#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

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


def _slug_now() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S-%f")


@dataclass
class CallResult:
    ok: bool
    name: str
    method: str
    path: str
    status_code: int | None
    latency_ms: int | None
    detail: str = ""
    skipped: bool = False


class ApiClient:
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
        timeout: int = 30,
    ) -> tuple[dict[str, Any], int, int]:
        url = f"{self.base_url}{path}"
        started = time.perf_counter()
        response = self.session.request(method, url, json=json_body, params=params, timeout=timeout)
        latency_ms = int((time.perf_counter() - started) * 1000)
        text = response.text.strip()
        if response.status_code >= 400:
            detail = text[:800] if text else response.reason
            raise RuntimeError(f"{method} {path} -> HTTP {response.status_code}: {detail}")
        if not text:
            return {}, response.status_code, latency_ms
        try:
            return response.json(), response.status_code, latency_ms
        except ValueError as exc:
            raise RuntimeError(f"{method} {path} returned non-JSON body: {text[:400]}") from exc


def _run_step(
    results: list[CallResult],
    *,
    name: str,
    method: str,
    path: str,
    fn: Callable[[], tuple[dict[str, Any], int, int]],
    required_keys: list[str] | None = None,
) -> dict[str, Any] | None:
    try:
        body, status_code, latency_ms = fn()
        missing_keys = [key for key in (required_keys or []) if key not in body]
        if missing_keys:
            raise RuntimeError(f"missing keys: {', '.join(missing_keys)}")
        results.append(
            CallResult(
                ok=True,
                name=name,
                method=method,
                path=path,
                status_code=status_code,
                latency_ms=latency_ms,
            )
        )
        return body
    except Exception as exc:  # noqa: BLE001 - aggregate failures into the report
        results.append(
            CallResult(
                ok=False,
                name=name,
                method=method,
                path=path,
                status_code=None,
                latency_ms=None,
                detail=str(exc),
            )
        )
        return None


def _skip_step(results: list[CallResult], *, name: str, method: str, path: str, detail: str) -> None:
    results.append(
        CallResult(
            ok=False,
            skipped=True,
            name=name,
            method=method,
            path=path,
            status_code=None,
            latency_ms=None,
            detail=detail,
        )
    )


def run_iteration(client: ApiClient, *, timeout: int, gpt_model: str | None) -> dict[str, Any]:
    iteration_id = _slug_now()
    results: list[CallResult] = []

    health = _run_step(
        results,
        name="health",
        method="GET",
        path="/api/v1/health",
        fn=lambda: client.request_json("GET", "/api/v1/health", timeout=timeout),
        required_keys=["db_ok"],
    )
    config = _run_step(
        results,
        name="workbench_config",
        method="GET",
        path="/api/v1/research/workbench/config",
        fn=lambda: client.request_json("GET", "/api/v1/research/workbench/config", timeout=timeout),
        required_keys=["default_mode", "available_backends"],
    )
    projects = _run_step(
        results,
        name="list_projects",
        method="GET",
        path="/api/v1/research/projects",
        fn=lambda: client.request_json("GET", "/api/v1/research/projects", timeout=timeout),
        required_keys=["default_project_id", "items"],
    )

    default_project_id = (projects or {}).get("default_project_id")
    project_payload = {"name": f"API Connectivity {iteration_id}", "description": "direct command api check"}
    created_project = _run_step(
        results,
        name="create_project",
        method="POST",
        path="/api/v1/research/projects",
        fn=lambda: client.request_json("POST", "/api/v1/research/projects", json_body=project_payload, timeout=timeout),
        required_keys=["project_id", "name"],
    )
    created_project_id = (created_project or {}).get("project_id")
    active_project_id = created_project_id or default_project_id

    if created_project_id:
        _run_step(
            results,
            name="get_project",
            method="GET",
            path=f"/api/v1/research/projects/{created_project_id}",
            fn=lambda: client.request_json("GET", f"/api/v1/research/projects/{created_project_id}", timeout=timeout),
            required_keys=["project_id", "name"],
        )
        _run_step(
            results,
            name="list_project_collections",
            method="GET",
            path=f"/api/v1/research/projects/{created_project_id}/collections",
            fn=lambda: client.request_json(
                "GET",
                f"/api/v1/research/projects/{created_project_id}/collections",
                timeout=timeout,
            ),
            required_keys=["items", "total"],
        )
        created_collection = _run_step(
            results,
            name="create_collection",
            method="POST",
            path=f"/api/v1/research/projects/{created_project_id}/collections",
            fn=lambda: client.request_json(
                "POST",
                f"/api/v1/research/projects/{created_project_id}/collections",
                json_body={"name": f"Connectivity Collection {iteration_id}", "description": "api connectivity check"},
                timeout=timeout,
            ),
            required_keys=["collection_id", "project_id"],
        )
        created_collection_id = (created_collection or {}).get("collection_id")
        if created_collection_id:
            _run_step(
                results,
                name="get_collection",
                method="GET",
                path=f"/api/v1/research/collections/{created_collection_id}",
                fn=lambda: client.request_json(
                    "GET",
                    f"/api/v1/research/collections/{created_collection_id}",
                    timeout=timeout,
                ),
                required_keys=["collection_id", "items"],
            )
        else:
            _skip_step(
                results,
                name="get_collection",
                method="GET",
                path="/api/v1/research/collections/{collection_id}",
                detail="skipped because collection creation failed",
            )
    else:
        _skip_step(
            results,
            name="get_project",
            method="GET",
            path="/api/v1/research/projects/{project_id}",
            detail="skipped because project creation failed",
        )
        _skip_step(
            results,
            name="list_project_collections",
            method="GET",
            path="/api/v1/research/projects/{project_id}/collections",
            detail="skipped because project creation failed",
        )
        _skip_step(
            results,
            name="create_collection",
            method="POST",
            path="/api/v1/research/projects/{project_id}/collections",
            detail="skipped because project creation failed",
        )
        _skip_step(
            results,
            name="get_collection",
            method="GET",
            path="/api/v1/research/collections/{collection_id}",
            detail="skipped because collection creation was skipped",
        )

    _run_step(
        results,
        name="list_tasks",
        method="GET",
        path="/api/v1/research/tasks",
        fn=lambda: client.request_json(
            "GET",
            "/api/v1/research/tasks",
            params={"project_id": active_project_id} if active_project_id else None,
            timeout=timeout,
        ),
        required_keys=["items", "total"],
    )

    created_task: dict[str, Any] | None = None
    if active_project_id:
        task_payload: dict[str, Any] = {
            "topic": f"API connectivity task {iteration_id}",
            "mode": "gpt_step",
            "llm_backend": "gpt",
            "project_id": active_project_id,
        }
        if gpt_model:
            task_payload["llm_model"] = gpt_model
        created_task = _run_step(
            results,
            name="create_task",
            method="POST",
            path="/api/v1/research/tasks",
            fn=lambda: client.request_json("POST", "/api/v1/research/tasks", json_body=task_payload, timeout=timeout),
            required_keys=["task_id", "latest_run_id", "project_id"],
        )
    else:
        _skip_step(
            results,
            name="create_task",
            method="POST",
            path="/api/v1/research/tasks",
            detail="skipped because no usable project id was available",
        )

    task_id = (created_task or {}).get("task_id")
    latest_run_id = (created_task or {}).get("latest_run_id")
    if task_id:
        _run_step(
            results,
            name="get_task",
            method="GET",
            path=f"/api/v1/research/tasks/{task_id}",
            fn=lambda: client.request_json("GET", f"/api/v1/research/tasks/{task_id}", timeout=timeout),
            required_keys=["task_id", "mode"],
        )
        canvas = _run_step(
            results,
            name="get_canvas",
            method="GET",
            path=f"/api/v1/research/tasks/{task_id}/canvas",
            fn=lambda: client.request_json("GET", f"/api/v1/research/tasks/{task_id}/canvas", timeout=timeout),
            required_keys=["task_id", "nodes", "edges", "viewport", "ui"],
        )
        if canvas:
            note_id = f"note:{task_id}:api-check"
            _run_step(
                results,
                name="put_canvas",
                method="PUT",
                path=f"/api/v1/research/tasks/{task_id}/canvas",
                fn=lambda: client.request_json(
                    "PUT",
                    f"/api/v1/research/tasks/{task_id}/canvas",
                    json_body={
                        "nodes": list(canvas.get("nodes") or [])
                        + [
                            {
                                "id": note_id,
                                "type": "note",
                                "position": {"x": 280, "y": 120},
                                "data": {
                                    "label": "API Check",
                                    "note": "saved by api connectivity check",
                                },
                            }
                        ],
                        "edges": list(canvas.get("edges") or []),
                        "viewport": canvas.get("viewport") or {"x": 0, "y": 0, "zoom": 1},
                        "ui": canvas.get("ui") or {},
                    },
                    timeout=timeout,
                ),
                required_keys=["task_id", "nodes", "edges"],
            )
        else:
            _skip_step(
                results,
                name="put_canvas",
                method="PUT",
                path=f"/api/v1/research/tasks/{task_id}/canvas",
                detail="skipped because canvas read failed",
            )

        if latest_run_id:
            _run_step(
                results,
                name="get_run_events",
                method="GET",
                path=f"/api/v1/research/tasks/{task_id}/runs/{latest_run_id}/events",
                fn=lambda: client.request_json(
                    "GET",
                    f"/api/v1/research/tasks/{task_id}/runs/{latest_run_id}/events",
                    timeout=timeout,
                ),
                required_keys=["items", "summary"],
            )
        else:
            _skip_step(
                results,
                name="get_run_events",
                method="GET",
                path="/api/v1/research/tasks/{task_id}/runs/{run_id}/events",
                detail="skipped because latest_run_id was missing",
            )
    else:
        _skip_step(
            results,
            name="get_task",
            method="GET",
            path="/api/v1/research/tasks/{task_id}",
            detail="skipped because task creation failed",
        )
        _skip_step(
            results,
            name="get_canvas",
            method="GET",
            path="/api/v1/research/tasks/{task_id}/canvas",
            detail="skipped because task creation failed",
        )
        _skip_step(
            results,
            name="put_canvas",
            method="PUT",
            path="/api/v1/research/tasks/{task_id}/canvas",
            detail="skipped because task creation failed",
        )
        _skip_step(
            results,
            name="get_run_events",
            method="GET",
            path="/api/v1/research/tasks/{task_id}/runs/{run_id}/events",
            detail="skipped because task creation failed",
        )

    _run_step(
        results,
        name="get_zotero_config",
        method="GET",
        path="/api/v1/research/integrations/zotero/config",
        fn=lambda: client.request_json("GET", "/api/v1/research/integrations/zotero/config", timeout=timeout),
        required_keys=["enabled", "has_api_key"],
    )

    attempted = [item for item in results if not item.skipped]
    successes = [item for item in attempted if item.ok]
    failures = [item for item in attempted if not item.ok]
    success_rate = round((len(successes) / len(attempted) * 100.0), 2) if attempted else 0.0

    return {
        "iteration_id": iteration_id,
        "success_rate": success_rate,
        "attempted": len(attempted),
        "passed": len(successes),
        "failed": len(failures),
        "skipped": len(results) - len(attempted),
        "health_db_ok": (health or {}).get("db_ok"),
        "default_mode": (config or {}).get("default_mode"),
        "default_project_id": default_project_id,
        "created_project_id": created_project_id,
        "created_task_id": task_id,
        "results": [item.__dict__ for item in results],
    }


def build_summary(base_url: str, iterations: list[dict[str, Any]]) -> dict[str, Any]:
    operation_stats: dict[str, dict[str, Any]] = {}
    total_attempted = 0
    total_passed = 0
    total_failed = 0
    total_skipped = 0

    for iteration in iterations:
        total_attempted += iteration["attempted"]
        total_passed += iteration["passed"]
        total_failed += iteration["failed"]
        total_skipped += iteration["skipped"]
        for item in iteration["results"]:
            stats = operation_stats.setdefault(
                item["name"],
                {
                    "name": item["name"],
                    "attempted": 0,
                    "passed": 0,
                    "failed": 0,
                    "skipped": 0,
                    "latency_ms": [],
                },
            )
            if item["skipped"]:
                stats["skipped"] += 1
                continue
            stats["attempted"] += 1
            if item["ok"]:
                stats["passed"] += 1
            else:
                stats["failed"] += 1
            if item["latency_ms"] is not None:
                stats["latency_ms"].append(item["latency_ms"])

    per_operation = []
    for name in sorted(operation_stats):
        stats = operation_stats[name]
        latencies = stats.pop("latency_ms")
        success_rate = round((stats["passed"] / stats["attempted"] * 100.0), 2) if stats["attempted"] else 0.0
        average_latency_ms = round(sum(latencies) / len(latencies), 2) if latencies else None
        per_operation.append(
            {
                **stats,
                "success_rate": success_rate,
                "average_latency_ms": average_latency_ms,
            }
        )

    overall_success_rate = round((total_passed / total_attempted * 100.0), 2) if total_attempted else 0.0
    return {
        "base_url": base_url,
        "generated_at": datetime.now().isoformat(),
        "iterations": iterations,
        "summary": {
            "attempted": total_attempted,
            "passed": total_passed,
            "failed": total_failed,
            "skipped": total_skipped,
            "overall_success_rate": overall_success_rate,
            "per_operation": per_operation,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run direct command API connectivity checks against the research-local backend.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="backend base url")
    parser.add_argument("--iterations", type=int, default=5, help="how many rounds to run")
    parser.add_argument("--timeout", type=int, default=30, help="per-request timeout in seconds")
    parser.add_argument("--gpt-model", default=_default_gpt_model(), help="GPT model used when creating a task")
    parser.add_argument("--json-out", default="", help="optional path to write the JSON report")
    args = parser.parse_args()

    client = ApiClient(args.base_url)
    try:
        iteration_results = []
        for index in range(1, args.iterations + 1):
            print(f"[API-CHECK] iteration {index}/{args.iterations}", flush=True)
            result = run_iteration(client, timeout=args.timeout, gpt_model=args.gpt_model)
            iteration_results.append(result)
            print(
                f"[API-CHECK] success_rate={result['success_rate']}% passed={result['passed']} failed={result['failed']} skipped={result['skipped']}",
                flush=True,
            )
        report = build_summary(args.base_url, iteration_results)
        text = json.dumps(report, ensure_ascii=False, indent=2)
        print(text)
        if args.json_out:
            output_path = Path(args.json_out)
            if not output_path.is_absolute():
                output_path = ROOT / output_path
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(text + "\n", encoding="utf-8")
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
