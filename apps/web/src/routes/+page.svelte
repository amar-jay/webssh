<script lang="ts">
  import AppShell from "#lib/components/AppShell.svelte";
  import LandingHero from "#lib/components/LandingHero.svelte";
  import WorkspaceDashboard from "#lib/components/WorkspaceDashboard.svelte";
  let { data, form } = $props();
</script>

<svelte:head
  ><title>WebSSH · Your machines, within reach</title><meta
    name="description"
    content="Pair your machines with WebSSH. A browser terminal for your own workspace."
  /></svelte:head
>
{#if data.user}
  <AppShell signedIn={true}>
    <WorkspaceDashboard
      agents={data.agents}
      runs={data.runs}
      sessions={data.sessions}
      unavailable={data.unavailable}
      message={form?.message}
    />
  </AppShell>
{:else}
  <LandingHero error={data.error} />
{/if}
