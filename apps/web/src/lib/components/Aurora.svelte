<div
  class="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
  aria-hidden="true"
>
  <div
    class="aurora-blade absolute top-[105px] left-[calc(50%-970px)] h-[240px] w-[1050px] rounded-[100%] mix-blend-screen blur-[44px] max-md:left-[-650px]"
  ></div>
  <div
    class="aurora-blade blade-two absolute top-20 left-[calc(50%+60px)] h-[190px] w-[1050px] rounded-[100%] mix-blend-screen blur-[44px] max-md:left-[50px]"
  ></div>
  <div
    class="aurora-blade blade-three absolute top-[380px] left-[calc(50%-400px)] h-[110px] w-[850px] rounded-[100%] mix-blend-screen blur-[65px]"
  ></div>
  <svg
    class="absolute inset-0 h-full w-full opacity-[.13] mix-blend-screen"
    width="100%"
    height="100%"
  >
    <filter id="aurora-grain">
      <feTurbulence
        type="fractalNoise"
        baseFrequency=".76"
        numOctaves="3"
        stitchTiles="stitch"
      />
    </filter>
    <rect
      width="100%"
      height="100%"
      filter="url(#aurora-grain)"
      opacity=".25"
    />
  </svg>
  <div
    class="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_36%,transparent_5%,#22243655_50%,#222436_90%)]"
  ></div>
</div>

<style>
  .aurora-blade {
    background: radial-gradient(
      ellipse at 70% 50%,
      #82aaff99 0%,
      #c099ff85 22%,
      #4fd6bea8 43%,
      #4fd6be00 72%
    );
    transform: rotate(-34deg);
    will-change: transform, opacity;
    animation: drift 18s ease-in-out infinite;
  }
  .blade-two {
    animation-duration: 22s;
    animation-direction: reverse;
  }
  .blade-three {
    animation-duration: 15s;
  }
  @keyframes drift {
    0%,
    100% {
      transform: translate(0, 0) rotate(-34deg) scale(1.12);
      opacity: 1;
    }
    50% {
      transform: translate(65px, -28px) rotate(-29deg) scale(0.9);
      opacity: 0.55;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .aurora-blade {
      animation: none;
      will-change: auto;
    }
  }
</style>
