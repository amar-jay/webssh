<svelte:head>
  <title>WebSSH</title>
  <meta name="description" content="A browser terminal for your remote machines." />
</svelte:head>

<main>
  <p class="label">WebSSH / development</p>
  <h1>Your shell, in the browser.</h1>
  <p>The web app is ready. Remote connections are the next step.</p>
  <section aria-labelledby="terminal-heading">
    <header><h2 id="terminal-heading">Terminal</h2><span>Disconnected</span></header>
    <div class="terminal"><p>No machine connected.</p><p>Pairing and terminal transport are not implemented yet.</p></div>
  </section>
</main>

<style>
  :global(body) { margin: 0; background: #edf2f7; color: #183047; font-family: system-ui, sans-serif; }
  main { max-width: 960px; margin: 0 auto; padding: 64px 24px; }
  .label { font: 13px ui-monospace, monospace; color: #46647e; }
  h1 { font-size: clamp(28px, 5vw, 44px); font-weight: 600; letter-spacing: -0.04em; }
  section { margin-top: 40px; border: 1px solid #b9c9d8; border-radius: 8px; overflow: hidden; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; background: #fff; }
  h2 { margin: 0; font-size: 14px; font-weight: 600; }
  span { font-size: 12px; color: #566b7d; }
  .terminal { min-height: 280px; padding: 20px; background: #152638; color: #c5d5e3; font: 13px/1.6 ui-monospace, monospace; }
  .terminal p { margin: 0 0 8px; }
</style>
