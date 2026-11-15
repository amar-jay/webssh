<script lang="ts">
  import { page } from "$app/state";
  import SetupHelp from "./SetupHelp.svelte";
  import type { Snippet } from "svelte";
  import { buttonSubtle } from "#lib/ui.js";
  let {
    children,
    signedIn = false,
  }: { children: Snippet; signedIn?: boolean } = $props();
</script>

<div class="mx-auto max-w-[1248px] px-5 min-[721px]:px-7 min-[1001px]:px-12">
  <header
    class="flex h-auto min-h-[84px] flex-wrap items-center gap-[18px] border-b border-line py-5 min-[721px]:h-[100px] min-[721px]:flex-nowrap min-[721px]:gap-7 min-[721px]:py-0 min-[1001px]:gap-14"
  >
    <a
      class="font-display text-xl font-bold tracking-tight whitespace-nowrap min-[721px]:text-2xl"
      href="/"
      aria-label="WebSSH home"
      ><span
        class="mr-2 inline-grid size-9 place-items-center rounded-lg border border-line font-mono text-xl text-accent"
        aria-hidden="true">›_</span
      >
      webssh<span class="text-coral">.</span></a
    >
    <nav
      class="order-3 flex w-full gap-6 text-sm font-medium text-secondary min-[721px]:order-none min-[721px]:w-auto min-[721px]:gap-7"
      aria-label="Main navigation"
    >
      <a
        class="p-0 hover:text-ink aria-[current=page]:text-ink min-[721px]:py-3"
        aria-current={page.url.pathname === "/" ? "page" : undefined}
        href="/">Overview</a
      >
      <a
        class="p-0 hover:text-ink aria-[current=page]:text-ink min-[721px]:py-3"
        aria-current={page.url.pathname === "/pair" ? "page" : undefined}
        href="/pair">Pair machine</a
      >
    </nav>
    <div class="ml-auto flex items-center gap-1 min-[721px]:gap-2.5">
      <SetupHelp />{#if signedIn}<form class="m-0" action="/logout" method="POST">
          <button
            class="{buttonSubtle} max-[720px]:px-2.5! max-[720px]:py-2! max-[720px]:text-xs!"
            type="submit">Sign out</button
          >
        </form>{:else}<a
          class="{buttonSubtle} max-[720px]:px-2.5! max-[720px]:py-2! max-[720px]:text-xs!"
          href="/login"
          >Sign in <span aria-hidden="true">↗</span></a
        >{/if}
    </div>
  </header>
  {@render children()}
  <footer
    class="flex flex-wrap justify-between gap-5 border-t border-line pt-6 pb-8 font-mono text-xs leading-relaxed tracking-wide text-secondary"
  >
    <span
      ><span class="mr-2 inline-block size-1.5 shrink-0 rounded-full bg-accent"
      ></span> Your machines. Your account.</span
    ><span>WEBSSH <span class="mx-3 text-coral">/</span> BROWSER TERMINAL</span>
  </footer>
</div>
