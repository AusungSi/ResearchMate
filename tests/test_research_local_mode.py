from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.research import router as research_router
from app.core.config import get_settings
from app.domain.models import Base
from app.infra.db import get_db
from app.infra.repos import ResearchSessionRepo
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
    app.include_router(research_router)

    def override_db():
        yield db_session

    app.dependency_overrides[get_db] = override_db
    return TestClient(app), db_session, app.state.research_service


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
