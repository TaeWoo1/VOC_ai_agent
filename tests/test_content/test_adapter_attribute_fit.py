"""Tests for the adapter-layer attribute-fit guardrail.

Stage 1 / Stage 2 (protected) decide which attribute a quote gets
grouped under. The seller PDF, however, surfaces a *representative*
quote per attribute. When the underlying detector groups a quote
under attribute X but the visible text reads as if the user is
talking about something else (e.g. dryness card showing "양이 부족"
or "모공 효과"), the representative quote contaminates the card.

The adapter adds an `attribute_fit_warning` field on the affected
quote and excludes flagged quotes from `monitoring_candidates.
top_negative_quotes` and `strengths.representative_quote`. The raw
evidence stays in `attributes[].top_quotes` for audit.
"""
from __future__ import annotations

from src.voc.content.adapters.from_phase2e import (
    _attribute_fit_warning,
    productreportdata_to_analysis_report,
)
from src.voc.reporting.phase2e.report import AttributeSummary, ProductReportData


# ---------------------------------------------------------------------------
# Pure-function rule tests.
# ---------------------------------------------------------------------------


def test_pore_efficacy_quote_flagged_under_dryness():
    code = _attribute_fit_warning(
        "dryness_skin_texture", "모공에 큰 효과는 못 봤어요",
    )
    assert code == "off_topic_pore_efficacy"


def test_amount_complaint_flagged_under_dryness():
    code = _attribute_fit_warning(
        "dryness_skin_texture",
        "양이 거의 없다시피해서 ... 다음에 다시 살거같지",
    )
    assert code == "off_topic_amount"


def test_price_complaint_flagged_under_dryness():
    code = _attribute_fit_warning(
        "dryness_skin_texture", "좀 비싼것같긴해요 효과는 모르겠어요",
    )
    # Either price-only or efficacy-doubt is acceptable; both fire.
    assert code in {"off_topic_price", "off_topic_efficacy_doubt"}


def test_genuine_dryness_complaint_not_flagged():
    code = _attribute_fit_warning(
        "dryness_skin_texture", "금방 건조해지는 느낌이 없지 않아 있는데",
    )
    assert code is None


def test_dryness_anchor_defuses_efficacy_cue():
    # "효과는 모르겠어요" alone would flag, but "건조" anchors it.
    code = _attribute_fit_warning(
        "dryness_skin_texture",
        "건조한 피부엔 효과는 모르겠어요. 미스트 정도",
    )
    assert code is None


def test_dryness_anchor_defuses_price_cue():
    code = _attribute_fit_warning(
        "dryness_skin_texture",
        "비싸지만 촉촉함이 오래가서 만족합니다",
    )
    assert code is None


def test_unknown_attribute_returns_none():
    code = _attribute_fit_warning(
        "value_price", "양이 적어요",
    )
    # `value_price` has no rule defined — never flagged.
    assert code is None


def test_empty_text_returns_none():
    assert _attribute_fit_warning("dryness_skin_texture", "") is None


# ---------------------------------------------------------------------------
# Adapter integration: top_negative_quotes / representative_quote skip.
# ---------------------------------------------------------------------------


def _summary_with_evidence(
    attribute: str,
    *,
    n_positive: int = 0,
    n_negative: int = 0,
    pos: list[dict] | None = None,
    neg: list[dict] | None = None,
) -> AttributeSummary:
    s = AttributeSummary(attribute=attribute)
    s.n_positive = n_positive
    s.n_negative = n_negative
    if pos:
        s.sample_evidences_pos = pos
    if neg:
        s.sample_evidences_neg = neg
    return s


def test_off_topic_dryness_quote_excluded_from_monitoring_top():
    # 5+ negatives required for monitoring_candidates surfacing.
    from collections import Counter
    prd = ProductReportData(
        product_id="A_test",
        product_name="Test Pad",
        n_reviews=200,
        n_records=200,
        n_mixed_reviews=0,
        n_with_tradeoff=0,
        tradeoff_pairs=Counter(),
        mixed_attribute_pairs=[],
        delivery_condition_records_total=0,
        attribute_summaries={
            "dryness_skin_texture": _summary_with_evidence(
                "dryness_skin_texture",
                n_positive=10, n_negative=5,
                neg=[
                    # First (highest-quality after sort) — off-topic.
                    {"text": "양이 거의 없다시피해서 다시는 안 살듯",
                     "review_id": "r_amount"},
                    # On-topic dryness — should win the representative slot.
                    {"text": "금방 건조해지는 느낌이 있어 아쉬워요",
                     "review_id": "r_dry"},
                    {"text": "모공에 큰 효과는 못 봤어요",
                     "review_id": "r_pore"},
                    {"text": "수분 날라간 느낌이에요", "review_id": "r_dry2"},
                    {"text": "건조함이 가시지 않아요", "review_id": "r_dry3"},
                ],
            ),
        },
    )
    out = productreportdata_to_analysis_report(prd)
    # Find the dryness monitoring entry.
    monitoring = {
        m["attribute_key"]: m for m in out["monitoring_candidates"]
    }
    dryness = monitoring.get("dryness_skin_texture")
    assert dryness is not None
    rids = [
        q["review_id"] for q in (dryness.get("top_negative_quotes") or [])
    ]
    # Off-topic quotes must NOT appear in the representative surface.
    assert "r_amount" not in rids, (
        "amount-complaint quote leaked into dryness representative card"
    )
    assert "r_pore" not in rids, (
        "pore-efficacy quote leaked into dryness representative card"
    )
    # At least one on-topic quote must survive (proves the filter is
    # not too aggressive).
    assert any(rid.startswith("r_dry") for rid in rids), (
        "every on-topic quote was filtered — guardrail too aggressive"
    )
    # The skipped count is recorded for audit.
    assert dryness.get("attribute_fit_skipped", 0) >= 1


def test_attributes_block_keeps_flagged_quote_for_audit():
    # The attribute_fit_warning is advisory; the raw quote still rides
    # in attributes[].top_quotes so audit tooling can see what was
    # flagged. Only representative surfaces apply the skip.
    from collections import Counter
    prd = ProductReportData(
        product_id="A_test",
        product_name="Test Pad",
        n_reviews=200,
        n_records=200,
        n_mixed_reviews=0,
        n_with_tradeoff=0,
        tradeoff_pairs=Counter(),
        mixed_attribute_pairs=[],
        delivery_condition_records_total=0,
        attribute_summaries={
            "dryness_skin_texture": _summary_with_evidence(
                "dryness_skin_texture",
                n_positive=2, n_negative=2,
                neg=[
                    {"text": "양이 거의 없다시피", "review_id": "r_amount"},
                    {"text": "건조하고 당김", "review_id": "r_dry"},
                ],
            ),
        },
    )
    out = productreportdata_to_analysis_report(prd)
    attrs = {a["key"]: a for a in out["attributes"]}
    dryness = attrs["dryness_skin_texture"]
    rids = [q["review_id"] for q in dryness["top_quotes"]]
    # Both kept in the attributes block (audit surface) ...
    assert "r_amount" in rids
    assert "r_dry" in rids
    # ... but the flagged one carries the warning.
    flagged = [
        q for q in dryness["top_quotes"]
        if q.get("review_id") == "r_amount"
    ]
    assert flagged
    assert flagged[0].get("attribute_fit_warning") in {
        "off_topic_amount", "off_topic_pore_efficacy",
    }
