#!/usr/bin/env bash
# Launch AgentCompose in Tauri dev mode (vite 5176 + native window).
set -euo pipefail
cd "$(dirname "$0")/.."
exec pnpm dev
