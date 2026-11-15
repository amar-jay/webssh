//go:build linux || darwin

package command

import (
	"bytes"
	"context"
	"github.com/amar-jay/webssh/packages/protocol"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/amar-jay/webssh/apps/cli/internal/agent"
	"github.com/amar-jay/webssh/apps/cli/internal/config"
	"github.com/amar-jay/webssh/apps/cli/internal/credentials"
)

func TestSessionCleanupRequiresWorkspaceLockAndExactOwnedID(t *testing.T) {
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux unavailable")
	}
	dir, err := os.MkdirTemp("", "ws-clean-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	cfg := config.Config{Version: 1, MachineName: "test", Shell: "/bin/sh"}
	creds := credentials.File{Version: 1, Origin: "https://example.com", OwnerID: "owner", AgentID: "agent", AgentToken: "private-token", GrantKey: "private-key", MachineName: "test"}
	cfgPath, credPath := filepath.Join(dir, "config.toml"), filepath.Join(dir, "credentials.toml")
	if err := config.Save(cfgPath, cfg); err != nil {
		t.Fatal(err)
	}
	if err := credentials.Save(credPath, creds); err != nil {
		t.Fatal(err)
	}
	base := filepath.Join(dir, "sessions")
	scope := managerScope(creds, cfg, dir)
	manager, err := agent.OpenSessionManager(base, scope, "")
	if err != nil {
		t.Fatal(err)
	}
	server, err := agent.New(agent.Options{Backend: "tmux", Manager: manager, Workspace: dir, Shell: "/bin/sh", SessionID: "cleanup-session", AllowDevToken: true, Token: strings.Repeat("t", 43)})
	if err != nil {
		manager.Close()
		t.Fatal(err)
	}
	defer func() { _ = manager.Terminate("cleanup-session"); manager.Close() }()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- server.Serve(ctx, listener) }()
	joined := false
	defer func() {
		cancel()
		if !joined {
			select {
			case <-done:
			case <-time.After(3 * time.Second):
				t.Error("agent did not stop")
			}
		}
	}()
	client, err := net.Dial("tcp", listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_ = client.SetDeadline(time.Now().Add(4 * time.Second))
	if err := protocol.Write(client, protocol.Message{Type: "create", Version: protocol.Version, SessionID: "cleanup-session", Token: strings.Repeat("t", 43), Cols: 80, Rows: 24}); err != nil {
		t.Fatal(err)
	}
	if ready, err := protocol.Read(client); err != nil || ready.Type != "ready" {
		t.Fatal("owned session did not start")
	}
	args := func(extra ...string) []string {
		return append(append([]string{"webssh", "sessions", "--config", cfgPath, "--credentials", credPath, "--state-dir", base}, extra...), dir)
	}
	if err := New().Run(context.Background(), args("--terminate", "cleanup-session")); err == nil || !strings.Contains(err.Error(), "already") {
		t.Fatal("cleanup bypassed running-agent lock")
	}
	cancel()
	select {
	case err := <-done:
		joined = true
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("agent stop timeout")
	}
	manager.Close()
	if err := New().Run(context.Background(), args("--terminate", "not-owned")); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatal("unknown session accepted")
	}
	if err := New().Run(context.Background(), args("--terminate", "cleanup-session")); err != nil {
		t.Fatal(err)
	}
	reopened, err := agent.OpenSessionManager(base, scope, "")
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if dead, _, _, err := reopened.State("cleanup-session"); err != nil || !dead {
		t.Fatal("owned session not terminated")
	}
}

func TestPersistenceHelpDistinguishesStopAndTerminate(t *testing.T) {
	if !strings.Contains(persistenceMessage("tmux"), "stays running") || !strings.Contains(persistenceMessage("ephemeral"), "ends its shells") {
		t.Fatal("ambiguous stop behavior")
	}
	if !strings.Contains(serveCommand().Description, "preserves remote work") {
		t.Fatal("serve help missing persistence behavior")
	}
}

func TestSessionPruneSubcommandNeedsNoWorkspace(t *testing.T) {
	var output bytes.Buffer
	cmd := New()
	cmd.Writer = &output
	base := filepath.Join(t.TempDir(), "missing")
	if err := cmd.Run(context.Background(), []string{"webssh", "sessions", "prune", "--state-dir", base}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(output.String(), "Preview only") {
		t.Fatal(output.String())
	}
	if _, err := os.Stat(base); !os.IsNotExist(err) {
		t.Fatal("preview created state directory")
	}
}
