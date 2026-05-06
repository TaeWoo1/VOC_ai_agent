"""Phase 1 review repository — flat sqlite3 store for the bait-report data slice.

Mirrors `EntityRepository` style: sync, raw `sqlite3.Connection`, JSON columns
serialized via `json.dumps(..., ensure_ascii=False)`, deserialized in
`_row_to_dict`. Uses `INSERT OR IGNORE` on `review_id` for idempotent
re-ingestion (within-channel dedup is enforced by the identity-preserving
`review_id` generator from `normalizer.py`).
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any


_INSERT_SQL = """INSERT OR IGNORE INTO phase1_reviews
    (review_id, source_channel, source_method, source_id, source_url,
     text, rating_normalized, rating_raw, review_date, language,
     content_fingerprint, is_duplicate, duplicate_of,
     product_keyword, product_external_id,
     channel_meta_json, derived_json, raw_metadata_json,
     run_id, collected_at, ingested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"""


class Phase1ReviewRepository:
    """Flat reviews store for Phase 1 (Coupang + OliveYoung bait report)."""

    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def save_many(self, rows: list[dict]) -> int:
        """Insert rows with `INSERT OR IGNORE` on `review_id` collision.

        Returns the number of rows actually inserted (collisions skipped).
        Computed via `total_changes` delta to avoid sqlite3 driver quirks
        with `cursor.rowcount` on `executemany` + `INSERT OR IGNORE`.
        """
        if not rows:
            return 0
        before = self._conn.total_changes
        self._conn.executemany(_INSERT_SQL, [self._to_row(r) for r in rows])
        self._conn.commit()
        return self._conn.total_changes - before

    def get(self, review_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM phase1_reviews WHERE review_id = ?", (review_id,)
        ).fetchone()
        if row is None:
            return None
        return self._row_to_dict(row)

    def count_by_channel(self) -> dict[str, int]:
        rows = self._conn.execute(
            "SELECT source_channel, COUNT(*) AS n FROM phase1_reviews "
            "GROUP BY source_channel"
        ).fetchall()
        return {r["source_channel"]: r["n"] for r in rows}

    def query(
        self,
        source_channel: str | None = None,
        run_id: str | None = None,
        limit: int | None = None,
    ) -> list[dict]:
        clauses: list[str] = []
        params: list[Any] = []
        if source_channel is not None:
            clauses.append("source_channel = ?")
            params.append(source_channel)
        if run_id is not None:
            clauses.append("run_id = ?")
            params.append(run_id)
        sql = "SELECT * FROM phase1_reviews"
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY ingested_at DESC"
        if limit is not None:
            sql += f" LIMIT {int(limit)}"
        rows = self._conn.execute(sql, params).fetchall()
        return [self._row_to_dict(r) for r in rows]

    @staticmethod
    def _to_row(r: dict) -> tuple:
        return (
            r["review_id"],
            r["source_channel"],
            r["source_method"],
            r.get("source_id"),
            r.get("source_url"),
            r["text"],
            r.get("rating_normalized"),
            r.get("rating_raw"),
            r.get("review_date"),
            r.get("language"),
            r["content_fingerprint"],
            1 if r.get("is_duplicate") else 0,
            r.get("duplicate_of"),
            r.get("product_keyword"),
            r.get("product_external_id"),
            json.dumps(r["channel_meta"], ensure_ascii=False)
            if r.get("channel_meta") is not None else None,
            json.dumps(r["derived"], ensure_ascii=False)
            if r.get("derived") is not None else None,
            json.dumps(r["raw_metadata"], ensure_ascii=False)
            if r.get("raw_metadata") is not None else None,
            r.get("run_id"),
            r["collected_at"],
            r["ingested_at"],
        )

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict:
        d = dict(row)
        d["channel_meta"] = (
            json.loads(d.pop("channel_meta_json"))
            if d.get("channel_meta_json") else None
        )
        d["derived"] = (
            json.loads(d.pop("derived_json"))
            if d.get("derived_json") else None
        )
        d["raw_metadata"] = (
            json.loads(d.pop("raw_metadata_json"))
            if d.get("raw_metadata_json") else None
        )
        d["is_duplicate"] = bool(d.get("is_duplicate"))
        return d
