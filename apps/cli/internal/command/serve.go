package command

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/urfave/cli/v3"

	"github.com/amar-jay/webssh/apps/cli/internal/agent"
	"github.com/amar-jay/webssh/apps/cli/internal/config"
	"github.com/amar-jay/webssh/apps/cli/internal/credentials"
	"github.com/amar-jay/webssh/apps/cli/internal/pairing"
	"github.com/amar-jay/webssh/packages/protocol"
)

func serveCommand() *cli.Command {
	return &cli.Command{
		Name:      "serve",
		Usage:     "Serve terminal sessions in a workspace directory",
		ArgsUsage: "<path>",
		Arguments: []cli.Argument{
			&cli.StringArg{
				Name:      "path",
				UsageText: "workspace directory",
				Required:  true,
			},
		},
		Flags: []cli.Flag{
			&cli.StringFlag{
				Name:  "config",
				Usage: "configuration file (default: ~/.webssh/config.toml)",
			},
			&cli.StringFlag{
				Name:  "credentials",
				Usage: "paired credentials file (default: ~/.webssh/credentials.toml)",
			},
			&cli.IntFlag{
				Name:  "port",
				Value: protocol.DefaultPort,
				Usage: "virtual terminal TCP port inside Tailcat",
			},
			&cli.StringFlag{
				Name:  "derpmap-url",
				Usage: "optional DERP map URL",
			},
			&cli.IntFlag{
				Name:  "max-connections",
				Value: 8,
				Usage: "maximum simultaneous connections, including handshakes",
			},
			&cli.BoolFlag{
				Name:  "json",
				Usage: "print connection credentials as one JSON record",
			},
			&cli.BoolFlag{
				Name:  "dev-token",
				Usage: "also mint a development per-run token for /dev/connect",
			},
		},
		Action: runServe,
	}
}

func runServe(ctx context.Context, cmd *cli.Command) error {
	workspace, err := workspacePath([]string{cmd.StringArg("path")})
	if err != nil {
		return err
	}
	configFile := cmd.String("config")
	if configFile == "" {
		configFile, err = config.Path()
		if err != nil {
			return err
		}
	}
	cfg, err := config.Load(configFile)
	if err != nil {
		return err
	}
	credFile := cmd.String("credentials")
	if credFile == "" {
		credFile, err = credentials.Path()
		if err != nil {
			return err
		}
	}
	opts := agent.Options{
		Workspace:      workspace,
		Shell:          cfg.Shell,
		Port:           cmd.Int("port"),
		DERPMapURL:     cmd.String("derpmap-url"),
		MaxConnections: cmd.Int("max-connections"),
	}
	creds, credErr := credentials.Load(credFile)
	devToken := cmd.Bool("dev-token")
	switch {
	case credErr == nil:
		control, err := pairing.NewClient(creds.Origin)
		if err != nil {
			return errors.New("paired origin is missing or invalid; pair again")
		}
		sessionID, err := control.AgentSession(ctx, creds, "", "")
		if err != nil {
			return fmt.Errorf("authorize agent run: %w", err)
		}
		opts.SessionID = sessionID
		opts.CheckAccess = func(ctx context.Context, id, nonce string) error {
			_, err := control.AgentSession(ctx, creds, id, nonce)
			return err
		}
		opts.Grants = agent.NewGrantVerifier(creds.AgentID, creds.GrantKey)
		if devToken {
			token, err := newDevToken()
			if err != nil {
				return err
			}
			opts.Token = token
			opts.AllowDevToken = true
		}
	case errors.Is(credErr, os.ErrNotExist):
		if !devToken {
			return errors.New("no paired credentials; run webssh pair or explicitly pass --dev-token")
		}
		opts.AllowDevToken = true
	default:
		return credErr
	}
	server, err := agent.New(opts)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
	defer stop()
	return server.Run(ctx, func(info agent.Info) error {
		if cmd.Bool("json") {
			return json.NewEncoder(os.Stdout).Encode(info)
		}
		if credErr == nil {
			fmt.Fprintf(os.Stdout, "\x1b[38;2;192;153;255mWebSSH\x1b[0m · %s\nPaired agent: %s\nWorkspace: %s\n\nAddress: %s\nPort: %d\nAuth: HMAC grants\n", cfg.MachineName, creds.AgentID, info.Workspace, info.Address, info.Port)
			if info.Token != "" {
				fmt.Fprintf(os.Stdout, "Dev token: %s\n", info.Token)
			}
			fmt.Fprintln(os.Stdout, "\n\x1b[38;2;130;139;184mConnection-scoped shells · Ctrl+C to stop\x1b[0m")
			return nil
		}
		_, err := fmt.Fprintf(os.Stdout, "\x1b[38;2;192;153;255mWebSSH\x1b[0m · %s\nWorkspace: %s\n\nAddress: %s\nPort: %d\nToken: %s\n\n\x1b[38;2;130;139;184mDevelopment token · Ctrl+C to stop\x1b[0m\n", cfg.MachineName, info.Workspace, info.Address, info.Port, info.Token)
		return err
	})
}

func newDevToken() (string, error) {
	var secret [32]byte
	if _, err := rand.Read(secret[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(secret[:]), nil
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
