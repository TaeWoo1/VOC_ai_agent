"""Database initialization and schema creation."""

from __future__ import annotations

import sqlite3


_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS entities (
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
);

CREATE TABLE IF NOT EXISTS sync_jobs (
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
);

CREATE TABLE IF NOT EXISTS source_connections (
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
);

CREATE TABLE IF NOT EXISTS snapshots (
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
);
"""


def init_db(db_path: str) -> sqlite3.Connection:
    """Create database and tables if they don't exist.

    Returns a sqlite3.Connection with row_factory set to sqlite3.Row
    for dict-like access.
    """
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(_SCHEMA_SQL)
    return conn
