# Remote CLI and agent

The Go CLI and remote agent will live here, using Tailcat’s Go library for connectivity. The initial command is expected to be `webssh serve`.

The agent will manage remote PTYs and shell processes, handle terminal input/output and resizing, and support reconnecting to tmux sessions. We will first investigate reusing Tailcat’s existing SSH and PTY support.

The Go module is `github.com/amar-jay/webssh/apps/cli` and includes Tailcat as a dependency. The executable will live under `cmd/webssh/` and private implementation packages under `internal/`.

The module is initialized; executable implementation is still to come.
