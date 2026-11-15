//go:build linux || darwin

package terminalclient

import (
	"context"
	"errors"
	"net"
	"os"
	"os/signal"
	"syscall"

	"github.com/muesli/cancelreader"
	"golang.org/x/term"
)

// RunTTY owns local raw mode and restores it before returning on every path.
func RunTTY(parent context.Context, conn net.Conn, input, output *os.File, opts Options) (Result, error) {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	fd := int(input.Fd())
	cols, rows, err := term.GetSize(fd)
	if err != nil {
		return Result{}, errors.New("could not read local terminal size")
	}
	reader, err := cancelreader.NewReader(input)
	if err != nil {
		return Result{}, errors.New("could not initialize terminal input")
	}
	defer reader.Close()
	previous, err := term.MakeRaw(fd)
	if err != nil {
		return Result{}, errors.New("could not enter raw terminal mode")
	}
	defer term.Restore(fd, previous)
	opts.Size = Size{cols, rows}
	sizes := make(chan Size, 1)
	opts.Resize = sizes
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGWINCH)
	defer signal.Stop(signals)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			select {
			case <-ctx.Done():
				return
			case <-signals:
				c, r, e := term.GetSize(fd)
				if e == nil {
					select {
					case <-sizes:
					default:
					}
					select {
					case sizes <- Size{c, r}:
					default:
					}
				}
			}
		}
	}()
	defer func() { cancel(); <-done }()
	return Run(ctx, conn, reader, output, opts)
}
