//go:build linux || darwin

package agent

import (
	"context"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/unix"
)

func pruneFixture(t *testing.T) (string, string) {
	t.Helper()
	base, err := os.MkdirTemp("", "ws-prune-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(base) })
	if err := os.Chmod(base, 0700); err != nil {
		t.Fatal(err)
	}
	name := "0123456789abcdef0123"
	dir := filepath.Join(base, name)
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "lock"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	ledger := sessionLedger{Version: 1, Scope: name + strings.Repeat("a", 44), RunID: "old-run", Sessions: map[string]sessionEntry{}}
	data, _ := json.Marshal(ledger)
	if err := os.WriteFile(filepath.Join(dir, "sessions.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	return base, dir
}
func TestPrunePreviewAndApply(t *testing.T) {
	base, dir := pruneFixture(t)
	for _, apply := range []bool{false, true} {
		results, err := PruneSessions(context.Background(), base, apply)
		if err != nil || len(results) != 1 {
			t.Fatalf("results=%v err=%v", results, err)
		}
		want := "stale: would remove"
		if apply {
			want = "removed"
		}
		if results[0].Status != want {
			t.Fatal(results)
		}
		_, err = os.Stat(dir)
		if apply && !os.IsNotExist(err) || !apply && err != nil {
			t.Fatalf("apply=%v stat=%v", apply, err)
		}
	}
}
func TestPrunePreservesActiveAgent(t *testing.T) {
	base, dir := pruneFixture(t)
	lock, err := os.OpenFile(filepath.Join(dir, "lock"), os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	if err = unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	results, err := PruneSessions(context.Background(), base, true)
	if err != nil || results[0].Status != "kept: agent running" {
		t.Fatalf("%v %v", results, err)
	}
}
func TestPrunePreservesListeningSocketAndRemovesStaleSocket(t *testing.T) {
	base, dir := pruneFixture(t)
	socket := filepath.Join(dir, "tmux.sock")
	// Use a short base: Unix socket paths are bounded on both supported platforms.
	if len(socket) > 100 {
		t.Skip("temporary directory too long for Unix socket")
	}
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: socket, Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	listener.SetUnlinkOnClose(false)
	defer listener.Close()
	results, err := PruneSessions(context.Background(), base, true)
	if err != nil || results[0].Status != "kept: tmux server running" {
		t.Fatalf("%v %v", results, err)
	}
	listener.Close()
	results, err = PruneSessions(context.Background(), base, true)
	if err != nil || results[0].Status != "removed" {
		t.Fatalf("%v %v", results, err)
	}
}
func TestPrunePreservesUnknownFilesAndSymlinks(t *testing.T) {
	for _, kind := range []string{"unknown", "symlink", "ledger"} {
		t.Run(kind, func(t *testing.T) {
			base, dir := pruneFixture(t)
			switch kind {
			case "unknown":
				if err := os.WriteFile(filepath.Join(dir, "user-data"), []byte("keep"), 0600); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				if err := os.Rename(dir, dir+"-target"); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(dir+"-target", dir); err != nil {
					t.Fatal(err)
				}
			case "ledger":
				if err := os.WriteFile(filepath.Join(dir, "sessions.json"), []byte("bad"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			results, err := PruneSessions(context.Background(), base, true)
			if err != nil || len(results) != 1 || results[0].Status == "removed" {
				t.Fatalf("%v %v", results, err)
			}
			if _, err := os.Lstat(dir); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestPruneGateBlocksConcurrentOpen(t *testing.T) {
	base, _ := pruneFixture(t)
	release, err := sessionGate(base, true)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if unlock, err := sessionGate(base, false); err == nil {
		unlock()
		t.Fatal("opener entered during prune")
	}
}
func TestPrunePreservesUnconfirmedSessionsWithoutSocket(t *testing.T) {
	base, dir := pruneFixture(t)
	data, err := os.ReadFile(filepath.Join(dir, "sessions.json"))
	if err != nil {
		t.Fatal(err)
	}
	var ledger sessionLedger
	if err = json.Unmarshal(data, &ledger); err != nil {
		t.Fatal(err)
	}
	ledger.Sessions["session-a"] = sessionEntry{Name: ownedName("session-a"), Marker: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}
	data, _ = json.Marshal(ledger)
	if err = os.WriteFile(filepath.Join(dir, "sessions.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	results, err := PruneSessions(context.Background(), base, true)
	if err != nil || results[0].Status != "kept: unconfirmed sessions" {
		t.Fatalf("%v %v", results, err)
	}
}

func TestPruneCannotEnterWhileManagerOpens(t *testing.T) {
	base, dir := pruneFixture(t)
	release, err := sessionGate(base, false)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if _, err := PruneSessions(context.Background(), base, true); err == nil {
		t.Fatal("prune bypassed opener's shared gate")
	}
	if _, err := os.Stat(dir); err != nil {
		t.Fatal(err)
	}
}

func TestPruneCancellationPreservesDirectory(t *testing.T) {
	base, dir := pruneFixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := PruneSessions(ctx, base, true); err == nil {
		t.Fatal("ignored cancellation")
	}
	if _, err := os.Stat(dir); err != nil {
		t.Fatal(err)
	}
}
