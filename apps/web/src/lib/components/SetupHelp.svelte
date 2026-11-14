<script lang="ts">
  import { Accordion, Dialog } from "bits-ui";
</script>

<Dialog.Root>
  <Dialog.Trigger class="button quiet"
    >Setup guide <span aria-hidden="true">↗</span></Dialog.Trigger
  >
  <Dialog.Portal>
    <Dialog.Overlay class="dialog-overlay" />
    <Dialog.Content class="dialog-content">
      <div class="eyebrow">FIELD GUIDE / WEBSSH</div>
      <Dialog.Title class="dialog-title">A machine of your own.</Dialog.Title>
      <Dialog.Description class="muted"
        >Pair your machine with your GitHub account in a few steps.</Dialog.Description
      >
      <Accordion.Root type="single" value="pair" class="accordion">
        <Accordion.Item value="pair">
          <Accordion.Header
            ><Accordion.Trigger
              >How do I pair a machine? <span aria-hidden="true">+</span
              ></Accordion.Trigger
            ></Accordion.Header
          >
          <Accordion.Content
            ><p>
              On your machine, run <code>webssh pair</code>. Open the approval
              link, sign in with GitHub, and confirm the machine name and code.
            </p></Accordion.Content
          >
        </Accordion.Item>
        <Accordion.Item value="next">
          <Accordion.Header
            ><Accordion.Trigger
              >What happens after pairing? <span aria-hidden="true">+</span
              ></Accordion.Trigger
            ></Accordion.Header
          >
          <Accordion.Content
            ><p>
              Pairing saves your machine’s credentials. You can start the agent
              with <code>webssh serve .</code>. Opening paired terminals in the
              browser is coming next.
            </p></Accordion.Content
          >
        </Accordion.Item>
        <Accordion.Item value="expired">
          <Accordion.Header
            ><Accordion.Trigger
              >My code has expired <span aria-hidden="true">+</span
              ></Accordion.Trigger
            ></Accordion.Header
          >
          <Accordion.Content
            ><p>
              Run <code>webssh pair</code> again to generate a fresh code. Keep the
              command running while you approve the machine.
            </p></Accordion.Content
          >
        </Accordion.Item>
      </Accordion.Root>
      <Dialog.Close class="button primary">Got it</Dialog.Close>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
