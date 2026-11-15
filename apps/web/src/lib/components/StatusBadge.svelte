<script lang="ts">
  let { status }: { status: string } = $props();
  const labels: Record<string, string> = { online: 'Online', starting: 'Starting', connecting: 'Ready', active: 'Active', offline: 'Offline', ended: 'Ended', expired: 'Expired', ending: 'Ending' };
</script>
<span class="inline-flex items-center gap-1.5 text-xs leading-relaxed">
  <span class="size-1.5 shrink-0 rounded-full {status === 'online' || status === 'active' ? 'bg-[#c3e88d]' : status === 'starting' || status === 'connecting' || status === 'ending' ? 'bg-accent' : 'bg-secondary'}" aria-hidden="true"></span>
  {labels[status] ?? 'Offline'}
</span>
