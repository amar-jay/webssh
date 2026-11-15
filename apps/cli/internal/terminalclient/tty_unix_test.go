//go:build linux || darwin

package terminalclient

import (
	"context"
	"github.com/amar-jay/webssh/packages/protocol"
	"github.com/creack/pty"
	"golang.org/x/term"
	"io"
	"net"
	"reflect"
	"testing"
	"time"
)

func TestTTYRawModeAndRestoration(t *testing.T) {
	for _, deny := range []bool{false, true} {
		t.Run(map[bool]string{false: "exit", true: "rejected"}[deny], func(t *testing.T) {
			master, slave, err := pty.Open()
			if err != nil {
				t.Fatal(err)
			}
			defer master.Close()
			defer slave.Close()
			if err := pty.Setsize(slave, &pty.Winsize{Cols: 80, Rows: 24}); err != nil {
				t.Fatal(err)
			}
			before, err := term.GetState(int(slave.Fd()))
			if err != nil {
				t.Fatal(err)
			}
			client, server := net.Pipe()
			defer client.Close()
			defer server.Close()
			done := make(chan struct{})
			go func() {
				defer close(done)
				m, e := protocol.Read(server)
				if e != nil {
					t.Error(e)
					return
				}
				raw, e := term.GetState(int(slave.Fd()))
				if e != nil || reflect.DeepEqual(raw, before) {
					t.Error("local terminal was not raw during attach")
				}
				if deny {
					protocol.Write(server, protocol.Message{Type: "error", Error: "session_busy"})
					return
				}
				protocol.Write(server, protocol.Message{Type: "ready", Version: protocol.Version, SessionID: m.SessionID, Capabilities: []string{"persistence"}})
				master.Write([]byte("hello\x03"))
				in, e := protocol.Read(server)
				if e != nil || in.Type != "input" || string(in.Data) != "hello\x03" {
					t.Errorf("raw input changed: %v %q", e, in.Data)
				}
				protocol.Write(server, protocol.Message{Type: "output", Data: []byte("TTY_OK")})
				protocol.Write(server, protocol.Message{Type: "exit", CodeKnown: true, Code: 0})
			}()
			readDone := make(chan struct{})
			go func() {
				defer close(readDone)
				if !deny {
					b := make([]byte, 6)
					io.ReadFull(master, b)
				}
			}()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_, err = RunTTY(ctx, client, slave, slave, Options{SessionID: "session_123456789012", Grant: "v1.test", Backend: "tmux", Term: "xterm-256color"})
			if deny && err == nil {
				t.Error("rejection was not returned")
			}
			if !deny && err != nil {
				t.Error(err)
			}
			after, e := term.GetState(int(slave.Fd()))
			if e != nil || !reflect.DeepEqual(before, after) {
				t.Error("terminal settings were not restored")
			}
			<-done
			<-readDone
		})
	}
}
