<script lang="ts">
  import type { Snippet } from "svelte";
  import Aurora from "./Aurora.svelte";
  import SiteHeader from "./SiteHeader.svelte";

  let {
    children,
    signedIn = false,
    width = "wide",
  }: { children: Snippet; signedIn?: boolean; width?: "wide" | "narrow" } = $props();
</script>

<div class="relative isolate min-h-svh overflow-hidden bg-canvas px-5 pt-5 font-sans text-ink md:px-10 md:pt-8">
  <Aurora />
  <SiteHeader {signedIn} />
  {#if width === "narrow"}
    <main class="mx-auto flex w-full max-w-[720px] flex-col items-center pt-16 pb-16">
      {@render children()}
    </main>
  {:else}
    {@render children()}
  {/if}
</div>
