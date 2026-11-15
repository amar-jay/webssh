<script lang="ts">
  import AppShell from "#lib/components/AppShell.svelte";
  import CommandBlock from "#lib/components/CommandBlock.svelte";
  import { buttonPrimary, eyebrow, machineIcon } from "#lib/ui.js";
  import Icon from "#lib/components/Icon.svelte";
  let { data } = $props();
  let status = $state<"idle" | "working" | "done" | "error">("idle");
  let message = $state("");

  async function approve() {
    if (!data.code || status === "working" || status === "done") return;
    status = "working";
    message = "";
    try {
      const res = await fetch("/api/pairing/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: data.code }),
      });
      const body = (await res.json()) as {
        error?: string;
        machineName?: string;
      };
      if (!res.ok) {
        status = "error";
        message =
          "Couldn’t approve this machine. Run webssh pair again for a fresh code.";
        return;
      }
      status = "done";
      message = `Paired ${body.machineName ?? "machine"}. Start webssh serve . on your machine to open a workspace.`;
    } catch {
      status = "error";
      message = "Couldn’t reach WebSSH. Check your connection and try again.";
    }
  }
</script>

<svelte:head><title>Pair a machine · WebSSH</title></svelte:head>
<AppShell signedIn={!!data.user}>
  <main
    class="mx-auto grid max-w-[900px] grid-cols-1 items-start gap-6 pt-9 pb-12 min-[721px]:gap-9 min-[1001px]:grid-cols-[1fr_1.15fr] min-[1001px]:gap-16 min-[1001px]:pt-16 min-[1001px]:pb-20"
  >
    <section>
      <p class={eyebrow}>WORKSPACE SETUP / PAIRING</p>
      <h1 class="my-6 text-4xl leading-tight tracking-tight min-[721px]:text-[40px]">
        A familiar machine.<br />A new connection.
      </h1>
      <p class="text-sm text-secondary">
        Link a machine you trust to your account. Start in its terminal, then
        confirm the code here.
      </p>
      <CommandBlock command="webssh pair" />
      <div
        class="mt-5 border-l-2 border-accent bg-accent/5 px-3 py-2 text-sm text-secondary"
      >
        Only approve a pairing request you started yourself.
      </div>
    </section>
    <section
      class="rounded-2xl border border-line bg-surface p-6 min-[721px]:p-8"
      aria-labelledby="pair-heading"
    >
      {#if status === "done"}
        <div
          class="{machineIcon} mb-6 border-accent/50 bg-accent/5 text-accent"
          aria-hidden="true"
        >
          ✓
        </div>
        <h2 id="pair-heading" class="text-2xl tracking-tight">You’re paired.</h2>
        <p class="text-sm" role="status">{message}</p>
        <div
          class="border-l-2 border-accent bg-accent/5 px-3 py-2 text-sm text-secondary"
        >
          Credentials are saved on your machine. Run webssh serve . there, then
          open its browser URL.
        </div>
        <a class="{buttonPrimary} mt-[18px] w-full" href="/dashboard"
          >Back to dashboard <Icon name="arrow-right" class="size-4" /></a
        >
      {:else if !data.code || data.error}
        <div class="{machineIcon} mb-6" aria-hidden="true">›_</div>
        <h2 id="pair-heading" class="text-2xl tracking-tight">
          Enter your pairing code
        </h2>
        <p class="text-sm text-secondary">
          Find the 8-character code in your machine’s terminal.
        </p>
        {#if data.error}<p
            class="mt-5 rounded-lg border border-coral/50 bg-raised p-3.5 text-sm text-danger"
            role="alert"
          >
            {data.error === "invalid_code"
              ? "Enter an 8-character code using letters and numbers."
              : "This code is unavailable or has expired. Run webssh pair again and enter the new code."}
          </p>{/if}
        <form method="GET">
          <label class="mb-2.5 block text-sm text-secondary" for="pairing-code"
            >Pairing code</label
          >
          <input
            class="w-full rounded-lg border border-line bg-canvas p-4 font-mono text-2xl tracking-[6px] text-ink uppercase"
            id="pairing-code"
            name="code"
            placeholder="XXXXXXXX"
            minlength="8"
            maxlength="8"
            pattern="[A-Za-z0-9]{8}"
            required
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            aria-describedby="code-hint"
          />
          <p id="code-hint" class="mt-2.5 text-xs text-secondary">
            Keep webssh pair running while you continue.
          </p>
          <button class="{buttonPrimary} mt-[18px] w-full" type="submit"
            >Continue <Icon name="arrow-right" class="size-4" /></button
          >
        </form>
      {:else}
        <div class="{machineIcon} mb-6" aria-hidden="true">›_</div>
        <h2 id="pair-heading" class="text-2xl tracking-tight">
          Is this your machine?
        </h2>
        <p class="text-sm text-secondary">
          Check that this name and code match the request in your terminal.
        </p>
        <div
          class="flex justify-between gap-3 border-b border-line py-3.5 text-sm"
        >
          <span class="text-secondary">Machine</span><strong
            >{data.machineName}</strong
          >
        </div>
        <div
          class="flex justify-between gap-3 border-b border-line py-3.5 text-sm"
        >
          <span class="text-secondary">Access</span><strong
            >Your account only</strong
          >
        </div>
        <code class="block py-[18px] font-mono text-2xl tracking-[5px] text-ink"
          >{data.code}</code
        >
        <button
          class="{buttonPrimary} mt-[18px] w-full"
          type="button"
          onclick={approve}
          disabled={status === "working"}
          >{status === "working" ? "Approving…" : "Approve machine"}
          {#if status !== "working"}<Icon name="arrow-right" class="size-4" />{/if}</button
        >
        <p class="mt-2.5 text-xs text-secondary" aria-live="polite">
          {status === "working"
            ? "Linking this machine to your account…"
            : "Approve only if you recognize this request."}
        </p>
        {#if status === "error"}<p
            class="mt-5 rounded-lg border border-coral/50 bg-raised p-3.5 text-sm text-danger"
            role="alert"
          >
            {message}
          </p>{/if}
        <a class="inline-block py-1.5 text-sm text-coral hover:underline" href="/pair"
          >Use a different code</a
        >
      {/if}
    </section>
  </main>
</AppShell>
