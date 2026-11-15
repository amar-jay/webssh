// Package config owns user settings and persistence, independently of any UI.
package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode"

	"github.com/pelletier/go-toml/v2"
)

type Config struct {
	Version     int    `toml:"version"`
	MachineName string `toml:"machine_name"`
	Shell       string `toml:"shell"`
	// TmuxConfig is "default", "none", or a file path.
	// "default" uses the local tmux config when one exists, and no config otherwise.
	TmuxConfig string `toml:"tmux_config,omitempty"`
}

func Defaults() Config {
	name, _ := os.Hostname()
	if name == "" {
		name = "my-machine"
	}
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
	}
	return Config{Version: 1, MachineName: name, Shell: shell, TmuxConfig: "default"}
}

// LocalTmuxConfig returns the first user tmux config tmux would read, or "" when none exists.
func LocalTmuxConfig() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", nil
	}
	var candidates []string
	if xdg := os.Getenv("XDG_CONFIG_HOME"); xdg != "" {
		candidates = append(candidates, filepath.Join(xdg, "tmux", "tmux.conf"))
	}
	candidates = append(candidates,
		filepath.Join(home, ".config", "tmux", "tmux.conf"),
		filepath.Join(home, ".tmux.conf"),
	)
	seen := map[string]bool{}
	for _, path := range candidates {
		if seen[path] {
			continue
		}
		seen[path] = true
		info, err := os.Stat(path)
		if err == nil && info.Mode().IsRegular() {
			return path, nil
		}
	}
	return "", nil
}

// TmuxFile resolves tmux_config. An empty result means start tmux with no config file.
func (c Config) TmuxFile() (string, error) {
	switch strings.TrimSpace(c.TmuxConfig) {
	case "", "default":
		return LocalTmuxConfig()
	case "none":
		return "", nil
	}
	path, err := expandPath(c.TmuxConfig)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return "", fmt.Errorf("tmux config %s is not available", path)
	}
	return path, nil
}

func expandPath(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" || strings.ContainsFunc(path, unicode.IsControl) {
		return "", errors.New("tmux config path is invalid")
	}
	if path == "~" || strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("find home directory: %w", err)
		}
		if path == "~" {
			path = home
		} else {
			path = filepath.Join(home, path[2:])
		}
	}
	if !filepath.IsAbs(path) {
		return "", errors.New("tmux config path must be absolute")
	}
	return filepath.Clean(path), nil
}

func Path() (string, error) {
	dir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("find home directory: %w", err)
	}
	return filepath.Join(dir, ".webssh", "config.toml"), nil
}

func (c Config) Validate() error {
	if c.Version != 1 {
		return fmt.Errorf("unsupported config version %d", c.Version)
	}
	switch strings.TrimSpace(c.TmuxConfig) {
	case "", "default", "none":
	default:
		if _, err := expandPath(c.TmuxConfig); err != nil {
			return err
		}
	}
	for _, field := range []struct{ name, value string }{{"machine name", c.MachineName}, {"shell", c.Shell}} {
		if strings.TrimSpace(field.value) == "" {
			return fmt.Errorf("%s must not be empty", field.name)
		}
		if strings.ContainsFunc(field.value, unicode.IsControl) {
			return fmt.Errorf("%s must not contain control characters", field.name)
		}
	}
	return nil
}

func Load(path string) (Config, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return Defaults(), nil
	}
	if err != nil {
		return Config{}, fmt.Errorf("read config: %w", err)
	}
	// Reject unknown fields rather than silently losing settings on a later save.
	dec := toml.NewDecoder(strings.NewReader(string(data)))
	dec.DisallowUnknownFields()
	var c Config
	if err := dec.Decode(&c); err != nil {
		return Config{}, fmt.Errorf("decode config: %w", err)
	}
	if err := c.Validate(); err != nil {
		return Config{}, err
	}
	return c, nil
}

func Save(path string, c Config) error {
	if err := c.Validate(); err != nil {
		return err
	}
	data, err := toml.Marshal(c)
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("create config directory: %w", err)
	}
	f, err := os.CreateTemp(dir, ".config-*.toml")
	if err != nil {
		return fmt.Errorf("create config file: %w", err)
	}
	defer os.Remove(f.Name())
	// CreateTemp uses mode 0600. Replace atomically in the same directory.
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Rename(f.Name(), path); err != nil {
		return fmt.Errorf("save config: %w", err)
	}
	return nil
}
