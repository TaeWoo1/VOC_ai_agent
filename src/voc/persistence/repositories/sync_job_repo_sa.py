"""SQLAlchemy-backed mirror of :class:`SyncJobRepository`.

Public method parity with src/voc/persistence/repository.py::SyncJobRepository:

  ┌────────────────┬──────────────────────────────────────────────────────┐
  │ legacy         │ this mirror                                          │
  ├────────────────┼──────────────────────────────────────────────────────┤
  │ create         │ async create                                         │
  │ start          │ async start                                          │
  │ complete       │ async complete                                       │
  │ get            │ async get                                            │
  │ list_by_entity │ async list_by_entity                                 │
  └────────────────┴──────────────────────────────────────────────────────┘

Return-value parity rules (from legacy ``_row_to_dict``):
  * ``stages_json`` column is removed; ``stages`` (parsed list) is added.
    Falsy column value → ``[]``.
  * ``errors_json`` column removed; ``errors`` (parsed list).  Falsy → ``[]``.
  * ``metadata_json`` column removed; ``metadata`` (parsed dict).  Falsy → ``{}``.

The truthiness check (``if d.get("stages_json"):``) treats both ``None`` and
empty string as "missing" — preserved exactly.

Note: ``complete()`` updates 6 fields (status, finished_at, total_collected,
total_indexed, stages_json, errors_json) — NOT metadata_json.  This asymmetry
is preserved verbatim from the legacy repo: metadata_json is set only by
create() (via SQL default ``'{}'``) and never touched again here.

The ``stages_json`` and ``errors_json`` parameters on ``complete()`` are
already-encoded JSON strings (caller's responsibility) — passed through
verbatim without re-serialization, matching legacy behavior.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.voc.persistence.models.sync_job import SyncJob
from src.voc.persistence.session import session_scope


class SyncJobRepositorySA:
    """Async SQLAlchemy mirror of the legacy ``SyncJobRepository``."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]):
        self._factory = session_factory

    async def create(
        self,
        job_id: str,
        entity_id: str,
        job_type: str = "refresh",
        status: str = "pending",
        started_at: str | None = None,
    ) -> None:
        if started_at is None:
            started_at = datetime.now(timezone.utc).isoformat()
        async with session_scope(self._factory) as session:
            session.add(
                SyncJob(
                    job_id=job_id,
                    entity_id=entity_id,
                    job_type=job_type,
                    status=status,
                    started_at=started_at,
                )
            )

    async def start(self, job_id: str) -> None:
        async with session_scope(self._factory) as session:
            await session.execute(
                update(SyncJob)
                .where(SyncJob.job_id == job_id)
                .values(status="running")
            )

    async def complete(
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
        async with session_scope(self._factory) as session:
            await session.execute(
                update(SyncJob)
                .where(SyncJob.job_id == job_id)
                .values(
                    status=status,
                    finished_at=finished_at,
                    total_collected=total_collected,
                    total_indexed=total_indexed,
                    stages_json=stages_json,
                    errors_json=errors_json,
                )
            )

    async def get(self, job_id: str) -> dict | None:
        async with session_scope(self._factory) as session:
            result = await session.execute(
                select(SyncJob).where(SyncJob.job_id == job_id)
            )
            row = result.scalar_one_or_none()
            return self._row_to_dict(row) if row is not None else None

    async def list_by_entity(
        self,
        entity_id: str,
        job_type: str | None = None,
        limit: int = 20,
    ) -> list[dict]:
        async with session_scope(self._factory) as session:
            stmt = select(SyncJob).where(SyncJob.entity_id == entity_id)
            if job_type:
                stmt = stmt.where(SyncJob.job_type == job_type)
            stmt = stmt.order_by(SyncJob.started_at.desc()).limit(limit)
            result = await session.execute(stmt)
            return [self._row_to_dict(r) for r in result.scalars().all()]

    @staticmethod
    def _row_to_dict(row: SyncJob) -> dict:
        # Per-column truthiness coalescing — legacy behavior is "any falsy
        # value (None, empty string) collapses to the empty default".
        # stages → []   if stages_json   is falsy
        # errors → []   if errors_json   is falsy
        # metadata → {} if metadata_json is falsy
        return {
            "job_id":          row.job_id,
            "entity_id":       row.entity_id,
            "job_type":        row.job_type,
            "status":          row.status,
            "started_at":      row.started_at,
            "finished_at":     row.finished_at,
            "total_collected": row.total_collected,
            "total_indexed":   row.total_indexed,
            "stages":          json.loads(row.stages_json) if row.stages_json else [],
            "errors":          json.loads(row.errors_json) if row.errors_json else [],
            "metadata":        json.loads(row.metadata_json) if row.metadata_json else {},
        }
