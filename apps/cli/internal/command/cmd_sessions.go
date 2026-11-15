package command

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/amar-jay/webssh/apps/cli/internal/agent"
	"github.com/amar-jay/webssh/apps/cli/internal/config"
	"github.com/amar-jay/webssh/apps/cli/internal/credentials"
	"github.com/urfave/cli/v3"
)

func sessionsCommand() *cli.Command {
	return &cli.Command{Name: "sessions", Usage: "List or terminate owned tmux sessions while serve is stopped", Description: "Stop serve first to acquire the workspace lock. Without flags, list stable IDs. --terminate and --terminate-all explicitly kill only ledger-owned tmux sessions; they never remove ownership tombstones. Use the dashboard while serve is running.", ArgsUsage: "<path>",
		Commands:  []*cli.Command{pruneSessionsCommand()},
		Arguments: []cli.Argument{&cli.StringArg{Name: "path", Required: true}},
		Flags: []cli.Flag{
			&cli.StringFlag{Name: "config", Usage: "configuration file"}, &cli.StringFlag{Name: "credentials", Usage: "paired credentials file"}, &cli.StringFlag{Name: "state-dir", Usage: "same private state directory used by serve"},
			&cli.StringFlag{Name: "terminate", Usage: "explicitly terminate one stable session ID"}, &cli.BoolFlag{Name: "terminate-all", Usage: "explicitly terminate all owned sessions in this workspace"},
		}, Action: runSessions}
}
func runSessions(ctx context.Context, cmd *cli.Command) error {
	if cmd.String("terminate") != "" && cmd.Bool("terminate-all") {
		return errors.New("choose --terminate or --terminate-all")
	}
	workspace, err := workspacePath([]string{cmd.StringArg("path")})
	if err != nil {
		return err
	}
	cfgPath := cmd.String("config")
	if cfgPath == "" {
		cfgPath, err = config.Path()
		if err != nil {
			return err
		}
	}
	cfg, err := config.Load(cfgPath)
	if err != nil {
		return errors.New("could not load workspace configuration")
	}
	credPath := cmd.String("credentials")
	if credPath == "" {
		credPath, err = credentials.Path()
		if err != nil {
			return err
		}
	}
	creds, err := credentials.Load(credPath)
	if err != nil && !os.IsNotExist(err) {
		return errors.New("could not read workspace credentials")
	}
	stateDir := cmd.String("state-dir")
	if stateDir == "" {
		stateDir = filepath.Join(filepath.Dir(credPath), "sessions")
	}
	tmuxFile, err := cfg.TmuxFile()
	if err != nil {
		return err
	}
	manager, err := agent.OpenSessionManager(stateDir, managerScope(creds, cfg, workspace), tmuxFile)
	if err != nil {
		return err
	}
	defer manager.Close()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	sessions, err := manager.List(ctx)
	if err != nil {
		return errors.New("could not inspect tmux sessions; check the backend and try again")
	}
	sort.Slice(sessions, func(i, j int) bool { return sessions[i].ID < sessions[j].ID })
	id := cmd.String("terminate")
	if id == "" && !cmd.Bool("terminate-all") {
		if len(sessions) == 0 {
			fmt.Fprintln(os.Stdout, "No owned sessions in this workspace.")
		}
		for _, session := range sessions {
			fmt.Fprintf(os.Stdout, "%s  %s\n", session.ID, session.Status)
		}
		return nil
	}
	found := false
	for _, session := range sessions {
		if !cmd.Bool("terminate-all") && session.ID != id {
			continue
		}
		found = true
		if err := manager.TerminateContext(ctx, session.ID); err != nil {
			return errors.New("could not confirm termination; ownership or backend availability could not be verified")
		}
		fmt.Fprintf(os.Stdout, "Terminated %s\n", session.ID)
	}
	if !found && id != "" {
		return errors.New("session not found in this workspace ledger")
	}
	return nil
}

func pruneSessionsCommand() *cli.Command {
	return &cli.Command{Name: "prune", Usage: "Preview stale workspace state directories; preserve all live tmux servers", Flags: []cli.Flag{
		&cli.StringFlag{Name: "state-dir", Usage: "session state directory (default: ~/.webssh/sessions)"},
		&cli.BoolFlag{Name: "apply", Usage: "remove only confirmed stale workspace directories"},
	}, Action: func(ctx context.Context, cmd *cli.Command) error {
		if cmd.Args().Len() != 0 {
			return errors.New("sessions prune accepts no positional arguments")
		}
		base := cmd.String("state-dir")
		if base == "" {
			path, err := credentials.Path()
			if err != nil {
				return err
			}
			base = filepath.Join(filepath.Dir(path), "sessions")
		}
		ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		results, err := agent.PruneSessions(ctx, base, cmd.Bool("apply"))
		for _, result := range results {
			fmt.Fprintf(cmd.Writer, "%s  %s\n", result.Directory, result.Status)
		}
		if err != nil {
			return err
		}
		if len(results) == 0 {
			fmt.Fprintln(cmd.Writer, "No workspace state directories found.")
		}
		if !cmd.Bool("apply") {
			fmt.Fprintln(cmd.Writer, "Preview only. Use webssh sessions prune --apply to remove confirmed stale directories.")
		}
		return nil
	}}
}
