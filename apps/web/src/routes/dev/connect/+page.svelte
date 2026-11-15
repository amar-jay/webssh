<script lang="ts">
  import AppShell from "#lib/components/AppShell.svelte";
  import CommandBlock from "#lib/components/CommandBlock.svelte";
  import { buttonPrimary, eyebrow } from "#lib/ui.js";
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
        value.version !== 2 ||
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
</script>

<svelte:head><title>Local connection · WebSSH</title></svelte:head>
<AppShell
  ><main
    class="mx-auto my-9 max-w-[660px] min-[721px]:mt-[60px] min-[721px]:mb-20"
  >
    <p class={eyebrow}>WEBSSH / LOCAL DEVELOPMENT</p>
    <h1 class="text-4xl tracking-tight">Connect to your workspace.</h1>
    <p class="text-secondary">
      Start a local development agent and paste its connection record below.
    </p>
    <CommandBlock
      command="webssh serve --backend ephemeral --dev-token --json ."
    />
    <form onsubmit={connect}>
      <label class="mt-6 mb-2.5 block text-sm" for="record"
        >Connection record</label
      >
      <textarea
        class="w-full resize-y rounded-lg border border-line bg-canvas p-4 font-mono text-sm tracking-normal text-ink normal-case"
        id="record"
        bind:value={record}
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
        rows="8"
        required></textarea>
      <p class="text-sm text-secondary">
        Kept in memory for this navigation only. Reloading requires a new
        handoff.
      </p>
      {#if problem}<p class="text-danger" role="alert">{problem}</p>{/if}
      <button
        class="{buttonPrimary} mt-3.5 mr-2.5"
        type="submit"
        disabled={!mounted}>Connect</button
      >
    </form>
  </main></AppShell
>
