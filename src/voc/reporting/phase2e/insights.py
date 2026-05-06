"""Per-attribute insight synthesis (Phase 2E).

Turns the existing evidence pool - which already carries
oy_evidence_score, oy_sort_ranks, polarity, and frequency - into one or
two operator-actionable Korean sentences per attribute.

Inputs (read-only)
------------------
- ProductReportData.attribute_summaries
- evidence dicts inside sample_evidences_neg / sample_evidences_pos
  (already enriched with oy_evidence_score, rating_normalized,
  oy_sort_ranks, review_date by `report.aggregate_product`)

Outputs
-------
`synthesize_attribute_insights(data)` returns:
    {"negative": [AttributeInsight, ...], "positive": [AttributeInsight, ...]}

Each AttributeInsight carries a `ko_summary` string (1–2 sentences) plus
diagnostic fields that the renderer can use for chip / priority styling.

Synthesis is template-based, NOT LLM-driven. Templates are picked by
signal pattern (which sort_types had top-rank evidence) and frequency
tier. The resulting sentence prefixes "{label} 관련 부정/긍정 의견" so
all attribute labels compose grammatically (no batchim particle agreement
required).

Out of scope
------------
- Detector logic - unchanged.
- Corpus filtering - unchanged.
- Evidence selection - synthesis reuses `select_evidence` with kind
  switching; no separate ranking logic.
- LLM / generative phrasing - purely deterministic templates.
"""

from __future__ import annotations

from dataclasses import dataclass

from src.voc.reporting.phase2e.report import (
    AttributeSummary,
    ProductReportData,
    _ko_short_label,
    compute_priority,
    select_evidence,
)


# ---------------------------------------------------------------------------
# Constants - Korean labels + signal-strength order
# ---------------------------------------------------------------------------

# Same labels used by `format_sort_signal_labels_ko` for evidence chips.
# Duplicated (not imported) so insights.py can be exercised in isolation
# without dragging the entire report module's chart helpers along.
_SORT_LABELS_KO: dict[str, str] = {
    "RATING_ASC":        "평점 낮은순",
    "USEFUL_SCORE_DESC": "유용한 순",
    "RECOMMENDED_DESC":  "추천순",
    "RATING_DESC":       "평점 높은순",
}

# Top-N rank threshold for treating a sort as "top-rank evidence" in
# template selection. Aligned with the scoring module's top tier
# (rank 1–10 = high weight) and `format_sort_signal_labels_ko`'s
# default. A signal contributes to the template choice only when AT
# LEAST ONE supporting evidence ranks within this window.
_TOP_RANK_THRESHOLD: int = 10


# ---------------------------------------------------------------------------
# Output shape
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AttributeInsight:
    attribute: str               # canonical key, e.g. "transfer_resistance"
    kind: str                    # "negative" or "positive"
    ko_summary: str              # 1–2 sentence Korean text (operator-facing)
    n_supporting: int            # # of evidences that fed this insight
    score_max: float             # max oy_evidence_score across supporting evidences (0.0 if all missing)
    signal_sources: list[str]    # canonical sort_types that surfaced top-rank evidence
    priority_label: str          # "High" / "Medium" / "Low" (negative);
                                  # "Strong" / "Moderate" / "Mild" (positive)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _collect_top_signal_sources(
    evidences: list[dict],
    *,
    threshold: int = _TOP_RANK_THRESHOLD,
) -> list[str]:
    """Return canonical sort_types where at least one supporting evidence
    ranks within the top-`threshold` for that sort.

    Output order is fixed by signal-strength priority
    (RATING_ASC → USEFUL_SCORE_DESC → RECOMMENDED_DESC → RATING_DESC),
    NOT input order, so two calls with the same signal-set always
    produce the same ordered list. DATETIME_DESC is ignored (every
    review is on it; carries no signal).
    """
    seen: set[str] = set()
    for ex in evidences:
        ranks = ex.get("oy_sort_ranks") or {}
        if not isinstance(ranks, dict):
            continue
        for st, rank in ranks.items():
            if st not in _SORT_LABELS_KO:
                continue
            if not isinstance(rank, int) or isinstance(rank, bool):
                continue
            if 1 <= rank <= threshold:
                seen.add(st)
    canonical_order = (
        "RATING_ASC", "USEFUL_SCORE_DESC",
        "RECOMMENDED_DESC", "RATING_DESC",
    )
    return [st for st in canonical_order if st in seen]


def _join_signal_labels_ko(sort_types: list[str]) -> str:
    """Render a list of canonical sort_types as a Korean phrase.

    Single sort: "유용한 순"
    Two: "유용한 순/추천순"
    Three+: comma-joined: "유용한 순, 추천순, 평점 높은순"
    """
    labels = [_SORT_LABELS_KO[st] for st in sort_types if st in _SORT_LABELS_KO]
    if len(labels) <= 2:
        return "/".join(labels)
    return ", ".join(labels)


def _max_score(evidences: list[dict]) -> float:
    """Highest oy_evidence_score among the supporting evidences. 0.0
    when every row lacks a score (legacy / pre-scoring data) - keeps
    the dataclass field non-None and consistent for downstream display.
    """
    best = 0.0
    for ex in evidences:
        s = ex.get("oy_evidence_score")
        if isinstance(s, (int, float)) and not isinstance(s, bool):
            v = float(s)
            if v > best:
                best = v
    return best


def _positive_priority_label(pct: float) -> str:
    """Coarse strength tier for positive insights - separate from
    `compute_priority` which is tuned for negative escalation."""
    if pct >= 30:
        return "Strong"
    if pct >= 15:
        return "Moderate"
    return "Mild"


# ---------------------------------------------------------------------------
# Negative-side template selection
# ---------------------------------------------------------------------------


def _build_negative_summary_ko(
    label: str,
    pct: float,
    signals: list[str],
) -> str:
    """Pick one of four negative templates by signal pattern.

    Cases (in priority order):
      1. RATING_ASC top-rank + at least one cross-confirm (USEFUL /
         RECOMMENDED / RATING_DESC) → "개선 우선순위가 높습니다." with
         the cross-signal phrase.
      2. RATING_ASC top-rank alone → same conclusion, no cross phrase.
      3. No RATING_ASC but USEFUL / RECOMMENDED top-rank →
         "모니터링이 필요합니다." (community-noted but not yet a
         critical-list dominator).
      4. No top-rank signals at all → frequency-only summary.

    Note: the ordering deliberately suppresses `RATING_DESC` from
    cross-confirming a negative insight; a high-rated review surfacing
    a complaint is unusual evidence and we don't want to overstate it.
    Same logic - keep `RATING_DESC` out of cross_signals here.
    """
    has_rating_asc = "RATING_ASC" in signals
    cross_signals = [
        s for s in signals
        if s in ("USEFUL_SCORE_DESC", "RECOMMENDED_DESC")
    ]
    pct_str = f"{pct:.0f}"

    if has_rating_asc and cross_signals:
        cross_phrase = _join_signal_labels_ko(cross_signals)
        return (
            f"{label} 관련 부정 의견은 평점 낮은순 상위 리뷰에서 반복적으로 "
            f"언급되며, {cross_phrase}에서도 확인되어 개선 우선순위가 높습니다."
        )
    if has_rating_asc:
        return (
            f"{label} 관련 부정 의견은 평점 낮은순 상위 리뷰에서 반복적으로 "
            f"언급되어 개선 우선순위가 높습니다."
        )
    if cross_signals:
        cross_phrase = _join_signal_labels_ko(cross_signals)
        return (
            f"{label} 관련 부정 의견이 {cross_phrase} 상위 리뷰에서 언급되어 "
            f"모니터링이 필요합니다."
        )
    return (
        f"{label} 관련 부정 의견이 전체 리뷰의 {pct_str}%에서 언급되어 "
        f"추세 모니터링이 필요합니다."
    )


def _build_positive_summary_ko(
    label: str,
    pct: float,
    signals: list[str],
) -> str:
    """Pick one of five positive templates by signal pattern.

    Cases (in priority order):
      1. RATING_DESC top-rank + RECOMMENDED top-rank → "핵심 강점"
         with cross phrase.
      2. RATING_DESC top-rank alone → "핵심 강점으로 자리잡고 있습니다."
      3. RECOMMENDED top-rank alone → "강점으로 작용합니다."
      4. USEFUL_SCORE_DESC top-rank (no RATING_DESC, no RECOMMENDED)
         → "강점입니다." (operator usefulness signal).
      5. No top-rank signals at all → frequency-only summary.

    RATING_ASC is NOT considered a positive cross-confirm - a positive
    review surfacing in the low-rating list is unusual and not the kind
    of "strength" signal we want to amplify here.
    """
    has_rating_desc = "RATING_DESC" in signals
    has_recommended = "RECOMMENDED_DESC" in signals
    has_useful = "USEFUL_SCORE_DESC" in signals
    pct_str = f"{pct:.0f}"

    if has_rating_desc and has_recommended:
        return (
            f"{label} 관련 긍정 평가는 평점 높은순 상위 리뷰에서 자주 "
            f"언급되며, 추천순 상위 리뷰에서도 확인되어 핵심 강점입니다."
        )
    if has_rating_desc:
        return (
            f"{label} 관련 긍정 평가는 평점 높은순 상위 리뷰에서 강조되어 "
            f"핵심 강점으로 자리잡고 있습니다."
        )
    if has_recommended:
        return (
            f"{label} 관련 긍정 평가가 추천순 상위 리뷰에서 확인되어 "
            f"강점으로 작용합니다."
        )
    if has_useful:
        return (
            f"{label} 관련 긍정 평가가 유용한 순 상위 리뷰에서 강조되어 "
            f"강점입니다."
        )
    return (
        f"{label} 관련 긍정 평가가 전체 리뷰의 {pct_str}%에서 확인되어 "
        f"강점으로 평가됩니다."
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def _build_negative_insight(
    s: AttributeSummary, n_reviews: int,
) -> AttributeInsight | None:
    if s.n_negative <= 0:
        return None
    evidences = select_evidence(s, n=3, prefer_diverse=True, kind="negative")
    if not evidences:
        return None
    signals = _collect_top_signal_sources(evidences)
    pct = (s.n_negative / n_reviews * 100) if n_reviews else 0.0
    label = _ko_short_label(s.attribute)
    ko = _build_negative_summary_ko(label, pct, signals)
    return AttributeInsight(
        attribute=s.attribute,
        kind="negative",
        ko_summary=ko,
        n_supporting=len(evidences),
        score_max=_max_score(evidences),
        signal_sources=signals,
        priority_label=compute_priority(s, n_reviews),
    )


def _build_positive_insight(
    s: AttributeSummary, n_reviews: int,
) -> AttributeInsight | None:
    if s.n_positive <= 0:
        return None
    evidences = select_evidence(s, n=3, prefer_diverse=True, kind="positive")
    if not evidences:
        return None
    signals = _collect_top_signal_sources(evidences)
    pct = (s.n_positive / n_reviews * 100) if n_reviews else 0.0
    label = _ko_short_label(s.attribute)
    ko = _build_positive_summary_ko(label, pct, signals)
    return AttributeInsight(
        attribute=s.attribute,
        kind="positive",
        ko_summary=ko,
        n_supporting=len(evidences),
        score_max=_max_score(evidences),
        signal_sources=signals,
        priority_label=_positive_priority_label(pct),
    )


def synthesize_attribute_insights(
    data: ProductReportData,
    *,
    top_n_negative: int = 5,
    top_n_positive: int = 3,
) -> dict[str, list[AttributeInsight]]:
    """Generate per-attribute Korean insights for the top negative and
    top positive attributes.

    Selection of attributes:
      - negative: top `top_n_negative` by `n_negative` (most-flagged complaints)
      - positive: top `top_n_positive` by `n_positive` (most-praised attributes)

    Attributes with `n_negative == 0` (resp. `n_positive == 0`) are
    silently skipped - there's no insight to render. The returned lists
    can therefore be shorter than the requested top-N.

    Each insight is a 1–2 sentence Korean string suitable for direct
    embedding in an operator-facing report. The diagnostic fields on
    AttributeInsight (signal_sources, score_max, priority_label) are
    available for renderers that want to add chips / priority badges.
    """
    summaries = list(data.attribute_summaries.values())

    neg_summaries = sorted(
        [s for s in summaries if s.n_negative > 0],
        key=lambda s: -s.n_negative,
    )[:top_n_negative]
    pos_summaries = sorted(
        [s for s in summaries if s.n_positive > 0],
        key=lambda s: -s.n_positive,
    )[:top_n_positive]

    neg_insights: list[AttributeInsight] = []
    for s in neg_summaries:
        ins = _build_negative_insight(s, data.n_reviews)
        if ins is not None:
            neg_insights.append(ins)

    pos_insights: list[AttributeInsight] = []
    for s in pos_summaries:
        ins = _build_positive_insight(s, data.n_reviews)
        if ins is not None:
            pos_insights.append(ins)

    return {"negative": neg_insights, "positive": pos_insights}
