# Deployment and distribution

Milestone 6 release tooling is implemented. [v0.1.0 is published as a prerelease](https://github.com/amar-jay/webssh/releases/tag/v0.1.0). A signed-in deployed browser journey and sustained relay capacity remain separate release gates; successful publication does not establish them. `release.json` is the release compatibility manifest; generated protocol sources stay committed.

## Reproduce a clean build

Use Go **1.27.4**, Node **22.12 or later**, pnpm **11.1.1**, and protoc **3.21.12**. Ubuntu 24.04's `protobuf-compiler` supplies that protoc version. Install tmux and a shell yourself for persistent sessions; WebSSH never installs tmux. Linux and macOS, amd64 and arm64, are the archive targets; Windows agents remain unsupported.

```sh
pnpm install --frozen-lockfile
pnpm go:test
pnpm go:vet
pnpm --filter @webssh/protocol generate
git diff --exit-code -- packages/protocol/gen packages/protocol/src/generated
pnpm check
pnpm -r --if-present test
pnpm --filter @webssh/web build
pnpm --filter @webssh/transport test:wasm
node scripts/release.mjs
node scripts/test-install.mjs
```

Every Go build/test/vet uses `GOMAXPROCS=2` and `-p 1`. The release archives are written to ignored `dist/release/`, alongside `SHA256SUMS` and dependency/version metadata. Archives contain `webssh` and `release.json`. Native and WASM builds must use the identical Tailcat/Tailscale versions in the release manifest. No dependency upgrade is performed during packaging. Local archives made from an uncommitted tree are development candidates, not published reproducible releases; CI requires a clean tree.

## WASM feasibility and caching

Cloudflare [limits each static asset to 25 MiB](https://developers.cloudflare.com/workers/platform/limits/). The original untrimmed binary was approximately 33 MiB raw / 7.6 MiB gzip. The reviewed Tailcat v0.7.0 omission list in `scripts/wasm-tags.txt` reduces it to approximately **26.2 MiB raw / 6.1 MiB gzip**. The build records exact compressed/uncompressed sizes and SHA-256 hashes in `/tailcat/build.json`, and refuses compressed assets over 25 MiB or decompressed assets over the 64 MiB browser budget. Gzip level 9 is used; compressed bytes are served as an asset, not as a Worker module. A separate host is unnecessary at this size.

The tag list is copied from the exact dependency's `build-tags.txt`. It omits control-plane, OS integration and unused services, while retaining WireGuard, DERP/WebSockets and the userspace network stack. Do not import a current upstream keep-list into this pinned version. Changes require real WASM smoke and browser/relay testing. The CLI keeps its normal native feature set.

A content-derived directory contains the WASM and the `wasm_exec.js` copied from the same Go toolchain. These paths cache for a year with `immutable`; the small manifest uses `no-store`. The loader verifies manifest compatibility, runtime script integrity and the decompressed WASM hash. It handles hosts that automatically decode gzip as well as raw gzip responses. Runtime/download/readiness waits are bounded. Deploy the complete asset set together. The browser never runs arbitrary separately hosted demo WASM.

The build hashes selected JS/WASM Go sources, embedded data, toolchain, dependency versions, tag list and build script. Unchanged verified assets are reused; unrelated UI edits do not recompile WASM. CI caches assets using transport/dependency inputs. Releases force a fresh build.

## Relay decision and operating envelope

The configured default remains Tailcat's `https://tailcat.dev/derpmap.json`. It currently advertises New York, San Francisco, Frankfurt and Tokyo. CSP names these four relay hosts explicitly, for HTTPS latency probes and WSS DERP. This is suitable for continued testing and a limited pilot; a sustained production availability/capacity commitment is **not established** by this repository. Do not promise an SLA or unrestricted capacity for the public relays.

On 2026-11-15, TLS-verified DERP WebSocket upgrades succeeded from the development machine to NYC, SFO and Frankfurt; Tokyo failed. Probe results are snapshots, not proof of continuous availability or server-side capacity. Run:

```sh
node scripts/probe-relay.mjs
```

The probe uses the real `derp` subprotocol and a ten-second deadline per host. A failing region fails the probe. Terminal traffic remains encrypted on Tailcat; Durable Objects hold application metadata and authorization, never terminal byte streams. Browser Tailcat traffic stays relayed. The per-agent default remains eight connections (including pending handshakes), but this is a client resource bound, not a relay capacity claim.

For sustained production, operate a controlled DERP service or obtain an explicit operator capacity commitment, then run the signed-in browser journey and sustained interactive/idle/reconnect tests at the intended concurrency from target geographies. Record bandwidth, CPU, connections, latency and outage recovery; do not stress-test shared public relays without operator authorization. Serve the DERP map over HTTPS, use valid TLS for WSS `/derp` with the `derp` subprotocol, and avoid a short reverse-proxy idle timeout. Add the exact map and node origins to production CSP before selecting it with `serve --derpmap-url https://...`. Both peers receive the selected map via the authorized descriptor. Wildcard relay origins and TLS-verification bypass are not production configuration.

A temporary outage detaches the browser and triggers bounded fresh-authorization retries without replaying input. Tmux preserves work. Agent heartbeat failure stops the agent after bounded retries; restart `serve` after connectivity returns. Missing relay/agent heartbeats never assert process exit. A new run generation invalidates old grants.

## Cloudflare configuration

The web Worker is `webssh-web`, custom HTTPS domain `ssh.amarjay.com`, with `ASSETS` and cross-Worker `WEBSSH_STATE` binding to `WebSSHState` in `webssh-state`. The state Worker has no public route. Preserve the `v1` SQLite class migration in `apps/state/wrangler.jsonc`; subsequent SQL migrations are monotonic and transactional in `schema.ts`. Never rename the class/namespace or delete and recreate the binding during deployment.

Set production Worker secrets through Wrangler's prompt or a secret manager; never commit them or echo them into build logs:

```sh
pnpm --filter @webssh/web exec wrangler secret put GITHUB_CLIENT_ID
pnpm --filter @webssh/web exec wrangler secret put GITHUB_CLIENT_SECRET
pnpm --filter @webssh/web exec wrangler secret put SESSION_SECRET
```

Use a randomly generated session secret of at least 32 characters and a GitHub OAuth application with callback `https://ssh.amarjay.com/auth/github/callback`. `PUBLIC_ORIGIN` must exactly match the HTTPS custom domain. Do not reuse development cookies/secrets. Provision the domain in the same Cloudflare account. The deployment workflow needs environment secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; use a narrowly scoped Workers deployment token with domain access. Runtime OAuth/session secrets remain in Cloudflare, not GitHub artifacts.

Deploy state first, then web, and probe the resulting deployment:

```sh
pnpm --filter @webssh/web build
pnpm --filter @webssh/state exec wrangler deploy
pnpm --filter @webssh/web exec wrangler deploy
node scripts/smoke-production.mjs https://ssh.amarjay.com
node scripts/probe-relay.mjs
```

Production CSP permits same-origin scripts plus WASM compilation, explicit relay origins, and terminal image data/blob URLs. It denies object embedding, third-party frames, cross-origin forms and remote scripts. Inline styles remain necessary for xterm sizing. SvelteKit hashes its generated executable inline scripts. Dynamic requests use no-store; static hashed assets use immutable caching. HTTPS adds HSTS; all responses use no-referrer and nosniff. `/dev/connect` and the mock handoff are unavailable in production, and paired agents require online grant checks unless the operator explicitly selects the CLI development flag.

`/api/health` checks auth configuration and a bounded RPC/schema read through the actual state binding. It returns only fixed app/state status and public compatibility versions. The production smoke additionally verifies authenticated route protection, the disabled development route, CSP, asset caching, SHA-256 integrity, and compilation of the served WASM. It does not attach to a user's agent or establish an OAuth session.

## CI and release publication

`Verify` runs bounded Go tests/vet, exact generator/drift checks, shared Go/TypeScript fixtures, TypeScript checks, SQLite migration upgrade/rollback-of-failed-transaction tests, JavaScript/parser tests, real WASM smoke, browser/local-DERP/native-PTY integration, and native archive installation tests. Browser integration uses ephemeral local test credentials in a private temporary file; it does not enable production development access or log terminal contents.

`Release` validates that `vX.Y.Z` matches `release.json`, tests locked dependencies, forces WASM compilation, and builds Linux/macOS amd64/arm64 archives with checksums. Before publishing, a native runner matrix executes the checksum installer and binary on Linux amd64/arm64 and macOS Intel/Apple Silicon. The release build also runs browser integration. The `prerelease` flag in `release.json` controls the GitHub release channel; v0.1.0 remains a prerelease while deployed-browser and sustained-relay gates are open. A tagged build publishes through the GitHub `release` environment; configure its protection rules as desired. Manual workflow dispatch produces downloadable candidate artifacts without publishing. A versioned release is not published until a matching committed tag is pushed and this workflow succeeds. Test native execution on each intended OS/architecture before advertising that platform as release-qualified; local cross-compilation alone is insufficient.

`Deploy production` is explicit workflow dispatch through the GitHub `production` environment. It preserves concurrency (no deployment cancellation halfway through migrations), deploys state before web, then runs production and relay smoke checks. A failure after deployment requires operator review; it does not erase state or blindly roll back data.

Install a published version after downloading/reviewing `scripts/install.sh` from the matching tag:

```sh
sh scripts/install.sh 0.1.0 "$HOME/.local/bin"
webssh --version
webssh config
webssh pair
webssh serve /path/to/workspace
```

The unversioned `https://ssh.amarjay.com/install.sh` route serves the same installer. With no version argument, or `latest`, it selects the newest published GitHub release, including prereleases, and verifies that release’s archive checksum. An explicit version still pins the download. Version 0.1.1 includes local tmux configuration support (`tmux_config = "default"`, an absolute path, or `"none"`) and the shared Tokyo Night UI. Localhost sign-in is limited to development builds; production ignores the development cookie.

The installer selects the supported OS/CPU, downloads only from HTTPS GitHub Releases, verifies the exact archive against `SHA256SUMS`, extracts the binary, runs its version command, and atomically replaces the destination binary. It never installs dependencies, starts a background service, rewrites configuration or removes session state. `scripts/test-install.mjs` executes this installer with a recorded network boundary and tests fresh install, repeat update and checksum failure preserving the existing binary. Add `~/.local/bin` to PATH if needed; install tmux through your system package manager. For an update, stop the tmux agent, install the chosen version, then restart the same workspace/config/state scope. Work stays in tmux. Retain the previous verified archive for rollback. Checksums protect integrity; they are not an independent code-signing trust channel.

## Compatibility, rollback and diagnostics

Compatibility is determined by terminal protocol **2**, bridge ABI **1**, negotiated capabilities and the pinned native/WASM dependency tuple. Patch CLI releases may interoperate if those remain unchanged. Wire/semantic breaking changes require a protocol increment and updated fixtures; bridge breaks require an ABI increment. Old frontend manifests/assets are rejected with reload/redeploy instructions. Old CLI protocol/capability failures instruct users to update the CLI and restart serve. Attaching with an old run generation is denied. Never reinterpret a protocol-v1 frame as v2.

Deploy additive schema changes before consumers. The real SQLite upgrade test starts at schema 4 with ownership and ended-session data, migrates to 5 twice and verifies preservation; a deliberately invalid migration rolls back atomically. Existing migration SQL must never be edited. Worker rollback does not roll back Durable Object data. Roll back only to code compatible with the current schema, protocol and ownership ledger; preserve application-owned tmux identifiers/tombstones. Do not downgrade to the old disconnect-kills-shell implementation. Restore the matching entire frontend/runtime asset deployment, and restart CLI agents if their supported protocol changes. Old in-memory browser code can require reload after deployment; reconnect must always obtain fresh grants.

Agent stderr emits fixed JSON lifecycle events for relay startup/readiness/failure, connection admission/closure/limits, successful attachment, access denial and observed process end. It includes no session IDs, commands, terminal output, machine paths, private keys, grants, Tailcat addresses or credentials. Raw upstream WASM WebSocket diagnostics are suppressed. Production app errors emit a fixed `request_failed` event. Do not enable raw Tailcat debug logging in production. Diagnostics are operational signals, not a terminal recording or user activity audit.

Distinguish failures using `/api/health` (app/state), relay TLS/WebSocket probes (relay reachability), dashboard run freshness plus agent events (agent), and authenticated terminal lifecycle/backend errors (process). Offline only means access/availability is lost; shell state can remain unknown. No unauthenticated endpoint exposes an agent descriptor or a user's process state.

## Verification recorded on 2026-11-15

Both Workers deployed successfully, state first, without changing the SQL migration history. Production smoke passed against `https://ssh.amarjay.com`: app/state health, login and development-route gates, CSP, immutable asset caching, runtime/WASM hashes and compilation of the served binary. Go tests/vet, TypeScript checks, shared fixtures, SQLite upgrade/failed-migration atomicity, JavaScript tests, real Go/WASM smoke, four cross-platform archive builds and the local Linux installer/update/corruption tests passed. The tagged [release workflow](https://github.com/amar-jay/webssh/actions/runs/43682989364) passed build/tests, real browser/local-DERP/native-PTY integration, native installer execution on Linux amd64/arm64 and macOS Intel/Apple Silicon, and prerelease publication. The [Verify workflow](https://github.com/amar-jay/webssh/actions/runs/43682346073) also passed. The public-download installer was then run into a fresh temporary directory on Linux amd64: archive checksum, version 0.1.0, tagged commit e2aa267, and serve/sessions help all verified. No signed-in browser surface was available for the deployed journey. Public relay reachability findings and the unverified capacity commitment remain as described above.

## Outstanding release gates

Before calling milestone 6 release acceptance complete: execute signed-in install/pair/serve on clean target machines; complete the deployed signed-in browser journey (including WASM attach, sleep/reconnect, revocation and explicit termination); and establish intended relay capacity/availability with its operator. A successful asset fetch/compile or local parser test does not substitute for that journey.
