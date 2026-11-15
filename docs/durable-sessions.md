# Durable sessions (milestone 4)

See [access and lifecycle controls](access-lifecycle.md) for expiry/revocation bounds, quotas, untrusted-output policy, and offline cleanup commands.

## Use

```sh
webssh serve /path/to/workspace
```

Tmux is the default process backend. Install tmux with your OS package manager if it is missing; WebSSH prints setup guidance and never installs it or silently falls back. Linux and macOS are supported. Use `webssh serve --backend ephemeral <path>` only when disconnect-kills-shell behavior is wanted explicitly. Flags precede the workspace path.

The normal browser URL still contains only an opaque session ID. Reload, close/reopen, suspend the browser, or lose a relay connection: the tmux server and shell keep running. Stopping serve also preserves tmux sessions. Restart serve with the same credentials, configured shell, workspace path, and state directory to recover them and republish the listener descriptor. Reconnecting requires the paired account's current browser session and current agent credentials.

The tmux binary and session state are local to the machine running serve. The default state directory is `sessions/` beside the credentials file (normally `~/.webssh/sessions`). `--state-dir` overrides it; choose a short, private path because Unix socket paths are limited. Do not delete the ownership ledger if sessions must be recovered. A workspace ledger currently allows 128 session IDs, including ended tombstones; use a new state directory for a fresh ledger when this limit is reached. It does not adopt sessions from an old ledger.

## Controllers, detach, and terminate

There is one active controller per stable session, independent of transport connection IDs. A second controller receives `session_busy`; it never disconnects or resizes the first controller. There is no forced takeover in this release. Close/detach the first controller or wait for its failed transport and authorization lease to expire. Resize messages are accepted only on the admitted controller's connection. Separate session IDs can have separate controllers.

- **Detach** closes/reaps only the connection's tmux client and its local PTY. It does not kill the tmux server, pane, or remote command. Closing a transport is also detach for the persistent backend. The default tmux prefix (`Ctrl-b d`) detaches intentionally and does not trigger automatic reconnect.
- **Terminate** is a distinct typed protocol message and an explicit dashboard action. The admitted controller can terminate immediately through the protocol. The dashboard queues a termination request, including while offline. The agent validates its ledger marker, kills the owned tmux session, and acknowledges the request on its control channel. The dashboard displays Termination pending until acknowledgment. No offline agent can confirm immediate process termination; it reconciles the request before exposing recovered work.
- Normal shell exit is detected from tmux pane state and reported as ended. Exit codes are reported only when known. A disconnected tmux client is never interpreted as shell exit.

Tmux redraws its screen on attach; WebSSH does **not** implement byte-perfect output replay or application-level output acknowledgments. Input sent during a failing connection may have been received or lost. WebSSH never resends uncertain input. The workspace is an initial directory, not a sandbox, and processes run with the agent user's privileges.

## Recovery and ownership

Each agent/workspace/shell scope has a dedicated tmux socket, a private directory, a mode-0600 JSON ledger, and an exclusive process lock. Scope includes the control-plane origin, owner and agent IDs, workspace path, and configured shell. Re-pairing as a new agent or changing this scope does not adopt old processes.

A ledger entry maps the stable session ID to an application-generated tmux name and a random ownership marker set atomically in the tmux session environment at creation. Creation and attachment use argument arrays, including separate configured-shell and `-i` arguments; no user-controlled shell command is concatenated. The dedicated server ignores the user's tmux configuration. These choices follow the [tmux command contract](https://github.com/tmux/tmux/wiki/Getting-Started).

Recovery visits only ledger entries on that dedicated socket and requires the exact marker. It never enumerates/adopts the user's ordinary tmux server, trusts a name prefix alone, attaches a marker mismatch, or terminates an unrelated session. A crash between ledger creation and tmux creation fails closed rather than guessing ownership. A missing/corrupt ledger is not reconstructed from tmux names; retain the old state and review it manually.

On every serve startup a new random generation fences admission. The authenticated control plane verifies recovered session ownership, retains explicit termination decisions, clears old controller leases/nonces, and associates fresh grants with the new generation. Durable termination requests and session tombstones are retained through cleanup, including prolonged offline periods, so recovery cannot resurrect explicitly terminated work. Old agent incarnations and grants from before restart are rejected. Rotated/revoked/expired credentials still fail authentication; knowing a stable ID is never authorization. Restoring a durable session whose control-plane availability expired requires current authenticated agent recovery; expiry alone never kills tmux work.

## Reconnect policy

For each outage, the browser makes at most six automatic retries with delays of 0.5, 1, 2, 4, 8, and 8 seconds. Each attempt obtains a new no-store descriptor and single-use grant. Resolution is bounded by eight seconds, transport setup by 25 seconds, and attach handshake by ten seconds. A connection stable for thirty seconds resets the budget for a later outage; a flapping connection does not. Retry exhaustion offers explicit `r` retry. No input listeners or pending input bytes carry over to a new attachment.

Protocol ping/pong every five seconds detects a silent relay; twenty seconds without an agent message closes the attachment and starts bounded reauthorization. The agent also detaches controllers after twenty seconds without browser messages, preventing a half-open sleeping connection from holding the controller slot forever. Timer wake after browser sleep also detects stale connections. Navigation aborts pending requests, backoff, and transport. Logout/authorization failure, explicit detach/termination, actual session exit, incompatible capabilities, and permanent backend errors stop automatic retries. A busy lease is retried only within the same bounded budget and never forces takeover.

The agent's two-second online authorization checks still detach a client when access or the control plane is unavailable. They preserve tmux work. Ten-second authenticated run heartbeats reconcile terminated/dead sessions and queued terminations. Missing heartbeats still mean offline/unknown shell state, not shell exit.

## Protocol and rollout

Protocol v2 uses a protobuf `oneof` with typed open/create mode, stable session ID, capabilities, backend, input/output, resize, detach, terminate, lifecycle, typed errors, and ping/pong. V1 field numbers 1–9 and removed field names are reserved. V1 frames are deliberately rejected; the HMAC grant format remains `v1` independently of the terminal protocol version. V2 shared fixtures cover both Go and TypeScript codecs; v1 fixtures remain a rejection corpus.

Upgrade both CLI and web app. SQL migration 5 adds backend/generation fences and durable termination requests without modifying applied migrations. Old ephemeral sessions remain ephemeral; they cannot be converted into already-running tmux shells. Durable tests execute the installed tmux binary, preserve a running command through detach/transport loss/restart, verify redraw, reject a second controller, explicitly terminate, reject unrelated tmux sessions, and test stale grants and revoked credentials. Browser reconnection tests inject network loss and logout; a live visual browser/sleep test requires an available signed-in browser.
