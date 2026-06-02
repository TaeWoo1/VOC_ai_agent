"""Tests for src.voc.content.insight_brief.

Phase C contract:
  - deterministic projection from analysis_report.json
  - diverse pool of evidence-backed `angle_candidates` (one per
    type minimum when source data supports it)
  - no primary-angle lock; `channel_angle_recommendations.{channel}.
    suggested_angle_ids` is an ordered suggestion only
  - information-first framing — sensational/clickbait wording
    blocked by the validator
  - locked phrases for evidence_boundaries + visual_concept
    anti_patterns
  - mandatory negative_prompts on cover and 7 background image
    prompts
  - never modifies the input analysis_report
"""
from __future__ import annotations

import copy

import pytest

from src.voc.content.insight_brief import (
    ANGLE_MAX_PER_TYPE,
    ANGLE_MAX_TOTAL,
    ANGLE_PRIORITY_MODES,
    ANTI_CLICKBAIT_KO,
    ANTI_PATTERNS_LOCKED,
    CARDNEWS_SECTIONS,
    INSIGHT_BRIEF_SCHEMA_VERSION,
    PALETTE_BY_CATEGORY,
    REQUIRED_NEGATIVE_PROMPT_TOKENS,
    WHAT_WE_CANNOT_SAY_KO,
    BriefValidationResult,
    InsightBriefGenerationError,
    generate_consumer_insight_brief,
    validate_consumer_insight_brief,
)


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


def _rich_report() -> dict:
    """Analysis report rich enough for every brief section to clear
    its minimums (verdict, ≥1 angle of every type, segments, monitoring)."""
    return {
        "schema_version": "3.0",
        "product": {
            "slug": "demo-product",
            "name_ko": "데모 제품",
            "category": "color_cosmetics",
            "source_url": "https://example.com/p/123",
        },
        "corpus": {
            "n_reviews_total": 1135,
            "primary_sort": "DATETIME_DESC",
            "sampling_strategy": "latest_only",
            "corpus_type": "observed_scrape",
            "confidence_level": "high",
            "signal_stability": "high",
            "observation_window": {"start": "2025-04-01", "end": "2026-04-01"},
        },
        "attributes": [
            {"key": "pigmentation",   "label_ko": "발색",   "n_positive": 181, "n_negative": 71, "n_mixed": 12},
            {"key": "persistence",    "label_ko": "지속력", "n_positive": 47,  "n_negative": 12, "n_mixed": 4},
            {"key": "transfer_resistance", "label_ko": "묻어남", "n_positive": 20, "n_negative": 38, "n_mixed": 6},
            {"key": "application_blending","label_ko":"발림성","n_positive": 32,"n_negative": 8, "n_mixed": 2},
        ],
        "strengths": [
            {"attribute_key": "pigmentation", "supporting_count": 181},
            {"attribute_key": "persistence",  "supporting_count": 47},
            {"attribute_key": "application_blending", "supporting_count": 32},
        ],
        "monitoring_candidates": [
            {"attribute_key": "transfer_resistance", "concern_label_ko": "묻어남", "n_negative": 38},
            {"attribute_key": "pigmentation",        "concern_label_ko": "발색 변화", "n_negative": 12},
        ],
        "buyer_segments": [
            {"segment_kind": "skin_type", "label_ko": "건성 피부",
             "dominant_count": 32, "dominance_ratio": 0.78, "confidence_level": "strong"},
            {"segment_kind": "tone", "label_ko": "쿨톤",
             "dominant_count": 24, "dominance_ratio": 0.66, "confidence_level": "moderate"},
        ],
        "quick_decision": {
            "verdict_ko": "발색이 진하다는 평이 두드러집니다",
            "who_for_ko": ["건성 피부에서 잘 맞았다는 의견", "쿨톤 사용자에서 호평"],
            "who_not_for_ko": ["마스크/외출 사용이 잦은 분"],
            "watch_outs_ko": ["묻어남"],
            "confidence_level": "strong",
        },
        "methodology_notes": {"disclosure_ko": "공개 리뷰 데이터 기반 정보입니다"},
    }


# ---------------------------------------------------------------------------
# happy-path generation
# ---------------------------------------------------------------------------


class TestGenerateHappyPath:
    def test_envelope_fields(self):
        b = generate_consumer_insight_brief(_rich_report())
        assert b["schema_version"] == INSIGHT_BRIEF_SCHEMA_VERSION
        assert b["product"]["slug"] == "demo-product"
        assert b["confidence_level"] in ("weak", "moderate", "strong")
        assert isinstance(b["source_analysis_report_sha256"], str)
        assert len(b["source_analysis_report_sha256"]) == 64

    def test_core_verdict_drawn_from_quick_decision(self):
        b = generate_consumer_insight_brief(_rich_report())
        assert "발색이 진하다는 평이 두드러집니다" in b["core_verdict"]["ko"]
        assert b["core_verdict"]["evidence"]["basis"] == "quick_decision.verdict_ko"

    def test_main_tradeoff_present_when_cross_attribute_split_exists(self):
        b = generate_consumer_insight_brief(_rich_report())
        assert b["main_tradeoff"] is not None
        assert b["main_tradeoff"]["for_attribute"] == "pigmentation"
        assert b["main_tradeoff"]["against_attribute"] == "transfer_resistance"

    def test_passes_validator(self):
        b = generate_consumer_insight_brief(_rich_report())
        result = validate_consumer_insight_brief(b)
        assert result.ok, f"unexpected blocking flags: {result.blocking}"


# ---------------------------------------------------------------------------
# angle_candidates — diversity pool
# ---------------------------------------------------------------------------


class TestAngleCandidates:
    def test_at_least_one_of_each_type_present_when_data_supports_it(self):
        b = generate_consumer_insight_brief(_rich_report())
        types_present = {a["type"] for a in b["angle_candidates"]}
        for t in ("strength", "tradeoff", "risk", "segment"):
            assert t in types_present, f"missing type: {t}"

    def test_each_candidate_has_required_fields(self):
        b = generate_consumer_insight_brief(_rich_report())
        for a in b["angle_candidates"]:
            assert {"angle_id", "type", "priority_score", "evidence_n", "ko"} <= a.keys()

    def test_angle_ids_unique_and_h_prefixed(self):
        b = generate_consumer_insight_brief(_rich_report())
        ids = [a["angle_id"] for a in b["angle_candidates"]]
        assert len(ids) == len(set(ids))
        for aid in ids:
            assert aid.startswith("h") and aid[1:].isdigit()

    def test_priority_score_in_zero_one(self):
        b = generate_consumer_insight_brief(_rich_report())
        for a in b["angle_candidates"]:
            assert 0.0 <= a["priority_score"] <= 1.0

    def test_sorted_by_priority_score_desc(self):
        b = generate_consumer_insight_brief(_rich_report())
        scores = [a["priority_score"] for a in b["angle_candidates"]]
        assert scores == sorted(scores, reverse=True)

    def test_max_per_type_cap(self):
        # Add many extra strengths to exercise the cap.
        report = _rich_report()
        report["strengths"] = [
            {"attribute_key": f"strength_{i}", "supporting_count": 100 - i}
            for i in range(10)
        ]
        # The non-existent attribute_keys mean the label_map will
        # return the key itself; that's still acceptable shaped output.
        # Augment attributes table so labels resolve.
        for i in range(10):
            report["attributes"].append({
                "key": f"strength_{i}",
                "label_ko": f"속성{i}",
                "n_positive": 100 - i,
                "n_negative": 0,
            })
        b = generate_consumer_insight_brief(report)
        strength_count = sum(1 for a in b["angle_candidates"] if a["type"] == "strength")
        assert strength_count <= ANGLE_MAX_PER_TYPE

    def test_total_cap(self):
        b = generate_consumer_insight_brief(_rich_report())
        assert len(b["angle_candidates"]) <= ANGLE_MAX_TOTAL

    def test_no_primary_angle_locked(self):
        """Phase C must NOT expose `primary_angle_id`. Channel
        recommendations carry `suggested_angle_ids` only."""
        b = generate_consumer_insight_brief(_rich_report())
        for ch_rec in b["channel_angle_recommendations"].values():
            assert "primary_angle_id" not in ch_rec
            assert "secondary_angle_ids" not in ch_rec
            assert "suggested_angle_ids" in ch_rec

    def test_channel_recommendations_reference_real_candidates(self):
        b = generate_consumer_insight_brief(_rich_report())
        valid_ids = {a["angle_id"] for a in b["angle_candidates"]}
        for ch_rec in b["channel_angle_recommendations"].values():
            for aid in ch_rec["suggested_angle_ids"]:
                assert aid in valid_ids

    def test_instagram_prefers_strength_or_segment(self):
        b = generate_consumer_insight_brief(_rich_report())
        suggested = b["channel_angle_recommendations"]["instagram"]["suggested_angle_ids"]
        types_at_top = [
            next(a["type"] for a in b["angle_candidates"] if a["angle_id"] == aid)
            for aid in suggested
        ]
        # At least one suggestion should be strength or segment when
        # both are present in the pool.
        assert any(t in ("strength", "segment") for t in types_at_top)

    def test_x_prefers_tradeoff_or_risk(self):
        b = generate_consumer_insight_brief(_rich_report())
        suggested = b["channel_angle_recommendations"]["x"]["suggested_angle_ids"]
        types_at_top = [
            next(a["type"] for a in b["angle_candidates"] if a["angle_id"] == aid)
            for aid in suggested
        ]
        assert any(t in ("tradeoff", "risk") for t in types_at_top)

    def test_information_first_phrasing(self):
        b = generate_consumer_insight_brief(_rich_report())
        joined = " ".join(a["ko"] for a in b["angle_candidates"])
        # Every candidate is an information-first lead, never a clickbait phrase.
        for clickbait in ANTI_CLICKBAIT_KO:
            assert clickbait not in joined, f"clickbait token leaked: {clickbait}"


# ---------------------------------------------------------------------------
# angle_priority_modes — declared, not honored in Phase C
# ---------------------------------------------------------------------------


class TestAnglePriorityModesDeclaration:
    def test_modes_declared(self):
        # Future Phase D config knob — surfaced as a constant so
        # callers can introspect what overrides will be available.
        assert "strength_first" in ANGLE_PRIORITY_MODES
        assert "tradeoff_first" in ANGLE_PRIORITY_MODES
        assert "risk_first" in ANGLE_PRIORITY_MODES
        assert "segment_first" in ANGLE_PRIORITY_MODES


# ---------------------------------------------------------------------------
# best_for / not_for / watch_outs
# ---------------------------------------------------------------------------


class TestBestForNotForWatchOuts:
    def test_best_for_uses_quick_decision_first(self):
        b = generate_consumer_insight_brief(_rich_report())
        assert any(
            "건성 피부" in entry["label_ko"] for entry in b["best_for"]
        )

    def test_best_for_falls_back_to_segments(self):
        report = _rich_report()
        report["quick_decision"]["who_for_ko"] = []
        b = generate_consumer_insight_brief(report)
        labels = " ".join(e["label_ko"] for e in b["best_for"])
        assert "건성 피부" in labels  # from segments

    def test_not_for_falls_back_to_monitoring(self):
        report = _rich_report()
        report["quick_decision"]["who_not_for_ko"] = []
        b = generate_consumer_insight_brief(report)
        assert b["not_for"]
        assert any("묻어남" in e["label_ko"] for e in b["not_for"])

    def test_watch_outs_threshold(self):
        report = _rich_report()
        for c in report["monitoring_candidates"]:
            c["n_negative"] = 1  # below WATCH_OUTS_MIN_NEGATIVE
        b = generate_consumer_insight_brief(report)
        assert b["watch_outs"] == []


# ---------------------------------------------------------------------------
# evidence_boundaries (locked phrases)
# ---------------------------------------------------------------------------


class TestEvidenceBoundaries:
    def test_what_we_cannot_say_includes_locked_phrases(self):
        b = generate_consumer_insight_brief(_rich_report())
        cannot = b["evidence_boundaries"]["what_we_cannot_say"]
        for required in WHAT_WE_CANNOT_SAY_KO:
            assert required in cannot

    def test_what_we_can_say_non_empty(self):
        b = generate_consumer_insight_brief(_rich_report())
        assert b["evidence_boundaries"]["what_we_can_say"]

    def test_observation_window_yyyy_mm(self):
        b = generate_consumer_insight_brief(_rich_report())
        win = b["evidence_boundaries"]["observation_window"]
        assert win["start"] == "2025-04"
        assert win["end"] == "2026-04"


# ---------------------------------------------------------------------------
# visual_concept + image prompts
# ---------------------------------------------------------------------------


class TestVisualConcept:
    def test_anti_patterns_locked_present(self):
        b = generate_consumer_insight_brief(_rich_report())
        anti = b["visual_concept"]["anti_patterns"]
        for required in ("face", "logo", "trademark", "skin_disease_imagery"):
            assert required in anti

    def test_anti_patterns_match_constant(self):
        b = generate_consumer_insight_brief(_rich_report())
        for token in ANTI_PATTERNS_LOCKED:
            assert token in b["visual_concept"]["anti_patterns"]

    def test_palette_from_category(self):
        b = generate_consumer_insight_brief(_rich_report())
        expected_palette = PALETTE_BY_CATEGORY["color_cosmetics"]["palette_keywords"]
        assert b["visual_concept"]["palette_keywords"] == expected_palette

    def test_unknown_category_falls_back_to_default(self):
        report = _rich_report()
        report["product"]["category"] = "weird_unknown_category"
        b = generate_consumer_insight_brief(report)
        assert b["visual_concept"]["palette_keywords"] == (
            PALETTE_BY_CATEGORY["default"]["palette_keywords"]
        )

    def test_missing_category_falls_back_to_default(self):
        report = _rich_report()
        report["product"].pop("category", None)
        b = generate_consumer_insight_brief(report)
        assert b["visual_concept"]["palette_keywords"] == (
            PALETTE_BY_CATEGORY["default"]["palette_keywords"]
        )


class TestImagePrompts:
    def test_cover_negative_prompts_present(self):
        b = generate_consumer_insight_brief(_rich_report())
        neg = b["cover_image_prompt"]["negative_prompts"]
        for required in REQUIRED_NEGATIVE_PROMPT_TOKENS:
            assert any(required in n for n in neg)

    def test_seven_background_prompts(self):
        b = generate_consumer_insight_brief(_rich_report())
        assert len(b["background_image_prompts"]) == 7

    def test_one_background_per_section(self):
        b = generate_consumer_insight_brief(_rich_report())
        sections = [p["section"] for p in b["background_image_prompts"]]
        assert sorted(sections) == sorted(CARDNEWS_SECTIONS)

    def test_every_background_has_negative_prompts(self):
        b = generate_consumer_insight_brief(_rich_report())
        for p in b["background_image_prompts"]:
            for required in REQUIRED_NEGATIVE_PROMPT_TOKENS:
                assert any(required in n for n in p["negative_prompts"])

    def test_no_face_or_logo_in_prompt_text(self):
        """Generator should never emit an image prompt whose body
        text mentions face/person/logo as a *requested* element.
        It can mention them only inside the 'Avoid:' clause."""
        b = generate_consumer_insight_brief(_rich_report())
        # The prompt body always contains the literal "Avoid:" segment;
        # split on it and check the *requested* head only.
        all_prompts = [b["cover_image_prompt"]["en"]]
        all_prompts += [p["en"] for p in b["background_image_prompts"]]
        for prompt in all_prompts:
            head = prompt.split("Avoid:", 1)[0]
            for forbidden in ("face", "logo", "trademark", "person"):
                assert forbidden not in head.lower(), (
                    f"{forbidden!r} appeared in requested side of: {prompt!r}"
                )


# ---------------------------------------------------------------------------
# error / failure paths
# ---------------------------------------------------------------------------


class TestGenerationErrors:
    def test_non_dict_raises(self):
        with pytest.raises(InsightBriefGenerationError):
            generate_consumer_insight_brief("not a dict")  # type: ignore[arg-type]

    def test_no_verdict_no_attributes_raises(self):
        report = {
            "schema_version": "3.0",
            "product": {"slug": "x"},
            "corpus": {"n_reviews_total": 0},
            "attributes": [],
        }
        with pytest.raises(InsightBriefGenerationError, match="core_verdict"):
            generate_consumer_insight_brief(report)

    def test_no_angles_anywhere_raises(self):
        # Verdict derives but no angles can be built.
        report = {
            "schema_version": "3.0",
            "product": {"slug": "x"},
            "corpus": {"n_reviews_total": 5},
            "attributes": [
                {"key": "pigmentation", "label_ko": "발색",
                 "n_positive": 1, "n_negative": 0},  # too thin for any bucket
            ],
        }
        with pytest.raises(InsightBriefGenerationError, match="angle_candidates"):
            generate_consumer_insight_brief(report)


# ---------------------------------------------------------------------------
# determinism / non-mutation
# ---------------------------------------------------------------------------


class TestDeterminism:
    def test_same_report_same_content(self):
        report = _rich_report()
        a = generate_consumer_insight_brief(report)
        b = generate_consumer_insight_brief(report)
        # generated_at differs; angle_candidates and other content
        # fields are byte-stable.
        assert a["angle_candidates"] == b["angle_candidates"]
        assert a["channel_angle_recommendations"] == b["channel_angle_recommendations"]
        assert a["source_analysis_report_sha256"] == b["source_analysis_report_sha256"]

    def test_does_not_mutate_input(self):
        report = _rich_report()
        before = copy.deepcopy(report)
        generate_consumer_insight_brief(report)
        assert report == before


# ---------------------------------------------------------------------------
# validator — additional rules
# ---------------------------------------------------------------------------


def _flag_rules(result: BriefValidationResult) -> set[str]:
    return {f.rule for f in result.blocking}


class TestValidator:
    def test_clickbait_in_core_verdict_blocked(self):
        b = generate_consumer_insight_brief(_rich_report())
        b["core_verdict"]["ko"] = "역대급 발색"
        result = validate_consumer_insight_brief(b)
        assert "anti_clickbait" in _flag_rules(result)

    def test_clickbait_in_angle_blocked(self):
        b = generate_consumer_insight_brief(_rich_report())
        b["angle_candidates"][0]["ko"] = "절대 사지 마세요"
        result = validate_consumer_insight_brief(b)
        assert "anti_clickbait" in _flag_rules(result)

    def test_medical_claim_blocked(self):
        b = generate_consumer_insight_brief(_rich_report())
        b["core_verdict"]["ko"] = "효과가 검증된 제품"
        result = validate_consumer_insight_brief(b)
        assert "ban_list_medical" in _flag_rules(result)

    def test_locked_phrase_missing_blocked(self):
        b = generate_consumer_insight_brief(_rich_report())
        b["evidence_boundaries"]["what_we_cannot_say"] = ["something else"]
        result = validate_consumer_insight_brief(b)
        assert "evidence_boundary_locked_phrase" in _flag_rules(result)

    def test_anti_pattern_missing_blocked(self):
        b = generate_consumer_insight_brief(_rich_report())
        b["visual_concept"]["anti_patterns"] = ["something_else"]
        result = validate_consumer_insight_brief(b)
        assert "visual_concept_anti_pattern_locked" in _flag_rules(result)

    def test_invalid_angle_type_blocked(self):
        b = generate_consumer_insight_brief(_rich_report())
        b["angle_candidates"][0]["type"] = "watch_out"  # was the old name; now invalid
        result = validate_consumer_insight_brief(b)
        assert "angle_candidate_type" in _flag_rules(result)

    def test_priority_score_out_of_range_blocked(self):
        b = generate_consumer_insight_brief(_rich_report())
        b["angle_candidates"][0]["priority_score"] = 1.5
        result = validate_consumer_insight_brief(b)
        assert "angle_candidate_priority_score" in _flag_rules(result)

    def test_suggested_angle_id_unknown_blocked(self):
        b = generate_consumer_insight_brief(_rich_report())
        b["channel_angle_recommendations"]["instagram"]["suggested_angle_ids"] = ["h9999"]
        result = validate_consumer_insight_brief(b)
        assert "suggested_angle_id_unknown" in _flag_rules(result)

    def test_negative_prompt_missing_blocked(self):
        b = generate_consumer_insight_brief(_rich_report())
        b["cover_image_prompt"]["negative_prompts"] = ["only one"]
        result = validate_consumer_insight_brief(b)
        assert "image_prompt_negative_required" in _flag_rules(result)

    def test_background_section_missing_blocked(self):
        b = generate_consumer_insight_brief(_rich_report())
        b["background_image_prompts"].pop()  # only 6 left
        result = validate_consumer_insight_brief(b)
        assert "background_image_prompts_count" in _flag_rules(result)


class TestDecisionCriteriaAngles:
    """SCAMPER M+E: angle_candidates carry purchase-decision phrasing
    rather than the old "리뷰에서 반복된 X 호평" / "구매 전 확인할 X"
    templates."""

    def test_strength_angle_is_contrast_pair(self):
        b = generate_consumer_insight_brief(_rich_report())
        strength_angles = [
            a for a in b["angle_candidates"] if a["type"] == "strength"
        ]
        assert strength_angles
        for a in strength_angles:
            ko = a.get("ko") or ""
            # Old template tokens are gone.
            assert "리뷰에서 반복된" not in ko, ko
            assert "호평" not in ko, ko
            # New template carries either "강점" pairing or a
            # count-paired strength-only fallback.
            assert "강점" in ko or "만족 후기" in ko, ko

    def test_risk_angle_carries_count(self):
        b = generate_consumer_insight_brief(_rich_report())
        risk_angles = [
            a for a in b["angle_candidates"] if a["type"] == "risk"
        ]
        assert risk_angles
        for a in risk_angles:
            ko = a.get("ko") or ""
            # New phrasing carries a digit (count) — no more bare
            # "구매 전 확인할 X" template.
            assert any(ch.isdigit() for ch in ko), ko

    def test_tradeoff_angle_carries_both_counts(self):
        b = generate_consumer_insight_brief(_rich_report())
        tradeoff_angles = [
            a for a in b["angle_candidates"] if a["type"] == "tradeoff"
        ]
        assert tradeoff_angles
        for a in tradeoff_angles:
            ko = a.get("ko") or ""
            # Both 만족 N건 and 불만 M건.
            assert "만족" in ko and "불만" in ko, ko
            assert sum(ch.isdigit() for ch in ko) >= 2, ko

    def test_no_generic_phrases_in_any_angle(self):
        from src.voc.content.editorial_rules import (
            find_unsupported_generic_phrases,
        )
        b = generate_consumer_insight_brief(_rich_report())
        for a in b["angle_candidates"]:
            ko = a.get("ko") or ""
            hits = find_unsupported_generic_phrases(ko)
            blocking = [h for h in hits if h["severity"] == "block"]
            assert not blocking, (a["angle_id"], ko, blocking)
