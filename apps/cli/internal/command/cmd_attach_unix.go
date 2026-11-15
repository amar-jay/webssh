//go:build linux || darwin

package command

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/amar-jay/webssh/apps/cli/internal/logging"
	"github.com/amar-jay/webssh/apps/cli/internal/pairing"
	"github.com/amar-jay/webssh/apps/cli/internal/terminalclient"
	"github.com/tailscale/tailcat"
	"github.com/urfave/cli/v3"
	"golang.org/x/term"
	"tailscale.com/types/logger"
)

func checkInteractiveTerminal() error {
	if !term.IsTerminal(int(os.Stdin.Fd())) || !term.IsTerminal(int(os.Stdout.Fd())) {
		return errors.New("attach requires an interactive terminal on stdin and stdout")
	}
	return nil
}
func attachTerminal(parent context.Context, descriptor pairing.AttachDescriptor) error {
	ctx, cancel := signal.NotifyContext(parent, os.Interrupt, syscall.SIGTERM, syscall.SIGHUP)
	defer cancel()
	logging.From(ctx).Info("Connecting to agent", "component", "client", "event", "attach_connecting")
	fmt.Fprintln(os.Stderr, "Detach: Ctrl-] then .")
	client := &tailcat.Client{Server: tailcat.Addr(descriptor.Address), DERPMapURL: descriptor.DERPMapURL, Logf: logger.Discard}
	defer client.Close()
	dialCtx, done := context.WithTimeout(ctx, 25*time.Second)
	conn, err := client.DialTCPPort(dialCtx, uint16(descriptor.Port))
	done()
	if err != nil {
		return errors.New("could not connect to the agent; request a fresh approval and retry")
	}
	defer conn.Close()
	terminal := os.Getenv("TERM")
	if terminal == "" {
		terminal = "xterm-256color"
	}
	result, err := terminalclient.RunTTY(ctx, conn, os.Stdin, os.Stdout, terminalclient.Options{SessionID: descriptor.SessionID, Grant: descriptor.Grant, Backend: descriptor.Backend, Term: terminal})
	if err != nil {
		return err
	}
	if result.Detached {
		logging.From(ctx).Info("Detached", "component", "client", "event", "session_detached")
	}
	if result.ExitCode != 0 {
		return cli.Exit("", result.ExitCode)
	}
	return nil
}
