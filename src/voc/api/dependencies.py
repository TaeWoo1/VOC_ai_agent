"""Dependency injection for FastAPI routes."""

from __future__ import annotations

from fastapi import Request

from src.voc.api.store import RunStore
from src.voc.app.monitoring import MonitoringService
from src.voc.app.orchestrator import VOCPipeline
from src.voc.app.sync_service import SyncService
from src.voc.persistence.repository import (
    EntityRepository,
    SnapshotRepository,
    SourceConnectionRepository,
    SyncJobRepository,
)


def get_pipeline(request: Request) -> VOCPipeline:
    """Return the pipeline instance from app state."""
    return request.app.state.pipeline


def get_run_store(request: Request) -> RunStore:
    """Return the run store instance from app state."""
    return request.app.state.run_store


def get_entity_repo(request: Request) -> EntityRepository:
    """Return the entity repository from app state."""
    return request.app.state.entity_repo


def get_monitoring_service(request: Request) -> MonitoringService:
    """Return the monitoring service instance from app state."""
    return request.app.state.monitoring


def get_sync_service(request: Request) -> SyncService:
    """Return the sync service instance from app state."""
    return request.app.state.sync_service


def get_job_repo(request: Request) -> SyncJobRepository:
    """Return the sync job repository from app state."""
    return request.app.state.job_repo


def get_snapshot_repo(request: Request) -> SnapshotRepository:
    """Return the snapshot repository from app state."""
    return request.app.state.snapshot_repo


def get_source_repo(request: Request) -> SourceConnectionRepository:
    """Return the source connection repository from app state."""
    return request.app.state.source_repo
