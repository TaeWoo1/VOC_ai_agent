"""Tests for `build_candidate_pool`.

Pure function — no I/O, no DB, no network. Determinism is the
load-bearing contract: same input → byte-stable output.
"""
from __future__ import annotations

import copy
import json

import pytest

from src.voc.content.unique_insights.candidate_pool import build_candidate_pool
from src.voc.content.unique_insights.schema import (
    BASELINE_CAVEAT_PROFILE_CURATED_KO,
    BASELINE_CAVEAT_UNCERTAIN_KO,
    CONCENTRATED_COMPLAINTS_MIN_N_NEGATIVE,
    CROSS_ATTRIBUTE_TRADEOFFS_MIN_COUNT,
    HIGH_FREQUENCY_STRENGTHS_MIN_N_POSITIVE,
    MAX_CONCENTRATED_COMPLAINTS,
    MAX_CROSS_ATTRIBUTE_TRADEOFFS,
    MAX_HIGH_FREQUENCY_STRENGTHS,
    MAX_POLARITY_OUTLIERS,
    MAX_USAGE_CONTEXT_SIGNALS,
    POLARITY_OUTLIER_DEVIATION_THRESHOLD,
    POLARITY_OUTLIER_NEGATIVE_SHARE_THRESHOLD,
)


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


def _q(text: str, rid: str, *, polarity: str | None = None) -> dict:
    out: dict = {"text": text, "review_id": rid}
    if polarity is not None:
        out["polarity"] = polarity
    return out


def _rich_report() -> dict:
    return {
        "schema_version": "3.0",
        "product": {"slug": "demo", "name_ko": "데모"},
        "corpus": {"n_reviews_total": 1135},
        "attributes": [
            {
                "key": "pigmentation",
                "label_ko": "발색",
                "n_positive": 181, "n_negative": 71, "n_mixed": 12,
                "top_quotes": [
                    _q("발색이 정말 진하고 예뻐요", "r1", polarity="positive"),
                    _q("색이 너무 잘 나와요", "r2", polarity="positive"),
                    _q("시간 지나면 변색돼요", "r3", polarity="negative_strong"),
                ],
            },
            {
                "key": "persistence",
                "label_ko": "지속력",
                "n_positive": 47, "n_negative": 12, "n_mixed": 4,
                "top_quotes": [
                    _q("지속력 정말 좋아요 하루 가요", "r4", polarity="positive"),
                ],
            },
            {
                "key": "transfer_resistance",
                "label_ko": "묻어남",
                "n_positive": 5, "n_negative": 38, "n_mixed": 6,
                "top_quotes": [
                    _q("마스크에 묻어나요 정말", "r5", polarity="negative_strong"),
                    _q("옷에도 묻어나서 아쉬워요", "r6", polarity="negative_strong"),
                ],
            },
            {
                "key": "application_blending",
                "label_ko": "발림성",
                "n_positive": 32, "n_negative": 8, "n_mixed": 2,
                "top_quotes": [
                    _q("발림성이 부드러워요", "r7", polarity="positive"),
                ],
            },
            {
                # Below threshold for high_frequency_strengths (n_pos=8 < 10)
                "key": "finish_texture",
                "label_ko": "마무리감",
                "n_positive": 8, "n_negative": 3, "n_mixed": 1,
                "top_quotes": [_q("자연스러운 마무리감", "r8", polarity="positive")],
            },
        ],
        "monitoring_candidates": [
            {
                "attribute_key": "transfer_resistance",
                "concern_label_ko": "묻어남",
                "n_negative": 38,
                "top_negative_quotes": [
                    _q("마스크에 묻어나요 정말", "r5", polarity="negative_strong"),
                    _q("옷에도 묻어나서 아쉬워요", "r6", polarity="negative_strong"),
                ],
            },
            {
                "attribute_key": "pigmentation",
                "concern_label_ko": "발색 변화",
                "n_negative": 12,
                "top_negative_quotes": [
                    _q("시간 지나면 변색돼요", "r3", polarity="negative_strong"),
                ],
            },
        ],
        "tradeoffs": [
            {"pair": "pigmentation:positive -> transfer_resistance:negative_strong", "count": 14},
            {"pair": "persistence:positive -> dryness_skin_texture:negative_weak", "count": 6},
            {"pair": "application_blending:positive -> finish_texture:negative_weak", "count": 2},  # below threshold
        ],
        "usage_patterns": [
            {"kind": "usage_context", "sentence_ko": "마스크 환경에서 묻어남 호소가 반복됩니다", "evidence_count": 24},
            {"kind": "contradiction", "sentence_ko": "ignored_by_pool", "evidence_count": 99},
            {"kind": "usage_context", "sentence_ko": "건성 피부에서 만족도 높음", "evidence_count": 12},
        ],
    }


def _profile_with_baseline() -> dict:
    return {
        "profile_id": "makeup_blush",
        "baseline_attribute_distribution": {
            "pigmentation":         {"expected_positive_share": 0.85},
            "persistence":          {"expected_positive_share": 0.80},
            "transfer_resistance":  {"expected_positive_share": 0.45},  # tradeoff-heavy expected
            "application_blending": {"expected_positive_share": 0.85},
            "finish_texture":       {"expected_positive_share": 0.80},
        },
    }


# ---------------------------------------------------------------------------
# happy path
# ---------------------------------------------------------------------------


class TestHappyPath:
    def test_returns_candidate_pool(self):
        pool = build_candidate_pool(_rich_report())
        # A few buckets should be populated for the rich fixture.
        assert pool.high_frequency_strengths
        assert pool.concentrated_complaints
        assert pool.cross_attribute_tradeoffs

    def test_candidate_ids_assigned_per_bucket(self):
        pool = build_candidate_pool(_rich_report())
        # Each bucket has its own prefix; ids are 3-digit zero-padded.
        for e in pool.high_frequency_strengths:
            assert e.candidate_id.startswith("cand_strength_")
        for e in pool.concentrated_complaints:
            assert e.candidate_id.startswith("cand_complaint_")
        for e in pool.cross_attribute_tradeoffs:
            assert e.candidate_id.startswith("cand_tradeoff_")
        for e in pool.polarity_outliers:
            assert e.candidate_id.startswith("cand_outlier_")
        for e in pool.usage_context_signals:
            assert e.candidate_id.startswith("cand_usage_")

    def test_candidate_ids_unique_within_bucket(self):
        pool = build_candidate_pool(_rich_report())
        for bucket in (
            pool.high_frequency_strengths,
            pool.concentrated_complaints,
            pool.cross_attribute_tradeoffs,
            pool.polarity_outliers,
            pool.usage_context_signals,
        ):
            ids = [e.candidate_id for e in bucket]
            assert len(ids) == len(set(ids))

    def test_candidate_ids_deterministic(self):
        a = build_candidate_pool(_rich_report())
        b = build_candidate_pool(_rich_report())
        assert [e.candidate_id for e in a.high_frequency_strengths] == \
               [e.candidate_id for e in b.high_frequency_strengths]

    def test_baseline_source_uncertain_without_profile(self):
        pool = build_candidate_pool(_rich_report())
        assert pool.category_baseline_source == "uncertain"
        assert pool.baseline_caveat_ko == BASELINE_CAVEAT_UNCERTAIN_KO

    def test_baseline_source_curated_with_profile(self):
        pool = build_candidate_pool(_rich_report(), profile=_profile_with_baseline())
        assert pool.category_baseline_source == "profile_curated"
        assert pool.baseline_caveat_ko == BASELINE_CAVEAT_PROFILE_CURATED_KO

    def test_non_dict_report_raises(self):
        with pytest.raises(TypeError):
            build_candidate_pool([])  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# bucket: high_frequency_strengths
# ---------------------------------------------------------------------------


class TestHighFrequencyStrengths:
    def test_excludes_below_threshold(self):
        pool = build_candidate_pool(_rich_report())
        keys = {e.attribute_key for e in pool.high_frequency_strengths}
        assert "finish_texture" not in keys  # n_pos=8 < 10
        assert "pigmentation" in keys
        assert "persistence" in keys
        assert "application_blending" in keys

    def test_excludes_when_negative_dominates(self):
        pool = build_candidate_pool(_rich_report())
        keys = {e.attribute_key for e in pool.high_frequency_strengths}
        # transfer_resistance: n_pos=5, n_neg=38 → not a strength
        assert "transfer_resistance" not in keys

    def test_sorted_by_n_pos_desc(self):
        pool = build_candidate_pool(_rich_report())
        counts = [e.n_pos for e in pool.high_frequency_strengths]
        assert counts == sorted(counts, reverse=True)

    def test_evidence_only_positive_quotes(self):
        pool = build_candidate_pool(_rich_report())
        pig = next(
            e for e in pool.high_frequency_strengths if e.attribute_key == "pigmentation"
        )
        # Negative quote r3 must NOT appear in this bucket's evidence.
        assert "r3" not in pig.evidence_review_ids
        assert "r1" in pig.evidence_review_ids

    def test_baseline_comparison_signed_when_profile(self):
        pool = build_candidate_pool(_rich_report(), profile=_profile_with_baseline())
        pig = next(
            e for e in pool.high_frequency_strengths if e.attribute_key == "pigmentation"
        )
        # actual = 181 / (181+71+12) = 181/264 ≈ 0.6856
        # expected = 0.85 → deviation = -0.1644
        assert pig.baseline_comparison is not None
        assert pig.baseline_comparison < 0
        assert abs(pig.baseline_comparison - (181 / 264 - 0.85)) < 1e-3

    def test_baseline_comparison_none_without_profile(self):
        pool = build_candidate_pool(_rich_report())
        for e in pool.high_frequency_strengths:
            assert e.baseline_comparison is None

    def test_cap_respected(self):
        # Synthesize many strength attributes
        report = {"attributes": [
            {
                "key": f"attr{i}",
                "label_ko": f"속성{i}",
                "n_positive": 100 - i, "n_negative": 0, "n_mixed": 0,
                "top_quotes": [_q(f"호평 {i}", f"r{i}_a", polarity="positive"),
                               _q(f"호평2 {i}", f"r{i}_b", polarity="positive")],
            }
            for i in range(20)
        ]}
        pool = build_candidate_pool(report)
        assert len(pool.high_frequency_strengths) == MAX_HIGH_FREQUENCY_STRENGTHS


# ---------------------------------------------------------------------------
# bucket: concentrated_complaints
# ---------------------------------------------------------------------------


class TestConcentratedComplaints:
    def test_above_threshold_included(self):
        pool = build_candidate_pool(_rich_report())
        keys = {e.attribute_key for e in pool.concentrated_complaints}
        assert "transfer_resistance" in keys
        assert "pigmentation" in keys

    def test_below_threshold_excluded(self):
        report = _rich_report()
        for c in report["monitoring_candidates"]:
            c["n_negative"] = 1
        pool = build_candidate_pool(report)
        assert pool.concentrated_complaints == ()

    def test_sorted_by_n_neg_desc(self):
        pool = build_candidate_pool(_rich_report())
        counts = [e.n_neg for e in pool.concentrated_complaints]
        assert counts == sorted(counts, reverse=True)

    def test_uses_top_negative_quotes(self):
        pool = build_candidate_pool(_rich_report())
        tr = next(
            e for e in pool.concentrated_complaints
            if e.attribute_key == "transfer_resistance"
        )
        assert "r5" in tr.evidence_review_ids
        assert "r6" in tr.evidence_review_ids

    def test_label_falls_back_to_attribute(self):
        report = _rich_report()
        for c in report["monitoring_candidates"]:
            c["concern_label_ko"] = ""  # blank → fall back to attribute label
        pool = build_candidate_pool(report)
        tr = next(
            e for e in pool.concentrated_complaints
            if e.attribute_key == "transfer_resistance"
        )
        assert tr.label_ko == "묻어남"


# ---------------------------------------------------------------------------
# bucket: cross_attribute_tradeoffs
# ---------------------------------------------------------------------------


class TestCrossAttributeTradeoffs:
    def test_count_threshold(self):
        pool = build_candidate_pool(_rich_report())
        pairs = [e.attribute_key for e in pool.cross_attribute_tradeoffs]
        # 14 + 6 pass threshold (≥3); the 2-count pair is dropped
        assert any("pigmentation:positive" in p for p in pairs)
        assert any("persistence:positive" in p for p in pairs)
        assert not any("application_blending:positive" in p for p in pairs)

    def test_synthesizes_evidence_from_both_attributes(self):
        pool = build_candidate_pool(_rich_report())
        pair = next(
            e for e in pool.cross_attribute_tradeoffs
            if "pigmentation:positive -> transfer_resistance" in e.attribute_key
        )
        # for_attribute=pigmentation positives + against_attribute=transfer_resistance negatives
        assert "r1" in pair.evidence_review_ids   # pigmentation positive
        assert "r5" in pair.evidence_review_ids   # transfer_resistance negative

    def test_unparseable_pair_dropped(self):
        report = _rich_report()
        report["tradeoffs"].append({"pair": "garbage", "count": 99})
        pool = build_candidate_pool(report)
        for e in pool.cross_attribute_tradeoffs:
            assert "garbage" not in e.attribute_key

    def test_sorted_by_count_desc(self):
        # Indirectly: first entry should be the highest-count pair
        pool = build_candidate_pool(_rich_report())
        # 14 first, then 6
        first = pool.cross_attribute_tradeoffs[0].attribute_key
        assert "pigmentation:positive -> transfer_resistance" in first

    def test_cap_respected(self):
        report = _rich_report()
        # Add 5 more eligible tradeoffs. Pair regex accepts only
        # `[a-z_]+` for attribute names, so use valid Stage 1 keys.
        synth_against = (
            "dryness_skin_texture", "color_tone_matching",
            "applicator_tool", "value_price", "packaging_container",
        )
        for i, against in enumerate(synth_against):
            report["tradeoffs"].append({
                "pair": f"persistence:positive -> {against}:negative_weak",
                "count": 100 + i,
            })
        pool = build_candidate_pool(report)
        assert len(pool.cross_attribute_tradeoffs) == MAX_CROSS_ATTRIBUTE_TRADEOFFS


# ---------------------------------------------------------------------------
# bucket: polarity_outliers
# ---------------------------------------------------------------------------


class TestPolarityOutliers:
    def test_without_baseline_uses_negative_share(self):
        pool = build_candidate_pool(_rich_report())
        # transfer_resistance: n_pos=5, n_neg=38 → neg_share = 38/43 ≈ 0.88, ≥0.4
        keys = {e.attribute_key for e in pool.polarity_outliers}
        assert "transfer_resistance" in keys

    def test_with_baseline_uses_deviation(self):
        report = _rich_report()
        # pigmentation actual_positive_share = 181/264 ≈ 0.685
        # baseline expected = 0.85 → deviation = -0.165 (|.| < 0.25, NOT outlier)
        # transfer_resistance actual = 5/49 ≈ 0.102; baseline = 0.45 → -0.348 (outlier)
        pool = build_candidate_pool(report, profile=_profile_with_baseline())
        keys = {e.attribute_key for e in pool.polarity_outliers}
        assert "transfer_resistance" in keys
        # pigmentation deviation magnitude is below the 0.25 threshold
        assert "pigmentation" not in keys

    def test_total_below_min_excluded(self):
        report = {
            "attributes": [{
                "key": "rare_attr",
                "label_ko": "희귀속성",
                "n_positive": 1, "n_negative": 1, "n_mixed": 0,
                "top_quotes": [],
            }]
        }
        pool = build_candidate_pool(report)
        assert pool.polarity_outliers == ()

    def test_baseline_comparison_set_when_profile_present(self):
        pool = build_candidate_pool(_rich_report(), profile=_profile_with_baseline())
        for e in pool.polarity_outliers:
            assert e.baseline_comparison is not None


# ---------------------------------------------------------------------------
# bucket: usage_context_signals
# ---------------------------------------------------------------------------


class TestUsageContextSignals:
    def test_only_usage_context_kind(self):
        pool = build_candidate_pool(_rich_report())
        labels = [e.label_ko for e in pool.usage_context_signals]
        assert "ignored_by_pool" not in labels
        assert any("마스크 환경" in (l or "") for l in labels)
        assert any("건성 피부" in (l or "") for l in labels)

    def test_sorted_by_evidence_count_desc(self):
        pool = build_candidate_pool(_rich_report())
        # rich fixture has counts 24 > 12; first entry should be 24
        first = pool.usage_context_signals[0]
        assert "마스크 환경" in (first.label_ko or "")

    def test_cap_respected(self):
        report = _rich_report()
        for i in range(5):
            report["usage_patterns"].append({
                "kind": "usage_context",
                "sentence_ko": f"context_{i}",
                "evidence_count": i + 100,
            })
        pool = build_candidate_pool(report)
        assert len(pool.usage_context_signals) == MAX_USAGE_CONTEXT_SIGNALS


# ---------------------------------------------------------------------------
# bounded_review_excerpts
# ---------------------------------------------------------------------------


class TestBoundedReviewExcerpts:
    def test_unions_attribute_and_monitoring_quotes(self):
        pool = build_candidate_pool(_rich_report())
        excerpts = pool.excerpts_as_dict()
        # r1 from pigmentation, r5 from monitoring
        assert "r1" in excerpts
        assert "r5" in excerpts

    def test_concatenates_multiple_excerpts_for_same_review(self):
        # r5 appears in transfer_resistance.top_quotes AND in monitoring's top_negative_quotes
        report = _rich_report()
        # Add a duplicate entry for r5 with different text on a separate attribute
        report["attributes"].append({
            "key": "extra",
            "label_ko": "기타",
            "n_positive": 0, "n_negative": 1, "n_mixed": 0,
            "top_quotes": [_q("r5에서 추가 발견", "r5", polarity="negative_strong")],
        })
        pool = build_candidate_pool(report)
        excerpts = pool.excerpts_as_dict()
        assert "마스크에 묻어나요" in excerpts["r5"]
        assert "r5에서 추가 발견" in excerpts["r5"]

    def test_max_chars_cap(self):
        report = {"attributes": [{
            "key": "x", "label_ko": "x",
            "n_positive": 0, "n_negative": 0, "n_mixed": 0,
            "top_quotes": [_q("a" * 300, f"r{i}", polarity="positive") for i in range(20)],
        }]}
        pool = build_candidate_pool(report, bounded_excerpt_max_chars=500)
        excerpts = pool.excerpts_as_dict()
        cum = sum(len(v) for v in excerpts.values())
        assert cum <= 500

    def test_sorted_by_review_id(self):
        pool = build_candidate_pool(_rich_report())
        rids = [rid for rid, _ in pool.bounded_review_excerpts]
        assert rids == sorted(rids)


# ---------------------------------------------------------------------------
# determinism
# ---------------------------------------------------------------------------


class TestDeterminism:
    def test_same_input_same_output(self):
        a = build_candidate_pool(_rich_report()).to_dict()
        b = build_candidate_pool(_rich_report()).to_dict()
        # JSON-serializable bytes equal
        assert json.dumps(a, ensure_ascii=False, sort_keys=True) == \
               json.dumps(b, ensure_ascii=False, sort_keys=True)

    def test_does_not_mutate_input(self):
        report = _rich_report()
        before = copy.deepcopy(report)
        build_candidate_pool(report)
        assert report == before
