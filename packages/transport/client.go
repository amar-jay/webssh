// Package transport owns WebSSH's Tailcat client and stream lifetimes.
// It contains no terminal protocol or user authorization policy.
package transport

import (
	"context"
	"errors"
	"net"
	"sync"

	"github.com/tailscale/tailcat"
	"tailscale.com/types/key"
	"tailscale.com/types/logger"
)

const MaxChunkSize = 64 << 10

var ErrClosed = errors.New("transport is closed")

type Options struct {
	Address        string
	NodePrivateKey string // Optional privkey:... identity; never log this value.
	DERPMapURL     string
}

type dialer interface {
	DialTCPPort(context.Context, uint16) (net.Conn, error)
	PublicKey() key.NodePublic
	Close() error
}

type Client struct {
	backend dialer
	ctx     context.Context
	cancel  context.CancelFunc
	mu      sync.Mutex
	closed  bool
	streams map[*Stream]struct{}
}

func NewClient(opts Options) (*Client, error) {
	if _, err := tailcat.ParseAddr(tailcat.Addr(opts.Address)); err != nil {
		return nil, errors.New("invalid Tailcat address")
	}
	backend := &tailcat.Client{Server: tailcat.Addr(opts.Address), DERPMapURL: opts.DERPMapURL, Logf: logger.Discard}
	if opts.NodePrivateKey != "" {
		if err := backend.Key.UnmarshalText([]byte(opts.NodePrivateKey)); err != nil {
			return nil, errors.New("invalid node private key")
		}
		if backend.Key.IsZero() {
			return nil, errors.New("node private key must not be zero")
		}
	}
	return newClient(backend), nil
}

func newClient(backend dialer) *Client {
	ctx, cancel := context.WithCancel(context.Background())
	return &Client{backend: backend, ctx: ctx, cancel: cancel, streams: make(map[*Stream]struct{})}
}

func (c *Client) PublicKey() string { return c.backend.PublicKey().String() }

func (c *Client) Dial(ctx context.Context, port int) (*Stream, error) {
	if port < 1 || port > 65535 {
		return nil, errors.New("port must be an integer between 1 and 65535")
	}
	ctx, cancel := context.WithCancel(ctx)
	stop := context.AfterFunc(c.ctx, cancel)
	defer stop()
	defer cancel()
	if c.ctx.Err() != nil {
		return nil, ErrClosed
	}
	conn, err := c.backend.DialTCPPort(ctx, uint16(port))
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed || ctx.Err() != nil {
		conn.Close()
		if c.closed {
			return nil, ErrClosed
		}
		return nil, ctx.Err()
	}
	stream := NewStream(conn, c)
	c.streams[stream] = struct{}{}
	return stream, nil
}

func (c *Client) Close() error {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil
	}
	c.closed = true
	c.cancel()
	streams := make([]*Stream, 0, len(c.streams))
	for stream := range c.streams {
		streams = append(streams, stream)
	}
	c.mu.Unlock()
	for _, stream := range streams {
		stream.Close()
	}
	return c.backend.Close()
}
