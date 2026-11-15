import { gunzipSync } from 'node:zlib';
// Run explicitly after wasm:build. The WASM main stays alive by design, so this
// smoke test exits its Node process after testing the real JS/Go boundary.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInThisContext } from 'node:vm';

const base = new URL('../../../apps/web/static/tailcat/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('build.json',base)));
const assets = new URL(manifest.assetDir+'/',base);
runInThisContext(await readFile(new URL('wasm_exec.js', assets), 'utf8'));
const go = new globalThis.Go();
const { instance } = await WebAssembly.instantiate(gunzipSync(await readFile(new URL('webssh.wasm.gz', assets))), go.importObject);
const timer = setTimeout(() => { console.error('WASM readiness timed out'); process.exit(1); }, 15_000);
const ready = new Promise(resolve => { globalThis.onWebSSHTailcatReady = resolve; });
void go.run(instance).catch(error => { console.error(error); process.exit(1); });
await ready;
try {
  const bridge = globalThis.websshTailcat;
  assert.equal(bridge.version, 1);
  const identity = await bridge.request('generateIdentity', 1, {});
  assert.match(identity.publicKey, /^nodekey:[a-f0-9]{64}$/);
  assert.match(identity.nodePrivateKey, /^privkey:[a-f0-9]{64}$/);
  await assert.rejects(bridge.request('createClient', 2, { address: 'invalid' }), /invalid Tailcat address/);
  await assert.rejects(bridge.request('read', 3, { stream: 999 }), /closed/);
  await assert.rejects(bridge.request('unknown', 4, {}), /unknown bridge operation/);
  await bridge.request('closeClient', 5, { client: 999 });
  await assert.rejects(bridge.request('dial', 6, null), /invalid bridge request/);
  await assert.rejects(bridge.request('dial', -1, {}), /positive integer/);
  bridge.cancel(999);
  console.log('Real Go/WASM bridge smoke test passed (identity, validation, errors, cleanup).');
  clearTimeout(timer);
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
