<script lang="ts">
  import { onMount } from 'svelte';
  import type { Terminal } from '@xterm/xterm';
  import '@xterm/xterm/css/xterm.css';

  let { sessionId }: { sessionId: string } = $props();
  let container: HTMLDivElement;

  onMount(() => {
    let disposed = false;
    let terminal: Terminal | undefined;
    let observer: ResizeObserver | undefined;
    let frame = 0;

    async function initialize() {
      // xterm depends on browser APIs, so load it only after mounting.
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit')
      ]);
      if (disposed) return;

      terminal = new Terminal({
        cursorBlink: true,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 14,
        theme: { background: '#000000', foreground: '#eeeeee' }
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(container);
      fit.fit();
      terminal.focus();

      const scheduleFit = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (!disposed) fit.fit();
        });
      };
      observer = new ResizeObserver(scheduleFit);
      observer.observe(container);
      await document.fonts.ready;
      if (!disposed) scheduleFit();
      // Remote input/output and PTY resize events will be wired here once
      // the session transport is implemented. Do not simulate a local shell.
    }

    void initialize().catch((error: unknown) => {
      console.error('Failed to initialize terminal', error);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      terminal?.dispose();
    };
  });
</script>

<div class="session-terminal" bind:this={container} aria-label={`Terminal session ${sessionId}`}></div>

<style>
  .session-terminal {
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: #000;
  }
</style>
