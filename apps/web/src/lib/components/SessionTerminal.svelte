<script lang="ts">
  import { onMount } from "svelte";
  import {
    createTerminal,
    type SessionTerminal,
    type TerminalOptions,
  } from "#lib/terminal/create-terminal.js";
  import "@xterm/xterm/css/xterm.css";
  import "#lib/terminal/fonts.css";
  import { tokyoNightMoon } from "#lib/terminal/theme.js";

  let {
    sessionId,
    options = {},
    onReady,
    onError,
  }: {
    sessionId: string;
    options?: TerminalOptions;
    onError?: () => void;
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
      if (disposed) return;
      onError?.();
      container.textContent =
        "Could not initialize the terminal. Reload the page to try again.";
      console.error("Failed to initialize terminal");
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

<div
  class="fixed inset-0 overflow-hidden p-3 font-mono text-sm"
  style:background={tokyoNightMoon.background}
  bind:this={container}
  aria-label={`Terminal session ${sessionId}`}
></div>
