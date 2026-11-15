<script lang="ts">
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
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
<div
  class="fixed z-20 flex items-center justify-center bg-canvas px-6 font-mono text-sm text-ink {status.phase ===
  'ended'
    ? 'inset-x-0 bottom-0 border-t border-line py-5'
    : 'inset-0'}"
>
  <section class="w-full max-w-[560px]" aria-label="Terminal connection">
    <div class="mb-5 flex items-center gap-3 text-xs text-secondary">
      <span class="text-accent">webssh</span><span
        class="h-px flex-1 bg-line"
        aria-hidden="true"
      ></span><span>connection</span>
    </div>
    <div role="status" aria-live="polite" aria-atomic="true">
      <div class="flex items-start gap-3">
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
              class="mt-3 mb-0 text-sm leading-relaxed text-secondary"
            >
              {status.detail}
            </p>{/if}
        </div>
      </div>
    </div>
    <div
      class="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-4 text-xs"
    >
      {#if status.retryable && !busy}<button
          class="bg-transparent text-ink hover:text-accent"
          type="button"
          onclick={onRetry}><kbd class="mr-2 text-accent">r</kbd>retry</button
        >{/if}
      <a
        class="inline-flex items-center gap-2 text-secondary hover:text-accent"
        href="/machines"
        ><ArrowLeft class="size-3.5" aria-hidden="true" />machines</a
      >
    </div>
  </section>
</div>
