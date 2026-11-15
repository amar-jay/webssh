<script lang="ts">
  import LogIn from "@lucide/svelte/icons/log-in";
  import LogOut from "@lucide/svelte/icons/log-out";
  import GitHubIcon from "./GitHubIcon.svelte";
  import SiteTabs from "./SiteTabs.svelte";
  import { buttonBright } from "#lib/ui.js";

  let { signedIn = false }: { signedIn?: boolean } = $props();
</script>

<header
  class="mx-auto flex max-w-[960px] flex-wrap items-center gap-x-4 gap-y-2.5 rounded-[26px] border border-white/15 bg-[#1e2030]/75 px-4 py-2.5 shadow-[inset_0_1px_0_#ffffff0d,0_8px_40px_#0003] backdrop-blur-xl md:gap-x-6 md:rounded-full md:px-3 md:py-2"
>
  <a
    class="flex items-center font-display text-[22px] font-semibold tracking-tight"
    href="/"
    aria-label="WebSSH home"
    ><img
      class="mr-2.5 size-6 shrink-0"
      src="/icon.svg"
      alt=""
      width="24"
      height="24"
    />webssh<span class="text-coral">.</span></a
  >
  <SiteTabs class="order-3 w-full md:order-none md:w-auto md:flex-1" />
  <div class="ml-auto flex items-center gap-3 md:ml-0">
    <a
      class="inline-flex items-center gap-1.5 text-sm font-medium text-secondary hover:text-ink"
      href="https://github.com/amar-jay/webssh"
      ><GitHubIcon class="size-4" /> GitHub</a
    >
    {#if signedIn}
      <form class="m-0" action="/logout" method="POST">
        <button class="{buttonBright} border-0" type="submit"
          >Sign out <LogOut class="size-3.5" aria-hidden="true" /></button
        >
      </form>
    {:else}
      <a class={buttonBright} href="/login"
        >Sign in <LogIn class="size-3.5" aria-hidden="true" /></a
      >
    {/if}
  </div>
</header>
