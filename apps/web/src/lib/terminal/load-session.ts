import type { Terminal } from '@xterm/xterm';

type Loader = () => Promise<unknown>;
type Attach = () => () => void;

/** Owns route-local loading feedback; the WASM runtime itself is shared. */
export function loadSession(
  terminal: Pick<Terminal, 'write' | 'onData'>,
  load: Loader,
  attach: Attach
): () => void {
  let disposed = false;
  let loading = false;
  let attached = false;
  let cleanup: (() => void) | undefined;
  const status = (message: string) => terminal.write(`\r\x1b[2K${message}`);

  async function start() {
    if (disposed || loading || attached) return;
    loading = true;
    status('\x1b[38;2;130;170;255mLoading terminal transport…\x1b[0m');
    try {
      await load();
      if (disposed) return;
      status('\x1b[38;2;79;214;190mTransport ready.\x1b[0m\r\n');
      terminal.write('\x1b[38;2;130;139;184mRemote sessions are not connected yet; starting the mock session.\x1b[0m\r\n\r\n');
      attached = true;
      retry.dispose();
      cleanup = attach();
    } catch {
      if (disposed) return;
      // Loader errors may contain URLs or other connection details. Display a
      // fixed message instead of interpreting arbitrary errors as ANSI output.
      status('\x1b[38;2;255;117;127mCould not load terminal transport.\x1b[0m\r\n');
      terminal.write('\x1b[38;2;130;139;184mCheck your connection, then press r to retry.\x1b[0m\r\n');
    } finally {
      loading = false;
    }
  }

  const retry = terminal.onData((data) => {
    if (data === 'r' || data === 'R') void start();
  });
  void start();

  return () => {
    disposed = true;
    retry.dispose();
    cleanup?.();
  };
}
