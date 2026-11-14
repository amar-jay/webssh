<script lang="ts">
  import SessionTerminal from '#lib/components/SessionTerminal.svelte';
  import type { PageProps } from './$types';

  let { params }: PageProps = $props();
</script>

<svelte:head>
  <title>{params.session_id} · WebSSH</title>
</svelte:head>

{#key params.session_id}
  <SessionTerminal sessionId={params.session_id} />
{/key}
