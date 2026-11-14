package main

import (
	"fmt"
	"os"

	"github.com/amar-jay/webssh/apps/cli/internal/command"
)

func main() {
	if err := command.Run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "webssh:", err)
		os.Exit(1)
	}
}
