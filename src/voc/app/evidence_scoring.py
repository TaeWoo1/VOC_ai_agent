"""Per-review evidence scoring (Phase 2E).

A review's `oy_evidence_score` is an UNSIGNED measure of how strong this
review is as evidence — independent of sentiment direction. A score of
8.0 doesn't mean "very positive" or "very negative"; it means "this
review carries strong evidence of whatever opinion it expresses." The
direction lives elsewhere (rating_normalized, polarity records, sort
membership).

Score components (all additive):

  Rating contribution:
    The intensity of the review's opinion drives evidence weight.
    Extremes are more actionable than middle-of-the-road ratings.
      rating ≤ 2  → 2.0   (complaint — high actionability for sellers)
      rating == 3 → 0.5   (mixed/mild — weak evidence)
      rating == 4 → 1.0   (moderate praise)
      rating == 5 → 1.5   (strong praise)
      missing     → 0.0

  Sort-type multiplier:
    Where the review surfaces under the OY sort buttons reflects its
    visibility on the page and its critical / useful / recommended
    standing in the community pool.
      RATING_ASC          → 1.0   (strongest CRITICAL signal — top of low-rating list)
      USEFUL_SCORE_DESC   → 0.9   (community-validated importance)
      RECOMMENDED_DESC    → 0.8   (operator-recommended)
      RATING_DESC         → 0.7   (strongest POSITIVE signal — top of high-rating list)
      DATETIME_DESC       → 0.0   (chronological backbone — every review is here, no signal)

  Rank tier (per-sort visibility):
      rank 1–10  → 3.0   (top-of-list — operators / shoppers see these first)
      rank 11–50 → 1.5   (mid-list)
      rank ≥ 51  → 0.5   (tail — surfaced but rarely surfaced FIRST)
      missing    → 0.0   (this sort did not observe the review)

  Total = rating_contribution + Σ_sort (rank_tier_weight × sort_multiplier)

Examples (computed by `compute_evidence_score`):

| review                                                       | score |
|--------------------------------------------------------------|------:|
| rating=1, RATING_ASC rank 2,  USEFUL_SCORE_DESC rank 5       |  7.70 |
| rating=5, RECOMMENDED_DESC rank 1                            |  3.90 |
| rating=3, only DATETIME_DESC rank 50 (no signal sorts)       |  0.50 |
| rating=2, RATING_ASC rank 45, USEFUL_SCORE_DESC rank 28      |  4.85 |
| rating=None, RATING_DESC rank 3                              |  2.10 |

Out of scope
------------
- Detector logic — unchanged. This module reads detector outputs
  conceptually (via raw_metadata) but does not modify them.
- Corpus filtering — `fetch_reviews` still filters to
  `oy_sort_type == DATETIME_DESC`. Scores are computed for every row
  with sort metadata; whether they're consumed for analysis vs.
  evidence selection is up to the caller.
- Versioning — if the weights below change, re-running
  `apply_evidence_scores_to_db` overwrites the stored value (idempotent
  under stable weights). No version field is written.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Weight constants (the design tradeoff is documented in the module header)
# ---------------------------------------------------------------------------

# Rating tier → contribution. Anything outside the 1–5 range degrades to 0;
# this matches the rating_normalized invariant and shields the score from
# garbage data.
RATING_TIER_CONTRIB: dict[int, float] = {
    1: 2.0,
    2: 2.0,
    3: 0.5,
    4: 1.0,
    5: 1.5,
}

SORT_TYPE_MULTIPLIER: dict[str, float] = {
    "RATING_ASC":        1.0,
    "USEFUL_SCORE_DESC": 0.9,
    "RECOMMENDED_DESC":  0.8,
    "RATING_DESC":       0.7,
    "DATETIME_DESC":     0.0,  # corpus backbone — every review sits here
}

# Rank tier weights. Tiered (not continuous) so a small change in scrape
# order (e.g., rank 9 vs rank 11 across re-runs) doesn't oscillate the
# score; consumers see stable cohorts of "top / mid / tail" instead.
_RANK_TIER_TOP = (1, 10, 3.0)
_RANK_TIER_MID = (11, 50, 1.5)
_RANK_TIER_TAIL = (51, None, 0.5)


def _rank_tier_weight(rank: int | None) -> float:
    """Map a 1-based rank ordinal to its tier weight. None → 0.0."""
    if rank is None or not isinstance(rank, int) or rank <= 0:
        return 0.0
    if rank <= _RANK_TIER_TOP[1]:
        return _RANK_TIER_TOP[2]
    if rank <= _RANK_TIER_MID[1]:
        return _RANK_TIER_MID[2]
    return _RANK_TIER_TAIL[2]


def _rating_contrib(rating_normalized: float | None) -> float:
    """Map a 1–5 rating to its contribution. Out-of-range / None → 0.0.

    Rounds half-rating values toward the nearest integer tier so partial
    ratings (e.g., 4.5 from a 10-point scale halved) still map to a tier
    instead of falling through to 0.
    """
    if rating_normalized is None:
        return 0.0
    try:
        # Banker's rounding is fine here — the boundary cases (.5) are
        # vanishingly rare in OY data, and either neighbor tier is a
        # reasonable assignment for a half-step rating.
        tier = int(round(float(rating_normalized)))
    except (TypeError, ValueError):
        return 0.0
    return RATING_TIER_CONTRIB.get(tier, 0.0)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def compute_evidence_score(
    rating_normalized: float | None,
    sort_ranks: dict[str, int | None] | None,
) -> float:
    """Compute a per-review evidence score.

    Pure function. Inputs are exactly what the score depends on, so
    callers can score rows in-memory without touching the DB and tests
    can exercise edge cases without staging fixtures.

    `sort_ranks` is the same shape that `sort_membership.merge_sidecars`
    produces in `oy_sort_ranks` raw_metadata: {sort_type → int | None}.
    A None rank or an unknown sort_type contributes 0 (neutral). Missing
    `sort_ranks` (or an empty dict) is also 0 — a row with no sort
    membership info gets only its rating contribution.

    Returns a non-negative float. Values are not bounded — a review at
    rank 1 across all four signal sorts with rating=1 maxes out at
    around 12.2, while a typical mid-rank rating-3 review scores under
    3.0. The score is a relative-ordering tool, not a probability.
    """
    score = _rating_contrib(rating_normalized)
    if sort_ranks:
        for sort_type, rank in sort_ranks.items():
            multiplier = SORT_TYPE_MULTIPLIER.get(sort_type, 0.0)
            if multiplier == 0.0:
                # Either an unknown sort_type or DATETIME_DESC (backbone).
                # Either way, no contribution.
                continue
            score += _rank_tier_weight(rank) * multiplier
    return round(score, 4)  # 4dp = enough precision; avoids float jitter


@dataclass
class ScoringStats:
    """Diagnostic counts from one apply_evidence_scores_to_db pass."""
    rows_examined: int = 0
    rows_updated: int = 0
    rows_no_op: int = 0  # row already has the same score; UPDATE skipped
    rows_skipped_no_metadata: int = 0  # raw_metadata_json was empty/invalid


# Reserved keys this module owns inside raw_metadata_json. Any other
# pre-existing fields are passed through unchanged.
_OWNED_KEYS: tuple[str, ...] = ("oy_evidence_score",)


def apply_evidence_scores_to_db(
    db_path: str | Path,
    *,
    goods_no: str,
) -> ScoringStats:
    """Compute and store `oy_evidence_score` for every row of `goods_no`.

    For each phase1_reviews row matching `product_external_id`:
      - read rating_normalized (column) + raw_metadata.oy_sort_ranks
      - compute_evidence_score(rating, sort_ranks)
      - write raw_metadata.oy_evidence_score (overwriting any prior
        value — re-running with new weights is intentionally
        non-additive on this owned key)

    UPDATEs only the raw_metadata_json column. No other column is
    touched. Rows whose raw_metadata_json is empty / not valid JSON are
    counted as `rows_skipped_no_metadata` (the score still depends on
    sort_ranks which lives there; without metadata we'd be writing a
    score derived from rating only — kept skipped to match the
    membership-pass conservatism).

    Idempotent: a second invocation against unchanged inputs yields 0
    updates and rows_no_op == N.
    """
    stats = ScoringStats()
    con = sqlite3.connect(str(db_path))
    try:
        cur = con.cursor()
        cur.execute(
            "SELECT review_id, rating_normalized, raw_metadata_json "
            "FROM phase1_reviews WHERE product_external_id = ?",
            (goods_no,),
        )
        rows = cur.fetchall()
        for review_id, rating, raw_json in rows:
            stats.rows_examined += 1
            if not raw_json:
                stats.rows_skipped_no_metadata += 1
                continue
            try:
                meta = json.loads(raw_json)
                if not isinstance(meta, dict):
                    stats.rows_skipped_no_metadata += 1
                    continue
            except json.JSONDecodeError:
                logger.warning(
                    "raw_metadata_json for review_id=%s is not valid JSON; "
                    "skipping evidence scoring",
                    review_id,
                )
                stats.rows_skipped_no_metadata += 1
                continue

            sort_ranks = meta.get("oy_sort_ranks")
            if not isinstance(sort_ranks, dict):
                sort_ranks = None
            score = compute_evidence_score(rating, sort_ranks)

            prior = meta.get("oy_evidence_score")
            if isinstance(prior, (int, float)) and not isinstance(prior, bool):
                if abs(float(prior) - score) < 1e-9:
                    stats.rows_no_op += 1
                    continue

            meta["oy_evidence_score"] = score
            cur.execute(
                "UPDATE phase1_reviews SET raw_metadata_json = ? "
                "WHERE review_id = ? AND product_external_id = ?",
                (json.dumps(meta, ensure_ascii=False), review_id, goods_no),
            )
            stats.rows_updated += 1
        con.commit()
    finally:
        con.close()
    return stats
