import { Decoder, encode, maxDataSize, defaultPort, type Message } from '@webssh/protocol';
import { loadTransport, type ClientOptions } from '@webssh/transport';
import type { SessionTerminal } from './create-terminal.js';

type Stream = { read(options?: { signal?: AbortSignal }): Promise<Uint8Array | null>; write(bytes: Uint8Array): Promise<void>; close(): Promise<void> };
type Client = { dial(port: number, options?: { signal?: AbortSignal }): Promise<Stream>; close(): Promise<void> };
export interface SessionTransport { createClient(options: ClientOptions): Promise<Client> }
export interface Connection extends ClientOptions { token: string; port?: number }
export type SessionState = 'connecting' | 'ready' | 'exited' | 'disconnected' | 'failed' | 'disposed';
export interface SessionResult { state: SessionState; code?: number }

/** One connection-scoped shell. The caller owns credentials and terminal lifetime.
 * No input is replayed or queued before the agent acknowledges attachment.
 */
export function attachRemoteSession(
  controller: Pick<SessionTerminal, 'terminal'>,
  connection: Connection,
  options: { transport?: SessionTransport; signal?: AbortSignal; onState?: (state: SessionResult) => void; handshakeTimeoutMs?: number } = {}
): { dispose(): void; done: Promise<SessionResult> } {
  const terminal = controller.terminal;
  const lifetime = new AbortController();
  let client: Client | undefined;
  let stream: Stream | undefined;
  let result: SessionResult | undefined;
  let ready = false;
  let queued = 0;
  let writer = Promise.resolve();
  let resize: { cols: number; rows: number } | undefined;
  let resizeScheduled = false;
  const listeners: { dispose(): void }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const notify = (state: SessionResult) => { try { options.onState?.(state); } catch { /* UI observers do not own transport cleanup. */ } };
  function finish(state: SessionResult) {
    if (result) return;
    result = state;
    clearTimeout(timer);
    listeners.forEach(listener => listener.dispose());
    options.signal?.removeEventListener('abort', dispose);
    lifetime.abort();
    void stream?.close().catch(() => {});
    void client?.close().catch(() => {});
    notify(state);
  }
  function dispose() { finish({ state: 'disposed' }); }
  function enqueue(message: Message) {
    if (result || !stream) return;
    let frame: Uint8Array;
    try { frame = encode(message); } catch { finish({ state: 'failed' }); return; }
    if (queued + frame.length > 1024 * 1024) { finish({ state: 'failed' }); return; }
    queued += frame.length;
    const socket = stream;
    writer = writer.then(async () => { if (!result) await socket.write(frame); });
    void writer.catch(() => finish({ state: 'failed' })).finally(() => { queued -= frame.length; });
  }
  function input(bytes: Uint8Array) {
    if (!ready || result) return;
    if (bytes.length > 1024 * 1024 - queued) { finish({ state: 'failed' }); return; }
    for (let offset = 0; offset < bytes.length && !result; offset += maxDataSize) enqueue({ type: 'input', data: bytes.subarray(offset, offset + maxDataSize) });
  }
  function flushResize() {
    if (resizeScheduled || !ready || result) return;
    resizeScheduled = true;
    queueMicrotask(() => {
      resizeScheduled = false;
      if (resize && ready && !result) { const size = resize; resize = undefined; enqueue({ type: 'resize', ...size }); }
    });
  }
  // Register immediately so changes while dialing are included in the attach.
  listeners.push(terminal.onResize(size => { resize = { cols: size.cols, rows: size.rows }; flushResize(); }));
  options.signal?.addEventListener('abort', dispose, { once: true });
  if (options.signal?.aborted) dispose();

  const done = (async (): Promise<SessionResult> => {
    try {
      if (result) return result;
      notify({ state: 'connecting' });
      const transport = options.transport ?? await loadTransport();
      if (result) return result;
      client = await transport.createClient({ address: connection.address, nodePrivateKey: connection.nodePrivateKey, derpMapURL: connection.derpMapURL });
      if (result) { await client.close(); return result; }
      stream = await client.dial(connection.port ?? defaultPort, { signal: lifetime.signal });
      if (result) { await stream.close(); return result; }
      timer = setTimeout(() => finish({ state: 'failed' }), options.handshakeTimeoutMs ?? 10_000);
      await stream.write(encode({ type: 'attach', version: 1, token: connection.token, cols: terminal.cols, rows: terminal.rows, term: 'xterm-256color' }));
      const decoder = new Decoder();
      while (!result) {
        const chunk = await stream.read({ signal: lifetime.signal });
        if (result) break;
        if (chunk === null) { decoder.finish(); finish({ state: 'disconnected' }); break; }
        for (const message of decoder.push(chunk)) {
          if (result) break;
          if (message.type === 'error') { finish({ state: 'failed' }); break; }
          if (!ready) {
            if (message.type !== 'ready') throw new Error('Expected agent readiness');
            ready = true; clearTimeout(timer);
            listeners.push(terminal.onData(text => {
              if (text.length > 1024 * 1024) { finish({ state: 'failed' }); return; }
              input(new TextEncoder().encode(text));
            }));
            listeners.push(terminal.onBinary(text => {
              if (text.length > 1024 * 1024) { finish({ state: 'failed' }); return; }
              input(Uint8Array.from(text, char => char.charCodeAt(0) & 255));
            }));
            notify({ state: 'ready' }); flushResize();
          } else if (message.type === 'output') {
            // Hold the single reader until xterm has parsed this output. Abort
            // also releases the wait if the terminal was disposed mid-write.
            await new Promise<void>((resolve, reject) => {
              const abort = () => reject(new Error('Session disposed'));
              lifetime.signal.addEventListener('abort', abort, { once: true });
              if (lifetime.signal.aborted) { abort(); return; }
              terminal.write(message.data, () => { lifetime.signal.removeEventListener('abort', abort); resolve(); });
            });
          } else if (message.type === 'exit') {
            finish({ state: 'exited', code: message.code ?? 0 });
          } else { throw new Error('Unexpected agent message'); }
        }
      }
    } catch { if (!result) finish({ state: 'failed' }); }
    finally {
      // Include resources created concurrently with cancellation.
      await Promise.allSettled([stream?.close(), client?.close()]);
    }
    return result ?? { state: 'failed' };
  })();
  return { dispose, done };
}
