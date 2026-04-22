#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p .runtime data artifacts/research

PYTHON_BIN="${PYTHON_BIN:-.venv-wsl/bin/python}"
APP_PORT="${APP_PORT:-8000}"
APP_HOST="${APP_HOST:-0.0.0.0}"

export APP_PROFILE="${APP_PROFILE:-research_local}"
export RESEARCH_ENABLED="${RESEARCH_ENABLED:-true}"
export RESEARCH_QUEUE_MODE="${RESEARCH_QUEUE_MODE:-worker}"
export DB_URL="${DB_URL:-sqlite:///./data/memomate.db}"
export RESEARCH_ARTIFACT_DIR="${RESEARCH_ARTIFACT_DIR:-./artifacts/research}"
export RESEARCH_SAVE_BASE_DIR="${RESEARCH_SAVE_BASE_DIR:-./artifacts/research/saved}"
export PYTHONUNBUFFERED="${PYTHONUNBUFFERED:-1}"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Python executable not found: $PYTHON_BIN" >&2
  echo "Create it first, for example: ~/.local/bin/virtualenv .venv-wsl" >&2
  exit 1
fi

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

start_process() {
  local name="$1"
  local pid_file="$2"
  local log_file="$3"
  local pattern="$4"
  shift 4

  if [[ -f "$pid_file" ]]; then
    local recorded_pid
    recorded_pid="$(cat "$pid_file")"
    if pid_matches_pattern "$recorded_pid" "$pattern"; then
      echo "$name already running pid=$recorded_pid"
      return
    fi
    rm -f "$pid_file"
  fi

  local existing_pid
  existing_pid="$(pgrep -f "$pattern" | head -n 1 || true)"
  if pid_matches_pattern "$existing_pid" "$pattern"; then
    echo "$existing_pid" >"$pid_file"
    echo "$name already running pid=$existing_pid"
    return
  fi

  : >"$log_file"
  setsid "$@" >"$log_file" 2>&1 < /dev/null &
  local pid="$!"
  sleep 2
  if pid_matches_pattern "$pid" "$pattern"; then
    echo "$pid" >"$pid_file"
    echo "$name started pid=$pid log=$log_file"
    return
  fi

  existing_pid="$(pgrep -f "$pattern" | head -n 1 || true)"
  if pid_matches_pattern "$existing_pid" "$pattern"; then
    echo "$existing_pid" >"$pid_file"
    echo "$name started pid=$existing_pid log=$log_file"
    return
  fi

  rm -f "$pid_file"
  echo "$name failed to start. Recent log output:" >&2
  tail -n 40 "$log_file" >&2 || true
  exit 1
}

start_process \
  "backend" \
  ".runtime/backend.pid" \
  ".runtime/backend.log" \
  "uvicorn app.main:app" \
  "$PYTHON_BIN" -m uvicorn app.main:app --host "$APP_HOST" --port "$APP_PORT"

start_process \
  "worker" \
  ".runtime/worker.pid" \
  ".runtime/worker.log" \
  "app.workers.research_worker" \
  "$PYTHON_BIN" -m app.workers.research_worker

echo "Research local backend: http://localhost:${APP_PORT}"
