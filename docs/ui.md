# Web UI

The web app uses the complete `bits-ui` package. All of its component families are available through named imports from `bits-ui`; there is no per-component installation or generation step. Import only what a screen needs so unused components stay out of the bundle.

Current integrations:

- Tabs: overview setup instructions.
- Dialog and Accordion: shared setup guide, including pairing and expired-code help.
- Tooltip: command copy controls, with clipboard success and failure feedback.

Shared components live in `apps/web/src/lib/components/`: `AppShell.svelte`, `SetupHelp.svelte`, and `CommandBlock.svelte`. The global palette, spacing, responsive layout, focus styles, and reduced-motion rules live in `apps/web/src/lib/styles.css`. The terminal keeps its existing xterm theme and full-screen local development behavior.

The overview, pairing entry, machine approval, success state, local connection form, and production terminal placeholder share this design. Production browser connections to paired agents remain a later milestone; the interface does not imply that a paired machine is already openable.

Run `pnpm --filter @webssh/web check`, `pnpm --filter @webssh/web test`, and `pnpm --filter @webssh/web build` to validate changes.
