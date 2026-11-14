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
