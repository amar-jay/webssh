package command

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestServeRequiresOneDirectory(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "file.txt")
	if err := os.WriteFile(file, nil, 0600); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		args []string
		want string
	}{
		{nil, "usage: webssh serve <path>"},
		{[]string{dir, dir}, "usage: webssh serve <path>"},
		{[]string{""}, "usage: webssh serve <path>"},
		{[]string{filepath.Join(dir, "missing")}, "open workspace directory"},
		{[]string{file}, "is not a directory"},
		{[]string{dir}, "not implemented yet (workspace: " + dir + ")"},
	} {
		err := serve(tc.args)
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("serve(%q): got %v, want %q", tc.args, err, tc.want)
		}
	}
}

func TestServeResolvesRelativeDirectory(t *testing.T) {
	path, err := filepath.Abs(".")
	if err != nil {
		t.Fatal(err)
	}
	if err := serve([]string{"."}); err == nil || !strings.Contains(err.Error(), "workspace: "+path) {
		t.Fatalf("relative workspace was not resolved: %v", err)
	}
}
