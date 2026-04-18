#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import requests


ROOT = Path(__file__).resolve().parents[1]


def _read_env_value(key: str, env_path: Path) -> str | None:
    if not env_path.exists():
        return None
    prefix = f"{key}="
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or not line.startswith(prefix):
            continue
        return line[len(prefix) :].strip()
    return None


def _default_gpt_model() -> str | None:
    return os.getenv("RESEARCH_GPT_MODEL") or _read_env_value("RESEARCH_GPT_MODEL", ROOT / ".env")


def _default_openclaw_model() -> str:
    agent = os.getenv("OPENCLAW_AGENT_ID") or _read_env_value("OPENCLAW_AGENT_ID", ROOT / ".env") or "main"
    if agent.startswith("openclaw:"):
        return agent
    return f"openclaw:{agent}"


def _slug_now() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


@dataclass
class ScenarioResult:
    scenario: str
    task_id: str
    ok: bool
    details: dict[str, Any]


class SmokeClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()

    def close(self) -> None:
        self.session.close()

    def request_json(
        self,
        method: str,
        path: str,
        *,
        json_body: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        timeout: int = 60,
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        response = self.session.request(method, url, json=json_body, params=params, timeout=timeout)
        text = response.text.strip()
        if response.status_code >= 400:
            detail = text[:800] if text else response.reason
            raise RuntimeError(f"{method} {path} -> HTTP {response.status_code}: {detail}")
        if not text:
            return {}
        try:
            return response.json()
        except ValueError as exc:
            raise RuntimeError(f"{method} {path} returned non-JSON body: {text[:400]}") from exc


def _print_step(message: str) -> None:
    print(f"[SMOKE] {message}", flush=True)


def _wait_for(
    description: str,
    fn,
    *,
    timeout: int,
    interval: float,
):
    deadline = time.time() + timeout
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            value = fn()
            if value:
                return value
            last_error = None
        except Exception as exc:  # noqa: BLE001 - surface last error on timeout
            last_error = exc
        time.sleep(interval)
    if last_error is not None:
        raise RuntimeError(f"timeout waiting for {description}; last error: {last_error}") from last_error
    raise RuntimeError(f"timeout waiting for {description}")


def _create_task(
    client: SmokeClient,
    *,
    topic_prefix: str,
    mode: str,
    llm_backend: str,
    llm_model: str | None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "topic": f"{topic_prefix} {_slug_now()}",
        "mode": mode,
        "llm_backend": llm_backend,
    }
    if llm_model:
        payload["llm_model"] = llm_model
    task = client.request_json("POST", "/api/v1/research/tasks", json_body=payload)
    _print_step(f"created task {task['task_id']} mode={mode}")
    return task


def _wait_for_planned_task(client: SmokeClient, task_id: str, *, timeout: int, interval: float) -> dict[str, Any]:
    def _poll():
        task = client.request_json("GET", f"/api/v1/research/tasks/{task_id}")
        if task.get("last_job_status") == "failed":
            raise RuntimeError(f"task planning failed: {task.get('last_failure_reason')}")
        if task.get("directions"):
            return task
        return None

    return _wait_for("planned directions", _poll, timeout=timeout, interval=interval)


def run_gpt_basic(
    client: SmokeClient,
    *,
    gpt_model: str | None,
    timeout: int,
    interval: float,
) -> ScenarioResult:
    task = _create_task(client, topic_prefix="GPT basic smoke", mode="gpt_step", llm_backend="gpt", llm_model=gpt_model)
    task_id = task["task_id"]
    planned = _wait_for_planned_task(client, task_id, timeout=timeout, interval=interval)
    directions = planned.get("directions") or []
    _print_step(f"{task_id} planned with {len(directions)} directions")

    canvas = client.request_json("GET", f"/api/v1/research/tasks/{task_id}/canvas")
    note_id = f"note:{task_id}:basic"
    topic_id = f"topic:{task_id}"
    nodes = list(canvas.get("nodes") or [])
    edges = list(canvas.get("edges") or [])
    nodes.append(
        {
            "id": note_id,
            "type": "note",
            "position": {"x": 300, "y": 160},
            "data": {"label": "Smoke Note", "note": "gpt basic live smoke"},
        }
    )
    edges.append(
        {
            "id": f"edge:{task_id}:basic",
            "source": topic_id,
            "target": note_id,
            "type": "manual",
            "data": {"label": "basic smoke"},
        }
    )
    saved_canvas = client.request_json(
        "PUT",
        f"/api/v1/research/tasks/{task_id}/canvas",
        json_body={
            "nodes": nodes,
            "edges": edges,
            "viewport": canvas.get("viewport") or {"x": 0, "y": 0, "zoom": 1},
        },
    )
    _print_step(f"{task_id} canvas updated with note node")

    chat = client.request_json(
        "POST",
        f"/api/v1/research/tasks/{task_id}/nodes/{topic_id}/chat",
        json_body={
            "question": "请用一句话说明这个调研主题第一步最值得关注的方向。",
            "tags": ["smoke", "gpt_basic"],
        },
        timeout=max(60, timeout),
    )
    history = chat.get("history") or []
    if not history:
        raise RuntimeError("node chat returned empty history")
    _print_step(f"{task_id} node chat history={len(history)}")

    return ScenarioResult(
        scenario="gpt_basic",
        task_id=task_id,
        ok=True,
        details={
            "directions": len(directions),
            "canvas_nodes": len(saved_canvas.get("nodes") or []),
            "canvas_edges": len(saved_canvas.get("edges") or []),
            "chat_history": len(history),
        },
    )


def run_gpt_explore(
    client: SmokeClient,
    *,
    gpt_model: str | None,
    timeout: int,
    interval: float,
    top_n: int,
    sources: list[str],
) -> ScenarioResult:
    task = _create_task(client, topic_prefix="GPT explore smoke", mode="gpt_step", llm_backend="gpt", llm_model=gpt_model)
    task_id = task["task_id"]
    planned = _wait_for_planned_task(client, task_id, timeout=timeout, interval=interval)
    directions = planned.get("directions") or []
    if not directions:
        raise RuntimeError("planned task returned no directions")

    start = client.request_json(
        "POST",
        f"/api/v1/research/tasks/{task_id}/explore/start",
        json_body={
            "direction_index": 1,
            "top_n": top_n,
            "sources": sources,
        },
    )
    round_id = int(start["round_id"])
    _print_step(f"{task_id} started exploration round={round_id}")

    def _round_ready():
        tree = client.request_json(
            "GET",
            f"/api/v1/research/tasks/{task_id}/explore/tree",
            params={"include_papers": True, "paper_limit": 10},
        )
        if any(node.get("id") == f"round:{round_id}" for node in tree.get("nodes") or []):
            return tree
        return None

    tree = _wait_for("first exploration round", _round_ready, timeout=timeout, interval=interval)
    _print_step(f"{task_id} first round visible in tree")

    propose = client.request_json(
        "POST",
        f"/api/v1/research/tasks/{task_id}/explore/rounds/{round_id}/propose",
        json_body={
            "action": "deepen",
            "feedback_text": "优先聚焦方法评估、可重复性和可靠性。",
            "candidate_count": 3,
        },
        timeout=max(60, timeout),
    )
    candidates = propose.get("candidates") or []
    if not candidates:
        raise RuntimeError("candidate generation returned no items")
    candidate_id = int(candidates[0]["candidate_id"])
    _print_step(f"{task_id} generated {len(candidates)} candidates")

    select = client.request_json(
        "POST",
        f"/api/v1/research/tasks/{task_id}/explore/rounds/{round_id}/select",
        json_body={"candidate_id": candidate_id, "top_n": top_n},
    )
    child_round_id = int(select["child_round_id"])
    _print_step(f"{task_id} selected candidate -> child_round={child_round_id}")

    def _child_round_ready():
        next_tree = client.request_json(
            "GET",
            f"/api/v1/research/tasks/{task_id}/explore/tree",
            params={"include_papers": True, "paper_limit": 10},
        )
        if any(node.get("id") == f"round:{child_round_id}" for node in next_tree.get("nodes") or []):
            return next_tree
        return None

    final_tree = _wait_for("child exploration round", _child_round_ready, timeout=timeout, interval=interval)
    graph = client.request_json(
        "GET",
        f"/api/v1/research/tasks/{task_id}/graph",
        params={"view": "tree", "include_papers": True, "paper_limit": 12},
    )

    return ScenarioResult(
        scenario="gpt_explore",
        task_id=task_id,
        ok=True,
        details={
            "directions": len(directions),
            "first_round_id": round_id,
            "child_round_id": child_round_id,
            "candidate_count": len(candidates),
            "tree_nodes": len(final_tree.get("nodes") or []),
            "tree_edges": len(final_tree.get("edges") or []),
            "graph_nodes": len(graph.get("nodes") or []),
            "graph_edges": len(graph.get("edges") or []),
            "graph_status": graph.get("status"),
        },
    )


def run_openclaw_auto(
    client: SmokeClient,
    *,
    openclaw_model: str,
    timeout: int,
    interval: float,
    guidance_text: str,
) -> ScenarioResult:
    task = _create_task(
        client,
        topic_prefix="OpenClaw auto smoke",
        mode="openclaw_auto",
        llm_backend="openclaw",
        llm_model=openclaw_model,
    )
    task_id = task["task_id"]
    started = client.request_json("POST", f"/api/v1/research/tasks/{task_id}/auto/start")
    run_id = started["run_id"]
    _print_step(f"{task_id} started auto run {run_id}")

    def _checkpoint_ready():
        events = client.request_json("GET", f"/api/v1/research/tasks/{task_id}/runs/{run_id}/events")
        items = events.get("items") or []
        checkpoint = next((item for item in items if item.get("event_type") == "checkpoint"), None)
        if checkpoint:
            task_state = client.request_json("GET", f"/api/v1/research/tasks/{task_id}")
            return {"events": items, "checkpoint": checkpoint, "task": task_state}
        return None

    checkpoint_state = _wait_for("openclaw checkpoint", _checkpoint_ready, timeout=timeout, interval=interval)
    if checkpoint_state["task"].get("auto_status") != "awaiting_guidance":
        raise RuntimeError(f"expected awaiting_guidance, got {checkpoint_state['task'].get('auto_status')}")
    _print_step(f"{task_id} checkpoint={checkpoint_state['checkpoint']['payload'].get('checkpoint_id')}")

    client.request_json(
        "POST",
        f"/api/v1/research/tasks/{task_id}/runs/{run_id}/guidance",
        json_body={"text": guidance_text, "tags": ["smoke", "openclaw_auto"]},
    )
    client.request_json("POST", f"/api/v1/research/tasks/{task_id}/runs/{run_id}/continue")
    _print_step(f"{task_id} submitted guidance and continued")

    def _completed():
        task_state = client.request_json("GET", f"/api/v1/research/tasks/{task_id}")
        status = task_state.get("auto_status")
        if status in {"failed", "canceled"}:
            raise RuntimeError(f"auto run ended with status={status} failure={task_state.get('last_failure_reason')}")
        if status == "completed":
            events = client.request_json("GET", f"/api/v1/research/tasks/{task_id}/runs/{run_id}/events")
            return {"task": task_state, "events": events.get("items") or []}
        return None

    completed = _wait_for("openclaw completion", _completed, timeout=timeout, interval=interval)
    final_events = completed["events"]
    event_types = {item.get("event_type") for item in final_events}
    if "report_chunk" not in event_types:
        raise RuntimeError("openclaw completion missing report_chunk event")
    artifact = next((item for item in final_events if item.get("event_type") == "artifact"), None)
    if artifact is None:
        raise RuntimeError("openclaw completion missing artifact event")
    artifact_path = ROOT / str(artifact["payload"]["path"])
    if not artifact_path.exists():
        raise RuntimeError(f"artifact file not found: {artifact_path}")

    return ScenarioResult(
        scenario="openclaw_auto",
        task_id=task_id,
        ok=True,
        details={
            "run_id": run_id,
            "auto_status": completed["task"].get("auto_status"),
            "last_checkpoint_id": completed["task"].get("last_checkpoint_id"),
            "event_types": sorted(x for x in event_types if x),
            "event_count": len(final_events),
            "artifact_path": str(artifact_path.relative_to(ROOT)),
        },
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run live smoke flows for research_local GPT and OpenClaw modes.")
    parser.add_argument(
        "--scenario",
        choices=["gpt_basic", "gpt_explore", "openclaw_auto", "all"],
        default="all",
        help="Which smoke scenario to run.",
    )
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="Backend base URL.")
    parser.add_argument("--iterations", type=int, default=1, help="Repeat the selected scenario(s) this many times.")
    parser.add_argument("--timeout", type=int, default=180, help="Per wait loop timeout in seconds.")
    parser.add_argument("--interval", type=float, default=2.0, help="Polling interval in seconds.")
    parser.add_argument("--top-n", type=int, default=5, help="Top-N used for GPT exploration smoke.")
    parser.add_argument("--sources", default="arxiv", help="Comma-separated sources used for GPT exploration smoke.")
    parser.add_argument("--gpt-model", default=_default_gpt_model(), help="GPT model to record on GPT tasks.")
    parser.add_argument("--openclaw-model", default=_default_openclaw_model(), help="OpenClaw model or agent reference.")
    parser.add_argument(
        "--guidance",
        default="请继续扩展图谱，并输出阶段性总结，优先说明下一步建议。",
        help="Guidance text for the OpenClaw auto scenario.",
    )
    parser.add_argument("--json-out", default="", help="Optional path to write the final JSON summary.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    sources = [item.strip() for item in args.sources.split(",") if item.strip()]
    scenarios = (
        ["gpt_basic", "gpt_explore", "openclaw_auto"]
        if args.scenario == "all"
        else [args.scenario]
    )
    summary: list[dict[str, Any]] = []
    client = SmokeClient(args.base_url)
    try:
        for index in range(1, max(1, args.iterations) + 1):
            _print_step(f"iteration {index}/{max(1, args.iterations)}")
            for scenario in scenarios:
                if scenario == "gpt_basic":
                    result = run_gpt_basic(client, gpt_model=args.gpt_model, timeout=args.timeout, interval=args.interval)
                elif scenario == "gpt_explore":
                    result = run_gpt_explore(
                        client,
                        gpt_model=args.gpt_model,
                        timeout=args.timeout,
                        interval=args.interval,
                        top_n=max(1, args.top_n),
                        sources=sources,
                    )
                else:
                    result = run_openclaw_auto(
                        client,
                        openclaw_model=args.openclaw_model,
                        timeout=max(args.timeout, 240),
                        interval=args.interval,
                        guidance_text=args.guidance,
                    )
                payload = {
                    "iteration": index,
                    "scenario": result.scenario,
                    "task_id": result.task_id,
                    "ok": result.ok,
                    "details": result.details,
                }
                summary.append(payload)
                _print_step(f"{result.scenario} PASS task={result.task_id}")
    finally:
        client.close()

    output = {
        "base_url": args.base_url.rstrip("/"),
        "scenarios": scenarios,
        "iterations": max(1, args.iterations),
        "results": summary,
        "generated_at": datetime.now().isoformat(),
    }
    text = json.dumps(output, ensure_ascii=False, indent=2)
    print(text)
    if args.json_out:
        out_path = Path(args.json_out)
        if not out_path.is_absolute():
            out_path = ROOT / out_path
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
