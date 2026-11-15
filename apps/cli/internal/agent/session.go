package agent

import (
	"context"
	"crypto/subtle"
	"errors"
	"io"
	"net"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/amar-jay/webssh/packages/protocol"
)

var validTerm = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.+-]{0,63}$`)

// writeFrame serializes control/output frames and bounds a slow peer's writes.
type writer struct {
	conn net.Conn
	mu   sync.Mutex
}

func (w *writer) send(m protocol.Message) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if err := w.conn.SetWriteDeadline(time.Now().Add(10 * time.Second)); err != nil {
		return err
	}
	return protocol.Write(w.conn, m)
}
func (w *writer) fail(code string) { _ = w.send(protocol.Message{Type: "error", Error: code}) }

func (a *Agent) authorize(token string) bool {
	// Grant-shaped tokens never fall back to the development per-run secret.
	if a.opts.Grants != nil && strings.HasPrefix(token, "v1.") {
		sessionID, err := a.opts.Grants.Verify(token, time.Now())
		if err != nil || (!a.opts.AllowRunSessions && sessionID != a.opts.SessionID) {
			return false
		}
		check, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		return a.opts.CheckAccess != nil && a.opts.CheckAccess(check, sessionID, strings.Split(token, ".")[3]) == nil
	}
	if a.opts.AllowDevToken && a.opts.Token != "" {
		return subtle.ConstantTimeCompare([]byte(token), []byte(a.opts.Token)) == 1
	}
	return false
}

func (a *Agent) handle(conn net.Conn) {
	out := &writer{conn: conn}
	_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	hello, err := protocol.Read(conn)
	if err != nil {
		out.fail("invalid_handshake")
		return
	}
	if hello.Type != "attach" || hello.Version != protocol.Version {
		out.fail("unsupported_protocol")
		return
	}

	if !protocol.ValidSize(hello.Cols, hello.Rows) || len(hello.Data) != 0 || hello.Error != "" || hello.Code != 0 {
		out.fail("invalid_attach")
		return
	}
	if hello.Term == "" {
		hello.Term = "xterm-256color"
	}
	if !validTerm.MatchString(hello.Term) {
		out.fail("invalid_terminal")
		return
	}
	_ = conn.SetReadDeadline(time.Time{})
	if a.opts.Grants != nil {
		a.controllerMu.Lock()
		if a.controlled {
			a.controllerMu.Unlock()
			out.fail("session_busy")
			return
		}
		a.controlled = true
		a.controllerMu.Unlock()
		defer func() { a.controllerMu.Lock(); a.controlled = false; a.controllerMu.Unlock() }()
	}
	if !a.authorize(hello.Token) {
		out.fail("unauthorized")
		return
	}
	// Each admitted grant nonce identifies this connection's lease. A busy
	// attempt never consumes a grant or changes the active lease.
	if a.opts.Grants != nil && strings.HasPrefix(hello.Token, "v1.") {
		parts := strings.Split(hello.Token, ".")
		sessionID, nonce := parts[1], parts[3]
		accessCtx, accessCancel := context.WithCancel(context.Background())
		stopped := make(chan struct{})
		go func() {
			defer close(stopped)
			ticker := time.NewTicker(2 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-accessCtx.Done():
					return
				case <-ticker.C:
					check, cancel := context.WithTimeout(accessCtx, 3*time.Second)
					err := a.opts.CheckAccess(check, sessionID, "check:"+nonce)
					cancel()
					if err != nil {
						conn.Close()
						return
					}
				}
			}
		}()
		defer func() {
			accessCancel()
			<-stopped
			release, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_ = a.opts.CheckAccess(release, sessionID, "release:"+nonce)
		}()
	}
	child, err := startProcess(a.opts, hello.Term, hello.Cols, hello.Rows)
	if err != nil {
		out.fail("shell_start_failed")
		return
	}
	var waitErr error
	waitDone := make(chan struct{})
	go func() { waitErr = child.cmd.Wait(); close(waitDone) }()
	// Always close the PTY, kill live process groups, and reap the shell.
	defer func() { child.stop(); <-waitDone }()
	if err := out.send(protocol.Message{Type: "ready", Version: protocol.Version}); err != nil {
		return
	}

	outputDone := make(chan error, 1)
	go func() {
		buf := make([]byte, 16<<10)
		for {
			n, err := child.file.Read(buf)
			if n > 0 {
				if sendErr := out.send(protocol.Message{Type: "output", Data: buf[:n]}); sendErr != nil {
					outputDone <- sendErr
					return
				}
			}
			if err != nil {
				outputDone <- nil
				return
			} // PTY EOF may be EIO on Unix.
		}
	}()
	inputDone := make(chan error, 1)
	go func() {
		for {
			m, err := protocol.Read(conn)
			if err != nil {
				inputDone <- err
				return
			}
			// Only terminal input, resize and detach are legal after attachment.
			if m.Version != 0 || m.Token != "" || m.Term != "" || m.Error != "" || m.Code != 0 {
				inputDone <- errors.New("invalid_message")
				return
			}
			switch m.Type {
			case "input":
				if m.Cols != 0 || m.Rows != 0 {
					inputDone <- errors.New("invalid_message")
					return
				}
				if err := writeAll(child.file, m.Data); err != nil {
					inputDone <- err
					return
				}
			case "resize":
				if !protocol.ValidSize(m.Cols, m.Rows) || len(m.Data) != 0 {
					inputDone <- errors.New("invalid_resize")
					return
				}
				if err := child.resize(m.Cols, m.Rows); err != nil {
					inputDone <- err
					return
				}
			case "detach":
				if m.Cols != 0 || m.Rows != 0 || len(m.Data) != 0 {
					inputDone <- errors.New("invalid_message")
					return
				}
				inputDone <- io.EOF
				return
			default:
				inputDone <- errors.New("invalid_message")
				return
			}
		}
	}()
	// Closing both sockets/files unblocks pumps on every return path, then joins
	// them so Serve never leaves connection goroutines behind.
	defer func() {
		conn.Close()
		child.stop()
		<-inputDone
		<-outputDone
	}()
	select {
	case <-waitDone:
		// Drain normal PTY output before the exit frame. Background processes may
		// retain the slave; bound the drain rather than waiting forever for EOF.
		select {
		case err := <-outputDone:
			outputDone <- err
			if err != nil {
				return
			}
		case <-time.After(time.Second):
			child.stop()
		}
		code := 0
		if waitErr != nil {
			code = child.cmd.ProcessState.ExitCode()
			if code < 0 {
				code = 128
			}
		}
		_ = out.send(protocol.Message{Type: "exit", Code: code})
	case err := <-inputDone:
		inputDone <- err
		if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, net.ErrClosed) {
			out.fail("invalid_session_message")
		}
	case err := <-outputDone:
		outputDone <- err
		if err == nil {
			// EOF can precede Wait's return by a scheduling turn.
			select {
			case <-waitDone:
				code := child.cmd.ProcessState.ExitCode()
				if code < 0 {
					code = 128
				}
				_ = out.send(protocol.Message{Type: "exit", Code: code})
			case <-time.After(time.Second):
				out.fail("shell_io_closed")
			}
		}
	}
}

func writeAll(w io.Writer, b []byte) error {
	for len(b) > 0 {
		n, err := w.Write(b)
		if err != nil {
			return err
		}
		if n == 0 {
			return io.ErrShortWrite
		}
		b = b[n:]
	}
	return nil
}
