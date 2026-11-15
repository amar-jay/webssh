<script lang="ts">
  import Seo from "#lib/components/Seo.svelte";
  import AppShell from "#lib/components/AppShell.svelte";
  import HelpArticle from "#lib/components/HelpArticle.svelte";

  let { data } = $props();
</script>

<Seo path="/help" />
<AppShell signedIn={!!data.user} width="narrow">
  <HelpArticle />
</AppShell>
