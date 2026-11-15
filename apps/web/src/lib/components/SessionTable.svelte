<script lang="ts">
  import type { TerminalSessionRecord } from '@webssh/state/types';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import Square from '@lucide/svelte/icons/square';
  import ConfirmForm from './ConfirmForm.svelte';
  import DataTable from './DataTable.svelte';
  import StatusBadge from './StatusBadge.svelte';
  import { iconAction } from '#lib/ui.js';
  let { sessions }: { sessions: TerminalSessionRecord[] } = $props();
</script>

<DataTable label="Sessions on this machine">
  {#snippet headings()}
    <th scope="col" class="w-[42%]">Session</th><th scope="col" class="w-[26%]">Status</th><th scope="col"><span class="sr-only">Actions</span></th>
  {/snippet}
  {#each sessions as session (session.terminalSessionId)}
    <tr>
      <td><div class="font-medium">{session.workspaceLabel || 'Workspace'}</div><span class="font-mono text-xs text-secondary">{session.terminalSessionId.slice(0, 8)}</span></td>
      <td><StatusBadge status={session.terminationRequested && !['ended', 'expired'].includes(session.status) ? 'ending' : session.status} /></td>
      <td>
        {#if !['ended', 'expired'].includes(session.status)}
          <div class="flex justify-end">
            {#if !session.terminationRequested}
              <a class={iconAction} href={`/s/${session.terminalSessionId}`} aria-label={`Open session ${session.terminalSessionId.slice(0, 8)}`} title="Open terminal"><ArrowUpRight class="size-4" aria-hidden="true" /></a>
              <ConfirmForm label={`End session ${session.terminalSessionId.slice(0, 8)}`} title="End this session?" description="This stops the remote process. Work in other sessions stays running." confirm="End session" action="?/end" fields={{ sessionId: session.terminalSessionId }}>
                {#snippet icon()}<Square class="size-3.5" aria-hidden="true" />{/snippet}
              </ConfirmForm>
            {/if}
          </div>
        {/if}
      </td>
    </tr>
  {:else}
    <tr><td colspan="3" class="text-secondary">No sessions yet. Start one from an online workspace.</td></tr>
  {/each}
</DataTable>
