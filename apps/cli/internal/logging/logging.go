// Package logging configures CLI diagnostics without owning command output.
package logging

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"regexp"
	"strings"

	"golang.org/x/term"
)

type contextKey struct{}

func WithLogger(ctx context.Context, logger *slog.Logger) context.Context {
	return context.WithValue(ctx, contextKey{}, logger)
}
func From(ctx context.Context) *slog.Logger {
	if logger, ok := ctx.Value(contextKey{}).(*slog.Logger); ok {
		return logger
	}
	// Commands called directly (rather than through the CLI root) remain usable.
	logger, _ := New(os.Stderr, "auto", "info")
	return logger
}

// FromEnvironment reads optional diagnostic settings without adding CLI flags.
func FromEnvironment(output io.Writer) (*slog.Logger, error) {
	format := strings.ToLower(strings.TrimSpace(os.Getenv("LOG_FORMAT")))
	level := strings.ToLower(strings.TrimSpace(os.Getenv("LOG_LEVEL")))
	if format == "" {
		format = "auto"
	}
	if level == "" {
		level = "info"
	}
	return New(output, format, level)
}

func New(output io.Writer, format, level string) (*slog.Logger, error) {
	var minimum slog.Level
	switch level {
	case "debug":
		minimum = slog.LevelDebug
	case "info":
		minimum = slog.LevelInfo
	case "warn":
		minimum = slog.LevelWarn
	case "error":
		minimum = slog.LevelError
	default:
		return nil, errors.New("log level must be debug, info, warn, or error")
	}
	if output == nil {
		output = os.Stderr
	}
	if format == "auto" {
		format = "json"
		if file, ok := output.(interface{ Fd() uintptr }); ok && term.IsTerminal(int(file.Fd())) {
			format = "text"
		}
	}
	opts := &slog.HandlerOptions{Level: minimum, ReplaceAttr: replaceAttr}
	var handler slog.Handler
	switch format {
	case "text":
		handler = slog.NewTextHandler(output, opts)
	case "json":
		handler = slog.NewJSONHandler(output, opts)
	default:
		return nil, errors.New("log format must be auto, text, or json")
	}
	return slog.New(handler).With("app", "webssh"), nil
}
func sensitive(key string) bool {
	key = strings.ToLower(strings.NewReplacer("_", "", "-", "").Replace(key))
	for _, name := range []string{"token", "secret", "password", "privatekey", "credential", "grant", "cookie", "authorization"} {
		if strings.Contains(key, name) {
			return true
		}
	}
	switch key {
	case "address", "descriptor", "sessionid", "agentid", "ownerid", "machinename", "workspace", "path":
		return true
	}
	return false
}

var secretValue = regexp.MustCompile(`(?i)(token|secret|password|grant|authorization|cookie|private[_-]?key)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)`)
var opaqueValue = regexp.MustCompile(`\b(?:v1\.[A-Za-z0-9_.-]+|privkey:[a-fA-F0-9]+|nodekey:[a-fA-F0-9]+|tc[A-Za-z0-9_-]{20,})\b`)
var urlValue = regexp.MustCompile(`https?://[^\s"'<>]+`)

var pathValue = regexp.MustCompile(`(^|[\s("'])/[^\s"'<>]+`)

func clean(value string) string {
	value = secretValue.ReplaceAllString(value, "$1=[redacted]")
	value = opaqueValue.ReplaceAllString(value, "[redacted]")
	value = urlValue.ReplaceAllString(value, "[URL redacted]")
	return pathValue.ReplaceAllString(value, "$1[path redacted]")
}
func replaceAttr(groups []string, attr slog.Attr) slog.Attr {
	for _, group := range groups {
		if sensitive(group) {
			return slog.String(attr.Key, "[redacted]")
		}
	}
	if sensitive(attr.Key) {
		return slog.String(attr.Key, "[redacted]")
	}
	if attr.Key == slog.TimeKey && attr.Value.Kind() == slog.KindTime {
		return slog.Time(attr.Key, attr.Value.Time().UTC())
	}
	if attr.Value.Kind() == slog.KindString {
		attr.Value = slog.StringValue(clean(attr.Value.String()))
	}
	if err, ok := attr.Value.Any().(error); ok {
		attr.Value = slog.StringValue(clean(err.Error()))
	}
	return attr
}
