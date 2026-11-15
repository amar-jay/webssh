<script lang="ts">
  import AppShell from "#lib/components/AppShell.svelte";
  import PairingFlow from "#lib/components/PairingFlow.svelte";
  let { data } = $props();
</script>

<svelte:head><title>Pair a machine · WebSSH</title></svelte:head>
<AppShell signedIn={!!data.user} width="narrow">
  <div class="w-full max-w-[460px]">
    <h1 class="mb-6 text-center text-2xl tracking-tight">Pair a machine</h1>
    {#key `${data.code}:${data.error}`}
      <PairingFlow
        code={data.code}
        error={data.error}
        machineName={data.machineName}
      />
    {/key}
  </div>
</AppShell>
