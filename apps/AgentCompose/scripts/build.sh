#!/usr/bin/env bash
# Compile the AgentCompose Tauri binary (dev profile, no bundle).
set -euo pipefail
cd "$(dirname "$0")/.."
exec pnpm build -- --no-bundle
