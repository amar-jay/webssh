<script lang="ts">
  import LandingHero from "#lib/components/LandingHero.svelte";
  let { data } = $props();
</script>

<svelte:head
  ><title>WebSSH | Your machines, within reach</title><meta
    name="description"
    content="Pair your machines with WebSSH. A browser terminal for your own workspace."
  /></svelte:head
>
<LandingHero signedIn={!!data.user} error={data.error} />
