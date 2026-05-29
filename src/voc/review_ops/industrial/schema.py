"""Data models for the industrial review-ops pilot.

Self-contained on purpose: this does NOT reuse ``CanonicalReview`` because that
model's ``source_channel`` is a closed ``Literal`` of K-beauty channels and it
carries K-beauty ``channel_meta`` unions. Industrial reviews arrive from
arbitrary commerce channels (네이버 / 쿠팡 / 11번가 / 자사몰 / ...), so ``channel``
here is a free string.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class IndustrialReview(BaseModel):
    """One normalized review row from an uploaded industrial-commerce CSV."""

    model_config = ConfigDict(extra="ignore")

    review_id: str
    channel: str  # free string — "네이버", "쿠팡", "자사몰", ...
    text: str
    content_fingerprint: str
    product_name: str | None = None
    option_name: str | None = None
    rating: float | None = None  # original 1–5 scale, not normalized
    author: str | None = None
    review_date: date | None = None
    language: str = "unknown"
    has_reply: bool = False
    source_id: str | None = None
    is_duplicate: bool = False
    duplicate_of: str | None = None


@dataclass
class WorklistRow:
    """One row of the operator worklist ("이번 주 운영자가 볼 리뷰")."""

    review_id: str
    review_date: date | None
    channel: str
    product_name: str | None
    option_name: str | None
    rating: float | None
    text: str
    tags: list[str] = field(default_factory=list)        # category ids
    tag_labels: list[str] = field(default_factory=list)  # Korean labels for chips
    reason: str = ""            # 왜 봐야 하나요
    suggested_action: str = ""  # 다음 조치
    tier: str = "week"          # "today" | "week"
    _severity: int = 0          # internal ranking key


@dataclass
class HeaderStats:
    """Short header stats — kept intentionally minimal (worklist comes first)."""

    total_reviews: int = 0
    by_channel: dict[str, int] = field(default_factory=dict)
    rating_distribution: dict[str, int] = field(default_factory=dict)  # "5".."1", "미상"


@dataclass
class IndustrialReport:
    """The full report model consumed by the HTML renderer."""

    title: str
    subtitle: str
    caveat: str
    generated_at: datetime
    header: HeaderStats
    density_note: str | None = None  # sample-only framing; None for real data
    worklist: list[WorklistRow] = field(default_factory=list)
    appendix: list[IndustrialReview] = field(default_factory=list)
