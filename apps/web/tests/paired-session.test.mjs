import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
// Bundle browser aliases without starting a browser or a WASM runtime.
const built = await build({
  entryPoints: ["src/lib/session/paired-session.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { attachPairedSession: attachPairedSessionImpl } = await import(
  "data:text/javascript;base64," +
    Buffer.from(built.outputFiles[0].text).toString("base64")
);
function attachPairedSession(controller, id, options = {}) {
  return attachPairedSessionImpl(controller, id, {
    ...options,
    onStatus(status) {
      controller.statuses.push(status);
      if (status)
        controller.output.push(
          [status.message, status.detail].filter(Boolean).join(" "),
        );
      options.onStatus?.(status);
    },
  });
}
function terminal() {
  const output = [],
    statuses = [],
    writes = [];
  let retry;
  return {
    output,
    statuses,
    writes,
    terminal: {
      write: (text) => writes.push(text),
      onData: (fn) => {
        retry = fn;
        return {
          dispose() {
            retry = undefined;
          },
        };
      },
    },
    retry: (text) => retry?.(text),
  };
}
test("opaque session resolves via no-store POST and passes grant to transport only", async () => {
  const t = terminal();
  let disposed = false;
  const secret = "v1.private_grant";
  const session = attachPairedSession(t, "opaque-session", {
    maxRetries: 0,
    fetcher: async (url, options) => {
      assert.equal(url, "/api/sessions/opaque-session/grant");
      assert.equal(options.method, "POST");
      assert.equal(options.cache, "no-store");
      assert.equal(options.credentials, "same-origin");
      return Response.json({
        address: "tcPrivateAddress",
        port: 2222,
        grant: secret,
      });
    },
    attach: (_controller, connection, options) => {
      assert.deepEqual(connection, {
        address: "tcPrivateAddress",
        port: 2222,
        token: secret,
        sessionId: "opaque-session",
        backend: undefined,
      });
      options.onState({ state: "connecting" });
      options.onState({ state: "ready" });
      options.onState({ state: "disconnected" });
      return {
        done: Promise.resolve({ state: "disconnected" }),
        dispose() {
          disposed = true;
        },
      };
    },
  });
  await session.done;
  assert(t.statuses.includes(null));
  assert.deepEqual(t.writes, []);
  assert.match(t.output.join(""), /Shell state is unknown/);
  assert.doesNotMatch(t.output.join(""), /private_grant|tcPrivateAddress/);
  session.dispose();
  assert(disposed);
});

test("offline, expired, ended and unauthorized sessions stop loading with useful messages", async () => {
  for (const [error, text] of [
    ["agent_offline", /offline.*shell state is unknown/s],
    ["session_expired", /expired/],
    ["session_ended", /has ended/],
    ["unauthorized", /Sign in/],
  ]) {
    const t = terminal();
    let attached = false;
    const session = attachPairedSession(t, "id", {
      maxRetries: 0,
      fetcher: async () => Response.json({ error }, { status: 409 }),
      attach: () => {
        attached = true;
        throw Error("must not attach");
      },
    });
    await session.done;
    assert.equal(attached, false);
    assert.match(t.output.join(""), text);
    session.dispose();
  }
});

test("diagnostics redact server/network errors and disposal aborts pending resolution", async () => {
  const t = terminal();
  let aborted = false;
  const session = attachPairedSession(t, "id", {
    maxRetries: 0,
    fetcher: async (_url, { signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => {
          aborted = true;
          reject(Error("secret-address-and-token"));
        }),
      ),
  });
  session.dispose();
  await session.done;
  assert(aborted);
  assert.doesNotMatch(t.output.join(""), /secret-address-and-token/);
  const other = terminal();
  const failed = attachPairedSession(other, "id", {
    maxRetries: 0,
    fetcher: async () => {
      throw Error("token=private");
    },
  });
  await failed.done;
  assert.match(other.output.join(""), /press r/);
  assert.doesNotMatch(other.output.join(""), /token=private/);
  failed.dispose();
});

test("reconnect obtains fresh grants and never replays input", async () => {
  const t = terminal();
  let resolved = 0,
    attached = 0;
  const seen = [];
  const session = attachPairedSession(t, "stable-id", {
    maxRetries: 2,
    retryDelays: [0, 0],
    fetcher: async () => {
      resolved++;
      return Response.json({
        address: "tcPersistentAddress",
        port: 2222,
        grant: "v1.fresh-" + resolved,
        backend: "tmux",
      });
    },
    attach: (_controller, connection, options) => {
      seen.push(connection.token);
      attached++;
      options.onState({ state: "ready" });
      return {
        done: Promise.resolve({
          state: attached === 1 ? "disconnected" : "exited",
          code: 0,
        }),
        dispose() {},
      };
    },
  });
  await session.done;
  assert.equal(resolved, 2);
  assert.deepEqual(seen, ["v1.fresh-1", "v1.fresh-2"]);
  assert.match(t.output.join(""), /No input will be replayed/);
  session.dispose();
});

test("logout stops reconnect and navigation cancels pending backoff", async () => {
  const t = terminal();
  let calls = 0;
  const session = attachPairedSession(t, "stable-id", {
    maxRetries: 3,
    retryDelays: [0],
    fetcher: async () => {
      calls++;
      return Response.json(
        { error: calls === 1 ? "agent_offline" : "unauthorized" },
        { status: calls === 1 ? 409 : 401 },
      );
    },
  });
  await session.done;
  assert.equal(calls, 2);
  t.retry("r");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  session.dispose();
  const other = terminal();
  let requests = 0;
  const nav = attachPairedSession(other, "stable-id", {
    maxRetries: 6,
    retryDelays: [10000],
    fetcher: async () => {
      requests++;
      return Response.json({ error: "agent_offline" }, { status: 409 });
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  nav.dispose();
  await nav.done;
  assert.equal(requests, 1);
});

test("a later outage gets a fresh bounded budget after a stable connection", async (context) => {
  let now = 1_000;
  context.mock.method(Date, "now", () => now);
  const h = terminal();
  let attempts = 0;
  const session = attachPairedSession(h, "stable-id", {
    maxRetries: 1,
    retryDelays: [0],
    fetcher: async () =>
      Response.json({
        address: "tcPersistentAddress",
        port: 2222,
        grant: "v1.current",
        backend: "tmux",
      }),
    attach: (_controller, _connection, options) => {
      attempts++;
      options.onState({ state: "ready" });
      now += 31_000;
      return {
        dispose() {},
        done: Promise.resolve({
          state: attempts < 3 ? "disconnected" : "exited",
        }),
      };
    },
  });
  await session.done;
  assert.equal(attempts, 3);
  session.dispose();
});

test("an occupied controller pauses immediately and retries only on request", async () => {
  const t = terminal();
  let calls = 0;
  const session = attachPairedSession(t, "stable-id", {
    retryDelays: [0],
    fetcher: async () => {
      calls++;
      return Response.json({ error: "session_busy" }, { status: 409 });
    },
  });
  await session.done;
  assert.equal(calls, 1);
  assert.equal(t.statuses.at(-1).phase, "blocked");
  assert.equal(t.statuses.at(-1).retryable, true);
  assert.deepEqual(t.writes, []);
  await session.retry();
  assert.equal(calls, 2);
  assert.equal(t.statuses.at(-1).phase, "blocked");
  session.dispose();
  await session.retry();
  assert.equal(calls, 2);
});

test("agent-side controller conflicts show the same paused status without retry spam", async () => {
  const t = terminal();
  let grants = 0,
    attachments = 0;
  const session = attachPairedSession(t, "stable-id", {
    retryDelays: [0],
    fetcher: async () => {
      grants++;
      return Response.json({
        address: "tcPersistentAddress",
        port: 2222,
        grant: "v1.current",
        backend: "tmux",
      });
    },
    attach: () => {
      attachments++;
      return {
        dispose() {},
        done: Promise.resolve({
          state: "failed",
          reason: "session_busy",
          retryable: true,
        }),
      };
    },
  });
  await session.done;
  assert.equal(grants, 1);
  assert.equal(attachments, 1);
  assert.equal(t.statuses.at(-1).message, "Session in use");
  assert.deepEqual(t.writes, []);
  await session.retry();
  assert.equal(grants, 2);
  assert.equal(attachments, 2);
  session.dispose();
});

test("transient outages update one status observer and stop at the retry limit", async () => {
  const t = terminal();
  let calls = 0;
  const session = attachPairedSession(t, "stable-id", {
    maxRetries: 2,
    retryDelays: [0],
    fetcher: async () => {
      calls++;
      return Response.json({ error: "agent_offline" }, { status: 409 });
    },
  });
  await session.done;
  assert.equal(calls, 3);
  assert.deepEqual(t.writes, []);
  assert.deepEqual(
    t.statuses
      .filter((status) => status?.phase === "retrying")
      .map((status) => status.attempt),
    [1, 2],
  );
  assert.equal(t.statuses.at(-1).message, "Reconnect paused");
  session.dispose();
});
