package command

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
)

func serve(args []string) error {
	flags := flag.NewFlagSet("webssh serve <path>", flag.ContinueOnError)
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	if flags.NArg() != 1 || flags.Arg(0) == "" {
		return errors.New("usage: webssh serve <path> (provide one workspace directory)")
	}
	path, err := filepath.Abs(flags.Arg(0))
	if err != nil {
		return fmt.Errorf("resolve workspace directory: %w", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("open workspace directory: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("workspace path %q is not a directory", path)
	}
	// This directory will become the remote shell's initial working directory.
	return fmt.Errorf("remote agent is not implemented yet (workspace: %s)", path)
}
