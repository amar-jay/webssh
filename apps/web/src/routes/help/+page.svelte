<script lang="ts">
  import AppShell from "#lib/components/AppShell.svelte";
  import HelpArticle from "#lib/components/HelpArticle.svelte";

  let { data } = $props();
</script>

<svelte:head><title>Help · WebSSH</title></svelte:head>
<AppShell signedIn={!!data.user} width="narrow">
  <HelpArticle />
</AppShell>
