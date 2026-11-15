<script lang="ts">
  import type { AgentRecord, TerminalSessionRecord } from "@webssh/state/types";
  import CommandCard from "./CommandCard.svelte";
  import ConfirmForm from "./ConfirmForm.svelte";
  import ListRow from "./ListRow.svelte";
  import Panel from "./Panel.svelte";
  import PollRefresh from "./PollRefresh.svelte";
  import { textAction } from "#lib/ui.js";

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
  let refreshFailed = $state(false);
  const labels = {
    connecting: "Ready",
    active: "Active",
    offline: "Offline",
    ended: "Ended",
    expired: "Expired",
  };
</script>

{#if message}<p class="mb-4 text-center text-sm text-secondary" role="status">{message}</p>{/if}
{#if unavailable || refreshFailed}<p class="mb-4 text-center text-sm text-danger" role="alert">
    Couldn’t load sessions.
  </p>{/if}
{#if !sessions.length}
  <CommandCard command="webssh serve ." />
  <PollRefresh bind:failed={refreshFailed} show={false} />
{:else}
  <Panel>
    {#snippet toolbar()}
      <PollRefresh bind:failed={refreshFailed} />
    {/snippet}
    {#each sessions as session (session.terminalSessionId)}
      <ListRow>
        <div class="min-w-0 flex-1">
          <div class="truncate">{session.workspaceLabel || "Workspace"}</div>
          <div class="truncate text-xs text-secondary">
            {agents.find((agent) => agent.agentId === session.agentId)?.machineName ||
              "Machine"} · {session.terminationRequested ? "Ending" : labels[session.status]}
          </div>
        </div>
        {#if !["ended", "expired"].includes(session.status)}
          <div class="flex items-center">
            <a class={textAction} href={`/s/${session.terminalSessionId}`}>Open</a>
            <ConfirmForm
              label="End"
              title="End this session?"
              description="The agent closes it on the next check-in."
              confirm="End"
              action="?/end"
              fields={{ sessionId: session.terminalSessionId }}
            />
          </div>
        {/if}
      </ListRow>
    {/each}
  </Panel>
{/if}
