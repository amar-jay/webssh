/** Literal Tailwind class groups. Variants do not repeat utilities that would override each other. */
const button =
  "inline-flex cursor-pointer items-center justify-center gap-3 rounded-lg text-sm leading-snug transition-colors disabled:cursor-not-allowed disabled:opacity-50";
export const buttonPrimary = `${button} border border-transparent bg-accent px-[18px] py-3 font-semibold text-canvas hover:bg-[#9ab8ff]`;
export const buttonSubtle = `${button} border border-line bg-transparent px-[18px] py-3 font-semibold text-ink hover:bg-raised`;
export const buttonQuiet = `${button} border border-transparent bg-transparent p-2.5 font-normal text-secondary hover:text-ink`;
export const buttonBright =
  "inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-canvas hover:bg-[#9ab8ff]";
export const textAction =
  "inline-flex cursor-pointer items-center rounded-lg px-2.5 py-2 text-sm text-accent hover:text-[#9ab8ff]";

export const eyebrow =
  "font-mono text-xs leading-relaxed tracking-[1.5px] text-secondary";
export const pill =
  "inline-block whitespace-nowrap rounded-full border border-line px-2 py-1 align-middle font-mono text-xs leading-normal text-secondary";
export const machineIcon =
  "grid size-12 shrink-0 place-items-center rounded-xl border border-line bg-accent/10 font-mono text-2xl text-accent";
export const surfaceCard =
  "rounded-xl border border-accent/30 bg-[#1e2030]/95 shadow-[0_25px_70px_#0007,inset_0_1px_0_#ffffff06]";
export const dialogOverlay = "fixed inset-0 z-50 bg-canvas/80 backdrop-blur-sm";
export const dialogPanel =
  "fixed top-1/2 left-1/2 z-[51] -translate-1/2 rounded-2xl border border-line bg-surface shadow-2xl";

export const iconAction =
  "inline-flex size-8 shrink-0 sm:size-9 items-center justify-center rounded-lg border-0 bg-transparent text-secondary transition-colors hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50";
