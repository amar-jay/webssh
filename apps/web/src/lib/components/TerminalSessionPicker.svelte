<script lang="ts">
  import { onMount } from "svelte";
  import TerminalPanel from "./TerminalPanel.svelte";
  import type { SessionPickerView } from "#lib/terminal/session-picker.js";
  let {
    view,
    onInput,
    onChoose,
    onHighlight,
    onRefresh,
  }: {
    view: SessionPickerView;
    onInput: (key: string) => void;
    onChoose: (index: number) => void;
    onHighlight: (index: number) => void;
    onRefresh: () => void;
  } = $props();
  let heading: HTMLHeadingElement;
  onMount(() => heading.focus({ preventScroll: true }));
  let height = $state(800);
  let pageSize = $derived(
    Math.max(1, Math.min(6, Math.floor((height - 300) / 36))),
  );
  let start = $derived(
    Math.max(
      0,
      Math.min(
        view.selected - Math.floor(pageSize / 2),
        view.choices.length - pageSize,
      ),
    ),
  );
  let visible = $derived(view.choices.slice(start, start + pageSize));
  function keydown(event: KeyboardEvent) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing)
      return;
    if (
      event.key === "Enter" &&
      event.target instanceof Element &&
      event.target.closest("a, [data-picker-action]")
    )
      return;
    const key = {
      ArrowUp: "\x1b[A",
      ArrowDown: "\x1b[B",
      Enter: "\r",
      n: "n",
      N: "N",
      r: "r",
      R: "R",
    }[event.key];
    if (!key) return;
    event.preventDefault();
    onInput(key);
  }
</script>

<svelte:window bind:innerHeight={height} onkeydown={keydown} />
<TerminalPanel label="sessions">
  <div class="mb-5 flex items-start gap-3">
    <span class="w-4 shrink-0 text-accent" aria-hidden="true">&gt;</span>
    <div class="min-w-0 flex-1">
      <h1
        bind:this={heading}
        tabindex="-1"
        class="m-0 text-sm font-medium outline-none"
      >
        Choose a session
      </h1>
      {#if view.workspace}<p
          class="mt-3 mb-0 text-sm text-secondary wrap-anywhere"
        >
          {view.workspace}
        </p>{/if}
    </div>
  </div>
  <div aria-busy={view.loading}>
    {#if start}<p class="my-2 pl-7 text-xs text-secondary">
        {start} earlier · ↑ to browse
      </p>{/if}
    <ul class="m-0 list-none space-y-1 p-0" aria-label="Workspace sessions">
      {#each visible as choice, offset (choice.id)}
        {@const index = start + offset}
        <li>
          <button
            type="button"
            disabled={view.loading}
            onfocus={() => onHighlight(index)}
            onclick={() => onChoose(index)}
            aria-current={view.selected === index ? "true" : undefined}
            class="flex w-full items-center gap-3 rounded px-2 py-2 text-left hover:bg-accent/5 focus-visible:outline-2 focus-visible:outline-accent {view.selected ===
            index
              ? 'bg-accent/10 text-accent'
              : 'text-ink'}"
          >
            <span class="w-3 shrink-0" aria-hidden="true"
              >{view.selected === index ? ">" : ""}</span
            >
            <span class="flex-1">{choice.id.slice(0, 8)}</span>
            <span class="text-xs text-secondary"
              >{choice.status === "active"
                ? "in use"
                : choice.status === "offline"
                  ? "offline"
                  : "available"}</span
            >
          </button>
        </li>
      {/each}
    </ul>
    {#if start + pageSize < view.choices.length}<p
        class="my-2 pl-7 text-xs text-secondary"
      >
        {view.choices.length - start - pageSize} more · ↓ to browse
      </p>{/if}
    <button
      type="button"
      disabled={view.loading || !view.ready}
      onfocus={() => onHighlight(view.choices.length)}
      onclick={() => onChoose(view.choices.length)}
      class="mt-2 flex w-full items-center gap-3 rounded px-2 py-2 text-left hover:bg-accent/5 focus-visible:outline-2 focus-visible:outline-accent {view.selected ===
      view.choices.length
        ? 'bg-accent/10 text-accent'
        : 'text-ink'}"
    >
      <span class="w-3 shrink-0" aria-hidden="true"
        >{view.selected === view.choices.length ? ">" : ""}</span
      ><span class="flex-1">New session</span>
      {#if !view.online && view.ready}<span class="text-xs text-secondary"
          >agent offline</span
        >{/if}
    </button>
  </div>
  <p
    class="mt-4 mb-0 text-xs leading-relaxed {view.error
      ? 'text-danger'
      : 'text-secondary'}"
    role="status"
    aria-live="polite"
  >
    {view.loading
      ? "Loading sessions…"
      : view.error || "↑/↓ select · Enter open · n new"}
  </p>
  {#snippet actions()}
    <button
      class="bg-transparent text-ink hover:text-accent disabled:opacity-50"
      type="button"
      disabled={view.loading}
      data-picker-action
      onclick={onRefresh}><kbd class="mr-2 text-accent">r</kbd>refresh</button
    >
  {/snippet}
</TerminalPanel>
