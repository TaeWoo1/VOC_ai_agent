"""Query endpoint — retrieval + generation path."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from src.voc.api.dependencies import get_pipeline, get_run_store
from src.voc.api.schemas import QueryRequest, QueryResponse, generate_run_id
from src.voc.api.store import RunStore
from src.voc.app.orchestrator import VOCPipeline
from src.voc.logging import run_id_var

router = APIRouter(prefix="/v1", tags=["query"])
logger = logging.getLogger(__name__)


@router.post("/query", response_model=QueryResponse, status_code=202)
async def query(
    request: QueryRequest,
    pipeline: VOCPipeline = Depends(get_pipeline),
    store: RunStore = Depends(get_run_store),
):
    """Query the VOC knowledge base for insights.

    Runs: retrieve relevant evidence → generate structured insight.
    Currently stubbed — returns not_implemented until retrieval + generation are wired.
    """
    rid = generate_run_id("qry")
    run_id_var.set(rid)

    logger.info("Query requested", extra={"question": request.question})

    result = await pipeline.query(
        question=request.question,
        run_id=rid,
        top_k=request.top_k,
        strategy=request.strategy,
        filters=request.filters,
    )

    response = QueryResponse(
        run_id=rid,
        status=result.status,
        question=request.question,
        insight=result.insight,
        retrieved_evidence=result.retrieved_evidence,
        retrieval_meta=result.retrieval_meta,
        message=result.message,
    )

    store.save(rid, response.model_dump())

    return response
