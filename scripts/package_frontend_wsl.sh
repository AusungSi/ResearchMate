#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
RELEASE_DIR="$ROOT_DIR/artifacts/releases"
STAGE_DIR="$ROOT_DIR/.runtime/frontend-package"

bash "$ROOT_DIR/scripts/build_frontend_wsl.sh"

mkdir -p "$RELEASE_DIR" "$STAGE_DIR"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

PACKAGE_VERSION="$(
  python3 - <<'PY'
import json
from pathlib import Path
data = json.loads(Path("frontend/package.json").read_text(encoding="utf-8"))
print(data.get("version", "0.0.0"))
PY
)"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT_FILE="$RELEASE_DIR/research-workbench-v${PACKAGE_VERSION}-${TIMESTAMP}.tar.gz"

cp -R "$FRONTEND_DIR/dist" "$STAGE_DIR/dist"
cp "$FRONTEND_DIR/nginx.conf" "$STAGE_DIR/nginx.conf"
cp "$FRONTEND_DIR/package.json" "$STAGE_DIR/package.json"
cp "$ROOT_DIR/docs/RESEARCH_LOCAL_QUICKSTART.md" "$STAGE_DIR/RESEARCH_LOCAL_QUICKSTART.md"

tar -czf "$OUTPUT_FILE" -C "$STAGE_DIR" .

echo "Frontend package created: $OUTPUT_FILE"
