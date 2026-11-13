# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## How to verify a change

**Only verify the code.** Do not run the test suites, do not take screenshots,
do not drive the UI (no Playwright / no `orca computer` / no window
automation), and do not launch the desktop app to click through it.

What "verifying the code" means here:

- `pnpm --filter <name> typecheck` (or `vue-tsc --noEmit`)
- `pnpm --filter <name> lint` (ESLint)
- `cargo check` / `cargo build` for Rust crates
- reading the diff back

The user checks the running app themselves. A change that typechecks and lints
clean is done — reporting "I verified it works" on that basis is fine, but do
not claim a behaviour was confirmed on screen.

## Status

Early-stage pnpm monorepo. The build, typecheck, test, lint, and formatting
toolchain is wired up. `apps/agent-management` is a single desktop app that
merges the Electron shell and the Vue 3 renderer into one package; its
renderer screens are still mock-data placeholders. `apps/AgentCompose` is a
Tauri + Vue 3 app whose Rust shell is still empty and whose renderer is a
mock-data Skills screen. The shared packages contain
placeholder or source-only implementations. When adding a package's first real
code, add the matching scripts and update this file.

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

| Package                    | Dir                     | Role                                                            |
| -------------------------- | ----------------------- | --------------------------------------------------------------- |
| `@remote/agent-management` | `apps/agent-management` | Desktop app (private): Electron shell + Vue 3 renderer in one   |
| `@remote/agent-data-grid`  | `apps/agent-data-grid`  | Data-grid desktop app (private): Tauri + Rust engine + React UI |
| `@remote/agent-compose`    | `apps/AgentCompose`     | Agent Skills desktop app (private): Tauri + Rust shell + Vue 3  |
| `@remote/components`       | `packages/components`   | Shared UI components; depends on `@remote/utils`                |
| `@remote/cli`              | `packages/cli`          | CLI tool (`bin: remote-cli`); depends on `@remote/utils`        |
| `@remote/utils`            | `packages/utils`        | Leaf shared utilities; no internal deps                         |

Internal deps use the `workspace:*` protocol, so pnpm symlinks local packages
instead of fetching from a registry. Dependency direction is one-way:
`agent-management → components → utils` and `cli → utils`. Keep `utils`
dependency-free of other workspace packages to avoid cycles.

`@remote/agent-management` is one self-contained package: the Electron main
process lives in `src/main`, the preload bridge in `src/preload`, the IPC
contract in `src/shared`, and the Vue 3 renderer in `src/renderer` (its own
`index.html` + `src/`). electron-vite renderer root = `src/renderer`, and
`@` aliases to `src/renderer/src`. The root package has no `dev` script;
`turbo run dev` picks up every package that defines one, so the desktop app
is started explicitly:

```bash
pnpm --filter @remote/agent-management dev       # desktop dev server on 5174 + Electron window (HMR)
pnpm --filter @remote/agent-management dev:web   # renderer only, web dev server on 5173 (no Electron)
pnpm --filter @remote/agent-management build      # out/* + release/win-unpacked (electron-builder --dir)
pnpm --filter @remote/agent-management build:bundle  # only out/main, out/preload, out/renderer
pnpm --filter @remote/agent-management start      # run the built output
pnpm --filter @remote/agent-management typecheck  # tsc (main/preload) + vue-tsc (renderer)
pnpm --filter @remote/agent-management test       # main/preload unit tests (node environment)
```

Ports differ on purpose: `dev:web` uses Vite's default 5173, the desktop
renderer dev server uses 5174 (`agent-data-grid` uses 5175, `AgentCompose` uses
5176), so they can run at the same time.

`@remote/agent-data-grid` is a **Tauri** app: the shell and the database
engine are Rust, the renderer is React 19. Layout inside the package:
`crates/ide-core`, `crates/ide-ssh` and `crates/ide-db` are vendored from
[OpenIDEA](https://github.com/l0ng-ai/openidea) (Apache-2.0) — the real
database engine (sqlx + tiberius + bb8, hand-written dialect introspection) —
and `src-tauri/src/commands/db.rs` exposes 28 typed commands through
`tauri-specta`; `pnpm gen:bindings` regenerates `src/bindings.ts`.
The renderer (`src/`, package root `index.html`) uses the vendored OpenIDEA UI
kit in `src/ui` (components + IntelliJ expui icons) and platform layer in
`src/platform`; theme tokens come from `src/styles/tokens.css` with app
aliases in `styles/app-tokens.css`. `apps/agent-data-grid/SPEC.md` is the UI
contract and `apps/agent-data-grid/THIRD_PARTY_LICENSES.md` records the
vendored licences. Vendored `ui/`, `platform/`, `features/database/` and the
generated `bindings.ts` are excluded from prettier/eslint (upstream uses
oxfmt).

`@remote/agent-compose` is a **Tauri** app too: `src-tauri/` holds a minimal
Rust shell (no commands yet), `src/` holds the Vue 3 renderer, and
`src-tauri/tauri.conf.json` wires `devUrl` to `http://localhost:5176` with
`frontendDist: ../dist`. Its scripts go through `scripts/tauri.mjs`, a launcher
that (a) puts `~/.cargo/bin` and the GNU toolchain's `self-contained` binutils
directory on `PATH`, (b) prefers a local MSYS2 MinGW-w64 toolchain
(`~/mingw64/bin`), and (c) runs a 2-second probe compile before starting Tauri
to pick a working `rustc` flag set — this machine's rustup GNU toolchain
cannot spawn its own `dlltool.exe` (`dlltool could not create import library
...: CreateProcess`), which is fatal because `raw-dylib` crates such as
`getrandom` need rustc to generate an import library at build time. The probe
prints which strategy it picked; see the file header for the candidates and the
`AGENT_COMPOSE_RUSTFLAGS` / `AGENT_COMPOSE_SKIP_PROBE` overrides. The MSYS2
strategy is the one that works here: it prepends `~/mingw64/bin` to `PATH` and
passes `-C dlltool=<msys2 dlltool>` + `-C linker=<msys2 gcc>`, because rustup's
`self-contained\x86_64-w64-mingw32-gcc.exe` is a link-only shell without the
mingw libs, and MSYS2 also supplies the `windres` that `tauri-build` needs for
the Windows icon resource. `src-tauri/Cargo.toml` therefore keeps
`crate-type = ["rlib"]` only — a `cdylib` on windows-gnu exports too many
symbols and GNU ld fails with `export ordinal too large`.
`scripts/tauri.mjs` also has to read `PATH` case-insensitively: on a native
Windows shell the variable is named `Path`, and `{ ...process.env }` copies that
spelling verbatim, so `env.PATH` is `undefined` and a naive PATH rewrite wipes
`node.exe` out of the child's environment (`'node' 不是内部或外部命令`).

```bash
pnpm --filter @remote/agent-compose dev       # tauri dev(vite 5176 + 原生窗口)
pnpm --filter @remote/agent-compose dev:web   # 只起 vite dev server(5176),不起壳
pnpm --filter @remote/agent-compose build     # tauri build(前端 dist + rust 可执行文件)
```

TypeScript is split in two: `tsconfig.json` (main/preload/shared + build
configs, Node types, no DOM) and `tsconfig.renderer.json` (Vue 3 renderer,
DOM types, `@/*` path alias).

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
for IPC channels. Do not add Electron/Node code to `packages/*` or to the
renderer (`src/renderer`); renderer code reaches the shell only through the
`window.desktop` bridge.
