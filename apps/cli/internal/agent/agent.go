package agent

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/amar-jay/webssh/packages/protocol"
	"github.com/tailscale/tailcat"
	"tailscale.com/tailcfg"
	"tailscale.com/types/logger"
)

type Options struct {
	Workspace      string
	Shell          string
	Token          string // Empty generates a new per-run capability; never log requests.
	Port           int    // Zero selects the protocol's default virtual port.
	MaxConnections int    // Includes connections still authenticating; defaults to 8.
	DERPMapURL     string
	Region         *tailcfg.DERPRegion // Optional explicit relay, useful for local integration.
}

type Info struct {
	Version   int    `json:"version"`
	Address   string `json:"address"`
	Port      int    `json:"port"`
	Token     string `json:"token"`
	Workspace string `json:"workspace"`
}

type Agent struct{ opts Options }

func New(opts Options) (*Agent, error) {
	if !supportedPTY {
		return nil, errors.New("terminal agent is supported on Linux and macOS")
	}
	workspace, err := filepath.Abs(opts.Workspace)
	if err != nil {
		return nil, fmt.Errorf("resolve workspace: %w", err)
	}
	if opts.Workspace == "" {
		return nil, errors.New("workspace is required")
	}
	info, err := os.Stat(workspace)
	if err != nil {
		return nil, fmt.Errorf("open workspace: %w", err)
	}
	if !info.IsDir() {
		return nil, errors.New("workspace must be a directory")
	}
	opts.Workspace = workspace
	shell, err := exec.LookPath(opts.Shell)
	if err != nil {
		return nil, errors.New("configured shell executable was not found")
	}
	opts.Shell, err = filepath.Abs(shell)
	if err != nil {
		return nil, err
	}
	if opts.Token == "" {
		var secret [32]byte
		if _, err := rand.Read(secret[:]); err != nil {
			return nil, err
		}
		opts.Token = base64.RawURLEncoding.EncodeToString(secret[:])
	}
	if len(opts.Token) < 32 || len(opts.Token) > 128 {
		return nil, errors.New("access token must contain 32 to 128 bytes")
	}
	if opts.Port == 0 {
		opts.Port = protocol.DefaultPort
	}
	if opts.Port < 1 || opts.Port > 65535 {
		return nil, errors.New("invalid virtual TCP port")
	}
	if opts.MaxConnections == 0 {
		opts.MaxConnections = 8
	}
	if opts.MaxConnections < 1 || opts.MaxConnections > 128 {
		return nil, errors.New("max connections must be between 1 and 128")
	}
	return &Agent{opts: opts}, nil
}

// Run creates an ephemeral encrypted listener. ready receives credentials once
// listening; the caller decides how to deliver them to an authorized browser.
func (a *Agent) Run(ctx context.Context, ready func(Info) error) error {
	server := &tailcat.Server{Logf: logger.Discard, DERPMapURL: a.opts.DERPMapURL, Region: a.opts.Region}
	defer server.Close()
	startup, cancel := context.WithTimeout(ctx, 30*time.Second)
	listener, err := server.Listen(startup, "tcp", fmt.Sprintf(":%d", a.opts.Port))
	cancel()
	if err != nil {
		if ctx.Err() != nil {
			return nil
		}
		return fmt.Errorf("start Tailcat listener: %w", err)
	}
	defer listener.Close()
	if ready != nil {
		if err := ready(Info{Version: protocol.Version, Address: string(server.TailcatAddr()), Port: a.opts.Port, Token: a.opts.Token, Workspace: a.opts.Workspace}); err != nil {
			return err
		}
	}
	return a.Serve(ctx, listener)
}

// Serve owns listener and all accepted connections, and waits for session cleanup
// on return. It is independent of relay setup so lifecycle tests can be local.
func (a *Agent) Serve(ctx context.Context, listener net.Listener) error {
	defer listener.Close()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	stop := context.AfterFunc(ctx, func() { listener.Close() })
	defer stop()
	var sessions sync.WaitGroup
	defer sessions.Wait()
	slots := make(chan struct{}, a.opts.MaxConnections)
	for {
		conn, err := listener.Accept()
		if err != nil {
			cancelled := ctx.Err() != nil
			cancel()
			if cancelled {
				return nil
			}
			return fmt.Errorf("accept terminal connection: %w", err)
		}
		select {
		case slots <- struct{}{}:
			sessions.Add(1)
			go func() {
				defer sessions.Done()
				defer func() { <-slots }()
				defer conn.Close()
				stop := context.AfterFunc(ctx, func() { conn.Close() })
				defer stop()
				a.handle(conn)
			}()
		default:
			conn.Close()
		}
	}
}
