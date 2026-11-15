<script lang="ts">
  import { Tooltip } from "bits-ui";
  import Icon from "./Icon.svelte";
  let { command, bare = false }: { command: string; bare?: boolean } = $props();
  let copied = $state(false);
  let failed = $state(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      copied = true;
      failed = false;
    } catch {
      failed = true;
    }
  }
</script>

<div
  class="flex min-w-0 items-center gap-3 {bare
    ? 'mt-0 mb-4 bg-transparent p-0'
    : 'my-3 rounded-lg border border-line bg-canvas px-3 py-4'}"
>
  <span class="font-mono text-accent" aria-hidden="true">$</span><code
    class="min-w-0 flex-1 overflow-x-auto font-mono text-sm text-ink whitespace-nowrap"
    >{command}</code
  >
  <Tooltip.Provider
    ><Tooltip.Root
      ><Tooltip.Trigger
        class="ml-auto grid size-8 shrink-0 place-items-center rounded border border-line bg-transparent text-secondary hover:border-accent hover:text-ink"
        onclick={copy}
        aria-label={copied ? "Copied" : `Copy ${command}`}
        >{#if copied}<Icon name="check" />{:else}<Icon name="copy" />{/if}</Tooltip.Trigger
      ><Tooltip.Portal
        ><Tooltip.Content
          class="z-[60] rounded bg-ink px-2.5 py-2 text-xs text-canvas"
          sideOffset={8}>Copy command</Tooltip.Content
        ></Tooltip.Portal
      ></Tooltip.Root
    ></Tooltip.Provider
  >
</div>
{#if failed}<p class="text-danger" role="alert">
    Couldn’t copy. Select the command to copy it manually.
  </p>{/if}
<span class="sr-only" role="status">{copied ? "Command copied" : ""}</span>
