"""Raw review schema — unprocessed data as received from connectors.

HYBRID: Structure scaffolded. Field semantics and validation rules are SELF.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel


class RawReview(BaseModel):
    """Raw review exactly as received from a connector, before any normalization.

    TODO: Finalize field semantics — which fields are truly optional vs required
    TODO: Decide whether raw_metadata should have a stricter shape per source_channel
    TODO: Consider adding raw_title for sources that separate title from body
    """

    source_channel: Literal["naver", "csv", "mock"]
    source_id: str | None = None
    source_url: str | None = None
    raw_text: str
    raw_rating: float | int | None = None
    raw_author: str | None = None
    raw_date: str | None = None  # Unparsed date string (may be Korean: "2024년 3월")
    raw_language: str | None = None  # Declared or detected language ("ko", "en", or None)
    raw_metadata: dict[str, Any] = {}  # Source-specific fields preserved verbatim
    collected_at: datetime
    keyword_used: str
    tenant_id: str = "default"
