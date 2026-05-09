from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.services.browser_paper_fetcher import BrowserPaperFetcher, resolve_browser_paper_sources, save_browser_paper_fetch_report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch paper candidates by simulating browser access with Playwright.")
    parser.add_argument("--query", default="", help="Search query, for example: diffusion policy for robotics")
    parser.add_argument("--top-n", type=int, default=10, help="Maximum number of merged papers to keep in the final output.")
    parser.add_argument(
        "--sources",
        default="arxiv,semantic_scholar,openalex",
        help="Comma-separated sources. Supported: arxiv, semantic_scholar, openalex",
    )
    parser.add_argument("--output", default="", help="Optional JSON output path.")
    parser.add_argument("--browser-path", default="", help="Optional browser executable path.")
    parser.add_argument("--remote-debug-url", default="", help="Optional remote CDP endpoint, for example http://127.0.0.1:9222")
    parser.add_argument(
        "--semantic-profile-dir",
        default="",
        help="Optional persistent profile directory for Semantic Scholar session reuse.",
    )
    parser.add_argument(
        "--init-semantic-session",
        action="store_true",
        help="Open a headed persistent Semantic Scholar browser session for manual cookie/login verification.",
    )
    parser.add_argument("--headed", action="store_true", help="Launch the browser in headed mode.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.init_semantic_session and not str(args.query or "").strip():
        raise SystemExit("--query is required unless --init-semantic-session is used")
    sources = resolve_browser_paper_sources([item.strip() for item in str(args.sources or "").split(",") if item.strip()])
    fetcher = BrowserPaperFetcher(
        browser_path=args.browser_path or None,
        remote_debug_url=args.remote_debug_url or None,
        semantic_scholar_profile_dir=args.semantic_profile_dir or None,
        headless=not args.headed,
    )
    if args.init_semantic_session:
        fetcher.init_semantic_scholar_session()
        return 0
    report = fetcher.fetch(query=args.query, top_n=max(1, args.top_n), sources=sources)
    if args.output:
        output_path = save_browser_paper_fetch_report(report, Path(args.output))
        print(f"saved {len(report['items'])} items to {output_path}")
    else:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
