import type { SessionTerminal } from "./create-terminal.js";

type Terminal = Pick<SessionTerminal["terminal"], "write" | "reset" | "focus">;
type Choice = { id: string; status: string; createdAt: number };
export type SessionPickerView = {
  choices: Choice[];
  workspace: string;
  selected: number;
  loading: boolean;
  ready: boolean;
  online: boolean;
  error: string;
};
const safeText = (value: string) =>
  value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
    .slice(0, 80);
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(value);

/** Picker state for the centered terminal overlay; never forwards selection keys. */
export function pickTerminalSession(
  terminal: Terminal,
  reference: string,
  options: {
    onSelect: (id: string) => void;
    onView: (view: SessionPickerView) => void;
    fetcher?: typeof fetch;
  },
) {
  const lifetime = new AbortController();
  let loading = false,
    selected = 0,
    ready = false,
    finished = false;
  let choices: Choice[] = [],
    workspace = "",
    online = false,
    error = "";
  const request = options.fetcher ?? fetch;
  const url = `/api/sessions/${encodeURIComponent(reference)}/choices`;
  function render() {
    if (lifetime.signal.aborted || finished) return;
    options.onView({
      choices,
      workspace: safeText(workspace),
      selected,
      loading,
      ready,
      online,
      error,
    });
  }

  function select(id: string) {
    if (finished || lifetime.signal.aborted) return;
    finished = true;
    dispose();
    terminal.reset();
    // Start the remote shell with an empty terminal buffer.
    terminal.write("\x1b[2J\x1b[3J\x1b[H");
    terminal.focus();
    options.onSelect(id);
  }
  async function load() {
    if (loading || finished || lifetime.signal.aborted) return;
    loading = true;
    error = "";
    render();
    try {
      const response = await request(url, {
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(8000)]),
      });
      const data = await response.json();
      if (lifetime.signal.aborted) return;
      if (!response.ok)
        throw Error(response.status === 401 ? "unauthorized" : "unavailable");
      if (data.backend === "ephemeral") {
        select(reference);
        return;
      }
      if (data.backend !== "tmux" || !Array.isArray(data.sessions))
        throw Error("unavailable");
      choices = data.sessions
        .filter((choice: Choice) => validId(choice.id))
        .slice(0, 128);
      workspace =
        typeof data.workspace === "string" ? data.workspace : "Workspace";
      online = data.online === true;
      selected = Math.max(
        0,
        choices.findIndex((choice) => choice.id === reference),
      );
      ready = true;
    } catch (cause) {
      if (!lifetime.signal.aborted)
        error =
          cause instanceof Error && cause.message === "unauthorized"
            ? "Sign in again, then reload this page."
            : "Cannot load sessions. Press r to retry.";
    } finally {
      loading = false;
      render();
    }
  }
  async function open() {
    if (loading || !ready || finished || lifetime.signal.aborted) return;
    if (selected < choices.length) {
      if (choices[selected].status === "active") {
        error = "Session in use. Detach the other controller first.";
        render();
        return;
      }
      select(choices[selected].id);
      return;
    }
    if (!online) {
      error = "Agent offline. Start webssh serve, then press r.";
      render();
      return;
    }
    loading = true;
    error = "";
    render();
    try {
      const response = await request(url, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(8000)]),
      });
      const data = await response.json();
      if (lifetime.signal.aborted) return;
      if (!response.ok || !validId(data.sessionId)) {
        error =
          response.status === 429
            ? "Session limit reached. Open an existing session."
            : "Could not create a session. Press r to refresh before trying again.";
        return;
      }
      select(data.sessionId);
    } catch {
      if (!lifetime.signal.aborted)
        error =
          "Creation could not be confirmed. Press r to refresh; a session may have been created.";
    } finally {
      loading = false;
      render();
    }
  }
  function input(key: string) {
    if (loading || finished) return;
    if (key === "r" || key === "R") {
      void load();
      return;
    }
    if (!ready) return;
    error = "";
    if (key === "\x1b[A")
      selected = (selected + choices.length) % (choices.length + 1);
    else if (key === "\x1b[B") selected = (selected + 1) % (choices.length + 1);
    else if (key === "n" || key === "N") {
      selected = choices.length;
      void open();
      return;
    } else if (key === "\r") {
      void open();
      return;
    }
    render();
  }
  function dispose() {
    lifetime.abort();
  }
  const done = load();
  function highlight(index: number) {
    if (
      !ready ||
      loading ||
      finished ||
      lifetime.signal.aborted ||
      !Number.isInteger(index) ||
      index < 0 ||
      index > choices.length
    )
      return;
    selected = index;
    error = "";
    render();
  }
  return {
    dispose,
    done,
    input,
    refresh: load,
    highlight,
    choose(index: number) {
      highlight(index);
      if (selected === index) void open();
    },
  };
}
