package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"testing"
)

func TestJSONLevelsAndRedaction(t *testing.T) {
	var out bytes.Buffer
	logger, err := New(&out, "json", "warn")
	if err != nil {
		t.Fatal(err)
	}
	logger.Info("filtered")
	logger.Warn("request failed", "component", "agent", "grant", "private-grant", "node_private_key", "privkey:abcd", "error", errors.New("token=private-secret request https://private-host/path?grant=private open /home/private-directory/credentials.toml"), "time", "not-a-timestamp", slog.Group("credentials", slog.String("value", "nested-secret")))
	var record map[string]any
	if err := json.Unmarshal(out.Bytes(), &record); err != nil {
		t.Fatal(err)
	}
	if record["level"] != "WARN" || record["app"] != "webssh" || record["grant"] != "[redacted]" {
		t.Fatalf("invalid structured record: %s", out.String())
	}
	for _, secret := range []string{"private-grant", "privkey:abcd", "private-secret", "private-host", "private-directory", "nested-secret", "filtered"} {
		if strings.Contains(out.String(), secret) {
			t.Fatalf("leaked sensitive value or filtered record: %s", secret)
		}
	}
}
func TestContextAndConcurrentRecords(t *testing.T) {
	var out bytes.Buffer
	logger, _ := New(&out, "json", "debug")
	ctx := WithLogger(context.Background(), logger)
	var group sync.WaitGroup
	for i := 0; i < 20; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			From(ctx).With("component", "agent").Debug("Connection opened", "event", "connection_opened")
		}()
	}
	group.Wait()
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 20 {
		t.Fatal("records lost")
	}
	for _, line := range lines {
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatal("interleaved record", err)
		}
	}
}
func TestFormatAndLevelValidation(t *testing.T) {
	var out bytes.Buffer
	logger, _ := New(&out, "text", "info")
	logger.Info("Relay ready", "event", "relay_ready")
	if !strings.Contains(out.String(), "level=INFO") || !strings.Contains(out.String(), "event=relay_ready") {
		t.Fatal("invalid text record")
	}
	for _, pair := range [][2]string{{"bad", "info"}, {"json", "bad"}} {
		if _, err := New(&out, pair[0], pair[1]); err == nil {
			t.Fatal("invalid configuration accepted")
		}
	}
	out.Reset()
	logger, _ = New(&out, "auto", "info")
	logger.Info("piped")
	if !json.Valid(bytes.TrimSpace(out.Bytes())) {
		t.Fatal("redirected auto output must be JSON")
	}
}

func TestSettingsDefaultsAndNormalisation(t *testing.T) {
	var out bytes.Buffer
	logger, err := FromSettings(&out, "", "")
	if err != nil {
		t.Fatal(err)
	}
	logger.Debug("hidden")
	logger.Info("visible")
	if !json.Valid(bytes.TrimSpace(out.Bytes())) || strings.Contains(out.String(), "hidden") {
		t.Fatal("wrong defaults")
	}
	out.Reset()
	logger, err = FromSettings(&out, " TEXT ", " DEBUG ")
	if err != nil {
		t.Fatal(err)
	}
	logger.Debug("enabled")
	if !strings.Contains(out.String(), "level=DEBUG") || !strings.Contains(out.String(), "msg=enabled") {
		t.Fatalf("saved settings ignored: %s", out.String())
	}
	if _, err := FromSettings(&out, "json", "trace"); err == nil {
		t.Fatal("invalid saved level accepted")
	}
	if _, err := FromSettings(&out, "csv", "info"); err == nil {
		t.Fatal("invalid saved format accepted")
	}
}
