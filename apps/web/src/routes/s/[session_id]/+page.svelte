<script lang="ts">
  import AppShell from "#lib/components/AppShell.svelte";
  const dev = import.meta.env.DEV;
  import SessionTerminal from "#lib/components/SessionTerminal.svelte";
  import { takeLocalSession } from "#lib/session/local-connections.js";
  import {
    attachRemoteSession,
    type SessionResult,
  } from "#lib/terminal/remote-session.js";
  import { attachMockSession } from "#lib/terminal/mock-session.js";
  import type { SessionTerminal as Controller } from "#lib/terminal/create-terminal.js";
  import type { PageProps } from "./$types";
  let { params }: PageProps = $props();
  function attach(controller: Controller) {
    const local = dev ? takeLocalSession(params.session_id) : undefined;
    if (!local) {
      controller.terminal.write(
        dev
          ? "No local connection available. Open /dev/connect to connect or start a mock session.\r\n"
          : "Session connection is not available.\r\n",
      );
      return;
    }
    if (local.mode === "mock")
      return attachMockSession(controller.terminal, params.session_id);
    const session = attachRemoteSession(controller, local.connection, {
      onState(state: SessionResult) {
        const messages = {
          connecting: "Connecting to workspace…",
          ready: "Connected.\r\n",
          failed: "Connection failed. Return to /dev/connect to try again.",
          disconnected: "Connection lost. The remote shell has disconnected.",
          exited: `Shell exited (${state.code ?? 0}).`,
          disposed: "",
        };
        if (state.state !== "disposed")
          controller.terminal.write(`\r\n${messages[state.state]}\r\n`);
      },
    });
    return () => session.dispose();
  }
</script>

<svelte:head><title>{params.session_id} · WebSSH</title></svelte:head>
{#if !dev}
  <AppShell>
    <main class="dev-page">
      <p class="eyebrow">WORKSPACE / TERMINAL</p>
      <div class="machine-icon" aria-hidden="true">›_</div>
      <h1>Your terminal is up next.</h1>
      <p class="muted">
        Browser connections to paired machines aren’t available yet. Pairing
        saves your machine’s credentials, so it’s ready for the next step.
      </p>
      <a class="button primary" href="/"
        >Back to overview <span aria-hidden="true">→</span></a
      >
    </main>
  </AppShell>
{:else}
  {#key params.session_id}
    <SessionTerminal
      sessionId={params.session_id}
      onReady={attach}
      options={{ screenReader: dev }}
    />
  {/key}
{/if}
