import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
const cwd = fileURLToPath(new URL('.', import.meta.url));
if(execFileSync('protoc',['--version'],{encoding:'utf8'}).trim()!=='libprotoc 3.21.12') throw new Error('Protocol generation requires protoc 3.21.12 (see docs/deployment.md)');
mkdirSync(new URL('bin/', import.meta.url), { recursive: true });
execFileSync('go', ['install', '-p', '1', 'google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.11'], {
  cwd, env: { ...process.env, GOMAXPROCS: '2', GOBIN: fileURLToPath(new URL('bin/', import.meta.url)) }, stdio: 'inherit'
});
execFileSync('protoc', ['-I', 'schema', '--plugin=protoc-gen-go=bin/protoc-gen-go', '--go_out=gen', '--go_opt=paths=source_relative', '--plugin=protoc-gen-ts_proto=node_modules/.bin/protoc-gen-ts_proto', '--ts_proto_out=src/generated', '--ts_proto_opt=outputJsonMethods=false,outputPartialMethods=false,importSuffix=.js,oneof=unions,enumsAsLiterals=true', 'terminal.proto'], { cwd, stdio: 'inherit' });
