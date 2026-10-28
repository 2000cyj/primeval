# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Early-stage pnpm monorepo. The build, typecheck, test, lint, and formatting
toolchain is wired up. `apps/vue` is still a placeholder Vue 3 + Vite app; the
shared packages contain placeholder or source-only implementations. When adding
a package's first real code, add the matching scripts and update this file.

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

| Package              | Dir                   | Role                                                     |
| -------------------- | --------------------- | -------------------------------------------------------- |
| `@remote/app-vue`    | `apps/vue`            | Vue 3 + Vite frontend (private, placeholder)             |
| `@remote/components` | `packages/components` | Shared UI components; depends on `@remote/utils`         |
| `@remote/cli`        | `packages/cli`        | CLI tool (`bin: remote-cli`); depends on `@remote/utils` |
| `@remote/utils`      | `packages/utils`      | Leaf shared utilities; no internal deps                  |

Internal deps use the `workspace:*` protocol, so pnpm symlinks local packages
instead of fetching from a registry. Dependency direction is one-way:
`app-vue → components → utils` and `cli → utils`. Keep `utils`
dependency-free of other workspace packages to avoid cycles.
