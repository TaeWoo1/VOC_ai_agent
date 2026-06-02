"""Per-attribute business-impact phrasing (Phase 2E).

Pairs each negative `AttributeInsight` with a 1-sentence Korean
explanation of the business consequence - answers "why does this matter
for the operator?" Sits between the insight sentence (what is happening)
and the recommendation (what to do about it) in the operator-facing
report.

Inputs (read-only)
------------------
- list[AttributeInsight] - typically the `"negative"` slice from
  `synthesize_attribute_insights`. Positive insights are skipped
  (a strength's "impact" is its own positive contribution; not the
  question this layer answers).

Outputs
-------
`generate_impacts(insights)` returns a list of `Impact` records, one
per negative insight whose `attribute` is in the mapping. Insights
with an unmapped attribute are silently skipped - no fabricated
generic stub.

Design notes
------------
Each phrase follows the pattern:
    "{문제 진술} {결과}로 이어질 수 있습니다."

The `이어질 수 있습니다` hedging is deliberate: VOC signals are
correlational, not causal proof. Stronger language ("발생합니다")
would overstate the evidence the report carries.

Out of scope
------------
- Impacts for positive insights - strengths are not consequences;
  this layer answers "why does this issue matter".
- Severity-graded phrasing - priority_label is forwarded so the
  renderer can style urgency separately.
- LLM-generated text - strictly deterministic, paired 1:1 with
  the `recommendations.py` mapping.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from src.voc.reporting.phase2e.insights import AttributeInsight


# Canonical impact phrases per attribute key. Updates ARE breaking -
# downstream reports cite these phrases verbatim. Any phrasing change
# should pair with a stakeholder review and a coordinated update to
# `tests/test_reporting/test_phase2e/test_impact.py`.
#
# Each phrase ties the issue to ≥1 concrete business outcome from
# the cosmetics-retail domain: 재구매율 (repurchase rate), 환불/교환
# (returns), 클레임 (complaints), 부정 리뷰 누적 (negative review
# accumulation), 경쟁사 대체 구매 (competitor switching), 신뢰도 하락
# (trust decline), 고객 이탈 (customer churn).
IMPACTS_KO: dict[str, str] = {
    "pigmentation":
        "발색 불만은 첫 구매 후 부정 리뷰 누적과 재구매율 저하로 이어질 수 있습니다.",
    "persistence":
        "지속력 부족은 제품 신뢰도 하락 및 경쟁사 대체 구매로 이어질 수 있습니다.",
    "application_blending":
        "발림성 불만은 사용 만족도 저하와 부정 입소문 확산으로 이어질 수 있습니다.",
    "adhesion_base_interaction":
        "베이스 호환성 문제는 다른 메이크업 제품과의 사용 회피 및 신뢰도 하락으로 "
        "이어질 수 있습니다.",
    "finish_texture":
        "마무리감 불일치는 제품 콘셉트 신뢰도 하락 및 재구매율 저하로 이어질 수 있습니다.",
    "dryness_skin_texture":
        "건조감 호소는 민감/건성 피부 고객 이탈 및 부정 리뷰 누적으로 이어질 수 있습니다.",
    "color_tone_matching":
        "톤 매칭 불일치는 환불/교환 요청 증가 및 컬러 라인업 신뢰도 하락으로 "
        "이어질 수 있습니다.",
    "packaging_container":
        "용기 불만은 첫인상 손상 및 선물용 구매 감소로 이어질 수 있습니다.",
    "applicator_tool":
        "도구 품질 불만은 제품 전반에 대한 인상 저하 및 재구매율 감소로 이어질 수 있습니다.",
    "value_price":
        "가격 불만은 경쟁사 대체 구매 및 재구매율 저하로 이어질 수 있습니다.",
    "multi_use_lip_cheek_compatibility":
        "립/치크 호환성 불만은 다용도 가치 인식 약화 및 차별화 포지션 약화로 "
        "이어질 수 있습니다.",
    "transfer_resistance":
        "묻어남 문제는 재구매율 저하 및 클레임 증가로 이어질 수 있습니다.",
}


# The six canonical business-risk categories the executive summary
# uses to badge each priority. These are the phrases the operator sees
# in the priority table, so the wording is fixed:
#   재구매율 저하 / 클레임 증가 / 경쟁사 이탈 / 부정 리뷰 누적 /
#   가격 저항 / 신뢰도 하락.
#
# Each attribute resolves to exactly ONE primary risk category. The
# choice reflects the dominant business outcome cited in the
# corresponding `IMPACTS_KO` phrase - i.e., this mapping is a
# coarsened, single-bucket view of the same data the impact phrase
# describes more fully.
RISK_CATEGORY_KO: dict[str, str] = {
    "pigmentation":                       "부정 리뷰 누적",
    "persistence":                        "경쟁사 이탈",
    "application_blending":               "부정 리뷰 누적",
    "adhesion_base_interaction":          "신뢰도 하락",
    "finish_texture":                     "재구매율 저하",
    "dryness_skin_texture":               "부정 리뷰 누적",
    "color_tone_matching":                "클레임 증가",
    "packaging_container":                "신뢰도 하락",
    "applicator_tool":                    "재구매율 저하",
    "value_price":                        "가격 저항",
    "multi_use_lip_cheek_compatibility":  "신뢰도 하락",
    "transfer_resistance":                "클레임 증가",
}

# Canonical set of risk categories. Used by tests to lock the
# vocabulary against the user-defined six and by the renderer to
# style category chips consistently.
RISK_CATEGORIES_KO: frozenset[str] = frozenset({
    "재구매율 저하",
    "클레임 증가",
    "경쟁사 이탈",
    "부정 리뷰 누적",
    "가격 저항",
    "신뢰도 하락",
})

# Per-category weight for the executive-summary priority_score
# `business_impact_weight` component.
#
# Replaces a prior flat +2.0 bonus with severity-graded weights so the
# score reflects business consequence - a 클레임 or 경쟁사 이탈 issue
# now ranks higher than a same-frequency 가격 저항 / 부정 리뷰 누적
# issue, all else equal.
#
# Severity tiers (user-pinned 2026-04-28):
#   3.0  - 클레임 증가, 경쟁사 이탈
#         Direct customer escalation / lost revenue. Most actionable
#         signals from the operator's perspective.
#   2.0  - 재구매율 저하, 신뢰도 하락
#         Repeated revenue loss, brand trust erosion. Lagging
#         indicators with material cumulative impact.
#   1.0  - 부정 리뷰 누적, 가격 저항
#         Reputation drag and pricing-perception headwind. Real but
#         less acute than escalation/churn.
#
# Attributes outside `RISK_CATEGORY_KO` (e.g., a future attribute key
# not yet mapped) get 0.0 - same fallback as the original flat-bonus
# behavior for unmapped keys, which preserves backward compatibility
# for that path.
IMPACT_BONUS_BY_RISK_CATEGORY: dict[str, float] = {
    "클레임 증가":    3.0,
    "경쟁사 이탈":    3.0,
    "재구매율 저하":  2.0,
    "신뢰도 하락":    2.0,
    "부정 리뷰 누적": 1.0,
    "가격 저항":      1.0,
}

# Attribute-level modifier on top of the category base weight.
# Final impact_bonus = IMPACT_BONUS_BY_RISK_CATEGORY[risk_category]
#                      + ATTRIBUTE_IMPACT_MODIFIER[attribute]
#
# The modifier captures attribute-specific operator-stakes that
# coarse risk-category bucketing flattens away. Two attributes in the
# same risk category can carry different urgency: a 클레임 증가 issue
# from a directly visible defect (transfer_resistance) is more
# actionable than a 클레임 증가 issue from skin-tone mismatch where
# returns are partially user-driven.
#
# Constraints:
#   - Range: every value in [-0.5, +0.5]. Locked by tests; preserves
#     the dominant role of the category weight while letting
#     attribute-level signal nudge the ranking.
#   - Default for unmapped attributes is 0.0 (no modifier). The
#     module-level `impact_bonus_for` returns 0.0 for unmapped attrs
#     either way, so this default never surfaces in practice - it's
#     a safety net for `attribute_modifier_for` direct callers.
#
# Severity bands (within [-0.5, +0.5]):
#   +0.5  direct visible defect / functional failure
#   +0.3  visible-but-conditional issue
#   +0.2  sensory or expected-variation issue
#   +0.1  aesthetic / practical issue
#    0.0  workmanship-learnable / tertiary / subjective
#   -0.2  economic / pricing pressure (not a product defect)
#   -0.3  niche selling point (limited to subset of users)
ATTRIBUTE_IMPACT_MODIFIER: dict[str, float] = {
    # +0.5  direct visible defect / functional failure
    "transfer_resistance":                 0.5,
    "adhesion_base_interaction":           0.5,
    # +0.3  visible-but-conditional
    "color_tone_matching":                 0.3,
    # +0.2  sensory / expected variation
    "persistence":                         0.2,
    "dryness_skin_texture":                0.2,
    # +0.1  aesthetic / practical
    "finish_texture":                      0.1,
    "packaging_container":                 0.1,
    #  0.0  workmanship / tertiary / subjective
    "applicator_tool":                     0.0,
    "application_blending":                0.0,
    "pigmentation":                        0.0,
    # -0.2 / -0.3  not a product defect
    "value_price":                        -0.2,
    "multi_use_lip_cheek_compatibility":  -0.3,
}


@dataclass(frozen=True)
class Impact:
    """One business-consequence statement derived from a negative insight."""
    attribute: str         # canonical key, e.g. "transfer_resistance"
    ko_consequence: str    # the 1-sentence Korean business consequence
    priority_label: str    # forwarded from the source insight
                            # (High/Medium/Low) - renderer styles urgency.


# Structured business-impact triple per attribute. Three buckets that
# map the abstract `IMPACTS_KO` phrase into named financial /
# operational dimensions a brand operator can scan in one breath:
#
#   revenue_ko : top-of-funnel / new-customer revenue effect
#                (e.g., "구매 전환 ↓", "매출 차감 ↑")
#   churn_ko   : retention / repeat-purchase effect
#                (e.g., "재구매율 ↓", "경쟁사 이탈 ↑")
#   cs_cost_ko : CS / returns / claim-handling cost
#                (e.g., "클레임/환불 처리 비용 ↑")
#
# Any field can be None when that dimension is not the dominant
# concern for the attribute - the renderer omits the absent chip
# rather than emitting a "-" placeholder. Phrases are deliberately
# short (≤5 words) so the priority card stays scannable.
@dataclass(frozen=True)
class BusinessImpact:
    revenue_ko: str | None
    churn_ko: str | None
    cs_cost_ko: str | None


BUSINESS_IMPACT_KO: dict[str, BusinessImpact] = {
    "transfer_resistance": BusinessImpact(
        revenue_ko=None,
        churn_ko="재구매율 ↓",
        cs_cost_ko="클레임/환불 비용 ↑",
    ),
    "color_tone_matching": BusinessImpact(
        revenue_ko="환불로 인한 매출 차감 ↑",
        churn_ko=None,
        cs_cost_ko="환불/교환 처리 비용 ↑",
    ),
    "persistence": BusinessImpact(
        revenue_ko="신규 전환 ↓",
        churn_ko="경쟁사 이탈 ↑",
        cs_cost_ko=None,
    ),
    "adhesion_base_interaction": BusinessImpact(
        revenue_ko=None,
        churn_ko="다른 제품군 사용 회피",
        cs_cost_ko=None,
    ),
    "finish_texture": BusinessImpact(
        revenue_ko="신규 전환 ↓",
        churn_ko="재구매율 ↓",
        cs_cost_ko=None,
    ),
    "applicator_tool": BusinessImpact(
        revenue_ko=None,
        churn_ko="재구매율 ↓",
        cs_cost_ko=None,
    ),
    "packaging_container": BusinessImpact(
        revenue_ko="선물용 구매 ↓",
        churn_ko=None,
        cs_cost_ko=None,
    ),
    "multi_use_lip_cheek_compatibility": BusinessImpact(
        revenue_ko="차별화 포지션 약화",
        churn_ko=None,
        cs_cost_ko=None,
    ),
    "pigmentation": BusinessImpact(
        revenue_ko="첫 구매 전환 ↓",
        churn_ko="재구매율 ↓",
        cs_cost_ko=None,
    ),
    "application_blending": BusinessImpact(
        revenue_ko="신규 전환 ↓",
        churn_ko="재구매율 ↓",
        cs_cost_ko=None,
    ),
    "dryness_skin_texture": BusinessImpact(
        revenue_ko=None,
        churn_ko="민감/건성 고객 이탈 ↑",
        cs_cost_ko=None,
    ),
    "value_price": BusinessImpact(
        revenue_ko="경쟁사 대체로 매출 차감 ↑",
        churn_ko="재구매율 ↓",
        cs_cost_ko=None,
    ),
}


def impact_for(attribute: str) -> str | None:
    """Look up the canonical impact phrase for an attribute key.

    Returns None when the attribute is not in `IMPACTS_KO`. The caller
    decides whether to skip silently (default) or surface the gap.
    Returning None instead of fabricating a generic stub means a
    future attribute addition surfaces as a visible omission rather
    than misleading boilerplate.
    """
    return IMPACTS_KO.get(attribute)


def risk_category_for(attribute: str) -> str | None:
    """Look up the primary business-risk category for an attribute.

    Returns one of the strings in `RISK_CATEGORIES_KO`, or None when
    the attribute is unmapped. Mirrors `impact_for` shape so renderers
    can compose them at the same call site without special-casing.
    """
    return RISK_CATEGORY_KO.get(attribute)


def business_impact_for(attribute: str) -> BusinessImpact | None:
    """Structured business-impact triple for an attribute.

    Returns a `BusinessImpact` whose fields are individually nullable,
    or None when the attribute is unmapped. Renderers should iterate
    over the populated fields and elide absent ones rather than
    treating None as a stub label.
    """
    return BUSINESS_IMPACT_KO.get(attribute)


def attribute_modifier_for(attribute: str) -> float:
    """Return the attribute-level modifier applied to the category base.

    Defaults to 0.0 for any attribute not in `ATTRIBUTE_IMPACT_MODIFIER`
    - including attributes that are in `RISK_CATEGORY_KO` but lack an
    explicit modifier (defensive: a future PR can add a category
    mapping without immediately specifying a modifier, and the
    behavior degrades to "category-only weight").
    """
    return ATTRIBUTE_IMPACT_MODIFIER.get(attribute, 0.0)


# Frequency scaling: continuous linear ramp from 0.5 at freq=0 up to
# 1.5 at freq≥0.15, capped above. Replaces a prior step function
# (0.5 / 1.0 / 1.5 at 0.05 / 0.15 boundaries) which produced score
# discontinuities - a review at 0.0499 prevalence and one at 0.05
# prevalence would jump from 0.5× to 1.0× modifier scale on
# essentially identical evidence. The continuous form retains the
# same endpoint behavior (0.5× at freq=0, 1.5× at freq≥0.15) but
# interpolates smoothly between.
#
#   scale(x) = 0.5 + clamp(x / 0.15, 0, 1)
#
# Endpoints + sample values:
#   x = 0.00  → 0.500
#   x = 0.025 → 0.667
#   x = 0.075 → 1.000   (where the prior step-1.0 band sat)
#   x = 0.15  → 1.500
#   x ≥ 0.15  → 1.500   (capped)
#
# Output is strictly bounded in [0.5, 1.5] by the inner clamp; the
# defensive max(0, ...) handles the (rare) freq_ratio < 0 path so the
# overall function never returns less than 0.5.
#
# With modifier ∈ [-0.5, +0.5] and scale ∈ [0.5, 1.5], the scaled
# modifier sits naturally in [-0.75, +0.75]. The defensive clamp in
# `impact_bonus_for` enforces this contract regardless of future
# tuning drift.
_FREQUENCY_RAMP_END: float = 0.15      # freq_ratio at which scale reaches max
_FREQUENCY_SCALE_MIN: float = 0.5      # scale at freq_ratio=0 (and below)
_FREQUENCY_SCALE_MAX: float = 1.5      # scale at freq_ratio≥_FREQUENCY_RAMP_END
# Backward-compat alias: previously the step function used this name
# as the "default scale when frequency info is missing." That meaning
# is preserved by the no-freq branch in `impact_bonus_for`.
_FREQUENCY_SCALE_DEFAULT: float = 1.0

# Hard cap on the scaled modifier (user-pinned). Locked by tests so a
# future PR widening either modifier or scale ranges can't silently
# overflow this contract.
_MODIFIER_SCALED_CAP: float = 0.75


def _frequency_scale(freq_ratio: float) -> float:
    """Map a frequency ratio (n_negative / n_reviews) to a base scale.

    Continuous linear ramp:  0.5 at freq=0, 1.5 at freq≥0.15, with a
    smooth interpolation between. See the constants block above for
    the formula and rationale.

    This is the *base* scale before sample-size confidence adjustment.
    `impact_bonus_for` blends this with a neutral 1.0 anchor weighted
    by `_confidence_factor(n_reviews)` so small samples don't apply
    the full frequency effect.

    Output is strictly bounded in [0.5, 1.5]. The inner `min` caps the
    upper end; the outer `max` (with 0.0) is a defensive guard for
    pathological negative inputs (which shouldn't occur in practice
    since freq_ratio derives from non-negative counts).
    """
    if _FREQUENCY_RAMP_END <= 0:
        # Degenerate config - fall back to the default scale.
        return _FREQUENCY_SCALE_DEFAULT
    ramp = max(0.0, min(freq_ratio / _FREQUENCY_RAMP_END, 1.0))
    return _FREQUENCY_SCALE_MIN + ramp


# Sample-size confidence adjustment - TWO components.
#
# Global component (corpus size):
#   A small corpus shouldn't fully apply frequency-based scaling.
#   Saturates around n_reviews ≈ 1000.
#
# Attribute-specific component (support size):
#   A rare attribute (n_negative very small) shouldn't over-weight the
#   priority score even when the corpus is large. n_negative IS the
#   number of records supporting the negative claim - the natural
#   reliability proxy for that signal.
#   Saturates around n_negative ≈ 100.
#
#   global_conf  = min(1.0, log(n_reviews + 1) / log(1000))
#   attr_conf    = min(1.0, log(n_negative + 1) / log(100))
#   confidence   = 0.5 * global_conf + 0.5 * attr_conf
#   final_scale  = base_scale * confidence + 1.0 * (1 - confidence)
#
# 50/50 blend chosen to give the attribute-specific component
# meaningful authority while preserving the global corpus-size
# discount. Either component independently being high but the other
# low yields ~0.5 confidence - i.e., neither widespread-corpus alone
# NOR broad-attribute-support alone is sufficient; both must agree.
#
# Behavior under the blended formula:
#   n_rev=1000, n_neg=2   → global=1.00, attr=0.24 → blended ≈ 0.62  (rare in big corpus)
#   n_rev=1000, n_neg=80  → global=1.00, attr=0.95 → blended ≈ 0.98  (broad in big corpus)
#   n_rev=100,  n_neg=10  → global=0.67, attr=0.52 → blended ≈ 0.59  (mid sample)
#   n_rev=10,   n_neg=5   → global=0.35, attr=0.39 → blended ≈ 0.37  (tiny sample)
#   n_rev=0     OR n_neg<=0 → blended = 0.0 (no signal)
#
# Backward compat: when `n_negative` is omitted, the function falls
# back to global-only confidence (the prior pre-PR behavior). The
# blend is only active when both inputs are supplied.
#
# Output bounded: each component ∈ [0, 1], so blended ∈ [0, 1]. The
# downstream blend in `impact_bonus_for` then keeps `final_scale` in
# [0.5, 1.5].
_CONFIDENCE_GLOBAL_REFERENCE_N: int = 1000
_CONFIDENCE_ATTR_REFERENCE_N: int = 100
_CONFIDENCE_GLOBAL_WEIGHT: float = 0.5
_CONFIDENCE_ATTR_WEIGHT: float = 0.5
_CONFIDENCE_NEUTRAL_ANCHOR: float = 1.0   # the value `final` blends toward at low confidence

# Backward-compat alias for the old single-component reference name.
# Some external scripts may import it directly; keeping it pinned to
# the same value preserves their behavior.
_CONFIDENCE_REFERENCE_N: int = _CONFIDENCE_GLOBAL_REFERENCE_N


def _log_ratio_capped(n: int, reference: int) -> float:
    """log(n + 1) / log(reference), capped at [0, 1]. Internal helper
    for the two confidence components."""
    if n <= 0:
        return 0.0
    log_ref = math.log(reference)
    if log_ref <= 0:
        return 1.0   # defensive - degenerate reference
    return min(1.0, math.log(n + 1) / log_ref)


def _confidence_factor(
    n_reviews: int | None,
    *,
    n_negative: int | None = None,
) -> float:
    """Sample-size-aware confidence in [0, 1].

    Two layers, blended 50/50 when both inputs are supplied:
      - Global confidence: log(n_reviews + 1) / log(1000)
      - Attribute confidence: log(n_negative + 1) / log(100)

    Backward-compat: when `n_negative` is None, returns global-only
    confidence (matches the prior pre-PR formula exactly).

    Returns 0.0 when `n_reviews` is None or non-positive (no global
    signal). When `n_negative` ≤ 0, the attribute component
    contributes 0; the function returns half the global confidence
    (since the blend weight is 0.5).
    """
    if n_reviews is None or n_reviews <= 0:
        return 0.0
    global_conf = _log_ratio_capped(
        n_reviews, _CONFIDENCE_GLOBAL_REFERENCE_N,
    )
    if n_negative is None:
        # Legacy single-component path - preserves prior values exactly.
        return global_conf
    attr_conf = _log_ratio_capped(
        n_negative, _CONFIDENCE_ATTR_REFERENCE_N,
    )
    return (
        _CONFIDENCE_GLOBAL_WEIGHT * global_conf
        + _CONFIDENCE_ATTR_WEIGHT * attr_conf
    )


def impact_bonus_for(
    attribute: str,
    *,
    n_negative: int | None = None,
    n_reviews: int | None = None,
) -> float:
    """Return the priority-score impact bonus for an attribute.

    Three-step lookup with optional frequency-aware scaling:
        attribute → risk_category → category_weight (base)
        attribute → attribute_modifier (raw)
        modifier_scaled = modifier * frequency_scale(n_negative / n_reviews)
                          (clamped to [-0.75, +0.75])
        bonus = base + modifier_scaled

    `n_negative` / `n_reviews` are optional. When both are provided AND
    `n_reviews > 0`, the modifier is scaled by the frequency band the
    issue falls into. When either is omitted (legacy callers, ad-hoc
    lookups, tests), `frequency_scale` defaults to 1.0 - i.e., the
    modifier stays at its raw value, preserving the prior pre-PR
    behavior exactly. This is the backward-compat path.

    Unmapped attribute (no risk_category) → 0.0, regardless of whether
    a modifier or frequency exists. Matches the legacy "no impact
    bonus for unknown attributes" fallback.
    """
    cat = RISK_CATEGORY_KO.get(attribute)
    if cat is None:
        return 0.0
    base = IMPACT_BONUS_BY_RISK_CATEGORY.get(cat, 0.0)
    modifier = attribute_modifier_for(attribute)

    if n_negative is None or n_reviews is None or n_reviews <= 0:
        # Legacy / no-freq-info caller - preserve pre-PR semantics.
        scale = _FREQUENCY_SCALE_DEFAULT
    else:
        # Confidence is now BOTH global (n_reviews) AND attribute-specific
        # (n_negative). The 50/50 blend prevents a rare attribute
        # (n_negative tiny) from being over-weighted just because the
        # corpus is large, AND prevents a vocal minority in a tiny
        # corpus from being treated as "widespread."
        base_scale = _frequency_scale(n_negative / n_reviews)
        confidence = _confidence_factor(n_reviews, n_negative=n_negative)
        scale = (base_scale * confidence
                 + _CONFIDENCE_NEUTRAL_ANCHOR * (1.0 - confidence))

    modifier_scaled = modifier * scale
    # Defensive clamp - user-pinned cap. Inputs in design range produce
    # values strictly within this band; the clamp guards against future
    # tuning drift (wider modifier range, new scale tier, etc.).
    if modifier_scaled > _MODIFIER_SCALED_CAP:
        modifier_scaled = _MODIFIER_SCALED_CAP
    elif modifier_scaled < -_MODIFIER_SCALED_CAP:
        modifier_scaled = -_MODIFIER_SCALED_CAP

    return base + modifier_scaled


def generate_impacts(
    insights: list[AttributeInsight],
) -> list[Impact]:
    """Map each negative insight to its canonical impact statement.

    Positive insights are skipped (a strength is not an issue whose
    "consequence" needs explaining). Unmapped attributes are skipped
    silently. Output preserves input order so renderers can keep
    insight ↔ impact ↔ recommendation triplets aligned visually.

    Idempotent: same input list → same output list.
    """
    out: list[Impact] = []
    for ins in insights:
        if ins.kind != "negative":
            continue
        consequence = impact_for(ins.attribute)
        if consequence is None:
            continue
        out.append(Impact(
            attribute=ins.attribute,
            ko_consequence=consequence,
            priority_label=ins.priority_label,
        ))
    return out
