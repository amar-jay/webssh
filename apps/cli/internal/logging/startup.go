package logging

import (
	"context"
	"log/slog"
	"sync"
)

type startupRecord struct {
	record  slog.Record
	handler slog.Handler
}
type startupState struct {
	mu      sync.Mutex
	ready   bool
	pending []startupRecord
}
type startupHandler struct {
	base  slog.Handler
	state *startupState
}

// BufferStartup defers startup diagnostics until the command has printed its
// result. Errors flush immediately. Original timestamps/attributes are kept;
// at most 32 records are retained, and derived loggers share the same gate.
func BufferStartup(logger *slog.Logger) (*slog.Logger, func()) {
	state := &startupState{}
	return slog.New(&startupHandler{base: logger.Handler(), state: state}), func() { state.mu.Lock(); defer state.mu.Unlock(); state.flush(context.Background()) }
}

func (s *startupState) flush(ctx context.Context) {
	s.ready = true
	for _, record := range s.pending {
		_ = record.handler.Handle(ctx, record.record)
	}
	s.pending = nil
}

func (h *startupHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.base.Enabled(ctx, level)
}

func (h *startupHandler) Handle(ctx context.Context, record slog.Record) error {
	h.state.mu.Lock()
	defer h.state.mu.Unlock()
	if !h.state.ready && record.Level < slog.LevelError {
		if len(h.state.pending) == 32 {
			h.state.pending = h.state.pending[1:]
		}
		h.state.pending = append(h.state.pending, startupRecord{record.Clone(), h.base})
		return nil
	}
	if !h.state.ready {
		h.state.flush(ctx)
	}
	return h.base.Handle(ctx, record)
}

func (h *startupHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &startupHandler{base: h.base.WithAttrs(attrs), state: h.state}
}

func (h *startupHandler) WithGroup(name string) slog.Handler {
	return &startupHandler{base: h.base.WithGroup(name), state: h.state}
}
