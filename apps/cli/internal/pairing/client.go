// Package pairing talks to the WebSSH control plane during device pairing.
package pairing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/amar-jay/webssh/apps/cli/internal/credentials"
)

type Client struct {
	Origin string
	HTTP   *http.Client
}

type StartResult struct {
	AttemptID string `json:"attemptId"`
	Code      string `json:"code"`
	CLISecret string `json:"cliSecret"`
	ExpiresAt int64  `json:"expiresAt"`
	URL       string `json:"url"`
}

type pollResult struct {
	Status      string `json:"status"`
	Error       string `json:"error"`
	AgentID     string `json:"agentId"`
	AgentToken  string `json:"agentToken"`
	GrantKey    string `json:"grantKey"`
	MachineName string `json:"machineName"`
	OwnerID     string `json:"ownerId"`
}

func NewClient(origin string) (*Client, error) {
	origin = strings.TrimRight(strings.TrimSpace(origin), "/")
	parsed, err := url.Parse(origin)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" || parsed.Path != "" {
		return nil, errors.New("origin must be an http(s) origin with no path (example: https://webssh.example)")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("invalid origin")
	}
	if parsed.Scheme == "http" && parsed.Hostname() != "localhost" {
		ip := net.ParseIP(parsed.Hostname())
		if ip == nil || !ip.IsLoopback() {
			return nil, errors.New("HTTPS is required outside loopback")
		}
	}
	return &Client{
		Origin: origin,
		HTTP:   &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("pairing redirects are not allowed") }},
	}, nil
}

func (c *Client) Start(ctx context.Context, machineName string) (StartResult, error) {
	var out StartResult
	if err := c.post(ctx, "/api/pairing/start", map[string]string{"machineName": machineName}, &out); err != nil {
		return StartResult{}, err
	}
	if out.Code == "" || out.CLISecret == "" || out.URL == "" {
		return StartResult{}, errors.New("pairing start returned an incomplete response")
	}
	return out, nil
}

func (c *Client) Poll(ctx context.Context, code, cliSecret string) (credentials.File, string, error) {
	var out pollResult
	if err := c.post(ctx, "/api/pairing/poll", map[string]string{"code": code, "cliSecret": cliSecret}, &out); err != nil {
		return credentials.File{}, "", err
	}
	switch out.Status {
	case "completed":
		file := credentials.File{
			Version:     1,
			Origin:      c.Origin,
			AgentID:     out.AgentID,
			AgentToken:  out.AgentToken,
			GrantKey:    out.GrantKey,
			OwnerID:     out.OwnerID,
			MachineName: out.MachineName,
		}
		if err := file.Validate(); err != nil {
			return credentials.File{}, "", err
		}
		return file, "completed", nil
	case "pending", "claimed", "expired":
		return credentials.File{}, out.Status, nil
	default:
		if out.Error != "" {
			return credentials.File{}, "", errors.New(out.Error)
		}
		return credentials.File{}, "", fmt.Errorf("unexpected pairing status %q", out.Status)
	}
}

func (c *Client) Wait(ctx context.Context, code, cliSecret string) (credentials.File, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		file, status, err := c.Poll(ctx, code, cliSecret)
		if err != nil {
			return credentials.File{}, err
		}
		if status == "completed" {
			return file, nil
		}
		if status == "expired" {
			return credentials.File{}, errors.New("pairing code expired")
		}
		select {
		case <-ctx.Done():
			return credentials.File{}, ctx.Err()
		case <-ticker.C:
		}
	}
}

func (c *Client) post(ctx context.Context, path string, body any, dest any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Origin+path, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("accept", "application/json")
	req.Header.Set("user-agent", "webssh-cli")
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil {
		return err
	}
	if res.StatusCode >= 400 {
		var errBody struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(data, &errBody)
		if errBody.Error != "" {
			return fmt.Errorf("%s", errBody.Error)
		}
		return fmt.Errorf("pairing request failed (%d)", res.StatusCode)
	}
	if err := json.Unmarshal(data, dest); err != nil {
		return fmt.Errorf("decode pairing response: %w", err)
	}
	return nil
}

func (c *Client) AgentSession(ctx context.Context, creds credentials.File, sessionID, nonce string) (string, error) {
	var out struct {
		SessionID string `json:"sessionId"`
	}
	err := c.post(ctx, "/api/agent/session", map[string]string{"ownerId": creds.OwnerID, "agentId": creds.AgentID, "agentToken": creds.AgentToken, "sessionId": sessionID, "nonce": nonce}, &out)
	return out.SessionID, err
}

func (c *Client) Credential(ctx context.Context, creds credentials.File, operation string) (string, error) {
	var out struct {
		AgentToken string `json:"agentToken"`
	}
	err := c.post(ctx, "/api/agent/session", map[string]string{"ownerId": creds.OwnerID, "agentId": creds.AgentID, "agentToken": creds.AgentToken, "operation": operation}, &out)
	return out.AgentToken, err
}

func (c *Client) Rotate(ctx context.Context, creds credentials.File, next, operationID string) error {
	var out struct {
		OK bool `json:"ok"`
	}
	return c.post(ctx, "/api/agent/session", map[string]string{"ownerId": creds.OwnerID, "agentId": creds.AgentID, "agentToken": creds.AgentToken, "operation": "renew", "replacementToken": next, "operationId": operationID}, &out)
}
