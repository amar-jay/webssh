<script lang="ts">
  import { page } from "$app/state";
  import SetupHelp from "./SetupHelp.svelte";
  import type { Snippet } from "svelte";
  let {
    children,
    signedIn = false,
  }: { children: Snippet; signedIn?: boolean } = $props();
</script>

<div class="app-shell">
  <header class="app-header">
    <a class="brand" href="/" aria-label="WebSSH home"
      ><span class="brand-mark" aria-hidden="true">›_</span> webssh<span
        class="brand-dot">.</span
      ></a
    >
    <nav aria-label="Main navigation">
      <a class:current={page.url.pathname === "/"} href="/">Overview</a>
      <a class:current={page.url.pathname === "/pair"} href="/pair"
        >Pair machine</a
      >
    </nav>
    <div class="header-actions">
      <SetupHelp />{#if signedIn}<form action="/logout" method="POST">
          <button class="button subtle" type="submit">Sign out</button>
        </form>{:else}<a class="button subtle" href="/login"
          >Sign in <span aria-hidden="true">↗</span></a
        >{/if}
    </div>
  </header>
  {@render children()}
  <footer class="app-footer">
    <span><span class="status-dot"></span> Your machines. Your account.</span
    ><span>WEBSSH <span class="footer-slash">/</span> BROWSER TERMINAL</span>
  </footer>
</div>
