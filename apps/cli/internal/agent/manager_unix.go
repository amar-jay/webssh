//go:build linux || darwin

package agent

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/sys/unix"
)

var sessionHandle = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

type sessionEntry struct {
	Name   string
	Marker string
	Ended  bool
}
type sessionLedger struct {
	Version  int
	Scope    string
	RunID    string
	Sessions map[string]sessionEntry
}

// SessionManager owns persistent processes independently of transport clients.
// The dedicated socket, private ledger, and per-session random marker must agree.
type SessionManager struct {
	mu                      sync.Mutex
	dir, socket, tmux, conf string
	lock                    *os.File
	ledger                  sessionLedger
	controllers             map[string]bool
}

func randomHandle() (string, error) {
	var b [16]byte
	_, err := rand.Read(b[:])
	return hex.EncodeToString(b[:]), err
}

func OpenSessionManager(base, scope, tmuxConfig string) (*SessionManager, error) {
	tmux, err := exec.LookPath("tmux")
	if err != nil {
		return nil, errors.New("tmux is required for durable sessions; install tmux with your system package manager, or explicitly use --backend ephemeral")
	}
	sum := sha256.Sum256([]byte(scope))
	identity := hex.EncodeToString(sum[:])
	dir := filepath.Join(base, identity[:20])
	if err = os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	// Refuse symlinks and directories writable by other users.
	info, err := os.Lstat(dir)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("session directory must be private (mode 0700)")
	}
	lock, err := os.OpenFile(filepath.Join(dir, "lock"), os.O_CREATE|os.O_RDWR|unix.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	if err = unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		lock.Close()
		return nil, errors.New("this workspace already has a running agent")
	}
	m := &SessionManager{dir: dir, socket: filepath.Join(dir, "tmux.sock"), tmux: tmux, conf: tmuxConfig, lock: lock, controllers: map[string]bool{}}
	if len(m.socket) > 100 {
		m.Close()
		return nil, errors.New("session socket path is too long; choose a shorter --state-dir")
	}
	path := filepath.Join(dir, "sessions.json")
	if info, err := os.Lstat(path); err == nil && (!info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0) {
		m.Close()
		return nil, errors.New("session ledger must be a private regular file")
	}
	var data []byte
	ledgerFile, err := os.OpenFile(path, os.O_RDONLY|unix.O_NOFOLLOW, 0)
	if err == nil {
		data, err = io.ReadAll(io.LimitReader(ledgerFile, 65537))
		ledgerFile.Close()
		if len(data) > 65536 {
			err = errors.New("ledger too large")
		}
	}
	if os.IsNotExist(err) {
		id, e := randomHandle()
		if e != nil {
			m.Close()
			return nil, e
		}
		m.ledger = sessionLedger{Version: 1, Scope: identity, RunID: id, Sessions: map[string]sessionEntry{}}
		err = m.save()
	} else if err == nil {
		decoder := json.NewDecoder(bytes.NewReader(data))
		decoder.DisallowUnknownFields()
		err = decoder.Decode(&m.ledger)
	}
	if err != nil || m.ledger.Version != 1 || m.ledger.Scope != identity || !sessionHandle.MatchString(m.ledger.RunID) || m.ledger.Sessions == nil || len(m.ledger.Sessions) > 128 {
		m.Close()
		return nil, errors.New("session ledger does not match this agent and workspace")
	}
	for id, e := range m.ledger.Sessions {
		if !sessionHandle.MatchString(id) || e.Name != ownedName(id) || len(e.Marker) != 64 {
			m.Close()
			return nil, errors.New("invalid session ledger")
		}
	}
	return m, nil
}
func (m *SessionManager) Close() {
	if m.lock != nil {
		_ = unix.Flock(int(m.lock.Fd()), unix.LOCK_UN)
		_ = m.lock.Close()
		m.lock = nil
	}
}
func (m *SessionManager) RunID() string { return m.ledger.RunID }
func (m *SessionManager) save() error {
	data, err := json.Marshal(m.ledger)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(m.dir, ".sessions-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if err = os.Rename(f.Name(), filepath.Join(m.dir, "sessions.json")); err != nil {
		return err
	}
	d, err := os.Open(m.dir)
	if err == nil {
		err = d.Sync()
		d.Close()
	}
	return err
}
func ownedName(id string) string {
	s := sha256.Sum256([]byte(id))
	return "webssh-" + hex.EncodeToString(s[:12])
}
func (m *SessionManager) tmuxPrefix() []string {
	file := "/dev/null"
	if m.conf != "" {
		file = m.conf
	}
	return []string{"-S", m.socket, "-f", file}
}
func (m *SessionManager) command(args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return m.commandContext(ctx, args...)
}
func (m *SessionManager) commandContext(ctx context.Context, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	cmd := exec.CommandContext(ctx, m.tmux, append(m.tmuxPrefix(), args...)...)
	cmd.Env = cleanEnvironment("xterm-256color")
	cmd.WaitDelay = 250 * time.Millisecond
	return cmd.Output()
}
func (m *SessionManager) ownedContext(ctx context.Context, e sessionEntry) bool {
	data, err := m.commandContext(ctx, "show-environment", "-t", "="+e.Name, "WEBSSH_OWNER_MARKER")
	return err == nil && strings.TrimSpace(string(data)) == "WEBSSH_OWNER_MARKER="+e.Marker
}
func (m *SessionManager) owned(e sessionEntry) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return m.ownedContext(ctx, e)
}
func (m *SessionManager) hasContext(ctx context.Context, e sessionEntry) bool {
	_, err := m.commandContext(ctx, "has-session", "-t", "="+e.Name)
	return err == nil
}
func (m *SessionManager) has(e sessionEntry) bool {
	_, err := m.command("has-session", "-t", "="+e.Name)
	return err == nil
}
func (m *SessionManager) Acquire(id string) (func(), error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !sessionHandle.MatchString(id) {
		return nil, errors.New("invalid_attach")
	}
	if m.controllers[id] {
		return nil, errors.New("session_busy")
	}
	m.controllers[id] = true
	return func() { m.mu.Lock(); delete(m.controllers, id); m.mu.Unlock() }, nil
}
func (m *SessionManager) Attach(id string, create bool, opts Options, term string, cols, rows int) (*process, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return m.AttachContext(ctx, id, create, opts, term, cols, rows)
}
func (m *SessionManager) AttachContext(ctx context.Context, id string, create bool, opts Options, term string, cols, rows int) (*process, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	m.mu.Lock()
	defer m.mu.Unlock()
	if ctx.Err() != nil {
		return nil, errors.New("backend_unavailable")
	}
	e, exists := m.ledger.Sessions[id]
	if exists && e.Ended {
		return nil, errors.New("session_ended")
	}
	if !exists {
		if len(m.ledger.Sessions) >= 128 {
			return nil, errors.New("backend_unavailable")
		}
		if !create {
			return nil, errors.New("session_not_found")
		}
		marker, err := randomHandle()
		if err != nil {
			return nil, err
		}
		marker2, err := randomHandle()
		if err != nil {
			return nil, err
		}
		e = sessionEntry{Name: ownedName(id), Marker: marker + marker2}
		m.ledger.Sessions[id] = e
		// Persist ownership before launching any process. Never adopt a name collision.
		if m.hasContext(ctx, e) {
			delete(m.ledger.Sessions, id)
			return nil, errors.New("backend_unavailable")
		}
		if err = m.save(); err != nil {
			return nil, err
		}
		if _, err = m.commandContext(ctx, "new-session", "-d", "-s", e.Name, "-c", opts.Workspace, "-x", strconv.Itoa(cols), "-y", strconv.Itoa(rows), "-e", "WEBSSH_OWNER_MARKER="+e.Marker, "-e", "WEBSSH=1", "--", opts.Shell, "-i"); err != nil {
			return nil, errors.New("shell_start_failed")
		}
		if _, err = m.commandContext(ctx, "set-window-option", "-t", "="+e.Name, "remain-on-exit", "on"); err != nil {
			return nil, errors.New("backend_unavailable")
		}
	}
	if !m.ownedContext(ctx, e) {
		return nil, errors.New("backend_unavailable")
	}
	if ctx.Err() != nil {
		return nil, errors.New("backend_unavailable")
	}
	// No -d: a new client must never silently take over another controller.
	cmd := exec.Command(m.tmux, append(m.tmuxPrefix(), "attach-session", "-t", "="+e.Name)...)
	return startCommand(cmd, opts.Workspace, term, cols, rows)
}

// State never equates a disconnected tmux client with a dead pane.
func (m *SessionManager) State(id string) (bool, int, bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return m.StateContext(ctx, id)
}
func (m *SessionManager) StateContext(ctx context.Context, id string) (bool, int, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state(ctx, id)
}
func (m *SessionManager) state(ctx context.Context, id string) (bool, int, bool, error) {
	e, exists := m.ledger.Sessions[id]
	if !exists {
		return false, 0, false, errors.New("session_not_found")
	}
	if e.Ended {
		return true, 0, false, nil
	}
	if !m.ownedContext(ctx, e) {
		return false, 0, false, errors.New("backend_unavailable")
	}
	data, err := m.commandContext(ctx, "list-panes", "-s", "-t", "="+e.Name, "-F", "#{pane_dead} #{pane_dead_status}")
	if err != nil {
		return false, 0, false, errors.New("backend_unavailable")
	}
	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	exitCode := 0
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) < 1 || fields[0] != "1" {
			return false, 0, false, nil
		}
		if len(fields) == 2 {
			exitCode, _ = strconv.Atoi(fields[1])
		}
	}
	return true, exitCode, len(lines) == 1, nil
}
func (m *SessionManager) Terminate(id string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return m.TerminateContext(ctx, id)
}
func (m *SessionManager) TerminateContext(ctx context.Context, id string) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	m.mu.Lock()
	defer m.mu.Unlock()
	e, exists := m.ledger.Sessions[id]
	if !exists {
		return nil
	}
	if e.Ended {
		return nil
	}
	if m.hasContext(ctx, e) {
		if !m.ownedContext(ctx, e) {
			return errors.New("backend_unavailable")
		}
		if _, err := m.commandContext(ctx, "kill-session", "-t", "="+e.Name); err != nil {
			return errors.New("backend_unavailable")
		}
	} else {
		return errors.New("backend_unavailable")
	}
	if ctx.Err() != nil {
		return errors.New("backend_unavailable")
	}
	e.Ended = true
	m.ledger.Sessions[id] = e
	return m.save()
}

// Snapshot discovers only ledger entries on our private socket; foreign sessions
// and marker mismatches are never adopted, attached, or terminated.
func (m *SessionManager) Snapshot() (live, ended []string) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return m.SnapshotContext(ctx)
}
func (m *SessionManager) SnapshotContext(ctx context.Context) (live, ended []string) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, e := range m.ledger.Sessions {
		if ctx.Err() != nil {
			break
		}
		if e.Ended {
			ended = append(ended, id)
			continue
		}
		if !m.ownedContext(ctx, e) {
			continue
		}
		dead, _, _, err := m.state(ctx, id)
		if err != nil {
			continue
		}
		if dead {
			ended = append(ended, id)
		} else {
			live = append(live, id)
		}
	}
	return
}
func (m *SessionManager) String() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return fmt.Sprintf("tmux session manager (%d sessions)", len(m.ledger.Sessions))
}

// SessionInfo exposes only stable IDs and lifecycle state, never names, markers or credentials.
type SessionInfo struct {
	ID     string
	Status string
}

func (m *SessionManager) List(ctx context.Context) ([]SessionInfo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var result []SessionInfo
	for id := range m.ledger.Sessions {
		if ctx.Err() != nil {
			return nil, errors.New("backend_unavailable")
		}
		dead, _, _, err := m.state(ctx, id)
		status := "running"
		if err != nil {
			status = "unavailable"
		} else if dead {
			status = "ended"
		}
		result = append(result, SessionInfo{ID: id, Status: status})
	}
	return result, nil
}
