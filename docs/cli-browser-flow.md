# CLI-to-browser flow (milestone 3)

This flow now uses persistent tmux by default. The [durable-session lifecycle](durable-sessions.md) supersedes the original connection-scoped process behavior.

## Normal use

```sh
webssh config
webssh pair
webssh serve /path/to/workspace
```

Approve the pairing link with GitHub. After serve announces its listener, open the printed `https://ssh.amarjay.com/s/<opaque-session-id>` URL. Sign in with the same GitHub account. The browser resolves the session and attaches without copying tokens or addresses.

Keep serve running. The signed-in home page lists paired machines, available workspaces, and recent sessions. Open terminal reuses an unended session or creates a fresh one after the previous session ends. Terminate prevents admission and queues owned-session termination for agent acknowledgment. One browser controller is allowed per stable session. Attach starts a tmux client; detach/disconnect preserves the tmux server and shell. Explicit termination ends the remote session. There is no automatic input replay.

## Records and authorization

A run identifies one serve process and listener. Its initial terminal session has the same opaque ID. Additional sessions reference that run. The run stores the configured machine name, a workspace basename (not its absolute path), the authenticated listener descriptor, and heartbeat timestamps. Agent tokens and grant keys never appear in the dashboard, normal CLI output, or URLs.

- `POST /api/agent/run`: agent-token-authenticated start, announce, heartbeat, offline, and end operations. Start is idempotent for the same random run ID. The browser URL is printed only after successful announcement.
- `POST /api/sessions/<id>/grant`: browser-owner-authenticated descriptor resolution and single-use 60-second grant minting. Foreign IDs return 404. Offline, busy, ended, expired, and revoked sessions return a fixed error code. Responses use `Cache-Control: no-store`.
- `POST /api/agent/session`: consumes grants and checks/releases active leases. Admission binds the session to the authenticated run. Browser session expiry/logout and agent revocation still invalidate access.
- Home page `?/start` and `?/end` actions derive ownership from the signed-in browser, never form-supplied owner IDs. Metadata refreshes every 10 seconds while visible. Server page data contains no descriptors or grants.

The `/s/<id>` page redirects unauthenticated production visitors through GitHub sign-in, preserves the session path, and renders only a terminal. Descriptors and grants live in attachment memory. Resolution takes at most 8 seconds; transport loading, client creation, and dialing have a 25-second total connection deadline, with a 10-second handshake deadline within it. Failure messages contain no raw server/network error text. Retry is explicit with `r`; terminal input is never replayed.

## Availability and session states

Serve sends an authenticated heartbeat every 10 seconds. Each control operation has at most three attempts with a three-second request budget and 0.5/1-second retry delays. Permanent authorization/state failures stop immediately. Exhausting heartbeat retries cancels the listener and cleans up local shells.

| Session state | Meaning                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| connecting    | Announced agent is reachable and no live attach lease has been confirmed; dashboard labels this Ready to open. |
| active        | Agent confirmed a single-use grant and has a current controller lease.                                         |
| offline       | Descriptor is unavailable or no heartbeat was received for 35 seconds. Shell state is unknown.                 |
| ended         | An explicit end action, agent-confirmed attachment cleanup, or completed serve shutdown ended this session.    |
| expired       | No run heartbeat for 24 hours. Shell state is unknown; no exit timestamp is fabricated.                        |

Active authorization is rechecked every two seconds with a three-second request budget and a ten-second lease. Missing heartbeats or leases alone never produce an ended record or an exit code. Only an actual protocol exit frame is reported as shell exit in the terminal. A lost connection reports unknown shell state.

## Startup and shutdown

Local configuration, workspace, shell, port, and credential validation happen before registration. Registration creates a starting run and initial session. Listen or announce failures trigger bounded best-effort cleanup and print no usable browser URL. SIGINT/SIGTERM stops the listener, closes connections, detaches clients, preserves tmux processes, and marks the run offline (ephemeral mode still kills/reaps connection-scoped shells and marks sessions ended) using an independent four-second cleanup budget.

A crash, network partition, or failed cleanup leaves a record that becomes offline after 35 seconds and expires after 24 hours. Offline does not imply the shell exited. Cleanup alarms and lazy read-time expiry enforce expiry even if no browser visits; old terminal/run metadata is removed after seven days.

## Build and deploy

The web build also builds the Go/WASM transport and copies the matching Go runtime, so a fresh checkout cannot silently deploy without terminal assets. All Go builds use `GOMAXPROCS=2` and `-p 1`.

Deploy the state Worker before the web Worker. SQL migration 4 adds run records and session run bindings without rewriting previous migrations. Existing paired credentials remain usable, but restart serve with the updated CLI to announce a descriptor and obtain an openable URL. Old unannounced sessions have no resolvable descriptor.

Tests cover the real SQLite Durable Object lifecycle, owner separation, concurrent session starts, heartbeat loss without shell-exit claims, expiry, one-time grant admission, end enforcement, request redaction, browser-side resolution and connection deadlines, local relay startup/CLI URL output, and shutdown cleanup. A live GitHub OAuth login and visual browser interaction require an available signed-in browser and are not simulated by these tests.
