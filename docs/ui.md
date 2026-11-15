# Web UI

The web app uses the complete `bits-ui` package. All of its component families are available through named imports from `bits-ui`; there is no per-component installation or generation step. Import only what a screen needs so unused components stay out of the bundle.

Current integrations:

- Accordion: the `/help` article, with collapsible questions.
- Dialog: confirmation before revoking a machine or ending a session.
- Tooltip: command copy controls and icon-only table actions.

Shared components live in `apps/web/src/lib/components/`: `AppShell.svelte`, `SiteHeader.svelte`, `SiteTabs.svelte`, `CommandCard.svelte`, `DataTable.svelte`, and `ConfirmForm.svelte`. Tab destinations come from `apps/web/src/lib/navigation.ts`, so the landing page and the signed-in app render the same tabs (`Machines`, `Pair`, `Help`); a tab is marked `aria-current="page"` on its section and on nested pages such as `/machines/<machine_id>`. The brand link returns to the landing page. The global palette, spacing, responsive layout, focus styles, and reduced-motion rules live in `apps/web/src/lib/styles.css`. The terminal keeps its existing xterm theme and full-screen behavior.

The signed-in app lists machines, then a machine's workspaces and sessions, with native form actions for opening and ending sessions. Pairing entry and approval, plus CLI attach approval, share this design. The `/s/<session_id>` route stays terminal-only and resolves credentials through an authenticated no-store request; it does not include the app header.

## App icon

`apps/web/static/icon.svg` is the single source: a Tokyo Night Moon tile with a gradient diamond and a prompt chevron. The header brand renders that same file, so the app and the browser tab cannot drift apart.

`pnpm icons` reads the SVG and rewrites `favicon.ico` (16/32/48), `apple-touch-icon.png` (180), and the installable sizes `icon-192.png`/`icon-512.png`, plus `icon-maskable-512.png` with launcher-safe padding. Commit the outputs; the raster step uses the root `sharp` dev dependency and is not part of `build`. `app.html` links the icon set and `manifest.webmanifest`, and `_headers` caches them.

Run `pnpm --filter @webssh/web check`, `pnpm --filter @webssh/web test`, and `pnpm --filter @webssh/web build` to validate changes.

The web app manifest uses a stable `/` app ID, English metadata, standalone display, and the shared Tokyo Night Moon colors. It includes regular and maskable icons. No service worker caches authenticated pages or terminal credentials.
