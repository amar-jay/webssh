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
  <section
    class="w-full max-w-[440px] rounded-lg bg-ink p-4 text-canvas sm:p-5"
    aria-label={`Terminal ${label}`}
  >
    <div class="mb-3 flex items-center gap-3 text-xs text-canvas/75">
      <span class="text-canvas">webssh</span><span
        class="h-px flex-1 bg-canvas/20"
        aria-hidden="true"
      ></span><span>{label}</span>
    </div>
    {@render children()}
    <div
      class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-canvas/20 pt-3 text-xs"
    >
      {@render actions?.()}
      <a
        class="inline-flex items-center gap-2 text-canvas/75 hover:text-canvas"
        href="/machines"
        ><ArrowLeft class="size-3.5" aria-hidden="true" />machines</a
      >
    </div>
  </section>
</div>
