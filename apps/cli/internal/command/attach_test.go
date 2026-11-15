package command

import (
	"strings"
	"testing"
)

func TestAttachTarget(t *testing.T) {
	id := "session_123456789012"
	for _, input := range []string{id, "https://ssh.amarjay.com/s/" + id} {
		got, origin, err := attachTarget(input, "https://ssh.amarjay.com")
		if err != nil || got != id || origin != "https://ssh.amarjay.com" {
			t.Fatalf("target: %s %s %v", got, origin, err)
		}
	}
	for _, input := range []string{"short", "https://ssh.amarjay.com/s/" + id + "?grant=secret", "https://user:secret@ssh.amarjay.com/s/" + id, "http://remote.example/s/" + id, "https://ssh.amarjay.com/machines/" + id} {
		if _, _, err := attachTarget(input, "https://ssh.amarjay.com"); err == nil {
			t.Fatal("accepted malformed or insecure target")
		}
	}
	if _, _, err := attachTarget(id, "http://localhost:1234"); err != nil {
		t.Fatal(err)
	}
}
func TestAttachHelpDescribesDetach(t *testing.T) {
	var b strings.Builder
	cmd := New()
	cmd.Writer = &b
	if err := cmd.Run(t.Context(), []string{"webssh", "attach", "--help"}); err != nil {
		t.Fatal(err)
	}
	for _, text := range []string{"Ctrl-]", "not the OpenSSH", "No automatic takeover"} {
		if !strings.Contains(b.String(), text) {
			t.Fatalf("missing help: %s", text)
		}
	}
}
