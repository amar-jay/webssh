import test from "node:test";
import assert from "node:assert/strict";
import { validateManifest, createTransport } from "../src/index.ts";
const valid = {
  schema: 1,
  protocolVersion: 2,
  bridgeVersion: 1,
  tailcat: "v0.7.0",
  tailscale: "v1.103.0-pre.0.20260916030321-a2263542f260",
  assetDir: "a".repeat(32),
  wasmSHA256: "b".repeat(64),
  runtimeSHA256: "c".repeat(64),
};
test("transport manifest rejects stale ABI, protocol, dependency and unsafe asset paths", () => {
  assert.equal(validateManifest(valid).assetDir, valid.assetDir);
  for (const patch of [
    { schema: 0 },
    { protocolVersion: 1 },
    { bridgeVersion: 2 },
    { tailcat: "v0.6.0" },
    { tailscale: "old" },
    { assetDir: "../runtime" },
    { wasmSHA256: "unknown" },
    { runtimeSHA256: "bad" },
  ])
    assert.throws(
      () => validateManifest({ ...valid, ...patch }),
      /Reload this page/,
    );
  assert.throws(() => validateManifest(null), /version mismatch/);
  assert.throws(() => createTransport({ version: 999 }), /Reload this page/);
});
