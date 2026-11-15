<script lang="ts">
  import AppShell from "#lib/components/AppShell.svelte";
  import WorkspaceDashboard from "#lib/components/WorkspaceDashboard.svelte";
  let { data, form } = $props();
</script>

<svelte:head><title>Dashboard · WebSSH</title></svelte:head>
<AppShell signedIn={true}>
  <WorkspaceDashboard
    agents={data.agents}
    runs={data.runs}
    unavailable={data.unavailable}
    message={form?.message}
  />
</AppShell>
