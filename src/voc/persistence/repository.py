"""SQLite-backed repositories for entities, sync jobs, and snapshots.

Each repository is pure data access — no business logic, no pipeline calls.
The interface mirrors the in-memory EntityStore so that MonitoringService
(which only calls .get()) works without changes.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone


class EntityRepository:
    """Persistent entity store — drop-in replacement for EntityStore."""

    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def save(self, entity_id: str, record: dict) -> None:
        self._conn.execute(
            """INSERT INTO entities
               (entity_id, tenant_id, entity_type, display_name, description,
                product_keywords, connector, metadata_json, created_at,
                last_refreshed_at, refresh_count)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                entity_id,
                record.get("tenant_id", "default"),
                record.get("entity_type", "product"),
                record["display_name"],
                record.get("description", ""),
                json.dumps(record["product_keywords"], ensure_ascii=False),
                record.get("connector", "mock"),
                json.dumps(record.get("metadata", {}), ensure_ascii=False),
                record["created_at"],
                record.get("last_refreshed_at"),
                record.get("refresh_count", 0),
            ),
        )
        self._conn.commit()

    def get(self, entity_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM entities WHERE entity_id = ?", (entity_id,)
        ).fetchone()
        if row is None:
            return None
        return self._row_to_dict(row)

    def list_all(self, tenant_id: str = "default") -> list[dict]:
        rows = self._conn.execute(
            "SELECT * FROM entities WHERE tenant_id = ? ORDER BY created_at DESC",
            (tenant_id,),
        ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def update(self, entity_id: str, updates: dict) -> dict | None:
        entity = self.get(entity_id)
        if entity is None:
            return None
        entity.update(updates)
        self._conn.execute(
            """UPDATE entities SET
               tenant_id = ?, entity_type = ?, display_name = ?, description = ?,
               product_keywords = ?, connector = ?, metadata_json = ?,
               last_refreshed_at = ?, refresh_count = ?
               WHERE entity_id = ?""",
            (
                entity.get("tenant_id", "default"),
                entity.get("entity_type", "product"),
                entity["display_name"],
                entity.get("description", ""),
                json.dumps(entity["product_keywords"], ensure_ascii=False),
                entity.get("connector", "mock"),
                json.dumps(entity.get("metadata", {}), ensure_ascii=False),
                entity.get("last_refreshed_at"),
                entity.get("refresh_count", 0),
                entity_id,
            ),
        )
        self._conn.commit()
        return self.get(entity_id)

    def delete(self, entity_id: str) -> bool:
        cursor = self._conn.execute(
            "DELETE FROM entities WHERE entity_id = ?", (entity_id,)
        )
        self._conn.commit()
        return cursor.rowcount > 0

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict:
        d = dict(row)
        d["product_keywords"] = json.loads(d["product_keywords"])
        d["metadata"] = json.loads(d.pop("metadata_json"))
        return d


class SyncJobRepository:
    """Persistent sync job store for refresh history and future job types."""

    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def create(
        self,
        job_id: str,
        entity_id: str,
        job_type: str = "refresh",
        status: str = "pending",
        started_at: str | None = None,
    ) -> None:
        if started_at is None:
            started_at = datetime.now(timezone.utc).isoformat()
        self._conn.execute(
            """INSERT INTO sync_jobs
               (job_id, entity_id, job_type, status, started_at)
               VALUES (?, ?, ?, ?, ?)""",
            (job_id, entity_id, job_type, status, started_at),
        )
        self._conn.commit()

    def start(self, job_id: str) -> None:
        self._conn.execute(
            "UPDATE sync_jobs SET status = 'running' WHERE job_id = ?",
            (job_id,),
        )
        self._conn.commit()

    def complete(
        self,
        job_id: str,
        status: str,
        finished_at: str | None = None,
        total_collected: int = 0,
        total_indexed: int = 0,
        stages_json: str = "[]",
        errors_json: str = "[]",
    ) -> None:
        if finished_at is None:
            finished_at = datetime.now(timezone.utc).isoformat()
        self._conn.execute(
            """UPDATE sync_jobs SET
               status = ?, finished_at = ?, total_collected = ?,
               total_indexed = ?, stages_json = ?, errors_json = ?
               WHERE job_id = ?""",
            (status, finished_at, total_collected, total_indexed,
             stages_json, errors_json, job_id),
        )
        self._conn.commit()

    def get(self, job_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM sync_jobs WHERE job_id = ?", (job_id,)
        ).fetchone()
        if row is None:
            return None
        return self._row_to_dict(row)

    def list_by_entity(
        self, entity_id: str, job_type: str | None = None, limit: int = 20
    ) -> list[dict]:
        if job_type:
            rows = self._conn.execute(
                """SELECT * FROM sync_jobs
                   WHERE entity_id = ? AND job_type = ?
                   ORDER BY started_at DESC LIMIT ?""",
                (entity_id, job_type, limit),
            ).fetchall()
        else:
            rows = self._conn.execute(
                """SELECT * FROM sync_jobs
                   WHERE entity_id = ?
                   ORDER BY started_at DESC LIMIT ?""",
                (entity_id, limit),
            ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict:
        d = dict(row)
        if d.get("stages_json"):
            d["stages"] = json.loads(d.pop("stages_json"))
        else:
            d["stages"] = []
            d.pop("stages_json", None)
        if d.get("errors_json"):
            d["errors"] = json.loads(d.pop("errors_json"))
        else:
            d["errors"] = []
            d.pop("errors_json", None)
        if d.get("metadata_json"):
            d["metadata"] = json.loads(d.pop("metadata_json"))
        else:
            d["metadata"] = {}
            d.pop("metadata_json", None)
        return d


class SourceConnectionRepository:
    """Persistent source connection store for entity-to-source linkage."""

    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def save(self, record: dict) -> None:
        self._conn.execute(
            """INSERT INTO source_connections
               (connection_id, entity_id, connector_type, source_type,
                display_name, status, config_json, capabilities_json,
                last_synced_at, error_message, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                record["connection_id"],
                record["entity_id"],
                record["connector_type"],
                record.get("source_type", "owned"),
                record["display_name"],
                record.get("status", "active"),
                json.dumps(record.get("config", {}), ensure_ascii=False),
                json.dumps(record.get("capabilities", {}), ensure_ascii=False),
                record.get("last_synced_at"),
                record.get("error_message"),
                record["created_at"],
            ),
        )
        self._conn.commit()

    def get(self, connection_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM source_connections WHERE connection_id = ?",
            (connection_id,),
        ).fetchone()
        if row is None:
            return None
        return self._row_to_dict(row)

    def list_by_entity(self, entity_id: str, status: str | None = None) -> list[dict]:
        if status:
            rows = self._conn.execute(
                """SELECT * FROM source_connections
                   WHERE entity_id = ? AND status = ?
                   ORDER BY created_at""",
                (entity_id, status),
            ).fetchall()
        else:
            rows = self._conn.execute(
                """SELECT * FROM source_connections
                   WHERE entity_id = ?
                   ORDER BY created_at""",
                (entity_id,),
            ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def update(self, connection_id: str, updates: dict) -> dict | None:
        conn = self.get(connection_id)
        if conn is None:
            return None
        conn.update(updates)
        self._conn.execute(
            """UPDATE source_connections SET
               status = ?, config_json = ?, capabilities_json = ?,
               last_synced_at = ?, error_message = ?, display_name = ?
               WHERE connection_id = ?""",
            (
                conn.get("status", "active"),
                json.dumps(conn.get("config", {}), ensure_ascii=False),
                json.dumps(conn.get("capabilities", {}), ensure_ascii=False),
                conn.get("last_synced_at"),
                conn.get("error_message"),
                conn["display_name"],
                connection_id,
            ),
        )
        self._conn.commit()
        return self.get(connection_id)

    def delete(self, connection_id: str) -> bool:
        cursor = self._conn.execute(
            "DELETE FROM source_connections WHERE connection_id = ?",
            (connection_id,),
        )
        self._conn.commit()
        return cursor.rowcount > 0

    def find_by_entity_and_type(
        self, entity_id: str, connector_type: str
    ) -> dict | None:
        row = self._conn.execute(
            """SELECT * FROM source_connections
               WHERE entity_id = ? AND connector_type = ?
               LIMIT 1""",
            (entity_id, connector_type),
        ).fetchone()
        if row is None:
            return None
        return self._row_to_dict(row)

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict:
        d = dict(row)
        if d.get("config_json"):
            d["config"] = json.loads(d.pop("config_json"))
        else:
            d["config"] = {}
            d.pop("config_json", None)
        if d.get("capabilities_json"):
            d["capabilities"] = json.loads(d.pop("capabilities_json"))
        else:
            d["capabilities"] = {}
            d.pop("capabilities_json", None)
        return d


class SnapshotRepository:
    """Persistent snapshot store for historical monitoring state."""

    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def save(self, snapshot: dict) -> None:
        self._conn.execute(
            """INSERT INTO snapshots
               (snapshot_id, entity_id, job_id, captured_at,
                total_reviews, avg_rating, negative_count, low_rating_ratio,
                channels_json, summary_text, dashboard_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                snapshot["snapshot_id"],
                snapshot["entity_id"],
                snapshot.get("job_id"),
                snapshot["captured_at"],
                snapshot.get("total_reviews"),
                snapshot.get("avg_rating"),
                snapshot.get("negative_count"),
                snapshot.get("low_rating_ratio"),
                json.dumps(snapshot.get("channels", []), ensure_ascii=False),
                snapshot.get("summary_text"),
                json.dumps(snapshot.get("dashboard"), ensure_ascii=False)
                if snapshot.get("dashboard") is not None else None,
            ),
        )
        self._conn.commit()

    def list_by_entity(self, entity_id: str, limit: int = 20) -> list[dict]:
        rows = self._conn.execute(
            """SELECT * FROM snapshots
               WHERE entity_id = ?
               ORDER BY captured_at DESC LIMIT ?""",
            (entity_id, limit),
        ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def get_latest(self, entity_id: str) -> dict | None:
        row = self._conn.execute(
            """SELECT * FROM snapshots
               WHERE entity_id = ?
               ORDER BY captured_at DESC LIMIT 1""",
            (entity_id,),
        ).fetchone()
        if row is None:
            return None
        return self._row_to_dict(row)

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict:
        d = dict(row)
        if d.get("channels_json"):
            d["channels"] = json.loads(d.pop("channels_json"))
        else:
            d["channels"] = []
            d.pop("channels_json", None)
        if d.get("dashboard_json"):
            d["dashboard"] = json.loads(d.pop("dashboard_json"))
        else:
            d["dashboard"] = None
            d.pop("dashboard_json", None)
        return d
