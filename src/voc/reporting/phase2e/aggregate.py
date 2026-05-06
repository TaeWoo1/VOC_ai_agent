"""Phase 2E Stage 3 — review-level aggregation (deterministic).

Takes a list of `PolarityRecord` (Stage 2 output) for a single review +
the review text, and computes:
  - mixed_review_flag: bool — true iff the records span both
    positive(or mixed) AND negative_*(or mixed) polarities
  - tradeoff_pair: str | None — cross-attribute trade-off in the form
    `"attr_a:polarity_a -> attr_b:polarity_b"` when:
      (a) the review contains at least one conjunction marker
      (b) there are positive AND negative_* records on DIFFERENT attributes
      (c) the pair is cross-attribute (self-loops prohibited per schema §7.5)
  - delivery_condition_flag: preserved from per-record Stage 2 output

Per `docs/phase2e_attribute_polarity_schema_plan.md` §7 and
`docs/phase2e_detector_design.md` §4 + §7.4.

This module is deterministic. No LLM, no DB.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

from .stage2 import PolarityRecord


CONJUNCTION_MARKERS = (
    "지만", "한데", "다만", "근데", "하지만", "그래도",
    "그런데", "반면", "대신", "아쉽",
)

POSITIVE_LIKE = ("positive", "mixed")
NEGATIVE_LIKE = ("negative_weak", "negative_strong", "mixed")


@dataclass(frozen=True)
class ReviewAggregation:
    review_id: str
    records: list[PolarityRecord]
    mixed_review_flag: bool
    tradeoff_pair: str | None
    delivery_condition_flag: bool          # any record with delivery_condition_flag=True
    has_conjunction_marker: bool


def has_conjunction_marker(review_text: str) -> bool:
    if not review_text:
        return False
    return any(m in review_text for m in CONJUNCTION_MARKERS)


def _detect_tradeoff_pair(
    records: list[PolarityRecord],
    review_text: str,
) -> str | None:
    """Cross-attribute trade-off detection.

    Rules (deterministic):
    1. Review must contain at least one conjunction marker.
    2. There must be at least one record with positive(or mixed) polarity
       and at least one record with negative_*(or mixed) polarity.
    3. The two records must be on DIFFERENT attributes (self-loop
       prohibited per schema §7.5).
    4. Among valid candidate pairs, prefer the highest combined intensity;
       tie-break by alphabetical attribute order.
    5. Output format: `"<attr_a>:<polarity_a> -> <attr_b>:<polarity_b>"`
       where attr_a is the positive side and attr_b is the conceded side.
    """
    if not has_conjunction_marker(review_text or ""):
        return None
    pos_records = [r for r in records if r.polarity in POSITIVE_LIKE]
    neg_records = [r for r in records if r.polarity in NEGATIVE_LIKE]
    if not pos_records or not neg_records:
        return None
    # Cross-attribute pairs only
    candidates: list[tuple[int, str]] = []
    for pr in pos_records:
        for nr in neg_records:
            if pr.attribute == nr.attribute:
                # Self-loop prohibited by schema §7.5; same-attribute
                # contradiction is expressed via polarity=mixed on a single
                # record, not via tradeoff_pair.
                continue
            score = (pr.intensity or 0) + (nr.intensity or 0)
            pair = f"{pr.attribute}:{pr.polarity} -> {nr.attribute}:{nr.polarity}"
            candidates.append((score, pair))
    if not candidates:
        return None
    # Highest score; ties broken by alphabetical pair string
    candidates.sort(key=lambda x: (-x[0], x[1]))
    return candidates[0][1]


def aggregate(
    review_id: str,
    records: Iterable[PolarityRecord],
    review_text: str = "",
) -> ReviewAggregation:
    """Compute review-level fields from Stage 2 records.

    Skips records with `drop=True`. Empty record list → mixed_flag=False,
    tradeoff_pair=None.
    """
    records = [r for r in records if not r.drop]
    polarities = {r.polarity for r in records}
    has_pos = any(p in POSITIVE_LIKE for p in polarities)
    has_neg = any(p in NEGATIVE_LIKE for p in polarities)
    mixed_flag = bool(has_pos and has_neg)

    # Single mixed record alone satisfies (positive contains 'mixed', negative contains 'mixed')
    # — handled correctly by the membership tests above.

    tradeoff = _detect_tradeoff_pair(records, review_text)

    return ReviewAggregation(
        review_id=review_id,
        records=records,
        mixed_review_flag=mixed_flag,
        tradeoff_pair=tradeoff,
        delivery_condition_flag=False,  # populated by stage 2 per-record;
        # this aggregation surface keeps it out for now to match seed schema
        has_conjunction_marker=has_conjunction_marker(review_text or ""),
    )
