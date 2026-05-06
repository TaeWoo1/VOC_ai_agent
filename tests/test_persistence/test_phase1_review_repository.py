"""Tests for Phase1ReviewRepository — flat reviews store for the bait report."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from src.voc.persistence.migrations import init_db
from src.voc.persistence.phase1_review_repository import Phase1ReviewRepository


@pytest.fixture
def db():
    return init_db(":memory:")


@pytest.fixture
def repo(db):
    return Phase1ReviewRepository(db)


def _row(**overrides) -> dict:
    base = {
        "review_id": "rev_001",
        "source_channel": "coupang",
        "source_method": "csv_upload",
        "source_id": "cp_external_001",
        "source_url": "https://www.coupang.com/vp/products/12345",
        "text": "좋은 제품이에요 만족합니다",
        "rating_normalized": 1.0,
        "rating_raw": 5.0,
        "review_date": "2026-01-01",
        "language": "ko",
        "content_fingerprint": "f" * 64,
        "is_duplicate": False,
        "duplicate_of": None,
        "product_keyword": "에어팟 프로",
        "product_external_id": "12345",
        "channel_meta": {
            "source_channel": "coupang",
            "verified_purchase": True,
            "helpful_count": 3,
            "review_title": "좋아요",
        },
        "derived": None,
        "raw_metadata": {"product_index": "12345", "review_index": 7},
        "run_id": "run_2026_01_01_aaaaaa",
        "collected_at": datetime(2026, 1, 1, tzinfo=timezone.utc).isoformat(),
        "ingested_at": datetime(2026, 1, 1, 0, 0, 1, tzinfo=timezone.utc).isoformat(),
    }
    base.update(overrides)
    return base


# ---------- init_db idempotency ----------

def test_init_db_creates_phase1_tables_idempotently():
    conn = init_db(":memory:")
    # second call on same in-process path should not error
    cur = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name IN ('phase1_reviews', 'phase1_runs')"
    )
    names = {r["name"] for r in cur.fetchall()}
    assert names == {"phase1_reviews", "phase1_runs"}
    # re-running the schema script via init_db on a NEW connection to the same
    # ":memory:" target is a fresh DB, so we test idempotency by re-executescript:
    from src.voc.persistence.migrations import _SCHEMA_SQL
    conn.executescript(_SCHEMA_SQL)  # must not raise


# ---------- save_many ----------

def test_save_many_basic_round_trip(repo):
    inserted = repo.save_many([_row()])
    assert inserted == 1
    fetched = repo.get("rev_001")
    assert fetched is not None
    assert fetched["review_id"] == "rev_001"
    assert fetched["source_channel"] == "coupang"
    assert fetched["text"] == "좋은 제품이에요 만족합니다"
    assert fetched["rating_normalized"] == 1.0
    assert fetched["is_duplicate"] is False


def test_save_many_empty_list_is_noop(repo):
    assert repo.save_many([]) == 0


def test_save_many_returns_inserted_count(repo):
    rows = [_row(review_id=f"rev_{i:03d}") for i in range(5)]
    assert repo.save_many(rows) == 5


def test_save_many_insert_or_ignore_on_duplicate_review_id(repo):
    repo.save_many([_row(review_id="dup")])
    inserted = repo.save_many([
        _row(review_id="dup", text="이건 무시되어야 한다"),
        _row(review_id="new"),
    ])
    assert inserted == 1  # only "new" inserted
    # original text preserved (IGNORE, not REPLACE)
    assert repo.get("dup")["text"] == "좋은 제품이에요 만족합니다"
    assert repo.get("new") is not None


def test_channel_meta_json_round_trip(repo):
    repo.save_many([_row()])
    fetched = repo.get("rev_001")
    assert fetched["channel_meta"]["verified_purchase"] is True
    assert fetched["channel_meta"]["review_title"] == "좋아요"
    assert fetched["channel_meta"]["helpful_count"] == 3


def test_raw_metadata_json_round_trip(repo):
    repo.save_many([_row()])
    fetched = repo.get("rev_001")
    assert fetched["raw_metadata"] == {"product_index": "12345", "review_index": 7}


def test_derived_json_round_trip_when_set(repo):
    derived_payload = {
        "normalized_skin_type": {"bucket": "dry"},
        "normalized_age_group": {"bucket": "20s"},
    }
    repo.save_many([_row(derived=derived_payload)])
    fetched = repo.get("rev_001")
    assert fetched["derived"] == derived_payload


def test_derived_is_none_when_not_set(repo):
    repo.save_many([_row()])
    assert repo.get("rev_001")["derived"] is None


def test_is_duplicate_round_trip(repo):
    repo.save_many([_row(review_id="dup1", is_duplicate=True, duplicate_of="rev_001")])
    fetched = repo.get("dup1")
    assert fetched["is_duplicate"] is True
    assert fetched["duplicate_of"] == "rev_001"


def test_korean_text_preserved_via_ensure_ascii_false(repo):
    repo.save_many([_row(
        review_id="kr_text",
        text="한글 깨지지 않아야 합니다 정말로",
        channel_meta={"source_channel": "oliveyoung", "skin_type": "건성"},
    )])
    fetched = repo.get("kr_text")
    assert fetched["text"] == "한글 깨지지 않아야 합니다 정말로"
    assert fetched["channel_meta"]["skin_type"] == "건성"


# ---------- get ----------

def test_get_nonexistent_returns_none(repo):
    assert repo.get("not-here") is None


# ---------- count_by_channel ----------

def test_count_by_channel_empty(repo):
    assert repo.count_by_channel() == {}


def test_count_by_channel_groups(repo):
    repo.save_many([
        _row(review_id="cp1", source_channel="coupang"),
        _row(review_id="cp2", source_channel="coupang"),
        _row(review_id="oy1", source_channel="oliveyoung"),
    ])
    assert repo.count_by_channel() == {"coupang": 2, "oliveyoung": 1}


# ---------- query ----------

def test_query_filter_by_channel(repo):
    repo.save_many([
        _row(review_id="cp1", source_channel="coupang"),
        _row(review_id="cp2", source_channel="coupang"),
        _row(review_id="oy1", source_channel="oliveyoung"),
    ])
    coupang_only = repo.query(source_channel="coupang")
    assert {r["review_id"] for r in coupang_only} == {"cp1", "cp2"}


def test_query_filter_by_run_id(repo):
    repo.save_many([
        _row(review_id="r1", run_id="run_a"),
        _row(review_id="r2", run_id="run_a"),
        _row(review_id="r3", run_id="run_b"),
    ])
    assert {r["review_id"] for r in repo.query(run_id="run_a")} == {"r1", "r2"}


def test_query_combined_filters(repo):
    repo.save_many([
        _row(review_id="r1", source_channel="coupang", run_id="run_a"),
        _row(review_id="r2", source_channel="oliveyoung", run_id="run_a"),
    ])
    out = repo.query(source_channel="coupang", run_id="run_a")
    assert [r["review_id"] for r in out] == ["r1"]


def test_query_limit(repo):
    rows = [_row(review_id=f"r{i:03d}") for i in range(10)]
    repo.save_many(rows)
    assert len(repo.query(limit=3)) == 3


def test_query_no_filter_returns_all(repo):
    repo.save_many([_row(review_id=f"r{i}") for i in range(4)])
    assert len(repo.query()) == 4
