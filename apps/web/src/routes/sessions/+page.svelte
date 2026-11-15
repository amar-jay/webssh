<script lang="ts">
  import AppShell from "#lib/components/AppShell.svelte";
  import SessionList from "#lib/components/SessionList.svelte";
  let { data, form } = $props();
</script>

<svelte:head><title>Sessions · WebSSH</title></svelte:head>
<AppShell signedIn={true}>
  <SessionList
    agents={data.agents}
    sessions={data.sessions}
    unavailable={data.unavailable}
    message={form?.message}
  />
</AppShell>
