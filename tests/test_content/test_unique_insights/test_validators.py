"""Tests for the unique-insights validator.

The substring rule is the load-bearing anti-hallucination check.
Every other rule has a positive (passes) and negative (blocks)
case for ratchet behavior.
"""
from __future__ import annotations

import copy

import pytest

from src.voc.content.unique_insights.schema import (
    BASELINE_SOURCES,
    CONFIDENCE_LEVELS,
    INSIGHT_TYPES,
    KNOWN_RISK_FLAGS,
    MAX_INSIGHTS,
    RELEVANCE_LEVELS,
)
from src.voc.content.unique_insights.validators import (
    InsightValidationResult,
    validate_unique_insights,
)


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


def _bounded_excerpts() -> dict[str, str]:
    return {
        "r1": "발색이 진하고 예뻐요",
        "r2": "지속력 정말 좋아요",
        "r3": "마스크에 묻어나요 정말",
        "r4": "옷에도 묻어나서 아쉬워요",
        "r5": "건성 피부에서 잘 맞아요",
    }


def _valid_insight() -> dict:
    return {
        "insight_id": "ins_001",
        "type": "unique_strength",
        "title_ko": "발색 호평이 두드러집니다",
        "explanation_ko": "리뷰 다수에서 발색이 진하고 색이 잘 나온다는 평이 반복됩니다.",
        "category_baseline": {
            "ko": "이 카테고리에서는 발색이 평균 수준으로 보고됩니다.",
            "source": "uncertain",
            "is_hypothesis": True,
        },
        "what_makes_it_unique_ko": "유사 카테고리 평균보다 발색 호평 비중이 두드러집니다.",
        "evidence_review_ids": ["r1", "r2"],
        "evidence_quotes_ko": ["발색이 진하고 예뻐요", "지속력 정말 좋아요"],
        "source_candidate_ids": ["cand_strength_001"],
        "confidence": "moderate",
        "content_angle_score": 0.62,
        "seller_report_relevance": "high",
        "buyer_content_relevance": "high",
        "risk_flags": ["category_baseline_uncertain"],
    }


def _valid_doc() -> dict:
    return {
        "schema_version": "1.0",
        "product": {"slug": "demo"},
        "candidate_pool": {
            "high_frequency_strengths": [
                {
                    "candidate_id": "cand_strength_001",
                    "attribute_key": "pigmentation",
                    "label_ko": "발색",
                    "n_pos": 181, "n_neg": 71, "n_mixed": 12,
                    "evidence_review_ids": ["r1", "r2"],
                    "evidence_excerpts_preview": ["발색이 진하고 예뻐요", "지속력 정말 좋아요"],
                    "baseline_comparison": None,
                },
            ],
            "concentrated_complaints": [],
            "cross_attribute_tradeoffs": [],
            "polarity_outliers": [],
            "usage_context_signals": [],
            "category_baseline_source": "uncertain",
            "baseline_caveat_ko": "...",
            "bounded_review_excerpts": _bounded_excerpts(),
        },
        "insights": [_valid_insight()],
    }


def _flag_rules(result: InsightValidationResult) -> set[str]:
    return {f.rule for f in result.blocking}


# ---------------------------------------------------------------------------
# happy path
# ---------------------------------------------------------------------------


class TestHappyPath:
    def test_valid_doc_passes(self):
        result = validate_unique_insights(_valid_doc())
        assert result.ok, f"unexpected blocking: {result.blocking}"

    def test_advisory_does_not_flip_ok(self):
        result = validate_unique_insights(_valid_doc())
        assert result.ok
        # No advisory rules in this doc shape.
        assert result.advisory == ()

    def test_summary_ok(self):
        assert validate_unique_insights(_valid_doc()).summary().startswith("ok")


# ---------------------------------------------------------------------------
# malformed top-level
# ---------------------------------------------------------------------------


class TestTopLevel:
    def test_non_dict(self):
        result = validate_unique_insights([])  # type: ignore[arg-type]
        assert not result.ok
        assert "malformed" in _flag_rules(result)

    def test_wrong_schema_version(self):
        d = _valid_doc()
        d["schema_version"] = "9.9"
        result = validate_unique_insights(d)
        assert "schema_version" in _flag_rules(result)

    def test_insights_not_list(self):
        d = _valid_doc()
        d["insights"] = "not a list"
        result = validate_unique_insights(d)
        assert "insights_present" in _flag_rules(result)

    def test_insights_count_over_max(self):
        d = _valid_doc()
        d["insights"] = [_valid_insight() for _ in range(MAX_INSIGHTS + 1)]
        # Make every insight_id unique
        for i, ins in enumerate(d["insights"]):
            ins["insight_id"] = f"ins_{i:03d}"
        result = validate_unique_insights(d)
        assert "insights_count" in _flag_rules(result)


# ---------------------------------------------------------------------------
# insight_id
# ---------------------------------------------------------------------------


class TestInsightId:
    def test_bad_format_blocks(self):
        d = _valid_doc()
        d["insights"][0]["insight_id"] = "INS-1"
        result = validate_unique_insights(d)
        assert "insight_id_format" in _flag_rules(result)

    def test_duplicate_blocks(self):
        d = _valid_doc()
        ins2 = _valid_insight()
        ins2["insight_id"] = "ins_001"  # duplicate
        d["insights"] = [_valid_insight(), ins2]
        result = validate_unique_insights(d)
        assert "insight_id_unique" in _flag_rules(result)


# ---------------------------------------------------------------------------
# type enum
# ---------------------------------------------------------------------------


class TestInsightType:
    def test_valid_types_all_pass(self):
        for t in INSIGHT_TYPES:
            d = _valid_doc()
            d["insights"][0]["type"] = t
            result = validate_unique_insights(d)
            assert "insight_type_enum" not in _flag_rules(result)

    def test_invalid_blocks(self):
        d = _valid_doc()
        d["insights"][0]["type"] = "weird_kind"
        result = validate_unique_insights(d)
        assert "insight_type_enum" in _flag_rules(result)


# ---------------------------------------------------------------------------
# length budgets
# ---------------------------------------------------------------------------


class TestLengthBudgets:
    def test_title_over_30_blocks(self):
        d = _valid_doc()
        d["insights"][0]["title_ko"] = "가" * 31
        result = validate_unique_insights(d)
        assert "title_ko_length" in _flag_rules(result)

    def test_explanation_over_200_blocks(self):
        d = _valid_doc()
        d["insights"][0]["explanation_ko"] = "가" * 201
        result = validate_unique_insights(d)
        assert "explanation_ko_length" in _flag_rules(result)

    def test_what_makes_unique_over_200_blocks(self):
        d = _valid_doc()
        d["insights"][0]["what_makes_it_unique_ko"] = "가" * 201
        result = validate_unique_insights(d)
        assert "what_makes_it_unique_ko_length" in _flag_rules(result)

    def test_empty_title_blocks(self):
        d = _valid_doc()
        d["insights"][0]["title_ko"] = ""
        result = validate_unique_insights(d)
        assert "title_ko_present" in _flag_rules(result)


# ---------------------------------------------------------------------------
# category_baseline + hypothesis interaction
# ---------------------------------------------------------------------------


class TestCategoryBaseline:
    def test_unknown_source_blocks(self):
        d = _valid_doc()
        d["insights"][0]["category_baseline"]["source"] = "magic_oracle"
        result = validate_unique_insights(d)
        assert "category_baseline_source" in _flag_rules(result)

    def test_uncertain_requires_hypothesis_true(self):
        d = _valid_doc()
        d["insights"][0]["category_baseline"]["source"] = "uncertain"
        d["insights"][0]["category_baseline"]["is_hypothesis"] = False
        result = validate_unique_insights(d)
        assert "baseline_uncertain_marks_hypothesis" in _flag_rules(result)

    def test_curated_does_not_force_hypothesis(self):
        d = _valid_doc()
        d["insights"][0]["category_baseline"]["source"] = "profile_curated"
        d["insights"][0]["category_baseline"]["is_hypothesis"] = False
        result = validate_unique_insights(d)
        assert "baseline_uncertain_marks_hypothesis" not in _flag_rules(result)


# ---------------------------------------------------------------------------
# evidence_review_ids
# ---------------------------------------------------------------------------


class TestEvidenceReviewIds:
    def test_min_count_below_two_blocks(self):
        d = _valid_doc()
        d["insights"][0]["evidence_review_ids"] = ["r1"]
        d["insights"][0]["evidence_quotes_ko"] = ["발색이 진하고 예뻐요"]
        result = validate_unique_insights(d)
        assert "evidence_review_ids_min" in _flag_rules(result)

    def test_max_count_over_five_blocks(self):
        d = _valid_doc()
        d["insights"][0]["evidence_review_ids"] = ["r1", "r2", "r3", "r4", "r5", "r1"]
        d["insights"][0]["evidence_quotes_ko"] = [
            "발색이 진하고 예뻐요", "지속력 정말 좋아요",
            "마스크에 묻어나요 정말", "옷에도 묻어나서 아쉬워요",
            "건성 피부에서 잘 맞아요", "발색이 진하고 예뻐요",
        ]
        result = validate_unique_insights(d)
        rules = _flag_rules(result)
        assert "evidence_review_ids_max" in rules or "evidence_review_ids_unique" in rules

    def test_unknown_review_id_blocks(self):
        d = _valid_doc()
        d["insights"][0]["evidence_review_ids"] = ["r1", "r_ghost"]
        d["insights"][0]["evidence_quotes_ko"] = ["발색이 진하고 예뻐요", "어디에도 없는 텍스트"]
        result = validate_unique_insights(d)
        assert "evidence_review_id_in_pool" in _flag_rules(result)

    def test_duplicate_ids_block(self):
        d = _valid_doc()
        d["insights"][0]["evidence_review_ids"] = ["r1", "r1"]
        d["insights"][0]["evidence_quotes_ko"] = ["발색이 진하고 예뻐요", "발색이 진하고 예뻐요"]
        result = validate_unique_insights(d)
        rules = _flag_rules(result)
        assert "evidence_review_ids_unique" in rules or "evidence_review_ids_min" in rules


# ---------------------------------------------------------------------------
# evidence_quotes_ko + substring check
# ---------------------------------------------------------------------------


class TestEvidenceQuotes:
    def test_quote_count_must_match_id_count(self):
        d = _valid_doc()
        d["insights"][0]["evidence_quotes_ko"] = ["only one quote"]
        result = validate_unique_insights(d)
        assert "evidence_quotes_count_match" in _flag_rules(result)

    def test_paraphrased_quote_blocks(self):
        d = _valid_doc()
        # r1 says "발색이 진하고 예뻐요"; the LLM tries to summarize as "발색이 좋다"
        d["insights"][0]["evidence_quotes_ko"][0] = "발색이 좋다"
        result = validate_unique_insights(d)
        assert "evidence_quote_substring" in _flag_rules(result)

    def test_substring_match_passes(self):
        d = _valid_doc()
        # Use only part of r1's text — strict substring still passes
        d["insights"][0]["evidence_quotes_ko"][0] = "발색이 진하"
        result = validate_unique_insights(d)
        assert "evidence_quote_substring" not in _flag_rules(result)

    def test_nfc_normalization_handles_decomposed_input(self):
        import unicodedata
        d = _valid_doc()
        # Decompose the first quote's chars to NFD; bounded excerpts are NFC
        # by construction. NFC-normalized comparison should still match.
        nfd = unicodedata.normalize("NFD", "발색이 진하고 예뻐요")
        d["insights"][0]["evidence_quotes_ko"][0] = nfd
        result = validate_unique_insights(d)
        assert "evidence_quote_substring" not in _flag_rules(result)

    def test_empty_quote_blocks(self):
        d = _valid_doc()
        d["insights"][0]["evidence_quotes_ko"][0] = ""
        result = validate_unique_insights(d)
        assert "evidence_quote_present" in _flag_rules(result)


# ---------------------------------------------------------------------------
# bounded_review_excerpts kwarg
# ---------------------------------------------------------------------------


class TestBoundedExcerptsKwarg:
    def test_kwarg_overrides_doc_field(self):
        d = _valid_doc()
        # If we pass an empty bounded set, every cited id should be unknown
        result = validate_unique_insights(
            d, bounded_review_excerpts={},
        )
        assert "evidence_review_id_in_pool" in _flag_rules(result)

    def test_falls_back_to_doc_when_kwarg_omitted(self):
        d = _valid_doc()
        result = validate_unique_insights(d)
        assert "evidence_review_id_in_pool" not in _flag_rules(result)


# ---------------------------------------------------------------------------
# ban-list scans (LLM-authored fields only)
# ---------------------------------------------------------------------------


class TestBanLists:
    def test_medical_in_explanation_blocks(self):
        d = _valid_doc()
        d["insights"][0]["explanation_ko"] = "이 제품은 진정 효과가 입증됐습니다."
        result = validate_unique_insights(d)
        assert "ban_list_medical" in _flag_rules(result)

    def test_directive_in_title_blocks(self):
        d = _valid_doc()
        d["insights"][0]["title_ko"] = "반드시 구매할 만"
        result = validate_unique_insights(d)
        assert "ban_list_directive" in _flag_rules(result)

    def test_superlative_in_what_makes_unique_blocks(self):
        d = _valid_doc()
        d["insights"][0]["what_makes_it_unique_ko"] = "최고의 발색을 자랑합니다"
        result = validate_unique_insights(d)
        assert "ban_list_superlative" in _flag_rules(result)

    def test_anti_clickbait_in_title_blocks(self):
        d = _valid_doc()
        d["insights"][0]["title_ko"] = "역대급 발색"
        result = validate_unique_insights(d)
        assert "anti_clickbait" in _flag_rules(result)

    def test_ban_list_does_not_scan_evidence_quotes(self):
        # Even if a reviewer wrote a banned token ("최고에요"), the
        # validator must not block on the verbatim quote.
        d = _valid_doc()
        d["candidate_pool"]["bounded_review_excerpts"]["r1"] = "최고에요 발색이 진하고 예뻐요"
        d["insights"][0]["evidence_quotes_ko"][0] = "최고에요 발색이 진하"
        result = validate_unique_insights(d)
        # No `ban_list_superlative` flag pointing at the quote location
        for f in result.blocking:
            assert "evidence_quotes_ko" not in f.location, \
                f"unexpected ban-list flag on quote: {f}"


# ---------------------------------------------------------------------------
# confidence + scores + relevance
# ---------------------------------------------------------------------------


class TestEnumsAndScores:
    @pytest.mark.parametrize("c", CONFIDENCE_LEVELS)
    def test_confidence_valid_passes(self, c):
        d = _valid_doc()
        d["insights"][0]["confidence"] = c
        result = validate_unique_insights(d)
        assert "confidence_enum" not in _flag_rules(result)

    def test_confidence_invalid_blocks(self):
        d = _valid_doc()
        d["insights"][0]["confidence"] = "yolo"
        result = validate_unique_insights(d)
        assert "confidence_enum" in _flag_rules(result)

    def test_content_angle_score_out_of_range_blocks(self):
        d = _valid_doc()
        d["insights"][0]["content_angle_score"] = 1.5
        result = validate_unique_insights(d)
        assert "content_angle_score_range" in _flag_rules(result)

    @pytest.mark.parametrize("r", RELEVANCE_LEVELS)
    def test_relevance_valid_passes(self, r):
        d = _valid_doc()
        d["insights"][0]["seller_report_relevance"] = r
        d["insights"][0]["buyer_content_relevance"] = r
        result = validate_unique_insights(d)
        rules = _flag_rules(result)
        assert "seller_report_relevance_enum" not in rules
        assert "buyer_content_relevance_enum" not in rules

    def test_relevance_invalid_blocks(self):
        d = _valid_doc()
        d["insights"][0]["seller_report_relevance"] = "extreme"
        result = validate_unique_insights(d)
        assert "seller_report_relevance_enum" in _flag_rules(result)


# ---------------------------------------------------------------------------
# risk_flags advisory
# ---------------------------------------------------------------------------


class TestRiskFlags:
    @pytest.mark.parametrize("rf", KNOWN_RISK_FLAGS)
    def test_known_flag_no_advisory(self, rf):
        d = _valid_doc()
        d["insights"][0]["risk_flags"] = [rf]
        result = validate_unique_insights(d)
        assert all(f.rule != "risk_flag_unknown" for f in result.advisory)

    def test_unknown_flag_advisory_only(self):
        d = _valid_doc()
        d["insights"][0]["risk_flags"] = ["mystery_flag"]
        result = validate_unique_insights(d)
        # advisory, not blocking
        assert any(f.rule == "risk_flag_unknown" for f in result.advisory)
        assert "risk_flag_unknown" not in _flag_rules(result)
        assert result.ok  # advisory does not flip ok

    def test_risk_flags_must_be_list(self):
        d = _valid_doc()
        d["insights"][0]["risk_flags"] = "not a list"
        result = validate_unique_insights(d)
        assert "risk_flags_present" in _flag_rules(result)


# ---------------------------------------------------------------------------
# multi-violation
# ---------------------------------------------------------------------------


class TestMultiFlag:
    def test_collects_multiple_blocking_flags(self):
        d = _valid_doc()
        d["insights"][0]["title_ko"] = "가" * 100        # length
        d["insights"][0]["confidence"] = "yolo"           # confidence enum
        d["insights"][0]["explanation_ko"] = "효과 있음"  # medical
        result = validate_unique_insights(d)
        rules = _flag_rules(result)
        assert "title_ko_length" in rules
        assert "confidence_enum" in rules
        assert "ban_list_medical" in rules

    def test_does_not_mutate_input(self):
        d = _valid_doc()
        before = copy.deepcopy(d)
        validate_unique_insights(d)
        assert d == before


# ---------------------------------------------------------------------------
# source_candidate_ids — every insight maps back to candidate_pool
# ---------------------------------------------------------------------------


class TestSourceCandidateIds:
    def test_missing_blocks(self):
        d = _valid_doc()
        del d["insights"][0]["source_candidate_ids"]
        result = validate_unique_insights(d)
        assert "source_candidate_ids_present" in _flag_rules(result)

    def test_empty_list_blocks(self):
        d = _valid_doc()
        d["insights"][0]["source_candidate_ids"] = []
        result = validate_unique_insights(d)
        assert "source_candidate_ids_min" in _flag_rules(result)

    def test_unknown_candidate_id_blocks(self):
        d = _valid_doc()
        d["insights"][0]["source_candidate_ids"] = ["cand_strength_999"]
        result = validate_unique_insights(d)
        assert "source_candidate_id_in_pool" in _flag_rules(result)

    def test_resolves_via_doc_when_kwarg_omitted(self):
        # _valid_doc has cand_strength_001 in candidate_pool block; the
        # validator should pick it up without an explicit pool kwarg.
        result = validate_unique_insights(_valid_doc())
        assert "source_candidate_id_in_pool" not in _flag_rules(result)

    def test_resolves_via_kwarg_pool_when_provided(self):
        from src.voc.content.unique_insights.schema import (
            BASELINE_CAVEAT_UNCERTAIN_KO,
            CandidateBucketEntry,
            CandidatePool,
        )
        pool = CandidatePool(
            high_frequency_strengths=(
                CandidateBucketEntry(
                    candidate_id="cand_strength_001",
                    attribute_key="pigmentation",
                    label_ko="발색",
                    n_pos=181, n_neg=71, n_mixed=12,
                    evidence_review_ids=("r1", "r2"),
                    evidence_excerpts_preview=("a", "b"),
                    baseline_comparison=None,
                ),
            ),
            concentrated_complaints=(),
            cross_attribute_tradeoffs=(),
            polarity_outliers=(),
            usage_context_signals=(),
            category_baseline_source="uncertain",
            baseline_caveat_ko=BASELINE_CAVEAT_UNCERTAIN_KO,
            bounded_review_excerpts=(("r1", "발색이 진하고 예뻐요"),
                                     ("r2", "지속력 정말 좋아요")),
        )
        d = _valid_doc()
        # Empty the doc's candidate_pool to force kwarg path
        d["candidate_pool"]["high_frequency_strengths"] = []
        result = validate_unique_insights(
            d,
            bounded_review_excerpts=pool.excerpts_as_dict(),
            candidate_pool=pool,
        )
        assert "source_candidate_id_in_pool" not in _flag_rules(result)

    def test_duplicate_blocks(self):
        d = _valid_doc()
        d["insights"][0]["source_candidate_ids"] = ["cand_strength_001", "cand_strength_001"]
        result = validate_unique_insights(d)
        assert "source_candidate_ids_unique" in _flag_rules(result)

    def test_too_many_blocks(self):
        d = _valid_doc()
        d["insights"][0]["source_candidate_ids"] = [
            f"cand_strength_{i:03d}" for i in range(1, 10)
        ]
        result = validate_unique_insights(d)
        assert "source_candidate_ids_max" in _flag_rules(result)

    def test_non_string_id_blocks(self):
        d = _valid_doc()
        d["insights"][0]["source_candidate_ids"] = ["cand_strength_001", 7]
        result = validate_unique_insights(d)
        assert "source_candidate_id_type" in _flag_rules(result)
