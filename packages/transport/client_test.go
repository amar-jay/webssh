package transport

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"

	"tailscale.com/types/key"
)

type testDialer struct {
	dial   func(context.Context) (net.Conn, error)
	closed bool
}

func (d *testDialer) DialTCPPort(ctx context.Context, _ uint16) (net.Conn, error) { return d.dial(ctx) }
func (d *testDialer) PublicKey() key.NodePublic                                   { return key.NodePublic{} }
func (d *testDialer) Close() error                                                { d.closed = true; return nil }

func TestClientCloseCancelsPendingDial(t *testing.T) {
	started := make(chan struct{})
	backend := &testDialer{dial: func(ctx context.Context) (net.Conn, error) { close(started); <-ctx.Done(); return nil, ctx.Err() }}
	client := newClient(backend)
	done := make(chan error, 1)
	go func() { _, err := client.Dial(context.Background(), 8022); done <- err }()
	<-started
	if err := client.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("dial error: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("pending dial did not cancel")
	}
	if !backend.closed {
		t.Fatal("backend not closed")
	}
	if _, err := client.Dial(context.Background(), 8022); !errors.Is(err, ErrClosed) {
		t.Fatalf("dial after close: %v", err)
	}
}

func TestClientClosesStreamsAndReadUnblocks(t *testing.T) {
	a, b := net.Pipe()
	defer b.Close()
	client := newClient(&testDialer{dial: func(context.Context) (net.Conn, error) { return a, nil }})
	stream, err := client.Dial(context.Background(), 8022)
	if err != nil {
		t.Fatal(err)
	}
	read := make(chan error, 1)
	go func() { _, err := stream.Read(); read <- err }()
	client.Close()
	select {
	case err := <-read:
		if err == nil {
			t.Fatal("read unexpectedly succeeded")
		}
	case <-time.After(time.Second):
		t.Fatal("read did not unblock")
	}
	if len(client.streams) != 0 {
		t.Fatal("stream remains registered")
	}
	if err := client.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestCancelledLateDialClosesReturnedSocket(t *testing.T) {
	a, b := net.Pipe()
	defer b.Close()
	ctx, cancel := context.WithCancel(context.Background())
	client := newClient(&testDialer{dial: func(context.Context) (net.Conn, error) { cancel(); return a, nil }})
	defer client.Close()
	if _, err := client.Dial(ctx, 8022); !errors.Is(err, context.Canceled) {
		t.Fatalf("late dial error: %v", err)
	}
	if _, err := b.Write([]byte("x")); err == nil {
		t.Fatal("late socket leaked")
	}
}

func TestStreamBytesAndLimits(t *testing.T) {
	a, b := net.Pipe()
	defer b.Close()
	client := newClient(&testDialer{dial: func(context.Context) (net.Conn, error) { return a, nil }})
	defer client.Close()
	for _, port := range []int{0, -1, 65536} {
		if _, err := client.Dial(context.Background(), port); err == nil {
			t.Fatalf("accepted port %d", port)
		}
	}
	stream, err := client.Dial(context.Background(), 8022)
	if err != nil {
		t.Fatal(err)
	}
	go func() { b.Write([]byte{0, 255, 27}); b.Close() }()
	data, err := stream.Read()
	if err != nil || string(data) != string([]byte{0, 255, 27}) {
		t.Fatalf("read: %v %v", data, err)
	}
	data, err = stream.Read()
	if err != nil || data != nil {
		t.Fatalf("EOF: %v %v", data, err)
	}
	if err := stream.Write(make([]byte, MaxChunkSize+1)); err == nil {
		t.Fatal("unbounded write accepted")
	}
}
