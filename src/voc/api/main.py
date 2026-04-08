"""FastAPI application factory."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from src.voc.api.middleware.errors import global_exception_handler
from src.voc.api.routes.health import router as health_router
from src.voc.api.routes.pipeline import router as pipeline_router
from src.voc.api.routes.query import router as query_router
from src.voc.api.routes.runs import router as runs_router
from src.voc.api.store import RunStore
from src.voc.app.orchestrator import VOCPipeline
from src.voc.generation.insight_gen import InsightGenerator
from src.voc.logging import setup_logging
from src.voc.processing.embedder import Embedder
from src.voc.processing.indexer import ChunkIndexer


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging(level="INFO")
    embedder = Embedder()
    indexer = ChunkIndexer()
    generator = InsightGenerator()
    app.state.pipeline = VOCPipeline(embedder=embedder, indexer=indexer, generator=generator)
    app.state.run_store = RunStore()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="VOC Intelligence API",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.add_exception_handler(Exception, global_exception_handler)
    app.include_router(health_router)
    app.include_router(pipeline_router)
    app.include_router(query_router)
    app.include_router(runs_router)
    return app


app = create_app()
