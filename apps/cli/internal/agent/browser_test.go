//go:build linux || darwin

package agent

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"tailscale.com/tstest/integration"
	"tailscale.com/types/logger"
)

func TestBrowserTerminal(t *testing.T) {
	if os.Getenv("WEBSSH_BROWSER_TEST") != "1" {
		t.Skip("set WEBSSH_BROWSER_TEST=1; requires Chromium, pnpm install and pnpm wasm:build")
	}
	workspace := t.TempDir()
	for name, content := range map[string]string{"unicode.txt": "TAILCAT_BROWSER_OK café İstanbul 日本語\n", "interrupt.txt": "INTERRUPT_OK\n"} {
		if err := os.WriteFile(filepath.Join(workspace, name), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	dm := integration.RunDERPAndSTUN(t, logger.Discard, "127.0.0.1")
	server, err := New(Options{Workspace: workspace, Shell: "/bin/sh", Region: dm.Regions[1]})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	ready := make(chan Info, 1)
	done := make(chan error, 1)
	go func() { done <- server.Run(ctx, func(info Info) error { ready <- info; return nil }) }()
	defer func() {
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Error(err)
			}
		case <-time.After(5 * time.Second):
			t.Error("agent shutdown timed out")
		}
	}()
	var info Info
	select {
	case info = <-ready:
	case <-ctx.Done():
		t.Fatal("agent startup timed out")
	}
	record := filepath.Join(t.TempDir(), "connection.json")
	data, err := json.Marshal(info)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(record, data, 0600); err != nil {
		t.Fatal(err)
	}
	_, file, _, _ := runtime.Caller(0)
	script := filepath.Join(filepath.Dir(file), "../../../web/tests/browser/terminal.mjs")
	cmd := exec.CommandContext(ctx, "node", script, record, workspace)
	// The script emits only fixed test descriptions, never credentials or output.
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("browser integration: %v\n%s", err, output)
	}
	t.Log(string(output))
}
