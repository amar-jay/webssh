<script lang="ts">
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import Plus from "@lucide/svelte/icons/plus";
  import AppShell from "#lib/components/AppShell.svelte";
  import CommandCard from "#lib/components/CommandCard.svelte";
  import DataTable from "#lib/components/DataTable.svelte";
  import PollRefresh from "#lib/components/PollRefresh.svelte";
  import SessionTable from "#lib/components/SessionTable.svelte";
  import StatusBadge from "#lib/components/StatusBadge.svelte";
  import Tip from "#lib/components/Tip.svelte";
  import { iconAction } from "#lib/ui.js";
  let { data, form } = $props();
  let refreshFailed = $state(false);
</script>

<svelte:head><title>{data.agent.machineName} | WebSSH</title></svelte:head>
<AppShell signedIn={true} width="narrow">
  <a
    class="mb-5 inline-flex items-center gap-2 self-start text-sm text-secondary hover:text-ink"
    href="/machines"><ArrowLeft class="size-4" aria-hidden="true" />Machines</a
  >
  <div class="mb-6 flex w-full items-center justify-between gap-4">
    <h1 class="m-0 min-w-0 text-2xl tracking-tight wrap-anywhere">
      {data.agent.machineName}
    </h1>
    <PollRefresh bind:failed={refreshFailed} />
  </div>
  {#if form?.message}<p
      class="mb-4 w-full text-sm text-secondary"
      role="status"
    >
      {form.message}
    </p>{/if}
  {#if refreshFailed}<p class="mb-4 w-full text-sm text-danger" role="alert">
      Couldn’t refresh this machine. Try again.
    </p>{/if}
  {#if data.runs.length}
    <DataTable label="Workspaces on this machine">
      {#snippet headings()}<th scope="col" class="w-[42%]">Workspace</th><th
          scope="col"
          class="w-[26%]">Status</th
        ><th scope="col"><span class="sr-only">Actions</span></th>{/snippet}
      {#each data.runs as run (run.runId)}
        <tr>
          <td
            ><div class="font-medium">{run.workspaceLabel}</div>
            <div class="text-xs text-secondary">
              {run.backend === "tmux" ? "Persistent" : "Ephemeral"}
            </div></td
          >
          <td><StatusBadge status={run.status} /></td>
          <td
            ><form class="flex justify-end" method="POST" action="?/start">
              <input type="hidden" name="runId" value={run.runId} /><Tip
                class={iconAction}
                label={run.status === "online"
                  ? `New session in ${run.workspaceLabel}`
                  : "Workspace offline"}
                type="submit"
                disabled={run.status !== "online"}
                ><Plus class="size-4" aria-hidden="true" /></Tip
              >
            </form></td
          >
        </tr>
      {/each}
    </DataTable>
  {:else}
    <div class="flex w-full flex-col items-start gap-3">
      <p class="m-0 text-sm text-secondary">Start the agent on this machine.</p>
      <CommandCard command="webssh serve ." />
    </div>
  {/if}
  <h2 class="mt-8 mb-4 self-start text-lg">Sessions</h2>
  <SessionTable sessions={data.sessions} />
</AppShell>
