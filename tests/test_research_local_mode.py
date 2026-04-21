from __future__ import annotations

from pathlib import Path
import struct
import zlib

import fitz

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.research import router as research_router
from app.core.config import get_settings
from app.demo.embodied_ai_seed import seed_embodied_ai_demo
from app.domain.models import Base
from app.infra.db import get_db
from app.infra.repos import (
    ResearchDirectionRepo,
    ResearchPaperFulltextRepo,
    ResearchPaperRepo,
    ResearchRoundPaperRepo,
    ResearchRoundRepo,
    ResearchSeedPaperRepo,
    ResearchSessionRepo,
    ResearchTaskRepo,
    UserRepo,
)
from app.llm.openclaw_client import LLMCallResult, LLMTaskType
from app.services.research_service import ResearchService


class FakeOpenClawClient:
    def chat_completion(self, *, task_type, prompt, system_prompt=None, user=None, temperature=0.0, max_tokens=0):
        if task_type == LLMTaskType.RESEARCH_PLAN:
            if "阶段报告" in prompt or "stage report" in prompt.lower():
                return LLMCallResult(
                    text="当前重点是巩固初版研究图谱，下一步建议聚焦高价值方向并补充证据链。",
                    provider="fake-openclaw",
                    model="fake-openclaw",
                    latency_ms=1,
                    via_fallback=False,
                )
            return LLMCallResult(
                text='{"directions":[{"name":"Direction A","queries":["q1","q2"],"exclude_terms":[]},{"name":"Direction B","queries":["q3","q4"],"exclude_terms":[]}]}',
                provider="fake-openclaw",
                model="fake-openclaw",
                latency_ms=1,
                via_fallback=False,
            )
        return LLMCallResult(
            text="default response",
            provider="fake-openclaw",
            model="fake-openclaw",
            latency_ms=1,
            via_fallback=False,
        )


def build_client():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session_local = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    db_session = session_local()
    app = FastAPI()
    app.state.research_service = ResearchService(openclaw_client=FakeOpenClawClient(), wecom_client=None)
    app.state.research_service.llm_gateway.chat_text = lambda **_kwargs: LLMCallResult(
        text="node level answer",
        provider="fake-gateway",
        model="fake-gateway",
        latency_ms=1,
        via_fallback=False,
    )
    app.include_router(research_router)

    def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    return TestClient(app), db_session, app.state.research_service


def _png_bytes(width: int = 240, height: int = 160, color: tuple[int, int, int] = (46, 109, 246)) -> bytes:
    r, g, b = color
    raw = b"".join(b"\x00" + bytes([r, g, b]) * width for _ in range(height))
    compressed = zlib.compress(raw)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", ihdr),
            chunk(b"IDAT", compressed),
            chunk(b"IEND", b""),
        ]
    )


def _pdf_with_image_bytes() -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 64), "Image PDF", fontsize=18)
    page.insert_image(fitz.Rect(72, 120, 540, 420), stream=_png_bytes())
    out = doc.tobytes()
    doc.close()
    return out


def _pdf_without_image_bytes() -> bytes:
    doc = fitz.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 72), "Text only PDF for paper visual fallback", fontsize=18)
    page.insert_textbox(
        fitz.Rect(72, 120, 520, 420),
        "This PDF intentionally has no embedded raster figure so the service should fall back to the SVG template visual.",
        fontsize=12,
    )
    out = doc.tobytes()
    doc.close()
    return out


def test_research_local_without_jwt_supports_canvas_and_node_chat():
    settings = get_settings()
    original_profile = settings.app_profile
    settings.app_profile = "research_local"
    client, db_session, _service = build_client()
    try:
        create_resp = client.post(
            "/api/v1/research/tasks",
            json={"topic": "local task", "mode": "gpt_step", "llm_backend": "gpt", "llm_model": "gpt-test"},
        )
        assert create_resp.status_code == 200
        task = create_resp.json()
        assert task["mode"] == "gpt_step"
        assert task["llm_backend"] == "gpt"

        canvas_resp = client.get(f"/api/v1/research/tasks/{task['task_id']}/canvas")
        assert canvas_resp.status_code == 200
        canvas = canvas_resp.json()
        assert canvas["task_id"] == task["task_id"]

        update_resp = client.put(
            f"/api/v1/research/tasks/{task['task_id']}/canvas",
            json={
                "nodes": [
                    {
                        "id": "note:test",
                        "type": "note",
                        "position": {"x": 100, "y": 120},
                        "data": {"label": "manual note"},
                    }
                ],
                "edges": [],
                "viewport": {"x": 0, "y": 0, "zoom": 1.1},
            },
        )
        assert update_resp.status_code == 200
        assert update_resp.json()["nodes"][0]["id"] == "note:test"

        chat_resp = client.post(
            f"/api/v1/research/tasks/{task['task_id']}/nodes/topic:{task['task_id']}/chat",
            json={"question": "这个主题为什么重要？"},
        )
        assert chat_resp.status_code == 200
        body = chat_resp.json()
        assert body["node_id"] == f"topic:{task['task_id']}"
        assert len(body["history"]) >= 1
    finally:
        client.close()
        db_session.close()
        settings.app_profile = original_profile


def test_openclaw_auto_run_generates_checkpoint_and_report_events():
    settings = get_settings()
    original_profile = settings.app_profile
    settings.app_profile = "research_local"
    client, db_session, service = build_client()
    try:
        create_resp = client.post(
            "/api/v1/research/tasks",
            json={"topic": "auto research topic", "mode": "openclaw_auto", "llm_backend": "openclaw", "llm_model": "openclaw"},
        )
        assert create_resp.status_code == 200
        task = create_resp.json()
        assert task["mode"] == "openclaw_auto"
        assert task["auto_status"] == "idle"

        start_resp = client.post(f"/api/v1/research/tasks/{task['task_id']}/auto/start")
        assert start_resp.status_code == 200
        run_id = start_resp.json()["run_id"]

        service.process_one_job(db_session)

        events_resp = client.get(f"/api/v1/research/tasks/{task['task_id']}/runs/{run_id}/events")
        assert events_resp.status_code == 200
        event_types = [item["event_type"] for item in events_resp.json()["items"]]
        assert "checkpoint" in event_types

        guidance_resp = client.post(
            f"/api/v1/research/tasks/{task['task_id']}/runs/{run_id}/guidance",
            json={"text": "请优先关注 Direction A 并输出阶段报告"},
        )
        assert guidance_resp.status_code == 200

        continue_resp = client.post(f"/api/v1/research/tasks/{task['task_id']}/runs/{run_id}/continue")
        assert continue_resp.status_code == 200

        service.process_one_job(db_session)

        final_events_resp = client.get(f"/api/v1/research/tasks/{task['task_id']}/runs/{run_id}/events")
        assert final_events_resp.status_code == 200
        final_types = [item["event_type"] for item in final_events_resp.json()["items"]]
        assert "report_chunk" in final_types
        assert "artifact" in final_types
    finally:
        client.close()
        db_session.close()
        settings.app_profile = original_profile


def test_switch_task_same_active_task_does_not_touch_session_state():
    settings = get_settings()
    original_profile = settings.app_profile
    settings.app_profile = "research_local"
    client, db_session, service = build_client()
    try:
        create_resp = client.post(
            "/api/v1/research/tasks",
            json={"topic": "session stability task", "mode": "gpt_step", "llm_backend": "gpt", "llm_model": "gpt-test"},
        )
        assert create_resp.status_code == 200
        task = create_resp.json()

        user_id = 1
        session = ResearchSessionRepo(db_session).get_or_create(user_id, page_size=service.settings.research_page_size)
        before_updated_at = session.updated_at

        switched = service.switch_task(db_session, user_id=user_id, task_id=task["task_id"])
        assert switched.task_id == task["task_id"]

        db_session.refresh(session)
        assert session.active_task_id == task["task_id"]
        assert session.updated_at == before_updated_at
    finally:
        client.close()
        db_session.close()
        settings.app_profile = original_profile


def test_create_task_generates_unique_task_ids():
    settings = get_settings()
    original_profile = settings.app_profile
    settings.app_profile = "research_local"
    client, db_session, _service = build_client()
    try:
        first = client.post(
            "/api/v1/research/tasks",
            json={"topic": "first unique id", "mode": "gpt_step", "llm_backend": "gpt", "llm_model": "gpt-test"},
        )
        second = client.post(
            "/api/v1/research/tasks",
            json={"topic": "second unique id", "mode": "gpt_step", "llm_backend": "gpt", "llm_model": "gpt-test"},
        )
        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json()["task_id"] != second.json()["task_id"]
    finally:
        client.close()
        db_session.close()
        settings.app_profile = original_profile


def test_workbench_config_and_gpt_step_events_are_available():
    settings = get_settings()
    original_profile = settings.app_profile
    settings.app_profile = "research_local"
    client, db_session, _service = build_client()
    try:
        config_resp = client.get("/api/v1/research/workbench/config")
        assert config_resp.status_code == 200
        config = config_resp.json()
        assert config["default_mode"] == "gpt_step"
        assert "gpt" in config["available_backends"]

        create_resp = client.post(
            "/api/v1/research/tasks",
            json={"topic": "eventful task", "mode": "gpt_step", "llm_backend": "gpt", "llm_model": "gpt-test"},
        )
        assert create_resp.status_code == 200
        task = create_resp.json()
        assert task["latest_run_id"].startswith("step-")

        events_resp = client.get(f"/api/v1/research/tasks/{task['task_id']}/runs/{task['latest_run_id']}/events")
        assert events_resp.status_code == 200
        body = events_resp.json()
        assert body["summary"]["total"] >= 2
        assert any(item["payload"].get("kind") == "gpt_step" for item in body["items"])

        delta_resp = client.get(
            f"/api/v1/research/tasks/{task['task_id']}/runs/{task['latest_run_id']}/events?after_seq={body['summary']['latest_seq']}"
        )
        assert delta_resp.status_code == 200
        assert delta_resp.json()["items"] == []
    finally:
        client.close()
        db_session.close()
        settings.app_profile = original_profile


def test_paper_asset_meta_reports_available_and_missing_assets(tmp_path):
    settings = get_settings()
    original_profile = settings.app_profile
    settings.app_profile = "research_local"
    client, db_session, _service = build_client()
    try:
        create_resp = client.post(
            "/api/v1/research/tasks",
            json={"topic": "asset task", "mode": "gpt_step", "llm_backend": "gpt", "llm_model": "gpt-test"},
        )
        assert create_resp.status_code == 200
        task_json = create_resp.json()
        task_row = ResearchTaskRepo(db_session).get_by_task_id(task_json["task_id"], user_id=1)
        assert task_row is not None

        direction = ResearchDirectionRepo(db_session).replace_for_task(
            task_row,
            [{"name": "Direction A", "queries": ["q1"], "exclude_terms": []}],
        )[0]
        paper = ResearchPaperRepo(db_session).replace_direction_papers(
            direction,
            [
                {
                    "paper_id": "paper:demo",
                    "title": "Demo Paper",
                    "title_norm": "demo paper",
                    "authors": ["Alice"],
                    "year": 2025,
                    "venue": "ACL",
                    "doi": "10.1000/demo",
                    "url": "https://example.com/demo",
                    "abstract": "abstract",
                    "method_summary": "method",
                    "source": "semantic_scholar",
                }
            ],
        )[0]
        round_row = ResearchRoundRepo(db_session).create(
            task_id=task_row.id,
            direction_index=direction.direction_index,
            parent_round_id=None,
            depth=1,
            action="expand",
            feedback_text="seed paper for graph",
            query_terms=["demo paper"],
            status="done",
        )
        ResearchRoundPaperRepo(db_session).replace_for_round(round_id=round_row.id, rows=[paper], role="seed")

        pdf_path = tmp_path / "demo.pdf"
        txt_path = tmp_path / "demo.txt"
        pdf_path.write_bytes(b"%PDF-1.4\n%demo\n")
        txt_path.write_text("demo fulltext", encoding="utf-8")
        ResearchPaperFulltextRepo(db_session).upsert(
            task_id=task_row.id,
            paper_id=paper.paper_id,
            status="parsed",
            pdf_path=str(pdf_path),
            text_path=str(txt_path),
        )
        ResearchPaperRepo(db_session).mark_saved(paper, md_path=str(tmp_path / "demo.md"), bib_path=str(tmp_path / "demo.bib"))
        Path(paper.saved_path).write_text("# Demo", encoding="utf-8")
        Path(paper.saved_bib_path).write_text("@article{demo}", encoding="utf-8")

        asset_resp = client.get(f"/api/v1/research/tasks/{task_json['task_id']}/papers/{paper.paper_id}/asset/meta")
        assert asset_resp.status_code == 200
        body = asset_resp.json()
        assert body["primary_kind"] == "pdf"
        by_kind = {item["kind"]: item for item in body["items"]}
        assert by_kind["pdf"]["status"] == "available"
        assert by_kind["txt"]["status"] == "available"
        assert by_kind["md"]["status"] == "available"
        assert by_kind["bib"]["status"] == "available"
        assert "disposition=inline" in by_kind["pdf"]["open_url"]
        assert "kind=pdf" in by_kind["pdf"]["download_url"]
        assert "disposition=attachment" in by_kind["pdf"]["download_url"]

        inline_resp = client.get(
            f"/api/v1/research/tasks/{task_json['task_id']}/papers/{paper.paper_id}/asset?kind=pdf&disposition=inline"
        )
        assert inline_resp.status_code == 200
        assert inline_resp.headers["content-type"].startswith("application/pdf")
        assert inline_resp.headers["content-disposition"].startswith("inline;")

        detail_resp = client.get(f"/api/v1/research/tasks/{task_json['task_id']}/papers/{paper.paper_id}")
        assert detail_resp.status_code == 200
        detail = detail_resp.json()
        assert detail["card_summary"]
        assert detail["summary_source"] == "abstract"
        assert detail["summary_status"] in {"none", "fallback", "done"}

        graph_resp = client.get(f"/api/v1/research/tasks/{task_json['task_id']}/graph?view=tree&include_papers=true")
        assert graph_resp.status_code == 200
        graph_node = next(node for node in graph_resp.json()["nodes"] if node["id"] == paper.paper_id)
        assert graph_node["card_summary"]
        assert graph_node["summary_source"] == "abstract"
        assert graph_node["summary_status"] in {"none", "fallback", "done"}
    finally:
        client.close()
        db_session.close()
        settings.app_profile = original_profile


def test_projects_and_collections_support_study_task_creation():
    settings = get_settings()
    original_profile = settings.app_profile
    settings.app_profile = "research_local"
    client, db_session, service = build_client()
    try:
        project_resp = client.get("/api/v1/research/projects")
        assert project_resp.status_code == 200
        default_project_id = project_resp.json()["default_project_id"]
        assert default_project_id

        extra_project = client.post("/api/v1/research/projects", json={"name": "Secondary Project"})
        assert extra_project.status_code == 200
        second_project_id = extra_project.json()["project_id"]

        task_resp = client.post(
            "/api/v1/research/tasks",
            json={"topic": "seed source task", "mode": "gpt_step", "llm_backend": "gpt", "llm_model": "gpt-test", "project_id": default_project_id},
        )
        assert task_resp.status_code == 200
        source_task = task_resp.json()
        task_row = ResearchTaskRepo(db_session).get_by_task_id(source_task["task_id"], user_id=1)
        assert task_row is not None

        direction = ResearchDirectionRepo(db_session).replace_for_task(
            task_row,
            [{"name": "Direction A", "queries": ["q1"], "exclude_terms": []}],
        )[0]
        paper = ResearchPaperRepo(db_session).replace_direction_papers(
            direction,
            [
                {
                    "paper_id": "paper:seed",
                    "title": "Seed Paper",
                    "title_norm": "seed paper",
                    "authors": ["Alice"],
                    "year": 2025,
                    "venue": "ACL",
                    "doi": "10.1000/seed",
                    "url": "https://example.com/seed",
                    "abstract": "seed abstract",
                    "method_summary": "seed method",
                    "source": "semantic_scholar",
                }
            ],
        )[0]

        collection_resp = client.post(
            f"/api/v1/research/projects/{second_project_id}/collections",
            json={"name": "My Collection"},
        )
        assert collection_resp.status_code == 200
        collection_id = collection_resp.json()["collection_id"]

        add_item_resp = client.post(
            f"/api/v1/research/collections/{collection_id}/items",
            json={"items": [{"task_id": source_task["task_id"], "paper_id": paper.paper_id}]},
        )
        assert add_item_resp.status_code == 200
        assert add_item_resp.json()["item_count"] == 1
        assert add_item_resp.json()["items"][0]["task_id"] == source_task["task_id"]

        study_resp = client.post(
            f"/api/v1/research/collections/{collection_id}/study",
            json={"topic": "Collection derived study", "mode": "gpt_step", "llm_backend": "gpt", "llm_model": "gpt-test"},
        )
        assert study_resp.status_code == 200
        study_task = study_resp.json()
        assert study_task["project_id"] == second_project_id

        service.process_one_job(db_session)
        service.process_one_job(db_session)
        study_row = ResearchTaskRepo(db_session).get_by_task_id(study_task["task_id"], user_id=1)
        assert study_row is not None
        seed_summary = ResearchSeedPaperRepo(db_session).summary_for_task(study_row.id)
        assert seed_summary["total"] >= 1
    finally:
        client.close()
        db_session.close()
        settings.app_profile = original_profile


def test_embodied_demo_seed_static_workspace_is_readable():
    settings = get_settings()
    original_profile = settings.app_profile
    settings.app_profile = "research_local"
    client, db_session, service = build_client()
    try:
        user = UserRepo(db_session).get_or_create(
            settings.research_local_user_id,
            timezone_name=settings.default_timezone,
            locale=settings.research_local_user_locale,
        )
        first = seed_embodied_ai_demo(db_session, user_id=int(user.id), service=service)
        second = seed_embodied_ai_demo(db_session, user_id=int(user.id), service=service)
        assert first["initialized"] is True
        assert second["initialized"] is False

        project_resp = client.get("/api/v1/research/projects")
        assert project_resp.status_code == 200
        assert any(item["project_id"] == "demo-embodied-ai" for item in project_resp.json()["items"])

        tasks_resp = client.get("/api/v1/research/tasks")
        assert tasks_resp.status_code == 200
        task_ids = {item["task_id"] for item in tasks_resp.json()["items"]}
        assert "demo-gpt-embodied" in task_ids
        assert "demo-auto-embodied" in task_ids

        collection_resp = client.get("/api/v1/research/collections/collection-demo-embodied-core")
        assert collection_resp.status_code == 200
        collection = collection_resp.json()
        assert collection["item_count"] >= 4
        assert {item["task_id"] for item in collection["items"]} == {"demo-gpt-embodied", "demo-auto-embodied"}

        canvas_resp = client.get("/api/v1/research/tasks/demo-gpt-embodied/canvas")
        assert canvas_resp.status_code == 200
        canvas = canvas_resp.json()
        assert any(node["type"] == "report" for node in canvas["nodes"])
        assert any(edge["data"].get("kind") == "manual" for edge in canvas["edges"])

        exports_resp = client.get("/api/v1/research/tasks/demo-gpt-embodied/exports")
        assert exports_resp.status_code == 200
        assert len(exports_resp.json()["items"]) >= 2
        assert all(item.get("filename") for item in exports_resp.json()["items"])
        assert any(item.get("download_url") for item in exports_resp.json()["items"])

        asset_resp = client.get("/api/v1/research/tasks/demo-gpt-embodied/papers/paper:gpt:wm-core/asset/meta")
        assert asset_resp.status_code == 200
        asset = asset_resp.json()
        assert asset["primary_kind"] in {"figure", "visual"}
        assert any(item["kind"] == "visual" and item["status"] == "available" for item in asset["items"])
        assert any(item["kind"] == "txt" and item["status"] == "available" for item in asset["items"])
        assert any(item["kind"] == "visual" and item.get("open_url") for item in asset["items"])

        events_resp = client.get("/api/v1/research/tasks/demo-auto-embodied/runs/run-demo-embodied-auto/events")
        assert events_resp.status_code == 200
        summary = events_resp.json()["summary"]
        assert summary["latest_checkpoint"]["checkpoint_id"] == "cp-embodied-stage-1"
        assert summary["latest_report_excerpt"]
        assert len(summary["guidance_history"]) >= 1
        assert len(summary["artifacts"]) >= 1
    finally:
        client.close()
        db_session.close()
        settings.app_profile = original_profile


def test_canvas_ui_and_provider_status_are_available():
    settings = get_settings()
    original_profile = settings.app_profile
    settings.app_profile = "research_local"
    client, db_session, _service = build_client()
    try:
        create_resp = client.post(
            "/api/v1/research/tasks",
            json={"topic": "canvas ui task", "mode": "gpt_step", "llm_backend": "gpt", "llm_model": "gpt-test"},
        )
        assert create_resp.status_code == 200
        task = create_resp.json()

        canvas_resp = client.get(f"/api/v1/research/tasks/{task['task_id']}/canvas")
        assert canvas_resp.status_code == 200
        assert canvas_resp.json()["ui"]["layout_mode"] == "elk_layered"

        update_resp = client.put(
            f"/api/v1/research/tasks/{task['task_id']}/canvas",
            json={
                "nodes": [],
                "edges": [],
                "viewport": {"x": 1, "y": 2, "zoom": 1.05},
                "ui": {
                    "left_sidebar_collapsed": True,
                    "right_sidebar_collapsed": False,
                    "left_sidebar_width": 300,
                    "right_sidebar_width": 430,
                    "show_minimap": True,
                    "layout_mode": "elk_stress",
                },
            },
        )
        assert update_resp.status_code == 200
        assert update_resp.json()["ui"]["show_minimap"] is True
        assert update_resp.json()["ui"]["layout_mode"] == "elk_stress"

        config_resp = client.get("/api/v1/research/workbench/config")
        assert config_resp.status_code == 200
        config = config_resp.json()
        assert "openalex" in config["discovery_providers"]
        assert any(item["role"] == "citation" for item in config["provider_status"])
    finally:
        client.close()
        db_session.close()
        settings.app_profile = original_profile


def test_zotero_import_creates_collection(monkeypatch):
    settings = get_settings()
    original_profile = settings.app_profile
    settings.app_profile = "research_local"
    client, db_session, service = build_client()
    try:
        settings.zotero_library_id = "12345"

        def fake_http_get_json(url, *, headers=None, params=None):
            if url.endswith("/collections/ABCD"):
                return {"data": {"name": "Zotero Demo"}}
            return [
                {
                    "data": {
                        "title": "Imported Paper",
                        "creators": [{"firstName": "Ada", "lastName": "Lovelace"}],
                        "date": "2024",
                        "publicationTitle": "Nature",
                        "DOI": "10.1000/zotero",
                        "url": "https://example.com/zotero",
                        "abstractNote": "imported abstract",
                    }
                }
            ]

        monkeypatch.setattr(service, "_http_get_json", fake_http_get_json)

        projects = client.get("/api/v1/research/projects")
        assert projects.status_code == 200
        default_project_id = projects.json()["default_project_id"]

        import_resp = client.post(
            "/api/v1/research/integrations/zotero/import",
            json={"project_id": default_project_id, "collection_key": "ABCD"},
        )
        assert import_resp.status_code == 200
        body = import_resp.json()
        assert body["imported"] == 1
        assert body["collection"]["name"] == "Zotero Demo"
        assert body["collection"]["item_count"] == 1
    finally:
        client.close()
        db_session.close()
        settings.app_profile = original_profile


def test_zotero_config_reports_local_first_mode():
    settings = get_settings()
    original_profile = settings.app_profile
    settings.app_profile = "research_local"
    client, db_session, _service = build_client()
    try:
        resp = client.get("/api/v1/research/integrations/zotero/config")
        assert resp.status_code == 200
        body = resp.json()
        assert body["mode"] == "local_default"
        assert body["enabled"] is True
        assert "csljson" in body["import_formats"]
        assert "collection" in body["export_targets"]
    finally:
        client.close()
        db_session.close()
        settings.app_profile = original_profile


def test_local_zotero_csljson_import_dedupes_and_exports_collection(tmp_path):
    settings = get_settings()
    original_profile = settings.app_profile
    settings.app_profile = "research_local"
    settings.research_artifact_dir = str(tmp_path)
    client, db_session, _service = build_client()
    try:
        projects = client.get("/api/v1/research/projects")
        assert projects.status_code == 200
        default_project_id = projects.json()["default_project_id"]

        content = """
[
  {
    "id": "item-1",
    "type": "article-journal",
    "title": "World Models for Embodied Agents",
    "author": [{"given": "Ada", "family": "Lovelace"}],
    "issued": {"date-parts": [[2024]]},
    "container-title": "Nature Machine Intelligence",
    "DOI": "10.1000/embodied-1",
    "URL": "https://example.com/embodied-1",
    "abstract": "paper abstract",
    "keyword": ["embodied ai", "world model"]
  },
  {
    "id": "item-2",
    "type": "article-journal",
    "title": "World Models for Embodied Agents",
    "author": [{"given": "Ada", "family": "Lovelace"}],
    "issued": {"date-parts": [[2024]]},
    "container-title": "Nature Machine Intelligence",
    "DOI": "10.1000/embodied-1",
    "URL": "https://example.com/embodied-1"
  }
]
""".strip()

        import_resp = client.post(
            "/api/v1/research/integrations/zotero/import-local",
            data={"project_id": default_project_id, "collection_name": "Local CSL"},
            files={"file": ("embodied.csljson", content, "application/json")},
        )
        assert import_resp.status_code == 200
        body = import_resp.json()
        assert body["format"] == "csljson"
        assert body["total_items"] == 2
        assert body["imported_items"] == 1
        assert body["deduped_items"] == 1
        collection_id = body["collection"]["collection_id"]

        export_bib = client.get(f"/api/v1/research/collections/{collection_id}/export?format=bib")
        assert export_bib.status_code == 200
        assert export_bib.json()["filename"].endswith(".bib")
        assert export_bib.json()["download_url"]
        bib_path = Path(export_bib.json()["path"])
        assert bib_path.exists()
        assert "World Models for Embodied Agents" in bib_path.read_text(encoding="utf-8")
        download_bib = client.get(export_bib.json()["download_url"])
        assert download_bib.status_code == 200

        export_csljson = client.get(f"/api/v1/research/collections/{collection_id}/export?format=csljson")
        assert export_csljson.status_code == 200
        assert export_csljson.json()["filename"].endswith(".csljson")
        assert export_csljson.json()["download_url"]
        csljson_path = Path(export_csljson.json()["path"])
        assert csljson_path.exists()
        assert '"title": "World Models for Embodied Agents"' in csljson_path.read_text(encoding="utf-8")
        download_csljson = client.get(export_csljson.json()["download_url"])
        assert download_csljson.status_code == 200

        export_history = client.get(f"/api/v1/research/collections/{collection_id}/exports")
        assert export_history.status_code == 200
        history_body = export_history.json()
        assert history_body["collection_id"] == collection_id
        assert len(history_body["items"]) == 2
        assert history_body["items"][0]["collection_id"] == collection_id
        assert history_body["items"][0]["format"] == "csljson"
        assert history_body["items"][0]["filename"].endswith(".csljson")
        assert history_body["items"][0]["download_url"]
        assert history_body["items"][1]["format"] == "bib"
        assert history_body["items"][1]["filename"].endswith(".bib")
    finally:
        client.close()
        db_session.close()
        settings.app_profile = original_profile


def test_local_zotero_bibtex_import_and_task_csljson_export(tmp_path):
    settings = get_settings()
    original_profile = settings.app_profile
    settings.app_profile = "research_local"
    settings.research_artifact_dir = str(tmp_path)
    client, db_session, _service = build_client()
    try:
        projects = client.get("/api/v1/research/projects")
        assert projects.status_code == 200
        default_project_id = projects.json()["default_project_id"]

        bib = """
@article{wm2024,
  title = {Embodied World Models in Practice},
  author = {Alice Smith and Bob Jones},
  journal = {Science Robotics},
  year = {2024},
  doi = {10.1000/embodied-bib},
  url = {https://example.com/embodied-bib},
  abstract = {bib abstract}
}
""".strip()

        import_resp = client.post(
            "/api/v1/research/integrations/zotero/import-local",
            data={"project_id": default_project_id, "collection_name": "Local Bib"},
            files={"file": ("embodied.bib", bib, "text/plain")},
        )
        assert import_resp.status_code == 200
        body = import_resp.json()
        assert body["format"] == "bib"
        assert body["imported_items"] == 1

        task_resp = client.post(
            "/api/v1/research/tasks",
            json={"topic": "export csljson task", "mode": "gpt_step", "llm_backend": "gpt", "llm_model": "gpt-test", "project_id": default_project_id},
        )
        assert task_resp.status_code == 200
        task_row = ResearchTaskRepo(db_session).get_by_task_id(task_resp.json()["task_id"], user_id=1)
        assert task_row is not None
        direction = ResearchDirectionRepo(db_session).replace_for_task(
            task_row,
            [{"name": "Direction A", "queries": ["q1"], "exclude_terms": []}],
        )[0]
        ResearchPaperRepo(db_session).replace_direction_papers(
            direction,
            [
                {
                    "paper_id": "paper:export-csl",
                    "title": "Exported CSL JSON Paper",
                    "title_norm": "exported csl json paper",
                    "authors": ["Alice Smith", "Bob Jones"],
                    "year": 2024,
                    "venue": "Science Robotics",
                    "doi": "10.1000/export-csl",
                    "url": "https://example.com/export-csl",
                    "abstract": "task export abstract",
                    "method_summary": "method",
                    "source": "semantic_scholar",
                }
            ],
        )

        export_resp = client.get(f"/api/v1/research/tasks/{task_resp.json()['task_id']}/export?format=csljson")
        assert export_resp.status_code == 200
        assert export_resp.json()["filename"].endswith(".csljson")
        assert export_resp.json()["download_url"]
        export_path = Path(export_resp.json()["path"])
        assert export_path.exists()
        export_text = export_path.read_text(encoding="utf-8")
        assert '"title": "Exported CSL JSON Paper"' in export_text
        assert '"DOI": "10.1000/export-csl"' in export_text

        download_resp = client.get(export_resp.json()["download_url"])
        assert download_resp.status_code == 200
    finally:
        client.close()
        db_session.close()
        settings.app_profile = original_profile


def test_paper_visual_extracts_primary_figure_and_exposes_graph_preview(tmp_path):
    settings = get_settings()
    original_profile = settings.app_profile
    original_artifact_dir = settings.research_artifact_dir
    settings.app_profile = "research_local"
    settings.research_artifact_dir = str(tmp_path / "artifacts")
    client, db_session, _service = build_client()
    try:
        create_resp = client.post(
            "/api/v1/research/tasks",
            json={"topic": "visual figure task", "mode": "gpt_step", "llm_backend": "gpt", "llm_model": "gpt-test"},
        )
        assert create_resp.status_code == 200
        task_json = create_resp.json()
        task_row = ResearchTaskRepo(db_session).get_by_task_id(task_json["task_id"], user_id=1)
        assert task_row is not None

        direction = ResearchDirectionRepo(db_session).replace_for_task(
            task_row,
            [{"name": "Direction A", "queries": ["figure"], "exclude_terms": []}],
        )[0]
        paper = ResearchPaperRepo(db_session).replace_direction_papers(
            direction,
            [
                {
                    "paper_id": "paper:visual-figure",
                    "title": "Figure Rich Paper",
                    "title_norm": "figure rich paper",
                    "authors": ["Alice"],
                    "year": 2025,
                    "venue": "ICLR",
                    "doi": "10.1000/figure-rich",
                    "url": "https://example.com/figure-rich",
                    "abstract": "paper with image",
                    "method_summary": "method",
                    "source": "semantic_scholar",
                }
            ],
        )[0]
        round_row = ResearchRoundRepo(db_session).create(
            task_id=task_row.id,
            direction_index=direction.direction_index,
            parent_round_id=None,
            depth=1,
            action="expand",
            feedback_text="build preview",
            query_terms=["figure rich paper"],
            status="done",
        )
        ResearchRoundPaperRepo(db_session).replace_for_round(round_id=round_row.id, rows=[paper], role="seed")

        upload_resp = client.post(
            f"/api/v1/research/tasks/{task_json['task_id']}/papers/{paper.paper_id}/pdf/upload",
            files={"file": ("figure-rich.pdf", _pdf_with_image_bytes(), "application/pdf")},
        )
        assert upload_resp.status_code == 200

        asset_resp = client.get(f"/api/v1/research/tasks/{task_json['task_id']}/papers/{paper.paper_id}/asset/meta")
        assert asset_resp.status_code == 200
        by_kind = {item["kind"]: item for item in asset_resp.json()["items"]}
        assert by_kind["figure"]["status"] == "available"
        assert "kind=figure" in by_kind["figure"]["download_url"]
        assert "disposition=attachment" in by_kind["figure"]["download_url"]
        assert by_kind["figure"]["mime_type"] == "image/png"
        assert by_kind["visual"]["status"] == "available"

        figure_resp = client.get(f"/api/v1/research/tasks/{task_json['task_id']}/papers/{paper.paper_id}/asset?kind=figure")
        assert figure_resp.status_code == 200
        assert figure_resp.headers["content-type"].startswith("image/png")

        graph_resp = client.get(f"/api/v1/research/tasks/{task_json['task_id']}/graph?view=tree&include_papers=true")
        assert graph_resp.status_code == 200
        graph_node = next(node for node in graph_resp.json()["nodes"] if node["id"] == paper.paper_id)
        assert graph_node["preview_kind"] == "figure"
        assert "kind=figure" in graph_node["preview_url"]
        assert "disposition=inline" in graph_node["preview_url"]
        assert graph_node["visual_status"] == "figure_ready"
    finally:
        client.close()
        db_session.close()
        settings.app_profile = original_profile
        settings.research_artifact_dir = original_artifact_dir


def test_paper_visual_falls_back_to_template_and_manual_rebuild_is_idempotent(tmp_path):
    settings = get_settings()
    original_profile = settings.app_profile
    original_artifact_dir = settings.research_artifact_dir
    settings.app_profile = "research_local"
    settings.research_artifact_dir = str(tmp_path / "artifacts")
    client, db_session, _service = build_client()
    try:
        create_resp = client.post(
            "/api/v1/research/tasks",
            json={"topic": "visual fallback task", "mode": "gpt_step", "llm_backend": "gpt", "llm_model": "gpt-test"},
        )
        assert create_resp.status_code == 200
        task_json = create_resp.json()
        task_row = ResearchTaskRepo(db_session).get_by_task_id(task_json["task_id"], user_id=1)
        assert task_row is not None

        direction = ResearchDirectionRepo(db_session).replace_for_task(
            task_row,
            [{"name": "Direction A", "queries": ["fallback"], "exclude_terms": []}],
        )[0]
        paper = ResearchPaperRepo(db_session).replace_direction_papers(
            direction,
            [
                {
                    "paper_id": "paper:visual-fallback",
                    "title": "Text Only Paper",
                    "title_norm": "text only paper",
                    "authors": ["Bob"],
                    "year": 2024,
                    "venue": "ACL",
                    "doi": "10.1000/text-only",
                    "url": "https://example.com/text-only",
                    "abstract": "paper without image",
                    "method_summary": "method",
                    "source": "arxiv",
                }
            ],
        )[0]
        round_row = ResearchRoundRepo(db_session).create(
            task_id=task_row.id,
            direction_index=direction.direction_index,
            parent_round_id=None,
            depth=1,
            action="expand",
            feedback_text="fallback preview",
            query_terms=["text only paper"],
            status="done",
        )
        ResearchRoundPaperRepo(db_session).replace_for_round(round_id=round_row.id, rows=[paper], role="seed")

        upload_resp = client.post(
            f"/api/v1/research/tasks/{task_json['task_id']}/papers/{paper.paper_id}/pdf/upload",
            files={"file": ("text-only.pdf", _pdf_without_image_bytes(), "application/pdf")},
        )
        assert upload_resp.status_code == 200

        asset_resp = client.get(f"/api/v1/research/tasks/{task_json['task_id']}/papers/{paper.paper_id}/asset/meta")
        assert asset_resp.status_code == 200
        by_kind = {item["kind"]: item for item in asset_resp.json()["items"]}
        assert by_kind["figure"]["status"] == "missing"
        assert by_kind["visual"]["status"] == "available"
        assert by_kind["visual"]["mime_type"] == "image/svg+xml"

        rebuild_one = client.post(f"/api/v1/research/tasks/{task_json['task_id']}/papers/{paper.paper_id}/visual/build")
        rebuild_two = client.post(f"/api/v1/research/tasks/{task_json['task_id']}/papers/{paper.paper_id}/visual/build")
        assert rebuild_one.status_code == 200
        assert rebuild_two.status_code == 200
        assert rebuild_two.json()["paper_id"] == paper.paper_id

        graph_resp = client.get(f"/api/v1/research/tasks/{task_json['task_id']}/graph?view=tree&include_papers=true")
        assert graph_resp.status_code == 200
        graph_node = next(node for node in graph_resp.json()["nodes"] if node["id"] == paper.paper_id)
        assert graph_node["preview_kind"] == "visual"
        assert "kind=visual" in graph_node["preview_url"]
        assert "disposition=inline" in graph_node["preview_url"]
        assert graph_node["visual_status"] == "visual_ready"
    finally:
        client.close()
        db_session.close()
        settings.app_profile = original_profile
        settings.research_artifact_dir = original_artifact_dir
