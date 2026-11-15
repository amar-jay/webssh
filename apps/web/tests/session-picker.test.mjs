import test from "node:test";
import assert from "node:assert/strict";
import { pickTerminalSession as createPicker } from "../src/lib/terminal/session-picker.ts";
const a = "abcdefghijklmnop",
  b = "qrstuvwxyz123456";
function harness() {
  const writes = [],
    selected = [],
    views = [];
  let resets = 0;
  const terminal = {
    views,
    write: (text) => writes.push(text),
    reset: () => resets++,
    focus() {},
  };
  return { terminal, writes, selected, views, resets: () => resets };
}
function pickTerminalSession(terminal, reference, options) {
  return createPicker(terminal, reference, {
    ...options,
    onView(view) {
      terminal.views.push(view);
    },
  });
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

test("picker waits for explicit selection and ignores further picker input after attaching", async () => {
  const h = harness();
  const picker = pickTerminalSession(h.terminal, a, {
    fetcher: async () => list(),
    onSelect: (id) => h.selected.push(id),
  });
  await picker.done;
  assert.deepEqual(h.selected, []);
  assert.deepEqual(
    h.writes,
    [],
    "picker content must stay outside shell output",
  );
  picker.input("\x1b[B");
  picker.input("\r");
  assert.deepEqual(h.selected, [b]);
  assert.equal(h.resets(), 1);
  picker.input("\r");
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
  picker.input("n");
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
  picker.input("\r");
  assert.deepEqual(h.selected, []);
  assert.equal(calls, 1);
  assert.match(h.views.at(-1).error, /Detach the other controller/);
  picker.dispose();
  const other = harness();
  const failed = pickTerminalSession(other.terminal, a, {
    fetcher: async () => {
      throw Error("secret-token");
    },
    onSelect: (id) => other.selected.push(id),
  });
  await failed.done;
  failed.input("\r");
  assert.deepEqual(other.selected, []);
  assert.doesNotMatch(JSON.stringify(other.views), /secret-token/);
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
  picker.input("n");
  await tick();
  assert.equal(posts, 1);
  assert.deepEqual(h.selected, []);
  assert.match(h.views.at(-1).error, /may have been created/);
  assert.doesNotMatch(JSON.stringify(h.views), /private-network-details/);
  picker.dispose();
});

test("pointer selection shares the keyboard state and cannot select twice", async () => {
  const h = harness();
  const picker = pickTerminalSession(h.terminal, a, {
    fetcher: async () => list(),
    onSelect: (id) => h.selected.push(id),
  });
  await picker.done;
  picker.highlight(1);
  assert.equal(h.views.at(-1).selected, 1);
  picker.choose(1);
  picker.choose(0);
  assert.deepEqual(h.selected, [b]);
  picker.dispose();
});
