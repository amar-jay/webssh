//go:build linux || darwin

package agent

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/amar-jay/webssh/apps/cli/internal/terminalclient"
)

type nativeInput struct {
	*io.PipeReader
	once sync.Once
}

func (r *nativeInput) Cancel() bool { r.once.Do(func() { r.PipeReader.Close() }); return true }
func TestNativeClientRunsRealAgentPTY(t *testing.T) {
	a := testAgent(t, "/bin/sh")
	conn, _ := connect(t, a)
	input, w := io.Pipe()
	defer w.Close()
	reader := &nativeInput{PipeReader: input}
	defer reader.Close()
	go func() { io.WriteString(w, "printf 'NATIVE_PTY_OK café\\n'; exit 7\n") }()
	var output bytes.Buffer
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	result, err := terminalclient.Run(ctx, conn, reader, &output, terminalclient.Options{SessionID: a.opts.SessionID, Grant: testToken, Backend: "ephemeral", Term: "xterm-256color", Size: terminalclient.Size{Cols: 80, Rows: 24}})
	if err != nil || result.ExitCode != 7 || !strings.Contains(output.String(), "NATIVE_PTY_OK café") {
		t.Fatalf("native PTY did not complete: %+v %v", result, err)
	}
}
func TestNativeDetachPreservesTmuxCommand(t *testing.T) {
	manager, base := tmuxManager(t)
	a := durableAgent(t, manager, base)
	conn, _ := connect(t, a)
	input, w := io.Pipe()
	defer w.Close()
	reader := &nativeInput{PipeReader: input}
	defer reader.Close()
	go func() {
		io.WriteString(w, "printf started > native-started; sleep 0.2; printf NATIVE_SURVIVED > native-survived\n")
		deadline := time.Now().Add(2 * time.Second)
		for time.Now().Before(deadline) {
			if _, err := os.Stat(filepath.Join(base, "native-started")); err == nil {
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
		w.Write([]byte{0x1d, '.'})
	}()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	result, err := terminalclient.Run(ctx, conn, reader, io.Discard, terminalclient.Options{SessionID: a.opts.SessionID, Grant: testToken, Backend: "tmux", Term: "xterm-256color", Size: terminalclient.Size{Cols: 80, Rows: 24}})
	if err != nil || !result.Detached {
		t.Fatalf("detach: %+v %v", result, err)
	}
	waitIdle(t, a, a.opts.SessionID)
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if value, err := os.ReadFile(filepath.Join(base, "native-survived")); err == nil && string(value) == "NATIVE_SURVIVED" {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("native detach ended tmux work")
}
