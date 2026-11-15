<script lang="ts">
  import AppShell from "#lib/components/AppShell.svelte";
  import MachineTable from "#lib/components/MachineTable.svelte";
  let { data, form } = $props();
</script>

<svelte:head><title>Machines | WebSSH</title></svelte:head>
<AppShell signedIn={true} width="narrow">
  <MachineTable
    agents={data.agents}
    runs={data.runs}
    sessions={data.sessions}
    unavailable={data.unavailable}
    message={form?.message}
  />
</AppShell>
