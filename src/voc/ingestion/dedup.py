"""Deduplication — exact content_fingerprint matching within a batch.

Within-batch only. Does not query external stores.
Flags duplicates but does not filter them — caller decides.
First-seen occurrence of each fingerprint is canonical.
"""

from __future__ import annotations

from src.voc.schemas.canonical import CanonicalReview


def dedup(reviews: list[CanonicalReview]) -> list[CanonicalReview]:
    """Flag duplicate reviews by content_fingerprint. First-seen wins.

    - Same order, same length as input.
    - Sets is_duplicate=True and duplicate_of=review_id on later occurrences.
    - Resets all is_duplicate/duplicate_of before processing (ignores pre-set values).
    - Cross-channel duplicates are detected (fingerprint is channel-agnostic).
    - Provenance fields on flagged duplicates are preserved.
    """
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
