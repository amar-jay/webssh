import test from "node:test";
import assert from "node:assert/strict";
import { pickTerminalSession } from "../src/lib/terminal/session-picker.ts";
const a = "abcdefghijklmnop",
  b = "qrstuvwxyz123456";
function harness() {
  let key;
  const writes = [],
    selected = [];
  let resets = 0;
  const terminal = {
    rows: 24,
    write: (text) => writes.push(text),
    reset: () => resets++,
    focus() {},
    onData(fn) {
      key = fn;
      return {
        dispose() {
          key = undefined;
        },
      };
    },
    onResize() {
      return { dispose() {} };
    },
  };
  return {
    terminal,
    writes,
    selected,
    key: (text) => key?.(text),
    resets: () => resets,
  };
}
const list = (
  sessions = [
    { id: a, status: "connecting" },
    { id: b, status: "connecting" },
  ],
) =>
  Response.json({
    backend: "tmux",
    workspace: "project",
    online: true,
    sessions,
  });
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("picker waits for explicit selection, then drops its input listener before attaching", async () => {
  const h = harness();
  const picker = pickTerminalSession(h.terminal, a, {
    fetcher: async () => list(),
    onSelect: (id) => h.selected.push(id),
  });
  await picker.done;
  assert.deepEqual(h.selected, []);
  h.key("\x1b[B");
  h.key("\r");
  assert.deepEqual(h.selected, [b]);
  assert.equal(h.resets(), 1);
  h.key("\r");
  assert.deepEqual(h.selected, [b]);
  picker.dispose();
});
test("new session is POSTed only on request and a returned opaque ID is selected", async () => {
  const h = harness(),
    methods = [];
  const picker = pickTerminalSession(h.terminal, a, {
    fetcher: async (url, options) => {
      assert.equal(url, `/api/sessions/${a}/choices`);
      assert.equal(options.cache, "no-store");
      methods.push(options.method ?? "GET");
      return options.method === "POST"
        ? Response.json({ sessionId: b }, { status: 201 })
        : list();
    },
    onSelect: (id) => h.selected.push(id),
  });
  await picker.done;
  assert.deepEqual(methods, ["GET"]);
  h.key("n");
  await tick();
  assert.deepEqual(methods, ["GET", "POST"]);
  assert.deepEqual(h.selected, [b]);
  picker.dispose();
});
test("busy sessions do not take over and network errors do not auto-create or auto-attach", async () => {
  const h = harness();
  let calls = 0;
  const picker = pickTerminalSession(h.terminal, a, {
    fetcher: async () => {
      calls++;
      return list([{ id: a, status: "active" }]);
    },
    onSelect: (id) => h.selected.push(id),
  });
  await picker.done;
  h.key("\r");
  assert.deepEqual(h.selected, []);
  assert.equal(calls, 1);
  assert.match(h.writes.at(-1), /Detach the other controller/);
  picker.dispose();
  const other = harness();
  const failed = pickTerminalSession(other.terminal, a, {
    fetcher: async () => {
      throw Error("secret-token");
    },
    onSelect: (id) => other.selected.push(id),
  });
  await failed.done;
  other.key("\r");
  assert.deepEqual(other.selected, []);
  assert.doesNotMatch(other.writes.join(""), /secret-token/);
  failed.dispose();
});
test("navigation aborts pending picker fetches without selecting", async () => {
  const h = harness();
  let aborted = false;
  const picker = pickTerminalSession(h.terminal, a, {
    fetcher: async (_url, { signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(Error("aborted"));
        }),
      ),
    onSelect: (id) => h.selected.push(id),
  });
  picker.dispose();
  await picker.done;
  assert(aborted);
  assert.deepEqual(h.selected, []);
});
test("ephemeral sessions retain direct attachment", async () => {
  const h = harness();
  const picker = pickTerminalSession(h.terminal, a, {
    fetcher: async () => Response.json({ backend: "ephemeral" }),
    onSelect: (id) => h.selected.push(id),
  });
  await picker.done;
  assert.deepEqual(h.selected, [a]);
  picker.dispose();
});

test("uncertain new-session responses never trigger automatic retries", async () => {
  const h = harness();
  let posts = 0;
  const picker = pickTerminalSession(h.terminal, a, {
    fetcher: async (_url, options) => {
      if (options.method === "POST") {
        posts++;
        throw Error("private-network-details");
      }
      return list();
    },
    onSelect: (id) => h.selected.push(id),
  });
  await picker.done;
  h.key("n");
  await tick();
  assert.equal(posts, 1);
  assert.deepEqual(h.selected, []);
  assert.match(h.writes.at(-1), /may have been created/);
  assert.doesNotMatch(h.writes.join(""), /private-network-details/);
  picker.dispose();
});
