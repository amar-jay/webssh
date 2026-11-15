import assert from "node:assert/strict";
import test from "node:test";
import { Decoder, encode } from "@webssh/protocol";
import { attachRemoteSession } from "../src/lib/terminal/remote-session.ts";
const tick = () => new Promise((resolve) => setImmediate(resolve));
function setup({ holdOutput = false } = {}) {
  const handlers = {},
    sent = [],
    output = [],
    chunks = [];
  let waiter,
    reads = 0,
    closed = false,
    consumed;
  const stream = {
    async read() {
      reads++;
      if (chunks.length) return chunks.shift();
      return new Promise((resolve) => {
        waiter = resolve;
      });
    },
    async write(bytes) {
      sent.push(...new Decoder().push(bytes));
    },
    async close() {
      closed = true;
      waiter?.(null);
    },
  };
  const client = {
    async dial() {
      return stream;
    },
    async close() {
      await stream.close();
    },
  };
  const terminal = {
    cols: 80,
    rows: 24,
    onResize: subscribe("resize"),
    onData: subscribe("data"),
    onBinary: subscribe("binary"),
    write(bytes, callback) {
      output.push(bytes);
      if (holdOutput) consumed = callback;
      else callback?.();
    },
  };
  function subscribe(name) {
    return (callback) => {
      handlers[name] = callback;
      return {
        dispose() {
          delete handlers[name];
        },
      };
    };
  }
  function push(...messages) {
    const chunk = new Uint8Array(Buffer.concat(messages.map((m) => encode(m))));
    if (waiter) {
      const resolve = waiter;
      waiter = undefined;
      resolve(chunk);
    } else chunks.push(chunk);
  }
  return {
    terminal,
    transport: {
      async createClient() {
        return client;
      },
    },
    sent,
    output,
    handlers,
    push,
    end: () => {
      if (waiter) {
        const resolve = waiter;
        waiter = undefined;
        resolve(null);
      } else chunks.push(null);
    },
    reads: () => reads,
    closed: () => closed,
    consume: () => consumed?.(),
  };
}
const credentials = { address: "private-address", token: "a".repeat(43) };

test("handshakes before input, forwards Unicode/binary bytes, coalesces resize, reports exit", async () => {
  const h = setup(),
    states = [];
  const session = attachRemoteSession({ terminal: h.terminal }, credentials, {
    transport: h.transport,
    onState: (s) => states.push(s),
  });
  await tick();
  assert.equal(h.sent[0].type, "create");
  assert.equal(h.handlers.data, undefined);
  h.push({ type: "ready", version: 2 });
  await tick();
  h.handlers.data("İ\r");
  h.handlers.binary("\xff");
  h.handlers.resize({ cols: 90, rows: 30 });
  h.handlers.resize({
    cols: 100,
    rows: 40,
    colsChanged: true,
    rowsChanged: true,
  });
  await tick();
  assert.deepEqual(
    h.sent.filter((x) => x.type === "input").map((x) => Array.from(x.data)),
    [Array.from(new TextEncoder().encode("İ\r")), [255]],
  );
  assert.equal(h.sent.filter((x) => x.type === "resize").length, 1);
  h.push(
    { type: "output", data: new Uint8Array([0, 255, 27]) },
    { type: "exit", code: 7, codeKnown: true },
  );
  assert.deepEqual(await session.done, { state: "exited", code: 7 });
  assert.equal(h.closed(), true);
  assert.deepEqual(Object.keys(h.handlers), []);
  assert.equal(states.at(-1).code, 7);
});

test("output parsing applies backpressure and disposal releases a pending terminal write", async () => {
  const h = setup({ holdOutput: true });
  const session = attachRemoteSession({ terminal: h.terminal }, credentials, {
    transport: h.transport,
  });
  await tick();
  h.push({ type: "ready", version: 2 });
  await tick();
  h.push({ type: "output", data: new Uint8Array([1]) });
  await tick();
  const reads = h.reads();
  await tick();
  assert.equal(h.reads(), reads);
  session.dispose();
  assert.deepEqual(await session.done, { state: "disposed" });
  h.consume();
});

test("rejected handshake fails without enabling input or exposing credential text", async () => {
  const h = setup();
  const states = [];
  const session = attachRemoteSession({ terminal: h.terminal }, credentials, {
    transport: h.transport,
    onState: (s) => states.push(s),
  });
  await tick();
  h.push({ type: "error", error: "unauthorized" });
  assert.deepEqual(await session.done, {
    state: "failed",
    reason: "unauthorized",
    retryable: undefined,
  });
  assert.equal(h.handlers.data, undefined);
  assert.doesNotMatch(JSON.stringify(states), /private-address|aaaa/);
});

test("a late client is closed after disposal", async () => {
  let finish,
    closed = 0;
  const h = setup();
  const session = attachRemoteSession({ terminal: h.terminal }, credentials, {
    transport: {
      createClient: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
  });
  session.dispose();
  finish({
    close: async () => {
      closed++;
    },
    dial: async () => {
      throw new Error("must not dial");
    },
  });
  assert.deepEqual(await session.done, { state: "disposed" });
  assert(closed > 0);
});

test("missing handshake times out", async () => {
  const h = setup();
  const session = attachRemoteSession({ terminal: h.terminal }, credentials, {
    transport: h.transport,
    handshakeTimeoutMs: 10,
  });
  assert.deepEqual(await session.done, { state: "failed" });
  assert(h.closed());
});

test("large input is split in order and EOF is distinct from shell exit", async () => {
  const h = setup();
  const session = attachRemoteSession({ terminal: h.terminal }, credentials, {
    transport: h.transport,
  });
  await tick();
  h.push({ type: "ready", version: 2 });
  await tick();
  h.handlers.data("x".repeat(70000));
  await tick();
  const frames = h.sent.filter((message) => message.type === "input");
  assert.deepEqual(
    frames.map((message) => message.data.length),
    [65536, 4464],
  );
  assert(frames.every((message) => message.data.every((byte) => byte === 120)));
  h.end();
  assert.deepEqual(await session.done, { state: "disconnected" });
});

test("connection deadline includes client creation and closes late resources", async () => {
  let finish,
    closed = 0;
  const h = setup();
  const session = attachRemoteSession({ terminal: h.terminal }, credentials, {
    connectionTimeoutMs: 10,
    transport: {
      createClient: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
  });
  assert.deepEqual(await session.done, { state: "failed" });
  finish({
    close: async () => {
      closed++;
    },
    dial: async () => {
      throw Error("must not dial after timeout");
    },
  });
  await tick();
  assert(closed > 0);
});

test("a silent relay triggers bounded disconnect without replaying input", async () => {
  const h = setup();
  const session = attachRemoteSession({ terminal: h.terminal }, credentials, {
    transport: h.transport,
    heartbeatMs: 5,
    silenceTimeoutMs: 15,
  });
  await tick();
  h.push({ type: "ready", version: 2 });
  await tick();
  h.handlers.data("uncertain input");
  assert.deepEqual(await session.done, { state: "disconnected" });
  assert.equal(h.sent.filter((m) => m.type === "input").length, 1);
  assert(h.sent.some((m) => m.type === "ping"));
});

test("explicit detach and terminate use distinct typed operations", async () => {
  const h = setup();
  const session = attachRemoteSession({ terminal: h.terminal }, credentials, {
    transport: h.transport,
  });
  await tick();
  h.push({ type: "ready", version: 2 });
  await tick();
  session.detach();
  assert.equal((await session.done).state, "detached");
  assert(h.sent.some((m) => m.type === "detach"));
  assert(!h.sent.some((m) => m.type === "terminate"));
  const other = setup();
  const end = attachRemoteSession({ terminal: other.terminal }, credentials, {
    transport: other.transport,
  });
  await tick();
  other.push({ type: "ready", version: 2 });
  await tick();
  end.terminate();
  await tick();
  assert(other.sent.some((m) => m.type === "terminate"));
  other.push({ type: "terminated" });
  assert.equal((await end.done).state, "terminated");
});

test("a slow writer cannot grow the input queue without bound", async () => {
  const h = setup();
  let block = false,
    release;
  // Use the real harness to reach ready, then hold input writes while flooding it.
  const base = h.transport;
  const original = await base.createClient();
  const originalDial = original.dial;
  const wrapped = {
    createClient: async () => ({
      ...original,
      dial: async () => {
        const stream = await originalDial();
        const write = stream.write;
        return {
          ...stream,
          write: (bytes) =>
            block
              ? new Promise((resolve) => {
                  release = resolve;
                })
              : write(bytes),
        };
      },
    }),
  };
  const session = attachRemoteSession({ terminal: h.terminal }, credentials, {
    transport: wrapped,
  });
  await tick();
  h.push({ type: "ready", version: 2 });
  await tick();
  block = true;
  h.handlers.data("x".repeat(65536));
  await tick();
  assert(release, "writer should be blocked");
  for (let i = 0; i < 32 && h.handlers.data; i++)
    h.handlers.data("x".repeat(65536));
  assert.equal((await session.done).state, "failed");
  assert.equal(h.handlers.data, undefined);
  release?.();
  session.dispose();
});
