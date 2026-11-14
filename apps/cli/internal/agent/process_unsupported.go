//go:build !linux && !darwin

package agent

import (
	"errors"
	"os"
	"os/exec"
)

const supportedPTY = false

type process struct {
	file *os.File
	cmd  *exec.Cmd
}

func startProcess(Options, string, int, int) (*process, error) {
	return nil, errors.New("PTY is unsupported on this platform")
}
func (p *process) resize(int, int) error { return errors.New("PTY is unsupported on this platform") }
func (p *process) stop()                 {}
