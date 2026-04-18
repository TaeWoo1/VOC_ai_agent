"""baseline — capture existing SQLite schema

Revision ID: 0001_baseline
Revises:
Create Date: 2026-04-18

PR 1 baseline migration.  Captures the EXACT schema currently created by
`src/voc/persistence/migrations.py::init_db()`.

Implementation notes:
  - DDL is reproduced verbatim from `_SCHEMA_SQL` in migrations.py via
    op.execute() rather than op.create_table(). This guarantees byte-identical
    output (no SQLAlchemy type-rendering differences) so a future cutover from
    the legacy init_db() path to alembic-managed schema is risk-free.
  - `IF NOT EXISTS` is dropped because Alembic owns the lifecycle from here on
    and uses its own version table to decide what to apply.
  - Indexes / FKs are not present in the existing schema and are NOT added
    here — additive changes belong in later migrations.
  - WAL pragma (`PRAGMA journal_mode=WAL`) is a runtime connection setting,
    not schema, and lives in init_db()/session.py — not in this migration.

Downgrade drops the four tables in reverse-creation order.
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001_baseline"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_ENTITIES_DDL = """
CREATE TABLE entities (
    entity_id         TEXT PRIMARY KEY,
    tenant_id         TEXT NOT NULL DEFAULT 'default',
    entity_type       TEXT NOT NULL,
    display_name      TEXT NOT NULL,
    description       TEXT DEFAULT '',
    product_keywords  TEXT NOT NULL,
    connector         TEXT DEFAULT 'mock',
    metadata_json     TEXT DEFAULT '{}',
    created_at        TEXT NOT NULL,
    last_refreshed_at TEXT,
    refresh_count     INTEGER DEFAULT 0
)
"""

_SYNC_JOBS_DDL = """
CREATE TABLE sync_jobs (
    job_id          TEXT PRIMARY KEY,
    entity_id       TEXT NOT NULL,
    job_type        TEXT NOT NULL DEFAULT 'refresh',
    status          TEXT NOT NULL,
    started_at      TEXT NOT NULL,
    finished_at     TEXT,
    total_collected INTEGER DEFAULT 0,
    total_indexed   INTEGER DEFAULT 0,
    stages_json     TEXT,
    errors_json     TEXT DEFAULT '[]',
    metadata_json   TEXT DEFAULT '{}'
)
"""

_SOURCE_CONNECTIONS_DDL = """
CREATE TABLE source_connections (
    connection_id     TEXT PRIMARY KEY,
    entity_id         TEXT NOT NULL,
    connector_type    TEXT NOT NULL,
    source_type       TEXT NOT NULL DEFAULT 'owned',
    display_name      TEXT NOT NULL,
    status            TEXT NOT NULL DEFAULT 'active',
    config_json       TEXT DEFAULT '{}',
    capabilities_json TEXT DEFAULT '{}',
    last_synced_at    TEXT,
    error_message     TEXT,
    created_at        TEXT NOT NULL
)
"""

_SNAPSHOTS_DDL = """
CREATE TABLE snapshots (
    snapshot_id       TEXT PRIMARY KEY,
    entity_id         TEXT NOT NULL,
    job_id            TEXT,
    captured_at       TEXT NOT NULL,
    total_reviews     INTEGER,
    avg_rating        REAL,
    negative_count    INTEGER,
    low_rating_ratio  REAL,
    channels_json     TEXT,
    summary_text      TEXT,
    dashboard_json    TEXT
)
"""


def upgrade() -> None:
    op.execute(_ENTITIES_DDL)
    op.execute(_SYNC_JOBS_DDL)
    op.execute(_SOURCE_CONNECTIONS_DDL)
    op.execute(_SNAPSHOTS_DDL)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS snapshots")
    op.execute("DROP TABLE IF EXISTS source_connections")
    op.execute("DROP TABLE IF EXISTS sync_jobs")
    op.execute("DROP TABLE IF EXISTS entities")
