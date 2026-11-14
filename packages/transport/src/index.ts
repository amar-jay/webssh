/** WebSSH's versioned Go/WASM transport API. No terminal/session policy lives here. */
export interface Identity { nodePrivateKey: string; publicKey: string }
export interface ClientOptions {
  address: string;
  nodePrivateKey?: string;
  derpMapURL?: string;
}
export interface Bridge {
  version: number;
  request(method: string, request: number, options: Record<string, unknown>): Promise<unknown>;
  cancel(request: number): void;
}
interface GoRuntime {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}
declare global {
  var websshTailcat: Bridge | undefined;
  var onWebSSHTailcatReady: (() => void) | undefined;
  var Go: (new () => GoRuntime) | undefined;
}

const chunkSize = 64 * 1024;
const maxQueuedBytes = 1024 * 1024;
let requestID = 0;
let loading: Promise<Transport> | undefined;

function abortError() { return new DOMException('Transport operation aborted', 'AbortError'); }

/** Injectable for testing; applications should normally use loadTransport(). */
export function createTransport(bridge: Bridge): Transport {
  if (bridge.version !== 1) throw new Error('Unsupported WebSSH transport bridge version');
  return new Transport(bridge);
}

export class Transport {
  private bridge: Bridge;
  constructor(bridge: Bridge) { this.bridge = bridge; }

  async call<T>(method: string, options: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const id = ++requestID;
    const pending = this.bridge.request(method, id, options);
    const cancel = () => this.bridge.cancel(id);
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    try { return await pending as T; }
    finally { signal?.removeEventListener('abort', cancel); }
  }

  generateIdentity(): Promise<Identity> { return this.call('generateIdentity', {}); }

  async createClient(options: ClientOptions): Promise<TailcatClient> {
    const result = await this.call<{ id: number; publicKey: string }>('createClient', { ...options });
    return new TailcatClient(this, result.id, result.publicKey);
  }
}

export class TailcatClient {
  readonly publicKey: string;
  private transport: Transport;
  private id: number;
  private lifetime = new AbortController();
  private closing?: Promise<void>;
  private streams = new Set<TailcatStream>();

  constructor(transport: Transport, id: number, publicKey: string) {
    this.transport = transport; this.id = id; this.publicKey = publicKey;
  }

  async dial(port: number, options: { signal?: AbortSignal } = {}): Promise<TailcatStream> {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('Invalid TCP port');
    const signal = options.signal
      ? AbortSignal.any([this.lifetime.signal, options.signal]) : this.lifetime.signal;
    signal.throwIfAborted();
    const id = await this.transport.call<number>('dial', { client: this.id, port }, signal);
    // A dial can finish concurrently with cancellation. Never leak its late result.
    if (signal.aborted) {
      await this.transport.call('closeStream', { stream: id });
      throw abortError();
    }
    const stream = new TailcatStream(this.transport, id, () => this.streams.delete(stream));
    this.streams.add(stream);
    return stream;
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.lifetime.abort();
      this.closing = (async () => {
        // Start backend close immediately to interrupt pending I/O.
        const closing = this.transport.call<void>('closeClient', { client: this.id });
        await Promise.all([closing, ...[...this.streams].map((stream) => stream.close())]);
      })();
    }
    return this.closing;
  }
}

export class TailcatStream {
  private transport: Transport;
  private id: number;
  private onClose: () => void;
  private reading = false;
  private closed = false;
  private endedWrite = false;
  private queuedBytes = 0;
  private writer: Promise<void> = Promise.resolve();
  private closing?: Promise<void>;

  constructor(transport: Transport, id: number, onClose: () => void) {
    this.transport = transport; this.id = id; this.onClose = onClose;
  }

  async read(options: { signal?: AbortSignal } = {}): Promise<Uint8Array | null> {
    if (this.closed) throw new Error('Stream is closed');
    if (this.reading) throw new Error('Concurrent reads are not allowed');
    this.reading = true;
    try {
      const bytes = await this.transport.call<Uint8Array | null>('read', { stream: this.id }, options.signal);
      if (options.signal?.aborted) throw abortError();
      return bytes;
    } catch (error) {
      await this.close().catch(() => {});
      throw error;
    } finally { this.reading = false; }
  }

  write(bytes: Uint8Array): Promise<void> {
    if (this.closed || this.endedWrite) return Promise.reject(new Error('Stream is not writable'));
    if (!(bytes instanceof Uint8Array)) return Promise.reject(new TypeError('write requires Uint8Array'));
    if (this.queuedBytes + bytes.byteLength > maxQueuedBytes) {
      return Promise.reject(new Error('Transport write queue is full'));
    }
    const copy = bytes.slice(); // The caller may reuse/mutate its original buffer.
    this.queuedBytes += copy.byteLength;
    const write = this.writer.then(async () => {
      if (this.closed) throw new Error('Stream is closed');
      for (let offset = 0; offset < copy.length; offset += chunkSize) {
        await this.transport.call('write', { stream: this.id, bytes: copy.subarray(offset, offset + chunkSize) });
      }
    });
    this.writer = write;
    // Keep a rejected queue poisoned, but attach a handler to prevent unhandled
    // rejections when consumers correctly handle only the returned operation.
    void write.catch(() => {});
    return write.finally(() => { this.queuedBytes -= copy.byteLength; });
  }

  closeWrite(): Promise<void> {
    if (this.closed || this.endedWrite) return Promise.reject(new Error('Stream is not writable'));
    this.endedWrite = true;
    this.writer = this.writer.then(() => this.transport.call<void>('closeWrite', { stream: this.id }));
    void this.writer.catch(() => {});
    return this.writer;
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.closed = true;
      this.onClose();
      // Do not wait for a blocked write before closing the socket that unblocks it.
      this.closing = this.transport.call<void>('closeStream', { stream: this.id });
    }
    return this.closing;
  }
}

/** Load once, only in a browser. Assets are produced by `pnpm wasm:build`. */
export function loadTransport(): Promise<Transport> {
  if (typeof document === 'undefined') return Promise.reject(new Error('WASM transport requires a browser'));
  if (loading) return loading;
  loading = boot().catch((error: unknown) => { loading = undefined; throw error; });
  return loading;
}

async function boot(): Promise<Transport> {
  if (globalThis.websshTailcat) return createTransport(globalThis.websshTailcat);
  if (!globalThis.Go) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/tailcat/wasm_exec.js';
      script.onload = () => { script.remove(); resolve(); };
      script.onerror = () => { script.remove(); reject(new Error('Could not load Go WASM runtime')); };
      document.head.append(script);
    });
  }
  if (!globalThis.Go) throw new Error('Go WASM runtime did not initialize');
  const go = new globalThis.Go();
  const response = await fetch('/tailcat/webssh.wasm.gz');
  if (!response.ok) throw new Error(`Could not load WebSSH WASM (${response.status})`);
  // arrayBuffer works on hosts that do not set the WASM streaming MIME type.
  const downloaded = new Uint8Array(await response.arrayBuffer());
  // Some hosts (including the dev server) set Content-Encoding and the browser
  // already decompresses. Static hosts may serve the raw .gz bytes instead.
  const binary = downloaded[0] === 0x1f && downloaded[1] === 0x8b
    ? await new Response(new Blob([downloaded]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : downloaded.buffer;
  const { instance } = await WebAssembly.instantiate(binary, go.importObject);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('WebSSH WASM readiness timed out')); }, 30_000);
    const cleanup = () => { clearTimeout(timer); globalThis.onWebSSHTailcatReady = undefined; };
    globalThis.onWebSSHTailcatReady = () => { cleanup(); resolve(); };
    void go.run(instance).then(
      () => { cleanup(); reject(new Error('WebSSH WASM stopped')); },
      (error: unknown) => { cleanup(); reject(error); }
    );
  });
  if (!globalThis.websshTailcat) throw new Error('WebSSH WASM did not expose its bridge');
  return createTransport(globalThis.websshTailcat);
}
