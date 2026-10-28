# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Early-stage pnpm monorepo skeleton. Packages exist as `package.json` + placeholder
source only — there is no build, lint, or test tooling wired up yet. When adding a
package's first real code, also add its `scripts` (build/test/lint) and update this file.

## Package Manager

pnpm only. `engines` + `engine-strict=true` (in `.npmrc`) block npm/yarn, and
`packageManager` pins `pnpm@10.18.1`. Requires Node >= 22.18.0.

```bash
pnpm install              # install all workspace deps
pnpm -r list --depth -1   # list workspace packages
pnpm --filter <name> <cmd>  # run a script in one package, e.g. --filter @remote/cli build
pnpm -r <cmd>             # run a script across all packages that define it
```

## Layout

Workspace globs (`pnpm-workspace.yaml`): `apps/*` and `packages/*`.

| Package                       | Dir                        | Role                                                                                        |
| ----------------------------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| `@remote/remote-control-vue3` | `apps/remote-control-vue3` | Vue 3 + Element Plus admin frontend (private); see its own CLAUDE.md for internal structure |
| `@remote/components`          | `packages/components`      | Shared UI components; depends on `@remote/utils`                                            |
| `@remote/cli`                 | `packages/cli`             | CLI tool (`bin: remote-cli`); depends on `@remote/utils`                                    |
| `@remote/utils`               | `packages/utils`           | Leaf shared utilities; no internal deps                                                     |

Internal deps use the `workspace:*` protocol, so pnpm symlinks local packages
instead of fetching from a registry. Dependency direction is one-way:
`remote-control-vue3 → components → utils` and `cli → utils`. Keep `utils`
dependency-free of other workspace packages to avoid cycles.
