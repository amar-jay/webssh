//go:build linux || darwin

package command

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/amar-jay/webssh/apps/cli/internal/config"
	"github.com/amar-jay/webssh/apps/cli/internal/credentials"
	"github.com/amar-jay/webssh/apps/cli/internal/pairing"
	"tailscale.com/envknob"
	"tailscale.com/net/netcheck"
	"tailscale.com/syncs"
	"tailscale.com/tailcfg"
	"tailscale.com/tstest/integration"
	"tailscale.com/types/logger"
)

func TestServePrintsOpaqueURLAfterAnnouncementAndEndsRun(t *testing.T) {
	envknob.Setenv("IN_TS_TEST", "true")
	netcheck.HookStartCaptivePortalDetection.SetForTest(func(context.Context, *netcheck.Client, *tailcfg.DERPMap, tailcfg.DERPRegionID, func(bool)) (<-chan struct{}, func()) {
		return syncs.ClosedChan(), func() {}
	})
	dm := integration.RunDERPAndSTUN(t, logger.Discard, "127.0.0.1")
	var mu sync.Mutex
	var operations []string
	var runID string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/derpmap" {
			_ = json.NewEncoder(w).Encode(dm)
			return
		}
		if r.URL.Path != "/api/agent/run" {
			http.NotFound(w, r)
			return
		}
		var body struct {
			pairing.RunUpdate
			AgentToken string `json:"agentToken"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || body.AgentToken != "private-agent-token" {
			w.WriteHeader(401)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		operations = append(operations, body.Operation)
		if body.Operation == "start" {
			if body.MachineName != "configured-machine" || body.WorkspaceLabel == "" {
				t.Error("configuration not announced")
			}
			runID = body.RunID
		}
		if body.Operation == "announce" && (!strings.HasPrefix(body.Address, "tc") || body.Port == 0) {
			t.Error("missing listener descriptor")
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"sessionId": body.RunID})
	}))
	defer server.Close()
	dir := t.TempDir()
	cfg := filepath.Join(dir, "config.toml")
	cred := filepath.Join(dir, "credentials.toml")
	if err := config.Save(cfg, config.Config{Version: 1, MachineName: "configured-machine", Shell: "/bin/sh"}); err != nil {
		t.Fatal(err)
	}
	if err := credentials.Save(cred, credentials.File{Version: 1, Origin: server.URL, OwnerID: "owner", AgentID: "agent", AgentToken: "private-agent-token", GrantKey: "private-grant-key", MachineName: "paired-name"}); err != nil {
		t.Fatal(err)
	}
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	oldStdout := os.Stdout
	os.Stdout = writer
	defer func() { os.Stdout = oldStdout; reader.Close(); writer.Close() }()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		done <- New().Run(ctx, []string{"webssh", "serve", "--config", cfg, "--credentials", cred, "--derpmap-url", server.URL + "/derpmap", "--json", dir})
	}()
	// Even on test failure, stop and join before restoring process stdout.
	joined := false
	defer func() {
		cancel()
		if !joined {
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Error("serve did not stop")
			}
		}
	}()
	line := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(reader)
		if scanner.Scan() {
			line <- scanner.Text()
		}
	}()
	var output string
	select {
	case output = <-line:
	case err := <-done:
		joined = true
		t.Fatalf("serve startup: %v", err)
	case <-ctx.Done():
		t.Fatal("no browser URL printed")
	}
	var record struct {
		SessionID string `json:"sessionId"`
		URL       string `json:"url"`
	}
	if err := json.Unmarshal([]byte(output), &record); err != nil {
		t.Fatal("invalid JSON output")
	}
	mu.Lock()
	expectedID := runID
	announced := len(operations) >= 2 && operations[0] == "start" && operations[1] == "announce"
	mu.Unlock()
	if !announced || record.SessionID != expectedID || record.URL != server.URL+"/s/"+expectedID {
		t.Fatal("URL was not bound to announced run")
	}
	if strings.Contains(output, "private-") || strings.Contains(output, "address") || strings.Contains(output, "token") || strings.Contains(output, "?") {
		t.Fatal("credentials or descriptors in ordinary output")
	}
	cancel()
	select {
	case err := <-done:
		joined = true
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("shutdown timeout")
	}
	mu.Lock()
	defer mu.Unlock()
	if operations[len(operations)-1] != "end" {
		t.Fatal("shutdown did not end run")
	}
}
