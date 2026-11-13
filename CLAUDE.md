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
toolchain is wired up. `apps/AgentCompose` is the desktop app: Tauri + Rust
shell + Vue 3 renderer, managing agents, skills, MCP servers and Pi
extensions. `apps/agentspace-core` is the shared Rust crate both the desktop
app and the `agentspace` CLI use, so the two clients always agree on the
data layout. The shared packages contain placeholder or source-only
implementations. When adding a package's first real code, add the matching
scripts and update this file.

## Package Manager

pnpm only. `engines` + `engine-strict=true` (in `.npmrc`) block npm/yarn, and
`packageManager` pins `pnpm@10.18.1`. Requires Node >= 22.18.0.

```bash
pnpm install              # install all workspace deps
pnpm -r list --depth -1   # list workspace packages
pnpm --filter <name> <cmd>  # run a script in one package, e.g. --filter @remote/agent-compose dev
pnpm -r <cmd>             # run a script across all packages that define it
```

## Layout

Workspace globs (`pnpm-workspace.yaml`): `apps/*` and `packages/*`.

| Package                     | Dir                          | Role                                                       |
| --------------------------- | ---------------------------- | ---------------------------------------------------------- |
| `@remote/agent-compose`     | `apps/AgentCompose`          | Desktop app (private): Tauri + Rust shell + Vue 3 renderer |
| `@remote/agent-compose-mcp` | `packages/agent-compose-mcp` | MCP sidecar + shared TS types (private)                    |

The Rust side lives outside pnpm: `apps/agentspace-core` is the shared crate
(`agentspace_core`), and `apps/agentspace-cli` builds the `agentspace`
command line on top of it. The desktop app depends on the same crate, so
both clients read and write the same files under `~/.agent-compose/`.

Internal deps use the `workspace:*` protocol, so pnpm symlinks local packages
instead of fetching from a registry.

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
