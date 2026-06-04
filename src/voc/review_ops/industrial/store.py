"""Local SQLite store for the industrial review-ops workspace (Slice A).

A small, self-contained persistence layer for the *local demo* workspace. It is
NOT SaaS persistence: single file, single local operator, stdlib ``sqlite3``
only. No external DB, no migrations framework, no ORM.

What it stores:
- ``uploads``       — one row per uploaded file (provenance + new-review count).
- ``reviews``       — one row per distinct review, keyed by the deterministic
                      ``review_id`` from ``normalize.py``. ``first_seen_upload_id``
                      is the basis of new-review detection across uploads.
- ``review_status`` — operator status/memo per review, keyed by ``review_id`` so
                      it survives re-uploads (the key is content/source-stable).
- ``issue_status``  — best-effort status/memo per repeated issue (wired later).
- ``issue_cache``   — cached repeated-issue discovery output keyed by a
                      deterministic cache key (see ``issue_cache.py``), so the
                      same file + scope + settings reuse the same result.
                      ``payload_json`` is opaque to this layer.
- ``chat_messages`` — one rolling local chat transcript (no embeddings here;
                      embeddings stay in memory per CLAUDE.md / approved plan).

Embeddings are NEVER persisted here. There is no vector storage in this module.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path

from src.voc.review_ops.industrial.schema import IndustrialReview

DEFAULT_DB_PATH = "./.review_ops_data/review_ops.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS uploads (
    upload_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    filename    TEXT,
    uploaded_at TEXT,
    row_count   INTEGER,
    new_count   INTEGER
);

CREATE TABLE IF NOT EXISTS reviews (
    review_id            TEXT PRIMARY KEY,
    content_fingerprint  TEXT,
    channel              TEXT,
    product_name         TEXT,
    option_name          TEXT,
    rating               REAL,
    author               TEXT,
    review_date          TEXT,
    text                 TEXT,
    language             TEXT,
    has_reply            INTEGER,
    source_id            TEXT,
    first_seen_upload_id INTEGER,
    first_seen_at        TEXT,
    last_seen_upload_id  INTEGER,
    last_seen_at         TEXT
);

CREATE TABLE IF NOT EXISTS review_status (
    review_id  TEXT PRIMARY KEY,
    status     TEXT,
    memo       TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS issue_status (
    issue_key  TEXT PRIMARY KEY,
    label      TEXT,
    status     TEXT,
    memo       TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    role       TEXT,
    content    TEXT,
    created_at TEXT
);

CREATE TABLE IF NOT EXISTS issue_cache (
    cache_key         TEXT PRIMARY KEY,
    scope_key         TEXT,
    corpus_hash       TEXT,
    recent_days       INTEGER,
    discovery_model   TEXT,
    verifier_model    TEXT,
    discovery_version TEXT,
    verifier_version  TEXT,
    payload_json      TEXT NOT NULL,
    created_at        TEXT NOT NULL
);
"""


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def open_store(path: str | None = None) -> sqlite3.Connection:
    """Open (and initialize) the local store.

    ``path=None`` uses ``DEFAULT_DB_PATH`` and creates its parent directory.
    Pass ``":memory:"`` (or a tmp path) in tests. Tables are bootstrapped via
    ``init_db`` before returning.
    """
    db_path = path or DEFAULT_DB_PATH
    if db_path != ":memory:":
        Path(db_path).expanduser().parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    init_db(conn)
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    """Create all tables if they do not already exist. Idempotent."""
    conn.executescript(_SCHEMA)
    conn.commit()


def create_upload(conn: sqlite3.Connection, filename: str, row_count: int) -> int:
    """Insert an upload row and return its ``upload_id``. ``new_count`` is filled
    in by :func:`upsert_reviews`."""
    cur = conn.execute(
        "INSERT INTO uploads (filename, uploaded_at, row_count, new_count) "
        "VALUES (?, ?, ?, ?)",
        (filename, _now_iso(), int(row_count), 0),
    )
    conn.commit()
    return int(cur.lastrowid)


def upsert_reviews(
    conn: sqlite3.Connection,
    upload_id: int,
    reviews: list[IndustrialReview],
) -> dict:
    """Persist reviews for ``upload_id`` and detect which are new.

    A review is NEW when its deterministic ``review_id`` is not yet in the
    ``reviews`` table; it is inserted with ``first_seen_upload_id = upload_id``.
    A review already present only has its ``last_seen_*`` columns updated —
    ``first_seen_*`` is never overwritten. Duplicate ``review_id`` values inside
    the same batch are counted once (the first insert makes later occurrences
    register as "seen").

    The owning upload's ``new_count`` is updated to match. Returns a summary
    dict: ``new_review_ids`` / ``new_count`` / ``seen_count`` / ``total``.
    """
    now = _now_iso()
    new_ids: list[str] = []
    seen_count = 0

    for r in reviews:
        exists = conn.execute(
            "SELECT 1 FROM reviews WHERE review_id = ?", (r.review_id,)
        ).fetchone()
        if exists:
            conn.execute(
                "UPDATE reviews SET last_seen_upload_id = ?, last_seen_at = ? "
                "WHERE review_id = ?",
                (upload_id, now, r.review_id),
            )
            seen_count += 1
        else:
            conn.execute(
                "INSERT INTO reviews ("
                "review_id, content_fingerprint, channel, product_name, "
                "option_name, rating, author, review_date, text, language, "
                "has_reply, source_id, first_seen_upload_id, first_seen_at, "
                "last_seen_upload_id, last_seen_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    r.review_id,
                    r.content_fingerprint,
                    r.channel,
                    r.product_name,
                    r.option_name,
                    r.rating,
                    r.author,
                    r.review_date.isoformat() if r.review_date else None,
                    r.text,
                    r.language,
                    1 if r.has_reply else 0,
                    r.source_id,
                    upload_id,
                    now,
                    upload_id,
                    now,
                ),
            )
            new_ids.append(r.review_id)

    conn.execute(
        "UPDATE uploads SET new_count = ? WHERE upload_id = ?",
        (len(new_ids), upload_id),
    )
    conn.commit()
    return {
        "new_review_ids": new_ids,
        "new_count": len(new_ids),
        "seen_count": seen_count,
        "total": len(new_ids) + seen_count,
    }


def get_upload_summary(conn: sqlite3.Connection, upload_id: int) -> dict | None:
    """Return the upload row as a dict, or None if not found."""
    row = conn.execute(
        "SELECT upload_id, filename, uploaded_at, row_count, new_count "
        "FROM uploads WHERE upload_id = ?",
        (upload_id,),
    ).fetchone()
    return dict(row) if row else None


def get_review_status(conn: sqlite3.Connection, review_id: str) -> dict | None:
    """Return ``{status, memo, updated_at}`` for a review, or None if unset."""
    row = conn.execute(
        "SELECT status, memo, updated_at FROM review_status WHERE review_id = ?",
        (review_id,),
    ).fetchone()
    return dict(row) if row else None


def set_review_status(
    conn: sqlite3.Connection,
    review_id: str,
    status: str,
    memo: str = "",
) -> None:
    """Upsert operator status/memo for a review (keyed by stable ``review_id``)."""
    conn.execute(
        "INSERT INTO review_status (review_id, status, memo, updated_at) "
        "VALUES (?, ?, ?, ?) "
        "ON CONFLICT(review_id) DO UPDATE SET "
        "status = excluded.status, memo = excluded.memo, "
        "updated_at = excluded.updated_at",
        (review_id, status, memo or "", _now_iso()),
    )
    conn.commit()


def list_recent_uploads(conn: sqlite3.Connection, limit: int = 10) -> list[dict]:
    """Return the most recent uploads, newest first."""
    rows = conn.execute(
        "SELECT upload_id, filename, uploaded_at, row_count, new_count "
        "FROM uploads ORDER BY upload_id DESC LIMIT ?",
        (int(limit),),
    ).fetchall()
    return [dict(r) for r in rows]


def get_cached_issues(conn: sqlite3.Connection, cache_key: str) -> dict | None:
    """Return the cached issue row as a dict, or None on miss.

    ``payload_json`` is returned verbatim — this layer does not parse it;
    deserialization is the caller's job (see ``issue_cache.deserialize_issues``).
    """
    row = conn.execute(
        "SELECT cache_key, scope_key, corpus_hash, recent_days, discovery_model, "
        "verifier_model, discovery_version, verifier_version, payload_json, "
        "created_at FROM issue_cache WHERE cache_key = ?",
        (cache_key,),
    ).fetchone()
    return dict(row) if row else None


def put_cached_issues(
    conn: sqlite3.Connection,
    cache_key: str,
    metadata: dict,
    payload_json: str,
) -> None:
    """Insert or replace a cached issue result, keyed by ``cache_key``.

    ``metadata`` supplies the (optional) descriptive columns: ``scope_key`` /
    ``corpus_hash`` / ``recent_days`` / ``discovery_model`` / ``verifier_model``
    / ``discovery_version`` / ``verifier_version``. ``created_at`` is taken from
    ``metadata`` when provided (injectable for tests), else ``_now_iso()``.
    ``payload_json`` is stored opaquely — not parsed here.
    """
    meta = metadata or {}
    conn.execute(
        "INSERT OR REPLACE INTO issue_cache ("
        "cache_key, scope_key, corpus_hash, recent_days, discovery_model, "
        "verifier_model, discovery_version, verifier_version, payload_json, "
        "created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            cache_key,
            meta.get("scope_key"),
            meta.get("corpus_hash"),
            meta.get("recent_days"),
            meta.get("discovery_model"),
            meta.get("verifier_model"),
            meta.get("discovery_version"),
            meta.get("verifier_version"),
            payload_json,
            meta.get("created_at") or _now_iso(),
        ),
    )
    conn.commit()
