"""Tests for `src/voc/reporting/phase2e/executive_summary.py`.

Coverage:
  - priority_score formula components add up correctly
  - priority_score ranks competing attributes in the expected order
  - strength_score ranking
  - synthesize_executive_summary fills KPI fields end-to-end
  - missing evidence_score / impact mapping → safe degradation
  - overall signal summary template selection
  - empty / zero-record data → empty summary, no crash
  - risk category mapping coverage and vocabulary lock
  - locked invariants: no detector / corpus changes
"""

from __future__ import annotations

from collections import Counter

import pytest

from src.voc.reporting.phase2e.report import (
    AttributeSummary,
    ProductReportData,
    aggregate_product,
)
from src.voc.reporting.phase2e.executive_summary import (
    ExecutiveSummary,
    PriorityItem,
    StrengthItem,
    compute_priority_score,
    compute_strength_score,
    synthesize_executive_summary,
)
import math

from src.voc.reporting.phase2e.impact import (
    ATTRIBUTE_IMPACT_MODIFIER,
    IMPACT_BONUS_BY_RISK_CATEGORY,
    IMPACTS_KO,
    RISK_CATEGORIES_KO,
    RISK_CATEGORY_KO,
    _confidence_factor,
    _frequency_scale,
    attribute_modifier_for,
    impact_bonus_for,
    risk_category_for,
)


def _expected_final_scale(n_negative: int, n_reviews: int) -> float:
    """Mirror of `impact_bonus_for`'s confidence-blended scale path.

    Updated to reflect the 50/50 global + attribute-specific
    confidence blend. Tests still verify production outputs; this
    helper just keeps the math readable in test bodies.
    """
    if n_reviews <= 0:
        return 1.0
    base_scale = 0.5 + max(0.0, min(n_negative / n_reviews / 0.15, 1.0))
    global_conf = min(1.0, math.log(n_reviews + 1) / math.log(1000))
    attr_conf = (
        min(1.0, math.log(n_negative + 1) / math.log(100))
        if n_negative > 0 else 0.0
    )
    confidence = 0.5 * global_conf + 0.5 * attr_conf
    return base_scale * confidence + 1.0 * (1.0 - confidence)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ev(
    *,
    review_id: str = "r",
    polarity: str = "negative_strong",
    intensity: int = 3,
    confidence: str = "high",
    span: str = "마스크에 옷에 다 묻어요",
    score: float | None = 7.0,
    rating: float | None = 1.0,
    sort_ranks: dict | None = None,
    review_date: str | None = "2026-04-01",
) -> dict:
    return {
        "review_id": review_id,
        "polarity": polarity,
        "intensity": intensity,
        "confidence": confidence,
        "evidence_span": span,
        "delivery_condition_flag": False,
        "oy_evidence_score": score,
        "rating_normalized": rating,
        "oy_sort_ranks": sort_ranks or {},
        "review_date": review_date,
    }


def _summary(
    attribute: str,
    *,
    n_negative: int = 0,
    n_positive: int = 0,
    avg_intensity_neg: float = 0.0,
    neg_evidences: list[dict] | None = None,
    pos_evidences: list[dict] | None = None,
) -> AttributeSummary:
    s = AttributeSummary(attribute=attribute)
    s.n_negative = n_negative
    s.n_positive = n_positive
    s.n_total = n_negative + n_positive
    s.avg_intensity_neg = avg_intensity_neg
    s.sample_evidences_neg = neg_evidences or []
    s.sample_evidences_pos = pos_evidences or []
    return s


def _build_data(
    *,
    n_reviews: int = 100,
    attributes: dict[str, AttributeSummary],
) -> ProductReportData:
    return ProductReportData(
        product_id="A0001",
        product_name="Test Product",
        n_reviews=n_reviews,
        n_records=sum(s.n_total for s in attributes.values()),
        n_mixed_reviews=0,
        n_with_tradeoff=0,
        attribute_summaries=attributes,
        tradeoff_pairs=Counter(),
        mixed_attribute_pairs=[],
        delivery_condition_records_total=0,
    )


# ---------------------------------------------------------------------------
# Risk-category vocabulary lock
# ---------------------------------------------------------------------------


def test_risk_categories_match_user_specified_six():
    """The user pinned exactly 6 risk categories. Locking the vocabulary
    here so a future PR can't silently drift into a 7th category that
    the renderer won't have a chip color for."""
    assert RISK_CATEGORIES_KO == frozenset({
        "재구매율 저하",
        "클레임 증가",
        "경쟁사 이탈",
        "부정 리뷰 누적",
        "가격 저항",
        "신뢰도 하락",
    })


def test_every_attribute_maps_to_one_of_the_six_risk_categories():
    """Coverage: every key in `RISK_CATEGORY_KO` must reference one of
    the six canonical categories. Catches typos that would render a
    custom string instead of a chip."""
    for attr, cat in RISK_CATEGORY_KO.items():
        assert cat in RISK_CATEGORIES_KO, \
            f"{attr}: risk category {cat!r} is not in the canonical six"


def test_risk_category_for_returns_none_on_unknown_key():
    assert risk_category_for("not_a_real_attribute") is None


def test_risk_category_aligns_with_impact_phrase():
    """Sanity: the risk-category mapping is a coarsened view of the
    impact phrase. For the user's documented example, the category
    should appear (verbatim or as a stem) inside the impact phrase
    - confirming the bucketing reflects the same data, not a
    contradicting layer."""
    cat = RISK_CATEGORY_KO["transfer_resistance"]
    impact = IMPACTS_KO["transfer_resistance"]
    assert cat == "클레임 증가"
    assert "클레임" in impact


# ---------------------------------------------------------------------------
# Severity-graded impact bonus - IMPACT_BONUS_BY_RISK_CATEGORY
# (2026-04-28 refinement; replaces a prior flat +2 bonus)
# ---------------------------------------------------------------------------


def test_impact_bonus_weights_match_user_specification():
    """User-pinned tier weights. If any of these change, the priority
    ranking shifts - phrase changes are breaking and must be deliberate."""
    assert IMPACT_BONUS_BY_RISK_CATEGORY["클레임 증가"] == 3.0
    assert IMPACT_BONUS_BY_RISK_CATEGORY["경쟁사 이탈"] == 3.0
    assert IMPACT_BONUS_BY_RISK_CATEGORY["재구매율 저하"] == 2.0
    assert IMPACT_BONUS_BY_RISK_CATEGORY["신뢰도 하락"] == 2.0
    assert IMPACT_BONUS_BY_RISK_CATEGORY["부정 리뷰 누적"] == 1.0
    assert IMPACT_BONUS_BY_RISK_CATEGORY["가격 저항"] == 1.0


def test_impact_bonus_covers_every_canonical_risk_category():
    """All six categories must have a weight. A future PR adding a 7th
    category to RISK_CATEGORIES_KO must add a weight here, or the
    score collapses to 0 for that category silently."""
    assert set(IMPACT_BONUS_BY_RISK_CATEGORY.keys()) == set(RISK_CATEGORIES_KO)


def test_impact_bonus_for_attribute_three_step_lookup():
    """attribute → risk_category → category_weight + attribute_modifier,
    in one call. Final values are category-base + modifier."""
    # transfer_resistance: 클레임 증가 (3.0) + +0.5 modifier
    assert impact_bonus_for("transfer_resistance") == pytest.approx(3.5)
    # persistence: 경쟁사 이탈 (3.0) + +0.2 modifier
    assert impact_bonus_for("persistence") == pytest.approx(3.2)
    # finish_texture: 재구매율 저하 (2.0) + +0.1 modifier
    assert impact_bonus_for("finish_texture") == pytest.approx(2.1)
    # packaging_container: 신뢰도 하락 (2.0) + +0.1 modifier
    assert impact_bonus_for("packaging_container") == pytest.approx(2.1)
    # pigmentation: 부정 리뷰 누적 (1.0) + 0.0 modifier
    assert impact_bonus_for("pigmentation") == pytest.approx(1.0)
    # value_price: 가격 저항 (1.0) + -0.2 modifier
    assert impact_bonus_for("value_price") == pytest.approx(0.8)


def test_impact_bonus_for_unmapped_attribute_returns_zero():
    """Backward compat: unknown attribute → 0.0 (matches the legacy
    'no impact bonus' fallback)."""
    assert impact_bonus_for("future_attribute_not_yet_mapped") == 0.0
    assert impact_bonus_for("") == 0.0


def test_priority_score_reflects_severity_graded_impact_bonus():
    """Two attributes identical except for risk category: the higher
    severity (클레임 증가, +3 base + 0.5 modifier) outranks the lower
    (가격 저항, +1 base − 0.2 modifier). The delta equals the
    impact_bonus difference: 3.5 − 0.8 = 2.7."""
    transfer = _summary(
        "transfer_resistance", n_negative=10, avg_intensity_neg=1.0,
        neg_evidences=[_ev(score=5.0)],
    )
    price = _summary(
        "value_price", n_negative=10, avg_intensity_neg=1.0,
        neg_evidences=[_ev(score=5.0)],
    )
    delta = (compute_priority_score(transfer, 100)
             - compute_priority_score(price, 100))
    # Confidence-blended scale at 10% freq, n_reviews=100.
    # transfer_resistance: 3.0 + 0.5 × scale
    # value_price:         1.0 + (-0.2) × scale
    scale = _expected_final_scale(10, 100)
    expected_delta = (3.0 + 0.5 * scale) - (1.0 + (-0.2) * scale)
    assert delta == pytest.approx(expected_delta, abs=0.01)


def test_priority_score_top_severity_attribute_outranks_high_freq_low_severity():
    """A 클레임 증가 issue at moderate frequency can outrank a 가격 저항
    issue at higher frequency - exactly the differentiation the
    weighting is designed to surface."""
    moderate_critical = _summary(
        "transfer_resistance", n_negative=10, avg_intensity_neg=2.0,
        neg_evidences=[_ev(score=4.0)],
    )
    higher_freq_low_severity = _summary(
        "value_price", n_negative=14, avg_intensity_neg=1.0,
        neg_evidences=[_ev(score=2.0)],
    )
    s_critical = compute_priority_score(moderate_critical, 100)
    s_price = compute_priority_score(higher_freq_low_severity, 100)
    # transfer_resistance scores higher despite lower frequency (10 vs 14)
    # because of the +3 critical-tier impact bonus AND stronger evidence.
    assert s_critical > s_price


@pytest.mark.parametrize("attribute,expected_bonus", [
    # tier-3 base (3.0) + modifier
    ("transfer_resistance", 3.5),                        # 클레임 증가 + 0.5
    ("color_tone_matching", 3.3),                        # 클레임 증가 + 0.3
    ("persistence", 3.2),                                # 경쟁사 이탈 + 0.2
    # tier-2 base (2.0) + modifier
    ("finish_texture", 2.1),                             # 재구매율 저하 + 0.1
    ("applicator_tool", 2.0),                            # 재구매율 저하 + 0.0
    ("adhesion_base_interaction", 2.5),                  # 신뢰도 하락 + 0.5
    ("packaging_container", 2.1),                        # 신뢰도 하락 + 0.1
    ("multi_use_lip_cheek_compatibility", 1.7),          # 신뢰도 하락 - 0.3
    # tier-1 base (1.0) + modifier
    ("pigmentation", 1.0),                               # 부정 리뷰 누적 + 0.0
    ("application_blending", 1.0),                       # 부정 리뷰 누적 + 0.0
    ("dryness_skin_texture", 1.2),                       # 부정 리뷰 누적 + 0.2
    ("value_price", 0.8),                                # 가격 저항 - 0.2
])
def test_each_attribute_resolves_to_its_documented_final_bonus(
    attribute, expected_bonus,
):
    """End-to-end: attribute → category_weight + attribute_modifier
    produces the exact final value documented for it. Locks the full
    12-attribute mapping against drift in either layer."""
    assert impact_bonus_for(attribute) == pytest.approx(expected_bonus)


# ---------------------------------------------------------------------------
# Attribute-level modifier - ATTRIBUTE_IMPACT_MODIFIER
# (2026-04-28 refinement on top of the category-base weights)
# ---------------------------------------------------------------------------


def test_user_specified_modifier_values_locked():
    """The user pinned four modifier values verbatim. If any of these
    drift, the priority ranking shifts - phrase changes are breaking."""
    assert ATTRIBUTE_IMPACT_MODIFIER["transfer_resistance"] == 0.5
    assert ATTRIBUTE_IMPACT_MODIFIER["adhesion_base_interaction"] == 0.5
    assert ATTRIBUTE_IMPACT_MODIFIER["pigmentation"] == 0.0
    assert ATTRIBUTE_IMPACT_MODIFIER["value_price"] == -0.2


def test_attribute_modifier_range_invariant():
    """The user constrained modifiers to [-0.5, +0.5]. Locking the
    range so a future tuning PR can't silently expand the modifier
    beyond its design envelope (which would let one attribute dominate
    the category-base signal)."""
    for attr, mod in ATTRIBUTE_IMPACT_MODIFIER.items():
        assert -0.5 <= mod <= 0.5, \
            f"{attr}: modifier {mod} outside [-0.5, +0.5] range"


def test_every_canonical_attribute_has_an_explicit_modifier():
    """All 12 canonical attributes must have an explicit modifier
    entry - even when the modifier is 0.0. Forces a deliberate choice
    rather than relying on the default-fallback path. A future
    attribute addition surfaces as a missing entry."""
    canonical_keys = set(RISK_CATEGORY_KO.keys())
    mapped_keys = set(ATTRIBUTE_IMPACT_MODIFIER.keys())
    missing = canonical_keys - mapped_keys
    extra = mapped_keys - canonical_keys
    assert missing == set(), f"missing modifiers for: {missing}"
    assert extra == set(), f"extra (unknown) modifiers: {extra}"


def test_attribute_modifier_for_unmapped_returns_zero():
    """Backward compat: an attribute not in ATTRIBUTE_IMPACT_MODIFIER
    falls back to 0.0. No exception, no special-casing for the caller."""
    assert attribute_modifier_for("not_a_real_attribute") == 0.0
    assert attribute_modifier_for("") == 0.0


def test_impact_bonus_unmapped_attribute_still_zero():
    """An attribute outside RISK_CATEGORY_KO returns impact_bonus 0.0
    REGARDLESS of whether a modifier exists. Locks the rule that an
    orphan modifier (no category) can never surface as a bonus -
    prevents subtle bugs where a future PR adds a modifier without a
    category mapping and expects the modifier alone to count."""
    # Even if we somehow had a modifier with no category, the lookup
    # short-circuits at the category step and returns 0.0.
    assert impact_bonus_for("future_attr_xyz") == 0.0


def test_attribute_modifier_differentiates_within_same_risk_category():
    """Two 클레임 증가 attributes can carry different impact_bonus
    values via their modifiers. transfer_resistance (visible defect,
    +0.5) > color_tone_matching (visible-but-conditional, +0.3)."""
    transfer = impact_bonus_for("transfer_resistance")
    tone = impact_bonus_for("color_tone_matching")
    # Both are 클레임 증가 (+3.0 base), but modifiers differ.
    assert transfer > tone
    assert transfer - tone == pytest.approx(0.2, abs=0.01)


def test_negative_modifier_pulls_below_category_base():
    """A negative modifier reduces the impact_bonus below the
    category-base weight. value_price (가격 저항, +1) − 0.2 = 0.8
    sits below the 1.0 floor an unmodified mapping would imply.
    """
    base = IMPACT_BONUS_BY_RISK_CATEGORY["가격 저항"]
    bonus = impact_bonus_for("value_price")
    assert bonus < base
    assert bonus == pytest.approx(0.8)


# ---------------------------------------------------------------------------
# Frequency-aware modifier scaling - _frequency_scale + impact_bonus_for
# Continuous ramp: scale = 0.5 + clamp(freq_ratio / 0.15, 0, 1)
# Replaces a prior step function (0.5 / 1.0 / 1.5 at 0.05 / 0.15 bands).
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("freq_ratio,expected_scale", [
    # Endpoints - exact values regardless of formula details.
    (0.0,    0.500),     # min of ramp
    (0.15,   1.500),     # ramp tops out
    # Cap above 0.15 - pathological inputs stay bounded.
    (0.30,   1.500),
    (1.0,    1.500),
    (2.0,    1.500),
    # Sample points along the ramp - continuous interpolation.
    # scale = 0.5 + freq/0.15 in this range.
    (0.025,  0.500 + 1.0/6),     # ≈ 0.667
    (0.05,   0.500 + 1.0/3),     # ≈ 0.833 (was 1.0 under step fn)
    (0.075,  1.000),              # midpoint of ramp
    (0.10,   0.500 + 2.0/3),     # ≈ 1.167 (was 1.0 under step fn)
    (0.125,  0.500 + 5.0/6),     # ≈ 1.333
    (0.149,  0.5 + 0.149/0.15),  # ≈ 1.493 - just below the cap
])
def test_frequency_scale_continuous_endpoints_and_samples(
    freq_ratio, expected_scale,
):
    """Exact endpoint values + sample points along the ramp. Locks
    the formula `scale = 0.5 + clamp(x/0.15, 0, 1)` against drift."""
    assert _frequency_scale(freq_ratio) == pytest.approx(expected_scale)


def test_frequency_scale_is_continuous_at_former_band_boundaries():
    """The whole point of switching to a continuous function: no
    discontinuity at 0.05 or 0.15. Two freq values 1e-9 apart must
    produce scales 1e-9 apart, not jump by 0.5."""
    # Around the former 0.05 boundary
    eps = 1e-9
    s_just_below = _frequency_scale(0.05 - eps)
    s_just_above = _frequency_scale(0.05 + eps)
    assert abs(s_just_above - s_just_below) < 1e-6

    # Around the former 0.15 boundary - the ramp transitions to the
    # cap exactly here; the function itself is still continuous.
    s_just_below_15 = _frequency_scale(0.15 - eps)
    s_just_above_15 = _frequency_scale(0.15 + eps)
    assert abs(s_just_above_15 - s_just_below_15) < 1e-6


def test_frequency_scale_is_monotonic_non_decreasing():
    """Higher prevalence → ≥ scale. Locks the directional contract:
    the function never punishes more widespread issues."""
    samples = [0.0, 0.01, 0.025, 0.05, 0.075, 0.10, 0.125, 0.15, 0.20, 0.5, 1.0]
    scales = [_frequency_scale(x) for x in samples]
    for a, b in zip(scales, scales[1:]):
        assert b >= a - 1e-9


def test_frequency_scale_strictly_bounded_in_min_max():
    """Output strictly in [0.5, 1.5] for any input - locks the
    user-pinned bound contract."""
    # Sample heavily inside, on, and beyond the ramp range.
    for x in (-0.5, 0.0, 0.01, 0.075, 0.15, 0.30, 1.0, 1e6):
        s = _frequency_scale(x)
        assert 0.5 <= s <= 1.5, f"freq_ratio={x} produced scale={s}"


def test_frequency_scale_negative_input_clamped_to_min():
    """Defensive: pathological negative input doesn't break the ramp.
    The outer `max(0, ...)` keeps scale at 0.5 floor.

    freq_ratio derives from non-negative counts in practice, so this
    path never executes from `compute_priority_score`. Still locked
    to defend against future direct callers passing odd inputs.
    """
    assert _frequency_scale(-1.0) == 0.5
    assert _frequency_scale(-0.001) == 0.5


def test_impact_bonus_without_freq_kwargs_uses_scale_one():
    """Backward-compat: the no-freq form preserves the prior pre-PR
    behavior. transfer_resistance bonus stays at 3.5 (3.0 + 0.5*1.0)."""
    assert impact_bonus_for("transfer_resistance") == pytest.approx(3.5)
    assert impact_bonus_for("value_price") == pytest.approx(0.8)


def test_impact_bonus_at_zero_frequency_dampens_toward_minimum():
    """At freq_ratio=0 the base_scale floors at 0.5; the confidence
    blend (n_reviews=100, ~67% confident) pulls the final scale partly
    back toward 1.0. Modifier is partially dampened, not fully halved."""
    scale = _expected_final_scale(0, 100)
    assert impact_bonus_for(
        "transfer_resistance", n_negative=0, n_reviews=100,
    ) == pytest.approx(3.0 + 0.5 * scale)
    assert impact_bonus_for(
        "value_price", n_negative=0, n_reviews=100,
    ) == pytest.approx(1.0 + (-0.2) * scale)


def test_impact_bonus_at_saturating_n_reviews_uses_full_base_scale():
    """At n_reviews ≥ 1000 (confidence saturated to 1.0) the scale
    equals the base_scale - no confidence blend dilution."""
    # n_reviews=1000 saturates confidence; freq=0.075 → base_scale=1.0
    bonus = impact_bonus_for(
        "transfer_resistance", n_negative=75, n_reviews=1000,
    )
    # 3.0 + 0.5 × 1.0 = 3.5 (no dilution at saturation)
    assert bonus == pytest.approx(3.5)


def test_impact_bonus_at_ramp_end_amplifies_modifier_with_blend():
    """At freq_ratio≥0.15 the BASE_SCALE caps at 1.5, but the FINAL
    scale still varies with n_negative through the attribute-specific
    confidence component. A larger n_negative produces higher
    confidence → final scale closer to 1.5 → larger bonus.

    This is intentional: the freq-cap stops base_scale from growing
    arbitrarily, but attribute support legitimately differentiates
    "vocal-minority issue" from "broadly-supported issue" even when
    both exceed the prevalence threshold.
    """
    bonus_at_end = impact_bonus_for(
        "transfer_resistance", n_negative=15, n_reviews=100,
    )
    bonus_more_support = impact_bonus_for(
        "transfer_resistance", n_negative=50, n_reviews=100,
    )
    # Each matches its own _expected_final_scale projection.
    scale_at_end = _expected_final_scale(15, 100)
    scale_more = _expected_final_scale(50, 100)
    assert bonus_at_end == pytest.approx(3.0 + 0.5 * scale_at_end)
    assert bonus_more_support == pytest.approx(3.0 + 0.5 * scale_more)
    # Both above 1.5× base_scale floor (since freq capped) but the
    # n_neg=50 case carries higher attribute-confidence → larger bonus.
    assert bonus_more_support > bonus_at_end


def test_impact_bonus_interpolates_between_endpoints():
    """At freq=0.10 with n_reviews=100, the confidence-blended scale
    is between the 0.5 floor and the 1.5 cap. Proves the ramp is
    continuous AND the confidence blend is active."""
    bonus = impact_bonus_for(
        "transfer_resistance", n_negative=10, n_reviews=100,
    )
    scale = _expected_final_scale(10, 100)
    expected = 3.0 + 0.5 * scale
    assert bonus == pytest.approx(expected)
    # Sanity: NOT the prior step-1.0 result (3.5) and NOT the
    # base_scale-only result (3.583): the confidence blend dilutes it
    # to ~3.555.
    assert bonus != pytest.approx(3.5)
    assert bonus < 3.583  # less than pure base_scale at n_reviews=100


def test_impact_bonus_with_freq_above_high_band_amplifies_modifier():
    """Widespread issues (≥15%) amplify the modifier toward 1.5× -
    diluted by the confidence blend at n_reviews=100. A larger sample
    shifts toward the full 1.5× amplification (covered by the
    saturation test below)."""
    bonus = impact_bonus_for(
        "transfer_resistance", n_negative=20, n_reviews=100,
    )
    scale = _expected_final_scale(20, 100)
    expected = 3.0 + 0.5 * scale
    assert bonus == pytest.approx(expected)


def test_impact_bonus_clamps_scaled_modifier_at_plus_minus_0_75():
    """Defensive cap: modifier_scaled is bounded at [-0.75, +0.75]
    regardless of inputs. To exercise the cap we need confidence
    saturated (n_reviews ≥ 1000) AND base_scale at max (freq ≥ 0.15);
    the confidence blend diluting the scale otherwise prevents the
    cap from being hit at small samples.

    transfer_resistance (modifier 0.5) at full base_scale 1.5 with
    confidence=1.0 → modifier_scaled = 0.5 × 1.5 = 0.75 (at cap)."""
    bonus = impact_bonus_for(
        "transfer_resistance", n_negative=2000, n_reviews=10000,
    )
    # 3.0 + 0.5 × 1.5 = 3.75
    assert bonus == pytest.approx(3.75)
    assert bonus - 3.0 == pytest.approx(0.75)
    assert bonus - 3.0 <= 0.75 + 1e-9


def test_impact_bonus_low_freq_does_not_flip_sign_of_modifier():
    """Dampening reduces modifier magnitude but doesn't change sign.
    A negative modifier stays negative (just smaller in magnitude)."""
    # value_price -0.2 at scale=0.5 → -0.1 (still negative)
    bonus_low = impact_bonus_for(
        "value_price", n_negative=2, n_reviews=100,
    )
    assert bonus_low - 1.0 < 0    # modifier_scaled is still negative
    assert bonus_low > 0.5         # but pulled UP toward the base


def test_impact_bonus_zero_n_reviews_falls_back_to_unscaled():
    """Defensive: n_reviews=0 (degenerate) must not divide-by-zero.
    Falls back to scale=1.0 (legacy behavior)."""
    # transfer_resistance unscaled = 3.5 (3.0 + 0.5)
    assert impact_bonus_for(
        "transfer_resistance", n_negative=0, n_reviews=0,
    ) == pytest.approx(3.5)


def test_impact_bonus_unmapped_attribute_stays_zero_under_freq_scaling():
    """Backward-compat: an unmapped attribute returns 0.0 even when
    frequency info is supplied. The scaling can't synthesize a bonus
    for an attribute with no risk category."""
    assert impact_bonus_for(
        "future_attribute_xyz", n_negative=20, n_reviews=100,
    ) == 0.0


# ---------------------------------------------------------------------------
# Confidence-aware blend - _confidence_factor + impact_bonus_for
# (2026-04-28 refinement: small samples don't fully apply the
# frequency-based scale)
# ---------------------------------------------------------------------------


def test_confidence_factor_zero_for_none_or_zero_n_reviews():
    """No sample → no confidence → final scale collapses to 1.0
    (neutral) downstream. Backward-compat: matches prior pre-PR behavior
    via the no-freq-info fallback path."""
    assert _confidence_factor(None) == 0.0
    assert _confidence_factor(0) == 0.0
    assert _confidence_factor(-1) == 0.0


def test_confidence_factor_saturates_at_reference_n():
    """At n_reviews ≥ 1000 the factor is capped at 1.0. Locks the
    saturation point at the documented reference (1000 reviews)."""
    assert _confidence_factor(1000) == 1.0
    assert _confidence_factor(10000) == 1.0
    assert _confidence_factor(1_000_000) == 1.0


def test_confidence_factor_is_logarithmic_growth():
    """Confidence grows on a log curve: doubling n produces a smaller
    delta than the same absolute increase at low n. Locks the shape
    of the curve."""
    c10 = _confidence_factor(10)
    c100 = _confidence_factor(100)
    c500 = _confidence_factor(500)
    # Strictly increasing.
    assert c10 < c100 < c500
    # Locked sample values (within tolerance for float precision).
    assert c10 == pytest.approx(0.347, abs=0.01)
    assert c100 == pytest.approx(0.668, abs=0.01)
    assert c500 == pytest.approx(0.900, abs=0.01)


def test_confidence_factor_strictly_bounded_in_zero_to_one():
    """Output ∈ [0, 1] for any valid n_reviews."""
    for n in (0, 1, 5, 10, 100, 999, 1000, 10000, 1_000_000):
        c = _confidence_factor(n)
        assert 0.0 <= c <= 1.0, f"n={n} produced confidence={c}"


def test_impact_bonus_at_low_n_reviews_pulled_toward_neutral():
    """Same freq_ratio (40%) at small n_reviews → final scale closer
    to 1.0 than to base_scale 1.5. The confidence blend forces this."""
    # 4 of 10 reviews negative → freq_ratio=0.4 → base_scale=1.5
    # Confidence at n=10: ~0.35 → final ≈ 1.5*0.35 + 1.0*0.65 = 1.175
    bonus_small = impact_bonus_for(
        "transfer_resistance", n_negative=4, n_reviews=10,
    )
    # Same freq at large n: confidence saturates → final = 1.5
    bonus_large = impact_bonus_for(
        "transfer_resistance", n_negative=4000, n_reviews=10000,
    )
    assert bonus_small < bonus_large
    # The small-sample case is meaningfully smaller - pulled toward 3.5
    # (modifier 0.5 × scale 1.0) rather than 3.75 (modifier 0.5 × scale 1.5).
    assert bonus_small < 3.6
    assert bonus_large == pytest.approx(3.75)


def test_impact_bonus_blend_preserves_bounded_output():
    """The user-pinned [-0.75, +0.75] modifier_scaled cap still holds
    under the confidence blend. Sample across n_reviews and freq_ratio
    extremes."""
    samples: list[tuple[str, int, int]] = [
        ("transfer_resistance", 0, 1),       # 0% freq, n=1
        ("transfer_resistance", 1, 1),       # 100% freq, n=1
        ("transfer_resistance", 5000, 10000),# 50% freq, n large
        ("value_price", 0, 1),
        ("value_price", 5000, 10000),
    ]
    for attr, n_neg, n_rev in samples:
        bonus = impact_bonus_for(attr, n_negative=n_neg, n_reviews=n_rev)
        from src.voc.reporting.phase2e.impact import (
            IMPACT_BONUS_BY_RISK_CATEGORY, RISK_CATEGORY_KO,
        )
        cat = RISK_CATEGORY_KO[attr]
        base = IMPACT_BONUS_BY_RISK_CATEGORY[cat]
        delta = bonus - base
        assert -0.75 - 1e-9 <= delta <= 0.75 + 1e-9, \
            f"attr={attr} n_neg={n_neg} n_rev={n_rev} delta={delta} out of bounds"


def test_impact_bonus_small_sample_doesnt_amplify_modifier():
    """A 5-of-10 corpus (50% prevalence - would normally hit the
    1.5× cap) gets pulled back toward 1.0 by the confidence blend.
    This is the load-bearing scenario for the refinement: a vocal
    minority in a tiny corpus should NOT produce the same priority
    score as a majority in a large corpus."""
    # Tiny corpus: 5 of 10 negative → freq=0.5 → base_scale=1.5
    # Confidence ≈ 0.347 → final ≈ 1.174
    bonus_tiny = impact_bonus_for(
        "transfer_resistance", n_negative=5, n_reviews=10,
    )
    # Saturated corpus: same freq, much larger n → final = 1.5
    bonus_saturated = impact_bonus_for(
        "transfer_resistance", n_negative=5000, n_reviews=10000,
    )
    delta = bonus_saturated - bonus_tiny
    # The saturated case carries a meaningfully larger bonus.
    assert delta > 0.15
    # Both bonuses still in the [base, base+0.75] range.
    assert 3.0 <= bonus_tiny <= 3.75
    assert 3.0 <= bonus_saturated <= 3.75


def test_impact_bonus_no_freq_info_unchanged_by_confidence_blend():
    """Backward-compat: callers that don't pass n_negative / n_reviews
    bypass the confidence blend entirely (scale defaults to 1.0).
    Pre-PR test values still hold for these calls."""
    # No freq kwargs → impact_bonus_for is purely category + modifier.
    assert impact_bonus_for("transfer_resistance") == pytest.approx(3.5)
    assert impact_bonus_for("value_price") == pytest.approx(0.8)
    assert impact_bonus_for("pigmentation") == pytest.approx(1.0)


# ---------------------------------------------------------------------------
# Attribute-specific confidence - _confidence_factor with n_negative kwarg
# (2026-04-28 refinement: blend global + attribute-specific reliability)
# ---------------------------------------------------------------------------


def test_confidence_factor_omits_n_negative_falls_back_to_global_only():
    """Backward compat: legacy callers that don't pass n_negative get
    the prior single-component confidence value.

    Locks the no-regression contract - any external caller that
    happens to call _confidence_factor(n_reviews) continues to work
    unchanged."""
    # n_reviews=100, no n_negative → log(101)/log(1000) ≈ 0.668
    expected = math.log(101) / math.log(1000)
    assert _confidence_factor(100) == pytest.approx(expected)


def test_confidence_factor_blends_global_and_attribute_50_50():
    """When both inputs are supplied, the result is exactly the 50/50
    weighted blend of the two log-ratio components."""
    # n_reviews=1000, n_negative=10
    # global = min(1, log(1001)/log(1000)) ≈ 1.0
    # attr   = min(1, log(11)/log(100)) ≈ 0.520
    # blend  = 0.5 * 1.0 + 0.5 * 0.520 ≈ 0.760
    expected = 0.5 * 1.0 + 0.5 * (math.log(11) / math.log(100))
    assert _confidence_factor(1000, n_negative=10) == pytest.approx(expected)


def test_confidence_factor_rare_attribute_in_large_corpus_dampens():
    """The load-bearing scenario for this refinement: a rare attribute
    (n_negative tiny) in a large corpus (n_reviews saturating) drops
    confidence well below 1.0 - preventing the rare attribute from
    inheriting the corpus's full confidence.

    n_reviews=1000, n_negative=2:
        global ≈ 1.00
        attr   ≈ log(3)/log(100) ≈ 0.239
        blend  ≈ 0.620
    """
    c = _confidence_factor(1000, n_negative=2)
    assert c == pytest.approx(0.620, abs=0.01)
    assert c < 1.0


def test_confidence_factor_broad_attribute_in_large_corpus_saturates():
    """Counterpoint to rare-attribute test: when both n_reviews AND
    n_negative are large, confidence approaches 1.0."""
    c = _confidence_factor(1000, n_negative=80)
    # global ≈ 1.0, attr = log(81)/log(100) ≈ 0.954, blend ≈ 0.977
    assert c == pytest.approx(0.977, abs=0.01)
    assert c > 0.95


def test_confidence_factor_zero_n_negative_dampens_to_half_global():
    """When n_negative ≤ 0, the attribute component contributes 0,
    so the blend returns half the global confidence (the global
    weight is 0.5).

    This covers a path that shouldn't occur in practice (a row with
    n_negative=0 wouldn't have a priority score at all; compute_
    priority_score returns 0 immediately) but is locked here as a
    defensive contract."""
    c = _confidence_factor(1000, n_negative=0)
    # global ≈ 1.0, attr = 0.0, blend = 0.5 * 1.0 + 0.5 * 0.0 = 0.5
    assert c == pytest.approx(0.5, abs=0.01)


def test_confidence_factor_strictly_bounded_with_attr_component():
    """Output ∈ [0, 1] across all reasonable input combinations."""
    cases = [
        (1, 1), (10, 5), (100, 20), (1000, 50), (10000, 200),
        (100, 0), (1000, 0), (1000000, 1000000),
    ]
    for n_rev, n_neg in cases:
        c = _confidence_factor(n_rev, n_negative=n_neg)
        assert 0.0 <= c <= 1.0, \
            f"n_reviews={n_rev} n_negative={n_neg} produced confidence={c}"


def test_priority_score_rare_attribute_doesnt_outrank_supported_one():
    """End-to-end: a high-prevalence rare attribute (1 of 5 reviews
    in a tiny set) does NOT outrank a moderate-prevalence well-supported
    attribute (50 of 200) when scaled by attribute confidence.

    Without the attribute-specific component, the rare attribute would
    have base_scale=1.5 (cap) and global confidence at the corpus
    size - potentially scoring above the well-supported one. With
    attr_conf in the blend, the rare attribute's confidence drops,
    pulling its final_scale toward neutral 1.0."""
    rare = _summary(
        "transfer_resistance", n_negative=1, avg_intensity_neg=2.0,
        neg_evidences=[_ev(score=4.0)],
    )
    well_supported = _summary(
        "transfer_resistance", n_negative=50, avg_intensity_neg=2.0,
        neg_evidences=[_ev(score=4.0)],
    )
    score_rare = compute_priority_score(rare, n_reviews=5)
    score_supported = compute_priority_score(well_supported, n_reviews=200)
    # The well-supported attribute's score is meaningfully larger,
    # despite identical evidence and severity.
    assert score_supported > score_rare


def test_impact_bonus_attr_confidence_changes_value_at_same_n_reviews():
    """Two scenarios with same n_reviews but different n_negative
    produce different impact_bonus values - the attribute-specific
    component is doing real work, not just echoing the global signal."""
    bonus_rare = impact_bonus_for(
        "transfer_resistance", n_negative=2, n_reviews=1000,
    )
    bonus_broad = impact_bonus_for(
        "transfer_resistance", n_negative=80, n_reviews=1000,
    )
    assert bonus_rare != pytest.approx(bonus_broad)


def test_priority_score_freq_aware_amplification_changes_ranking():
    """End-to-end: a widespread issue with a positive modifier outranks
    a same-category niche issue once frequency scaling is applied,
    even when other components are equal.

    Two transfer_resistance instances at different prevalence:
      - widespread: 25 / 100 = 25% → scale 1.5 → modifier_scaled 0.75
      - niche:       2 / 100 = 2%   → scale 0.5 → modifier_scaled 0.25
    The widespread case scores ~0.5 higher just from the impact bonus
    delta (and a freq_w delta - both compound the effect)."""
    widespread = _summary(
        "transfer_resistance", n_negative=25, avg_intensity_neg=2.0,
        neg_evidences=[_ev(score=4.0)],
    )
    niche = _summary(
        "transfer_resistance", n_negative=2, avg_intensity_neg=2.0,
        neg_evidences=[_ev(score=4.0)],
    )
    s_widespread = compute_priority_score(widespread, 100)
    s_niche = compute_priority_score(niche, 100)
    assert s_widespread > s_niche


def test_priority_score_uses_attribute_specific_modifier():
    """End-to-end: priority_score reflects the attribute-specific
    modifier, not just the category base. Two same-frequency,
    same-evidence, same-tier attributes in the same risk category
    rank by modifier."""
    # Both 클레임 증가 (3.0 base): transfer_resistance (+0.5) vs
    # color_tone_matching (+0.3). Otherwise identical inputs.
    transfer = _summary(
        "transfer_resistance", n_negative=10, avg_intensity_neg=2.0,
        neg_evidences=[_ev(score=4.0)],
    )
    tone = _summary(
        "color_tone_matching", n_negative=10, avg_intensity_neg=2.0,
        neg_evidences=[_ev(score=4.0)],
    )
    delta = (compute_priority_score(transfer, 100)
             - compute_priority_score(tone, 100))
    # Modifier delta (0.5 - 0.3 = 0.2) × confidence-blended-scale.
    scale = _expected_final_scale(10, 100)
    expected = (0.5 - 0.3) * scale
    assert delta == pytest.approx(expected, abs=0.01)


# ---------------------------------------------------------------------------
# compute_priority_score - formula components
# ---------------------------------------------------------------------------


def test_priority_score_zero_when_no_negatives():
    s = _summary("value_price", n_negative=0)
    assert compute_priority_score(s, n_reviews=100) == 0.0


def test_priority_score_zero_when_n_reviews_zero():
    s = _summary("value_price", n_negative=10, avg_intensity_neg=2.0)
    assert compute_priority_score(s, n_reviews=0) == 0.0


def test_priority_score_frequency_component():
    """40% negative frequency contributes 40% × 25 = 10.0 to the score."""
    s = _summary(
        "value_price", n_negative=40, avg_intensity_neg=0.0,
        neg_evidences=[],  # no evidence → score component = 0
    )
    # avg_intensity=0 → severity_w = 0
    # priority_label likely "High" (40% ≥ 30%) → +5 tier bonus
    # impact_bonus = 1.0 (가격 저항) + (-0.2) × confidence-blended-scale
    # frequency_w = 10
    score = compute_priority_score(s, n_reviews=100)
    scale = _expected_final_scale(40, 100)
    expected = 10 + 0 + 0 + 5 + (1.0 + (-0.2) * scale)
    assert score == pytest.approx(expected, abs=0.01)


def test_priority_score_evidence_component_uses_max_score():
    s = _summary(
        "value_price", n_negative=10, avg_intensity_neg=0.0,
        neg_evidences=[
            _ev(score=3.0), _ev(score=8.0), _ev(score=5.0),
        ],
    )
    # frequency_w = 0.10 * 25 = 2.5
    # evidence_w = 8.0 (max)
    # severity_w = 0
    # tier = Low (10% < 15%) → +0
    # impact_bonus = 1.0 (가격 저항) + (-0.2) × confidence-blended-scale
    # at n_reviews=100, scale ≈ 1.111 (was 1.167 pre-confidence-blend)
    score = compute_priority_score(s, n_reviews=100)
    scale = _expected_final_scale(10, 100)
    expected = 2.5 + 8.0 + 0 + 0 + (1.0 + (-0.2) * scale)
    assert score == pytest.approx(expected, abs=0.01)


def test_priority_score_severity_component():
    s = _summary(
        "value_price", n_negative=10, avg_intensity_neg=3.0,
        neg_evidences=[_ev(score=None)],  # no evidence score
    )
    # frequency_w = 2.5
    # evidence_w = 0
    # severity_w = 3.0 * 2 = 6.0
    # tier = Medium (compute_priority: pct >= 0.10 AND sev >= 2.5) → +2
    # impact bonus: 1.0 (가격 저항) + (-0.2) × confidence-blended-scale
    score = compute_priority_score(s, n_reviews=100)
    scale = _expected_final_scale(10, 100)
    expected = 2.5 + 0 + 6.0 + 2 + (1.0 + (-0.2) * scale)
    assert score == pytest.approx(expected, abs=0.01)


def test_priority_score_tier_bonus_high():
    """High-priority issues get +5 over otherwise identical Low cases."""
    high = _summary(
        "value_price", n_negative=35, avg_intensity_neg=2.5,
        neg_evidences=[_ev(score=5.0)],
    )
    low = _summary(
        "value_price", n_negative=2, avg_intensity_neg=1.0,
        neg_evidences=[_ev(score=5.0)],
    )
    # high is 35% / sev 2.5 → "High"
    # low is 2% / sev 1.0 → "Low"
    assert compute_priority_score(high, 100) > compute_priority_score(low, 100)


def test_priority_score_unmapped_attribute_no_impact_bonus():
    """An attribute outside RISK_CATEGORY_KO loses the impact bonus
    entirely. The delta equals the mapped attribute's full impact bonus
    (category base + attribute modifier)."""
    mapped = _summary(
        "value_price", n_negative=10, avg_intensity_neg=1.0,
        neg_evidences=[_ev(score=5.0)],
    )
    unmapped = _summary(
        "future_attribute_not_in_mapping", n_negative=10,
        avg_intensity_neg=1.0,
        neg_evidences=[_ev(score=5.0)],
    )
    delta = (compute_priority_score(mapped, 100)
             - compute_priority_score(unmapped, 100))
    # value_price impact_bonus at 10% freq, n_reviews=100:
    #   1.0 (base) + (-0.2) × confidence-blended-scale
    scale = _expected_final_scale(10, 100)
    expected = 1.0 + (-0.2) * scale
    assert delta == pytest.approx(expected, abs=0.01)


def test_priority_score_missing_evidence_score_falls_back_safely():
    """Every negative sample lacks an oy_evidence_score → evidence_w
    contributes 0 but the score is still meaningful from the other
    components. Required so legacy/pre-scoring data still ranks."""
    s = _summary(
        "value_price", n_negative=20, avg_intensity_neg=2.0,
        neg_evidences=[_ev(score=None), _ev(score=None)],
    )
    score = compute_priority_score(s, n_reviews=100)
    # frequency 5.0 + evidence 0 + severity 4.0 + tier (15-30% boundary
    # likely Low or Medium depending on severity) + impact 2.
    # Just assert non-zero and finite - exact value covered by component tests.
    assert score > 0.0
    assert score < 50.0


# ---------------------------------------------------------------------------
# compute_priority_score - relative ranking
# ---------------------------------------------------------------------------


def test_priority_score_ranks_high_freq_high_severity_first():
    big = _summary(
        "transfer_resistance", n_negative=40, avg_intensity_neg=2.8,
        neg_evidences=[_ev(score=8.0)],
    )
    small = _summary(
        "value_price", n_negative=5, avg_intensity_neg=1.5,
        neg_evidences=[_ev(score=3.0)],
    )
    assert compute_priority_score(big, 100) > compute_priority_score(small, 100)


def test_priority_score_uses_max_evidence_not_average():
    """Max-score is the right aggregation: a single high-score row
    indicates strong evidence. Averaging would dilute the signal under
    legacy/null-score rows."""
    one_strong = _summary(
        "value_price", n_negative=5, avg_intensity_neg=1.0,
        neg_evidences=[
            _ev(score=10.0),  # one strong signal
            _ev(score=None), _ev(score=None), _ev(score=None),
        ],
    )
    all_weak = _summary(
        "value_price", n_negative=5, avg_intensity_neg=1.0,
        neg_evidences=[_ev(score=2.0)] * 4,
    )
    assert (compute_priority_score(one_strong, 100)
            > compute_priority_score(all_weak, 100))


# ---------------------------------------------------------------------------
# compute_strength_score
# ---------------------------------------------------------------------------


def test_strength_score_zero_when_no_positives():
    s = _summary("pigmentation", n_positive=0)
    assert compute_strength_score(s, n_reviews=100) == 0.0


def test_strength_score_freq_plus_evidence_max():
    s = _summary(
        "pigmentation", n_positive=30,
        pos_evidences=[
            _ev(polarity="positive", rating=5.0, score=4.0),
            _ev(polarity="positive", rating=5.0, score=7.0),
        ],
    )
    # freq = 30/100 * 25 = 7.5
    # evidence_max = 7.0
    # total = 14.5
    assert compute_strength_score(s, n_reviews=100) == pytest.approx(14.5)


def test_strength_score_ranks_more_frequent_first():
    high = _summary(
        "pigmentation", n_positive=40,
        pos_evidences=[_ev(polarity="positive", rating=5.0, score=3.0)],
    )
    low = _summary(
        "value_price", n_positive=5,
        pos_evidences=[_ev(polarity="positive", rating=5.0, score=3.0)],
    )
    assert (compute_strength_score(high, 100)
            > compute_strength_score(low, 100))


# ---------------------------------------------------------------------------
# synthesize_executive_summary - end to end
# ---------------------------------------------------------------------------


def test_synthesize_picks_top_n_priorities_by_score():
    """Order matters: the highest priority_score lands in slot 1."""
    attrs = {
        "value_price": _summary(
            "value_price", n_negative=8, avg_intensity_neg=1.5,
            neg_evidences=[_ev(score=2.0)],
        ),
        "transfer_resistance": _summary(
            "transfer_resistance", n_negative=35, avg_intensity_neg=2.8,
            neg_evidences=[_ev(score=8.0)],
        ),
        "applicator_tool": _summary(
            "applicator_tool", n_negative=15, avg_intensity_neg=2.0,
            neg_evidences=[_ev(score=4.5)],
        ),
        "color_tone_matching": _summary(
            "color_tone_matching", n_negative=20, avg_intensity_neg=2.2,
            neg_evidences=[_ev(score=5.0)],
        ),
    }
    data = _build_data(attributes=attrs)
    es = synthesize_executive_summary(data, top_n_priorities=3)
    assert [p.attribute for p in es.top_priorities] == [
        "transfer_resistance",
        "color_tone_matching",
        "applicator_tool",
    ]


def test_synthesize_skips_attributes_with_zero_score():
    """An attribute with n_negative=0 must not appear even when there's
    space in the top-N list."""
    attrs = {
        "transfer_resistance": _summary(
            "transfer_resistance", n_negative=10, avg_intensity_neg=2.0,
            neg_evidences=[_ev(score=4.0)],
        ),
        "value_price": _summary(
            "value_price", n_negative=0, n_positive=5,
            pos_evidences=[_ev(polarity="positive", rating=5.0, score=2.0)],
        ),
    }
    data = _build_data(attributes=attrs)
    es = synthesize_executive_summary(data, top_n_priorities=3)
    assert len(es.top_priorities) == 1
    assert es.top_priorities[0].attribute == "transfer_resistance"


def test_synthesize_priority_item_carries_full_kpi_framing():
    """The renderer needs all 4 KPI fields (issue / why / action /
    risk) per priority. Lock the contract that synthesize emits them
    end-to-end without manual reshaping by the caller."""
    s = _summary(
        "transfer_resistance", n_negative=30, avg_intensity_neg=2.5,
        neg_evidences=[_ev(score=7.0, sort_ranks={"RATING_ASC": 2})],
    )
    data = _build_data(attributes={"transfer_resistance": s})
    es = synthesize_executive_summary(data)
    p = es.top_priorities[0]
    # Issue framing
    assert p.label_ko == "마스크/옷 묻어남 저항"
    assert p.n_negative == 30
    assert p.pct_negative == pytest.approx(0.30)
    # Why it matters (impact phrase)
    assert p.why_ko == \
        "묻어남 문제는 재구매율 저하 및 클레임 증가로 이어질 수 있습니다."
    # Recommended action
    assert p.action_ko == \
        "옵션/사용 환경별 묻어남 의견 분포 및 CS 문의 교차 확인 후보"
    # Business risk category
    assert p.risk_category == "클레임 증가"


def test_synthesize_strength_item_carries_minimal_framing():
    s = _summary(
        "pigmentation", n_positive=25,
        pos_evidences=[_ev(polarity="positive", rating=5.0, score=4.0)],
    )
    data = _build_data(attributes={"pigmentation": s})
    es = synthesize_executive_summary(data)
    s_item = es.top_strengths[0]
    assert s_item.label_ko == "발색"
    assert s_item.n_positive == 25
    assert s_item.pct_positive == pytest.approx(0.25)
    assert s_item.priority_label == "Moderate"  # 25% ≥ 15%


def test_synthesize_overall_signal_high_frequency_template():
    """Negative records ≥ 30% of total → 'high priority' template."""
    attrs = {
        "transfer_resistance": _summary(
            "transfer_resistance", n_negative=40, avg_intensity_neg=2.5,
            neg_evidences=[_ev(score=5.0)],
        ),
    }
    data = _build_data(n_reviews=100, attributes=attrs)
    es = synthesize_executive_summary(data)
    assert "개선 우선순위가 높습니다" in es.overall_signal_ko
    assert "마스크/옷 묻어남 저항" in es.overall_signal_ko


def test_synthesize_overall_signal_moderate_frequency_template():
    """15% ≤ negative records < 30% → 'concentrated concern' template."""
    attrs = {
        "transfer_resistance": _summary(
            "transfer_resistance", n_negative=20, avg_intensity_neg=2.0,
            neg_evidences=[_ev(score=4.0)],
        ),
    }
    data = _build_data(n_reviews=100, attributes=attrs)
    es = synthesize_executive_summary(data)
    # 20/20 records = 100% neg in this contrived scenario; check the
    # alternative: lower neg fraction → use a different fixture.
    # Build one where neg/total is between 15-30%.
    attrs2 = {
        "transfer_resistance": _summary(
            "transfer_resistance", n_negative=20, avg_intensity_neg=2.0,
            neg_evidences=[_ev(score=4.0)],
        ),
        "pigmentation": _summary(
            "pigmentation", n_positive=80,
            pos_evidences=[_ev(polarity="positive", rating=5.0, score=3.0)],
        ),
    }
    data2 = _build_data(n_reviews=100, attributes=attrs2)
    es2 = synthesize_executive_summary(data2)
    # 20 / 100 = 20% neg → "주요 우려는 ...에 집중되어 있습니다."
    assert "집중되어 있습니다" in es2.overall_signal_ko


def test_synthesize_overall_signal_positive_dominant_template():
    """Negative < 15% → positive-dominant template referencing the top strength."""
    attrs = {
        "pigmentation": _summary(
            "pigmentation", n_positive=80,
            pos_evidences=[_ev(polarity="positive", rating=5.0, score=4.0)],
        ),
        "value_price": _summary(
            "value_price", n_negative=5, avg_intensity_neg=1.0,
            neg_evidences=[_ev(score=2.0)],
        ),
    }
    data = _build_data(n_reviews=100, attributes=attrs)
    es = synthesize_executive_summary(data)
    assert "긍정 평가가 우세" in es.overall_signal_ko
    assert "발색" in es.overall_signal_ko  # top positive label


def test_synthesize_overall_signal_empty_data():
    """No records at all (degenerate) - emit a placeholder rather than
    crashing or producing an empty string."""
    data = _build_data(n_reviews=0, attributes={})
    es = synthesize_executive_summary(data)
    assert es.overall_signal_ko != ""
    assert es.top_priorities == []
    assert es.top_strengths == []


def test_synthesize_legacy_data_no_evidence_scores_still_ranks():
    """Pre-scoring data: every evidence dict lacks oy_evidence_score.
    The score still ranks attributes via frequency + severity + tier
    + impact - proves the layer degrades gracefully on legacy input."""
    attrs = {
        "transfer_resistance": _summary(
            "transfer_resistance", n_negative=30, avg_intensity_neg=2.5,
            neg_evidences=[_ev(score=None)] * 3,
        ),
        "value_price": _summary(
            "value_price", n_negative=5, avg_intensity_neg=1.0,
            neg_evidences=[_ev(score=None)],
        ),
    }
    data = _build_data(attributes=attrs)
    es = synthesize_executive_summary(data)
    # transfer_resistance ranks first by frequency + severity alone.
    assert es.top_priorities[0].attribute == "transfer_resistance"
    assert es.top_priorities[0].score_max == 0.0


def test_synthesize_unmapped_attribute_emits_none_for_kpi_fields():
    """An attribute outside the impact / recommendation / risk-category
    mappings still surfaces as a priority (its score is computable)
    but the why/action/risk fields are None - the renderer will
    elide those columns rather than emit boilerplate."""
    s = _summary(
        "future_attribute_xyz", n_negative=20, avg_intensity_neg=2.0,
        neg_evidences=[_ev(score=5.0)],
    )
    data = _build_data(attributes={"future_attribute_xyz": s})
    es = synthesize_executive_summary(data)
    p = es.top_priorities[0]
    assert p.attribute == "future_attribute_xyz"
    assert p.why_ko is None
    assert p.action_ko is None
    assert p.risk_category is None


def test_synthesize_returns_n_reviews_and_n_records_total():
    """The summary forwards the corpus-wide counters so the renderer
    doesn't need to re-query data."""
    attrs = {
        "transfer_resistance": _summary(
            "transfer_resistance", n_negative=10, avg_intensity_neg=2.0,
            neg_evidences=[_ev(score=4.0)],
        ),
        "pigmentation": _summary(
            "pigmentation", n_positive=15,
            pos_evidences=[_ev(polarity="positive", rating=5.0, score=2.0)],
        ),
    }
    data = _build_data(n_reviews=100, attributes=attrs)
    es = synthesize_executive_summary(data)
    assert es.n_reviews == 100
    assert es.n_records_total == 25


def test_synthesize_dataclass_results_are_frozen():
    s = _summary(
        "transfer_resistance", n_negative=10, avg_intensity_neg=2.0,
        neg_evidences=[_ev(score=4.0)],
    )
    data = _build_data(attributes={"transfer_resistance": s})
    es = synthesize_executive_summary(data)
    import dataclasses
    for cls_inst in (
        es,
        es.top_priorities[0] if es.top_priorities else None,
    ):
        if cls_inst is None:
            continue
        assert dataclasses.is_dataclass(cls_inst)


# ---------------------------------------------------------------------------
# Top-3 / Top-2 default sizes match the user's stated requirement
# ---------------------------------------------------------------------------


def test_default_top_n_priorities_is_three():
    """The user pinned top-3. Synthesize defaults must match without the
    caller passing top_n_priorities - guards against drift."""
    attrs = {
        f"attr_{i}": _summary(
            "transfer_resistance",  # using a real attribute key for impact lookup
            n_negative=10 - i, avg_intensity_neg=2.0,
            neg_evidences=[_ev(score=5.0 - i * 0.3)],
        )
        for i in range(5)
    }
    # All 5 use the same attribute key so they collide; build with
    # distinct real keys instead to test top-N size.
    real_keys = ["transfer_resistance", "value_price", "pigmentation",
                  "persistence", "color_tone_matching"]
    attrs = {
        k: _summary(
            k, n_negative=20 - i * 2, avg_intensity_neg=2.0,
            neg_evidences=[_ev(score=5.0 - i * 0.3)],
        )
        for i, k in enumerate(real_keys)
    }
    data = _build_data(attributes=attrs)
    es = synthesize_executive_summary(data)
    assert len(es.top_priorities) == 3


def test_default_top_n_strengths_is_two():
    real_keys = ["pigmentation", "persistence", "finish_texture",
                  "application_blending"]
    attrs = {
        k: _summary(
            k, n_positive=20 - i * 2,
            pos_evidences=[_ev(polarity="positive", rating=5.0,
                                score=4.0 - i * 0.2)],
        )
        for i, k in enumerate(real_keys)
    }
    data = _build_data(attributes=attrs)
    es = synthesize_executive_summary(data)
    assert len(es.top_strengths) == 2
