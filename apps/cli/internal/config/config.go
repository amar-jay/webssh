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
	return Config{Version: 1, MachineName: name, Shell: shell}
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
