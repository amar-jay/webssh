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
	"time"

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
				Usage: "print a browser URL as JSON (development mode includes connection credentials)",
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
	var control *pairing.Client
	var runID string
	switch {
	case credErr == nil:
		control, err = pairing.NewClient(creds.Origin)
		if err != nil {
			return errors.New("paired origin is missing or invalid; pair again")
		}
		runID, err = newDevToken() // Random public run/session handle, no credentials in the URL.
		if err != nil {
			return err
		}
		opts.SessionID = runID
		opts.AllowRunSessions = true
		opts.CheckAccess = func(ctx context.Context, id, nonce string) error {
			return control.RunAccess(ctx, creds, runID, id, nonce)
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
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	heartbeatDone := make(chan error, 1)
	heartbeatStarted := false
	if control != nil {
		// Even a lost registration response gets bounded cleanup. No URL is printed until announce succeeds.
		defer func() {
			cleanup, done := context.WithTimeout(context.Background(), 4*time.Second)
			defer done()
			_ = retryControl(cleanup, func(c context.Context) error {
				return control.UpdateRun(c, creds, pairing.RunUpdate{Operation: "end", RunID: runID})
			})
		}()
		err = retryControl(ctx, func(c context.Context) error {
			return control.UpdateRun(c, creds, pairing.RunUpdate{Operation: "start", RunID: runID, MachineName: cfg.MachineName, WorkspaceLabel: filepath.Base(workspace)})
		})
		if err != nil {
			return errors.New("could not register agent run; check your connection and pairing")
		}
	}
	err = server.Run(ctx, func(info agent.Info) error {
		if control != nil {
			if err := retryControl(ctx, func(c context.Context) error {
				return control.UpdateRun(c, creds, pairing.RunUpdate{Operation: "announce", RunID: runID, Address: info.Address, Port: info.Port, DERPMapURL: opts.DERPMapURL})
			}); err != nil {
				return errors.New("could not announce agent listener; no browser session was opened")
			}
			heartbeatStarted = true
			go func() {
				err := heartbeatRun(ctx, 10*time.Second, func(c context.Context) error {
					return control.UpdateRun(c, creds, pairing.RunUpdate{Operation: "heartbeat", RunID: runID})
				})
				heartbeatDone <- err
				if err != nil {
					cancel()
				}
			}()
			browserURL := control.Origin + "/s/" + runID
			if cmd.Bool("json") && !devToken {
				return json.NewEncoder(os.Stdout).Encode(struct {
					Version   int    `json:"version"`
					SessionID string `json:"sessionId"`
					URL       string `json:"url"`
				}{protocol.Version, runID, browserURL})
			}
			if !devToken {
				_, err := fmt.Fprintf(os.Stdout, "WebSSH · %s\nWorkspace: %s\n\nOpen in your browser:\n%s\n\nKeep this command running · Ctrl+C to stop\n", cfg.MachineName, info.Workspace, browserURL)
				return err
			}
		}
		if cmd.Bool("json") {
			return json.NewEncoder(os.Stdout).Encode(info)
		}
		_, err := fmt.Fprintf(os.Stdout, "WebSSH · %s\nWorkspace: %s\n\nAddress: %s\nPort: %d\nToken: %s\n\nDevelopment token · Ctrl+C to stop\n", cfg.MachineName, info.Workspace, info.Address, info.Port, info.Token)
		return err
	})
	cancel()
	if heartbeatStarted {
		if heartbeatErr := <-heartbeatDone; heartbeatErr != nil && err == nil {
			err = heartbeatErr
		}
	}
	if control != nil && err != nil {
		return errors.New("workspace agent stopped; check your connection and pairing, then run serve again")
	}
	return err
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
