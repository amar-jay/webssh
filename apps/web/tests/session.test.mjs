import assert from 'node:assert/strict';
import test from 'node:test';
import { signSession, verifySession } from '../src/lib/auth/session.ts';

const secret = 'abcdefghijklmnopqrstuvwxyz012345';

test('session round-trip', async () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const token = await signSession({ sid: 's1', oid: '42', exp }, secret);
  const payload = await verifySession(token, secret);
  assert.deepEqual(payload, { sid: 's1', oid: '42', exp });
});

test('session rejects tampering and expiry', async () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const token = await signSession({ sid: 's1', oid: '42', exp }, secret);
  assert.equal(await verifySession(token.slice(0, -2) + 'aa', secret), null);
  assert.equal(await verifySession(token, 'other-secret-other-secret-other-1'), null);
  const expired = await signSession({ sid: 's1', oid: '42', exp: Math.floor(Date.now() / 1000) - 1 }, secret);
  assert.equal(await verifySession(expired, secret), null);
});

test('malformed cookie encoding fails closed without throwing', async () => {
 for (const value of ['abc.%','%.abc','.','abc.===']) assert.equal(await verifySession(value,secret),null);
});
