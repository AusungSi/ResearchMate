from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.browser_paper_fetcher import BrowserPaperFetcher


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Initialize a persistent Semantic Scholar browser session in WSL.")
    parser.add_argument(
        "--semantic-profile-dir",
        default="tmp/semantic-scholar-profile",
        help="Persistent profile directory to reuse for Semantic Scholar.",
    )
    parser.add_argument("--browser-path", default="", help="Optional browser executable path.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    fetcher = BrowserPaperFetcher(
        browser_path=args.browser_path or None,
        semantic_scholar_profile_dir=args.semantic_profile_dir or None,
        headless=False,
    )
    fetcher.init_semantic_scholar_session()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
