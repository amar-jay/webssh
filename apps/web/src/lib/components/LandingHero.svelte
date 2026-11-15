<script lang="ts">
  import { Tabs } from 'bits-ui';
  import CommandBlock from './CommandBlock.svelte';
  let { error }: { error?: string | null } = $props();
</script>

<div class="landing relative isolate min-h-svh overflow-hidden bg-canvas px-5 pt-5 font-sans text-ink md:px-10 md:pt-8">
  <div class="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
    <div class="aurora-blade absolute h-[240px] w-[1050px] rounded-[100%] mix-blend-screen blur-[44px] top-[105px] left-[calc(50%-970px)] max-md:left-[-650px]"></div>
    <div class="aurora-blade blade-two absolute top-20 left-[calc(50%+60px)] h-[190px] w-[1050px] rounded-[100%] mix-blend-screen blur-[44px] max-md:left-[50px]"></div>
    <div class="aurora-blade blade-three absolute top-[380px] left-[calc(50%-400px)] h-[110px] w-[850px] rounded-[100%] mix-blend-screen blur-[65px]"></div>
    <svg class="absolute inset-0 h-full w-full opacity-[.13] mix-blend-screen" width="100%" height="100%"><filter id="landing-grain"><feTurbulence type="fractalNoise" baseFrequency=".76" numOctaves="3" stitchTiles="stitch" /></filter><rect width="100%" height="100%" filter="url(#landing-grain)" opacity=".25" /></svg>
    <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_36%,transparent_5%,#07080a55_50%,#07080a_90%)]"></div>
  </div>

  <header class="mx-auto flex min-h-16 max-w-[960px] items-center gap-4 rounded-full border border-white/15 bg-[#101113]/75 py-2.5 pr-3 pl-5 shadow-[inset_0_1px_0_#ffffff0d,0_8px_40px_#0003] backdrop-blur-xl md:gap-8 md:pl-6">
    <a class="flex items-center font-display text-[22px] font-semibold tracking-tight" href="/" aria-label="WebSSH home"><span class="mr-2.5 h-5 w-4 bg-linear-to-br from-[#ffd09a] via-[#ff6b4a] to-[#ff2f3a] [clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]" aria-hidden="true"></span>webssh<span class="text-coral">.</span></a>
    <nav class="flex flex-1 justify-end gap-7 text-sm font-medium text-secondary md:justify-center" aria-label="Main navigation">
      <a class="hidden hover:text-ink md:block" href="#workspace">How it works</a>
      <a class="hidden hover:text-ink sm:block" href="/pair">Pair a machine</a>
      <a class="hidden hover:text-ink md:block" href="https://github.com/amar-jay/webssh">GitHub <span aria-hidden="true">↗</span></a>
    </nav>
    <a class="rounded-full border border-white/20 bg-white/5 px-4 py-2.5 text-sm hover:border-coral/60 hover:text-accent" href="/login">Sign in <span class="ml-2 text-secondary" aria-hidden="true">↗</span></a>
  </header>

  <main class="mx-auto max-w-[1000px] pt-12 pb-5 text-center md:pt-10 min-[1000px]:min-h-[calc(100svh-160px)]">
    <a class="inline-flex items-center gap-2 rounded-full border border-coral/30 bg-[#231412]/50 px-3 py-2 font-mono text-xs leading-normal tracking-wide text-secondary" href="https://github.com/amar-jay/webssh/releases"><span class="size-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_9px_#ff6b4a]"></span>YOUR WORKSPACE, WITHOUT THE DISTANCE <span class="ml-1" aria-hidden="true">↗</span></a>
    <h1 class="mt-6 mb-4 font-display text-[clamp(44px,5.2vw,76px)] leading-[1.03] font-medium tracking-[-.055em]">Your terminal.<br /><span class="bg-linear-to-r from-[#fff3e7] via-[#ffc2a2] to-[#ff956e] bg-clip-text text-transparent">Anywhere you are.</span></h1>
    <p class="mb-6 text-base leading-relaxed text-secondary">The shell you know. The machine you trust.<br />Bring your workspace to the browser. Keep your work running.</p>
    <div class="flex flex-wrap items-center justify-center gap-5 md:gap-7">
      <a class="inline-flex items-center gap-6 rounded-lg border border-white/60 bg-ink px-5 py-3.5 text-sm font-semibold text-canvas shadow-[0_0_30px_#ff6b4a22,inset_0_-2px_0_#0001] transition hover:-translate-y-0.5 hover:bg-[#ffd7bd] motion-reduce:transform-none" href="/login">Get started with GitHub <span aria-hidden="true">→</span></a>
      <a class="text-sm text-secondary hover:text-ink" href="https://github.com/amar-jay/webssh">Explore the source <span class="ml-2" aria-hidden="true">↗</span></a>
    </div>
    {#if error}<p class="mx-auto mt-4 mb-0 max-w-[500px] text-sm text-danger" role="alert">{error === 'auth_not_configured' ? 'Sign-in is unavailable right now. Please try again later.' : 'Sign-in didn’t complete. Please try signing in again.'}</p>{/if}
    <p class="mt-4 mb-7 font-mono text-xs leading-relaxed tracking-wide text-secondary">YOUR MACHINE. YOUR SHELL. LINUX & macOS.</p>

    <section id="workspace" class="mx-auto max-w-[720px] scroll-mt-6 rounded-xl border border-coral/30 bg-[#0d0e10]/95 text-left shadow-[0_25px_70px_#0007,inset_0_1px_0_#ffffff06]" aria-label="Connect your workspace">
      <div class="flex items-center justify-between gap-3 border-b border-coral/15 px-5 py-3 font-mono text-xs text-secondary">
        <div class="flex gap-1.5" aria-hidden="true"><i class="size-2 rounded-full bg-[#ff956e]"></i><i class="size-2 rounded-full bg-[#ffb347]"></i><i class="size-2 rounded-full bg-[#b9764d]"></i></div><span>your workspace / anywhere</span><span aria-hidden="true">⌘</span>
      </div>
      <Tabs.Root value="pair">
        <Tabs.List class="flex gap-5 border-b border-coral/15 px-4 md:gap-7 md:px-6" aria-label="Workspace setup">
          <Tabs.Trigger class="border-b border-transparent bg-transparent py-3.5 font-mono text-xs text-secondary data-[state=active]:border-coral data-[state=active]:text-ink" value="pair">01 <span class="ml-1">Pair your machine</span></Tabs.Trigger>
          <Tabs.Trigger class="border-b border-transparent bg-transparent py-3.5 font-mono text-xs text-secondary data-[state=active]:border-coral data-[state=active]:text-ink" value="serve">02 <span class="ml-1">Open your workspace</span></Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="pair" class="px-4 py-5 md:px-6">
          <p class="mb-3 font-mono text-xs leading-relaxed text-secondary"># With the CLI installed, connect your machine to your account</p>
          <CommandBlock bare command="webssh pair" />
          <div class="flex flex-col justify-between gap-3 text-xs leading-relaxed sm:flex-row"><span class="text-secondary">Approve the code with your GitHub account.</span><a class="text-coral hover:text-ink" href="/pair">Enter a pairing code <span aria-hidden="true">→</span></a></div>
        </Tabs.Content>
        <Tabs.Content value="serve" class="px-4 py-5 md:px-6">
          <p class="mb-3 font-mono text-xs leading-relaxed text-secondary"># Start in the folder you want to work in</p>
          <CommandBlock bare command="webssh serve ." />
          <div class="flex flex-col justify-between gap-3 text-xs leading-relaxed sm:flex-row"><span class="text-secondary">Keep the agent running. Open the URL it prints.</span><a class="text-coral hover:text-ink" href="/login">Sign in to your workspace <span aria-hidden="true">→</span></a></div>
        </Tabs.Content>
      </Tabs.Root>
    </section>
    <div class="mt-5 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs text-secondary md:gap-x-4"><span>Browser access</span><b class="text-coral" aria-hidden="true">·</b><span>Your own machine</span><b class="text-coral" aria-hidden="true">·</b><span>Persistent sessions with tmux</span></div>
  </main>
  <footer class="mx-auto flex max-w-[1200px] flex-wrap justify-between gap-4 py-5 font-mono text-xs leading-relaxed tracking-wide text-secondary"><span>BUILT FOR THE WAY YOU WORK.</span><a class="tracking-normal hover:text-ink" href="https://github.com/amar-jay/webssh/releases">Download the CLI <span aria-hidden="true">↗</span></a></footer>
</div>

<style>
  /* The atmospheric artwork is the only custom CSS; the UI uses Tailwind. */
  .aurora-blade {
    background: radial-gradient(ellipse at 70% 50%, #ffb34799 0%, #ff6b4a85 22%, #ff2f3aa8 43%, #ff2f3a00 72%);
    transform: rotate(-34deg);
    will-change: transform, opacity;
    animation: drift 18s ease-in-out infinite;
  }
  .blade-two { animation-duration: 22s; animation-direction: reverse; }
  .blade-three { animation-duration: 15s; }
  @keyframes drift {
    0%, 100% { transform: translate(0, 0) rotate(-34deg) scale(1.12); opacity: 1; }
    50% { transform: translate(65px, -28px) rotate(-29deg) scale(.9); opacity: .55; }
  }
  @media (prefers-reduced-motion: reduce) {
    .aurora-blade { animation: none; will-change: auto; }
  }
</style>
