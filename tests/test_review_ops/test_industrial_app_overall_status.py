"""App-level 전체 리뷰 상태 stats + 리뷰 확인 filters. No OpenAI, no Streamlit E2E.

Imports the pure helpers from the Streamlit app module (the module imports
streamlit, which is available in the dev env) and exercises the counting /
filtering / interpretation logic only.
"""

from __future__ import annotations

from datetime import date

from app_industrial_review_ops import (
    LOW_RATING_INTERPRETATION,
    POSITIVE_INTERPRETATION,
    compute_filter_counts,
    compute_rating_summary,
    filter_review_items,
)
from src.voc.review_ops.industrial.schema import IndustrialReview


def _review(
    review_id: str,
    *,
    rating: float | None = 5.0,
    day: int = 1,
) -> IndustrialReview:
    return IndustrialReview(
        review_id=review_id,
        channel="네이버",
        text=f"리뷰 {review_id}",
        content_fingerprint=f"fp-{review_id}",
        product_name="몰딩 1호",
        rating=rating,
        review_date=date(2026, 5, day),
    )


# --- compute_rating_summary -------------------------------------------------


def test_rating_distribution_and_unknown():
    reviews = [
        _review("a", rating=5.0),
        _review("b", rating=5.0),
        _review("c", rating=4.0),
        _review("d", rating=3.0),
        _review("e", rating=1.0),
        _review("f", rating=None),
    ]
    s = compute_rating_summary(reviews, recent_days=90, today=date(2026, 5, 31))
    assert s["distribution"] == {"5": 2, "4": 1, "3": 1, "2": 0, "1": 1}
    assert s["unknown_rating"] == 1
    assert s["total"] == 6
    assert s["rated_count"] == 5


def test_average_rating():
    reviews = [
        _review("a", rating=5.0),
        _review("b", rating=5.0),
        _review("c", rating=4.0),
        _review("d", rating=2.0),
    ]
    s = compute_rating_summary(reviews, recent_days=90, today=date(2026, 5, 31))
    assert s["average"] == 4.0


def test_average_rating_none_when_no_ratings():
    reviews = [_review("a", rating=None), _review("b", rating=None)]
    s = compute_rating_summary(reviews, recent_days=90, today=date(2026, 5, 31))
    assert s["average"] is None
    assert s["low_share"] == 0.0


def test_low_rating_count():
    reviews = [
        _review("a", rating=5.0),
        _review("b", rating=3.0),  # low
        _review("c", rating=2.0),  # low
        _review("d", rating=1.0),  # low
    ]
    s = compute_rating_summary(reviews, recent_days=90, today=date(2026, 5, 31))
    assert s["low_count"] == 3


def test_high_positive_interpretation():
    # 9/10 are 5점, low share well under the threshold -> positive framing.
    reviews = [_review(f"p{i}", rating=5.0) for i in range(9)]
    reviews.append(_review("low", rating=1.0))
    s = compute_rating_summary(reviews, recent_days=90, today=date(2026, 5, 31))
    assert s["interpretation"] == POSITIVE_INTERPRETATION


def test_low_rating_interpretation():
    # 2/5 are low -> share 0.4 >= threshold -> worklist-first framing.
    reviews = [
        _review("a", rating=5.0),
        _review("b", rating=5.0),
        _review("c", rating=4.0),
        _review("d", rating=2.0),
        _review("e", rating=1.0),
    ]
    s = compute_rating_summary(reviews, recent_days=90, today=date(2026, 5, 31))
    assert s["interpretation"] == LOW_RATING_INTERPRETATION


def test_recent_count_window():
    reviews = [
        _review("recent", rating=5.0, day=30),  # within 90d of 2026-05-31
        _review("old", rating=5.0, day=1),
        IndustrialReview(
            review_id="nodate",
            channel="네이버",
            text="날짜 없음",
            content_fingerprint="fp-nodate",
            rating=5.0,
            review_date=None,
        ),
    ]
    s = compute_rating_summary(reviews, recent_days=10, today=date(2026, 5, 31))
    # only 'recent' (day 30, 1 day ago) is within 10 days; 'old' and 'nodate' excluded.
    assert s["recent_count"] == 1


# --- filters ----------------------------------------------------------------


def _tagged():
    return [
        (_review("a", rating=5.0), ["reorder_bulk_purchase_signal"]),
        (_review("b", rating=2.0), ["needs_reply"]),
        (_review("c", rating=1.0), ["delivery_packaging_damage"]),
        (_review("d", rating=4.0), ["detail_page_faq_candidate"]),
        (_review("e", rating=5.0), []),
    ]


def test_filter_low_rating():
    items = filter_review_items(
        _tagged(), "low_rating", new_ids=set(), worklist_ids=set(), issue_ids=set()
    )
    assert {it["review_id"] for it in items} == {"b", "c"}


def test_filter_repeated_issue_evidence():
    issue_ids = {"c", "b"}
    items = filter_review_items(
        _tagged(), "repeated_issue", new_ids=set(), worklist_ids=set(), issue_ids=issue_ids
    )
    assert {it["review_id"] for it in items} == {"b", "c"}


def test_filter_priority_worklist():
    worklist_ids = {"a", "b", "c"}
    items = filter_review_items(
        _tagged(), "priority", new_ids=set(), worklist_ids=worklist_ids, issue_ids=set()
    )
    assert {it["review_id"] for it in items} == {"a", "b", "c"}


def test_filter_needs_reply_and_detail_page():
    needs = filter_review_items(
        _tagged(), "needs_reply", new_ids=set(), worklist_ids=set(), issue_ids=set()
    )
    detail = filter_review_items(
        _tagged(), "detail_page", new_ids=set(), worklist_ids=set(), issue_ids=set()
    )
    assert {it["review_id"] for it in needs} == {"b"}
    assert {it["review_id"] for it in detail} == {"d"}


def test_filter_all_returns_everything_newest_first():
    items = filter_review_items(
        _tagged(), "all", new_ids=set(), worklist_ids=set(), issue_ids=set()
    )
    assert len(items) == 5


def test_compute_filter_counts():
    counts = compute_filter_counts(
        _tagged(),
        new_ids={"e"},
        worklist_ids={"a", "b", "c"},
        issue_ids={"c"},
    )
    assert counts["all"] == 5
    assert counts["new"] == 1
    assert counts["priority"] == 3
    assert counts["low_rating"] == 2  # b(2), c(1)
    assert counts["needs_reply"] == 1
    assert counts["detail_page"] == 1
    assert counts["repeated_issue"] == 1
