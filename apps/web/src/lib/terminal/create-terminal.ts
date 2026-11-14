import type { IDisposable, Terminal } from '@xterm/xterm';
import type { ISearchOptions } from '@xterm/addon-search';
import type { IProgressState } from '@xterm/addon-progress';
import { tokyoNightMoon } from './theme.js';

export interface TerminalOptions {
  screenReader?: boolean;
  unicode?: '11' | 'graphemes';
  // Local font discovery may require browser permission. Enable deliberately.
  ligatures?: boolean;
  onProgress?: (progress: IProgressState) => void;
}

export type SessionTerminal = Awaited<ReturnType<typeof createTerminal>>;

// Called only in the browser. The caller owns the returned controller.
export async function createTerminal(container: HTMLElement, options: TerminalOptions = {}) {
  const [
    { Terminal }, { FitAddon }, { ClipboardAddon }, { ImageAddon },
    { SearchAddon }, { SerializeAddon }, { Unicode11Addon },
    { WebLinksAddon }, { WebglAddon }, { ProgressAddon }
  ] = await Promise.all([
    import('@xterm/xterm'), import('@xterm/addon-fit'),
    import('@xterm/addon-clipboard'), import('@xterm/addon-image'),
    import('@xterm/addon-search'), import('@xterm/addon-serialize'),
    import('@xterm/addon-unicode11'), import('@xterm/addon-web-links'),
    import('@xterm/addon-webgl'), import('@xterm/addon-progress')
  ]);

  const terminal: Terminal = new Terminal({
    allowProposedApi: true, // Unicode providers and image/serialize addons use proposed APIs.
    cursorBlink: true,
    screenReaderMode: options.screenReader ?? false,
    fontFamily: '"JetBrains Mono", "Symbols Nerd Font Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 14,
    theme: tokyoNightMoon
  });
  const disposables: IDisposable[] = [];
  try {
    const fit = new FitAddon();
    const search = new SearchAddon();
    const serialize = new SerializeAddon();
    const progress = new ProgressAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.loadAddon(serialize);
    terminal.loadAddon(progress);
    if (options.onProgress) disposables.push(progress.onChange(options.onProgress));

    terminal.loadAddon(new WebLinksAddon((_event, uri) => {
      const url = new URL(uri);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        window.open(url.href, '_blank', 'noopener,noreferrer');
      }
    }));
    terminal.loadAddon(new ClipboardAddon(undefined, {
      // OSC 52 may copy output, but may never read the user's clipboard.
      readText: () => '',
      async writeText(_selection, text) {
        try {
          await navigator.clipboard?.writeText(text);
        } catch {
          // Clipboard permissions/secure-context requirements vary by browser.
        }
      }
    }));
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = '11';
    if (options.unicode === 'graphemes') {
      const { UnicodeGraphemesAddon } = await import('@xterm/addon-unicode-graphemes');
      terminal.loadAddon(new UnicodeGraphemesAddon());
    }

    // Canvas text does not trigger web-font downloads automatically. Load the
    // terminal faces explicitly before xterm measures its cell dimensions.
    await Promise.allSettled([
      document.fonts.load('14px "JetBrains Mono"'),
      document.fonts.load('700 14px "JetBrains Mono"'),
      document.fonts.load('italic 14px "JetBrains Mono"'),
      document.fonts.load('700 italic 14px "JetBrains Mono"'),
      document.fonts.load('14px "Symbols Nerd Font Mono"', '\uf07b\ue5ff\uf120')
    ]);
    await document.fonts.ready;
    terminal.open(container);
    if (options.ligatures) {
      const { LigaturesAddon } = await import('@xterm/addon-ligatures');
      terminal.loadAddon(new LigaturesAddon());
    }
    // WebGL is an optimization; keep the default renderer when unavailable.
    const webgl = new WebglAddon();
    disposables.push(webgl.onContextLoss(() => webgl.dispose()));
    try {
      terminal.loadAddon(webgl);
    } catch {
      webgl.dispose();
    }
    terminal.loadAddon(new ImageAddon({ storageLimit: 32, pixelLimit: 4_194_304 }));
    fit.fit();

    let lastSearch = '';
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.key !== 'F3') return true;
      event.preventDefault();
      if (event.type === 'keydown') {
        lastSearch = terminal.getSelection() || lastSearch;
        if (lastSearch) {
          if (event.shiftKey) search.findPrevious(lastSearch);
          else search.findNext(lastSearch);
        }
      }
      return false;
    });

    let disposed = false;
    return {
      terminal,
      fit: () => fit.fit(),
      findNext: (query: string, settings?: ISearchOptions) => search.findNext(query, settings),
      findPrevious: (query: string, settings?: ISearchOptions) => search.findPrevious(query, settings),
      clearSearch: () => search.clearDecorations(),
      serialize: () => serialize.serialize(),
      serializeAsHTML: () => serialize.serializeAsHTML(),
      getProgress: () => ({ ...progress.progress }),
      dispose() {
        if (disposed) return;
        disposed = true;
        disposables.forEach((disposable) => disposable.dispose());
        terminal.dispose(); // Disposes every loaded addon as well.
      }
    };
  } catch (error) {
    disposables.forEach((disposable) => disposable.dispose());
    terminal.dispose();
    throw error;
  }
}
