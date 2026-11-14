# WebSSH browser transport

`packages/transport` owns our Go/WASM entrypoint and TypeScript API. It imports Tailcat `v0.7.0`; it does not compile or expose the upstream demo bridge. Native code can reuse the Go client lifecycle package without importing CLI code.

This is a transport foundation. The agent server, pairing, authorization grants, terminal framing, PTYs, tmux, and real terminal session integration remain to be implemented. The `/s/<session_id>` route uses the real browser session adapter with a single-use development handoff from `/dev/connect`. Mock sessions require an explicit choice on that development page. See [browser session](browser-session.md).

## Build and use

From the repository root:

```sh
pnpm wasm:build
pnpm --filter @webssh/transport test:wasm
```

The build writes `webssh.wasm.gz`, the matching Go toolchain's `wasm_exec.js`, and version metadata to ignored `apps/web/static/tailcat/`. It does not modify READMEs or fetch a hosted demo binary. The initial build is approximately 33 MiB uncompressed. It currently uses an untrimmed Go build for correctness; version-specific feature omission and compression are future deployment work. Check generated size against the actual hosting platform's limits before deploying.

Call only in browser code, such as a Svelte `onMount` callback:

```ts
import { loadTransport } from '@webssh/transport';

const transport = await loadTransport();
const identity = await transport.generateIdentity();
// Enroll identity.publicKey through our future authorized pairing flow.
// Keep identity.nodePrivateKey secret; persistence is the caller's policy.
const client = await transport.createClient({
  address: authorizedTailcatAddress,
  nodePrivateKey: identity.nodePrivateKey
});
try {
  const conn = await client.dial(applicationPort, { signal });
  try {
    // One reader loop. Await consumption before reading more.
    // A real terminal uses our future frame decoder, not raw stream bytes.
    for (;;) {
      const bytes = await conn.read({ signal });
      if (bytes === null) break;
      await consume(bytes);
    }
  } finally {
    await conn.close();
  }
} finally {
  await client.close();
}
```

The snippet's application variables are placeholders. No shell connection is exposed by this change. The WASM loader is lazy and shared per browser runtime; importing the package during SSR does not start WASM, and calling its loader during SSR rejects.

## Contract and ownership

- Bridge ABI version 1 uses two runtime-global functions: `request` and `cancel`, under `globalThis.websshTailcat`. Clients/streams are numeric handles. There are no per-client JS callbacks retained by Go.
- `generateIdentity()` returns an independent WireGuard client node keypair. This is not an upstream `tailcat.PrivateKey` JSON object and does not contain a server address/PSK. `nodePrivateKey` uses the encoding produced by Go's `key.NodePrivate.MarshalText`.
- `createClient()` validates the address and optional identity without connecting. `client.publicKey` is available before dialing. Omit the identity for a new ephemeral one.
- A client owns one Tailcat backend and can dial multiple TCP streams. Dial startup has a 60-second budget. Closing the client cancels pending dials and closes owned sockets. Close operations are idempotent.
- AbortSignal cancellation is supported for dialing and reading. An aborted dial that returns late is immediately closed. Cancelling an in-flight read closes that stream because retrying a partially consumed operation is unsafe. Cancellation does not destroy other streams on the same client.
- Reads return `Uint8Array` chunks of at most 64 KiB or `null` at EOF. One read may be pending per stream. Reads have no automatic idle timeout, so a quiet terminal remains connected.
- Writes copy caller-owned input, serialize in call order, and split into at most 64 KiB bridge operations. At most 1 MiB may be queued per stream. Queue overflow rejects the new write; the caller should await writes and apply producer backpressure. A failed write poisons the writer queue to prevent silently continuing after uncertain delivery.
- `closeWrite()` queues a TCP half-close after pending writes and prevents further writes. `close()` interrupts pending I/O immediately; it does not wait behind blocked output. EOF does not automatically close the client; always dispose it explicitly.
- There is no listener, UDP, terminal protocol, or status API in this initial bridge. It can be extended deliberately with a new compatible operation or an ABI version change.

The Go Promise executor callback is released after synchronous Promise construction. Only the two global bridge callbacks remain registered for the WASM runtime's lifetime. Request cancellation records are removed on completion; stream handles are removed on explicit stream/client close. Always close streams after EOF/errors to release handles as well as sockets.

The loader uses same-origin `/tailcat/` paths and buffers the WASM before instantiation, so it does not depend on streaming MIME configuration. It fetches the gzip asset and decompresses it with the browser’s DecompressionStream before instantiation, keeping the uploaded asset below Cloudflare’s individual file limit. It does not yet implement download progress. Hosts with an application base path need a loader path configuration before using this default. Configure HTTPS/WSS, relay origins, CORS, CSP, and WASM execution policy at deployment.

## Verification

`pnpm go:test` covers native lifecycle behavior with in-memory sockets, including pending-dial cancellation and late-socket cleanup. Transport JavaScript tests exercise ordering, queue bounds, cancellation races, ownership, and SSR rejection. `test:wasm` executes the real compiled Go bridge in Node to check readiness, identity encoding, argument errors, and cleanup operations. It requires the generated assets first and deliberately terminates its process because the WASM program stays alive.

These tests do not establish browser-to-agent connectivity through a real relay. A browser/local-DERP integration test and terminal protocol tests are required when wiring the agent and terminal route.
