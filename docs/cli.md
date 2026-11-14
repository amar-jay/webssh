# CLI structure

The Go module lives in `apps/cli`. Commands and the remote agent share configuration, but the agent does not depend on the configuration UI.

```text
cmd/webssh/          Process entry point and exit status
internal/command/   urfave/cli v3 commands, flags, and application wiring
internal/config/    Settings, defaults, validation, TOML persistence
internal/prompt/config/ Inline Bubble Tea questionnaire
internal/agent/     Tailcat listener, grant/dev-token authentication, PTY and process lifecycle
internal/credentials/ Paired agent secrets (`~/.webssh/credentials.toml`, mode 0600)
internal/pairing/   Control-plane HTTP client for device pairing
```

Run from `apps/cli`:

```sh
go run ./cmd/webssh --help
go run ./cmd/webssh config
go run ./cmd/webssh pair --origin https://webssh-web.abdelmanan-abdelrahman03.workers.dev
go run ./cmd/webssh serve .
go run ./cmd/webssh config --path /tmp/webssh-config.toml
GOMAXPROCS=2 go test -p 1 ./...
```

If a valid configuration file already exists, `webssh config` first asks **Use existing configuration? [Y/n]**. `y` or Enter uses it unchanged; `n` starts setup again; Esc cancels. The questionnaire restarts from defaults and only replaces the file after the final save confirmation; cancelling preserves the existing file.

`webssh config` asks for the machine name and shell executable one question at a time using Bubble Tea v2 and Bubbles text inputs, inline in the current shell. Enter accepts each prefilled answer; Shift+Tab goes back. A final `[y/N]` prompt saves only on `y`; Enter or `n` cancels. Esc or Ctrl+C cancels at any question. Save errors stay at confirmation so they can be retried. The prompt does not use the alternate screen, and leaves the answer transcript visible.

By default the TOML file is stored at `~/.webssh/config.toml`, using `os.UserHomeDir()`. A missing file uses the hostname and `$SHELL` (falling back to `/bin/sh`) without writing anything. Saving validates the settings and atomically replaces the file using a temporary file with mode 0600. Unknown fields, malformed TOML, and unsupported schema versions are rejected rather than silently overwritten.

Configuration is versioned with `version = 1`. The shell field is an executable name/path, not a shell command; no process is launched by the questionnaire. The agent uses the configured shell executable.

`webssh pair --origin URL` starts a short-lived pairing attempt, prints a code and approval URL, and waits until the authenticated browser approves. The CLI then writes `~/.webssh/credentials.toml` (mode 0600). Existing credentials require `--replace`. Set the origin with `--origin` or `WEBSSH_ORIGIN`.

`webssh serve <path>` starts the agent in an existing workspace directory. It loads configuration without prompting. If paired credentials exist, attach uses short-lived HMAC grants verified with the stored `grant_key`; the per-run application token is not used. Without credentials, it refuses to start unless `--dev-token` is explicit. `--dev-token` also mints that development token for `/dev/connect` even when paired. `--json` emits one connection record; flags must precede the path. `--config`, `--credentials`, `--port`, `--derpmap-url`, and `--max-connections` customize startup. Ctrl+C or SIGTERM stops the agent and its sessions.

The initial agent supports Linux/macOS. Each authenticated connection starts one interactive PTY shell in the workspace, forwards bytes and resize events, and reports exit status. Disconnect/detach kills the shell and foreground job groups and reaps the shell. Deliberately daemonized processes are outside this cleanup guarantee. The workspace is an initial directory, not a sandbox. Tmux persistence and printing a browser session URL remain milestone 3.

See [agent protocol](agent-protocol.md) for framing, credentials, lifecycle, and limits. Use `GOMAXPROCS=2 go test -p 1 ./...` for bounded local checks.

Paired mode now requires online run registration and session-scoped grants. Local testing must explicitly pass `--dev-token`. Use `pair --renew` to rotate a paired token; restart running agents afterward. See [identity and pairing](identity-pairing.md) for revocation timing and recovery.
