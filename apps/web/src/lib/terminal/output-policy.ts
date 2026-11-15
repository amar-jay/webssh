import type { IDisposable, ILinkHandler, Terminal } from "@xterm/xterm";

export const terminalLimits = Object.freeze({
  scrollback: 1000,
  imageMiB: 32,
  imagePixels: 4_194_304,
  urlChars: 2048,
});

export function safeTerminalLink(value: string): string | undefined {
  if (
    value.length > terminalLimits.urlChars ||
    /[\u0000-\u0020\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value)
  )
    return;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return;
    return url.href;
  } catch {
    return;
  }
}

/** Both OSC 8 and detected links require an intentional trusted modifier-click. */
export function terminalLinkHandler(actions: {
  confirm: (text: string) => boolean;
  open: (url: string, target: string, features: string) => unknown;
}): ILinkHandler {
  return {
    activate(event, uri) {
      if (
        !event.isTrusted ||
        event.button !== 0 ||
        !(event.ctrlKey || event.metaKey)
      )
        return;
      const safe = safeTerminalLink(uri);
      if (!safe || !actions.confirm(`Open this terminal link?\n${safe}`))
        return;
      actions.open(safe, "_blank", "noopener,noreferrer");
    },
  };
}

/** Remote bytes cannot request clipboard access, window operations, or title changes.
 * Explicit local keyboard copy/paste remains separate from escape parsing.
 */
export function installOutputPolicy(
  terminal: Pick<Terminal, "parser">,
): IDisposable {
  const handlers = [52, 0, 1, 2].map((id) =>
    terminal.parser.registerOscHandler(id, () => true),
  );
  handlers.push(terminal.parser.registerCsiHandler({ final: "t" }, () => true));
  return {
    dispose() {
      handlers.forEach((handler) => handler.dispose());
    },
  };
}
