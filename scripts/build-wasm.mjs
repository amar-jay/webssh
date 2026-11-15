import { gzipSync, constants } from "node:zlib";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile, rm, mkdtemp } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleDir = join(root, "packages/transport");
const output = join(root, "apps/web/static/tailcat");
const release = JSON.parse(await readFile(join(root, "release.json")));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const run = (args) =>
  execFileSync("go", args, {
    cwd: moduleDir,
    encoding: "utf8",
    env: { ...process.env, GOMAXPROCS: "2" },
  }).trim();
const go = run(["env", "GOVERSION"]);
if (go !== release.go)
  throw new Error("Go toolchain mismatch; use " + release.go);
for (const [name, expected] of [
  ["github.com/tailscale/tailcat", release.tailcat],
  ["tailscale.com", release.tailscale],
]) {
  if (run(["list", "-m", "-f", "{{.Version}}", name]) !== expected)
    throw new Error("Release dependency mismatch: " + name);
}
const tags = (
  await readFile(join(root, "scripts/wasm-tags.txt"), "utf8")
).trim();
const sourceInputs = execFileSync(
  "go",
  [
    "list",
    "-tags",
    tags,
    "-deps",
    "-f",
    "{{range .GoFiles}}{{$.Dir}}/{{.}}\n{{end}}{{range .EmbedFiles}}{{$.Dir}}/{{.}}\n{{end}}",
    "./cmd/webssh-wasm",
  ],
  {
    cwd: moduleDir,
    encoding: "utf8",
    env: { ...process.env, GOMAXPROCS: "2", GOOS: "js", GOARCH: "wasm" },
  },
)
  .trim()
  .split("\n")
  .filter(Boolean)
  .sort();
const inputs = createHash("sha256")
  .update(await readFile(fileURLToPath(import.meta.url)))
  .update(JSON.stringify(release))
  .update(tags)
  .update(go);
for (const path of sourceInputs) inputs.update(await readFile(path));
const inputHash = inputs.digest("hex");
if (!process.argv.includes("--force")) {
  try {
    const previous = JSON.parse(await readFile(join(output, "build.json")));
    if (previous.inputHash === inputHash) {
      const binary = await readFile(
        join(output, previous.assetDir, "webssh.wasm.gz"),
      );
      const runtime = await readFile(
        join(output, previous.assetDir, "wasm_exec.js"),
      );
      if (
        hash(binary) === previous.gzipSHA256 &&
        hash(runtime) === previous.runtimeSHA256
      ) {
        console.log("WASM inputs unchanged; reusing verified assets");
        process.exit(0);
      }
    }
  } catch {}
}
const scratch = await mkdtemp(join(tmpdir(), "webssh-wasm-"));
try {
  const binaryPath = join(scratch, "webssh.wasm");
  execFileSync(
    "go",
    [
      "build",
      "-p",
      "1",
      "-trimpath",
      "-tags",
      tags,
      "-ldflags=-s -w",
      "-o",
      binaryPath,
      "./cmd/webssh-wasm",
    ],
    {
      cwd: moduleDir,
      env: { ...process.env, GOMAXPROCS: "2", GOOS: "js", GOARCH: "wasm" },
      stdio: "inherit",
    },
  );
  const binary = await readFile(binaryPath),
    gzip = gzipSync(binary, { level: constants.Z_BEST_COMPRESSION });
  if (gzip.length > 25 * 1024 * 1024)
    throw new Error(
      "WASM exceeds Cloudflare static asset limit; configure a separate asset host",
    );
  if (binary.length > 64 * 1024 * 1024)
    throw new Error("WASM exceeds browser download budget");
  const runtime = await readFile(
    join(run(["env", "GOROOT"]), "lib/wasm/wasm_exec.js"),
  );
  const assetDir = hash(Buffer.concat([gzip, runtime])).slice(0, 32);
  await mkdir(join(output, assetDir), { recursive: true });
  await writeFile(join(output, assetDir, "webssh.wasm.gz"), gzip);
  await writeFile(join(output, assetDir, "wasm_exec.js"), runtime);
  const manifest = {
    schema: 1,
    release: release.version,
    protocolVersion: release.protocol,
    bridgeVersion: release.bridge,
    go,
    tailcat: release.tailcat,
    tailscale: release.tailscale,
    inputHash,
    assetDir,
    uncompressedBytes: binary.length,
    gzipBytes: gzip.length,
    wasmSHA256: hash(binary),
    gzipSHA256: hash(gzip),
    runtimeSHA256: hash(runtime),
    tags: tags.split(","),
  };
  await writeFile(
    join(output, "build.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  // Remove the former unversioned runtime/binary so they cannot be paired across releases.
  await Promise.all(
    ["webssh.wasm", "webssh.wasm.gz", "wasm_exec.js"].map((name) =>
      rm(join(output, name), { force: true }),
    ),
  );
  console.log(
    `WASM: ${binary.length} bytes raw, ${gzip.length} bytes gzip; asset ${assetDir}`,
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
