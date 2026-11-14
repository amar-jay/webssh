import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const moduleDir = join(root, 'packages/transport');
const output = join(root, 'apps/web/static/tailcat');
await mkdir(output, { recursive: true });
// Leave upstream feature omission tags out initially: correctness first. Review
// a version-matched WASM keep-list before optimizing binary size.
execFileSync('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', join(output, 'webssh.wasm'), './cmd/webssh-wasm'], {
  cwd: moduleDir, env: { ...process.env, GOOS: 'js', GOARCH: 'wasm' }, stdio: 'inherit'
});
const goRoot = execFileSync('go', ['env', 'GOROOT'], { cwd: moduleDir, encoding: 'utf8' }).trim();
await copyFile(join(goRoot, 'lib/wasm/wasm_exec.js'), join(output, 'wasm_exec.js'));
await writeFile(join(output, 'build.json'), JSON.stringify({
  bridgeVersion: 1,
  go: execFileSync('go', ['version'], { encoding: 'utf8' }).trim(),
  tailcat: execFileSync('go', ['list', '-m', '-f', '{{.Version}}', 'github.com/tailscale/tailcat'], { cwd: moduleDir, encoding: 'utf8' }).trim()
}, null, 2) + '\n');
console.log('Built WebSSH WASM and matching Go runtime in apps/web/static/tailcat');
