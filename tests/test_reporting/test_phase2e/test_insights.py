"""Tests for `src/voc/reporting/phase2e/insights.py`.

The synthesis is template-based and deterministic, so each test stages
a minimal AttributeSummary + ProductReportData fixture and asserts the
exact (or substring) form of the generated Korean sentence.

Coverage:
  - Negative templates: RATING_ASC + cross / RATING_ASC alone /
    community / frequency-only
  - Positive templates: RATING_DESC + RECOMMENDED / RATING_DESC alone /
    RECOMMENDED alone / USEFUL / frequency-only
  - Polarity / frequency thresholds for kind-specific priority labels
  - Empty / zero-count attributes are skipped
  - Top-N selection picks most-flagged attributes
  - Legacy data (no scores, no sort_ranks) still produces an insight
"""

from __future__ import annotations

from collections import Counter

from src.voc.reporting.phase2e.report import (
    AttributeSummary,
    ProductReportData,
)
from src.voc.reporting.phase2e.insights import (
    AttributeInsight,
    _collect_top_signal_sources,
    _join_signal_labels_ko,
    synthesize_attribute_insights,
)


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


# ---------------------------------------------------------------------------
# Negative templates
# ---------------------------------------------------------------------------


def test_negative_template_rating_asc_plus_cross_confirm():
    """Strongest case: complaint surfaces in BOTH RATING_ASC top-rank
    AND a community-validated sort. Expected sentence shape matches
    the example in the task description."""
    s = _summary(
        "transfer_resistance", n_negative=30, avg_intensity_neg=2.8,
        neg_evidences=[_ev(
            review_id="r1", span="마스크에 옷에 다 묻어요",
            sort_ranks={"RATING_ASC": 2, "USEFUL_SCORE_DESC": 5},
            score=8.5,
        )],
    )
    data = _build_data(attributes={"transfer_resistance": s})
    insights = synthesize_attribute_insights(data)
    assert len(insights["negative"]) == 1
    ins = insights["negative"][0]
    assert ins.kind == "negative"
    # The sentence references both the primary (평점 낮은순) and the
    # cross-confirm (유용한 순) sources, ending with the high-priority
    # conclusion.
    assert "평점 낮은순 상위 리뷰에서 반복적으로 언급" in ins.ko_summary
    assert "유용한 순" in ins.ko_summary
    assert "에서도 확인되어 개선 우선순위가 높습니다" in ins.ko_summary


def test_negative_template_rating_asc_alone():
    """RATING_ASC top-rank but no cross-confirm signal — same priority
    conclusion, but without the cross-source clause."""
    s = _summary(
        "value_price", n_negative=15, avg_intensity_neg=2.5,
        neg_evidences=[_ev(
            review_id="r1", span="가격이 너무 비싸요",
            sort_ranks={"RATING_ASC": 1},
            score=6.5,
        )],
    )
    data = _build_data(attributes={"value_price": s})
    insights = synthesize_attribute_insights(data)
    ins = insights["negative"][0]
    assert "평점 낮은순 상위 리뷰에서 반복적으로 언급되어 개선 우선순위가 높습니다" in ins.ko_summary
    # No cross-confirm phrase.
    assert "에서도 확인되어" not in ins.ko_summary


def test_negative_template_community_only_no_rating_asc():
    """USEFUL_SCORE_DESC top-rank but no RATING_ASC dominance →
    community-noted but not yet escalated to high priority."""
    s = _summary(
        "applicator_tool", n_negative=8, avg_intensity_neg=2.0,
        neg_evidences=[_ev(
            review_id="r1", span="퍼프가 별로예요",
            sort_ranks={"USEFUL_SCORE_DESC": 4},
            score=3.5,
        )],
    )
    data = _build_data(attributes={"applicator_tool": s})
    ins = insights = synthesize_attribute_insights(data)["negative"][0]
    assert "유용한 순 상위 리뷰에서 언급되어 모니터링이 필요합니다" in ins.ko_summary
    # No RATING_ASC mention.
    assert "평점 낮은순" not in ins.ko_summary


def test_negative_template_frequency_only_when_no_top_rank_signals():
    """Top-3 evidences all have no top-tier rank in any signal sort →
    fall back to a frequency-only sentence with the percentage."""
    s = _summary(
        "value_price", n_negative=20, avg_intensity_neg=1.5,
        neg_evidences=[_ev(
            review_id="r1", span="가격이 비싸요",
            sort_ranks={"DATETIME_DESC": 100},  # backbone — never a signal
            score=2.0,
        )],
    )
    data = _build_data(n_reviews=100, attributes={"value_price": s})
    ins = synthesize_attribute_insights(data)["negative"][0]
    assert "전체 리뷰의 20%" in ins.ko_summary
    assert "추세 모니터링이 필요합니다" in ins.ko_summary
    # No sort-button source phrase.
    assert "평점 낮은순" not in ins.ko_summary
    assert "유용한 순" not in ins.ko_summary


def test_negative_template_two_cross_signals_joined_with_slash():
    """When BOTH USEFUL and RECOMMENDED cross-confirm, the labels join
    with '/' for compactness (vs comma for 3+ signals)."""
    s = _summary(
        "color_tone_matching", n_negative=12, avg_intensity_neg=2.2,
        neg_evidences=[_ev(
            review_id="r1", span="톤이 안 맞아요",
            sort_ranks={
                "RATING_ASC": 3,
                "USEFUL_SCORE_DESC": 6,
                "RECOMMENDED_DESC": 4,
            },
            score=7.0,
        )],
    )
    data = _build_data(attributes={"color_tone_matching": s})
    ins = synthesize_attribute_insights(data)["negative"][0]
    # Two cross-signals → joined with '/'
    assert "유용한 순/추천순" in ins.ko_summary


def test_rating_desc_does_not_cross_confirm_negative():
    """A negative review surfacing in RATING_DESC (high-rating list) is
    unusual evidence — we deliberately don't let it cross-confirm a
    negative insight, to avoid overstating the signal."""
    s = _summary(
        "value_price", n_negative=10, avg_intensity_neg=2.0,
        neg_evidences=[_ev(
            review_id="r1", span="가격이 비싸요",
            sort_ranks={
                "RATING_ASC": 3,    # critical signal — drives high priority
                "RATING_DESC": 2,   # NOT counted as cross-confirm here
            },
            score=5.0,
        )],
    )
    data = _build_data(attributes={"value_price": s})
    ins = synthesize_attribute_insights(data)["negative"][0]
    # The sentence is the "RATING_ASC alone" form (no 에서도 확인되어).
    assert "에서도 확인되어" not in ins.ko_summary


# ---------------------------------------------------------------------------
# Positive templates
# ---------------------------------------------------------------------------


def test_positive_template_rating_desc_plus_recommended():
    """Strongest positive: RATING_DESC top + RECOMMENDED top → 핵심 강점."""
    s = _summary(
        "pigmentation", n_positive=40,
        pos_evidences=[_ev(
            review_id="r1", span="발색이 정말 좋아요",
            polarity="positive", rating=5.0,
            sort_ranks={"RATING_DESC": 1, "RECOMMENDED_DESC": 2},
            score=6.5,
        )],
    )
    data = _build_data(n_reviews=100, attributes={"pigmentation": s})
    ins = synthesize_attribute_insights(data)["positive"][0]
    assert ins.kind == "positive"
    assert "평점 높은순 상위 리뷰에서 자주 언급" in ins.ko_summary
    assert "추천순 상위 리뷰에서도 확인되어 핵심 강점입니다" in ins.ko_summary


def test_positive_template_rating_desc_alone():
    s = _summary(
        "persistence", n_positive=20,
        pos_evidences=[_ev(
            review_id="r1", span="지속력이 길어요",
            polarity="positive", rating=5.0,
            sort_ranks={"RATING_DESC": 4},
            score=4.5,
        )],
    )
    data = _build_data(n_reviews=100, attributes={"persistence": s})
    ins = synthesize_attribute_insights(data)["positive"][0]
    assert "평점 높은순 상위 리뷰에서 강조되어 핵심 강점으로 자리잡고 있습니다" in ins.ko_summary
    assert "추천순" not in ins.ko_summary


def test_positive_template_recommended_alone():
    s = _summary(
        "finish_texture", n_positive=10,
        pos_evidences=[_ev(
            review_id="r1", span="마무리감이 자연스러워요",
            polarity="positive", rating=4.0,
            sort_ranks={"RECOMMENDED_DESC": 5},
            score=3.0,
        )],
    )
    data = _build_data(n_reviews=100, attributes={"finish_texture": s})
    ins = synthesize_attribute_insights(data)["positive"][0]
    assert "추천순 상위 리뷰에서 확인되어 강점으로 작용합니다" in ins.ko_summary


def test_positive_template_useful_alone():
    """USEFUL_SCORE_DESC alone — community-valued positive evidence."""
    s = _summary(
        "application_blending", n_positive=8,
        pos_evidences=[_ev(
            review_id="r1", span="발림성이 좋아요",
            polarity="positive", rating=4.0,
            sort_ranks={"USEFUL_SCORE_DESC": 2},
            score=2.5,
        )],
    )
    data = _build_data(n_reviews=100, attributes={"application_blending": s})
    ins = synthesize_attribute_insights(data)["positive"][0]
    assert "유용한 순 상위 리뷰에서 강조되어 강점입니다" in ins.ko_summary


def test_positive_template_frequency_only():
    s = _summary(
        "value_price", n_positive=12,
        pos_evidences=[_ev(
            review_id="r1", span="가격이 좋아요",
            polarity="positive", rating=4.0,
            sort_ranks={},  # no signal-sort top-rank
            score=1.0,
        )],
    )
    data = _build_data(n_reviews=100, attributes={"value_price": s})
    ins = synthesize_attribute_insights(data)["positive"][0]
    assert "전체 리뷰의 12%에서 확인되어 강점으로 평가됩니다" in ins.ko_summary


def test_rating_asc_does_not_promote_positive():
    """A positive review somehow surfacing in RATING_ASC (low-rating
    list) is unusual; we don't let it count as positive cross-confirm."""
    s = _summary(
        "pigmentation", n_positive=25,
        pos_evidences=[_ev(
            review_id="r1", span="발색 좋아요",
            polarity="positive", rating=4.0,
            sort_ranks={"RATING_ASC": 3, "RATING_DESC": 4},
            score=3.0,
        )],
    )
    data = _build_data(n_reviews=100, attributes={"pigmentation": s})
    ins = synthesize_attribute_insights(data)["positive"][0]
    # The selected template is RATING_DESC-alone; RATING_ASC is ignored
    # for positive synthesis.
    assert "평점 높은순 상위 리뷰에서 강조되어 핵심 강점으로 자리잡고 있습니다" in ins.ko_summary
    assert "평점 낮은순" not in ins.ko_summary


# ---------------------------------------------------------------------------
# Priority labels
# ---------------------------------------------------------------------------


def test_negative_priority_uses_compute_priority():
    """High frequency + high severity → 'High' priority label, matching
    the existing `compute_priority` thresholds."""
    s = _summary(
        "transfer_resistance", n_negative=35, avg_intensity_neg=2.8,
        neg_evidences=[_ev(
            review_id="r1", span="옷에 묻어요",
            sort_ranks={"RATING_ASC": 1},
        )],
    )
    data = _build_data(n_reviews=100, attributes={"transfer_resistance": s})
    ins = synthesize_attribute_insights(data)["negative"][0]
    assert ins.priority_label == "High"


def test_negative_priority_low_for_few_mentions():
    s = _summary(
        "value_price", n_negative=2, avg_intensity_neg=1.5,
        neg_evidences=[_ev(
            review_id="r1", span="가격이 비싸요",
            sort_ranks={},
        )],
    )
    data = _build_data(n_reviews=100, attributes={"value_price": s})
    ins = synthesize_attribute_insights(data)["negative"][0]
    assert ins.priority_label == "Low"


def test_positive_priority_strong_at_30pct():
    """Positive priority uses its own coarse tiering (Strong/Moderate/Mild)
    derived from positive percentage of corpus."""
    s = _summary(
        "pigmentation", n_positive=40,
        pos_evidences=[_ev(
            review_id="r1", span="발색 좋아요",
            polarity="positive", rating=5.0, sort_ranks={"RATING_DESC": 1},
        )],
    )
    data = _build_data(n_reviews=100, attributes={"pigmentation": s})
    ins = synthesize_attribute_insights(data)["positive"][0]
    assert ins.priority_label == "Strong"


def test_positive_priority_moderate_around_15pct():
    s = _summary(
        "persistence", n_positive=18,
        pos_evidences=[_ev(
            review_id="r1", span="지속력 좋아요",
            polarity="positive", rating=4.0, sort_ranks={"RATING_DESC": 4},
        )],
    )
    data = _build_data(n_reviews=100, attributes={"persistence": s})
    ins = synthesize_attribute_insights(data)["positive"][0]
    assert ins.priority_label == "Moderate"


# ---------------------------------------------------------------------------
# Skips + selection
# ---------------------------------------------------------------------------


def test_skips_attributes_with_zero_negative():
    """An attribute with n_negative=0 produces no negative insight, even
    if it has positive activity. (And vice versa.)"""
    s = _summary(
        "packaging_container", n_negative=0, n_positive=5,
        pos_evidences=[_ev(
            review_id="r1", span="용기가 예뻐요",
            polarity="positive", rating=5.0,
            sort_ranks={"RATING_DESC": 3},
        )],
    )
    data = _build_data(n_reviews=100, attributes={"packaging_container": s})
    out = synthesize_attribute_insights(data)
    assert out["negative"] == []
    assert len(out["positive"]) == 1


def test_skips_attribute_with_no_evidence_pool():
    """Defensive: even if n_negative > 0 but the sample pool is empty
    (a bug in upstream aggregation, or filtered out), we don't emit
    a sentence with nothing to back it up."""
    s = _summary(
        "value_price", n_negative=10, avg_intensity_neg=2.0,
        neg_evidences=[],   # empty pool — no insight should be produced
    )
    data = _build_data(n_reviews=100, attributes={"value_price": s})
    out = synthesize_attribute_insights(data)
    assert out["negative"] == []


def test_top_n_negative_picks_most_flagged():
    """Top-N is by n_negative count, NOT alphabetical or insertion order."""
    attrs = {
        "value_price": _summary(
            "value_price", n_negative=5,
            neg_evidences=[_ev(span="가격이 비싸요", sort_ranks={})],
        ),
        "transfer_resistance": _summary(
            "transfer_resistance", n_negative=30, avg_intensity_neg=2.5,
            neg_evidences=[_ev(span="옷에 묻어요",
                                sort_ranks={"RATING_ASC": 1})],
        ),
        "applicator_tool": _summary(
            "applicator_tool", n_negative=12,
            neg_evidences=[_ev(span="퍼프가 별로예요",
                                sort_ranks={"USEFUL_SCORE_DESC": 3})],
        ),
    }
    data = _build_data(n_reviews=100, attributes=attrs)
    out = synthesize_attribute_insights(data, top_n_negative=2)
    rendered = [ins.attribute for ins in out["negative"]]
    assert rendered == ["transfer_resistance", "applicator_tool"]


def test_legacy_evidence_no_score_no_sort_ranks_still_produces_insight():
    """A pre-scoring run leaves sample_evidences without score or sort
    ranks. Synthesis must still produce a sensible frequency-only
    insight, not crash or emit empty text."""
    s = _summary(
        "value_price", n_negative=15, avg_intensity_neg=2.0,
        neg_evidences=[{
            "review_id": "rid",
            "polarity": "negative_strong",
            "intensity": 2,
            "confidence": "medium",
            "evidence_span": "가격이 비싸요",
            "delivery_condition_flag": False,
            # no oy_evidence_score / oy_sort_ranks / rating_normalized
        }],
    )
    data = _build_data(n_reviews=100, attributes={"value_price": s})
    ins = synthesize_attribute_insights(data)["negative"][0]
    assert "전체 리뷰의 15%" in ins.ko_summary
    # Score field defaults to 0.0 (not None) so the renderer can
    # display a numeric chip without conditional logic.
    assert ins.score_max == 0.0


def test_n_supporting_matches_select_evidence_output_size():
    """n_supporting is the count of evidences that fed the synthesis,
    capped at 3 by select_evidence's default n=3."""
    s = _summary(
        "transfer_resistance", n_negative=10, avg_intensity_neg=2.5,
        neg_evidences=[
            _ev(review_id=f"r{i}", span=f"옷에 묻어요 #{i}",
                sort_ranks={"RATING_ASC": i + 1})
            for i in range(5)
        ],
    )
    data = _build_data(n_reviews=100, attributes={"transfer_resistance": s})
    ins = synthesize_attribute_insights(data)["negative"][0]
    # select_evidence default n=3; cross-attribute filter trims those
    # without core stems — "옷에 묻어요" matches transfer_resistance stems
    # ("옷에", "묻어"), so all 3 survive.
    assert ins.n_supporting <= 3


def test_returns_empty_lists_for_completely_empty_data():
    data = _build_data(n_reviews=0, attributes={})
    out = synthesize_attribute_insights(data)
    assert out == {"negative": [], "positive": []}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def test_collect_top_signal_sources_canonical_order():
    """Output order is signal-strength priority, NOT input dict order."""
    evidences = [_ev(sort_ranks={
        "RATING_DESC": 4,
        "RATING_ASC": 6,
        "USEFUL_SCORE_DESC": 1,
    })]
    out = _collect_top_signal_sources(evidences)
    assert out == ["RATING_ASC", "USEFUL_SCORE_DESC", "RATING_DESC"]


def test_collect_top_signal_sources_ignores_below_threshold():
    evidences = [_ev(sort_ranks={"RATING_ASC": 50})]  # tail tier
    assert _collect_top_signal_sources(evidences) == []


def test_collect_top_signal_sources_skips_datetime_desc():
    evidences = [_ev(sort_ranks={
        "DATETIME_DESC": 1,    # backbone — ignored
        "RATING_ASC": 5,
    })]
    assert _collect_top_signal_sources(evidences) == ["RATING_ASC"]


def test_join_signal_labels_ko_one_two_three():
    assert _join_signal_labels_ko(["RATING_ASC"]) == "평점 낮은순"
    assert _join_signal_labels_ko([
        "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
    ]) == "유용한 순/추천순"
    assert _join_signal_labels_ko([
        "RATING_ASC", "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
    ]) == "평점 낮은순, 유용한 순, 추천순"


# ---------------------------------------------------------------------------
# AttributeInsight is a hashable, frozen dataclass
# ---------------------------------------------------------------------------


def test_attribute_insight_is_frozen_dataclass():
    ins = AttributeInsight(
        attribute="x", kind="negative", ko_summary="...",
        n_supporting=1, score_max=5.0,
        signal_sources=["RATING_ASC"], priority_label="High",
    )
    # Frozen → assigning to a field raises.
    import dataclasses
    assert dataclasses.is_dataclass(ins)
    try:
        ins.kind = "positive"
    except dataclasses.FrozenInstanceError:
        pass
    else:
        assert False, "expected FrozenInstanceError"
