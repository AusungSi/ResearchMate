#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.config import get_settings
from app.demo.embodied_ai_seed import seed_embodied_ai_demo
from app.infra.db import init_db, session_scope
from app.infra.repos import UserRepo
from app.services.research_service import ResearchService


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed a static Embodied AI demo workspace into the local research database.")
    parser.add_argument("--json-out", default="", help="Optional path to write the JSON summary.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    settings = get_settings()
    init_db()

    with session_scope() as db:
        user = UserRepo(db).get_or_create(
            settings.research_local_user_id,
            timezone_name=settings.default_timezone,
            locale=settings.research_local_user_locale,
        )
        service = ResearchService()
        summary = seed_embodied_ai_demo(db, user_id=int(user.id), service=service, root_dir=ROOT)

    payload = {
        **summary,
        "frontend_url": "http://127.0.0.1:5173",
        "backend_url": "http://127.0.0.1:8000",
        "generated_at": __import__("datetime").datetime.now().isoformat(),
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    print(text)

    if args.json_out:
        out_path = Path(args.json_out)
        if not out_path.is_absolute():
            out_path = ROOT / out_path
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(text, encoding="utf-8")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
