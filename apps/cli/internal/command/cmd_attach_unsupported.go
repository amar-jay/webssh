//go:build !linux && !darwin

package command

import (
	"context"
	"errors"
	"github.com/amar-jay/webssh/apps/cli/internal/pairing"
)

func checkInteractiveTerminal() error {
	return errors.New("native attach is supported on Linux and macOS")
}
func attachTerminal(context.Context, pairing.AttachDescriptor) error {
	return checkInteractiveTerminal()
}
