<script lang="ts">
  import {
    attachPairedSession,
    type ConnectionStatus as Status,
  } from "#lib/session/paired-session.js";
  import { replaceState } from "$app/navigation";
  import { page } from "$app/state";
  import { pickTerminalSession } from "#lib/terminal/session-picker.js";
  import ConnectionStatus from "#lib/components/ConnectionStatus.svelte";
  let status = $state<Status | null>({
    phase: "connecting",
    message: "Preparing terminal",
  });
  let retry = () => window.location.reload();
  const dev = import.meta.env.DEV;
  import SessionTerminal from "#lib/components/SessionTerminal.svelte";
  import { takeLocalSession } from "#lib/session/local-connections.js";
  import {
    attachRemoteSession,
    type SessionResult,
  } from "#lib/terminal/remote-session.js";
  import type { SessionTerminal as Controller } from "#lib/terminal/create-terminal.js";
  import type { PageProps } from "./$types";
  let { params }: PageProps = $props();
  function attach(controller: Controller) {
    const local = dev ? takeLocalSession(params.session_id) : undefined;
    if (!local) {
      status = null;
      let session: ReturnType<typeof attachPairedSession> | undefined;
      const picker = pickTerminalSession(
        controller.terminal,
        params.session_id,
        {
          onSelect(id) {
            replaceState(`/s/${encodeURIComponent(id)}`, page.state);
            session = attachPairedSession(controller, id, {
              onStatus: (next) => {
                status = next;
              },
            });
            retry = () => {
              void session?.retry();
              controller.terminal.focus();
            };
          },
        },
      );
      return () => {
        picker.dispose();
        session?.dispose();
      };
    }
    status = null;
    const session = attachRemoteSession(controller, local.connection, {
      onState(state: SessionResult) {
        const messages = {
          connecting: "Connecting to workspace…",
          ready: "Connected.\r\n",
          failed: "Connection failed. Return to /dev/connect to try again.",
          disconnected: "Connection lost. The remote shell has disconnected.",
          exited: `Shell exited (${state.code ?? 0}).`,
          disposed: "",
          detached: "Detached. Open the session again to reconnect.",
          terminated: "Session terminated.",
        };
        if (state.state !== "disposed")
          controller.terminal.write(`\r\n${messages[state.state]}\r\n`);
      },
    });
    return () => session.dispose();
  }
</script>

<svelte:head><title>{params.session_id} | WebSSH</title></svelte:head>
{#key params.session_id}
  <SessionTerminal
    sessionId={params.session_id}
    onReady={attach}
    onError={() => {
      status = {
        phase: "failed",
        message: "Terminal unavailable",
        detail: "Reload to try again.",
        retryable: true,
      };
    }}
    options={{ screenReader: dev }}
  />
{/key}

{#if status}<ConnectionStatus {status} onRetry={() => retry()} />{/if}
