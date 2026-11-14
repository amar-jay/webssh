import assert from 'node:assert/strict';
import test from 'node:test';
import { createTransport, loadTransport } from '../src/index.ts';

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function setup(handler = () => null) {
  const calls = [], cancelled = [];
  const transport = createTransport({ version: 1, cancel: id => cancelled.push(id),
    async request(method, id, args) {
      calls.push({ method, id, args });
      if (method === 'createClient') return { id: 1, publicKey: 'nodekey:test' };
      if (method === 'dial') return 2;
      return handler(method, args);
    }
  });
  return { transport, calls, cancelled };
}

test('cancellation closes a dial that completes late', async () => {
  const pending = deferred(), calls = [], cancelled = [];
  const transport = createTransport({ version: 1, cancel: id => cancelled.push(id),
    async request(method, id, args) {
      calls.push({ method, args });
      if (method === 'createClient') return { id: 1, publicKey: 'nodekey:test' };
      if (method === 'dial') return pending.promise;
    }
  });
  const client = await transport.createClient({ address: 'test' });
  const controller = new AbortController();
  const dial = client.dial(8022, { signal: controller.signal });
  controller.abort(); pending.resolve(42);
  await assert.rejects(dial, { name: 'AbortError' });
  assert.equal(cancelled.length, 1);
  assert(calls.some(x => x.method === 'closeStream' && x.args.stream === 42));
});

test('writes copy bytes, split bounded chunks, preserve order and half-close last', async () => {
  const gate = deferred(); let writes = 0;
  const { transport, calls } = setup(async method => { if (method === 'write' && ++writes === 1) await gate.promise; });
  const client = await transport.createClient({ address: 'test' });
  const stream = await client.dial(8022);
  const bytes = new Uint8Array(65537).fill(7);
  const first = stream.write(bytes); bytes.fill(9);
  const second = stream.write(new Uint8Array([8]));
  const half = stream.closeWrite();
  await assert.rejects(stream.write(new Uint8Array([0])), /not writable/);
  gate.resolve(); await Promise.all([first, second, half]);
  const output = calls.filter(x => x.method === 'write');
  assert.deepEqual(output.map(x => x.args.bytes.length), [65536, 1, 1]);
  assert.deepEqual(output.map(x => x.args.bytes[0]), [7, 7, 8]);
  assert.equal(calls.at(-1).method, 'closeWrite');
});

test('read ownership and bounded write queues prevent unbounded producers', async () => {
  const gate = deferred();
  const { transport } = setup(method => ['read', 'write'].includes(method) ? gate.promise : null);
  const client = await transport.createClient({ address: 'test' });
  const stream = await client.dial(8022);
  const read = stream.read();
  await assert.rejects(stream.read(), /Concurrent reads/);
  const write = stream.write(new Uint8Array(1024 * 1024));
  await assert.rejects(stream.write(new Uint8Array([1])), /queue is full/);
  gate.resolve(null); await Promise.all([read, write]); await client.close();
});

test('client close is idempotent and closes owned streams', async () => {
  const { transport, calls } = setup();
  const client = await transport.createClient({ address: 'test' });
  const stream = await client.dial(8022);
  await Promise.all([client.close(), client.close()]);
  assert.equal(calls.filter(x => x.method === 'closeClient').length, 1);
  assert.equal(calls.filter(x => x.method === 'closeStream').length, 1);
  await assert.rejects(stream.read(), /closed/);
  await assert.rejects(client.dial(8022));
});

test('rejects incompatible bridges, invalid ports and server-side loading', async () => {
  assert.throws(() => createTransport({ version: 2 }), /Unsupported/);
  const { transport, calls } = setup();
  const client = await transport.createClient({ address: 'test' });
  for (const port of [0, 65536, 1.5, NaN]) await assert.rejects(client.dial(port), /Invalid TCP port/);
  assert.equal(calls.filter(x => x.method === 'dial').length, 0);
  await assert.rejects(loadTransport(), /requires a browser/);
});
