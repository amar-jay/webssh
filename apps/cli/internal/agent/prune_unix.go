//go:build linux || darwin

package agent

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

// The base gate prevents an opener from waiting on a workspace lock that prune
// has unlinked. Normal agents hold this gate only while opening their ledger.
func sessionGate(base string, exclusive bool) (func(), error) {
	if err := os.MkdirAll(base, 0700); err != nil {
		return nil, err
	}
	if !privatePath(base, true) {
		return nil, errors.New("session state directory must be private and owned by this user")
	}
	file, err := os.OpenFile(filepath.Join(base, ".maintenance.lock"), os.O_CREATE|os.O_RDWR|unix.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	mode := unix.LOCK_SH
	if exclusive {
		mode = unix.LOCK_EX
	}
	info, err := file.Stat()
	if err != nil || !privateInfo(info, false) {
		file.Close()
		return nil, errors.New("invalid session maintenance lock")
	}
	if err := unix.Flock(int(file.Fd()), mode|unix.LOCK_NB); err != nil {
		file.Close()
		return nil, errors.New("session state is busy; retry after the other operation finishes")
	}
	return func() { _ = unix.Flock(int(file.Fd()), unix.LOCK_UN); _ = file.Close() }, nil
}

func privateInfo(info os.FileInfo, directory bool) bool {
	if info == nil || info.Mode().Perm()&0077 != 0 {
		return false
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != uint32(os.Geteuid()) {
		return false
	}
	if directory {
		return info.IsDir()
	}
	return info.Mode().IsRegular()
}
func privatePath(path string, directory bool) bool {
	info, err := os.Lstat(path)
	return err == nil && privateInfo(info, directory)
}

// PruneResult contains only directory handles and fixed reasons, never ledger secrets.
type PruneResult struct{ Directory, Status string }

var workspaceDirectory = regexp.MustCompile(`^[a-f0-9]{20}$`)

// PruneSessions never kills a process. A listening socket (including a foreign
// server), an active agent, unrecognized files or uncertain state prevent removal.
// Removing a whole stale ledger causes the next serve to mint a new run identity;
// individual tombstones are never discarded from a surviving run.
func PruneSessions(ctx context.Context, base string, apply bool) ([]PruneResult, error) {
	if _, err := os.Lstat(base); os.IsNotExist(err) {
		return nil, nil
	}
	unlock, err := sessionGate(base, true)
	if err != nil {
		return nil, err
	}
	defer unlock()
	entries, err := os.ReadDir(base)
	if err != nil {
		return nil, err
	}
	var results []PruneResult
	for _, entry := range entries {
		if ctx.Err() != nil {
			return results, ctx.Err()
		}
		if !workspaceDirectory.MatchString(entry.Name()) {
			continue
		}
		status := pruneWorkspace(ctx, base, entry.Name(), apply)
		results = append(results, PruneResult{entry.Name(), status})
	}
	return results, nil
}

func pruneWorkspace(ctx context.Context, base, name string, apply bool) string {
	dir := filepath.Join(base, name)
	if !privatePath(dir, true) {
		return "kept: unrecognized directory"
	}
	// Do not create a lock or ledger just to inspect an unfamiliar directory.
	lock, err := os.OpenFile(filepath.Join(dir, "lock"), os.O_RDWR|unix.O_NOFOLLOW, 0)
	if err != nil {
		return "kept: missing or invalid lock"
	}
	defer lock.Close()
	info, err := lock.Stat()
	if err != nil || !privateInfo(info, false) {
		return "kept: invalid lock"
	}
	if err := unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		return "kept: agent running"
	}
	defer unix.Flock(int(lock.Fd()), unix.LOCK_UN)
	ledger, err := os.OpenFile(filepath.Join(dir, "sessions.json"), os.O_RDONLY|unix.O_NOFOLLOW, 0)
	if err != nil {
		return "kept: missing or invalid ledger"
	}
	info, err = ledger.Stat()
	if err != nil || !privateInfo(info, false) {
		ledger.Close()
		return "kept: invalid ledger"
	}
	data, err := io.ReadAll(io.LimitReader(ledger, 65537))
	ledger.Close()
	var state sessionLedger
	if err != nil || len(data) > 65536 || json.Unmarshal(data, &state) != nil || state.Version != 1 || len(state.Scope) != 64 || !strings.HasPrefix(state.Scope, name) || !sessionHandle.MatchString(state.RunID) || state.Sessions == nil {
		return "kept: invalid ledger"
	}
	for id, session := range state.Sessions {
		if !sessionHandle.MatchString(id) || session.Name != ownedName(id) || len(session.Marker) != 64 {
			return "kept: invalid ledger"
		}
	}
	files, err := os.ReadDir(dir)
	if err != nil {
		return "kept: inspection failed"
	}
	for _, file := range files {
		switch file.Name() {
		case "lock", "sessions.json":
		case "tmux.sock":
			info, err := os.Lstat(filepath.Join(dir, file.Name()))
			if err != nil || info.Mode()&os.ModeSocket == 0 {
				return "kept: unrecognized socket"
			}
		default:
			return "kept: unrecognized files"
		}
	}
	socket := filepath.Join(dir, "tmux.sock")
	// A socket can be absent while a server is still running if it was manually
	// unlinked. Ledger entries not confirmed ended are therefore retained unless
	// there is a stale socket proving the old endpoint has stopped listening.
	_, socketErr := os.Lstat(socket)
	if socketErr != nil && !os.IsNotExist(socketErr) {
		return "kept: socket unavailable"
	}
	if os.IsNotExist(socketErr) {
		for _, session := range state.Sessions {
			if !session.Ended {
				return "kept: unconfirmed sessions"
			}
		}
	} else {
		dialer := net.Dialer{Timeout: time.Second}
		conn, err := dialer.DialContext(ctx, "unix", socket)
		if err == nil {
			conn.Close()
			return "kept: tmux server running"
		}
		if !errors.Is(err, syscall.ECONNREFUSED) {
			return "kept: socket unavailable"
		}
	}
	if ctx.Err() != nil {
		return "kept: inspection cancelled"
	}
	if !apply {
		return "stale: would remove"
	}
	// Only remove the three recognized entries; never recursively delete data.
	for _, file := range []string{"tmux.sock", "sessions.json", "lock"} {
		if err := os.Remove(filepath.Join(dir, file)); err != nil && !os.IsNotExist(err) {
			return "kept: cleanup incomplete"
		}
	}
	if err := os.Remove(dir); err != nil {
		return "kept: cleanup incomplete"
	}
	return "removed"
}
