"""Pure helpers for the product-scope polish fix. No OpenAI, no Streamlit E2E.

Covers issue_product_summary (per-card product context) and
rating_distribution_bars (visual rating bars).
"""

from __future__ import annotations

from app_industrial_review_ops import issue_product_summary, rating_distribution_bars


# --- issue_product_summary --------------------------------------------------


def test_issue_product_summary_one_product():
    product_by_id = {"a": "전선몰딩", "b": "전선몰딩"}
    assert issue_product_summary(["a", "b"], product_by_id) == "상품: 전선몰딩"


def test_issue_product_summary_two_products_orders_by_count():
    # 전선몰딩 has 2 evidence ids, 컵디스펜서 has 1 -> 전선몰딩 listed first.
    product_by_id = {"a": "전선몰딩", "b": "전선몰딩", "c": "컵디스펜서"}
    assert (
        issue_product_summary(["a", "b", "c"], product_by_id)
        == "주요 상품: 전선몰딩, 컵디스펜서"
    )


def test_issue_product_summary_many_products():
    product_by_id = {
        "a": "전선몰딩", "b": "전선몰딩", "c": "전선몰딩",  # top (3)
        "d": "컵디스펜서", "e": "컵디스펜서",                # 2
        "f": "종이컵홀더",                                  # 1
    }
    assert (
        issue_product_summary(["a", "b", "c", "d", "e", "f"], product_by_id)
        == "주요 상품: 전선몰딩 외 2개"
    )


def test_issue_product_summary_ignores_unknown_ids():
    product_by_id = {"a": "전선몰딩"}
    assert issue_product_summary(["a", "zzz"], product_by_id) == "상품: 전선몰딩"


def test_issue_product_summary_empty_when_no_match():
    assert issue_product_summary(["x", "y"], {}) == ""


# --- rating_distribution_bars -----------------------------------------------


def test_rating_distribution_bars_order_and_counts():
    rs = {"distribution": {"5": 80, "4": 10, "3": 5, "2": 3, "1": 2}, "total": 100}
    bars = rating_distribution_bars(rs)
    assert [b["label"] for b in bars] == ["5점", "4점", "3점", "2점", "1점"]
    assert [b["count"] for b in bars] == [80, 10, 5, 3, 2]
    assert bars[0]["fraction"] == 0.8
    assert bars[4]["fraction"] == 0.02


def test_rating_distribution_bars_zero_total_safe():
    rs = {"distribution": {}, "total": 0}
    bars = rating_distribution_bars(rs)
    assert [b["count"] for b in bars] == [0, 0, 0, 0, 0]
    assert all(b["fraction"] == 0.0 for b in bars)
