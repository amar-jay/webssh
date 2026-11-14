# Go and pnpm workspaces

WebSSH is a dual Go/pnpm monorepo. The repository root is a workspace, not an extra Go module.

| Directory | Go | pnpm |
| --- | --- | --- |
| `apps/cli` | CLI/agent module | — |
| `apps/web` | — | SvelteKit app |
| `apps/state` | — | Cloudflare state Worker |
| `packages/transport` | Reusable client lifecycle and browser WASM entrypoint | Typed browser transport client and asset build |
| `packages/protocol` | Protobuf schema, Go codec, fixtures | Generated TypeScript codec |

`go.work` lists local Go modules. Each retains its own `go.mod` and `go.sum`. `pnpm-workspace.yaml` discovers `apps/*` and `packages/*`, and the root lockfile records JavaScript dependencies. The web app depends on `@webssh/transport` using `workspace:*`.

Do not add empty modules for hypothetical shared code. Add a module when its purpose and API exist. Code shared between modules must be outside a module's `internal` directory, and Go module imports use their full module paths. `go.work` resolves local modules during development; an independently consumed module still needs valid dependency versions or an explicitly managed local replacement.

Common root commands:

```sh
pnpm install
pnpm check
pnpm go:test
pnpm go:vet
pnpm --filter @webssh/transport test
pnpm wasm:build
pnpm --filter @webssh/transport test:wasm
```

Go package patterns must name module directories: `go test ./apps/cli/... ./packages/transport/...` works from the root; `go test ./...` does not cover a workspace root that is not a module. Update the root Go scripts when adding modules.

Use `GOWORK=off go test ./...` inside a module to check it independently. Avoid running `go work sync` as a routine install step: it can rewrite module dependency versions. Commit `go.work`, module manifests/sums, and any generated `go.work.sum` needed by the workspace.

WASM compilation is explicit, not part of each frontend edit/build. Run it after changing Go transport code or the Go toolchain. Generated assets are ignored by Git. CI/deployment must run `pnpm wasm:build` before building/deploying the web app when it needs the transport. The web build alone does not generate these assets.

Go workspace references: [workspace tutorial](https://go.dev/doc/tutorial/workspaces), [module/workspace reference](https://go.dev/ref/mod#workspaces).
