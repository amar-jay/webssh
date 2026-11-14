<script lang="ts">
  import { Tooltip } from "bits-ui";
  let { command }: { command: string } = $props();
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

<div class="command-block">
  <span class="prompt" aria-hidden="true">$</span><code>{command}</code>
  <Tooltip.Provider
    ><Tooltip.Root
      ><Tooltip.Trigger
        class="copy-button"
        onclick={copy}
        aria-label={`Copy ${command}`}
        >{copied ? "Copied ✓" : "Copy"}</Tooltip.Trigger
      ><Tooltip.Portal
        ><Tooltip.Content class="tooltip" sideOffset={8}
          >Copy command</Tooltip.Content
        ></Tooltip.Portal
      ></Tooltip.Root
    ></Tooltip.Provider
  >
</div>
{#if failed}<p class="error" role="alert">
    Couldn’t copy. Select the command to copy it manually.
  </p>{/if}
<span class="sr-only" role="status">{copied ? "Command copied" : ""}</span>
