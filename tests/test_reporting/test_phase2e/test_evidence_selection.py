"""Tests for the score-aware evidence selection in
`src/voc/reporting/phase2e/report.py`.

Covers:
  - score-driven primary order
  - tie-breakers per kind (negative concern vs. positive strength)
  - missing-score safety (falls back to a deterministic legacy-like order)
  - signal-rank label formatting
  - cross-attribute leakage filter still applies
  - dedup + diversity rules still apply
"""

from __future__ import annotations

import pytest

from src.voc.reporting.phase2e.report import (
    AttributeSummary,
    aggregate_product,
    format_sort_signal_labels_ko,
    select_evidence,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ev(
    *,
    review_id: str,
    polarity: str = "negative_strong",
    intensity: int = 3,
    confidence: str = "high",
    span: str = "가격이 너무 비싸요",
    score: float | None = None,
    rating: float | None = None,
    sort_ranks: dict[str, int | None] | None = None,
    review_date: str | None = None,
    delivery: bool = False,
) -> dict:
    """Compact builder for a sample-evidence dict that matches the shape
    `aggregate_product` produces."""
    return {
        "review_id": review_id,
        "polarity": polarity,
        "intensity": intensity,
        "confidence": confidence,
        "evidence_span": span,
        "delivery_condition_flag": delivery,
        "oy_evidence_score": score,
        "rating_normalized": rating,
        "oy_sort_ranks": sort_ranks or {},
        "review_date": review_date,
    }


def _summary_with_neg(*evidences: dict) -> AttributeSummary:
    s = AttributeSummary(attribute="value_price")
    s.n_negative = len(evidences)
    s.sample_evidences_neg = list(evidences)
    return s


def _summary_with_pos(*evidences: dict) -> AttributeSummary:
    s = AttributeSummary(attribute="value_price")
    s.n_positive = len(evidences)
    s.sample_evidences_pos = list(evidences)
    return s


# ---------------------------------------------------------------------------
# Score-driven primary order
# ---------------------------------------------------------------------------


def test_higher_score_evidence_selected_first():
    """The primary sort key. A score=8.0 review must come before a
    score=2.0 review even if everything else (polarity, confidence,
    span) prefers the lower-score review."""
    s = _summary_with_neg(
        _ev(review_id="r_low",
            polarity="negative_strong", confidence="high", intensity=3,
            span="가격이 비싸",  # short span — would win the legacy tie-breakers
            score=2.0),
        _ev(review_id="r_high",
            polarity="negative_weak", confidence="low", intensity=1,
            span="가격이 비싸서 다시는 안 살 거예요",  # longer span
            score=8.0),
    )
    out = select_evidence(s, n=2, kind="negative")
    assert [ex["review_id"] for ex in out] == ["r_high", "r_low"]


def test_missing_score_falls_back_safely():
    """Every row missing a score → no crash; selection still produces a
    deterministic order using the secondary keys (polarity strength,
    span length, date, confidence). No score is treated as 0.0."""
    s = _summary_with_neg(
        _ev(review_id="r_weak",
            polarity="negative_weak", confidence="medium",
            span="가격 별로", score=None, review_date="2026-01-01"),
        _ev(review_id="r_strong",
            polarity="negative_strong", confidence="high",
            span="가격이 비싸요", score=None, review_date="2026-04-01"),
    )
    out = select_evidence(s, n=2, kind="negative")
    # negative_strong wins on the polarity tie-breaker.
    assert out[0]["review_id"] == "r_strong"
    assert len(out) == 2


def test_mixed_score_and_missing_score_in_same_pool():
    """A row WITH a score beats a row without (missing → 0.0). The
    fallback is graceful, not silently equivalent."""
    s = _summary_with_neg(
        _ev(review_id="r_no_score",
            polarity="negative_strong", confidence="high",
            span="가격이 너무 비쌈", score=None),
        _ev(review_id="r_has_score",
            polarity="negative_weak", confidence="low",
            span="가격이 비싸요", score=4.0),
    )
    out = select_evidence(s, n=2, kind="negative")
    assert out[0]["review_id"] == "r_has_score"


# ---------------------------------------------------------------------------
# Tie-breaker rules per kind
# ---------------------------------------------------------------------------


def test_negative_kind_prefers_stronger_negative_polarity_at_tied_score():
    """When scores tie, the negative selector prefers
    negative_strong > negative_weak > mixed. Locks in the kind-specific
    tie-breaker for concern sections."""
    s = _summary_with_neg(
        _ev(review_id="r_mixed",
            polarity="mixed", span="가격은 별로지만 만족", score=5.0),
        _ev(review_id="r_weak",
            polarity="negative_weak", span="가격이 좀 비싸요", score=5.0),
        _ev(review_id="r_strong",
            polarity="negative_strong", span="가격이 너무 비싸요", score=5.0),
    )
    out = select_evidence(s, n=3, kind="negative")
    assert [ex["review_id"] for ex in out] == ["r_strong", "r_weak", "r_mixed"]


def test_positive_kind_prefers_higher_rating_at_tied_score():
    """For strength sections, the positive selector breaks score ties by
    higher rating_normalized — the operator wants the most enthusiastic
    review when intensity is otherwise indistinguishable."""
    s = _summary_with_pos(
        _ev(review_id="r_4star",
            polarity="positive", span="가격이 좋아요", rating=4.0,
            score=3.0),
        _ev(review_id="r_5star",
            polarity="positive", span="가성비 끝판왕", rating=5.0,
            score=3.0),
        _ev(review_id="r_3star",
            polarity="positive", span="가격은 적당", rating=3.0,
            score=3.0),
    )
    out = select_evidence(s, n=3, kind="positive")
    assert [ex["review_id"] for ex in out] == ["r_5star", "r_4star", "r_3star"]


def test_shorter_cleaner_span_breaks_score_and_polarity_ties():
    """Among rows that tie on score AND polarity strength, the shorter
    evidence_span wins. Keeps reports tight."""
    s = _summary_with_neg(
        _ev(review_id="r_long",
            polarity="negative_strong",
            span="가격이 비싸서 정말로 너무 너무 너무 안 좋아요 진짜",
            score=5.0),
        _ev(review_id="r_short",
            polarity="negative_strong",
            span="가격이 비싸요",
            score=5.0),
    )
    out = select_evidence(s, n=2, kind="negative")
    assert out[0]["review_id"] == "r_short"


def test_newer_date_breaks_remaining_ties():
    """When score, polarity, AND span length all tie, prefer the newer
    review date so reports surface fresh evidence."""
    s = _summary_with_neg(
        _ev(review_id="r_old",
            polarity="negative_strong",
            span="가격이 비싸요",
            score=5.0, review_date="2025-01-01"),
        _ev(review_id="r_new",
            polarity="negative_strong",
            span="가격이 비싸",  # same length-ish; reuse identical len for tie
            score=5.0, review_date="2026-04-01"),
    )
    # Make the spans the same length for a true tie:
    s.sample_evidences_neg[0]["evidence_span"] = "가격이 비싸요"
    s.sample_evidences_neg[1]["evidence_span"] = "가격이 비싸요"
    # Need different review_ids so dedup by text doesn't drop one.
    # Test the date tie-breaker via direct sort_key inspection instead:
    from src.voc.reporting.phase2e.report import _evidence_sort_key
    k_old = _evidence_sort_key(s.sample_evidences_neg[0], kind="negative")
    k_new = _evidence_sort_key(s.sample_evidences_neg[1], kind="negative")
    # "newer first" → k_new < k_old in the descending date wrapper.
    assert k_new < k_old


# ---------------------------------------------------------------------------
# Existing protections still hold
# ---------------------------------------------------------------------------


def test_score_does_not_override_cross_attribute_filter():
    """A high-score evidence on a different attribute (no core stem
    match) is still filtered as cross-attribute leakage. Score
    re-ranking must not be a hole through the relevance check."""
    s = _summary_with_neg(
        _ev(review_id="r_off",
            polarity="negative_strong",
            span="포장이 부실해서 실망",  # packaging text, not value_price
            score=10.0),
        _ev(review_id="r_on",
            polarity="negative_weak",
            span="가격이 비싸요",  # has value_price stem
            score=2.0),
    )
    out = select_evidence(s, n=2, kind="negative")
    # The off-topic high-score evidence is filtered out; the on-topic
    # low-score one wins by relevance.
    assert [ex["review_id"] for ex in out] == ["r_on"]


def test_score_dedup_on_evidence_span():
    """Two rows with identical spans are deduped regardless of score."""
    s = _summary_with_neg(
        _ev(review_id="r1", span="가격이 비싸요", score=5.0),
        _ev(review_id="r2", span="가격이 비싸요", score=8.0),
    )
    out = select_evidence(s, n=2, kind="negative", prefer_diverse=True)
    assert len(out) == 1
    # Higher-score row picked.
    assert out[0]["review_id"] == "r2"


def test_score_diversity_on_review_id():
    """Two evidences from the same review_id are collapsed (only one
    surfaces) when prefer_diverse=True. Score doesn't bypass the
    diversity rule."""
    s = _summary_with_neg(
        _ev(review_id="r_same", polarity="negative_strong",
            span="가격이 비싸요", score=8.0),
        _ev(review_id="r_same", polarity="negative_weak",
            span="가격이 좀 비쌈", score=7.0),
        _ev(review_id="r_other", polarity="negative_weak",
            span="가격이 별로", score=3.0),
    )
    out = select_evidence(s, n=3, kind="negative", prefer_diverse=True)
    rids = [ex["review_id"] for ex in out]
    assert rids.count("r_same") == 1
    assert "r_other" in rids


def test_empty_pool_returns_empty():
    s = _summary_with_neg()
    assert select_evidence(s, n=3, kind="negative") == []


def test_positive_kind_uses_pos_pool_not_neg_pool():
    """`kind="positive"` must read sample_evidences_pos, never neg."""
    s = AttributeSummary(attribute="value_price")
    s.sample_evidences_neg = [_ev(review_id="r_neg", polarity="negative_strong",
                                    span="가격이 비싸요", score=10.0)]
    s.sample_evidences_pos = [_ev(review_id="r_pos", polarity="positive",
                                    span="가격이 좋아요", rating=5.0, score=2.0)]
    out = select_evidence(s, n=2, kind="positive")
    assert [ex["review_id"] for ex in out] == ["r_pos"]


# ---------------------------------------------------------------------------
# Signal-rank label formatting
# ---------------------------------------------------------------------------


def test_format_sort_signal_labels_ko_top_ranks():
    labels = format_sort_signal_labels_ko({
        "RATING_ASC": 3,
        "USEFUL_SCORE_DESC": 8,
    })
    assert labels == ["평점 낮은순 TOP 3", "유용한 순 TOP 8"]


def test_format_sort_signal_labels_ko_omits_outside_threshold():
    """Ranks outside the top-10 threshold are not labeled (clutter)."""
    labels = format_sort_signal_labels_ko({
        "RATING_ASC": 3,           # in
        "USEFUL_SCORE_DESC": 50,   # out
    })
    assert labels == ["평점 낮은순 TOP 3"]


def test_format_sort_signal_labels_ko_skips_datetime_desc():
    """DATETIME_DESC is the chronological backbone — every review is
    in it. Labeling it adds no signal value."""
    labels = format_sort_signal_labels_ko({
        "DATETIME_DESC": 1,
        "RATING_ASC": 5,
    })
    assert labels == ["평점 낮은순 TOP 5"]


def test_format_sort_signal_labels_ko_canonical_order():
    """Labels emit in the documented signal-strength order:
    RATING_ASC → USEFUL → RECOMMENDED → RATING_DESC. The strongest
    signal must appear first regardless of input dict insertion order.
    """
    labels = format_sort_signal_labels_ko({
        "RATING_DESC": 4,
        "RECOMMENDED_DESC": 2,
        "RATING_ASC": 6,
        "USEFUL_SCORE_DESC": 1,
    })
    assert labels == [
        "평점 낮은순 TOP 6",
        "유용한 순 TOP 1",
        "추천순 TOP 2",
        "평점 높은순 TOP 4",
    ]


def test_format_sort_signal_labels_ko_handles_none_or_empty():
    assert format_sort_signal_labels_ko(None) == []
    assert format_sort_signal_labels_ko({}) == []


def test_format_sort_signal_labels_ko_skips_null_or_invalid_rank():
    labels = format_sort_signal_labels_ko({
        "RATING_ASC": None,
        "USEFUL_SCORE_DESC": 0,        # invalid
        "RECOMMENDED_DESC": -3,        # invalid
        "RATING_DESC": 7,              # ok
    })
    assert labels == ["평점 높은순 TOP 7"]


def test_format_sort_signal_labels_ko_custom_threshold():
    """`threshold` lets callers widen the labeling range (e.g., when
    surveying mid-tier evidence)."""
    labels = format_sort_signal_labels_ko(
        {"RATING_ASC": 25}, threshold=50,
    )
    assert labels == ["평점 낮은순 TOP 25"]


# ---------------------------------------------------------------------------
# aggregate_product threads review-level fields into sample_evidences
# ---------------------------------------------------------------------------


def test_aggregate_product_attaches_score_and_rating_to_neg_evidences():
    """End-to-end through aggregate_product: per-review fields land on
    every sample_evidence dict. This is the contract select_evidence
    relies on."""
    reviews = [{
        "review_id": "rid_1",
        "mixed_review_flag": False,
        "tradeoff_pair": None,
        "records": [{
            "attribute": "value_price",
            "polarity": "negative_strong",
            "intensity": 3,
            "evidence_span": "가격이 너무 비싸요",
            "confidence": "high",
            "delivery_condition_flag": False,
        }],
        "oy_evidence_score": 8.7,
        "rating_normalized": 1.0,
        "oy_sort_ranks": {"RATING_ASC": 4, "USEFUL_SCORE_DESC": 9},
        "review_date": "2026-04-15",
    }]
    data = aggregate_product(
        product_id="A0001",
        product_name="P",
        reviews=reviews,
    )
    s = data.attribute_summaries["value_price"]
    assert len(s.sample_evidences_neg) == 1
    ev = s.sample_evidences_neg[0]
    assert ev["oy_evidence_score"] == 8.7
    assert ev["rating_normalized"] == 1.0
    assert ev["oy_sort_ranks"] == {"RATING_ASC": 4, "USEFUL_SCORE_DESC": 9}
    assert ev["review_date"] == "2026-04-15"


def test_aggregate_product_legacy_review_block_without_extra_fields():
    """A review block missing the new fields still aggregates cleanly —
    the sample_evidence dict carries None / {} for the new keys."""
    reviews = [{
        "review_id": "rid_1",
        "mixed_review_flag": False,
        "tradeoff_pair": None,
        "records": [{
            "attribute": "value_price",
            "polarity": "negative_strong",
            "intensity": 2,
            "evidence_span": "가격이 비싸요",
            "confidence": "medium",
            "delivery_condition_flag": False,
        }],
    }]
    data = aggregate_product(
        product_id="A0001", product_name="P", reviews=reviews,
    )
    ev = data.attribute_summaries["value_price"].sample_evidences_neg[0]
    assert ev["oy_evidence_score"] is None
    assert ev["rating_normalized"] is None
    assert ev["oy_sort_ranks"] == {}
    assert ev["review_date"] is None
