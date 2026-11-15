<script lang="ts">
  import CommandBlock from './CommandBlock.svelte';
  import Icon from './Icon.svelte';
  import { installCommand } from '#lib/install.js';
  let { error }: { error?: string | null } = $props();
</script>

<div class="landing relative isolate min-h-svh overflow-hidden bg-canvas px-5 pt-5 font-sans text-ink md:px-10 md:pt-8">
  <div class="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
    <div class="aurora-blade absolute h-[240px] w-[1050px] rounded-[100%] mix-blend-screen blur-[44px] top-[105px] left-[calc(50%-970px)] max-md:left-[-650px]"></div>
    <div class="aurora-blade blade-two absolute top-20 left-[calc(50%+60px)] h-[190px] w-[1050px] rounded-[100%] mix-blend-screen blur-[44px] max-md:left-[50px]"></div>
    <div class="aurora-blade blade-three absolute top-[380px] left-[calc(50%-400px)] h-[110px] w-[850px] rounded-[100%] mix-blend-screen blur-[65px]"></div>
    <svg class="absolute inset-0 h-full w-full opacity-[.13] mix-blend-screen" width="100%" height="100%"><filter id="landing-grain"><feTurbulence type="fractalNoise" baseFrequency=".76" numOctaves="3" stitchTiles="stitch" /></filter><rect width="100%" height="100%" filter="url(#landing-grain)" opacity=".25" /></svg>
    <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_36%,transparent_5%,#22243655_50%,#222436_90%)]"></div>
  </div>

  <header class="mx-auto flex min-h-16 max-w-[960px] items-center gap-4 rounded-full border border-white/15 bg-[#1e2030]/75 py-2.5 pr-3 pl-5 shadow-[inset_0_1px_0_#ffffff0d,0_8px_40px_#0003] backdrop-blur-xl md:gap-8 md:pl-6">
    <a class="flex items-center font-display text-[22px] font-semibold tracking-tight" href="/" aria-label="WebSSH home"><span class="mr-2.5 h-5 w-4 bg-linear-to-br from-[#82aaff] via-[#c099ff] to-[#86e1fc] [clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]" aria-hidden="true"></span>webssh<span class="text-coral">.</span></a>
    <nav class="flex flex-1 justify-end gap-7 text-sm font-medium text-secondary md:justify-center" aria-label="Main navigation">
      <a class="hover:text-ink" href="/login">Serve</a>
      <a class="inline-flex items-center gap-1 hover:text-ink" href="https://github.com/amar-jay/webssh">GitHub <Icon name="arrow-up-right" class="size-3.5" /></a>
    </nav>
    <a class="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-canvas hover:bg-[#9ab8ff]" href="/login">Sign in <Icon name="log-in" class="size-3.5" /></a>
  </header>

  <main class="mx-auto flex max-w-[820px] flex-col items-center pt-16 pb-16 text-center md:pt-24">
    <h1 class="mb-4 font-display text-[clamp(44px,5.2vw,76px)] leading-[1.03] font-medium tracking-[-.055em]">Your terminal.<br /><span class="bg-linear-to-r from-[#c8d3f5] via-[#86e1fc] to-[#82aaff] bg-clip-text text-transparent">Anywhere you are.</span></h1>
    <p class="mb-8 text-base leading-relaxed text-secondary">The shell you know, on the machine you trust.</p>
    <div class="w-fit max-w-full rounded-xl border border-accent/30 bg-[#1e2030]/95 px-4 py-2.5 text-left shadow-[0_25px_70px_#0007,inset_0_1px_0_#ffffff06] md:px-5">
      <CommandBlock bare command={installCommand} />
    </div>
    {#if error}<p class="mx-auto mt-4 mb-0 max-w-[500px] text-sm text-danger" role="alert">{error === 'auth_not_configured' ? 'Sign-in is unavailable right now.' : 'Sign-in didn’t complete. Try again.'}</p>{/if}
  </main>
</div>

<style>
  /* The atmospheric artwork is the only custom CSS; the UI uses Tailwind. */
  .aurora-blade {
    background: radial-gradient(ellipse at 70% 50%, #82aaff99 0%, #c099ff85 22%, #4fd6bea8 43%, #4fd6be00 72%);
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
