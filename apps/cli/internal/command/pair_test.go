package command

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPairUsesProductionOriginAndRefusesExistingCredentials(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials.toml")
	if err := os.WriteFile(path, []byte("version = 1\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := Run([]string{"webssh", "pair", "--credentials", path}); err == nil || !strings.Contains(err.Error(), "--replace") {
		t.Fatalf("existing credentials: %v", err)
	}
}
