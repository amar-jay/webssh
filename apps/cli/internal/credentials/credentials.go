// Package credentials stores paired agent secrets separately from user settings.
package credentials

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/pelletier/go-toml/v2"
)

type File struct {
	Origin      string `toml:"origin"`
	Version     int    `toml:"version"`
	AgentID     string `toml:"agent_id"`
	AgentToken  string `toml:"agent_token"`
	GrantKey    string `toml:"grant_key"`
	OwnerID     string `toml:"owner_id"`
	MachineName string `toml:"machine_name"`
}

func Path() (string, error) {
	dir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("find home directory: %w", err)
	}
	return filepath.Join(dir, ".webssh", "credentials.toml"), nil
}

func (c File) Validate() error {
	if c.Version != 1 {
		return fmt.Errorf("unsupported credentials version %d", c.Version)
	}
	for _, field := range []struct{ name, value string }{
		{"agent_id", c.AgentID},
		{"agent_token", c.AgentToken},
		{"grant_key", c.GrantKey},
		{"owner_id", c.OwnerID},
		{"machine_name", c.MachineName},
	} {
		if strings.TrimSpace(field.value) == "" {
			return fmt.Errorf("%s must not be empty", field.name)
		}
	}
	return nil
}

func Load(path string) (File, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return File{}, err
	}
	if err != nil {
		return File{}, fmt.Errorf("read credentials: %w", err)
	}
	dec := toml.NewDecoder(strings.NewReader(string(data)))
	dec.DisallowUnknownFields()
	var c File
	if err := dec.Decode(&c); err != nil {
		return File{}, fmt.Errorf("decode credentials: %w", err)
	}
	if err := c.Validate(); err != nil {
		return File{}, err
	}
	return c, nil
}

func Save(path string, c File) error {
	if err := c.Validate(); err != nil {
		return err
	}
	data, err := toml.Marshal(c)
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("create credentials directory: %w", err)
	}
	f, err := os.CreateTemp(dir, ".credentials-*.toml")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err := f.Chmod(0600); err != nil {
		f.Close()
		return err
	}
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
		return err
	}
	return syncDirectory(dir)
}
