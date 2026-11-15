<script lang="ts">
  import type { Snippet } from "svelte";
  import { surfaceCard } from "#lib/ui.js";

  let { children, toolbar }: { children: Snippet; toolbar?: Snippet } = $props();
</script>

<section
  class="w-full text-left {surfaceCard}"
>
  {#if toolbar}
    <div class="flex items-center justify-end border-b border-white/10 pr-1">
      {@render toolbar()}
    </div>
  {/if}
  <ul>
    {@render children()}
  </ul>
</section>
