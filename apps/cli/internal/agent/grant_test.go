package agent

import (
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestEncodeGrantLayout(t *testing.T) {
	got := EncodeGrant("agent1", "grant-key-material", "sess1", "nonce1", 1_700_000_060)
	prefix := "v1.sess1.1700000060.nonce1."
	if got != "v1.sess1.1700000060.nonce1.iRvx-XlhTlFOyZVl0Wb8g_u5H3hRNojF-P4nYgAipug" || !strings.HasPrefix(got, prefix) {
		t.Fatalf("layout: %q", got)
	}
}

func TestGrantVerifierAcceptsValidGrantOnce(t *testing.T) {
	v := NewGrantVerifier("agent1", "grant-key-material")
	now := time.Unix(1_700_000_000, 0)
	grant := EncodeGrant("agent1", "grant-key-material", "sess1", "nonce1", now.Unix()+60)
	got, err := v.Verify(grant, now)
	if err != nil || got != "sess1" {
		t.Fatalf("valid grant: %q %v", got, err)
	}
	if _, err := v.Verify(grant, now); err == nil || !strings.Contains(err.Error(), "replayed") {
		t.Fatalf("replay: %v", err)
	}
}

func TestGrantVerifierRejectsTamperedExpiredAndForeign(t *testing.T) {
	v := NewGrantVerifier("agent1", "grant-key-material")
	now := time.Unix(1_700_000_000, 0)
	valid := EncodeGrant("agent1", "grant-key-material", "sess1", "nonce1", now.Unix()+60)
	cases := []struct {
		name  string
		token string
		now   time.Time
		want  string
	}{
		{"expired", EncodeGrant("agent1", "grant-key-material", "sess1", "n", now.Unix()-1), now, "expired"},
		{"wrong key", EncodeGrant("agent1", "other-key", "sess1", "n", now.Unix()+60), now, "unauthorized"},
		{"wrong agent", EncodeGrant("agent2", "grant-key-material", "sess1", "n", now.Unix()+60), now, "unauthorized"},
		{"truncated", valid[:len(valid)-2], now, "invalid"},
		{"empty", "", now, "invalid"},
	}
	for _, tc := range cases {
		_, err := v.Verify(tc.token, tc.now)
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("%s: got %v, want %q", tc.name, err, tc.want)
		}
	}
}

func TestGrantCapacityPreservesReplayAndBoundsExpiry(t *testing.T) {
	v := NewGrantVerifier("a", "k")
	now := time.Now()
	first := EncodeGrant("a", "k", "s", "first", now.Unix()+60)
	if _, err := v.Verify(first, now); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 4095; i++ {
		if _, err := v.Verify(EncodeGrant("a", "k", "s", strconv.Itoa(i), now.Unix()+60), now); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := v.Verify(EncodeGrant("a", "k", "s", "overflow", now.Unix()+60), now); err == nil {
		t.Fatal("capacity must fail closed")
	}
	if _, err := v.Verify(first, now); err == nil {
		t.Fatal("replayed grant accepted")
	}
	if _, err := v.Verify(EncodeGrant("a", "k", "s", "future", now.Unix()+3600), now); err == nil {
		t.Fatal("unbounded expiry accepted")
	}
}

func TestGrantExpiryBoundaryAndInputBounds(t *testing.T) {
	now := time.Unix(1700000000, 0)
	verifier := NewGrantVerifier("agent", "key")
	for _, token := range []string{
		EncodeGrant("agent", "key", "session", "nonce", now.Unix()),
		EncodeGrant("agent", "key", strings.Repeat("s", 65), "nonce", now.Unix()+60),
		EncodeGrant("agent", "key", "session", strings.Repeat("n", 65), now.Unix()+60),
		strings.Repeat("x", 513),
	} {
		if _, err := verifier.Verify(token, now); err == nil {
			t.Fatal("invalid/expired grant accepted")
		}
	}
	if _, err := verifier.Verify(EncodeGrant("agent", "key", "session", "valid", now.Unix()+1), now); err != nil {
		t.Fatal(err)
	}
	verifier.mu.Lock()
	verifier.pruneLocked(now.Unix() + 1)
	remaining := len(verifier.nonces)
	verifier.mu.Unlock()
	if remaining != 0 {
		t.Fatal("expired nonce retained at exact expiry boundary")
	}
}

func TestAuthenticityCheckDoesNotConsumeGrant(t *testing.T) {
	verifier := NewGrantVerifier("agent", "key")
	now := time.Now()
	grant := EncodeGrant("agent", "key", "session", "nonce", now.Unix()+60)
	if !verifier.Authentic(grant, now) {
		t.Fatal("authentic grant rejected")
	}
	if _, err := verifier.Verify(grant, now); err != nil {
		t.Fatal("check consumed grant")
	}
	if verifier.Authentic(grant, now) {
		t.Fatal("replayed grant considered authentic")
	}
}
