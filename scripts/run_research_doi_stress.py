from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.research_service import ResearchService, _resolve_sources


def _norm_doi(value: object) -> str | None:
    text = str(value or "").strip().lower()
    if not text:
        return None
    text = re.sub(r"^https?://(dx\.)?doi\.org/", "", text)
    text = text.replace("doi:", "").strip()
    return text or None


def _truth_kind(doi: str | None, venue: str | None, source: str | None) -> str:
    doi_norm = _norm_doi(doi) or ""
    venue_norm = str(venue or "").strip().lower()
    source_norm = str(source or "").strip().lower()
    if doi_norm.startswith("10.48550/arxiv") or venue_norm in {"arxiv", "corr"} or "arxiv" in venue_norm or source_norm == "arxiv":
        return "preprint"
    return "formal"


def _topic_batches() -> list[tuple[str, str]]:
    return [
        ("graph-neural-networks", "graph neural network"),
        ("object-detection", "deformable detr"),
        ("llm-instruction", "instruction tuning large language model"),
        ("3d-vision", "3d gaussian splatting"),
        ("rlhf", "reinforcement learning from human feedback"),
    ]


def _evenly_spaced_audit_items(items: list[dict], count: int) -> list[dict]:
    with_doi = [item for item in items if _norm_doi(item.get("doi"))]
    if len(with_doi) <= count:
        return with_doi
    step = max(1, len(with_doi) // count)
    selected = [with_doi[idx] for idx in range(0, len(with_doi), step)]
    return selected[:count]


def _run_search_batch(service: ResearchService, *, topic: str, count: int) -> dict:
    allowed_sources = _resolve_sources(None, service.settings.research_sources_default)
    ordered_sources = service._ordered_search_sources(allowed_sources)
    all_papers: list[dict] = []
    source_runs: list[dict] = []
    for source in ordered_sources:
        started = perf_counter()
        result = service._search_by_source(
            source=source,
            query=topic,
            top_n=count,
            constraints={"year_from": 2019},
            allow_semantic_fallback=("arxiv" not in allowed_sources),
        )
        elapsed = (perf_counter() - started) * 1000.0
        all_papers.extend(result.papers)
        source_runs.append(
            {
                "source": source,
                "status": result.status,
                "paper_count": len(result.papers),
                "elapsed_ms": round(elapsed, 2),
                "error": result.error,
            }
        )
        if service._should_stop_search_fanout(all_papers, top_n=count):
            break
    deduped = service._dedupe_papers(all_papers)
    if service.settings.research_search_quality_rerank_enabled:
        deduped = service._rank_discovered_papers(deduped, top_n=count, constraints={"sources": list(allowed_sources)})
    return {
        "items": deduped[:count],
        "source_runs": source_runs,
    }


def _audit_doi_resolution(service: ResearchService, items: list[dict], *, audit_count: int) -> dict:
    audit_items = _evenly_spaced_audit_items(items, audit_count)
    exact = 0
    useful = 0
    source_mix = Counter()
    latencies: list[float] = []
    failures: list[dict] = []
    for item in audit_items:
        probe = type("Paper", (), {})()
        probe.title = str(item.get("title") or "").strip()
        probe.authors_json = json.dumps(item.get("authors") or [], ensure_ascii=False)
        probe.year = item.get("year")
        probe.doi = None
        probe.url = item.get("url")
        started = perf_counter()
        best = service._resolve_best_doi_for_paper(probe)
        elapsed = (perf_counter() - started) * 1000.0
        latencies.append(elapsed)
        predicted = _norm_doi(best.get("doi")) if best else None
        predicted_source = str(best.get("source") or "") if best else ""
        truth = _norm_doi(item.get("doi"))
        if predicted:
            useful += 1
            source_mix[predicted_source or "unknown"] += 1
        if predicted == truth:
            exact += 1
        else:
            failures.append(
                {
                    "title": item.get("title"),
                    "year": item.get("year"),
                    "truth_doi": truth,
                    "predicted_doi": predicted,
                    "predicted_source": predicted_source or None,
                    "truth_kind": _truth_kind(truth, item.get("venue"), item.get("source")),
                    "venue": item.get("venue"),
                }
            )
    latencies_sorted = sorted(latencies)
    p50 = latencies_sorted[len(latencies_sorted) // 2] if latencies_sorted else 0.0
    p95 = latencies_sorted[min(len(latencies_sorted) - 1, int(len(latencies_sorted) * 0.95))] if latencies_sorted else 0.0
    return {
        "sample_size": len(audit_items),
        "resolved": useful,
        "exact_match": exact,
        "resolved_rate": round(useful / max(1, len(audit_items)), 4),
        "exact_match_rate": round(exact / max(1, len(audit_items)), 4),
        "avg_item_latency_ms": round(sum(latencies) / max(1, len(latencies)), 2),
        "p50_item_latency_ms": round(p50, 2),
        "p95_item_latency_ms": round(p95, 2),
        "source_mix": dict(source_mix),
        "failures": failures[:6],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run retrieval + DOI audit stress tests")
    parser.add_argument("--count", type=int, default=50, help="Retrieved papers per run")
    parser.add_argument("--audit-count", type=int, default=10, help="DOI audit sample size per run")
    parser.add_argument("--timeout", type=int, default=60, help="Per-request timeout seconds")
    parser.add_argument("--json-out", type=str, default="")
    args = parser.parse_args()

    service = ResearchService(wecom_client=None)
    service.settings.research_search_request_timeout_seconds = max(10, int(args.timeout))
    service.settings.research_search_openalex_default_enabled = True
    service.settings.research_sources_default = "dblp,openalex,arxiv,semantic_scholar"
    service.settings.research_doi_resolution_sources_default = "dblp,openalex,arxiv,crossref"

    batches: list[dict] = []
    started_at = datetime.now(timezone.utc)
    for batch_id, (slug, topic) in enumerate(_topic_batches(), start=1):
        batch_started = perf_counter()
        search_payload = _run_search_batch(service, topic=topic, count=args.count)
        search_elapsed_ms = (perf_counter() - batch_started) * 1000.0
        items = search_payload["items"]
        retrieval_source_mix = Counter(str(item.get("source") or "unknown") for item in items)
        doi_coverage = sum(1 for item in items if _norm_doi(item.get("doi")))
        formal_count = sum(1 for item in items if _truth_kind(item.get("doi"), item.get("venue"), item.get("source")) == "formal")
        audit_started = perf_counter()
        audit = _audit_doi_resolution(service, items, audit_count=args.audit_count)
        audit_elapsed_ms = (perf_counter() - audit_started) * 1000.0
        batches.append(
            {
                "batch_id": batch_id,
                "slug": slug,
                "topic": topic,
                "search_elapsed_ms": round(search_elapsed_ms, 2),
                "audit_elapsed_ms": round(audit_elapsed_ms, 2),
                "retrieval": {
                    "sample_size": len(items),
                    "doi_coverage": doi_coverage,
                    "doi_coverage_rate": round(doi_coverage / max(1, len(items)), 4),
                    "formal_count": formal_count,
                    "formal_rate": round(formal_count / max(1, len(items)), 4),
                    "source_mix": dict(retrieval_source_mix),
                    "source_runs": search_payload["source_runs"],
                },
                "doi_audit": audit,
            }
        )

    overall_retrieved = sum(batch["retrieval"]["sample_size"] for batch in batches)
    overall_doi_coverage = sum(batch["retrieval"]["doi_coverage"] for batch in batches)
    overall_formal = sum(batch["retrieval"]["formal_count"] for batch in batches)
    overall_audit_total = sum(batch["doi_audit"]["sample_size"] for batch in batches)
    overall_audit_resolved = sum(batch["doi_audit"]["resolved"] for batch in batches)
    overall_audit_exact = sum(batch["doi_audit"]["exact_match"] for batch in batches)
    payload = {
        "overall": {
            "started_at": started_at.isoformat(),
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "runs": len(batches),
            "retrieved_total": overall_retrieved,
            "retrieval_doi_coverage_rate": round(overall_doi_coverage / max(1, overall_retrieved), 4),
            "retrieval_formal_rate": round(overall_formal / max(1, overall_retrieved), 4),
            "audit_total": overall_audit_total,
            "audit_resolved_rate": round(overall_audit_resolved / max(1, overall_audit_total), 4),
            "audit_exact_match_rate": round(overall_audit_exact / max(1, overall_audit_total), 4),
            "avg_search_elapsed_ms": round(sum(batch["search_elapsed_ms"] for batch in batches) / max(1, len(batches)), 2),
            "avg_audit_elapsed_ms": round(sum(batch["audit_elapsed_ms"] for batch in batches) / max(1, len(batches)), 2),
        },
        "batches": batches,
    }
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    print(text)
    if args.json_out:
        output_path = Path(args.json_out)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
