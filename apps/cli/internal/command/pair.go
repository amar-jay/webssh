package command

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"charm.land/lipgloss/v2"
	"github.com/urfave/cli/v3"

	"github.com/amar-jay/webssh/apps/cli/internal/config"
	"github.com/amar-jay/webssh/apps/cli/internal/credentials"
	"github.com/amar-jay/webssh/apps/cli/internal/pairing"
)

func pairCommand() *cli.Command {
	return &cli.Command{
		Name:  "pair",
		Usage: "Pair this machine with an authenticated browser",
		Flags: []cli.Flag{
			&cli.BoolFlag{Name: "renew", Usage: "rotate an existing paired credential (requires online access)"},
			&cli.StringFlag{
				Name:    "origin",
				Usage:   "WebSSH site origin",
				Sources: cli.EnvVars("WEBSSH_ORIGIN"),
			},
			&cli.StringFlag{
				Name:  "config",
				Usage: "configuration file (default: ~/.webssh/config.toml)",
			},
			&cli.StringFlag{
				Name:  "credentials",
				Usage: "credentials file (default: ~/.webssh/credentials.toml)",
			},
			&cli.BoolFlag{
				Name:  "replace",
				Usage: "replace existing paired credentials",
			},
		},
		Action: runPair,
	}
}

func runPair(ctx context.Context, cmd *cli.Command) error {
	if cmd.Args().Len() != 0 {
		return errors.New("pair accepts no positional arguments")
	}
	credFile := cmd.String("credentials")
	if credFile == "" {
		var err error
		credFile, err = credentials.Path()
		if err != nil {
			return err
		}
	}
	unlock, err := credentials.Lock(credFile)
	if err != nil {
		return fmt.Errorf("credential operation already running or unavailable: %w", err)
	}
	defer unlock()
	if recovery, err := credentials.ReadRecovery(credFile); err == nil {
		return finishCredentialRecovery(ctx, credFile, recovery)
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if cmd.Bool("renew") {
		previous, err := credentials.Load(credFile)
		if err != nil {
			return err
		}
		next := previous
		next.AgentToken, err = newDevToken()
		if err != nil {
			return err
		}
		operationID, err := newDevToken()
		if err != nil {
			return err
		}
		recovery := credentials.Recovery{Mode: "renew", Previous: previous, Next: next, OperationID: operationID}
		if err = credentials.WriteRecovery(credFile, recovery); err != nil {
			return err
		}
		return finishCredentialRecovery(ctx, credFile, recovery)
	}

	origin := cmd.String("origin")
	if origin == "" {
		return errors.New("set --origin or WEBSSH_ORIGIN to the WebSSH site origin")
	}
	configFile := cmd.String("config")
	if configFile == "" {
		var err error
		configFile, err = config.Path()
		if err != nil {
			return err
		}
	}

	if _, err := os.Stat(credFile); err == nil && !cmd.Bool("replace") {
		return errors.New("credentials already exist; pass --replace to pair again")
	}
	cfg, err := config.Load(configFile)
	if err != nil {
		return err
	}
	client, err := pairing.NewClient(origin)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()
	started, err := client.Start(ctx, cfg.MachineName)
	if err != nil {
		return fmt.Errorf("start pairing: %w", err)
	}
	code := lipgloss.NewStyle().Foreground(lipgloss.Color("#4fd6be")).Bold(true).Render(started.Code)
	url := lipgloss.NewStyle().Foreground(lipgloss.Color("#82aaff")).Render(started.URL)
	fmt.Fprintf(os.Stdout, "%s\n\nCode: %s\nOpen: %s\n\n%s\n",
		lipgloss.NewStyle().Foreground(lipgloss.Color("#c099ff")).Render("WebSSH pairing"),
		code,
		url,
		lipgloss.NewStyle().Foreground(lipgloss.Color("#828bb8")).Render("Waiting for browser approval. Ctrl+C cancels."),
	)
	file, err := client.Wait(ctx, started.Code, started.CLISecret)
	if err != nil {
		return err
	}
	var previous credentials.File
	if cmd.Bool("replace") {
		previous, err = credentials.Load(credFile)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	recovery := credentials.Recovery{Mode: "replace", Previous: previous, Next: file}
	if err = credentials.WriteRecovery(credFile, recovery); err != nil {
		return err
	}
	if err = finishCredentialRecovery(ctx, credFile, recovery); err != nil {
		return err
	}

	fmt.Fprintf(os.Stdout, "Paired %s as %s\n", file.MachineName, file.AgentID)
	return nil
}
