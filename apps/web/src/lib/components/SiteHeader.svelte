<script lang="ts">
  import { page } from "$app/state";
  import ArrowUpRight from "@lucide/svelte/icons/arrow-up-right";
  import LayoutDashboard from "@lucide/svelte/icons/layout-dashboard";
  import LogIn from "@lucide/svelte/icons/log-in";
  import LogOut from "@lucide/svelte/icons/log-out";
  import { buttonBright } from "#lib/ui.js";

  let { signedIn = false }: { signedIn?: boolean } = $props();
  let landing = $derived(page.url.pathname === "/");
  const appLinks = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/sessions", label: "Sessions" },
    { href: "/pair", label: "Pair" },
  ];
</script>

<header
  class="mx-auto flex min-h-16 max-w-[960px] flex-wrap items-center gap-x-4 gap-y-2 rounded-full border border-white/15 bg-[#1e2030]/75 py-2.5 pr-3 pl-5 shadow-[inset_0_1px_0_#ffffff0d,0_8px_40px_#0003] backdrop-blur-xl md:gap-x-8 md:pl-6"
>
  <a
    class="flex items-center font-display text-[22px] font-semibold tracking-tight"
    href="/"
    aria-label="WebSSH home"
    ><span
      class="mr-2.5 h-5 w-4 bg-linear-to-br from-[#82aaff] via-[#c099ff] to-[#86e1fc] [clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]"
      aria-hidden="true"
    ></span>webssh<span class="text-coral">.</span></a
  >
  <nav
    class="flex flex-1 items-center justify-end gap-4 text-sm font-medium text-secondary md:justify-center md:gap-7"
    aria-label="Main navigation"
  >
    {#if landing || !signedIn}
      <a class="hover:text-ink" href="/login">Serve</a>
    {:else}
      {#each appLinks as link (link.href)}
        <a
          class="hover:text-ink aria-[current=page]:text-ink"
          href={link.href}
          aria-current={page.url.pathname === link.href ? "page" : undefined}
          >{link.label}</a
        >
      {/each}
    {/if}
    <a
      class="hover:text-ink aria-[current=page]:text-ink"
      href="/help"
      aria-current={page.url.pathname === "/help" ? "page" : undefined}>Help</a
    >
    <a
      class="inline-flex items-center gap-1 hover:text-ink"
      href="https://github.com/amar-jay/webssh"
      >GitHub <ArrowUpRight class="size-3.5" aria-hidden="true" /></a
    >
  </nav>
  {#if signedIn && !landing}
    <form class="m-0" action="/logout" method="POST">
      <button class="{buttonBright} border-0" type="submit"
        >Sign out <LogOut class="size-3.5" aria-hidden="true" /></button
      >
    </form>
  {:else}
    <a class={buttonBright} href={signedIn ? "/dashboard" : "/login"}
      >{signedIn ? "Dashboard" : "Sign in"}
      {#if signedIn}<LayoutDashboard class="size-3.5" aria-hidden="true" />{:else}<LogIn
          class="size-3.5"
          aria-hidden="true"
        />{/if}</a
    >
  {/if}
</header>
