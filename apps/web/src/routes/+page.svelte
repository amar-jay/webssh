<script lang="ts">
  let { data } = $props();
</script>

<svelte:head>
  <title>WebSSH</title>
  <meta name="description" content="A browser terminal for your remote machines." />
</svelte:head>

<main>
  <p class="label">WebSSH</p>
  <h1>Your shell, in the browser.</h1>
  <p>Private owner access via GitHub. Pair a machine, then open a terminal session.</p>
  {#if data.error}
    <p class="err">{data.error}</p>
  {/if}
  <nav>
    {#if data.user}
      <a href="/pair">Pair a machine</a>
      <form method="POST" action="/logout"><button type="submit">Log out</button></form>
    {:else}
      <a class="primary" href="/login">Sign in with GitHub</a>
    {/if}
  </nav>
</main>

<style>
  :global(body) {
    margin: 0;
    min-height: 100vh;
    background: radial-gradient(1200px 600px at 20% -10%, #2a3358, #222436 55%);
    color: #c8d3f5;
    font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
  }
  main { max-width: 40rem; margin: 0 auto; padding: 4rem 1.5rem; }
  .label { font: 13px/1 "JetBrains Mono", ui-monospace, monospace; color: #828bb8; }
  h1 { font-size: clamp(2rem, 5vw, 3rem); letter-spacing: -0.04em; color: #c099ff; }
  nav { display: flex; gap: 1rem; align-items: center; margin-top: 1.5rem; }
  a, button {
    font: inherit;
    color: #1b1d2b;
    background: #82aaff;
    text-decoration: none;
    border: 0;
    border-radius: 4px;
    padding: 0.65rem 0.9rem;
    cursor: pointer;
  }
  a:not(.primary) { background: transparent; color: #86e1fc; padding-left: 0; }
  .err { color: #ff757f; }
</style>
