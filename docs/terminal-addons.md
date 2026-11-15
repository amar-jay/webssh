# Terminal addons

`apps/web/src/lib/terminal/create-terminal.ts` owns browser-only xterm initialization and addon disposal. `SessionTerminal.svelte` mounts it at `/s/[session_id]`, fits it on container resize, and disposes it on navigation. The route remains terminal-only.

| Addon | Setup |
| --- | --- |
| Fit | Fits the viewport on mount and container resize. |
| Web links | Opens HTTP/HTTPS links in a separate tab with opener isolation. |
| WebGL | Accelerated rendering, falling back to the default renderer if unavailable or after context loss. |
| Image | Inline image protocols with a 32 MB image cache and a 4,194,304-pixel limit per image. |
| Clipboard | OSC 52 copy support subject to browser permissions; remote clipboard read requests return an empty string. Normal user-initiated paste remains handled by xterm. |
| Search | Select output and press F3 to find the next occurrence, or Shift+F3 for the previous occurrence. The controller also exposes `findNext`, `findPrevious`, and `clearSearch`. |
| Serialize | Controller methods `serialize` and `serializeAsHTML` export terminal contents. Nothing is automatically stored or sent. |
| Unicode 11 | Default character-width provider. The remote application's width rules must agree with the browser's. |
| Unicode graphemes | Installed and opt-in via `options.unicode = 'graphemes'`; replaces the active Unicode 11 provider. Experimental. |
| Ligatures | Installed and opt-in via `options.ligatures = true`. Needs a ligature-capable font; local font discovery can require browser permission, with fallback ligature rules when discovery is unavailable. |
| Progress | Parses terminal progress sequences. Exposes `getProgress()` and an optional `options.onProgress` callback, without adding visible UI. |

The component accepts `onReady(controller)` for integration with the application. Its `terminal` property exposes xterm's input, output, and resize APIs. Options are applied at mount time. Snapshot serialization preserves terminal contents, not a running remote process.

## Deliberately inactive addons

- Attach requires a WebSocket carrying terminal bytes. WebSSH plans to use Tailcat streams, so input/output will be wired through the transport directly.
- Program-status reports support to remote programs only when their status is visibly presented. This terminal has no status UI, so the addon is not loaded.
- The published web-fonts addon currently requires an xterm prerelease newer than our stable xterm 6.0.0 dependency. Self-hosted Geist Mono and Nerd Font symbols are loaded via CSS instead; `create-terminal.ts` waits for those faces before opening.

Remote transport is not implemented yet. The route attaches `mock-session.ts`, a browser-only adapter with sample output and canned commands. Type `help` for commands or `demo` for rendering samples. It supports command history, basic line editing, Ctrl+C, and Ctrl+L. It never executes host commands. Replace the route’s mock `onReady` handler with the Tailcat adapter when transport is ready.

## Theme

The terminal uses the supplied Tokyo Night Moon palette in `theme.ts`, including all 16 ANSI colors, foreground, background, selection, and block cursor colors. The full-screen container shares the theme background. xterm has no separate theme properties for bold text color, link color, badges, or a cursor guide; those supplied values are retained as accent tokens but are not applied by the renderer.

## Clipboard shortcuts

While a session page is open, the terminal captures common DevTools shortcuts so they do not open inspector UI:

| Shortcut | Action |
| --- | --- |
| Ctrl/Cmd+Shift+C | Copy the current selection |
| Ctrl/Cmd+Shift+V | Paste from the clipboard into the terminal |
| Ctrl/Cmd+Shift+I/J/K, Cmd+Option+I/J/C | Blocked (best-effort); F12 still opens DevTools |

Browsers reserve some of these chords; `preventDefault` cannot always stop DevTools. Ctrl/Cmd+C remains the interrupt character for the remote shell.

## Terminal fonts

The web terminal self-hosts Geist Mono Variable, including bold and italic, through `@fontsource-variable/geist-mono`. Interface text uses Inter, and headings use Geist. Symbols Nerd Font Mono v3.4.0 stays in the terminal font stack after Geist Mono so file, folder, prompt, and other private-use glyphs still draw. Its upstream license is retained beside the asset. Standard system monospace fonts remain the final fallback.

Fonts load explicitly before xterm opens and measures its cells, including a sample from the symbol font. Canvas rendering otherwise may measure a system fallback before the web fonts arrive. No external font service or locally installed font is required. Ligatures remain opt-in through the existing addon.

Sources: [Geist Mono](https://vercel.com/font), [Nerd Fonts symbols v3.4.0](https://github.com/ryanoasis/nerd-fonts/tree/v3.4.0/patched-fonts/NerdFontsSymbolsOnly).
