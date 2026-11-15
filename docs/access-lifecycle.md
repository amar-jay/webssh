# Access and lifecycle controls (milestone 5)

## Expiry and active revocation

An attach grant is single-use and expires at its exact Unix expiry second. The local verifier also rejects grants more than sixty seconds into the future, malformed/oversized identifiers, bad MAC lengths, and replay. The server transaction checks the same admission deadline, current agent credentials, session ownership/status, run generation, issuing browser session, and controller lease. Grant minting rechecks authorization transactionally after asynchronous signing so revocation or termination during signing cannot issue a usable stale grant.

The grant expiry is an **admission deadline**, not the remote shell lifetime. Once admitted, the agent renews a ten-second controller lease every two seconds with a three-second request budget. Active access continues after the original attach grant expires only while that lease, browser session, current agent token, run generation, and terminal session remain valid. Browser sessions have a fourteen-day absolute expiry; agent credentials expire after thirty days. Logout, browser expiry/revocation, agent revocation/credential rotation, terminal expiry/termination, or a stopped/stale run blocks new admission and cuts current application access on the next check (normally within two seconds, up to the check interval plus request budget). This is bounded revocation, not instantaneous revocation.

The agent validates the consumed lease again after backend creation and before ready/input is exposed. A termination observed during attach terminates only the owned session and emits no ready frame. Admission and tmux creation span systems, so the continuous check remains necessary after readiness. An HTTP termination request stays queued until the agent verifies and acknowledges owned-session termination.

A run becomes offline after 35 seconds without a heartbeat and expires after 24 hours. Its tmux work is not killed by metadata expiry. Authenticated restart recovery can republish owned work with a fresh generation; old grants do not survive restart. Neither heartbeat loss nor client loss invents shell exit or an exit code. There is no arbitrary lifetime timer that silently destroys a persistent tmux command.

## Stop, detach, terminate, and cleanup

Serve help and normal output explain the selected backend:

- Tmux: Ctrl+C/SIGTERM stops the agent and detaches clients, preserving remote work. Restart serve in the same scope to recover it.
- Ephemeral: disconnect or agent stop kills/reaps that connection's shell and foreground jobs.
- Terminate: explicit protocol/dashboard/local cleanup ends the selected owned remote session. The busy policy never performs automatic takeover.

For offline cleanup, stop serve first, then use the same workspace, config, credentials, and optional state directory as the original serve command:

```sh
webssh sessions /path/to/workspace
webssh sessions --terminate <session-id> /path/to/workspace
webssh sessions --terminate-all /path/to/workspace
```

`--config`, `--credentials`, and `--state-dir` override the corresponding paths. Without termination flags this command lists only stable IDs and lifecycle state. It acquires the workspace lock, refuses to bypass a running agent, checks the private ownership ledger and tmux marker, and never uses `kill-server` or a name prefix as authority. Unknown IDs and marker mismatches cannot be terminated. An unavailable backend does not produce a false termination acknowledgment. Ownership tombstones are not deleted to free capacity. Local cleanup records are reconciled with cloud metadata on the next authenticated serve; a locally ended entry cannot be recreated by an old grant in the meantime.

These are application ownership guarantees, not an OS sandbox. The agent runs as the local user; deliberately daemonized processes outside the application's terminal session are outside its cleanup guarantee.

## Resource limits

| Resource | Bound |
| --- | --- |
| Native connections, including pending handshakes | Default 8, configurable up to 128 |
| Pending handshake | Ten-second absolute read deadline; counts against connection limit |
| Protocol frame / byte payload | 128 KiB / 64 KiB |
| Native output buffer | One 16 KiB PTY chunk per connection, serialized writes |
| Slow native writer / blocked PTY input | Ten-second network write / two-second PTY write deadline |
| Controller silence | Twenty seconds, with five-second browser pings |
| Browser input writer queue | 1 MiB; overflow fails closed, no replay |
| Browser output consumption | One protocol reader waits for xterm's write callback |
| Browser scrollback / images | 1,000 lines; 32 MiB image storage and 4,194,304 pixels per image |
| xterm OSC/DCS parser payload | Upstream xterm 6 caps payload accumulation at 10,000,000 characters |
| API JSON/native form bodies | 16 KiB actual bytes, 1,024 chunks, five seconds; Content-Length is not trusted |
| Agent run/attach control operations | Bounded retries; three-second request/short tmux-operation budgets; cancellation joins pumps/monitor |
| Local ledger | 128 entries, private regular file, maximum 64 KiB on read |
| Owner agents / runs / terminal records | 128 / 32 / 4,096 (128 terminal records per run) |
| Owner browser sessions | 64 live sessions; expired/revoked rows can be removed before admission |
| Owner grant records | 1,024 total, 16 per terminal session; expired unused grants pruned, active lease nonces retained |
| Shared pairing hub | 512 unexpired attempts and 4,096 rate buckets; expiry cleanup before admission |

Cloud quotas are enforced at insertion, including concurrent/recovery paths. Agents/runs/session tombstones count toward quotas; access decisions are never silently evicted to admit more work. At capacity, use an existing unended session or an administratively reviewed new scope/account capacity policy. Persistent records are retained within these hard limits so prolonged offline termination decisions cannot be forgotten. This release does not silently recycle ownership tombstones or automatically kill processes to reclaim quota.

## Untrusted terminal output

The terminal and its parser treat remote bytes as terminal data, not HTML. Remote OSC 52 clipboard reads **and writes** are consumed and blocked. Explicit trusted keyboard copy/paste remains available. Remote title changes and window manipulation/report requests are blocked; the image addon cannot enable window reports.

Both detected links and OSC 8 links use the same policy: trusted left-button Ctrl/Meta-click, HTTP(S) only, no credentials/control/bidi characters, maximum 2,048 characters, and destination confirmation. New windows use `noopener,noreferrer`. Output alone cannot open a URL. An allowed HTTP(S) URL is not a claim that the destination is trustworthy; the user confirms the actual URL.

Tests exercise the installed xterm 6 headless parser with split OSC 52 queries/writes, title/window requests, malicious hyperlinks, HTML-looking output, and repeated output beyond scrollback. They test the same policy functions installed by the browser terminal. Visual browser, clipboard permission prompts, and deployed relay interactions remain release-gate checks when a signed-in browser is available.

## Verification

Native tests cover termination during attach, revocation with completely blocked output, cancellation while input blocks, pending-handshake limits, simultaneous competing controllers, and terminating one session without affecting another. Real SQLite tests cover exact expiry, active authorization after attach-grant expiry, browser/agent revocation, concurrent grant limits, all metadata quotas, and preservation of termination records. Browser-side tests cover backpressure, queue overflow, cancellation, bounded reconnect, safe output/link policies, and actual request-body limits.
