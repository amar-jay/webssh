<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import Tip from "./Tip.svelte";

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
    class="min-w-0 font-mono break-all text-ink whitespace-normal"
    >{command}</code
  >
  <Tip
    label="Copy command"
    class="ml-2 inline-flex size-[1em] shrink-0 items-center justify-center text-secondary hover:text-ink"
    type="button"
    onclick={copy}
    aria-label={copied ? "Copied" : `Copy ${command}`}
  >
    {#if copied}<Check class="size-[1em]" />{:else}<Copy
        class="size-[1em]"
      />{/if}
  </Tip>
</div>
{#if failed}<p class="text-danger" role="alert">
    Couldn’t copy. Select the command to copy it manually.
  </p>{/if}
<span class="sr-only" role="status">{copied ? "Command copied" : ""}</span>
