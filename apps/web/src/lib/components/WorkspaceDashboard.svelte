<script lang="ts">
  import { Dialog } from "bits-ui";
  import { onMount } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import type {
    AgentRecord,
    RunRecord,
    TerminalSessionRecord,
  } from "@webssh/state/types";
  import CommandBlock from "./CommandBlock.svelte";
  let {
    agents,
    runs,
    sessions,
    unavailable,
    message,
  }: {
    agents: AgentRecord[];
    runs: RunRecord[];
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

<main class="dashboard">
  <div class="dashboard-heading">
    <div>
      <p class="eyebrow">YOUR WORKSPACE</p>
      <h1>Machines & sessions.</h1>
      <p class="muted">Open a running workspace, or pair a new machine.</p>
    </div>
    <a class="button primary" href="/pair"
      >Pair machine <span aria-hidden="true">+</span></a
    >
  </div>
  {#if message}<p class="inline-note" role="status">{message}</p>{/if}
  {#if unavailable || refreshFailed}<p class="notice error" role="alert">
      Couldn’t load your workspaces. Check your connection and refresh.
    </p>{/if}
  <div class="section-heading">
    <h2>Machines <span class="pill">{agents.length}</span></h2>
    <button class="button quiet" onclick={refresh} disabled={refreshing}
      >{refreshing ? "Refreshing…" : "Refresh"}</button
    >
  </div>
  {#if !agents.length}<section class="empty-state">
      <h3>Your first machine starts here.</h3>
      <p class="muted">
        Run this on the machine you want to access, then approve its code.
      </p>
      <CommandBlock command="webssh pair" />
    </section>{/if}
  <div class="machine-grid">
    {#each agents as agent (agent.agentId)}
      {@const workspaces = runs.filter(
        (r) =>
          r.agentId === agent.agentId &&
          !["ended", "expired"].includes(r.status),
      )}
      <section class="workspace-card">
        <div class="workspace-heading">
          <span class="machine-icon" aria-hidden="true">›_</span>
          <div>
            <h3>{agent.machineName}</h3>
            <span class="muted small"
              >{workspaces.some((r) => r.status === "online")
                ? "Available"
                : "Offline"}</span
            >
          </div>
          <Dialog.Root>
            <Dialog.Trigger class="button quiet">Revoke access</Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay class="dialog-overlay" />
              <Dialog.Content class="dialog-content">
                <Dialog.Title class="dialog-title"
                  >Revoke {agent.machineName}?</Dialog.Title
                >
                <Dialog.Description class="muted"
                  >Current browser connections will detach and new connections
                  will be blocked. Tmux work stays on the machine. Pair the
                  machine again to restore access.</Dialog.Description
                >
                <form method="POST" action="?/revoke">
                  <input type="hidden" name="agentId" value={agent.agentId} />
                  <button type="submit" class="button primary"
                    >Revoke access</button
                  >
                  <Dialog.Close class="button quiet">Cancel</Dialog.Close>
                </form>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
        {#if !workspaces.length}<p class="muted small">
            Start the agent in your workspace to make it available here.
          </p>
          <CommandBlock command="webssh serve ." />{/if}
        {#each workspaces as run (run.runId)}<div class="workspace-run">
            <div>
              <strong>{run.workspaceLabel}</strong><span class="muted small"
                >{run.backend === "tmux" ? "Persistent" : "Ephemeral"}</span
              ><span class="pill"
                >{run.status === "online"
                  ? "Ready"
                  : run.status === "starting"
                    ? "Starting"
                    : "Offline"}</span
              >
            </div>
            <form method="POST" action="?/start">
              <input type="hidden" name="runId" value={run.runId} /><button
                class="button subtle"
                disabled={run.status !== "online"}
                type="submit"
                >Open terminal <span aria-hidden="true">↗</span></button
              >
            </form>
          </div>{/each}
      </section>
    {/each}
  </div>
  <div class="section-heading">
    <h2>Sessions</h2>
    <span class="muted small">Availability updates every 10 seconds</span>
  </div>
  {#if !sessions.length}<p class="empty-state muted">
      No sessions yet. Run <code>webssh serve .</code> on a paired machine.
    </p>{:else}<div class="session-list">
      {#each sessions as session (session.terminalSessionId)}<div
          class="session-row"
        >
          <div>
            <strong>{session.workspaceLabel || "Workspace"}</strong>
            <p class="muted small">
              {agents.find((a) => a.agentId === session.agentId)?.machineName ||
                "Machine"}
            </p>
          </div>
          <span class="pill"
            >{session.terminationRequested
              ? "Termination pending"
              : labels[session.status]}</span
          >
          <div class="session-actions">
            {#if !["ended", "expired"].includes(session.status)}<a
                class="button subtle"
                href={`/s/${session.terminalSessionId}`}>Open</a
              >
              <form method="POST" action="?/end">
                <input
                  type="hidden"
                  name="sessionId"
                  value={session.terminalSessionId}
                /><button class="button quiet" type="submit">Terminate</button>
              </form>{/if}
          </div>
        </div>{/each}
    </div>{/if}
  <p class="muted small">
    Offline means the agent hasn’t checked in. It does not confirm that a shell
    has exited.
  </p>
</main>
