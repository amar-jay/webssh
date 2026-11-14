# Remote CLI and agent

The Go CLI and remote agent will live here, using Tailcat’s Go library for connectivity. The initial command is expected to be `webssh serve`.

The agent will manage remote PTYs and shell processes, handle terminal input/output and resizing, and support reconnecting to tmux sessions. We will first investigate reusing Tailcat’s existing SSH and PTY support.

When implementation begins, the Go module will live in this directory, with the executable under `cmd/webssh/` and private implementation packages under `internal/`.

This directory is a placeholder; the Go module has not been initialized yet.
