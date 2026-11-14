import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeGrant, hmacSign, sha256, timingSafeEqual } from '../src/crypto.ts';

test('hmac grant encoding matches the documented v1 layout', async () => {
  const grant = await encodeGrant('agent1', 'grant-key-material', 'sess1', 'nonce1', 1700000060);
  assert.equal(grant, 'v1.sess1.1700000060.nonce1.iRvx-XlhTlFOyZVl0Wb8g_u5H3hRNojF-P4nYgAipug');
  const parts = grant.split('.');
  assert.equal(parts.length, 5);
  assert.equal(parts[0], 'v1');
  assert.equal(parts[1], 'sess1');
  assert.equal(parts[2], '1700000060');
  assert.equal(parts[3], 'nonce1');
  const mac = await hmacSign('grant-key-material', 'v1\nagent1\nsess1\n1700000060\nnonce1');
  assert.equal(parts[4], mac);
});

test('sha256 and timing-safe compare', async () => {
  const a = await sha256('code');
  const b = await sha256('code');
  const c = await sha256('other');
  assert.equal(timingSafeEqual(a, b), true);
  assert.equal(timingSafeEqual(a, c), false);
  assert.equal(timingSafeEqual(a, a.slice(0, 8)), false);
});
