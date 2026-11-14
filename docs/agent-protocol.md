# Agent protocol v1

`internal/agent` owns an ephemeral Tailcat listener and connection-scoped PTY shells. `packages/protocol` contains the schema in `schema/terminal.proto`, generated Go/TypeScript protobuf codecs, length framing adapters, and shared binary fixtures. The browser route is not connected to the agent yet.

Run from the root:

```sh
GOMAXPROCS=2 go run -p 1 ./apps/cli/cmd/webssh serve --json .
```

The connection record contains `version`, `address`, `port`, `token`, and `workspace`. Address and token are credentials: deliver them privately. Neither is written into configuration. Each agent restart generates fresh credentials. The default virtual TCP port is 8022; it does not open host port 8022.

Frames are a four-byte unsigned big-endian protobuf payload byte length followed by a binary `webssh.protocol.v1.TerminalMessage`. Maximum frame size is 128 KiB; `data` is a native protobuf `bytes` field limited to 64 KiB. TCP reads may split or combine frames. Malformed/oversized frames are rejected. Protobuf unknown fields are tolerated for additive schema evolution; unknown message types are rejected by session validation. Type-specific validation enforces directions and session state.

The following JSON-like examples describe field values for readability; JSON is not sent on the wire.

| Direction | Message |
| --- | --- |
| Client first | `{"type":"attach","version":1,"token":"…","cols":80,"rows":24,"term":"xterm-256color"}` |
| Server after shell start | `{"type":"ready","version":1}` |
| Client input | `{"type":"input","data":"base64…"}` |
| Server output | `{"type":"output","data":"base64…"}` |
| Client resize | `{"type":"resize","cols":120,"rows":40}` |
| Client disconnect request | `{"type":"detach"}` |
| Server shell exit | `{"type":"exit","code":7}` (missing code means zero) |
| Server failure | `{"type":"error","error":"unauthorized"}` |

Authentication and initial dimensions are checked before any shell is launched. The token is compared with constant-time comparison. The terminal name defaults to xterm-256color and accepts at most 64 restricted printable characters. Dimensions must be 1–1000 columns and 1–500 rows. No client-chosen command, environment, shell, or workspace is accepted.

The handshake has a ten-second deadline. At most eight connections, including handshakes, are accepted by default. Server writes have ten-second deadlines and output flows directly from the PTY with bounded buffers. Quiet authenticated sessions have no read idle timeout. Normal exit drains PTY output before sending exit status; draining is bounded to one second when background processes retain the PTY. Signaled exits report code 128.

Shells run with the agent user's privileges and inherited environment, with TERM and WEBSSH set by the agent. This is not a filesystem/process sandbox. Closing the connection, detach, shutdown, or invalid messages stops the PTY and shell/foreground process groups. The agent joins I/O goroutines and reaps the shell. Persistent tmux sessions, account pairing, per-user grants, and reattachment are not implemented.

Tests cover rejected authentication without process creation, workspace/resize/output/exit behavior, disconnect cleanup, malformed messages, Go/TypeScript fixtures, and an actual Tailcat connection through a local DERP/STUN test relay. Run Go tests with `GOMAXPROCS=2` and `-p 1` to bound resource use.

## Schema generation

Install `protoc` (the checked-in output was generated with 3.21.12), run `pnpm install`, then `pnpm --filter @webssh/protocol generate`. The script installs pinned `protoc-gen-go` v1.36.11 into an ignored local bin directory with Go resource limits, and uses pinned ts-proto 2.20.0. Commit generated sources alongside schema changes; consumers do not need protoc just to build. No gRPC service/runtime is involved.

The generated `TerminalMessage` defines the wire field numbers and binary codecs. Go's `Message` struct and TypeScript's discriminated union are application adapters; neither implements protobuf encoding. The initial envelope retains a string message type and field validation at the session boundary. Never reuse field numbers; reserve removed fields and use additive changes where possible.

This replaces the unpublished JSON prototype and is wire-incompatible with it. Both ends must update together. Version 1 identifies this initial protobuf contract; the length prefix and transport limits remain unchanged. Fixture JSON uses base64 only as a portable representation of expected bytes in tests.
