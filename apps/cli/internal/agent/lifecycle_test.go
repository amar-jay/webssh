//go:build linux || darwin

package agent

import (
	"context"
	"errors"
	"io"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/amar-jay/webssh/packages/protocol"
)

func TestTerminationDuringAttachNeverExposesReady(t *testing.T) {
	manager, base := tmuxManager(t)
	a := durableAgent(t, manager, base)
	a.opts.Grants = NewGrantVerifier("agent", "key")
	a.opts.AllowRunSessions = true
	a.opts.AllowDevToken = false
	entered := make(chan struct{}, 1)
	resume := make(chan struct{})
	a.opts.CheckAccess = func(ctx context.Context, id, nonce string) error {
		if strings.HasPrefix(nonce, "check:") {
			select {
			case entered <- struct{}{}:
			default:
			}
			select {
			case <-resume:
				return errors.New("session_ended")
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		return nil
	}
	conn, _ := connect(t, a)
	send(t, conn, protocol.Message{Type: "create", Version: protocol.Version, SessionID: "during-attach", Token: EncodeGrant("agent", "key", "during-attach", "nonce", time.Now().Unix()+60), Cols: 80, Rows: 24})
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("attach did not reach revalidation")
	}
	close(resume)
	if message := receive(t, conn); message.Type != "error" || message.Error != "session_ended" {
		t.Fatalf("exposed terminal after termination: %s", message.Type)
	}
	waitIdle(t, a, "during-attach")
	if dead, _, _, err := manager.State("during-attach"); err != nil || !dead {
		t.Fatal("termination during attach left a live owned session")
	}
}

func TestRevocationInterruptsBlockedOutputButPreservesTmux(t *testing.T) {
	manager, base := tmuxManager(t)
	a := durableAgent(t, manager, base)
	a.opts.Grants = NewGrantVerifier("agent", "key")
	a.opts.AllowRunSessions = true
	a.opts.AllowDevToken = false
	var revoked atomic.Bool
	a.opts.CheckAccess = func(context.Context, string, string) error {
		if revoked.Load() {
			return errors.New("unauthorized")
		}
		return nil
	}
	server, client := net.Pipe()
	defer client.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { defer close(done); defer server.Close(); a.handle(ctx, server) }()
	_ = client.SetDeadline(time.Now().Add(6 * time.Second))
	send(t, client, protocol.Message{Type: "create", Version: protocol.Version, SessionID: "slow-consumer", Token: EncodeGrant("agent", "key", "slow-consumer", "nonce", time.Now().Unix()+60), Cols: 80, Rows: 24})
	if message := receive(t, client); message.Type != "ready" {
		t.Fatal("not ready")
	}
	send(t, client, protocol.Message{Type: "input", Data: []byte("yes output\n")})
	// net.Pipe has no output buffer. Stop reading to block the writer completely.
	revoked.Store(true)
	select {
	case <-done:
	case <-time.After(4 * time.Second):
		t.Fatal("revocation waited for a slow consumer")
	}
	if dead, _, _, err := manager.State("slow-consumer"); err != nil || dead {
		t.Fatal("revocation killed persistent work")
	}
}

func TestCancellationInterruptsBlockedPTYInput(t *testing.T) {
	a := testAgent(t, "/bin/sh")
	server, client := net.Pipe()
	defer client.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { defer close(done); defer server.Close(); a.handle(ctx, server) }()
	_ = client.SetDeadline(time.Now().Add(4 * time.Second))
	attach(t, client)
	send(t, client, protocol.Message{Type: "input", Data: []byte("sleep 30\n")})
	writeDone := make(chan struct{})
	writeStarted := make(chan struct{})
	go func() {
		defer close(writeDone)
		for i := 0; i < 32; i++ {
			if protocol.Write(client, protocol.Message{Type: "input", Data: []byte(strings.Repeat("x", 64<<10))}) != nil {
				return
			}
			if i == 0 {
				close(writeStarted)
			}
		}
	}()
	select {
	case <-writeStarted:
	case <-time.After(time.Second):
		t.Fatal("input never reached PTY pump")
	}
	time.Sleep(20 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("PTY input blocked cancellation")
	}
	select {
	case <-writeDone:
	case <-time.After(time.Second):
		t.Fatal("client write did not unblock")
	}
}

func TestPendingHandshakesCannotExceedConnectionLimit(t *testing.T) {
	a := testAgent(t, "/bin/sh")
	a.opts.MaxConnections = 2
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- a.Serve(ctx, listener) }()
	var clients []net.Conn
	for i := 0; i < 3; i++ {
		conn, err := net.Dial("tcp", listener.Addr().String())
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close()
		clients = append(clients, conn)
	}
	_ = clients[2].SetReadDeadline(time.Now().Add(time.Second))
	var b [1]byte
	if _, err := clients[2].Read(b[:]); err == nil || !errors.Is(err, io.EOF) {
		t.Fatalf("excess pending connection was not closed: %v", err)
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("pending handshakes blocked shutdown")
	}
}

func TestConcurrentControllersNeverTakeOver(t *testing.T) {
	manager, base := tmuxManager(t)
	a := durableAgent(t, manager, base)
	var connections []net.Conn
	for i := 0; i < 2; i++ {
		conn, _ := connect(t, a)
		connections = append(connections, conn)
		defer conn.Close()
	}
	var wg sync.WaitGroup
	results := make(chan protocol.Message, 2)
	start := make(chan struct{})
	for _, conn := range connections {
		wg.Add(1)
		go func(conn net.Conn) {
			defer wg.Done()
			<-start
			_ = protocol.Write(conn, protocol.Message{Type: "create", Version: protocol.Version, SessionID: "competing", Token: testToken, Cols: 80, Rows: 24})
			m, _ := protocol.Read(conn)
			results <- m
		}(conn)
	}
	close(start)
	wg.Wait()
	close(results)
	ready, busy := 0, 0
	for result := range results {
		if result.Type == "ready" {
			ready++
		}
		if result.Type == "error" && result.Error == "session_busy" {
			busy++
		}
	}
	if ready != 1 || busy != 1 {
		t.Fatalf("controllers: ready=%d busy=%d", ready, busy)
	}
}

func TestTerminatingOneOwnedSessionLeavesOtherControllerAlive(t *testing.T) {
	manager, base := tmuxManager(t)
	a := durableAgent(t, manager, base)
	first, _ := openDurable(t, a, "first-owned")
	second, _ := openDurable(t, a, "second-owned")
	send(t, first, protocol.Message{Type: "terminate"})
	for {
		message := receive(t, first)
		if message.Type == "terminated" {
			break
		}
		if message.Type == "error" {
			t.Fatal(message.Error)
		}
	}
	send(t, second, protocol.Message{Type: "input", Data: []byte("printf '\\123\\124\\111\\114\\114\\137\\101\\114\\111\\126\\105\\n'\n")})
	outputUntil(t, second, "STILL_ALIVE")
	if dead, _, _, err := manager.State("second-owned"); err != nil || dead {
		t.Fatal("cleanup terminated another session")
	}
	first.Close()
	second.Close()
}

func TestUnauthenticatedClientCannotProbeBusyController(t *testing.T) {
	manager, base := tmuxManager(t)
	a := durableAgent(t, manager, base)
	first, _ := openDurable(t, a, "private-occupancy")
	defer first.Close()
	stranger, _ := connect(t, a)
	defer stranger.Close()
	send(t, stranger, protocol.Message{Type: "create", Version: protocol.Version, SessionID: "private-occupancy", Token: strings.Repeat("x", 43), Cols: 80, Rows: 24})
	if message := receive(t, stranger); message.Type != "error" || message.Error != "unauthorized" {
		t.Fatal("unauthenticated client learned controller occupancy")
	}
}
