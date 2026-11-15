package command

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/amar-jay/webssh/apps/cli/internal/config"
	"github.com/amar-jay/webssh/apps/cli/internal/credentials"
	"github.com/amar-jay/webssh/apps/cli/internal/pairing"
)

func managerScope(creds credentials.File, cfg config.Config, workspace string) string {
	return fmt.Sprintf("%s\n%s\n%s\n%s\n%s", creds.Origin, creds.OwnerID, creds.AgentID, workspace, cfg.Shell)
}

func persistenceMessage(backend string) string {
	if backend == "tmux" {
		return "Ctrl+C stops the agent and detaches clients; tmux work stays running. Terminate sessions from the dashboard or with webssh sessions after stopping serve."
	}
	return "Ephemeral backend: disconnect or Ctrl+C ends its shells."
}

// Each operation has three attempts and a three-second budget per attempt.
// A missed heartbeat never reports shell termination to the control plane.
func retryControl(ctx context.Context, operation func(context.Context) error) error {
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if attempt > 0 {
			timer := time.NewTimer(time.Duration(attempt) * 500 * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
		}
		request, cancel := context.WithTimeout(ctx, 3*time.Second)
		err = operation(request)
		cancel()
		if err == nil {
			return nil
		}
		// Permanent authorization/state failures must not be retried.
		if err.Error() == "resource_limit" || err.Error() == "unauthorized" || err.Error() == "session_unavailable" {
			return err
		}
	}
	return err
}

func heartbeatRun(ctx context.Context, interval time.Duration, heartbeat func(context.Context) error) error {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			if err := retryControl(ctx, heartbeat); err != nil {
				if ctx.Err() != nil {
					return nil
				}
				return errors.New("agent heartbeat failed; connection stopped, run serve again")
			}
		}
	}
}

func finishCredentialRecovery(ctx context.Context, path string, r credentials.Recovery) error {
	if r.Mode == "renew" {
		control, err := pairing.NewClient(r.Previous.Origin)
		if err != nil {
			return err
		}
		if err = control.Rotate(ctx, r.Previous, r.Next.AgentToken, r.OperationID); err != nil {
			return fmt.Errorf("renewal pending; rerun pair to recover: %w", err)
		}
	}
	// For replacement the new local credential must be durable before revoking
	// the old remote pairing. A journal retains both across any partial failure.
	if err := credentials.Save(path, r.Next); err != nil {
		return fmt.Errorf("credentials retained in recovery journal; rerun pair: %w", err)
	}
	if r.Mode == "replace" && r.Previous.AgentID != "" {
		control, err := pairing.NewClient(r.Previous.Origin)
		if err != nil {
			return err
		}
		if _, err = control.Credential(ctx, r.Previous, "revoke"); err != nil && err.Error() != "unauthorized" {
			return fmt.Errorf("previous pairing revocation pending; rerun pair: %w", err)
		}
	}
	return credentials.FinishRecovery(path)
}
