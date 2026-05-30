"""Rule-based taxonomy: per-category recall + false-positive guard.

This is the honesty gate. If a deliberately short/terse Korean review stops
matching, or a clean positive review starts tripping a risk tag, that surfaces
here rather than in front of a testbed operator.
"""

from __future__ import annotations

from src.voc.review_ops.industrial.classify import classify
from src.voc.review_ops.industrial.schema import IndustrialReview
from src.voc.review_ops.industrial.taxonomy import CATEGORIES, CATEGORY_BY_ID


def _review(text: str, *, has_reply: bool = False) -> IndustrialReview:
    return IndustrialReview(
        review_id="t", channel="네이버", text=text, content_fingerprint="x" * 64,
        has_reply=has_reply,
    )


# One seed phrase per category that must keep firing.
SEEDS = {
    "missing_or_wrong_components": "브라켓이 누락되어 왔어요",
    "delivery_packaging_damage": "박스가 터져서 왔어요",
    "spec_size_confusion": "사이즈가 안맞아요",
    "color_appearance_mismatch": "색이 사진과 달라요",
    "installation_difficulty": "설치가 어렵네요",
    "durability_adhesion_finish": "금방 부러졌어요",
    "cs_exchange_return_issue": "반품하고 싶어요",
    "component_option_confusion": "옵션이 헷갈려요",
    "detail_page_faq_candidate": "상세페이지에 설명이 부족해요",
    "needs_reply": "재고 있나요? 문의드려요",
    "channel_difference_signal": "다른 데가 싸던데요",
    "reorder_bulk_purchase_signal": "재구매했어요",
    "positive_marketing_phrase": "만족합니다",
}


def test_every_category_has_a_seed():
    assert set(SEEDS) == {c.id for c in CATEGORIES}


def test_each_category_fires_on_its_seed():
    for cat_id, text in SEEDS.items():
        assert cat_id in classify(_review(text)), f"{cat_id} did not fire on '{text}'"


def test_short_korean_reviews_still_classify():
    assert "spec_size_confusion" in classify(_review("사이즈 안맞음"))
    assert "cs_exchange_return_issue" in classify(_review("교환문의요"))
    assert "color_appearance_mismatch" in classify(_review("색이 사진이랑 달라요"))


def test_clean_positive_review_has_no_risk_tag():
    text = "튼튼하고 잘 만들어졌어요. 딱 맞아서 만족합니다. 재구매 의사 있어요."
    tags = classify(_review(text))
    assert "positive_marketing_phrase" in tags
    risk_tags = [t for t in tags if CATEGORY_BY_ID[t].kind == "risk"]
    assert risk_tags == [], f"clean positive review wrongly flagged as risk: {risk_tags}"


def test_positive_neutral_reviews_avoid_risk_tags():
    # neutral help-topic mentions must not trip risk categories (Codex finding #3)
    t1 = classify(_review("설치 방법이 잘 나와 있어서 쉽게 했어요. 만족합니다"))
    assert "installation_difficulty" not in t1

    t2 = classify(_review("교환 정책이 자세히 안내되어 있어서 안심됐어요"))
    assert "cs_exchange_return_issue" not in t2
    assert "needs_reply" not in t2

    t3 = classify(_review("상세페이지에 치수가 잘 나와 있어서 딱 맞게 샀어요"))
    assert "detail_page_faq_candidate" not in t3
    assert "spec_size_confusion" not in t3


def test_true_positive_complaints_still_fire():
    assert "installation_difficulty" in classify(_review("설치가 어렵네요"))
    assert "cs_exchange_return_issue" in classify(_review("교환 가능한가요?"))
    assert "detail_page_faq_candidate" in classify(_review("상세페이지 설명이 부족해요"))
    assert "spec_size_confusion" in classify(_review("사이즈 안맞음"))


def test_broad_risk_keywords_do_not_fire_on_positive_reviews():
    # missing_or_wrong_components must not fire on positive/neutral "없어요" forms
    for text in ("문제 없어요. 튼튼하고 만족합니다", "불편 없어요", "빠짐없이 잘 왔어요"):
        assert "missing_or_wrong_components" not in classify(_review(text)), text
    # spec_size_confusion must not fire on positive size adjectives
    for text in ("작고 튼튼해서 만족합니다", "작은 공간에 딱 맞아요"):
        assert "spec_size_confusion" not in classify(_review(text)), text


def test_qualified_risk_keywords_still_fire():
    for text in ("구성품이 누락됐어요", "브라켓이 안 들어있어요", "나사가 빠져 있어요"):
        assert "missing_or_wrong_components" in classify(_review(text)), text
    for text in ("사이즈가 안맞아요", "작아서 안 맞아요", "너무 커서 설치가 안 돼요",
                 "표기된 치수랑 달라요"):
        assert "spec_size_confusion" in classify(_review(text)), text


_RISK_KINDS = {"risk"}


def _risk_tags(text: str) -> list[str]:
    from src.voc.review_ops.industrial.taxonomy import CATEGORY_BY_ID
    return [t for t in classify(_review(text)) if CATEGORY_BY_ID[t].kind in _RISK_KINDS]


def test_cs_and_delivery_bare_nouns_do_not_fire_on_positive_reviews():
    positives = [
        "반품 정책이 자세히 안내되어 있어서 안심됐어요. 설치도 쉬웠고 만족합니다",
        "환불 안내가 명확해서 믿고 구매했어요",
        "고객센터 응대가 좋았어요",
        "a/s가 빨라서 만족합니다",
        "손상 없이 잘 왔어요",
        "긁힘 하나 없이 깔끔합니다",
        "문제 없어요. 튼튼하고 만족합니다",
        "작고 튼튼해서 만족합니다",
    ]
    for text in positives:
        assert _risk_tags(text) == [], f"{text!r} wrongly flagged risk: {_risk_tags(text)}"


def test_cs_and_delivery_complaints_still_fire():
    assert "cs_exchange_return_issue" in classify(_review("반품하고 싶어요"))
    assert "cs_exchange_return_issue" in classify(_review("환불 요청드립니다"))
    assert "cs_exchange_return_issue" in classify(_review("고객센터 연락이 안 됩니다"))
    assert "cs_exchange_return_issue" in classify(_review("a/s 요청합니다"))
    assert "delivery_packaging_damage" in classify(_review("박스가 파손되어 왔어요"))
    assert "delivery_packaging_damage" in classify(_review("제품이 손상된 상태로 왔어요"))
    assert "delivery_packaging_damage" in classify(_review("긁힌 자국이 있어요"))
    assert "missing_or_wrong_components" in classify(_review("구성품이 누락됐어요"))
    assert "spec_size_confusion" in classify(_review("사이즈가 안맞아요"))


def test_negated_positive_reviews_do_not_produce_risk_tags():
    negated_positives = [
        "파손 없이 잘 왔어요",
        "손상 없이 잘 왔어요",
        "긁힘 하나 없이 깔끔합니다",
        "안 떨어져요 튼튼합니다",
        "헐거움 없이 딱 맞아요",
        "문제 없어요. 튼튼하고 만족합니다",
        "불편 없어요",
        "교환 처리가 안내되어 있어 안심했습니다",
    ]
    for text in negated_positives:
        assert _risk_tags(text) == [], f"{text!r} wrongly flagged risk: {_risk_tags(text)}"


def test_negated_true_positive_complaints_still_fire():
    assert "delivery_packaging_damage" in classify(_review("박스가 파손되어 왔어요"))
    assert "delivery_packaging_damage" in classify(_review("제품이 손상된 상태로 왔어요"))
    assert "delivery_packaging_damage" in classify(_review("긁힌 자국이 있어요"))
    assert "durability_adhesion_finish" in classify(_review("접착이 약해서 떨어져요"))
    assert "durability_adhesion_finish" in classify(_review("헐거워서 고정이 안 돼요"))
    assert "cs_exchange_return_issue" in classify(_review("교환 처리가 안 됩니다"))
    assert "cs_exchange_return_issue" in classify(_review("반품하고 싶어요"))
    assert "cs_exchange_return_issue" in classify(_review("환불 요청드립니다"))


def test_distant_term_negation_does_not_produce_risk_tags():
    distant_negated = [
        "파손은 전혀 없고 잘 왔어요",
        "파손 없이 잘 왔어요",
        "긁힘은 전혀 없습니다",
        "헐거움 없이 딱 맞아요",
        "파손되지 않았어요",
    ]
    for text in distant_negated:
        assert _risk_tags(text) == [], f"{text!r} wrongly flagged risk: {_risk_tags(text)}"


def test_distant_negation_does_not_suppress_real_complaints():
    # "없" here does NOT negate the risk term — these must still fire
    assert "delivery_packaging_damage" in classify(_review("파손돼서 쓸 수 없어요"))
    assert "delivery_packaging_damage" in classify(_review("박스가 파손되어 왔어요"))
    assert "delivery_packaging_damage" in classify(_review("제품이 손상된 상태로 왔어요"))
    assert "durability_adhesion_finish" in classify(_review("접착이 약해서 떨어져요"))
    assert "durability_adhesion_finish" in classify(_review("헐거워서 고정이 안 돼요"))
    assert "cs_exchange_return_issue" in classify(_review("교환 처리가 안 됩니다"))


def test_affirmative_positive_phrases_do_not_produce_risk_tags():
    # affirmative (non-negated) uses of risk terms in satisfied reviews
    for text in [
        "상세페이지 치수 확인 후 구매했더니 딱 맞아요. 만족합니다",
        "교환 가능해서 안심하고 구매했어요. 만족합니다",
    ]:
        assert _risk_tags(text) == [], f"{text!r} wrongly flagged risk: {_risk_tags(text)}"


def test_request_and_complaint_forms_still_fire():
    assert "cs_exchange_return_issue" in classify(_review("교환 가능한가요?"))
    assert "spec_size_confusion" in classify(_review("치수 확인이 필요해요"))
    assert "spec_size_confusion" in classify(_review("사이즈가 안맞아요"))


def test_positive_cs_contact_phrasing_not_flagged():
    # "안 해도" = "even without …" — a positive completion, not a CS complaint
    for text in [
        "고객센터 연락 안 해도 바로 처리되어 만족합니다",
        "처리 안 해도 바로 됐어요. 만족합니다",
    ]:
        assert _risk_tags(text) == [], f"{text!r} wrongly flagged risk: {_risk_tags(text)}"


def test_cs_contact_failure_complaints_still_fire():
    assert "cs_exchange_return_issue" in classify(_review("고객센터 연락이 안 됩니다"))
    assert "cs_exchange_return_issue" in classify(_review("교환 처리가 안 됩니다"))


def test_needs_reply_suppressed_when_already_replied():
    text = "재고 있나요? 문의드려요"
    assert "needs_reply" in classify(_review(text, has_reply=False))
    assert "needs_reply" not in classify(_review(text, has_reply=True))
