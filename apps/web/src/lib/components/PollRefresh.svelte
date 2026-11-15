<script lang="ts">
  import { onMount } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Tip from "./Tip.svelte";
  import { iconAction } from "#lib/ui.js";

  let {
    failed = $bindable(false),
    show = true,
  }: { failed?: boolean; show?: boolean } = $props();
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
  <Tip
    label={refreshing ? "Refreshing…" : "Refresh"}
    class={iconAction}
    onclick={refresh}
    disabled={refreshing}
  >
    <RefreshCw
      class="size-4 {refreshing
        ? 'animate-spin motion-reduce:animate-none'
        : ''}"
      aria-hidden="true"
    />
  </Tip>
{/if}
