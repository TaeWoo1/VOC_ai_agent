"""Phase 1 run audit repository — append-only run summary store.

Each `phase1_pipeline.run()` invocation produces one row here regardless of
quality_status. Bait-report queries join `phase1_reviews.run_id → phase1_runs`
to filter out degraded/invalid runs.
"""

from __future__ import annotations

import json
import sqlite3


class Phase1RunRepository:
    """Append-only run audit log for Phase 1 ingestion runs."""

    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def save(
        self,
        run_id: str,
        channel: str,
        requested_target: str,
        started_at: str,
        finished_at: str | None,
        quality_status: str,
        summary: dict,
    ) -> None:
        self._conn.execute(
            """INSERT INTO phase1_runs
               (run_id, channel, requested_target, started_at, finished_at,
                quality_status, summary_json)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                run_id,
                channel,
                requested_target,
                started_at,
                finished_at,
                quality_status,
                json.dumps(summary, ensure_ascii=False, default=str),
            ),
        )
        self._conn.commit()

    def get(self, run_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM phase1_runs WHERE run_id = ?", (run_id,)
        ).fetchone()
        if row is None:
            return None
        return self._row_to_dict(row)

    def latest_by_channel(self, channel: str) -> dict | None:
        row = self._conn.execute(
            """SELECT * FROM phase1_runs
               WHERE channel = ?
               ORDER BY started_at DESC LIMIT 1""",
            (channel,),
        ).fetchone()
        if row is None:
            return None
        return self._row_to_dict(row)

    @staticmethod
    def _row_to_dict(row: sqlite3.Row) -> dict:
        d = dict(row)
        d["summary"] = json.loads(d.pop("summary_json"))
        return d
