<script lang="ts">
  import { Accordion, Dialog } from "bits-ui";
  import { buttonPrimary, buttonQuiet, eyebrow } from "#lib/ui.js";
</script>

<Dialog.Root>
  <Dialog.Trigger
    class="{buttonQuiet} max-[1000px]:text-xs! max-[720px]:p-2!"
    >Setup guide <span aria-hidden="true">↗</span></Dialog.Trigger
  >
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-50 bg-canvas/80 backdrop-blur-sm" />
    <Dialog.Content
      class="fixed top-1/2 left-1/2 z-[51] max-h-[85dvh] w-[min(520px,calc(100vw-32px))] -translate-1/2 overflow-auto rounded-2xl border border-line bg-surface p-6 shadow-2xl min-[721px]:p-8"
    >
      <div class={eyebrow}>FIELD GUIDE / WEBSSH</div>
      <Dialog.Title class="mt-3.5 mb-2.5 text-3xl tracking-tight"
        >A machine of your own.</Dialog.Title
      >
      <Dialog.Description class="text-sm text-secondary"
        >Pair your machine with your GitHub account in a few steps.</Dialog.Description
      >
      <Accordion.Root type="single" value="pair" class="mt-6 border-t border-line">
        <Accordion.Item value="pair" class="border-b border-line">
          <Accordion.Header
            ><Accordion.Trigger
              class="flex w-full items-center justify-between border-0 bg-transparent py-[18px] text-left text-sm text-ink [&[data-state=open]>span]:rotate-45"
              >How do I pair a machine? <span aria-hidden="true">+</span
              ></Accordion.Trigger
            ></Accordion.Header
          >
          <Accordion.Content
            ><p class="mb-0 pb-3 text-sm text-secondary">
              On your machine, run <code class="text-accent">webssh pair</code>. Open
              the approval link, sign in with GitHub, and confirm the machine name
              and code.
            </p></Accordion.Content
          >
        </Accordion.Item>
        <Accordion.Item value="next" class="border-b border-line">
          <Accordion.Header
            ><Accordion.Trigger
              class="flex w-full items-center justify-between border-0 bg-transparent py-[18px] text-left text-sm text-ink [&[data-state=open]>span]:rotate-45"
              >What happens after pairing? <span aria-hidden="true">+</span
              ></Accordion.Trigger
            ></Accordion.Header
          >
          <Accordion.Content
            ><p class="mb-0 pb-3 text-sm text-secondary">
              Pairing saves your machine’s credentials. You can start the agent
              with <code class="text-accent">webssh serve .</code>. Open the URL
              printed by serve and sign in with the same GitHub account. Use the
              overview to open or end sessions.
            </p></Accordion.Content
          >
        </Accordion.Item>
        <Accordion.Item value="expired" class="border-b border-line">
          <Accordion.Header
            ><Accordion.Trigger
              class="flex w-full items-center justify-between border-0 bg-transparent py-[18px] text-left text-sm text-ink [&[data-state=open]>span]:rotate-45"
              >My code has expired <span aria-hidden="true">+</span
              ></Accordion.Trigger
            ></Accordion.Header
          >
          <Accordion.Content
            ><p class="mb-0 pb-3 text-sm text-secondary">
              Run <code class="text-accent">webssh pair</code> again to generate a
              fresh code. Keep the command running while you approve the machine.
            </p></Accordion.Content
          >
        </Accordion.Item>
      </Accordion.Root>
      <Dialog.Close class="{buttonPrimary} mt-6">Got it</Dialog.Close>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
