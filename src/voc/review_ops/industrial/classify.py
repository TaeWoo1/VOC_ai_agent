"""Rule-based multi-label classifier (no LLM).

Matches taxonomy keywords against review text via case-insensitive substring
containment. Korean is matched directly; English keywords match lowercased.

Two small, deterministic guards keep positive/neutral reviews off the problem
worklist (this is NOT a general NLP engine — just bounded checks):

1. Negation guard (risk categories only): a matched risk keyword is ignored if
   a negation cue sits immediately around it — "없이"/"없어"/"없네"/"없습니다"
   just after ("파손 없이 잘 왔어요"), or a standalone "안" just before
   ("안 떨어져요"). Positive and signal tags are never suppressed.
2. ``needs_reply`` only fires when the review has no existing brand reply.
"""

from __future__ import annotations

import re

from src.voc.review_ops.industrial.schema import IndustrialReview
from src.voc.review_ops.industrial.taxonomy import CATEGORIES

# Negation cue just AFTER a risk keyword: 없이 / 없어 / 없네 / 없습니다 / 없음 / 없다.
_NEG_AFTER_CUE = "없"
_NEG_AFTER_WINDOW = 5
# Standalone "안" just BEFORE a risk keyword (negation), e.g. "안 떨어져요".
_NEG_BEFORE_RE = re.compile(r"(?:^|\s)안\s*$")


def _negated(text_lower: str, start: int, end: int) -> bool:
    """True if a negation cue sits just after or just before the matched span."""
    if _NEG_AFTER_CUE in text_lower[end : end + _NEG_AFTER_WINDOW]:
        return True
    return bool(_NEG_BEFORE_RE.search(text_lower[:start]))


def _matches(text_lower: str, keywords: tuple[str, ...], *, guard_negation: bool) -> bool:
    """A keyword hits if it occurs un-negated at least once.

    With ``guard_negation`` (risk categories), an occurrence wrapped in a
    negation cue does not count; the search continues to later occurrences.
    """
    for kw in keywords:
        kw_l = kw.lower()
        idx = text_lower.find(kw_l)
        while idx != -1:
            if not (guard_negation and _negated(text_lower, idx, idx + len(kw_l))):
                return True
            idx = text_lower.find(kw_l, idx + 1)
    return False


def classify(review: IndustrialReview) -> list[str]:
    """Return matched category ids, in taxonomy priority order."""
    text_lower = review.text.lower()
    tags: list[str] = []
    for cat in CATEGORIES:
        if not _matches(text_lower, cat.keywords, guard_negation=(cat.kind == "risk")):
            continue
        if cat.id == "needs_reply" and review.has_reply:
            continue
        tags.append(cat.id)
    return tags
