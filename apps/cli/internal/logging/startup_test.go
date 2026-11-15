package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestStartupOutputPrecedesDeferredLogs(t *testing.T) {
	var out bytes.Buffer
	base, _ := New(&out, "json", "info")
	logger, flush := BufferStartup(base.With("component", "agent"))
	original := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	record := slog.NewRecord(original, slog.LevelInfo, "Connecting to relay", 0)
	record.AddAttrs(slog.String("event", "relay_starting"))
	logger.Handler().Handle(context.Background(), record)
	logger.Info("Relay ready", "event", "relay_ready")
	if out.Len() != 0 {
		t.Fatal("startup logs appeared before command output")
	}
	out.WriteString("WORKSPACE_URL\n")
	flush()
	flush()
	logger.Info("Session attached", "event", "session_attached")
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 4 || lines[0] != "WORKSPACE_URL" {
		t.Fatal("wrong output ordering or duplicate flush")
	}
	for i, event := range []string{"relay_starting", "relay_ready", "session_attached"} {
		var entry map[string]any
		if err := json.Unmarshal([]byte(lines[i+1]), &entry); err != nil {
			t.Fatal(err)
		}
		if entry["event"] != event || entry["component"] != "agent" {
			t.Fatal("lost event attributes")
		}
		if i == 0 && entry["time"] != original.Format(time.RFC3339Nano) {
			t.Fatal("original timestamp lost")
		}
	}
}
func TestStartupErrorFlushesImmediately(t *testing.T) {
	var out bytes.Buffer
	base, _ := New(&out, "json", "info")
	logger, flush := BufferStartup(base)
	logger.With("component", "agent").Info("Connecting", "event", "relay_starting")
	logger.WithGroup("diagnostic").Error("Relay failed", "event", "relay_failed")
	if !strings.Contains(out.String(), "relay_starting") || !strings.Contains(out.String(), "relay_failed") {
		t.Fatal("error waited for banner")
	}
	before := out.String()
	flush()
	if out.String() != before {
		t.Fatal("error flush duplicated records")
	}
}
