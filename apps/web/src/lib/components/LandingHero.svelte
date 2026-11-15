<script lang="ts">
  import Aurora from "./Aurora.svelte";
  import CommandCard from "./CommandCard.svelte";
  import SiteHeader from "./SiteHeader.svelte";
  import { installCommand } from "#lib/install.js";
  let {
    signedIn = false,
    error,
  }: { signedIn?: boolean; error?: string | null } = $props();
</script>

<div
  class="relative isolate min-h-svh overflow-hidden bg-canvas px-5 pt-5 font-sans text-ink md:px-10 md:pt-8"
>
  <Aurora />
  <SiteHeader {signedIn} />

  <main
    class="mx-auto flex max-w-[820px] flex-col items-center pt-16 pb-16 text-center md:pt-24"
  >
    <h1
      class="mb-4 font-display text-[clamp(44px,5.2vw,76px)] leading-[1.03] font-medium tracking-[-.055em]"
    >
      Your terminal.<br /><span
        class="bg-linear-to-r from-[#c8d3f5] via-[#86e1fc] to-[#82aaff] bg-clip-text text-transparent"
        >Anywhere you are.</span
      >
    </h1>
    <p class="mb-8 text-base leading-relaxed text-secondary">
      The shell you know, on the machine you trust.
    </p>
    <CommandCard command={installCommand} />
    {#if error}<p
        class="mx-auto mt-4 mb-0 max-w-[500px] text-sm text-danger"
        role="alert"
      >
        {error === "auth_not_configured"
          ? "Sign-in is unavailable right now."
          : "Sign-in didn’t complete. Try again."}
      </p>{/if}
  </main>
</div>
