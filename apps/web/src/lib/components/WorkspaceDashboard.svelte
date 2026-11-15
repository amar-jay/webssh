<script lang="ts">
  import type { AgentRecord, RunRecord } from "@webssh/state/types";
  import CommandBlock from "./CommandBlock.svelte";
  import CommandCard from "./CommandCard.svelte";
  import ConfirmForm from "./ConfirmForm.svelte";
  import ListRow from "./ListRow.svelte";
  import Panel from "./Panel.svelte";
  import PollRefresh from "./PollRefresh.svelte";
  import { textAction } from "#lib/ui.js";

  let {
    agents,
    runs,
    unavailable,
    message,
  }: {
    agents: AgentRecord[];
    runs: RunRecord[];
    unavailable: boolean;
    message?: string;
  } = $props();
  let refreshFailed = $state(false);

  const rows = $derived(
    agents.flatMap<{ agent: AgentRecord; run: RunRecord | null }>((agent) => {
      const workspaces = runs.filter(
        (run) =>
          run.agentId === agent.agentId &&
          !["ended", "expired"].includes(run.status),
      );
      return workspaces.length
        ? workspaces.map((run) => ({ agent, run }))
        : [{ agent, run: null }];
    }),
  );

  function statusLabel(status: string | undefined) {
    if (status === "online") return "Online";
    if (status === "starting") return "Starting";
    return "Offline";
  }
</script>

{#if message}<p class="mb-4 text-center text-sm text-secondary" role="status">{message}</p>{/if}
{#if unavailable || refreshFailed}<p class="mb-4 text-center text-sm text-danger" role="alert">
    Couldn’t load machines.
  </p>{/if}
{#if !agents.length}
  <CommandCard command="webssh pair" />
  <PollRefresh bind:failed={refreshFailed} show={false} />
{:else}
  <Panel>
    {#snippet toolbar()}
      <PollRefresh bind:failed={refreshFailed} />
    {/snippet}
    {#each rows as row (row.run?.runId ?? row.agent.agentId)}
      <ListRow>
        <div class="min-w-0 flex-1">
          <div class="truncate">{row.agent.machineName}</div>
          <div class="truncate text-xs text-secondary">
            {#if row.run}{row.run.workspaceLabel} · {statusLabel(row.run.status)}{:else}Offline{/if}
          </div>
          {#if !row.run}
            <div class="mt-2"><CommandBlock bare command="webssh serve ." /></div>
          {/if}
        </div>
        <div class="flex items-center">
          {#if row.run?.status === "online"}
            <form method="POST" action="?/start">
              <input type="hidden" name="runId" value={row.run.runId} />
              <button class={textAction} type="submit">Open</button>
            </form>
          {/if}
          <ConfirmForm
            label="Revoke"
            title={`Revoke ${row.agent.machineName}?`}
            description="Connections stop. Work in tmux stays on the machine."
            confirm="Revoke"
            action="?/revoke"
            fields={{ agentId: row.agent.agentId }}
          />
        </div>
      </ListRow>
    {/each}
  </Panel>
{/if}
