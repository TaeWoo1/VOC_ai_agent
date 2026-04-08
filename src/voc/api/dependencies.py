"""Dependency injection for FastAPI routes."""

from __future__ import annotations

from fastapi import Request

from src.voc.api.store import RunStore
from src.voc.app.orchestrator import VOCPipeline


def get_pipeline(request: Request) -> VOCPipeline:
    """Return the pipeline instance from app state."""
    return request.app.state.pipeline


def get_run_store(request: Request) -> RunStore:
    """Return the run store instance from app state."""
    return request.app.state.run_store
