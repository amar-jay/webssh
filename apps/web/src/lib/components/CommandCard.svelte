<script lang="ts">
  import CommandBlock from "./CommandBlock.svelte";
  import { surfaceCard } from "#lib/ui.js";

  let { command }: { command: string } = $props();
</script>

<div class="w-fit max-w-full px-4 py-2.5 text-left md:px-5 {surfaceCard}">
  <CommandBlock bare {command} />
</div>
