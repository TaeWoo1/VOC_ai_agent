"""Unit tests for SourceConnectionRepository."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from src.voc.persistence.migrations import init_db
from src.voc.persistence.repository import SourceConnectionRepository


@pytest.fixture
def db():
    return init_db(":memory:")


@pytest.fixture
def repo(db):
    return SourceConnectionRepository(db)


def _make_record(connection_id="conn-1", entity_id="e1", **overrides):
    base = {
        "connection_id": connection_id,
        "entity_id": entity_id,
        "connector_type": "csv",
        "source_type": "owned",
        "display_name": "CSV 업로드",
        "status": "active",
        "config": {"file_path": "/uploads/e1/reviews.csv"},
        "capabilities": {"sync_mode": "manual", "requires_upload": True},
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    base.update(overrides)
    return base


class TestSourceConnectionRepository:
    def test_save_and_get(self, repo):
        repo.save(_make_record())
        result = repo.get("conn-1")
        assert result is not None
        assert result["connection_id"] == "conn-1"
        assert result["entity_id"] == "e1"
        assert result["connector_type"] == "csv"
        assert result["config"]["file_path"] == "/uploads/e1/reviews.csv"
        assert result["capabilities"]["sync_mode"] == "manual"

    def test_get_nonexistent(self, repo):
        assert repo.get("nonexistent") is None

    def test_list_by_entity(self, repo):
        repo.save(_make_record("c1", "e1"))
        repo.save(_make_record("c2", "e1"))
        repo.save(_make_record("c3", "e2"))
        assert len(repo.list_by_entity("e1")) == 2
        assert len(repo.list_by_entity("e2")) == 1

    def test_list_by_entity_with_status_filter(self, repo):
        repo.save(_make_record("c1", "e1", status="active"))
        repo.save(_make_record("c2", "e1", status="inactive"))
        assert len(repo.list_by_entity("e1", status="active")) == 1
        assert len(repo.list_by_entity("e1", status="inactive")) == 1

    def test_update(self, repo):
        repo.save(_make_record())
        updated = repo.update("conn-1", {
            "status": "error",
            "error_message": "File not found",
        })
        assert updated is not None
        assert updated["status"] == "error"
        assert updated["error_message"] == "File not found"

    def test_update_nonexistent(self, repo):
        assert repo.update("nonexistent", {"status": "error"}) is None

    def test_update_config(self, repo):
        repo.save(_make_record())
        updated = repo.update("conn-1", {
            "config": {"file_path": "/new/path.csv", "row_count": 42},
        })
        assert updated["config"]["file_path"] == "/new/path.csv"
        assert updated["config"]["row_count"] == 42

    def test_delete(self, repo):
        repo.save(_make_record())
        assert repo.delete("conn-1") is True
        assert repo.get("conn-1") is None

    def test_delete_nonexistent(self, repo):
        assert repo.delete("nonexistent") is False

    def test_find_by_entity_and_type(self, repo):
        repo.save(_make_record("c1", "e1", connector_type="csv"))
        repo.save(_make_record("c2", "e1", connector_type="mock"))
        result = repo.find_by_entity_and_type("e1", "csv")
        assert result is not None
        assert result["connector_type"] == "csv"

    def test_find_by_entity_and_type_not_found(self, repo):
        repo.save(_make_record("c1", "e1", connector_type="csv"))
        assert repo.find_by_entity_and_type("e1", "naver") is None

    def test_config_roundtrip(self, repo):
        config = {
            "file_path": "/uploads/e1/data.csv",
            "filename": "data.csv",
            "row_count": 150,
        }
        repo.save(_make_record(config=config))
        result = repo.get("conn-1")
        assert result["config"] == config

    def test_capabilities_roundtrip(self, repo):
        caps = {
            "sync_mode": "api_pull",
            "data_format": "api_json",
            "supports_incremental": True,
            "requires_upload": False,
            "requires_auth": True,
        }
        repo.save(_make_record(capabilities=caps))
        result = repo.get("conn-1")
        assert result["capabilities"] == caps
