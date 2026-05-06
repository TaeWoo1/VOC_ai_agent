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

-- Phase 1 (Coupang + OliveYoung bait report). Throwaway after Phase 2 cutover.
-- Lean schema by design: no FK, no UNIQUE on (channel, fingerprint), minimal NOT NULL.
-- Identity generators (review_id, content_fingerprint) match the future SA `reviews`
-- table so the Phase 2 migration is a 1:1 copy. Do not tighten constraints here.
CREATE TABLE IF NOT EXISTS phase1_reviews (
    review_id            TEXT PRIMARY KEY,
    source_channel       TEXT NOT NULL,
    source_method        TEXT NOT NULL,
    source_id            TEXT,
    source_url           TEXT,
    text                 TEXT NOT NULL,
    rating_normalized    REAL,
    rating_raw           REAL,
    review_date          TEXT,
    language             TEXT,
    content_fingerprint  TEXT NOT NULL,
    is_duplicate         INTEGER DEFAULT 0,
    duplicate_of         TEXT,
    product_keyword      TEXT,
    product_external_id  TEXT,
    channel_meta_json    TEXT,
    derived_json         TEXT,
    raw_metadata_json    TEXT,
    run_id               TEXT,
    collected_at         TEXT NOT NULL,
    ingested_at          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_phase1_reviews_channel
    ON phase1_reviews(source_channel);
CREATE INDEX IF NOT EXISTS ix_phase1_reviews_keyword
    ON phase1_reviews(product_keyword);
CREATE INDEX IF NOT EXISTS ix_phase1_reviews_date
    ON phase1_reviews(review_date);
CREATE INDEX IF NOT EXISTS ix_phase1_reviews_channel_fingerprint
    ON phase1_reviews(source_channel, content_fingerprint);

CREATE TABLE IF NOT EXISTS phase1_runs (
    run_id            TEXT PRIMARY KEY,
    channel           TEXT NOT NULL,
    requested_target  TEXT NOT NULL,
    started_at        TEXT NOT NULL,
    finished_at       TEXT,
    quality_status    TEXT NOT NULL,
    summary_json      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_phase1_runs_channel_started
    ON phase1_runs(channel, started_at);
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
