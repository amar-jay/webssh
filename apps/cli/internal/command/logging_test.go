package command

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/amar-jay/webssh/apps/cli/internal/agent"
	"github.com/amar-jay/webssh/apps/cli/internal/config"
	"github.com/amar-jay/webssh/apps/cli/internal/logging"
	"github.com/urfave/cli/v3"
)

// useConfig writes a configuration with the given logging settings into a
// temporary HOME so the root command picks it up.
func useConfig(t *testing.T, level, format string) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	cfg := config.Defaults()
	cfg.LogLevel, cfg.LogFormat = level, format
	if err := config.Save(filepath.Join(home, ".webssh", "config.toml"), cfg); err != nil {
		t.Fatal(err)
	}
}

func TestRootLoggerUsesSavedConfig(t *testing.T) {
	useConfig(t, "info", "text")
	var out bytes.Buffer
	err := run([]string{"webssh", "config", "unexpected"}, &out)
	if err == nil || strings.Count(out.String(), "Command failed") != 1 || !strings.Contains(out.String(), "level=ERROR") {
		t.Fatalf("expected one text error from saved config: %q %v", out.String(), err)
	}
}

func TestRootLoggerDefaultsWhenConfigIsInvalid(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	path := filepath.Join(home, ".webssh", "config.toml")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("version = 1\nmachine_name = 'm'\nshell = '/bin/sh'\nlog_level = 'invalid'\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := run([]string{"webssh", "config"}, &out); err == nil {
		t.Fatal("invalid config must still be reported")
	}
	if !json.Valid(bytes.TrimSpace(out.Bytes())) || strings.Count(out.String(), "Command failed") != 1 {
		t.Fatalf("invalid config must fall back to default logging: %q", out.String())
	}
}

func TestRootLoggerKeepsStdoutSeparate(t *testing.T) {
	useConfig(t, "info", "json")
	var output, diagnostics bytes.Buffer
	cmd := New()
	cmd.Writer = &output
	cmd.ErrWriter = &diagnostics
	cmd.Commands = []*cli.Command{{Name: "probe", Action: func(ctx context.Context, c *cli.Command) error {
		logging.From(ctx).Info("Status", "event", "probe")
		_, err := c.Writer.Write([]byte(`{"url":"https://ssh.amarjay.com/s/opaque"}` + "\n"))
		return err
	}}}
	if err := cmd.Run(t.Context(), []string{"webssh", "probe"}); err != nil {
		t.Fatal(err)
	}
	if !json.Valid(bytes.TrimSpace(output.Bytes())) || !json.Valid(bytes.TrimSpace(diagnostics.Bytes())) {
		t.Fatal("command output and logs were mixed")
	}
	if strings.Contains(diagnostics.String(), "opaque") {
		t.Fatal("command data leaked into logs")
	}
}

func TestAgentEventsUseLevelsAndFixedNames(t *testing.T) {
	var out bytes.Buffer
	logger, _ := logging.New(&out, "json", "info")
	logAgentEvent(context.Background(), logger, agent.ConnectionOpened)
	logAgentEvent(context.Background(), logger, agent.Event("unknown-private-value"))
	if out.Len() != 0 {
		t.Fatal("debug or unknown event leaked")
	}
	logAgentEvent(context.Background(), logger, agent.AccessDenied)
	var record map[string]any
	if err := json.Unmarshal(out.Bytes(), &record); err != nil {
		t.Fatal(err)
	}
	if record["level"] != slog.LevelWarn.String() || record["event"] != "access_denied" {
		t.Fatal("wrong event classification")
	}
}

func TestSavedConfigControlsLogging(t *testing.T) {
	useConfig(t, "error", "json")
	var out bytes.Buffer
	if err := run([]string{"webssh", "config", "unexpected"}, &out); err == nil {
		t.Fatal("expected a command error")
	}
	var record map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(out.Bytes()), &record); err != nil {
		t.Fatalf("saved JSON format ignored: %q", out.String())
	}
	if record["level"] != "ERROR" {
		t.Fatalf("saved level ignored: %v", record["level"])
	}
}
