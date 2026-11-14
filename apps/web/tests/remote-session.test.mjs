import assert from 'node:assert/strict';
import test from 'node:test';
import { Decoder, encode } from '@webssh/protocol';
import { attachRemoteSession } from '../src/lib/terminal/remote-session.ts';
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup({ holdOutput = false } = {}) {
  const handlers = {}, sent = [], output = [], chunks = [];
  let waiter, reads = 0, closed = false, consumed;
  const stream = {
    async read() { reads++; if(chunks.length) return chunks.shift(); return new Promise(resolve => { waiter = resolve; }); },
    async write(bytes) { sent.push(...new Decoder().push(bytes)); },
    async close() { closed = true; waiter?.(null); }
  };
  const client = { async dial() { return stream; }, async close() { await stream.close(); } };
  const terminal = { cols:80, rows:24,
    onResize: subscribe('resize'), onData: subscribe('data'), onBinary: subscribe('binary'),
    write(bytes, callback) { output.push(bytes); if(holdOutput) consumed = callback; else callback?.(); }
  };
  function subscribe(name) { return callback => { handlers[name] = callback; return { dispose() { delete handlers[name]; } }; }; }
  function push(...messages) {
    const chunk = new Uint8Array(Buffer.concat(messages.map(m=>encode(m))));
    if(waiter) { const resolve=waiter;waiter=undefined;resolve(chunk); } else chunks.push(chunk);
  }
  return {terminal, transport:{async createClient(){return client;}},sent,output,handlers,push,
    reads:()=>reads,closed:()=>closed,consume:()=>consumed?.()};
}
const credentials = { address:'private-address', token:'a'.repeat(43) };

test('handshakes before input, forwards Unicode/binary bytes, coalesces resize, reports exit', async () => {
  const h=setup(),states=[];
  const session=attachRemoteSession({terminal:h.terminal},credentials,{transport:h.transport,onState:s=>states.push(s)});
  await tick();assert.equal(h.sent[0].type,'attach');assert.equal(h.handlers.data,undefined);
  h.push({type:'ready',version:1});await tick();
  h.handlers.data('İ\r');h.handlers.binary('\xff');
  h.handlers.resize({cols:90,rows:30});h.handlers.resize({cols:100,rows:40});await tick();
  assert.deepEqual(h.sent.filter(x=>x.type==='input').map(x=>Array.from(x.data)),[Array.from(new TextEncoder().encode('İ\r')),[255]]);
  assert.equal(h.sent.filter(x=>x.type==='resize').length,1);
  h.push({type:'output',data:new Uint8Array([0,255,27])},{type:'exit',code:7});
  assert.deepEqual(await session.done,{state:'exited',code:7});assert.equal(h.closed(),true);
  assert.deepEqual(Object.keys(h.handlers),[]);assert.equal(states.at(-1).code,7);
});

test('output parsing applies backpressure and disposal releases a pending terminal write', async () => {
  const h=setup({holdOutput:true});const session=attachRemoteSession({terminal:h.terminal},credentials,{transport:h.transport});
  await tick();h.push({type:'ready',version:1});await tick();
  h.push({type:'output',data:new Uint8Array([1])});await tick();const reads=h.reads();await tick();assert.equal(h.reads(),reads);
  session.dispose();assert.deepEqual(await session.done,{state:'disposed'});h.consume();
});

test('rejected handshake fails without enabling input or exposing credential text', async () => {
  const h=setup();const states=[];const session=attachRemoteSession({terminal:h.terminal},credentials,{transport:h.transport,onState:s=>states.push(s)});
  await tick();h.push({type:'error',error:'unauthorized'});
  assert.deepEqual(await session.done,{state:'failed'});assert.equal(h.handlers.data,undefined);
  assert.doesNotMatch(JSON.stringify(states),/private-address|aaaa/);
});

test('a late client is closed after disposal', async () => {
  let finish,closed=0;
  const h=setup();const session=attachRemoteSession({terminal:h.terminal},credentials,{transport:{createClient:()=>new Promise(resolve=>{finish=resolve;})}});
  session.dispose();finish({close:async()=>{closed++;},dial:async()=>{throw new Error('must not dial');}});
  assert.deepEqual(await session.done,{state:'disposed'});assert(closed>0);
});

test('missing handshake times out', async () => {
  const h=setup();const session=attachRemoteSession({terminal:h.terminal},credentials,{transport:h.transport,handshakeTimeoutMs:10});
  assert.deepEqual(await session.done,{state:'failed'});assert(h.closed());
});
