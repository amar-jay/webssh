<script lang="ts">
  import AppShell from "#lib/components/AppShell.svelte";
  import CommandBlock from "#lib/components/CommandBlock.svelte";
  import { onMount } from "svelte";
  let mounted = $state(false);
  onMount(() => {
    mounted = true;
  });
  import { goto } from "$app/navigation";
  import { putLocalSession } from "#lib/session/local-connections.js";
  let record = $state("");
  let problem = $state("");
  function connect(event: SubmitEvent) {
    event.preventDefault();
    try {
      const value = JSON.parse(record);
      if (
        value.version !== 1 ||
        typeof value.address !== "string" ||
        !value.address.startsWith("tc") ||
        typeof value.token !== "string" ||
        value.token.length < 32 ||
        value.token.length > 128 ||
        !Number.isInteger(value.port) ||
        value.port < 1 ||
        value.port > 65535
      )
        throw new Error();
      const id = putLocalSession({
        mode: "remote",
        connection: {
          address: value.address,
          token: value.token,
          port: value.port,
        },
      });
      record = "";
      problem = "";
      void goto(`/s/${id}`);
    } catch {
      problem = "Paste a valid connection record from webssh serve --json.";
    }
  }
  function mock() {
    record = "";
    void goto(`/s/${putLocalSession({ mode: "mock" })}`);
  }
</script>

<svelte:head><title>Local connection · WebSSH</title></svelte:head>
<AppShell
  ><main class="dev-page">
    <p class="eyebrow">WEBSSH / LOCAL DEVELOPMENT</p>
    <h1>Connect to your workspace.</h1>
    <p class="muted">
      Start a local development agent and paste its connection record below.
    </p>
    <CommandBlock command="webssh serve --dev-token --json ." />
    <form onsubmit={connect}>
      <label for="record">Connection record</label>
      <textarea
        id="record"
        bind:value={record}
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
        rows="8"
        required></textarea>
      <p class="muted small">
        Kept in memory for this navigation only. Reloading requires a new
        handoff.
      </p>
      {#if problem}<p role="alert">{problem}</p>{/if}
      <button class="button primary" type="submit" disabled={!mounted}
        >Connect</button
      >
      <button
        type="button"
        disabled={!mounted}
        class="button subtle"
        onclick={mock}>Open mock terminal</button
      >
    </form>
  </main></AppShell
>
