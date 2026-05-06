"""Tests for src.voc.content.validators.

Phase B contract: every cardnews must pass `validate_instagram_cardnews_ko`
with zero blocking flags. The validator is defense-in-depth and the
generator's contract — so tests cover both the happy path (a
hand-built valid cardnews) and every blocking rule.
"""
from __future__ import annotations

import pytest

from src.voc.content.validators import (
    BAN_LIST_CAUSAL_KO,
    BAN_LIST_DIRECTIVE_KO,
    BAN_LIST_MEDICAL_KO,
    BAN_LIST_SUPERLATIVE_KO,
    BULLETS_MAX,
    BULLETS_MIN,
    BULLET_MAX_CHARS_KO,
    EXPECTED_SLIDE_COUNT,
    EXPECTED_SLIDE_TYPES,
    SLIDE_TITLE_MAX_CHARS_KO,
    CardnewsValidationResult,
    validate_instagram_cardnews_ko,
)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _valid_cardnews() -> dict:
    """A hand-crafted valid KO Instagram cardnews used as a baseline.
    Each test mutates a copy to exercise one rule at a time."""
    return {
        "schema_version": "1.0",
        "lang": "ko",
        "channel": "instagram",
        "format": "cardnews_7slide",
        "product": {"slug": "demo", "name_ko": "데모"},
        "confidence_level": "moderate",
        "slide_count": 7,
        "slides": [
            {"index": 1, "type": "hook", "title": "한 줄 인상",
             "subtitle": "리뷰에서 반복되는 인상: 발색 호평이 두드러집니다"},
            {"index": 2, "type": "loved", "title": "반복되는 호평",
             "bullets": ["발색: 호평 181건", "지속력: 호평 47건"]},
            {"index": 3, "type": "divides", "title": "갈리는 의견",
             "bullets": ["발색: 호평 181, 비판 71", "지속력: 호평 47, 비판 12"]},
            {"index": 4, "type": "fit", "title": "잘 맞은 분들",
             "bullets": ["건성 피부: 잘 맞았다는 의견 32건",
                         "쿨톤: 잘 맞았다는 의견 24건"]},
            {"index": 5, "type": "watch_outs", "title": "유의 포인트",
             "bullets": ["묻어남: 비판 의견 12건", "발림성: 비판 의견 8건"]},
            {"index": 6, "type": "best_for", "title": "구매 전 점검",
             "for_bullets": ["건성 피부에서 호평이 반복"],
             "not_for_bullets": ["묻어남이 중요한 사용 상황"]},
            {"index": 7, "type": "method", "title": "분석 기준",
             "bullets": ["리뷰 1135건 분석",
                         "표본 규모가 충분합니다",
                         "리뷰 신호이며 결함을 확정하지 않습니다"],
             "disclosure": "공개 리뷰 데이터를 정리한 정보입니다"},
        ],
    }


def _flag_rules(result: CardnewsValidationResult) -> set[str]:
    return {f.rule for f in result.blocking}


# ---------------------------------------------------------------------------
# happy path
# ---------------------------------------------------------------------------


class TestValidatorHappyPath:
    def test_baseline_cardnews_validates(self):
        result = validate_instagram_cardnews_ko(_valid_cardnews())
        assert result.ok, f"unexpected blocking flags: {result.blocking}"

    def test_summary_says_ok(self):
        assert validate_instagram_cardnews_ko(_valid_cardnews()).summary().startswith("ok")

    def test_advisory_does_not_flip_ok(self):
        # No advisory rules in Phase B yet — verify the property
        # works on a clean result.
        result = validate_instagram_cardnews_ko(_valid_cardnews())
        assert result.ok
        assert result.advisory == ()


# ---------------------------------------------------------------------------
# top-level shape
# ---------------------------------------------------------------------------


class TestTopLevelShape:
    def test_rejects_non_dict(self):
        result = validate_instagram_cardnews_ko([])  # type: ignore[arg-type]
        assert not result.ok
        assert "malformed" in _flag_rules(result)

    def test_rejects_wrong_lang(self):
        c = _valid_cardnews()
        c["lang"] = "en"
        result = validate_instagram_cardnews_ko(c)
        assert "lang" in _flag_rules(result)

    def test_rejects_wrong_channel(self):
        c = _valid_cardnews()
        c["channel"] = "threads"
        result = validate_instagram_cardnews_ko(c)
        assert "channel" in _flag_rules(result)

    def test_rejects_wrong_format(self):
        c = _valid_cardnews()
        c["format"] = "cardnews_5slide"
        result = validate_instagram_cardnews_ko(c)
        assert "format" in _flag_rules(result)


# ---------------------------------------------------------------------------
# slides shape
# ---------------------------------------------------------------------------


class TestSlideShape:
    def test_slide_count_must_be_seven(self):
        c = _valid_cardnews()
        c["slides"] = c["slides"][:5]
        result = validate_instagram_cardnews_ko(c)
        assert "slide_count" in _flag_rules(result)

    def test_slide_index_must_match_position(self):
        c = _valid_cardnews()
        c["slides"][2]["index"] = 99
        result = validate_instagram_cardnews_ko(c)
        assert "slide_index" in _flag_rules(result)

    def test_slide_type_must_match_position(self):
        c = _valid_cardnews()
        c["slides"][1]["type"] = "method"  # slot 2 must be "loved"
        result = validate_instagram_cardnews_ko(c)
        assert "slide_type" in _flag_rules(result)

    def test_expected_slide_types_constant_matches_position(self):
        # Sanity: the constant the validator is built around.
        assert EXPECTED_SLIDE_COUNT == 7
        assert EXPECTED_SLIDE_TYPES == (
            "hook", "loved", "divides", "fit", "watch_outs", "best_for", "method"
        )


# ---------------------------------------------------------------------------
# title length
# ---------------------------------------------------------------------------


class TestTitleLength:
    def test_title_at_limit_passes(self):
        c = _valid_cardnews()
        c["slides"][1]["title"] = "가" * SLIDE_TITLE_MAX_CHARS_KO
        result = validate_instagram_cardnews_ko(c)
        assert "title_length" not in _flag_rules(result)

    def test_title_over_limit_blocked(self):
        c = _valid_cardnews()
        c["slides"][1]["title"] = "가" * (SLIDE_TITLE_MAX_CHARS_KO + 1)
        result = validate_instagram_cardnews_ko(c)
        assert "title_length" in _flag_rules(result)

    def test_empty_title_blocked(self):
        c = _valid_cardnews()
        c["slides"][1]["title"] = ""
        result = validate_instagram_cardnews_ko(c)
        assert "title_present" in _flag_rules(result)


# ---------------------------------------------------------------------------
# bullet count + length
# ---------------------------------------------------------------------------


class TestBulletCount:
    def test_zero_bullets_blocked(self):
        c = _valid_cardnews()
        c["slides"][1]["bullets"] = []
        result = validate_instagram_cardnews_ko(c)
        assert "bullet_count" in _flag_rules(result)

    def test_one_bullet_blocked(self):
        c = _valid_cardnews()
        c["slides"][1]["bullets"] = ["발색: 호평 181건"]
        result = validate_instagram_cardnews_ko(c)
        assert "bullet_count" in _flag_rules(result)

    def test_min_bullets_passes(self):
        c = _valid_cardnews()
        c["slides"][1]["bullets"] = ["발색: 호평 181건", "지속력: 호평 47건"]
        result = validate_instagram_cardnews_ko(c)
        assert "bullet_count" not in _flag_rules(result)

    def test_max_bullets_passes(self):
        c = _valid_cardnews()
        c["slides"][1]["bullets"] = [
            "발색: 호평 181건",
            "지속력: 호평 47건",
            "발림성: 호평 32건",
            "촉촉함: 호평 18건",
        ]
        result = validate_instagram_cardnews_ko(c)
        assert "bullet_count" not in _flag_rules(result)

    def test_over_max_bullets_blocked(self):
        c = _valid_cardnews()
        c["slides"][1]["bullets"] = ["가" * 5] * (BULLETS_MAX + 1)
        result = validate_instagram_cardnews_ko(c)
        assert "bullet_count" in _flag_rules(result)


class TestBulletLength:
    def test_bullet_at_limit_passes(self):
        c = _valid_cardnews()
        c["slides"][1]["bullets"] = ["가" * BULLET_MAX_CHARS_KO, "지속력: 호평 47건"]
        result = validate_instagram_cardnews_ko(c)
        assert "bullet_length" not in _flag_rules(result)

    def test_bullet_over_limit_blocked(self):
        c = _valid_cardnews()
        c["slides"][1]["bullets"] = ["가" * (BULLET_MAX_CHARS_KO + 1), "지속력: 호평 47건"]
        result = validate_instagram_cardnews_ko(c)
        assert "bullet_length" in _flag_rules(result)

    def test_empty_bullet_blocked(self):
        c = _valid_cardnews()
        c["slides"][1]["bullets"] = ["", "지속력: 호평 47건"]
        result = validate_instagram_cardnews_ko(c)
        assert "bullet_present" in _flag_rules(result)


# ---------------------------------------------------------------------------
# best_for combined budget
# ---------------------------------------------------------------------------


class TestBestForBudget:
    def test_for_plus_not_for_count_must_be_in_range(self):
        c = _valid_cardnews()
        c["slides"][5]["for_bullets"] = []
        c["slides"][5]["not_for_bullets"] = []
        result = validate_instagram_cardnews_ko(c)
        assert "bullet_count" in _flag_rules(result)

    def test_combined_over_budget_blocked(self):
        c = _valid_cardnews()
        c["slides"][5]["for_bullets"] = ["가"] * 3
        c["slides"][5]["not_for_bullets"] = ["가"] * 3
        result = validate_instagram_cardnews_ko(c)
        assert "bullet_count" in _flag_rules(result)

    def test_only_for_at_min_passes(self):
        c = _valid_cardnews()
        c["slides"][5]["for_bullets"] = ["건성 피부에서 호평", "쿨톤에서 호평"]
        c["slides"][5]["not_for_bullets"] = []
        result = validate_instagram_cardnews_ko(c)
        assert "bullet_count" not in _flag_rules(result)


# ---------------------------------------------------------------------------
# hook subtitle
# ---------------------------------------------------------------------------


class TestHookSubtitle:
    def test_missing_subtitle_blocked(self):
        c = _valid_cardnews()
        c["slides"][0]["subtitle"] = ""
        result = validate_instagram_cardnews_ko(c)
        assert "hook_subtitle_present" in _flag_rules(result)

    def test_hook_has_no_bullet_count_rule(self):
        # Hook deliberately has no bullets — validator should not
        # flag bullet_count on it.
        result = validate_instagram_cardnews_ko(_valid_cardnews())
        for f in result.blocking:
            if f.rule == "bullet_count":
                assert "slide[1]" not in f.location


# ---------------------------------------------------------------------------
# method disclosure
# ---------------------------------------------------------------------------


class TestMethodDisclosure:
    def test_missing_disclosure_blocked(self):
        c = _valid_cardnews()
        c["slides"][6]["disclosure"] = ""
        result = validate_instagram_cardnews_ko(c)
        assert "method_disclosure_present" in _flag_rules(result)

    def test_whitespace_disclosure_blocked(self):
        c = _valid_cardnews()
        c["slides"][6]["disclosure"] = "   "
        result = validate_instagram_cardnews_ko(c)
        assert "method_disclosure_present" in _flag_rules(result)


# ---------------------------------------------------------------------------
# ban lists
# ---------------------------------------------------------------------------


class TestBanListMedical:
    @pytest.mark.parametrize("term", BAN_LIST_MEDICAL_KO)
    def test_blocks_medical_term_in_bullet(self, term: str):
        c = _valid_cardnews()
        c["slides"][1]["bullets"][0] = f"발색 {term} 의견 반복"
        result = validate_instagram_cardnews_ko(c)
        assert "ban_list_medical" in _flag_rules(result)

    def test_blocks_medical_term_in_subtitle(self):
        c = _valid_cardnews()
        c["slides"][0]["subtitle"] = "효과가 있다는 인상"
        result = validate_instagram_cardnews_ko(c)
        assert "ban_list_medical" in _flag_rules(result)


class TestBanListDirective:
    @pytest.mark.parametrize("term", BAN_LIST_DIRECTIVE_KO)
    def test_blocks_directive_term(self, term: str):
        c = _valid_cardnews()
        c["slides"][1]["bullets"][0] = f"{term} 좋다는 의견"
        result = validate_instagram_cardnews_ko(c)
        assert "ban_list_directive" in _flag_rules(result)


class TestBanListSuperlative:
    @pytest.mark.parametrize("term", BAN_LIST_SUPERLATIVE_KO)
    def test_blocks_superlative_term(self, term: str):
        c = _valid_cardnews()
        c["slides"][1]["bullets"][0] = f"{term} 발색의 제품"
        result = validate_instagram_cardnews_ko(c)
        assert "ban_list_superlative" in _flag_rules(result)


class TestBanListCausal:
    @pytest.mark.parametrize("term", BAN_LIST_CAUSAL_KO)
    def test_blocks_causal_term(self, term: str):
        c = _valid_cardnews()
        c["slides"][1]["bullets"][0] = f"{term} 결함 발생"
        result = validate_instagram_cardnews_ko(c)
        assert "ban_list_causal" in _flag_rules(result)


# ---------------------------------------------------------------------------
# multi-flag scenario
# ---------------------------------------------------------------------------


class TestMultiFlag:
    def test_collects_all_blocking_flags_not_just_first(self):
        c = _valid_cardnews()
        c["slides"][1]["title"] = "가" * 100  # over title length
        c["slides"][1]["bullets"][0] = "효과가 있다는 의견 반복"  # medical
        result = validate_instagram_cardnews_ko(c)
        rules = _flag_rules(result)
        assert "title_length" in rules
        assert "ban_list_medical" in rules

    def test_locations_are_specific(self):
        c = _valid_cardnews()
        c["slides"][3]["bullets"][0] = "효과 있는 제품"
        result = validate_instagram_cardnews_ko(c)
        medical = [f for f in result.blocking if f.rule == "ban_list_medical"]
        assert any("slide[4]" in f.location for f in medical)
