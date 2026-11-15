<script lang="ts">
  import { Tooltip } from "bits-ui";
  import type { Snippet } from "svelte";

  let {
    label,
    class: className = "",
    type = "button",
    disabled = false,
    onclick,
    "aria-label": ariaLabel,
    children,
  }: {
    label: string;
    class?: string;
    type?: "button" | "submit";
    disabled?: boolean;
    onclick?: (event: MouseEvent) => void;
    "aria-label"?: string;
    children: Snippet;
  } = $props();
</script>

<Tooltip.Provider>
  <Tooltip.Root>
    <Tooltip.Trigger
      class={className}
      aria-label={ariaLabel ?? label}
      {type}
      {disabled}
      {onclick}
    >
      {@render children()}
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        class="z-[60] rounded bg-ink px-2.5 py-2 text-xs text-canvas"
        sideOffset={8}>{label}</Tooltip.Content
      >
    </Tooltip.Portal>
  </Tooltip.Root>
</Tooltip.Provider>
