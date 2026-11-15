package main

import (
	"errors"
	"os"

	"github.com/amar-jay/webssh/apps/cli/internal/command"
)

func main() {
	if err := command.Run(os.Args); err != nil {
		var exit interface{ ExitCode() int }
		if errors.As(err, &exit) {
			os.Exit(exit.ExitCode())
		}
		os.Exit(1)
	}
}
