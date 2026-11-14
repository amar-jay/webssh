# Remote CLI and agent

The Go CLI and remote agent will live here, using Tailcat’s Go library for connectivity. The initial command is expected to be `webssh serve`.

The agent will manage remote PTYs and shell processes, handle terminal input/output and resizing, and support reconnecting to tmux sessions. We will first investigate reusing Tailcat’s existing SSH and PTY support.

The Go module `github.com/amar-jay/webssh/apps/cli` lives in this directory, with Tailcat v0.7.0 installed. The executable lives under `cmd/webssh/`, with separate command, configuration, configuration prompt, and future agent packages under `internal/`.

The CLI provides `webssh config`, an inline Bubble Tea v2 questionnaire for machine-name and shell settings. The remote agent is not implemented yet. See [CLI development notes](../../docs/cli.md) for commands, storage behavior, and package boundaries.
