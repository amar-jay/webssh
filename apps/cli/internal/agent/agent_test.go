//go:build linux || darwin

package agent

import (
	"context"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/amar-jay/webssh/packages/protocol"
)

const testToken = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func testAgent(t *testing.T, shell string) *Agent {
	t.Helper()
	a, err := New(Options{Workspace: t.TempDir(), Shell: shell, AllowDevToken: true, Token: testToken})
	if err != nil {
		t.Fatal(err)
	}
	return a
}

func connect(t *testing.T, a *Agent) (net.Conn, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- a.Serve(ctx, listener) }()
	conn, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	_ = conn.SetDeadline(time.Now().Add(8 * time.Second))
	stop := func() {
		conn.Close()
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Error(err)
			}
		case <-time.After(3 * time.Second):
			t.Error("agent shutdown did not finish")
		}
	}
	t.Cleanup(stop)
	return conn, cancel
}

func send(t *testing.T, conn net.Conn, message protocol.Message) {
	t.Helper()
	if err := protocol.Write(conn, message); err != nil {
		t.Fatal(err)
	}
}
func receive(t *testing.T, conn net.Conn) protocol.Message {
	t.Helper()
	message, err := protocol.Read(conn)
	if err != nil {
		t.Fatal(err)
	}
	return message
}
func attach(t *testing.T, conn net.Conn) {
	t.Helper()
	send(t, conn, protocol.Message{Type: "attach", Version: 1, Token: testToken, Cols: 80, Rows: 24})
	if got := receive(t, conn); got.Type != "ready" || got.Version != 1 {
		t.Fatalf("not ready: %+v", got)
	}
}

func TestUnauthorizedCannotStartShell(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "started")
	shell := filepath.Join(t.TempDir(), "shell")
	if err := os.WriteFile(shell, []byte("#!/bin/sh\ntouch '"+marker+"'\nexec /bin/sh -i\n"), 0700); err != nil {
		t.Fatal(err)
	}
	a := testAgent(t, shell)
	conn, _ := connect(t, a)
	send(t, conn, protocol.Message{Type: "attach", Version: 1, Token: strings.Repeat("b", 43), Cols: 80, Rows: 24})
	if got := receive(t, conn); got.Type != "error" || got.Error != "unauthorized" {
		t.Fatalf("unauthorized response: %+v", got)
	}
	if _, err := os.Stat(marker); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("shell started before auth: %v", err)
	}
}

func TestInvalidGrantNeverStartsShell(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "started")
	shell := filepath.Join(t.TempDir(), "shell")
	if err := os.WriteFile(shell, []byte("#!/bin/sh\ntouch '"+marker+"'\nexec /bin/sh -i\n"), 0700); err != nil {
		t.Fatal(err)
	}
	a, err := New(Options{
		Workspace: t.TempDir(),
		Shell:     shell,
		Grants:    NewGrantVerifier("agent1", "grant-key-material"), SessionID: "sess1", CheckAccess: func(context.Context, string, string) error { return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	conn, _ := connect(t, a)
	send(t, conn, protocol.Message{Type: "attach", Version: 1, Token: testToken, Cols: 80, Rows: 24})
	if got := receive(t, conn); got.Type != "error" || got.Error != "unauthorized" {
		t.Fatalf("dev token against grants-only agent: %+v", got)
	}
	if _, err := os.Stat(marker); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("shell started before grant: %v", err)
	}

	conn2, _ := connect(t, a)
	grant := EncodeGrant("agent1", "grant-key-material", "sess1", "nonce1", time.Now().Add(time.Minute).Unix())
	send(t, conn2, protocol.Message{Type: "attach", Version: 1, Token: grant, Cols: 80, Rows: 24})
	if got := receive(t, conn2); got.Type != "ready" {
		t.Fatalf("valid grant: %+v", got)
	}
	deadline := time.Now().Add(time.Second)
	for {
		if _, err := os.Stat(marker); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("shell marker not created")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestTerminalWorkspaceResizeAndExit(t *testing.T) {
	a := testAgent(t, "/bin/sh")
	conn, _ := connect(t, a)
	attach(t, conn)
	send(t, conn, protocol.Message{Type: "resize", Cols: 120, Rows: 40})
	send(t, conn, protocol.Message{Type: "input", Data: []byte("printf '\\101\\107\\105\\116\\124\\137\\117\\113\\n'; pwd; stty size; exit 7\n")})
	var output strings.Builder
	for {
		m := receive(t, conn)
		if m.Type == "output" {
			output.Write(m.Data)
			continue
		}
		if m.Type != "exit" || m.Code != 7 {
			t.Fatalf("expected exit 7, got %+v; output: %q", m, output.String())
		}
		break
	}
	for _, want := range []string{"AGENT_OK", a.opts.Workspace, "40 120"} {
		if !strings.Contains(output.String(), want) {
			t.Fatalf("missing %q in output: %q", want, output.String())
		}
	}
}

func TestDisconnectKillsAndReapsShell(t *testing.T) {
	pidFile := filepath.Join(t.TempDir(), "pid")
	shell := filepath.Join(t.TempDir(), "shell")
	if err := os.WriteFile(shell, []byte("#!/bin/sh\necho $$ > '"+pidFile+"'\nexec /bin/sh -i\n"), 0700); err != nil {
		t.Fatal(err)
	}
	a := testAgent(t, shell)
	conn, cancel := connect(t, a)
	attach(t, conn)
	var pid int
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if b, err := os.ReadFile(pidFile); err == nil {
			pid, _ = strconv.Atoi(strings.TrimSpace(string(b)))
			if pid > 0 {
				break
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
	if pid == 0 {
		t.Fatal("shell did not start")
	}
	conn.Close()
	cancel()
	for time.Now().Before(deadline.Add(time.Second)) {
		if errors.Is(syscall.Kill(pid, 0), syscall.ESRCH) {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("shell was not killed and reaped")
}

func TestInvalidHandshakeAndResize(t *testing.T) {
	for _, hello := range []protocol.Message{
		{Type: "attach", Version: 2, Token: testToken, Cols: 80, Rows: 24},
		{Type: "attach", Version: 1, Token: testToken, Cols: 0, Rows: 24},
		{Type: "attach", Version: 1, Token: testToken, Cols: 80, Rows: 24, Term: "bad\x1b"},
	} {
		a := testAgent(t, "/bin/sh")
		conn, _ := connect(t, a)
		send(t, conn, hello)
		if got := receive(t, conn); got.Type != "error" {
			t.Fatalf("invalid handshake accepted: %+v", got)
		}
	}
	a := testAgent(t, "/bin/sh")
	conn, _ := connect(t, a)
	attach(t, conn)
	send(t, conn, protocol.Message{Type: "resize", Cols: 100000, Rows: 24})
	for {
		m := receive(t, conn)
		if m.Type == "output" {
			continue
		}
		if m.Type != "error" {
			t.Fatalf("invalid resize accepted: %+v", m)
		}
		break
	}
}

func TestOptionsValidation(t *testing.T) {
	for _, opts := range []Options{
		{Workspace: "", Shell: "/bin/sh"}, {Workspace: t.TempDir(), Shell: "/not/a/shell"},
		{Workspace: t.TempDir(), Shell: "/bin/sh", AllowDevToken: true, Token: "short"}, {Workspace: t.TempDir(), Shell: "/bin/sh", Port: -1},
		{Workspace: t.TempDir(), Shell: "/bin/sh", MaxConnections: -1},
	} {
		if _, err := New(opts); err == nil {
			t.Fatal("invalid options accepted")
		}
	}
	a := testAgent(t, "/bin/sh")
	b, err := New(Options{Workspace: a.opts.Workspace, Shell: "/bin/sh", AllowDevToken: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(b.opts.Token) != 43 || b.opts.Port != protocol.DefaultPort {
		t.Fatal("missing ephemeral defaults")
	}
}

func TestRunBindingAndOnlineDenial(t *testing.T) {
	a := testAgent(t, "/bin/sh")
	a.opts.Grants = NewGrantVerifier("agent", "key")
	a.opts.SessionID = "this-run"
	a.opts.AllowDevToken = false
	calls := 0
	a.opts.CheckAccess = func(context.Context, string, string) error { calls++; return errors.New("revoked") }
	if a.authorize(EncodeGrant("agent", "key", "other-run", "n1", time.Now().Unix()+60)) {
		t.Fatal("foreign run admitted")
	}
	if calls != 0 {
		t.Fatal("foreign run reached control plane")
	}
	if a.authorize(EncodeGrant("agent", "key", "this-run", "n2", time.Now().Unix()+60)) {
		t.Fatal("revoked/offline agent admitted")
	}
	if calls != 1 {
		t.Fatal("missing online authorization")
	}
}

func TestNoImplicitDevelopmentAuthentication(t *testing.T) {
	if _, err := New(Options{Workspace: t.TempDir(), Shell: "/bin/sh"}); err == nil {
		t.Fatal("implicit token fallback")
	}
	if _, err := New(Options{Workspace: t.TempDir(), Shell: "/bin/sh", Token: testToken}); err == nil {
		t.Fatal("implicit dev token enable")
	}
}

func TestLiveConnectionClosesOnOnlineRevocation(t *testing.T) {
	a := testAgent(t, "/bin/sh")
	a.opts.Grants = NewGrantVerifier("agent", "key")
	a.opts.SessionID = "run"
	a.opts.AllowDevToken = false
	var revoked atomic.Bool
	a.opts.CheckAccess = func(context.Context, string, string) error {
		if revoked.Load() {
			return errors.New("revoked")
		}
		return nil
	}
	conn, _ := connect(t, a)
	send(t, conn, protocol.Message{Type: "attach", Version: 1, Token: EncodeGrant("agent", "key", "run", "nonce", time.Now().Unix()+60), Cols: 80, Rows: 24})
	if m := receive(t, conn); m.Type != "ready" {
		t.Fatal("not ready")
	}
	revoked.Store(true)
	_ = conn.SetReadDeadline(time.Now().Add(4 * time.Second))
	for {
		_, err := protocol.Read(conn)
		if err != nil {
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				t.Fatal("revocation did not close socket")
			}
			break
		}
	}
}
