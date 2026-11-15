<script lang="ts">
  import { Accordion } from "bits-ui";
  import HelpQuestion from "./HelpQuestion.svelte";
</script>

<article class="w-full text-left">
  <h1 class="mb-3 text-4xl tracking-tight">Help</h1>
  <p class="mb-10 max-w-[40rem] text-base text-secondary">
    Pair a machine you trust, then open its shell from the browser.
  </p>
  <Accordion.Root type="multiple" class="border-t border-line">
    <HelpQuestion value="pair" title="How do I pair a machine?">
      <p class="m-0">
        On your machine, run <code class="text-accent">webssh pair</code>. Open
        the approval link, sign in with GitHub, and confirm the machine name and
        code.
      </p>
    </HelpQuestion>
    <HelpQuestion value="next" title="What happens after pairing?">
      <p class="m-0">
        Pairing saves your machine’s credentials. Start the agent with
        <code class="text-accent">webssh serve .</code>, open the printed URL,
        and sign in with the same GitHub account. Choose a machine in Machines
        to start, reopen, or end its sessions.
      </p>
    </HelpQuestion>
    <HelpQuestion value="expired" title="My code has expired">
      <p class="m-0">
        Run <code class="text-accent">webssh pair</code> again for a fresh code. Keep
        the command running while you approve the machine.
      </p>
    </HelpQuestion>
    <HelpQuestion value="env" title="Logging and environment">
      <p class="mb-4">
        Set <code class="text-accent">log_level</code> and
        <code class="text-accent">log_format</code> in
        <code class="text-accent">webssh config</code>; neither has an
        environment variable or flag. The rest of this table is read from your
        shell.
      </p>
      <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5">
        <dt class="font-mono text-ink">log_level</dt>
        <dd class="m-0">
          Saved in config: <code class="text-ink">debug</code>,
          <code class="text-ink">info</code> (default),
          <code class="text-ink">warn</code>, or
          <code class="text-ink">error</code>.
        </dd>
        <dt class="font-mono text-ink">log_format</dt>
        <dd class="m-0">
          Saved in config: <code class="text-ink">auto</code> (default: text on
          a terminal, JSON when piped), <code class="text-ink">text</code>, or
          <code class="text-ink">json</code>.
        </dd>
        <dt class="font-mono text-ink">NO_COLOR</dt>
        <dd class="m-0">Any value removes colour from terminal logs.</dd>
        <dt class="font-mono text-ink">SHELL</dt>
        <dd class="m-0">
          Shell recorded when settings are first created; falls back to
          <code class="text-ink">/bin/sh</code>.
        </dd>
        <dt class="font-mono text-ink">XDG_CONFIG_HOME</dt>
        <dd class="m-0">
          First place checked for <code class="text-ink">tmux.conf</code>.
        </dd>
      </dl>
    </HelpQuestion>
  </Accordion.Root>
</article>
