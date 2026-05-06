"""Tests for `src/voc/reporting/phase2e/impact.py`.

The impact layer is a flat lookup keyed on attribute, structurally
identical to `recommendations.py`. Tests lock in:
  - Coverage: every canonical attribute key has an impact phrase.
  - The user's documented example (transfer_resistance) produces the
    exact phrase shown in the requirements.
  - generate_impacts skips positive insights and unmapped attributes;
    preserves order; forwards priority_label.
  - Phrasing follows the "...로 이어질 수 있습니다." hedging pattern.
"""

from __future__ import annotations

import dataclasses

from src.voc.reporting.phase2e.insights import AttributeInsight
from src.voc.reporting.phase2e.report import ATTRIBUTE_LABELS_KO
from src.voc.reporting.phase2e.impact import (
    IMPACTS_KO,
    Impact,
    generate_impacts,
    impact_for,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ins(
    attribute: str,
    *,
    kind: str = "negative",
    priority: str = "Medium",
) -> AttributeInsight:
    return AttributeInsight(
        attribute=attribute,
        kind=kind,
        ko_summary="...",
        n_supporting=3,
        score_max=5.0,
        signal_sources=[],
        priority_label=priority,
    )


# ---------------------------------------------------------------------------
# Coverage + locked phrase
# ---------------------------------------------------------------------------


def test_every_canonical_attribute_has_an_impact_phrase():
    """Same coverage contract as recommendations: a new attribute
    addition surfaces immediately as a missing impact phrase."""
    canonical_keys = set(ATTRIBUTE_LABELS_KO.keys())
    mapped_keys = set(IMPACTS_KO.keys())
    missing = canonical_keys - mapped_keys
    extra = mapped_keys - canonical_keys
    assert missing == set(), f"missing impacts for: {missing}"
    assert extra == set(), f"extra (unknown) impacts: {extra}"


def test_user_example_transfer_resistance_phrase_locked():
    """User-documented example. Phrase changes are breaking — downstream
    reports cite this verbatim."""
    assert impact_for("transfer_resistance") == \
        "묻어남 문제는 재구매율 저하 및 클레임 증가로 이어질 수 있습니다."


def test_all_phrases_use_the_hedging_pattern():
    """Every phrase ends with the documented hedging clause '이어질 수
    있습니다.' VOC signals are correlational; stronger language would
    overstate the evidence the report carries."""
    for attr, phrase in IMPACTS_KO.items():
        assert phrase.endswith("이어질 수 있습니다."), \
            f"{attr}: phrase doesn't end with hedging clause ({phrase!r})"


def test_all_phrases_are_non_trivial():
    """Each phrase is a substantive sentence — references at least
    one concrete business outcome from the cosmetics-retail domain.
    Sets a lower bound on operator usefulness."""
    business_outcome_stems = (
        "재구매", "환불", "교환", "클레임", "부정 리뷰", "경쟁사",
        "신뢰도", "고객", "이탈", "구매 감소", "포지션",
        "선물용", "확산", "만족도", "차별화",
    )
    for attr, phrase in IMPACTS_KO.items():
        assert isinstance(phrase, str)
        assert len(phrase) >= 25, f"{attr}: phrase too short ({phrase!r})"
        assert phrase.strip() == phrase, f"{attr}: leading/trailing whitespace"
        assert any(stem in phrase for stem in business_outcome_stems), \
            f"{attr}: phrase lacks a business-outcome reference"


def test_no_phrase_includes_a_raw_attribute_key():
    """Phrases are operator-facing — must not leak code-side keys."""
    for attr, phrase in IMPACTS_KO.items():
        assert attr not in phrase, \
            f"{attr}: raw key leaked into phrase ({phrase!r})"


# ---------------------------------------------------------------------------
# impact_for
# ---------------------------------------------------------------------------


def test_impact_for_returns_none_on_unknown_key():
    assert impact_for("not_a_real_attribute") is None
    assert impact_for("") is None


def test_impact_for_is_pure_lookup():
    a = impact_for("pigmentation")
    b = impact_for("pigmentation")
    assert a == b
    assert a is not None


# ---------------------------------------------------------------------------
# generate_impacts
# ---------------------------------------------------------------------------


def test_generate_impacts_pairs_each_negative_insight():
    insights = [
        _ins("transfer_resistance", priority="High"),
        _ins("value_price", priority="Medium"),
    ]
    out = generate_impacts(insights)
    assert len(out) == 2
    assert out[0].attribute == "transfer_resistance"
    assert out[0].priority_label == "High"
    assert out[0].ko_consequence == \
        "묻어남 문제는 재구매율 저하 및 클레임 증가로 이어질 수 있습니다."
    assert out[1].attribute == "value_price"
    assert out[1].priority_label == "Medium"


def test_generate_impacts_skips_positive_insights():
    """Positive insights are strengths — not consequences-of-issues."""
    insights = [
        _ins("transfer_resistance", kind="negative", priority="High"),
        _ins("pigmentation", kind="positive", priority="Strong"),
        _ins("value_price", kind="negative", priority="Low"),
    ]
    out = generate_impacts(insights)
    assert [r.attribute for r in out] == [
        "transfer_resistance", "value_price",
    ]


def test_generate_impacts_skips_unmapped_attribute_silently():
    """An attribute not in IMPACTS_KO produces no entry rather than
    boilerplate. Future-attribute safety."""
    insights = [
        _ins("transfer_resistance", priority="High"),
        _ins("future_attribute_not_yet_mapped", priority="Medium"),
        _ins("value_price", priority="Low"),
    ]
    out = generate_impacts(insights)
    assert len(out) == 2
    assert all(r.attribute != "future_attribute_not_yet_mapped" for r in out)


def test_generate_impacts_preserves_input_order():
    """Renderers pair insight ↔ impact ↔ recommendation by position —
    output order MUST mirror input order so the visual triplet aligns."""
    insights = [
        _ins("value_price", priority="Low"),
        _ins("pigmentation", priority="Medium"),
        _ins("transfer_resistance", priority="High"),
    ]
    out = generate_impacts(insights)
    assert [r.attribute for r in out] == [
        "value_price", "pigmentation", "transfer_resistance",
    ]


def test_generate_impacts_is_idempotent():
    insights = [_ins("transfer_resistance", priority="High")]
    a = generate_impacts(insights)
    b = generate_impacts(insights)
    assert a == b


def test_generate_impacts_handles_empty_input():
    assert generate_impacts([]) == []


def test_generate_impacts_handles_all_positive_input():
    insights = [
        _ins("pigmentation", kind="positive", priority="Strong"),
        _ins("persistence", kind="positive", priority="Moderate"),
    ]
    assert generate_impacts(insights) == []


def test_impact_dataclass_is_frozen():
    imp = Impact(
        attribute="x", ko_consequence="...로 이어질 수 있습니다.",
        priority_label="High",
    )
    assert dataclasses.is_dataclass(imp)
    try:
        imp.priority_label = "Low"
    except dataclasses.FrozenInstanceError:
        pass
    else:
        assert False, "expected FrozenInstanceError"


# ---------------------------------------------------------------------------
# Parallel structure with recommendations.py
# ---------------------------------------------------------------------------


def test_impact_and_recommendation_cover_the_same_attribute_set():
    """Impact and recommendation layers are paired — every attribute
    in one must be in the other. A future PR adding a new attribute
    has to update both in the same change."""
    from src.voc.reporting.phase2e.recommendations import RECOMMENDATIONS_KO
    assert set(IMPACTS_KO.keys()) == set(RECOMMENDATIONS_KO.keys())


# ---------------------------------------------------------------------------
# BusinessImpact (revenue / churn / cs_cost triple)
# ---------------------------------------------------------------------------


def test_business_impact_covers_every_canonical_attribute():
    """Coverage gate: every key in ATTRIBUTE_LABELS_KO has a
    BusinessImpact mapping. A future attribute addition surfaces
    immediately as a missing entry."""
    from src.voc.reporting.phase2e.report import ATTRIBUTE_LABELS_KO
    from src.voc.reporting.phase2e.impact import BUSINESS_IMPACT_KO
    canonical = set(ATTRIBUTE_LABELS_KO.keys())
    mapped = set(BUSINESS_IMPACT_KO.keys())
    assert canonical - mapped == set()
    assert mapped - canonical == set()


def test_business_impact_each_entry_has_at_least_one_populated_field():
    """An entry where all three fields are None contributes nothing —
    the renderer would emit no chip. Such an entry is a bug. Lock the
    contract that every mapping has at least one signal."""
    from src.voc.reporting.phase2e.impact import BUSINESS_IMPACT_KO
    for attr, bi in BUSINESS_IMPACT_KO.items():
        populated = [
            f for f in (bi.revenue_ko, bi.churn_ko, bi.cs_cost_ko)
            if f is not None
        ]
        assert populated, \
            f"{attr}: BusinessImpact has all None fields — would render nothing"


def test_business_impact_phrases_are_concise():
    """Phrases are designed for compact chip-like rendering. Locking
    a length budget so a future "drift toward verbose" doesn't blow
    up the priority card layout."""
    from src.voc.reporting.phase2e.impact import BUSINESS_IMPACT_KO
    for attr, bi in BUSINESS_IMPACT_KO.items():
        for field_name, value in (
            ("revenue_ko", bi.revenue_ko),
            ("churn_ko", bi.churn_ko),
            ("cs_cost_ko", bi.cs_cost_ko),
        ):
            if value is None:
                continue
            # ≤ 18 Korean characters keeps the chip on one line of the card.
            assert len(value) <= 18, \
                f"{attr}.{field_name}: phrase too long ({value!r}, "\
                f"len {len(value)})"


def test_business_impact_for_returns_none_on_unknown_key():
    from src.voc.reporting.phase2e.impact import business_impact_for
    assert business_impact_for("not_a_real_attribute") is None
    assert business_impact_for("") is None


def test_business_impact_for_user_examples():
    """Lock a few representative mappings against drift."""
    from src.voc.reporting.phase2e.impact import business_impact_for
    transfer = business_impact_for("transfer_resistance")
    assert transfer is not None
    # transfer_resistance: churn + CS cost are the dominant signals;
    # no top-of-funnel revenue effect surfaces because the issue
    # mostly hits existing customers.
    assert transfer.revenue_ko is None
    assert transfer.churn_ko == "재구매율 ↓"
    assert transfer.cs_cost_ko == "클레임/환불 비용 ↑"

    price = business_impact_for("value_price")
    assert price is not None
    # Pricing concerns hit revenue + retention but not CS cost.
    assert price.revenue_ko == "경쟁사 대체로 매출 차감 ↑"
    assert price.churn_ko == "재구매율 ↓"
    assert price.cs_cost_ko is None


def test_generate_impacts_returns_one_entry_per_negative_insight():
    """For any insight set whose negative attributes are all in the
    mapping, generate_impacts emits exactly one Impact per negative
    insight — no merging, no fan-out."""
    insights = [
        _ins("transfer_resistance", priority="High"),
        _ins("value_price", priority="Medium"),
        _ins("pigmentation", priority="Low"),
    ]
    out = generate_impacts(insights)
    assert len(out) == 3
