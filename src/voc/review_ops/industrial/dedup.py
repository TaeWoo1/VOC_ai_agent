"""Within-batch deduplication by content fingerprint (first-seen wins).

Mirrors the logic of ``src.voc.ingestion.dedup`` but operates on the pilot's own
``IndustrialReview`` model. Flags duplicates; does not remove them — the report
builder decides what to display.
"""

from __future__ import annotations

from src.voc.review_ops.industrial.schema import IndustrialReview


def dedup(reviews: list[IndustrialReview]) -> list[IndustrialReview]:
    """Flag duplicates by content_fingerprint. Same order, same length."""
    seen: dict[str, str] = {}  # fingerprint -> review_id of first occurrence

    for review in reviews:
        review.is_duplicate = False
        review.duplicate_of = None
        if review.content_fingerprint in seen:
            review.is_duplicate = True
            review.duplicate_of = seen[review.content_fingerprint]
        else:
            seen[review.content_fingerprint] = review.review_id

    return reviews
