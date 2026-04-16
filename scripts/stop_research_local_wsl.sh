#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

pid_matches_pattern() {
  local pid="$1"
  local pattern="$2"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" >/dev/null 2>&1 || return 1
  local cmdline
  cmdline="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  [[ -n "$cmdline" ]] || return 1
  [[ "$cmdline" == *"$pattern"* ]]
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

stop_process() {
  local name="$1"
  local pid_file="$2"
  local pattern="$3"

  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if pid_matches_pattern "$pid" "$pattern"; then
      terminate_pid "$pid"
      echo "$name stopped pid=$pid"
    else
      echo "$name stale pid file ignored pid=$pid"
    fi
    rm -f "$pid_file"
  fi

  local stale_pids
  stale_pids="$(pgrep -f "$pattern" || true)"
  if [[ -n "$stale_pids" ]]; then
    echo "$stale_pids" | xargs -r -n 1 bash -lc 'kill "$1" >/dev/null 2>&1 || true; for _ in {1..20}; do kill -0 "$1" >/dev/null 2>&1 || exit 0; sleep 0.2; done; kill -9 "$1" >/dev/null 2>&1 || true' _
    echo "$name stale processes stopped: $stale_pids"
  elif [[ ! -f "$pid_file" ]]; then
    echo "$name not running"
  fi
}

stop_process "backend" ".runtime/backend.pid" "uvicorn app.main:app"
stop_process "worker" ".runtime/worker.pid" "app.workers.research_worker"
