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

| Package              | Dir                   | Role                                                      |
| -------------------- | --------------------- | --------------------------------------------------------- |
| `@remote/app-vue`    | `apps/vue`            | Vue 3 + Vite frontend (private, placeholder)              |
| `@remote/desktop`    | `apps/desktop`        | Electron shell (private) wrapping the `apps/vue` renderer |
| `@remote/components` | `packages/components` | Shared UI components; depends on `@remote/utils`          |
| `@remote/cli`        | `packages/cli`        | CLI tool (`bin: remote-cli`); depends on `@remote/utils`  |
| `@remote/utils`      | `packages/utils`      | Leaf shared utilities; no internal deps                   |

Internal deps use the `workspace:*` protocol, so pnpm symlinks local packages
instead of fetching from a registry. Dependency direction is one-way:
`app-vue → components → utils` and `cli → utils`. Keep `utils`
dependency-free of other workspace packages to avoid cycles.

`@remote/desktop` depends on `@remote/app-vue` at build time and reuses its
source as the Electron renderer (electron-vite renderer root = `apps/vue`).
The root package has no `dev` script; `turbo run dev` picks up every package
that defines one, so the desktop shell is started explicitly:

```bash
pnpm --filter @remote/app-vue dev       # web dev server on 5173
pnpm --filter @remote/desktop dev        # desktop dev server on 5174 + Electron window (HMR)
pnpm --filter @remote/desktop build      # out/* + release/win-unpacked (electron-builder --dir)
pnpm --filter @remote/desktop build:bundle  # only out/main, out/preload, out/renderer
pnpm --filter @remote/desktop start      # run the built output
pnpm --filter @remote/desktop typecheck
pnpm --filter @remote/desktop test       # main/preload unit tests (node environment)
```

Ports differ on purpose: `apps/vue` uses Vite's default 5173, the desktop
renderer dev server uses 5174, so both can run at the same time.

Security baseline is fixed: `contextIsolation: true`, `sandbox: true`,
`nodeIntegration: false`, `webSecurity: true`, production CSP with no inline
scripts or `eval`, and exactly one read-only IPC probe (`app:getVersion`)
exposed through `contextBridge` as `window.desktop`. Main process is ESM;
preload is built as CommonJS (`out/preload/index.cjs`) because sandboxed
preloads cannot be ESM. "Dev mode" is decided by the presence of
`ELECTRON_RENDERER_URL` (not `app.isPackaged`), and the IPC sender /
navigation allowlist is a single policy shared by both: dev trusts only the
dev server origin, non-dev trusts only the actual renderer entry file.
`ALLOWED_CHANNELS` in `src/shared/channels.ts` is the runtime whitelist gate
for IPC channels. Do not add Electron/Node code to `packages/*` or
`apps/vue`.
