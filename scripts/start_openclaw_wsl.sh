#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p .runtime

OPENCLAW_BIN="${OPENCLAW_BIN:-$HOME/.openclaw/bin/openclaw}"
PID_FILE=".runtime/openclaw.pid"
LOG_FILE=".runtime/openclaw.log"

read_env_value() {
  local key="$1"
  local file="${2:-.env}"
  if [[ ! -f "$file" ]]; then
    return 1
  fi
  local line
  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  [[ -n "$line" ]] || return 1
  line="${line#*=}"
  line="${line%$'\r'}"
  printf '%s' "$line"
}

OPENCLAW_BASE_URL="${OPENCLAW_BASE_URL:-$(read_env_value OPENCLAW_BASE_URL .env || true)}"
OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-$(read_env_value OPENCLAW_GATEWAY_TOKEN .env || true)}"
OPENCLAW_PORT="${OPENCLAW_PORT:-$(printf '%s' "${OPENCLAW_BASE_URL:-http://127.0.0.1:18789}" | sed -E 's#.*:([0-9]+)/?$#\1#')}"

if [[ ! -x "$OPENCLAW_BIN" ]]; then
  echo "OpenClaw CLI not found: $OPENCLAW_BIN" >&2
  exit 1
fi

if [[ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]]; then
  echo "OPENCLAW_GATEWAY_TOKEN is empty. Fill it in .env first." >&2
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
  printf '%s' "$cmdline" | grep -E -q "$pattern"
}

PATTERN="openclaw-gateway|openclaw gateway run"

if [[ -f "$PID_FILE" ]]; then
  existing_pid="$(cat "$PID_FILE")"
  if pid_matches_pattern "$existing_pid" "$PATTERN"; then
    echo "openclaw gateway already running pid=$existing_pid"
    echo "OpenClaw gateway: http://127.0.0.1:${OPENCLAW_PORT}"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

existing_pid="$(pgrep -f "$PATTERN" | head -n 1 || true)"
if pid_matches_pattern "$existing_pid" "$PATTERN"; then
  echo "$existing_pid" >"$PID_FILE"
  echo "openclaw gateway already running pid=$existing_pid"
  echo "OpenClaw gateway: http://127.0.0.1:${OPENCLAW_PORT}"
  exit 0
fi

: >"$LOG_FILE"
setsid "$OPENCLAW_BIN" gateway run \
  --bind loopback \
  --port "$OPENCLAW_PORT" \
  --auth token \
  --token "$OPENCLAW_GATEWAY_TOKEN" \
  --compact \
  >"$LOG_FILE" 2>&1 < /dev/null &

pid="$!"
sleep 3

if pid_matches_pattern "$pid" "$PATTERN"; then
  echo "$pid" >"$PID_FILE"
  echo "openclaw gateway started pid=$pid log=$LOG_FILE"
  echo "OpenClaw gateway: http://127.0.0.1:${OPENCLAW_PORT}"
  exit 0
fi

existing_pid="$(pgrep -f "$PATTERN" | head -n 1 || true)"
if pid_matches_pattern "$existing_pid" "$PATTERN"; then
  echo "$existing_pid" >"$PID_FILE"
  echo "openclaw gateway started pid=$existing_pid log=$LOG_FILE"
  echo "OpenClaw gateway: http://127.0.0.1:${OPENCLAW_PORT}"
  exit 0
fi

if ss -ltn 2>/dev/null | grep -q ":${OPENCLAW_PORT} "; then
  existing_pid="$(pgrep -f "openclaw-gateway" | head -n 1 || true)"
  if [[ -n "$existing_pid" ]]; then
    echo "$existing_pid" >"$PID_FILE"
    echo "openclaw gateway started pid=$existing_pid log=$LOG_FILE"
    echo "OpenClaw gateway: http://127.0.0.1:${OPENCLAW_PORT}"
    exit 0
  fi
fi

rm -f "$PID_FILE"
echo "openclaw gateway failed to start. Recent log output:" >&2
tail -n 60 "$LOG_FILE" >&2 || true
exit 1
