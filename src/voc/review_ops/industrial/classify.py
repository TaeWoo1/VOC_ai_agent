"""Rule-based multi-label classifier (no LLM).

Matches taxonomy keywords against review text via case-insensitive substring
containment. Korean is matched directly; English keywords match lowercased.

``needs_reply`` is special: it only fires when a question-style keyword is
present AND the review has no existing brand reply — an already-answered
question does not need another reply.
"""

from __future__ import annotations

from src.voc.review_ops.industrial.schema import IndustrialReview
from src.voc.review_ops.industrial.taxonomy import CATEGORIES


def _matches(text_lower: str, keywords: tuple[str, ...]) -> bool:
    return any(kw.lower() in text_lower for kw in keywords)


def classify(review: IndustrialReview) -> list[str]:
    """Return matched category ids, in taxonomy priority order."""
    text_lower = review.text.lower()
    tags: list[str] = []
    for cat in CATEGORIES:
        if not _matches(text_lower, cat.keywords):
            continue
        if cat.id == "needs_reply" and review.has_reply:
            continue
        tags.append(cat.id)
    return tags
