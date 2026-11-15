import {
  Decoder,
  encode,
  maxDataSize,
  defaultPort,
  version,
  type Message,
} from "@webssh/protocol";
import { loadTransport, type ClientOptions } from "@webssh/transport";
import type { SessionTerminal } from "./create-terminal.js";

type Stream = {
  read(options?: { signal?: AbortSignal }): Promise<Uint8Array | null>;
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
};
type Client = {
  dial(port: number, options?: { signal?: AbortSignal }): Promise<Stream>;
  close(): Promise<void>;
};
export interface SessionTransport {
  createClient(options: ClientOptions): Promise<Client>;
}
export interface Connection extends ClientOptions {
  token: string;
  port?: number;
  sessionId?: string;
  backend?: "tmux" | "ephemeral";
  existing?: boolean;
}
export type SessionState =
  | "connecting"
  | "ready"
  | "exited"
  | "disconnected"
  | "failed"
  | "disposed"
  | "detached"
  | "terminated";
export interface SessionResult {
  state: SessionState;
  code?: number;
  reason?: string;
  retryable?: boolean;
}

/** One connection-scoped shell. The caller owns credentials and terminal lifetime.
 * No input is replayed or queued before the agent acknowledges attachment.
 */
export function attachRemoteSession(
  controller: Pick<SessionTerminal, "terminal">,
  connection: Connection,
  options: {
    transport?: SessionTransport;
    signal?: AbortSignal;
    onState?: (state: SessionResult) => void;
    heartbeatMs?: number;
    silenceTimeoutMs?: number;
    handshakeTimeoutMs?: number;
    connectionTimeoutMs?: number;
  } = {},
): {
  dispose(): void;
  detach(): void;
  terminate(): void;
  done: Promise<SessionResult>;
} {
  const terminal = controller.terminal;
  const lifetime = new AbortController();
  let client: Client | undefined;
  let stream: Stream | undefined;
  let result: SessionResult | undefined;
  let complete!: (state: SessionResult) => void;
  const completed = new Promise<SessionResult>((resolve) => {
    complete = resolve;
  });
  let ready = false;
  let queued = 0;
  let writer = Promise.resolve();
  let resize: { cols: number; rows: number } | undefined;
  let resizeScheduled = false;
  const listeners: { dispose(): void }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let lastReceived = Date.now();
  let connectionTimer: ReturnType<typeof setTimeout> | undefined;
  const notify = (state: SessionResult) => {
    try {
      options.onState?.(state);
    } catch {
      /* UI observers do not own transport cleanup. */
    }
  };
  function finish(state: SessionResult) {
    if (result) return;
    result = state;
    complete(state);
    clearTimeout(timer);
    clearTimeout(connectionTimer);
    clearInterval(pingTimer);
    listeners.forEach((listener) => listener.dispose());
    options.signal?.removeEventListener("abort", dispose);
    lifetime.abort();
    void stream?.close().catch(() => {});
    void client?.close().catch(() => {});
    notify(state);
  }
  function detach() {
    if (!stream || result) {
      dispose();
      return;
    }
    const socket = stream;
    listeners.forEach((listener) => listener.dispose());
    void Promise.race([
      writer.then(() => socket.write(encode({ type: "detach" }))),
      new Promise((resolve) => setTimeout(resolve, 300)),
    ]).finally(() => finish({ state: "detached" }));
  }
  function terminate() {
    if (!ready || result) return;
    enqueue({ type: "terminate" });
    timer = setTimeout(
      () =>
        finish({
          state: "failed",
          reason: "termination_pending",
          retryable: false,
        }),
      5_000,
    );
  }
  function dispose() {
    finish({ state: "disposed" });
  }
  function enqueue(message: Message) {
    if (result || !stream) return;
    let frame: Uint8Array;
    try {
      frame = encode(message);
    } catch {
      finish({ state: "failed" });
      return;
    }
    if (queued + frame.length > 1024 * 1024) {
      finish({ state: "failed" });
      return;
    }
    queued += frame.length;
    const socket = stream;
    writer = writer.then(async () => {
      if (!result) await socket.write(frame);
    });
    void writer
      .catch(() => finish({ state: "failed" }))
      .finally(() => {
        queued -= frame.length;
      });
  }
  function input(bytes: Uint8Array) {
    if (!ready || result) return;
    if (bytes.length > 1024 * 1024 - queued) {
      finish({ state: "failed" });
      return;
    }
    for (
      let offset = 0;
      offset < bytes.length && !result;
      offset += maxDataSize
    )
      enqueue({
        type: "input",
        data: bytes.subarray(offset, offset + maxDataSize),
      });
  }
  function flushResize() {
    if (resizeScheduled || !ready || result) return;
    resizeScheduled = true;
    queueMicrotask(() => {
      resizeScheduled = false;
      if (resize && ready && !result) {
        const size = resize;
        resize = undefined;
        enqueue({ type: "resize", ...size });
      }
    });
  }
  // Register immediately so changes while dialing are included in the attach.
  listeners.push(
    terminal.onResize((size) => {
      resize = { cols: size.cols, rows: size.rows };
      flushResize();
    }),
  );
  options.signal?.addEventListener("abort", dispose, { once: true });
  if (options.signal?.aborted) dispose();

  const work = (async (): Promise<SessionResult> => {
    try {
      if (result) return result;
      notify({ state: "connecting" });
      connectionTimer = setTimeout(
        () => finish({ state: "failed" }),
        options.connectionTimeoutMs ?? 25_000,
      );
      const transport = options.transport ?? (await loadTransport());
      if (result) return result;
      client = await transport.createClient({
        address: connection.address,
        nodePrivateKey: connection.nodePrivateKey,
        derpMapURL: connection.derpMapURL,
      });
      if (result) {
        await client.close();
        return result;
      }
      stream = await client.dial(connection.port ?? defaultPort, {
        signal: lifetime.signal,
      });
      if (result) {
        await stream.close();
        return result;
      }
      timer = setTimeout(
        () => finish({ state: "failed" }),
        options.handshakeTimeoutMs ?? 10_000,
      );
      await stream.write(
        encode({
          type: connection.existing ? "attach" : "create",
          version,
          sessionId: connection.sessionId,
          capabilities:
            connection.backend === "tmux"
              ? ["persistence", "reconnect", "terminate"]
              : [],
          token: connection.token,
          cols: terminal.cols,
          rows: terminal.rows,
          term: "xterm-256color",
        }),
      );
      const decoder = new Decoder();
      while (!result) {
        const chunk = await stream.read({ signal: lifetime.signal });
        if (result) break;
        if (chunk === null) {
          decoder.finish();
          finish({ state: "disconnected" });
          break;
        }
        for (const message of decoder.push(chunk)) {
          if (result) break;
          lastReceived = Date.now();
          if (message.type === "error") {
            finish({
              state: "failed",
              reason: message.error,
              retryable: message.retryable,
            });
            break;
          }
          if (message.type === "pong") continue;
          if (message.type === "detached" || message.type === "terminated") {
            finish({ state: message.type });
            break;
          }
          if (!ready) {
            if(message.type === "ready" && message.version !== version) throw new Error("Unsupported terminal protocol");
            if(message.type === "ready" && connection.backend === "tmux" && !message.capabilities?.includes("persistence")) throw new Error("Persistent capability mismatch");
            if (
              message.type !== "ready" ||
              message.version !== version ||
              (connection.sessionId &&
                message.sessionId !== connection.sessionId) ||
              (connection.backend === "tmux" &&
                !message.capabilities?.includes("persistence"))
            )
              throw new Error("Expected agent readiness");
            ready = true;
            clearTimeout(timer);
            clearTimeout(connectionTimer);
            listeners.push(
              terminal.onData((text) => {
                if (text.length > 1024 * 1024) {
                  finish({ state: "failed" });
                  return;
                }
                input(new TextEncoder().encode(text));
              }),
            );
            listeners.push(
              terminal.onBinary((text) => {
                if (text.length > 1024 * 1024) {
                  finish({ state: "failed" });
                  return;
                }
                input(
                  Uint8Array.from(text, (char) => char.charCodeAt(0) & 255),
                );
              }),
            );
            pingTimer = setInterval(() => {
              if (
                Date.now() - lastReceived >
                (options.silenceTimeoutMs ?? 20_000)
              ) {
                finish({ state: "disconnected" });
                return;
              }
              enqueue({ type: "ping" });
            }, options.heartbeatMs ?? 5_000);
            notify({ state: "ready" });
            flushResize();
          } else if (message.type === "output") {
            // Hold the single reader until xterm has parsed this output. Abort
            // also releases the wait if the terminal was disposed mid-write.
            await new Promise<void>((resolve, reject) => {
              const abort = () => reject(new Error("Session disposed"));
              lifetime.signal.addEventListener("abort", abort, { once: true });
              if (lifetime.signal.aborted) {
                abort();
                return;
              }
              terminal.write(message.data, () => {
                lifetime.signal.removeEventListener("abort", abort);
                resolve();
              });
            });
          } else if (message.type === "exit") {
            finish({
              state: "exited",
              ...(message.codeKnown ? { code: message.code ?? 0 } : {}),
            });
          } else {
            throw new Error("Unexpected agent message");
          }
        }
      }
    } catch (error) {
      if (!result)
        finish({
          state: "failed",
          ...(error instanceof Error &&
          ["Unsupported terminal protocol", "Persistent capability mismatch"].includes(error.message)
            ? { reason: error.message === "Persistent capability mismatch" ? "capability_mismatch" : "unsupported_protocol", retryable: false }
            : {}),
        });
    } finally {
      // Include resources created concurrently with cancellation.
      await Promise.allSettled([stream?.close(), client?.close()]);
    }
    return result ?? { state: "failed" };
  })();
  return { dispose, detach, terminate, done: Promise.race([work, completed]) };
}
