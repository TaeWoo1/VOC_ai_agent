"""Canonical review schema — normalized, validated, tenant-tagged.

Created by:  ingestion.normalizer
Modified by: ingestion.dedup (is_duplicate, duplicate_of)
Consumed by: ingestion.evidence, processing.chunker, eval.dataset
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class CanonicalReview(BaseModel):

    # --- Identity ---
    review_id: str  # TODO: source-stable hash when source_id exists, content-addressed fallback
    tenant_id: str = "default"

    # --- Source provenance ---
    source_channel: str  # "mock" | "naver" | "csv"
    source_domain: str  # TODO: derive in normalizer from source_url or channel fallback map
    source_id: str | None = None
    source_url: str | None = None

    # --- Normalized content ---
    text: str  # NFC normalized, whitespace collapsed, casing preserved
    rating_normalized: float | None = Field(default=None, ge=0.0, le=1.0)  # 0.0-1.0 scale
    author: str | None = None
    review_date: date | None = None  # TODO: handle Korean date formats in normalizer
    language: Literal["ko", "en", "unknown"]  # TODO: raw_language > Hangul heuristic > "unknown"

    # --- Deduplication ---
    content_fingerprint: str  # TODO: language-agnostic (NFC + lower + strip + collapse ws) -> sha256
    is_duplicate: bool = False  # Set by dedup module
    duplicate_of: str | None = None

    # --- Context ---
    product_keyword: str
    collected_at: datetime  # From RawReview
    ingested_at: datetime  # Set by normalizer
    metadata: dict[str, Any] = Field(default_factory=dict)  # Pass-through, debugging only
