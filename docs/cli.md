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
go run ./cmd/webssh pair
go run ./cmd/webssh serve .
go run ./cmd/webssh config --path /tmp/webssh-config.toml
GOMAXPROCS=2 go test -p 1 ./...
```

If a valid configuration file already exists, `webssh config` first asks **Use existing configuration? [Y/n]**. `y` or Enter uses it unchanged; `n` starts setup again; Esc cancels. The questionnaire restarts from defaults and only replaces the file after the final save confirmation; cancelling preserves the existing file.

`webssh config` asks for the machine name, shell executable, log level, log format, and tmux configuration one question at a time using Bubble Tea v2 and Bubbles text inputs, inline in the current shell. Enter accepts each prefilled answer; Shift+Tab goes back. A final `[y/N]` prompt saves only on `y`; Enter or `n` cancels. Esc or Ctrl+C cancels at any question. Save errors stay at confirmation so they can be retried. The prompt does not use the alternate screen, and leaves the answer transcript visible.

By default the TOML file is stored at `~/.webssh/config.toml`, using `os.UserHomeDir()`. A missing file uses the hostname and `$SHELL` (falling back to `/bin/sh`) without writing anything. Saving validates the settings and atomically replaces the file using a temporary file with mode 0600. Unknown fields, malformed TOML, and unsupported schema versions are rejected rather than silently overwritten.

The tmux question is prefilled with the first available local config: `$XDG_CONFIG_HOME/tmux/tmux.conf`, `~/.config/tmux/tmux.conf`, then `~/.tmux.conf`. If none exists it offers `none`. Accept that path, provide another absolute or `~/` path, choose `default` for automatic discovery at startup, or `none` to ignore tmux configuration. Explicit files must exist before setup can continue. The chosen value is saved as `tmux_config`; setup never edits the tmux file or starts tmux. Existing explicit choices remain prefilled when passed to the questionnaire.

Configuration is versioned with `version = 1`. The shell field is an executable name/path, not a shell command; no process is launched by the questionnaire. The agent uses the configured shell executable. Logging is saved as `log_level` (`info` by default) and `log_format` (`auto` by default); files written before these fields existed keep working and use those defaults.

`webssh pair` starts a short-lived pairing attempt against the fixed production origin `https://ssh.amarjay.com`, prints a code and approval URL, and waits until the authenticated browser approves. The CLI then writes `~/.webssh/credentials.toml` (mode 0600). Existing credentials require `--replace`.

`webssh serve <path>` starts the agent in an existing workspace directory. It loads configuration without prompting. If paired credentials exist, attach uses short-lived HMAC grants verified with the stored `grant_key`; the per-run application token is not used. Without credentials, it refuses to start unless `--dev-token` is explicit. `--dev-token` also mints that development token for `/dev/connect` even when paired. `--json` emits the opaque session ID and browser URL in paired mode; with explicit `--dev-token`, it emits a development connection record; flags must precede the path. `--config`, `--credentials`, `--port`, `--derpmap-url`, and `--max-connections` customize startup. Ctrl+C or SIGTERM stops the agent and its sessions.

The agent supports Linux/macOS. Serve uses persistent tmux sessions by default; missing tmux produces setup instructions. Disconnect/detach closes only the client PTY while the tmux shell keeps running. Use --backend ephemeral explicitly for connection-scoped PTYs that die on disconnect. Deliberately daemonized processes are outside this cleanup guarantee. The workspace is an initial directory, not a sandbox. Paired startup registers the run, announces its listener, and prints a browser URL containing only an opaque session ID. Open that URL and sign in with the GitHub account used for pairing. The authenticated overview lists paired machines and sessions and lets you open or end a session. See [durable sessions](durable-sessions.md) for restart recovery, controller ownership, reconnect, and termination.

See [agent protocol](agent-protocol.md) for framing, credentials, lifecycle, and limits. Use `GOMAXPROCS=2 go test -p 1 ./...` for bounded local checks.

Paired mode now requires online run registration and session-scoped grants. Ephemeral local testing must explicitly pass `--backend ephemeral --dev-token`. Use `pair --renew` to rotate a paired token; restart running agents afterward. See [identity and pairing](identity-pairing.md) for revocation timing and recovery.

For availability, startup cleanup, connection deadlines, and the session lifecycle, see [CLI-to-browser flow](cli-browser-flow.md).

For owned tmux cleanup while serve is stopped, use `webssh sessions <path>`, `webssh sessions --terminate <id> <path>`, or `webssh sessions --terminate-all <path>`. See [access and lifecycle controls](access-lifecycle.md).

Versioned installation, updates, checksums and rollback are documented in [deployment and distribution](deployment.md).

## Native terminal client

Use a session URL printed by `serve`, or its opaque session ID:

```sh
webssh attach https://ssh.amarjay.com/s/SESSION_ID
webssh attach SESSION_ID
# Alias:
webssh ssh SESSION_ID
```

The source machine must keep `webssh serve` running. On the client machine, `attach` prints a short-lived approval link and matching code. Sign in to the owning GitHub account, verify the code, and approve CLI access. The approval is single-use, expires after five minutes, and delivers a fresh session grant directly to the CLI. No grants, cookies, or agent credentials need copying or saving locally. Signing out of the approving browser or revoking the machine cuts the native connection through the existing lease checks. This first version requires a fresh browser approval for each attachment; it does not provide a persistent CLI login.

The native client uses the same protocol and remote PTY as the browser, with raw local input, Unicode, Ctrl+C, window resize, heartbeat deadlines, and remote exit status. It requires an interactive Linux/macOS terminal. It can use Tailcat's native direct path where available; this is not an OpenSSH server or an `ssh user@host` endpoint.

Press **Ctrl-] then .** to detach; press **Ctrl-] twice** to send a literal Ctrl-]. Tmux work stays running after detach, terminal closure, or network loss; an explicitly ephemeral session ends on disconnect. Ending the remote shell or using the existing session termination controls terminates it. Another active controller is rejected without takeover. Network loss returns to the local shell, restores terminal settings, and never reconnects or replays uncertain input automatically. Native escape sequences are rendered by your local terminal emulator, whose clipboard and link policies apply.

Deploy state migration 6 before the updated web app, then distribute the updated CLI. Earlier releases do not contain `attach`.

## Diagnostics

CLI diagnostics use Go `log/slog` on stderr. `webssh config` saves `log_level` (`debug|info|warn|error`, default `info`) and `log_format` (`auto|text|json`, default `auto`: text for an interactive stderr terminal, JSON when redirected). Neither setting has a CLI flag or an environment variable, so the saved file is the only source; changes apply from the next command:

```toml
# ~/.webssh/config.toml
log_level = 'debug'
log_format = 'json'
```

```sh
webssh serve . 2>agent.log
```

Terminal text logs use Tokyo Night Moon colors for timestamps and severity. `NO_COLOR` disables colors; `TERM=dumb`, redirected output, and JSON output never contain ANSI styling. During `serve` startup, normal diagnostics appear after the workspace/browser URL output, retaining their original timestamps. Errors flush startup diagnostics immediately.

Prompts, pairing/approval links, session listings, and the `serve --json` result remain command output, separate from diagnostics. Native terminal input/output stays untouched; connection diagnostics are emitted outside raw-mode attachment. A remote process's exit status remains its exit status, with no extra error record for an otherwise silent remote exit.

Log records include timestamps, severity, application/component and fixed lifecycle event names. Connection open/close events use `debug`, access denials and connection limits use `warn`, and relay failure uses `error`. Common credential fields, private keys, grants, connection addresses, identifiers, URLs and absolute paths are redacted by the handler. Do not add command contents, terminal output, arbitrary configuration structs or raw upstream transport diagnostics to log records; Tailcat debug output remains disabled at every CLI log level. Logs are not written to disk unless you redirect stderr.
