"""App-level new-review UI summary helper. No OpenAI, no Streamlit E2E.

Imports ``compute_new_review_summary`` from the Streamlit app module (the
module imports streamlit, which is available in the dev env) and exercises the
pure counting/rendering logic only.
"""

from __future__ import annotations

from datetime import date

from app_industrial_review_ops import compute_new_review_summary
from src.voc.review_ops.industrial.schema import IndustrialReview


def _review(review_id: str, *, day: int = 1, rating: float | None = 2.0) -> IndustrialReview:
    return IndustrialReview(
        review_id=review_id,
        channel="네이버",
        text=f"리뷰 {review_id}",
        content_fingerprint=f"fp-{review_id}",
        product_name="몰딩 1호",
        rating=rating,
        review_date=date(2026, 5, day),
    )


def test_first_upload_all_new():
    tagged = [(_review("a"), []), (_review("b"), [])]
    s = compute_new_review_summary(tagged, {"a", "b"}, worklist_review_ids=set())
    assert s["total_active"] == 2
    assert s["new_count"] == 2
    assert s["seen_count"] == 0
    assert s["first_upload"] is True


def test_partial_new_not_first_upload():
    tagged = [(_review("a"), []), (_review("b"), []), (_review("c"), [])]
    s = compute_new_review_summary(tagged, {"c"}, worklist_review_ids=set())
    assert s["new_count"] == 1
    assert s["seen_count"] == 2
    assert s["first_upload"] is False


def test_zero_new_when_all_seen():
    tagged = [(_review("a"), []), (_review("b"), [])]
    s = compute_new_review_summary(tagged, set(), worklist_review_ids=set())
    assert s["new_count"] == 0
    assert s["seen_count"] == 2
    assert s["first_upload"] is False
    assert s["new_rows"] == []


def test_priority_new_count_intersects_worklist():
    tagged = [(_review("a"), []), (_review("b"), []), (_review("c"), [])]
    # a and c are new; only a and b are on the worklist -> intersection is {a}.
    s = compute_new_review_summary(tagged, {"a", "c"}, worklist_review_ids={"a", "b"})
    assert s["priority_new_count"] == 1


def test_needs_reply_new_count_uses_tags():
    tagged = [
        (_review("a"), ["needs_reply"]),
        (_review("b"), ["delivery_packaging_damage"]),
        (_review("c"), ["needs_reply"]),  # seen, not new -> must not count
    ]
    s = compute_new_review_summary(tagged, {"a", "b"}, worklist_review_ids=set())
    assert s["needs_reply_new_count"] == 1  # only 'a' is both new and needs_reply


def test_new_rows_capped_and_sorted_newest_first():
    tagged = [(_review(str(i), day=i), []) for i in range(1, 26)]  # 25 reviews
    new_ids = {str(i) for i in range(1, 26)}
    s = compute_new_review_summary(tagged, new_ids, worklist_review_ids=set(), max_rows=20)
    assert s["new_count"] == 25
    assert len(s["new_rows"]) == 20  # capped
    # newest first: day 25 then day 24 ...
    assert s["new_rows"][0]["작성일"] == "2026-05-25"
    assert s["new_rows"][1]["작성일"] == "2026-05-24"


def test_new_rows_contain_expected_columns():
    tagged = [(_review("a"), ["needs_reply"])]
    s = compute_new_review_summary(tagged, {"a"}, worklist_review_ids=set())
    row = s["new_rows"][0]
    assert set(row.keys()) == {"작성일", "채널", "상품명", "평점", "태그", "리뷰"}
    assert row["채널"] == "네이버"
    assert row["평점"] == "2"


def test_empty_corpus():
    s = compute_new_review_summary([], set(), worklist_review_ids=set())
    assert s["total_active"] == 0
    assert s["first_upload"] is False
    assert s["new_rows"] == []
