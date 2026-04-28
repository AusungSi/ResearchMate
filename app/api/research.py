from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
import orjson
from pathlib import Path
from sqlalchemy.orm import Session

from app.api.mobile import get_current_user_id
from app.domain.schemas import (
    ResearchCollectionAddItemsRequest,
    ResearchCollectionGraphResponse,
    ResearchCollectionListResponse,
    ResearchCollectionCreateRequest,
    ResearchCollectionRemoveItemsRequest,
    ResearchCollectionResponse,
    ResearchCollectionSummaryResponse,
    ResearchCollectionStudyRequest,
    ResearchCompareRequest,
    ResearchCompareResponse,
    ResearchPaperDetailResponse,
    ResearchPaperAssetResponse,
    ResearchExportResponse,
    ResearchExportListResponse,
    ResearchAutoRunResponse,
    ResearchCanvasRequest,
    ResearchCanvasResponse,
    ResearchChatAttachmentListResponse,
    ResearchChatMessageListResponse,
    ResearchChatThreadCreateRequest,
    ResearchChatThreadListResponse,
    ResearchChatThreadResponse,
    ResearchExploreStartRequest,
    ResearchExploreStartResponse,
    ResearchExploreTreeResponse,
    ResearchNodeChatRequest,
    ResearchNodeChatResponse,
    ResearchPaperSaveRequest,
    ResearchPaperSaveResponse,
    ResearchPaperSummarizeResponse,
    ResearchRunControlResponse,
    ResearchRunEventsResponse,
    ResearchRunGuidanceRequest,
    ResearchRunGuidanceResponse,
    ResearchRoundNextRequest,
    ResearchRoundNextResponse,
    ResearchFulltextBuildResponse,
    ResearchFulltextStatusResponse,
    ResearchGraphBuildRequest,
    ResearchGraphBuildResponse,
    ResearchGraphResponse,
    ResearchGraphSnapshotListResponse,
    ResearchRoundProposeRequest,
    ResearchRoundProposeResponse,
    ResearchRoundSelectRequest,
    ResearchRoundSelectResponse,
    ResearchSearchResponse,
    ResearchSavedPaperListResponse,
    ResearchProjectCreateRequest,
    ResearchProjectDashboardResponse,
    ResearchProjectListResponse,
    ResearchProjectResponse,
    ResearchTaskCreateRequest,
    ResearchTaskChatStreamRequest,
    ResearchTaskListResponse,
    ResearchTaskPlanResponse,
    ResearchTaskResponse,
    ResearchTaskSearchEnqueueResponse,
    ResearchTaskSearchRequest,
    ResearchVenueMetricsResponse,
    ResearchWorkbenchConfigResponse,
    ResearchZoteroConfigResponse,
    ResearchZoteroImportRequest,
    ResearchZoteroImportResponse,
)
from app.infra.db import get_db
from app.services.research_service import CanvasStateBusyError, NodeChatBusyError, ResearchService


router = APIRouter(prefix="/api/v1/research")


def get_research_service(request: Request) -> ResearchService:
    return request.app.state.research_service


def _queue_feedback(queued: bool, *, submitted: str, noop_reason: str | None, noop_messages: dict[str, str]) -> tuple[str | None, str]:
    if queued:
        return None, submitted
    return noop_reason, noop_messages.get(noop_reason or "", "当前操作没有执行。")


def _sse_event(event_type: str, payload: dict) -> bytes:
    return f"event: {event_type}\ndata: {orjson.dumps(payload).decode('utf-8')}\n\n".encode("utf-8")


@router.post("/tasks", response_model=ResearchTaskResponse)
def create_research_task(
    payload: ResearchTaskCreateRequest,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchTaskResponse:
    constraints = {
        "year_from": payload.year_from,
        "year_to": payload.year_to,
        "top_n": payload.top_n,
        "sources": payload.sources,
    }
    row = research_service.create_task(
        db,
        user_id=user_id,
        topic=payload.topic,
        project_id=payload.project_id,
        constraints=constraints,
        mode=payload.mode,
        llm_backend=payload.llm_backend,
        llm_model=payload.llm_model,
    )
    # Commit before the follow-up read so the next HTTP request cannot observe
    # a just-created task before the outer dependency finalizer commits it.
    db.commit()
    data = research_service.get_task(db, user_id=user_id, task_id=row.task_id)
    return ResearchTaskResponse(**data)


@router.get("/tasks", response_model=ResearchTaskListResponse)
def list_research_tasks(
    limit: int = Query(default=10, ge=1, le=50),
    project_id: str | None = Query(default=None),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchTaskListResponse:
    items = research_service.list_tasks(db, user_id=user_id, limit=limit, project_id=project_id)
    return ResearchTaskListResponse(items=[ResearchTaskResponse(**x) for x in items], total=len(items))


@router.get("/workbench/config", response_model=ResearchWorkbenchConfigResponse)
def get_workbench_config(
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchWorkbenchConfigResponse:
    return ResearchWorkbenchConfigResponse(**research_service.get_workbench_config())


@router.get("/projects", response_model=ResearchProjectListResponse)
def list_projects(
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchProjectListResponse:
    return ResearchProjectListResponse(**research_service.list_projects(db, user_id=user_id))


@router.post("/projects", response_model=ResearchProjectResponse)
def create_project(
    payload: ResearchProjectCreateRequest,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchProjectResponse:
    return ResearchProjectResponse(**research_service.create_project(db, user_id=user_id, name=payload.name, description=payload.description))


@router.get("/projects/{project_id}", response_model=ResearchProjectResponse)
def get_project(
    project_id: str,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchProjectResponse:
    try:
        data = research_service.get_project(db, user_id=user_id, project_id=project_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ResearchProjectResponse(**data)


@router.get("/projects/{project_id}/dashboard", response_model=ResearchProjectDashboardResponse)
def get_project_dashboard(
    project_id: str,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchProjectDashboardResponse:
    try:
        data = research_service.get_project_dashboard(db, user_id=user_id, project_id=project_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ResearchProjectDashboardResponse(**data)


@router.get("/projects/{project_id}/collections", response_model=ResearchCollectionListResponse)
def list_project_collections(
    project_id: str,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchCollectionListResponse:
    try:
        data = research_service.list_collections(db, user_id=user_id, project_id=project_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ResearchCollectionListResponse(
        items=[ResearchCollectionResponse(**item) for item in data["items"]],
        total=data["total"],
    )


@router.post("/projects/{project_id}/collections", response_model=ResearchCollectionResponse)
def create_project_collection(
    project_id: str,
    payload: ResearchCollectionCreateRequest,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchCollectionResponse:
    try:
        data = research_service.create_collection(
            db,
            user_id=user_id,
            project_id=project_id,
            name=payload.name,
            description=payload.description,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchCollectionResponse(**data)


@router.get("/collections/{collection_id}", response_model=ResearchCollectionResponse)
def get_collection(
    collection_id: str,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchCollectionResponse:
    try:
        data = research_service.get_collection(
            db,
            user_id=user_id,
            collection_id=collection_id,
            offset=offset,
            limit=limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ResearchCollectionResponse(**data)


@router.post("/collections/{collection_id}/items", response_model=ResearchCollectionResponse)
def add_collection_items(
    collection_id: str,
    payload: ResearchCollectionAddItemsRequest,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchCollectionResponse:
    try:
        data = research_service.add_collection_items(db, user_id=user_id, collection_id=collection_id, items=[item.model_dump() for item in payload.items])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchCollectionResponse(**data)


@router.delete("/collections/{collection_id}/items/{item_id}", response_model=ResearchCollectionResponse)
def delete_collection_item(
    collection_id: str,
    item_id: int,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchCollectionResponse:
    try:
        data = research_service.remove_collection_item(db, user_id=user_id, collection_id=collection_id, item_id=item_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ResearchCollectionResponse(**data)


@router.post("/collections/{collection_id}/items/remove", response_model=ResearchCollectionResponse)
def remove_collection_items(
    collection_id: str,
    payload: ResearchCollectionRemoveItemsRequest,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchCollectionResponse:
    try:
        data = research_service.remove_collection_items(
            db,
            user_id=user_id,
            collection_id=collection_id,
            item_ids=payload.item_ids,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ResearchCollectionResponse(**data)


@router.post("/collections/{collection_id}/study", response_model=ResearchTaskResponse)
def create_collection_study(
    collection_id: str,
    payload: ResearchCollectionStudyRequest,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchTaskResponse:
    try:
        data = research_service.create_study_from_collection(
            db,
            user_id=user_id,
            collection_id=collection_id,
            topic=payload.topic,
            mode=payload.mode,
            llm_backend=payload.llm_backend,
            llm_model=payload.llm_model,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.commit()
    return ResearchTaskResponse(**data)


@router.post("/collections/{collection_id}/summarize", response_model=ResearchCollectionSummaryResponse)
def summarize_collection(
    collection_id: str,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchCollectionSummaryResponse:
    try:
        data = research_service.summarize_collection(db, user_id=user_id, collection_id=collection_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchCollectionSummaryResponse(**data)


@router.post("/collections/{collection_id}/graph/build", response_model=ResearchCollectionGraphResponse)
def build_collection_graph(
    collection_id: str,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchCollectionGraphResponse:
    try:
        data = research_service.build_collection_graph(db, user_id=user_id, collection_id=collection_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchCollectionGraphResponse(**data)


@router.post("/collections/{collection_id}/compare", response_model=ResearchCompareResponse)
def compare_collection(
    collection_id: str,
    payload: ResearchCompareRequest,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchCompareResponse:
    try:
        data = research_service.compare_collection(
            db,
            user_id=user_id,
            collection_id=collection_id,
            focus=payload.focus,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchCompareResponse(**data)


@router.get("/integrations/zotero/config", response_model=ResearchZoteroConfigResponse)
def get_zotero_config(
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchZoteroConfigResponse:
    return ResearchZoteroConfigResponse(**research_service.get_zotero_config())


@router.post("/integrations/zotero/import", response_model=ResearchZoteroImportResponse)
def import_zotero_collection(
    payload: ResearchZoteroImportRequest,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchZoteroImportResponse:
    try:
        data = research_service.import_zotero_collection(
            db,
            user_id=user_id,
            project_id=payload.project_id,
            collection_key=payload.collection_key,
            collection_name=payload.collection_name,
            library_type=payload.library_type,
            library_id=payload.library_id,
            api_key=payload.api_key,
            limit=payload.limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchZoteroImportResponse(
        project_id=data["project_id"],
        collection=ResearchCollectionResponse(**data["collection"]),
        imported=data["imported"],
        total_items=data.get("total_items", data["imported"]),
        imported_items=data.get("imported_items", data["imported"]),
        deduped_items=data.get("deduped_items", 0),
        linked_existing_papers=data.get("linked_existing_papers", 0),
        format=data.get("format"),
    )


@router.post("/integrations/zotero/import-local", response_model=ResearchZoteroImportResponse)
async def import_zotero_local_file(
    file: UploadFile = File(...),
    project_id: str | None = Form(default=None),
    collection_name: str | None = Form(default=None),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchZoteroImportResponse:
    try:
        content = await file.read()
        data = research_service.import_zotero_local_file(
            db,
            user_id=user_id,
            project_id=project_id,
            filename=file.filename or "zotero-import",
            content=content,
            collection_name=collection_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchZoteroImportResponse(
        project_id=data["project_id"],
        collection=ResearchCollectionResponse(**data["collection"]),
        imported=data["imported"],
        total_items=data["total_items"],
        imported_items=data["imported_items"],
        deduped_items=data["deduped_items"],
        linked_existing_papers=data["linked_existing_papers"],
        format=data["format"],
    )


@router.get("/tasks/{task_id}", response_model=ResearchTaskResponse)
def get_research_task(
    task_id: str,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchTaskResponse:
    try:
        data = research_service.get_task(db, user_id=user_id, task_id=task_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ResearchTaskResponse(**data)


@router.get("/tasks/{task_id}/canvas", response_model=ResearchCanvasResponse)
def get_canvas(
    task_id: str,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchCanvasResponse:
    try:
        data = research_service.get_canvas_state(db, user_id=user_id, task_id=task_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ResearchCanvasResponse(**data)


@router.put("/tasks/{task_id}/canvas", response_model=ResearchCanvasResponse)
def put_canvas(
    task_id: str,
    payload: ResearchCanvasRequest,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchCanvasResponse:
    try:
        data = research_service.save_canvas_state(
            db,
            user_id=user_id,
            task_id=task_id,
            state=payload.model_dump(),
        )
    except CanvasStateBusyError as exc:
        raise HTTPException(status_code=409, detail="画布正在和后台研究结果同步，系统会自动重试保存。") from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ResearchCanvasResponse(**data)


@router.post("/tasks/{task_id}/auto/start", response_model=ResearchAutoRunResponse)
def auto_start(
    task_id: str,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchAutoRunResponse:
    try:
        data = research_service.start_auto_research(db, user_id=user_id, task_id=task_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchAutoRunResponse(**data, message="已启动 OpenClaw Auto 运行。")


@router.get("/tasks/{task_id}/runs/{run_id}/events", response_model=ResearchRunEventsResponse)
def get_run_events(
    task_id: str,
    run_id: str,
    after_seq: int | None = Query(default=None, ge=0),
    limit: int = Query(default=200, ge=1, le=1000),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchRunEventsResponse:
    try:
        data = research_service.list_run_events(
            db,
            user_id=user_id,
            task_id=task_id,
            run_id=run_id,
            after_seq=after_seq,
            limit=limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ResearchRunEventsResponse(**data)


@router.post("/tasks/{task_id}/runs/{run_id}/guidance", response_model=ResearchRunGuidanceResponse)
def submit_guidance(
    task_id: str,
    run_id: str,
    payload: ResearchRunGuidanceRequest,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchRunGuidanceResponse:
    try:
        data = research_service.submit_run_guidance(
            db,
            user_id=user_id,
            task_id=task_id,
            run_id=run_id,
            text=payload.text,
            tags=payload.tags,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchRunGuidanceResponse(**data, message="已提交新的 checkpoint 引导。")


@router.post("/tasks/{task_id}/runs/{run_id}/continue", response_model=ResearchRunControlResponse)
def continue_auto_run(
    task_id: str,
    run_id: str,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchRunControlResponse:
    try:
        data = research_service.continue_auto_research(db, user_id=user_id, task_id=task_id, run_id=run_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchRunControlResponse(**data, message="自动研究已继续。")


@router.post("/tasks/{task_id}/runs/{run_id}/cancel", response_model=ResearchRunControlResponse)
def cancel_auto_run(
    task_id: str,
    run_id: str,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchRunControlResponse:
    try:
        data = research_service.cancel_auto_research(db, user_id=user_id, task_id=task_id, run_id=run_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchRunControlResponse(**data, message="自动研究已停止。")


@router.post("/tasks/{task_id}/plan", response_model=ResearchTaskPlanResponse)
def plan_task(
    task_id: str,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchTaskPlanResponse:
    try:
        task, queued, noop_reason = research_service.enqueue_plan(db, user_id=user_id, task_id=task_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    noop_reason, message = _queue_feedback(
        queued,
        submitted="方向规划已提交。",
        noop_reason=noop_reason,
        noop_messages={
            "directions_already_available": "当前任务已经有方向，可直接检索或继续探索。",
            "plan_already_pending": "方向规划已经在队列中，请稍后刷新。",
        },
    )
    return ResearchTaskPlanResponse(task_id=task.task_id, status=task.status.value, queued=queued, noop_reason=noop_reason, message=message)


@router.post("/tasks/{task_id}/search", response_model=ResearchTaskSearchEnqueueResponse)
def search_direction(
    task_id: str,
    payload: ResearchTaskSearchRequest,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchTaskSearchEnqueueResponse:
    try:
        research_service.switch_task(db, user_id=user_id, task_id=task_id)
        task, queued, noop_reason = research_service.enqueue_search(
            db,
            user_id=user_id,
            direction_index=payload.direction_index,
            top_n=payload.top_n,
            force_refresh=payload.force_refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    noop_reason, message = _queue_feedback(
        queued,
        submitted=f"已提交方向 {payload.direction_index} 的检索请求。",
        noop_reason=noop_reason,
        noop_messages={
            "direction_missing": "当前任务还没有这个方向，请先规划方向后再检索。",
            "search_already_pending": "当前已经有检索任务在队列中，请稍后刷新。",
        },
    )
    return ResearchTaskSearchEnqueueResponse(
        task_id=task.task_id,
        status=task.status.value,
        direction_index=payload.direction_index,
        queued=queued,
        force_refresh=payload.force_refresh,
        noop_reason=noop_reason,
        message=message,
    )


@router.post("/tasks/{task_id}/explore/start", response_model=ResearchExploreStartResponse)
def explore_start(
    task_id: str,
    payload: ResearchExploreStartRequest,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchExploreStartResponse:
    try:
        task, round_row = research_service.start_exploration(
            db,
            user_id=user_id,
            task_id=task_id,
            direction_index=payload.direction_index,
            top_n=payload.top_n,
            year_from=payload.year_from,
            year_to=payload.year_to,
            sources=payload.sources,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchExploreStartResponse(
        task_id=task.task_id,
        direction_index=payload.direction_index,
        round_id=round_row.id,
        status=task.status.value,
        queued=True,
        message=f"已为方向 {payload.direction_index} 创建探索轮次。",
    )


@router.post("/tasks/{task_id}/explore/rounds/{round_id}/propose", response_model=ResearchRoundProposeResponse)
def explore_round_propose(
    task_id: str,
    round_id: int,
    payload: ResearchRoundProposeRequest,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchRoundProposeResponse:
    try:
        data = research_service.propose_round_candidates(
            db,
            user_id=user_id,
            task_id=task_id,
            round_id=round_id,
            action=payload.action,
            feedback_text=payload.feedback_text,
            candidate_count=payload.candidate_count,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchRoundProposeResponse(**data)


@router.post("/tasks/{task_id}/explore/rounds/{round_id}/select", response_model=ResearchRoundSelectResponse)
def explore_round_select(
    task_id: str,
    round_id: int,
    payload: ResearchRoundSelectRequest,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchRoundSelectResponse:
    try:
        data = research_service.select_round_candidate(
            db,
            user_id=user_id,
            task_id=task_id,
            round_id=round_id,
            candidate_id=payload.candidate_id,
            top_n=payload.top_n,
            force_refresh=payload.force_refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchRoundSelectResponse(**data, message="已选择候选方向，准备进入下一轮。")


@router.post("/tasks/{task_id}/explore/rounds/{round_id}/next", response_model=ResearchRoundNextResponse)
def explore_round_next(
    task_id: str,
    round_id: int,
    payload: ResearchRoundNextRequest,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchRoundNextResponse:
    try:
        data = research_service.create_next_round_from_intent(
            db,
            user_id=user_id,
            task_id=task_id,
            round_id=round_id,
            intent_text=payload.intent_text,
            top_n=payload.top_n,
            force_refresh=payload.force_refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchRoundNextResponse(**data, message="已根据新的意图继续下一轮探索。")


@router.get("/tasks/{task_id}/explore/tree", response_model=ResearchExploreTreeResponse)
def explore_tree(
    task_id: str,
    include_papers: bool = Query(default=False),
    paper_limit: int | None = Query(default=None, ge=1, le=50),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchExploreTreeResponse:
    try:
        data = research_service.get_exploration_tree(
            db,
            user_id=user_id,
            task_id=task_id,
            include_papers=include_papers,
            paper_limit=paper_limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchExploreTreeResponse(task_id=task_id, nodes=data["nodes"], edges=data["edges"], stats=data["stats"])


@router.get("/tasks/{task_id}/papers", response_model=ResearchSearchResponse)
def get_direction_papers(
    task_id: str,
    direction_index: int = Query(..., ge=1),
    page: int = Query(default=1, ge=1),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchSearchResponse:
    try:
        research_service.switch_task(db, user_id=user_id, task_id=task_id)
        data = research_service.page_direction_papers(
            db,
            user_id=user_id,
            direction_index=direction_index,
            page=page,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchSearchResponse(**data)


@router.get("/tasks/{task_id}/papers/saved", response_model=ResearchSavedPaperListResponse)
def get_saved_papers(
    task_id: str,
    limit: int = Query(default=200, ge=1, le=1000),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchSavedPaperListResponse:
    try:
        data = research_service.list_saved_papers(
            db,
            user_id=user_id,
            task_id=task_id,
            limit=limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchSavedPaperListResponse(**data)


@router.post("/tasks/{task_id}/papers/compare", response_model=ResearchCompareResponse)
def compare_task_papers(
    task_id: str,
    payload: ResearchCompareRequest,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchCompareResponse:
    try:
        data = research_service.compare_task_papers(
            db,
            user_id=user_id,
            task_id=task_id,
            paper_ids=payload.paper_ids,
            focus=payload.focus,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchCompareResponse(**data)


@router.get("/tasks/{task_id}/venues/metrics", response_model=ResearchVenueMetricsResponse)
def get_task_venue_metrics(
    task_id: str,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchVenueMetricsResponse:
    try:
        data = research_service.get_task_venue_metrics(
            db,
            user_id=user_id,
            task_id=task_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchVenueMetricsResponse(**data)


@router.get("/tasks/{task_id}/papers/{paper_id:path}/asset")
def get_paper_asset(
    task_id: str,
    paper_id: str,
    kind: str = Query(default="pdf"),
    disposition: str = Query(default="attachment"),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
):
    try:
        path = research_service.get_paper_asset_path(
            db,
            user_id=user_id,
            task_id=task_id,
            paper_token=paper_id,
            kind=kind,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    content_disposition_type = "inline" if disposition == "inline" else "attachment"
    return FileResponse(path=path, filename=Path(path).name, content_disposition_type=content_disposition_type)


@router.get("/tasks/{task_id}/papers/{paper_id:path}/asset/meta", response_model=ResearchPaperAssetResponse)
def get_paper_asset_meta(
    task_id: str,
    paper_id: str,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchPaperAssetResponse:
    try:
        data = research_service.get_paper_assets(
            db,
            user_id=user_id,
            task_id=task_id,
            paper_token=paper_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ResearchPaperAssetResponse(**data)


@router.post("/tasks/{task_id}/papers/{paper_id:path}/visual/build", response_model=ResearchPaperAssetResponse)
def rebuild_paper_visual(
    task_id: str,
    paper_id: str,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchPaperAssetResponse:
    try:
        data = research_service.rebuild_paper_visual_assets(
            db,
            user_id=user_id,
            task_id=task_id,
            paper_token=paper_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchPaperAssetResponse(**data)


@router.get("/tasks/{task_id}/papers/{paper_id:path}", response_model=ResearchPaperDetailResponse)
def get_paper_detail(
    task_id: str,
    paper_id: str,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchPaperDetailResponse:
    try:
        data = research_service.get_paper_detail(
            db,
            user_id=user_id,
            task_id=task_id,
            paper_token=paper_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchPaperDetailResponse(**data)


@router.get("/tasks/{task_id}/nodes/{node_id:path}/chat", response_model=ResearchNodeChatResponse)
def get_node_chat_history(
    task_id: str,
    node_id: str,
    thread_id: str | None = None,
    limit: int = 50,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchNodeChatResponse:
    try:
        data = research_service.get_node_chat_history(
            db,
            user_id=user_id,
            task_id=task_id,
            node_id=node_id,
            thread_id=thread_id,
            limit=limit,
        )
    except NodeChatBusyError as exc:
        raise HTTPException(status_code=409, detail="节点问答正在和后台研究结果同步，系统会自动重试或请稍后再问一次。") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchNodeChatResponse(**data)


@router.get("/tasks/{task_id}/chat/threads", response_model=ResearchChatThreadListResponse)
def list_task_chat_threads(
    task_id: str,
    limit: int = Query(default=30, ge=1, le=100),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchChatThreadListResponse:
    try:
        data = research_service.list_chat_threads(db, user_id=user_id, task_id=task_id, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchChatThreadListResponse(**data)


@router.post("/tasks/{task_id}/chat/threads", response_model=ResearchChatThreadResponse)
def create_task_chat_thread(
    task_id: str,
    payload: ResearchChatThreadCreateRequest,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchChatThreadResponse:
    try:
        data = research_service.create_chat_thread(db, user_id=user_id, task_id=task_id, title=payload.title)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchChatThreadResponse(**data)


@router.get("/tasks/{task_id}/chat/messages", response_model=ResearchChatMessageListResponse)
def list_task_chat_messages(
    task_id: str,
    thread_id: str = Query(...),
    limit: int = Query(default=100, ge=1, le=300),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchChatMessageListResponse:
    try:
        data = research_service.list_chat_messages(db, user_id=user_id, task_id=task_id, thread_id=thread_id, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchChatMessageListResponse(**data)


@router.post("/tasks/{task_id}/chat/attachments", response_model=ResearchChatAttachmentListResponse)
def upload_task_chat_attachment(
    task_id: str,
    file: UploadFile = File(...),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchChatAttachmentListResponse:
    try:
        data = research_service.upload_chat_attachment(
            db,
            user_id=user_id,
            task_id=task_id,
            filename=file.filename or "attachment",
            content=file.file.read(),
            mime_type=file.content_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchChatAttachmentListResponse(**data)


@router.post("/tasks/{task_id}/chat/stream")
def stream_task_chat(
    task_id: str,
    payload: ResearchTaskChatStreamRequest,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> StreamingResponse:
    try:
        _task_id, _thread_id, build_events = research_service.stream_task_chat(
            db,
            user_id=user_id,
            task_id=task_id,
            thread_id=payload.thread_id,
            message=payload.message,
            context_node_ids=payload.context_node_ids,
            attachment_ids=payload.attachment_ids,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    def event_stream():
        for event in build_events():
            event_type = str(event.get("type") or "message")
            yield _sse_event(event_type, event)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

@router.post("/tasks/{task_id}/nodes/{node_id:path}/chat", response_model=ResearchNodeChatResponse)
def chat_with_node(
    task_id: str,
    node_id: str,
    payload: ResearchNodeChatRequest,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchNodeChatResponse:
    try:
        data = research_service.chat_with_node(
            db,
            user_id=user_id,
            task_id=task_id,
            node_id=node_id,
            question=payload.question,
            thread_id=payload.thread_id,
            tags=payload.tags,
        )
    except NodeChatBusyError as exc:
        raise HTTPException(status_code=409, detail="节点问答正在和后台研究结果同步，系统会自动重试或请稍后再问一次。") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchNodeChatResponse(**data)


@router.post("/tasks/{task_id}/papers/{paper_id:path}/save", response_model=ResearchPaperSaveResponse)
def save_paper(
    task_id: str,
    paper_id: str,
    payload: ResearchPaperSaveRequest,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchPaperSaveResponse:
    try:
        data = research_service.save_paper(
            db,
            user_id=user_id,
            task_id=task_id,
            paper_token=paper_id,
            subdir=payload.subdir,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchPaperSaveResponse(**data)


@router.post("/tasks/{task_id}/papers/{paper_id:path}/summarize", response_model=ResearchPaperSummarizeResponse)
def summarize_paper(
    task_id: str,
    paper_id: str,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchPaperSummarizeResponse:
    try:
        data = research_service.enqueue_paper_summary(
            db,
            user_id=user_id,
            task_id=task_id,
            paper_token=paper_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchPaperSummarizeResponse(**data)


@router.get("/tasks/{task_id}/export", response_model=ResearchExportResponse)
def export_task(
    task_id: str,
    format: str = Query(default="md"),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchExportResponse:
    try:
        research_service.switch_task(db, user_id=user_id, task_id=task_id)
        path = research_service.export_task(db, user_id=user_id, fmt=format)
        exports = research_service.list_exports(db, user_id=user_id, task_id=task_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    latest = next((item for item in exports["items"] if item.get("output_path") == path), None)
    return ResearchExportResponse(
        task_id=task_id,
        format=format,
        path=path,
        filename=Path(path).name,
        download_url=latest.get("download_url") if latest else None,
    )


@router.get("/collections/{collection_id}/export", response_model=ResearchExportResponse)
def export_collection(
    collection_id: str,
    format: str = Query(default="bib"),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchExportResponse:
    try:
        path = research_service.export_collection(db, user_id=user_id, collection_id=collection_id, fmt=format)
        exports = research_service.list_collection_exports(db, user_id=user_id, collection_id=collection_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    latest = next((item for item in exports["items"] if item.get("output_path") == path), None)
    return ResearchExportResponse(
        collection_id=collection_id,
        format=format,
        path=path,
        filename=Path(path).name,
        download_url=latest.get("download_url") if latest else None,
    )


@router.get("/tasks/{task_id}/exports/{record_id}/download")
def download_task_export(
    task_id: str,
    record_id: int,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
):
    try:
        path = research_service.get_task_export_download_path(db, user_id=user_id, task_id=task_id, record_id=record_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(path=path, filename=Path(path).name)


@router.get("/collections/{collection_id}/exports/{record_id}/download")
def download_collection_export(
    collection_id: str,
    record_id: int,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
):
    try:
        path = research_service.get_collection_export_download_path(db, user_id=user_id, collection_id=collection_id, record_id=record_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(path=path, filename=Path(path).name)


@router.get("/tasks/{task_id}/exports", response_model=ResearchExportListResponse)
def list_task_exports(
    task_id: str,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchExportListResponse:
    try:
        data = research_service.list_exports(db, user_id=user_id, task_id=task_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchExportListResponse(**data)


@router.get("/collections/{collection_id}/exports", response_model=ResearchExportListResponse)
def list_collection_exports(
    collection_id: str,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchExportListResponse:
    try:
        data = research_service.list_collection_exports(db, user_id=user_id, collection_id=collection_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchExportListResponse(**data)


@router.post("/tasks/{task_id}/fulltext/build", response_model=ResearchFulltextBuildResponse)
def build_fulltext(
    task_id: str,
    force: bool = Query(default=False),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchFulltextBuildResponse:
    try:
        task, queued, noop_reason = research_service.enqueue_fulltext_build(
            db,
            user_id=user_id,
            task_id=task_id,
            force=force,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    noop_reason, message = _queue_feedback(
        queued,
        submitted="全文处理已提交。",
        noop_reason=noop_reason,
        noop_messages={
            "fulltext_already_pending": "全文处理已经在队列中，请稍后刷新。",
            "no_papers": "当前任务还没有论文，先完成检索后再处理全文。",
            "paper_missing": "当前没有找到对应论文，无法重试全文处理。",
        },
    )
    return ResearchFulltextBuildResponse(task_id=task.task_id, status=task.status.value, queued=queued, noop_reason=noop_reason, message=message)


@router.post("/tasks/{task_id}/fulltext/retry", response_model=ResearchFulltextBuildResponse)
def retry_fulltext(
    task_id: str,
    paper_ids: list[str] | None = None,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchFulltextBuildResponse:
    try:
        task, queued, noop_reason = research_service.enqueue_fulltext_build(
            db,
            user_id=user_id,
            task_id=task_id,
            force=True,
            paper_ids=paper_ids,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    noop_reason, message = _queue_feedback(
        queued,
        submitted="已提交全文重试请求。",
        noop_reason=noop_reason,
        noop_messages={
            "no_papers": "当前任务还没有论文，先完成检索后再处理全文。",
            "paper_missing": "当前没有找到对应论文，无法重试全文处理。",
        },
    )
    return ResearchFulltextBuildResponse(task_id=task.task_id, status=task.status.value, queued=queued, noop_reason=noop_reason, message=message)


@router.get("/tasks/{task_id}/fulltext/status", response_model=ResearchFulltextStatusResponse)
def fulltext_status(
    task_id: str,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchFulltextStatusResponse:
    try:
        data = research_service.get_fulltext_status(db, user_id=user_id, task_id=task_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchFulltextStatusResponse(**data)


@router.post("/tasks/{task_id}/papers/{paper_id:path}/pdf/upload")
async def upload_paper_pdf(
    task_id: str,
    paper_id: str,
    file: UploadFile = File(...),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> dict:
    data = await file.read()
    try:
        payload = research_service.upload_pdf_for_paper(
            db,
            user_id=user_id,
            task_id=task_id,
            paper_token=paper_id,
            filename=file.filename or f"{paper_id}.pdf",
            content=data,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"task_id": task_id, **payload}


@router.post("/tasks/{task_id}/graph/build", response_model=ResearchGraphBuildResponse)
def build_graph(
    task_id: str,
    payload: ResearchGraphBuildRequest,
    force: bool = Query(default=False),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchGraphBuildResponse:
    force_refresh = bool(force or payload.force_refresh)
    try:
        task, queued, noop_reason = research_service.enqueue_graph_build(
            db,
            user_id=user_id,
            task_id=task_id,
            direction_index=payload.direction_index,
            round_id=payload.round_id,
            view=payload.view,
            citation_sources=payload.citation_sources,
            seed_top_n=payload.seed_top_n,
            expand_limit_per_paper=payload.expand_limit_per_paper,
            force_refresh=payload.force_refresh,
            force=force_refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    noop_reason, message = _queue_feedback(
        queued,
        submitted="图谱构建已提交。",
        noop_reason=noop_reason,
        noop_messages={
            "graph_already_pending": "图谱构建已经在队列中，请稍后刷新。",
            "no_graph_seed": "当前任务还没有可用于构图的方向、轮次或论文。",
        },
    )
    return ResearchGraphBuildResponse(
        task_id=task.task_id,
        status=task.status.value,
        queued=queued,
        direction_index=payload.direction_index,
        round_id=payload.round_id,
        view=payload.view,
        noop_reason=noop_reason,
        message=message,
    )


@router.post("/tasks/{task_id}/explore/rounds/{round_id}/citation/build", response_model=ResearchGraphBuildResponse)
def build_round_citation_graph(
    task_id: str,
    round_id: int,
    payload: ResearchGraphBuildRequest,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchGraphBuildResponse:
    try:
        task, queued = research_service.enqueue_round_citation_build(
            db,
            user_id=user_id,
            task_id=task_id,
            round_id=round_id,
            seed_top_n=payload.seed_top_n,
            expand_limit_per_paper=payload.expand_limit_per_paper,
            citation_sources=payload.citation_sources,
            force_refresh=payload.force_refresh,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchGraphBuildResponse(
        task_id=task.task_id,
        status=task.status.value,
        queued=queued,
        direction_index=payload.direction_index,
        round_id=round_id,
        view="citation",
        message="已提交当前轮次的引用图构建。",
    )


@router.get("/tasks/{task_id}/graph", response_model=ResearchGraphResponse)
def get_graph(
    task_id: str,
    view: str = Query(default="citation"),
    direction_index: int | None = Query(default=None),
    round_id: int | None = Query(default=None),
    include_papers: bool = Query(default=False),
    paper_limit: int | None = Query(default=None, ge=1, le=50),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchGraphResponse:
    try:
        data = research_service.get_graph_snapshot(
            db,
            user_id=user_id,
            task_id=task_id,
            direction_index=direction_index,
            round_id=round_id,
            view=view,
            include_papers=include_papers,
            paper_limit=paper_limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchGraphResponse(**data)


@router.get("/tasks/{task_id}/graph/snapshots", response_model=ResearchGraphSnapshotListResponse)
def list_graph_snapshots(
    task_id: str,
    view: str | None = Query(default=None),
    limit: int = Query(default=10, ge=1, le=50),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchGraphSnapshotListResponse:
    try:
        data = research_service.list_graph_snapshots(
            db,
            user_id=user_id,
            task_id=task_id,
            view=view,
            limit=limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchGraphSnapshotListResponse(**data)


@router.get("/tasks/{task_id}/graph/view", response_class=HTMLResponse)
def graph_view(
    task_id: str,
    view: str = Query(default="citation"),
    direction_index: int | None = Query(default=None),
    round_id: int | None = Query(default=None),
    _user_id: int = Depends(get_current_user_id),
) -> HTMLResponse:
    direction_q = f"&direction_index={direction_index}" if direction_index is not None else ""
    round_q = f"&round_id={round_id}" if round_id is not None else ""
    view_q = f"&view={view}"
    html = f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>MemoMate Research Graph</title>
  <script src="https://cdn.jsdelivr.net/npm/cytoscape@3.31.2/dist/cytoscape.min.js"></script>
  <style>
    :root {{
      --bg: #f3f1ea;
      --panel: #fbfaf6;
      --ink: #262421;
      --muted: #6b655e;
      --edge: #8e877e;
      --topic: #176087;
      --direction: #1f8a70;
      --paper: #d97706;
    }}
    body {{ margin: 0; background: radial-gradient(circle at top, #fff9ee 0%, var(--bg) 60%); color: var(--ink); font-family: "Source Han Sans SC","Noto Sans SC",sans-serif; }}
    .wrap {{ display: grid; grid-template-columns: 1fr 340px; min-height: 100vh; }}
    #cy {{ min-height: 100vh; }}
    .panel {{ background: var(--panel); border-left: 1px solid #ddd4c8; padding: 14px; overflow: auto; }}
    .title {{ font-size: 18px; font-weight: 700; margin-bottom: 10px; }}
    .meta {{ color: var(--muted); font-size: 13px; margin-bottom: 8px; }}
    .item {{ margin-bottom: 12px; font-size: 13px; line-height: 1.5; word-break: break-word; }}
    .label {{ color: var(--muted); font-weight: 600; }}
    .search {{ width: 100%; border: 1px solid #d5cfc4; border-radius: 8px; padding: 8px 10px; font-size: 14px; box-sizing: border-box; margin-bottom: 10px; }}
  </style>
</head>
<body>
  <div class="wrap">
    <div id="cy"></div>
    <div class="panel">
      <div class="title">Research Graph</div>
      <input class="search" id="searchInput" placeholder="搜索标题/ID"/>
      <div class="meta" id="summary">加载中...</div>
      <div id="detail" class="item">点击节点查看详情</div>
    </div>
  </div>
  <script>
    const token = localStorage.getItem("memomate_access_token") || "";
    const api = `/api/v1/research/tasks/{task_id}/graph?` + `t=${{Date.now()}}{view_q}{direction_q}{round_q}`;
    fetch(api, {{ headers: token ? {{ Authorization: `Bearer ${{token}}` }} : {{}} }})
      .then(r => r.json())
      .then(data => {{
        document.getElementById("summary").innerText = `节点 ${{data.nodes.length}} | 边 ${{data.edges.length}} | 状态 ${{data.status}}`;
        const elements = [];
        data.nodes.forEach(n => elements.push({{ data: {{ id: n.id, label: n.label, type: n.type, year: n.year || "", source: n.source || "", fulltext: n.fulltext_status || "", direction: n.direction_index || "" }} }}));
        data.edges.forEach(e => elements.push({{ data: {{ source: e.source, target: e.target, edgeType: e.type, weight: e.weight || 1 }} }}));
        const cy = cytoscape({{
          container: document.getElementById('cy'),
          elements,
          layout: {{ name: 'cose', animate: false, fit: true, padding: 30 }},
          style: [
            {{ selector: 'node', style: {{ 'label': 'data(label)', 'font-size': 11, 'text-wrap':'wrap', 'text-max-width': 140, 'text-valign': 'center', 'text-halign':'center', 'background-color': '#888', 'color': '#1f1f1f', 'width': 20, 'height': 20 }} }},
            {{ selector: 'node[type=\"topic\"]', style: {{ 'background-color': 'var(--topic)', 'width': 38, 'height': 38, 'color':'#fff' }} }},
            {{ selector: 'node[type=\"direction\"]', style: {{ 'background-color': 'var(--direction)', 'width': 30, 'height': 30, 'color':'#fff' }} }},
            {{ selector: 'node[type=\"paper\"]', style: {{ 'background-color': 'var(--paper)' }} }},
            {{ selector: 'edge', style: {{ 'curve-style':'bezier', 'line-color':'var(--edge)', 'target-arrow-shape':'triangle', 'target-arrow-color':'var(--edge)', 'width': 1.5, 'opacity': 0.85 }} }},
            {{ selector: 'edge[edgeType=\"cited_by\"]', style: {{ 'line-style':'dashed' }} }},
            {{ selector: '.faded', style: {{ 'opacity': 0.12 }} }},
          ],
        }});
        cy.on('tap', 'node', (evt) => {{
          const d = evt.target.data();
          document.getElementById('detail').innerHTML = `
            <div class="item"><span class="label">ID:</span> ${{d.id}}</div>
            <div class="item"><span class="label">标题:</span> ${{d.label}}</div>
            <div class="item"><span class="label">类型:</span> ${{d.type}}</div>
            <div class="item"><span class="label">年份:</span> ${{d.year || "-"}}</div>
            <div class="item"><span class="label">来源:</span> ${{d.source || "-"}}</div>
            <div class="item"><span class="label">全文状态:</span> ${{d.fulltext || "-"}}</div>`;
          cy.elements().removeClass('faded');
          const neighborhood = evt.target.closedNeighborhood();
          cy.elements().not(neighborhood).addClass('faded');
        }});
        document.getElementById('searchInput').addEventListener('input', (e) => {{
          const q = (e.target.value || '').toLowerCase().trim();
          cy.elements().removeClass('faded');
          if (!q) return;
          cy.nodes().forEach(n => {{
            const hit = `${{n.data('label')}} ${{n.id()}}`.toLowerCase().includes(q);
            if (!hit) n.addClass('faded');
          }});
        }});
      }})
      .catch(err => {{
        document.getElementById("summary").innerText = "图谱加载失败";
        document.getElementById("detail").innerText = String(err);
      }});
  </script>
</body>
</html>"""
    return HTMLResponse(content=html)
