package command

import (
	"context"
	"fmt"
	"github.com/amar-jay/webssh/apps/cli/internal/credentials"
	"github.com/amar-jay/webssh/apps/cli/internal/pairing"
)

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
