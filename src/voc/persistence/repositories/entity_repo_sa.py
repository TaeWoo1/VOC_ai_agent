"""SQLAlchemy-backed mirror of :class:`EntityRepository`.

Public method parity with src/voc/persistence/repository.py::EntityRepository:

  ┌──────────────┬────────────────────────────────────────────────────────┐
  │ legacy       │ this mirror                                            │
  ├──────────────┼────────────────────────────────────────────────────────┤
  │ save         │ async save                                             │
  │ get          │ async get                                              │
  │ list_all     │ async list_all                                         │
  │ update       │ async update                                           │
  │ delete       │ async delete                                           │
  └──────────────┴────────────────────────────────────────────────────────┘

Return-value parity rules:
  * The dict has the same keys as the legacy ``_row_to_dict`` output:
    ``entity_id, tenant_id, entity_type, display_name, description,
    product_keywords (parsed list), connector, metadata (parsed dict, was
    metadata_json column), created_at, last_refreshed_at, refresh_count``.
  * ``product_keywords`` and ``metadata`` are JSON-deserialized via
    ``json.loads`` — the model column type is ``Text``, NEVER ``JSON``,
    matching the legacy storage convention exactly.

Constructor takes an ``async_sessionmaker`` (not a ``sqlite3.Connection``).
"""

from __future__ import annotations

import json

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.voc.persistence.models.entity import Entity
from src.voc.persistence.session import session_scope


class EntityRepositorySA:
    """Async SQLAlchemy mirror of the legacy ``EntityRepository``."""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]):
        self._factory = session_factory

    async def save(self, entity_id: str, record: dict) -> None:
        async with session_scope(self._factory) as session:
            session.add(
                Entity(
                    entity_id=entity_id,
                    tenant_id=record.get("tenant_id", "default"),
                    entity_type=record.get("entity_type", "product"),
                    display_name=record["display_name"],
                    description=record.get("description", ""),
                    product_keywords=json.dumps(
                        record["product_keywords"], ensure_ascii=False
                    ),
                    connector=record.get("connector", "mock"),
                    metadata_json=json.dumps(
                        record.get("metadata", {}), ensure_ascii=False
                    ),
                    created_at=record["created_at"],
                    last_refreshed_at=record.get("last_refreshed_at"),
                    refresh_count=record.get("refresh_count", 0),
                )
            )

    async def get(self, entity_id: str) -> dict | None:
        async with session_scope(self._factory) as session:
            result = await session.execute(
                select(Entity).where(Entity.entity_id == entity_id)
            )
            row = result.scalar_one_or_none()
            return self._row_to_dict(row) if row is not None else None

    async def list_all(self, tenant_id: str = "default") -> list[dict]:
        async with session_scope(self._factory) as session:
            result = await session.execute(
                select(Entity)
                .where(Entity.tenant_id == tenant_id)
                .order_by(Entity.created_at.desc())
            )
            return [self._row_to_dict(r) for r in result.scalars().all()]

    async def update(self, entity_id: str, updates: dict) -> dict | None:
        # Mirror of legacy update(): read existing dict, merge updates,
        # write all fields back.  Two-phase, matching legacy semantics
        # exactly (legacy also calls .get() before and after).
        existing = await self.get(entity_id)
        if existing is None:
            return None
        existing.update(updates)
        async with session_scope(self._factory) as session:
            result = await session.execute(
                select(Entity).where(Entity.entity_id == entity_id)
            )
            row = result.scalar_one_or_none()
            if row is None:
                return None
            row.tenant_id = existing.get("tenant_id", "default")
            row.entity_type = existing.get("entity_type", "product")
            row.display_name = existing["display_name"]
            row.description = existing.get("description", "")
            row.product_keywords = json.dumps(
                existing["product_keywords"], ensure_ascii=False
            )
            row.connector = existing.get("connector", "mock")
            row.metadata_json = json.dumps(
                existing.get("metadata", {}), ensure_ascii=False
            )
            row.last_refreshed_at = existing.get("last_refreshed_at")
            row.refresh_count = existing.get("refresh_count", 0)
        return await self.get(entity_id)

    async def delete(self, entity_id: str) -> bool:
        async with session_scope(self._factory) as session:
            result = await session.execute(
                delete(Entity).where(Entity.entity_id == entity_id)
            )
            return result.rowcount > 0

    @staticmethod
    def _row_to_dict(row: Entity) -> dict:
        # Key parity with legacy: produce ``metadata`` (parsed dict) from
        # the ``metadata_json`` column, ``product_keywords`` parsed list,
        # all other columns as-is.  Strict — does not coalesce None into
        # defaults; the legacy code does not either.
        return {
            "entity_id": row.entity_id,
            "tenant_id": row.tenant_id,
            "entity_type": row.entity_type,
            "display_name": row.display_name,
            "description": row.description,
            "product_keywords": json.loads(row.product_keywords),
            "connector": row.connector,
            "metadata": json.loads(row.metadata_json),
            "created_at": row.created_at,
            "last_refreshed_at": row.last_refreshed_at,
            "refresh_count": row.refresh_count,
        }
