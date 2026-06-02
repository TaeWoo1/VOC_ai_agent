"""Tests for `src/voc/reporting/phase2e/recommendations.py`.

The recommendations layer is a flat lookup keyed on attribute. Tests
lock in:
  - Coverage: every canonical attribute key has a recommendation.
  - The user's documented examples (transfer_resistance, value_price)
    produce the exact phrases shown in the requirements.
  - generate_recommendations skips positive insights and unmapped
    attributes; preserves order; forwards priority_label.
  - Recommendations are deterministic + idempotent.
"""

from __future__ import annotations

import dataclasses

import pytest

from src.voc.reporting.phase2e.insights import AttributeInsight
from src.voc.reporting.phase2e.report import ATTRIBUTE_LABELS_KO
from src.voc.reporting.phase2e.recommendations import (
    RECOMMENDATIONS_KO,
    Recommendation,
    generate_recommendations,
    recommendation_for,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ins(
    attribute: str,
    *,
    kind: str = "negative",
    priority: str = "Medium",
    summary: str = "...",
) -> AttributeInsight:
    return AttributeInsight(
        attribute=attribute,
        kind=kind,
        ko_summary=summary,
        n_supporting=3,
        score_max=5.0,
        signal_sources=[],
        priority_label=priority,
    )


# ---------------------------------------------------------------------------
# Coverage + locked example phrases
# ---------------------------------------------------------------------------


def test_every_canonical_attribute_has_a_recommendation():
    """The mapping must cover every key in ATTRIBUTE_LABELS_KO so a
    new attribute addition surfaces immediately as a missing
    recommendation rather than as silent skip-on-render."""
    canonical_keys = set(ATTRIBUTE_LABELS_KO.keys())
    mapped_keys = set(RECOMMENDATIONS_KO.keys())
    missing = canonical_keys - mapped_keys
    extra = mapped_keys - canonical_keys
    assert missing == set(), f"missing recommendations for: {missing}"
    assert extra == set(), f"extra (unknown) recommendations: {extra}"


def test_user_example_transfer_resistance_phrase_locked():
    """User-documented example, post 2026-04-28 wording-safety pass.
    Phrase changes are breaking - downstream reports cite this verbatim
    so the lock here forces a deliberate stakeholder review on update."""
    assert recommendation_for("transfer_resistance") == \
        "옵션/사용 환경별 묻어남 의견 분포 및 CS 문의 교차 확인 후보"


def test_user_example_value_price_phrase_locked():
    assert recommendation_for("value_price") == \
        "프로모션 시점/옵션별 가격 의견 분포 확인 후보"


def test_all_phrases_are_non_trivial():
    """Each phrase must be a substantive sentence - not empty, not a
    single-word stub. Sets a lower bound on operator usefulness."""
    for attr, phrase in RECOMMENDATIONS_KO.items():
        assert isinstance(phrase, str)
        assert len(phrase) >= 15, f"{attr}: phrase too short ({phrase!r})"
        assert phrase.strip() == phrase, f"{attr}: leading/trailing whitespace"
        # Must reference at least one investigation-oriented stem (post-
        # 2026-04-28 wording-safety pass: directive verbs ARE allowed
        # if paired with hedging - what matters is presence of an
        # investigative noun like 후보 / 검토 / 가능성).
        assert any(stem in phrase for stem in (
            "후보", "가능성", "검토", "재설계", "재구성", "재검토",
            "조정", "변경", "보강",
        )), f"{attr}: phrase lacks an investigation stem"


def test_no_phrase_uses_directive_imperative_wording():
    """Locks the 2026-04-28 wording-safety contract:
      - No phrase asserts a known root cause ("원인", "원인은").
      - No phrase commands a fix without hedging ("해야 함", standalone
        "필요" without 검토/추가 etc., "개선 필요").
    The report can identify candidates worth investigating; it CANNOT
    prescribe a manufacturing change without visibility into the
    brand's formulation/QA/cost constraints."""
    for attr, phrase in RECOMMENDATIONS_KO.items():
        assert "해야 함" not in phrase, f"{attr}: directive wording in {phrase!r}"
        assert "원인은" not in phrase, f"{attr}: claims known cause in {phrase!r}"
        # Allow "필요" only inside compounds ("검토 필요", "추가 검증 필요",
        # "확인 필요" etc.). Bare "X가 필요" / "개선 필요" reads as a directive.
        assert "개선 필요" not in phrase, \
            f"{attr}: directive '개선 필요' in {phrase!r}"


def test_every_phrase_ends_in_hedged_candidate_form():
    """Every recommendation must end in a hedged candidate marker so
    the brand can disagree without contradicting the report. Allowed
    endings: 후보 / 가능성 / 검토 / 권장 / 확인.

    Phrases may carry a trailing parenthetical clause (e.g.
    "...검토 후보 (밀착력 개선 가설)") which we strip ONLY when it
    occupies the suffix - mid-string parens like "도구(퍼프/브러시)"
    must not be touched."""
    import re
    allowed_endings = ("후보", "가능성", "검토", "권장", "확인")
    trailing_paren_re = re.compile(r"\s*\([^()]*\)\s*$")
    for attr, phrase in RECOMMENDATIONS_KO.items():
        tail = phrase.rstrip()
        # Only strip a parenthetical that occupies the very end of
        # the phrase (after optional whitespace) - preserves any
        # mid-string parens unchanged.
        tail = trailing_paren_re.sub("", tail).rstrip()
        assert any(tail.endswith(end) for end in allowed_endings), \
            f"{attr}: phrase doesn't end in a hedged marker: {phrase!r}"


def test_no_phrase_includes_a_raw_attribute_key():
    """Phrases are operator-facing - must not leak code-side keys like
    'transfer_resistance' into user-visible Korean text."""
    for attr, phrase in RECOMMENDATIONS_KO.items():
        assert attr not in phrase, \
            f"{attr}: raw key leaked into phrase ({phrase!r})"


# ---------------------------------------------------------------------------
# recommendation_for
# ---------------------------------------------------------------------------


def test_recommendation_for_returns_none_on_unknown_key():
    """No fabricated stub for an attribute we don't recognize - the
    caller can then decide whether to skip or surface the gap."""
    assert recommendation_for("not_a_real_attribute") is None
    assert recommendation_for("") is None


def test_recommendation_for_is_pure_lookup():
    """Calling twice yields the same string - no caching surprises, no
    state. Locks in the deterministic contract."""
    a = recommendation_for("pigmentation")
    b = recommendation_for("pigmentation")
    assert a == b
    assert a is not None


# ---------------------------------------------------------------------------
# generate_recommendations
# ---------------------------------------------------------------------------


def test_generate_recommendations_pairs_each_negative_insight():
    insights = [
        _ins("transfer_resistance", priority="High"),
        _ins("value_price", priority="Medium"),
    ]
    recs = generate_recommendations(insights)
    assert len(recs) == 2
    assert recs[0].attribute == "transfer_resistance"
    assert recs[0].priority_label == "High"
    assert recs[0].ko_action == \
        "옵션/사용 환경별 묻어남 의견 분포 및 CS 문의 교차 확인 후보"
    assert recs[1].attribute == "value_price"
    assert recs[1].priority_label == "Medium"


def test_generate_recommendations_skips_positive_insights():
    """Positive insights describe strengths - not action items. The
    recommendation layer ignores them rather than emitting a
    'preserve this strength' phrase that would muddy the negative
    action list."""
    insights = [
        _ins("transfer_resistance", kind="negative", priority="High"),
        _ins("pigmentation", kind="positive", priority="Strong"),
        _ins("value_price", kind="negative", priority="Low"),
    ]
    recs = generate_recommendations(insights)
    assert [r.attribute for r in recs] == [
        "transfer_resistance", "value_price",
    ]


def test_generate_recommendations_skips_unmapped_attribute_silently():
    """An attribute not in RECOMMENDATIONS_KO produces no rec rather
    than a placeholder 'consider improving X' boilerplate. A future
    attribute addition surfaces as a visible omission in the report."""
    insights = [
        _ins("transfer_resistance", priority="High"),
        _ins("future_attribute_not_yet_mapped", priority="Medium"),
        _ins("value_price", priority="Low"),
    ]
    recs = generate_recommendations(insights)
    assert len(recs) == 2
    assert all(r.attribute != "future_attribute_not_yet_mapped"
               for r in recs)


def test_generate_recommendations_preserves_input_order():
    """Renderers pair insight bullets with their recommendation by
    position - output order MUST mirror input order so there's no
    visual mismatch."""
    insights = [
        _ins("value_price", priority="Low"),
        _ins("pigmentation", kind="negative", priority="Medium"),
        _ins("transfer_resistance", priority="High"),
    ]
    recs = generate_recommendations(insights)
    assert [r.attribute for r in recs] == [
        "value_price", "pigmentation", "transfer_resistance",
    ]


def test_generate_recommendations_is_idempotent():
    insights = [_ins("transfer_resistance", priority="High")]
    a = generate_recommendations(insights)
    b = generate_recommendations(insights)
    assert a == b


def test_generate_recommendations_handles_empty_input():
    assert generate_recommendations([]) == []


def test_generate_recommendations_handles_all_positive_input():
    """Edge: every insight is positive → no recs produced."""
    insights = [
        _ins("pigmentation", kind="positive", priority="Strong"),
        _ins("persistence", kind="positive", priority="Moderate"),
    ]
    assert generate_recommendations(insights) == []


def test_recommendation_dataclass_is_frozen():
    rec = Recommendation(
        attribute="x", ko_action="...", priority_label="High",
    )
    assert dataclasses.is_dataclass(rec)
    try:
        rec.priority_label = "Low"
    except dataclasses.FrozenInstanceError:
        pass
    else:
        assert False, "expected FrozenInstanceError"


# ---------------------------------------------------------------------------
# End-to-end with synthesize_attribute_insights
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Action category (즉시 실행 / 중기 개선 / 실험/검증)
# ---------------------------------------------------------------------------


def test_action_categories_match_user_specification():
    """Three pinned categories. Locking the vocabulary so a refactor
    can't introduce a 4th bucket without a deliberate review."""
    from src.voc.reporting.phase2e.recommendations import (
        ACTION_CATEGORIES_KO,
    )
    assert ACTION_CATEGORIES_KO == frozenset({
        "즉시 실행", "중기 개선", "실험/검증",
    })


def test_action_category_covers_every_canonical_attribute():
    from src.voc.reporting.phase2e.recommendations import (
        ACTION_CATEGORY_KO,
    )
    canonical = set(ATTRIBUTE_LABELS_KO.keys())
    mapped = set(ACTION_CATEGORY_KO.keys())
    assert canonical - mapped == set()
    assert mapped - canonical == set()


def test_action_category_values_are_in_the_canonical_set():
    """Every mapped value MUST be one of the three canonical strings.
    Catches typos that would render a custom category chip instead
    of one of the three user-pinned options."""
    from src.voc.reporting.phase2e.recommendations import (
        ACTION_CATEGORIES_KO, ACTION_CATEGORY_KO,
    )
    for attr, cat in ACTION_CATEGORY_KO.items():
        assert cat in ACTION_CATEGORIES_KO, \
            f"{attr}: category {cat!r} not in canonical set"


def test_action_category_distribution_uses_all_three_buckets():
    """All three buckets must have at least one attribute. If one
    bucket ends up empty after a future tuning pass, the operator
    won't see that category chip in any report - likely an oversight."""
    from src.voc.reporting.phase2e.recommendations import (
        ACTION_CATEGORIES_KO, ACTION_CATEGORY_KO,
    )
    used = set(ACTION_CATEGORY_KO.values())
    assert used == ACTION_CATEGORIES_KO, \
        f"category buckets unused: {ACTION_CATEGORIES_KO - used}"


@pytest.mark.parametrize("attribute,expected_category", [
    # 즉시 실행
    ("value_price",                      "즉시 실행"),
    ("applicator_tool",                  "즉시 실행"),
    # 중기 개선
    ("transfer_resistance",              "중기 개선"),
    ("persistence",                      "중기 개선"),
    ("application_blending",             "중기 개선"),
    ("finish_texture",                   "중기 개선"),
    ("dryness_skin_texture",             "중기 개선"),
    ("color_tone_matching",              "중기 개선"),
    ("packaging_container",              "중기 개선"),
    # 실험/검증
    ("pigmentation",                      "실험/검증"),
    ("adhesion_base_interaction",        "실험/검증"),
    ("multi_use_lip_cheek_compatibility","실험/검증"),
])
def test_action_category_for_each_attribute(attribute, expected_category):
    from src.voc.reporting.phase2e.recommendations import (
        action_category_for,
    )
    assert action_category_for(attribute) == expected_category


def test_action_category_for_returns_none_on_unknown_key():
    from src.voc.reporting.phase2e.recommendations import (
        action_category_for,
    )
    assert action_category_for("not_a_real_attribute") is None
    assert action_category_for("") is None


def test_recommendations_pair_with_synthesize_output():
    """Smoke E2E: synthesize → recommend wires cleanly. The output
    of synthesize_attribute_insights['negative'] feeds straight into
    generate_recommendations without any reshape."""
    from collections import Counter

    from src.voc.reporting.phase2e.report import (
        AttributeSummary, ProductReportData,
    )
    from src.voc.reporting.phase2e.insights import (
        synthesize_attribute_insights,
    )

    s = AttributeSummary(attribute="transfer_resistance")
    s.n_negative = 25
    s.n_total = 25
    s.avg_intensity_neg = 2.5
    s.sample_evidences_neg = [{
        "review_id": "r1",
        "polarity": "negative_strong",
        "intensity": 3,
        "confidence": "high",
        "evidence_span": "마스크에 옷에 다 묻어요",
        "delivery_condition_flag": False,
        "oy_evidence_score": 7.5,
        "rating_normalized": 1.0,
        "oy_sort_ranks": {"RATING_ASC": 2, "USEFUL_SCORE_DESC": 5},
        "review_date": "2026-04-01",
    }]
    data = ProductReportData(
        product_id="A0001", product_name="Test",
        n_reviews=100, n_records=25, n_mixed_reviews=0,
        n_with_tradeoff=0,
        attribute_summaries={"transfer_resistance": s},
        tradeoff_pairs=Counter(),
        mixed_attribute_pairs=[],
        delivery_condition_records_total=0,
    )
    insights = synthesize_attribute_insights(data)
    recs = generate_recommendations(insights["negative"])
    assert len(recs) == 1
    assert recs[0].attribute == "transfer_resistance"
    assert recs[0].priority_label == "High"
    assert recs[0].ko_action == \
        "옵션/사용 환경별 묻어남 의견 분포 및 CS 문의 교차 확인 후보"
