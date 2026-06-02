"""Executive summary synthesis (Phase 2E).

Builds a deterministic, business-grade summary at the front of the
Phase 2E report. The summary surfaces:

  - top 3 improvement priorities, ranked by `compute_priority_score`,
    each with KPI framing (issue / why it matters / recommended
    action / business risk category)
  - top 2 product strengths, ranked by `compute_strength_score`
  - a 1–2 sentence overall product-signal summary

The synthesis reuses existing layers (insights / impact / recommendations
/ risk_category) without modifying them. No LLM; templates are
deterministic and pinned by tests.

priority_score formula
----------------------
A weighted sum of five components, all derived from existing data:

    priority_score = freq_w + evidence_w + severity_w + tier_bonus + impact_bonus

where:
    freq_w        = (n_negative / n_reviews) * 25
    evidence_w    = max(oy_evidence_score across negative samples) * 1.0
    severity_w    = avg_intensity_neg * 2.0
    tier_bonus    = {High: 5, Medium: 2, Low: 0}[compute_priority(s, n_reviews)]
    impact_bonus  = category_base + (attribute_modifier × frequency_scale)
                    where frequency_scale ∈ [0.5, 1.5] (continuous,
                    confidence-blended)

Severity tiers for impact_bonus (2026-04-28 refinement):
    Category base: 3.0 - 클레임 증가, 경쟁사 이탈
                   2.0 - 재구매율 저하, 신뢰도 하락
                   1.0 - 부정 리뷰 누적, 가격 저항
                   0.0 - unmapped attribute (fallback)
    Attribute modifier (raw) ∈ [-0.5, +0.5]
    Frequency scale (issue prevalence + global + attribute-specific
    sample-size confidence):
        base_scale   = 0.5 + clamp(freq_ratio / 0.15, 0, 1)
        global_conf  = min(1.0, log(n_reviews + 1) / log(1000))
        attr_conf    = min(1.0, log(n_negative + 1) / log(100))
        confidence   = 0.5 × global_conf + 0.5 × attr_conf
        final_scale  = base_scale × confidence + 1.0 × (1 - confidence)
        Output bounded: ∈ [0.5, 1.5].

        Both confidence components must agree for the final scale to
        carry the full base_scale effect: a rare attribute in a large
        corpus (broad corpus, thin support) AND a vocal-minority issue
        in a tiny corpus (thin corpus, full attribute share) both
        produce ~0.5 confidence, pulling the final scale toward 1.0.
        Saturation reached when n_reviews ≥ 1000 AND n_negative ≥ 100.
    Modifier_scaled = modifier × scale, clamped to [-0.75, +0.75]

`compute_priority_score` passes (n_negative, n_reviews) into
`impact_bonus_for` so the modifier scales by issue prevalence.
Calling `impact_bonus_for(attr)` without frequency info defaults
to scale=1.0 (legacy / pre-PR equivalence).

Theoretical max ≈ 51.25 (every review negative, top-tier score 12,
severity 3, High tier, max impact 3.75). Typical High-priority
issue still scores in the 20–30 range; Low-priority < 10.

The score is unsigned and unitless - it's a relative-ranking tool, not
a probability or a metric the operator should interpret in absolute
terms. The order across attributes is the load-bearing output.

Out of scope
------------
- Detector logic - unchanged.
- Corpus filtering - unchanged.
- Insight / impact / recommendation phrasing - reused verbatim.
- LLM-generated text - strictly deterministic.
"""

from __future__ import annotations

from dataclasses import dataclass

from src.voc.reporting.phase2e.impact import (
    impact_bonus_for,
    impact_for,
    risk_category_for,
)
from src.voc.reporting.phase2e.recommendations import recommendation_for
from src.voc.reporting.phase2e.report import (
    AttributeSummary,
    ProductReportData,
    _ko_short_label,
    compute_priority,
)


# ---------------------------------------------------------------------------
# Score weights - tuned so a typical High-tier issue lands in the
# 20–30 range and a marginal issue stays under 10. See module
# docstring for the formula and theoretical max.
# ---------------------------------------------------------------------------

_FREQUENCY_WEIGHT: float = 25.0       # multiplier on (n_negative / n_reviews)
_EVIDENCE_WEIGHT: float = 1.0         # multiplier on max negative evidence score
_SEVERITY_WEIGHT: float = 2.0         # multiplier on avg_intensity_neg
_TIER_BONUS: dict[str, float] = {     # adds a bump per High/Medium/Low tier
    "High":   5.0,
    "Medium": 2.0,
    "Low":    0.0,
}
# Impact-bonus weighting moved to impact.IMPACT_BONUS_BY_RISK_CATEGORY
# (severity-graded per risk category). Resolved at scoring time via
# `impact_bonus_for(attribute)`. The legacy flat constant remains
# unused but kept here as a documentation breadcrumb of the prior
# behavior (a uniform +2.0 across mapped attributes).
_LEGACY_FLAT_IMPACT_BONUS: float = 2.0  # unused; retained for change history


# ---------------------------------------------------------------------------
# Output dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PriorityItem:
    """One row of the Top-N improvement-priority table.

    Carries everything the renderer needs for KPI framing without
    re-querying the source data. `risk_category` may be None when the
    attribute lacks a `RISK_CATEGORY_KO` entry - the renderer should
    fall back to "-" or omit the chip entirely rather than emit a stub.
    """
    attribute: str               # canonical key
    label_ko: str                # short Korean label (no English gloss)
    n_negative: int
    pct_negative: float          # 0.0 – 1.0
    avg_intensity_neg: float
    score_max: float             # max oy_evidence_score across negative samples
    priority_label: str          # "High" / "Medium" / "Low"
    priority_score: float        # the composite ranking score
    risk_category: str | None    # one of RISK_CATEGORIES_KO, or None
    why_ko: str | None           # impact phrase
    action_ko: str | None        # recommendation phrase


@dataclass(frozen=True)
class StrengthItem:
    """One row of the Top-N strengths section."""
    attribute: str
    label_ko: str
    n_positive: int
    pct_positive: float
    score_max: float             # max oy_evidence_score across positive samples
    strength_score: float
    priority_label: str          # "Strong" / "Moderate" / "Mild"


@dataclass(frozen=True)
class ExecutiveSummary:
    """Structured payload the renderer materializes into PDF flowables."""
    overall_signal_ko: str           # 1–2 sentence narrative summary (corpus-stat framing)
    overall_verdict_ko: str          # business-framed verdict (consequences + direction)
    top_priorities: list[PriorityItem]   # length 0..top_n_priorities
    top_strengths: list[StrengthItem]    # length 0..top_n_strengths
    recommended_actions_ko: list[str]    # operator-actionable phrases (from top priorities)
    n_reviews: int                   # forwarded for context lines
    n_records_total: int


# ---------------------------------------------------------------------------
# Score computation
# ---------------------------------------------------------------------------


def _max_negative_evidence_score(s: AttributeSummary) -> float:
    """Highest oy_evidence_score across this attribute's negative
    sample evidences. Returns 0.0 when every sample lacks a score
    (legacy / pre-scoring data) - the score component degrades
    gracefully rather than blowing up the formula."""
    best = 0.0
    for ex in s.sample_evidences_neg:
        v = ex.get("oy_evidence_score")
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            v = float(v)
            if v > best:
                best = v
    return best


def _max_positive_evidence_score(s: AttributeSummary) -> float:
    best = 0.0
    for ex in s.sample_evidences_pos:
        v = ex.get("oy_evidence_score")
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            v = float(v)
            if v > best:
                best = v
    return best


def compute_priority_score(
    s: AttributeSummary, n_reviews: int,
) -> float:
    """Composite priority score for ranking improvement priorities.

    See module docstring for the formula. Returns 0.0 when the
    attribute has no negative records or n_reviews is 0 - both
    degenerate cases the renderer should skip.
    """
    if s.n_negative <= 0 or n_reviews <= 0:
        return 0.0
    pct = s.n_negative / n_reviews
    freq_w = pct * _FREQUENCY_WEIGHT
    evidence_w = _max_negative_evidence_score(s) * _EVIDENCE_WEIGHT
    severity_w = (s.avg_intensity_neg or 0.0) * _SEVERITY_WEIGHT
    tier = compute_priority(s, n_reviews)
    tier_bonus = _TIER_BONUS.get(tier, 0.0)
    # Severity-graded + frequency-scaled impact bonus. The category
    # base comes from IMPACT_BONUS_BY_RISK_CATEGORY; the attribute
    # modifier comes from ATTRIBUTE_IMPACT_MODIFIER and is scaled by
    # the issue's prevalence (n_negative / n_reviews) via
    # `impact_bonus_for`'s frequency-aware path. Unmapped attributes
    # still get 0.0, preserving the legacy fallback.
    impact_bonus = impact_bonus_for(
        s.attribute,
        n_negative=s.n_negative,
        n_reviews=n_reviews,
    )
    return round(freq_w + evidence_w + severity_w + tier_bonus + impact_bonus, 4)


def compute_strength_score(
    s: AttributeSummary, n_reviews: int,
) -> float:
    """Score for ranking strengths. Simpler than priority_score -
    severity and impact-mapping bonuses don't apply to strengths.
    """
    if s.n_positive <= 0 or n_reviews <= 0:
        return 0.0
    pct = s.n_positive / n_reviews
    freq_w = pct * _FREQUENCY_WEIGHT
    evidence_w = _max_positive_evidence_score(s) * _EVIDENCE_WEIGHT
    return round(freq_w + evidence_w, 4)


# ---------------------------------------------------------------------------
# Strength tier (mirrors insights.py - kept here as a free function so
# this module doesn't import insights.py just for the helper)
# ---------------------------------------------------------------------------


def _strength_tier(pct_positive: float) -> str:
    if pct_positive >= 0.30:
        return "Strong"
    if pct_positive >= 0.15:
        return "Moderate"
    return "Mild"


# ---------------------------------------------------------------------------
# Overall signal summary template selection
# ---------------------------------------------------------------------------


def _build_overall_signal_ko(
    data: ProductReportData,
    *,
    top_neg_label: str | None,
    top_pos_label: str | None,
    pct_neg_records: float,
) -> str:
    """Pick one of four narrative templates by negative-record share.

    `pct_neg_records` is the share of polarity records that are
    negative-leaning - a proxy for overall product sentiment health.
    """
    n = data.n_reviews
    pct = pct_neg_records * 100

    if pct_neg_records >= 0.30 and top_neg_label:
        return (
            f"분석 대상 {n}건의 리뷰에서 부정 의견 비율이 {pct:.0f}%로 "
            f"확인되었으며, '{top_neg_label}' 영역에서 개선 우선순위가 "
            f"높습니다."
        )
    if pct_neg_records >= 0.15 and top_neg_label:
        return (
            f"분석 대상 {n}건의 리뷰 중 {pct:.0f}%에서 부정 의견이 "
            f"확인되었으며, 주요 우려는 '{top_neg_label}'에 집중되어 "
            f"있습니다."
        )
    if top_pos_label:
        return (
            f"전반적으로 긍정 평가가 우세한 가운데('{top_pos_label}' 강점), "
            f"일부 속성에서 개선 후보가 식별되었습니다."
        )
    # Edge: nothing to report - empty pipeline output.
    return f"분석 대상 {n}건의 리뷰에서 유의미한 신호가 식별되지 않았습니다."


def _join_ko_concerns(items: list[PriorityItem], limit: int = 2) -> str:
    """Render the top concern labels as a Korean phrase: "묻어남, 지속력"."""
    return ", ".join(p.label_ko for p in items[:limit])


def _join_ko_risk_categories(items: list[PriorityItem], limit: int = 2) -> str:
    """Render the distinct risk categories from the top priorities,
    preserving order. Skips None/missing to avoid leaking placeholders."""
    seen: list[str] = []
    for p in items[:limit]:
        if p.risk_category and p.risk_category not in seen:
            seen.append(p.risk_category)
    if not seen:
        return ""
    if len(seen) == 1:
        return seen[0]
    return " 및 ".join(seen)


def _build_overall_verdict_ko(
    *,
    top_priorities: list[PriorityItem],
    top_strengths: list[StrengthItem],
    pct_neg_records: float,
) -> str:
    """Business-framed 1-sentence verdict suitable for the prominent
    "Overall Verdict" box at the top of the report.

    Differs from `_build_overall_signal_ko` by emphasizing
    *consequence framing* - names the business risk categories
    (재구매율 저하, 클레임 증가, …) the priorities point to, rather
    than just citing percentages.

    Templates by signal balance:
      - concerns dominant (≥0.30 negative records):
        "본 제품은 전반적으로 우려 신호가 우세하며, {concerns} 관련
        이슈가 {risks}로 이어질 수 있어 우선 개선이 필요합니다."
      - mixed (0.15–0.30):
        "본 제품은 전반적으로 긍정 신호가 있으나, {concerns} 관련 우려가
        {risks}에 영향을 줄 가능성이 있습니다."
      - positive dominant (<0.15) with strengths:
        "본 제품은 {strength} 강점이 우세하며, 일부 속성에서 점진적
        개선 후보가 식별되었습니다."
      - empty / minimal data:
        "분석 대상 데이터에서 유의미한 신호가 식별되지 않았습니다."
    """
    has_concerns = bool(top_priorities)
    has_strengths = bool(top_strengths)

    if pct_neg_records >= 0.30 and has_concerns:
        concerns = _join_ko_concerns(top_priorities)
        risks = _join_ko_risk_categories(top_priorities)
        risk_phrase = f"{risks}로 이어질 수 있어" if risks else "비즈니스 영향이 발생할 수 있어"
        return (
            f"본 제품은 전반적으로 우려 신호가 우세하며, "
            f"{concerns} 관련 이슈가 {risk_phrase} 우선 검토 후보로 보입니다."
        )

    if pct_neg_records >= 0.15 and has_concerns:
        concerns = _join_ko_concerns(top_priorities)
        risks = _join_ko_risk_categories(top_priorities)
        risk_phrase = f"{risks}에" if risks else "비즈니스 지표에"
        return (
            f"본 제품은 전반적으로 긍정 신호가 있으나, "
            f"{concerns} 관련 우려가 {risk_phrase} 영향을 줄 가능성이 있습니다."
        )

    if has_strengths:
        strength = top_strengths[0].label_ko
        return (
            f"본 제품은 '{strength}' 강점이 우세하며, "
            f"일부 속성에서 점진적 개선 후보가 식별되었습니다."
        )

    return "분석 대상 데이터에서 유의미한 신호가 식별되지 않았습니다."


def _build_recommended_actions_ko(
    top_priorities: list[PriorityItem],
    *,
    limit: int = 3,
) -> list[str]:
    """Top-N action phrases for the executive summary's
    "Recommended Next Actions" list. Pulled directly from each
    priority's `action_ko` (the canonical recommendation phrase),
    skipping any priority without one. Result is the recommendation
    layer's output filtered + ordered to match the priority ranking.
    """
    out: list[str] = []
    for p in top_priorities[:limit]:
        if p.action_ko:
            out.append(p.action_ko)
    return out


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def synthesize_executive_summary(
    data: ProductReportData,
    *,
    top_n_priorities: int = 3,
    top_n_strengths: int = 2,
) -> ExecutiveSummary:
    """Build the executive summary structure from aggregated data.

    Selection:
      - priorities: top `top_n_priorities` attributes by
        `compute_priority_score`, descending. Attributes with score 0
        (no negatives) are excluded; the returned list can be shorter
        than the requested top-N.
      - strengths: top `top_n_strengths` attributes by
        `compute_strength_score`, descending; same shorter-than-N
        rule.

    Each PriorityItem carries the issue label + frequency + severity
    + risk category + why-it-matters + recommended action - enough
    for the renderer to materialize the KPI table without re-querying
    the source layers. Missing risk/why/action fields surface as None
    so the renderer can elide them rather than emit a stub.
    """
    summaries = list(data.attribute_summaries.values())

    # ---- Priorities ----
    scored_neg: list[tuple[float, AttributeSummary]] = [
        (compute_priority_score(s, data.n_reviews), s)
        for s in summaries
        if s.n_negative > 0
    ]
    scored_neg.sort(key=lambda t: -t[0])
    scored_neg = [(score, s) for (score, s) in scored_neg if score > 0]
    top_priorities: list[PriorityItem] = []
    for score, s in scored_neg[:top_n_priorities]:
        pct = (s.n_negative / data.n_reviews) if data.n_reviews else 0.0
        top_priorities.append(PriorityItem(
            attribute=s.attribute,
            label_ko=_ko_short_label(s.attribute),
            n_negative=s.n_negative,
            pct_negative=pct,
            avg_intensity_neg=s.avg_intensity_neg or 0.0,
            score_max=_max_negative_evidence_score(s),
            priority_label=compute_priority(s, data.n_reviews),
            priority_score=score,
            risk_category=risk_category_for(s.attribute),
            why_ko=impact_for(s.attribute),
            action_ko=recommendation_for(s.attribute),
        ))

    # ---- Strengths ----
    scored_pos: list[tuple[float, AttributeSummary]] = [
        (compute_strength_score(s, data.n_reviews), s)
        for s in summaries
        if s.n_positive > 0
    ]
    scored_pos.sort(key=lambda t: -t[0])
    scored_pos = [(score, s) for (score, s) in scored_pos if score > 0]
    top_strengths: list[StrengthItem] = []
    for score, s in scored_pos[:top_n_strengths]:
        pct_pos = (s.n_positive / data.n_reviews) if data.n_reviews else 0.0
        top_strengths.append(StrengthItem(
            attribute=s.attribute,
            label_ko=_ko_short_label(s.attribute),
            n_positive=s.n_positive,
            pct_positive=pct_pos,
            score_max=_max_positive_evidence_score(s),
            strength_score=score,
            priority_label=_strength_tier(pct_pos),
        ))

    # ---- Overall signal summary ----
    # Compute negative-record share across ALL attributes so the
    # narrative reflects product-wide signal, not just the top-N.
    n_total = sum(
        s.n_total for s in summaries
    ) or 0
    n_neg_records = sum(
        s.n_negative for s in summaries
    )
    pct_neg = (n_neg_records / n_total) if n_total else 0.0
    top_neg_label = top_priorities[0].label_ko if top_priorities else None
    top_pos_label = top_strengths[0].label_ko if top_strengths else None
    overall = _build_overall_signal_ko(
        data,
        top_neg_label=top_neg_label,
        top_pos_label=top_pos_label,
        pct_neg_records=pct_neg,
    )

    verdict = _build_overall_verdict_ko(
        top_priorities=top_priorities,
        top_strengths=top_strengths,
        pct_neg_records=pct_neg,
    )
    recommended_actions = _build_recommended_actions_ko(top_priorities)

    return ExecutiveSummary(
        overall_signal_ko=overall,
        overall_verdict_ko=verdict,
        top_priorities=top_priorities,
        top_strengths=top_strengths,
        recommended_actions_ko=recommended_actions,
        n_reviews=data.n_reviews,
        n_records_total=n_total,
    )
