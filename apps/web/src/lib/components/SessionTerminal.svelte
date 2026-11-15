<script lang="ts">
  import { onMount } from 'svelte';
  import { createTerminal, type SessionTerminal, type TerminalOptions } from '#lib/terminal/create-terminal.js';
  import '@xterm/xterm/css/xterm.css';
  import '@fontsource/jetbrains-mono/400.css';
  import '@fontsource/jetbrains-mono/700.css';
  import '@fontsource/jetbrains-mono/400-italic.css';
  import '@fontsource/jetbrains-mono/700-italic.css';
  import '#lib/terminal/fonts.css';
  import { tokyoNightMoon } from '#lib/terminal/theme.js';

  let { sessionId, options = {}, onReady }: {
    sessionId: string;
    options?: TerminalOptions;
    onReady?: (session: SessionTerminal) => void | (() => void);
  } = $props();
  let container: HTMLDivElement;

  onMount(() => {
    let disposed = false;
    let session: SessionTerminal | undefined;
    let observer: ResizeObserver | undefined;
    let frame = 0;
    let cleanupSession: (() => void) | void;

    async function initialize() {
      const controller = await createTerminal(container, options);
      if (disposed) {
        controller.dispose();
        return;
      }
      session = controller;
      controller.terminal.focus();

      const scheduleFit = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (!disposed) controller.fit();
        });
      };
      observer = new ResizeObserver(scheduleFit);
      observer.observe(container);
      cleanupSession = onReady?.(controller);
    }

    void initialize().catch((error: unknown) => {
      container.textContent = 'Could not initialize the terminal. Reload the page to try again.';
      console.error('Failed to initialize terminal');
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      cleanupSession?.();
      session?.dispose();
    };
  });
</script>

<div class="session-terminal" style:background={tokyoNightMoon.background} bind:this={container} aria-label={`Terminal session ${sessionId}`}></div>

<style>
  .session-terminal {
    position: fixed;
    inset: 0;
    padding: 12px;
    overflow: hidden;
  }
</style>
