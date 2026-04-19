"""API request/response schemas and run_id generation."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Literal

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


class EntityCreateRequest(BaseModel):
    display_name: str
    entity_type: Literal["product", "store", "business"] = "product"
    entity_id: str | None = None
    description: str = ""
    product_keywords: list[str] = Field(min_length=1)
    connector: str = "mock"
    metadata: dict[str, Any] = Field(default_factory=dict)


class EntityResponse(BaseModel):
    entity_id: str
    entity_type: Literal["product", "store", "business"]
    tenant_id: str
    display_name: str
    description: str
    product_keywords: list[str]
    connector: str
    created_at: datetime
    last_refreshed_at: datetime | None
    refresh_count: int
    metadata: dict[str, Any]


class EntityListResponse(BaseModel):
    entities: list[EntityResponse]


class RefreshRequest(BaseModel):
    max_results: int = Field(default=100, ge=1, le=1000)


class RefreshResponse(BaseModel):
    entity_id: str
    job_id: str
    status: str  # "accepted" (non-blocking dispatch)


class SyncJobResponse(BaseModel):
    job_id: str
    entity_id: str
    job_type: str
    status: str  # pending/running/completed/partial/failed
    started_at: str
    finished_at: str | None = None
    total_collected: int = 0
    total_indexed: int = 0
    stages: list[dict] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class SnapshotResponse(BaseModel):
    snapshot_id: str
    entity_id: str
    job_id: str | None = None
    captured_at: str
    total_reviews: int | None = None
    avg_rating: float | None = None
    negative_count: int | None = None
    low_rating_ratio: float | None = None
    channels: list[str] = Field(default_factory=list)
    summary_text: str | None = None
    dashboard: dict | None = None


# --- Source connection DTOs ---


class SourceConnectionCreate(BaseModel):
    connector_type: str  # "csv", "mock", future: "naver_commerce", "google_business"
    source_type: Literal["owned", "public"] = "owned"
    display_name: str
    config: dict[str, Any] = Field(default_factory=dict)
    capabilities: dict[str, Any] = Field(default_factory=dict)


class SourceConnectionUpdate(BaseModel):
    display_name: str | None = None
    status: str | None = None  # "active" / "inactive"
    config: dict[str, Any] | None = None


class SourceConnectionResponse(BaseModel):
    connection_id: str
    entity_id: str
    connector_type: str
    source_type: str
    display_name: str
    status: str  # active/inactive/error
    config: dict[str, Any] = Field(default_factory=dict)
    capabilities: dict[str, Any] = Field(default_factory=dict)
    last_synced_at: str | None = None
    error_message: str | None = None
    created_at: str


# --- Source validation DTOs ---


class ValidationCheckResponse(BaseModel):
    name: str
    passed: bool
    detail: str = ""


class SourceValidationResponse(BaseModel):
    connection_id: str
    connector_type: str
    status: str  # current source_connection status
    readiness: str  # ready/manual_ready/config_incomplete/auth_missing/file_missing/not_implemented
    checks: list[ValidationCheckResponse] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    next_steps: list[str] = Field(default_factory=list)
    sync_mode: str = "unknown"  # manual/api/auto/unknown
    requires_upload: bool = False


# --- Monitoring DTOs (operator-facing) ---


class ReviewStats(BaseModel):
    total_reviews: int
    total_chunks: int
    avg_rating: float | None
    negative_count: int
    low_rating_ratio: float
    channels: list[str]


class ActionItem(BaseModel):
    priority: int
    issue: str
    why_urgent: str
    suggested_action: str
    evidence_ids: list[str]


class RecurringIssue(BaseModel):
    issue: str
    frequency: Literal["high", "medium", "low"]
    sentiment: Literal["negative", "mixed"]
    evidence_ids: list[str]


class FlaggedReview(BaseModel):
    reason: str
    review_text_snippet: str
    rating: float | None
    evidence_ids: list[str]


class MonitoringDashboard(BaseModel):
    entity_id: str
    display_name: str
    entity_type: Literal["product", "store", "business"]
    last_refreshed_at: datetime | None
    refresh_count: int
    review_stats: ReviewStats
    monitoring_summary: str
    what_to_fix_first: list[ActionItem]
    recurring_issues: list[RecurringIssue]
    reviews_needing_attention: list[FlaggedReview]
    generated_at: datetime


class MonitoringIssues(BaseModel):
    entity_id: str
    what_to_fix_first: list[ActionItem]
    recurring_issues: list[RecurringIssue]
    generated_at: datetime


class MonitoringSummary(BaseModel):
    entity_id: str
    monitoring_summary: str
    review_stats: ReviewStats
    generated_at: datetime


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
