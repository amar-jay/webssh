# Understanding Tailcat

This is WebSSH's source-based integration reference, reviewed on **2026-11-14**. It separates Tailcat behavior from proposed WebSSH behavior; it does not mean the transport has already been implemented here.

## Version and evidence

Our Go module currently requires `github.com/tailscale/tailcat v0.7.0`. The downloaded Go module's origin is commit **`15ab9e68bfc6534a61797d7af28cedd42b54a3a5`**. This document uses that source as its API baseline. Upstream `main` was **`e00cdde6ff787f801361ff85ed085775c775d4c5`** when reviewed, 18 commits ahead. Do not copy examples from `main` into our pinned dependency without checking compatibility.

The pinned module's changelog still calls its newest section “Unreleased”; later upstream changelog edits assign a release heading and include further changes. Use actual source and commit identities to decide which APIs exist. Recheck this guide whenever upgrading Tailcat or its `tailscale.com` dependency.

The documentation index lookup did not contain Tailscale's Tailcat (it returned the unrelated Tailchat). This guide is based on upstream implementation, examples, tests, and security documentation instead.

Primary source links are pinned to the baseline where possible:

- [Overview and usage](https://github.com/tailscale/tailcat/blob/15ab9e68bfc6534a61797d7af28cedd42b54a3a5/README.md)
- [Go transport implementation](https://github.com/tailscale/tailcat/blob/15ab9e68bfc6534a61797d7af28cedd42b54a3a5/tailcat.go), [listeners](https://github.com/tailscale/tailcat/blob/15ab9e68bfc6534a61797d7af28cedd42b54a3a5/listen.go), [address encoding](https://github.com/tailscale/tailcat/blob/15ab9e68bfc6534a61797d7af28cedd42b54a3a5/wire.go)
- [Browser Go/WASM bridge](https://github.com/tailscale/tailcat/blob/15ab9e68bfc6534a61797d7af28cedd42b54a3a5/web/main_js.go), [demo JavaScript](https://github.com/tailscale/tailcat/blob/15ab9e68bfc6534a61797d7af28cedd42b54a3a5/web/app.js), [browser tests](https://github.com/tailscale/tailcat/blob/15ab9e68bfc6534a61797d7af28cedd42b54a3a5/web/wasm_test.go)
- [WASM builder](https://github.com/tailscale/tailcat/blob/15ab9e68bfc6534a61797d7af28cedd42b54a3a5/internal/wasmbuild/wasmbuild.go), [static HTTP handler](https://github.com/tailscale/tailcat/blob/15ab9e68bfc6534a61797d7af28cedd42b54a3a5/webdemo/webdemo.go)
- [Security model](https://github.com/tailscale/tailcat/blob/15ab9e68bfc6534a61797d7af28cedd42b54a3a5/SECURITY.md), [changes since our baseline](https://github.com/tailscale/tailcat/compare/15ab9e68bfc6534a61797d7af28cedd42b54a3a5...e00cdde6ff787f801361ff85ed085775c775d4c5)

## What it provides

Tailcat assembles Tailscale's data-plane components into an embeddable userspace transport. It supplies encrypted connectivity without a Tailscale account, a tailnet, the Tailscale control plane, root privileges, or changes to host routing and DNS.

| Component | Responsibility |
| --- | --- |
| WireGuard | Authenticates node keys and encrypts peer traffic, optionally strengthened by a pre-shared key (PSK). |
| DERP | Initial rendezvous and relay when a direct path is unavailable. |
| magicsock | Endpoint discovery, NAT traversal, and selection of relay/direct paths. |
| gVisor netstack | Userspace TCP/UDP sockets carried inside the tunnel. |
| Tailcat wrapper | Addresses, peer introduction, configuration, listeners, and convenience services. |
| WebSSH | User identity, pairing, authorization policy, terminal protocol, PTYs, tmux, persistence, and reconnect UX. |

A Tailcat TCP connection is an ordinary byte stream to the application. It is not a WebSocket, SSH session, PTY, or terminal protocol. Tailcat separately offers optional SSH and file services built on that transport.

### Connection sequence

1. The agent configures and starts a `tailcat.Server` (or calls `Listen`, which starts it).
2. It obtains a `tc...` address and distributes that address through an application-controlled channel.
3. A client parses that address, resolves relay details if necessary, and establishes its own DERP connection.
4. Tailcat's `meow`/`meowed` introduction exchanges node/discovery information and admits the client according to server policy.
5. WireGuard establishes encrypted communication; the application dials a virtual TCP port.
6. Native peers can discover and switch to direct UDP paths. Browser peers remain DERP-relayed in the reviewed implementation.

The introduction is not a WebSSH user login. Application authorization must complete before an accepted connection can create or attach to a shell.

## Browser networking changes the design

The WASM transport connects to DERP over **WebSockets**, handled by `tailscale.com/derp/derphttp` under `GOOS=js`. This WebSocket carries DERP traffic; it is not a WebSSH terminal WebSocket endpoint.

Browsers cannot open the raw UDP sockets needed by this implementation's native path discovery. There is no implemented WebRTC direct transport in the reviewed version. Therefore, for our browser-to-agent use case:

- Relay latency, capacity, availability, and rate limits affect every terminal session.
- A browser connection remaining relayed is expected, not a failed NAT traversal.
- Running our own WASM wrapper would not itself enable peer-to-peer browser networking.
- Cloudflare can host the app and application state, while terminal traffic travels through DERP to the agent. A Durable Object is not automatically the relay.

Browser region selection also differs: `pickregion_js.go` cannot perform native STUN probing. It returns no preferred region and relies on map filtering/fallback selection. Do not describe that as measuring the nearest relay from the browser.

## Addresses, keys, and persistence

`tailcat.Addr` is a case-sensitive string: `tc` followed by base64url-encoded CBOR. It serializes connection information, not an application session record. Its wire encoding lives in `wire.go`; use Tailcat's parser instead of duplicating it in JavaScript.

`ConnInfo` carries:

- `ServerPublic`: the server's WireGuard node public key.
- `ServerDiscoPublic`: a separate path-discovery public key. New manually constructed connection info must include it; the client rejects legacy addresses lacking it.
- `PresharedKey`: an independent secret mixed into the WireGuard handshake.
- `RegionID` or embedded `Region` details identifying the bootstrap relay.

**Treat the entire address as a credential.** With default open admission, someone who obtains it can reach the exposed service. PSKs are generated by default and should remain enabled. They also prevent a relay operator that observes node public keys from joining the tunnel merely from that knowledge.

`Server.TailcatAddr()` returns an address with embedded relay details after startup. This avoids a separate map fetch by the client. Compact addresses with only a region ID require map resolution. `ParseAddr` validates/decodes, `ConnInfo.Expand` resolves relay information, and `Addr.Resolve` produces a self-contained address. These operations do not authenticate a WebSSH user.

`NewPrivateKey()` creates node identity, discovery information, and a PSK, but the caller still supplies the region. Despite its name, **`PrivateKey.Public` contains a PSK and is secret**. A serialized `PrivateKey` additionally contains the node private key.

For a stable agent across restarts, restore the node private key, PSK, and consistent relay selection. Restoring only the node key is insufficient: a newly generated PSK invalidates old addresses. Letting the relay change also makes previously shared rendezvous information unreliable.

Proposed WebSSH handling:

- Keep `/s/<session_id>` an opaque application identifier, separate from the Tailcat credential.
- Release connection credentials only after checking session ownership/access.
- Keep credentials out of route paths, analytics, exception reports, and routine logs.
- Decide explicitly whether the server can read stored credentials or stores an encrypted envelope. Tailcat does not settle this trust decision.
- Define address/key rotation and expiry at the application layer; Tailcat addresses have no built-in session expiry.
- Keep any future key storage separate from questionnaire settings in `~/.webssh/config.toml`, with restrictive file permissions. This storage layout is still a design decision.

The Tailcat CLI's own saved-key conventions (`default`, `client-default`, and its config directory) belong to that CLI. Embedding the Go library does not automatically load those files or honor its environment-variable defaults.

## Go API at our pinned version

Configure fields before `Start` or the first `Listen`. Avoid mutating configuration concurrently after startup except through documented methods.

### Server

| API/configuration | Behavior |
| --- | --- |
| `Server{}` | Usable defaults: ephemeral identity/PSK, relay selection, default logging. |
| `Start() error` | Explicit startup; starting twice returns an error. No context argument at this version. |
| `Listen(ctx, "tcp", ":PORT")` | Starts if needed; returns a `net.Listener` on a virtual tunnel port. |
| `TailcatAddr()` | Connection credential; only call after successful startup. |
| `Addr()` | Virtual IP, distinct from the shareable `tc...` address. |
| `OnTCP` / `OnUDP` | Per-port handler factories, set before startup. Nil handlers reject/drop traffic. |
| `OnTCPForward` / `OnUDPForward` | Traffic addressed through the server to other destinations; relevant to exit-node behavior. |
| `AllowedClients` | Initial allowed node keys. Empty means **allow everyone**. |
| `AddAllowedClient(k)` | Adds an allowed key; does not implement revocation. |
| `ServedTCPPorts` / `ServedUDPPorts` | Additional packet-filter restrictions for callback-served ports. |
| `Status()` | Includes peers and path details such as `CurAddr` and `Relay`. |
| `Close()` | Closes listeners, active connections, and backend resources. |
| `DrainTCP(ctx)` | Specialized bounded teardown support before process exit; see cautions below. |

Prefer a listener for a single WebSSH application port. It accepts standard Go handlers without opening an operating-system TCP listener. An active listener takes precedence over `OnTCP`/`OnUDP` for that port.

`Listen` accepts `tcp`, `tcp6`, `udp`, and `udp6`. A port of `0` picks an unused virtual port obtainable from the listener's `Addr()`. The host must be empty, unspecified, or the server's virtual IP. After `Listen` returns, cancelling its startup context does **not** stop the listener. Close it explicitly. Closing a listener leaves accepted connections alive; closing the whole server closes them.

UDP listeners unusually return a `net.Listener`: each `Accept` returns one client flow as a `net.Conn` also implementing `ConnPacketConn`. Datagram boundaries are preserved. Idle incoming UDP flows expire after two minutes by default. This is useful background, but TCP is the appropriate initial terminal transport.

### Minimal transport-only server example

This example illustrates the pinned API and deliberately does not launch a shell. Exposing a shell requires authorization and our session protocol first.

```go
package main

import (
    "context"
    "io"
    "log"
    "net"
    "time"

    "github.com/tailscale/tailcat"
    "tailscale.com/types/logger"
)

func main() {
    srv := &tailcat.Server{Logf: logger.Discard}
    defer srv.Close()

    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()
    ln, err := srv.Listen(ctx, "tcp", ":8022")
    if err != nil {
        log.Fatal(err)
    }
    defer ln.Close()

    // Deliver srv.TailcatAddr() privately to an authorized client here.
    for {
        conn, err := ln.Accept()
        if err != nil {
            return
        }
        go func(c net.Conn) {
            defer c.Close()
            _, _ = io.Copy(c, c) // Echo only; replace with an authorized protocol handler.
        }(conn)
    }
}
```

Port `8022` here is an example application port inside the tunnel, not an SSH declaration or a bound host port. Our protocol must agree on the port or communicate it separately; the Tailcat address does not encode an application TCP port.

### Client

`NewClient(addr)` or `&Client{Server: addr}` creates a client. Set `Key`, `Logf`, `DERPMapURL`, and `DERPMapCache` before first use. Without `Key`, it generates an ephemeral identity.

- `PublicKey()` provides the effective client node key, including before connecting; native code can use this for allowlist enrollment.
- `Ping(ctx)` starts the transport and tests the Tailcat introduction path.
- `DialTCPPort(ctx, port)` opens a stream to a server-local virtual port; reuse a client for multiple streams in native Go.
- `Dial(ctx, network, address)` uses the tunnel's dialer.
- `DialTCP(ctx, netip.AddrPort)` and corresponding UDP methods support arbitrary destinations when the server supplies forwarding behavior. They do not automatically make the server an exit node.
- `DiscoPing(ctx)` provides path diagnostics; `Close()` shuts down the client backend.

Apply deadlines to application handshakes and idle work as well as dialing. A successful dial alone says nothing about application session authorization.

## Existing JavaScript/WASM API

The browser package is a Go `main`, not an npm module or a stable TypeScript SDK. On startup it installs two globals and calls `globalThis.onTailcatReady()` if present. It then stays alive. The reviewed bridge is small enough to adapt later, but already supports our first raw-stream prototype.

```ts
interface TailcatConnection {
  port: number;
  read(): Promise<Uint8Array | null>;
  write(bytes: Uint8Array): Promise<void>;
  closeWrite(): Promise<void>;
  close(): void;
}

interface TailcatDialOptions {
  addr: string;
  derpMapURL?: string;
  privateKey?: string; // JSON encoding of tailcat.PrivateKey
  port?: number;      // Defaults to 1; WebSSH must pass its agreed port.
  verbose?: boolean;
}

// Conceptual declarations; these types are not installed in our app yet.
declare function tailcatDial(options: TailcatDialOptions): Promise<TailcatConnection>;
declare function tailcatListen(options: {
  derpMapURL: string;
  privateKey?: string;
  verbose?: boolean;
  onConnection(conn: TailcatConnection): void;
}): Promise<{
  addr: string;
  privateKeyJSON: string;
  close(): void;
}>;
```

### Dial behavior and limitations

`tailcatDial` generates a fresh client identity unless supplied key JSON. It repeatedly pings with five-second attempt budgets within a 60-second overall budget, then opens TCP. Each call creates its own Go `Client`; `conn.close()` also closes that client. It is not a shared multi-stream client API.

`read()` is pull-based, returns up to 64 KiB per call, and returns `null` on EOF. **Never call `read()` concurrently on one connection**: it shares a Go read buffer. Await writes in order through one writer queue; do not assume independently launched promises serialize application messages. Handle rejected promises and EOF explicitly, and always close the connection.

The bridge does not expose AbortSignal cancellation, client public-key discovery before dialing, UDP, status/ping diagnostics, explicit client reuse, application multiplexing, or server allowlist options. Its numeric port is cast to `uint16` without a public validation layer; validate an integer in `1..65535` in our wrapper.

The source creates `js.Func` callbacks without comprehensive release management. Closing network objects is essential, but do not assume it releases all Go/JS bridge allocations. Repeated connect/disconnect tests should include memory observation; a custom bridge should track callback ownership and release functions when safe.

### Listening from a browser

`tailcatListen` requires an absolute map URL and an `onConnection` callback. It accepts any virtual TCP port through `OnTCP`, returns the address and private-key JSON, and can restore a saved identity. Newly created identities pin the selected region for persistence; old persisted keys without PSKs are migrated to a new PSK/address.

This supports the upstream send/receive demo, but WebSSH's initial direction should be **agent listens, browser dials**. We do not need to expose a browser listener or copy the demo's localStorage key-persistence policy.

## WASM choice, build, and hosting

**Recommendation for the first milestone:** build the existing upstream `web` package from the same pinned source as the native agent and provide a small WebSSH TypeScript adapter. We can replace the exported bridge later without replacing WireGuard, DERP, or netstack.

A custom Go/WASM entrypoint becomes justified if we need cancellable dialing, pre-connect key enrollment, shared clients across streams, path diagnostics, stricter lifecycle management, or terminal-specific operations in Go. It should import Tailcat as a dependency rather than fork the transport. Go's `internal` rules prevent our module from importing Tailcat's `internal/wasmbuild` or `internal/buildtags` directly.

To build the upstream distribution, run these commands **inside a separate checkout of the reviewed source**, not in WebSSH's repository root:

```sh
git checkout 15ab9e68bfc6534a61797d7af28cedd42b54a3a5
go run ./cmd/tailcat-webdist -o ./dist
```

This builds `main.wasm`, `main.wasm.gz`, `main.wasm.zst`, copies the matching Go toolchain's `wasm_exec.js`, and copies the demo `index.html` and `app.js`. WebSSH only needs the runtime/WASM assets and our loader; it does not need the demo UI. `cmd/tailcat-web` is the upstream local demo server.

The builder uses `GOOS=js GOARCH=wasm`, stripped symbols, and generated WASM-specific omission tags. The native release tag list is different. If we create a custom build, derive/review tags against the exact dependency versions; do not blindly copy a tag string across upgrades. Newer upstream also changes the native feature keep-list for networking.

The loader must:

1. Run only in the browser, never during SvelteKit SSR.
2. Load the matching `wasm_exec.js` and construct `new Go()`.
3. Install the readiness callback before starting the instance.
4. Instantiate the WASM with `go.importObject`, start `go.run(instance)`, and wait for readiness. Do not await `go.run` as a readiness signal: the program intentionally stays running.
5. Handle fetch, instantiation, runtime, and readiness failures. Load once per browser runtime rather than once per route component.
6. Close per-session streams on route disposal, including connections that finish dialing after disposal.

Serve WASM as `application/wasm`. The binary is large (upstream describes tens of MB uncompressed); measure actual built/compressed sizes before deciding how to deploy it. Use versioned assets and correct caching. Keep Go runtime and WASM versions paired.

Upstream's static handler negotiates precompressed files and sends `Content-Encoding` plus `Vary: Accept-Encoding`. Its demo can instead fetch `.gz` and decompress with `DecompressionStream` on static hosts. These are different strategies: a `.gz` file alone does not configure Cloudflare's asset response headers. Check platform asset limits and compression behavior when implementing deployment.

The browser needs permission to fetch the WASM/map and connect to relay WebSocket origins. Configure CSP `connect-src`, applicable WASM execution policy, HTTPS/WSS, and CORS for cross-origin map fetching. Own relays must support the browser WebSocket transport; native DERP connectivity alone is not enough proof.

## Relay discovery and operations

The default map endpoint is `https://tailcat.dev/derpmap.json`; the default public relays are rate-limited. A production browser terminal should have an explicit relay plan because it continuously uses relaying.

Native servers can set `Region`, `RegionID`, or `DERPMapURL`. A supplied region bypasses fetching the map. Clients can set a custom map URL when addresses do not already embed relay details. With embedded relay information, clients use those details rather than relying on a different map URL to redirect the address.

The Go library's default map cache is process-wide memory. `DERPMapCache` permits persistent storage. The fetcher uses a cached map younger than one hour directly, revalidates older maps with ETags, and can fall back to cached data on fetch failure. The Tailcat CLI adds its own disk cache; WebSSH's embedded library does not automatically inherit it.

We can run a TLS-enabled DERP server and distribute its region information or a custom map. That makes capacity and availability ours to operate; it does not remove the need for authorization. Plan relay geography, WebSocket support, bandwidth limits, egress costs, monitoring, and failure handling. The pinned connection-info format supports at most one advertised region, so do not assume automatic multi-region agent failover.

## Terminal protocol and xterm integration

The existing bridge's raw stream is enough to carry our own protocol. **Passing raw shell bytes in both directions is insufficient** once we need resize, attach, exit status, errors, and authorization.

Proposed division of work:

| Layer | WebSSH responsibility |
| --- | --- |
| `apps/web` | Load WASM, obtain authorized connection information, adapt streams, feed xterm, forward input/resize, dispose cleanly. |
| `apps/cli/internal/agent` | Own transport lifecycle, authenticate requests, create/attach PTYs or tmux sessions, enforce session policy. |
| `apps/state` and web server | Application identity, ownership, pairing records, session metadata, authorized connection-info delivery. |
| `packages/protocol` | Versioned frame contract and cross-language fixtures. |

A candidate single-stream contract needs a versioned handshake, authenticated attach request, terminal type/dimensions, input/output bytes, resize messages, exit/error messages, and explicit detach behavior. This is a proposal, not an existing Tailcat protocol. Define maximum frame sizes, encoding, and valid state transitions before implementing it.

TCP reads do not preserve message boundaries: a header can span reads, or several frames can arrive in one read. Use an incremental decoder with bounded buffers. Keep terminal output as bytes (`Uint8Array`); avoid decoding each read independently, which can corrupt split UTF-8 sequences. Encode text input explicitly and handle xterm binary input according to its API.

Use one reader loop and one ordered, bounded writer queue. Upstream's pull-based reading gives transport backpressure only if we stop requesting data when the terminal consumer is busy; connect that loop to xterm's write-completion mechanism. Bound pasted-input queues and coalesce rapid resize updates. Do not let slow rendering accumulate unbounded output arrays.

The xterm Attach addon expects a WebSocket and cannot attach directly to this connection object. Our adapter belongs at the existing terminal controller's input/output boundary; it will replace mock-session attachment when ready.

## PTYs, SSH, tmux, and reconnects

Tailcat's built-in SSH service is optional. `SSHConnHandler(SSHOptions{Shell: true})` can serve a shell, PTY resizing, commands, and SFTP on supported native platforms (Linux/macOS/Windows, unless SSH is omitted by build tags). Configured `AuthorizedKeys` requires a matching SSH key; absent keys rely on tunnel identity/admission. `Exec` forces a command instead and disables shell/client-chosen commands/SFTP.

The JS bridge exposes raw TCP, not an SSH client. Dialing virtual port 22 would produce SSH protocol bytes, which xterm cannot interpret. Using built-in SSH would require a browser-side SSH implementation/bridge and SSH policy. For our current architecture, a custom terminal protocol backed by an agent-owned PTY is the more direct integration.

`ExecConnHandler` starts a process with connection stdin/stdout and server-local stderr. It does not itself provide a PTY, resize messages, session persistence, or a workspace directory setting. It is not a complete terminal-session implementation.

Built-in shell sessions run with the operating-system permissions of the agent user. WebSSH's `serve <path>` should set the initial workspace directory; it is **not a filesystem sandbox**. Tailcat's rooted file service uses `os.Root` for SFTP confinement, but that does not confine an unrestricted shell. Shell-enabled SSH also offers broad SFTP access by default unless configured otherwise.

`Server.PeerEnv(local, remote)` exposes authenticated tunnel peer information to subprocesses, including `TAILCAT_PEER_KEY`. At our pinned version there is no exported `PeerKey` method; that arrives later.

Tailcat does not implement tmux or durable terminal sessions. A new connection after a disconnect does not automatically resume a PTY or replay lost output. We must define session identity, tmux lifecycle, browser reattachment, ownership, whether multiple viewers can attach, input arbitration, and resize ownership. tmux can preserve a process across browser disconnects; it does not by itself define application-level delivery/replay semantics.

Do not blindly resend input after a transport failure: the shell may have processed it before disconnection. Reconnect with backoff and fresh authorization, then reattach according to our protocol. Test browser reload, sleeping tabs, agent restart, relay failure, and explicit session termination separately.

## Authorization and revocation

The upstream security document describes Tailcat's wrapper as experimental, historically built for a person controlling both ends. WebSSH must account for the stronger threat model introduced by hosted accounts and remote shell access.

At the pinned version:

- An empty `AllowedClients` list permits all clients that know the address. It does not deny everyone.
- Adding allowed clients is supported; removing/disconnecting an admitted client is not exposed as a public API.
- Node-key identity does not automatically map to a WebSSH account or session permission.
- The JS dial API can supply a private identity but cannot expose its generated public key before connecting. Account-based key enrollment needs extra bridge/API work or a separately designed enrollment process.

We should authenticate/authorize at the application handshake before spawning or attaching a terminal, track active application connections, and close them when access is revoked. A short-lived grant could be part of that design, but its format, issuer validation, replay policy, and key binding remain decisions. Never equate a publicly visible session ID with authorization.

Preserve PSKs, protect private keys, and avoid publishing shell credentials in DNS or logs. Encryption protects transport contents; it does not make an XSS-compromised authorized browser trustworthy.

### Newer upstream APIs: unavailable in our current dependency

At reviewed `main`, the important differences are:

| New API/change | Implication |
| --- | --- |
| `Server.AllowClient func(key.NodePublic) bool` | Replaces `AllowedClients` and `AddAllowedClient`; nil still permits all. Configure before startup. |
| `KeySet` | Thread-safe allowed-key collection; `Contains` can be the admission callback. |
| `Server.DisconnectClient(k)` | Removes peer routing; existing connections stall rather than receiving resets. Reject the key in admission first to prevent reconnection. |
| `Server.PeerKey(remote)` | Identifies accepted connections/flows by their authenticated node key. |
| `Server.StartContext(ctx)` | Bounds explicit startup; cancellation after startup does not stop the server. |
| `Client.DERPRegion()` | Exposes the selected relay after startup. |
| Native shared-library API | Adds a C-compatible embedding route; unrelated to the existing JS bridge. |

The new admission hook is consulted for clients not already connected, runs without the server lock held, and may block. Rejected clients retry, so expensive lookups should cache negative decisions. It is not a per-request authorization callback. Removing a key from a `KeySet` alone does not revoke an already connected peer.

Upstream also adds performance tooling and networking/shutdown fixes. Review dependency and build-tag changes alongside API changes before upgrading. There is no upgrade performed as part of writing this document.

## Shutdown and troubleshooting

Because TCP runs inside the process, exiting immediately can lose final queued data or teardown packets. `ProxyConns` handles bidirectional copying/half-close, and specialized `DrainTCP` methods exist for bounded final teardown. The server drain is intended for the passive closer; using it as a general shutdown wait can hang on TCP states until its context expires. Use explicit ownership, bounded deadlines, and the source comments rather than treating drain as an unconditional step before every disconnect.

Close application streams, stop listeners, and release the server/client backend in a deliberate shutdown sequence. Listener closure and accepted-stream closure are separate operations. A browser read returning EOF still needs connection cleanup; it is not a process-exit message.

| Symptom | First checks |
| --- | --- |
| Browser never becomes ready | Asset HTTP status/MIME, matching runtime, WASM policy, loader error handling, readiness callback timing. |
| Dial times out | Correct credential and port, agent alive, same relay, PSK/key persistence, admission policy, HTTPS/WebSocket/CSP restrictions. |
| Native works, browser fails | Relay WebSocket support and browser network policy; do not depend on native direct UDP. |
| Connection works, screen stays blank | Application framing/handshake, reader ownership, PTY creation, initial size, output pump. |
| Corrupted output | Incremental frame decoding, byte handling, concurrent reads/writes, split UTF-8. |
| Extra latency or low throughput | Relay region/capacity/rate limiting, terminal render backpressure, browser throttling. |
| Reconnect starts a new shell | Agent/session persistence and attach behavior; Tailcat does not restore a shell. |
| Previously shared address stops working after restart | Restored node key, PSK, relay information, or intentionally rotated identity. |

Avoid logging addresses/key JSON while diagnosing. Native `Status()` and `DiscoPing` can distinguish relay/direct paths; the existing JS bridge does not expose these diagnostics.

## Validation plan and reading map

Upstream tests exercise TCP/UDP, address validation, PSKs, half-close, active-connection shutdown, listener semantics, and status reporting. Browser tests build WASM, run a local WebSocket-capable DERP, and exchange data with native Go via headless Chrome. They are opt-in (`-run-headless-browser-tests`) and are valuable examples for a hermetic WebSSH transport test. Reading those tests is not evidence that our application has passed them.

For WebSSH's first real transport milestone, verify:

1. Browser/native binary interoperability from the same pinned source using a local relay.
2. Authorized attach succeeds and unauthorized/expired requests never create a PTY.
3. Input, output, Unicode, paste, resizing, and command exit work through the frame decoder.
4. Output remains bounded with a slow consumer and input ordering survives rapid typing/paste.
5. Browser disposal during a pending dial closes any eventual connection.
6. Detach/reconnect preserves the intended tmux session without replaying input.
7. Agent shutdown, relay interruption, and revocation close or fail sessions according to policy.
8. Built assets deploy within the actual Cloudflare hosting limits and browser policies.

For deeper source work:

| Files | Read for |
| --- | --- |
| `tailcat.go` | Server/client startup, DERP maps/cache, peer admission, netstack, status, dialing, teardown. |
| `listen.go`, `listen_test.go` | Standard listener API, port ownership, UDP flows, closure. |
| `disco.go`, `wire.go`, associated tests | Peer introduction and address representation/validation. |
| `web/main_js.go`, `web/app.js` | Actual JS bridge, loader, demo protocol and persistence choices. |
| `web/wasm_test.go` | Browser/native interoperability with a local WebSocket DERP. |
| `tailcat_ssh*.go`, `tailcat_exec.go` | Optional SSH/PTY/process behavior and peer environment. |
| `tailcat_files.go`, `tailcat_sftp.go` | File-service modes, SFTP access, rooted paths. |
| `internal/wasmbuild`, `internal/buildtags`, `webdemo` | Asset generation, feature omission, compression/serving. |
| `cmd/tailcat` | CLI policy and convenience features; do not assume these are automatic library behavior. |
| `SECURITY.md`, `CHANGELOG.md`, `go.mod` | Threat model, API evolution, tightly coupled dependencies. |

The source is BSD-3-Clause licensed; preserve required notices when redistributing upstream code/assets. Before implementation, the remaining product decisions are pairing and credential delivery, key persistence/rotation, relay operation, session authorization, terminal framing, and reconnect semantics. Tailcat supplies the encrypted stream underneath those choices.
