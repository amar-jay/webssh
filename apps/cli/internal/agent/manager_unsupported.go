//go:build !linux && !darwin

package agent

import (
	"errors"
	"regexp"
)

var sessionHandle = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

type SessionManager struct{}

func randomHandle() (string, error) { return "", errors.New("PTY is unsupported on this platform") }
func OpenSessionManager(string, string) (*SessionManager, error) {
	return nil, errors.New("tmux sessions require Linux or macOS")
}
func (*SessionManager) Close()                         {}
func (*SessionManager) RunID() string                  { return "" }
func (*SessionManager) Snapshot() ([]string, []string) { return nil, nil }
func (*SessionManager) Terminate(string) error         { return errors.New("unsupported platform") }
func (*SessionManager) State(string) (bool, int, bool, error) {
	return false, 0, false, errors.New("unsupported platform")
}
func (*SessionManager) Attach(string, bool, Options, string, int, int) (*process, error) {
	return nil, errors.New("unsupported platform")
}
