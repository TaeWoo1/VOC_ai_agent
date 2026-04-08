"""Pipeline execution endpoints."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from src.voc.api.dependencies import get_pipeline, get_run_store
from src.voc.api.schemas import (
    IngestResponse,
    PipelineRequest,
    StageStatus,
    generate_run_id,
)
from src.voc.api.store import RunStore
from src.voc.app.orchestrator import VOCPipeline
from src.voc.logging import run_id_var

router = APIRouter(prefix="/v1/pipeline", tags=["pipeline"])
logger = logging.getLogger(__name__)


@router.post("/run", response_model=IngestResponse, status_code=202)
async def run_pipeline(
    request: PipelineRequest,
    pipeline: VOCPipeline = Depends(get_pipeline),
    store: RunStore = Depends(get_run_store),
):
    """Run the VOC ingestion pipeline: collect → normalize → dedup → split → chunk."""
    rid = generate_run_id("pipe")
    run_id_var.set(rid)

    logger.info("Pipeline run requested", extra={"keyword": request.keyword})

    result = await pipeline.ingest(
        keyword=request.keyword,
        run_id=rid,
        connector_name=request.connector,
        max_results=request.max_results,
    )

    response = IngestResponse(
        run_id=result.run_id,
        overall_status=result.status,
        stages=[
            StageStatus(
                name=s.name,
                status=s.status,
                count=s.count,
                duration_ms=s.duration_ms,
                errors=s.errors,
            )
            for s in result.stages
        ],
        counts=result.counts,
    )

    store.save(rid, response.model_dump())

    return response
