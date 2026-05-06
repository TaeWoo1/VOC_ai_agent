"""Tests for the buyer-journey cardnews layout (10-15 slides).

Run-003 reviewer feedback: the existing 7-slide cardnews collapsed
the buyer journey into one card per category. The 10-15 slide layout
expands per-attribute loved/checkpoint slides + adds explicit
fit/consider/checklist/method slides for a downstream design skill
to consume.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.voc.content.cardnews_buyer_journey import (
    DEFAULT_TONE,
    FORMAT,
    MAX_SLIDE_COUNT,
    MIN_SLIDE_COUNT,
    build_buyer_journey_cardnews,
)

REPO = Path(__file__).resolve().parents[2]


def _rich_report() -> dict:
    """Three strengths + three monitoring candidates → max-length
    layout (14 slides per the spec)."""
    return {
        "schema_version": "3.0",
        "product": {
            "slug": "product-deadbeef",
            "name_ko": "Test pad",
            "category": "패드",
            "source_url": "https://example.test",
        },
        "corpus": {
            "n_reviews_total": 2115,
            "n_reviews_analyzed": 2115,
            "primary_sort": "DATETIME_DESC",
            "sampling_strategy": "observable_multi_sort_corpus",
            "corpus_type": "observed_scrape",
            "confidence_level": "high",
            "signal_stability": "high",
            "observation_window": {"start": None, "end": None},
        },
        "attributes": [
            {"key": "finish_texture", "label_ko": "촉촉함/마무리감",
             "n_positive": 356, "n_negative": 33, "n_mixed": 0,
             "evidence_score": 6.0,
             "polarity_share": {"positive": 0.91, "negative": 0.09, "mixed": 0.0},
             "tier": None, "top_quotes": []},
            {"key": "value_price", "label_ko": "대용량/가성비",
             "n_positive": 331, "n_negative": 19, "n_mixed": 0,
             "evidence_score": 6.0,
             "polarity_share": {"positive": 0.94, "negative": 0.06, "mixed": 0.0},
             "tier": None, "top_quotes": []},
            {"key": "dryness_skin_texture", "label_ko": "건조감/당김",
             "n_positive": 143, "n_negative": 37, "n_mixed": 0,
             "evidence_score": 5.0,
             "polarity_share": {"positive": 0.79, "negative": 0.21, "mixed": 0.0},
             "tier": None, "top_quotes": []},
            {"key": "adhesion_base_interaction", "label_ko": "패드 밀착력",
             "n_positive": 97, "n_negative": 25, "n_mixed": 0,
             "evidence_score": 4.0,
             "polarity_share": {"positive": 0.80, "negative": 0.20, "mixed": 0.0},
             "tier": None, "top_quotes": []},
        ],
        "strengths": [
            {"attribute_key": "finish_texture", "supporting_count": 356,
             "theme_keywords_ko": [],
             "representative_quote": {
                 "text": "재구매 할 정도로 좋아요. 정말 만족합니다.",
                 "display_text": "재구매 할 정도로 좋아요. 정말 만족합니다.",
                 "review_id": "r_strong_1", "polarity": "positive",
             }},
            {"attribute_key": "value_price", "supporting_count": 331,
             "theme_keywords_ko": [],
             "representative_quote": {
                 "text": "가성비가 정말 좋아요",
                 "display_text": "가성비가 정말 좋아요",
                 "review_id": "r_strong_2", "polarity": "positive",
             }},
            {"attribute_key": "adhesion_base_interaction",
             "supporting_count": 97,
             "theme_keywords_ko": [],
             "representative_quote": {
                 "text": "잘 밀착되고 좋아요",
                 "display_text": "잘 밀착되고 좋아요",
                 "review_id": "r_strong_3", "polarity": "positive",
             }},
        ],
        "monitoring_candidates": [
            {"attribute_key": "dryness_skin_texture",
             "concern_label_ko": "건조감/당김",
             "n_negative": 37,
             "top_negative_quotes": [
                 {"text": "건조하다는 의견이 있어요",
                  "display_text": "건조하다는 의견이 있어요",
                  "review_id": "r_neg_1", "polarity": "negative_weak"},
             ]},
            {"attribute_key": "finish_texture",
             "concern_label_ko": "촉촉함/마무리감",
             "n_negative": 33,
             "top_negative_quotes": [
                 {"text": "끈적임이 살짝 남아요",
                  "display_text": "끈적임이 살짝 남아요",
                  "review_id": "r_neg_2", "polarity": "negative_weak"},
             ]},
            {"attribute_key": "adhesion_base_interaction",
             "concern_label_ko": "패드 밀착력",
             "n_negative": 25,
             "top_negative_quotes": []},
        ],
        "tradeoffs": [],
        "usage_patterns": [
            {"kind": "contradiction", "sentence_ko":
                "<b>촉촉함/마무리감</b>은 만족 후기 356건이 누적되는 강점이지만, "
                "같은 축에 다른 결 의견 33건이 함께 보입니다.",
             "evidence_count": 389, "n_positive": 356, "n_negative": 33,
             "attribute_key": "finish_texture"},
        ],
        "buyer_segments": [],
        "quick_decision": {
            "verdict_ko":
                "촉촉함/마무리감 만족 후기 356건이 보이지만, "
                "건조감/당김 불만 후기도 37건 함께 누적됩니다.",
            "who_for_ko": [
                "촉촉함/마무리감 강점이 매력적인 사용자 (만족 356건)",
                "대용량/가성비를 우선 가치로 두는 사용자 (만족 331건)",
                "건조감/당김 중심으로 제품을 고르는 사용자 (관련 호평 143건)",
            ],
            "who_not_for_ko": [
                "건조감/당김에 민감하신 분은 한 번 더 검토하세요 (불만 후기 37건)",
            ],
            "watch_outs_ko": ["건조감/당김"],
            "confidence_level": "strong",
        },
        "methodology_notes": {
            "disclosure_ko": "리뷰 데이터 정리 자료입니다.",
            "sample_caveats_ko": [],
            "sampling_strategy": "observable_multi_sort_corpus",
        },
        "polarity_audit": {
            "n_total_quotes": 63,
            "n_total_suspect": 1,
            "n_total_suspect_share": 0.0159,
            "by_attribute": {},
            "samples": [],
        },
    }


# ---------------------------------------------------------------------------
# Slide-count contract
# ---------------------------------------------------------------------------


def test_buyer_journey_layout_supports_10_to_15_slides():
    """Locked: rich corpus produces between MIN_SLIDE_COUNT and
    MAX_SLIDE_COUNT slides per the run-003 spec."""
    cn = build_buyer_journey_cardnews(_rich_report())
    assert MIN_SLIDE_COUNT <= cn["slide_count"] <= MAX_SLIDE_COUNT
    assert len(cn["slides"]) == cn["slide_count"]


def test_buyer_journey_layout_uses_buyer_journey_format_string():
    cn = build_buyer_journey_cardnews(_rich_report())
    assert cn["format"] == FORMAT
    assert cn["format"] == "cardnews_buyer_journey"


def test_buyer_journey_indices_are_contiguous_and_one_indexed():
    cn = build_buyer_journey_cardnews(_rich_report())
    for i, slide in enumerate(cn["slides"], start=1):
        assert slide["index"] == i


# ---------------------------------------------------------------------------
# Slide-type narrative
# ---------------------------------------------------------------------------


def test_buyer_journey_first_slide_is_ask_then_scope():
    """Buyer journey opens with the ask hook and then states scope."""
    cn = build_buyer_journey_cardnews(_rich_report())
    assert cn["slides"][0]["type"] == "ask"
    assert cn["slides"][1]["type"] == "scope"
    # Scope slide must include the analyzed-review count.
    assert "2,115" in cn["slides"][1]["title"]


def test_buyer_journey_includes_loved_point_per_strength():
    """Loved-point slides expand 1 per strength up to the cap (3)."""
    cn = build_buyer_journey_cardnews(_rich_report())
    loved_slides = [s for s in cn["slides"] if s["type"] == "loved_point"]
    assert len(loved_slides) == 3
    titles = [s["title"] for s in loved_slides]
    # Each strength label appears as its own slide title.
    assert any("촉촉함/마무리감" in t for t in titles)
    assert any("대용량/가성비" in t for t in titles)


def test_buyer_journey_includes_checkpoint_per_monitoring_candidate():
    cn = build_buyer_journey_cardnews(_rich_report())
    checkpoint_slides = [s for s in cn["slides"] if s["type"] == "checkpoint"]
    # 3 monitoring candidates → 3 checkpoint slides (cap).
    assert len(checkpoint_slides) == 3
    types_in_order = [s["type"] for s in cn["slides"]]
    # Divides slide must come BEFORE the first checkpoint.
    assert types_in_order.index("divides") < types_in_order.index("checkpoint")


def test_buyer_journey_closes_with_checklist_then_method():
    cn = build_buyer_journey_cardnews(_rich_report())
    assert cn["slides"][-2]["type"] == "checklist"
    assert cn["slides"][-1]["type"] == "method"


def test_buyer_journey_includes_fit_and_consider_slides():
    cn = build_buyer_journey_cardnews(_rich_report())
    types = [s["type"] for s in cn["slides"]]
    assert "fit" in types
    assert "consider" in types
    # Fit must come BEFORE consider (positive framing first).
    assert types.index("fit") < types.index("consider")


# ---------------------------------------------------------------------------
# Confidence axes integration + headline caveat
# ---------------------------------------------------------------------------


def test_buyer_journey_method_slide_surfaces_rating_asc_caveat():
    """When RATING_ASC failed, the method slide must mention the
    under-observation caveat. This is the operator-facing reason the
    cardnews is not a directional verdict."""
    cn = build_buyer_journey_cardnews(
        _rich_report(),
        sorts_attempted=[
            "DATETIME_DESC", "RATING_ASC", "RATING_DESC",
            "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
        ],
        sorts_succeeded=["DATETIME_DESC", "RATING_DESC", "USEFUL_SCORE_DESC"],
        sorts_failed=["RATING_ASC", "RECOMMENDED_DESC"],
        partial_success=True,
    )
    assert cn["confidence_axes"]["negative_signal_coverage"]["level"] == "degraded"
    method_slide = next(s for s in cn["slides"] if s["type"] == "method")
    method_text = " ".join(method_slide["body_lines"])
    assert "RATING_ASC" in method_text
    # Run-003 QA pass-4: caveat phrasing rewritten to seller-friendly
    # Korean — "과소 관측" replaced with "실제보다 적게 반영".
    assert "적게 반영" in method_text


def test_buyer_journey_tone_block_locks_buyer_friendly_voice():
    cn = build_buyer_journey_cardnews(_rich_report())
    tone = cn["tone"]
    assert tone == DEFAULT_TONE
    assert "효능 보장 표현" in tone["avoid"]
    assert "결함 확정 표현" in tone["avoid"]
    assert "리뷰 기반" in tone["encourage"]


# ---------------------------------------------------------------------------
# Reader-friendly wording lock — no internal jargon in any slide
# ---------------------------------------------------------------------------


def test_buyer_journey_slides_avoid_internal_jargon():
    """End-to-end lock: no slide title or body contains the
    internal-feeling tokens the run-003 spec called out."""
    cn = build_buyer_journey_cardnews(_rich_report())
    forbidden = (
        "관찰 신호", "모니터링 후보", "신뢰도 낮음", "신뢰도 높음",
        "안정성 높음", "안정성 낮음", "부정 신호", "긍정 신호",
        "모니터링 후보 신호",
    )
    for slide in cn["slides"]:
        title = slide.get("title") or ""
        body = " ".join(slide.get("body_lines") or [])
        combined = f"{title}\n{body}"
        for term in forbidden:
            assert term not in combined, (
                f"slide #{slide.get('index')} ({slide.get('type')}) "
                f"leaked internal jargon {term!r}: {combined!r}"
            )


# ---------------------------------------------------------------------------
# Real run-003 fixture
# ---------------------------------------------------------------------------


def test_buyer_journey_against_real_run003_fixture_if_present():
    fixture_path = (
        REPO / "outputs" / "2026-05-02_product-83743e299623_run-003"
        / "shared" / "_pre_retry_snapshot" / "20260502T122159Z"
        / "analysis_report.json"
    )
    if not fixture_path.is_file():
        pytest.skip(f"run-003 fixture not present at {fixture_path}")
    report = json.loads(fixture_path.read_text(encoding="utf-8"))
    cn = build_buyer_journey_cardnews(
        report,
        sorts_attempted=[
            "DATETIME_DESC", "RATING_ASC", "RATING_DESC",
            "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
        ],
        sorts_succeeded=["DATETIME_DESC", "RATING_DESC", "USEFUL_SCORE_DESC"],
        sorts_failed=["RATING_ASC", "RECOMMENDED_DESC"],
        partial_success=True,
    )
    # Real run-003 has 3 strengths + 3+ monitoring candidates → max layout.
    assert MIN_SLIDE_COUNT <= cn["slide_count"] <= MAX_SLIDE_COUNT
    # Confidence axes carry the RATING_ASC degradation flag.
    assert (
        cn["confidence_axes"]["negative_signal_coverage"]["level"] == "degraded"
    )
