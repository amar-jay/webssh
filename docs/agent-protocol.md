# Agent protocol v2

`packages/protocol/schema/terminal.proto` is the source of truth for the typed Protobuf contract. Both generated languages, framing adapters, and shared `fixtures/v2.json` are checked in. `fixtures/v1.json` remains a rejection corpus. See [durable sessions](durable-sessions.md) for ownership, recovery, controller policy, and process lifecycle.

Frames are a four-byte unsigned big-endian byte length followed by `webssh.protocol.v2.TerminalMessage`. Frame size is at most 128 KiB and a data payload is at most 64 KiB. Incremental decoders handle split/coalesced reads and fail closed on malformed lengths/payloads. The envelope uses a `oneof`, reserves old untyped field numbers 1–9, and rejects v1 frames. No gRPC runtime is involved.

| Payload            | Direction       | Purpose                                                                                                           |
| ------------------ | --------------- | ----------------------------------------------------------------------------------------------------------------- |
| OpenRequest        | browser → agent | Version 2; CREATE_OR_ATTACH or ATTACH_EXISTING; stable session ID; token; dimensions; TERM; required capabilities |
| Ready              | agent → browser | Confirms stable ID, backend and capabilities                                                                      |
| Bytes input/output | directional     | Raw terminal bytes; no automatic uncertain-input replay                                                           |
| Size resize        | browser → agent | Active controller dimensions, 1–1000 columns and 1–500 rows                                                       |
| Detach             | browser → agent | Detach client, preserve tmux work                                                                                 |
| Terminate          | browser → agent | Explicitly terminate owned remote session                                                                         |
| Lifecycle          | agent → browser | DETACHED, ENDED (exit code only when known), or TERMINATED                                                        |
| Failure            | agent → browser | Typed fixed error code; no raw credentials/exception strings                                                      |
| Ping/Pong          | browser ↔ agent | Bounded silent-transport detection                                                                                |

No client-supplied shell, command, environment, workspace, or tmux name is accepted. Open uses the agent's configured shell/workspace and application-owned tmux identity. The public session ID must match the grant's signed ID; authorization consumes a fresh nonce against the current run generation and browser session. One active controller per stable session is enforced before launching a tmux client. Capability mismatch, busy controller, and invalid grants fail without starting a shell.

HMAC grants retain their independent `v1.<session>.<expiry>.<nonce>.<mac>` format. They never fall back to development tokens. Explicit `--dev-token` is for local tests only. Plain PTYs require `--backend ephemeral`; their disconnect semantics remain destructive by design.

Generate with `pnpm --filter @webssh/protocol generate` after installing protoc. The generator uses pinned protoc-gen-go v1.36.11 and ts-proto 2.20.0 (discriminated oneof unions and erasable enum literals), with bounded Go build resources. Commit generated codecs and fixtures with schema changes. Consumers do not need protoc to build.
