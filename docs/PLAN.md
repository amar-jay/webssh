# WebSSH completion plan

Status: updated 2026-11-15. Milestones 3 and 4 are complete and deployed. Milestones 5 and 6 are implemented with automated/native/parser/build verification; milestone 6 publication, relay capacity and live browser release gates remain open; completing the implementation does not imply live browser acceptance has been verified.

## Target outcome

A user runs `webssh serve <path>`, pairs the agent with their browser, opens `/s/<session_id>`, and gets a real terminal. Reloading or briefly losing connectivity preserves the remote work. Only an authorized browser can attach. The user can explicitly end the session and stop the agent.

Keep the session route entirely terminal-based, using the existing Tokyo Night Moon theme and padding. Put login, pairing, and machine/session selection outside the terminal route. Support Linux/macOS agents first.

## Current foundation

| Component | Implemented | Essential gap |
| --- | --- | --- |
| Web terminal | xterm, addons, theme, terminal-only route, WASM loading, authenticated production session URLs | Live browser reload/sleep acceptance remains to be verified |
| Browser transport | Owned Go/WASM bridge, typed client, cancellation, stream ownership, fresh-grant reconnect and liveness deadlines | Deployed browser/relay outage acceptance remains a release gate |
| Agent | Tailcat listener, HMAC grants, tmux persistence/recovery, active revocation, bounded resources, scoped cleanup and safe lifecycle events | Deployed signed-in browser and outage acceptance |
| Protocol | Typed Protobuf v2, generated Go/TS codecs, shared fixtures, capabilities, pinned generators and generation-drift CI | Execute CI on the committed release candidate |
| CLI | Configuration, pairing, opaque session URLs, persistent recovery, cleanup, four versioned archive targets, checksums and tested installer | Publish matching tag; run target-platform CI and clean-machine install/pair |
| State service | Owner/pairing records, active lease checks, generation fences, durable termination, storage quotas and migration preservation tests | Deployed end-to-end release journey |
| Deployment | Web/state deployed, versioned WASM/runtime assets, CSP, health, CI/release/deploy workflows and production smoke | Sustained relay capacity, tagged publication and signed-in browser acceptance |

The original architecture notes contain future-tense statements that predate these implementations. Use the code and current protocol/transport documents for implementation status. READMEs remain user-owned.

## 1. Prove a real browser terminal locally

**Priority: first.** Resolve transport integration before expanding application storage or account flows.

- Add a browser session adapter that composes `@webssh/transport`, `@webssh/protocol`, and the existing xterm controller.
- Supply connection information through a development-only local pairing/input mechanism outside `/s/`. Keep address/token out of route paths, query strings, logs, and committed fixtures. Do not add a production endpoint that releases credentials without ownership checks.
- Dial the application port, send attach with initial dimensions, and wait for ready before enabling input.
- Feed decoded output bytes into xterm. Forward text and binary input correctly; split large input into permitted messages and preserve order.
- Use one reader and a bounded writer queue. Wait for xterm consumption to apply output backpressure. Coalesce resize events.
- Show connecting, failure, shell exit, and disconnect states inside the terminal. Distinguish a failed connection from a process exit.
- Dispose terminal listeners and streams on navigation, including late dial completion. Do not silently replace a failed real session with a mock.
- Keep mock attachment available through an explicit development mode.
- Add a real headless-browser integration test using a local WebSocket-capable DERP and the native agent. The existing Node WASM smoke test is not a browser network test.

**Acceptance:** from a browser, run commands in the served directory; verify Unicode, paste, Ctrl+C, an interactive full-screen program, resize, exit code, invalid credentials, and route disposal. No unexpected shell remains after disconnect under the current connection-scoped policy.

## 2. Establish application identity and secure pairing

**Priority: required before a public deployment.** Decide the initial identity model explicitly: recommended first-release scope is private owner access with one browser controller per session.

- Choose an authentication provider/session mechanism compatible with the web Worker. Store secure server-side identity in cookies; define logout and expiry.
- Define records for owner, agent, pairing attempt, terminal session, and connection grant. Separate stable IDs from credentials.
- Implement narrow Durable Object operations with transactional SQLite migrations. Derive object routing from trusted ownership data; never treat a supplied object/session ID as authorization.
- Implement CLI device pairing: CLI requests a short-lived pairing attempt, displays a URL/code, browser authenticates and approves the named machine, CLI completes the exchange. Make claims single-use and rate-limited.
- Give the registered agent its own scoped credential stored with restrictive permissions, separate from ordinary settings. Define renewal and revocation.
- Define how connection information reaches an authorized browser and how the agent accepts it. Prefer short-lived, session-scoped grants validated by the agent, with expiry/replay policy and explicit session binding.
- Retire the broad per-run application token as the production authorization mechanism. Decide whether grants are cryptographically signed or validated through an authenticated control channel; document the trust boundary before implementing either.
- Document that a service which receives raw Tailcat credentials or can mint shell grants is trusted for access. Do not claim an untrusted control plane without designing and verifying that stronger model.

**Acceptance:** a second account cannot read, claim, or attach to another owner's machine/session. Expired/replayed pairing codes and revoked agent credentials fail. Invalid grants never create or attach to a PTY. Logout/expiry blocks new access.

## 3. Deliver the normal CLI-to-browser flow

**Status: complete and deployed (2026-11-15).** See [CLI-to-browser flow](cli-browser-flow.md).

Depends on milestones 1 and 2.

- Have `serve <path>` load configuration, register/announce the running agent, create a session record, and print a browser URL containing only the opaque session ID.
- Add a small authenticated landing page for pairing, available machines/sessions, and starting or ending a session. Keep `/s/<session_id>` terminal-only.
- Let the web server resolve an authorized session ID into the current connection descriptor/grant. Return no-store responses and exclude credentials from diagnostics.
- Track agent availability through an authenticated heartbeat or control channel with bounded retries and expiry. Define offline, connecting, active, ended and expired states.
- Avoid recording offline as shell termination: a missing heartbeat alone is not proof that a process exited.
- Define startup failure and shutdown behavior so stale session records expire or are marked offline/ended appropriately.

**Acceptance:** a fresh user can configure, pair, run serve, and open the printed URL without manually copying credentials. An offline agent produces a useful terminal message rather than an endless loader.

## 4. Preserve remote work and reconnect

**Status: complete and deployed (2026-11-15).** See [durable sessions](durable-sessions.md).

**Priority: essential for the stated durable-session experience.** Tmux is now the default persistent backend; disconnect-kills-shell behavior remains only in the explicit ephemeral backend.

- Introduce stable agent-side session IDs and a session manager, separate from transport connection IDs.
- Use tmux as the first persistent process backend. Check availability and report setup instructions; do not install it silently. Keep direct PTYs as an explicitly ephemeral option.
- Create tmux sessions in the requested workspace with the configured shell. Use argument-safe process calls and application-owned identifiers.
- On browser loss, detach the connection's tmux client while preserving the tmux server/session. Explicit terminate must end the remote session; detach and terminate must be distinct protocol operations.
- Evolve the Protobuf contract for create/attach/session identity, capability negotiation, detach/terminate, and lifecycle/error messages. Prefer typed payloads (`oneof`/enums) as the contract expands; reserve removed field numbers and keep fixtures current.
- Reconnect with bounded backoff and fresh authorization; cancel retries on navigation, logout, termination, or terminal exit. Never replay uncertain input automatically.
- Begin with one active controller per session. Specify takeover, resize ownership and how a previous controller is disconnected.
- Let tmux redraw terminal state on attach. Do not claim byte-perfect output replay unless an acknowledgment/replay mechanism is explicitly implemented.
- Define agent restart recovery: discover only application-owned tmux sessions, reconcile them with stored ownership, and prevent stale credentials from granting access.

**Acceptance:** reloading, closing/reopening the tab, sleeping the browser and a temporary relay outage preserve a long-running command. Reattach redraws correctly. Explicit termination ends it. A second controller obeys the documented takeover policy. Restart recovery cannot attach to an unrelated tmux session.

## 5. Complete access and lifecycle controls

**Status: implemented.** Expiry/revocation enforcement, bounded resources/storage, scoped cleanup, untrusted terminal-output policies, and lifecycle concurrency tests are in place. See [access and lifecycle controls](access-lifecycle.md). Live visual browser checks remain release gates.

Depends on pairing and persistent sessions.

- Enforce grant/session expiry at attach and define behavior for expiry during an active connection.
- Implement revocation of active application connections and blocked future attachments, not just deletion of a metadata record.
- Define agent stop versus session termination. Print the chosen persistence behavior clearly in CLI help and document cleanup commands.
- Bound frame sizes, connection counts, pending handshakes, output buffers, storage growth and retries. Retain fixed public errors without exposing tokens or host details.
- Verify browser terminal escape handling and clipboard/link policies using untrusted remote output.
- Add concurrency tests for termination during attach, disconnect during output, simultaneous takeover, slow consumers and cancellation.

**Acceptance:** revocation actually cuts access; stopped sessions cannot reconnect with old grants; slow/malicious clients cannot grow memory without bound. Cleanup does not accidentally terminate another user's/session's processes.

## 6. Make deployment and distribution reliable

**Status: implementation in place; release acceptance remains gated.** Versioned WASM/runtime assets, host size enforcement, dependency/toolchain compatibility, bounded CI, release archives/checksums/installer, production smoke, migration preservation tests, CSP and safe lifecycle signals are implemented. State/web deployment and production app/state/auth/CSP/asset smoke passed on 2026-11-15. See [deployment and distribution](deployment.md) for current relay evidence and the outstanding publication/clean-machine/deployed-browser gates.

Start the asset feasibility check during milestone 1; complete this milestone before release.

- Measure compressed/uncompressed WASM size and confirm it can be served by the chosen host. The original uncompressed binary was about 33 MiB; the verified tagged build is 27,450,419 bytes raw and 6,377,893 bytes gzip, below the chosen host’s 25 MiB per-asset upload limit.
- Review version-matched Go feature omission tags, compression, caching and runtime pairing. Choose a separate asset host if necessary after checking current platform constraints.
- Decide on a relay for sustained browser use. Verify WebSocket support, TLS, capacity, geography and outages. Browser traffic stays relayed in the current Tailcat implementation.
- Configure web/state bindings, migrations, secrets, domains, HTTPS, CSP and relay origins. Keep terminal traffic on Tailcat; application state belongs in Durable Objects.
- Add CI for bounded Go tests/vet, protocol generation drift, shared fixtures, TypeScript checks, browser integration and a production deployment smoke test. Build WASM only when required and for releases.
- Pin generator versions and preserve generated sources. Establish a compatibility rule for CLI/protocol/WASM versions and actionable mismatch errors.
- Publish versioned CLI artifacts for supported platforms with checksums and tested installation/update instructions in docs. Package the same dependency versions tested with the browser build.
- Log lifecycle events without command contents, output, private keys, grants or connection credentials. Add enough health signals to distinguish app, relay, agent and process failures.

**Acceptance:** a clean checkout builds; a fresh supported machine can install and pair; deployed WASM loads and connects; migrations preserve data; rollback/version mismatch behavior is understood. No development credentials or mock terminal path is enabled by default in production.

## Release gates

A demo is complete after milestone 1. An authenticated ephemeral terminal is usable after milestones 2–3 plus deployment verification. The essential durable WebSSH release requires milestones 1–6, especially preservation across disconnects and working revocation.

Before calling the essential release complete, perform this single end-to-end journey:

1. Install CLI on a clean supported machine and pair it to an authenticated browser.
2. Serve a workspace, open the emitted URL, and use the terminal interactively.
3. Run a long command, resize, drop connectivity, reload and reattach without losing the process.
4. Verify a different owner and expired credentials cannot attach.
5. Revoke access and confirm both live and future connections fail.
6. End the remote session and verify process/metadata cleanup.
7. Repeat against the deployed web/state services and intended relay, not only local mocks.

## Deferred from the essential release

- Windows PTY backend, mobile-specific terminal controls and native packaging beyond supported platforms.
- Collaborative typing, multiple viewers, session sharing and organizational roles.
- File browser/SFTP, port forwarding, SSH interoperability and command automation.
- Terminal recording/searchable history, offline output replay and audited session playback.
- Direct browser peer-to-peer transport or a Tailcat transport fork.
- Custom terminal themes and additional decorative UI.

## Working rules

Proceed milestone by milestone with reviewable commits and update this plan as decisions settle. Keep READMEs protected. Run Go checks with `GOMAXPROCS=2` and `-p 1`; use race detection only with explicit limits and a reason. Use focused tests during implementation and reserve full builds/browser runs for integration changes and release gates.

**Milestone 1 completed locally:** development-only credential handoff, real terminal route, explicit mocks and browser–DERP–agent acceptance test are implemented. See [browser session](browser-session.md).

**Milestone 2 implemented:** GitHub OAuth with HttpOnly cookies, Durable Object owner/pairing records, CLI `webssh pair`, HMAC-signed attach grants, and grant verification before PTY start. See [identity and pairing](identity-pairing.md). GitHub OAuth app credentials must be set on the Worker before public pairing works.

**Milestone 3 complete and deployed:** serve registers and announces the agent, prints an opaque session URL, and supports the authenticated machine/session dashboard and no-store descriptor/grant resolution. Heartbeats, bounded retries, expiry, startup cleanup, and offline messages are implemented. See [CLI-to-browser flow](cli-browser-flow.md).

**Milestone 4 complete and deployed:** stable agent-side sessions, tmux persistence, ownership-checked restart recovery, typed protocol v2, distinct detach/terminate operations, bounded fresh-authorization reconnect, and a single-controller busy policy are implemented. Native tmux tests cover running-command preservation through detach, abrupt transport loss, a sleeping controller, restart, redraw, explicit termination, and rejection of unrelated sessions. State and browser-side tests cover generation fences, stale/revoked credentials, queued termination, retry cancellation, and no uncertain-input replay. See [durable sessions](durable-sessions.md).

**Verification limit:** live signed-in browser reload/sleep and deployed relay-outage acceptance remain unverified because no browser was available. Keep these checks in the release gates; automated/native tests and production route/asset smoke checks do not replace them.

**Milestone 5 implemented:** active lease revalidation and revocation, cancellation-safe native I/O, transactional storage quotas, scoped offline cleanup, and shared terminal output/link/clipboard policies. Native concurrency, real SQLite, and real xterm parser tests verify the controls. See [access and lifecycle controls](access-lifecycle.md).

**Milestone 6 implemented and web/state deployed:** hashed WASM/runtime assets with integrity and compatibility checks, version-matched omission tags, input-aware builds, pinned protocol generation, bounded verification workflows, native installer runner matrix, four CLI archive targets/checksums, migration upgrade tests, CSP, health and fixed lifecycle diagnostics are in place. Local Go tests/vet, 51 JavaScript tests, TypeScript checks, WASM smoke, archive builds and Linux installer/update/corruption tests passed. Production app/state/auth/CSP/asset smoke passed. CLI archives remain unpublished candidates; workflows and signed-in browser acceptance still require execution. Relay TLS/WebSocket probes passed for NYC, SFO and Frankfurt; Tokyo failed from the test machine. See [deployment and distribution](deployment.md).

**Next release task:** publish a tested matching tag, establish sustained relay capacity, and complete clean-machine installation and the deployed signed-in browser release journey.
