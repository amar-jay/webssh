# Browser session adapter

`apps/web/src/lib/terminal/remote-session.ts` composes the owned Tailcat transport, Protobuf framing, and the existing terminal controller. It accepts connection credentials in memory; pairing and session-ID lookup remain the caller's responsibility. In local development, `/dev/connect` accepts the CLI JSON record and navigates to `/s/<opaque_id>` using a single-use in-memory handoff. Reloading or a new tab cannot recover the credential. The connection form is restricted to loopback hosts and returns 404 in production. Only real agent connections are supported; the temporary simulated terminal has been removed.

```ts
const session = attachRemoteSession(
  controller,
  {
    address: descriptor.address,
    port: descriptor.port,
    token: descriptor.token,
  },
  {
    signal: abortController.signal,
    onState(state) {
      // Render fixed terminal status text for connecting/ready/failed/
      // disconnected/exited/disposed. An exit includes the process code.
    },
  },
);

// On component disposal, before disposing the terminal:
session.dispose();
// Optional completion notification; normal failures resolve with a state.
const outcome = await session.done;
```

The adapter loads the shared runtime lazily, creates its own client, sends initial terminal size in attach, and enables input after ready. Text input is UTF-8; xterm binary input preserves byte values. Large input is split at the protocol limit; the pending writer queue is bounded to 1 MiB and closes on overflow. Resize changes in the same microtask are coalesced. Output parsing awaits xterm's write callback before reading further.

An agent handshake must complete within ten seconds after dialing. The transport separately bounds dialing. There is no idle timeout after readiness. EOF without exit is a disconnect, malformed/unexpected frames are failures, and an exit reports its code. No input is replayed, no automatic reconnect occurs, and failures remain explicit. These behaviors match the current connection-scoped agent.

Disposal aborts dialing/reads, closes owned resources (including late results), removes listeners, and releases pending output waits. The shared WASM runtime and caller-owned terminal remain outside the adapter's lifetime. Status callbacks receive fixed state names and exit codes, never credentials or raw remote errors. The adapter deliberately does not draw UI; the caller controls terminal status presentation.

Tests use fake transport endpoints with real Protobuf frames to verify handshake, bytes, resize, backpressure, timeout and cleanup. Real browser-to-relay testing is still the next integration gate.

## Run the local terminal

1. Run `pnpm wasm:build` after changes to Go transport code (or on a clean checkout).
2. Run `pnpm dev` and open `http://localhost:5173/dev/connect`.
3. In another terminal, run `GOMAXPROCS=2 go run -p 1 ./apps/cli/cmd/webssh serve --backend ephemeral --dev-token --json <workspace>`.
4. Paste the record into the form and choose Connect. Keep that record private. Only the random handoff ID enters the session URL.

The route shows connecting, ready, failure, process exit and disconnect messages within xterm. Real-session disposal closes its stream/client before the terminal is destroyed. The app exposes no production credential lookup endpoint. Development screen-reader mode also makes rendered terminal content available to accessibility tools and the integration test.

## Real browser integration test

With dependencies and WASM assets installed, run `pnpm test:browser`. It launches a local WebSocket-capable DERP/STUN relay, a native agent, a temporary Vite server and headless Chromium. Set `CHROME_BIN` to your Chromium executable if it is not `/snap/bin/chromium`. The test requires `vi` and `stty` on the agent host. The command disables Go test-result caching so changes to the JavaScript browser harness always run against a real browser.

The test verifies invalid credentials, Unicode output, multiline paste, Ctrl+C, PTY resize, editing a file with vi, exit code, empty handoff after reload (the picker metadata request returns 401 without requesting a grant), and route disposal with shell reaping. It also exercises the actual picker UI with test-only metadata: keyboard selection and clicking New session must precede any grant request, and both grant requests remain unauthorized. Those HTTP fixtures live only in the test and never authorize a shell. Credentials are generated per run and held in a temporary file with mode 0600; they are not command arguments, committed fixtures, browser storage, screenshots or traces. The test closes browser/server processes and the native agent on completion. Go uses two threads and one package at a time.

WASM delivery accepts both raw gzip bytes from static hosts and browser-decoded responses from hosts that set Content-Encoding. The loader checks the gzip magic bytes to avoid double decompression.

The temporary localhost sign-in bypass has been removed. Local account pages require the normal OAuth configuration and state service; `/dev/connect` remains a loopback-only test connector to a real development agent.
