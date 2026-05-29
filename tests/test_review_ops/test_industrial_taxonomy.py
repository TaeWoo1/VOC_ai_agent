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


def test_needs_reply_suppressed_when_already_replied():
    text = "재고 있나요? 문의드려요"
    assert "needs_reply" in classify(_review(text, has_reply=False))
    assert "needs_reply" not in classify(_review(text, has_reply=True))
