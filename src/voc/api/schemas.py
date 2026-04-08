"""API request/response schemas and run_id generation."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from pydantic import BaseModel, Field


def generate_run_id(prefix: str = "run") -> str:
    """Generate a unique run ID: {prefix}_{YYYYMMDD}_{HHMMSS}_{uuid6}."""
    now = datetime.now(timezone.utc)
    short_uuid = uuid.uuid4().hex[:6]
    return f"{prefix}_{now:%Y%m%d_%H%M%S}_{short_uuid}"


class HealthResponse(BaseModel):
    status: str
    version: str
    timestamp: str


class PipelineRequest(BaseModel):
    keyword: str
    connector: str = "mock"
    max_results: int = Field(default=100, ge=1, le=1000)


class StageStatus(BaseModel):
    name: str
    status: str
    count: int
    duration_ms: float
    errors: list[str] = Field(default_factory=list)


class IngestResponse(BaseModel):
    run_id: str
    overall_status: str
    stages: list[StageStatus]
    counts: dict[str, int]


class RunRecord(BaseModel):
    run_id: str
    overall_status: str
    stages: list[StageStatus]
    counts: dict[str, int]
    created_at: str


class QueryRequest(BaseModel):
    question: str
    top_k: int = Field(default=10, ge=1, le=50)
    strategy: str = "naive"
    filters: dict[str, str] = Field(default_factory=dict)


class QueryResponse(BaseModel):
    run_id: str
    status: str  # "completed" | "not_implemented" | "failed"
    question: str
    insight: dict | None = None  # TODO: VOCInsight dict when generation is implemented
    retrieved_evidence: list[dict] = Field(default_factory=list)  # TODO: RetrievedChunk dicts
    retrieval_meta: dict = Field(default_factory=dict)  # TODO: top_score, chunks_retrieved
    message: str | None = None
