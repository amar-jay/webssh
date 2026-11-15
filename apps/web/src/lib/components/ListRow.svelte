<script lang="ts">
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<li
  class="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-white/10 px-4 py-2.5 first:border-t-0"
>
  {@render children()}
</li>
