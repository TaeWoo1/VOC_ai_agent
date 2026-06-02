"""Cardnews safety validator tests (v2.0).

Validates the contract laid out in `feedback_consumer_safety_contract`:
- Every banned framing is rejected (including v2.0's `갈리는 제품 추천`).
- Audit IDs never bleed into public fields.
- Missing/invalid `language` field rejects.
- The validator is fail-closed: any single violation aborts.
"""
from __future__ import annotations

import json

import pytest

from cardnews.safety_validator import (
    BANNED_FRAMINGS_KO,
    CardnewsSafetyError,
    PLANNER_ATTACK_BANNED_KO,
    PLANNER_EXPOSE_BANNED_KO,
    PLANNER_MEDICAL_BANNED_KO,
    validate_cardnews_safety,
    validate_content_plan_safety,
)


def _ok_layout() -> dict:
    """Minimal v2.0 layout dict that should pass the validator clean."""
    return {
        "schema_version": "2.0",
        "language": "ko",
        "channel": "instagram",
        "format": "cardnews_long",
        "product": {"name_ko": "테스트 제품"},
        "product_image": {
            "source": "fallback_gradient",
            "url": None,
            "local_path": None,
            "usage": "cover_full_bleed",
        },
        "page_count": 2,
        "pages": [
            {
                "index": 1,
                "type": "cover",
                "language": "ko",
                "title": "테스트 제품",
                "headline": "테스트 제품 호평이 분명한데, 갈린 결도 있어요",
                "subtitle": "리뷰 100건 정리",
                "chip": "리뷰 저널 · 2026-05",
                "chip_strip": ["리뷰"],
                "corpus_footer": "리뷰 100건 분석 · 보통 신뢰",
                "audit": {},
            },
            {
                "index": 2,
                "type": "checkpoint",
                "language": "ko",
                "attribute_key": "pigmentation",
                "chip": "구매 전 체크포인트",
                "number": "01",
                "label": "발색",
                "count": "호불호 12건",
                "tip": "옵션별 후기 먼저 확인",
                "why_note": "단일 평균보다 후기 분포로 봐야 정확",
                "who_note": "옵션별 후기를 비교하는 분",
                "audit": {
                    "evidence_span_raw": "발색이 사진과 다르다",
                    "evidence_review_id_truncated": "abc123def456",
                    "evidence_polarity": "negative_strong",
                },
            },
        ],
    }


def test_clean_layout_passes() -> None:
    validate_cardnews_safety(_ok_layout())


@pytest.mark.parametrize("banned", BANNED_FRAMINGS_KO)
def test_each_banned_framing_is_caught_in_subtitle(banned: str) -> None:
    layout = _ok_layout()
    layout["pages"][0]["subtitle"] = f"테스트 {banned} 카피"
    with pytest.raises(CardnewsSafetyError) as e:
        validate_cardnews_safety(layout)
    msgs = [str(v) for v in e.value.violations]
    assert any(banned in m and "subtitle" in m for m in msgs), (
        f"safety error didn't pinpoint {banned!r} in subtitle: {msgs!r}"
    )


def test_banned_framing_in_takeaways_caught() -> None:
    """v2.0 — summary takeaways list of strings is walked + scanned."""
    layout = _ok_layout()
    layout["pages"].append({
        "index": 3, "type": "summary", "language": "ko",
        "chip": "한 장 정리", "title": "한 장 정리",
        "headline": "정리",
        "takeaways": [
            "정상 takeaway",
            "이건 진짜 실체 폭로입니다",  # banned: 진짜 실체
        ],
        "closing_note": "구매 전 한 가지 기준으로 좁혀 보세요",
        "audit": {},
    })
    layout["page_count"] = 3
    with pytest.raises(CardnewsSafetyError) as e:
        validate_cardnews_safety(layout)
    msgs = [str(v) for v in e.value.violations]
    assert any("진짜 실체" in m and "takeaways" in m for m in msgs), msgs


def test_banned_framing_in_axes_caught() -> None:
    """v2.0 — why_divides axes list of strings is walked + scanned."""
    layout = _ok_layout()
    layout["pages"].append({
        "index": 3, "type": "why_divides", "language": "ko",
        "chip": "왜 갈렸을까", "title": "왜 갈렸을까",
        "headline": "왜 갈렸을까",
        "axes": [
            "사용 환경에 따라 갈려요",
            "팩트 폭로에 따라 갈려요",  # banned: 팩트 폭로
        ],
        "note": "단일 평균보다 후기 분포로 보는 게 정확",
        "audit": {},
    })
    layout["page_count"] = 3
    with pytest.raises(CardnewsSafetyError) as e:
        validate_cardnews_safety(layout)
    msgs = [str(v) for v in e.value.violations]
    assert any("팩트 폭로" in m and "axes" in m for m in msgs), msgs


def test_review_id_in_public_field_caught() -> None:
    layout = _ok_layout()
    layout["pages"][1]["tip"] = "후기 abc123def456 참고"
    with pytest.raises(CardnewsSafetyError) as e:
        validate_cardnews_safety(layout)
    msgs = [str(v) for v in e.value.violations]
    assert any("review_id_leak" in m for m in msgs), msgs


def test_missing_language_root_caught() -> None:
    layout = _ok_layout()
    del layout["language"]
    with pytest.raises(CardnewsSafetyError) as e:
        validate_cardnews_safety(layout)
    msgs = [str(v) for v in e.value.violations]
    assert any("language" in m for m in msgs), msgs


def test_invalid_language_caught() -> None:
    layout = _ok_layout()
    layout["language"] = "fr"
    with pytest.raises(CardnewsSafetyError):
        validate_cardnews_safety(layout)


def test_missing_per_page_language_caught() -> None:
    layout = _ok_layout()
    del layout["pages"][1]["language"]
    with pytest.raises(CardnewsSafetyError) as e:
        validate_cardnews_safety(layout)
    msgs = [str(v) for v in e.value.violations]
    assert any("language" in m for m in msgs), msgs


def test_audit_field_text_not_scanned_for_banned_framing() -> None:
    """Banned framings appearing only inside `audit.*` must NOT trip
    the validator — verbatim review text often legitimately contains
    banned-tone words."""
    layout = _ok_layout()
    layout["pages"][1]["audit"]["evidence_span_raw"] = (
        "이 제품 진짜 최악이에요 부작용도 있어요"
    )
    validate_cardnews_safety(layout)


def test_extra_banned_extends_default_list() -> None:
    layout = _ok_layout()
    layout["pages"][0]["subtitle"] = "특정 브랜드명 X 노출"
    validate_cardnews_safety(layout)
    with pytest.raises(CardnewsSafetyError):
        validate_cardnews_safety(layout, extra_banned=["특정 브랜드명 X"])


# ---------------------------------------------------------------------------
# Planner-stage validator (validate_content_plan_safety)
# ---------------------------------------------------------------------------


def _ok_plan() -> dict:
    """Minimal v2.0 content_plan dict that should pass the planner-stage
    validator clean. Mirrors ContentPlan v2.0 but kept hand-rolled here
    so the test doesn't depend on Pydantic introspection."""
    return {
        "schema_version": "2.0",
        "language": "ko",
        "cover": {
            "headline": "리뷰 신호가 한 곳에서 갈리는 지점",
            "subline": "테스트 제품 · 리뷰 100건",
            "chips": ["리뷰"],
            "corpus_footer": "리뷰 100건 분석 · 보통 신뢰",
        },
        "one_liner": {
            "headline": "표본에서 반복된 두 신호",
            "sub": "분석 리뷰 100건",
        },
        "loved": {
            "headline": "가장 자주 칭찬받은 부분",
            "items": [{"label": "a", "count": "만족 30건", "note": "반복"}],
        },
        "divides": {
            "headline": "갈리는 의견",
            "items": [{"label": "a", "satisfied": 30, "split": 5,
                       "note": "사용 환경에 따라"}],
        },
        "why_divides": {
            "attribute_key": "a",
            "headline": "a, 왜 갈렸을까",
            "axes": ["사용 환경에 따라 체감이 달라요"],
            "note": "단일 평균보다 후기 분포로 봐야 정확",
        },
        "signature": {
            "attribute_key": "a",
            "title": "a",
            "headline": "a 후기 따라 다르게 읽혔어요",
            "lead": "a 관련 호평과 갈림이 함께 쌓여 있어요.",
            "why_it_matters": "이 제품의 결정적 항목을 사용 환경 기준으로 보는 단계",
            "who_should_check": "a 관련 후기를 추가로 살펴보고 싶은 분",
        },
        "checkpoints": {
            "slides": [
                {"label": "a", "count": "호불호 5건",
                 "tip": "후기 먼저 확인", "why_note": "환경 영향",
                 "who_note": "본인 환경을 비교하는 분"},
            ],
        },
        "fit": {
            "headline": "잘 맞는 분",
            "items": [
                {"label": "a 강점이 매력적인 분", "note": "30건"},
                {"label": "다른 후기와 비교해 결정하는 분", "note": "추가 확인"},
            ],
        },
        "consider": {
            "headline": "신중하게 볼 분",
            "items": [
                {"label": "a 민감하게 보는 분", "note": "5건"},
                {"label": "옵션 차이가 큰 사용 환경의 분", "note": "환경 비교"},
            ],
        },
        "summary": {
            "headline": "한 장 정리",
            "takeaways": [
                "a 강점이 반복적으로 언급됐어요",
                "a 사용 환경에 따라 의견이 갈렸어요",
            ],
            "closing_note": "구매 전 본인 환경 한 가지로 좁혀 보세요",
        },
        "cta": {
            "type": "comment_next_product",
            "headline": "다음에 보고 싶은 제품을 댓글로",
            "body": "함께 알려주시면 같은 방식으로 정리합니다",
            "disclosure": "리뷰 신호이며 결함을 단정하지 않습니다",
        },
    }


def test_clean_plan_passes_planner_validator() -> None:
    validate_content_plan_safety(_ok_plan())


@pytest.mark.parametrize("term", BANNED_FRAMINGS_KO)
def test_planner_validator_catches_banned_framing(term: str) -> None:
    plan = _ok_plan()
    plan["cover"]["headline"] = f"테스트 {term} 카피"
    with pytest.raises(CardnewsSafetyError) as e:
        validate_content_plan_safety(plan)
    msgs = [str(v) for v in e.value.violations]
    assert any(term in m for m in msgs), msgs


@pytest.mark.parametrize("term", PLANNER_MEDICAL_BANNED_KO)
def test_planner_validator_catches_medical_claim(term: str) -> None:
    plan = _ok_plan()
    plan["signature"]["lead"] = f"이 제품은 {term}에 도움된다는 후기가 있어요."
    with pytest.raises(CardnewsSafetyError) as e:
        validate_content_plan_safety(plan)
    rules = {v.rule for v in e.value.violations}
    assert "medical_claim" in rules, rules


@pytest.mark.parametrize("term", PLANNER_ATTACK_BANNED_KO)
def test_planner_validator_catches_brand_attack(term: str) -> None:
    plan = _ok_plan()
    plan["divides"]["items"][0]["note"] = f"브랜드 {term} 의혹"
    with pytest.raises(CardnewsSafetyError) as e:
        validate_content_plan_safety(plan)
    rules = {v.rule for v in e.value.violations}
    assert "brand_attack" in rules, rules


@pytest.mark.parametrize("term", PLANNER_EXPOSE_BANNED_KO)
def test_planner_validator_catches_expose_framing(term: str) -> None:
    plan = _ok_plan()
    plan["cta"]["body"] = f"브랜드가 {term} 진실"
    with pytest.raises(CardnewsSafetyError) as e:
        validate_content_plan_safety(plan)
    rules = {v.rule for v in e.value.violations}
    assert "expose_framing" in rules or "brand_attack" in rules, rules


def test_planner_validator_catches_galineun_jepum_chuchun() -> None:
    """v2.0 — '갈리는 제품 추천' is a banned CTA framing."""
    plan = _ok_plan()
    plan["cta"]["body"] = "호불호 갈리는 제품 추천 받고 싶다면 댓글"
    with pytest.raises(CardnewsSafetyError) as e:
        validate_content_plan_safety(plan)
    rules = {v.rule for v in e.value.violations}
    assert "banned_framing" in rules, rules


def test_planner_validator_walks_nested_strings() -> None:
    """Banned phrase planted deep in a list-of-dicts must still trip."""
    plan = _ok_plan()
    plan["loved"]["items"].append({
        "label": "test", "count": "n", "note": "최악의 후기 패턴",
    })
    with pytest.raises(CardnewsSafetyError):
        validate_content_plan_safety(plan)


def test_planner_validator_walks_takeaways_string_list() -> None:
    """v2.0 — summary.takeaways is list[str]; walker must descend."""
    plan = _ok_plan()
    plan["summary"]["takeaways"].append("이건 광고에 속지 마세요 테스트")
    with pytest.raises(CardnewsSafetyError):
        validate_content_plan_safety(plan)


def test_planner_validator_walks_axes_string_list() -> None:
    """v2.0 — why_divides.axes is list[str]; walker must descend."""
    plan = _ok_plan()
    plan["why_divides"]["axes"].append("최악의 사용 환경에 따라 갈려요")
    with pytest.raises(CardnewsSafetyError):
        validate_content_plan_safety(plan)


def test_planner_validator_missing_language_caught() -> None:
    plan = _ok_plan()
    del plan["language"]
    with pytest.raises(CardnewsSafetyError) as e:
        validate_content_plan_safety(plan)
    rules = {v.rule for v in e.value.violations}
    assert "language_invalid" in rules


def test_planner_validator_invalid_language_caught() -> None:
    plan = _ok_plan()
    plan["language"] = "fr"
    with pytest.raises(CardnewsSafetyError):
        validate_content_plan_safety(plan)


def test_planner_validator_extra_banned_extends_list() -> None:
    plan = _ok_plan()
    plan["cover"]["headline"] = "특수 키워드 노출"
    validate_content_plan_safety(plan)
    with pytest.raises(CardnewsSafetyError):
        validate_content_plan_safety(plan, extra_banned=["특수 키워드"])


# ---------------------------------------------------------------------------
# Multi-violation collection
# ---------------------------------------------------------------------------


def test_violations_collected_not_short_circuited() -> None:
    """If multiple rules fire, the validator should report all of them
    in one shot — the operator shouldn't have to fix-and-rerun."""
    layout = _ok_layout()
    layout["pages"][0]["subtitle"] = "이 제품은 최악이고 부작용도 있어요"
    del layout["pages"][1]["language"]
    with pytest.raises(CardnewsSafetyError) as e:
        validate_cardnews_safety(layout)
    rules = {v.rule for v in e.value.violations}
    assert "banned_framing" in rules
    assert "language_invalid" in rules or any(
        "language" in v.rule for v in e.value.violations
    )
