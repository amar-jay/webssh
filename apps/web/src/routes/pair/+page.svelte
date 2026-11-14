<script lang="ts">
  let { data } = $props();
  let status = $state<'idle' | 'working' | 'done' | 'error'>('idle');
  let message = $state('');

  async function approve() {
    if (!data.code || status === 'working' || status === 'done') return;
    status = 'working';
    message = '';
    try {
      const res = await fetch('/api/pairing/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: data.code })
      });
      const body = (await res.json()) as { error?: string; machineName?: string };
      if (!res.ok) {
        status = 'error';
        message = body.error || 'approval_failed';
        return;
      }
      status = 'done';
      message = `Paired ${body.machineName ?? 'machine'}. You can close this tab.`;
    } catch {
      status = 'error';
      message = 'approval_failed';
    }
  }
</script>

<main class="pair">
  <h1>Pair a machine</h1>
  {#if data.error}
    <p class="err">Invalid pairing code.</p>
    <form method="GET">
      <label>Code <input name="code" maxlength="8" autocomplete="off" /></label>
      <button type="submit">Continue</button>
    </form>
  {:else if !data.code}
    <p>Enter the 8-character code from <code>webssh pair</code>.</p>
    <form method="GET">
      <label>Code <input name="code" maxlength="8" autocomplete="off" /></label>
      <button type="submit">Continue</button>
    </form>
  {:else}
    <p>Pair <strong>{data.machineName}</strong> with your account? Code <code>{data.code}</code>?</p>
    {#if status === 'done'}
      <p class="ok">{message}</p>
    {:else}
      <button type="button" onclick={approve} disabled={status === 'working'}>
        {status === 'working' ? 'Approving…' : 'Approve machine'}
      </button>
      {#if status === 'error'}
        <p class="err">{message}</p>
      {/if}
    {/if}
  {/if}
  <div class="hint"><a href="/">Home</a> · <form method="POST" action="/logout"><button type="submit">Log out</button></form></div>
</main>

<style>
  :global(body) {
    margin: 0;
    min-height: 100vh;
    background: radial-gradient(1200px 600px at 20% -10%, #2a3358, #222436 55%);
    color: #c8d3f5;
    font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
  }
  .pair {
    max-width: 28rem;
    margin: 0 auto;
    padding: 4rem 1.5rem;
  }
  h1 {
    font-size: 2.4rem;
    letter-spacing: -0.03em;
    margin: 0 0 1rem;
    color: #c099ff;
  }
  code {
    font-family: "JetBrains Mono", ui-monospace, monospace;
    color: #4fd6be;
  }
  form { display: grid; gap: 0.75rem; margin-top: 1rem; }
  label { display: grid; gap: 0.35rem; color: #828bb8; }
  input {
    font: 16px/1.4 "JetBrains Mono", ui-monospace, monospace;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    border: 1px solid #444a73;
    background: #1b1d2b;
    color: #c8d3f5;
    padding: 0.65rem 0.75rem;
    border-radius: 4px;
  }
  button {
    margin-top: 1rem;
    border: 0;
    border-radius: 4px;
    padding: 0.7rem 1rem;
    background: #82aaff;
    color: #1b1d2b;
    font-weight: 600;
    cursor: pointer;
    width: fit-content;
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .ok { color: #c3e88d; }
  .err { color: #ff757f; }
  .hint { margin-top: 2rem; color: #828bb8; }
  a { color: #86e1fc; }
</style>
