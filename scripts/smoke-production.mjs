import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
const release = JSON.parse(
  await readFile(new URL("../release.json", import.meta.url)),
);
const origin = process.argv[2] || "https://ssh.amarjay.com";
assert.equal(new URL(origin).protocol, "https:");
const get = (path) =>
  fetch(origin + path, {
    redirect: "manual",
    signal: AbortSignal.timeout(60000),
  });
const health = await get("/api/health");
assert.equal(health.status, 200);
assert.match(health.headers.get("cache-control"), /no-store/);
assert.deepEqual(await health.json(), {
  app: "ok",
  state: "ok",
  protocol: release.protocol,
  bridge: release.bridge,
  release: release.version,
});
const root = await get("/");
assert.equal(root.status, 200);
assert.match(root.headers.get("content-security-policy"), /wasm-unsafe-eval/);
const session = await get("/s/release_smoke");
assert.equal(session.status, 303);
assert.match(session.headers.get("location"), /^\/login\?/);
const dev = await get("/dev/connect");
assert.equal(dev.status, 404);
const m = await get("/tailcat/build.json");
assert.equal(m.status, 200);
assert.match(m.headers.get("cache-control"), /no-store/);
const manifest = await m.json();
assert.equal(manifest.protocolVersion, 2);
assert.equal(manifest.bridgeVersion, 1);
assert.match(manifest.assetDir, /^[a-f0-9]{32}$/);
for (const [file, key] of [
  ["wasm_exec.js", "runtimeSHA256"],
  ["webssh.wasm.gz", "wasmSHA256"],
]) {
  const response = await get("/tailcat/" + manifest.assetDir + "/" + file);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /immutable/);
  let bytes = Buffer.from(await response.arrayBuffer());
  if (file.endsWith(".gz") && bytes[0] === 31 && bytes[1] === 139)
    bytes = gunzipSync(bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest[key]);
  if (file.endsWith(".gz")) assert(await WebAssembly.compile(bytes));
}
console.log(
  "Production app/state, auth gates, CSP and matched WASM/runtime assets passed. Relay/agent attachment is a separate gate.",
);
