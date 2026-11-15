<script lang="ts">
  import { Tabs } from 'bits-ui';
  import CommandBlock from './CommandBlock.svelte';
  let { error }: { error?: string | null } = $props();
</script>

<div class="landing">
  <div class="atmosphere" aria-hidden="true">
    <div class="blade blade-one"></div><div class="blade blade-two"></div><div class="blade blade-three"></div>
    <svg class="grain" width="100%" height="100%"><filter id="landing-grain"><feTurbulence type="fractalNoise" baseFrequency=".76" numOctaves="3" stitchTiles="stitch" /></filter><rect width="100%" height="100%" filter="url(#landing-grain)" opacity=".25" /></svg>
    <div class="vignette"></div>
  </div>

  <header class="floating-nav">
    <a class="wordmark" href="/" aria-label="WebSSH home"><span class="diamond" aria-hidden="true"></span>webssh<span class="wordmark-dot">.</span></a>
    <nav aria-label="Main navigation"><a href="#workspace">How it works</a><a href="/pair">Pair a machine</a><a href="https://github.com/amar-jay/webssh">GitHub <span aria-hidden="true">↗</span></a></nav>
    <a class="nav-login" href="/login">Sign in <span aria-hidden="true">↗</span></a>
  </header>

  <main class="hero">
    <a class="announcement" href="https://github.com/amar-jay/webssh/releases"><span class="live-dot"></span> YOUR WORKSPACE, WITHOUT THE DISTANCE <span aria-hidden="true">↗</span></a>
    <h1>Your terminal.<br /><span>Anywhere you are.</span></h1>
    <p class="hero-copy">The shell you know. The machine you trust.<br />Bring your workspace to the browser. Keep your work running.</p>
    <div class="hero-actions"><a class="start-button" href="/login">Get started with GitHub <span aria-hidden="true">→</span></a><a class="source-link" href="https://github.com/amar-jay/webssh">Explore the source <span aria-hidden="true">↗</span></a></div>
    {#if error}<p class="auth-error" role="alert">{error === 'auth_not_configured' ? 'Sign-in is unavailable right now. Please try again later.' : 'Sign-in didn’t complete. Please try signing in again.'}</p>{/if}
    <p class="platforms">YOUR MACHINE. YOUR SHELL. <span>LINUX & macOS.</span></p>

    <section id="workspace" class="terminal-preview" aria-label="Connect your workspace">
      <div class="terminal-title"><div class="window-dots" aria-hidden="true"><i></i><i></i><i></i></div><span>your workspace / anywhere</span><span class="terminal-symbol" aria-hidden="true">⌘</span></div>
      <Tabs.Root value="pair">
        <Tabs.List class="setup-tabs" aria-label="Workspace setup"><Tabs.Trigger class="setup-tab" value="pair">01 <span>Pair your machine</span></Tabs.Trigger><Tabs.Trigger class="setup-tab" value="serve">02 <span>Open your workspace</span></Tabs.Trigger></Tabs.List>
        <Tabs.Content value="pair" class="setup-content"><p class="terminal-comment"># With the CLI installed, connect your machine to your account</p><CommandBlock command="webssh pair" /><div class="terminal-bottom"><span>Approve the code with your GitHub account.</span><a href="/pair">Enter a pairing code <span aria-hidden="true">→</span></a></div></Tabs.Content>
        <Tabs.Content value="serve" class="setup-content"><p class="terminal-comment"># Start in the folder you want to work in</p><CommandBlock command="webssh serve ." /><div class="terminal-bottom"><span>Keep the agent running. Open the URL it prints.</span><a href="/login">Sign in to your workspace <span aria-hidden="true">→</span></a></div></Tabs.Content>
      </Tabs.Root>
    </section>
    <div class="hero-footnote"><span>Browser access</span><b aria-hidden="true">·</b><span>Your own machine</span><b aria-hidden="true">·</b><span>Persistent sessions with tmux</span></div>
  </main>
  <footer><span>BUILT FOR THE WAY YOU WORK.</span><a href="https://github.com/amar-jay/webssh/releases">Download the CLI <span aria-hidden="true">↗</span></a></footer>
</div>

<style>
  .landing { --mono: 'JetBrains Mono', monospace; --muted: #9c9c9d; --warm: #ffb347; position: relative; isolation: isolate; min-height: 100svh; overflow: hidden; background: #07080a; color: #f6f3ef; font-family: 'Segoe UI', Arial, sans-serif; padding: 32px 40px 0; }
  .atmosphere { position: absolute; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; }
  .blade { position: absolute; width: 1050px; height: 240px; border-radius: 100%; transform: rotate(-34deg); background: radial-gradient(ellipse at 70% 50%, #ffb34799 0%, #ff6b4a85 22%, #ff2f3aa8 43%, #ff2f3a00 72%); filter: blur(44px); mix-blend-mode: screen; will-change: transform, opacity; animation: drift 18s ease-in-out infinite; }
  .blade-one { top: 105px; left: calc(50% - 970px); }
  .blade-two { top: 80px; left: calc(50% + 60px); height: 190px; animation-duration: 22s; animation-direction: reverse; }
  .blade-three { top: 380px; left: calc(50% - 400px); width: 850px; height: 110px; filter: blur(65px); animation-duration: 15s; }
  .grain { position: absolute; inset: 0; opacity: .13; mix-blend-mode: screen; }
  .vignette { position: absolute; inset: 0; background: radial-gradient(ellipse at 50% 36%, transparent 5%, #07080a55 50%, #07080a 90%); }
  @keyframes drift { 0%, 100% { transform: translate(0, 0) rotate(-34deg) scale(1.12); opacity: 1; } 50% { transform: translate(65px, -28px) rotate(-29deg) scale(.9); opacity: .55; } }
  .floating-nav { max-width: 960px; margin: 0 auto; padding: 10px 12px 10px 25px; min-height: 64px; display: flex; align-items: center; gap: 32px; border: 1px solid #ffffff1c; border-radius: 100px; background: #101113b8; box-shadow: inset 0 1px 0 #ffffff0d, 0 8px 40px #0003; backdrop-filter: blur(24px); }
  .wordmark { display: flex; align-items: center; font-size: 22px; font-weight: 650; letter-spacing: -1px; }
  .wordmark-dot { color: #ff6b4a; }
  .diamond { width: 16px; height: 20px; margin-right: 12px; background: linear-gradient(135deg, #ffd09a, #ff6b4a 55%, #ff2f3a); clip-path: polygon(50% 0,100% 50%,50% 100%,0 50%); filter: drop-shadow(0 0 8px #ff6b4a); }
  nav { display: flex; justify-content: center; gap: 30px; flex: 1; color: #9c9c9d; font-size: 14px; font-weight: 500; }
  nav a:hover, .source-link:hover, footer a:hover { color: #fff0dd; }
  .nav-login { padding: 11px 19px; border: 1px solid #ffffff20; border-radius: 30px; background: #ffffff08; font-size: 13px; }
  .nav-login span { margin-left: 16px; color: #aaa; }
  .hero { text-align: center; max-width: 1000px; margin: 0 auto; padding: 69px 0 30px; }
  .announcement { display: inline-flex; align-items: center; gap: 10px; padding: 8px 12px; border: 1px solid #ffac7d30; border-radius: 30px; background: #23141260; color: #e5bba4; font: 9px/1.5 var(--mono); letter-spacing: 1.2px; }
  .announcement > span:last-child { margin-left: 6px; }
  .live-dot { width: 5px; height: 5px; background: #ffb347; border-radius: 50%; box-shadow: 0 0 9px #ff6b4a; }
  h1 { font-size: clamp(52px, 6.2vw, 88px); font-weight: 550; line-height: 1.03; letter-spacing: -5px; margin: 27px 0 22px; }
  h1 span { background: linear-gradient(110deg, #fff3e7 15%, #ffc2a2 55%, #ff956e); background-clip: text; -webkit-text-fill-color: transparent; }
  .hero-copy { color: #b4acaa; font-size: 17px; line-height: 1.7; margin-bottom: 25px; }
  .hero-actions { display: flex; align-items: center; justify-content: center; gap: 27px; }
  .start-button { display: inline-flex; align-items: center; gap: 25px; background: #f4eee8; color: #211510; border: 1px solid #fff9; border-radius: 8px; padding: 14px 19px; font-size: 13px; font-weight: 650; box-shadow: 0 0 30px #ff6b4a22, inset 0 -2px 0 #0001; transition: background .2s, transform .2s; }
  .start-button:hover { background: #ffd7bd; transform: translateY(-2px); }
  .source-link { font-size: 13px; color: #c3b8b2; }
  .source-link span { margin-left: 10px; }
  .platforms { font: 8px/1.6 var(--mono); letter-spacing: 1.4px; color: #8d7b71; margin: 18px 0 32px; }
  .platforms span { color: #b6a398; }
  .terminal-preview { max-width: 680px; margin: 0 auto; text-align: left; background: #0d0e10e8; border: 1px solid #d7b6a02b; border-radius: 12px; box-shadow: 0 25px 70px #0007, 0 -1px 30px #ff6b4a08, inset 0 1px 0 #ffffff06; scroll-margin-top: 25px; }
  .terminal-title { display: flex; align-items: center; justify-content: space-between; padding: 14px 19px; border-bottom: 1px solid #ffffff0c; color: #807b78; font: 10px var(--mono); }
  .window-dots { display: flex; gap: 6px; }
  .window-dots i { width: 7px; height: 7px; background: #62514a; border-radius: 50%; }
  .window-dots i:first-child { background: #c36b56; }.window-dots i:nth-child(2) { background: #a58756; }
  .terminal-symbol { color: #62564f; }
  .terminal-preview :global(.setup-tabs) { display: flex; gap: 26px; padding: 0 23px; border-bottom: 1px solid #ffffff0b; }
  .terminal-preview :global(.setup-tab) { padding: 15px 0 13px; font: 10px var(--mono); color: #77716d; background: transparent; border: 0; border-bottom: 1px solid transparent; }
  .terminal-preview :global(.setup-tab span) { margin-left: 6px; }
  .terminal-preview :global(.setup-tab[data-state='active']) { color: #ffc0a0; border-bottom-color: #ff956e; }
  .terminal-preview :global(.setup-content) { padding: 20px 23px; }
  .terminal-comment { color: #79736e; font: 10px/1.6 var(--mono); margin-bottom: 12px; }
  .terminal-preview :global(.command-block) { padding: 0; border: 0; background: transparent; margin: 0 0 20px; }
  .terminal-preview :global(.command-block code) { color: #f0e4da; font-size: 14px; }
  .terminal-preview :global(.prompt) { color: #ff956e; }
  .terminal-preview :global(.copy-button) { border-color: #ffffff20; color: #a99d94; padding: 5px 9px; }
  .terminal-bottom { display: flex; justify-content: space-between; gap: 16px; color: #837c77; font-size: 10px; line-height: 1.6; }
  .terminal-bottom a { color: #dbab8d; }
  .hero-footnote { display: flex; align-items: center; justify-content: center; gap: 17px; margin-top: 23px; color: #77716d; font-size: 10px; }
  .hero-footnote b { color: #5f3f30; }
  .auth-error { max-width: 500px; margin: 18px auto 0; color: #ffc0a0; font-size: 13px; }
  footer { max-width: 1200px; margin: 0 auto; padding: 20px 0 22px; display: flex; justify-content: space-between; color: #645e59; font: 8px var(--mono); letter-spacing: 1px; }
  footer a { color: #9c8b80; letter-spacing: 0; font-size: 10px; }
  .landing :global(a:focus-visible), .landing :global(button:focus-visible) { outline-color: #ffb347; }
  @media (min-width: 721px) and (max-height: 950px) { .hero { padding: 30px 0 16px; } h1 { font-size: clamp(60px, 5.2vw, 74px); margin: 20px 0 16px; } .hero-copy { font-size: 15px; line-height: 1.6; margin-bottom: 20px; } .platforms { margin: 14px 0 24px; } .hero-footnote { margin-top: 18px; } footer { padding: 14px 0; } }
  @media (max-width: 720px) { .landing { padding: 18px 18px 0; } .floating-nav { padding: 10px 12px 10px 18px; gap: 14px; min-height: 58px; } .wordmark { font-size: 20px; } nav { justify-content: end; } nav a { display: none; } nav a:nth-child(2) { display: block; font-size: 11px; } .nav-login { font-size: 11px; padding: 10px 12px; } .nav-login span { display: none; } .hero { padding-top: 65px; } .announcement { font-size: 7px; letter-spacing: .7px; } h1 { letter-spacing: -2.6px; font-size: clamp(44px, 9vw, 64px); margin-top: 30px; } .hero-copy { font-size: 14px; } .hero-actions { gap: 19px; flex-wrap: wrap; } .start-button { padding: 13px 16px; } .source-link { font-size: 12px; } .terminal-bottom { flex-direction: column; gap: 10px; } .terminal-preview :global(.setup-tabs) { gap: 16px; padding: 0 16px; } .terminal-preview :global(.setup-tab) { font-size: 9px; } .terminal-preview :global(.setup-content) { padding: 20px 16px; } .terminal-comment { font-size: 9px; } .hero-footnote { gap: 8px; font-size: 8px; } footer { gap: 16px; font-size: 7px; } .blade-one { left: -650px; } .blade-two { left: 50px; } }
  @media (prefers-reduced-motion: reduce) { .blade { animation: none; will-change: auto; } .start-button { transition: none; } }
</style>
