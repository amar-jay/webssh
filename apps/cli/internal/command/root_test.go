package command

import (
	"bytes"
	"strings"
	"testing"
)

func TestHelpListsCommands(t *testing.T) {
	var out bytes.Buffer
	cmd := New()
	cmd.Writer = &out
	if err := cmd.Run(t.Context(), []string{"webssh", "--help"}); err != nil {
		t.Fatal(err)
	}
	got := out.String()
	for _, want := range []string{"config", "pair", "serve"} {
		if !strings.Contains(got, want) {
			t.Fatalf("help missing %q:\n%s", want, got)
		}
	}
}

func TestUnknownCommand(t *testing.T) {
	err := Run([]string{"webssh", "nope"})
	if err == nil || !strings.Contains(err.Error(), "nope") {
		t.Fatalf("unknown command: %v", err)
	}
}

func TestServeHelpMentionsPath(t *testing.T) {
	var out bytes.Buffer
	cmd := New()
	cmd.Writer = &out
	if err := cmd.Run(t.Context(), []string{"webssh", "serve", "--help"}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "path") {
		t.Fatalf("serve help:\n%s", out.String())
	}
}

func TestServeMissingPath(t *testing.T) {
	err := Run([]string{"webssh", "serve"})
	if err == nil {
		t.Fatal("expected missing path error")
	}
}
