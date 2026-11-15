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
  class="inline-flex w-fit max-w-full items-start gap-2 text-sm leading-5 {bare
    ? 'm-0 bg-transparent p-0'
    : 'my-3 rounded-lg border border-line bg-canvas px-3 py-2'}"
>
  <span class="font-mono text-accent" aria-hidden="true">$</span><code
    class="min-w-0 font-mono break-all text-ink whitespace-normal">{command}</code
  >
  <Tooltip.Provider
    ><Tooltip.Root
      ><Tooltip.Trigger
        class="ml-2 inline-flex size-[1em] shrink-0 items-center justify-center text-secondary hover:text-ink"
        onclick={copy}
        aria-label={copied ? "Copied" : `Copy ${command}`}
        >{#if copied}<Icon name="check" class="size-[1em]" />{:else}<Icon
            name="copy"
            class="size-[1em]"
          />{/if}</Tooltip.Trigger
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
