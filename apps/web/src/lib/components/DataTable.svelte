<script lang="ts">
  import type { Snippet } from 'svelte';
  import { surfaceCard } from '#lib/ui.js';
  let { label, headings, children }: { label: string; headings: Snippet; children: Snippet } = $props();
</script>
<div class="w-full {surfaceCard}">
  <table class="w-full table-fixed text-left text-sm [&_th]:px-2 [&_th]:py-3 [&_th]:text-xs [&_th]:font-medium [&_th]:text-secondary [&_td]:px-2 [&_td]:py-3 [&_td]:wrap-anywhere [&_tbody_tr]:border-t [&_tbody_tr]:border-line/60 [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-accent/5 md:[&_th]:px-5 md:[&_td]:px-5">
    <caption class="sr-only">{label}</caption>
    <thead><tr>{@render headings()}</tr></thead>
    <tbody>{@render children()}</tbody>
  </table>
</div>
