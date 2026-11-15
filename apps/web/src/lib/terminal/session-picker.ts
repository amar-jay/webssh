import type { SessionTerminal } from "./create-terminal.js";

type Terminal = Pick<
  SessionTerminal["terminal"],
  "write" | "onData" | "onResize" | "reset" | "focus" | "rows"
>;
type Choice = { id: string; status: string; createdAt: number };
const safeText = (value: string) =>
  value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
    .slice(0, 80);
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(value);

/** Local terminal UI; its keystrokes are disposed before remote input is enabled. */
export function pickTerminalSession(
  terminal: Terminal,
  reference: string,
  options: { onSelect: (id: string) => void; fetcher?: typeof fetch },
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
    const lines = [
      "\x1b[38;2;130;170;255mwebssh\x1b[0m  /  Choose a session",
      "",
      safeText(workspace),
      "",
    ];
    const visible = Math.max(1, terminal.rows - 11);
    const start = Math.max(
      0,
      Math.min(selected - Math.floor(visible / 2), choices.length - visible),
    );
    if (start) lines.push(`  … ${start} earlier`);
    for (let i = start; i < Math.min(choices.length, start + visible); i++) {
      const choice = choices[i];
      const label = `${choice.id.slice(0, 8)}  ${choice.status === "active" ? "in use" : choice.status === "offline" ? "offline" : "available"}`;
      lines.push(
        `${selected === i ? "\x1b[38;2;130;170;255m> " : "  "}${label}\x1b[0m`,
      );
    }
    if (start + visible < choices.length)
      lines.push(`  … ${choices.length - start - visible} more`);
    lines.push(
      `${selected === choices.length ? "\x1b[38;2;130;170;255m> " : "  "}New session${online ? "" : " (agent offline)"}\x1b[0m`,
      "",
    );
    if (loading) lines.push("Loading…");
    else if (error) lines.push(error);
    else lines.push("↑/↓ select · Enter open · n new · r refresh");
    terminal.write("\x1b[2J\x1b[H" + lines.join("\r\n"));
  }
  function select(id: string) {
    if (finished || lifetime.signal.aborted) return;
    finished = true;
    dispose();
    terminal.reset();
    // Clear after any already-queued picker writes, before remote output starts.
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
  const keys = terminal.onData((key) => {
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
  });
  const resize = terminal.onResize(render);
  function dispose() {
    lifetime.abort();
    keys.dispose();
    resize.dispose();
  }
  const done = load();
  return { dispose, done };
}
