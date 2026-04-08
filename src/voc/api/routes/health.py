"""Health check endpoints."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter

from fastapi import Request

from src.voc.api.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health(request: Request):
    return HealthResponse(
        status="ok",
        version=request.app.version,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@router.get("/health/ready", response_model=HealthResponse)
async def health_ready(request: Request):
    return HealthResponse(
        status="ready",
        version=request.app.version,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )
