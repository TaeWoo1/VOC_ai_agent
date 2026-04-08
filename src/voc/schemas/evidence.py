"""Evidence unit schema and segmenter interface.

Created by:  ingestion.evidence (using a SentenceSegmenter implementation)
Consumed by: processing.chunker, retrieval, eval.dataset
"""

from __future__ import annotations

from datetime import date
from typing import Protocol

from pydantic import BaseModel


class EvidenceUnit(BaseModel):
    """Atomic unit of evidence for retrieval and citation."""

    evidence_id: str  # TODO: f"{review_id}_{unit_index:03d}"
    review_id: str
    text: str
    unit_index: int  # 0-based position in parent review
    char_start: int  # Offset in parent CanonicalReview.text
    char_end: int  # Invariant: text == parent.text[char_start:char_end]

    # Denormalized from parent — needed for retrieval metadata filters
    language: str
    source_channel: str
    product_keyword: str
    rating_normalized: float | None = None
    review_date: date | None = None


class SentenceSegmenter(Protocol):
    """Replaceable interface for splitting text into spans.

    Concrete implementations (heuristic, KSS wrapper, etc.)
    belong in ingestion/evidence.py.
    """

    def segment(self, text: str, language: str) -> list[tuple[str, int, int]]:
        """Split text into (segment_text, char_start, char_end) spans.

        TODO: spans must be non-overlapping, ordered by char_start
        TODO: exclude empty/whitespace-only spans
        TODO: apply configurable minimum length; merge short spans in implementation
        """
        ...
