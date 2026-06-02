"""Reliability-layer tests for the Phase 2E → analysis_report adapter.

These tests verify the P0 reliability changes:
  - polarity guardrail filters suspect quotes from the watch-out side
  - display_text is attached to every top_quote
  - polarity_audit sidecar is populated
  - narrative templates diversify (no all-identical sentences)
  - who_for_ko entries do not all use the "만족 후기 N건이 누적되는
    사용자" tautology
"""
from __future__ import annotations

from collections import Counter

from src.voc.content.adapters.from_phase2e import (
    productreportdata_to_analysis_report,
)
from src.voc.reporting.phase2e.report import AttributeSummary, ProductReportData


def _summary(
    attribute: str,
    *,
    n_positive: int = 0,
    n_negative: int = 0,
    n_mixed: int = 0,
    pos_examples: list[dict] | None = None,
    neg_examples: list[dict] | None = None,
) -> AttributeSummary:
    s = AttributeSummary(attribute=attribute)
    s.n_positive = n_positive
    s.n_negative = n_negative
    s.n_mixed = n_mixed
    if pos_examples:
        s.sample_evidences_pos = list(pos_examples)
    if neg_examples:
        s.sample_evidences_neg = list(neg_examples)
    return s


# Real run-010 false-negative cases: text labeled negative_weak by
# Stage 2, but the text carries decisive positive cues.
SUSPECT_NEGATIVES_RUN010 = [
    {
        "text": "엄청 잘 떼져요 ㅎㅎ 얇고 쫀쫀해서 밀착도 잘되고 촉촉하네요 탄력도 조금 좋",
        "review_id": "139c299e5139",
        "polarity": "negative_weak",
    },
    {
        "text": ":) 좀 써보니까 패드가 부드럽게 밀착되면서 피부 컨디션을 쫀쫀하게 잡아주",
        "review_id": "be0f2e6fcdae",
        "polarity": "negative_weak",
    },
]

CLEAN_NEGATIVES = [
    {
        "text": "도톰한데 빨리 마르는느낌이 있음- 밀착력도 아쉬움 리뉴되고 픽업집게는",
        "review_id": "6c37efd5336b",
        "polarity": "negative_weak",
    },
    {
        "text": "히알루론산으로 바꿔봤어요. 들뜸없이 밀착력은 좋은데, 빨리 말라서 아쉬워요",
        "review_id": "276b849e386f",
        "polarity": "negative_weak",
    },
    {
        "text": "통이 좀 마음에 안드는데 일단 뚜껑이 잘 안 닫히는 느낌",
        "review_id": "abcd1234",
        "polarity": "negative_strong",
    },
    {
        "text": "별로예요 비싸기만 하고 효과는 모르겠어요",
        "review_id": "efgh5678",
        "polarity": "negative_strong",
    },
    {
        "text": "트러블이 올라와서 후회하는 중입니다",
        "review_id": "ijkl9012",
        "polarity": "negative_strong",
    },
]


def _prd_with_suspect_negatives() -> ProductReportData:
    """Construct a PRD where adhesion's negative samples include
    both suspect (mislabeled positive) and clean negative quotes."""
    return ProductReportData(
        product_id="A000000171427",
        product_name="메디힐 더마 패드 200매",
        n_reviews=2029,
        n_records=2029,
        n_mixed_reviews=50,
        n_with_tradeoff=10,
        attribute_summaries={
            "adhesion_base_interaction": _summary(
                "adhesion_base_interaction",
                n_positive=39,
                n_negative=13,
                neg_examples=SUSPECT_NEGATIVES_RUN010 + CLEAN_NEGATIVES,
            ),
            "value_price": _summary(
                "value_price",
                n_positive=157,
                n_negative=24,
                pos_examples=[
                    {"text": "200매라 가성비도 좋은편이라서 만족합니다",
                     "review_id": "r1", "polarity": "positive"},
                ],
            ),
            "finish_texture": _summary(
                "finish_texture", n_positive=132, n_negative=33,
                pos_examples=[
                    {"text": "촉촉하고 좋아도 용량도 많아서 너무 만족",
                     "review_id": "r2", "polarity": "positive"},
                ],
                neg_examples=[
                    {"text": "다른 패드들에 비해서 덜 촉촉하다고 해야하나 그건 좀 아쉬웠음",
                     "review_id": "r3", "polarity": "negative_weak"},
                ] * 5,
            ),
            "dryness_skin_texture": _summary(
                "dryness_skin_texture", n_positive=53, n_negative=17,
                pos_examples=[
                    {"text": "수분 보충이 제일 중요했는데 만족스럽습니다",
                     "review_id": "r4", "polarity": "positive"},
                ],
            ),
        },
        tradeoff_pairs=Counter(),
        mixed_attribute_pairs=[],
        delivery_condition_records_total=0,
    )


# ---------------------------------------------------------------------------
# Polarity guardrail wiring.
# ---------------------------------------------------------------------------


def test_top_negative_quotes_excludes_suspect_entries():
    out = productreportdata_to_analysis_report(_prd_with_suspect_negatives())
    monitoring = {m["attribute_key"]: m for m in out["monitoring_candidates"]}
    adh = monitoring["adhesion_base_interaction"]
    quotes = adh.get("top_negative_quotes") or []
    surfaced_review_ids = {q.get("review_id") for q in quotes}
    # The two suspect run-010 quotes must NOT appear.
    assert "139c299e5139" not in surfaced_review_ids
    assert "be0f2e6fcdae" not in surfaced_review_ids


def test_polarity_suspect_skipped_count_recorded():
    out = productreportdata_to_analysis_report(_prd_with_suspect_negatives())
    monitoring = {m["attribute_key"]: m for m in out["monitoring_candidates"]}
    adh = monitoring["adhesion_base_interaction"]
    # The adapter records skipped count when one or more were dropped.
    assert adh.get("polarity_suspect_skipped", 0) >= 1


def test_polarity_audit_block_present_and_populated():
    out = productreportdata_to_analysis_report(_prd_with_suspect_negatives())
    audit = out.get("polarity_audit") or {}
    assert "n_total_quotes" in audit
    assert audit["n_total_quotes"] > 0
    assert audit["n_total_suspect"] >= 1
    by_attr = audit.get("by_attribute") or {}
    assert "adhesion_base_interaction" in by_attr
    # Suspect samples are diagnostic — first few should include
    # the run-010 suspect IDs.
    sample_ids = {s["review_id"] for s in audit.get("samples") or []}
    assert "139c299e5139" in sample_ids or "be0f2e6fcdae" in sample_ids


# ---------------------------------------------------------------------------
# display_text attached to top_quotes.
# ---------------------------------------------------------------------------


def test_attribute_top_quotes_carry_display_text():
    out = productreportdata_to_analysis_report(_prd_with_suspect_negatives())
    attrs = {a["key"]: a for a in out["attributes"]}
    val_quotes = attrs["value_price"].get("top_quotes") or []
    assert val_quotes, "value_price should have at least one quote"
    for q in val_quotes:
        assert "text" in q
        # display_text is added by the adapter; it can equal text
        # for already-clean spans, but the key must be present.
        assert "display_text" in q


def test_display_text_does_not_dangle_mid_word():
    # Construct a span that ends mid-word.
    prd = ProductReportData(
        product_id="x",
        product_name="x",
        n_reviews=500,
        n_records=500,
        n_mixed_reviews=0,
        n_with_tradeoff=0,
        attribute_summaries={
            "packaging_container": _summary(
                "packaging_container",
                n_positive=2,
                n_negative=8,
                neg_examples=[
                    {
                        "text": (
                            "패드 크기도 크고 면도 피부에 자극이 가거나 하지않아서 "
                            "좋았는데 안에 토너액이 넉넉하게 들어있는건 아니기도 하고 "
                            "뚜껑이 대충눌러서는 완벽하게 닫"
                        ),
                        "review_id": "midword",
                        "polarity": "negative_weak",
                    },
                ] * 5,
            ),
        },
        tradeoff_pairs=Counter(),
        mixed_attribute_pairs=[],
        delivery_condition_records_total=0,
    )
    out = productreportdata_to_analysis_report(prd)
    attrs = {a["key"]: a for a in out["attributes"]}
    quotes = attrs["packaging_container"].get("top_quotes") or []
    assert quotes
    for q in quotes:
        d = q.get("display_text", "")
        assert not d.endswith("닫"), f"display_text dangled mid-word: {d!r}"


# ---------------------------------------------------------------------------
# Narrative diversification — usage_patterns + who_for_ko.
# ---------------------------------------------------------------------------


def _prd_three_contradictions() -> ProductReportData:
    """Three attributes each meeting the contradiction threshold so
    we can verify usage_patterns rotates through templates."""
    return ProductReportData(
        product_id="x",
        product_name="x",
        n_reviews=2000,
        n_records=2000,
        n_mixed_reviews=100,
        n_with_tradeoff=20,
        attribute_summaries={
            "value_price": _summary("value_price", n_positive=157, n_negative=24),
            "finish_texture": _summary("finish_texture", n_positive=132, n_negative=33),
            "dryness_skin_texture": _summary("dryness_skin_texture", n_positive=53, n_negative=17),
            "adhesion_base_interaction": _summary("adhesion_base_interaction", n_positive=39, n_negative=13),
        },
        tradeoff_pairs=Counter(),
        mixed_attribute_pairs=[],
        delivery_condition_records_total=0,
    )


def test_usage_patterns_diversify_across_entries():
    out = productreportdata_to_analysis_report(_prd_three_contradictions())
    patterns = out["usage_patterns"]
    assert len(patterns) >= 3
    sentences = [p["sentence_ko"] for p in patterns]
    # Strong property: not all sentences use identical phrasing.
    distinct_lead = {s.split(" ")[0] for s in sentences}
    assert len(distinct_lead) >= 2, (
        f"usage_patterns repeat the same template: {sentences}"
    )


def test_usage_patterns_include_business_question():
    out = productreportdata_to_analysis_report(_prd_three_contradictions())
    patterns = out["usage_patterns"]
    assert patterns
    for p in patterns:
        assert "business_question_ko" in p
        assert p["business_question_ko"]


def test_who_for_ko_does_not_use_satisfaction_count_tautology():
    """The previous template — '<X> 만족 후기 N건이 누적되는 사용자' —
    is a tautology. New templates should describe the buyer type,
    not just the existence of positive reviews."""
    out = productreportdata_to_analysis_report(_prd_three_contradictions())
    qd = out["quick_decision"]
    who_for = qd["who_for_ko"]
    assert who_for
    # No entry should use the old "누적되는 사용자" tautological tail.
    for line in who_for:
        assert "누적되는 사용자" not in line, (
            f"who_for_ko still uses old tautological template: {line!r}"
        )
    # Lines must mention either evidence count or positive framing
    # (강점 / 호평 / 만족 / 우선 / 중심) — not be empty descriptions.
    for line in who_for:
        assert any(
            cue in line for cue in ("강점", "호평", "만족", "우선", "중심")
        ), f"who_for line lacks framing cue: {line!r}"


def test_who_for_ko_diversifies_templates():
    """Three strengths should produce three distinguishable lines —
    not the same template repeated three times."""
    out = productreportdata_to_analysis_report(_prd_three_contradictions())
    who_for = out["quick_decision"]["who_for_ko"]
    if len(who_for) >= 3:
        # Strip labels/numbers to compare structural template.
        # A simple proxy: not all three should share the same suffix.
        suffixes = [line.split(" ")[-1] for line in who_for[:3]]
        assert len(set(suffixes)) >= 2, (
            f"who_for_ko repeats one template: {who_for}"
        )
