// Package command parses CLI arguments and composes configuration, UI, and agent services.
package command

import (
	"errors"
	"flag"
	"fmt"
	"os"

	"github.com/amar-jay/webssh/apps/cli/internal/config"
	configprompt "github.com/amar-jay/webssh/apps/cli/internal/prompt/config"
)

func Run(args []string) error {
	if len(args) == 0 {
		usage()
		return nil
	}
	switch args[0] {
	case "help", "-h", "--help":
		usage()
		return nil
	case "config":
		flags := flag.NewFlagSet("webssh config", flag.ContinueOnError)
		path := flags.String("path", "", "configuration file (default: ~/.webssh/config.toml)")
		if err := flags.Parse(args[1:]); err != nil {
			if errors.Is(err, flag.ErrHelp) {
				return nil
			}
			return err
		}
		if flags.NArg() != 0 {
			return errors.New("config accepts no positional arguments")
		}
		if *path == "" {
			var err error
			*path, err = config.Path()
			if err != nil {
				return err
			}
		}
		cfg, err := config.Load(*path)
		if err != nil {
			return err
		}
		saved, err := configprompt.Run(cfg, *path)
		if err != nil {
			return err
		}
		if saved {
			fmt.Fprintln(os.Stdout, "Configuration saved to", *path)
		}
		return nil
	case "serve":
		return errors.New("remote agent is not implemented yet")
	default:
		return fmt.Errorf("unknown command %q (see webssh help)", args[0])
	}
}

func usage() {
	fmt.Fprintln(os.Stdout, "WebSSH\n\nUsage: webssh <command>\n\n  config [--path FILE]  Configure this machine\n  help                  Show help\n\nRemote serving is not implemented yet.")
}
