"""SQLAlchemy-backed mirror of :class:`SourceConnectionRepository`.

Public method parity with src/voc/persistence/repository.py::SourceConnectionRepository:

  ┌──────────────────────────┬────────────────────────────────────────────┐
  │ legacy                   │ this mirror                                │
  ├──────────────────────────┼────────────────────────────────────────────┤
  │ save                     │ async save                                 │
  │ get                      │ async get                                  │
  │ list_by_entity           │ async list_by_entity                       │
  │ update                   │ async update                               │
  │ delete                   │ async delete                               │
  │ find_by_entity_and_type  │ async find_by_entity_and_type              │
  └──────────────────────────┴────────────────────────────────────────────┘

Return-value parity rules (from legacy ``_row_to_dict``):
  * ``config_json``       removed; ``config``       (parsed dict). Falsy → ``{}``.
  * ``capabilities_json`` removed; ``capabilities`` (parsed dict). Falsy → ``{}``.

Notable repo-specific quirks preserved verbatim:
  * ``list_by_entity`` orders by ``created_at`` ASCENDING (not DESC).
    Different from ``EntityRepository.list_all`` which is DESC.
  * ``update`` writes only 6 fields:
    ``status, config_json, capabilities_json, last_synced_at,
    error_message, display_name``.
    It does NOT touch ``entity_id``, ``connector_type``, ``source_type``,
    or ``created_at``.  Mirrors legacy behavior precisely.
  * ``find_by_entity_and_type`` returns the FIRST matching row (LIMIT 1)
    deterministically — but legacy has no explicit ORDER BY, so SQLite
    returns insertion order.  We preserve that (no order_by added).
"""

from __future__ import annotations

import json

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.voc.persistence.models.source_connection import SourceConnection
from src.voc.persistence.session import session_scope


class SourceConnectionRepositorySA:
    """Async SQLAlchemy mirror of the legacy ``SourceConnectionRepository``."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]):
        self._factory = session_factory

    async def save(self, record: dict) -> None:
        async with session_scope(self._factory) as session:
            session.add(
                SourceConnection(
                    connection_id=record["connection_id"],
                    entity_id=record["entity_id"],
                    connector_type=record["connector_type"],
                    source_type=record.get("source_type", "owned"),
                    display_name=record["display_name"],
                    status=record.get("status", "active"),
                    config_json=json.dumps(
                        record.get("config", {}), ensure_ascii=False
                    ),
                    capabilities_json=json.dumps(
                        record.get("capabilities", {}), ensure_ascii=False
                    ),
                    last_synced_at=record.get("last_synced_at"),
                    error_message=record.get("error_message"),
                    created_at=record["created_at"],
                )
            )

    async def get(self, connection_id: str) -> dict | None:
        async with session_scope(self._factory) as session:
            result = await session.execute(
                select(SourceConnection).where(
                    SourceConnection.connection_id == connection_id
                )
            )
            row = result.scalar_one_or_none()
            return self._row_to_dict(row) if row is not None else None

    async def list_by_entity(
        self, entity_id: str, status: str | None = None
    ) -> list[dict]:
        async with session_scope(self._factory) as session:
            stmt = select(SourceConnection).where(
                SourceConnection.entity_id == entity_id
            )
            if status:
                stmt = stmt.where(SourceConnection.status == status)
            # Legacy orders by created_at ASCENDING — preserve.
            stmt = stmt.order_by(SourceConnection.created_at)
            result = await session.execute(stmt)
            return [self._row_to_dict(r) for r in result.scalars().all()]

    async def update(self, connection_id: str, updates: dict) -> dict | None:
        existing = await self.get(connection_id)
        if existing is None:
            return None
        existing.update(updates)
        async with session_scope(self._factory) as session:
            result = await session.execute(
                select(SourceConnection).where(
                    SourceConnection.connection_id == connection_id
                )
            )
            row = result.scalar_one_or_none()
            if row is None:
                return None
            # Legacy update writes EXACTLY these 6 fields (and not the others).
            row.status = existing.get("status", "active")
            row.config_json = json.dumps(
                existing.get("config", {}), ensure_ascii=False
            )
            row.capabilities_json = json.dumps(
                existing.get("capabilities", {}), ensure_ascii=False
            )
            row.last_synced_at = existing.get("last_synced_at")
            row.error_message = existing.get("error_message")
            row.display_name = existing["display_name"]
        return await self.get(connection_id)

    async def delete(self, connection_id: str) -> bool:
        async with session_scope(self._factory) as session:
            result = await session.execute(
                delete(SourceConnection).where(
                    SourceConnection.connection_id == connection_id
                )
            )
            return result.rowcount > 0

    async def find_by_entity_and_type(
        self, entity_id: str, connector_type: str
    ) -> dict | None:
        async with session_scope(self._factory) as session:
            result = await session.execute(
                select(SourceConnection)
                .where(SourceConnection.entity_id == entity_id)
                .where(SourceConnection.connector_type == connector_type)
                .limit(1)
            )
            row = result.scalar_one_or_none()
            return self._row_to_dict(row) if row is not None else None

    @staticmethod
    def _row_to_dict(row: SourceConnection) -> dict:
        # Per-column truthiness coalescing — legacy treats any falsy value
        # (None, empty string) as missing.
        return {
            "connection_id":  row.connection_id,
            "entity_id":      row.entity_id,
            "connector_type": row.connector_type,
            "source_type":    row.source_type,
            "display_name":   row.display_name,
            "status":         row.status,
            "config":         json.loads(row.config_json) if row.config_json else {},
            "capabilities":   json.loads(row.capabilities_json) if row.capabilities_json else {},
            "last_synced_at": row.last_synced_at,
            "error_message":  row.error_message,
            "created_at":     row.created_at,
        }
