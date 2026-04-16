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
APP_SCRIPT="$FRONTEND_DIR/node_modules/vite/bin/vite.js"
APP_PATTERN="node_modules/vite/bin/vite.js"

FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
VITE_API_PROXY_TARGET="${VITE_API_PROXY_TARGET:-http://127.0.0.1:8000}"

PID_FILE="$ROOT_DIR/.runtime/frontend.pid"
LOG_FILE="$ROOT_DIR/.runtime/frontend.log"

mkdir -p "$ROOT_DIR/.runtime" "$ROOT_DIR/artifacts/releases"

if [[ ! -x "$NODE_BIN" ]]; then
  bash "$ROOT_DIR/scripts/install_frontend_node_wsl.sh"
fi

export PATH="$NODE_DIR/bin:$PATH"
export VITE_API_PROXY_TARGET
export NODE_ENV="${NODE_ENV:-development}"

ensure_deps() {
  local stamp_file="$FRONTEND_DIR/node_modules/.package-lock-ready"
  if [[ ! -d "$FRONTEND_DIR/node_modules" ]] || [[ ! -f "$stamp_file" ]] || [[ "$FRONTEND_DIR/package-lock.json" -nt "$stamp_file" ]]; then
    echo "Installing frontend dependencies inside WSL..."
    (cd "$FRONTEND_DIR" && "$NPM_BIN" ci)
    touch "$stamp_file"
  fi
}

pid_matches_app() {
  local pid="$1"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" >/dev/null 2>&1 || return 1
  local cmdline
  cmdline="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  [[ -n "$cmdline" ]] || return 1
  [[ "$cmdline" == *"$APP_PATTERN"* ]]
}

ensure_deps

if [[ -f "$PID_FILE" ]]; then
  existing_pid="$(cat "$PID_FILE")"
  if pid_matches_app "$existing_pid"; then
    echo "frontend already running pid=$existing_pid"
    echo "Research workbench: http://127.0.0.1:${FRONTEND_PORT}"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

existing_pid="$(pgrep -f "$APP_PATTERN" | head -n 1 || true)"
if pid_matches_app "$existing_pid"; then
  echo "$existing_pid" >"$PID_FILE"
  echo "frontend already running pid=$existing_pid"
  echo "Research workbench: http://127.0.0.1:${FRONTEND_PORT}"
  exit 0
fi

: >"$LOG_FILE"
pushd "$FRONTEND_DIR" >/dev/null
setsid "$NODE_BIN" "./node_modules/vite/bin/vite.js" --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" >"$LOG_FILE" 2>&1 < /dev/null &
pid="$!"
popd >/dev/null
sleep 2

actual_pid="$(pgrep -n -f "$APP_PATTERN" || true)"
if pid_matches_app "$actual_pid"; then
  pid="$actual_pid"
elif ! pid_matches_app "$pid"; then
  existing_pid="$(pgrep -f "$APP_PATTERN" | head -n 1 || true)"
  if ! pid_matches_app "$existing_pid"; then
    echo "frontend failed to start. Recent log output:" >&2
    tail -n 60 "$LOG_FILE" >&2 || true
    exit 1
  fi
  pid="$existing_pid"
fi

echo "$pid" >"$PID_FILE"
echo "frontend started pid=$pid log=$LOG_FILE"
echo "Research workbench: http://127.0.0.1:${FRONTEND_PORT}"
