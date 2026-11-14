package command

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/amar-jay/webssh/apps/cli/internal/agent"
	"github.com/amar-jay/webssh/apps/cli/internal/config"
	"github.com/amar-jay/webssh/packages/protocol"
)

func serve(args []string) error {
	flags := flag.NewFlagSet("webssh serve [options] <path>", flag.ContinueOnError)
	configFile := flags.String("config", "", "configuration file (default: ~/.webssh/config.toml)")
	port := flags.Int("port", protocol.DefaultPort, "virtual terminal TCP port inside Tailcat")
	derpMap := flags.String("derpmap-url", "", "optional DERP map URL")
	maxConnections := flags.Int("max-connections", 8, "maximum simultaneous connections, including handshakes")
	jsonOutput := flags.Bool("json", false, "print connection credentials as one JSON record")
	if err := flags.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return nil
		}
		return err
	}
	workspace, err := workspacePath(flags.Args())
	if err != nil {
		return err
	}
	if *configFile == "" {
		*configFile, err = config.Path()
		if err != nil {
			return err
		}
	}
	cfg, err := config.Load(*configFile)
	if err != nil {
		return err
	}
	server, err := agent.New(agent.Options{Workspace: workspace, Shell: cfg.Shell, Port: *port, DERPMapURL: *derpMap, MaxConnections: *maxConnections})
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return server.Run(ctx, func(info agent.Info) error {
		if *jsonOutput {
			return json.NewEncoder(os.Stdout).Encode(info)
		}
		_, err := fmt.Fprintf(os.Stdout, "\x1b[38;2;192;153;255mWebSSH\x1b[0m · %s\nWorkspace: %s\n\nAddress: %s\nPort: %d\nToken: %s\n\n\x1b[38;2;130;139;184mConnection-scoped shells · Ctrl+C to stop\x1b[0m\n", cfg.MachineName, info.Workspace, info.Address, info.Port, info.Token)
		return err
	})
}

func workspacePath(args []string) (string, error) {
	if len(args) != 1 || args[0] == "" {
		return "", errors.New("usage: webssh serve <path> (provide one workspace directory)")
	}
	path, err := filepath.Abs(args[0])
	if err != nil {
		return "", fmt.Errorf("resolve workspace directory: %w", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("open workspace directory: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("workspace path %q is not a directory", path)
	}
	return path, nil
}
