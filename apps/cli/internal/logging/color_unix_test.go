//go:build linux || darwin

package logging

import (
	"bytes"
	"encoding/json"
	"github.com/creack/pty"
	"strings"
	"testing"
)

type ttyBuffer struct {
	*bytes.Buffer
	fd uintptr
}

func (w ttyBuffer) Fd() uintptr { return w.fd }
func TestTerminalColorsAndNoColor(t *testing.T) {
	master, slave, err := pty.Open()
	if err != nil {
		t.Fatal(err)
	}
	defer master.Close()
	defer slave.Close()
	t.Setenv("TERM", "xterm-256color")
	t.Setenv("NO_COLOR", "")
	var out bytes.Buffer
	writer := ttyBuffer{&out, slave.Fd()}
	logger, err := New(writer, "auto", "info")
	if err != nil {
		t.Fatal(err)
	}
	logger.Info("Relay ready", "event", "relay_ready")
	if !strings.Contains(out.String(), "\x1b[38;2;130;170;255mlevel=INFO\x1b[0m") {
		t.Fatal("terminal info level lacks color")
	}
	out.Reset()
	t.Setenv("NO_COLOR", "1")
	logger, _ = New(writer, "text", "info")
	logger.Error("failed")
	if strings.Contains(out.String(), "\x1b[") {
		t.Fatal("NO_COLOR ignored")
	}
	out.Reset()
	t.Setenv("NO_COLOR", "")
	t.Setenv("TERM", "dumb")
	logger, _ = New(writer, "text", "info")
	logger.Info("ready")
	if strings.Contains(out.String(), "\x1b[") {
		t.Fatal("dumb terminal colored")
	}
	out.Reset()
	t.Setenv("TERM", "xterm-256color")
	logger, _ = New(writer, "json", "info")
	logger.Info("ready")
	if !json.Valid(bytes.TrimSpace(out.Bytes())) || strings.Contains(out.String(), "\x1b[") {
		t.Fatal("JSON output colored")
	}
	out.Reset()
	logger, _ = New(&out, "text", "info")
	logger.Info("piped")
	if strings.Contains(out.String(), "\x1b[") {
		t.Fatal("redirected text colored")
	}
}
