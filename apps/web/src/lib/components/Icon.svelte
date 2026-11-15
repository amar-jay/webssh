<script lang="ts">
  /** Lucide icon paths (ISC). https://lucide.dev */
  let {
    name,
    class: className = "size-4",
  }: {
    name:
      | "arrow-down"
      | "arrow-right"
      | "arrow-up-right"
      | "check"
      | "chevron-down"
      | "copy"
      | "dashboard"
      | "log-in"
      | "plus"
      | "terminal";
    class?: string;
  } = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  class="shrink-0 {className}"
  aria-hidden="true"
>
  {#if name === "arrow-down"}
    <path d="M12 5v14" /><path d="m19 12-7 7-7-7" />
  {:else if name === "arrow-right"}
    <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
  {:else if name === "arrow-up-right"}
    <path d="M7 7h10v10" /><path d="M7 17 17 7" />
  {:else if name === "check"}
    <path d="M20 6 9 17l-5-5" />
  {:else if name === "chevron-down"}
    <path d="m6 9 6 6 6-6" />
  {:else if name === "dashboard"}
    <rect width="7" height="9" x="3" y="3" rx="1" />
    <rect width="7" height="5" x="14" y="3" rx="1" />
    <rect width="7" height="9" x="14" y="12" rx="1" />
    <rect width="7" height="5" x="3" y="16" rx="1" />
  {:else if name === "copy"}
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  {:else if name === "log-in"}
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    <path d="m10 17 5-5-5-5" /><path d="M15 12H3" />
  {:else if name === "plus"}
    <path d="M5 12h14" /><path d="M12 5v14" />
  {:else}
    <polyline points="4 17 10 11 4 5" /><line x1="12" x2="20" y1="19" y2="19" />
  {/if}
</svg>
