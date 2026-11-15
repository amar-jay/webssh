import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, rm, mkdtemp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
execFileSync(process.execPath, [join(root, "scripts/verify-release.mjs")], {
  stdio: "inherit",
});
const release = JSON.parse(await readFile(join(root, "release.json")));
if (
  execFileSync("go", ["env", "GOVERSION"], { encoding: "utf8" }).trim() !==
  release.go
)
  throw new Error("Use " + release.go);
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
if (
  process.env.CI &&
  execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }).trim()
)
  throw new Error("Release requires a clean checkout");
const dest = join(root, "dist", "release");
await mkdir(dest, { recursive: true });
const platforms = process.argv.includes("--native")
  ? [
      [
        process.platform === "darwin" ? "darwin" : "linux",
        process.arch === "arm64" ? "arm64" : "amd64",
      ],
    ]
  : [
      ["linux", "amd64"],
      ["linux", "arm64"],
      ["darwin", "amd64"],
      ["darwin", "arm64"],
    ];
const checksums = [];
for (const [os, arch] of platforms) {
  const scratch = await mkdtemp(join(tmpdir(), "webssh-release-"));
  try {
    const name = `webssh_${release.version}_${os}_${arch}.tar.gz`;
    execFileSync(
      "go",
      [
        "build",
        "-p",
        "1",
        "-trimpath",
        `-ldflags=-s -w -buildid= -X github.com/amar-jay/webssh/apps/cli/internal/command.Version=${release.version} -X github.com/amar-jay/webssh/apps/cli/internal/command.Commit=${commit}`,
        "-o",
        join(scratch, "webssh"),
        "./apps/cli/cmd/webssh",
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          GOMAXPROCS: "2",
          GOOS: os,
          GOARCH: arch,
          CGO_ENABLED: "0",
        },
        stdio: "inherit",
      },
    );
    await writeFile(
      join(scratch, "release.json"),
      JSON.stringify(
        { ...release, commit, platform: `${os}/${arch}` },
        null,
        2,
      ) + "\n",
    );
    execFileSync(
      "tar",
      ["-czf", join(dest, name), "-C", scratch, "webssh", "release.json"],
      { stdio: "inherit" },
    );
    checksums.push(
      createHash("sha256")
        .update(await readFile(join(dest, name)))
        .digest("hex") +
        "  " +
        name,
    );
    console.log("Built " + name);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
await writeFile(join(dest, "SHA256SUMS"), checksums.join("\n") + "\n");
await writeFile(
  join(dest, "release.json"),
  JSON.stringify({ ...release, commit }, null, 2) + "\n",
);
