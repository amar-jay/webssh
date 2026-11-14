package credentials

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSaveAndLoadRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials.toml")
	in := File{
		Version:     1,
		AgentID:     "agent",
		AgentToken:  "token",
		GrantKey:    "grant",
		OwnerID:     "42",
		MachineName: "box",
	}
	if err := Save(path, in); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("mode %v", info.Mode().Perm())
	}
	out, err := Load(path)
	if err != nil || out != in {
		t.Fatalf("load: %+v %v", out, err)
	}
}

func TestLoadRejectsUnknownFields(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials.toml")
	if err := os.WriteFile(path, []byte("version = 1\nagent_id = \"a\"\nagent_token = \"t\"\ngrant_key = \"g\"\nowner_id = \"1\"\nmachine_name = \"n\"\nextra = true\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Fatal("expected unknown field error")
	}
}
