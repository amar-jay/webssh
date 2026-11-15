<script lang="ts">
  import { page } from "$app/state";
  import { isCurrentTab, primaryTabs } from "#lib/navigation.js";

  let { class: className = "" }: { class?: string } = $props();
</script>

<nav class="flex justify-center {className}" aria-label="Primary">
  <ul
    class="m-0 flex list-none flex-wrap items-center justify-center gap-1 p-0"
    role="list"
  >
    {#each primaryTabs as tab (tab.href)}
      {@const current = isCurrentTab(page.url.pathname, tab.href)}
      <li>
        <a
          class="inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors {current
            ? 'bg-accent/15 text-ink shadow-[inset_0_1px_0_#ffffff1a]'
            : 'text-secondary hover:bg-white/5 hover:text-ink'}"
          href={tab.href}
          aria-current={current ? "page" : undefined}>{tab.label}</a
        >
      </li>
    {/each}
  </ul>
</nav>
