<script lang="ts">
  import { Dialog } from "bits-ui";
  import { buttonPrimary, buttonQuiet, dialogOverlay, dialogPanel } from "#lib/ui.js";

  let {
    label,
    title,
    description,
    confirm,
    action,
    fields,
  }: {
    label: string;
    title: string;
    description: string;
    confirm: string;
    action: string;
    fields: Record<string, string>;
  } = $props();
</script>

<Dialog.Root>
  <Dialog.Trigger class={buttonQuiet}>{label}</Dialog.Trigger>
  <Dialog.Portal>
    <Dialog.Overlay class={dialogOverlay} />
    <Dialog.Content class="w-[min(420px,calc(100vw-32px))] p-6 {dialogPanel}">
      <Dialog.Title class="mb-2 text-xl tracking-tight">{title}</Dialog.Title>
      <Dialog.Description class="text-sm text-secondary">{description}</Dialog.Description>
      <form class="mt-5 flex items-center gap-2" method="POST" {action}>
        {#each Object.entries(fields) as [name, value] (name)}
          <input type="hidden" {name} {value} />
        {/each}
        <button type="submit" class={buttonPrimary}>{confirm}</button>
        <Dialog.Close class={buttonQuiet}>Cancel</Dialog.Close>
      </form>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
