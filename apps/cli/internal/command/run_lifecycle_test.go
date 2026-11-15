package command

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestControlRetryIsBoundedAndCancelable(t *testing.T) {
	calls := 0
	err := retryControl(context.Background(), func(ctx context.Context) error {
		calls++
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > 3*time.Second {
			t.Fatal("missing request deadline")
		}
		return errors.New("temporary")
	})
	if err == nil || calls != 3 {
		t.Fatalf("got %d attempts and %v", calls, err)
	}
	calls = 0
	err = retryControl(context.Background(), func(context.Context) error { calls++; return errors.New("unauthorized") })
	if err == nil || calls != 1 {
		t.Fatal("authorization errors must not retry")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := retryControl(ctx, func(context.Context) error { t.Fatal("called after cancellation"); return nil }); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestHeartbeatStopsAfterBoundedFailures(t *testing.T) {
	calls := 0
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := heartbeatRun(ctx, time.Millisecond, func(context.Context) error { calls++; return errors.New("temporary") })
	if err == nil || calls != 3 {
		t.Fatalf("heartbeat got %d attempts and %v", calls, err)
	}
}
