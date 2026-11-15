<script lang="ts">
  import TerminalPanel from "./TerminalPanel.svelte";
  import type { ConnectionStatus } from "#lib/session/paired-session.js";
  let { status, onRetry }: { status: ConnectionStatus; onRetry: () => void } =
    $props();
  let frame = $state(0);
  let busy = $derived(
    status.phase === "connecting" || status.phase === "retrying",
  );
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  $effect(() => {
    if (!busy || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    const timer = setInterval(() => {
      frame = (frame + 1) % frames.length;
    }, 90);
    return () => clearInterval(timer);
  });
  function keydown(event: KeyboardEvent) {
    if (
      status.retryable &&
      !busy &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      event.key.toLowerCase() === "r"
    ) {
      event.preventDefault();
      onRetry();
    }
  }
</script>

<svelte:window onkeydown={keydown} />
<TerminalPanel label="connection" docked={status.phase === "ended"}>
  <div role="status" aria-live="polite" aria-atomic="true">
    <div class="flex items-start gap-2">
      <span class="w-4 shrink-0 text-accent" aria-hidden="true"
        >{busy ? frames[frame] : status.phase === "ended" ? "■" : "!"}</span
      >
      <div class="min-w-0 flex-1">
        <p class="m-0 font-medium">
          {status.message}{#if status.attempt}<span
              class="ml-3 text-xs text-secondary"
              >[{status.attempt}/{status.maxRetries}]</span
            >{/if}
        </p>
        {#if status.detail}<p
            class="mt-1.5 mb-0 text-sm leading-relaxed text-secondary"
          >
            {status.detail}
          </p>{/if}
      </div>
    </div>
  </div>
  {#snippet actions()}
    {#if status.retryable && !busy}<button
        class="bg-transparent text-ink hover:text-accent"
        type="button"
        onclick={onRetry}><kbd class="mr-2 text-accent">r</kbd>retry</button
      >{/if}
  {/snippet}
</TerminalPanel>
