<script lang="ts">
  import type { AgentRecord, RunRecord, TerminalSessionRecord } from '@webssh/state/types';
  import Monitor from '@lucide/svelte/icons/monitor';
  import Unplug from '@lucide/svelte/icons/unplug';
  import CommandCard from './CommandCard.svelte';
  import ConfirmForm from './ConfirmForm.svelte';
  import DataTable from './DataTable.svelte';
  import PollRefresh from './PollRefresh.svelte';
  import StatusBadge from './StatusBadge.svelte';
  let { agents, runs, sessions, unavailable, message }: {
    agents: AgentRecord[]; runs: RunRecord[]; sessions: TerminalSessionRecord[];
    unavailable: boolean; message?: string;
  } = $props();
  let refreshFailed = $state(false);
  function machineStatus(agentId: string) {
    const current = runs.filter((run) => run.agentId === agentId);
    return current.some((run) => run.status === 'online') ? 'online'
      : current.some((run) => run.status === 'starting') ? 'starting' : 'offline';
  }
</script>

<div class="mb-5 flex w-full items-center justify-between gap-4">
  <h1 class="m-0 text-2xl tracking-tight">Machines</h1>
  <PollRefresh bind:failed={refreshFailed} />
</div>
{#if message}<p class="mb-4 w-full text-sm text-secondary" role="status">{message}</p>{/if}
{#if unavailable || refreshFailed}<p class="mb-4 w-full text-sm text-danger" role="alert">Couldn’t load machines. Refresh to try again.</p>{/if}
{#if !agents.length && !unavailable}
  <div class="flex w-full flex-col items-start gap-3"><p class="m-0 text-sm text-secondary">Pair your first machine.</p><CommandCard command="webssh pair" /></div>
{:else if agents.length}
  <DataTable label="Your machines">
    {#snippet headings()}
      <th scope="col" class="w-[42%] md:w-[48%]">Machine</th>
      <th scope="col" class="w-[28%] md:w-[24%]">Status</th>
      <th scope="col" aria-label="Sessions"><span class="hidden sm:inline">Sessions</span><span class="sm:hidden" aria-hidden="true">#</span></th>
      <th scope="col" class="w-12 md:w-16"><span class="sr-only">Actions</span></th>
    {/snippet}
    {#each agents as agent (agent.agentId)}
      <tr>
        <td><a class="flex min-h-9 items-center gap-2.5 font-medium hover:text-accent" href={`/machines/${encodeURIComponent(agent.agentId)}`}><Monitor class="hidden size-4 shrink-0 text-accent sm:block" aria-hidden="true" /><span class="wrap-anywhere">{agent.machineName}</span></a></td>
        <td><StatusBadge status={machineStatus(agent.agentId)} /></td>
        <td><a class="inline-flex min-h-9 min-w-6 items-center text-accent hover:text-ink" href={`/machines/${encodeURIComponent(agent.agentId)}`} aria-label={`Sessions on ${agent.machineName}`}>{sessions.filter((session) => session.agentId === agent.agentId && !['ended', 'expired'].includes(session.status)).length}</a></td>
        <td class="text-right">
          <ConfirmForm label={`Revoke ${agent.machineName}`} title={`Revoke ${agent.machineName}?`} description="Connections stop. Work in tmux stays on the machine." confirm="Revoke" action="?/revoke" fields={{ agentId: agent.agentId }}>
            {#snippet icon()}<Unplug class="size-4" aria-hidden="true" />{/snippet}
          </ConfirmForm>
        </td>
      </tr>
    {/each}
  </DataTable>
{/if}
