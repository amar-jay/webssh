package command

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"

	"github.com/amar-jay/webssh/apps/cli/internal/agent"
	"github.com/amar-jay/webssh/apps/cli/internal/logging"
	"github.com/urfave/cli/v3"
)

func TestRootLoggerEnvironmentAndSingleError(t *testing.T) {
	var out bytes.Buffer
	t.Setenv("LOG_FORMAT", "text")
	t.Setenv("LOG_LEVEL", "info")
	err := run([]string{"webssh", "config", "unexpected"}, &out)
	if err == nil || strings.Count(out.String(), "Command failed") != 1 || !strings.Contains(out.String(), "level=ERROR") {
		t.Fatalf("expected one text error: %q %v", out.String(), err)
	}
	out.Reset()
	t.Setenv("LOG_LEVEL", "invalid")
	err = run([]string{"webssh", "config"}, &out)
	if err == nil || !json.Valid(bytes.TrimSpace(out.Bytes())) {
		t.Fatal("invalid log level did not fail with a diagnostic")
	}
}
func TestRootLoggerKeepsStdoutSeparate(t *testing.T) {
	t.Setenv("LOG_FORMAT", "json")
	t.Setenv("LOG_LEVEL", "info")
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
