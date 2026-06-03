"""Pure helpers for the product-scope UI (H2). No OpenAI, no Streamlit E2E.

Only the pure display helpers are tested; the Streamlit wiring (multiselect,
table render, scope caption placement) is exercised by the manual smoke.
"""

from __future__ import annotations

from app_industrial_review_ops import (
    product_status_rows,
    scope_caption_text,
    scoped_product_status_summaries,
)


def test_scope_caption_full_corpus():
    assert scope_caption_text({"scope_products": []}) == "전체 상품 기준"
    assert scope_caption_text({}) == "전체 상품 기준"


def test_scope_caption_selected():
    assert scope_caption_text({"scope_products": ["A"]}) == "선택 상품 기준: 1개 상품"
    assert scope_caption_text({"scope_products": ["A", "B", "C"]}) == "선택 상품 기준: 3개 상품"


def test_product_status_rows_maps_fields():
    summaries = [
        {
            "product_name": "전선몰딩",
            "review_count": 10,
            "average_rating": 4.5,
            "low_rating_count": 2,
            "recent_review_count": 3,
        }
    ]
    rows = product_status_rows(summaries)
    assert rows == [
        {"상품명": "전선몰딩", "리뷰 수": 10, "평균 평점": 4.5, "저평점 수": 2, "최근 리뷰 수": 3}
    ]


def test_product_status_rows_none_average_shows_dash():
    summaries = [
        {
            "product_name": "미상상품",
            "review_count": 1,
            "average_rating": None,
            "low_rating_count": 0,
            "recent_review_count": 0,
        }
    ]
    rows = product_status_rows(summaries)
    assert rows[0]["평균 평점"] == "-"


def test_product_status_rows_empty():
    assert product_status_rows([]) == []


# --- scoped_product_status_summaries ----------------------------------------


def _summaries():
    return [
        {"product_name": "전선몰딩", "review_count": 100, "average_rating": 4.0,
         "low_rating_count": 5, "recent_review_count": 10},
        {"product_name": "컵디스펜서", "review_count": 50, "average_rating": 3.5,
         "low_rating_count": 8, "recent_review_count": 4},
        {"product_name": "생수컵", "review_count": 20, "average_rating": 4.5,
         "low_rating_count": 1, "recent_review_count": 2},
    ]


def test_scoped_summaries_empty_scope_returns_empty():
    assert scoped_product_status_summaries(_summaries(), []) == []
    assert scoped_product_status_summaries(_summaries(), None) == []


def test_scoped_summaries_filters_to_scope():
    out = scoped_product_status_summaries(_summaries(), ["전선몰딩"])
    assert [s["product_name"] for s in out] == ["전선몰딩"]


def test_scoped_summaries_preserves_count_desc_order():
    # scope order is irrelevant; output follows the incoming (count-desc) order.
    out = scoped_product_status_summaries(_summaries(), ["생수컵", "전선몰딩"])
    assert [s["product_name"] for s in out] == ["전선몰딩", "생수컵"]


def test_scoped_summaries_ignores_unknown_scope_names():
    out = scoped_product_status_summaries(_summaries(), ["없는상품", "컵디스펜서"])
    assert [s["product_name"] for s in out] == ["컵디스펜서"]
