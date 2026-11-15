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
  class="fixed z-20 flex items-center justify-center bg-canvas px-4 font-mono text-sm text-ink {docked
    ? 'inset-x-0 bottom-0 border-t border-line py-5'
    : 'inset-0'}"
>
  <section
    class="w-full max-w-[440px] p-2 text-ink sm:p-3"
    aria-label={`Terminal ${label}`}
  >
    <div class="mb-3 flex items-center gap-2 text-xs text-secondary">
      <span class="text-accent">webssh</span><span
        class="h-px flex-1 bg-line"
        aria-hidden="true"
      ></span><span>{label}</span>
    </div>
    {@render children()}
    <div
      class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-2 text-xs"
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
