// Package terminalclient connects a local terminal to an agent's existing PTY protocol.
package terminalclient

import (
	"context"
	"errors"
	"io"
	"net"
	"time"

	"github.com/amar-jay/webssh/packages/protocol"
	"github.com/muesli/cancelreader"
)

type Size struct{ Cols, Rows int }
type Options struct {
	SessionID, Grant, Backend, Term string
	Size                            Size
	Resize                          <-chan Size
}
type Result struct {
	ExitCode int
	Detached bool
}

// Escape treats Ctrl-] . as detach and Ctrl-] Ctrl-] as a literal Ctrl-].
// It retains only the escape prefix, never uncertain input across connections.
type Escape struct{ pending bool }

func (e *Escape) Feed(input []byte) (out []byte, detach bool) {
	for _, b := range input {
		if e.pending {
			e.pending = false
			if b == '.' {
				return out, true
			}
			out = append(out, 0x1d)
			if b == 0x1d {
				continue
			}
		} else if b == 0x1d {
			e.pending = true
			continue
		}
		out = append(out, b)
	}
	return out, false
}
func fixedError(reason string) error {
	switch reason {
	case "session_busy":
		return errors.New("another controller is attached; detach it before retrying")
	case "unauthorized", "agent_revoked":
		return errors.New("access denied or revoked; request fresh approval")
	case "unsupported_protocol", "capability_mismatch":
		return errors.New("CLI and agent are incompatible; update both and restart serve")
	case "session_ended", "session_not_found":
		return errors.New("remote session ended or is unavailable")
	default:
		return errors.New("agent rejected the attachment")
	}
}

func Run(ctx context.Context, conn net.Conn, input cancelreader.CancelReader, output io.Writer, opts Options) (Result, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	stop := context.AfterFunc(ctx, func() { conn.Close(); input.Cancel() })
	defer stop()
	defer conn.Close()
	defer input.Cancel()
	send := func(m protocol.Message) error {
		if err := conn.SetWriteDeadline(time.Now().Add(10 * time.Second)); err != nil {
			return err
		}
		return protocol.Write(conn, m)
	}
	caps := []string{"terminate"}
	if opts.Backend == "tmux" {
		caps = append(caps, "persistence", "reconnect")
	}
	if !protocol.ValidSize(opts.Size.Cols, opts.Size.Rows) {
		return Result{}, errors.New("invalid terminal size")
	}
	if err := send(protocol.Message{Type: "create", Version: protocol.Version, SessionID: opts.SessionID, Token: opts.Grant, Backend: "", Cols: opts.Size.Cols, Rows: opts.Size.Rows, Term: opts.Term, Capabilities: caps}); err != nil {
		return Result{}, errors.New("could not send terminal handshake")
	}
	conn.SetReadDeadline(time.Now().Add(15 * time.Second))
	ready, err := protocol.Read(conn)
	if err != nil {
		return Result{}, errors.New("terminal handshake failed; request fresh approval")
	}
	if ready.Type == "error" {
		return Result{}, fixedError(ready.Error)
	}
	if ready.Type != "ready" || ready.Version != protocol.Version || ready.SessionID != opts.SessionID || (opts.Backend == "tmux" && !has(ready.Capabilities, "persistence")) {
		return Result{}, errors.New("CLI and agent are incompatible; update both")
	}
	type incoming struct {
		m   protocol.Message
		err error
	}
	messages := make(chan incoming)
	readsDone := make(chan struct{})
	go func() {
		defer close(readsDone)
		for {
			conn.SetReadDeadline(time.Now().Add(20 * time.Second))
			m, e := protocol.Read(conn)
			select {
			case messages <- incoming{m, e}:
			case <-ctx.Done():
				return
			}
			if e != nil {
				return
			}
		}
	}()
	type chunk struct {
		data []byte
		err  error
	}
	inputs := make(chan chunk)
	inputDone := make(chan struct{})
	go func() {
		defer close(inputDone)
		buf := make([]byte, 16<<10)
		for {
			n, e := input.Read(buf)
			var b []byte
			if n > 0 {
				b = append([]byte(nil), buf[:n]...)
			}
			select {
			case inputs <- chunk{b, e}:
			case <-ctx.Done():
				return
			}
			if e != nil {
				return
			}
		}
	}()
	defer func() { cancel(); conn.Close(); input.Cancel(); <-readsDone; <-inputDone }()
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	escape := Escape{}
	for {
		select {
		case <-ctx.Done():
			return Result{}, errors.New("connection interrupted; remote work may still be running")
		case in := <-messages:
			if in.err != nil {
				return Result{}, errors.New("connection lost; remote work may still be running; input was not replayed")
			}
			switch in.m.Type {
			case "output":
				if err := writeAll(output, in.m.Data); err != nil {
					return Result{}, errors.New("could not write terminal output")
				}
			case "pong":
			case "exit":
				return Result{ExitCode: in.m.Code}, nil
			case "detached":
				return Result{Detached: true}, nil
			case "terminated":
				return Result{}, nil
			case "error":
				return Result{}, fixedError(in.m.Error)
			default:
				return Result{}, errors.New("unexpected agent message")
			}
		case in := <-inputs:
			data, detach := escape.Feed(in.data)
			if len(data) > 0 {
				if err := send(protocol.Message{Type: "input", Data: data}); err != nil {
					return Result{}, errors.New("input delivery uncertain; input will not be replayed")
				}
			}
			if detach || in.err != nil {
				_ = send(protocol.Message{Type: "detach"})
				return Result{Detached: true}, nil
			}
		case size, open := <-opts.Resize:
			if !open {
				opts.Resize = nil
				continue
			}
			if protocol.ValidSize(size.Cols, size.Rows) {
				if err := send(protocol.Message{Type: "resize", Cols: size.Cols, Rows: size.Rows}); err != nil {
					return Result{}, errors.New("connection lost during resize")
				}
			}
		case <-ticker.C:
			if err := send(protocol.Message{Type: "ping"}); err != nil {
				return Result{}, errors.New("connection lost")
			}
		}
	}
}
func has(list []string, item string) bool {
	for _, s := range list {
		if s == item {
			return true
		}
	}
	return false
}
func writeAll(w io.Writer, b []byte) error {
	for len(b) > 0 {
		n, e := w.Write(b)
		if e != nil {
			return e
		}
		if n == 0 {
			return io.ErrShortWrite
		}
		b = b[n:]
	}
	return nil
}
