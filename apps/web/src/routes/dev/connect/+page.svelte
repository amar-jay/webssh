<script lang="ts">
  import { onMount } from 'svelte';
  let mounted = $state(false);
  onMount(() => { mounted = true; });
  import { goto } from '$app/navigation';
  import { putLocalSession } from '#lib/session/local-connections.js';
  let record = $state('');
  let problem = $state('');
  function connect(event: SubmitEvent) {
    event.preventDefault();
    try {
      const value = JSON.parse(record);
      if (value.version !== 1 || typeof value.address !== 'string' || !value.address.startsWith('tc') || typeof value.token !== 'string' || value.token.length < 32 || value.token.length > 128 || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new Error();
      const id = putLocalSession({ mode: 'remote', connection: { address: value.address, token: value.token, port: value.port } });
      record = ''; problem = '';
      void goto(`/s/${id}`);
    } catch { problem = 'Paste a valid connection record from webssh serve --json.'; }
  }
  function mock() { record = ''; void goto(`/s/${putLocalSession({ mode: 'mock' })}`); }
</script>
<svelte:head><title>Local connection · WebSSH</title></svelte:head>
<main>
  <p class="label">WebSSH / local development</p>
  <h1>Connect to your workspace.</h1>
  <p>Run <code>webssh serve --json &lt;path&gt;</code> and paste its connection record below.</p>
  <form onsubmit={connect}>
    <label for="record">Connection record</label>
    <textarea id="record" bind:value={record} spellcheck="false" autocomplete="off" autocapitalize="off" rows="8" required></textarea>
    <p class="hint">Kept in memory for this navigation only. Reloading requires a new handoff.</p>
    {#if problem}<p role="alert">{problem}</p>{/if}
    <button type="submit" disabled={!mounted}>Connect</button>
    <button type="button" disabled={!mounted} class="secondary" onclick={mock}>Open mock terminal</button>
  </form>
</main>
<style>
  :global(body) { margin: 0; background: #222436; color: #c8d3f5; font-family: system-ui, sans-serif; }
  main { max-width: 660px; padding: 64px 24px; margin: auto; }
  .label, code, textarea { font-family: ui-monospace, monospace; }
  .label { color: #4fd6be; font-size: 13px; }
  h1 { font-size: clamp(28px, 5vw, 38px); letter-spacing: -.035em; }
  p { line-height: 1.6; }
  form { margin-top: 32px; }
  label { display: block; margin-bottom: 10px; }
  textarea { box-sizing: border-box; width: 100%; padding: 14px; background: #1b1d2b; color: #c8d3f5; border: 1px solid #444a73; border-radius: 6px; resize: vertical; }
  .hint { font-size: 13px; color: #828bb8; }
  button { padding: 11px 18px; margin: 12px 12px 0 0; border: 1px solid #82aaff; border-radius: 5px; background: #82aaff; color: #222436; cursor: pointer; font: inherit; }
  .secondary { background: transparent; color: #c8d3f5; border-color: #444a73; }
  :focus-visible { outline: 2px solid #4fd6be; outline-offset: 3px; }
  [role=alert] { color: #ff757f; }
</style>
