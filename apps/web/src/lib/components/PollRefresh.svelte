<script lang="ts">
  import { onMount } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import { buttonQuiet } from "#lib/ui.js";

  let { failed = $bindable(false), show = true }: { failed?: boolean; show?: boolean } =
    $props();
  let refreshing = $state(false);

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      await invalidateAll();
      failed = false;
    } catch {
      failed = true;
    } finally {
      refreshing = false;
    }
  }

  onMount(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 10_000);
    return () => clearInterval(timer);
  });
</script>

{#if show}
  <button class={buttonQuiet} type="button" onclick={refresh} disabled={refreshing}>
    {refreshing ? "Refreshing…" : "Refresh"}
  </button>
{/if}
