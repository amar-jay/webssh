package terminalclient

import (
	"bytes"
	"context"
	"io"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/amar-jay/webssh/packages/protocol"
)

// A cancellable input pipe also lets tests prove Run joins its input pump.
type testInput struct {
	*io.PipeReader
	once sync.Once
}

func (r *testInput) Cancel() bool            { r.once.Do(func() { r.PipeReader.Close() }); return true }
func newInput() (*testInput, *io.PipeWriter) { r, w := io.Pipe(); return &testInput{PipeReader: r}, w }
func TestEscapeSplitAcrossReads(t *testing.T) {
	e := Escape{}
	b, stop := e.Feed([]byte{'a', 0x1d})
	if string(b) != "a" || stop {
		t.Fatal("prefix lost")
	}
	b, stop = e.Feed([]byte{'.', 'x'})
	if !stop || len(b) != 0 {
		t.Fatal("detach leaked input")
	}
	e = Escape{}
	b, stop = e.Feed([]byte{0x1d, 0x1d, 'a', 0x1d, 'b'})
	if stop || !bytes.Equal(b, []byte{0x1d, 'a', 0x1d, 'b'}) {
		t.Fatal("literal escape not preserved")
	}
}
func fixture(t *testing.T) (net.Conn, net.Conn, *testInput, *io.PipeWriter, Options) {
	t.Helper()
	a, b := net.Pipe()
	input, w := newInput()
	t.Cleanup(func() { a.Close(); b.Close(); w.Close(); input.Close() })
	return a, b, input, w, Options{SessionID: "session_123456789012", Grant: "v1.test", Backend: "tmux", Term: "xterm-256color", Size: Size{80, 24}}
}
func ready(t *testing.T, c net.Conn, opts Options) {
	t.Helper()
	m, e := protocol.Read(c)
	if e != nil || m.Type != "create" || m.SessionID != opts.SessionID || m.Token != opts.Grant || m.Cols != 80 {
		t.Errorf("bad handshake: %v", e)
		return
	}
	if e = protocol.Write(c, protocol.Message{Type: "ready", Version: protocol.Version, SessionID: opts.SessionID, Backend: "tmux", Capabilities: []string{"persistence"}}); e != nil {
		t.Error(e)
	}
}
func TestInputOutputResizeAndRemoteExit(t *testing.T) {
	a, b, input, w, opts := fixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	sizes := make(chan Size, 1)
	opts.Resize = sizes
	agentDone := make(chan struct{})
	go func() {
		defer close(agentDone)
		ready(t, b, opts)
		m, e := protocol.Read(b)
		if e != nil || m.Type != "input" || string(m.Data) != "café\x03" {
			t.Errorf("input: %v %q", e, m.Data)
			return
		}
		sizes <- Size{120, 40}
		m, e = protocol.Read(b)
		if e != nil || m.Type != "resize" || m.Cols != 120 || m.Rows != 40 {
			t.Errorf("resize: %v", e)
			return
		}
		protocol.Write(b, protocol.Message{Type: "output", Data: []byte("日本語\r\n")})
		protocol.Write(b, protocol.Message{Type: "exit", Code: 7, CodeKnown: true})
	}()
	go func() { io.WriteString(w, "café\x03") }()
	var output bytes.Buffer
	result, err := Run(ctx, a, input, &output, opts)
	if err != nil || result.ExitCode != 7 || output.String() != "日本語\r\n" {
		t.Fatalf("result: %+v %v output %q", result, err, output.String())
	}
	<-agentDone
}
func TestDetachDoesNotTerminateAndCancellationUnblocksInput(t *testing.T) {
	a, b, input, w, opts := fixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		ready(t, b, opts)
		m, e := protocol.Read(b)
		if e != nil || m.Type != "detach" {
			t.Errorf("expected detach, got %s %v", m.Type, e)
		}
	}()
	go func() { w.Write([]byte{0x1d}); w.Write([]byte{'.'}) }()
	result, err := Run(ctx, a, input, io.Discard, opts)
	if err != nil || !result.Detached {
		t.Fatalf("detach: %+v %v", result, err)
	}
	<-done
	a, b, input, _, opts = fixture(t)
	ctx, cancel = context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	go ready(t, b, opts)
	started := time.Now()
	_, err = Run(ctx, a, input, io.Discard, opts)
	if err == nil || time.Since(started) > time.Second {
		t.Fatal("cancel did not release pumps")
	}
}
func TestBusyRefusesInputAndDoesNotExposeErrors(t *testing.T) {
	a, b, input, _, opts := fixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	go func() {
		protocol.Read(b)
		protocol.Write(b, protocol.Message{Type: "error", Error: "session_busy", Retryable: true})
	}()
	_, err := Run(ctx, a, input, io.Discard, opts)
	if err == nil || err.Error() != "another controller is attached; detach it before retrying" {
		t.Fatalf("busy: %v", err)
	}
}
