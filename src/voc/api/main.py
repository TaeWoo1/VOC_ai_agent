"""FastAPI application factory."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from src.voc.api.middleware.errors import global_exception_handler
from src.voc.api.routes.entities import router as entities_router
from src.voc.api.routes.health import router as health_router
from src.voc.api.routes.pipeline import router as pipeline_router
from src.voc.api.routes.query import router as query_router
from src.voc.api.routes.runs import router as runs_router
from src.voc.api.routes.sources import router as sources_router
from src.voc.api.routes.upload import router as upload_router
from src.voc.api.store import RunStore
from src.voc.app.monitoring import MonitoringService
from src.voc.app.orchestrator import VOCPipeline
from src.voc.app.sync_service import SyncService
from src.voc.config import get_settings
from src.voc.connectors.csv import CSVConnector
from src.voc.connectors.google_business import GoogleBusinessConnector
from src.voc.connectors.json_import import JsonImportConnector
from src.voc.connectors.mock import MockConnector
from src.voc.generation.insight_gen import InsightGenerator
from src.voc.logging import setup_logging
from src.voc.persistence.migrations import init_db
from src.voc.persistence.repository import (
    EntityRepository,
    SnapshotRepository,
    SourceConnectionRepository,
    SyncJobRepository,
)
from src.voc.processing.embedder import Embedder
from src.voc.processing.indexer import ChunkIndexer


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    setup_logging(level=settings.log_level)

    # Core engine components
    embedder = Embedder()
    indexer = ChunkIndexer()
    generator = InsightGenerator()

    # Connector registry
    connectors = {
        "mock": MockConnector,
        "csv": CSVConnector,
        "json_import": JsonImportConnector,
        "google_business": GoogleBusinessConnector,
    }
    pipeline = VOCPipeline(embedder=embedder, indexer=indexer, generator=generator, connectors=connectors)

    # Persistence
    db = init_db(settings.db_path)
    entity_repo = EntityRepository(db)
    job_repo = SyncJobRepository(db)
    snapshot_repo = SnapshotRepository(db)
    source_repo = SourceConnectionRepository(db)

    # Services
    monitoring = MonitoringService(pipeline=pipeline, entity_store=entity_repo, indexer=indexer)
    sync_service = SyncService(
        pipeline=pipeline,
        entity_repo=entity_repo,
        job_repo=job_repo,
        snapshot_repo=snapshot_repo,
        source_repo=source_repo,
        monitoring=monitoring,
    )

    # App state
    app.state.pipeline = pipeline
    app.state.run_store = RunStore()
    app.state.entity_repo = entity_repo
    app.state.job_repo = job_repo
    app.state.snapshot_repo = snapshot_repo
    app.state.source_repo = source_repo
    app.state.monitoring = monitoring
    app.state.sync_service = sync_service

    yield

    db.close()


def create_app() -> FastAPI:
    app = FastAPI(
        title="VOC Intelligence API",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.add_exception_handler(Exception, global_exception_handler)
    app.include_router(health_router)
    app.include_router(entities_router)
    app.include_router(pipeline_router)
    app.include_router(query_router)
    app.include_router(runs_router)
    app.include_router(sources_router)
    app.include_router(upload_router)
    return app


app = create_app()
