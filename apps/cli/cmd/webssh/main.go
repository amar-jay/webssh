package main

import (
	"errors"
	"fmt"
	"os"

	"github.com/amar-jay/webssh/apps/cli/internal/command"
)

func main() {
	if err := command.Run(os.Args); err != nil {
		if err.Error() != "" {
			fmt.Fprintln(os.Stderr, "webssh:", err)
		}
		var exit interface{ ExitCode() int }
		if errors.As(err, &exit) {
			os.Exit(exit.ExitCode())
		}
		os.Exit(1)
	}
}
