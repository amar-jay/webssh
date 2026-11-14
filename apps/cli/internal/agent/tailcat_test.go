//go:build linux || darwin

package agent

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/amar-jay/webssh/packages/protocol"
	"github.com/tailscale/tailcat"
	"tailscale.com/envknob"
	"tailscale.com/net/netcheck"
	"tailscale.com/syncs"
	"tailscale.com/tailcfg"
	"tailscale.com/tstest/integration"
	"tailscale.com/types/logger"
)

// Keep the integration test on local relays; disable unrelated network probes.
func TestMain(m *testing.M) {
	envknob.Setenv("IN_TS_TEST", "true")
	netcheck.HookStartCaptivePortalDetection.SetForTest(func(context.Context, *netcheck.Client, *tailcfg.DERPMap, tailcfg.DERPRegionID, func(bool)) (<-chan struct{}, func()) {
		return syncs.ClosedChan(), func() {}
	})
	os.Exit(m.Run())
}

func TestTailcatAgentEndToEnd(t *testing.T) {
	dm := integration.RunDERPAndSTUN(t, logger.Discard, "127.0.0.1")
	a, err := New(Options{Workspace: t.TempDir(), Shell: "/bin/sh", AllowDevToken: true, Token: testToken, Region: dm.Regions[1]})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	ready := make(chan Info, 1)
	done := make(chan error, 1)
	go func() { done <- a.Run(ctx, func(info Info) error { ready <- info; return nil }) }()
	t.Cleanup(func() {
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Error(err)
			}
		case <-time.After(3 * time.Second):
			t.Error("Tailcat agent shutdown timed out")
		}
	})
	var info Info
	select {
	case info = <-ready:
	case err := <-done:
		done <- err
		t.Fatalf("startup: %v", err)
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if info.Version != 1 || info.Port != protocol.DefaultPort || info.Token != testToken {
		t.Fatal("invalid connection record")
	}
	client := &tailcat.Client{Server: tailcat.Addr(info.Address), Logf: logger.Discard}
	defer client.Close()
	conn, err := client.DialTCPPort(ctx, uint16(info.Port))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	attach(t, conn)
	send(t, conn, protocol.Message{Type: "input", Data: []byte("exit 3\n")})
	for {
		message := receive(t, conn)
		if message.Type == "output" {
			continue
		}
		if message.Type != "exit" || message.Code != 3 {
			t.Fatalf("unexpected terminal response: %+v", message)
		}
		break
	}
}
