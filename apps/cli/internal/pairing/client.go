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
	"regexp"
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
		return credentials.File{}, "", errors.New("unexpected pairing status")
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
		if regexp.MustCompile(`^[a-z_]{1,64}$`).MatchString(errBody.Error) {
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

// RunUpdate publishes only the listener descriptor, never the agent's grant key.
type RunUpdate struct {
	Backend        string   `json:"backend,omitempty"`
	Generation     string   `json:"generation,omitempty"`
	RecoveredIDs   []string `json:"recoveredIds,omitempty"`
	EndedIDs       []string `json:"endedIds,omitempty"`
	TerminatedIDs  []string `json:"terminatedIds,omitempty"`
	Operation      string   `json:"operation"`
	RunID          string   `json:"runId"`
	MachineName    string   `json:"machineName,omitempty"`
	WorkspaceLabel string   `json:"workspaceLabel,omitempty"`
	Address        string   `json:"address,omitempty"`
	Port           int      `json:"port,omitempty"`
	DERPMapURL     string   `json:"derpMapURL,omitempty"`
}

type RunResult struct {
	SessionID    string   `json:"sessionId"`
	TerminateIDs []string `json:"terminateIds"`
}

func (c *Client) UpdateRun(ctx context.Context, creds credentials.File, update RunUpdate) error {
	_, err := c.SyncRun(ctx, creds, update)
	return err
}
func (c *Client) SyncRun(ctx context.Context, creds credentials.File, update RunUpdate) (RunResult, error) {
	var out RunResult
	err := c.post(ctx, "/api/agent/run", struct {
		RunUpdate
		OwnerID    string `json:"ownerId"`
		AgentID    string `json:"agentId"`
		AgentToken string `json:"agentToken"`
	}{update, creds.OwnerID, creds.AgentID, creds.AgentToken}, &out)
	return out, err
}

func (c *Client) RunAccess(ctx context.Context, creds credentials.File, runID, sessionID, nonce string, generation ...string) error {
	var incarnation string
	if len(generation) > 0 {
		incarnation = generation[0]
	}
	var out struct {
		SessionID string `json:"sessionId"`
	}
	return c.post(ctx, "/api/agent/session", map[string]string{"ownerId": creds.OwnerID, "agentId": creds.AgentID, "agentToken": creds.AgentToken, "runId": runID, "sessionId": sessionID, "nonce": nonce, "generation": incarnation}, &out)
}

// Attach approvals authorize one native connection; they are not agent credentials.
type AttachStart struct {
	Code      string `json:"code"`
	CLISecret string `json:"cliSecret"`
	ExpiresAt int64  `json:"expiresAt"`
	URL       string `json:"url"`
}
type AttachDescriptor struct {
	Status     string `json:"status"`
	SessionID  string `json:"terminalSessionId"`
	Address    string `json:"address"`
	Port       int    `json:"port"`
	Grant      string `json:"grant"`
	Backend    string `json:"backend"`
	DERPMapURL string `json:"derpMapURL"`
}

func (c *Client) StartAttach(ctx context.Context, sessionID string) (AttachStart, error) {
	var out AttachStart
	if err := c.post(ctx, "/api/cli/attach/start", map[string]string{"sessionId": sessionID}, &out); err != nil {
		return out, errors.New("could not request CLI access; check the service and try again")
	}
	expected := c.Origin + "/attach?code=" + out.Code
	if !regexp.MustCompile(`^[A-Z0-9]{8}$`).MatchString(out.Code) || !regexp.MustCompile(`^[A-Za-z0-9_-]{32}$`).MatchString(out.CLISecret) || out.URL != expected {
		return AttachStart{}, errors.New("invalid CLI approval response")
	}
	return out, nil
}
func (c *Client) WaitAttach(ctx context.Context, attempt AttachStart, sessionID string) (AttachDescriptor, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		var result AttachDescriptor
		if err := c.post(ctx, "/api/cli/attach/poll", map[string]string{"code": attempt.Code, "cliSecret": attempt.CLISecret}, &result); err != nil {
			if err.Error() == "session_busy" {
				return result, errors.New("another controller is attached; detach it before retrying")
			}
			return result, errors.New("CLI approval failed; check session availability and request a fresh link")
		}
		if result.Status == "approved" {
			if result.SessionID != sessionID || !strings.HasPrefix(result.Address, "tc") || !strings.HasPrefix(result.Grant, "v1.") || result.Port < 1 || result.Port > 65535 || (result.Backend != "tmux" && result.Backend != "ephemeral") {
				return AttachDescriptor{}, errors.New("invalid session descriptor")
			}
			if result.DERPMapURL != "" {
				u, e := url.Parse(result.DERPMapURL)
				if e != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
					return AttachDescriptor{}, errors.New("invalid relay map")
				}
			}
			return result, nil
		}
		if result.Status != "pending" {
			return result, errors.New("CLI approval expired; run attach again")
		}
		select {
		case <-ctx.Done():
			return result, errors.New("CLI approval cancelled or expired")
		case <-ticker.C:
		}
	}
}
