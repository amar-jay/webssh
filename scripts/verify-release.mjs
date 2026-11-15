import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const release = JSON.parse(
  await readFile(new URL("../release.json", import.meta.url)),
);
if (process.env.GITHUB_REF_TYPE === "tag")
  assert.equal(
    process.env.GITHUB_REF_NAME,
    "v" + release.version,
    "Tag must match release.json",
  );
for (const module of ["apps/cli", "packages/transport"]) {
  const source = await readFile(
    new URL("../" + module + "/go.mod", import.meta.url),
    "utf8",
  );
  assert(source.includes("github.com/tailscale/tailcat " + release.tailcat));
  assert(source.includes("tailscale.com " + release.tailscale));
  assert(source.includes("go " + release.go.slice(2)));
}
console.log("Release version and native/WASM dependencies match.");

assert(
  (
    await readFile(
      new URL("../packages/protocol/frame.go", import.meta.url),
      "utf8",
    )
  ).includes("const Version = " + release.protocol),
);
assert(
  (
    await readFile(
      new URL("../packages/protocol/src/index.ts", import.meta.url),
      "utf8",
    )
  ).includes("export const version = " + release.protocol),
);
