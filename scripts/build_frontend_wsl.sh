#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
TOOLS_DIR="${TOOLS_DIR:-$ROOT_DIR/.wsl-tools}"
NODE_VERSION="${NODE_VERSION:-$(cat "$FRONTEND_DIR/.nvmrc" 2>/dev/null || echo 22.18.0)}"
NODE_DIST="node-v${NODE_VERSION}-linux-x64"
NODE_DIR="$TOOLS_DIR/$NODE_DIST"
NODE_BIN="$NODE_DIR/bin/node"
NPM_BIN="$NODE_DIR/bin/npm"

mkdir -p "$ROOT_DIR/.runtime" "$ROOT_DIR/artifacts/releases"

if [[ ! -x "$NODE_BIN" ]]; then
  bash "$ROOT_DIR/scripts/install_frontend_node_wsl.sh"
fi

export PATH="$NODE_DIR/bin:$PATH"

stamp_file="$FRONTEND_DIR/node_modules/.package-lock-ready"
if [[ ! -d "$FRONTEND_DIR/node_modules" ]] || [[ ! -f "$stamp_file" ]] || [[ "$FRONTEND_DIR/package-lock.json" -nt "$stamp_file" ]]; then
  echo "Installing frontend dependencies inside WSL..."
  (cd "$FRONTEND_DIR" && "$NPM_BIN" ci)
  touch "$stamp_file"
fi

echo "Building frontend inside WSL..."
(cd "$FRONTEND_DIR" && "$NODE_BIN" ./node_modules/typescript/bin/tsc -b)
(cd "$FRONTEND_DIR" && "$NODE_BIN" ./node_modules/vite/bin/vite.js build)

echo "Frontend build complete: $FRONTEND_DIR/dist"
