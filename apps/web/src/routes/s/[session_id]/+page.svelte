<script lang="ts">
  import SessionTerminal from '#lib/components/SessionTerminal.svelte';
  import { loadTransport } from '@webssh/transport';
  import { loadSession } from '#lib/terminal/load-session.js';
  import { attachMockSession } from '#lib/terminal/mock-session.js';
  import type { PageProps } from './$types';

  let { params }: PageProps = $props();
</script>

<svelte:head>
  <title>{params.session_id} · WebSSH</title>
</svelte:head>

{#key params.session_id}
  <SessionTerminal
    sessionId={params.session_id}
    onReady={({ terminal }) => loadSession(
      terminal,
      loadTransport,
      () => attachMockSession(terminal, params.session_id)
    )}
  />
{/key}
