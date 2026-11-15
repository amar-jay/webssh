// Package command parses CLI arguments and composes configuration, UI, and agent services.
package command

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"

	"github.com/urfave/cli/v3"

	"github.com/amar-jay/webssh/apps/cli/internal/config"
	"github.com/amar-jay/webssh/apps/cli/internal/logging"
	configprompt "github.com/amar-jay/webssh/apps/cli/internal/prompt/config"
)

// Version and Commit are injected by the reproducible release build.
var Version = "dev"
var Commit = "unknown"

func New() *cli.Command { return newCommand(nil) }

func newCommand(configured func(*slog.Logger)) *cli.Command {
	return &cli.Command{
		Name:    "webssh",
		Version: Version + " (" + Commit + "; protocol 2, bridge 1)",
		Usage:   "browser and native terminals for remote machines",
		Before: func(ctx context.Context, cmd *cli.Command) (context.Context, error) {
			format, level := savedLogSettings()
			logger, err := logging.FromSettings(cmd.ErrWriter, format, level)
			if err != nil {
				return ctx, err
			}
			if configured != nil {
				configured(logger)
			}
			return logging.WithLogger(ctx, logger), nil
		},
		Commands: []*cli.Command{
			configCommand(),
			pairCommand(),
			serveCommand(),
			attachCommand(),
			sessionsCommand(),
		},
		// Keep process lifetime in main/tests; urfave help still prints and returns.
		ExitErrHandler: func(context.Context, *cli.Command, error) {},
	}
}

func Run(args []string) error {
	return run(args, os.Stderr)
}

func run(args []string, stderr io.Writer) error {
	format, level := savedLogSettings()
	logger, setupErr := logging.FromSettings(stderr, format, level)
	if setupErr != nil {
		logger, _ = logging.New(stderr, "auto", "info")
	}
	cmd := newCommand(func(configured *slog.Logger) { logger = configured })
	cmd.ErrWriter = stderr
	err := cmd.Run(context.Background(), args)
	if err != nil && err.Error() != "" {
		logger.Error("Command failed", "component", "cli", "error", err)
	}
	return err
}

// savedLogSettings is best effort: commands that need the configuration report
// its errors themselves, so a broken file must not stop logging from starting.
// An empty result means the product defaults.
func savedLogSettings() (format, level string) {
	path, err := config.Path()
	if err != nil {
		return "", ""
	}
	cfg, err := config.Load(path)
	if err != nil {
		return "", ""
	}
	return cfg.LogFormat, cfg.LogLevel
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
