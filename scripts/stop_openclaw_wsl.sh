#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PID_FILE=".runtime/openclaw.pid"
PATTERN="openclaw-gateway|openclaw gateway run"

pid_matches_pattern() {
  local pid="$1"
  local pattern="$2"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" >/dev/null 2>&1 || return 1
  local cmdline
  cmdline="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  [[ -n "$cmdline" ]] || return 1
  printf '%s' "$cmdline" | grep -E -q "$pattern"
}

stop_pid() {
  local pid="$1"
  if ! pid_matches_pattern "$pid" "$PATTERN"; then
    return 1
  fi
  kill "$pid" >/dev/null 2>&1 || true
  for _ in {1..20}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done
  kill -9 "$pid" >/dev/null 2>&1 || true
  return 0
}

stopped=0

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE")"
  if stop_pid "$pid"; then
    echo "openclaw gateway stopped pid=$pid"
    stopped=1
  fi
  rm -f "$PID_FILE"
fi

while true; do
  pid="$(pgrep -f "$PATTERN" | head -n 1 || true)"
  [[ -n "$pid" ]] || break
  stop_pid "$pid" || break
  echo "openclaw gateway stopped pid=$pid"
  stopped=1
done

if [[ "$stopped" -eq 0 ]]; then
  echo "openclaw gateway not running"
fi
