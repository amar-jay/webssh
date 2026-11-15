import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Decoder, encode } from '../src/index.ts';
const fixtures = JSON.parse(readFileSync(new URL('../fixtures/v2.json', import.meta.url)));

test('shared Go/TypeScript fixtures decode byte by byte and re-encode', () => {
  for (const fixture of fixtures) {
    const wire = Buffer.from(fixture.hex, 'hex');
    const decoder = new Decoder();
    const frames = [];
    for (const byte of wire) frames.push(...decoder.push(new Uint8Array([byte])));
    decoder.finish();
    assert.equal(frames.length, 1);
    assert.equal(Buffer.from(encode(frames[0])).toString('hex'), fixture.hex, fixture.name);
  }
});
test('coalesced frames, arbitrary bytes and truncated streams', () => {
  const wire = Buffer.concat(fixtures.map(f => Buffer.from(f.hex, 'hex')));
  const decoder = new Decoder();
  assert.equal(decoder.push(wire).length, fixtures.length); decoder.finish();
  assert.deepEqual(new Decoder().push(encode({ type:'input', data:new Uint8Array([0,255,27]) }))[0].data, new Uint8Array([0,255,27]));
  const partial = new Decoder(); partial.push(wire.subarray(0,5));
  assert.throws(() => partial.finish(), /Truncated/);
});
test('invalid lengths poison the decoder and dimensions are bounded', () => {
  const decoder = new Decoder();
  assert.throws(() => decoder.push(new Uint8Array(4)), /length/);
  assert.throws(() => decoder.push(new Uint8Array()), /failed/);
  assert.throws(() => encode({type:'resize', cols:0, rows:24}), /resize/);
  assert.throws(() => encode({type:'input', data:new Uint8Array(65537)}), /bytes/);
});

test('v1 reserved fields cannot be interpreted as a v2 payload',()=>{
 const legacy=JSON.parse(readFileSync(new URL('../fixtures/v1.json',import.meta.url)));
 for(const fixture of legacy)assert.throws(()=>new Decoder().push(Buffer.from(fixture.hex,'hex')),/Unsupported/);
});
