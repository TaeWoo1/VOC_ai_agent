"""Unit tests for persistence repositories against in-memory SQLite."""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pytest

from src.voc.persistence.migrations import init_db
from src.voc.persistence.repository import (
    EntityRepository,
    SnapshotRepository,
    SyncJobRepository,
)


@pytest.fixture
def db():
    return init_db(":memory:")


@pytest.fixture
def entity_repo(db):
    return EntityRepository(db)


@pytest.fixture
def job_repo(db):
    return SyncJobRepository(db)


@pytest.fixture
def snapshot_repo(db):
    return SnapshotRepository(db)


def _make_entity_record(**overrides) -> dict:
    base = {
        "tenant_id": "default",
        "entity_type": "product",
        "display_name": "에어팟 프로",
        "description": "Apple 무선 이어폰",
        "product_keywords": ["에어팟 프로", "airpods pro"],
        "connector": "mock",
        "metadata": {},
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_refreshed_at": None,
        "refresh_count": 0,
    }
    base.update(overrides)
    return base


# --------------------------------------------------------------------------
# EntityRepository
# --------------------------------------------------------------------------


class TestEntityRepository:
    def test_save_and_get(self, entity_repo):
        record = _make_entity_record()
        entity_repo.save("airpods-pro", record)
        result = entity_repo.get("airpods-pro")
        assert result is not None
        assert result["entity_id"] == "airpods-pro"
        assert result["display_name"] == "에어팟 프로"
        assert result["product_keywords"] == ["에어팟 프로", "airpods pro"]
        assert result["metadata"] == {}

    def test_get_nonexistent(self, entity_repo):
        assert entity_repo.get("nonexistent") is None

    def test_list_all_filters_by_tenant(self, entity_repo):
        entity_repo.save("e1", _make_entity_record(tenant_id="t1"))
        entity_repo.save("e2", _make_entity_record(tenant_id="t2"))
        entity_repo.save("e3", _make_entity_record(tenant_id="t1"))
        assert len(entity_repo.list_all("t1")) == 2
        assert len(entity_repo.list_all("t2")) == 1
        assert len(entity_repo.list_all("t3")) == 0

    def test_update(self, entity_repo):
        entity_repo.save("e1", _make_entity_record())
        updated = entity_repo.update("e1", {"display_name": "Updated Name"})
        assert updated is not None
        assert updated["display_name"] == "Updated Name"
        # verify persistence
        fetched = entity_repo.get("e1")
        assert fetched["display_name"] == "Updated Name"

    def test_update_nonexistent(self, entity_repo):
        assert entity_repo.update("nonexistent", {"display_name": "X"}) is None

    def test_delete(self, entity_repo):
        entity_repo.save("e1", _make_entity_record())
        assert entity_repo.delete("e1") is True
        assert entity_repo.get("e1") is None

    def test_delete_nonexistent(self, entity_repo):
        assert entity_repo.delete("nonexistent") is False

    def test_product_keywords_roundtrip(self, entity_repo):
        keywords = ["키워드1", "keyword2", "키워드 3"]
        entity_repo.save("e1", _make_entity_record(product_keywords=keywords))
        result = entity_repo.get("e1")
        assert result["product_keywords"] == keywords

    def test_metadata_roundtrip(self, entity_repo):
        meta = {"source_url": "https://example.com", "notes": "테스트"}
        entity_repo.save("e1", _make_entity_record(metadata=meta))
        result = entity_repo.get("e1")
        assert result["metadata"] == meta


# --------------------------------------------------------------------------
# SyncJobRepository
# --------------------------------------------------------------------------


class TestSyncJobRepository:
    def test_create_and_get(self, job_repo):
        job_repo.create("job-1", "entity-1")
        result = job_repo.get("job-1")
        assert result is not None
        assert result["job_id"] == "job-1"
        assert result["entity_id"] == "entity-1"
        assert result["job_type"] == "refresh"
        assert result["status"] == "pending"

    def test_start(self, job_repo):
        job_repo.create("job-1", "entity-1")
        job_repo.start("job-1")
        result = job_repo.get("job-1")
        assert result["status"] == "running"

    def test_complete(self, job_repo):
        job_repo.create("job-1", "entity-1")
        job_repo.start("job-1")
        stages = [{"name": "collected", "status": "ok", "count": 10}]
        job_repo.complete(
            "job-1",
            status="completed",
            total_collected=10,
            total_indexed=8,
            stages_json=json.dumps(stages),
            errors_json="[]",
        )
        result = job_repo.get("job-1")
        assert result["status"] == "completed"
        assert result["total_collected"] == 10
        assert result["total_indexed"] == 8
        assert result["stages"] == stages
        assert result["errors"] == []
        assert result["finished_at"] is not None

    def test_get_nonexistent(self, job_repo):
        assert job_repo.get("nonexistent") is None

    def test_list_by_entity(self, job_repo):
        job_repo.create("j1", "e1", job_type="refresh")
        job_repo.create("j2", "e1", job_type="refresh")
        job_repo.create("j3", "e2", job_type="refresh")
        assert len(job_repo.list_by_entity("e1")) == 2
        assert len(job_repo.list_by_entity("e2")) == 1

    def test_list_by_entity_with_job_type_filter(self, job_repo):
        job_repo.create("j1", "e1", job_type="refresh")
        job_repo.create("j2", "e1", job_type="import")
        assert len(job_repo.list_by_entity("e1", job_type="refresh")) == 1
        assert len(job_repo.list_by_entity("e1", job_type="import")) == 1

    def test_list_respects_limit(self, job_repo):
        for i in range(5):
            job_repo.create(f"j{i}", "e1")
        assert len(job_repo.list_by_entity("e1", limit=3)) == 3


# --------------------------------------------------------------------------
# SnapshotRepository
# --------------------------------------------------------------------------


class TestSnapshotRepository:
    def _make_snapshot(self, snapshot_id="snap-1", entity_id="e1", **overrides):
        base = {
            "snapshot_id": snapshot_id,
            "entity_id": entity_id,
            "job_id": "job-1",
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "total_reviews": 42,
            "avg_rating": 0.72,
            "negative_count": 5,
            "low_rating_ratio": 0.12,
            "channels": ["mock", "csv"],
            "summary_text": "전반적으로 긍정적이나 배터리 불만 증가",
            "dashboard": {
                "action_items": [{"priority": 1, "issue": "배터리"}],
                "recurring_issues": [],
                "flagged_reviews": [],
            },
        }
        base.update(overrides)
        return base

    def test_save_and_list(self, snapshot_repo):
        snapshot_repo.save(self._make_snapshot("s1", "e1"))
        snapshot_repo.save(self._make_snapshot("s2", "e1"))
        results = snapshot_repo.list_by_entity("e1")
        assert len(results) == 2

    def test_get_latest(self, snapshot_repo):
        snapshot_repo.save(
            self._make_snapshot("s1", "e1", captured_at="2026-01-01T00:00:00Z")
        )
        snapshot_repo.save(
            self._make_snapshot("s2", "e1", captured_at="2026-01-02T00:00:00Z")
        )
        latest = snapshot_repo.get_latest("e1")
        assert latest is not None
        assert latest["snapshot_id"] == "s2"

    def test_get_latest_nonexistent(self, snapshot_repo):
        assert snapshot_repo.get_latest("nonexistent") is None

    def test_dashboard_json_roundtrip(self, snapshot_repo):
        dashboard = {
            "action_items": [{"priority": 1, "issue": "배터리 소모"}],
            "recurring_issues": [{"issue": "충전 느림", "frequency": "high"}],
            "flagged_reviews": [],
        }
        snapshot_repo.save(self._make_snapshot("s1", dashboard=dashboard))
        result = snapshot_repo.get_latest("e1")
        assert result["dashboard"] == dashboard

    def test_null_dashboard(self, snapshot_repo):
        snapshot_repo.save(self._make_snapshot("s1", dashboard=None))
        result = snapshot_repo.get_latest("e1")
        assert result["dashboard"] is None

    def test_channels_roundtrip(self, snapshot_repo):
        snapshot_repo.save(self._make_snapshot("s1", channels=["naver", "csv"]))
        result = snapshot_repo.get_latest("e1")
        assert result["channels"] == ["naver", "csv"]

    def test_list_respects_limit(self, snapshot_repo):
        for i in range(5):
            snapshot_repo.save(self._make_snapshot(f"s{i}"))
        assert len(snapshot_repo.list_by_entity("e1", limit=3)) == 3
