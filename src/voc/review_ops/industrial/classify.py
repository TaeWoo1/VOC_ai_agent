"""Rule-based multi-label classifier (no LLM).

Matches taxonomy keywords against review text via case-insensitive substring
containment. Korean is matched directly; English keywords match lowercased.

Two small, deterministic guards keep positive/neutral reviews off the problem
worklist (this is NOT a general NLP engine — just bounded checks):

1. Negation guard (risk categories only): a matched risk keyword is ignored if
   a negation cue sits around it — a bounded particle/adverb chain ending in
   "없"/"~지 않" just after ("파손은 전혀 없고", "파손되지 않았어요"), a 없/않 within
   3 chars ("헐거움 없이"), or a standalone "안" just before ("안 떨어져요").
   Positive and signal tags are never suppressed.
2. ``needs_reply`` only fires when the review has no existing brand reply.
"""

from __future__ import annotations

import re

from src.voc.review_ops.industrial.schema import IndustrialReview
from src.voc.review_ops.industrial.taxonomy import CATEGORIES

# Negation just AFTER the risk term — two bounded checks:
#  (a) anchored particle/adverb chain ending in 없 (or ~지 않) — catches
#      distant-but-attached negation: "파손은 전혀 없고", "파손되지 않았어요".
#  (b) 3-char proximity for 없/않 — catches mid-noun matches like the keyword
#      "헐거" inside "헐거움 없이". The narrow window prevents an unrelated distant
#      없 ("파손돼서 쓸 수 없어요", offset ~7) from suppressing a real complaint.
_NEG_AFTER_RE = re.compile(
    r"^(?:[은는이가을를도]\s*)?(?:전혀|별로|하나도|거의|그다지|딱히)?\s*"
    r"(?:없|(?:되지|하지|지)\s*않)"
)
_NEG_PROX_WINDOW = 3
# Standalone "안" just BEFORE a risk keyword (negation), e.g. "안 떨어져요".
_NEG_BEFORE_RE = re.compile(r"(?:^|\s)안\s*$")


def _negated(text_lower: str, start: int, end: int) -> bool:
    """True if a negation cue sits just after or just before the matched span."""
    after = text_lower[end:]
    if _NEG_AFTER_RE.match(after):
        return True
    window = after[:_NEG_PROX_WINDOW]
    if "없" in window or "않" in window:
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
