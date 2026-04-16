#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
TOOLS_DIR="${TOOLS_DIR:-$ROOT_DIR/.wsl-tools}"
NODE_VERSION="${NODE_VERSION:-$(cat "$FRONTEND_DIR/.nvmrc" 2>/dev/null || echo 22.18.0)}"
NODE_DIST="node-v${NODE_VERSION}-linux-x64"
NODE_DIR="$TOOLS_DIR/$NODE_DIST"
NODE_BIN="$NODE_DIR/bin/node"
ARCHIVE_PATH="$TOOLS_DIR/${NODE_DIST}.tar.xz"
DOWNLOAD_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_DIST}.tar.xz"

mkdir -p "$TOOLS_DIR"

if [[ -x "$NODE_BIN" ]] && [[ "$("$NODE_BIN" --version)" == "v${NODE_VERSION}" ]]; then
  echo "WSL node already installed at $NODE_BIN"
  exit 0
fi

echo "Downloading Node.js v${NODE_VERSION} for WSL..."
rm -f "$ARCHIVE_PATH"
curl -fsSL "$DOWNLOAD_URL" -o "$ARCHIVE_PATH"

echo "Extracting Node.js into $TOOLS_DIR..."
rm -rf "$NODE_DIR"
tar -xf "$ARCHIVE_PATH" -C "$TOOLS_DIR"

if [[ ! -x "$NODE_BIN" ]]; then
  echo "Node installation failed: $NODE_BIN not found" >&2
  exit 1
fi

echo "Installed $("$NODE_BIN" --version) at $NODE_BIN"
