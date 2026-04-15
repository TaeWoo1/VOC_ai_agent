"""Entity CRUD endpoints — register and manage monitoring targets."""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from src.voc.api.dependencies import (
    get_entity_repo,
    get_job_repo,
    get_monitoring_service,
    get_snapshot_repo,
    get_sync_service,
)
from src.voc.api.schemas import (
    EntityCreateRequest,
    EntityListResponse,
    EntityResponse,
    MonitoringDashboard,
    MonitoringIssues,
    MonitoringSummary,
    RefreshRequest,
    RefreshResponse,
    SnapshotResponse,
    SyncJobResponse,
    generate_run_id,
)
from src.voc.app.monitoring import EntityNotFoundError, MonitoringService
from src.voc.app.sync_service import SyncService
from src.voc.persistence.repository import (
    EntityRepository,
    SnapshotRepository,
    SyncJobRepository,
)
from src.voc.schemas.entity import Entity

router = APIRouter(prefix="/v1/entities", tags=["entities"])
logger = logging.getLogger(__name__)


def _generate_entity_id(display_name: str) -> str:
    """Derive a short slug from the display name."""
    return hashlib.sha256(display_name.encode("utf-8")).hexdigest()[:12]


# --- Entity CRUD ---


@router.post("", response_model=EntityResponse, status_code=201)
async def create_entity(
    request: EntityCreateRequest,
    repo: EntityRepository = Depends(get_entity_repo),
):
    entity_id = request.entity_id or _generate_entity_id(request.display_name)

    if repo.get(entity_id) is not None:
        raise HTTPException(status_code=409, detail=f"Entity '{entity_id}' already exists")

    entity = Entity(
        entity_id=entity_id,
        entity_type=request.entity_type,
        display_name=request.display_name,
        description=request.description,
        product_keywords=request.product_keywords,
        connector=request.connector,
        created_at=datetime.now(timezone.utc),
        metadata=request.metadata,
    )

    repo.save(entity_id, entity.model_dump(mode="json"))
    logger.info("Entity registered", extra={"entity_id": entity_id})

    return entity


@router.get("", response_model=EntityListResponse)
async def list_entities(
    tenant_id: str = "default",
    repo: EntityRepository = Depends(get_entity_repo),
):
    return EntityListResponse(entities=repo.list_all(tenant_id=tenant_id))


@router.get("/{entity_id}", response_model=EntityResponse)
async def get_entity(
    entity_id: str,
    repo: EntityRepository = Depends(get_entity_repo),
):
    entity = repo.get(entity_id)
    if entity is None:
        raise HTTPException(status_code=404, detail=f"Entity '{entity_id}' not found")
    return entity


@router.delete("/{entity_id}", status_code=204)
async def delete_entity(
    entity_id: str,
    repo: EntityRepository = Depends(get_entity_repo),
):
    if not repo.delete(entity_id):
        raise HTTPException(status_code=404, detail=f"Entity '{entity_id}' not found")


# --- Refresh (non-blocking via BackgroundTasks) ---


@router.post("/{entity_id}/refresh", response_model=RefreshResponse, status_code=202)
async def refresh_entity(
    entity_id: str,
    background_tasks: BackgroundTasks,
    request: RefreshRequest | None = None,
    repo: EntityRepository = Depends(get_entity_repo),
    job_repo: SyncJobRepository = Depends(get_job_repo),
    sync_service: SyncService = Depends(get_sync_service),
):
    """Refresh reviews for a monitoring target (non-blocking)."""
    if request is None:
        request = RefreshRequest()

    entity = repo.get(entity_id)
    if entity is None:
        raise HTTPException(status_code=404, detail=f"Entity '{entity_id}' not found")

    job_id = generate_run_id("refresh")
    job_repo.create(job_id, entity_id, job_type="refresh", status="pending")

    background_tasks.add_task(
        sync_service.execute_refresh,
        entity_id=entity_id,
        job_id=job_id,
        max_results=request.max_results,
    )

    return RefreshResponse(
        entity_id=entity_id,
        job_id=job_id,
        status="accepted",
    )


# --- Sync jobs ---


@router.get("/{entity_id}/jobs", response_model=list[SyncJobResponse])
async def list_jobs(
    entity_id: str,
    job_type: str | None = None,
    limit: int = 20,
    repo: EntityRepository = Depends(get_entity_repo),
    job_repo: SyncJobRepository = Depends(get_job_repo),
):
    """List sync jobs for an entity."""
    if repo.get(entity_id) is None:
        raise HTTPException(status_code=404, detail=f"Entity '{entity_id}' not found")
    return job_repo.list_by_entity(entity_id, job_type=job_type, limit=limit)


@router.get("/{entity_id}/jobs/{job_id}", response_model=SyncJobResponse)
async def get_job(
    entity_id: str,
    job_id: str,
    job_repo: SyncJobRepository = Depends(get_job_repo),
):
    """Poll a specific sync job status."""
    job = job_repo.get(job_id)
    if job is None or job["entity_id"] != entity_id:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
    return job


# --- Snapshots ---


@router.get("/{entity_id}/snapshots", response_model=list[SnapshotResponse])
async def list_snapshots(
    entity_id: str,
    limit: int = 20,
    repo: EntityRepository = Depends(get_entity_repo),
    snapshot_repo: SnapshotRepository = Depends(get_snapshot_repo),
):
    """List historical monitoring snapshots for an entity."""
    if repo.get(entity_id) is None:
        raise HTTPException(status_code=404, detail=f"Entity '{entity_id}' not found")
    return snapshot_repo.list_by_entity(entity_id, limit=limit)


# --- Monitoring endpoints ---


@router.get("/{entity_id}/monitoring", response_model=MonitoringDashboard)
async def get_monitoring_dashboard(
    entity_id: str,
    service: MonitoringService = Depends(get_monitoring_service),
):
    """Operator monitoring dashboard for a registered entity."""
    try:
        return await service.get_dashboard(entity_id)
    except EntityNotFoundError:
        raise HTTPException(status_code=404, detail=f"Entity '{entity_id}' not found")


@router.get("/{entity_id}/issues", response_model=MonitoringIssues)
async def get_monitoring_issues(
    entity_id: str,
    service: MonitoringService = Depends(get_monitoring_service),
):
    """Priority issues and recurring problems for a registered entity."""
    try:
        return await service.get_issues(entity_id)
    except EntityNotFoundError:
        raise HTTPException(status_code=404, detail=f"Entity '{entity_id}' not found")


@router.get("/{entity_id}/summary", response_model=MonitoringSummary)
async def get_monitoring_summary(
    entity_id: str,
    service: MonitoringService = Depends(get_monitoring_service),
):
    """Quick monitoring summary and review stats for a registered entity."""
    try:
        return await service.get_summary(entity_id)
    except EntityNotFoundError:
        raise HTTPException(status_code=404, detail=f"Entity '{entity_id}' not found")
