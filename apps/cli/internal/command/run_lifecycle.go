package command

import (
	"context"
	"errors"
	"time"
)

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
