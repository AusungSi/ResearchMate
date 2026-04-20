#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the Embodied AI static demo seed and/or the live showcase flows."
    )
    parser.add_argument(
        "--mode",
        choices=["static", "live", "all"],
        default="all",
        help="Which showcase mode to run.",
    )
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="Backend base URL used by live flows.")
    parser.add_argument(
        "--live-scenarios",
        default="gpt_basic,gpt_explore,openclaw_auto",
        help="Comma-separated live scenarios passed to research_live_smoke.",
    )
    parser.add_argument("--timeout", type=int, default=240, help="Per scenario timeout for live flows.")
    parser.add_argument("--interval", type=float, default=2.0, help="Polling interval for live flows.")
    parser.add_argument("--top-n", type=int, default=5, help="Top-N used by the GPT explore live flow.")
    parser.add_argument("--sources", default="arxiv", help="Discovery sources used by the GPT explore live flow.")
    parser.add_argument("--gpt-model", default="", help="Optional GPT model override.")
    parser.add_argument("--openclaw-model", default="", help="Optional OpenClaw model override.")
    parser.add_argument("--guidance", default="", help="Optional guidance override for OpenClaw live flow.")
    parser.add_argument("--json-out", default="", help="Optional path to write the combined JSON summary.")
    return parser.parse_args()


def _run_python(script_name: str, *args: str) -> subprocess.CompletedProcess[str]:
    command = [sys.executable, str(ROOT / "scripts" / script_name), *args]
    return subprocess.run(
        command,
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _static_notes() -> list[dict[str, str]]:
    return [
        {
            "step": "打开工作台",
            "expected": "左侧可以看到 demo-embodied-ai 项目，以及 GPT Step 和 OpenClaw Auto 两个已完成任务。",
        },
        {
            "step": "切到 GPT Step 任务",
            "expected": "中间画布展示具身智能方向、论文节点、compare 报告节点和演示 note 节点。",
        },
        {
            "step": "点击论文节点",
            "expected": "右侧可以看到论文详情、PDF/fulltext 资产状态和导出记录。",
        },
        {
            "step": "切到 OpenClaw Auto 任务",
            "expected": "右侧时间线能看到 checkpoint、guidance 历史、阶段报告摘要和 artifact。",
        },
        {
            "step": "打开 collection",
            "expected": "能展示来自两个任务的核心论文集合，适合演示 compare 和 study task 派生。",
        },
    ]


def _live_notes() -> list[dict[str, str]]:
    return [
        {
            "step": "先跑 gpt_basic",
            "expected": "创建任务、方向规划、节点问答和画布写回都能成功。",
        },
        {
            "step": "再跑 gpt_explore",
            "expected": "能看到探索轮次、候选方向生成、候选选择和树图增长。",
        },
        {
            "step": "最后跑 openclaw_auto",
            "expected": "能看到自动研究进入 checkpoint，提交 guidance 后继续，并产出 report/artifact。",
        },
    ]


def run_static_demo() -> dict:
    output_path = ROOT / "artifacts" / "demo" / "embodied-static-demo.json"
    proc = _run_python("seed_embodied_demo.py", "--json-out", str(output_path))
    if proc.returncode != 0:
        raise RuntimeError(
            "static demo seed failed\n"
            f"stdout:\n{proc.stdout}\n"
            f"stderr:\n{proc.stderr}"
        )
    return {
        "summary": _load_json(output_path),
        "json_path": str(output_path.relative_to(ROOT)),
        "notes": _static_notes(),
    }


def run_live_demo(args: argparse.Namespace) -> dict:
    live_scenarios = [item.strip() for item in args.live_scenarios.split(",") if item.strip()]
    results: list[dict] = []
    for scenario in live_scenarios:
        output_path = ROOT / "artifacts" / "demo" / f"live-{scenario}.json"
        cmd_args = [
            "--scenario",
            scenario,
            "--base-url",
            args.base_url,
            "--timeout",
            str(args.timeout),
            "--interval",
            str(args.interval),
            "--top-n",
            str(args.top_n),
            "--sources",
            args.sources,
            "--json-out",
            str(output_path),
        ]
        if args.gpt_model:
            cmd_args.extend(["--gpt-model", args.gpt_model])
        if args.openclaw_model:
            cmd_args.extend(["--openclaw-model", args.openclaw_model])
        if args.guidance:
            cmd_args.extend(["--guidance", args.guidance])
        proc = _run_python("research_live_smoke.py", *cmd_args)
        if proc.returncode != 0:
            raise RuntimeError(
                f"live showcase failed for scenario={scenario}\n"
                f"stdout:\n{proc.stdout}\n"
                f"stderr:\n{proc.stderr}"
            )
        results.append(
            {
                "scenario": scenario,
                "summary": _load_json(output_path),
                "json_path": str(output_path.relative_to(ROOT)),
            }
        )
    return {
        "scenarios": live_scenarios,
        "results": results,
        "notes": _live_notes(),
    }


def main() -> int:
    args = parse_args()
    payload: dict[str, object] = {
        "generated_at": datetime.now().isoformat(),
        "mode": args.mode,
        "theme": "具身智能 / Embodied AI",
    }
    if args.mode in {"static", "all"}:
        payload["static_demo"] = run_static_demo()
    if args.mode in {"live", "all"}:
        payload["live_demo"] = run_live_demo(args)

    text = json.dumps(payload, ensure_ascii=False, indent=2)
    print(text)

    if args.json_out:
        output_path = Path(args.json_out)
        if not output_path.is_absolute():
            output_path = ROOT / output_path
        _write_json(output_path, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
