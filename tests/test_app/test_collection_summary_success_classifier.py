"""Tests for the v2.4.4 collection_summary success classifier.

Live OY smoke (2026-05-03) showed `unknown_failure` + `quality=invalid`
sorts being included in `sorts_succeeded`. The classifier now uses an
explicit allow-list (EXPLICIT_SUCCESS_STATUSES) and an explicit
reject-list (EXPLICIT_FAILURE_STATUSES) and records a `success_reason`
audit string per sort.
"""
from __future__ import annotations

import pytest

from src.voc.app.collection_summary import (
    EXPLICIT_FAILURE_STATUSES,
    EXPLICIT_SUCCESS_STATUSES,
    _is_success_entry,
    _success_reason,
    build_collection_summary,
)


# ---------------------------------------------------------------------------
# _is_success_entry — allow-list semantics
# ---------------------------------------------------------------------------


def test_unknown_failure_with_raw_seen_is_NOT_success() -> None:
    """The exact bug live smoke surfaced: unknown_failure + invalid +
    raw_seen=40 + rows_inserted=0 must NOT be in sorts_succeeded."""
    entry = {
        "sort_type": "RATING_ASC",
        "status": "unknown_failure",
        "quality_status": "invalid",
        "raw_records_seen": 40,
        "rows_inserted": 0,
    }
    assert _is_success_entry(entry) is False
    assert "failed_status:unknown_failure" in _success_reason(entry)


def test_quality_invalid_with_clean_status_is_NOT_success() -> None:
    """Even a status the classifier doesn't know about must fail
    when quality_status='invalid' — that's the connector's hard
    'do not trust this batch' signal."""
    entry = {
        "sort_type": "RATING_ASC",
        "status": "ok",  # Hypothetical contradictory shape
        "quality_status": "invalid",
        "raw_records_seen": 100,
        "rows_inserted": 50,
    }
    assert _is_success_entry(entry) is False
    assert "failed_quality_invalid" in _success_reason(entry)


@pytest.mark.parametrize("status", sorted(EXPLICIT_SUCCESS_STATUSES))
def test_explicit_success_statuses_are_success(status: str) -> None:
    entry = {
        "sort_type": "DATETIME_DESC",
        "status": status,
        "quality_status": "ok",
        "raw_records_seen": 10,
        "rows_inserted": 5,
    }
    assert _is_success_entry(entry) is True


def test_duplicate_only_with_zero_inserts_is_success() -> None:
    """`duplicate_only` is the canonical carryover case — the scrape
    ran cleanly but every row was already in the DB. Must count as
    success regardless of rows_inserted."""
    entry = {
        "sort_type": "DATETIME_DESC",
        "status": "duplicate_only",
        "quality_status": "ok",
        "raw_records_seen": 30,
        "rows_inserted": 0,
    }
    assert _is_success_entry(entry) is True
    assert "success_carryover" in _success_reason(entry)


@pytest.mark.parametrize("status", sorted(EXPLICIT_FAILURE_STATUSES))
def test_explicit_failure_statuses_are_failure(status: str) -> None:
    entry = {
        "sort_type": "RATING_ASC",
        "status": status,
        "quality_status": "invalid",
        "raw_records_seen": 50,
        "rows_inserted": 0,
    }
    assert _is_success_entry(entry) is False


def test_unclassified_status_with_inserts_passes() -> None:
    """Future status names get a soft pass when there are real DB
    inserts AND quality is OK/degraded. This keeps the classifier
    forward-compatible without re-opening the unknown_failure hole."""
    entry = {
        "sort_type": "DATETIME_DESC",
        "status": "future_new_status",
        "quality_status": "ok",
        "raw_records_seen": 20,
        "rows_inserted": 10,
    }
    assert _is_success_entry(entry) is True
    assert "success_unclassified_status" in _success_reason(entry)


def test_unclassified_status_with_zero_inserts_is_failure() -> None:
    entry = {
        "sort_type": "DATETIME_DESC",
        "status": "future_new_status",
        "quality_status": "ok",
        "raw_records_seen": 20,
        "rows_inserted": 0,
    }
    assert _is_success_entry(entry) is False


# ---------------------------------------------------------------------------
# build_collection_summary integration
# ---------------------------------------------------------------------------


def test_build_summary_excludes_unknown_failure_from_succeeded() -> None:
    """Live-smoke regression: a 5-sort multi-sort run where one sort
    returned unknown_failure must place that sort in sorts_failed,
    NOT sorts_succeeded."""
    per_sort = [
        {"sort_type": "DATETIME_DESC", "status": "max_cap_reached",
         "quality_status": "ok", "raw_records_seen": 200, "rows_inserted": 200,
         "attempts": 1},
        {"sort_type": "RATING_ASC", "status": "unknown_failure",
         "quality_status": "invalid", "raw_records_seen": 40, "rows_inserted": 0,
         "attempts": 2},
        {"sort_type": "RATING_DESC", "status": "ok",
         "quality_status": "ok", "raw_records_seen": 50, "rows_inserted": 50,
         "attempts": 1},
        {"sort_type": "USEFUL_SCORE_DESC", "status": "duplicate_only",
         "quality_status": "ok", "raw_records_seen": 30, "rows_inserted": 0,
         "attempts": 1},
        {"sort_type": "RECOMMENDED_DESC", "status": "max_cap_reached",
         "quality_status": "ok", "raw_records_seen": 50, "rows_inserted": 30,
         "attempts": 1},
    ]
    summary = build_collection_summary(
        product_url="https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A_TEST",
        goods_no="A_TEST",
        product_name="Test Product",
        corpus_mode="observable_multi_sort",
        primary_sort="DATETIME_DESC",
        per_sort_summaries=per_sort,
        sorts_attempted_plan=[
            "DATETIME_DESC", "RATING_ASC", "RATING_DESC",
            "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
        ],
    )

    assert "RATING_ASC" not in summary["sorts_succeeded"]
    assert "RATING_ASC" in summary["sorts_failed"]
    assert summary["partial_success"] is True
    # success_reason audit trail
    rr_reason = summary["per_sort"]["RATING_ASC"]["success_reason"]
    assert "failed_status:unknown_failure" in rr_reason
    assert "RATING_DESC" in summary["sorts_succeeded"]
    rd_reason = summary["per_sort"]["RATING_DESC"]["success_reason"]
    assert "success_clean:ok" in rd_reason
    # duplicate_only with zero inserts → carryover success
    assert "USEFUL_SCORE_DESC" in summary["sorts_succeeded"]
    assert "success_carryover" in summary["per_sort"]["USEFUL_SCORE_DESC"]["success_reason"]


def test_build_summary_all_failures_partial_false() -> None:
    """When every sort failed, partial_success must be False (the
    `partial` framing only applies to mixed outcomes)."""
    per_sort = [
        {"sort_type": "DATETIME_DESC", "status": "unknown_failure",
         "quality_status": "invalid", "raw_records_seen": 5, "rows_inserted": 0,
         "attempts": 2},
        {"sort_type": "RATING_ASC", "status": "anti_bot",
         "quality_status": "invalid", "raw_records_seen": 0, "rows_inserted": 0,
         "attempts": 1},
    ]
    summary = build_collection_summary(
        product_url="https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A",
        goods_no="A",
        product_name="X",
        corpus_mode="observable_multi_sort",
        primary_sort="DATETIME_DESC",
        per_sort_summaries=per_sort,
        sorts_attempted_plan=["DATETIME_DESC", "RATING_ASC"],
    )
    assert summary["sorts_succeeded"] == []
    assert sorted(summary["sorts_failed"]) == ["DATETIME_DESC", "RATING_ASC"]
    assert summary["partial_success"] is False


def test_build_summary_all_clean_partial_false() -> None:
    """When every sort succeeded, partial_success is False."""
    per_sort = [
        {"sort_type": "DATETIME_DESC", "status": "max_cap_reached",
         "quality_status": "ok", "raw_records_seen": 200, "rows_inserted": 200,
         "attempts": 1},
        {"sort_type": "RATING_DESC", "status": "ok",
         "quality_status": "ok", "raw_records_seen": 50, "rows_inserted": 50,
         "attempts": 1},
    ]
    summary = build_collection_summary(
        product_url="https://x.example.com/p?goodsNo=A",
        goods_no="A", product_name="X", corpus_mode="observable_multi_sort",
        primary_sort="DATETIME_DESC", per_sort_summaries=per_sort,
        sorts_attempted_plan=["DATETIME_DESC", "RATING_DESC"],
    )
    assert sorted(summary["sorts_succeeded"]) == ["DATETIME_DESC", "RATING_DESC"]
    assert summary["sorts_failed"] == []
    assert summary["partial_success"] is False
