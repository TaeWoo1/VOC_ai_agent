"""Cardnews safety validator tests.

Validates the contract laid out in `feedback_consumer_safety_contract`:
- Every banned framing is rejected.
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
    """Minimal layout dict that should pass the validator clean."""
    return {
        "schema_version": "1.0",
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
                "subtitle": "리뷰 100건 정리",
                "audit": {},
            },
            {
                "index": 2,
                "type": "caution_attr",
                "language": "ko",
                "attribute_key": "pigmentation",
                "label_ko": "발색",
                "title": "발색",
                "chip": "주의 시그널",
                "ratio_strip": {"satisfied": 30, "split": 12},
                "evidence_phrase_ko": "발색 호불호가 갈린 의견",
                "tip_ko": "옵션별 후기 먼저 확인",
                "audit": {
                    "evidence_span_raw": "발색이 사진과 다르다",
                    "evidence_review_id_truncated": "abc123def456",
                    "evidence_polarity": "negative_strong",
                },
            },
        ],
    }


def test_clean_layout_passes() -> None:
    validate_cardnews_safety(_ok_layout())  # no raise


@pytest.mark.parametrize("banned", BANNED_FRAMINGS_KO)
def test_each_banned_framing_is_caught_in_subtitle(banned: str) -> None:
    layout = _ok_layout()
    layout["pages"][0]["subtitle"] = f"테스트 {banned} 카피"
    with pytest.raises(CardnewsSafetyError) as e:
        validate_cardnews_safety(layout)
    # Confirm the violation pinpoints the banned token + the field.
    msgs = [str(v) for v in e.value.violations]
    assert any(banned in m and "subtitle" in m for m in msgs), (
        f"safety error didn't pinpoint {banned!r} in subtitle: {msgs!r}"
    )


def test_banned_framing_in_bullet_caught() -> None:
    layout = _ok_layout()
    layout["pages"].append({
        "index": 3, "type": "loved", "language": "ko",
        "title": "반복되는 호평", "chip": "[반복되는 호평]",
        "bullets": ["정상 불릿", "이건 진짜 실체에 대한 폭로입니다"],
        "audit": {},
    })
    layout["page_count"] = 3
    with pytest.raises(CardnewsSafetyError) as e:
        validate_cardnews_safety(layout)
    msgs = [str(v) for v in e.value.violations]
    assert any("진짜 실체" in m and "bullets[1]" in m for m in msgs), msgs


def test_review_id_in_public_field_caught() -> None:
    layout = _ok_layout()
    # Plant the audit ID in a public bullet — should trip the leak rule.
    layout["pages"][1]["evidence_phrase_ko"] = "후기 abc123def456 참고"
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
    """Banned framings appearing only inside `audit.*` must NOT trip the
    validator — audit fields are excluded from public scanning. Verbatim
    review text often legitimately contains words like '독한'/'최악'."""
    layout = _ok_layout()
    # User's banned framing planted ONLY inside audit field
    layout["pages"][1]["audit"]["evidence_span_raw"] = (
        "이 제품 진짜 최악이에요 부작용도 있어요"
    )
    # Should still pass since audit fields don't render publicly
    validate_cardnews_safety(layout)


def test_extra_banned_extends_default_list() -> None:
    layout = _ok_layout()
    layout["pages"][0]["subtitle"] = "특정 브랜드명 X 노출"
    # Default list does NOT ban "특정 브랜드명 X" — should pass
    validate_cardnews_safety(layout)
    # With caller-supplied extension, should fail
    with pytest.raises(CardnewsSafetyError):
        validate_cardnews_safety(layout, extra_banned=["특정 브랜드명 X"])


# ---------------------------------------------------------------------------
# Planner-stage validator (validate_content_plan_safety)
# ---------------------------------------------------------------------------


def _ok_plan() -> dict:
    """Minimal content_plan dict that should pass the planner-stage
    validator clean. Mirrors the ContentPlan schema in content_plan.py
    but kept hand-rolled here so the test doesn't depend on the
    Pydantic model's introspection."""
    return {
        "schema_version": "1.0",
        "language": "ko",
        "cover": {
            "headline": "리뷰 신호가 한 곳에서 갈리는 지점",
            "subline": "테스트 제품 · 리뷰 100건",
            "chips": ["리뷰"],
        },
        "hook": {
            "headline": "표본에서 반복된 두 신호",
            "metrics": [{"label": "분석 리뷰", "value": "100"}],
            "bullets": ["a 강점 — 호평 30건"],
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
        "signature": {
            "attribute_key": "a",
            "title": "a",
            "headline": "a 후기 따라 다르게 읽혔어요",
            "lead": "a 관련 호평과 갈림이 함께 쌓여 있어요.",
            "why_it_matters": "이 제품의 결정적 항목",
            "who_should_check": "a 관련 후기 추가 검색",
        },
        "checkpoints": {
            "headline": "구매 전 체크포인트",
            "items": [{"label": "a", "count": "호불호 5건",
                       "tip": "후기 먼저 확인", "why_note": "환경 영향",
                       "who_note": "본인 환경 비교"}],
        },
        "audience": {
            "fit_items": [{"label": "a 강점이 매력적인 분", "note": "30건"}],
            "consider_items": [{"label": "a 민감한 분", "note": "5건"}],
        },
        "method": {
            "items": [{"label": "분석 리뷰", "value": "100건"}],
            "note": "리뷰 신호이며 결함을 단정하지 않습니다",
        },
        "cta": {
            "type": "comment_next_product",
            "headline": "다음에 보고 싶은 제품을 댓글로",
            "body": "함께 알려주시면 같은 방식으로 정리합니다",
        },
    }


def test_clean_plan_passes_planner_validator() -> None:
    validate_content_plan_safety(_ok_plan())  # no raise


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
    # 숨긴/속고/폭로/은폐 → expose_framing; some terms may also
    # match brand_attack via overlap. Either is acceptable.
    assert "expose_framing" in rules or "brand_attack" in rules, rules


def test_planner_validator_walks_nested_strings() -> None:
    """Banned phrase planted deep in a list-of-dicts must still trip."""
    plan = _ok_plan()
    plan["loved"]["items"].append({
        "label": "test", "count": "n", "note": "최악의 후기 패턴",
    })
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
    validate_content_plan_safety(plan)  # default OK
    with pytest.raises(CardnewsSafetyError):
        validate_content_plan_safety(plan, extra_banned=["특수 키워드"])


# ---------------------------------------------------------------------------
# Multi-violation collection
# ---------------------------------------------------------------------------


def test_violations_collected_not_short_circuited() -> None:
    """If multiple rules fire, the validator should report all of them
    in one shot — the operator shouldn't have to fix-and-rerun a dozen
    times."""
    layout = _ok_layout()
    layout["pages"][0]["subtitle"] = "이 제품은 최악이고 부작용도 있어요"
    del layout["pages"][1]["language"]
    with pytest.raises(CardnewsSafetyError) as e:
        validate_cardnews_safety(layout)
    # At minimum we should see banned_framing AND language violations
    rules = {v.rule for v in e.value.violations}
    assert "banned_framing" in rules
    assert "language_invalid" in rules or any(
        "language" in v.rule for v in e.value.violations
    )
