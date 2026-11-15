//go:build !linux && !darwin

package agent

import (
	"context"
	"errors"
)

type PruneResult struct{ Directory, Status string }

func sessionGate(string, bool) (func(), error) {
	return nil, errors.New("tmux sessions require Linux or macOS")
}

func PruneSessions(context.Context, string, bool) ([]PruneResult, error) {
	return nil, errors.New("tmux sessions require Linux or macOS")
}
