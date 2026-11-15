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
func (w *writer) fail(code string) {
	_ = w.send(protocol.Message{Type: "error", Error: code, Retryable: code == "session_busy"})
}

func (a *Agent) authorize(token string) bool { return a.authorizeContext(context.Background(), token) }

func (a *Agent) authorizeContext(ctx context.Context, token string) bool {
	// Grant-shaped tokens never fall back to the development per-run secret.
	if a.opts.Grants != nil && strings.HasPrefix(token, "v1.") {
		sessionID, err := a.opts.Grants.Verify(token, time.Now())
		if err != nil || (!a.opts.AllowRunSessions && sessionID != a.opts.SessionID) {
			return false
		}
		check, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		return a.opts.CheckAccess != nil && a.opts.CheckAccess(check, sessionID, strings.Split(token, ".")[3]) == nil
	}
	if a.opts.AllowDevToken && a.opts.Token != "" {
		return subtle.ConstantTimeCompare([]byte(token), []byte(a.opts.Token)) == 1
	}
	return false
}

func (a *Agent) handle(parent context.Context, conn net.Conn) {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()

	out := &writer{conn: conn}
	_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	hello, err := protocol.Read(conn)
	if err != nil {
		out.fail("invalid_handshake")
		return
	}
	if (hello.Type != "attach" && hello.Type != "create") || hello.Version != protocol.Version {
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
	sessionID := hello.SessionID
	if a.opts.Grants != nil && strings.HasPrefix(hello.Token, "v1.") {
		parts := strings.Split(hello.Token, ".")
		if len(parts) != 5 {
			out.fail("unauthorized")
			return
		}
		if sessionID != "" && sessionID != parts[1] {
			out.fail("unauthorized")
			return
		}
		sessionID = parts[1]
	}
	if sessionID == "" {
		sessionID = a.opts.SessionID
	}
	if !sessionHandle.MatchString(sessionID) {
		out.fail("invalid_attach")
		return
	}
	caps := []string{"terminate"}
	if a.opts.Backend == "tmux" {
		caps = []string{"persistence", "reconnect", "terminate"}
	}
	for _, required := range hello.Capabilities {
		found := false
		for _, cap := range caps {
			if required == cap {
				found = true
			}
		}
		if !found {
			out.fail("capability_mismatch")
			return
		}
	}
	if a.opts.Grants != nil && strings.HasPrefix(hello.Token, "v1.") {
		if !a.opts.Grants.Authentic(hello.Token, time.Now()) {
			out.fail("unauthorized")
			return
		}
	} else if !a.opts.AllowDevToken || a.opts.Token == "" || subtle.ConstantTimeCompare([]byte(hello.Token), []byte(a.opts.Token)) != 1 {
		out.fail("unauthorized")
		return
	}
	a.controllerMu.Lock()
	if a.controlled[sessionID] {
		a.controllerMu.Unlock()
		out.fail("session_busy")
		return
	}
	a.controlled[sessionID] = true
	a.controllerMu.Unlock()
	defer func() { a.controllerMu.Lock(); delete(a.controlled, sessionID); a.controllerMu.Unlock() }()
	if a.opts.Backend == "tmux" {
		release, err := a.opts.Manager.Acquire(sessionID)
		if err != nil {
			out.fail("session_busy")
			return
		}
		defer release()
	}
	ended := false
	if !a.authorizeContext(ctx, hello.Token) {
		out.fail("unauthorized")
		return
	}
	// Each admitted grant nonce identifies this connection's lease. A busy
	// attempt never consumes a grant or changes the active lease.
	if a.opts.Grants != nil && strings.HasPrefix(hello.Token, "v1.") {
		parts := strings.Split(hello.Token, ".")
		nonce := parts[3]
		accessCtx, accessCancel := context.WithCancel(ctx)
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
						a.event(AccessDenied)
						cancel()
						conn.Close()
						if err.Error() == "session_ended" && a.opts.Manager != nil {
							_ = a.opts.Manager.Terminate(sessionID)
						}
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
			operation := "release:"
			if a.opts.Backend == "tmux" {
				operation = "detach:"
				if ended {
					operation = "ended:"
				}
			}
			_ = a.opts.CheckAccess(release, sessionID, operation+nonce)
		}()
	}
	var child *process
	if a.opts.Backend == "tmux" {
		child, err = a.opts.Manager.AttachContext(ctx, sessionID, hello.Type == "create", a.opts, hello.Term, hello.Cols, hello.Rows)
	} else {
		child, err = startProcess(a.opts, hello.Term, hello.Cols, hello.Rows)
	}
	if err != nil {
		code := err.Error()
		switch code {
		case "session_ended", "session_not_found", "backend_unavailable":
			out.fail(code)
		default:
			out.fail("shell_start_failed")
		}
		return
	}
	var waitErr error
	waitDone := make(chan struct{})
	go func() { waitErr = child.cmd.Wait(); close(waitDone) }()
	// Always close the PTY, kill live process groups, and reap the shell.
	defer func() { child.stop(); <-waitDone }()
	if a.opts.Grants != nil && strings.HasPrefix(hello.Token, "v1.") {
		check, done := context.WithTimeout(ctx, 3*time.Second)
		err := a.opts.CheckAccess(check, sessionID, "check:"+strings.Split(hello.Token, ".")[3])
		done()
		if err != nil {
			if err.Error() == "session_ended" && a.opts.Manager != nil {
				_ = a.opts.Manager.Terminate(sessionID)
				out.fail("session_ended")
			} else {
				out.fail("unauthorized")
			}
			return
		}
	}
	select {
	case <-ctx.Done():
		return
	default:
	}
	if err := out.send(protocol.Message{Type: "ready", Version: protocol.Version, SessionID: sessionID, Backend: a.opts.Backend, Capabilities: caps}); err != nil {
		return
	}

	a.event(SessionAttached)
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
			_ = conn.SetReadDeadline(time.Now().Add(a.opts.ClientIdleTimeout))
			m, err := protocol.Read(conn)
			if err != nil {
				inputDone <- err
				return
			}
			// Only terminal input, resize and detach are legal after attachment.
			if m.Version != 0 || m.Token != "" || m.Term != "" || m.Error != "" || m.Code != 0 || m.SessionID != "" || len(m.Capabilities) > 0 || m.Backend != "" {
				inputDone <- errors.New("invalid_message")
				return
			}
			switch m.Type {
			case "ping":
				if err := out.send(protocol.Message{Type: "pong"}); err != nil {
					inputDone <- err
					return
				}
			case "input":
				if m.Cols != 0 || m.Rows != 0 {
					inputDone <- errors.New("invalid_message")
					return
				}
				if err := child.file.SetWriteDeadline(time.Now().Add(2 * time.Second)); err != nil {
					inputDone <- err
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
			case "detach", "terminate":
				if m.Cols != 0 || m.Rows != 0 || len(m.Data) != 0 {
					inputDone <- errors.New("invalid_message")
					return
				}
				if m.Type == "terminate" {
					inputDone <- errors.New("terminate")
				} else {
					inputDone <- errors.New("detach")
				}
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
	type processEnd struct {
		code  int
		known bool
		err   error
	}
	paneEnd := make(chan processEnd, 1)
	watchCtx, watchCancel := context.WithCancel(ctx)
	watchDone := make(chan struct{})
	defer func() { watchCancel(); <-watchDone }()
	if a.opts.Backend == "tmux" {
		go func() {
			defer close(watchDone)
			ticker := time.NewTicker(500 * time.Millisecond)
			defer ticker.Stop()
			for {
				select {
				case <-watchCtx.Done():
					return
				case <-ticker.C:
					dead, code, known, err := a.opts.Manager.StateContext(watchCtx, sessionID)
					if dead || err != nil {
						paneEnd <- processEnd{code, known, err}
						return
					}
				}
			}
		}()
	}
	if a.opts.Backend != "tmux" {
		close(watchDone)
	}
	select {
	case <-ctx.Done():
		return
	case <-waitDone:
		if a.opts.Backend == "tmux" {
			dead, code, known, stateErr := a.opts.Manager.StateContext(watchCtx, sessionID)
			if stateErr != nil {
				out.fail("backend_unavailable")
			} else if dead {
				ended = true
				_ = a.opts.Manager.Terminate(sessionID)
				_ = out.send(protocol.Message{Type: "exit", Code: code, CodeKnown: known})
			} else {
				_ = out.send(protocol.Message{Type: "detached"})
			}
			return
		}
		a.event(ProcessEnded)
		ended = true
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
		_ = out.send(protocol.Message{Type: "exit", Code: code, CodeKnown: true})
	case result := <-paneEnd:
		if result.err != nil {
			out.fail("backend_unavailable")
			return
		}
		a.event(ProcessEnded)
		ended = true
		_ = a.opts.Manager.Terminate(sessionID)
		_ = out.send(protocol.Message{Type: "exit", Code: result.code, CodeKnown: result.known})
	case err := <-inputDone:
		inputDone <- err
		if err != nil && err.Error() == "terminate" {
			if a.opts.Backend == "tmux" {
				if killErr := a.opts.Manager.Terminate(sessionID); killErr != nil {
					out.fail("backend_unavailable")
					return
				}
			}
			ended = true
			_ = out.send(protocol.Message{Type: "terminated"})
			return
		}
		if err != nil && err.Error() == "detach" {
			_ = out.send(protocol.Message{Type: "detached"})
			return
		}
		if timeout, ok := err.(net.Error); ok && timeout.Timeout() {
			return
		}
		if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, net.ErrClosed) {
			out.fail("invalid_session_message")
		}
	case err := <-outputDone:
		outputDone <- err
		if a.opts.Backend == "tmux" {
			return
		}
		if err == nil {
			ended = true
			// EOF can precede Wait's return by a scheduling turn.
			select {
			case <-waitDone:
				code := child.cmd.ProcessState.ExitCode()
				if code < 0 {
					code = 128
				}
				_ = out.send(protocol.Message{Type: "exit", Code: code, CodeKnown: true})
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
