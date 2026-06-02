"""Tests for Phase1RunRepository — append-only run audit log."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from src.voc.persistence.migrations import init_db
from src.voc.persistence.phase1_run_repository import Phase1RunRepository


@pytest.fixture
def db():
    return init_db(":memory:")


@pytest.fixture
def repo(db):
    return Phase1RunRepository(db)


def _save(repo, **overrides):
    args = {
        "run_id": "run_001",
        "channel": "coupang",
        "requested_target": "/coupang/coupang_reviews.csv",
        "started_at": datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc).isoformat(),
        "finished_at": datetime(2026, 1, 1, 12, 0, 5, tzinfo=timezone.utc).isoformat(),
        "quality_status": "ok",
        "summary": {
            "raw_records_seen": 100,
            "records_parsed": 100,
            "blocked": False,
            "auth_error": False,
        },
    }
    args.update(overrides)
    repo.save(**args)
    return args


def test_save_and_get_round_trip(repo):
    saved = _save(repo)
    fetched = repo.get("run_001")
    assert fetched is not None
    assert fetched["run_id"] == "run_001"
    assert fetched["channel"] == "coupang"
    assert fetched["quality_status"] == "ok"
    assert fetched["summary"]["raw_records_seen"] == 100
    assert fetched["requested_target"] == saved["requested_target"]


def test_get_nonexistent_returns_none(repo):
    assert repo.get("does-not-exist") is None


def test_finished_at_can_be_null(repo):
    _save(repo, run_id="open_run", finished_at=None)
    fetched = repo.get("open_run")
    assert fetched["finished_at"] is None


def test_summary_json_preserves_korean(repo):
    _save(repo, run_id="kr_run", summary={"sample_dropped_reasons": ["짧은 텍스트", "날짜 파싱 실패"]})
    fetched = repo.get("kr_run")
    assert fetched["summary"]["sample_dropped_reasons"] == ["짧은 텍스트", "날짜 파싱 실패"]


def test_latest_by_channel_picks_most_recent_started_at(repo):
    _save(repo, run_id="r1", channel="coupang",
          started_at=datetime(2026, 1, 1, 10, tzinfo=timezone.utc).isoformat())
    _save(repo, run_id="r2", channel="coupang",
          started_at=datetime(2026, 1, 2, 10, tzinfo=timezone.utc).isoformat())
    _save(repo, run_id="r3", channel="coupang",
          started_at=datetime(2026, 1, 1, 20, tzinfo=timezone.utc).isoformat())
    latest = repo.latest_by_channel("coupang")
    assert latest["run_id"] == "r2"


def test_latest_by_channel_isolates_per_channel(repo):
    _save(repo, run_id="cp1", channel="coupang",
          started_at=datetime(2026, 1, 1, tzinfo=timezone.utc).isoformat())
    _save(repo, run_id="oy1", channel="oliveyoung",
          started_at=datetime(2026, 1, 2, tzinfo=timezone.utc).isoformat())
    assert repo.latest_by_channel("coupang")["run_id"] == "cp1"
    assert repo.latest_by_channel("oliveyoung")["run_id"] == "oy1"


def test_latest_by_channel_no_runs_returns_none(repo):
    assert repo.latest_by_channel("ghost") is None


def test_quality_status_invalid_persists(repo):
    _save(repo, run_id="bad", quality_status="invalid",
          summary={"blocked": True})
    fetched = repo.get("bad")
    assert fetched["quality_status"] == "invalid"
    assert fetched["summary"]["blocked"] is True


def test_quality_status_degraded_persists(repo):
    _save(repo, run_id="warn", quality_status="degraded",
          summary={"parse_warnings": 15, "records_parsed": 100})
    fetched = repo.get("warn")
    assert fetched["quality_status"] == "degraded"
