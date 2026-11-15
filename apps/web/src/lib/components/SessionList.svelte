<script lang="ts">
  import { onMount } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import type { AgentRecord, TerminalSessionRecord } from "@webssh/state/types";
  import { buttonQuiet, buttonSubtle, eyebrow, pill } from "#lib/ui.js";

  let {
    agents,
    sessions,
    unavailable,
    message,
  }: {
    agents: AgentRecord[];
    sessions: TerminalSessionRecord[];
    unavailable: boolean;
    message?: string;
  } = $props();
  let refreshing = $state(false);
  let refreshFailed = $state(false);
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      await invalidateAll();
      refreshFailed = false;
    } catch {
      refreshFailed = true;
    } finally {
      refreshing = false;
    }
  }
  onMount(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 10_000);
    return () => clearInterval(timer);
  });
  const labels = {
    connecting: "Ready to open",
    active: "Active",
    offline: "Offline",
    ended: "Ended",
    expired: "Expired",
  };
</script>

<main class="pt-14 pb-[70px]">
  <div class="mb-9 flex items-end justify-between gap-6">
    <div>
      <p class={eyebrow}>YOUR WORKSPACE</p>
      <h1 class="mb-3 text-3xl tracking-tight min-[721px]:text-4xl">Sessions.</h1>
    </div>
    <button class={buttonQuiet} onclick={refresh} disabled={refreshing}
      >{refreshing ? "Refreshing…" : "Refresh"}</button
    >
  </div>
  {#if message}<p
      class="border-l-2 border-accent bg-accent/5 px-3 py-2 text-sm text-secondary"
      role="status"
    >
      {message}
    </p>{/if}
  {#if unavailable || refreshFailed}<p
      class="mt-5 rounded-lg border border-coral/50 bg-raised p-3.5 text-sm text-danger"
      role="alert"
    >
      Couldn’t load your sessions. Check your connection and refresh.
    </p>{/if}
  {#if !sessions.length}<p
      class="mt-8 rounded-xl border border-line bg-surface p-6 text-secondary"
    >
      No sessions yet. Run <code>webssh serve .</code> on a paired machine.
    </p>{:else}<div class="mt-8 overflow-hidden rounded-xl border border-line">
      {#each sessions as session (session.terminalSessionId)}<div
          class="flex flex-wrap items-center gap-5 border-t border-line bg-surface p-5 first:border-t-0 min-[721px]:flex-nowrap min-[721px]:px-6 min-[721px]:py-5"
        >
          <div class="min-w-0 flex-1 wrap-anywhere">
            <strong>{session.workspaceLabel || "Workspace"}</strong>
            <p class="mt-1.5 mb-0 text-sm text-secondary">
              {agents.find((agent) => agent.agentId === session.agentId)
                ?.machineName || "Machine"}
            </p>
          </div>
          <span class={pill}
            >{session.terminationRequested
              ? "Termination pending"
              : labels[session.status]}</span
          >
          <div class="flex w-full items-center gap-2.5 min-[721px]:w-auto">
            {#if !["ended", "expired"].includes(session.status)}<a
                class={buttonSubtle}
                href={`/s/${session.terminalSessionId}`}>Open</a
              >
              <form method="POST" action="?/end">
                <input
                  type="hidden"
                  name="sessionId"
                  value={session.terminalSessionId}
                /><button class={buttonQuiet} type="submit">Terminate</button>
              </form>{/if}
          </div>
        </div>{/each}
    </div>{/if}
  <p class="text-sm text-secondary">
    Offline means the agent hasn’t checked in. It does not confirm that a shell
    has exited.
  </p>
</main>
