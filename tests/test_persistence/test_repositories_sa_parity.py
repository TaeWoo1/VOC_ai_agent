"""SA repository ↔ legacy repository behavior parity tests.

For every public method on every legacy sqlite3 repository, we assert that
the SQLAlchemy mirror yields identical observable behavior against the
same SQLite database file.  Both code paths share one DB; the legacy repo
opens it via stdlib ``sqlite3`` while the SA repo opens it via async
``aiosqlite`` + SQLAlchemy 2.0.

Skips cleanly when SaaS-evolution deps (sqlalchemy / aiosqlite) aren't
installed in the active env — see PR 2 plan checkpoint for the rationale.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

pytest.importorskip("sqlalchemy")
pytest.importorskip("aiosqlite")

from src.voc.persistence.migrations import init_db  # noqa: E402
from src.voc.persistence.repository import (  # noqa: E402
    EntityRepository,
    SnapshotRepository,
    SourceConnectionRepository,
    SyncJobRepository,
)
from src.voc.persistence.repositories.entity_repo_sa import EntityRepositorySA  # noqa: E402
from src.voc.persistence.repositories.snapshot_repo_sa import SnapshotRepositorySA  # noqa: E402
from src.voc.persistence.repositories.source_connection_repo_sa import (  # noqa: E402
    SourceConnectionRepositorySA,
)
from src.voc.persistence.repositories.sync_job_repo_sa import SyncJobRepositorySA  # noqa: E402
from src.voc.persistence.session import make_engine, make_session_factory  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures: shared SQLite file, both legacy and SA repos against it.
# ---------------------------------------------------------------------------


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    """Fresh SQLite file per test, schema applied via legacy init_db."""
    p = tmp_path / "parity.db"
    conn = init_db(str(p))
    conn.close()
    return p


@pytest.fixture
def legacy_conn(db_path: Path):
    """Sync sqlite3 connection for the legacy repos."""
    import sqlite3

    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()


@pytest.fixture
async def sa_factory(db_path: Path):
    """Async SQLAlchemy session factory for the SA repos."""
    engine = make_engine(f"sqlite+aiosqlite:///{db_path}")
    factory = make_session_factory(engine)
    yield factory
    await engine.dispose()


@pytest.fixture
def legacy_repos(legacy_conn) -> dict:
    return {
        "entity": EntityRepository(legacy_conn),
        "sync_job": SyncJobRepository(legacy_conn),
        "source_connection": SourceConnectionRepository(legacy_conn),
        "snapshot": SnapshotRepository(legacy_conn),
    }


@pytest.fixture
def sa_repos(sa_factory) -> dict:
    return {
        "entity": EntityRepositorySA(sa_factory),
        "sync_job": SyncJobRepositorySA(sa_factory),
        "source_connection": SourceConnectionRepositorySA(sa_factory),
        "snapshot": SnapshotRepositorySA(sa_factory),
    }


# ---------------------------------------------------------------------------
# Record builders: produce well-formed input dicts for each repo.
# ---------------------------------------------------------------------------


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def make_entity_record(entity_id: str = "e1", **overrides) -> dict:
    base = {
        "tenant_id": "default",
        "entity_type": "product",
        "display_name": "Test Entity",
        "description": "an entity for parity",
        "product_keywords": ["alpha", "beta", "한글"],
        "connector": "mock",
        "metadata": {"source": "test", "extras": {"k": 1}},
        "created_at": _now(),
        "last_refreshed_at": None,
        "refresh_count": 0,
    }
    base.update(overrides)
    base["entity_id"] = entity_id  # for completeness, though save() takes id separately
    return base


def make_source_connection_record(connection_id: str = "c1", entity_id: str = "e1", **overrides) -> dict:
    base = {
        "connection_id": connection_id,
        "entity_id": entity_id,
        "connector_type": "csv",
        "source_type": "owned",
        "display_name": "Test Source",
        "status": "active",
        "config": {"file_path": "./uploads/foo.csv"},
        "capabilities": {"supports_replies": False},
        "last_synced_at": None,
        "error_message": None,
        "created_at": _now(),
    }
    base.update(overrides)
    return base


def make_snapshot_record(snapshot_id: str = "s1", entity_id: str = "e1", **overrides) -> dict:
    base = {
        "snapshot_id": snapshot_id,
        "entity_id": entity_id,
        "job_id": None,
        "captured_at": _now(),
        "total_reviews": 10,
        "avg_rating": 4.2,
        "negative_count": 1,
        "low_rating_ratio": 0.1,
        "channels": [{"name": "csv", "count": 10}],
        "summary_text": "summary",
        "dashboard": {"alerts": []},
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# EntityRepository parity (5 methods)
# ---------------------------------------------------------------------------


async def test_entity_save_then_get_parity(legacy_repos, sa_repos):
    """save via legacy → get via both → identical dict."""
    rec = make_entity_record("e1")
    legacy_repos["entity"].save("e1", rec)

    legacy_view = legacy_repos["entity"].get("e1")
    sa_view = await sa_repos["entity"].get("e1")

    assert legacy_view == sa_view
    # Explicit shape checks: column rename + JSON parse occurred.
    assert "metadata" in sa_view and "metadata_json" not in sa_view
    assert sa_view["metadata"] == {"source": "test", "extras": {"k": 1}}
    assert sa_view["product_keywords"] == ["alpha", "beta", "한글"]


async def test_entity_save_via_sa_then_get_via_legacy(legacy_repos, sa_repos):
    """save via SA → get via both → identical dict."""
    rec = make_entity_record("e2")
    await sa_repos["entity"].save("e2", rec)

    legacy_view = legacy_repos["entity"].get("e2")
    sa_view = await sa_repos["entity"].get("e2")

    assert legacy_view == sa_view
    # Shape parity: legacy view includes the column-rename + parse.
    assert legacy_view["metadata"] == {"source": "test", "extras": {"k": 1}}


async def test_entity_get_missing_returns_none(legacy_repos, sa_repos):
    assert legacy_repos["entity"].get("nope") is None
    assert await sa_repos["entity"].get("nope") is None


async def test_entity_list_all_parity(legacy_repos, sa_repos):
    """list_all orders by created_at DESC; both paths agree."""
    # Insert 3 entities with deterministically-ordered timestamps.
    for i, name in enumerate(["A", "B", "C"]):
        rec = make_entity_record(
            f"e{i}", display_name=name, created_at=f"2026-04-19T0{i}:00:00+00:00"
        )
        legacy_repos["entity"].save(rec["entity_id"], rec)

    legacy_list = legacy_repos["entity"].list_all()
    sa_list = await sa_repos["entity"].list_all()

    assert legacy_list == sa_list
    # Most recent (C) first per ORDER BY created_at DESC.
    assert [r["display_name"] for r in legacy_list] == ["C", "B", "A"]


async def test_entity_list_all_filters_by_tenant(legacy_repos, sa_repos):
    legacy_repos["entity"].save("e_def", make_entity_record("e_def"))
    legacy_repos["entity"].save(
        "e_other", make_entity_record("e_other", tenant_id="other_tenant")
    )

    legacy_default = legacy_repos["entity"].list_all()
    sa_default = await sa_repos["entity"].list_all()
    legacy_other = legacy_repos["entity"].list_all(tenant_id="other_tenant")
    sa_other = await sa_repos["entity"].list_all(tenant_id="other_tenant")

    assert legacy_default == sa_default
    assert legacy_other == sa_other
    assert {r["entity_id"] for r in legacy_default} == {"e_def"}
    assert {r["entity_id"] for r in legacy_other} == {"e_other"}


async def test_entity_update_parity_mutual(legacy_repos, sa_repos):
    """Update via legacy then SA, observe each other's changes."""
    rec = make_entity_record("e1", display_name="Original")
    legacy_repos["entity"].save("e1", rec)

    # Update via legacy
    legacy_updated = legacy_repos["entity"].update("e1", {"display_name": "Mid", "refresh_count": 5})
    sa_view = await sa_repos["entity"].get("e1")
    assert legacy_updated == sa_view
    assert legacy_updated["display_name"] == "Mid"
    assert legacy_updated["refresh_count"] == 5

    # Update via SA
    sa_updated = await sa_repos["entity"].update("e1", {"display_name": "Final"})
    legacy_view = legacy_repos["entity"].get("e1")
    assert sa_updated == legacy_view
    assert sa_updated["display_name"] == "Final"
    assert sa_updated["refresh_count"] == 5  # carried over via merge-then-write


async def test_entity_update_missing_returns_none(legacy_repos, sa_repos):
    assert legacy_repos["entity"].update("nope", {"display_name": "x"}) is None
    assert await sa_repos["entity"].update("nope", {"display_name": "x"}) is None


async def test_entity_delete_parity(legacy_repos, sa_repos):
    """Delete returns True on first call, False on repeat — both paths agree."""
    legacy_repos["entity"].save("e1", make_entity_record("e1"))

    # Legacy deletes; SA confirms gone.
    assert legacy_repos["entity"].delete("e1") is True
    assert legacy_repos["entity"].delete("e1") is False
    assert await sa_repos["entity"].delete("e1") is False

    # Re-insert; SA deletes; legacy confirms gone.
    legacy_repos["entity"].save("e1", make_entity_record("e1"))
    assert await sa_repos["entity"].delete("e1") is True
    assert legacy_repos["entity"].get("e1") is None


# ---------------------------------------------------------------------------
# SyncJobRepository parity (5 methods)
# ---------------------------------------------------------------------------


async def test_sync_job_create_then_get_default_coalescing(legacy_repos, sa_repos):
    """create() inserts SQL defaults; get() coalesces via _row_to_dict."""
    legacy_repos["sync_job"].create("j1", "e1")

    legacy_view = legacy_repos["sync_job"].get("j1")
    sa_view = await sa_repos["sync_job"].get("j1")

    assert legacy_view == sa_view
    # Default coalescing rules per repo:
    # stages_json column has no SQL default → row is NULL → "stages" coalesces to []
    assert sa_view["stages"] == []
    # errors_json default '[]' (truthy) → parsed → []
    assert sa_view["errors"] == []
    # metadata_json default '{}' (truthy) → parsed → {}
    assert sa_view["metadata"] == {}
    # Renamed keys present, originals absent.
    assert "stages_json" not in sa_view
    assert "errors_json" not in sa_view
    assert "metadata_json" not in sa_view
    # Default status from create()
    assert sa_view["status"] == "pending"
    assert sa_view["job_type"] == "refresh"
    # started_at is auto-generated ISO string when omitted
    assert isinstance(sa_view["started_at"], str)
    datetime.fromisoformat(sa_view["started_at"])  # parses cleanly


async def test_sync_job_create_via_sa(legacy_repos, sa_repos):
    """Symmetric: create via SA, both paths see it."""
    await sa_repos["sync_job"].create("j2", "e1", job_type="refresh", status="pending")

    legacy_view = legacy_repos["sync_job"].get("j2")
    sa_view = await sa_repos["sync_job"].get("j2")
    assert legacy_view == sa_view


async def test_sync_job_start_parity(legacy_repos, sa_repos):
    legacy_repos["sync_job"].create("j1", "e1")
    legacy_repos["sync_job"].start("j1")

    sa_view = await sa_repos["sync_job"].get("j1")
    assert sa_view["status"] == "running"

    # Reset and try via SA
    legacy_repos["sync_job"].create("j2", "e1")
    await sa_repos["sync_job"].start("j2")

    legacy_view = legacy_repos["sync_job"].get("j2")
    assert legacy_view["status"] == "running"


async def test_sync_job_complete_writes_six_fields_not_metadata(legacy_repos, sa_repos):
    """complete() updates 6 fields but leaves metadata_json untouched (legacy quirk)."""
    legacy_repos["sync_job"].create("j1", "e1")
    # Inject metadata via raw SQL to verify complete() doesn't clear it.
    legacy_repos["sync_job"]._conn.execute(
        "UPDATE sync_jobs SET metadata_json = ? WHERE job_id = ?",
        (json.dumps({"injected": True}), "j1"),
    )
    legacy_repos["sync_job"]._conn.commit()

    # Complete via SA — passes JSON strings through verbatim.
    await sa_repos["sync_job"].complete(
        "j1",
        status="completed",
        total_collected=5,
        total_indexed=4,
        stages_json=json.dumps([{"stage": "ingest", "ok": True}]),
        errors_json=json.dumps([]),
    )

    legacy_view = legacy_repos["sync_job"].get("j1")
    sa_view = await sa_repos["sync_job"].get("j1")

    assert legacy_view == sa_view
    assert legacy_view["status"] == "completed"
    assert legacy_view["total_collected"] == 5
    assert legacy_view["total_indexed"] == 4
    assert legacy_view["stages"] == [{"stage": "ingest", "ok": True}]
    assert legacy_view["errors"] == []
    # metadata preserved — complete() did not clear it.
    assert legacy_view["metadata"] == {"injected": True}
    assert isinstance(legacy_view["finished_at"], str)
    datetime.fromisoformat(legacy_view["finished_at"])


async def test_sync_job_list_by_entity_parity(legacy_repos, sa_repos):
    """list_by_entity orders by started_at DESC and supports job_type filter."""
    legacy_repos["sync_job"].create("j1", "e1", started_at="2026-04-19T01:00:00+00:00")
    legacy_repos["sync_job"].create("j2", "e1", started_at="2026-04-19T02:00:00+00:00")
    legacy_repos["sync_job"].create("j3", "e1", job_type="import", started_at="2026-04-19T03:00:00+00:00")
    legacy_repos["sync_job"].create("j4", "e2", started_at="2026-04-19T04:00:00+00:00")

    legacy_all = legacy_repos["sync_job"].list_by_entity("e1")
    sa_all = await sa_repos["sync_job"].list_by_entity("e1")
    assert legacy_all == sa_all
    # DESC ordering
    assert [r["job_id"] for r in sa_all] == ["j3", "j2", "j1"]

    legacy_refresh = legacy_repos["sync_job"].list_by_entity("e1", job_type="refresh")
    sa_refresh = await sa_repos["sync_job"].list_by_entity("e1", job_type="refresh")
    assert legacy_refresh == sa_refresh
    assert [r["job_id"] for r in sa_refresh] == ["j2", "j1"]

    legacy_limited = legacy_repos["sync_job"].list_by_entity("e1", limit=2)
    sa_limited = await sa_repos["sync_job"].list_by_entity("e1", limit=2)
    assert legacy_limited == sa_limited
    assert len(sa_limited) == 2


async def test_sync_job_get_missing(legacy_repos, sa_repos):
    assert legacy_repos["sync_job"].get("nope") is None
    assert await sa_repos["sync_job"].get("nope") is None


# ---------------------------------------------------------------------------
# SourceConnectionRepository parity (6 methods)
# ---------------------------------------------------------------------------


async def test_source_connection_save_then_get_parity(legacy_repos, sa_repos):
    rec = make_source_connection_record("c1", "e1")
    legacy_repos["source_connection"].save(rec)

    legacy_view = legacy_repos["source_connection"].get("c1")
    sa_view = await sa_repos["source_connection"].get("c1")

    assert legacy_view == sa_view
    # Shape: config_json/capabilities_json columns renamed + parsed.
    assert "config_json" not in sa_view
    assert "capabilities_json" not in sa_view
    assert sa_view["config"] == {"file_path": "./uploads/foo.csv"}
    assert sa_view["capabilities"] == {"supports_replies": False}


async def test_source_connection_list_by_entity_orders_ascending(legacy_repos, sa_repos):
    """Verifies ASCENDING created_at ordering — distinct from EntityRepository."""
    legacy_repos["source_connection"].save(
        make_source_connection_record("c1", "e1", created_at="2026-04-19T03:00:00+00:00")
    )
    legacy_repos["source_connection"].save(
        make_source_connection_record("c2", "e1", created_at="2026-04-19T01:00:00+00:00")
    )
    legacy_repos["source_connection"].save(
        make_source_connection_record("c3", "e1", created_at="2026-04-19T02:00:00+00:00")
    )

    legacy_list = legacy_repos["source_connection"].list_by_entity("e1")
    sa_list = await sa_repos["source_connection"].list_by_entity("e1")

    assert legacy_list == sa_list
    # ASC, not DESC.
    assert [r["connection_id"] for r in sa_list] == ["c2", "c3", "c1"]


async def test_source_connection_list_by_entity_status_filter(legacy_repos, sa_repos):
    legacy_repos["source_connection"].save(
        make_source_connection_record("c1", "e1", status="active")
    )
    legacy_repos["source_connection"].save(
        make_source_connection_record("c2", "e1", status="inactive")
    )

    legacy_active = legacy_repos["source_connection"].list_by_entity("e1", status="active")
    sa_active = await sa_repos["source_connection"].list_by_entity("e1", status="active")
    assert legacy_active == sa_active
    assert {r["connection_id"] for r in sa_active} == {"c1"}


async def test_source_connection_update_writes_only_six_fields(legacy_repos, sa_repos):
    """update() must NOT touch entity_id, connector_type, source_type, created_at."""
    rec = make_source_connection_record("c1", "e1", created_at="2026-04-19T01:00:00+00:00")
    legacy_repos["source_connection"].save(rec)

    # Attempt to update fields that update() does not write — they must NOT change.
    sa_updated = await sa_repos["source_connection"].update(
        "c1",
        {
            "status": "inactive",
            "config": {"new": "value"},
            "capabilities": {"feature": True},
            "last_synced_at": "2026-04-19T05:00:00+00:00",
            "error_message": "transient",
            "display_name": "Updated Name",
            # These should be IGNORED by update():
            "entity_id": "e_other",
            "connector_type": "json_import",
            "source_type": "public",
            "created_at": "1999-01-01T00:00:00+00:00",
        },
    )
    legacy_view = legacy_repos["source_connection"].get("c1")
    assert sa_updated == legacy_view
    # The 6 writeable fields changed:
    assert sa_updated["status"] == "inactive"
    assert sa_updated["config"] == {"new": "value"}
    assert sa_updated["capabilities"] == {"feature": True}
    assert sa_updated["last_synced_at"] == "2026-04-19T05:00:00+00:00"
    assert sa_updated["error_message"] == "transient"
    assert sa_updated["display_name"] == "Updated Name"
    # The non-writeable fields are unchanged:
    assert sa_updated["entity_id"] == "e1"
    assert sa_updated["connector_type"] == "csv"
    assert sa_updated["source_type"] == "owned"
    assert sa_updated["created_at"] == "2026-04-19T01:00:00+00:00"


async def test_source_connection_update_missing_returns_none(legacy_repos, sa_repos):
    assert legacy_repos["source_connection"].update("nope", {"status": "x"}) is None
    assert await sa_repos["source_connection"].update("nope", {"status": "x"}) is None


async def test_source_connection_delete_parity(legacy_repos, sa_repos):
    legacy_repos["source_connection"].save(make_source_connection_record("c1", "e1"))
    assert legacy_repos["source_connection"].delete("c1") is True
    assert await sa_repos["source_connection"].delete("c1") is False

    legacy_repos["source_connection"].save(make_source_connection_record("c1", "e1"))
    assert await sa_repos["source_connection"].delete("c1") is True
    assert legacy_repos["source_connection"].get("c1") is None


async def test_source_connection_find_by_entity_and_type_unique_match(legacy_repos, sa_repos):
    """Unique (entity_id, connector_type) match — both repos agree.

    NOTE: the legacy schema does NOT enforce uniqueness on (entity_id,
    connector_type), and ``find_by_entity_and_type`` has no ORDER BY.
    With multiple matches the behavior is implementation-defined; this
    test only covers the unambiguous single-match case.
    """
    legacy_repos["source_connection"].save(
        make_source_connection_record("c1", entity_id="e1", connector_type="csv")
    )
    legacy_repos["source_connection"].save(
        make_source_connection_record("c2", entity_id="e1", connector_type="json_import")
    )

    legacy_csv = legacy_repos["source_connection"].find_by_entity_and_type("e1", "csv")
    sa_csv = await sa_repos["source_connection"].find_by_entity_and_type("e1", "csv")
    assert legacy_csv == sa_csv
    assert legacy_csv["connection_id"] == "c1"

    legacy_miss = legacy_repos["source_connection"].find_by_entity_and_type("e1", "google_business")
    sa_miss = await sa_repos["source_connection"].find_by_entity_and_type("e1", "google_business")
    assert legacy_miss is None
    assert sa_miss is None


# ---------------------------------------------------------------------------
# SnapshotRepository parity (3 methods + None/{} edge case)
# ---------------------------------------------------------------------------


async def test_snapshot_save_then_list_parity(legacy_repos, sa_repos):
    rec = make_snapshot_record("s1", "e1")
    legacy_repos["snapshot"].save(rec)

    legacy_view = legacy_repos["snapshot"].list_by_entity("e1")
    sa_view = await sa_repos["snapshot"].list_by_entity("e1")

    assert legacy_view == sa_view
    assert len(sa_view) == 1
    snap = sa_view[0]
    # Column rename + JSON parse
    assert "channels_json" not in snap
    assert "dashboard_json" not in snap
    assert snap["channels"] == [{"name": "csv", "count": 10}]
    assert snap["dashboard"] == {"alerts": []}
    # Numeric type fidelity
    assert snap["total_reviews"] == 10
    assert snap["avg_rating"] == 4.2
    assert snap["negative_count"] == 1
    assert snap["low_rating_ratio"] == 0.1


async def test_snapshot_dashboard_none_round_trip(legacy_repos, sa_repos):
    """dashboard=None → SQL NULL → read back as None (NOT {})."""
    rec = make_snapshot_record("s_none", "e1", dashboard=None)
    legacy_repos["snapshot"].save(rec)

    legacy_view = legacy_repos["snapshot"].get_latest("e1")
    sa_view = await sa_repos["snapshot"].get_latest("e1")

    assert legacy_view == sa_view
    assert sa_view["dashboard"] is None  # NOT {}


async def test_snapshot_dashboard_empty_dict_round_trip(legacy_repos, sa_repos):
    """dashboard={} → '{}' string in DB → read back as {} (NOT None)."""
    rec = make_snapshot_record("s_empty", "e1", dashboard={})
    legacy_repos["snapshot"].save(rec)

    legacy_view = legacy_repos["snapshot"].get_latest("e1")
    sa_view = await sa_repos["snapshot"].get_latest("e1")

    assert legacy_view == sa_view
    assert sa_view["dashboard"] == {}  # NOT None
    # The None vs {} distinction is preserved end-to-end on both paths.


async def test_snapshot_dashboard_omitted_round_trip(legacy_repos, sa_repos):
    """dashboard key omitted from input dict → treated as None."""
    rec = make_snapshot_record("s_omit", "e1")
    rec.pop("dashboard")
    legacy_repos["snapshot"].save(rec)

    legacy_view = legacy_repos["snapshot"].get_latest("e1")
    sa_view = await sa_repos["snapshot"].get_latest("e1")

    assert legacy_view == sa_view
    assert sa_view["dashboard"] is None


async def test_snapshot_list_by_entity_orders_desc_with_limit(legacy_repos, sa_repos):
    legacy_repos["snapshot"].save(
        make_snapshot_record("s1", "e1", captured_at="2026-04-19T01:00:00+00:00")
    )
    legacy_repos["snapshot"].save(
        make_snapshot_record("s2", "e1", captured_at="2026-04-19T03:00:00+00:00")
    )
    legacy_repos["snapshot"].save(
        make_snapshot_record("s3", "e1", captured_at="2026-04-19T02:00:00+00:00")
    )

    legacy_all = legacy_repos["snapshot"].list_by_entity("e1")
    sa_all = await sa_repos["snapshot"].list_by_entity("e1")
    assert legacy_all == sa_all
    assert [r["snapshot_id"] for r in sa_all] == ["s2", "s3", "s1"]

    legacy_limited = legacy_repos["snapshot"].list_by_entity("e1", limit=1)
    sa_limited = await sa_repos["snapshot"].list_by_entity("e1", limit=1)
    assert legacy_limited == sa_limited
    assert len(sa_limited) == 1
    assert sa_limited[0]["snapshot_id"] == "s2"


async def test_snapshot_get_latest_parity(legacy_repos, sa_repos):
    legacy_repos["snapshot"].save(
        make_snapshot_record("s1", "e1", captured_at="2026-04-19T01:00:00+00:00")
    )
    legacy_repos["snapshot"].save(
        make_snapshot_record("s2", "e1", captured_at="2026-04-19T02:00:00+00:00")
    )

    legacy_latest = legacy_repos["snapshot"].get_latest("e1")
    sa_latest = await sa_repos["snapshot"].get_latest("e1")
    assert legacy_latest == sa_latest
    assert sa_latest["snapshot_id"] == "s2"

    assert legacy_repos["snapshot"].get_latest("nope") is None
    assert await sa_repos["snapshot"].get_latest("nope") is None
