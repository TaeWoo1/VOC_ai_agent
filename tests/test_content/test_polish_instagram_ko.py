"""Tests for polish.instagram_ko (Phase D1).

Drives every code path with MockLLMClient — no network, no
ANTHROPIC_API_KEY needed. Validates: happy path, retry on validator
fail, fallback after retry, cache hit/miss, malformed JSON, LLM
exception, style_seed passthrough.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from src.voc.content.angle_selection import SelectedAngle, select_angle
from src.voc.content.editorial_validators import validate_editorial_cardnews_ko
from src.voc.content.llm.cache import PolishCache, compute_cache_key
from src.voc.content.llm.client import MockLLMClient
from src.voc.content.polish.common import SYSTEM_PROMPT_VERSION
from src.voc.content.polish.instagram_ko import (
    polish_instagram_cardnews_ko,
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
        "analysis_report_sha256": "a" * 64,
        "source_brief_sha256": "b" * 64,
        "confidence_level": "strong",
        "slide_count": 7,
        "slides": [
            {"index": 1, "type": "hook", "title": "한 줄 인상",
             "subtitle": "리뷰에서 일관되게 나타나는 인상: 발색 호평이 두드러집니다"},
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
        "channel_angle_recommendations": {
            "instagram": {
                "suggested_angle_ids": ["h2"],
                "tone_directive": "정보 중심 에디토리얼 톤. 차분하게.",
            },
        },
        "evidence_boundaries": {
            "n_reviews_total": 1135,
            "what_we_can_say": ["리뷰에서 반복되는 인상"],
            "what_we_cannot_say": [
                "제품 결함 확정", "효능 보장",
                "특정 피부 트러블 진단", "최고/1위/베스트 단정",
            ],
        },
        "visual_concept": {
            "mood_ko": "차분한 톤",
            "anti_patterns": ["face", "logo", "trademark", "skin_disease_imagery"],
        },
    }


def _analysis_report() -> dict:
    return {
        "attributes": [
            {"key": "pigmentation", "label_ko": "발색"},
            {"key": "persistence", "label_ko": "지속력"},
            {"key": "transfer_resistance", "label_ko": "묻어남"},
            {"key": "application_blending", "label_ko": "발림성"},
        ],
    }


def _selected_h2() -> SelectedAngle:
    return select_angle(
        _brief()["angle_candidates"],
        suggestions=["h2"],
        mode="auto",
    )


def _valid_polished_response() -> dict:
    """A polished_slides payload that passes every Phase D validator
    against the fixtures above."""
    return {
        "polished_slides": [
            {
                "index": 1,
                "type": "hook",
                "title": "한 줄 인상",
                "subtitle": "리뷰 1135건에서 발색이 진하다는 평이 반복됩니다",
                "source_brief_fields": ["core_verdict.ko", "angle_candidates[h2]"],
            },
            {
                "index": 2,
                "type": "loved",
                "title": "반복되는 호평",
                "bullets": [
                    "리뷰 181건에서 발색 호평이 반복됩니다",
                    "지속력 호평 47건이 누적됐습니다",
                ],
                "source_brief_fields": ["angle_candidates[h2]", "best_for[0]"],
            },
            {
                "index": 3,
                "type": "divides",
                "title": "갈리는 의견",
                "bullets": [
                    "발색 호평 181건과 비판 71건이 함께 보입니다",
                    "지속력 호평 47건과 비판 12건이 공존합니다",
                ],
                "source_brief_fields": ["main_tradeoff.ko", "angle_candidates[h2]"],
            },
            {
                "index": 4,
                "type": "fit",
                "title": "잘 맞은 분들",
                "bullets": [
                    "건성 피부 사용자에서 발색 호평 32건",
                    "쿨톤 사용자에서 호평 24건",
                ],
                "source_brief_fields": ["best_for[0]", "best_for[1]", "angle_candidates[h2]"],
            },
            {
                "index": 5,
                "type": "watch_outs",
                "title": "유의 포인트",
                "bullets": [
                    "묻어남 비판 38건이 반복됩니다",
                    "발색 변화 비판 12건이 등장합니다",
                ],
                "source_brief_fields": ["watch_outs[0]", "watch_outs[1]", "angle_candidates[h2]"],
            },
            {
                "index": 6,
                "type": "best_for",
                "title": "구매 전 점검",
                "for_bullets": ["건성 피부에서 발색 호평 32건"],
                "not_for_bullets": ["묻어남이 중요한 사용 상황"],
                "source_brief_fields": ["best_for[0]", "not_for[0]", "angle_candidates[h2]"],
            },
            {
                "index": 7,
                "type": "method",
                "title": "분석 기준",
                "bullets": [
                    "리뷰 1135건 분석 결과입니다",
                    "관찰 기간 2025-04 ~ 2026-04",
                ],
                "disclosure": "공개 리뷰 데이터를 정리한 정보입니다",
                "source_brief_fields": ["evidence_boundaries.n_reviews_total"],
            },
        ]
    }


def _as_llm_response(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False)


# ---------------------------------------------------------------------------
# happy path
# ---------------------------------------------------------------------------


class TestPolishHappyPath:
    def test_returns_ok(self):
        llm = MockLLMClient([_as_llm_response(_valid_polished_response())])
        result = polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm, analysis_report=_analysis_report(),
        )
        assert result.status == "ok"
        assert result.cardnews is not None
        assert not result.fallback_used
        assert result.retry_count == 0
        assert result.llm_call_count == 1

    def test_editorial_passes_validator(self):
        llm = MockLLMClient([_as_llm_response(_valid_polished_response())])
        result = polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm, analysis_report=_analysis_report(),
        )
        v = validate_editorial_cardnews_ko(
            result.cardnews, _skeleton(), _brief(),
            _selected_h2().angle, analysis_report=_analysis_report(),
        )
        assert v.ok, v.blocking

    def test_polish_log_populated(self):
        llm = MockLLMClient([_as_llm_response(_valid_polished_response())])
        result = polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm, analysis_report=_analysis_report(),
        )
        log = result.cardnews["polish_log"]
        assert log["model"] == "mock-model"
        assert log["polish_mode"] == "full"
        assert log["fallback_used"] is False
        assert log["retry_count"] == 0
        assert log["cache"]["hit"] is False
        assert len(log["validator_history"]) == 1
        assert log["validator_history"][0]["ok"] is True

    def test_per_slide_skeleton_diff_present(self):
        llm = MockLLMClient([_as_llm_response(_valid_polished_response())])
        result = polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm, analysis_report=_analysis_report(),
        )
        for slide in result.cardnews["slides"]:
            assert "skeleton" in slide
            assert "preserved_numerics" in slide

    def test_selected_angle_recorded(self):
        llm = MockLLMClient([_as_llm_response(_valid_polished_response())])
        result = polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm, analysis_report=_analysis_report(),
        )
        assert result.cardnews["selected_angle"]["angle_id"] == "h2"
        assert result.cardnews["selected_angle"]["selection_mode"] == "auto"


# ---------------------------------------------------------------------------
# retry on validator failure
# ---------------------------------------------------------------------------


class TestRetryAndFallback:
    def test_retries_then_succeeds(self):
        bad = copy.deepcopy(_valid_polished_response())
        # Drop a number on slide 2 — fires numeric_preservation
        bad["polished_slides"][1]["bullets"] = [
            "발색 호평이 반복됩니다",  # 181 missing
            "지속력 호평 47건이 누적됐습니다",
        ]
        llm = MockLLMClient([
            _as_llm_response(bad),
            _as_llm_response(_valid_polished_response()),
        ])
        result = polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm, analysis_report=_analysis_report(),
        )
        assert result.status == "ok"
        assert result.retry_count == 1
        assert result.llm_call_count == 2
        # validator_history records both attempts
        log = result.cardnews["polish_log"]
        assert len(log["validator_history"]) == 2
        assert log["validator_history"][0]["ok"] is False
        assert "numeric_preservation" in log["validator_history"][0]["blocking_rules"]
        assert log["validator_history"][1]["ok"] is True

    def test_falls_back_after_retry_exhausted(self):
        bad = copy.deepcopy(_valid_polished_response())
        bad["polished_slides"][1]["bullets"] = [
            "발색 호평이 반복됩니다",
            "지속력 호평이 누적됐습니다",
        ]
        llm = MockLLMClient([
            _as_llm_response(bad),
            _as_llm_response(bad),  # retry also fails
        ])
        result = polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm, analysis_report=_analysis_report(),
        )
        assert result.status == "failed"
        assert result.fallback_used is True
        assert result.llm_call_count == 2
        assert "validation failed" in result.notes

    def test_strict_retry_prompt_includes_failure(self):
        """The retry prompt must quote the rule that failed.
        We inspect the second call's `system` arg."""
        bad = copy.deepcopy(_valid_polished_response())
        bad["polished_slides"][2]["bullets"] = ["갈리는 의견"]  # under bullet_count
        llm = MockLLMClient([
            _as_llm_response(bad),
            _as_llm_response(_valid_polished_response()),
        ])
        polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm, analysis_report=_analysis_report(),
        )
        retry_system = llm.calls[1]["system"]
        assert "이전 출력 거부됨" in retry_system
        assert "bullet_count" in retry_system or "slide_structure_preservation" in retry_system


# ---------------------------------------------------------------------------
# malformed / exceptional outputs
# ---------------------------------------------------------------------------


class TestMalformedOutputs:
    def test_malformed_json_falls_back(self):
        llm = MockLLMClient([
            "this is not json at all",
            "still not json",
        ])
        result = polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm, analysis_report=_analysis_report(),
        )
        assert result.status == "failed"
        assert result.fallback_used is True
        assert "malformed JSON" in result.notes

    def test_llm_exception_falls_back(self):
        llm = MockLLMClient([RuntimeError("upstream timeout")])
        result = polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm, analysis_report=_analysis_report(),
        )
        assert result.status == "failed"
        assert result.fallback_used is True
        assert "RuntimeError" in result.notes

    def test_strips_code_fence_wrappers(self):
        wrapped = "```json\n" + _as_llm_response(_valid_polished_response()) + "\n```"
        llm = MockLLMClient([wrapped])
        result = polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm, analysis_report=_analysis_report(),
        )
        assert result.status == "ok"


# ---------------------------------------------------------------------------
# cache
# ---------------------------------------------------------------------------


class TestCacheBehavior:
    def test_first_call_misses_cache_writes_on_success(self, tmp_path: Path):
        cache = PolishCache(tmp_path)
        llm = MockLLMClient([_as_llm_response(_valid_polished_response())])
        polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm, cache=cache,
            analysis_report=_analysis_report(),
        )
        # Compute expected key independently and verify the file
        # exists under the cache.
        key = compute_cache_key(
            skeleton_sha256=__import__(
                "src.voc.content.polish.common", fromlist=["compute_skeleton_sha256"]
            ).compute_skeleton_sha256(_skeleton()),
            brief_sha256=__import__(
                "src.voc.content.polish.common", fromlist=["compute_brief_sha256"]
            ).compute_brief_sha256(_brief()),
            selected_angle_id="h2",
            model="mock-model",
            temperature=0.0,
            system_prompt_version=SYSTEM_PROMPT_VERSION,
            polish_mode="full",
            style_seed=None,
        )
        assert cache.has(key)

    def test_second_call_hits_cache_no_llm_call(self, tmp_path: Path):
        cache = PolishCache(tmp_path)
        llm1 = MockLLMClient([_as_llm_response(_valid_polished_response())])
        polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm1, cache=cache,
            analysis_report=_analysis_report(),
        )
        # Second client has no responses queued; if the LLM gets
        # called the test will RuntimeError-out.
        llm2 = MockLLMClient([])
        result = polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm2, cache=cache,
            analysis_report=_analysis_report(),
        )
        assert result.status == "ok"
        assert result.cache_hit is True
        assert result.llm_call_count == 0

    def test_failed_output_not_cached(self, tmp_path: Path):
        cache = PolishCache(tmp_path)
        bad = copy.deepcopy(_valid_polished_response())
        bad["polished_slides"][1]["bullets"] = ["발색 호평", "지속력 호평"]  # numbers gone
        llm = MockLLMClient([_as_llm_response(bad), _as_llm_response(bad)])
        polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm, cache=cache,
            analysis_report=_analysis_report(),
        )
        # Cache should be empty (nothing persisted).
        assert list(tmp_path.rglob("*.json")) == []


# ---------------------------------------------------------------------------
# style_seed
# ---------------------------------------------------------------------------


class TestStyleSeed:
    def test_seed_in_user_prompt(self):
        llm = MockLLMClient([_as_llm_response(_valid_polished_response())])
        polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm, style_seed=42,
            analysis_report=_analysis_report(),
        )
        user_prompt = llm.calls[0]["user"]
        assert "[style_seed]" in user_prompt
        assert "42" in user_prompt

    def test_no_seed_omits_block(self):
        llm = MockLLMClient([_as_llm_response(_valid_polished_response())])
        polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm,
            analysis_report=_analysis_report(),
        )
        user_prompt = llm.calls[0]["user"]
        assert "[style_seed]" not in user_prompt

    def test_different_seeds_different_cache_keys(self, tmp_path: Path):
        cache = PolishCache(tmp_path)
        llm_a = MockLLMClient([_as_llm_response(_valid_polished_response())])
        result_a = polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm_a, cache=cache, style_seed=1,
            analysis_report=_analysis_report(),
        )
        llm_b = MockLLMClient([_as_llm_response(_valid_polished_response())])
        result_b = polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm_b, cache=cache, style_seed=2,
            analysis_report=_analysis_report(),
        )
        assert result_a.cache_key != result_b.cache_key
        # Both LLMs were called (different keys → different cache entries)
        assert llm_a.call_count == 1
        assert llm_b.call_count == 1

    def test_same_seed_caches_consistently(self, tmp_path: Path):
        cache = PolishCache(tmp_path)
        llm = MockLLMClient([_as_llm_response(_valid_polished_response())])
        polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm, cache=cache, style_seed=7,
            analysis_report=_analysis_report(),
        )
        llm2 = MockLLMClient([])  # would fail if called
        result = polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm2, cache=cache, style_seed=7,
            analysis_report=_analysis_report(),
        )
        assert result.cache_hit is True


# ---------------------------------------------------------------------------
# polish modes
# ---------------------------------------------------------------------------


class TestPolishModes:
    def test_full_mode_polishes_all_slides(self):
        llm = MockLLMClient([_as_llm_response(_valid_polished_response())])
        result = polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm, polish_mode="full",
            analysis_report=_analysis_report(),
        )
        # Slide 2 bullets should reflect LLM rewrite (not skeleton verbatim)
        assert result.cardnews["slides"][1]["bullets"][0] != _skeleton()["slides"][1]["bullets"][0]

    def test_hook_only_keeps_other_slides_verbatim(self):
        # Build an LLM response where slides 2-7 differ from skeleton.
        # In hook_only mode, the assembler should still ship skeleton
        # text on slides 2-7.
        polished = _valid_polished_response()
        llm = MockLLMClient([_as_llm_response(polished)])
        result = polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm, polish_mode="hook_only",
            analysis_report=_analysis_report(),
        )
        skel = _skeleton()
        # Hook subtitle changed
        assert result.cardnews["slides"][0]["subtitle"] != skel["slides"][0]["subtitle"]
        # All other slides byte-equal skeleton on the polished fields
        for i in range(1, 7):
            stype = skel["slides"][i]["type"]
            if stype == "best_for":
                assert result.cardnews["slides"][i]["for_bullets"] == skel["slides"][i]["for_bullets"]
                assert result.cardnews["slides"][i]["not_for_bullets"] == skel["slides"][i]["not_for_bullets"]
            elif stype == "method":
                assert result.cardnews["slides"][i]["bullets"] == skel["slides"][i]["bullets"]
                assert result.cardnews["slides"][i]["disclosure"] == skel["slides"][i]["disclosure"]
            else:
                assert result.cardnews["slides"][i]["bullets"] == skel["slides"][i]["bullets"]

    def test_invalid_mode_raises(self):
        llm = MockLLMClient([])
        with pytest.raises(ValueError, match="unknown polish_mode"):
            polish_instagram_cardnews_ko(
                _skeleton(), _brief(), _selected_h2(),
                llm_client=llm, polish_mode="random_mode",  # type: ignore[arg-type]
            )


# ---------------------------------------------------------------------------
# structural assembly
# ---------------------------------------------------------------------------


class TestAssemblyPreservesStructure:
    def test_ignores_llm_index_or_type_drift(self):
        """LLM tries to swap slide 2 to type=method; assembler
        forces skeleton index/type. Validator may flag, but the
        assembled doc still has the correct skeleton-derived
        structural fields."""
        polished = _valid_polished_response()
        polished["polished_slides"][1]["index"] = 99
        polished["polished_slides"][1]["type"] = "method"
        llm = MockLLMClient([
            _as_llm_response(polished),
            _as_llm_response(_valid_polished_response()),
        ])
        result = polish_instagram_cardnews_ko(
            _skeleton(), _brief(), _selected_h2(),
            llm_client=llm, analysis_report=_analysis_report(),
        )
        # Final assembled cardnews has correct skeleton-derived index/type
        assert result.cardnews["slides"][1]["index"] == 2
        assert result.cardnews["slides"][1]["type"] == "loved"
