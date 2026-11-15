import assert from "node:assert/strict";
import {
  readFile,
  mkdtemp,
  mkdir,
  rm,
  copyFile,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const version = JSON.parse(await readFile(join(root, "release.json"))).version;
const platform = process.platform === "darwin" ? "darwin" : "linux",
  arch = process.arch === "arm64" ? "arm64" : "amd64";
const archive = `webssh_${version}_${platform}_${arch}.tar.gz`;
const scratch = await mkdtemp(join(tmpdir(), "webssh-install-test-"));
try {
  const bin = join(scratch, "bin"),
    destination = join(scratch, "installed");
  await mkdir(bin);
  await mkdir(destination);
  // Replace only the network boundary with recorded release files. Execute the real installer.
  await writeFile(
    join(bin, "curl"),
    `#!/bin/sh\ncase "$*" in *SHA256SUMS*) source="$RELEASE_FIXTURE/SHA256SUMS";; *) source="$RELEASE_FIXTURE/$RELEASE_ARCHIVE";; esac\nwhile [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then cp "$source" "$2"; exit; fi; shift; done\nexit 1\n`,
    { mode: 0o755 },
  );
  await copyFile(join(root, "dist/release", archive), join(scratch, archive));
  await copyFile(
    join(root, "dist/release/SHA256SUMS"),
    join(scratch, "SHA256SUMS"),
  );
  const env = {
    ...process.env,
    PATH: bin + ":" + process.env.PATH,
    RELEASE_FIXTURE: scratch,
    RELEASE_ARCHIVE: archive,
  };
  const install = () =>
    execFileSync(
      "sh",
      [join(root, "scripts/install.sh"), version, destination],
      { env, encoding: "utf8" },
    );
  install();
  install();
  assert.match(
    execFileSync(join(destination, "webssh"), ["--version"], {
      encoding: "utf8",
    }),
    new RegExp(version.replaceAll(".", "\\.")),
  );
  const before = await readFile(join(destination, "webssh"));
  await writeFile(join(scratch, archive), "corrupt archive");
  assert.throws(install);
  assert.deepEqual(await readFile(join(destination, "webssh")), before);
  console.log(
    "Fresh install, atomic update, checksum failure and existing-binary preservation passed.",
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
