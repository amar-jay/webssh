<script lang="ts">
  import { Accordion } from "bits-ui";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import type { Snippet } from "svelte";

  let { value, title, children }: { value: string; title: string; children: Snippet } =
    $props();
</script>

<Accordion.Item {value} class="border-b border-line">
  <Accordion.Header level={2}>
    <Accordion.Trigger
      class="flex w-full items-center justify-between gap-4 border-0 bg-transparent py-4 text-left text-base text-ink [&[data-state=open]>svg]:rotate-180"
    >
      {title}
      <ChevronDown class="size-4 shrink-0 text-secondary transition-transform" />
    </Accordion.Trigger>
  </Accordion.Header>
  <Accordion.Content>
    <div class="max-w-[40rem] pb-4 text-sm leading-relaxed text-secondary">
      {@render children()}
    </div>
  </Accordion.Content>
</Accordion.Item>
