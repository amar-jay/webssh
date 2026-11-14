package credentials

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
)

// Recovery is written and fsynced before any destructive remote operation.
// Both credentials remain available after a crash or a failed final rename.
type Recovery struct {
	Mode        string `json:"mode"`
	OperationID string `json:"operationId"`
	Previous    File   `json:"previous"`
	Next        File   `json:"next"`
}

func ReadRecovery(path string) (Recovery, error) {
	var r Recovery
	data, err := os.ReadFile(path + ".recovery")
	if err != nil {
		return r, err
	}
	if err = json.Unmarshal(data, &r); err != nil {
		return r, err
	}
	if r.Mode != "renew" && r.Mode != "replace" {
		return r, errors.New("invalid credential recovery mode")
	}
	if err = r.Next.Validate(); err != nil {
		return r, err
	}
	return r, nil
}
func WriteRecovery(path string, r Recovery) error {
	data, err := json.Marshal(r)
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err = os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".recovery-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Rename(f.Name(), path+".recovery"); err != nil {
		return err
	}
	return syncDirectory(dir)
}
func FinishRecovery(path string) error {
	if err := os.Remove(path + ".recovery"); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return syncDirectory(filepath.Dir(path))
}
func syncDirectory(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}
