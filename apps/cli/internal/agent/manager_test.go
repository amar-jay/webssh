//go:build linux || darwin

package agent

import (
	"context"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/amar-jay/webssh/packages/protocol"
)

func tmuxManager(t *testing.T) (*SessionManager, string) {
	t.Helper()
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not installed; durable integration requires tmux")
	}
	base, err := os.MkdirTemp("", "ws-")
	if err != nil {
		t.Fatal(err)
	}
	manager, err := OpenSessionManager(base, "owner/agent/workspace", "")
	if err != nil {
		os.RemoveAll(base)
		t.Fatal(err)
	}
	t.Cleanup(func() {
		live, ended := manager.Snapshot()
		for _, id := range append(live, ended...) {
			_ = manager.Terminate(id)
		}
		manager.Close()
		os.RemoveAll(base)
	})
	return manager, base
}
func durableAgent(t *testing.T, m *SessionManager, workspace string) *Agent {
	t.Helper()
	a, err := New(Options{Backend: "tmux", Manager: m, SessionID: "persistent-session", Workspace: workspace, Shell: "/bin/sh", AllowDevToken: true, Token: testToken})
	if err != nil {
		t.Fatal(err)
	}
	return a
}
func openDurable(t *testing.T, a *Agent, id string) (net.Conn, context.CancelFunc) {
	t.Helper()
	conn, cancel := connect(t, a)
	send(t, conn, protocol.Message{Type: "create", Version: protocol.Version, SessionID: id, Token: testToken, Cols: 80, Rows: 24, Capabilities: []string{"persistence", "reconnect", "terminate"}})
	ready := receive(t, conn)
	if ready.Type != "ready" || ready.SessionID != id || ready.Backend != "tmux" {
		t.Fatalf("not ready: %s / %s", ready.Type, ready.Error)
	}
	return conn, cancel
}
func outputUntil(t *testing.T, conn net.Conn, marker string) string {
	t.Helper()
	var text strings.Builder
	for text.Len() < 1<<20 {
		m := receive(t, conn)
		if m.Type == "error" {
			t.Fatalf("agent error: %s", m.Error)
		}
		if m.Type == "output" {
			text.Write(m.Data)
			if strings.Contains(text.String(), marker) {
				return text.String()
			}
		}
	}
	t.Fatal("expected output not found")
	return ""
}
func waitIdle(t *testing.T, a *Agent, id string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		a.controllerMu.Lock()
		busy := a.controlled[id]
		a.controllerMu.Unlock()
		if !busy {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("controller did not detach")
}

func TestTmuxPreservesWorkAcrossDetachRestartAndTermination(t *testing.T) {
	m, base := tmuxManager(t)
	workspace := filepath.Join(base, "workspace with spaces; no expansion")
	if err := os.Mkdir(workspace, 0700); err != nil {
		t.Fatal(err)
	}
	a := durableAgent(t, m, workspace)
	conn, cancel := openDurable(t, a, "persistent-session")
	// Only an observed marker proves the command started; do not match terminal echo.
	send(t, conn, protocol.Message{Type: "input", Data: []byte("export WS_TOKEN=kept; printf '\\123\\124\\101\\122\\124\\105\\104\\n'; sleep 1; printf SURVIVED > probe\n")})
	outputUntil(t, conn, "STARTED")
	second, _ := connect(t, a)
	send(t, second, protocol.Message{Type: "create", Version: protocol.Version, SessionID: "persistent-session", Token: testToken, Cols: 120, Rows: 40})
	if message := receive(t, second); message.Type != "error" || message.Error != "session_busy" {
		t.Fatal("second controller was not rejected")
	}
	second.Close()
	send(t, conn, protocol.Message{Type: "detach"})
	for {
		message := receive(t, conn)
		if message.Type == "detached" {
			break
		}
		if message.Type == "error" {
			t.Fatal(message.Error)
		}
	}
	conn.Close()
	cancel()
	waitIdle(t, a, "persistent-session")
	deadline := time.Now().Add(3 * time.Second)
	for {
		data, err := os.ReadFile(filepath.Join(workspace, "probe"))
		if err == nil && string(data) == "SURVIVED" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("long-running command did not survive detach")
		}
		time.Sleep(20 * time.Millisecond)
	}
	// A new manager/process incarnation recovers only the owned ledger and socket.
	runID := m.RunID()
	m.Close()
	recovered, err := OpenSessionManager(base, "owner/agent/workspace", "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = recovered.Terminate("persistent-session"); recovered.Close() })
	if recovered.RunID() != runID {
		t.Fatal("run identity changed across restart")
	}
	live, _ := recovered.Snapshot()
	if len(live) != 1 || live[0] != "persistent-session" {
		t.Fatal("owned session not recovered")
	}
	restarted := durableAgent(t, recovered, workspace)
	attached, _ := openDurable(t, restarted, "persistent-session")
	send(t, attached, protocol.Message{Type: "input", Data: []byte("printf '\\126\\101\\114\\125\\105:%s\\n' \"$WS_TOKEN\"; pwd\n")})
	redraw := outputUntil(t, attached, "VALUE:kept")
	if !strings.Contains(redraw, "STARTED") {
		t.Fatal("tmux did not redraw prior screen on reattach")
	}
	send(t, attached, protocol.Message{Type: "resize", Cols: 100, Rows: 30})
	send(t, attached, protocol.Message{Type: "input", Data: []byte("printf '\\124\\105\\122\\115\\111\\116\\101\\124\\105\\n'; sleep 1; printf LEAKED > after-termination\n")})
	outputUntil(t, attached, "TERMINATE")
	send(t, attached, protocol.Message{Type: "terminate"})
	for {
		message := receive(t, attached)
		if message.Type == "terminated" {
			break
		}
		if message.Type == "error" {
			t.Fatal(message.Error)
		}
	}
	attached.Close()
	time.Sleep(1200 * time.Millisecond)
	if _, err := os.Stat(filepath.Join(workspace, "after-termination")); !os.IsNotExist(err) {
		t.Fatal("explicit terminate did not stop foreground work")
	}
	waitIdle(t, restarted, "persistent-session")
	if !recovered.ledger.Sessions["persistent-session"].Ended || recovered.has(recovered.ledger.Sessions["persistent-session"]) {
		t.Fatal("termination left tmux session alive")
	}
	retry, _ := connect(t, restarted)
	send(t, retry, protocol.Message{Type: "create", Version: protocol.Version, SessionID: "persistent-session", Token: testToken, Cols: 80, Rows: 24})
	if message := receive(t, retry); message.Error != "session_ended" {
		t.Fatal("ended session was recreated")
	}
	retry.Close()
}

func TestTmuxRecoveryRejectsUnrelatedSessionsAndDuplicateAgents(t *testing.T) {
	m, base := tmuxManager(t)
	if other, err := OpenSessionManager(base, "owner/agent/workspace", ""); err == nil {
		other.Close()
		t.Fatal("duplicate workspace agent acquired lock")
	}
	// This name resembles ours but has no ledger ownership marker.
	name := ownedName("foreign-session")
	if _, err := m.command("new-session", "-d", "-s", name, "--", "/bin/sh", "-i"); err != nil {
		t.Fatal("test tmux setup failed")
	}
	t.Cleanup(func() { _, _ = m.command("kill-session", "-t", "="+name) })
	if _, err := m.Attach("foreign-session", true, Options{Workspace: base, Shell: "/bin/sh"}, "xterm", 80, 24); err == nil {
		t.Fatal("adopted unrelated tmux session")
	}
	if live, _ := m.Snapshot(); len(live) != 0 {
		t.Fatal("discovered unrelated tmux session")
	}
	// Even a stale/copied ledger marker must not authorize a foreign session.
	m.ledger.Sessions["foreign-session"] = sessionEntry{Name: name, Marker: strings.Repeat("a", 64)}
	if err := m.Terminate("foreign-session"); err == nil {
		t.Fatal("terminated unrelated session")
	}
	if !m.has(sessionEntry{Name: name}) {
		t.Fatal("foreign session was touched")
	}
}

func TestTmuxMissingReportsInstructionsWithoutFallback(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	if _, err := OpenSessionManager(t.TempDir(), "scope", ""); err == nil || !strings.Contains(err.Error(), "--backend ephemeral") {
		t.Fatal("missing tmux did not give explicit setup instructions")
	}
}

func TestTmuxSurvivesAbruptTransportLoss(t *testing.T) {
	manager, base := tmuxManager(t)
	a := durableAgent(t, manager, base)
	conn, _ := openDurable(t, a, "lost-transport")
	send(t, conn, protocol.Message{Type: "input", Data: []byte("printf '\\102\\105\\107\\111\\116\\n'; sleep 1; printf DONE > survived\n")})
	outputUntil(t, conn, "BEGIN")
	conn.Close()
	waitIdle(t, a, "lost-transport")
	deadline := time.Now().Add(3 * time.Second)
	for {
		if data, err := os.ReadFile(filepath.Join(base, "survived")); err == nil && string(data) == "DONE" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("transport loss killed work")
		}
		time.Sleep(20 * time.Millisecond)
	}
	again, _ := openDurable(t, a, "lost-transport")
	send(t, again, protocol.Message{Type: "input", Data: []byte("printf '\\122\\105\\103\\117\\126\\105\\122\\105\\104\\n'\n")})
	outputUntil(t, again, "RECOVERED")
	again.Close()
}

func TestTmuxSleepingControllerLosesLeaseWithoutKillingWork(t *testing.T) {
	manager, base := tmuxManager(t)
	a := durableAgent(t, manager, base)
	a.opts.ClientIdleTimeout = 250 * time.Millisecond
	sleeping, _ := openDurable(t, a, "sleeping-browser")
	send(t, sleeping, protocol.Message{Type: "input", Data: []byte("printf '\\102\\105\\107\\111\\116\\n'; sleep 1; printf DONE > awake\n")})
	outputUntil(t, sleeping, "BEGIN")
	// Leave TCP open but send no pings, as with a suspended browser.
	waitIdle(t, a, "sleeping-browser")
	deadline := time.Now().Add(3 * time.Second)
	for {
		if data, err := os.ReadFile(filepath.Join(base, "awake")); err == nil && string(data) == "DONE" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("sleeping controller stopped work")
		}
		time.Sleep(20 * time.Millisecond)
	}
	a.opts.ClientIdleTimeout = 20 * time.Second
	woke, _ := openDurable(t, a, "sleeping-browser")
	woke.Close()
	sleeping.Close()
}
