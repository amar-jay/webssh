package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadMissingDoesNotWrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.toml")
	c, err := Load(path)
	if err != nil || c.Validate() != nil {
		t.Fatalf("invalid defaults: %+v, %v", c, err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("loading defaults created a file")
	}
}

func TestSaveRoundTripAndRejectInvalid(t *testing.T) {
	path := filepath.Join(t.TempDir(), "webssh", "config.toml")
	c := Config{Version: 1, MachineName: "test-machine", Shell: "/bin/sh"}
	if err := Save(path, c); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load(path)
	if err != nil || loaded != c {
		t.Fatalf("round trip: %+v, %v", loaded, err)
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0600 {
		t.Fatalf("permissions: %v", info.Mode())
	}
	c.MachineName = ""
	if err := Save(path, c); err == nil {
		t.Fatal("accepted empty machine name")
	}
	loaded, err = Load(path)
	if err != nil || loaded.MachineName != "test-machine" {
		t.Fatal("invalid save changed existing config")
	}
}

func TestLoadRejectsInvalidDocuments(t *testing.T) {
	for _, data := range []string{
		"version = 2\nmachine_name = 'test'\nshell = 'sh'",
		"version = 1\nmachine_name = 'test'\nshell = 'sh'\nunknown = true",
		"version = 1\nversion = 1\nmachine_name = 'test'\nshell = 'sh'",
		"shell = [broken",
		`{"version":1,"machine_name":"test","shell":"sh"}`,
	} {
		t.Run(data, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "config.toml")
			if err := os.WriteFile(path, []byte(data), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := Load(path); err == nil {
				t.Fatal("accepted invalid config")
			}
		})
	}
}

func TestTmuxConfigUsesLocalFileOrNone(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", "")
	c := Defaults()
	if c.TmuxConfig != "default" {
		t.Fatalf("default setting: %q", c.TmuxConfig)
	}
	file, err := c.TmuxFile()
	if err != nil || file != "" {
		t.Fatalf("missing local config: %q %v", file, err)
	}
	local := filepath.Join(home, ".tmux.conf")
	if err := os.WriteFile(local, []byte("set -g history-limit 1000\n"), 0600); err != nil {
		t.Fatal(err)
	}
	file, err = c.TmuxFile()
	if err != nil || file != local {
		t.Fatalf("local config: %q %v", file, err)
	}
	xdg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", xdg)
	preferred := filepath.Join(xdg, "tmux", "tmux.conf")
	if err := os.MkdirAll(filepath.Dir(preferred), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(preferred, []byte("set -g mouse on\n"), 0600); err != nil {
		t.Fatal(err)
	}
	file, err = Config{Version: 1, MachineName: "m", Shell: "/bin/sh"}.TmuxFile()
	if err != nil || file != preferred {
		t.Fatalf("xdg config: %q %v", file, err)
	}
	none := Config{Version: 1, MachineName: "m", Shell: "/bin/sh", TmuxConfig: "none"}
	if file, err = none.TmuxFile(); err != nil || file != "" {
		t.Fatalf("none: %q %v", file, err)
	}
	explicit := Config{Version: 1, MachineName: "m", Shell: "/bin/sh", TmuxConfig: local}
	if file, err = explicit.TmuxFile(); err != nil || file != local {
		t.Fatalf("explicit: %q %v", file, err)
	}
	missing := Config{Version: 1, MachineName: "m", Shell: "/bin/sh", TmuxConfig: filepath.Join(home, "missing.conf")}
	if _, err = missing.TmuxFile(); err == nil {
		t.Fatal("accepted a missing tmux config path")
	}
}

func TestPathUsesHomeNotXDG(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	path, err := Path()
	if err != nil {
		t.Fatal(err)
	}
	if path != filepath.Join(home, ".webssh", "config.toml") {
		t.Fatalf("unexpected path: %s", path)
	}
}
