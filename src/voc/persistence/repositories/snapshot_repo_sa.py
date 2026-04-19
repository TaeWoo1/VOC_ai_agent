"""SQLAlchemy-backed mirror of :class:`SnapshotRepository`.

Public method parity with src/voc/persistence/repository.py::SnapshotRepository:

  ┌────────────────┬──────────────────────────────────────────────────────┐
  │ legacy         │ this mirror                                          │
  ├────────────────┼──────────────────────────────────────────────────────┤
  │ save           │ async save                                           │
  │ list_by_entity │ async list_by_entity                                 │
  │ get_latest     │ async get_latest                                     │
  └────────────────┴──────────────────────────────────────────────────────┘

Repo-specific quirks preserved verbatim:

  * **dashboard_json semantics differ from every other JSON column.**  On
    save: ``json.dumps(snapshot["dashboard"]) if snapshot["dashboard"] is
    not None else None``.  Means an explicit ``dashboard={}`` is stored as
    ``'{}'`` and read back as ``{}``; an absent or ``None`` dashboard is
    stored as SQL NULL and read back as ``None``.  This None/{} distinction
    is load-bearing — existing operator-console code differentiates "no
    dashboard yet" (None) from "dashboard with no fields populated" ({}).

  * **channels_json is never NULL on insert.**  Save always JSON-encodes
    the channels (default ``[]`` if absent in the input dict).  But on
    read, the legacy ``_row_to_dict`` still defensively coalesces falsy
    column values to ``[]`` for forward compatibility with rows inserted
    by other code paths.  Mirrored here.

  * **No update or delete** in the legacy interface.  Snapshots are
    append-only by convention; PR 2 mirrors that exactly — no extra
    methods added.

  * **Ordering:** both ``list_by_entity`` and ``get_latest`` order by
    ``captured_at DESC`` so the most recent snapshot is first.

This is the smallest of the 4 mirrors (3 methods) but carries the most
behavioral nuance because of the dashboard None/{} distinction.
"""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.voc.persistence.models.snapshot import Snapshot
from src.voc.persistence.session import session_scope


class SnapshotRepositorySA:
    """Async SQLAlchemy mirror of the legacy ``SnapshotRepository``."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]):
        self._factory = session_factory

    async def save(self, snapshot: dict) -> None:
        # dashboard handling: explicit None → SQL NULL; explicit {} → '{}'.
        dashboard_value = snapshot.get("dashboard")
        if dashboard_value is not None:
            dashboard_json = json.dumps(dashboard_value, ensure_ascii=False)
        else:
            dashboard_json = None

        async with session_scope(self._factory) as session:
            session.add(
                Snapshot(
                    snapshot_id=snapshot["snapshot_id"],
                    entity_id=snapshot["entity_id"],
                    job_id=snapshot.get("job_id"),
                    captured_at=snapshot["captured_at"],
                    total_reviews=snapshot.get("total_reviews"),
                    avg_rating=snapshot.get("avg_rating"),
                    negative_count=snapshot.get("negative_count"),
                    low_rating_ratio=snapshot.get("low_rating_ratio"),
                    channels_json=json.dumps(
                        snapshot.get("channels", []), ensure_ascii=False
                    ),
                    summary_text=snapshot.get("summary_text"),
                    dashboard_json=dashboard_json,
                )
            )

    async def list_by_entity(
        self, entity_id: str, limit: int = 20
    ) -> list[dict]:
        async with session_scope(self._factory) as session:
            result = await session.execute(
                select(Snapshot)
                .where(Snapshot.entity_id == entity_id)
                .order_by(Snapshot.captured_at.desc())
                .limit(limit)
            )
            return [self._row_to_dict(r) for r in result.scalars().all()]

    async def get_latest(self, entity_id: str) -> dict | None:
        async with session_scope(self._factory) as session:
            result = await session.execute(
                select(Snapshot)
                .where(Snapshot.entity_id == entity_id)
                .order_by(Snapshot.captured_at.desc())
                .limit(1)
            )
            row = result.scalar_one_or_none()
            return self._row_to_dict(row) if row is not None else None

    @staticmethod
    def _row_to_dict(row: Snapshot) -> dict:
        # channels:  falsy column → []
        # dashboard: falsy column → None  (NOT {} — see module docstring)
        return {
            "snapshot_id":      row.snapshot_id,
            "entity_id":        row.entity_id,
            "job_id":           row.job_id,
            "captured_at":      row.captured_at,
            "total_reviews":    row.total_reviews,
            "avg_rating":       row.avg_rating,
            "negative_count":   row.negative_count,
            "low_rating_ratio": row.low_rating_ratio,
            "channels":         json.loads(row.channels_json) if row.channels_json else [],
            "summary_text":     row.summary_text,
            "dashboard":        json.loads(row.dashboard_json) if row.dashboard_json else None,
        }
