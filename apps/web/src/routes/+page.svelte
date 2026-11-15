<script lang="ts">
  import Seo from "#lib/components/Seo.svelte";
  import LandingHero from "#lib/components/LandingHero.svelte";
  let { data } = $props();
</script>

<Seo path="/" />
<LandingHero signedIn={!!data.user} error={data.error} />
