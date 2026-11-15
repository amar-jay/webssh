<script lang="ts">
  import AppShell from "#lib/components/AppShell.svelte";
  import CommandBlock from "#lib/components/CommandBlock.svelte";
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
  <main class="pair-layout">
    <section class="pair-intro">
      <p class="eyebrow">WORKSPACE SETUP / PAIRING</p>
      <h1>A familiar machine.<br />A new connection.</h1>
      <p>
        Link a machine you trust to your account. Start in its terminal, then
        confirm the code here.
      </p>
      <CommandBlock command="webssh pair" />
      <div class="inline-note">
        Only approve a pairing request you started yourself.
      </div>
    </section>
    <section class="pair-card" aria-labelledby="pair-heading">
      {#if status === "done"}
        <div class="machine-icon success-icon" aria-hidden="true">✓</div>
        <h2 id="pair-heading">You’re paired.</h2>
        <p role="status">{message}</p>
        <div class="inline-note">
          Credentials are saved on your machine. Run webssh serve . there, then
          open its browser URL.
        </div>
        <a class="button primary" href="/"
          >Back to overview <span aria-hidden="true">→</span></a
        >
      {:else if !data.code || data.error}
        <div class="machine-icon" aria-hidden="true">›_</div>
        <h2 id="pair-heading">Enter your pairing code</h2>
        <p class="muted">
          Find the 8-character code in your machine’s terminal.
        </p>
        {#if data.error}<p class="notice error" role="alert">
            {data.error === "invalid_code"
              ? "Enter an 8-character code using letters and numbers."
              : "This code is unavailable or has expired. Run webssh pair again and enter the new code."}
          </p>{/if}
        <form method="GET">
          <label for="pairing-code">Pairing code</label>
          <input
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
          <p id="code-hint" class="field-hint">
            Keep webssh pair running while you continue.
          </p>
          <button class="button primary" type="submit"
            >Continue <span aria-hidden="true">→</span></button
          >
        </form>
      {:else}
        <div class="machine-icon" aria-hidden="true">›_</div>
        <h2 id="pair-heading">Is this your machine?</h2>
        <p class="muted">
          Check that this name and code match the request in your terminal.
        </p>
        <div class="machine-row">
          <span>Machine</span><strong>{data.machineName}</strong>
        </div>
        <div class="machine-row">
          <span>Access</span><strong>Your account only</strong>
        </div>
        <code class="pair-code">{data.code}</code>
        <button
          class="button primary"
          type="button"
          onclick={approve}
          disabled={status === "working"}
          >{status === "working" ? "Approving…" : "Approve machine"}
          <span aria-hidden="true">→</span></button
        >
        <p class="field-hint" aria-live="polite">
          {status === "working"
            ? "Linking this machine to your account…"
            : "Approve only if you recognize this request."}
        </p>
        {#if status === "error"}<p class="notice error" role="alert">
            {message}
          </p>{/if}
        <a class="text-link" href="/pair">Use a different code</a>
      {/if}
    </section>
  </main>
</AppShell>
