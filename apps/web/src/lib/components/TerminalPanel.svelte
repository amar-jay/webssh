<script lang="ts">
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import type { Snippet } from "svelte";
  let {
    label,
    docked = false,
    children,
    actions,
  }: {
    label: string;
    docked?: boolean;
    children: Snippet;
    actions?: Snippet;
  } = $props();
</script>

<div
  class="fixed z-20 flex items-center justify-center bg-canvas px-6 font-mono text-sm text-ink {docked
    ? 'inset-x-0 bottom-0 border-t border-line py-5'
    : 'inset-0'}"
>
  <section class="w-full max-w-[560px]" aria-label={`Terminal ${label}`}>
    <div class="mb-5 flex items-center gap-3 text-xs text-secondary">
      <span class="text-accent">webssh</span><span
        class="h-px flex-1 bg-line"
        aria-hidden="true"
      ></span><span>{label}</span>
    </div>
    {@render children()}
    <div
      class="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-4 text-xs"
    >
      {@render actions?.()}
      <a
        class="inline-flex items-center gap-2 text-secondary hover:text-accent"
        href="/machines"
        ><ArrowLeft class="size-3.5" aria-hidden="true" />machines</a
      >
    </div>
  </section>
</div>
