"""App-level product-scope plumbing (H1). No OpenAI, no Streamlit E2E.

Covers the pure helpers (compute_product_summaries, truncate_product_label) and
generate() product scoping. generate() is exercised with do_cluster/do_refine
OFF so no network/OpenAI call happens; the local store is pointed at a tmp path.
"""

from __future__ import annotations

import os
import tempfile
from datetime import date

from app_industrial_review_ops import (
    UNKNOWN_PRODUCT_LABEL,
    compute_product_summaries,
    generate,
    truncate_product_label,
)
from src.voc.review_ops.industrial.schema import IndustrialReview


def _review(
    review_id: str,
    *,
    product: str | None,
    rating: float | None = 5.0,
    day: int = 1,
) -> IndustrialReview:
    return IndustrialReview(
        review_id=review_id,
        channel="네이버",
        text=f"리뷰 {review_id}",
        content_fingerprint=f"fp-{review_id}",
        product_name=product,
        rating=rating,
        review_date=date(2026, 5, day),
    )


# --- compute_product_summaries ---------------------------------------------


def _mixed():
    return [
        _review("a", product="전선몰딩", rating=5.0, day=30),
        _review("b", product="전선몰딩", rating=2.0, day=30),
        _review("c", product="전선몰딩", rating=1.0, day=1),
        _review("d", product="컵디스펜서", rating=5.0, day=30),
        _review("e", product="컵디스펜서", rating=4.0, day=30),
        _review("f", product=None, rating=3.0, day=30),
    ]


def test_counts_products_correctly():
    s = compute_product_summaries(_mixed(), recent_days=90, today=date(2026, 5, 31))
    by_name = {d["product_name"]: d for d in s}
    assert by_name["전선몰딩"]["review_count"] == 3
    assert by_name["컵디스펜서"]["review_count"] == 2
    assert by_name[UNKNOWN_PRODUCT_LABEL]["review_count"] == 1


def test_average_rating_per_product():
    s = compute_product_summaries(_mixed(), recent_days=90, today=date(2026, 5, 31))
    by_name = {d["product_name"]: d for d in s}
    assert by_name["전선몰딩"]["average_rating"] == round((5 + 2 + 1) / 3, 1)  # 2.7
    assert by_name["컵디스펜서"]["average_rating"] == 4.5


def test_low_rating_count_per_product():
    s = compute_product_summaries(_mixed(), recent_days=90, today=date(2026, 5, 31))
    by_name = {d["product_name"]: d for d in s}
    assert by_name["전선몰딩"]["low_rating_count"] == 2  # ratings 2 and 1
    assert by_name["컵디스펜서"]["low_rating_count"] == 0


def test_recent_review_count_per_product():
    # window 10 days before 2026-05-31: only day=30 reviews count.
    s = compute_product_summaries(_mixed(), recent_days=10, today=date(2026, 5, 31))
    by_name = {d["product_name"]: d for d in s}
    assert by_name["전선몰딩"]["recent_review_count"] == 2  # a, b (day30); c (day1) excluded
    assert by_name["컵디스펜서"]["recent_review_count"] == 2


def test_blank_product_bucket():
    s = compute_product_summaries(
        [_review("x", product="", rating=5.0), _review("y", product=None, rating=5.0)],
        recent_days=90,
        today=date(2026, 5, 31),
    )
    assert len(s) == 1
    assert s[0]["product_name"] == UNKNOWN_PRODUCT_LABEL
    assert s[0]["review_count"] == 2


def test_sorted_by_review_count_desc():
    s = compute_product_summaries(_mixed(), recent_days=90, today=date(2026, 5, 31))
    counts = [d["review_count"] for d in s]
    assert counts == sorted(counts, reverse=True)
    assert s[0]["product_name"] == "전선몰딩"  # most reviews


# --- truncate_product_label -------------------------------------------------


def test_truncate_keeps_short_names():
    assert truncate_product_label("전선몰딩", width=28) == "전선몰딩"


def test_truncate_long_names():
    long = "나누리샵 세모금컵 4000매 생수컵 + 세모금컵 하향식 디스펜서 추가구성"
    out = truncate_product_label(long, width=12)
    assert out.endswith("…")
    assert len(out) <= 12


# --- generate() scoping -----------------------------------------------------


def _rows():
    # canonical rows: product_name + text (+ rating/date) drive normalize. The
    # canonical date key is "date" (see normalize.py), not "review_date".
    return [
        {"product_name": "전선몰딩", "text": "몰딩 접착력이 약해요", "rating": "2", "date": "2026-05-30"},
        {"product_name": "전선몰딩", "text": "벽에 설치하기 어려웠습니다", "rating": "3", "date": "2026-05-30"},
        {"product_name": "컵디스펜서", "text": "자석이 약해서 뚜껑이 헐거워요", "rating": "2", "date": "2026-05-30"},
        {"product_name": "컵디스펜서", "text": "잘 쓰고 있습니다", "rating": "5", "date": "2026-05-30"},
        {"product_name": "컵디스펜서", "text": "만족합니다", "rating": "5", "date": "2026-05-30"},
    ]


def _tmp_store():
    return os.path.join(tempfile.mkdtemp(), "scope.db")


def test_generate_no_filter_is_full_corpus():
    res = generate(
        _rows(), title="t", today=date(2026, 5, 31), recent_days=90,
        store_path=_tmp_store(), do_refine=False, do_cluster=False, product_filter=None,
    )
    assert res["full_active_count"] == 5
    assert res["scoped_active_count"] == 5
    assert res["total"] == 5
    assert res["scope_products"] == []
    assert res["scope_label"] == "전체 상품"
    # product_summaries always reflect the FULL corpus.
    names = {d["product_name"] for d in res["product_summaries"]}
    assert names == {"전선몰딩", "컵디스펜서"}


def test_generate_scopes_to_one_product():
    res = generate(
        _rows(), title="t", today=date(2026, 5, 31), recent_days=90,
        store_path=_tmp_store(), do_refine=False, do_cluster=False,
        product_filter={"전선몰딩"},
    )
    assert res["full_active_count"] == 5
    assert res["scoped_active_count"] == 2
    assert res["total"] == 2
    assert res["scope_products"] == ["전선몰딩"]
    assert res["scope_label"] == "선택 상품 1개"
    # tagged + rating_summary are confined to the selected product.
    assert all(r.product_name == "전선몰딩" for r, _ in res["tagged"])
    assert res["rating_summary"]["total"] == 2
    # full product_summaries still list both products so the operator can widen.
    names = {d["product_name"] for d in res["product_summaries"]}
    assert names == {"전선몰딩", "컵디스펜서"}


def test_generate_worklist_scoped_to_product():
    res = generate(
        _rows(), title="t", today=date(2026, 5, 31), recent_days=90,
        store_path=_tmp_store(), do_refine=False, do_cluster=False,
        product_filter={"전선몰딩"},
    )
    # every worklist id belongs to a 전선몰딩 review
    molding_ids = {r.review_id for r, _ in res["tagged"]}
    assert res["worklist_review_ids"]
    assert res["worklist_review_ids"] <= molding_ids


def test_generate_absent_product_falls_back_to_full():
    res = generate(
        _rows(), title="t", today=date(2026, 5, 31), recent_days=90,
        store_path=_tmp_store(), do_refine=False, do_cluster=False,
        product_filter={"존재하지 않는 상품"},
    )
    assert res["scoped_active_count"] == 5  # fell back to full corpus
    assert res["scope_label"] == "전체 상품"
    assert res["scope_products"] == []
