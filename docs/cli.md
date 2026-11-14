# CLI structure

The Go module lives in `apps/cli`. Commands and the remote agent share configuration, but the agent does not depend on the configuration UI.

```text
cmd/webssh/          Process entry point and exit status
internal/command/   Argument parsing and application wiring
internal/config/    Settings, defaults, validation, TOML persistence
internal/prompt/config/ Inline Bubble Tea questionnaire
internal/agent/     Reserved boundary for the headless remote agent
```

Run from `apps/cli`:

```sh
go run ./cmd/webssh help
go run ./cmd/webssh config
go run ./cmd/webssh config --path /tmp/webssh-config.toml
go test ./...
```

`webssh config` asks for the machine name and shell executable one question at a time using Bubble Tea v2 and Bubbles text inputs, inline in the current shell. Enter accepts each prefilled answer; Shift+Tab goes back. A final `[y/N]` prompt saves only on `y`; Enter or `n` cancels. Esc or Ctrl+C cancels at any question. Save errors stay at confirmation so they can be retried. The prompt does not use the alternate screen, and leaves the answer transcript visible.

By default the TOML file is stored at `~/.webssh/config.toml`, using `os.UserHomeDir()`. A missing file uses the hostname and `$SHELL` (falling back to `/bin/sh`) without writing anything. Saving validates the settings and atomically replaces the file using a temporary file with mode 0600. Unknown fields, malformed TOML, and unsupported schema versions are rejected rather than silently overwritten.

Configuration is versioned with `version = 1`. The shell field is an executable name/path, not a shell command; no process is launched by the questionnaire. The stored values will be consumed when the remote agent is implemented.

`webssh serve` currently returns an explicit not-implemented error. The agent package contains only its responsibility boundary. Future PTY, shell/tmux lifecycle, and Tailcat transport code belong behind that boundary, independently of Bubble Tea. Configuration should not store networking credentials until their lifecycle and storage are designed.
