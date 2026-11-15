/** Literal Tailwind class groups. Variants do not repeat utilities that would override each other. */
const button =
  "inline-flex cursor-pointer items-center justify-center gap-3 rounded-lg text-sm leading-snug transition-colors disabled:cursor-not-allowed disabled:opacity-50";
export const buttonPrimary = `${button} border border-transparent bg-accent px-[18px] py-3 font-semibold text-canvas hover:bg-[#ffd09a]`;
export const buttonSubtle = `${button} border border-line bg-transparent px-[18px] py-3 font-semibold text-ink hover:bg-raised`;
export const buttonQuiet = `${button} border border-transparent bg-transparent p-2.5 font-normal text-secondary hover:text-ink`;

export const eyebrow =
  "font-mono text-xs leading-relaxed tracking-[1.5px] text-secondary";
export const pill =
  "inline-block whitespace-nowrap rounded-full border border-line px-2 py-1 align-middle font-mono text-xs leading-normal text-secondary";
export const machineIcon =
  "grid size-12 shrink-0 place-items-center rounded-xl border border-line bg-accent/10 font-mono text-2xl text-accent";
