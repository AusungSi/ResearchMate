#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
APP_SCRIPT="$FRONTEND_DIR/node_modules/vite/bin/vite.js"
APP_PATTERN="node_modules/vite/bin/vite.js"
PID_FILE="$ROOT_DIR/.runtime/frontend.pid"

pid_matches_app() {
  local pid="$1"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" >/dev/null 2>&1 || return 1
  local cmdline
  cmdline="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  [[ -n "$cmdline" ]] || return 1
  [[ "$cmdline" == *"$APP_PATTERN"* ]]
}

terminate_pid() {
  local pid="$1"
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    return
  fi
  kill "$pid" >/dev/null 2>&1 || true
  for _ in {1..20}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return
    fi
    sleep 0.2
  done
  kill -9 "$pid" >/dev/null 2>&1 || true
}

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE")"
  if pid_matches_app "$pid"; then
    terminate_pid "$pid"
    echo "frontend stopped pid=$pid"
  else
    echo "frontend stale pid file ignored pid=$pid"
  fi
  rm -f "$PID_FILE"
fi

stale_pids="$(pgrep -f "$APP_PATTERN" || true)"
if [[ -n "$stale_pids" ]]; then
  echo "$stale_pids" | xargs -r -n 1 bash -lc 'kill "$1" >/dev/null 2>&1 || true; for _ in {1..20}; do kill -0 "$1" >/dev/null 2>&1 || exit 0; sleep 0.2; done; kill -9 "$1" >/dev/null 2>&1 || true' _
  echo "frontend stale processes stopped: $stale_pids"
else
  echo "frontend not running"
fi
