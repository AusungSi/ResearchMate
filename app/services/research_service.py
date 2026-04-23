from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
from io import BytesIO
from pathlib import Path
from time import perf_counter, sleep
from urllib.parse import quote_plus, urljoin
from uuid import uuid4
from xml.etree import ElementTree as ET
import re

import httpx
import orjson
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_logger
from app.domain.enums import (
    ResearchActionType,
    ResearchAutoStatus,
    ResearchGraphBuildStatus,
    ResearchGraphViewType,
    ResearchJobType,
    ResearchLLMBackend,
    ResearchPaperFulltextStatus,
    ResearchRunEventType,
    ResearchRunMode,
    ResearchRoundStatus,
    ResearchTaskStatus,
)
from app.domain.models import (
    ResearchCompareReport,
    ResearchCollection,
    ResearchCollectionExportRecord,
    ResearchCollectionItem,
    ResearchExportRecord,
    ResearchProject,
    ResearchRound,
    ResearchTask,
    User,
)
from app.infra.repos import (
    ResearchCanvasStateRepo,
    ResearchCompareReportRepo,
    ResearchCollectionExportRecordRepo,
    ResearchCollectionItemRepo,
    ResearchCollectionRepo,
    ResearchCitationFetchCacheRepo,
    ResearchCitationEdgeRepo,
    ResearchDirectionRepo,
    ResearchExportRecordRepo,
    ResearchGraphSnapshotRepo,
    ResearchJobRepo,
    ResearchNodeChatRepo,
    ResearchPaperRepo,
    ResearchPaperFulltextRepo,
    ResearchRoundCandidateRepo,
    ResearchRoundPaperRepo,
    ResearchRoundRepo,
    ResearchProjectRepo,
    ResearchRunEventRepo,
    ResearchSeedPaperRepo,
    ResearchSearchCacheRepo,
    ResearchSessionRepo,
    ResearchTaskRepo,
    UserRepo,
)
from app.infra.wecom_client import WeComClient
from app.llm.openclaw_client import LLMCallResult, LLMTaskType, OpenClawClient
from app.llm.research_llm_gateway import ResearchLLMGateway
from app.services.paper_visual_service import PaperVisualService
from app.services.venue_metrics_service import VenueMetricsService


logger = get_logger("research")

try:
    import networkx as nx
except Exception:  # pragma: no cover
    nx = None

try:
    import fitz
except Exception:  # pragma: no cover
    fitz = None

try:
    from pdfminer.high_level import extract_text as pdfminer_extract_text
except Exception:  # pragma: no cover
    pdfminer_extract_text = None


@dataclass
class SearchFetchResult:
    papers: list[dict]
    status: str
    error: str | None = None


class CanvasStateBusyError(RuntimeError):
    """Raised when canvas persistence collides with an ongoing SQLite write lock."""


class NodeChatBusyError(RuntimeError):
    """Raised when node chat persistence collides with an ongoing SQLite write lock."""


class ResearchService:
    def __init__(
        self,
        *,
        openclaw_client: OpenClawClient | None = None,
        wecom_client: WeComClient | None = None,
    ) -> None:
        self.settings = get_settings()
        self.openclaw_client = openclaw_client or OpenClawClient(settings=self.settings)
        self.llm_gateway = ResearchLLMGateway(settings=self.settings, openclaw_client=self.openclaw_client)
        self.paper_visual_service = PaperVisualService(settings=self.settings)
        self.venue_metrics_service = VenueMetricsService(settings=self.settings)
        self.wecom_client = wecom_client
        self.research_jobs_total = 0
        self.research_job_latency_ms = 0
        self.research_cache_hit = 0
        self.research_cache_miss = 0
        self.research_export_success = 0
        self.research_export_fail = 0
        self.research_search_source_status: dict[str, int] = {}

    def metrics_snapshot(self) -> dict[str, int | dict[str, int]]:
        return {
            "research_jobs_total": self.research_jobs_total,
            "research_job_latency_ms": self.research_job_latency_ms,
            "research_cache_hit": self.research_cache_hit,
            "research_cache_miss": self.research_cache_miss,
            "research_export_success": self.research_export_success,
            "research_export_fail": self.research_export_fail,
            "research_search_source_status": dict(self.research_search_source_status),
        }

    def create_task(
        self,
        db: Session,
        *,
        user_id: int,
        topic: str,
        project_id: str | None = None,
        constraints: dict | None = None,
        mode: str | ResearchRunMode = ResearchRunMode.GPT_STEP,
        llm_backend: str | ResearchLLMBackend = ResearchLLMBackend.GPT,
        llm_model: str | None = None,
    ) -> tuple[ResearchTask, bool, str | None]:
        task_repo = ResearchTaskRepo(db)
        session_repo = ResearchSessionRepo(db)
        project = self._get_or_create_project(db, user_id=user_id, project_id=project_id)
        now = datetime.now(timezone.utc)
        task_id = self._next_task_id()
        mode_text = mode.value if isinstance(mode, ResearchRunMode) else str(mode)
        backend_text = llm_backend.value if isinstance(llm_backend, ResearchLLMBackend) else str(llm_backend)
        mode_value = ResearchRunMode(mode_text)
        backend_value = ResearchLLMBackend(backend_text)
        if mode_value == ResearchRunMode.OPENCLAW_AUTO:
            backend_value = ResearchLLMBackend.OPENCLAW
        status = ResearchTaskStatus.CREATED if mode_value == ResearchRunMode.OPENCLAW_AUTO else ResearchTaskStatus.PLANNING
        row = ResearchTask(
            task_id=task_id,
            user_id=user_id,
            project_id=project.id,
            topic=topic.strip(),
            constraints_json=orjson.dumps(constraints or {}).decode("utf-8"),
            mode=mode_value,
            llm_backend=backend_value,
            llm_model=(llm_model.strip()[:128] if llm_model and llm_model.strip() else None),
            auto_status=ResearchAutoStatus.IDLE,
            status=status,
            created_at=now,
            updated_at=now,
        )
        task_repo.create(row)
        if mode_value == ResearchRunMode.GPT_STEP:
            self._emit_step_progress(
                db,
                task=row,
                step="task_created",
                title="任务已创建",
                message="研究任务已创建，系统会按 GPT Step 流程逐步推进。",
                status="created",
                details={
                    "mode": mode_value.value,
                    "llm_backend": backend_value.value,
                    "llm_model": row.llm_model,
                    "project_id": project.project_key,
                },
            )
        if mode_value == ResearchRunMode.GPT_STEP:
            ResearchJobRepo(db).enqueue(
                row.id,
                ResearchJobType.PLAN,
                {"topic": row.topic, "constraints": constraints or {}},
                queue_name=self.settings.research_queue_name,
            )
            self._emit_step_progress(
                db,
                task=row,
                step="plan_queued",
                title="方向规划已排队",
                message="正在准备方向规划任务。",
                status="queued",
            )
        session = session_repo.get_or_create(user_id, page_size=self.settings.research_page_size)
        session_repo.set_active_task(session, row.task_id)
        return row

    def enqueue_search(
        self,
        db: Session,
        *,
        user_id: int,
        direction_index: int,
        top_n: int | None = None,
        force_refresh: bool = False,
    ) -> ResearchTask:
        task = self.get_active_task(db, user_id)
        if not task:
            raise ValueError("no active research task")
        if direction_index < 1:
            raise ValueError("direction index must be >= 1")
        direction = ResearchDirectionRepo(db).get_by_index(task.id, direction_index)
        if not direction:
            return task, False, "direction_missing"
        job_repo = ResearchJobRepo(db)
        if job_repo.has_pending(task.id, ResearchJobType.SEARCH):
            return task, False, "search_already_pending"
        payload = {
            "direction_index": direction_index,
            "top_n": top_n or self.settings.research_topn_default,
            "force_refresh": bool(force_refresh),
        }
        job_repo.enqueue(task.id, ResearchJobType.SEARCH, payload, queue_name=self.settings.research_queue_name)
        task.status = ResearchTaskStatus.SEARCHING
        task.updated_at = datetime.now(timezone.utc)
        db.add(task)
        db.flush()
        self._emit_step_progress(
            db,
            task=task,
            step="search_queued",
            title=f"方向 {direction_index} 检索已排队",
            message=f"正在为方向 {direction_index} 准备检索任务。",
            status="queued",
            details=payload,
        )
        return task, True, None

    def enqueue_plan(self, db: Session, *, user_id: int, task_id: str, force: bool = False) -> tuple[ResearchTask, bool, str | None]:
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        direction_count = len(ResearchDirectionRepo(db).list_for_task(task.id))
        job_repo = ResearchJobRepo(db)
        if not force and direction_count > 0:
            return task, False, "directions_already_available"
        if job_repo.has_pending(task.id, ResearchJobType.PLAN):
            return task, False, "plan_already_pending"
        payload = {
            "topic": task.topic,
            "constraints": _load_json_dict(task.constraints_json),
        }
        job_repo.enqueue(task.id, ResearchJobType.PLAN, payload, queue_name=self.settings.research_queue_name)
        task.status = ResearchTaskStatus.PLANNING
        task.updated_at = datetime.now(timezone.utc)
        db.add(task)
        db.flush()
        self._emit_step_progress(
            db,
            task=task,
            step="plan_queued",
            title="方向规划已排队",
            message="正在为当前任务生成研究方向。",
            status="queued",
            details={"force": bool(force)},
        )
        return task, True, None

    def enqueue_fulltext_build(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        force: bool = False,
        paper_ids: list[str] | None = None,
    ) -> tuple[ResearchTask, bool, str | None]:
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        if not self.settings.research_fulltext_enabled:
            raise ValueError("research fulltext is disabled")
        job_repo = ResearchJobRepo(db)
        if not force and job_repo.has_pending(task.id, ResearchJobType.FULLTEXT):
            return task, False, "fulltext_already_pending"
        target_paper_ids = [str(x).strip() for x in (paper_ids or []) if str(x).strip()]
        paper_rows = ResearchPaperRepo(db).list_for_task(task.id)
        if target_paper_ids:
            known_ids = {_paper_token(row) for row in paper_rows}
            if not any(paper_id in known_ids for paper_id in target_paper_ids):
                return task, False, "paper_missing"
        elif not paper_rows:
            return task, False, "no_papers"
        job_repo.enqueue(
            task.id,
            ResearchJobType.FULLTEXT,
            {"force": bool(force), "paper_ids": target_paper_ids},
            queue_name=self.settings.research_queue_name,
        )
        task.status = ResearchTaskStatus.SEARCHING
        task.updated_at = datetime.now(timezone.utc)
        db.add(task)
        db.flush()
        self._emit_step_progress(
            db,
            task=task,
            step="fulltext_queued",
            title="全文处理已排队",
            message="正在准备抓取与解析论文全文。",
            status="queued",
            details={"force": bool(force), "paper_count": len(target_paper_ids)},
        )
        return task, True, None

    def enqueue_graph_build(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        direction_index: int | None = None,
        round_id: int | None = None,
        view: str = ResearchGraphViewType.CITATION.value,
        citation_sources: list[str] | None = None,
        seed_top_n: int | None = None,
        expand_limit_per_paper: int | None = None,
        force_refresh: bool = False,
        force: bool = False,
    ) -> tuple[ResearchTask, bool, str | None]:
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        if not self.settings.research_graph_enabled:
            raise ValueError("research graph is disabled")
        job_repo = ResearchJobRepo(db)
        if not force and job_repo.has_pending(task.id, ResearchJobType.GRAPH_BUILD):
            return task, False, "graph_already_pending"
        if not round_id:
            direction_count = len(ResearchDirectionRepo(db).list_for_task(task.id))
            round_count = len(ResearchRoundRepo(db).list_for_task(task.id))
            paper_count = len(ResearchPaperRepo(db).list_for_task(task.id))
            if direction_count == 0 and round_count == 0 and paper_count == 0:
                return task, False, "no_graph_seed"
        payload = {
            "direction_index": direction_index,
            "round_id": round_id,
            "view": (view or ResearchGraphViewType.CITATION.value).strip().lower(),
            "citation_sources": citation_sources,
            "seed_top_n": seed_top_n,
            "expand_limit_per_paper": expand_limit_per_paper,
            "force": bool(force),
            "force_refresh": bool(force_refresh),
        }
        job_repo.enqueue(task.id, ResearchJobType.GRAPH_BUILD, payload, queue_name=self.settings.research_queue_name)
        task.status = ResearchTaskStatus.SEARCHING
        task.updated_at = datetime.now(timezone.utc)
        db.add(task)
        db.flush()
        self._emit_step_progress(
            db,
            task=task,
            step="graph_queued",
            title="图谱构建已排队",
            message="正在准备构建研究图谱。",
            status="queued",
            details=payload,
        )
        return task, True, None

    def start_exploration(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        direction_index: int,
        top_n: int | None = None,
        year_from: int | None = None,
        year_to: int | None = None,
        sources: list[str] | None = None,
    ) -> tuple[ResearchTask, ResearchRound]:
        if not self.settings.research_exploration_enabled:
            raise ValueError("research exploration is disabled")
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        direction = ResearchDirectionRepo(db).get_by_index(task.id, direction_index)
        if not direction:
            raise ValueError("direction not found")

        round_repo = ResearchRoundRepo(db)
        max_rounds = max(1, int(self.settings.research_max_rounds))
        if round_repo.count_for_task_direction(task.id, direction_index) >= max_rounds:
            raise ValueError(f"max rounds reached ({max_rounds})")

        query_terms = _load_json_list(direction.queries_json) or [direction.name]
        round_row = round_repo.create(
            task_id=task.id,
            direction_index=direction_index,
            parent_round_id=None,
            depth=1,
            action=ResearchActionType.EXPAND.value,
            feedback_text=None,
            query_terms=query_terms[:4],
            status=ResearchRoundStatus.QUEUED.value,
        )
        payload = {
            "direction_index": direction_index,
            "top_n": top_n or self.settings.research_round_topn_default,
            "force_refresh": False,
            "round_id": round_row.id,
            "explicit_queries": query_terms[:4],
            "constraints_override": {
                "year_from": year_from,
                "year_to": year_to,
                "sources": sources,
            },
        }
        ResearchJobRepo(db).enqueue(task.id, ResearchJobType.SEARCH, payload, queue_name=self.settings.research_queue_name)
        task.status = ResearchTaskStatus.SEARCHING
        task.updated_at = datetime.now(timezone.utc)
        db.add(task)
        db.flush()
        self._emit_step_progress(
            db,
            task=task,
            step="exploration_started",
            title="探索轮次已创建",
            message=f"已为方向 {direction_index} 创建第 1 轮探索。",
            status="queued",
            details={"direction_index": direction_index, "round_id": round_row.id},
        )
        return task, round_row

    def propose_round_candidates(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        round_id: int,
        action: str,
        feedback_text: str,
        candidate_count: int | None = None,
    ) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        round_repo = ResearchRoundRepo(db)
        round_row = round_repo.get(round_id)
        if not round_row or round_row.task_id != task.id:
            raise ValueError("round not found")
        action_norm = (action or "").strip().lower()
        valid_actions = {item.value for item in ResearchActionType}
        if action_norm not in valid_actions:
            raise ValueError("invalid action")
        if action_norm == ResearchActionType.STOP.value:
            round_repo.update_status(round_row, ResearchRoundStatus.STOPPED.value)
            return {"task_id": task.task_id, "round_id": round_id, "action": action_norm, "candidates": []}

        candidate_n = max(2, min(5, int(candidate_count or self.settings.research_round_candidate_default)))
        references = self._round_reference_titles(db, round_id=round_row.id, limit=8)
        generated = self._generate_round_candidates(
            task_topic=task.topic,
            action=action_norm,
            feedback_text=feedback_text,
            query_terms=_load_json_list(round_row.query_terms_json),
            references=references,
            candidate_count=candidate_n,
            project_context=self._project_context_prompt(db, task=task),
        )
        repo = ResearchRoundCandidateRepo(db)
        rows = self._run_with_locked_retry(db, lambda: repo.replace_for_round(round_row.id, generated))
        out = []
        for row in rows:
            out.append(
                {
                    "candidate_id": row.id,
                    "candidate_index": row.candidate_index,
                    "name": row.name,
                    "queries": _load_json_list(row.queries_json),
                    "reason": row.reason,
                }
            )
        round_row.action = ResearchActionType(action_norm)
        round_row.feedback_text = (feedback_text or "").strip()[:2000] or None
        round_row.updated_at = datetime.now(timezone.utc)
        db.add(round_row)
        db.flush()
        self._emit_step_progress(
            db,
            task=task,
            step="candidates_generated",
            title="候选方向已生成",
            message=f"第 {round_row.id} 轮已生成 {len(out)} 个候选方向。",
            status="done",
            details={"round_id": round_row.id, "action": action_norm, "candidate_count": len(out)},
        )
        return {"task_id": task.task_id, "round_id": round_row.id, "action": action_norm, "candidates": out}

    def select_round_candidate(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        round_id: int,
        candidate_id: int,
        top_n: int | None = None,
        force_refresh: bool = False,
    ) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        round_repo = ResearchRoundRepo(db)
        parent = round_repo.get(round_id)
        if not parent or parent.task_id != task.id:
            raise ValueError("round not found")
        candidate_repo = ResearchRoundCandidateRepo(db)
        candidate = candidate_repo.get_by_id(candidate_id)
        if not candidate or candidate.round_id != parent.id:
            fallback = candidate_repo.get_by_index(parent.id, candidate_id)
            if not fallback:
                raise ValueError("candidate not found")
            candidate = fallback
        candidate_repo.mark_selected(candidate)

        max_rounds = max(1, int(self.settings.research_max_rounds))
        if parent.depth >= max_rounds:
            raise ValueError(f"max rounds reached ({max_rounds})")
        child = round_repo.create(
            task_id=task.id,
            direction_index=parent.direction_index,
            parent_round_id=parent.id,
            depth=parent.depth + 1,
            action=parent.action.value,
            feedback_text=parent.feedback_text,
            query_terms=_load_json_list(candidate.queries_json),
            status=ResearchRoundStatus.QUEUED.value,
        )
        payload = {
            "direction_index": parent.direction_index,
            "top_n": top_n or self.settings.research_round_topn_default,
            "force_refresh": bool(force_refresh),
            "round_id": child.id,
            "explicit_queries": _load_json_list(candidate.queries_json),
        }
        ResearchJobRepo(db).enqueue(task.id, ResearchJobType.SEARCH, payload, queue_name=self.settings.research_queue_name)
        task.status = ResearchTaskStatus.SEARCHING
        task.updated_at = datetime.now(timezone.utc)
        db.add(task)
        db.flush()
        self._emit_step_progress(
            db,
            task=task,
            step="candidate_selected",
            title="候选方向已选中",
            message=f"已从第 {parent.id} 轮派生新的探索轮次。",
            status="queued",
            details={"parent_round_id": parent.id, "child_round_id": child.id, "candidate_id": candidate.id},
        )
        return {
            "task_id": task.task_id,
            "parent_round_id": parent.id,
            "child_round_id": child.id,
            "status": task.status.value,
            "queued": True,
        }

    def create_next_round_from_intent(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        round_id: int,
        intent_text: str,
        top_n: int | None = None,
        force_refresh: bool = False,
    ) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        parent = ResearchRoundRepo(db).get(round_id)
        if not parent or parent.task_id != task.id:
            raise ValueError("round not found")
        intent = (intent_text or "").strip()
        if not intent:
            raise ValueError("intent_text is required")
        max_rounds = max(1, int(self.settings.research_max_rounds))
        if parent.depth >= max_rounds:
            raise ValueError(f"max rounds reached ({max_rounds})")

        direction = ResearchDirectionRepo(db).get_by_index(task.id, parent.direction_index)
        references = self._round_reference_titles(db, round_id=parent.id, limit=8)
        queries = self._generate_queries_from_intent(
            task_topic=task.topic,
            direction_name=direction.name if direction else "",
            intent_text=intent,
            current_queries=_load_json_list(parent.query_terms_json),
            references=references,
            project_context=self._project_context_prompt(db, task=task),
        )
        child = ResearchRoundRepo(db).create(
            task_id=task.id,
            direction_index=parent.direction_index,
            parent_round_id=parent.id,
            depth=parent.depth + 1,
            action=parent.action.value,
            feedback_text=intent,
            query_terms=queries[:4],
            status=ResearchRoundStatus.QUEUED.value,
        )
        payload = {
            "direction_index": parent.direction_index,
            "top_n": top_n or self.settings.research_round_topn_default,
            "force_refresh": bool(force_refresh),
            "round_id": child.id,
            "explicit_queries": queries[:4],
        }
        ResearchJobRepo(db).enqueue(task.id, ResearchJobType.SEARCH, payload, queue_name=self.settings.research_queue_name)
        task.status = ResearchTaskStatus.SEARCHING
        task.updated_at = datetime.now(timezone.utc)
        db.add(task)
        db.flush()
        self._emit_step_progress(
            db,
            task=task,
            step="next_round_created",
            title="下一轮探索已创建",
            message=f"已根据新的探索意图创建第 {child.id} 轮。",
            status="queued",
            details={"parent_round_id": parent.id, "child_round_id": child.id},
        )
        return {
            "task_id": task.task_id,
            "parent_round_id": parent.id,
            "child_round_id": child.id,
            "status": task.status.value,
            "queued": True,
        }

    def enqueue_round_citation_build(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        round_id: int,
        seed_top_n: int | None = None,
        expand_limit_per_paper: int | None = None,
        citation_sources: list[str] | None = None,
        force_refresh: bool = False,
    ) -> tuple[ResearchTask, bool]:
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        round_row = ResearchRoundRepo(db).get(round_id)
        if not round_row or round_row.task_id != task.id:
            raise ValueError("round not found")
        job_repo = ResearchJobRepo(db)
        if not force_refresh and job_repo.has_pending(task.id, ResearchJobType.GRAPH_BUILD):
            return task, False
        payload = {
            "round_id": round_id,
            "direction_index": round_row.direction_index,
            "view": ResearchGraphViewType.CITATION.value,
            "seed_top_n": seed_top_n,
            "expand_limit_per_paper": expand_limit_per_paper,
            "citation_sources": citation_sources,
            "force_refresh": bool(force_refresh),
        }
        job_repo.enqueue(task.id, ResearchJobType.GRAPH_BUILD, payload, queue_name=self.settings.research_queue_name)
        task.status = ResearchTaskStatus.SEARCHING
        task.updated_at = datetime.now(timezone.utc)
        db.add(task)
        db.flush()
        return task, True

    def get_exploration_tree(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        include_papers: bool = False,
        paper_limit: int | None = None,
    ) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        return self._build_tree_graph(db, task, include_papers=include_papers, paper_limit=paper_limit)

    def list_graph_snapshots(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        view: str | None = None,
        limit: int = 10,
    ) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        rows = ResearchGraphSnapshotRepo(db).list_recent(task.id, view_type=view, limit=limit)
        items = []
        for row in rows:
            nodes = _load_json_list_of_dict(row.nodes_json)
            edges = _load_json_list_of_dict(row.edges_json)
            items.append(
                {
                    "snapshot_id": row.id,
                    "direction_index": row.direction_index,
                    "round_id": row.round_id,
                    "view": row.view_type.value,
                    "status": row.status.value,
                    "nodes": len(nodes),
                    "edges": len(edges),
                    "updated_at": row.updated_at,
                }
            )
        return {"task_id": task.task_id, "items": items}

    def process_one_job(
        self,
        db: Session,
        *,
        worker_id: str | None = None,
        queue_name: str | None = None,
        lease_seconds: int | None = None,
    ) -> int:
        job_repo = ResearchJobRepo(db)
        queue = (queue_name or self.settings.research_queue_name).strip() or "research"
        if worker_id:
            job = job_repo.claim_next(
                worker_id=worker_id,
                lease_seconds=int(lease_seconds or self.settings.research_job_lease_seconds),
                queue_name=queue,
            )
        else:
            job = job_repo.next_queued(queue_name=queue)
        if not job:
            return 0
        started_at = perf_counter()
        task = db.get(ResearchTask, job.task_id)
        if not task:
            job_repo.mark_failed(job, "task_not_found")
            self._record_job_metric()
            return 1
        payload = {}
        try:
            payload = orjson.loads(job.payload_json)
        except Exception:
            payload = {}

        if not worker_id:
            job_repo.mark_running(job)

        # Release the SQLite write lock before running slow LLM/network work.
        # The worker uses expire_on_commit=False, so the claimed job/task rows remain usable.
        db.commit()

        last_beat = perf_counter()

        def touch_lease() -> None:
            nonlocal last_beat
            if not worker_id:
                return
            hb_interval = max(3, int(self.settings.research_job_heartbeat_seconds))
            if perf_counter() - last_beat < hb_interval:
                return
            job_repo.heartbeat(
                job,
                worker_id=worker_id,
                lease_seconds=int(lease_seconds or self.settings.research_job_lease_seconds),
            )
            db.commit()
            last_beat = perf_counter()

        job_error: str | None = None
        try:
            if job.job_type == ResearchJobType.PLAN:
                self._run_plan_job(db, task, payload, touch_lease=touch_lease)
            elif job.job_type == ResearchJobType.SEARCH:
                self._run_search_job(db, task, payload, touch_lease=touch_lease)
            elif job.job_type == ResearchJobType.FULLTEXT:
                self._run_fulltext_job(db, task, payload, touch_lease=touch_lease)
            elif job.job_type == ResearchJobType.GRAPH_BUILD:
                self._run_graph_job(db, task, payload, touch_lease=touch_lease)
            elif job.job_type == ResearchJobType.PAPER_SUMMARY:
                self._run_paper_summary_job(db, task, payload, touch_lease=touch_lease)
            elif job.job_type == ResearchJobType.AUTO_RESEARCH:
                self._run_auto_research_job(db, task, payload, touch_lease=touch_lease)
            else:
                raise ValueError(f"unsupported job type: {job.job_type}")
            job_repo.mark_done(job)
        except Exception as exc:
            logger.exception("research_job_failed task_id=%s job_id=%s", task.task_id, job.id)
            job_error = self._normalize_job_error(exc)
            max_attempts = max(1, int(self.settings.research_job_max_attempts))
            if job.attempts < max_attempts:
                base_delay = max(1, int(self.settings.research_job_backoff_seconds))
                delay_seconds = min(300, base_delay * (2 ** max(0, job.attempts - 1)))
                task.status = self._task_status_for_retry(job.job_type)
                task.updated_at = datetime.now(timezone.utc)
                db.add(task)
                db.flush()
                job_repo.mark_retry(job, error=job_error, delay_seconds=delay_seconds)
                logger.warning(
                    "research_job_retry_scheduled task_id=%s job_id=%s attempt=%s/%s delay_s=%s",
                    task.task_id,
                    job.id,
                    job.attempts,
                    max_attempts,
                    delay_seconds,
                )
            else:
                task.status = ResearchTaskStatus.FAILED
                if job.job_type == ResearchJobType.AUTO_RESEARCH:
                    task.auto_status = ResearchAutoStatus.FAILED
                task.updated_at = datetime.now(timezone.utc)
                db.add(task)
                db.flush()
                job_repo.mark_failed(job, job_error)
                self._notify_user(db, task.user_id, f"调研任务 {task.task_id} 失败：{job_error[:120]}")
        finally:
            latency_ms = int((perf_counter() - started_at) * 1000)
            self._record_job_metric(latency_ms=latency_ms)
        return 1

    def get_active_task(self, db: Session, user_id: int) -> ResearchTask | None:
        task_repo = ResearchTaskRepo(db)
        session = ResearchSessionRepo(db).get_or_create(user_id, page_size=self.settings.research_page_size)
        if session.active_task_id:
            row = task_repo.get_by_task_id(session.active_task_id, user_id=user_id)
            if row:
                return row
        items = task_repo.list_recent(user_id=user_id, limit=1)
        return items[0] if items else None

    def switch_task(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        remember_active: bool = True,
    ) -> ResearchTask:
        row = ResearchTaskRepo(db).get_by_task_id(task_id.strip(), user_id=user_id)
        if not row:
            raise ValueError("task not found")
        if remember_active:
            session = ResearchSessionRepo(db).get_or_create(user_id, page_size=self.settings.research_page_size)
            ResearchSessionRepo(db).set_active_task(session, row.task_id)
        return row

    def list_projects(self, db: Session, *, user_id: int) -> dict:
        repo = ResearchProjectRepo(db)
        default_project = self._get_or_create_project(db, user_id=user_id)
        rows = repo.list_for_user(user_id)
        return {
            "items": [self._project_to_dict(db, row) for row in rows],
            "total": len(rows),
            "default_project_id": default_project.project_key if default_project else None,
        }

    def create_project(self, db: Session, *, user_id: int, name: str, description: str | None = None) -> dict:
        repo = ResearchProjectRepo(db)
        now = datetime.now(timezone.utc)
        project = ResearchProject(
            project_key=f"project-{uuid4().hex[:10]}",
            user_id=user_id,
            name=name.strip()[:255],
            description=(description or "").strip() or None,
            is_default=False,
            created_at=now,
            updated_at=now,
        )
        repo.create(project)
        return self._project_to_dict(db, project)

    def get_project(self, db: Session, *, user_id: int, project_id: str) -> dict:
        row = self._get_or_create_project(db, user_id=user_id, project_id=project_id)
        return self._project_to_dict(db, row)

    def get_project_dashboard(self, db: Session, *, user_id: int, project_id: str) -> dict:
        project = self._get_or_create_project(db, user_id=user_id, project_id=project_id)
        task_rows = ResearchTaskRepo(db).list_recent(user_id=user_id, limit=500, project_id=project.id)
        collection_rows = ResearchCollectionRepo(db).list_for_project(project.id)
        paper_count = 0
        saved_paper_count = 0
        recent_runs: list[dict] = []
        for task in task_rows:
            papers = ResearchPaperRepo(db).list_for_task(task.id)
            paper_count += len(papers)
            saved_paper_count += sum(1 for paper in papers if paper.saved)
            latest_run = ResearchRunEventRepo(db).latest_for_task(task.id)
            if latest_run:
                recent_runs.append(
                    {
                        "task_id": task.task_id,
                        "run_id": latest_run.run_id,
                        "topic": task.topic,
                        "mode": task.mode.value,
                        "auto_status": task.auto_status.value,
                        "updated_at": latest_run.created_at,
                    }
                )
        recent_runs.sort(key=lambda item: item["updated_at"], reverse=True)
        workbench_config = self.get_workbench_config()
        return {
            "project": self._project_to_dict(db, project),
            "task_count": len(task_rows),
            "collection_count": len(collection_rows),
            "paper_count": paper_count,
            "saved_paper_count": saved_paper_count,
            "recent_tasks": [self._task_to_dict(db, row) for row in task_rows[:5]],
            "recent_runs": recent_runs[:8],
            "provider_status": workbench_config["provider_status"],
            "recent_exports": [self._export_record_to_dict(row) for row in ResearchExportRecordRepo(db).list_recent_for_project(project.id, limit=8)],
            "recent_collections": [self._collection_to_dict(db, row, include_items=False) for row in collection_rows[:6]],
        }

    def list_collections(self, db: Session, *, user_id: int, project_id: str) -> dict:
        project = self._get_or_create_project(db, user_id=user_id, project_id=project_id)
        rows = ResearchCollectionRepo(db).list_for_project(project.id)
        return {"items": [self._collection_to_dict(db, row, include_items=False) for row in rows], "total": len(rows)}

    def create_collection(
        self,
        db: Session,
        *,
        user_id: int,
        project_id: str,
        name: str,
        description: str | None = None,
        source_type: str = "manual",
        source_ref: str | None = None,
    ) -> dict:
        project = self._get_or_create_project(db, user_id=user_id, project_id=project_id)
        now = datetime.now(timezone.utc)
        row = ResearchCollection(
            collection_id=f"collection-{uuid4().hex[:10]}",
            project_id=project.id,
            name=name.strip()[:255],
            description=(description or "").strip() or None,
            source_type=(source_type or "manual").strip()[:32] or "manual",
            source_ref=(source_ref or "").strip()[:255] or None,
            created_at=now,
            updated_at=now,
        )
        ResearchCollectionRepo(db).create(row)
        return self._collection_to_dict(db, row)

    def get_collection(
        self,
        db: Session,
        *,
        user_id: int,
        collection_id: str,
        offset: int = 0,
        limit: int = 50,
    ) -> dict:
        row = ResearchCollectionRepo(db).get_by_collection_id(user_id=user_id, collection_id=collection_id)
        if not row:
            raise ValueError("collection not found")
        return self._collection_to_dict(db, row, offset=offset, limit=limit)

    def add_collection_items(self, db: Session, *, user_id: int, collection_id: str, items: list[dict]) -> dict:
        collection = ResearchCollectionRepo(db).get_by_collection_id(user_id=user_id, collection_id=collection_id)
        if not collection:
            raise ValueError("collection not found")
        return self._add_collection_items_with_stats(db, collection=collection, items=items)["collection"]

    def remove_collection_item(self, db: Session, *, user_id: int, collection_id: str, item_id: int) -> dict:
        collection = ResearchCollectionRepo(db).get_by_collection_id(user_id=user_id, collection_id=collection_id)
        if not collection:
            raise ValueError("collection not found")
        row = ResearchCollectionItemRepo(db).get_by_id(item_id)
        if not row or row.collection_id != collection.id:
            raise ValueError("collection item not found")
        ResearchCollectionItemRepo(db).delete(row)
        collection.updated_at = datetime.now(timezone.utc)
        db.add(collection)
        db.flush()
        return self._collection_to_dict(db, collection)

    def remove_collection_items(self, db: Session, *, user_id: int, collection_id: str, item_ids: list[int]) -> dict:
        collection = ResearchCollectionRepo(db).get_by_collection_id(user_id=user_id, collection_id=collection_id)
        if not collection:
            raise ValueError("collection not found")
        item_repo = ResearchCollectionItemRepo(db)
        rows = []
        for item_id in item_ids:
            row = item_repo.get_by_id(int(item_id))
            if row and row.collection_id == collection.id:
                rows.append(row)
        if rows:
            item_repo.delete_many(rows)
        collection.updated_at = datetime.now(timezone.utc)
        db.add(collection)
        db.flush()
        return self._collection_to_dict(db, collection)

    def create_study_from_collection(
        self,
        db: Session,
        *,
        user_id: int,
        collection_id: str,
        topic: str | None = None,
        mode: str | ResearchRunMode = ResearchRunMode.GPT_STEP,
        llm_backend: str | ResearchLLMBackend = ResearchLLMBackend.GPT,
        llm_model: str | None = None,
    ) -> dict:
        collection = ResearchCollectionRepo(db).get_by_collection_id(user_id=user_id, collection_id=collection_id)
        if not collection:
            raise ValueError("collection not found")
        items = ResearchCollectionItemRepo(db).list_for_collection(collection.id)
        if not items:
            raise ValueError("collection is empty")
        task = self.create_task(
            db,
            user_id=user_id,
            project_id=collection.project.project_key,
            topic=(topic or f"{collection.name} 集合研究").strip(),
            constraints={
                "seed_collection_id": collection.collection_id,
                "derived_from_collection_id": collection.collection_id,
                "sources": list(_resolve_sources(None, self.settings.research_sources_default)),
            },
            mode=mode,
            llm_backend=llm_backend,
            llm_model=llm_model,
        )
        return self.get_task(db, user_id=user_id, task_id=task.task_id)

    def summarize_collection(self, db: Session, *, user_id: int, collection_id: str) -> dict:
        collection = ResearchCollectionRepo(db).get_by_collection_id(user_id=user_id, collection_id=collection_id)
        if not collection:
            raise ValueError("collection not found")
        items = ResearchCollectionItemRepo(db).list_for_collection(collection.id)
        summary = self._summarize_collection_items(collection.name, items)
        collection.summary_text = summary
        collection.updated_at = datetime.now(timezone.utc)
        db.add(collection)
        db.flush()
        return {
            "collection_id": collection.collection_id,
            "summary_text": summary,
            "item_count": len(items),
        }

    def build_collection_graph(self, db: Session, *, user_id: int, collection_id: str) -> dict:
        collection = ResearchCollectionRepo(db).get_by_collection_id(user_id=user_id, collection_id=collection_id)
        if not collection:
            raise ValueError("collection not found")
        items = ResearchCollectionItemRepo(db).list_for_collection(collection.id)
        collection_node_id = f"collection:{collection.collection_id}"
        nodes = [
            {
                "id": collection_node_id,
                "type": "group",
                "label": collection.name,
                "summary": collection.summary_text or self._summarize_collection_items(collection.name, items),
            }
        ]
        edges = []
        for index, item in enumerate(items, start=1):
            node_id = item.paper_id or f"collection-item:{item.id}"
            nodes.append(
                {
                    "id": node_id,
                    "type": "paper",
                    "label": item.title,
                    "year": item.year,
                    "venue": item.venue,
                    "source": item.source,
                    "summary": _load_json_dict(item.metadata_json).get("abstract") or item.title,
                }
            )
            edges.append(
                {
                    "source": collection_node_id,
                    "target": node_id,
                    "type": "collection_paper",
                    "weight": 1.0,
                }
            )
            if index > 1:
                prev = items[index - 2]
                prev_id = prev.paper_id or f"collection-item:{prev.id}"
                edges.append(
                    {
                        "source": prev_id,
                        "target": node_id,
                        "type": "collection_sequence",
                        "weight": 0.5,
                    }
                )
        return {
            "collection_id": collection.collection_id,
            "nodes": nodes,
            "edges": edges,
            "stats": {"node_count": len(nodes), "edge_count": len(edges), "item_count": len(items)},
        }

    def compare_task_papers(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        paper_ids: list[str],
        focus: str | None = None,
    ) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id, remember_active=False)
        if len(paper_ids) < 2:
            raise ValueError("at least two papers are required for compare")
        papers = []
        for paper_id in paper_ids:
            paper = ResearchPaperRepo(db).get_by_token(task.id, paper_id)
            if paper:
                papers.append(paper)
        if len(papers) < 2:
            raise ValueError("at least two valid papers are required for compare")
        report = self._build_compare_report(
            db,
            project_id=task.project_id,
            task=task,
            collection=None,
            scope="task_papers",
            title=f"{task.topic} 论文对比",
            focus=focus,
            items=[self._paper_compare_item(paper) for paper in papers],
            llm_backend=task.llm_backend.value,
            llm_model=task.llm_model,
        )
        return self._compare_report_to_dict(report)

    def compare_collection(self, db: Session, *, user_id: int, collection_id: str, focus: str | None = None) -> dict:
        collection = ResearchCollectionRepo(db).get_by_collection_id(user_id=user_id, collection_id=collection_id)
        if not collection:
            raise ValueError("collection not found")
        items = ResearchCollectionItemRepo(db).list_for_collection(collection.id)
        if len(items) < 2:
            raise ValueError("collection needs at least two papers for compare")
        recent_tasks = ResearchTaskRepo(db).list_recent(user_id=collection.project.user_id, project_id=collection.project_id, limit=1)
        backend = recent_tasks[0].llm_backend.value if recent_tasks else ResearchLLMBackend.GPT.value
        model = recent_tasks[0].llm_model if recent_tasks else (self.settings.research_gpt_model or None)
        report = self._build_compare_report(
            db,
            project_id=collection.project_id,
            task=None,
            collection=collection,
            scope="collection",
            title=f"{collection.name} 集合对比",
            focus=focus,
            items=[self._collection_compare_item(item) for item in items],
            llm_backend=backend,
            llm_model=model,
        )
        return self._compare_report_to_dict(report)

    def list_exports(self, db: Session, *, user_id: int, task_id: str) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id, remember_active=False)
        rows = ResearchExportRecordRepo(db).list_for_task(task.id, limit=50)
        return {
            "task_id": task.task_id,
            "items": [self._export_record_to_dict(row) for row in rows],
        }

    def list_collection_exports(self, db: Session, *, user_id: int, collection_id: str) -> dict:
        collection = ResearchCollectionRepo(db).get_by_collection_id(user_id=user_id, collection_id=collection_id)
        if not collection:
            raise ValueError("collection not found")
        rows = ResearchCollectionExportRecordRepo(db).list_for_collection(collection.id, limit=50)
        return {
            "collection_id": collection.collection_id,
            "items": [self._export_record_to_dict(row) for row in rows],
        }

    def get_task_export_download_path(self, db: Session, *, user_id: int, task_id: str, record_id: int) -> str:
        task = self.switch_task(db, user_id=user_id, task_id=task_id, remember_active=False)
        row = ResearchExportRecordRepo(db).get_for_task(task.id, record_id)
        if not row or not row.output_path:
            raise ValueError("export record not found")
        path = Path(row.output_path)
        if not path.exists():
            raise ValueError("export artifact not found")
        return str(path)

    def get_collection_export_download_path(self, db: Session, *, user_id: int, collection_id: str, record_id: int) -> str:
        collection = ResearchCollectionRepo(db).get_by_collection_id(user_id=user_id, collection_id=collection_id)
        if not collection:
            raise ValueError("collection not found")
        row = ResearchCollectionExportRecordRepo(db).get_for_collection(collection.id, record_id)
        if not row or not row.output_path:
            raise ValueError("export record not found")
        path = Path(row.output_path)
        if not path.exists():
            raise ValueError("export artifact not found")
        return str(path)

    def get_zotero_config(self) -> dict:
        legacy_enabled = bool(self.settings.zotero_base_url)
        legacy_configured = bool(self.settings.zotero_base_url and self.settings.zotero_library_id.strip())
        return {
            "enabled": True,
            "mode": "local_default",
            "import_formats": ["csljson", "bib"],
            "export_targets": ["task", "collection"],
            "legacy_web_api_enabled": legacy_enabled,
            "legacy_web_api_configured": legacy_configured,
            "base_url": self.settings.zotero_base_url,
            "library_type": self.settings.zotero_library_type,
            "library_id": self.settings.zotero_library_id or None,
            "has_api_key": bool(self.settings.zotero_api_key.strip()),
        }

    def import_zotero_collection(
        self,
        db: Session,
        *,
        user_id: int,
        project_id: str,
        collection_key: str | None = None,
        collection_name: str | None = None,
        library_type: str | None = None,
        library_id: str | None = None,
        api_key: str | None = None,
        limit: int | None = None,
    ) -> dict:
        project = self._get_or_create_project(db, user_id=user_id, project_id=project_id)
        base_url = self.settings.zotero_base_url.rstrip("/")
        lib_type = (library_type or self.settings.zotero_library_type or "users").strip()
        lib_id = (library_id or self.settings.zotero_library_id or "").strip()
        token = (api_key or self.settings.zotero_api_key or "").strip()
        if not base_url or not lib_id:
            raise ValueError("zotero is not configured")

        headers = {"Zotero-API-Version": "3"}
        if token:
            headers["Zotero-API-Key"] = token

        target_name = (collection_name or "").strip()
        source_ref = collection_key or lib_id
        if collection_key:
            collection_resp = self._http_get_json(
                f"{base_url}/{lib_type}/{quote_plus(lib_id)}/collections/{quote_plus(collection_key)}",
                headers=headers,
            )
            if isinstance(collection_resp, dict):
                data = collection_resp.get("data") if isinstance(collection_resp.get("data"), dict) else collection_resp
                target_name = target_name or str(data.get("name") or f"Zotero {collection_key}")
            items_resp = self._http_get_json(
                f"{base_url}/{lib_type}/{quote_plus(lib_id)}/collections/{quote_plus(collection_key)}/items/top",
                headers=headers,
                params={"limit": max(1, min(200, int(limit or 100)))},
            )
        else:
            target_name = target_name or "Zotero 导入"
            items_resp = self._http_get_json(
                f"{base_url}/{lib_type}/{quote_plus(lib_id)}/items/top",
                headers=headers,
                params={"limit": max(1, min(200, int(limit or 100)))},
            )

        collection = self.create_collection(
            db,
            user_id=user_id,
            project_id=project.project_key,
            name=target_name,
            description="Imported from Zotero",
            source_type="zotero",
            source_ref=source_ref,
        )
        raw_items = items_resp if isinstance(items_resp, list) else []
        normalized_items = [self._normalize_zotero_item(item) for item in raw_items]
        normalized_items = [item for item in normalized_items if item]
        stats = self._add_collection_items_with_stats(
            db,
            collection=ResearchCollectionRepo(db).get_by_collection_id(user_id=user_id, collection_id=collection["collection_id"]),
            items=normalized_items,
        )
        return {
            "project_id": project.project_key,
            "collection": stats["collection"],
            "imported": stats["imported_items"],
            "total_items": len(normalized_items),
            "imported_items": stats["imported_items"],
            "deduped_items": stats["deduped_items"],
            "linked_existing_papers": stats["linked_existing_papers"],
            "format": "legacy_web_api",
        }

    def import_zotero_local_file(
        self,
        db: Session,
        *,
        user_id: int,
        project_id: str | None,
        filename: str,
        content: bytes,
        collection_name: str | None = None,
    ) -> dict:
        if not content:
            raise ValueError("uploaded file is empty")
        fmt = self._detect_zotero_import_format(filename=filename, content=content)
        payloads = self._parse_zotero_local_file(filename=filename, content=content, fmt=fmt)
        if not payloads:
            raise ValueError("no importable items found in file")
        project = self._get_or_create_project(db, user_id=user_id, project_id=project_id)
        target_name = (collection_name or "").strip() or Path(filename or "zotero-import").stem or "Zotero Import"
        collection = self.create_collection(
            db,
            user_id=user_id,
            project_id=project.project_key,
            name=target_name,
            description="Imported from local Zotero export",
            source_type="zotero_local",
            source_ref=(filename or "").strip() or None,
        )
        collection_row = ResearchCollectionRepo(db).get_by_collection_id(user_id=user_id, collection_id=collection["collection_id"])
        if not collection_row:
            raise ValueError("collection not found after creation")
        stats = self._add_collection_items_with_stats(db, collection=collection_row, items=payloads)
        return {
            "project_id": project.project_key,
            "collection": stats["collection"],
            "imported": stats["imported_items"],
            "total_items": len(payloads),
            "imported_items": stats["imported_items"],
            "deduped_items": stats["deduped_items"],
            "linked_existing_papers": stats["linked_existing_papers"],
            "format": fmt,
        }

    def list_tasks(self, db: Session, *, user_id: int, limit: int = 10, project_id: str | None = None) -> list[dict]:
        project_row = self._get_or_create_project(db, user_id=user_id, project_id=project_id) if project_id else None
        rows = ResearchTaskRepo(db).list_recent(user_id=user_id, limit=limit, project_id=project_row.id if project_row else None)
        return [self._task_to_dict(db, row) for row in rows]

    def get_task(self, db: Session, *, user_id: int, task_id: str) -> dict:
        row = ResearchTaskRepo(db).get_by_task_id(task_id, user_id=user_id)
        if not row:
            raise ValueError("task not found")
        return self._task_to_dict(db, row)

    def get_active_task_snapshot(self, db: Session, *, user_id: int) -> dict | None:
        row = self.get_active_task(db, user_id)
        if not row:
            return None
        return self._task_to_dict(db, row)

    def get_workbench_config(self) -> dict:
        discovery_providers = ["semantic_scholar", "openalex", "arxiv"]
        citation_providers = _resolve_citation_sources(None, self.settings.research_citation_sources_default)
        provider_status = [
            {
                "key": "semantic_scholar",
                "role": "discovery",
                "enabled": True,
                "configured": bool(self.settings.semantic_scholar_api_key.strip()),
                "detail": "API key optional",
            },
            {
                "key": "arxiv",
                "role": "discovery",
                "enabled": True,
                "configured": True,
                "detail": "Public feed",
            },
            {
                "key": "openalex",
                "role": "discovery",
                "enabled": True,
                "configured": True,
                "detail": "Public API",
            },
            {
                "key": "semantic_scholar",
                "role": "citation",
                "enabled": "semantic_scholar" in citation_providers,
                "configured": bool(self.settings.semantic_scholar_api_key.strip()),
                "detail": "Citation graph source",
            },
            {
                "key": "openalex",
                "role": "citation",
                "enabled": "openalex" in citation_providers,
                "configured": True,
                "detail": "Citation graph source",
            },
            {
                "key": "crossref",
                "role": "citation",
                "enabled": "crossref" in citation_providers,
                "configured": True,
                "detail": "Citation fallback",
            },
            {
                "key": "zotero",
                "role": "integration",
                "enabled": True,
                "configured": bool(self.settings.zotero_library_id.strip()),
                "detail": "Import only",
            },
            {
                "key": "paper_visual",
                "role": "visual",
                "enabled": True,
                "configured": True,
                "detail": f"{self.settings.paper_visual_provider.title()} fallback",
            },
            {
                "key": "diffusion",
                "role": "visual",
                "enabled": bool(self.settings.paper_visual_diffusion_enabled),
                "configured": bool(self.settings.paper_visual_diffusion_base_url.strip()),
                "detail": "Reserved provider",
            },
        ]
        return {
            "default_mode": ResearchRunMode.GPT_STEP.value,
            "default_backend": ResearchLLMBackend.GPT.value,
            "default_gpt_model": self.settings.research_gpt_model or None,
            "default_openclaw_model": self.settings.openclaw_agent_id or "openclaw",
            "openclaw_enabled": bool(self.settings.openclaw_enabled),
            "available_modes": [item.value for item in ResearchRunMode],
            "available_backends": [item.value for item in ResearchLLMBackend],
            "discovery_providers": discovery_providers,
            "citation_providers": citation_providers,
            "provider_status": provider_status,
            "layout_defaults": {
                "layout_mode": "elk_layered",
                "spacing_x": 420,
                "spacing_y": 240,
                "paper_ring_spacing": 340,
            },
            "default_canvas_ui": self._default_canvas_ui(),
        }

    def get_canvas_state(self, db: Session, *, user_id: int, task_id: str) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id, remember_active=False)
        repo = ResearchCanvasStateRepo(db)
        row = repo.get_for_task(task.id)
        if row:
            state = _load_json_dict(row.state_json)
            return {
                "task_id": task.task_id,
                "nodes": list(state.get("nodes") or []),
                "edges": list(state.get("edges") or []),
                "viewport": dict(state.get("viewport") or {"x": 0, "y": 0, "zoom": 1}),
                "ui": dict(state.get("ui") or self._default_canvas_ui()),
                "updated_at": row.updated_at,
            }
        graph = self.get_graph_snapshot(
            db,
            user_id=user_id,
            task_id=task.task_id,
            view=ResearchGraphViewType.TREE.value,
            include_papers=True,
            paper_limit=self.settings.research_graph_paper_limit_default,
        )
        state = self._default_canvas_from_graph(task_id=task.task_id, graph=graph)
        saved = repo.upsert(task.id, state)
        return {
            "task_id": task.task_id,
            "nodes": list(state.get("nodes") or []),
            "edges": list(state.get("edges") or []),
            "viewport": dict(state.get("viewport") or {"x": 0, "y": 0, "zoom": 1}),
            "ui": dict(state.get("ui") or self._default_canvas_ui()),
            "updated_at": saved.updated_at,
        }

    def save_canvas_state(self, db: Session, *, user_id: int, task_id: str, state: dict) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id, remember_active=False)
        task_token = task.task_id
        payload = {
            "nodes": list(state.get("nodes") or []),
            "edges": list(state.get("edges") or []),
            "viewport": dict(state.get("viewport") or {"x": 0, "y": 0, "zoom": 1}),
            "ui": {**self._default_canvas_ui(), **dict(state.get("ui") or {})},
        }
        try:
            row = self._run_with_locked_retry(
                db,
                lambda: ResearchCanvasStateRepo(db).upsert(task.id, payload),
                attempts=8,
                base_delay_seconds=0.35,
            )
        except OperationalError as exc:
            if self._is_sqlite_locked_error(exc):
                db.rollback()
                logger.warning("research_canvas_save_busy task_id=%s", task_token)
                raise CanvasStateBusyError("canvas_save_busy") from exc
            db.rollback()
            raise
        return {
            "task_id": task_token,
            "nodes": payload["nodes"],
            "edges": payload["edges"],
            "viewport": payload["viewport"],
            "ui": payload["ui"],
            "updated_at": row.updated_at,
        }

    def chat_with_node(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        node_id: str,
        question: str,
        thread_id: str | None = None,
        tags: list[str] | None = None,
    ) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id, remember_active=False)
        task_token = task.task_id
        repo = ResearchNodeChatRepo(db)
        thread = (thread_id or uuid4().hex[:12]).strip()[:64]
        context = self._resolve_node_context(db, task=task, node_id=node_id)
        project_context = self._project_context_prompt(db, task=task)
        try:
            history_rows = self._run_with_locked_retry(
                db,
                lambda: repo.list_for_node(task_id=task.id, node_id=node_id, thread_id=thread, limit=12),
                attempts=6,
                base_delay_seconds=0.25,
            )
        except OperationalError as exc:
            if self._is_sqlite_locked_error(exc):
                db.rollback()
                logger.warning("research_node_chat_read_busy task_id=%s node_id=%s", task_token, node_id)
                raise NodeChatBusyError("node_chat_busy") from exc
            db.rollback()
            raise
        history_lines = [f"Q: {row.question}\nA: {row.answer}" for row in history_rows[-4:]]
        prompt = (
            "你是 research node assistant。请只基于给定节点上下文回答，不要接管整个研究流程。\n\n"
            f"Task topic: {task.topic}\n"
            f"Node ID: {node_id}\n"
            f"Node context JSON: {orjson.dumps(context).decode('utf-8')}\n"
            f"Existing chat: {orjson.dumps(history_lines).decode('utf-8')}\n"
            f"User question: {question.strip()}\n"
            f"Tags: {orjson.dumps(tags or []).decode('utf-8')}"
        )
        prompt = (
            "你是 research node assistant。请只基于给定节点上下文回答，不要接管整个研究流程。\n\n"
            f"Task topic: {task.topic}\n"
            f"Node ID: {node_id}\n"
            f"Node context JSON: {orjson.dumps(context).decode('utf-8')}\n"
            f"Existing chat: {orjson.dumps(history_lines).decode('utf-8')}\n"
            f"User question: {question.strip()}\n"
            f"Tags: {orjson.dumps(tags or []).decode('utf-8')}"
        )
        prompt = (
            "You are a node-level research assistant inside a larger research project.\n"
            "Answer only from the provided node context and project context. Do not invent facts and do not take over the whole workflow.\n\n"
            f"Project context:\n{project_context}\n\n"
            f"Task topic: {task.topic}\n"
            f"Node ID: {node_id}\n"
            f"Node context JSON: {orjson.dumps(context).decode('utf-8')}\n"
            f"Existing chat: {orjson.dumps(history_lines).decode('utf-8')}\n"
            f"User question: {question.strip()}\n"
            f"Tags: {orjson.dumps(tags or []).decode('utf-8')}"
        )
        result = self.llm_gateway.chat_text(
            backend=task.llm_backend.value,
            model=task.llm_model,
            system_prompt="Answer in concise Chinese Markdown. Use short headings or bullet lists when helpful. Prefer evidence already present in the node context and say explicitly when evidence is limited.",
            prompt=prompt,
            temperature=0.2,
            max_tokens=900,
        )
        answer = self._sanitize_node_chat_answer(result.text, context=context, question=question)
        try:
            row = self._run_with_locked_retry(
                db,
                lambda: repo.create(
                    task_id=task.id,
                    node_id=node_id,
                    thread_id=thread,
                    question=question,
                    answer=answer,
                    provider=result.provider,
                    model=result.model,
                    context=context,
                ),
                attempts=8,
                base_delay_seconds=0.35,
            )
            history_rows = self._run_with_locked_retry(
                db,
                lambda: repo.list_for_node(task_id=task.id, node_id=node_id, thread_id=thread, limit=50),
                attempts=6,
                base_delay_seconds=0.25,
            )
        except OperationalError as exc:
            if self._is_sqlite_locked_error(exc):
                db.rollback()
                logger.warning("research_node_chat_write_busy task_id=%s node_id=%s", task_token, node_id)
                raise NodeChatBusyError("node_chat_busy") from exc
            db.rollback()
            raise
        return {
            "task_id": task_token,
            "node_id": node_id,
            "thread_id": thread,
            "item": self._node_chat_to_dict(task_token, row),
            "history": [self._node_chat_to_dict(task_token, item) for item in history_rows],
        }

    def get_node_chat_history(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        node_id: str,
        thread_id: str | None = None,
        limit: int = 50,
    ) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id, remember_active=False)
        task_token = task.task_id
        repo = ResearchNodeChatRepo(db)
        try:
            history_rows = self._run_with_locked_retry(
                db,
                lambda: repo.list_for_node(task_id=task.id, node_id=node_id, thread_id=thread_id, limit=max(1, min(200, int(limit)))),
                attempts=6,
                base_delay_seconds=0.25,
            )
        except OperationalError as exc:
            if self._is_sqlite_locked_error(exc):
                db.rollback()
                logger.warning("research_node_chat_history_busy task_id=%s node_id=%s", task_token, node_id)
                raise NodeChatBusyError("node_chat_busy") from exc
            db.rollback()
            raise
        latest = history_rows[-1] if history_rows else None
        resolved_thread = thread_id or (latest.thread_id if latest else None)
        return {
            "task_id": task_token,
            "node_id": node_id,
            "thread_id": resolved_thread,
            "item": self._node_chat_to_dict(task_token, latest) if latest else None,
            "history": [self._node_chat_to_dict(task_token, item) for item in history_rows],
        }

    def _project_context_prompt(self, db: Session, *, task: ResearchTask) -> str:
        project = task.project
        if project is None and task.project_id is not None:
            project = next((row for row in ResearchProjectRepo(db).list_for_user(task.user_id) if row.id == task.project_id), None)
        if project is None:
            return "No explicit project context."

        lines = [f"Project name: {project.name}"]
        if project.description:
            lines.append(f"Project description: {self._compact_text(project.description, 320)}")

        recent_tasks = [
            row.topic
            for row in ResearchTaskRepo(db).list_recent(user_id=task.user_id, project_id=project.id, limit=6)
            if row.id != task.id and row.topic
        ][:3]
        if recent_tasks:
            lines.append("Recent sibling tasks:")
            lines.extend(f"- {self._compact_text(topic, 160)}" for topic in recent_tasks)

        collections = ResearchCollectionRepo(db).list_for_project(project.id)[:3]
        if collections:
            lines.append("Project collections:")
            item_repo = ResearchCollectionItemRepo(db)
            for collection in collections:
                count = item_repo.count_for_collection(collection.id)
                summary = self._compact_text(collection.summary_text or collection.description or "", 180)
                collection_line = f"- {collection.name} ({collection.source_type}, {count} items)"
                if summary:
                    collection_line += f": {summary}"
                lines.append(collection_line)
        else:
            lines.append("Project collections: none yet.")

        return "\n".join(lines)

    def get_paper_asset_path(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        paper_token: str,
        kind: str = "pdf",
    ) -> str:
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        paper = ResearchPaperRepo(db).get_by_token(task.id, paper_token)
        if not paper:
            raise ValueError("paper not found")
        fulltext = ResearchPaperFulltextRepo(db).get(task.id, _paper_token(paper))
        self._ensure_rendered_paper_assets(task=task, paper=paper, fulltext=fulltext)
        derived_md_path = self._paper_text_asset_path(task=task, paper=paper, kind="md")
        derived_bib_path = self._paper_text_asset_path(task=task, paper=paper, kind="bib")
        kind_norm = (kind or "pdf").strip().lower()
        candidates: list[str | None]
        if kind_norm == "pdf":
            candidates = [fulltext.pdf_path if fulltext else None]
        elif kind_norm in {"txt", "fulltext"}:
            candidates = [fulltext.text_path if fulltext else None]
        elif kind_norm == "overall":
            candidates = [self._paper_visual_assets(task=task, paper=paper, fulltext=fulltext).get("overall", {}).get("path")]
        elif kind_norm == "figure":
            candidates = [self._paper_visual_assets(task=task, paper=paper, fulltext=fulltext).get("figure", {}).get("path")]
        elif kind_norm == "visual":
            candidates = [self._paper_visual_assets(task=task, paper=paper, fulltext=fulltext).get("visual", {}).get("path")]
        elif kind_norm in {"md", "markdown"}:
            candidates = [derived_md_path]
        elif kind_norm == "bib":
            candidates = [derived_bib_path]
        else:
            candidates = [
                self._paper_visual_assets(task=task, paper=paper, fulltext=fulltext).get("overall", {}).get("path"),
                self._paper_visual_assets(task=task, paper=paper, fulltext=fulltext).get("figure", {}).get("path"),
                self._paper_visual_assets(task=task, paper=paper, fulltext=fulltext).get("visual", {}).get("path"),
                fulltext.pdf_path if fulltext else None,
                fulltext.text_path if fulltext else None,
                derived_md_path,
                derived_bib_path,
            ]
        for candidate in candidates:
            if candidate and Path(candidate).exists():
                return str(Path(candidate))
        raise ValueError("asset not found")

    def get_paper_assets(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        paper_token: str,
    ) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        paper = ResearchPaperRepo(db).get_by_token(task.id, paper_token)
        if not paper:
            raise ValueError("paper not found")
        fulltext = ResearchPaperFulltextRepo(db).get(task.id, _paper_token(paper))
        self._ensure_rendered_paper_assets(task=task, paper=paper, fulltext=fulltext)
        items = []
        visual_assets = self._paper_visual_assets(task=task, paper=paper, fulltext=fulltext)
        md_path = self._paper_text_asset_path(task=task, paper=paper, kind="md")
        bib_path = self._paper_text_asset_path(task=task, paper=paper, kind="bib")
        static_assets = {
            "overall": visual_assets.get("overall"),
            "figure": visual_assets.get("figure"),
            "visual": visual_assets.get("visual"),
            "pdf": self._basic_asset_metadata(kind="pdf", path_value=fulltext.pdf_path if fulltext else None),
            "txt": self._basic_asset_metadata(kind="txt", path_value=fulltext.text_path if fulltext else None),
            "md": self._basic_asset_metadata(kind="md", path_value=md_path),
            "bib": self._basic_asset_metadata(kind="bib", path_value=bib_path),
        }
        for kind in ("overall", "figure", "visual", "pdf", "txt", "md", "bib"):
            item = static_assets.get(kind) or {"kind": kind, "status": "missing"}
            exists = item.get("status") == "available"
            status = self._resolve_paper_asset_status(kind=kind, exists=exists, fulltext=fulltext)
            items.append(
                {
                    "kind": kind,
                    "status": status,
                    "filename": item.get("filename"),
                    "path": item.get("path"),
                    "open_url": (
                        self._paper_asset_url(task_id=task.task_id, paper_token=paper_token, kind=kind, disposition="inline")
                        if status == "available"
                        else None
                    ),
                    "download_url": (
                        self._paper_asset_url(task_id=task.task_id, paper_token=paper_token, kind=kind, disposition="attachment")
                        if status == "available"
                        else None
                    ),
                    "mime_type": item.get("mime_type"),
                    "width": item.get("width"),
                    "height": item.get("height"),
                    "source": item.get("source"),
                }
            )
        primary = next((item["kind"] for item in items if item["status"] == "available"), None)
        return {
            "task_id": task.task_id,
            "paper_id": _paper_token(paper),
            "primary_kind": primary,
            "items": items,
        }

    def rebuild_paper_visual_assets(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        paper_token: str,
    ) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        paper = ResearchPaperRepo(db).get_by_token(task.id, paper_token)
        if not paper:
            raise ValueError("paper not found")
        fulltext = ResearchPaperFulltextRepo(db).get(task.id, _paper_token(paper))
        self._build_paper_visual_assets(task=task, paper=paper, fulltext=fulltext)
        return self.get_paper_assets(db, user_id=user_id, task_id=task_id, paper_token=paper_token)

    def start_auto_research(self, db: Session, *, user_id: int, task_id: str) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        if task.mode != ResearchRunMode.OPENCLAW_AUTO:
            raise ValueError("task mode is not openclaw_auto")
        if task.llm_backend != ResearchLLMBackend.OPENCLAW:
            raise ValueError("openclaw_auto task must use llm_backend=openclaw")
        run_id = f"run-{uuid4().hex[:12]}"
        ResearchJobRepo(db).enqueue(
            task.id,
            ResearchJobType.AUTO_RESEARCH,
            {"run_id": run_id, "phase": "start"},
            queue_name=self.settings.research_queue_name,
        )
        task.auto_status = ResearchAutoStatus.RUNNING
        task.status = ResearchTaskStatus.SEARCHING
        task.updated_at = datetime.now(timezone.utc)
        db.add(task)
        db.flush()
        self._emit_run_event(
            db,
            task=task,
            run_id=run_id,
            event_type=ResearchRunEventType.PROGRESS,
            payload={"message": "auto research queued", "phase": "start"},
        )
        return {
            "task_id": task.task_id,
            "run_id": run_id,
            "auto_status": task.auto_status.value,
            "queued": True,
        }

    def list_run_events(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        run_id: str,
        after_seq: int | None = None,
        limit: int = 200,
    ) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id, remember_active=False)
        rows = ResearchRunEventRepo(db).list_for_run(task_id=task.id, run_id=run_id, after_seq=after_seq, limit=limit)
        summary_rows = (
            rows
            if after_seq is None and len(rows) < limit
            else ResearchRunEventRepo(db).list_for_run(task_id=task.id, run_id=run_id, limit=1000)
        )
        return {
            "task_id": task.task_id,
            "run_id": run_id,
            "items": [self._run_event_to_dict(task.task_id, row) for row in rows],
            "summary": self._summarize_run_events(summary_rows),
        }

    def submit_run_guidance(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        run_id: str,
        text: str,
        tags: list[str] | None = None,
    ) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        self._emit_run_event(
            db,
            task=task,
            run_id=run_id,
            event_type=ResearchRunEventType.PROGRESS,
            payload={"message": "guidance received", "kind": "user_guidance", "text": text.strip(), "tags": tags or []},
        )
        return {
            "task_id": task.task_id,
            "run_id": run_id,
            "auto_status": task.auto_status.value,
            "accepted": True,
        }

    def continue_auto_research(self, db: Session, *, user_id: int, task_id: str, run_id: str) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        if task.auto_status not in {ResearchAutoStatus.AWAITING_GUIDANCE, ResearchAutoStatus.RUNNING}:
            raise ValueError("task is not awaiting guidance")
        ResearchJobRepo(db).enqueue(
            task.id,
            ResearchJobType.AUTO_RESEARCH,
            {"run_id": run_id, "phase": "continue"},
            queue_name=self.settings.research_queue_name,
        )
        task.auto_status = ResearchAutoStatus.RUNNING
        task.status = ResearchTaskStatus.SEARCHING
        task.updated_at = datetime.now(timezone.utc)
        db.add(task)
        db.flush()
        return {
            "task_id": task.task_id,
            "run_id": run_id,
            "auto_status": task.auto_status.value,
            "queued": True,
        }

    def cancel_auto_research(self, db: Session, *, user_id: int, task_id: str, run_id: str) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        task.auto_status = ResearchAutoStatus.CANCELED
        task.updated_at = datetime.now(timezone.utc)
        db.add(task)
        db.flush()
        self._emit_run_event(
            db,
            task=task,
            run_id=run_id,
            event_type=ResearchRunEventType.PROGRESS,
            payload={"message": "auto research canceled", "status": ResearchAutoStatus.CANCELED.value},
        )
        return {
            "task_id": task.task_id,
            "run_id": run_id,
            "auto_status": task.auto_status.value,
            "queued": False,
        }

    def get_fulltext_status(self, db: Session, *, user_id: int, task_id: str) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        repo = ResearchPaperFulltextRepo(db)
        rows = repo.list_for_task(task.id)
        items = []
        for row in rows:
            items.append(
                {
                    "paper_id": row.paper_id,
                    "status": row.status.value,
                    "source_url": row.source_url,
                    "pdf_path": row.pdf_path,
                    "text_path": row.text_path,
                    "text_chars": row.text_chars,
                    "parser": row.parser,
                    "quality_score": row.quality_score,
                    "sections": _load_json_dict(row.sections_json),
                    "fail_reason": row.fail_reason,
                    "fetched_at": row.fetched_at,
                    "parsed_at": row.parsed_at,
                }
            )
        return {
            "task_id": task.task_id,
            "summary": repo.summary_for_task(task.id),
            "items": items,
        }

    def upload_pdf_for_paper(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        paper_token: str,
        filename: str,
        content: bytes,
    ) -> dict:
        if not content:
            raise ValueError("empty pdf content")
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        paper = ResearchPaperRepo(db).get_by_token(task.id, paper_token)
        if not paper:
            raise ValueError("paper not found")
        paper_key = _paper_token(paper)
        pdf_dir = Path(self.settings.research_artifact_dir).expanduser().resolve() / task.task_id / "fulltext"
        pdf_dir.mkdir(parents=True, exist_ok=True)
        safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "_", filename or f"{paper_key}.pdf")
        if not safe_name.lower().endswith(".pdf"):
            safe_name = f"{safe_name}.pdf"
        pdf_path = pdf_dir / safe_name
        pdf_path.write_bytes(content)
        text, meta = self._parse_pdf_bytes(content)
        sections = _extract_sections_lite(text)
        quality = _estimate_text_quality(text)
        text_path = pdf_dir / f"{safe_name.rsplit('.', 1)[0]}.txt"
        text_path.write_text(text, encoding="utf-8")
        row = ResearchPaperFulltextRepo(db).upsert(
            task_id=task.id,
            paper_id=paper_key,
            source_url=paper.url,
            status=ResearchPaperFulltextStatus.PARSED.value,
            pdf_path=str(pdf_path),
            text_path=str(text_path),
            text_chars=len(text),
            parser=str(meta.get("parser") or "")[:32] or None,
            quality_score=quality,
            sections_json=orjson.dumps(sections).decode("utf-8"),
            fail_reason=None,
            fetched_at=datetime.now(timezone.utc),
            parsed_at=datetime.now(timezone.utc),
        )
        self._safe_build_paper_visual_assets(task=task, paper=paper, fulltext=row)
        return {
            "paper_id": row.paper_id,
            "status": row.status.value,
            "pdf_path": row.pdf_path,
            "text_path": row.text_path,
            "text_chars": row.text_chars,
        }

    def get_paper_detail(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        paper_token: str,
    ) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        paper = ResearchPaperRepo(db).get_by_token(task.id, paper_token)
        if not paper:
            raise ValueError("paper not found")
        paper_id = _paper_token(paper)
        fulltext = ResearchPaperFulltextRepo(db).get(task.id, paper_id)
        self._ensure_rendered_paper_assets(task=task, paper=paper, fulltext=fulltext)
        preview = self._paper_visual_preview(task=task, paper=paper, fulltext=fulltext)
        summary = self._paper_summary_view(paper=paper, fulltext=fulltext)
        venue_metrics = self.venue_metrics_service.lookup_for_paper(
            venue=paper.venue,
            doi=paper.doi,
            title=paper.title,
            year=paper.year,
        )
        return {
            "task_id": task.task_id,
            "paper_id": paper_id,
            "title": paper.title,
            "authors": _load_json_list(paper.authors_json),
            "year": paper.year,
            "venue": paper.venue,
            "doi": paper.doi,
            "url": paper.url,
            "abstract": paper.abstract,
            "method_summary": paper.method_summary,
            "card_summary": summary["card_summary"],
            "summary_source": summary["summary_source"],
            "summary_status": summary["summary_status"],
            "source": paper.source,
            "fulltext_status": fulltext.status.value if fulltext else None,
            "saved": bool(paper.saved),
            "saved_path": paper.saved_path,
            "saved_bib_path": paper.saved_bib_path,
            "saved_at": paper.saved_at,
            "key_points_status": summary["summary_status"],
            "key_points_source": summary["summary_source"],
            "key_points": summary["detail_summary"],
            "key_points_error": paper.key_points_error,
            "key_points_updated_at": paper.key_points_updated_at,
            "preview_kind": preview.get("preview_kind"),
            "preview_url": preview.get("preview_url"),
            "visual_status": preview.get("visual_status"),
            "venue_metrics": venue_metrics,
        }

    def _paper_summary_view(self, *, paper, fulltext) -> dict[str, str]:
        summary_source = self._paper_summary_source(paper=paper)
        summary_status = self._paper_summary_status(paper=paper)
        detail_summary = self._build_structured_summary_text(
            source=summary_source,
            abstract=(paper.abstract or "").strip(),
            method_summary=(paper.method_summary or "").strip(),
            raw_key_points=(paper.key_points or "").strip(),
            has_fulltext=bool(fulltext and fulltext.text_path and Path(fulltext.text_path).exists()),
        )
        return {
            "summary_source": summary_source,
            "summary_status": summary_status,
            "detail_summary": detail_summary,
            "card_summary": self._build_card_summary(detail_summary),
        }

    def _paper_summary_source(self, *, paper) -> str:
        source = (paper.key_points_source or "").strip().lower()
        if source in {"fulltext", "abstract"}:
            return source
        if (paper.abstract or "").strip():
            return "abstract"
        if (paper.method_summary or "").strip():
            return "method_fallback"
        return "none"

    def _paper_summary_status(self, *, paper) -> str:
        status = (paper.key_points_status or "").strip().lower()
        if status:
            return status
        if (paper.key_points or "").strip():
            return "done"
        if (paper.abstract or "").strip() or (paper.method_summary or "").strip():
            return "fallback"
        return "none"

    def _build_structured_summary_text(
        self,
        *,
        source: str,
        abstract: str,
        method_summary: str,
        raw_key_points: str,
        has_fulltext: bool,
    ) -> str:
        sections = self._extract_structured_summary_sections(raw_key_points)
        evidence = self._extract_summary_evidence(raw_key_points)
        abstract_sentence = self._first_sentence(abstract, limit=180)
        method_sentence = self._first_sentence(method_summary, limit=180)

        if not sections["研究问题"]:
            sections["研究问题"] = abstract_sentence or "当前资料尚未明确交代论文要解决的问题，建议回看摘要或引言。"
        if not sections["核心方法"]:
            sections["核心方法"] = method_sentence or abstract_sentence or "当前资料不足以稳定总结核心方法，建议补齐全文后再查看。"
        if not sections["数据与实验"]:
            sections["数据与实验"] = (
                "当前摘要仅能确认论文包含实验验证，但具体数据集、评测设置或对照实验仍需回看原文。"
                if abstract or has_fulltext
                else "当前资料不足，尚不能确认数据集与实验设置。"
            )
        if not sections["关键结果/证据"]:
            sections["关键结果/证据"] = evidence or abstract_sentence or "当前资料尚不足以提炼稳定的结果证据，建议结合原文图表核对。"
        if not sections["局限与风险"]:
            sections["局限与风险"] = "当前可见材料对局限描述较少，建议重点核对适用边界、失败案例与复现条件。"
        if not sections["对当前研究任务的启发/下一步建议"]:
            sections["对当前研究任务的启发/下一步建议"] = "建议继续核对这篇论文与当前研究主题的关系，并补齐实验细节、证据强度与可复现性判断。"

        source_label = {
            "fulltext": "全文",
            "abstract": "摘要",
            "method_fallback": "方法回退",
            "none": "当前资料",
        }.get(source, "当前资料")

        lines = [f"基于{source_label}的结构化摘要"]
        for index, key in enumerate(
            [
                "研究问题",
                "核心方法",
                "数据与实验",
                "关键结果/证据",
                "局限与风险",
                "对当前研究任务的启发/下一步建议",
            ],
            start=1,
        ):
            lines.append(f"{index}. {key}：{sections[key]}")
        return "\n".join(lines)

    def _build_card_summary(self, detail_summary: str) -> str:
        sections = self._extract_structured_summary_sections(detail_summary)
        compact = []
        for label in ("研究问题", "核心方法", "关键结果/证据"):
            text = sections.get(label, "").strip()
            if text:
                compact.append(f"{label}：{self._compact_text(text, 92)}")
        return "\n".join(compact)

    def _extract_structured_summary_sections(self, text: str) -> dict[str, str]:
        sections = {
            "研究问题": "",
            "核心方法": "",
            "数据与实验": "",
            "关键结果/证据": "",
            "局限与风险": "",
            "对当前研究任务的启发/下一步建议": "",
        }
        if not text:
            return sections
        patterns = {
            "研究问题": re.compile(r"(?:^|\n)\s*(?:\d+\.\s*)?研究问题[:：]\s*(.+?)(?=\n\s*(?:\d+\.\s*)?(?:核心方法|数据与实验|关键结果/证据|局限与风险|对当前研究任务的启发/下一步建议)[:：]|\Z)", re.S),
            "核心方法": re.compile(r"(?:^|\n)\s*(?:\d+\.\s*)?核心方法[:：]\s*(.+?)(?=\n\s*(?:\d+\.\s*)?(?:研究问题|数据与实验|关键结果/证据|局限与风险|对当前研究任务的启发/下一步建议)[:：]|\Z)", re.S),
            "数据与实验": re.compile(r"(?:^|\n)\s*(?:\d+\.\s*)?数据与实验[:：]\s*(.+?)(?=\n\s*(?:\d+\.\s*)?(?:研究问题|核心方法|关键结果/证据|局限与风险|对当前研究任务的启发/下一步建议)[:：]|\Z)", re.S),
            "关键结果/证据": re.compile(r"(?:^|\n)\s*(?:\d+\.\s*)?关键结果/证据[:：]\s*(.+?)(?=\n\s*(?:\d+\.\s*)?(?:研究问题|核心方法|数据与实验|局限与风险|对当前研究任务的启发/下一步建议)[:：]|\Z)", re.S),
            "局限与风险": re.compile(r"(?:^|\n)\s*(?:\d+\.\s*)?局限与风险[:：]\s*(.+?)(?=\n\s*(?:\d+\.\s*)?(?:研究问题|核心方法|数据与实验|关键结果/证据|对当前研究任务的启发/下一步建议)[:：]|\Z)", re.S),
            "对当前研究任务的启发/下一步建议": re.compile(r"(?:^|\n)\s*(?:\d+\.\s*)?对当前研究任务的启发/下一步建议[:：]\s*(.+?)(?=\n\s*(?:\d+\.\s*)?(?:研究问题|核心方法|数据与实验|关键结果/证据|局限与风险)[:：]|\Z)", re.S),
        }
        for key, pattern in patterns.items():
            match = pattern.search(text)
            if match:
                sections[key] = self._compact_text(match.group(1), 260)
        return sections

    def _extract_summary_evidence(self, text: str) -> str:
        if not text:
            return ""
        lines = []
        for raw in text.splitlines():
            line = str(raw).strip()
            if not line:
                continue
            if line.startswith("基于") or "结构化摘要" in line:
                continue
            if re.match(r"^\d+\.\s+", line):
                line = re.sub(r"^\d+\.\s+", "", line)
            if re.match(r"^[-*•]\s+", line):
                line = re.sub(r"^[-*•]\s+", "", line)
            if "：" in line and any(
                marker in line for marker in ["研究问题", "核心方法", "数据与实验", "关键结果/证据", "局限与风险", "对当前研究任务的启发/下一步建议"]
            ):
                continue
            lines.append(line)
            if len(lines) >= 2:
                break
        return "；".join(lines)

    def _first_sentence(self, text: str, *, limit: int) -> str:
        compact = self._compact_text(text, limit)
        if not compact:
            return ""
        for sep in ("。", ".", "；", ";", "!", "！", "?", "？"):
            if sep in compact:
                return compact.split(sep)[0].strip()[:limit]
        return compact[:limit]

    def _compact_text(self, text: str, limit: int) -> str:
        compact = re.sub(r"\s+", " ", str(text or "")).strip()
        if not compact:
            return ""
        return compact[:limit].rstrip("，,；;。.")

    def _basic_asset_metadata(self, *, kind: str, path_value: str | None) -> dict:
        path_text = str(path_value).strip() if path_value else None
        exists = bool(path_text and Path(path_text).exists())
        mime_map = {
            "pdf": "application/pdf",
            "txt": "text/plain; charset=utf-8",
            "md": "text/markdown; charset=utf-8",
            "bib": "application/x-bibtex",
        }
        return {
            "kind": kind,
            "status": "available" if exists else "missing",
            "filename": Path(path_text).name if exists and path_text else None,
            "path": path_text if exists else None,
            "mime_type": mime_map.get(kind),
            "width": None,
            "height": None,
            "source": None,
        }

    def _ensure_rendered_paper_assets(self, *, task: ResearchTask, paper, fulltext) -> None:
        self._paper_text_asset_path(task=task, paper=paper, kind="md")
        self._paper_text_asset_path(task=task, paper=paper, kind="bib")
        assets = self.paper_visual_service.inspect_assets(
            artifact_root=Path(self.settings.research_artifact_dir),
            task_id=task.task_id,
            paper_token=_paper_token(paper),
        )
        if "visual" not in assets:
            self._safe_build_paper_visual_assets(task=task, paper=paper, fulltext=fulltext)

    def _paper_text_asset_path(self, *, task: ResearchTask, paper, kind: str) -> str:
        kind_norm = (kind or "").strip().lower()
        if kind_norm not in {"md", "bib"}:
            raise ValueError("unsupported paper text asset kind")
        configured_path = paper.saved_path if kind_norm == "md" else paper.saved_bib_path
        target = Path(configured_path).expanduser().resolve() if configured_path else self._paper_derived_asset_path(
            task=task,
            paper=paper,
            suffix=kind_norm,
        )
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            if kind_norm == "md":
                target.write_text(self._render_saved_paper_markdown(task, paper), encoding="utf-8")
            else:
                target.write_text(self._render_bib([paper]), encoding="utf-8")
        return str(target)

    def _paper_derived_asset_path(self, *, task: ResearchTask, paper, suffix: str) -> Path:
        base_dir = Path(self.settings.research_artifact_dir).expanduser().resolve() / task.task_id / "derived" / "papers"
        base_dir.mkdir(parents=True, exist_ok=True)
        file_stem = re.sub(r"[^a-zA-Z0-9._-]+", "_", _paper_token(paper))[:120] or f"paper_{paper.id}"
        return base_dir / f"{file_stem}.{suffix}"

    def _resolve_paper_asset_status(self, *, kind: str, exists: bool, fulltext) -> str:
        if exists:
            return "available"
        fulltext_status = self._fulltext_status_value(fulltext)
        if kind == "pdf":
            return fulltext_status or ResearchPaperFulltextStatus.NOT_STARTED.value
        if kind == "txt":
            if fulltext_status == ResearchPaperFulltextStatus.FETCHED.value:
                return "parsing"
            return fulltext_status or ResearchPaperFulltextStatus.NOT_STARTED.value
        if kind in {"overall", "figure"}:
            if fulltext and fulltext.pdf_path and Path(fulltext.pdf_path).exists():
                return "not_extracted"
            return fulltext_status if fulltext_status in {
                ResearchPaperFulltextStatus.FETCHING.value,
                ResearchPaperFulltextStatus.FETCHED.value,
                ResearchPaperFulltextStatus.NEED_UPLOAD.value,
                ResearchPaperFulltextStatus.FAILED.value,
            } else "needs_pdf"
        if kind == "visual":
            return "not_built"
        return "missing"

    @staticmethod
    def _fulltext_status_value(fulltext) -> str | None:
        if not fulltext or fulltext.status is None:
            return None
        raw = getattr(fulltext.status, "value", fulltext.status)
        text = str(raw or "").strip().lower()
        return text or None

    def _paper_asset_url(self, *, task_id: str, paper_token: str, kind: str, disposition: str) -> str:
        return (
            f"/api/v1/research/tasks/{quote_plus(task_id)}/papers/{quote_plus(paper_token)}/asset"
            f"?kind={quote_plus(kind)}&disposition={quote_plus(disposition)}"
        )

    def _build_paper_visual_assets(self, *, task: ResearchTask, paper, fulltext) -> dict:
        return self.paper_visual_service.build_assets(
            artifact_root=Path(self.settings.research_artifact_dir),
            task_id=task.task_id,
            paper_token=_paper_token(paper),
            pdf_path=(fulltext.pdf_path if fulltext else None),
            title=paper.title,
            authors=_load_json_list(paper.authors_json),
            year=paper.year,
            venue=paper.venue,
            source=paper.source,
            abstract=paper.key_points or paper.abstract,
            key_points=paper.key_points,
        )

    def _safe_build_paper_visual_assets(self, *, task: ResearchTask, paper, fulltext) -> None:
        try:
            self._build_paper_visual_assets(task=task, paper=paper, fulltext=fulltext)
        except Exception:
            logger.exception("paper_visual_build_failed task_id=%s paper_id=%s", task.task_id, _paper_token(paper))

    def _paper_visual_assets(self, *, task: ResearchTask, paper, fulltext) -> dict:
        assets = self.paper_visual_service.inspect_assets(
            artifact_root=Path(self.settings.research_artifact_dir),
            task_id=task.task_id,
            paper_token=_paper_token(paper),
        )
        out: dict[str, dict] = {}
        for kind, asset in assets.items():
            out[kind] = {
                "kind": asset.kind,
                "status": "available",
                "filename": Path(asset.path).name,
                "path": asset.path,
                "mime_type": asset.mime_type,
                "width": asset.width,
                "height": asset.height,
                "source": asset.source,
            }
        return out

    def _paper_visual_preview(self, *, task: ResearchTask, paper, fulltext) -> dict:
        assets = self._paper_visual_assets(task=task, paper=paper, fulltext=fulltext)
        preview_kind = None
        preview_url = None
        visual_status = "missing"
        for kind in ("overall", "figure", "visual"):
            item = assets.get(kind)
            if item and item.get("status") == "available":
                preview_kind = kind
                preview_url = self._paper_asset_url(task_id=task.task_id, paper_token=_paper_token(paper), kind=kind, disposition="inline")
                if kind == "overall":
                    visual_status = "overall_ready"
                elif kind == "figure":
                    visual_status = "figure_ready"
                else:
                    visual_status = "visual_ready"
                break
        if preview_kind is None and fulltext and fulltext.pdf_path and Path(fulltext.pdf_path).exists():
            visual_status = "needs_build"
        return {
            "preview_kind": preview_kind,
            "preview_url": preview_url,
            "visual_status": visual_status,
        }

    def _paper_graph_node(self, *, task: ResearchTask, paper, direction_index: int | None, fulltext) -> dict:
        preview = self._paper_visual_preview(task=task, paper=paper, fulltext=fulltext)
        summary = self._paper_summary_view(paper=paper, fulltext=fulltext)
        return {
            "id": _paper_token(paper),
            "paper_id": _paper_token(paper),
            "type": "paper",
            "label": paper.title[:240],
            "year": paper.year,
            "source": paper.source,
            "venue": paper.venue,
            "doi": paper.doi,
            "url": paper.url,
            "abstract": paper.abstract,
            "method_summary": paper.method_summary,
            "card_summary": summary["card_summary"],
            "summary_source": summary["summary_source"],
            "summary_status": summary["summary_status"],
            "authors": _load_json_list(paper.authors_json),
            "direction_index": direction_index,
            "fulltext_status": fulltext.status.value if fulltext else None,
            "saved": bool(paper.saved),
            "key_points_status": summary["summary_status"],
            "preview_kind": preview.get("preview_kind"),
            "preview_url": preview.get("preview_url"),
            "visual_status": preview.get("visual_status"),
        }

    def get_task_venue_metrics(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
    ) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        papers = ResearchPaperRepo(db).list_for_task(task.id)
        grouped: dict[str, dict] = {}
        for paper in papers:
            venue = str(paper.venue or "").strip()
            if not venue:
                continue
            venue_key = re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\u4e00-\u9fff]+", " ", venue.lower().replace("&", " and "))).strip()
            if not venue_key:
                continue
            item = grouped.setdefault(
                venue_key,
                {
                    "venue": venue,
                    "paper_count": 0,
                    "paper_ids": [],
                    "sample_paper": paper,
                },
            )
            item["paper_count"] += 1
            item["paper_ids"].append(_paper_token(paper))
        items = []
        for venue_key, item in sorted(grouped.items(), key=lambda pair: (-pair[1]["paper_count"], pair[1]["venue"].lower())):
            sample_paper = item["sample_paper"]
            metrics = self.venue_metrics_service.lookup_for_paper(
                venue=sample_paper.venue,
                doi=sample_paper.doi,
                title=sample_paper.title,
                year=sample_paper.year,
            )
            items.append(
                {
                    "venue": item["venue"],
                    "venue_key": venue_key,
                    "source_type": metrics.get("source_type"),
                    "paper_count": item["paper_count"],
                    "paper_ids": item["paper_ids"],
                    "metrics": metrics,
                }
            )
        return {
            "task_id": task.task_id,
            "items": items,
        }

    def list_saved_papers(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        limit: int = 200,
    ) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        rows = ResearchPaperRepo(db).list_saved_for_task(task.id, limit=limit)
        return {
            "task_id": task.task_id,
            "items": [
                {
                    "paper_id": _paper_token(row),
                    "title": row.title,
                    "year": row.year,
                    "doi": row.doi,
                    "saved_path": row.saved_path,
                    "saved_bib_path": row.saved_bib_path,
                    "saved_at": row.saved_at,
                }
                for row in rows
            ],
        }

    def save_paper(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        paper_token: str,
        subdir: str | None = None,
    ) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        paper_repo = ResearchPaperRepo(db)
        paper = paper_repo.get_by_token(task.id, paper_token)
        if not paper:
            raise ValueError("paper not found")
        base_dir = Path(self.settings.research_save_base_dir).expanduser().resolve()
        safe_subdir = (subdir or "").strip()
        if safe_subdir:
            p = Path(safe_subdir)
            if p.is_absolute() or ".." in p.parts:
                raise ValueError("invalid subdir")
        target_dir = (base_dir / safe_subdir / task.task_id).resolve()
        if not str(target_dir).startswith(str(base_dir)):
            raise ValueError("invalid subdir")
        target_dir.mkdir(parents=True, exist_ok=True)

        paper_key = re.sub(r"[^a-zA-Z0-9._-]+", "_", _paper_token(paper))[:120] or f"paper_{paper.id}"
        md_path = target_dir / f"{paper_key}.md"
        bib_path = target_dir / f"{paper_key}.bib"
        md_path.write_text(self._render_saved_paper_markdown(task, paper), encoding="utf-8")
        bib_path.write_text(self._render_bib([paper]), encoding="utf-8")
        row = paper_repo.mark_saved(paper, md_path=str(md_path), bib_path=str(bib_path))
        self._emit_step_progress(
            db,
            task=task,
            step="paper_saved",
            title="论文已保存",
            message=f"已保存论文《{row.title[:48]}》。",
            status="done",
            details={"paper_id": _paper_token(row)},
        )
        return {
            "task_id": task.task_id,
            "paper_id": _paper_token(row),
            "saved": bool(row.saved),
            "saved_path": str(md_path),
            "saved_bib_path": str(bib_path),
            "saved_at": row.saved_at,
        }

    def enqueue_paper_summary(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        paper_token: str,
    ) -> dict:
        if not self.settings.research_summary_enabled:
            raise ValueError("research summary is disabled")
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        paper_repo = ResearchPaperRepo(db)
        paper = paper_repo.get_by_token(task.id, paper_token)
        if not paper:
            raise ValueError("paper not found")
        paper_repo.update_key_points(paper, status="queued", error=None)
        payload = {"paper_token": _paper_token(paper)}
        ResearchJobRepo(db).enqueue(task.id, ResearchJobType.PAPER_SUMMARY, payload, queue_name=self.settings.research_queue_name)
        task.status = ResearchTaskStatus.SEARCHING
        task.updated_at = datetime.now(timezone.utc)
        db.add(task)
        db.flush()
        self._emit_step_progress(
            db,
            task=task,
            step="paper_summary_queued",
            title="论文总结已排队",
            message=f"正在为论文《{paper.title[:48]}》生成要点总结。",
            status="queued",
            details={"paper_id": _paper_token(paper)},
        )
        return {
            "task_id": task.task_id,
            "paper_id": _paper_token(paper),
            "key_points_status": "queued",
            "queued": True,
        }

    def get_graph_snapshot(
        self,
        db: Session,
        *,
        user_id: int,
        task_id: str,
        direction_index: int | None = None,
        round_id: int | None = None,
        view: str = ResearchGraphViewType.CITATION.value,
        include_papers: bool = False,
        paper_limit: int | None = None,
    ) -> dict:
        task = self.switch_task(db, user_id=user_id, task_id=task_id)
        view_norm = (view or ResearchGraphViewType.CITATION.value).strip().lower()
        if view_norm == ResearchGraphViewType.TREE.value:
            data = self._build_tree_graph(db, task, include_papers=include_papers, paper_limit=paper_limit)
            return {"task_id": task.task_id, "view": view_norm, **data}
        row = ResearchGraphSnapshotRepo(db).latest_for_task(
            task.id,
            direction_index=direction_index,
            round_id=round_id,
            view_type=view_norm,
        )
        if not row:
            return {
                "task_id": task.task_id,
                "view": view_norm,
                "direction_index": direction_index,
                "round_id": round_id,
                "depth": int(self.settings.research_graph_depth_default),
                "status": ResearchGraphBuildStatus.QUEUED.value,
                "nodes": [],
                "edges": [],
                "stats": {},
            }
        return {
            "task_id": task.task_id,
            "view": row.view_type.value,
            "direction_index": row.direction_index,
            "round_id": row.round_id,
            "depth": row.depth,
            "status": row.status.value,
            "nodes": _load_json_list_of_dict(row.nodes_json),
            "edges": _load_json_list_of_dict(row.edges_json),
            "stats": _load_json_dict(row.stats_json),
        }

    def page_direction_papers(
        self,
        db: Session,
        *,
        user_id: int,
        direction_index: int,
        page: int,
    ) -> dict:
        task = self.get_active_task(db, user_id)
        if not task:
            raise ValueError("no active task")
        direction = ResearchDirectionRepo(db).get_by_index(task.id, direction_index)
        if not direction:
            raise ValueError("direction not found")
        items = ResearchPaperRepo(db).list_for_direction(direction.id)
        page_size = self.settings.research_page_size
        page = max(1, page)
        start = (page - 1) * page_size
        end = start + page_size
        sliced = items[start:end]
        ResearchSessionRepo(db).set_pagination(
            ResearchSessionRepo(db).get_or_create(user_id, page_size=page_size),
            direction_index=direction_index,
            page=page,
        )
        cards = []
        for idx, row in enumerate(sliced, start=start + 1):
            cards.append(
                {
                    "index": idx,
                    "title": row.title,
                    "authors": _load_json_list(row.authors_json),
                    "year": row.year,
                    "venue": row.venue,
                    "doi": row.doi,
                    "url": row.url,
                    "abstract": row.abstract,
                    "method_summary": row.method_summary,
                    "source": row.source,
                    "saved": bool(row.saved),
                }
            )
        return {
            "task_id": task.task_id,
            "direction_index": direction_index,
            "page": page,
            "page_size": page_size,
            "total": len(items),
            "items": cards,
        }

    def get_paper_by_index(self, db: Session, *, user_id: int, index: int) -> dict:
        task = self.get_active_task(db, user_id)
        if not task:
            raise ValueError("no active task")
        papers = ResearchPaperRepo(db).list_for_task(task.id)
        if index < 1 or index > len(papers):
            raise ValueError("paper index out of range")
        row = papers[index - 1]
        return {
            "index": index,
            "paper_id": _paper_token(row),
            "title": row.title,
            "authors": _load_json_list(row.authors_json),
            "year": row.year,
            "venue": row.venue,
            "doi": row.doi,
            "url": row.url,
            "abstract": row.abstract,
            "method_summary": row.method_summary,
            "source": row.source,
        }

    def get_paper_by_doi(self, db: Session, *, user_id: int, doi: str) -> dict:
        task = self.get_active_task(db, user_id)
        if not task:
            raise ValueError("no active task")
        doi_norm = doi.strip().lower()
        for row in ResearchPaperRepo(db).list_for_task(task.id):
            if (row.doi or "").strip().lower() == doi_norm:
                return {
                    "paper_id": _paper_token(row),
                    "title": row.title,
                    "authors": _load_json_list(row.authors_json),
                    "year": row.year,
                    "venue": row.venue,
                    "doi": row.doi,
                    "url": row.url,
                    "abstract": row.abstract,
                    "method_summary": row.method_summary,
                    "source": row.source,
                }
        raise ValueError("paper not found")

    def export_task(self, db: Session, *, user_id: int, fmt: str = "md") -> str:
        fmt_norm = (fmt or "md").lower().strip()
        if fmt_norm not in {"md", "bib", "json", "csljson"}:
            raise ValueError("format must be one of md|bib|json|csljson")
        task: ResearchTask | None = None
        try:
            task = self.get_active_task(db, user_id)
            if not task:
                raise ValueError("no active task")
            base = Path(self.settings.research_artifact_dir).expanduser().resolve() / task.task_id
            base.mkdir(parents=True, exist_ok=True)
            directions = ResearchDirectionRepo(db).list_for_task(task.id)
            papers = ResearchPaperRepo(db).list_for_task(task.id)

            report_path = base / "report.md"
            bib_path = base / "papers.bib"
            json_path = base / "papers.json"
            csljson_path = base / "papers.csljson"
            report_path.write_text(self._render_report(task, directions, papers), encoding="utf-8")
            bib_path.write_text(self._render_bib(papers), encoding="utf-8")
            json_path.write_text(self._render_json(task, directions, papers), encoding="utf-8")
            csljson_path.write_text(self._render_csljson_from_papers(papers), encoding="utf-8")

            if fmt_norm == "bib":
                self._record_export_metric(success=True)
                ResearchExportRecordRepo(db).create(
                    task_id=task.id,
                    project_id=task.project_id,
                    fmt=fmt_norm,
                    output_path=str(bib_path),
                    status="success",
                )
                return str(bib_path)
            if fmt_norm == "csljson":
                self._record_export_metric(success=True)
                ResearchExportRecordRepo(db).create(
                    task_id=task.id,
                    project_id=task.project_id,
                    fmt=fmt_norm,
                    output_path=str(csljson_path),
                    status="success",
                )
                return str(csljson_path)
            if fmt_norm == "json":
                self._record_export_metric(success=True)
                ResearchExportRecordRepo(db).create(
                    task_id=task.id,
                    project_id=task.project_id,
                    fmt=fmt_norm,
                    output_path=str(json_path),
                    status="success",
                )
                return str(json_path)
            self._record_export_metric(success=True)
            ResearchExportRecordRepo(db).create(
                task_id=task.id,
                project_id=task.project_id,
                fmt=fmt_norm,
                output_path=str(report_path),
                status="success",
            )
            return str(report_path)
        except Exception as exc:
            self._record_export_metric(success=False)
            if task is not None:
                ResearchExportRecordRepo(db).create(
                    task_id=task.id,
                    project_id=task.project_id,
                    fmt=fmt_norm,
                    output_path=None,
                    status="failed",
                    error=str(exc),
                )
            raise

    def export_collection(self, db: Session, *, user_id: int, collection_id: str, fmt: str = "bib") -> str:
        fmt_norm = (fmt or "bib").lower().strip()
        if fmt_norm not in {"bib", "csljson"}:
            raise ValueError("format must be one of bib|csljson")
        collection = ResearchCollectionRepo(db).get_by_collection_id(user_id=user_id, collection_id=collection_id)
        if not collection:
            raise ValueError("collection not found")
        try:
            items = ResearchCollectionItemRepo(db).list_for_collection(collection.id)
            if not items:
                raise ValueError("collection is empty")
            base = Path(self.settings.research_artifact_dir).expanduser().resolve() / "collections" / collection.collection_id
            base.mkdir(parents=True, exist_ok=True)
            bib_path = base / "collection.bib"
            csljson_path = base / "collection.csljson"
            bib_path.write_text(self._render_bib_from_collection_items(items), encoding="utf-8")
            csljson_path.write_text(self._render_csljson_from_collection_items(items), encoding="utf-8")
            output_path = str(csljson_path if fmt_norm == "csljson" else bib_path)
            ResearchCollectionExportRecordRepo(db).create(
                collection_id=collection.id,
                fmt=fmt_norm,
                output_path=output_path,
                status="success",
            )
            return output_path
        except Exception as exc:
            ResearchCollectionExportRecordRepo(db).create(
                collection_id=collection.id,
                fmt=fmt_norm,
                output_path=None,
                status="failed",
                error=str(exc),
            )
            raise

    def _run_plan_job(
        self,
        db: Session,
        task: ResearchTask,
        payload: dict,
        *,
        touch_lease: Callable[[], None] | None = None,
    ) -> None:
        constraints = _load_json_dict(task.constraints_json)
        seed_rows = self._build_seed_corpus_for_task(db, task=task, constraints=constraints)
        directions = self._plan_directions_from_seed(
            task.topic,
            constraints,
            seed_rows,
            backend=task.llm_backend.value,
            model=task.llm_model,
            project_context=self._project_context_prompt(db, task=task),
        )
        ResearchDirectionRepo(db).replace_for_task(task, directions)
        task.status = ResearchTaskStatus.CREATED
        task.updated_at = datetime.now(timezone.utc)
        db.add(task)
        db.flush()
        self._emit_step_progress(
            db,
            task=task,
            step="plan_completed",
            title="方向规划完成",
            message=f"已生成 {len(directions)} 个研究方向。",
            status="done",
            details={"direction_count": len(directions)},
        )
        lines = [f"调研任务 {task.task_id} 方向已生成："]
        for idx, item in enumerate(directions, start=1):
            lines.append(f"{idx}. {item['name']}")
        lines.append('回复“调研 选择 2”查看方向 2。')
        if touch_lease:
            touch_lease()
        self._notify_user(db, task.user_id, "\n".join(lines))

    def _run_search_job(
        self,
        db: Session,
        task: ResearchTask,
        payload: dict,
        *,
        touch_lease: Callable[[], None] | None = None,
    ) -> None:
        constraints = _load_json_dict(task.constraints_json)
        constraints_override = payload.get("constraints_override")
        if isinstance(constraints_override, dict):
            for key in ("year_from", "year_to", "sources"):
                value = constraints_override.get(key)
                if value:
                    constraints[key] = value
        direction_index = int(payload.get("direction_index") or 1)
        round_id = _to_int_or_none(payload.get("round_id"))
        default_top_n = int(constraints.get("top_n") or self.settings.research_topn_default)
        top_n = int(payload.get("top_n") or default_top_n)
        force_refresh = bool(payload.get("force_refresh") or False)
        top_n = max(1, min(100, top_n))
        direction = ResearchDirectionRepo(db).get_by_index(task.id, direction_index)
        if not direction:
            raise ValueError("direction not found")

        allowed_sources = _resolve_sources(constraints.get("sources"), self.settings.research_sources_default)
        if not allowed_sources:
            allowed_sources = {"semantic_scholar"}

        query_terms = _load_json_list(payload.get("explicit_queries") or "[]")
        if not query_terms and round_id:
            round_row = ResearchRoundRepo(db).get(round_id)
            if round_row and round_row.task_id == task.id:
                query_terms = _load_json_list(round_row.query_terms_json)
                ResearchRoundRepo(db).update_status(round_row, ResearchRoundStatus.RUNNING.value)
        if not query_terms:
            query_terms = _load_json_list(direction.queries_json) or [direction.name]

        exclude_terms = _load_json_list(direction.exclude_terms_json)
        all_papers: list[dict] = []
        cache_repo = ResearchSearchCacheRepo(db)
        for query in query_terms[:4]:
            effective_query = _merge_query_and_excludes(query, exclude_terms)
            ordered_sources = [src for src in ("semantic_scholar", "openalex", "arxiv") if src in allowed_sources]
            for source in ordered_sources:
                result = self._search_with_cache(
                    cache_repo=cache_repo,
                    task=task,
                    direction_index=direction_index,
                    source=source,
                    query=effective_query,
                    top_n=top_n,
                    constraints=constraints,
                    force_refresh=force_refresh,
                    allow_semantic_fallback=("arxiv" not in allowed_sources),
                )
                self._record_source_status(source, result.status)
                if result.error:
                    logger.warning(
                        "research_source_fetch_error task_id=%s source=%s status=%s error=%s",
                        task.task_id,
                        source,
                        result.status,
                        result.error,
                    )
                all_papers.extend(result.papers)
                if touch_lease:
                    touch_lease()
        papers = self._dedupe_papers(all_papers)
        papers = self._rank_discovered_papers(papers, top_n=top_n, constraints=constraints)
        papers = papers[: max(1, top_n)]
        for row in papers:
            row["method_summary"] = self._summarize_method(row.get("abstract") or "")

        paper_repo = ResearchPaperRepo(db)
        if round_id:
            rows = paper_repo.upsert_direction_papers(direction, papers)
            ResearchRoundPaperRepo(db).replace_for_round(round_id=round_id, rows=rows, role="seed")
            round_row = ResearchRoundRepo(db).get(round_id)
            if round_row and round_row.task_id == task.id:
                ResearchRoundRepo(db).update_status(round_row, ResearchRoundStatus.DONE.value)
        else:
            rows = paper_repo.replace_direction_papers(direction, papers)
        ResearchDirectionRepo(db).update_papers_count(direction, len(paper_repo.list_for_direction(direction.id)))

        task.status = ResearchTaskStatus.DONE
        task.updated_at = datetime.now(timezone.utc)
        db.add(task)
        db.flush()
        self._emit_step_progress(
            db,
            task=task,
            step="search_completed",
            title="论文检索完成",
            message=(
                f"方向 {direction_index} 的第 {round_id} 轮探索已完成，新增 {len(rows)} 篇论文。"
                if round_id
                else f"方向 {direction_index} 检索完成，收录 {len(rows)} 篇论文。"
            ),
            status="done",
            details={"direction_index": direction_index, "round_id": round_id, "paper_count": len(rows)},
        )
        if round_id:
            msg = (
                f"已完成方向 {direction_index} 的第 {round_id} 轮检索，新增 {len(rows)} 篇。"
                "请在本地调研页面继续下一轮。"
            )
        else:
            msg = f"已完成方向 {direction_index} 检索，收录 {len(rows)} 篇。回复“调研 下一页”浏览结果，回复“调研 导出”导出文件。"
        self._notify_user(db, task.user_id, msg)

    def _run_fulltext_job(
        self,
        db: Session,
        task: ResearchTask,
        payload: dict,
        *,
        touch_lease: Callable[[], None] | None = None,
    ) -> None:
        force = bool(payload.get("force") or False)
        paper_filter = {str(x).strip() for x in _load_json_list(payload.get("paper_ids")) if str(x).strip()}
        papers = ResearchPaperRepo(db).list_for_task(task.id)
        fulltext_repo = ResearchPaperFulltextRepo(db)
        base_dir = Path(self.settings.research_artifact_dir).expanduser().resolve() / task.task_id / "fulltext"
        base_dir.mkdir(parents=True, exist_ok=True)
        for paper in papers:
            paper_id = _paper_token(paper)
            if paper_filter and paper_id not in paper_filter:
                continue
            current = fulltext_repo.get(task.id, paper_id)
            if (
                current
                and current.status == ResearchPaperFulltextStatus.PARSED
                and not force
            ):
                continue
            fulltext_repo.upsert(
                task_id=task.id,
                paper_id=paper_id,
                source_url=paper.url,
                status=ResearchPaperFulltextStatus.FETCHING.value,
                fail_reason=None,
            )
            pdf_bytes, source_url, error = self._download_pdf_for_paper(paper)
            if not pdf_bytes:
                fulltext_repo.upsert(
                    task_id=task.id,
                    paper_id=paper_id,
                    source_url=source_url or paper.url,
                    status=ResearchPaperFulltextStatus.NEED_UPLOAD.value,
                    fail_reason=error or "pdf_unavailable",
                )
                continue
            file_stem = re.sub(r"[^a-zA-Z0-9._-]+", "_", paper_id)[:80] or f"paper_{paper.id}"
            pdf_path = base_dir / f"{file_stem}.pdf"
            pdf_path.write_bytes(pdf_bytes)
            fetched_at = datetime.now(timezone.utc)
            fulltext_repo.upsert(
                task_id=task.id,
                paper_id=paper_id,
                source_url=source_url or paper.url,
                status=ResearchPaperFulltextStatus.FETCHED.value,
                pdf_path=str(pdf_path),
                fail_reason=None,
                fetched_at=fetched_at,
            )
            try:
                text, meta = self._parse_pdf_bytes(pdf_bytes)
                sections = _extract_sections_lite(text)
                quality = _estimate_text_quality(text)
                text_path = base_dir / f"{file_stem}.txt"
                text_path.write_text(text, encoding="utf-8")
                fulltext_repo.upsert(
                    task_id=task.id,
                    paper_id=paper_id,
                    source_url=source_url or paper.url,
                    status=ResearchPaperFulltextStatus.PARSED.value,
                    pdf_path=str(pdf_path),
                    text_path=str(text_path),
                    text_chars=len(text),
                    parser=str(meta.get("parser") or "")[:32] or None,
                    quality_score=quality,
                    sections_json=orjson.dumps(sections).decode("utf-8"),
                    fail_reason=None,
                    fetched_at=fetched_at,
                    parsed_at=datetime.now(timezone.utc),
                )
                current = fulltext_repo.get(task.id, paper_id)
                self._safe_build_paper_visual_assets(task=task, paper=paper, fulltext=current)
            except Exception as exc:
                fulltext_repo.upsert(
                    task_id=task.id,
                    paper_id=paper_id,
                    source_url=source_url or paper.url,
                    status=ResearchPaperFulltextStatus.NEED_UPLOAD.value,
                    pdf_path=str(pdf_path),
                    fail_reason=f"parse_failed:{exc}",
                    fetched_at=fetched_at,
                )
            if touch_lease:
                touch_lease()

        task.status = ResearchTaskStatus.DONE
        task.updated_at = datetime.now(timezone.utc)
        db.add(task)
        db.flush()
        summary = fulltext_repo.summary_for_task(task.id)
        self._emit_step_progress(
            db,
            task=task,
            step="fulltext_completed",
            title="全文处理完成",
            message=f"已解析 {summary.get('parsed', 0)} 篇全文，仍有 {summary.get('need_upload', 0)} 篇需要补传。",
            status="done",
            details=summary,
        )
        self._notify_user(
            db,
            task.user_id,
            (
                f"调研任务 {task.task_id} 全文处理完成。"
                f"已解析 {summary.get('parsed', 0)} 篇，待上传 {summary.get('need_upload', 0)} 篇。"
            ),
        )

    def _run_graph_job(
        self,
        db: Session,
        task: ResearchTask,
        payload: dict,
        *,
        touch_lease: Callable[[], None] | None = None,
    ) -> None:
        view = str(payload.get("view") or ResearchGraphViewType.CITATION.value).strip().lower()
        direction_index = _to_int_or_none(payload.get("direction_index"))
        round_id = _to_int_or_none(payload.get("round_id"))
        seed_top_n = max(1, int(payload.get("seed_top_n") or self.settings.research_graph_seed_topn))
        expand_limit = max(1, int(payload.get("expand_limit_per_paper") or self.settings.research_graph_expand_limit_per_paper))
        citation_sources = _resolve_citation_sources(payload.get("citation_sources"), self.settings.research_citation_sources_default)
        depth = max(1, int(self.settings.research_graph_depth_default))

        if view == ResearchGraphViewType.TREE.value:
            tree = self._build_tree_graph(
                db,
                task,
                include_papers=True,
                paper_limit=self.settings.research_graph_paper_limit_default,
            )
            ResearchGraphSnapshotRepo(db).upsert_snapshot(
                task_id=task.id,
                direction_index=direction_index,
                round_id=round_id,
                view_type=ResearchGraphViewType.TREE.value,
                depth=depth,
                nodes=tree["nodes"],
                edges=tree["edges"],
                stats=tree["stats"],
                status=ResearchGraphBuildStatus.DONE.value,
            )
            task.status = ResearchTaskStatus.DONE
            task.updated_at = datetime.now(timezone.utc)
            db.add(task)
            db.flush()
            self._emit_step_progress(
                db,
                task=task,
                step="tree_graph_completed",
                title="树状图已生成",
                message=f"已生成 {len(tree['nodes'])} 个节点、{len(tree['edges'])} 条连线的树状图。",
                status="done",
                details=tree["stats"],
            )
            return

        paper_repo = ResearchPaperRepo(db)
        fulltext_map = {
            row.paper_id: row
            for row in ResearchPaperFulltextRepo(db).list_for_task(task.id)
        }
        direction_repo = ResearchDirectionRepo(db)
        all_directions = direction_repo.list_for_task(task.id)
        direction_by_id = {d.id: d for d in all_directions}
        source_coverage: dict[str, int] = {}
        provider_errors: dict[str, str] = {}
        fallback_used = False

        if round_id is not None:
            round_row = ResearchRoundRepo(db).get(round_id)
            if not round_row or round_row.task_id != task.id:
                raise ValueError("round not found")
            direction_index = round_row.direction_index
            refs = ResearchRoundPaperRepo(db).list_for_round(round_row.id)
            rank_map = {x.paper_id: x.rank for x in refs}
            seeds = paper_repo.list_by_ids([x.paper_id for x in refs])
            seeds.sort(key=lambda x: rank_map.get(x.id, 999999))
            seed_papers = seeds[:seed_top_n]
            direction_row = direction_repo.get_by_index(task.id, direction_index)
            used_directions = [direction_row] if direction_row else []
        elif direction_index is not None:
            direction_row = direction_repo.get_by_index(task.id, direction_index)
            if not direction_row:
                raise ValueError("direction not found")
            seed_papers = paper_repo.list_for_direction(direction_row.id)[:seed_top_n]
            used_directions = [direction_row]
        else:
            seed_papers = paper_repo.list_for_task(task.id)[:seed_top_n]
            used_directions = all_directions

        nodes: dict[str, dict] = {}
        edges: list[dict] = []
        edge_seen: set[tuple[str, str, str]] = set()
        citation_edges: list[dict] = []

        topic_id = f"topic:{task.task_id}"
        nodes[topic_id] = {
            "id": topic_id,
            "type": "topic",
            "label": task.topic,
            "source": "memomate",
            "direction_index": None,
            "score": None,
            "fulltext_status": None,
        }
        for d in used_directions:
            d_node_id = f"direction:{task.task_id}:{d.direction_index}"
            nodes[d_node_id] = {
                "id": d_node_id,
                "type": "direction",
                "label": d.name,
                "source": "memomate",
                "direction_index": d.direction_index,
                "score": None,
                "fulltext_status": None,
            }
            key = (topic_id, d_node_id, "topic_direction")
            if key not in edge_seen:
                edges.append({"source": topic_id, "target": d_node_id, "type": "topic_direction", "weight": 1.0})
                edge_seen.add(key)

        for paper in seed_papers:
            p_id = _paper_token(paper)
            direction_idx = direction_by_id.get(paper.direction_id).direction_index if paper.direction_id in direction_by_id else None
            fulltext_row = fulltext_map.get(p_id)
            preview = self._paper_visual_preview(task=task, paper=paper, fulltext=fulltext_row)
            summary = self._paper_summary_view(paper=paper, fulltext=fulltext_row)
            nodes[p_id] = {
                "id": p_id,
                "type": "paper",
                "label": paper.title[:240],
                "year": paper.year,
                "source": paper.source,
                "direction_index": direction_idx,
                "score": None,
                "fulltext_status": fulltext_row.status.value if fulltext_row else None,
                "card_summary": summary["card_summary"],
                "summary_source": summary["summary_source"],
                "summary_status": summary["summary_status"],
                "preview_kind": preview.get("preview_kind"),
                "preview_url": preview.get("preview_url"),
                "visual_status": preview.get("visual_status"),
            }
            if direction_idx is not None:
                d_node_id = f"direction:{task.task_id}:{direction_idx}"
                key = (d_node_id, p_id, "direction_paper")
                if key not in edge_seen:
                    edges.append({"source": d_node_id, "target": p_id, "type": "direction_paper", "weight": 1.0})
                    edge_seen.add(key)

            neighbor_result = self._fetch_citation_neighbors_multi(
                db,
                task=task,
                paper=paper,
                limit=expand_limit,
                ordered_sources=citation_sources,
                force_refresh=bool(payload.get("force_refresh") or False),
            )
            for src, count in (neighbor_result.get("source_coverage") or {}).items():
                source_coverage[src] = source_coverage.get(src, 0) + int(count)
            if neighbor_result.get("fallback_used"):
                fallback_used = True
            for src, err in (neighbor_result.get("provider_errors") or {}).items():
                provider_errors[src] = err
            for item in neighbor_result["items"]:
                n_id = str(item.get("neighbor_id") or "").strip()
                if not n_id:
                    continue
                if n_id not in nodes:
                    nodes[n_id] = {
                        "id": n_id,
                        "type": "paper",
                        "label": str(item.get("title") or "Untitled")[:240],
                        "year": _to_int_or_none(item.get("year")),
                        "source": str(item.get("source") or "semantic_scholar"),
                        "direction_index": direction_idx,
                        "score": None,
                        "fulltext_status": fulltext_map.get(n_id).status.value if fulltext_map.get(n_id) else None,
                        "preview_kind": None,
                        "preview_url": None,
                        "visual_status": "missing",
                    }
                src = str(item.get("source_id") or "").strip()
                dst = str(item.get("target_id") or "").strip()
                edge_type = str(item.get("edge_type") or "cites").strip()
                if not src or not dst:
                    continue
                key = (src, dst, edge_type)
                if key in edge_seen:
                    continue
                edge_seen.add(key)
                edge_item = {
                    "source": src,
                    "target": dst,
                    "type": edge_type,
                    "weight": float(item.get("weight") or 1.0),
                    "source_name": str(item.get("source_name") or "semantic_scholar"),
                }
                edges.append(edge_item)
                if edge_type in {"cites", "cited_by"}:
                    citation_edges.append(edge_item)
            if touch_lease:
                touch_lease()

        stats = self._compute_graph_stats(nodes=list(nodes.values()), edges=edges)
        stats["source_coverage"] = source_coverage
        stats["fallback_used"] = fallback_used
        stats["provider_errors"] = provider_errors
        for node in nodes.values():
            if node["id"] in stats.get("scores", {}):
                node["score"] = float(stats["scores"][node["id"]])

        ResearchCitationEdgeRepo(db).replace_for_task(task.id, citation_edges)
        ResearchGraphSnapshotRepo(db).upsert_snapshot(
            task_id=task.id,
            direction_index=direction_index,
            round_id=round_id,
            view_type=ResearchGraphViewType.CITATION.value,
            depth=depth,
            nodes=list(nodes.values()),
            edges=edges,
            stats=stats,
            status=ResearchGraphBuildStatus.DONE.value,
        )
        task.status = ResearchTaskStatus.DONE
        task.updated_at = datetime.now(timezone.utc)
        db.add(task)
        db.flush()
        self._emit_step_progress(
            db,
            task=task,
            step="citation_graph_completed",
            title="图谱构建完成",
            message=f"已生成 {stats.get('node_count', 0)} 个节点、{stats.get('edge_count', 0)} 条连线。",
            status="done",
            details={"view": view, **stats},
        )
        self._notify_user(
            db,
            task.user_id,
            (
                f"调研任务 {task.task_id} 图谱构建完成。"
                f"节点 {stats.get('node_count', 0)}，边 {stats.get('edge_count', 0)}。"
                "回复“调研 图谱 查看”查看。"
            ),
        )

    def _run_paper_summary_job(
        self,
        db: Session,
        task: ResearchTask,
        payload: dict,
        *,
        touch_lease: Callable[[], None] | None = None,
    ) -> None:
        paper_token = str(payload.get("paper_token") or "").strip()
        if not paper_token:
            raise ValueError("paper_token is required")
        paper_repo = ResearchPaperRepo(db)
        paper = paper_repo.get_by_token(task.id, paper_token)
        if not paper:
            raise ValueError("paper not found")
        paper_repo.update_key_points(paper, status="running", error=None)
        paper_key = _paper_token(paper)
        fulltext = ResearchPaperFulltextRepo(db).get(task.id, paper_key)
        source = "abstract"
        text = (paper.abstract or "").strip()
        if fulltext and fulltext.text_path:
            try:
                p = Path(fulltext.text_path)
                if p.exists():
                    raw = p.read_text(encoding="utf-8", errors="ignore")
                    if raw.strip():
                        source = "fulltext"
                        text = raw.strip()
            except Exception:
                logger.exception("paper_summary_read_fulltext_failed paper=%s", paper_key)
        if not text:
            paper_repo.update_key_points(paper, status="failed", error="no_text_for_summary")
            raise ValueError("no text available for summary")
        if touch_lease:
            touch_lease()
        points = self._summarize_structured_key_points(text=text, source=source)
        paper_repo.update_key_points(
            paper,
            status="done",
            key_points=points,
            source=source,
            error=None,
        )
        if paper.saved and paper.saved_path:
            try:
                md_path = Path(paper.saved_path)
                md_path.parent.mkdir(parents=True, exist_ok=True)
                md_path.write_text(self._render_saved_paper_markdown(task, paper), encoding="utf-8")
            except Exception:
                logger.exception("paper_summary_refresh_saved_file_failed paper=%s", paper_key)
        task.status = ResearchTaskStatus.DONE
        task.updated_at = datetime.now(timezone.utc)
        db.add(task)
        db.flush()
        self._emit_step_progress(
            db,
            task=task,
            step="paper_summary_completed",
            title="论文要点已生成",
            message=f"已为论文《{paper.title[:48]}》生成关键要点。",
            status="done",
            details={"paper_id": paper_key, "source": source},
        )

    def _run_auto_research_job(
        self,
        db: Session,
        task: ResearchTask,
        payload: dict,
        *,
        touch_lease: Callable[[], None] | None = None,
    ) -> None:
        run_id = str(payload.get("run_id") or "").strip()
        phase = str(payload.get("phase") or "start").strip().lower()
        if not run_id:
            raise ValueError("run_id is required")
        task.auto_status = ResearchAutoStatus.RUNNING
        task.status = ResearchTaskStatus.SEARCHING
        task.updated_at = datetime.now(timezone.utc)
        db.add(task)
        db.flush()
        self._emit_run_event(
            db,
            task=task,
            run_id=run_id,
            event_type=ResearchRunEventType.PROGRESS,
            payload={"message": f"auto research {phase} started", "phase": phase},
        )
        if phase == "start":
            directions = ResearchDirectionRepo(db).list_for_task(task.id)
            if not directions:
                constraints = _load_json_dict(task.constraints_json)
                seed_rows = self._build_seed_corpus_for_task(db, task=task, constraints=constraints)
                directions = self._plan_directions_from_seed(
                    task.topic,
                    constraints,
                    seed_rows,
                    backend=task.llm_backend.value,
                    model=task.llm_model,
                    project_context=self._project_context_prompt(db, task=task),
                )
                ResearchDirectionRepo(db).replace_for_task(task, directions)
            if touch_lease:
                touch_lease()
            graph = self._build_tree_graph(db, task, include_papers=False)
            for node in graph["nodes"]:
                self._emit_run_event(
                    db,
                    task=task,
                    run_id=run_id,
                    event_type=ResearchRunEventType.NODE_UPSERT,
                    payload=node,
                )
            for edge in graph["edges"]:
                self._emit_run_event(
                    db,
                    task=task,
                    run_id=run_id,
                    event_type=ResearchRunEventType.EDGE_UPSERT,
                    payload=edge,
                )
            checkpoint_id = f"ckpt-{uuid4().hex[:10]}"
            task.last_checkpoint_id = checkpoint_id
            task.auto_status = ResearchAutoStatus.AWAITING_GUIDANCE
            task.status = ResearchTaskStatus.DONE
            task.updated_at = datetime.now(timezone.utc)
            db.add(task)
            db.flush()
            self._emit_run_event(
                db,
                task=task,
                run_id=run_id,
                event_type=ResearchRunEventType.CHECKPOINT,
                payload={
                    "checkpoint_id": checkpoint_id,
                    "title": "Initial research map",
                    "summary": "已生成第一版 topic/direction 研究图谱，请给出下一阶段引导。",
                    "suggested_next_steps": [
                        "指定优先扩展的方向",
                        "要求加入特定约束或关键论文",
                        "聚焦某个方法路线继续深入",
                    ],
                    "graph_delta_summary": {
                        "node_count": len(graph["nodes"]),
                        "edge_count": len(graph["edges"]),
                    },
                    "report_excerpt": "初版图谱已建立，当前在第一个 checkpoint 等待用户引导。",
                },
            )
            return

        guidance = self._latest_guidance_text(db, task_id=task.id, run_id=run_id)
        prompt = (
            "你是 openclaw auto research orchestrator。请基于 topic、已有方向和用户 guidance，输出一段阶段报告。\n\n"
            f"Topic: {task.topic}\n"
            f"Directions: {orjson.dumps([d.name for d in ResearchDirectionRepo(db).list_for_task(task.id)]).decode('utf-8')}\n"
            f"Guidance: {guidance}\n"
            "请输出一段结构化中文总结，包含：当前重点、建议下一步、风险。"
        )
        prompt = (
            "You are the OpenClaw Auto research orchestrator for this local research workspace.\n"
            "Write a concise Chinese stage report based only on the topic, current directions, and user guidance.\n\n"
            f"Topic: {task.topic}\n"
            f"Directions: {orjson.dumps([d.name for d in ResearchDirectionRepo(db).list_for_task(task.id)]).decode('utf-8')}\n"
            f"Guidance: {guidance or 'None'}\n\n"
            "Report structure:\n"
            "1. 当前阶段重点\n"
            "2. 已形成的研究判断\n"
            "3. 建议下一步扩展方向\n"
            "4. 风险与需要用户确认的问题\n"
        )
        try:
            result = self.llm_gateway.chat_text(
                backend=ResearchLLMBackend.OPENCLAW.value,
                model=task.llm_model,
                system_prompt="Act like an autonomous research run, but respond with a concise stage report.",
                prompt=prompt,
                temperature=0.2,
                max_tokens=1200,
            )
            report_text = result.text.strip()
        except Exception as exc:
            logger.warning(
                "auto_research_continue_fallback task_id=%s run_id=%s error=%s",
                task.task_id,
                run_id,
                exc,
            )
            report_text = (
                f"Stage summary for {task.topic}\n\n"
                f"- Guidance received: {guidance or 'None'}\n"
                "- Current focus: keep the existing direction graph and prioritize user-selected branches.\n"
                "- Suggested next step: continue with retrieval-augmented exploration, then add a focused paper search.\n"
                "- Risks: OpenClaw is not currently available in this local environment, so this report is a safe fallback.\n"
            )
        report_dir = Path(self.settings.research_artifact_dir) / task.task_id / "runs" / run_id
        report_dir.mkdir(parents=True, exist_ok=True)
        report_path = report_dir / "stage-report.md"
        report_md = (
            f"# {task.topic}\n\n"
            f"## Run\n\n- run_id: {run_id}\n- phase: {phase}\n\n"
            f"## Guidance\n\n{guidance or 'None'}\n\n"
            f"## Report\n\n{report_text}\n"
        )
        report_path.write_text(report_md, encoding="utf-8")
        report_node_id = f"report:{run_id}"
        self._emit_run_event(
            db,
            task=task,
            run_id=run_id,
            event_type=ResearchRunEventType.REPORT_CHUNK,
            payload={"title": "Stage report", "content": report_text},
        )
        self._emit_run_event(
            db,
            task=task,
            run_id=run_id,
            event_type=ResearchRunEventType.NODE_UPSERT,
            payload={
                "id": report_node_id,
                "type": "report",
                "label": "Stage report",
                "summary": report_text[:280],
                "status": "done",
            },
        )
        self._emit_run_event(
            db,
            task=task,
            run_id=run_id,
            event_type=ResearchRunEventType.EDGE_UPSERT,
            payload={
                "source": f"topic:{task.task_id}",
                "target": report_node_id,
                "type": "topic_report",
                "weight": 1.0,
            },
        )
        self._emit_run_event(
            db,
            task=task,
            run_id=run_id,
            event_type=ResearchRunEventType.ARTIFACT,
            payload={"kind": "report", "path": str(report_path)},
        )
        task.auto_status = ResearchAutoStatus.COMPLETED
        task.status = ResearchTaskStatus.DONE
        task.updated_at = datetime.now(timezone.utc)
        db.add(task)
        db.flush()

    def _step_run_id(self, task: ResearchTask | str) -> str:
        task_id = task.task_id if isinstance(task, ResearchTask) else str(task).strip()
        return f"step-{task_id}"

    def _emit_step_progress(
        self,
        db: Session,
        *,
        task: ResearchTask,
        step: str,
        title: str,
        message: str,
        status: str,
        details: dict | None = None,
        result_refs: dict | None = None,
    ) -> dict:
        return self._emit_run_event(
            db,
            task=task,
            run_id=self._step_run_id(task),
            event_type=ResearchRunEventType.PROGRESS,
            payload={
                "kind": "gpt_step",
                "step": step,
                "title": title,
                "message": message,
                "status": status,
                "details": details or {},
                "result_refs": result_refs or {},
            },
        )

    def _emit_run_event(
        self,
        db: Session,
        *,
        task: ResearchTask,
        run_id: str,
        event_type: ResearchRunEventType,
        payload: dict,
    ) -> dict:
        row = ResearchRunEventRepo(db).create_event(
            task_id=task.id,
            run_id=run_id,
            event_type=event_type,
            payload={
                "run_id": run_id,
                "task_id": task.task_id,
                "event_type": event_type.value,
                "payload": payload,
            },
        )
        return self._run_event_to_dict(task.task_id, row)

    def _summarize_run_events(self, rows) -> dict:
        phase_map: dict[str, dict] = {}
        latest_checkpoint: dict | None = None
        latest_report: dict | None = None
        artifacts: list[dict] = []
        guidance_history: list[dict] = []
        step_cards: list[dict] = []
        latest_seq = 0
        for row in rows:
            _run_id, _task_id, event_type, payload = self._decode_run_event(row, task_id="")
            latest_seq = max(latest_seq, int(row.seq or 0))
            phase_key, phase_label = self._phase_summary_key(event_type, payload)
            if phase_key:
                current = phase_map.setdefault(
                    phase_key,
                    {
                        "key": phase_key,
                        "label": phase_label,
                        "event_count": 0,
                        "started_seq": row.seq,
                        "latest_seq": row.seq,
                    },
                )
                current["event_count"] += 1
                current["latest_seq"] = row.seq
            if event_type == ResearchRunEventType.CHECKPOINT.value:
                latest_checkpoint = payload
            elif event_type == ResearchRunEventType.REPORT_CHUNK.value:
                latest_report = payload
            elif event_type == ResearchRunEventType.ARTIFACT.value:
                artifacts.append(payload)
            if payload.get("kind") == "user_guidance":
                guidance_history.append(
                    {
                        "seq": row.seq,
                        "text": str(payload.get("text") or "").strip(),
                        "tags": list(payload.get("tags") or []),
                        "created_at": row.created_at,
                    }
                )
            if payload.get("kind") == "gpt_step":
                step_cards.append(
                    {
                        "key": str(payload.get("step") or event_type),
                        "title": str(payload.get("title") or self._step_label(str(payload.get("step") or event_type))),
                        "status": str(payload.get("status") or "").strip() or None,
                        "seq": row.seq,
                        "details": _load_json_dict(payload.get("details")),
                        "result_refs": _load_json_dict(payload.get("result_refs")),
                        "created_at": row.created_at,
                    }
                )
        latest_report_excerpt = None
        if latest_report:
            latest_report_excerpt = (
                str(latest_report.get("report_excerpt") or "").strip()
                or str(latest_report.get("summary") or "").strip()
                or str(latest_report.get("content") or "").strip()
                or None
            )
        return {
            "total": len(rows),
            "latest_seq": latest_seq,
            "phases": list(phase_map.values()),
            "phase_groups": list(phase_map.values()),
            "latest_checkpoint": latest_checkpoint,
            "latest_report": latest_report,
            "latest_report_excerpt": latest_report_excerpt,
            "guidance_history": guidance_history[-10:],
            "step_cards": step_cards[-20:],
            "artifacts": artifacts[-10:],
        }

    def _decode_run_event(self, row, *, task_id: str) -> tuple[str, str, str, dict]:
        data = _load_json_dict(row.payload_json)
        if "payload" in data:
            return (
                str(data.get("run_id") or row.run_id),
                str(data.get("task_id") or task_id),
                str(data.get("event_type") or row.event_type.value),
                _load_json_dict(data.get("payload")),
            )
        return (
            str(row.run_id),
            str(task_id),
            str(row.event_type.value),
            data,
        )

    def _phase_summary_key(self, event_type: str, payload: dict) -> tuple[str, str]:
        if payload.get("kind") == "gpt_step":
            step = str(payload.get("step") or event_type).strip() or event_type
            return step, self._step_label(step)
        if event_type == ResearchRunEventType.CHECKPOINT.value:
            return "checkpoint", "Checkpoint"
        if event_type == ResearchRunEventType.REPORT_CHUNK.value:
            return "report", "阶段报告"
        if event_type == ResearchRunEventType.ARTIFACT.value:
            return "artifact", "产出物"
        phase = str(payload.get("phase") or "").strip().lower()
        if phase:
            return phase, phase.replace("_", " ").title()
        if event_type in {
            ResearchRunEventType.NODE_UPSERT.value,
            ResearchRunEventType.EDGE_UPSERT.value,
            ResearchRunEventType.PAPER_UPSERT.value,
        }:
            return "graph_sync", "图谱同步"
        return event_type, event_type.replace("_", " ").title()

    def _step_label(self, step: str) -> str:
        labels = {
            "task_created": "任务创建",
            "plan_queued": "方向规划排队",
            "plan_completed": "方向规划完成",
            "search_queued": "论文检索排队",
            "search_completed": "论文检索完成",
            "exploration_started": "开始探索",
            "candidates_generated": "候选生成",
            "candidate_selected": "候选已选",
            "next_round_created": "下一轮探索",
            "graph_queued": "图谱构建排队",
            "tree_graph_completed": "树状图完成",
            "citation_graph_completed": "图谱构建完成",
            "fulltext_queued": "全文处理排队",
            "fulltext_completed": "全文处理完成",
            "paper_saved": "论文保存",
            "paper_summary_queued": "论文总结排队",
            "paper_summary_completed": "论文总结完成",
        }
        return labels.get(step, step.replace("_", " "))

    def _latest_guidance_text(self, db: Session, *, task_id: int, run_id: str) -> str:
        rows = ResearchRunEventRepo(db).list_for_run(task_id=task_id, run_id=run_id, limit=200)
        for row in reversed(rows):
            _run_id, _task_id, event_type, payload = self._decode_run_event(row, task_id="")
            if event_type == ResearchRunEventType.PROGRESS.value and payload.get("kind") == "user_guidance":
                return str(payload.get("text") or "").strip()
        return ""

    def _run_event_to_dict(self, task_id: str, row) -> dict:
        run_id, task_token, event_type, payload = self._decode_run_event(row, task_id=task_id)
        return {
            "run_id": run_id,
            "task_id": task_token,
            "event_type": event_type,
            "seq": row.seq,
            "payload": payload,
            "created_at": row.created_at,
        }

    def _node_chat_to_dict(self, task_id: str, row) -> dict:
        return {
            "id": row.id,
            "task_id": task_id,
            "node_id": row.node_id,
            "thread_id": row.thread_id,
            "question": row.question,
            "answer": row.answer,
            "provider": row.provider,
            "model": row.model,
            "created_at": row.created_at,
        }

    def _sanitize_node_chat_answer(self, answer: str, *, context: dict, question: str) -> str:
        text = (answer or "").strip()
        raw_prompt_markers = ("Node context JSON:", "User question:", "research node assistant")
        if not text or any(marker in text for marker in raw_prompt_markers):
            return self._local_node_chat_answer(context=context, question=question)
        return text

    def _local_node_chat_answer(self, *, context: dict, question: str) -> str:
        node_type = str(context.get("type") or "unknown")
        label = str(context.get("label") or context.get("title") or context.get("name") or context.get("id") or "当前节点").strip()
        summary = self._compact_text(
            str(
                context.get("card_summary")
                or context.get("summary")
                or context.get("method_summary")
                or context.get("abstract")
                or context.get("description")
                or context.get("userNote")
                or ""
            ),
            420,
        )
        if node_type == "paper":
            title = str(context.get("title") or label)
            return (
                f"这篇论文节点的核心价值在于：它为当前任务提供了一条可追踪的论文证据。\n\n"
                f"- 论文：{title}\n"
                f"- 来源信息：{context.get('venue') or 'venue 未标注'} / {context.get('year') or '年份未标注'} / {context.get('source') or '来源未标注'}\n"
                f"- 当前可用信息：{summary or '目前只有基础元数据，建议先处理全文或打开 PDF 后再做深入问答。'}\n\n"
                f"针对你的问题“{question.strip()}”，我建议下一步优先看它解决的问题、方法假设、实验结果和局限，并把它和当前研究主题的关系写成一个 note/report 节点。"
            )
        if node_type == "direction":
            return (
                f"这个方向节点的核心价值是把总主题拆成一条可执行的检索路线。\n\n"
                f"- 方向：{label}\n"
                f"- 当前摘要：{summary or '还没有足够摘要信息，建议先执行“检索方向”。'}\n\n"
                f"如果要继续推进，可以沿这个方向补论文、生成候选分支，或者构建图谱看看它和其它方向的关系。"
            )
        if node_type == "topic":
            return (
                f"Topic node overview for: {label}\n\n"
                f"- Current context: {summary or 'No structured direction or paper summary is available yet.'}\n"
                "- Suggested next step: inspect which directions already have papers, which directions still lack evidence, "
                "and then decide whether to continue search, build graph, process fulltext, or branch into a new exploration round."
            )
        if node_type in {"question", "note", "reference", "group", "report"}:
            return (
                f"这是一个手工{node_type}节点，核心价值在于承接你的人工判断和阶段性整理。\n\n"
                f"- 节点：{label}\n"
                f"- 已记录内容：{summary or '这个节点还没有写入具体内容。'}\n\n"
                f"建议直接在这个节点里沉淀问题、答案和下一步行动；如果它要关联论文，可以手工连到相关 paper 或 direction 节点。"
            )
        return (
            f"当前节点“{label}”的可用上下文较少。\n\n"
            f"我能确认的是：它属于 `{node_type}` 类型，和任务中的某个研究步骤或手工整理有关。"
            f"{' 当前摘要：' + summary if summary else ' 建议先补充备注、连到相关论文，或选择更具体的 paper/direction 节点提问。'}"
        )

    def _resolve_node_context(self, db: Session, *, task: ResearchTask, node_id: str) -> dict:
        if node_id == f"topic:{task.task_id}":
            directions = ResearchDirectionRepo(db).list_for_task(task.id)
            direction_items = [
                {
                    "direction_index": row.direction_index,
                    "name": row.name,
                    "papers_count": len(row.papers or []),
                }
                for row in directions[:8]
            ]
            summary_lines = [f"研究主题：{task.topic}", f"任务状态：{task.status.value}"]
            if direction_items:
                summary_lines.append("已规划方向：")
                summary_lines.extend(f"- 方向 {item['direction_index']}：{item['name']}（{item['papers_count']} 篇论文）" for item in direction_items[:5])
            else:
                summary_lines.append("当前还没有方向结果。")
            return {
                "id": node_id,
                "type": "topic",
                "label": task.topic,
                "status": task.status.value,
                "mode": task.mode.value,
                "auto_status": task.auto_status.value if task.auto_status else None,
                "project_name": task.project.name if task.project else None,
                "summary": "\n".join(summary_lines),
                "directions": direction_items,
            }
        if node_id.startswith("paper:"):
            paper = ResearchPaperRepo(db).get_by_token(task.id, node_id)
            if paper:
                fulltext = ResearchPaperFulltextRepo(db).get(task.id, _paper_token(paper))
                summary = self._paper_summary_view(paper=paper, fulltext=fulltext)
                return {
                    "type": "paper",
                    "title": paper.title,
                    "authors": _load_json_list(paper.authors_json),
                    "year": paper.year,
                    "venue": paper.venue,
                    "abstract": paper.abstract,
                    "method_summary": paper.method_summary,
                    "card_summary": summary["card_summary"],
                    "summary_source": summary["summary_source"],
                    "key_points": summary["detail_summary"],
                    "source": paper.source,
                    "saved": paper.saved,
                }
        graph = self._build_tree_graph(db, task, include_papers=True, paper_limit=self.settings.research_graph_paper_limit_default)
        for node in graph["nodes"]:
            if str(node.get("id")) == node_id:
                return node
        canvas = ResearchCanvasStateRepo(db).get_for_task(task.id)
        if canvas:
            state = _load_json_dict(canvas.state_json)
            for node in state.get("nodes") or []:
                if str(node.get("id")) != node_id:
                    continue
                data = dict(node.get("data") or {})
                return {
                    "id": node_id,
                    "type": str(node.get("type") or data.get("type") or "manual"),
                    "label": str(data.get("label") or node_id),
                    "summary": str(data.get("summary") or ""),
                    "userNote": str(data.get("userNote") or ""),
                    "isManual": bool(data.get("isManual", True)),
                }
        return {"id": node_id, "type": "unknown", "label": node_id}

    def _default_canvas_from_graph(self, *, task_id: str, graph: dict) -> dict:
        nodes = []
        edges = []
        type_columns = {
            "topic": 0,
            "direction": 1,
            "round": 2,
            "paper": 3,
            "checkpoint": 2,
            "report": 3,
        }
        counts: dict[str, int] = {}
        for node in graph.get("nodes", []):
            node_type = str(node.get("type") or "note")
            col = type_columns.get(node_type, 4)
            row = counts.get(node_type, 0)
            counts[node_type] = row + 1
            nodes.append(
                {
                    "id": node.get("id"),
                    "type": node_type,
                    "position": {"x": 120 + col * 320, "y": 100 + row * 180},
                    "data": node,
                    "hidden": False,
                }
            )
        for idx, edge in enumerate(graph.get("edges", []), start=1):
            source = str(edge.get("source") or "")
            target = str(edge.get("target") or "")
            edges.append(
                {
                    "id": f"edge:{task_id}:{idx}:{source}:{target}",
                    "source": source,
                    "target": target,
                    "type": "smoothstep",
                    "data": edge,
                    "hidden": False,
                }
            )
        return {
            "nodes": nodes,
            "edges": edges,
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "ui": self._default_canvas_ui(),
        }

    def _default_canvas_ui(self) -> dict:
        return {
            "left_sidebar_collapsed": False,
            "right_sidebar_collapsed": False,
            "left_sidebar_width": 320,
            "right_sidebar_width": 420,
            "show_minimap": False,
            "layout_mode": "elk_layered",
        }

    def _search_with_cache(
        self,
        *,
        cache_repo: ResearchSearchCacheRepo,
        task: ResearchTask,
        direction_index: int,
        source: str,
        query: str,
        top_n: int,
        constraints: dict,
        force_refresh: bool,
        allow_semantic_fallback: bool,
    ) -> SearchFetchResult:
        year_from = _to_int_or_none(constraints.get("year_from"))
        year_to = _to_int_or_none(constraints.get("year_to"))
        cache_enabled = bool(self.settings.research_cache_enabled)
        if cache_enabled and not force_refresh:
            cached = cache_repo.get_valid(
                task_id=task.id,
                direction_index=direction_index,
                source=source,
                query_text=query,
                year_from=year_from,
                year_to=year_to,
                top_n=top_n,
            )
            if cached is not None:
                self._record_cache_hit()
                logger.info(
                    "research_cache_hit task_id=%s direction=%s source=%s top_n=%s",
                    task.task_id,
                    direction_index,
                    source,
                    top_n,
                )
                return SearchFetchResult(papers=cached, status="cache_hit")
        self._record_cache_miss()
        fetched = self._search_by_source(
            source=source,
            query=query,
            top_n=top_n,
            constraints=constraints,
            allow_semantic_fallback=allow_semantic_fallback,
        )
        if cache_enabled and fetched.status in {"ok", "ok_empty"}:
            try:
                cache_repo.upsert(
                    task_id=task.id,
                    direction_index=direction_index,
                    source=source,
                    query_text=query,
                    year_from=year_from,
                    year_to=year_to,
                    top_n=top_n,
                    papers=fetched.papers,
                    ttl_seconds=max(1, int(self.settings.research_cache_ttl_seconds)),
                )
            except Exception:
                logger.exception(
                    "research_cache_upsert_failed task_id=%s direction=%s source=%s",
                    task.task_id,
                    direction_index,
                    source,
                )
        return fetched

    def _search_by_source(
        self,
        *,
        source: str,
        query: str,
        top_n: int,
        constraints: dict,
        allow_semantic_fallback: bool,
    ) -> SearchFetchResult:
        source_key = source.strip().lower()
        if source_key == "semantic_scholar":
            papers, status, error = _normalize_source_response(
                self._search_semantic_scholar(query, top_n=top_n, constraints=constraints)
            )
            if allow_semantic_fallback and status in {"rate_limited", "http_5xx"} and not papers:
                fallback_papers, fb_status, fb_error = _normalize_source_response(
                    self._search_arxiv(query, top_n=top_n, constraints=constraints)
                )
                if fallback_papers:
                    return SearchFetchResult(
                        papers=fallback_papers,
                        status=f"fallback_arxiv_from_{status}",
                        error=fb_error,
                    )
                return SearchFetchResult(
                    papers=[],
                    status=f"fallback_arxiv_from_{status}",
                    error=fb_error or error,
                )
            return SearchFetchResult(papers=papers, status=status, error=error)
        if source_key == "arxiv":
            papers, status, error = _normalize_source_response(
                self._search_arxiv(query, top_n=top_n, constraints=constraints)
            )
            return SearchFetchResult(papers=papers, status=status, error=error)
        if source_key == "openalex":
            papers, status, error = _normalize_source_response(
                self._search_openalex(query, top_n=top_n, constraints=constraints)
            )
            return SearchFetchResult(papers=papers, status=status, error=error)
        return SearchFetchResult(papers=[], status="unsupported_source", error=f"unsupported_source:{source_key}")

    def _download_pdf_for_paper(self, paper) -> tuple[bytes | None, str | None, str | None]:
        candidates = self._candidate_pdf_urls(paper)
        max_file_size = max(1, int(self.settings.research_fulltext_max_file_mb)) * 1024 * 1024
        timeout = max(5, int(self.settings.research_fulltext_timeout_seconds))
        retries = max(1, int(self.settings.research_fulltext_retries))
        trust_env = False
        for candidate in candidates:
            for attempt in range(retries):
                try:
                    with httpx.Client(timeout=timeout, follow_redirects=True, trust_env=trust_env) as client:
                        resp = client.get(candidate)
                    if resp.status_code >= 400:
                        if attempt < retries - 1:
                            sleep(0.2 * (2**attempt))
                            continue
                        break
                    content_type = (resp.headers.get("content-type") or "").lower()
                    data = resp.content
                    if len(data) > max_file_size:
                        return None, candidate, "file_too_large"
                    if "pdf" in content_type or data[:4] == b"%PDF":
                        return data, candidate, None
                    links = _extract_pdf_links_from_html(resp.text, candidate)
                    for link in links:
                        if link not in candidates:
                            candidates.append(link)
                except Exception as exc:
                    if attempt < retries - 1:
                        sleep(0.2 * (2**attempt))
                        continue
                    logger.warning("fulltext_download_failed paper=%s url=%s error=%s", getattr(paper, "id", None), candidate, exc)
                    break
        return None, None, "no_pdf_url_found"

    def _candidate_pdf_urls(self, paper) -> list[str]:
        out: list[str] = []
        url = (paper.url or "").strip()
        doi = (paper.doi or "").strip()
        if url:
            out.append(url)
            if "arxiv.org/abs/" in url:
                out.append(url.replace("/abs/", "/pdf/") + ".pdf")
            if "arxiv.org/pdf/" in url and not url.endswith(".pdf"):
                out.append(f"{url}.pdf")
            if not url.lower().endswith(".pdf"):
                out.append(f"{url}.pdf")
        if doi:
            out.append(f"https://doi.org/{doi}")
        out.extend(self._live_pdf_candidate_urls(paper))
        unique: list[str] = []
        seen = set()
        for item in out:
            if not item or item in seen:
                continue
            unique.append(item)
            seen.add(item)
        return unique

    def _live_pdf_candidate_urls(self, paper) -> list[str]:
        candidates: list[str] = []
        for loader in (self._semantic_scholar_pdf_candidates, self._arxiv_pdf_candidates, self._openalex_pdf_candidates):
            try:
                candidates.extend(loader(paper))
            except Exception:
                logger.exception("paper_pdf_candidate_loader_failed loader=%s paper=%s", loader.__name__, _paper_token(paper))
        unique: list[str] = []
        seen = set()
        for item in candidates:
            url = str(item or "").strip()
            if not url or url in seen:
                continue
            seen.add(url)
            unique.append(url)
        return unique

    def _semantic_scholar_pdf_candidates(self, paper) -> list[str]:
        paper_id = str(getattr(paper, "paper_id", "") or "").strip()
        doi = str(getattr(paper, "doi", "") or "").strip()
        source = str(getattr(paper, "source", "") or "").strip().lower()
        url = str(getattr(paper, "url", "") or "").strip().lower()
        identifier = f"DOI:{doi}" if doi else (paper_id if source == "semantic_scholar" or "semanticscholar.org" in url else "")
        if not identifier:
            return []
        params = {"fields": "openAccessPdf,externalIds,url"}
        headers = {"User-Agent": "MemoMate/0.1 (research)"}
        api_key = self.settings.semantic_scholar_api_key.strip()
        if api_key:
            headers["x-api-key"] = api_key
        with httpx.Client(timeout=20, follow_redirects=True, trust_env=False) as client:
            resp = client.get(
                f"https://api.semanticscholar.org/graph/v1/paper/{quote_plus(identifier)}",
                params=params,
                headers=headers,
            )
        if resp.status_code >= 400:
            return []
        payload = resp.json() if resp.content else {}
        urls: list[str] = []
        open_access_pdf = payload.get("openAccessPdf") if isinstance(payload, dict) else None
        if isinstance(open_access_pdf, dict):
            pdf_url = str(open_access_pdf.get("url") or "").strip()
            if pdf_url:
                urls.append(pdf_url)
        paper_url = str(payload.get("url") or "").strip() if isinstance(payload, dict) else ""
        if paper_url:
            urls.append(paper_url)
        external_ids = payload.get("externalIds") if isinstance(payload, dict) and isinstance(payload.get("externalIds"), dict) else {}
        arxiv_id = str(external_ids.get("ArXiv") or external_ids.get("Arxiv") or "").strip()
        if arxiv_id:
            normalized = arxiv_id.replace("arXiv:", "").strip()
            urls.append(f"https://arxiv.org/pdf/{normalized}.pdf")
            urls.append(f"https://arxiv.org/abs/{normalized}")
        return urls

    def _openalex_pdf_candidates(self, paper) -> list[str]:
        doi = str(getattr(paper, "doi", "") or "").strip().lower()
        if not doi:
            return []
        with httpx.Client(timeout=20, follow_redirects=True, trust_env=False) as client:
            resp = client.get(
                "https://api.openalex.org/works",
                params={"filter": f"doi:https://doi.org/{doi}", "per-page": "1"},
            )
        if resp.status_code >= 400:
            return []
        payload = resp.json() if resp.content else {}
        results = payload.get("results") if isinstance(payload, dict) else None
        if not isinstance(results, list) or not results:
            return []
        item = results[0] if isinstance(results[0], dict) else {}
        urls: list[str] = []
        location_candidates: list[object] = [
            item.get("best_oa_location"),
            item.get("primary_location"),
        ]
        locations = item.get("locations")
        if isinstance(locations, list):
            location_candidates.extend(locations)
        open_access = item.get("open_access")
        if isinstance(open_access, dict):
            location_candidates.append({"pdf_url": open_access.get("oa_url"), "landing_page_url": open_access.get("oa_url")})
        for raw in location_candidates:
            if not isinstance(raw, dict):
                continue
            pdf_url = str(raw.get("pdf_url") or "").strip()
            landing_page_url = str(raw.get("landing_page_url") or "").strip()
            if pdf_url:
                urls.append(pdf_url)
            if landing_page_url:
                urls.append(landing_page_url)
                if "arxiv.org/abs/" in landing_page_url:
                    urls.append(landing_page_url.replace("/abs/", "/pdf/") + ".pdf")
        return urls

    def _arxiv_pdf_candidates(self, paper) -> list[str]:
        title = str(getattr(paper, "title", "") or "").strip()
        if not title:
            return []
        with httpx.Client(timeout=20, follow_redirects=True, trust_env=False) as client:
            resp = client.get(
                "https://export.arxiv.org/api/query",
                params={"search_query": f'ti:"{title}"', "start": "0", "max_results": "3"},
            )
        if resp.status_code >= 400 or not resp.text.strip():
            return []
        try:
            root = ET.fromstring(resp.text)
        except ET.ParseError:
            return []
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        target_norm = _normalize_title(title)
        best_score = 0.0
        best_urls: list[str] = []
        for entry in root.findall("atom:entry", ns):
            entry_title = "".join(entry.findtext("atom:title", default="", namespaces=ns).split())
            candidate_norm = _normalize_title(entry_title)
            if not candidate_norm:
                continue
            score = SequenceMatcher(a=target_norm, b=candidate_norm).ratio()
            if score < 0.9 or score < best_score:
                continue
            urls: list[str] = []
            entry_id = entry.findtext("atom:id", default="", namespaces=ns).strip()
            if entry_id:
                abs_url = entry_id.replace("http://", "https://", 1)
                urls.append(abs_url)
                if "/abs/" in abs_url:
                    urls.append(abs_url.replace("/abs/", "/pdf/") + ".pdf")
            for link in entry.findall("atom:link", ns):
                href = str(link.attrib.get("href") or "").strip()
                link_type = str(link.attrib.get("type") or "").strip().lower()
                if href and (link_type == "application/pdf" or "/pdf/" in href):
                    urls.append(href.replace("http://", "https://", 1))
            best_score = score
            best_urls = urls
        return best_urls

    def _parse_pdf_bytes(self, content: bytes) -> tuple[str, dict]:
        if fitz is not None:
            doc = fitz.open(stream=content, filetype="pdf")
            parts = [page.get_text("text") for page in doc]
            text = "\n".join(parts).strip()
            if text:
                return _normalize_pdf_text(text), {"parser": "pymupdf", "pages": len(doc)}
        if pdfminer_extract_text is not None:
            text = pdfminer_extract_text(BytesIO(content)) or ""
            text = text.strip()
            if text:
                return _normalize_pdf_text(text), {"parser": "pdfminer"}
        raise ValueError("pdf_parse_failed")

    def _fetch_citation_neighbors_multi(
        self,
        db: Session,
        *,
        task: ResearchTask,
        paper,
        limit: int,
        ordered_sources: list[str],
        force_refresh: bool,
    ) -> dict:
        paper_key = _paper_token(paper)
        cache_repo = ResearchCitationFetchCacheRepo(db)
        source_coverage: dict[str, int] = {}
        provider_errors: dict[str, str] = {}
        fallback_used = False
        merged: list[dict] = []

        for idx, source in enumerate(ordered_sources):
            source_key = (source or "").strip().lower()
            if not source_key:
                continue
            payload: dict | None = None
            if not force_refresh:
                payload = cache_repo.get_valid(task_id=task.id, paper_key=paper_key, source=source_key)
            if payload:
                items = _load_json_list_of_dict(payload.get("items"))
                status = str(payload.get("status") or "cached")
                error = payload.get("error")
            else:
                items, status, error = self._fetch_citation_by_source(source_key, paper=paper, limit=limit)
                cache_repo.upsert(
                    task_id=task.id,
                    paper_key=paper_key,
                    source=source_key,
                    payload={"items": items, "status": status, "error": error},
                    ttl_seconds=max(1, int(self.settings.research_citation_cache_ttl_seconds)),
                )
            if items:
                source_coverage[source_key] = len(items)
                merged.extend(items)
                if idx > 0:
                    fallback_used = True
                break
            provider_errors[source_key] = str(error or status or "empty")

        seen: set[tuple[str, str, str]] = set()
        unique: list[dict] = []
        for item in merged:
            src = str(item.get("source_id") or "").strip()
            dst = str(item.get("target_id") or "").strip()
            edge_type = str(item.get("edge_type") or "cites").strip()
            if not src or not dst:
                continue
            key = (src, dst, edge_type)
            if key in seen:
                continue
            seen.add(key)
            unique.append(item)
        return {
            "items": unique,
            "source_coverage": source_coverage,
            "provider_errors": provider_errors,
            "fallback_used": fallback_used,
        }

    def _fetch_citation_by_source(self, source: str, *, paper, limit: int) -> tuple[list[dict], str, str | None]:
        if source == "semantic_scholar":
            return self._fetch_citation_neighbors_semantic(paper, limit=limit)
        if source == "openalex":
            return self._fetch_citation_neighbors_openalex(paper, limit=limit)
        if source == "crossref":
            return self._fetch_citation_neighbors_crossref(paper, limit=limit)
        return [], "unsupported_source", f"unsupported_source:{source}"

    def _fetch_citation_neighbors_semantic(self, paper, *, limit: int) -> tuple[list[dict], str, str | None]:
        identifier = _semantic_scholar_identifier_for_paper(paper)
        if not identifier:
            return [], "missing_identifier", "missing_identifier"
        api_key = self.settings.semantic_scholar_api_key.strip()
        headers = {"User-Agent": "MemoMate/0.1 (citation-graph)"}
        if api_key:
            headers["x-api-key"] = api_key
        url = f"https://api.semanticscholar.org/graph/v1/paper/{quote_plus(identifier)}"
        fields = (
            "title,year,externalIds,references.paperId,references.title,references.year,references.externalIds,"
            "citations.paperId,citations.title,citations.year,citations.externalIds"
        )
        try:
            with httpx.Client(timeout=20, trust_env=False) as client:
                resp = client.get(url, params={"fields": fields}, headers=headers)
            if resp.status_code >= 400:
                return [], f"http_{resp.status_code}", f"http_{resp.status_code}"
            payload = resp.json()
        except Exception as exc:
            return [], "transport_error", str(exc)

        base_id = _paper_token(paper)
        items: list[dict] = []
        references = payload.get("references") if isinstance(payload, dict) else []
        citations = payload.get("citations") if isinstance(payload, dict) else []
        for row in (references or [])[:limit]:
            neighbor = _normalize_neighbor_from_s2(row)
            if not neighbor:
                continue
            items.append(
                {
                    "source_id": base_id,
                    "target_id": neighbor["id"],
                    "neighbor_id": neighbor["id"],
                    "title": neighbor["title"],
                    "year": neighbor.get("year"),
                    "source": "semantic_scholar",
                    "edge_type": "cites",
                    "source_name": "semantic_scholar",
                    "weight": 1.0,
                }
            )
        for row in (citations or [])[:limit]:
            neighbor = _normalize_neighbor_from_s2(row)
            if not neighbor:
                continue
            items.append(
                {
                    "source_id": neighbor["id"],
                    "target_id": base_id,
                    "neighbor_id": neighbor["id"],
                    "title": neighbor["title"],
                    "year": neighbor.get("year"),
                    "source": "semantic_scholar",
                    "edge_type": "cited_by",
                    "source_name": "semantic_scholar",
                    "weight": 1.0,
                }
            )
        return items, ("ok" if items else "ok_empty"), None

    def _fetch_citation_neighbors_openalex(self, paper, *, limit: int) -> tuple[list[dict], str, str | None]:
        doi = (paper.doi or "").strip().lower()
        if not doi:
            return [], "missing_doi", "missing_doi"
        base_id = _paper_token(paper)
        items: list[dict] = []
        try:
            with httpx.Client(timeout=20, trust_env=False) as client:
                work_resp = client.get(
                    f"https://api.openalex.org/works/https://doi.org/{quote_plus(doi)}",
                    params={"select": "id,referenced_works,cited_by_api_url"},
                )
                if work_resp.status_code >= 400:
                    return [], f"http_{work_resp.status_code}", f"http_{work_resp.status_code}"
                work = work_resp.json()
                refs = work.get("referenced_works") if isinstance(work, dict) else []
                for ref in (refs or [])[:limit]:
                    ref_id = _normalize_openalex_id(ref)
                    if not ref_id:
                        continue
                    items.append(
                        {
                            "source_id": base_id,
                            "target_id": ref_id,
                            "neighbor_id": ref_id,
                            "title": ref_id,
                            "year": None,
                            "source": "openalex",
                            "edge_type": "cites",
                            "source_name": "openalex",
                            "weight": 1.0,
                        }
                    )
                cited_url = work.get("cited_by_api_url") if isinstance(work, dict) else None
                if isinstance(cited_url, str) and cited_url.strip():
                    cited_resp = client.get(cited_url, params={"per-page": limit, "select": "id,display_name,publication_year"})
                    if cited_resp.status_code < 400:
                        cited_data = cited_resp.json()
                        results = cited_data.get("results") if isinstance(cited_data, dict) else []
                        for row in (results or [])[:limit]:
                            cid = _normalize_openalex_id(row.get("id"))
                            if not cid:
                                continue
                            items.append(
                                {
                                    "source_id": cid,
                                    "target_id": base_id,
                                    "neighbor_id": cid,
                                    "title": str(row.get("display_name") or cid)[:240],
                                    "year": _to_int_or_none(row.get("publication_year")),
                                    "source": "openalex",
                                    "edge_type": "cited_by",
                                    "source_name": "openalex",
                                    "weight": 1.0,
                                }
                            )
        except Exception as exc:
            return [], "transport_error", str(exc)
        return items, ("ok" if items else "ok_empty"), None

    def _fetch_citation_neighbors_crossref(self, paper, *, limit: int) -> tuple[list[dict], str, str | None]:
        doi = (paper.doi or "").strip().lower()
        if not doi:
            return [], "missing_doi", "missing_doi"
        base_id = _paper_token(paper)
        items: list[dict] = []
        url = f"https://api.crossref.org/works/{quote_plus(doi)}"
        try:
            with httpx.Client(timeout=20, trust_env=False) as client:
                resp = client.get(url)
            if resp.status_code >= 400:
                return [], f"http_{resp.status_code}", f"http_{resp.status_code}"
            payload = resp.json()
        except Exception as exc:
            return [], "transport_error", str(exc)
        message = payload.get("message") if isinstance(payload, dict) else {}
        references = message.get("reference") if isinstance(message, dict) else []
        for row in (references or [])[:limit]:
            if not isinstance(row, dict):
                continue
            title = str(row.get("article-title") or row.get("series-title") or "").strip()
            neighbor_doi = str(row.get("DOI") or "").strip().lower()
            neighbor_id = _citation_neighbor_id(title=title, doi=neighbor_doi, fallback_seed=str(row.get("key") or "ref"))
            if not neighbor_id:
                continue
            year = _to_int_or_none(row.get("year"))
            items.append(
                {
                    "source_id": base_id,
                    "target_id": neighbor_id,
                    "neighbor_id": neighbor_id,
                    "title": (title or neighbor_id)[:240],
                    "year": year,
                    "source": "crossref",
                    "edge_type": "cites",
                    "source_name": "crossref",
                    "weight": 1.0,
                }
            )
        return items, ("ok" if items else "ok_empty"), None

    def _compute_graph_stats(self, *, nodes: list[dict], edges: list[dict]) -> dict:
        paper_nodes = [n for n in nodes if n.get("type") == "paper"]
        citation_edges = [e for e in edges if e.get("type") in {"cites", "cited_by"}]
        scores: dict[str, float] = {}
        if nx is not None and paper_nodes:
            g = nx.DiGraph()
            for node in paper_nodes:
                g.add_node(node["id"])
            for edge in citation_edges:
                src = str(edge.get("source") or "").strip()
                dst = str(edge.get("target") or "").strip()
                if src and dst:
                    g.add_edge(src, dst, weight=float(edge.get("weight") or 1.0))
            if g.number_of_nodes() > 0:
                try:
                    pr = nx.pagerank(g, alpha=0.85)
                    scores = {str(k): float(v) for k, v in pr.items()}
                except Exception:
                    scores = {}
                try:
                    components = nx.number_weakly_connected_components(g)
                except Exception:
                    components = 0
            else:
                components = 0
        else:
            components = 0
            # Fallback: degree as simple score if networkx unavailable.
            deg: dict[str, int] = {}
            for edge in citation_edges:
                src = str(edge.get("source") or "").strip()
                dst = str(edge.get("target") or "").strip()
                if src:
                    deg[src] = deg.get(src, 0) + 1
                if dst:
                    deg[dst] = deg.get(dst, 0) + 1
            total = max(1, sum(deg.values()))
            scores = {k: float(v / total) for k, v in deg.items()}
        top = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)[:10]
        return {
            "node_count": len(nodes),
            "edge_count": len(edges),
            "paper_node_count": len(paper_nodes),
            "citation_edge_count": len(citation_edges),
            "components": int(components),
            "top_central_papers": [{"paper_id": pid, "score": score} for pid, score in top],
            "scores": scores,
        }

    def _round_reference_titles(self, db: Session, *, round_id: int, limit: int = 8) -> list[str]:
        refs = ResearchRoundPaperRepo(db).list_for_round(round_id)
        paper_ids = [row.paper_id for row in refs[:limit]]
        rows = ResearchPaperRepo(db).list_by_ids(paper_ids)
        return [row.title for row in rows if row.title][:limit]

    def _generate_queries_from_intent(
        self,
        *,
        task_topic: str,
        direction_name: str,
        intent_text: str,
        current_queries: list[str],
        references: list[str],
        project_context: str | None = None,
    ) -> list[str]:
        prompt = (
            "你是 memomate-research-planner，请根据用户意图生成下一轮检索 query。"
            '返回严格 JSON: {"queries":["q1","q2","q3"]}。\n\n'
            f"Topic: {task_topic}\n"
            f"Direction: {direction_name}\n"
            f"Project context: {project_context or 'none'}\n"
            f"User intent: {intent_text}\n"
            f"Current queries: {orjson.dumps(current_queries).decode('utf-8')}\n"
            f"Reference titles: {orjson.dumps(references).decode('utf-8')}\n"
            "Rules: return 2-4 concise, non-duplicate queries."
        )
        try:
            result = self.openclaw_client.chat_completion(
                task_type=LLMTaskType.RESEARCH_PLAN,
                prompt=prompt,
                system_prompt="Return strict JSON only.",
                temperature=0.1,
                max_tokens=500,
            )
            data = _extract_first_json_object((result.text or "").strip())
            queries = [str(x).strip() for x in (data or {}).get("queries", []) if str(x).strip()]
            dedup: list[str] = []
            seen: set[str] = set()
            for q in queries:
                key = q.lower()
                if key in seen:
                    continue
                seen.add(key)
                dedup.append(q)
            if len(dedup) >= 2:
                return dedup[:4]
        except Exception:
            logger.exception("research_intent_to_queries_failed")

        base = intent_text.strip()[:200] or task_topic.strip()
        out = [base]
        if direction_name.strip():
            out.append(f"{direction_name.strip()} {base}")
        if task_topic.strip():
            out.append(f"{task_topic.strip()} {base}")
        dedup: list[str] = []
        seen: set[str] = set()
        for q in out:
            key = q.lower().strip()
            if not key or key in seen:
                continue
            seen.add(key)
            dedup.append(q.strip())
        if len(dedup) < 2:
            dedup.append(f"{base} methods")
        return dedup[:4]

    def _generate_round_candidates(
        self,
        *,
        task_topic: str,
        action: str,
        feedback_text: str,
        query_terms: list[str],
        references: list[str],
        candidate_count: int,
        project_context: str | None = None,
    ) -> list[dict]:
        prompt = (
            "你是 memomate-research-planner，请根据输入生成下一轮调研候选方向。"
            "返回 JSON: {\"candidates\":[{\"name\":\"\",\"queries\":[\"\"],\"reason\":\"\"}]}。\n\n"
            f"Topic: {task_topic}\n"
            f"Project context: {project_context or 'none'}\n"
            f"Action: {action}\n"
            f"Feedback: {feedback_text}\n"
            f"Current queries: {orjson.dumps(query_terms).decode('utf-8')}\n"
            f"Reference titles: {orjson.dumps(references).decode('utf-8')}\n"
            f"Candidates: {candidate_count}"
        )
        try:
            result = self.openclaw_client.chat_completion(
                task_type=LLMTaskType.RESEARCH_PLAN,
                prompt=prompt,
                system_prompt="Return strict JSON only.",
                temperature=0.2,
                max_tokens=900,
            )
            text = (result.text or "").strip()
            if text.startswith("```"):
                text = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", text)
                text = re.sub(r"\s*```$", "", text).strip()
            data = _extract_first_json_object(text)
            raw = data.get("candidates") if isinstance(data, dict) else None
            candidates: list[dict] = []
            if isinstance(raw, list):
                for item in raw[:candidate_count]:
                    if not isinstance(item, dict):
                        continue
                    name = str(item.get("name") or "").strip()
                    queries = [str(x).strip() for x in (item.get("queries") or []) if str(x).strip()]
                    if not name:
                        continue
                    if len(queries) < 2:
                        queries = [name, f"{name} methods"]
                    candidates.append(
                        {
                            "name": name[:255],
                            "queries": queries[:4],
                            "reason": str(item.get("reason") or "").strip()[:1000] or None,
                        }
                    )
            if candidates:
                return candidates
        except Exception:
            logger.exception("research_round_candidate_generate_failed")
        base = (feedback_text or task_topic or "research topic").strip()
        seed = [x for x in query_terms if x][:2] or [task_topic]
        templates = [
            ("问题定义与评测边界", [f"{seed[0]} benchmark", f"{base} evaluation"], "收敛评测协议和问题边界"),
            ("核心方法深化", [f"{seed[0]} method", f"{base} architecture"], "针对当前方向深化方法细节"),
            ("数据与泛化", [f"{seed[0]} dataset", f"{base} generalization"], "补齐数据与泛化证据"),
            ("误差与失败案例", [f"{seed[0]} error analysis", f"{base} failure cases"], "关注失败模式和可解释性"),
            ("临床/业务落地", [f"{seed[0]} deployment", f"{base} real world"], "评估实际应用可行性"),
        ]
        out = []
        for name, queries, reason in templates[:candidate_count]:
            out.append({"name": name, "queries": queries[:4], "reason": reason})
        return out

    def _build_tree_graph(
        self,
        db: Session,
        task: ResearchTask,
        *,
        include_papers: bool = False,
        paper_limit: int | None = None,
    ) -> dict:
        round_repo = ResearchRoundRepo(db)
        round_rows = round_repo.list_for_task(task.id)
        direction_rows = ResearchDirectionRepo(db).list_for_task(task.id)
        direction_map = {row.direction_index: row for row in direction_rows}
        round_paper_repo = ResearchRoundPaperRepo(db)
        paper_repo = ResearchPaperRepo(db)
        fulltext_map = {
            row.paper_id: row
            for row in ResearchPaperFulltextRepo(db).list_for_task(task.id)
            if row.paper_id
        }

        nodes: dict[str, dict] = {}
        edges: list[dict] = []
        seen: set[tuple[str, str, str]] = set()

        topic_id = f"topic:{task.task_id}"
        direction_names = [row.name for row in direction_rows[:5] if row.name]
        topic_summary = (
            f"当前研究主题：{task.topic}\n"
            f"任务状态：{task.status.value}\n"
            + (
                "已规划方向：\n- " + "\n- ".join(direction_names)
                if direction_names
                else "当前还没有方向结果，下一步可先做方向规划。"
            )
        )
        nodes[topic_id] = {"id": topic_id, "type": "topic", "label": task.topic, "summary": topic_summary, "status": task.status.value}

        per_round_paper_limit = max(
            1,
            min(
                50,
                int(paper_limit or self.settings.research_graph_paper_limit_default),
            ),
        )

        for direction in direction_rows:
            d_id = f"direction:{task.task_id}:{direction.direction_index}"
            direction_queries = _load_json_list(direction.queries_json)
            direction_papers_count = len(paper_repo.list_for_direction(direction.id))
            nodes[d_id] = {
                "id": d_id,
                "type": "direction",
                "label": direction.name,
                "direction_index": direction.direction_index,
                "papers_count": direction_papers_count,
                "summary": (
                    f"这个方向用于围绕“{direction.name}”检索和组织论文证据。\n"
                    f"检索 query：{'; '.join(direction_queries[:3]) if direction_queries else direction.name}\n"
                    f"当前已收录 {direction_papers_count} 篇论文；点击方向节点后可以继续检索、开始探索或构建图谱。"
                ),
            }
            key = (topic_id, d_id, "topic_direction")
            if key not in seen:
                edges.append({"source": topic_id, "target": d_id, "type": "topic_direction", "weight": 1.0})
                seen.add(key)
            if include_papers:
                for paper in paper_repo.list_for_direction(direction.id)[:per_round_paper_limit]:
                    p_id = _paper_token(paper)
                    if p_id not in nodes:
                        nodes[p_id] = self._paper_graph_node(
                            task=task,
                            paper=paper,
                            direction_index=direction.direction_index,
                            fulltext=fulltext_map.get(p_id),
                        )
                    edge_key = (d_id, p_id, "direction_paper")
                    if edge_key not in seen:
                        edges.append({"source": d_id, "target": p_id, "type": "direction_paper", "weight": 1.0})
                        seen.add(edge_key)

        for row in round_rows:
            r_id = f"round:{row.id}"
            feedback_short = (row.feedback_text or "").strip()
            if feedback_short:
                feedback_short = re.sub(r"\s+", " ", feedback_short)[:18]
            nodes[r_id] = {
                "id": r_id,
                "type": "round",
                "label": f"第{row.depth}轮" + (f" · {feedback_short}" if feedback_short else ""),
                "direction_index": row.direction_index,
                "depth": row.depth,
                "action": row.action.value,
                "status": row.status.value,
                "feedback_text": row.feedback_text,
                "source": "memomate",
            }
            if row.parent_round_id:
                p_id = f"round:{row.parent_round_id}"
                key = (p_id, r_id, "round_round")
                if key not in seen:
                    edges.append({"source": p_id, "target": r_id, "type": "round_round", "weight": 1.0})
                    seen.add(key)
            else:
                d = direction_map.get(row.direction_index)
                if d:
                    d_id = f"direction:{task.task_id}:{d.direction_index}"
                    key = (d_id, r_id, "direction_round")
                    if key not in seen:
                        edges.append({"source": d_id, "target": r_id, "type": "direction_round", "weight": 1.0})
                        seen.add(key)

            if include_papers:
                refs = round_paper_repo.list_for_round(row.id)[:per_round_paper_limit]
                papers = paper_repo.list_by_ids([x.paper_id for x in refs])
                rank = {x.paper_id: x.rank for x in refs}
                papers.sort(key=lambda p: rank.get(p.id, 999999))
                for paper in papers:
                    p_id = _paper_token(paper)
                    if p_id not in nodes:
                        nodes[p_id] = self._paper_graph_node(
                            task=task,
                            paper=paper,
                            direction_index=row.direction_index,
                            fulltext=fulltext_map.get(p_id),
                        )
                    key = (r_id, p_id, "round_paper")
                    if key not in seen:
                        edges.append({"source": r_id, "target": p_id, "type": "round_paper", "weight": 1.0})
                        seen.add(key)

        return {
            "direction_index": None,
            "round_id": None,
            "depth": 1,
            "status": ResearchGraphBuildStatus.DONE.value,
            "nodes": list(nodes.values()),
            "edges": edges,
            "stats": {
                "node_count": len(nodes),
                "edge_count": len(edges),
                "round_count": len(round_rows),
                "paper_limit_applied": per_round_paper_limit if include_papers else 0,
            },
        }

    def _build_seed_corpus_for_task(self, db: Session, *, task: ResearchTask, constraints: dict) -> list:
        seed_collection_id = str(constraints.get("seed_collection_id") or "").strip()
        if seed_collection_id:
            collection = ResearchCollectionRepo(db).get_by_collection_id(user_id=task.user_id, collection_id=seed_collection_id)
            if collection:
                items = ResearchCollectionItemRepo(db).list_for_collection(collection.id)
                seed_items = [
                    {
                        "paper_id": item.paper_id,
                        "title": item.title,
                        "title_norm": item.title_norm,
                        "authors": _load_json_list(item.authors_json),
                        "year": item.year,
                        "venue": item.venue,
                        "doi": item.doi,
                        "url": item.url,
                        "abstract": _load_json_dict(item.metadata_json).get("abstract"),
                        "source": item.source,
                    }
                    for item in items
                ]
                return ResearchSeedPaperRepo(db).replace_for_task(task.id, seed_items)
        top_n = max(10, min(120, int(self.settings.research_seed_topn_default)))
        constraints_seed = {
            "year_from": constraints.get("year_from"),
            "year_to": constraints.get("year_to"),
            "sources": constraints.get("sources"),
        }
        sources = _resolve_sources(constraints_seed.get("sources"), self.settings.research_sources_default)
        ordered_sources = [src for src in ("semantic_scholar", "openalex", "arxiv") if src in sources] or [
            "semantic_scholar",
            "openalex",
            "arxiv",
        ]

        collected: list[dict] = []
        per_source = max(10, min(100, top_n))
        for source in ordered_sources:
            fetched = self._search_by_source(
                source=source,
                query=task.topic,
                top_n=per_source,
                constraints=constraints_seed,
                allow_semantic_fallback=True,
            )
            self._record_source_status(source, fetched.status)
            if fetched.papers:
                collected.extend(fetched.papers)
            if len(collected) >= top_n * 2:
                break
        deduped = self._dedupe_papers(collected)
        deduped = self._rank_discovered_papers(deduped, top_n=top_n, constraints=constraints_seed)[:top_n]
        return ResearchSeedPaperRepo(db).replace_for_task(task.id, deduped)

    def _plan_directions_from_seed(
        self,
        topic: str,
        constraints: dict,
        seed_rows: list,
        *,
        backend: str = "gpt",
        model: str | None = None,
        project_context: str | None = None,
    ) -> list[dict]:
        if not seed_rows:
            return self._plan_directions(topic, constraints, backend=backend, model=model, project_context=project_context)
        max_abs = max(120, int(self.settings.research_seed_max_abstract_chars))
        snippets = []
        for idx, row in enumerate(seed_rows[:40], start=1):
            title = str(getattr(row, "title", "") or "").strip()
            abstract = str(getattr(row, "abstract", "") or "").strip()
            year = getattr(row, "year", None)
            source = str(getattr(row, "source", "") or "")
            if not title:
                continue
            snippets.append(
                {
                    "i": idx,
                    "title": title[:200],
                    "year": year,
                    "source": source,
                    "abstract": abstract[:max_abs],
                }
            )
        if not snippets:
            return self._plan_directions(topic, constraints, backend=backend, model=model, project_context=project_context)

        direction_min = max(1, int(self.settings.research_direction_min))
        direction_max = max(direction_min, int(self.settings.research_direction_max))
        prompt = (
            "你是 memomate-research-planner。请基于给定论文集合归纳研究方向。"
            '返回严格 JSON: {"directions":[{"name":"...","queries":["q1","q2"],"exclude_terms":["x"]}]}\n'
            f"Topic: {topic}\n"
            f"Directions count: {direction_min}-{direction_max}\n"
            "Rules: 方向必须是互斥的方法流派（如 encoder-decoder, VLM, agentic pipeline 等），"
            "不要给同义方向，不要给数据集或评测维度当方向。每个方向 query 2-4 条。\n"
            f"Papers:\n{orjson.dumps(snippets).decode('utf-8')}"
        )
        prompt = (
            "你是学术研究规划助手。请基于给定论文种子集合，归纳后续值得追踪的研究方向。\n"
            '返回严格 JSON: {"directions":[{"name":"...","queries":["q1","q2"],"exclude_terms":["x"]}]}\n'
            f"Topic: {topic}\n"
            f"Directions count: {direction_min}-{direction_max}\n"
            "Rules:\n"
            "- 方向必须是和主题直接相关的学术研究路线，而不是通用软件方案。\n"
            "- 每个方向必须彼此区分，避免同义重复。\n"
            "- 每个方向给 2-4 条适合检索论文的英文 query。\n"
            "- 如果主题是 embodied AI，应优先考虑 world models、VLA/generalist robot policies、robot data efficiency、sim-to-real/generalization、benchmarks/safety 等路线。\n"
            "- 不要输出 retrieval-augmented、template/rule-based、generic hybrid pipeline，除非用户主题明确要求。\n"
            f"Papers:\n{orjson.dumps(snippets).decode('utf-8')}"
        )
        prompt = (
            "You are an academic research planner. Use the seed papers to propose domain-specific research tracks.\n"
            'Return strict JSON: {"directions":[{"name":"...","queries":["q1","q2"],"exclude_terms":["x"]}]}\n'
            f"Topic: {topic}\n"
            f"Project context: {project_context or 'none'}\n"
            f"Directions count: {direction_min}-{direction_max}\n"
            "Rules:\n"
            "- Directions must be scholarly research tracks directly related to the topic, not generic software solution routes.\n"
            "- Directions must be distinct and non-overlapping.\n"
            "- Each direction must include 2-4 English-only paper discovery queries.\n"
            "- Query strings must be English only because the discovery providers work best with English scholarly queries.\n"
            "- For embodied AI, prefer tracks like world models, vision-language-action/generalist robot policies, robot data efficiency, sim-to-real/generalization, benchmarks, safety, and deployment.\n"
            "- Do not output retrieval-augmented generation, template/rule-based systems, or generic hybrid pipelines unless explicitly requested by the topic.\n"
            f"Papers:\n{orjson.dumps(snippets).decode('utf-8')}"
        )
        try:
            result = self.llm_gateway.chat_text(
                backend=backend,
                model=model,
                prompt=prompt,
                system_prompt="Return strict JSON only.",
                temperature=0.2,
                max_tokens=1600,
            )
            directions = self._parse_direction_json(result)
            if directions:
                return directions
        except Exception:
            logger.exception("research_plan_from_seed_failed")
        return self._plan_directions(topic, constraints, backend=backend, model=model, project_context=project_context)

    def _plan_directions(
        self,
        topic: str,
        constraints: dict,
        *,
        backend: str = "gpt",
        model: str | None = None,
        project_context: str | None = None,
    ) -> list[dict]:
        direction_min = max(1, int(self.settings.research_direction_min))
        direction_max = max(direction_min, int(self.settings.research_direction_max))
        system_prompt = (
            "You are a scholarly research planner. Return strict JSON only."
        )
        prompt = (
            "Input topic:\n"
            f"{topic}\n\n"
            "Project context:\n"
            f"{project_context or 'none'}\n\n"
            "Constraints JSON:\n"
            f"{orjson.dumps(constraints).decode('utf-8')}\n\n"
            "Return JSON schema:\n"
            '{"directions":[{"name":"string","queries":["q1","q2"],"exclude_terms":["x"]}]}\n'
            f"Rules: directions count must be {direction_min}-{direction_max}; each direction queries count 2-4.\n"
            "Directions must be domain-specific research tracks for the input topic, not generic software solution routes. "
            "For embodied AI topics, prefer tracks such as world models for robotics, vision-language-action models, "
            "robot data efficiency, sim-to-real/generalization, evaluation benchmarks, safety/alignment, and deployment. "
            "Do NOT output generic tracks like retrieval-augmented generation, template/rule-based systems, or generic hybrid pipelines "
            "unless the user topic explicitly asks about those. "
            "Avoid near-duplicate directions and make each query suitable for academic paper discovery. "
            "All query strings must be English only."
        )
        try:
            result = self.llm_gateway.chat_text(
                backend=backend,
                model=model,
                prompt=prompt,
                system_prompt=system_prompt,
                temperature=0.1,
                max_tokens=2400,
            )
            directions = self._parse_direction_json(result)
            if directions:
                return directions
        except Exception:
            logger.exception("research_plan_llm_failed")
        return self._fallback_directions(topic)

    def _parse_direction_json(self, result: LLMCallResult) -> list[dict]:
        text = (result.text or "").strip()
        if text.startswith("```"):
            text = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", text)
            text = re.sub(r"\s*```$", "", text).strip()
        data = _extract_first_json_object(text)
        if isinstance(data, dict) and "directions" not in data:
            nested = data.get("data")
            if isinstance(nested, dict):
                data = nested
        if not isinstance(data, dict):
            return []
        raw_dirs = data.get("directions")
        if isinstance(raw_dirs, dict):
            raw_dirs = raw_dirs.get("items")
        if not isinstance(raw_dirs, list):
            return []
        out: list[dict] = []
        for item in raw_dirs[:8]:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            queries = [str(x).strip() for x in (item.get("queries") or []) if str(x).strip()]
            excludes = [str(x).strip() for x in (item.get("exclude_terms") or []) if str(x).strip()]
            if not name:
                continue
            if len(queries) < 2:
                queries = [name, f"{name} methods"]
            out.append({"name": name, "queries": queries[:4], "exclude_terms": excludes[:8]})
        direction_min = max(1, int(self.settings.research_direction_min))
        direction_max = max(direction_min, int(self.settings.research_direction_max))
        if len(out) < direction_min:
            return []
        return out[:direction_max]

    def _summarize_key_points(self, *, text: str, source: str) -> str:
        source_label = "全文" if source == "fulltext" else "摘要"
        content = (text or "").strip()
        if not content:
            return f"基于{source_label}：暂无可总结文本。"
        max_chars = max(500, int(self.settings.research_summary_max_chars))
        clipped = content[:max_chars]
        prompt = (
            "请基于以下内容提炼 5-8 条关键要点，覆盖问题、方法、实验、结论、局限。"
            '返回严格 JSON: {"key_points":["..."],"notes":"...","confidence":"low|medium|high"}。\n\n'
            f"Source: {source_label}\n"
            f"Content:\n{clipped}"
        )
        try:
            result = self.openclaw_client.chat_completion(
                task_type=LLMTaskType.PAPER_KEYPOINTS,
                prompt=prompt,
                system_prompt="Return strict JSON only.",
                temperature=0.1,
                max_tokens=900,
            )
            data = _extract_first_json_object((result.text or "").strip())
            points = [str(x).strip() for x in (data or {}).get("key_points", []) if str(x).strip()]
            notes = str((data or {}).get("notes") or "").strip()
            lines = [f"基于{source_label}要点："]
            for idx, item in enumerate(points[:8], start=1):
                lines.append(f"{idx}. {item}")
            if notes:
                lines.append(f"备注：{notes}")
            if len(lines) > 1:
                return "\n".join(lines)
        except Exception:
            logger.exception("paper_key_points_llm_failed")
        sentence = clipped.split("。")[0].split(".")[0][:180]
        return f"基于{source_label}要点：该工作围绕“{sentence}”展开，建议结合原文核验。"

    def _summarize_structured_key_points(self, *, text: str, source: str) -> str:
        source_label = "全文" if source == "fulltext" else "摘要"
        content = (text or "").strip()
        if not content:
            return (
                f"基于{source_label}的结构化摘要\n"
                "1. 研究问题：当前没有可用于总结的文本。\n"
                "2. 核心方法：暂无可用信息。\n"
                "3. 数据与实验：暂无可用信息。\n"
                "4. 关键结果/证据：暂无可用信息。\n"
                "5. 局限与风险：暂无可用信息。\n"
                "6. 对当前研究任务的启发/下一步建议：建议先补齐原文后再总结。"
            )
        max_chars = max(500, int(self.settings.research_summary_max_chars))
        clipped = content[:max_chars]
        prompt = (
            "请基于下面论文内容生成结构化研究摘要，必须尽量忠实，不要编造原文没有的信息。\n"
            "返回严格 JSON，字段固定为："
            '{"research_problem":"","core_method":"","data_and_experiments":"","key_results":"","limitations":"","next_steps":"","confidence":"low|medium|high"}'
            "\n其中 next_steps 必须站在当前研究工作台视角，说明这篇论文对继续调研有什么启发。\n"
            f"Source: {source_label}\n"
            f"Content:\n{clipped}"
        )
        try:
            result = self.openclaw_client.chat_completion(
                task_type=LLMTaskType.PAPER_KEYPOINTS,
                prompt=prompt,
                system_prompt="Return strict JSON only.",
                temperature=0.1,
                max_tokens=1200,
            )
            data = _extract_first_json_object((result.text or "").strip())
            if data:
                sections = {
                    "研究问题": self._compact_text(data.get("research_problem"), 320),
                    "核心方法": self._compact_text(data.get("core_method"), 320),
                    "数据与实验": self._compact_text(data.get("data_and_experiments"), 320),
                    "关键结果/证据": self._compact_text(data.get("key_results"), 320),
                    "局限与风险": self._compact_text(data.get("limitations"), 320),
                    "对当前研究任务的启发/下一步建议": self._compact_text(data.get("next_steps"), 320),
                }
                if any(sections.values()):
                    lines = [f"基于{source_label}的结构化摘要"]
                    for index, key in enumerate(sections, start=1):
                        value = sections[key] or "当前文本没有提供足够信息，建议结合原文继续核对。"
                        lines.append(f"{index}. {key}：{value}")
                    return "\n".join(lines)
        except Exception:
            logger.exception("paper_key_points_llm_failed")
        sentence = self._first_sentence(clipped, limit=180)
        return (
            f"基于{source_label}的结构化摘要\n"
            f"1. 研究问题：{sentence or '当前文本未明确给出研究问题，建议回看摘要或引言。'}\n"
            f"2. 核心方法：{sentence or '当前文本不足以提炼稳定的方法描述。'}\n"
            "3. 数据与实验：当前自动回退摘要未能稳定识别实验设置，建议回看原文方法与实验部分。\n"
            "4. 关键结果/证据：当前自动回退摘要只能确认论文围绕该主题展开，具体结果仍需结合原文核对。\n"
            "5. 局限与风险：当前可见文本较少，建议重点核对适用边界、失败案例和复现条件。\n"
            "6. 对当前研究任务的启发/下一步建议：建议把这篇论文作为候选证据节点，再结合全文、图表和引用关系继续判断其价值。"
        )

    def _summarize_method(self, abstract: str) -> str:
        abs_text = (abstract or "").strip()
        if not abs_text:
            return "基于摘要总结：摘要缺失，暂无法总结方法。"
        system_prompt = "Prefer memomate-abstract-summarizer skill if available. Keep factual and concise."
        prompt = (
            "请基于以下摘要，用中文输出 1-3 句方法总结。"
            "必须以“基于摘要总结：”开头，不要编造摘要中没有出现的信息。\n\n"
            f"{abs_text[:4000]}"
        )
        try:
            result = self.openclaw_client.chat_completion(
                task_type=LLMTaskType.ABSTRACT_SUMMARIZE,
                prompt=prompt,
                system_prompt=system_prompt,
                temperature=0.1,
                max_tokens=320,
            )
            text = (result.text or "").strip()
            if text:
                if not text.startswith("基于摘要总结："):
                    return f"基于摘要总结：{text}"
                return text
        except Exception:
            logger.exception("research_method_summary_failed")
        sentence = abs_text.split(".")[0].split("。")[0]
        return f"基于摘要总结：该工作围绕“{sentence[:120]}”展开，细节以原文摘要为准。"

    def _search_semantic_scholar(self, query: str, *, top_n: int, constraints: dict) -> tuple[list[dict], str, str | None]:
        year_from = constraints.get("year_from")
        year_to = constraints.get("year_to")
        url = "https://api.semanticscholar.org/graph/v1/paper/search"
        params = {
            "query": query,
            "limit": max(1, min(100, top_n)),
            # `doi` field is no longer directly queryable in some API versions.
            "fields": "title,authors,year,venue,abstract,externalIds,url",
        }
        if year_from:
            params["year"] = f"{year_from}-{year_to or datetime.now().year}"
        headers = {"User-Agent": "MemoMate/0.1 (research)"}
        api_key = self.settings.semantic_scholar_api_key.strip()
        if api_key:
            headers["x-api-key"] = api_key

        payload: dict | None = None
        for attempt in range(3):
            try:
                with httpx.Client(timeout=20) as client:
                    resp = client.get(url, params=params, headers=headers)
            except httpx.TimeoutException as exc:
                if attempt < 2:
                    sleep(0.25 * (2**attempt))
                    continue
                return [], "timeout", str(exc)
            except Exception as exc:
                if attempt < 2:
                    sleep(0.25 * (2**attempt))
                    continue
                return [], "transport_error", str(exc)

            if resp.status_code == 429:
                if attempt < 2:
                    sleep(0.5 * (2**attempt))
                    continue
                logger.warning(
                    "semantic_scholar_rate_limited query=%s has_api_key=%s",
                    query[:120],
                    bool(api_key),
                )
                return [], "rate_limited", "http_429"
            if 500 <= resp.status_code < 600:
                if attempt < 2:
                    sleep(0.35 * (2**attempt))
                    continue
                return [], "http_5xx", f"http_{resp.status_code}"
            if resp.status_code >= 400:
                logger.warning("semantic_scholar_http_error status=%s query=%s", resp.status_code, query[:120])
                return [], f"http_{resp.status_code}", f"http_{resp.status_code}"
            try:
                payload = resp.json()
            except Exception as exc:
                return [], "parse_error", str(exc)
            break

        if payload is None:
            return [], "empty_payload", "empty_payload"
        papers = []
        for item in payload.get("data", []) if isinstance(payload, dict) else []:
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            external_ids = item.get("externalIds") if isinstance(item, dict) else None
            doi_val = None
            if isinstance(external_ids, dict):
                raw_doi = external_ids.get("DOI")
                if isinstance(raw_doi, str) and raw_doi.strip():
                    doi_val = raw_doi.strip()
            papers.append(
                {
                    "paper_id": item.get("paperId"),
                    "title": title,
                    "title_norm": _normalize_title(title),
                    "authors": [str(a.get("name") or "").strip() for a in (item.get("authors") or []) if a.get("name")],
                    "year": item.get("year"),
                    "venue": item.get("venue"),
                    "doi": doi_val,
                    "url": item.get("url"),
                    "abstract": item.get("abstract"),
                    "source": "semantic_scholar",
                    "relevance_score": None,
                }
            )
        if not papers:
            return papers, "ok_empty", None
        return papers, "ok", None

    def _search_arxiv(self, query: str, *, top_n: int, constraints: dict) -> tuple[list[dict], str, str | None]:
        start = 0
        max_results = max(1, min(100, top_n))
        q = quote_plus(query)
        url = f"https://export.arxiv.org/api/query?search_query=all:{q}&start={start}&max_results={max_results}"
        try:
            with httpx.Client(timeout=20) as client:
                resp = client.get(url)
                if resp.status_code >= 400:
                    if 500 <= resp.status_code < 600:
                        return [], "http_5xx", f"http_{resp.status_code}"
                    return [], f"http_{resp.status_code}", f"http_{resp.status_code}"
                xml = resp.text
        except httpx.TimeoutException as exc:
            return [], "timeout", str(exc)
        except Exception as exc:
            return [], "transport_error", str(exc)
        if not xml or not xml.strip():
            return [], "empty_payload", "empty_payload"
        try:
            root = ET.fromstring(xml)
        except ET.ParseError as exc:
            return [], "parse_error", str(exc)
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        papers = []
        year_from = constraints.get("year_from")
        year_to = constraints.get("year_to")
        for entry in root.findall("atom:entry", ns):
            title = _safe_xml_text(entry.find("atom:title", ns))
            if not title:
                continue
            published = _safe_xml_text(entry.find("atom:published", ns))
            year = None
            if published and len(published) >= 4:
                try:
                    year = int(published[:4])
                except Exception:
                    year = None
            if year_from and year and year < int(year_from):
                continue
            if year_to and year and year > int(year_to):
                continue
            url_item = _safe_xml_text(entry.find("atom:id", ns))
            abstract = _safe_xml_text(entry.find("atom:summary", ns))
            authors = [_safe_xml_text(n.find("atom:name", ns)) for n in entry.findall("atom:author", ns)]
            papers.append(
                {
                    "paper_id": url_item.rsplit("/", 1)[-1] if url_item else None,
                    "title": title,
                    "title_norm": _normalize_title(title),
                    "authors": [x for x in authors if x],
                    "year": year,
                    "venue": "arXiv",
                    "doi": None,
                    "url": url_item,
                    "abstract": abstract,
                    "source": "arxiv",
                    "relevance_score": None,
                }
            )
        if not papers:
            return papers, "ok_empty", None
        return papers, "ok", None

    def _search_openalex(self, query: str, *, top_n: int, constraints: dict) -> tuple[list[dict], str, str | None]:
        params = {
            "search": query,
            "per-page": max(1, min(100, top_n)),
            "select": "id,display_name,publication_year,primary_location,doi,abstract_inverted_index,authorships",
        }
        year_from = _to_int_or_none(constraints.get("year_from"))
        year_to = _to_int_or_none(constraints.get("year_to"))
        if year_from or year_to:
            lower = year_from or 1900
            upper = year_to or datetime.now().year
            params["filter"] = f"from_publication_date:{lower}-01-01,to_publication_date:{upper}-12-31"
        try:
            with httpx.Client(timeout=20, trust_env=False) as client:
                resp = client.get("https://api.openalex.org/works", params=params)
            if resp.status_code >= 400:
                if 500 <= resp.status_code < 600:
                    return [], "http_5xx", f"http_{resp.status_code}"
                return [], f"http_{resp.status_code}", f"http_{resp.status_code}"
            payload = resp.json()
        except httpx.TimeoutException as exc:
            return [], "timeout", str(exc)
        except Exception as exc:
            return [], "transport_error", str(exc)
        results = payload.get("results") if isinstance(payload, dict) else []
        papers = []
        for item in results or []:
            if not isinstance(item, dict):
                continue
            title = str(item.get("display_name") or "").strip()
            if not title:
                continue
            primary_location = item.get("primary_location") if isinstance(item.get("primary_location"), dict) else {}
            source = primary_location.get("source") if isinstance(primary_location.get("source"), dict) else {}
            url = primary_location.get("landing_page_url") or primary_location.get("pdf_url")
            authorships = item.get("authorships") if isinstance(item.get("authorships"), list) else []
            authors = []
            for authorship in authorships:
                author = authorship.get("author") if isinstance(authorship, dict) and isinstance(authorship.get("author"), dict) else {}
                name = str(author.get("display_name") or "").strip()
                if name:
                    authors.append(name)
            abstract = _openalex_abstract_to_text(item.get("abstract_inverted_index"))
            doi = str(item.get("doi") or "").strip()
            if doi.startswith("https://doi.org/"):
                doi = doi.replace("https://doi.org/", "", 1)
            papers.append(
                {
                    "paper_id": _normalize_openalex_id(item.get("id")),
                    "title": title,
                    "title_norm": _normalize_title(title),
                    "authors": authors,
                    "year": _to_int_or_none(item.get("publication_year")),
                    "venue": str(source.get("display_name") or "").strip() or "OpenAlex",
                    "doi": doi or None,
                    "url": str(url or "").strip() or None,
                    "abstract": abstract or None,
                    "source": "openalex",
                    "relevance_score": None,
                }
            )
        if not papers:
            return [], "ok_empty", None
        return papers, "ok", None

    def _dedupe_papers(self, papers: list[dict]) -> list[dict]:
        by_doi: dict[str, dict] = {}
        by_title: list[dict] = []
        for row in papers:
            doi = (row.get("doi") or "").strip().lower()
            if doi:
                if doi not in by_doi:
                    by_doi[doi] = row
                continue
            title_norm = row.get("title_norm") or _normalize_title(str(row.get("title") or ""))
            duplicate = None
            for existing in by_title:
                ratio = SequenceMatcher(a=title_norm, b=existing.get("title_norm", "")).ratio()
                if ratio >= 0.93:
                    duplicate = existing
                    break
            if duplicate is None:
                by_title.append(row)
        merged = list(by_doi.values()) + by_title
        merged.sort(key=lambda x: (x.get("year") or 0), reverse=True)
        return merged

    def _rank_discovered_papers(self, papers: list[dict], *, top_n: int, constraints: dict) -> list[dict]:
        if len(papers) <= 1:
            return papers

        ranked = list(papers)
        ranked.sort(key=self._paper_preliminary_sort_key, reverse=True)
        sources = _resolve_sources(constraints.get("sources"), self.settings.research_sources_default)
        if sources == {"arxiv"}:
            return ranked

        rerank_limit = min(len(ranked), max(30, int(top_n) * 2))
        metrics_cache: dict[tuple[str, str, str, int | None], dict] = {}
        head = ranked[:rerank_limit]
        tail = ranked[rerank_limit:]
        head.sort(
            key=lambda paper: self._paper_quality_sort_key(paper, metrics_cache=metrics_cache),
            reverse=True,
        )
        return head + tail

    @staticmethod
    def _paper_preliminary_sort_key(paper: dict) -> tuple[float, int, int, int]:
        source = str(paper.get("source") or "").strip().lower()
        venue = str(paper.get("venue") or "").strip().lower()
        doi = str(paper.get("doi") or "").strip()
        year = _to_int_or_none(paper.get("year")) or 0
        source_score = {
            "openalex": 3,
            "semantic_scholar": 2,
            "arxiv": 0,
        }.get(source, 1)
        venue_score = 0.0
        if venue and "arxiv" not in venue:
            venue_score = 1.0
        if venue in {"arxiv", "openalex"}:
            venue_score = -1.0
        doi_score = 1 if doi else 0
        return (venue_score, source_score, doi_score, year)

    def _paper_quality_sort_key(
        self,
        paper: dict,
        *,
        metrics_cache: dict[tuple[str, str, str, int | None], dict],
    ) -> tuple[float, int, int, int]:
        metrics = self._paper_quality_metrics(paper, metrics_cache=metrics_cache)
        quality_score = self._paper_quality_score(paper, metrics)
        source = str(paper.get("source") or "").strip().lower()
        source_score = {
            "openalex": 3,
            "semantic_scholar": 2,
            "arxiv": 0,
        }.get(source, 1)
        doi_score = 1 if str(paper.get("doi") or "").strip() else 0
        year = _to_int_or_none(paper.get("year")) or 0
        return (quality_score, source_score, doi_score, year)

    def _paper_quality_metrics(
        self,
        paper: dict,
        *,
        metrics_cache: dict[tuple[str, str, str, int | None], dict],
    ) -> dict:
        venue = str(paper.get("venue") or "").strip()
        source = str(paper.get("source") or "").strip().lower()
        doi = str(paper.get("doi") or "").strip().lower()
        title = str(paper.get("title") or "").strip()
        year = _to_int_or_none(paper.get("year"))
        cache_key = (venue.lower(), doi, title.lower(), year)
        if cache_key in metrics_cache:
            return metrics_cache[cache_key]

        if not venue or source == "arxiv" or "arxiv" in venue.lower():
            metrics_cache[cache_key] = {}
            return {}

        metrics = self.venue_metrics_service.lookup_for_paper(
            venue=venue,
            doi=doi or None,
            title=title or None,
            year=year,
        )
        metrics_cache[cache_key] = dict(metrics or {})
        return metrics_cache[cache_key]

    @staticmethod
    def _paper_quality_score(paper: dict, metrics: dict) -> float:
        source = str(paper.get("source") or "").strip().lower()
        venue = str(paper.get("venue") or "").strip().lower()
        doi = str(paper.get("doi") or "").strip()
        year = _to_int_or_none(paper.get("year")) or 0
        score = 0.0

        if doi:
            score += 1.5
        if source == "openalex":
            score += 1.0
        elif source == "semantic_scholar":
            score += 0.5
        if venue and "arxiv" not in venue and venue != "openalex":
            score += 1.0
        if source == "arxiv" or "arxiv" in venue:
            score -= 8.0

        source_type = str(metrics.get("source_type") or "").strip().lower()
        if source_type == "journal":
            score += 2.5
        elif source_type == "conference":
            score += 2.0
        elif source_type == "repository":
            score -= 6.0

        ccf_rank = str((metrics.get("ccf") or {}).get("rank") or "").strip().upper()
        score += {
            "A": 6.0,
            "B": 4.0,
            "C": 2.0,
        }.get(ccf_rank, 0.0)

        jcr_quartile = str((metrics.get("jcr") or {}).get("quartile") or "").strip().upper()
        score += {
            "Q1": 6.0,
            "Q2": 4.0,
            "Q3": 2.0,
            "Q4": 1.0,
        }.get(jcr_quartile, 0.0)

        cas_quartile = str((metrics.get("cas") or {}).get("quartile") or "").strip()
        score += {
            "1区": 5.0,
            "2区": 3.0,
            "3区": 1.5,
            "4区": 0.5,
        }.get(cas_quartile, 0.0)
        if str((metrics.get("cas") or {}).get("top") or "").strip().lower() == "top":
            score += 1.0
        if (metrics.get("sci") or {}).get("indexed") is True:
            score += 1.5
        if (metrics.get("ei") or {}).get("indexed") is True:
            score += 1.0

        impact_factor = (metrics.get("impact_factor") or {}).get("value")
        if isinstance(impact_factor, (int, float)):
            score += min(float(impact_factor), 20.0) / 5.0

        paper_citation_count = _to_int_or_none(metrics.get("paper_citation_count")) or 0
        venue_citation_count = _to_int_or_none(metrics.get("venue_citation_count")) or 0
        h_index = _to_int_or_none(metrics.get("h_index")) or 0
        score += min(paper_citation_count, 200) / 100.0
        score += min(venue_citation_count, 500000) / 250000.0
        score += min(h_index, 400) / 200.0
        score += min(max(year - 2018, 0), 8) / 8.0
        return score

    def _task_to_dict(self, db: Session, row: ResearchTask) -> dict:
        row = self._ensure_task_project(db, row)
        directions = ResearchDirectionRepo(db).list_for_task(row.id)
        papers_total = sum(x.papers_count for x in directions)
        job_repo = ResearchJobRepo(db)
        latest_job = job_repo.latest_for_task(row.id)
        next_retry_job = job_repo.next_retry_for_task(row.id)
        fulltext_stats = ResearchPaperFulltextRepo(db).summary_for_task(row.id)
        seed_stats = ResearchSeedPaperRepo(db).summary_for_task(row.id)
        latest_run = ResearchRunEventRepo(db).latest_for_task(row.id)
        latest_graph = ResearchGraphSnapshotRepo(db).latest_for_task(row.id)
        rounds_total = len(ResearchRoundRepo(db).list_for_task(row.id))
        graph_stats = _load_json_dict(latest_graph.stats_json) if latest_graph else {}
        if latest_graph:
            graph_stats = {
                **graph_stats,
                "status": latest_graph.status.value,
                "direction_index": latest_graph.direction_index,
                "round_id": latest_graph.round_id,
                "view": latest_graph.view_type.value,
                "updated_at": latest_graph.updated_at.isoformat() if latest_graph.updated_at else None,
            }
        return {
            "task_id": row.task_id,
            "project_id": row.project.project_key if row.project else None,
            "project_name": row.project.name if row.project else None,
            "topic": row.topic,
            "status": row.status.value,
            "mode": row.mode.value,
            "llm_backend": row.llm_backend.value,
            "llm_model": row.llm_model,
            "auto_status": row.auto_status.value,
            "last_checkpoint_id": row.last_checkpoint_id,
            "latest_run_id": latest_run.run_id if latest_run else None,
            "constraints": _load_json_dict(row.constraints_json),
            "directions": [
                {
                    "direction_index": d.direction_index,
                    "name": d.name,
                    "queries": _load_json_list(d.queries_json),
                    "exclude_terms": _load_json_list(d.exclude_terms_json),
                    "papers_count": d.papers_count,
                }
                for d in directions
            ],
            "papers_total": papers_total,
            "rounds_total": rounds_total,
            "last_job_type": latest_job.job_type.value if latest_job else None,
            "last_job_status": latest_job.status.value if latest_job else None,
            "last_failure_reason": (latest_job.error or None) if latest_job else None,
            "last_attempts": int(latest_job.attempts) if latest_job else 0,
            "next_retry_at": next_retry_job.scheduled_at if next_retry_job else None,
            "fulltext_stats": fulltext_stats,
            "seed_stats": seed_stats,
            "graph_stats": graph_stats,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    def _project_to_dict(self, db: Session, row: ResearchProject) -> dict:
        task_count = len(ResearchTaskRepo(db).list_recent(user_id=row.user_id, limit=500, project_id=row.id))
        collection_count = len(ResearchCollectionRepo(db).list_for_project(row.id))
        return {
            "project_id": row.project_key,
            "name": row.name,
            "description": row.description,
            "is_default": row.is_default,
            "task_count": task_count,
            "collection_count": collection_count,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    def _collection_to_dict(
        self,
        db: Session,
        row: ResearchCollection,
        *,
        include_items: bool = True,
        offset: int = 0,
        limit: int = 50,
    ) -> dict:
        item_repo = ResearchCollectionItemRepo(db)
        total_items = item_repo.count_for_collection(row.id)
        item_rows = item_repo.list_for_collection_page(row.id, offset=offset, limit=limit) if include_items else []
        return {
            "collection_id": row.collection_id,
            "project_id": row.project.project_key,
            "name": row.name,
            "description": row.description,
            "source_type": row.source_type,
            "source_ref": row.source_ref,
            "summary_text": row.summary_text,
            "item_count": total_items,
            "items": [self._collection_item_to_dict(item) for item in item_rows] if include_items else [],
            "offset": max(0, int(offset)),
            "limit": max(1, int(limit)) if include_items else 0,
            "has_more": include_items and (max(0, int(offset)) + len(item_rows) < total_items),
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    def _collection_item_to_dict(self, row: ResearchCollectionItem) -> dict:
        metadata = _load_json_dict(row.metadata_json)
        source_task_id = row.source_task.task_id if getattr(row, "source_task", None) else None
        task_token = metadata.get("task_id")
        if task_token is not None and not isinstance(task_token, str):
            task_token = None
        return {
            "item_id": row.id,
            "task_id": task_token or source_task_id,
            "paper_id": row.paper_id,
            "title": row.title,
            "authors": _load_json_list(row.authors_json),
            "year": row.year,
            "venue": row.venue,
            "doi": row.doi,
            "url": row.url,
            "source": row.source,
            "metadata": {
                **metadata,
                "task_id": task_token or source_task_id,
            }
            if (task_token or source_task_id)
            else metadata,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    def _export_record_to_dict(self, row: ResearchExportRecord | ResearchCollectionExportRecord) -> dict:
        task = getattr(row, "task", None)
        project = getattr(row, "project", None)
        collection = getattr(row, "collection", None)
        output_path = str(row.output_path).strip() if row.output_path else None
        filename = Path(output_path).name if output_path else None
        if task:
            download_url = f"/api/v1/research/tasks/{quote_plus(task.task_id)}/exports/{row.id}/download"
        elif collection:
            download_url = f"/api/v1/research/collections/{quote_plus(collection.collection_id)}/exports/{row.id}/download"
        else:
            download_url = None
        return {
            "id": row.id,
            "task_id": task.task_id if task else None,
            "collection_id": collection.collection_id if collection else None,
            "project_id": (
                project.project_key
                if project
                else (collection.project.project_key if collection and collection.project else None)
            ),
            "format": row.format,
            "output_path": output_path,
            "filename": filename,
            "download_url": download_url if output_path else None,
            "status": row.status,
            "error": row.error,
            "created_at": row.created_at,
        }

    def _compare_report_to_dict(self, row: ResearchCompareReport) -> dict:
        return {
            "report_id": row.report_id,
            "scope": row.scope,
            "title": row.title,
            "focus": row.focus,
            "overview": row.overview,
            "common_points": _load_json_list(row.common_points_json),
            "differences": _load_json_list(row.differences_json),
            "recommended_next_steps": _load_json_list(row.recommended_next_steps_json),
            "items": _load_json_list_of_dict(row.items_json),
            "created_at": row.created_at,
        }

    def _paper_compare_item(self, paper) -> dict:
        return {
            "paper_id": _paper_token(paper),
            "title": paper.title,
            "year": paper.year,
            "venue": paper.venue,
            "source": paper.source,
            "doi": paper.doi,
            "url": paper.url,
            "abstract": paper.abstract,
            "method_summary": paper.method_summary,
        }

    def _collection_compare_item(self, item: ResearchCollectionItem) -> dict:
        metadata = _load_json_dict(item.metadata_json)
        return {
            "paper_id": item.paper_id,
            "title": item.title,
            "year": item.year,
            "venue": item.venue,
            "source": item.source,
            "doi": item.doi,
            "url": item.url,
            "abstract": metadata.get("abstract"),
            "method_summary": metadata.get("method_summary"),
        }

    def _build_compare_report(
        self,
        db: Session,
        *,
        project_id: int | None,
        task: ResearchTask | None,
        collection: ResearchCollection | None,
        scope: str,
        title: str,
        focus: str | None,
        items: list[dict],
        llm_backend: str,
        llm_model: str | None,
    ) -> ResearchCompareReport:
        structured = self._generate_compare_payload(
            title=title,
            focus=focus,
            items=items,
            llm_backend=llm_backend,
            llm_model=llm_model,
        )
        return ResearchCompareReportRepo(db).create(
            report_id=f"compare-{uuid4().hex[:10]}",
            project_id=project_id,
            task_id=task.id if task else None,
            collection_id=collection.id if collection else None,
            scope=scope,
            title=structured["title"],
            focus=structured.get("focus"),
            overview=structured["overview"],
            common_points=list(structured.get("common_points") or []),
            differences=list(structured.get("differences") or []),
            recommended_next_steps=list(structured.get("recommended_next_steps") or []),
            items=items,
        )

    def _generate_compare_payload(
        self,
        *,
        title: str,
        focus: str | None,
        items: list[dict],
        llm_backend: str,
        llm_model: str | None,
    ) -> dict:
        clipped_items = [
            {
                "paper_id": item.get("paper_id"),
                "title": item.get("title"),
                "year": item.get("year"),
                "venue": item.get("venue"),
                "source": item.get("source"),
                "doi": item.get("doi"),
                "abstract": str(item.get("abstract") or "")[:1200],
                "method_summary": str(item.get("method_summary") or "")[:600],
            }
            for item in items[:10]
        ]
        prompt = (
            "请对下面这些论文或集合论文做中文对比总结。"
            '返回严格 JSON：{"title":"...","focus":"...","overview":"...","common_points":["..."],'
            '"differences":["..."],"recommended_next_steps":["..."]}\n\n'
            f"Title: {title}\n"
            f"Focus: {focus or '整体方法与研究价值'}\n"
            f"Items: {orjson.dumps(clipped_items).decode('utf-8')}"
        )
        try:
            result = self.llm_gateway.chat_text(
                backend=llm_backend,
                model=llm_model,
                system_prompt="Return strict JSON only. Be factual and concise.",
                prompt=prompt,
                temperature=0.1,
                max_tokens=1400,
            )
            data = _extract_first_json_object((result.text or "").strip())
            if isinstance(data, dict):
                common_points = [str(item).strip() for item in (data.get("common_points") or []) if str(item).strip()]
                differences = [str(item).strip() for item in (data.get("differences") or []) if str(item).strip()]
                next_steps = [str(item).strip() for item in (data.get("recommended_next_steps") or []) if str(item).strip()]
                overview = str(data.get("overview") or "").strip()
                if overview:
                    return {
                        "title": str(data.get("title") or title).strip() or title,
                        "focus": str(data.get("focus") or focus or "").strip() or None,
                        "overview": overview,
                        "common_points": common_points[:8],
                        "differences": differences[:8],
                        "recommended_next_steps": next_steps[:8],
                    }
        except Exception:
            logger.exception("compare_report_llm_failed title=%s", title)
        return self._compare_payload_fallback(title=title, focus=focus, items=items)

    def _compare_payload_fallback(self, *, title: str, focus: str | None, items: list[dict]) -> dict:
        venues = sorted({str(item.get("venue") or "").strip() for item in items if str(item.get("venue") or "").strip()})
        years = [int(item.get("year")) for item in items if item.get("year")]
        sources = sorted({str(item.get("source") or "").strip() for item in items if str(item.get("source") or "").strip()})
        common_points = []
        if venues:
            common_points.append(f"论文主要分布在 {', '.join(venues[:4])} 等来源。")
        if years:
            common_points.append(f"样本时间范围主要集中在 {min(years)} 到 {max(years)}。")
        if sources:
            common_points.append(f"当前对比样本来自 {', '.join(sources[:4])}。")
        if not common_points:
            common_points.append("这些论文都围绕同一研究主题展开，但证据仍需结合原文核验。")
        differences = []
        for item in items[:4]:
            label = str(item.get("title") or item.get("paper_id") or "未命名论文").strip()
            venue = str(item.get("venue") or "来源未标注").strip()
            year = str(item.get("year") or "年份未知").strip()
            differences.append(f"{label} 更适合从 {venue} / {year} 这个上下文理解其定位与贡献。")
        next_steps = [
            "优先挑选 2-3 篇代表论文继续做全文处理与证据核验。",
            "将差异最大的论文加入 Collection，继续生成专题 study task。",
            "基于当前对比结果补一版总结笔记，沉淀到画布节点中。",
        ]
        return {
            "title": title,
            "focus": (focus or "").strip() or None,
            "overview": f"当前共比较 {len(items)} 篇论文，建议围绕“{focus or '方法差异与研究价值'}”继续筛选代表样本并补充全文证据。",
            "common_points": common_points[:8],
            "differences": differences[:8],
            "recommended_next_steps": next_steps[:8],
        }

    def _get_or_create_project(
        self,
        db: Session,
        *,
        user_id: int,
        project_id: str | None = None,
    ) -> ResearchProject:
        repo = ResearchProjectRepo(db)
        if project_id:
            row = repo.get_by_project_key(user_id=user_id, project_key=project_id.strip())
            if not row:
                raise ValueError("project not found")
            return row
        default_row = repo.get_default(user_id=user_id)
        if default_row:
            return default_row
        now = datetime.now(timezone.utc)
        row = ResearchProject(
            project_key="project-default",
            user_id=user_id,
            name="默认研究项目",
            description="自动创建的默认项目，用于承接未分组的研究任务。",
            is_default=True,
            created_at=now,
            updated_at=now,
        )
        repo.create(row)
        return row

    def _ensure_task_project(self, db: Session, row: ResearchTask) -> ResearchTask:
        if row.project_id is not None:
            return row
        project = self._get_or_create_project(db, user_id=row.user_id)
        row.project_id = project.id
        row.updated_at = datetime.now(timezone.utc)
        db.add(row)
        db.flush()
        return row

    def _resolve_collection_item_payload(self, db: Session, *, collection: ResearchCollection, payload: dict) -> dict:
        task_token = str(payload.get("task_id") or "").strip()
        paper_token = str(payload.get("paper_id") or "").strip()
        if task_token and paper_token:
            task = ResearchTaskRepo(db).get_by_task_id(task_token, user_id=collection.project.user_id)
            if not task:
                raise ValueError(f"task not found: {task_token}")
            paper = ResearchPaperRepo(db).get_by_token(task.id, paper_token)
            if not paper:
                raise ValueError(f"paper not found: {paper_token}")
            return {
                "source_task_id": task.id,
                "paper_id": _paper_token(paper),
                "doi": (paper.doi or "").strip().lower() or None,
                "title": paper.title,
                "title_norm": paper.title_norm,
                "authors": _load_json_list(paper.authors_json),
                "year": paper.year,
                "venue": paper.venue,
                "url": paper.url,
                "source": paper.source,
                "metadata": {
                    "task_id": task.task_id,
                    "abstract": paper.abstract,
                    "method_summary": paper.method_summary,
                },
            }
        title = str(payload.get("title") or "").strip()
        if not title:
            raise ValueError("collection item title is required")
        doi = str(payload.get("doi") or "").strip().lower() or None
        matched = self._match_existing_paper_for_import(
            db,
            user_id=collection.project.user_id,
            doi=doi,
            title_norm=_normalize_title(title),
        )
        metadata = dict(payload.get("metadata") or {})
        metadata.setdefault("task_id", matched["task_id"] if matched else None)
        if matched:
            metadata.setdefault("matched_existing_paper", True)
            metadata.setdefault("matched_paper_id", matched["paper_id"])
            metadata.setdefault("matched_task_id", matched["task_id"])
        return {
            "source_task_id": matched["task_row_id"] if matched else None,
            "paper_id": paper_token or (matched["paper_id"] if matched else None),
            "doi": doi,
            "title": title,
            "title_norm": _normalize_title(title),
            "authors": payload.get("authors") or [],
            "year": _to_int_or_none(payload.get("year")),
            "venue": str(payload.get("venue") or "").strip() or None,
            "url": str(payload.get("url") or "").strip() or None,
            "source": str(payload.get("source") or "manual").strip() or "manual",
            "metadata": metadata,
        }

    def _add_collection_items_with_stats(self, db: Session, *, collection: ResearchCollection | None, items: list[dict]) -> dict:
        if not collection:
            raise ValueError("collection not found")
        item_repo = ResearchCollectionItemRepo(db)
        existing = item_repo.list_for_collection(collection.id)
        existing_keys = {
            (
                (item.paper_id or "").strip().lower(),
                (item.doi or "").strip().lower(),
                (item.title_norm or "").strip().lower(),
            )
            for item in existing
        }
        imported_items = 0
        deduped_items = 0
        linked_existing_papers = 0

        for payload in items:
            normalized = self._resolve_collection_item_payload(db, collection=collection, payload=payload)
            key = (
                (normalized.get("paper_id") or "").strip().lower(),
                (normalized.get("doi") or "").strip().lower(),
                (normalized.get("title_norm") or "").strip().lower(),
            )
            if key in existing_keys:
                deduped_items += 1
                continue
            now = datetime.now(timezone.utc)
            row = ResearchCollectionItem(
                collection_id=collection.id,
                source_task_id=normalized.get("source_task_id"),
                paper_id=normalized.get("paper_id"),
                doi=normalized.get("doi"),
                title=normalized["title"],
                title_norm=normalized["title_norm"],
                authors_json=orjson.dumps(normalized.get("authors") or []).decode("utf-8"),
                year=normalized.get("year"),
                venue=normalized.get("venue"),
                url=normalized.get("url"),
                source=normalized.get("source") or "manual",
                metadata_json=orjson.dumps(normalized.get("metadata") or {}).decode("utf-8"),
                created_at=now,
                updated_at=now,
            )
            item_repo.create(row)
            existing_keys.add(key)
            imported_items += 1
            if normalized.get("source_task_id") or normalized.get("paper_id"):
                linked_existing_papers += 1

        collection.updated_at = datetime.now(timezone.utc)
        db.add(collection)
        db.flush()
        return {
            "collection": self._collection_to_dict(db, collection),
            "imported_items": imported_items,
            "deduped_items": deduped_items,
            "linked_existing_papers": linked_existing_papers,
        }

    def _match_existing_paper_for_import(
        self,
        db: Session,
        *,
        user_id: int,
        doi: str | None,
        title_norm: str | None,
    ) -> dict | None:
        doi_norm = (doi or "").strip().lower()
        title_norm_value = (title_norm or "").strip().lower()
        if not doi_norm and not title_norm_value:
            return None
        task_rows = ResearchTaskRepo(db).list_recent(user_id=user_id, limit=200)
        paper_repo = ResearchPaperRepo(db)
        for task_row in task_rows:
            for paper in paper_repo.list_for_task(task_row.id):
                paper_doi = (paper.doi or "").strip().lower()
                paper_title_norm = (paper.title_norm or "").strip().lower()
                if doi_norm and paper_doi == doi_norm:
                    return {"task_id": task_row.task_id, "task_row_id": task_row.id, "paper_id": _paper_token(paper)}
                if not doi_norm and title_norm_value and paper_title_norm == title_norm_value:
                    return {"task_id": task_row.task_id, "task_row_id": task_row.id, "paper_id": _paper_token(paper)}
        return None

    def _summarize_collection_items(self, name: str, items: list[ResearchCollectionItem]) -> str:
        if not items:
            return f"集合「{name}」目前还没有论文。"
        top_venues: dict[str, int] = {}
        years: list[int] = []
        for item in items:
            if item.venue:
                top_venues[item.venue] = top_venues.get(item.venue, 0) + 1
            if item.year:
                years.append(int(item.year))
        venue_text = "、".join([venue for venue, _count in sorted(top_venues.items(), key=lambda pair: pair[1], reverse=True)[:3]]) or "来源未标注"
        if years:
            year_text = f"{min(years)}-{max(years)}"
        else:
            year_text = "年份未标注"
        return f"集合「{name}」共包含 {len(items)} 篇论文，时间范围 {year_text}，主要来源/期刊包括 {venue_text}。适合继续做集合级总结、派生 study task 或构建专题图谱。"

    def _detect_zotero_import_format(self, *, filename: str, content: bytes) -> str:
        suffix = Path(filename or "").suffix.lower()
        text = content.decode("utf-8-sig", errors="ignore").lstrip()
        if suffix in {".json", ".csljson"}:
            return "csljson"
        if suffix == ".bib":
            return "bib"
        if text.startswith("{") or text.startswith("["):
            return "csljson"
        if re.search(r"@\w+\s*[{(]", text):
            return "bib"
        raise ValueError("unsupported import format, expected .json/.csljson or .bib")

    def _parse_zotero_local_file(self, *, filename: str, content: bytes, fmt: str) -> list[dict]:
        text = content.decode("utf-8-sig", errors="ignore")
        if not text.strip():
            raise ValueError("uploaded file is empty")
        if fmt == "csljson":
            return self._parse_zotero_csljson(filename=filename, text=text)
        if fmt == "bib":
            return self._parse_zotero_bibtex(filename=filename, text=text)
        raise ValueError("unsupported import format")

    def _parse_zotero_csljson(self, *, filename: str, text: str) -> list[dict]:
        try:
            data = orjson.loads(text)
        except orjson.JSONDecodeError as exc:
            raise ValueError("invalid CSL JSON file") from exc
        if isinstance(data, dict) and isinstance(data.get("items"), list):
            raw_items = data.get("items") or []
        elif isinstance(data, list):
            raw_items = data
        else:
            raise ValueError("invalid CSL JSON structure")
        items: list[dict] = []
        for raw in raw_items:
            if not isinstance(raw, dict):
                continue
            title = str(raw.get("title") or "").strip()
            if not title:
                continue
            items.append(
                {
                    "title": title,
                    "authors": self._parse_csl_authors(raw.get("author")),
                    "year": self._extract_csl_year(raw),
                    "venue": self._first_nonempty_string(raw.get("container-title"), raw.get("collection-title"), raw.get("publisher")),
                    "doi": self._first_nonempty_string(raw.get("DOI"), raw.get("doi")),
                    "url": self._first_nonempty_string(raw.get("URL"), raw.get("url")),
                    "source": "zotero_local",
                    "metadata": {
                        "abstract": self._first_nonempty_string(raw.get("abstract"), raw.get("note")),
                        "item_type": self._first_nonempty_string(raw.get("type")) or "article-journal",
                        "tags": self._normalize_tag_values(raw.get("keyword") or raw.get("keywords")),
                        "source_file": filename,
                        "zotero_key": self._first_nonempty_string(raw.get("id"), raw.get("_id")),
                        "raw_source": "csljson",
                    },
                }
            )
        return items

    def _parse_zotero_bibtex(self, *, filename: str, text: str) -> list[dict]:
        items: list[dict] = []
        for entry in self._parse_bibtex_entries(text):
            title = str(entry["fields"].get("title") or "").strip()
            if not title:
                continue
            items.append(
                {
                    "title": title,
                    "authors": self._parse_bibtex_authors(entry["fields"].get("author")),
                    "year": _extract_year_from_text(self._first_nonempty_string(entry["fields"].get("year"), entry["fields"].get("date")) or ""),
                    "venue": self._first_nonempty_string(
                        entry["fields"].get("journal"),
                        entry["fields"].get("booktitle"),
                        entry["fields"].get("publisher"),
                    ),
                    "doi": self._first_nonempty_string(entry["fields"].get("doi")),
                    "url": self._first_nonempty_string(entry["fields"].get("url")),
                    "source": "zotero_local",
                    "metadata": {
                        "abstract": self._first_nonempty_string(entry["fields"].get("abstract"), entry["fields"].get("note")),
                        "item_type": entry["entry_type"],
                        "tags": self._normalize_tag_values(entry["fields"].get("keywords")),
                        "source_file": filename,
                        "zotero_key": entry["cite_key"],
                        "raw_source": "bib",
                    },
                }
            )
        return items

    def _parse_bibtex_entries(self, text: str) -> list[dict]:
        entries: list[dict] = []
        cursor = 0
        total = len(text)
        while cursor < total:
            match = re.search(r"@([A-Za-z0-9_:+-]+)\s*([({])", text[cursor:])
            if not match:
                break
            entry_type = str(match.group(1) or "").strip().lower()
            open_char = match.group(2)
            close_char = "}" if open_char == "{" else ")"
            body_start = cursor + match.end()
            depth = 1
            index = body_start
            while index < total and depth > 0:
                char = text[index]
                if char == open_char:
                    depth += 1
                elif char == close_char:
                    depth -= 1
                index += 1
            body = text[body_start : max(body_start, index - 1)]
            cursor = index
            if not body.strip():
                continue
            cite_key, fields_block = self._split_bibtex_body(body)
            entries.append(
                {
                    "entry_type": entry_type or "article",
                    "cite_key": cite_key,
                    "fields": self._parse_bibtex_fields(fields_block),
                }
            )
        return entries

    @staticmethod
    def _split_bibtex_body(body: str) -> tuple[str, str]:
        if "," not in body:
            return body.strip(), ""
        cite_key, fields_block = body.split(",", 1)
        return cite_key.strip(), fields_block

    def _parse_bibtex_fields(self, body: str) -> dict[str, str]:
        fields: dict[str, str] = {}
        index = 0
        length = len(body)
        while index < length:
            while index < length and body[index] in " \t\r\n,":
                index += 1
            start = index
            while index < length and re.match(r"[A-Za-z0-9_:+-]", body[index]):
                index += 1
            name = body[start:index].strip().lower()
            while index < length and body[index].isspace():
                index += 1
            if not name or index >= length or body[index] != "=":
                break
            index += 1
            while index < length and body[index].isspace():
                index += 1
            value, index = self._read_bibtex_value(body, index)
            fields[name] = value.strip()
            while index < length and body[index] not in ",":
                index += 1
            if index < length and body[index] == ",":
                index += 1
        return fields

    def _read_bibtex_value(self, text: str, index: int) -> tuple[str, int]:
        if index >= len(text):
            return "", index
        marker = text[index]
        if marker == "{":
            depth = 1
            index += 1
            start = index
            while index < len(text) and depth > 0:
                char = text[index]
                if char == "{":
                    depth += 1
                elif char == "}":
                    depth -= 1
                index += 1
            return self._strip_wrapping_braces(text[start : max(start, index - 1)]), index
        if marker == '"':
            index += 1
            start = index
            escaped = False
            while index < len(text):
                char = text[index]
                if char == '"' and not escaped:
                    return text[start:index], index + 1
                escaped = char == "\\" and not escaped
                if char != "\\":
                    escaped = False
                index += 1
            return text[start:], index
        start = index
        while index < len(text) and text[index] not in ",\r\n":
            index += 1
        return text[start:index].strip(), index

    @staticmethod
    def _strip_wrapping_braces(value: str) -> str:
        cleaned = value.strip()
        while cleaned.startswith("{") and cleaned.endswith("}"):
            inner = cleaned[1:-1].strip()
            if not inner:
                return ""
            cleaned = inner
        return cleaned

    @staticmethod
    def _parse_bibtex_authors(value: object) -> list[str]:
        text = str(value or "").strip()
        if not text:
            return []
        authors = []
        for part in re.split(r"\s+and\s+", text, flags=re.IGNORECASE):
            normalized = part.strip()
            if not normalized:
                continue
            if "," in normalized:
                pieces = [piece.strip() for piece in normalized.split(",", 1)]
                normalized = " ".join(piece for piece in reversed(pieces) if piece).strip()
            authors.append(normalized)
        return authors

    @staticmethod
    def _parse_csl_authors(value: object) -> list[str]:
        if not isinstance(value, list):
            return []
        authors = []
        for author in value:
            if not isinstance(author, dict):
                continue
            literal = str(author.get("literal") or "").strip()
            if literal:
                authors.append(literal)
                continue
            given = str(author.get("given") or "").strip()
            family = str(author.get("family") or "").strip()
            full_name = " ".join(part for part in (given, family) if part).strip()
            if full_name:
                authors.append(full_name)
        return authors

    @staticmethod
    def _extract_csl_year(item: dict) -> int | None:
        for key in ("issued", "published-print", "published-online", "accessed"):
            value = item.get(key)
            if isinstance(value, dict):
                date_parts = value.get("date-parts")
                if isinstance(date_parts, list) and date_parts and isinstance(date_parts[0], list) and date_parts[0]:
                    return _to_int_or_none(date_parts[0][0])
        return _extract_year_from_text(str(item.get("year") or "").strip())

    @staticmethod
    def _normalize_tag_values(value: object) -> list[str]:
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        if isinstance(value, str):
            return [part.strip() for part in re.split(r"[;,]", value) if part.strip()]
        return []

    @staticmethod
    def _first_nonempty_string(*values: object) -> str | None:
        for value in values:
            if isinstance(value, list):
                for item in value:
                    text = str(item or "").strip()
                    if text:
                        return text
            else:
                text = str(value or "").strip()
                if text:
                    return text
        return None

    @staticmethod
    def _sanitize_bib_value(value: object) -> str:
        return str(value or "").replace("{", "").replace("}", "").strip()

    @staticmethod
    def _authors_to_csl(authors: list[object]) -> list[dict[str, str]]:
        output: list[dict[str, str]] = []
        for raw in authors:
            text = str(raw or "").strip()
            if not text:
                continue
            if "," in text:
                family, given = [part.strip() for part in text.split(",", 1)]
                output.append({"family": family, "given": given})
            elif len(text.split()) == 1:
                output.append({"literal": text})
            else:
                parts = text.split()
                output.append({"family": parts[-1], "given": " ".join(parts[:-1])})
        return output

    @staticmethod
    def _collection_item_export_dict(item: ResearchCollectionItem) -> dict:
        metadata = _load_json_dict(item.metadata_json)
        return {
            "id": metadata.get("zotero_key") or item.paper_id or f"collection-item-{item.id}",
            "title": item.title,
            "authors": _load_json_list(item.authors_json),
            "year": item.year,
            "venue": item.venue,
            "doi": item.doi,
            "url": item.url,
            "abstract": metadata.get("abstract"),
            "type": metadata.get("item_type") or "article-journal",
        }

    def _normalize_zotero_item(self, item: dict) -> dict | None:
        data = item.get("data") if isinstance(item, dict) and isinstance(item.get("data"), dict) else item
        if not isinstance(data, dict):
            return None
        title = str(data.get("title") or "").strip()
        if not title:
            return None
        creators = data.get("creators") if isinstance(data.get("creators"), list) else []
        authors = []
        for creator in creators:
            if not isinstance(creator, dict):
                continue
            first = str(creator.get("firstName") or "").strip()
            last = str(creator.get("lastName") or "").strip()
            name = " ".join(part for part in (first, last) if part).strip() or str(creator.get("name") or "").strip()
            if name:
                authors.append(name)
        year = _extract_year_from_text(str(data.get("date") or "").strip())
        return {
            "title": title,
            "authors": authors,
            "year": year,
            "venue": str(data.get("publicationTitle") or data.get("proceedingsTitle") or "").strip() or None,
            "doi": str(data.get("DOI") or "").strip() or None,
            "url": str(data.get("url") or "").strip() or None,
            "source": "zotero",
            "metadata": {
                "item_type": data.get("itemType"),
                "zotero_key": data.get("key"),
                "abstract": data.get("abstractNote"),
            },
        }

    @staticmethod
    def _http_get_json(url: str, *, headers: dict[str, str] | None = None, params: dict | None = None):
        with httpx.Client(timeout=30, trust_env=False) as client:
            response = client.get(url, headers=headers or {}, params=params or {})
        if response.status_code >= 400:
            raise ValueError(f"http_{response.status_code}")
        return response.json()

    def _fallback_directions(self, topic: str) -> list[dict]:
        base = topic.strip()
        direction_min = max(1, int(self.settings.research_direction_min))
        direction_max = max(direction_min, int(self.settings.research_direction_max))
        english_directions = [
            {
                "name": "World models for robotics planning",
                "queries": [f"{base} world model robotics", f"{base} embodied world model planning"],
                "exclude_terms": [],
            },
            {
                "name": "Vision-language-action models for robot control",
                "queries": [f"{base} vision language action model", f"{base} VLA robot policy"],
                "exclude_terms": [],
            },
            {
                "name": "Robot data efficiency and imitation learning",
                "queries": [f"{base} data efficiency imitation learning", f"{base} robot dataset embodied AI"],
                "exclude_terms": [],
            },
            {
                "name": "Sim-to-real transfer and generalization",
                "queries": [f"{base} sim-to-real generalization", f"{base} robot transfer learning"],
                "exclude_terms": [],
            },
            {
                "name": "Benchmarks, safety, and deployment",
                "queries": [f"{base} benchmark evaluation safety", f"{base} embodied AI deployment"],
                "exclude_terms": [],
            },
        ]
        return english_directions[: max(direction_min, min(direction_max, len(english_directions)))]
        directions = [
            {
                "name": "世界模型与机器人规划",
                "queries": [f"{base} world model robotics", f"{base} embodied world model planning"],
                "exclude_terms": [],
            },
            {
                "name": "视觉语言动作模型与端到端控制",
                "queries": [f"{base} vision language action model", f"{base} VLA robot policy"],
                "exclude_terms": [],
            },
            {
                "name": "数据效率、模仿学习与机器人数据集",
                "queries": [f"{base} data efficiency imitation learning", f"{base} robot dataset embodied AI"],
                "exclude_terms": [],
            },
            {
                "name": "仿真到现实迁移与泛化能力",
                "queries": [f"{base} sim-to-real generalization", f"{base} robot transfer learning"],
                "exclude_terms": [],
            },
            {
                "name": "评测基准、安全性与部署",
                "queries": [f"{base} benchmark evaluation safety", f"{base} embodied AI deployment"],
                "exclude_terms": [],
            },
        ]
        return directions[: max(direction_min, min(direction_max, len(directions)))]
        directions = [
            {
                "name": "生成式/端到端方案",
                "queries": [f"{base} generative", f"{base} end-to-end model"],
                "exclude_terms": [],
            },
            {
                "name": "检索增强/知识引入方案",
                "queries": [f"{base} retrieval augmented", f"{base} knowledge grounded"],
                "exclude_terms": [],
            },
            {
                "name": "模板/规则/结构化方案",
                "queries": [f"{base} template based", f"{base} rule-based"],
                "exclude_terms": [],
            },
        ]
        extras = [
            {
                "name": "多阶段/模块化管线方案",
                "queries": [f"{base} pipeline", f"{base} multi-stage"],
                "exclude_terms": [],
            },
            {
                "name": "混合/跨模态方案",
                "queries": [f"{base} hybrid model", f"{base} multimodal"],
                "exclude_terms": [],
            },
        ]
        direction_min = max(1, int(self.settings.research_direction_min))
        direction_max = max(direction_min, int(self.settings.research_direction_max))
        while len(directions) < direction_min and extras:
            directions.append(extras.pop(0))
        return directions[:direction_max]

    @staticmethod
    def _next_task_id() -> str:
        now = datetime.now(timezone.utc)
        return f"R-{now:%Y%m%d-%H%M%S}-{uuid4().hex[:4]}"

    def _notify_user(self, db: Session, user_id: int, content: str) -> None:
        if not self.wecom_client:
            return
        user: User | None = UserRepo(db).get_by_id(user_id)
        if not user:
            return
        ok, error = self.wecom_client.send_text(user.wecom_user_id, content)
        if not ok:
            logger.warning("research_notify_failed user_id=%s error=%s", user_id, error)

    @staticmethod
    def _run_with_locked_retry(db: Session, operation: Callable[[], object], *, attempts: int = 4, base_delay_seconds: float = 0.2):
        for attempt in range(max(1, attempts)):
            try:
                return operation()
            except OperationalError as exc:
                if not ResearchService._is_sqlite_locked_error(exc) or attempt >= attempts - 1:
                    raise
                db.rollback()
                sleep(base_delay_seconds * (attempt + 1))
        raise RuntimeError("sqlite retry exhausted")

    @staticmethod
    def _is_sqlite_locked_error(exc: OperationalError) -> bool:
        return "database is locked" in str(exc).lower()

    @staticmethod
    def _task_status_for_retry(job_type: ResearchJobType) -> ResearchTaskStatus:
        if job_type == ResearchJobType.PLAN:
            return ResearchTaskStatus.PLANNING
        if job_type == ResearchJobType.AUTO_RESEARCH:
            return ResearchTaskStatus.SEARCHING
        return ResearchTaskStatus.SEARCHING

    def _record_job_metric(self, *, latency_ms: int = 0) -> None:
        if not self.settings.research_metrics_enabled:
            return
        self.research_jobs_total += 1
        self.research_job_latency_ms = max(0, int(latency_ms))

    def _record_source_status(self, source: str, status: str) -> None:
        if not self.settings.research_metrics_enabled:
            return
        key = f"{source}:{status}"
        self.research_search_source_status[key] = self.research_search_source_status.get(key, 0) + 1

    def _record_cache_hit(self) -> None:
        if not self.settings.research_metrics_enabled:
            return
        self.research_cache_hit += 1

    def _record_cache_miss(self) -> None:
        if not self.settings.research_metrics_enabled:
            return
        self.research_cache_miss += 1

    def _record_export_metric(self, *, success: bool) -> None:
        if not self.settings.research_metrics_enabled:
            return
        if success:
            self.research_export_success += 1
        else:
            self.research_export_fail += 1

    def record_export_delivery(self, *, success: bool) -> None:
        self._record_export_metric(success=success)

    @staticmethod
    def _normalize_job_error(exc: Exception) -> str:
        value = str(exc).strip()
        if not value:
            return exc.__class__.__name__
        return f"{exc.__class__.__name__}:{value}"[:2000]

    @staticmethod
    def _render_saved_paper_markdown(task: ResearchTask, paper) -> str:
        lines = [
            f"# {paper.title}",
            "",
            f"- Task ID: {task.task_id}",
            f"- Source: {paper.source}",
            f"- Year: {paper.year or '-'}",
            f"- Venue: {paper.venue or '-'}",
            f"- DOI: {paper.doi or '-'}",
            f"- URL: {paper.url or '-'}",
            "",
            "## Authors",
            ", ".join(_load_json_list(paper.authors_json)) or "-",
            "",
            "## Abstract",
            (paper.abstract or "-"),
            "",
            "## Method Summary",
            (paper.method_summary or "-"),
        ]
        if paper.key_points:
            lines.extend(["", "## AI Key Points", paper.key_points])
        return "\n".join(lines).strip() + "\n"

    @staticmethod
    def _render_report(task: ResearchTask, directions: list, papers: list) -> str:
        lines = [f"# Research Report: {task.topic}", "", f"- Task ID: {task.task_id}", f"- Status: {task.status.value}", ""]
        lines.append("## Directions")
        for d in directions:
            lines.append(f"- [{d.direction_index}] {d.name} ({d.papers_count} papers)")
        lines.append("")
        lines.append("## Papers")
        for idx, p in enumerate(papers, start=1):
            lines.append(f"### {idx}. {p.title}")
            lines.append(f"- Source: {p.source}")
            if p.year:
                lines.append(f"- Year: {p.year}")
            if p.venue:
                lines.append(f"- Venue: {p.venue}")
            if p.doi:
                lines.append(f"- DOI: {p.doi}")
            if p.url:
                lines.append(f"- URL: {p.url}")
            if p.method_summary:
                lines.append(f"- Method Summary: {p.method_summary}")
            lines.append("")
        return "\n".join(lines).strip() + "\n"

    @staticmethod
    def _render_bib(papers: list) -> str:
        export_items = []
        for idx, paper in enumerate(papers, start=1):
            export_items.append(
                {
                    "id": _paper_token(paper) or f"paper{idx}",
                    "title": paper.title,
                    "authors": _load_json_list(paper.authors_json),
                    "year": paper.year,
                    "venue": paper.venue,
                    "doi": paper.doi,
                    "url": paper.url,
                    "abstract": paper.abstract,
                    "type": "article-journal",
                }
            )
        return ResearchService._render_bib_from_export_items(export_items)

    @staticmethod
    def _render_bib_from_collection_items(items: list[ResearchCollectionItem]) -> str:
        export_items = [ResearchService._collection_item_export_dict(item) for item in items]
        return ResearchService._render_bib_from_export_items(export_items)

    @staticmethod
    def _render_bib_from_export_items(items: list[dict]) -> str:
        blocks: list[str] = []
        for idx, item in enumerate(items, start=1):
            key = _normalize_cite_key(str(item.get("id") or f"paper{idx}"), fallback=f"paper{idx}")
            authors = " and ".join([str(author).strip() for author in (item.get("authors") or []) if str(author).strip()])
            title = ResearchService._sanitize_bib_value(item.get("title"))
            venue = ResearchService._sanitize_bib_value(item.get("venue"))
            url = ResearchService._sanitize_bib_value(item.get("url"))
            doi = ResearchService._sanitize_bib_value(item.get("doi"))
            year = str(item.get("year") or "")
            entry_type = "inproceedings" if "proceed" in str(item.get("type") or "").lower() else "article"
            venue_field = "booktitle" if entry_type == "inproceedings" else "journal"
            entry = [
                f"@{entry_type}{{{key},",
                f"  title = {{{title}}},",
                f"  author = {{{authors}}},",
                f"  {venue_field} = {{{venue}}},",
                f"  year = {{{year}}},",
                f"  doi = {{{doi}}},",
                f"  url = {{{url}}},",
                "}",
            ]
            blocks.append("\n".join(entry))
        return "\n\n".join(blocks).strip() + "\n"

    @staticmethod
    def _render_csljson_from_papers(papers: list) -> str:
        export_items = []
        for idx, paper in enumerate(papers, start=1):
            export_items.append(
                {
                    "id": _paper_token(paper) or f"paper{idx}",
                    "title": paper.title,
                    "authors": _load_json_list(paper.authors_json),
                    "year": paper.year,
                    "venue": paper.venue,
                    "doi": paper.doi,
                    "url": paper.url,
                    "abstract": paper.abstract,
                    "type": "article-journal",
                }
            )
        return ResearchService._render_csljson_from_export_items(export_items)

    @staticmethod
    def _render_csljson_from_collection_items(items: list[ResearchCollectionItem]) -> str:
        export_items = [ResearchService._collection_item_export_dict(item) for item in items]
        return ResearchService._render_csljson_from_export_items(export_items)

    @staticmethod
    def _render_csljson_from_export_items(items: list[dict]) -> str:
        payload = []
        for idx, item in enumerate(items, start=1):
            entry: dict[str, object] = {
                "id": str(item.get("id") or f"paper{idx}"),
                "type": str(item.get("type") or "article-journal"),
                "title": str(item.get("title") or ""),
            }
            authors = ResearchService._authors_to_csl(item.get("authors") or [])
            if authors:
                entry["author"] = authors
            year = _to_int_or_none(item.get("year"))
            if year is not None:
                entry["issued"] = {"date-parts": [[year]]}
            venue = str(item.get("venue") or "").strip()
            if venue:
                entry["container-title"] = venue
            doi = str(item.get("doi") or "").strip()
            if doi:
                entry["DOI"] = doi
            url = str(item.get("url") or "").strip()
            if url:
                entry["URL"] = url
            abstract = str(item.get("abstract") or "").strip()
            if abstract:
                entry["abstract"] = abstract
            payload.append(entry)
        return orjson.dumps(payload, option=orjson.OPT_INDENT_2).decode("utf-8") + "\n"

    @staticmethod
    def _render_json(task: ResearchTask, directions: list, papers: list) -> str:
        payload = {
            "task_id": task.task_id,
            "topic": task.topic,
            "status": task.status.value,
            "constraints": _load_json_dict(task.constraints_json),
            "directions": [
                {
                    "direction_index": d.direction_index,
                    "name": d.name,
                    "queries": _load_json_list(d.queries_json),
                    "exclude_terms": _load_json_list(d.exclude_terms_json),
                    "papers_count": d.papers_count,
                }
                for d in directions
            ],
            "papers": [
                {
                    "title": p.title,
                    "authors": _load_json_list(p.authors_json),
                    "year": p.year,
                    "venue": p.venue,
                    "doi": p.doi,
                    "url": p.url,
                    "abstract": p.abstract,
                    "method_summary": p.method_summary,
                    "source": p.source,
                }
                for p in papers
            ],
        }
        return orjson.dumps(payload, option=orjson.OPT_INDENT_2).decode("utf-8") + "\n"


def _load_json_list(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(x) for x in value if str(x).strip()]
    if not isinstance(value, str):
        return []
    if not value:
        return []
    try:
        data = orjson.loads(value)
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    return [str(x) for x in data if str(x).strip()]


def _load_json_dict(value: object) -> dict:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if not isinstance(value, str):
        return {}
    if not value:
        return {}
    try:
        data = orjson.loads(value)
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def _load_json_list_of_dict(value: object) -> list[dict]:
    if value is None:
        return []
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if not isinstance(value, str):
        return []
    if not value:
        return []
    try:
        data = orjson.loads(value)
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    return [item for item in data if isinstance(item, dict)]


def _safe_xml_text(node) -> str:
    if node is None or node.text is None:
        return ""
    return node.text.strip()


def _to_int_or_none(value: object) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except Exception:
        return None


def _normalize_title(title: str) -> str:
    value = (title or "").lower()
    value = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def _normalize_cite_key(value: str, *, fallback: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9:_-]+", "-", (value or "").strip()).strip("-")
    return normalized[:64] or fallback


def _resolve_sources(sources: object, default_sources: str) -> set[str]:
    allowed = {"semantic_scholar", "arxiv", "openalex"}
    values: list[str] = []
    if isinstance(sources, str):
        values = [item.strip().lower() for item in sources.split(",") if item.strip()]
    elif isinstance(sources, list):
        values = [str(item).strip().lower() for item in sources if str(item).strip()]
    if not values:
        values = [item.strip().lower() for item in default_sources.split(",") if item.strip()]
    return {item for item in values if item in allowed}


def _extract_year_from_text(value: str) -> int | None:
    match = re.search(r"(19|20)\d{2}", value or "")
    if not match:
        return None
    try:
        return int(match.group(0))
    except Exception:
        return None


def _openalex_abstract_to_text(value: object) -> str:
    if not isinstance(value, dict):
        return ""
    words: list[tuple[int, str]] = []
    for token, positions in value.items():
        if not isinstance(token, str) or not isinstance(positions, list):
            continue
        for pos in positions:
            if isinstance(pos, int):
                words.append((pos, token))
    if not words:
        return ""
    words.sort(key=lambda item: item[0])
    return " ".join(token for _pos, token in words)


def _resolve_citation_sources(sources: object, default_sources: str) -> list[str]:
    allowed = {"semantic_scholar", "openalex", "crossref"}
    values: list[str] = []
    if isinstance(sources, str):
        values = [item.strip().lower() for item in re.split(r"[,\s|]+", sources) if item.strip()]
    elif isinstance(sources, list):
        values = [str(item).strip().lower() for item in sources if str(item).strip()]
    if not values:
        values = [item.strip().lower() for item in default_sources.split(",") if item.strip()]
    out = [item for item in values if item in allowed]
    if not out:
        return ["semantic_scholar"]
    dedup: list[str] = []
    seen = set()
    for item in out:
        if item in seen:
            continue
        seen.add(item)
        dedup.append(item)
    return dedup


def _merge_query_and_excludes(query: str, exclude_terms: list[str]) -> str:
    value = (query or "").strip()
    excludes = [item.strip() for item in exclude_terms if item and item.strip()]
    if not excludes:
        return value
    return f"{value} " + " ".join(f"-{item}" for item in excludes)


def _extract_first_json_object(text: str) -> dict | None:
    raw = (text or "").strip()
    if not raw:
        return None
    try:
        data = orjson.loads(raw)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    for idx, char in enumerate(raw):
        if char != "{":
            continue
        candidate = raw[idx:]
        try:
            data = orjson.loads(candidate)
        except Exception:
            continue
        if isinstance(data, dict):
            return data
    return None


def _normalize_source_response(raw: object) -> tuple[list[dict], str, str | None]:
    if isinstance(raw, tuple) and len(raw) == 3:
        papers = raw[0] if isinstance(raw[0], list) else []
        status = str(raw[1] or "ok")
        error = str(raw[2]) if raw[2] is not None else None
        return [item for item in papers if isinstance(item, dict)], status, error
    if isinstance(raw, list):
        papers = [item for item in raw if isinstance(item, dict)]
        return papers, ("ok" if papers else "ok_empty"), None
    return [], "invalid_response", f"invalid_source_response:{type(raw).__name__}"


def _paper_token(paper) -> str:
    if getattr(paper, "paper_id", None):
        return str(paper.paper_id).strip()
    if getattr(paper, "doi", None):
        return str(paper.doi).strip().lower()
    return f"paper-{paper.id}"


def _normalize_pdf_text(text: str) -> str:
    value = (text or "").replace("\x00", " ")
    value = re.sub(r"[ \t]+\n", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def _estimate_text_quality(text: str) -> float:
    value = (text or "").strip()
    if not value:
        return 0.0
    total = len(value)
    alpha = sum(1 for ch in value if ch.isalpha())
    digit = sum(1 for ch in value if ch.isdigit())
    bad = sum(1 for ch in value if ord(ch) < 9 or ord(ch) == 127)
    ratio = (alpha + 0.3 * digit) / max(1, total)
    penalty = bad / max(1, total)
    score = max(0.0, min(1.0, ratio - penalty))
    return round(float(score), 4)


def _extract_sections_lite(text: str) -> dict:
    value = (text or "").strip()
    if not value:
        return {}
    normalized = re.sub(r"\r\n?", "\n", value)
    patterns = [
        ("abstract", r"\babstract\b"),
        ("introduction", r"\bintroduction\b"),
        ("method", r"\bmethods?\b|\bmethodology\b"),
        ("results", r"\bresults?\b"),
        ("conclusion", r"\bconclusions?\b"),
        ("references", r"\breferences\b"),
    ]
    lines = normalized.splitlines()
    hits: dict[str, int] = {}
    for idx, line in enumerate(lines):
        low = line.strip().lower()
        for key, pattern in patterns:
            if key in hits:
                continue
            if re.search(pattern, low):
                hits[key] = idx
    if not hits:
        return {}
    ordered = sorted(hits.items(), key=lambda kv: kv[1])
    result: dict[str, str] = {}
    for pos, (key, start_idx) in enumerate(ordered):
        end_idx = ordered[pos + 1][1] if pos + 1 < len(ordered) else len(lines)
        chunk = "\n".join(lines[start_idx:end_idx]).strip()
        if chunk:
            result[key] = chunk[:2000]
    return result


def _extract_pdf_links_from_html(html: str, base_url: str) -> list[str]:
    if not html:
        return []
    links = re.findall(r"""href=['"]([^'"]+\.pdf(?:\?[^'"]*)?)['"]""", html, flags=re.IGNORECASE)
    out: list[str] = []
    seen = set()
    for item in links:
        url = urljoin(base_url, item.strip())
        if url and url not in seen:
            seen.add(url)
            out.append(url)
    return out


def _semantic_scholar_identifier_for_paper(paper) -> str | None:
    paper_id = (getattr(paper, "paper_id", None) or "").strip()
    if paper_id:
        return paper_id
    doi = (getattr(paper, "doi", None) or "").strip()
    if doi:
        return f"DOI:{doi}"
    return None


def _normalize_openalex_id(raw: object) -> str:
    value = str(raw or "").strip()
    if not value:
        return ""
    if "/" in value:
        value = value.rsplit("/", 1)[-1]
    return value.strip()


def _citation_neighbor_id(*, title: str, doi: str, fallback_seed: str) -> str:
    doi_norm = (doi or "").strip().lower()
    if doi_norm:
        return doi_norm
    title_norm = _normalize_title(title)
    if title_norm:
        return title_norm[:120]
    fallback = _normalize_title(fallback_seed)
    return fallback[:120] or ""


def _normalize_neighbor_from_s2(payload: object) -> dict | None:
    if not isinstance(payload, dict):
        return None
    paper_id = str(payload.get("paperId") or "").strip()
    title = str(payload.get("title") or "").strip()
    if not title and not paper_id:
        return None
    external_ids = payload.get("externalIds") if isinstance(payload.get("externalIds"), dict) else {}
    doi = str(external_ids.get("DOI") or "").strip().lower() if external_ids else ""
    neighbor_id = paper_id or doi
    if not neighbor_id:
        neighbor_id = _normalize_title(title)[:120] or "unknown"
    return {
        "id": neighbor_id,
        "title": title or neighbor_id,
        "year": _to_int_or_none(payload.get("year")),
        "doi": doi or None,
    }
