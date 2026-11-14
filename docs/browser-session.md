# Browser session adapter

`apps/web/src/lib/terminal/remote-session.ts` composes the owned Tailcat transport, Protobuf framing, and the existing terminal controller. It accepts connection credentials in memory; pairing and session-ID lookup remain the caller's responsibility. The existing route still uses mocks until a credential source is wired in.

```ts
const session = attachRemoteSession(controller, {
  address: descriptor.address,
  port: descriptor.port,
  token: descriptor.token
}, {
  signal: abortController.signal,
  onState(state) {
    // Render fixed terminal status text for connecting/ready/failed/
    // disconnected/exited/disposed. An exit includes the process code.
  }
});

// On component disposal, before disposing the terminal:
session.dispose();
// Optional completion notification; normal failures resolve with a state.
const outcome = await session.done;
```

The adapter loads the shared runtime lazily, creates its own client, sends initial terminal size in attach, and enables input after ready. Text input is UTF-8; xterm binary input preserves byte values. Large input is split at the protocol limit; the pending writer queue is bounded to 1 MiB and closes on overflow. Resize changes in the same microtask are coalesced. Output parsing awaits xterm's write callback before reading further.

An agent handshake must complete within ten seconds after dialing. The transport separately bounds dialing. There is no idle timeout after readiness. EOF without exit is a disconnect, malformed/unexpected frames are failures, and an exit reports its code. No input is replayed, no automatic reconnect occurs, and no mock fallback is installed. These behaviors match the current connection-scoped agent.

Disposal aborts dialing/reads, closes owned resources (including late results), removes listeners, and releases pending output waits. The shared WASM runtime and caller-owned terminal remain outside the adapter's lifetime. Status callbacks receive fixed state names and exit codes, never credentials or raw remote errors. The adapter deliberately does not draw UI; the caller controls terminal status presentation.

Tests use fake transport endpoints with real Protobuf frames to verify handshake, bytes, resize, backpressure, timeout and cleanup. Real browser-to-relay testing is still the next integration gate.
