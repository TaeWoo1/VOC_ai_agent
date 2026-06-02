"""Tests for editorial_validators.

Each rule gets at least one positive (passes when conformant) and one
negative (blocks the named rule) test. Phase D1 includes the **relaxed**
novel_claim_guard (per-slide anchor required, not per-bullet) and the
new **angle_propagation_per_slide** rule.
"""
from __future__ import annotations

import copy

import pytest

from src.voc.content.editorial_validators import (
    DISCLOSURE_REQUIRED_SUBSTRINGS,
    EditorialValidationResult,
    LOCKED_SLIDE_TITLES_KO,
    extract_angle_core_noun,
    validate_editorial_cardnews_ko,
    _korean_substring_overlap,
    _resolve_brief_path,
)


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


def _skeleton() -> dict:
    return {
        "schema_version": "1.0",
        "lang": "ko",
        "channel": "instagram",
        "format": "cardnews_7slide",
        "product": {"slug": "demo", "name_ko": "데모"},
        "confidence_level": "strong",
        "slide_count": 7,
        "slides": [
            {"index": 1, "type": "hook", "title": "한 줄 인상",
             "subtitle": "리뷰 1135건에서 발색 호평이 두드러집니다"},
            {"index": 2, "type": "loved", "title": "반복되는 호평",
             "bullets": ["발색: 호평 181건", "지속력: 호평 47건"]},
            {"index": 3, "type": "divides", "title": "갈리는 의견",
             "bullets": ["발색: 호평 181, 비판 71", "지속력: 호평 47, 비판 12"]},
            {"index": 4, "type": "fit", "title": "잘 맞은 분들",
             "bullets": ["건성 피부: 잘 맞았다는 의견 32건", "쿨톤: 잘 맞았다는 의견 24건"]},
            {"index": 5, "type": "watch_outs", "title": "유의 포인트",
             "bullets": ["묻어남: 비판 38건", "발색 변화: 비판 12건"]},
            {"index": 6, "type": "best_for", "title": "구매 전 점검",
             "for_bullets": ["건성 피부에서 호평 32건"],
             "not_for_bullets": ["묻어남이 중요한 사용 상황"]},
            {"index": 7, "type": "method", "title": "분석 기준",
             "bullets": ["리뷰 1135건 분석", "관찰 기간: 2025-04 ~ 2026-04"],
             "disclosure": "공개 리뷰 데이터를 정리한 정보입니다"},
        ],
    }


def _editorial_from_skeleton(skel: dict | None = None) -> dict:
    """A minimally-polished editorial that should pass every validator."""
    skel = skel or _skeleton()
    e = copy.deepcopy(skel)
    e["polished"] = True
    # Add Phase D required fields per slide
    # Every non-method slide carries the selected-angle citation in
    # source_brief_fields so the angle_propagation rule passes by
    # explicit citation. Method slide is exempt.
    paths_per_slide = [
        ["core_verdict.ko", "angle_candidates[h2]"],
        ["angle_candidates[h2]", "best_for[0]"],
        ["main_tradeoff.ko", "angle_candidates[h2]"],
        ["best_for[0]", "best_for[1]", "angle_candidates[h2]"],
        ["watch_outs[0]", "watch_outs[1]", "angle_candidates[h2]"],
        ["best_for[0]", "not_for[0]", "angle_candidates[h2]"],
        ["evidence_boundaries.n_reviews_total"],
    ]
    for slide, paths in zip(e["slides"], paths_per_slide):
        slide["source_brief_fields"] = list(paths)
    # Light tone polish on slide 2 — preserves numbers + uses angle's core noun "발색"
    e["slides"][1]["bullets"] = [
        "리뷰 181건에서 발색 호평이 반복됩니다",
        "지속력 호평 47건이 누적됐습니다",
    ]
    return e


def _brief() -> dict:
    return {
        "schema_version": "1.0",
        "product": {"slug": "demo"},
        "confidence_level": "strong",
        "core_verdict": {"ko": "발색이 진하다는 평이 두드러집니다"},
        "main_tradeoff": {"ko": "발색은 강하지만 묻어남에서 의견이 갈립니다"},
        "angle_candidates": [
            {"angle_id": "h1", "type": "tradeoff", "priority_score": 1.0,
             "evidence_n": 252, "ko": "의견이 갈린 발색"},
            {"angle_id": "h2", "type": "strength", "priority_score": 0.7,
             "evidence_n": 181, "ko": "리뷰에서 반복된 발색 호평"},
        ],
        "best_for": [
            {"label_ko": "건성 피부에서 호평이 반복", "evidence_n": 32},
            {"label_ko": "쿨톤 사용자에서 호평", "evidence_n": 24},
        ],
        "not_for": [{"label_ko": "마스크/외출 사용이 잦은 분", "evidence_n": 38}],
        "watch_outs": [
            {"concern_label_ko": "묻어남", "n_negative": 38},
            {"concern_label_ko": "발색 변화", "n_negative": 12},
        ],
        "evidence_boundaries": {"n_reviews_total": 1135},
        "visual_concept": {"mood_ko": "차분한 톤"},
    }


def _selected_angle() -> dict:
    return {
        "angle_id": "h2",
        "type": "strength",
        "ko": "리뷰에서 반복된 발색 호평",
        "priority_score": 0.7,
        "evidence_n": 181,
    }


def _analysis_report() -> dict:
    return {
        "attributes": [
            {"key": "pigmentation",   "label_ko": "발색"},
            {"key": "persistence",    "label_ko": "지속력"},
            {"key": "transfer_resistance", "label_ko": "묻어남"},
        ],
    }


def _flag_rules(result: EditorialValidationResult) -> set[str]:
    return {f.rule for f in result.blocking}


# ---------------------------------------------------------------------------
# happy path
# ---------------------------------------------------------------------------


class TestEditorialValidatorHappyPath:
    def test_baseline_editorial_passes(self):
        result = validate_editorial_cardnews_ko(
            _editorial_from_skeleton(),
            _skeleton(),
            _brief(),
            _selected_angle(),
            analysis_report=_analysis_report(),
        )
        assert result.ok, f"unexpected blocking flags: {result.blocking}"


# ---------------------------------------------------------------------------
# numeric_preservation
# ---------------------------------------------------------------------------


class TestNumericPreservation:
    def test_drop_a_number_blocks(self):
        e = _editorial_from_skeleton()
        # Skeleton slide 2 had 181 and 47; drop the 47.
        e["slides"][1]["bullets"] = [
            "리뷰 181건에서 발색 호평이 반복됩니다",
            "지속력 호평이 누적됐습니다",
        ]
        result = validate_editorial_cardnews_ko(
            e, _skeleton(), _brief(), _selected_angle(),
            analysis_report=_analysis_report(),
        )
        rules = _flag_rules(result)
        assert "numeric_preservation" in rules

    def test_reformatting_preserves(self):
        e = _editorial_from_skeleton()
        e["slides"][1]["bullets"] = [
            "리뷰 181건에서 발색 호평이 반복됩니다",
            "지속력 47건의 호평이 누적됐습니다",
        ]
        result = validate_editorial_cardnews_ko(
            e, _skeleton(), _brief(), _selected_angle(),
            analysis_report=_analysis_report(),
        )
        assert "numeric_preservation" not in _flag_rules(result)

    def test_small_numbers_under_threshold_not_tracked(self):
        # Skeleton slide 7 has "관찰 기간: 2025-04 ~ 2026-04"; 4
        # is under threshold so dropping it shouldn't fire the rule.
        e = _editorial_from_skeleton()
        e["slides"][6]["bullets"] = ["리뷰 1135건 분석", "관찰 기간: 2025년 ~ 2026년"]
        result = validate_editorial_cardnews_ko(
            e, _skeleton(), _brief(), _selected_angle(),
            analysis_report=_analysis_report(),
        )
        # 1135, 2025, 2026 must be preserved; 4 is below threshold.
        assert "numeric_preservation" not in _flag_rules(result)


# ---------------------------------------------------------------------------
# slide_structure_preservation
# ---------------------------------------------------------------------------


class TestSlideStructurePreservation:
    def test_slide_count_drift_blocks(self):
        e = _editorial_from_skeleton()
        e["slides"] = e["slides"][:6]
        result = validate_editorial_cardnews_ko(
            e, _skeleton(), _brief(), _selected_angle(),
            analysis_report=_analysis_report(),
        )
        assert "slide_structure_preservation" in _flag_rules(result)

    def test_index_drift_blocks(self):
        e = _editorial_from_skeleton()
        e["slides"][2]["index"] = 99
        result = validate_editorial_cardnews_ko(
            e, _skeleton(), _brief(), _selected_angle(),
            analysis_report=_analysis_report(),
        )
        assert "slide_structure_preservation" in _flag_rules(result)

    def test_type_drift_blocks(self):
        e = _editorial_from_skeleton()
        e["slides"][1]["type"] = "method"
        result = validate_editorial_cardnews_ko(
            e, _skeleton(), _brief(), _selected_angle(),
            analysis_report=_analysis_report(),
        )
        assert "slide_structure_preservation" in _flag_rules(result)

    def test_title_rewrite_blocks(self):
        e = _editorial_from_skeleton()
        e["slides"][1]["title"] = "다른 제목으로 변경"
        result = validate_editorial_cardnews_ko(
            e, _skeleton(), _brief(), _selected_angle(),
            analysis_report=_analysis_report(),
        )
        assert "slide_structure_preservation" in _flag_rules(result)


# ---------------------------------------------------------------------------
# confidence_consistency
# ---------------------------------------------------------------------------


class TestConfidenceConsistency:
    def test_mismatch_blocks(self):
        e = _editorial_from_skeleton()
        e["confidence_level"] = "weak"
        result = validate_editorial_cardnews_ko(
            e, _skeleton(), _brief(), _selected_angle(),
            analysis_report=_analysis_report(),
        )
        assert "confidence_consistency" in _flag_rules(result)


# ---------------------------------------------------------------------------
# source_field_traceability
# ---------------------------------------------------------------------------


class TestSourceFieldTraceability:
    def test_empty_source_brief_fields_blocks(self):
        e = _editorial_from_skeleton()
        e["slides"][1]["source_brief_fields"] = []
        result = validate_editorial_cardnews_ko(
            e, _skeleton(), _brief(), _selected_angle(),
            analysis_report=_analysis_report(),
        )
        assert "source_field_traceability" in _flag_rules(result)

    def test_unknown_path_blocks(self):
        e = _editorial_from_skeleton()
        e["slides"][1]["source_brief_fields"] = ["something_made_up"]
        result = validate_editorial_cardnews_ko(
            e, _skeleton(), _brief(), _selected_angle(),
            analysis_report=_analysis_report(),
        )
        assert "source_field_traceability" in _flag_rules(result)

    def test_unknown_angle_id_blocks(self):
        e = _editorial_from_skeleton()
        e["slides"][1]["source_brief_fields"] = ["angle_candidates[h9999]"]
        result = validate_editorial_cardnews_ko(
            e, _skeleton(), _brief(), _selected_angle(),
            analysis_report=_analysis_report(),
        )
        assert "source_field_traceability" in _flag_rules(result)

    def test_index_out_of_range_blocks(self):
        e = _editorial_from_skeleton()
        e["slides"][1]["source_brief_fields"] = ["best_for[99]"]
        result = validate_editorial_cardnews_ko(
            e, _skeleton(), _brief(), _selected_angle(),
            analysis_report=_analysis_report(),
        )
        assert "source_field_traceability" in _flag_rules(result)


class TestResolveBriefPath:
    def test_each_root_resolves(self):
        b = _brief()
        assert _resolve_brief_path(b, "core_verdict.ko")
        assert _resolve_brief_path(b, "main_tradeoff.ko")
        assert _resolve_brief_path(b, "angle_candidates[h1]")
        assert _resolve_brief_path(b, "best_for[0]")
        assert _resolve_brief_path(b, "not_for[0]")
        assert _resolve_brief_path(b, "watch_outs[0]")
        assert _resolve_brief_path(b, "evidence_boundaries.n_reviews_total")
        assert _resolve_brief_path(b, "visual_concept.mood_ko")

    def test_unknown_root_rejected(self):
        assert not _resolve_brief_path(_brief(), "secret_field.x")


# ---------------------------------------------------------------------------
# novel_claim_guard (RELAXED — per-slide, not per-bullet)
# ---------------------------------------------------------------------------


class TestNovelClaimGuardRelaxed:
    def test_one_anchored_bullet_passes_slide(self):
        """RELAXED rule: as long as ONE bullet on the slide carries
        a numeric / attribute label / angle label, the slide passes
        even if other bullets are tone-only."""
        e = _editorial_from_skeleton()
        # Slide 4 (fit): 1 anchored ("건성 피부 32"), 1 tone-only.
        e["slides"][3]["bullets"] = [
            "건성 피부 사용자에게 잘 맞았다는 의견 32건",
            "차분한 인상으로 다가옵니다",   # no number, no label
        ]
        # Source paths still resolve and slide reflects angle via 발색? No,
        # angle is "리뷰에서 반복된 발색 호평". Use core noun "발색"
        # somewhere on slide for angle propagation. Fit slide doesn't
        # naturally mention 발색, so reuse path citation.
        e["slides"][3]["source_brief_fields"] = [
            "best_for[0]", "angle_candidates[h2]",
        ]
        result = validate_editorial_cardnews_ko(
            e, _skeleton(), _brief(), _selected_angle(),
            analysis_report=_analysis_report(),
        )
        assert "novel_claim_guard" not in _flag_rules(result)

    def test_zero_anchored_bullets_blocks(self):
        e = _editorial_from_skeleton()
        # All bullets on slide 2 stripped of numbers AND labels.
        e["slides"][1]["bullets"] = [
            "차분한 인상이 반복됩니다",
            "꾸준한 만족감이 보입니다",
        ]
        # Keep angle propagation passable via path citation
        e["slides"][1]["source_brief_fields"] = ["angle_candidates[h2]", "best_for[0]"]
        result = validate_editorial_cardnews_ko(
            e, _skeleton(), _brief(), _selected_angle(),
            analysis_report=_analysis_report(),
        )
        assert "novel_claim_guard" in _flag_rules(result)

    def test_attribute_label_anchor_passes(self):
        # Bullet has no number but contains attribute label "발색".
        e = _editorial_from_skeleton()
        e["slides"][1]["bullets"] = [
            "발색에 대한 호평이 반복적으로 등장합니다",
            "지속력에 대한 호평 47건",
        ]
        result = validate_editorial_cardnews_ko(
            e, _skeleton(), _brief(), _selected_angle(),
            analysis_report=_analysis_report(),
        )
        # 47 is preserved on the second bullet; first bullet is
        # anchored via the attribute label "발색".
        assert "novel_claim_guard" not in _flag_rules(result)


# ---------------------------------------------------------------------------
# angle_propagation_per_slide
# ---------------------------------------------------------------------------


class TestAnglePropagation:
    def test_method_slide_exempt(self):
        e = _editorial_from_skeleton()
        # Method slide normally has no angle reference; it's exempt.
        result = validate_editorial_cardnews_ko(
            e, _skeleton(), _brief(), _selected_angle(),
            analysis_report=_analysis_report(),
        )
        # Should not flag method slide for angle_propagation
        for f in result.blocking:
            assert "slide[7]" not in f.location or f.rule != "angle_propagation_per_slide"

    def test_passes_via_source_field_citation(self):
        """If a slide cites the selected angle in source_brief_fields,
        it propagates regardless of text content."""
        e = _editorial_from_skeleton()
        # Slide 5 (watch_outs) text doesn't naturally contain "발색"
        # — but cites the angle.
        e["slides"][4]["source_brief_fields"] = [
            "angle_candidates[h2]", "watch_outs[0]",
        ]
        e["slides"][4]["bullets"] = [
            "묻어남: 비판 38건",
            "발색 변화: 비판 12건",  # contains 발색 — also passes via core noun
        ]
        result = validate_editorial_cardnews_ko(
            e, _skeleton(), _brief(), _selected_angle(),
            analysis_report=_analysis_report(),
        )
        assert "angle_propagation_per_slide" not in _flag_rules(result)

    def test_passes_via_core_noun_substring(self):
        """Slide doesn't cite the angle but contains its core noun."""
        e = _editorial_from_skeleton()
        # Selected angle = "리뷰에서 반복된 발색 호평", core noun = "발색".
        e["slides"][2]["source_brief_fields"] = ["main_tradeoff.ko"]
        e["slides"][2]["bullets"] = [
            "발색 호평 181건, 비판 71건",
            "지속력 호평 47건, 비판 12건",
        ]
        result = validate_editorial_cardnews_ko(
            e, _skeleton(), _brief(), _selected_angle(),
            analysis_report=_analysis_report(),
        )
        assert "angle_propagation_per_slide" not in _flag_rules(result)

    def test_blocks_when_no_propagation_signal(self):
        """A non-method slide with neither citation nor any Korean
        substring overlap with the selected angle should block."""
        e = _editorial_from_skeleton()
        # Strip every reference to the angle's core noun ("발색") AND
        # remove the angle citation. Keep numeric preservation
        # satisfied so this test isolates the angle rule.
        e["slides"][3]["source_brief_fields"] = ["best_for[0]", "best_for[1]"]
        e["slides"][3]["bullets"] = [
            "건성 피부 32건의 의견",
            "쿨톤 24건의 의견",
        ]
        result = validate_editorial_cardnews_ko(
            e, _skeleton(), _brief(), _selected_angle(),
            analysis_report=_analysis_report(),
        )
        assert "angle_propagation_per_slide" in _flag_rules(result)


class TestExtractAngleCoreNoun:
    @pytest.mark.parametrize(
        "phrase,expected",
        [
            ("의견이 갈린 발색", "발색"),
            ("의견이 갈린 묻어남", "묻어남"),
            ("리뷰에서 반복된 발색 호평", "발색"),
            ("리뷰에서 반복된 지속력 호평", "지속력"),
            ("구매 전 확인할 묻어남", "묻어남"),
            ("건성 피부에서 반복된 사용감", "건성 피부"),
            ("", ""),
        ],
    )
    def test_extracts(self, phrase, expected):
        assert extract_angle_core_noun(phrase) == expected


class TestKoreanSubstringOverlap:
    def test_finds_three_char_overlap(self):
        assert _korean_substring_overlap("발색이 진하다", "이 제품은 발색이 좋아요")

    def test_short_overlap_rejected(self):
        # Only 2-char overlap available
        assert not _korean_substring_overlap("발색", "발음")

    def test_non_korean_ignored(self):
        assert not _korean_substring_overlap("ABCDE", "ABCDEFG")


# ---------------------------------------------------------------------------
# disclosure_keyword_preservation
# ---------------------------------------------------------------------------


class TestDisclosureKeyword:
    def test_passes_with_required_substring(self):
        e = _editorial_from_skeleton()
        # Default disclosure already contains "리뷰" — ok.
        result = validate_editorial_cardnews_ko(
            e, _skeleton(), _brief(), _selected_angle(),
            analysis_report=_analysis_report(),
        )
        assert "disclosure_keyword_preservation" not in _flag_rules(result)

    def test_blocks_when_no_substring(self):
        e = _editorial_from_skeleton()
        e["slides"][6]["disclosure"] = "공개 데이터 기반"  # no required substring
        result = validate_editorial_cardnews_ko(
            e, _skeleton(), _brief(), _selected_angle(),
            analysis_report=_analysis_report(),
        )
        assert "disclosure_keyword_preservation" in _flag_rules(result)

    def test_required_substrings_constant_pinned(self):
        assert DISCLOSURE_REQUIRED_SUBSTRINGS == (
            "리뷰", "정리", "효능 보장하지 않"
        )


# ---------------------------------------------------------------------------
# locked titles constant
# ---------------------------------------------------------------------------


class TestLockedTitles:
    def test_locked_titles_match_phase_b(self):
        assert LOCKED_SLIDE_TITLES_KO == {
            "hook": "한 줄 인상",
            "loved": "반복되는 호평",
            "divides": "갈리는 의견",
            "fit": "잘 맞은 분들",
            "watch_outs": "유의 포인트",
            "best_for": "구매 전 점검",
            "method": "분석 기준",
        }
