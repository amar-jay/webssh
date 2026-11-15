// Package command parses CLI arguments and composes configuration, UI, and agent services.
package command

import (
	"context"
	"fmt"
	"os"

	"github.com/urfave/cli/v3"

	"github.com/amar-jay/webssh/apps/cli/internal/config"
	configprompt "github.com/amar-jay/webssh/apps/cli/internal/prompt/config"
)

func New() *cli.Command {
	return &cli.Command{
		Name:  "webssh",
		Usage: "browser terminals for remote machines",
		Commands: []*cli.Command{
			configCommand(),
			pairCommand(),
			serveCommand(),
			sessionsCommand(),
		},
		// Keep process lifetime in main/tests; urfave help still prints and returns.
		ExitErrHandler: func(context.Context, *cli.Command, error) {},
	}
}

func Run(args []string) error {
	return New().Run(context.Background(), args)
}

func configCommand() *cli.Command {
	return &cli.Command{
		Name:  "config",
		Usage: "Configure this machine",
		Flags: []cli.Flag{
			&cli.StringFlag{
				Name:  "path",
				Usage: "configuration file (default: ~/.webssh/config.toml)",
			},
		},
		Action: runConfig,
	}
}

func runConfig(_ context.Context, cmd *cli.Command) error {
	if cmd.Args().Len() != 0 {
		return fmt.Errorf("config accepts no positional arguments")
	}
	path := cmd.String("path")
	if path == "" {
		var err error
		path, err = config.Path()
		if err != nil {
			return err
		}
	}
	cfg, err := config.Load(path)
	if err != nil {
		return err
	}
	_, statErr := os.Stat(path)
	saved, err := configprompt.Run(cfg, path, statErr == nil)
	if err != nil {
		return err
	}
	if saved {
		fmt.Fprintln(os.Stdout, "Configuration saved to", path)
	}
	return nil
}
