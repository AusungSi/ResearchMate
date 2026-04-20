#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-$ROOT_DIR/.venv-wsl/bin/python}"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "python not found: $PYTHON_BIN" >&2
  echo "please create the WSL environment first: .venv-wsl/bin/python -m pip install -r requirements-research-local.txt" >&2
  exit 1
fi

cd "$ROOT_DIR"
"$PYTHON_BIN" scripts/demo_showcase.py "$@"
