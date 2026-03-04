from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.api.mobile import get_current_user_id
from app.domain.schemas import (
    ResearchExportResponse,
    ResearchSearchResponse,
    ResearchTaskCreateRequest,
    ResearchTaskListResponse,
    ResearchTaskResponse,
    ResearchTaskSearchRequest,
)
from app.infra.db import get_db
from app.services.research_service import ResearchService


router = APIRouter(prefix="/api/v1/research")


def get_research_service(request: Request) -> ResearchService:
    return request.app.state.research_service


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
    row = research_service.create_task(db, user_id=user_id, topic=payload.topic, constraints=constraints)
    data = research_service.get_task(db, user_id=user_id, task_id=row.task_id)
    return ResearchTaskResponse(**data)


@router.get("/tasks", response_model=ResearchTaskListResponse)
def list_research_tasks(
    limit: int = Query(default=10, ge=1, le=50),
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> ResearchTaskListResponse:
    items = research_service.list_tasks(db, user_id=user_id, limit=limit)
    return ResearchTaskListResponse(items=[ResearchTaskResponse(**x) for x in items], total=len(items))


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


@router.post("/tasks/{task_id}/search")
def search_direction(
    task_id: str,
    payload: ResearchTaskSearchRequest,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    research_service: ResearchService = Depends(get_research_service),
) -> dict[str, str | int]:
    try:
        research_service.switch_task(db, user_id=user_id, task_id=task_id)
        task = research_service.enqueue_search(
            db,
            user_id=user_id,
            direction_index=payload.direction_index,
            top_n=payload.top_n,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"task_id": task.task_id, "status": task.status.value, "direction_index": payload.direction_index}


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
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ResearchExportResponse(task_id=task_id, format=format, path=path)
