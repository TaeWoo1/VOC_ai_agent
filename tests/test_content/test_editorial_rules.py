"""Tests for the SCAMPER editorial-rules layer.

Covers each move:
  S — DECISION_FRAME_HEADERS_KO presence + content
  C — combine_evidence_sources fallback paths
  A — category_vocabulary_for() returns the right emphasis/suppress lists
  M — build_contrast_verdict produces evidence-paired contrast
  P — interview_hook_for resolves the right template
  E — find_unsupported_generic_phrases blocks/advisories correctly
  R — build_hesitation_lines surfaces caution as primary content

Plus a Mediheal-toner-pad golden fixture proving the adapter no
longer emits banned phrases on the regression case.
"""
from __future__ import annotations

from collections import Counter

import pytest

from src.voc.content.editorial_rules import (
    CATEGORY_VOCABULARY_KO,
    DECISION_FRAME_HEADERS_KO,
    GENERIC_PHRASES_KO,
    GENERIC_QUOTE_PENALTIES_KO,
    INTERVIEW_HOOK_TEMPLATES_KO,
    LABEL_OVERRIDES_BY_PROFILE,
    POLISH_PROMPT_FRAGMENT_KO,
    QUOTE_NOUN_BONUSES_KO,
    SOFT_GENERIC_PHRASES_KO,
    build_contrast_verdict,
    build_hesitation_lines,
    category_vocabulary_for,
    combine_evidence_sources,
    display_label_for,
    find_unsupported_generic_phrases,
    interview_hook_for,
    score_quote_quality,
    select_best_quote,
)


# ---------------------------------------------------------------------------
# S — Substitute
# ---------------------------------------------------------------------------


class TestDecisionFrameHeaders:
    def test_required_keys_present(self):
        for k in (
            "verdict_label",
            "strengths_label",
            "monitoring_label",
            "hesitation_label",
            "fit_label",
            "interview_hook_label",
        ):
            assert k in DECISION_FRAME_HEADERS_KO
            assert DECISION_FRAME_HEADERS_KO[k]

    def test_no_review_summary_framing_in_headers(self):
        # The whole point of substitute: nothing reads as "리뷰 요약".
        for label in DECISION_FRAME_HEADERS_KO.values():
            assert "리뷰 요약" not in label
            assert "후기 모음" not in label


# ---------------------------------------------------------------------------
# C — Combine
# ---------------------------------------------------------------------------


class TestCombineEvidenceSources:
    def test_no_inputs_returns_empty(self):
        out = combine_evidence_sources(analysis_report=None)
        assert out["strengths"] == []
        assert out["monitoring"] == []
        assert out["unique"] == []
        assert out["has_unique_insights"] is False

    def test_uses_strengths_and_monitoring_when_present(self):
        ar = {
            "strengths": [{"attribute_key": "persistence", "supporting_count": 210}],
            "monitoring_candidates": [
                {"attribute_key": "dryness_skin_texture", "n_negative": 87},
            ],
        }
        out = combine_evidence_sources(analysis_report=ar)
        assert len(out["strengths"]) == 1
        assert out["strengths"][0]["attribute_key"] == "persistence"
        assert out["monitoring"][0]["n_negative"] == 87

    def test_falls_back_to_top_quotes_when_blocks_empty(self):
        # No strengths/monitoring blocks — adapter shape that hasn't
        # been populated yet. Combine MUST still produce useful
        # buckets from `attributes[].top_quotes`.
        ar = {
            "attributes": [
                {
                    "key": "persistence", "label_ko": "지속력",
                    "n_positive": 210, "n_negative": 5,
                    "top_quotes": [
                        {"text": "오래 가요", "review_id": "r1",
                         "polarity": "positive"},
                    ],
                },
                {
                    "key": "dryness_skin_texture", "label_ko": "건조함",
                    "n_positive": 12, "n_negative": 87,
                    "top_quotes": [
                        {"text": "건조해요", "review_id": "r2",
                         "polarity": "negative"},
                    ],
                },
            ],
        }
        out = combine_evidence_sources(analysis_report=ar)
        assert len(out["strengths"]) >= 1
        assert any(
            s["attribute_key"] == "persistence" for s in out["strengths"]
        )
        assert len(out["monitoring"]) >= 1

    def test_unique_insights_marker_when_present(self):
        ar = {"strengths": [], "monitoring_candidates": []}
        ui = {"insights": [{"insight_id": "ins_001"}]}
        out = combine_evidence_sources(analysis_report=ar, unique_insights=ui)
        assert out["has_unique_insights"] is True
        assert len(out["unique"]) == 1

    def test_unique_insights_empty_means_no_marker(self):
        out = combine_evidence_sources(
            analysis_report={"strengths": [], "monitoring_candidates": []},
            unique_insights={"insights": []},
        )
        assert out["has_unique_insights"] is False


# ---------------------------------------------------------------------------
# A — Adapt
# ---------------------------------------------------------------------------


class TestCategoryVocabularyFor:
    def test_skincare_pad_emphasizes_pad_and_essence(self):
        v = category_vocabulary_for("skincare_pad")
        for kw in ("촉촉", "패드 두께", "에센스 양", "트위저"):
            assert kw in v["emphasis"], f"{kw!r} missing from skincare_pad emphasis"

    def test_skincare_pad_suppresses_makeup_words(self):
        v = category_vocabulary_for("skincare_pad")
        for kw in ("발색", "쿨톤", "립크림", "마무리감"):
            assert kw in v["suppress"], f"{kw!r} should be suppressed for skincare_pad"

    def test_unknown_profile_falls_back_to_default(self):
        assert category_vocabulary_for("nonexistent") == CATEGORY_VOCABULARY_KO["default"]

    def test_none_profile_falls_back_to_default(self):
        assert category_vocabulary_for(None) == CATEGORY_VOCABULARY_KO["default"]


# ---------------------------------------------------------------------------
# M — Modify
# ---------------------------------------------------------------------------


class TestBuildContrastVerdict:
    def test_strength_and_monitoring_yields_contrast(self):
        s = [{"attribute_key": "persistence", "label_ko": "지속력",
              "supporting_count": 210}]
        m = [{"attribute_key": "dryness_skin_texture",
              "concern_label_ko": "건조함", "n_negative": 87}]
        out = build_contrast_verdict(strengths=s, monitoring=m)
        # Carries both labels and both counts.
        assert "지속력" in out
        assert "건조함" in out
        assert "210" in out
        assert "87" in out
        # Doesn't contain banned phrases.
        for phrase in (
            "호평이 반복됩니다",
            "관련 호평",
            "주의가 필요합니다",
        ):
            assert phrase not in out

    def test_strength_only(self):
        s = [{"attribute_key": "x", "label_ko": "X", "supporting_count": 50}]
        out = build_contrast_verdict(strengths=s, monitoring=[])
        assert "X" in out
        assert "50" in out
        assert "호평이 반복됩니다" not in out

    def test_monitoring_only(self):
        m = [{"attribute_key": "y", "concern_label_ko": "Y", "n_negative": 33}]
        out = build_contrast_verdict(strengths=[], monitoring=m)
        assert "Y" in out
        assert "33" in out

    def test_empty_inputs_yields_volume_note(self):
        out = build_contrast_verdict(strengths=[], monitoring=[])
        assert "리뷰량이 부족" in out


# ---------------------------------------------------------------------------
# P — Put to another use
# ---------------------------------------------------------------------------


class TestInterviewHookFor:
    def test_packaging_resolves(self):
        h = interview_hook_for("packaging_container")
        assert h is not None
        assert "용기" in h or "트위저" in h

    def test_dryness_resolves(self):
        h = interview_hook_for("dryness_skin_texture")
        assert h is not None
        assert "건조" in h

    def test_unknown_returns_none(self):
        assert interview_hook_for("not_an_attribute_key") is None

    def test_none_returns_none(self):
        assert interview_hook_for(None) is None

    def test_every_template_carries_korean_text(self):
        for k, v in INTERVIEW_HOOK_TEMPLATES_KO.items():
            assert isinstance(v, str) and v.strip(), k


# ---------------------------------------------------------------------------
# R — Reverse
# ---------------------------------------------------------------------------


class TestBuildHesitationLines:
    def test_lines_carry_counts(self):
        m = [
            {"attribute_key": "dryness_skin_texture",
             "concern_label_ko": "건조함", "n_negative": 87},
            {"attribute_key": "packaging_container",
             "concern_label_ko": "용기 위생", "n_negative": 24},
        ]
        out = build_hesitation_lines(m, profile_id="skincare_pad")
        assert len(out) == 2
        for line in out:
            assert "한 번 더 검토" in line
            assert any(ch.isdigit() for ch in line)

    def test_limit_cap_respected(self):
        m = [
            {"attribute_key": f"a{i}", "concern_label_ko": f"L{i}",
             "n_negative": i + 5}
            for i in range(10)
        ]
        out = build_hesitation_lines(m, limit=3)
        assert len(out) == 3

    def test_zero_negatives_skipped(self):
        m = [
            {"attribute_key": "x", "concern_label_ko": "X", "n_negative": 0},
            {"attribute_key": "y", "concern_label_ko": "Y", "n_negative": 5},
        ]
        out = build_hesitation_lines(m)
        assert len(out) == 1
        assert "Y" in out[0]

    def test_skincare_pad_uses_sensitivity_phrasing(self):
        m = [{"attribute_key": "dryness_skin_texture",
              "concern_label_ko": "건조함", "n_negative": 50}]
        out = build_hesitation_lines(m, profile_id="skincare_pad")
        assert "민감하신 분" in out[0]


# ---------------------------------------------------------------------------
# E — Eliminate (validator)
# ---------------------------------------------------------------------------


class TestFindUnsupportedGenericPhrases:
    def test_empty_text_returns_empty(self):
        assert find_unsupported_generic_phrases("") == []
        assert find_unsupported_generic_phrases(None) == []

    def test_clean_text_returns_empty(self):
        assert find_unsupported_generic_phrases(
            "지속력 만족 후기 210건이 보이지만, 건조함 불만 후기도 87건 함께 누적됩니다.",
        ) == []

    def test_banned_phrase_without_evidence_blocks(self):
        hits = find_unsupported_generic_phrases(
            "발색 관련 호평이 반복됩니다",
        )
        assert hits, "expected at least one block hit"
        assert any(h["severity"] == "block" for h in hits)
        assert any(h["phrase"] == "호평이 반복됩니다" for h in hits)

    def test_banned_phrase_with_digit_passes(self):
        # The same banned substring is allowed when the sentence
        # carries specific evidence (a digit).
        hits = find_unsupported_generic_phrases(
            "리뷰 181건에서 발색 호평이 반복됩니다",
        )
        assert hits == []

    def test_banned_phrase_with_quote_passes(self):
        hits = find_unsupported_generic_phrases(
            '발색 호평이 반복됩니다 ("정말 진해요")',
        )
        assert hits == []

    def test_soft_phrase_returns_advisory_by_default(self):
        hits = find_unsupported_generic_phrases(
            "건성 피부에서 잘 맞았다는 의견",
        )
        assert hits
        assert all(h["severity"] == "advisory" for h in hits)
        assert any(h["phrase"] == "잘 맞았다는 의견" for h in hits)

    def test_soft_phrase_with_evidence_passes(self):
        hits = find_unsupported_generic_phrases(
            "건성 피부에서 잘 맞았다는 의견 32건",
        )
        assert hits == []

    def test_treat_soft_as_blocking_promotes_severity(self):
        hits = find_unsupported_generic_phrases(
            "건성 피부에서 잘 맞았다는 의견",
            treat_soft_as_blocking=True,
        )
        assert hits and hits[0]["severity"] == "block"

    def test_extra_banned_picked_up(self):
        hits = find_unsupported_generic_phrases(
            "느낌이 그저 그렇습니다",
            extra_banned=("그저 그렇습니다",),
        )
        assert hits
        assert any(h["phrase"] == "그저 그렇습니다" for h in hits)

    def test_per_sentence_evaluation(self):
        # Bad sentence + good sentence — only the bad one is flagged.
        text = (
            "발색 호평이 반복됩니다. 다른 항목은 후기 47건이 누적되었습니다."
        )
        hits = find_unsupported_generic_phrases(text)
        assert hits
        assert all("47" not in h["sentence"] for h in hits)


class TestBanListContents:
    def test_required_phrases_listed(self):
        for phrase in (
            "호평이 반복됩니다",
            "관련 호평",
            "주의가 필요합니다",
            "사용 패턴",
        ):
            assert phrase in GENERIC_PHRASES_KO

    def test_polish_prompt_fragment_mentions_decision_criteria(self):
        # Documents the SCAMPER S move via the prompt.
        assert "구매 전 의사결정" in POLISH_PROMPT_FRAGMENT_KO
        assert "SCAMPER" in POLISH_PROMPT_FRAGMENT_KO


# ---------------------------------------------------------------------------
# Mediheal toner-pad golden fixture (end-to-end through the adapter)
# ---------------------------------------------------------------------------


class TestDisplayLabelFor:
    def test_skincare_pad_overrides_makeup_leaning_label(self):
        # Canonical short label "베이스 상호작용" should be replaced
        # with "패드 밀착력" for skincare_pad.
        assert display_label_for(
            "adhesion_base_interaction",
            profile_id="skincare_pad",
            fallback="베이스 상호작용",
        ) == "패드 밀착력"

    def test_skincare_pad_finish_texture_override(self):
        assert display_label_for(
            "finish_texture", profile_id="skincare_pad", fallback="마무리감",
        ) == "촉촉함/마무리감"

    def test_skincare_pad_value_price_override(self):
        assert display_label_for(
            "value_price", profile_id="skincare_pad", fallback="가격/가성비",
        ) == "대용량/가성비"

    def test_default_profile_returns_fallback(self):
        # Without an override, returns the caller-supplied fallback.
        assert display_label_for(
            "finish_texture", profile_id=None, fallback="마무리감",
        ) == "마무리감"

    def test_unknown_profile_returns_fallback(self):
        assert display_label_for(
            "finish_texture",
            profile_id="nonexistent",
            fallback="마무리감",
        ) == "마무리감"

    def test_unknown_attribute_returns_fallback(self):
        assert display_label_for(
            "completely_made_up_key",
            profile_id="skincare_pad",
            fallback="원본",
        ) == "원본"

    def test_no_fallback_returns_attribute_key(self):
        # Defensive: when fallback omitted, return the key so the
        # downstream renderer never gets a None or empty string.
        assert display_label_for(
            "finish_texture", profile_id="skincare_pad",
        ) == "촉촉함/마무리감"
        assert display_label_for(
            "finish_texture", profile_id="default",
        ) == "finish_texture"

    def test_skincare_pad_keys_complete(self):
        # The user explicitly listed six attribute overrides for
        # skincare_pad — the table must carry all of them.
        s = LABEL_OVERRIDES_BY_PROFILE["skincare_pad"]
        for k in (
            "adhesion_base_interaction",
            "finish_texture",
            "dryness_skin_texture",
            "packaging_container",
            "value_price",
            "persistence",
        ):
            assert k in s, k
            assert s[k] and isinstance(s[k], str)


class TestScoreQuoteQuality:
    def test_none_returns_zero(self):
        assert score_quote_quality(None) == 0.0

    def test_empty_string_returns_zero(self):
        assert score_quote_quality("") == 0.0
        assert score_quote_quality({"text": ""}) == 0.0

    def test_generic_phrase_penalized(self):
        # "너무 만족해요" matches a generic substring — gets penalized.
        bad = score_quote_quality(
            {"text": "너무 만족해요"}, profile_id="skincare_pad",
        )
        assert bad < 0

    def test_specific_quote_scores_higher_than_generic(self):
        good = score_quote_quality(
            {"text": "200매 대용량에 휴대용 케이스까지 들어있어 좋아요"},
            profile_id="skincare_pad",
        )
        bad = score_quote_quality(
            {"text": "너무 만족해요"}, profile_id="skincare_pad",
        )
        assert good > bad
        assert good > 0

    def test_multiple_nouns_stack(self):
        # "대용량" + "패드" + "집게" → 3 noun bonuses.
        score = score_quote_quality(
            {"text": "대용량 패드에 집게도 들어있어 편해요"},
            profile_id="skincare_pad",
        )
        assert score >= 3.0  # 3 nouns + length bonus

    def test_profile_unaware_skips_skincare_nouns(self):
        # Same Korean text under default profile shouldn't get the
        # skincare-specific noun bonuses (none configured).
        s_pad = score_quote_quality(
            {"text": "대용량 패드 집게"}, profile_id="skincare_pad",
        )
        s_def = score_quote_quality({"text": "대용량 패드 집게"})
        assert s_pad > s_def

    def test_makeup_blush_uses_makeup_nouns(self):
        s = score_quote_quality(
            {"text": "발색 진하고 지속력 좋아요"},
            profile_id="makeup_blush",
        )
        assert s > 0

    def test_string_input_supported(self):
        assert score_quote_quality(
            "200매 대용량 좋아요", profile_id="skincare_pad",
        ) > 0

    def test_evidence_span_field_supported(self):
        # Adapter's `evidence_span` field name must work too.
        assert score_quote_quality(
            {"evidence_span": "촉촉하고 좋아요"},
            profile_id="skincare_pad",
        ) > 0

    def test_length_bonus_capped(self):
        # Very long Korean string → bonus saturates at 0.6.
        long = "대" * 500
        s = score_quote_quality({"text": long}, profile_id="skincare_pad")
        # 500 chars: noun bonus + length bonus capped, but no
        # generic-phrase penalty. Length bonus shouldn't drive
        # this above ~501 (1 noun + 0.6 length cap).
        assert s < 10  # arbitrary upper-bound sanity


class TestSelectBestQuote:
    def test_empty_returns_none(self):
        assert select_best_quote([]) is None
        assert select_best_quote(None) is None

    def test_picks_highest_scoring(self):
        quotes = [
            {"text": "너무 만족해요", "review_id": "r1"},  # generic, penalized
            {"text": "200매 대용량에 휴대용 케이스까지 좋아요", "review_id": "r2"},
            {"text": "좋아요", "review_id": "r3"},
        ]
        best = select_best_quote(quotes, profile_id="skincare_pad")
        assert best is not None
        assert best["review_id"] == "r2"

    def test_ties_break_on_input_order(self):
        # Two equally-scored quotes; first occurrence wins.
        quotes = [
            {"text": "좋아요 A", "review_id": "first"},
            {"text": "좋아요 B", "review_id": "second"},
        ]
        best = select_best_quote(quotes, profile_id="skincare_pad")
        assert best["review_id"] == "first"

    def test_drops_non_dicts(self):
        quotes = [None, 42, {"text": "대용량 패드 좋아요", "review_id": "r1"}]
        best = select_best_quote(quotes, profile_id="skincare_pad")
        assert best is not None
        assert best["review_id"] == "r1"

    def test_all_empty_text_returns_first(self):
        # All entries score 0; first wins via tie-break.
        quotes = [{"text": ""}, {"text": ""}]
        best = select_best_quote(quotes, profile_id="skincare_pad")
        assert best == {"text": ""}


class TestQuoteScoringTables:
    def test_generic_penalties_complete(self):
        # The user explicitly listed three generic phrases — make
        # sure they're in the penalty table.
        for p in ("너무 만족", "정말 좋아요", "생각보다 만족"):
            assert any(p in g for g in GENERIC_QUOTE_PENALTIES_KO), p

    def test_skincare_pad_nouns_complete(self):
        # Required nouns from the user's spec.
        for n in (
            "대용량", "패드", "집게", "케이스",
            "밀착", "촉촉", "건조", "마름",
            "토너", "에센스",
        ):
            assert n in QUOTE_NOUN_BONUSES_KO["skincare_pad"], n


class TestMedihealGolden:
    """End-to-end: a Mediheal-shaped PRD goes through the adapter
    with `selected_profile_id="skincare_pad"`, and the resulting
    analysis_report MUST NOT emit any banned generic phrase in
    `quick_decision.verdict_ko`, `who_for_ko`, `who_not_for_ko`,
    or `usage_patterns[].sentence_ko`."""

    @pytest.fixture
    def report(self):
        from src.voc.content.adapters.from_phase2e import (
            productreportdata_to_analysis_report,
        )
        from src.voc.reporting.phase2e.report import (
            AttributeSummary, ProductReportData,
        )

        def _attr(attribute, *, n_pos=0, n_neg=0, n_mix=0):
            s = AttributeSummary(attribute=attribute)
            s.n_positive = n_pos
            s.n_negative = n_neg
            s.n_mixed = n_mix
            return s

        prd = ProductReportData(
            product_id="A000000MEDI",
            product_name="메디힐 데일리 토너패드",
            n_reviews=1480, n_records=1480,
            n_mixed_reviews=120, n_with_tradeoff=44,
            attribute_summaries={
                "persistence": _attr(
                    "persistence", n_pos=210, n_neg=18,
                ),
                "dryness_skin_texture": _attr(
                    "dryness_skin_texture", n_pos=12, n_neg=87,
                ),
                "packaging_container": _attr(
                    "packaging_container", n_pos=42, n_neg=9,
                ),
            },
            tradeoff_pairs=Counter({
                "persistence:positive -> dryness_skin_texture:negative_weak": 14,
            }),
            mixed_attribute_pairs=[],
            delivery_condition_records_total=0,
        )
        return productreportdata_to_analysis_report(
            prd,
            product_category="토너패드",
            selected_profile_id="skincare_pad",
            suppress_attributes=frozenset({
                "pigmentation", "color_tone_matching",
                "application_blending", "transfer_resistance",
                "multi_use_lip_cheek_compatibility",
            }),
        )

    def test_verdict_carries_specific_contrast(self, report):
        v = report["quick_decision"]["verdict_ko"]
        # Specific evidence (digits) on both sides.
        assert any(ch.isdigit() for ch in v), v
        assert "지속력" in v or "건조" in v
        # Banned phrases are absent.
        assert find_unsupported_generic_phrases(v) == []

    def test_who_for_lines_have_counts(self, report):
        for line in report["quick_decision"]["who_for_ko"]:
            assert any(ch.isdigit() for ch in line), line
            assert find_unsupported_generic_phrases(line) == []

    def test_who_not_for_uses_hesitation_phrasing(self, report):
        not_for = report["quick_decision"]["who_not_for_ko"]
        assert not_for, "expected at least one hesitation line"
        for line in not_for:
            assert "한 번 더 검토" in line
            assert any(ch.isdigit() for ch in line), line
            assert find_unsupported_generic_phrases(line) == []

    def test_usage_patterns_sentences_clean(self, report):
        for p in report["usage_patterns"]:
            assert find_unsupported_generic_phrases(p["sentence_ko"]) == []

    def test_monitoring_carries_interview_hook(self, report):
        # SCAMPER P: known frictions get surfaced as hooks.
        dryness = next(
            m for m in report["monitoring_candidates"]
            if m["attribute_key"] == "dryness_skin_texture"
        )
        assert "interview_hook_ko" in dryness
        assert "건조" in dryness["interview_hook_ko"]

    def test_no_makeup_attributes_leak(self, report):
        # Suppress + skincare_pad profile must keep makeup keys out
        # entirely, and no banned phrase appears anywhere in
        # quick_decision.
        joined = (
            (report["quick_decision"]["verdict_ko"] or "")
            + " ".join(report["quick_decision"]["who_for_ko"])
            + " ".join(report["quick_decision"]["who_not_for_ko"])
        )
        for kw in ("발색", "쿨톤", "립크림"):
            assert kw not in joined, joined
        assert find_unsupported_generic_phrases(joined) == []
