package logging

import (
	"io"
	"regexp"
)

// Color only the standard handler's timestamp and severity prefix. Values have
// already been quoted and redacted by slog before reaching this writer.
type colorWriter struct{ output io.Writer }

var textPrefix = regexp.MustCompile(`^(time=[^ ]+ )?(level=(DEBUG|INFO|WARN|ERROR))`)

func (w colorWriter) Write(p []byte) (int, error) {
	match := textPrefix.FindSubmatch(p)
	if match == nil {
		return w.output.Write(p)
	}
	colors := map[string]string{"DEBUG": "\x1b[38;2;192;153;255m", "INFO": "\x1b[38;2;130;170;255m", "WARN": "\x1b[38;2;255;199;119m", "ERROR": "\x1b[38;2;255;117;127m"}
	var line []byte
	if len(match[1]) > 0 {
		line = append(line, "\x1b[38;2;130;139;184m"...)
		line = append(line, match[1]...)
		line = append(line, "\x1b[0m"...)
	}
	line = append(line, colors[string(match[3])]...)
	line = append(line, match[2]...)
	line = append(line, "\x1b[0m"...)
	line = append(line, p[len(match[0]):]...)
	n, err := w.output.Write(line)
	if err != nil {
		return 0, err
	}
	if n != len(line) {
		return 0, io.ErrShortWrite
	}
	return len(p), nil
}
