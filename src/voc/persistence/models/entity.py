"""SQLAlchemy model for the ``entities`` table.

Mirrors the DDL in ``0001_baseline.py`` exactly so autogenerate detects no
drift.  All TEXT columns are ``Text`` (never ``String`` or ``JSON``); all
SQL defaults use ``server_default=text(...)`` so they render to DDL.

Imports limited to ``sqlalchemy`` and the local ``Base``.
"""

from __future__ import annotations

from sqlalchemy import Integer, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from src.voc.persistence.models.base import Base


class Entity(Base):
    __tablename__ = "entities"

    # Baseline fidelity: SQLite permits NULL in non-INTEGER PRIMARY KEY columns
    # (`TEXT PRIMARY KEY` without `NOT NULL`).  Model declares this verbatim so
    # autogenerate matches the live DDL.  Long-term, PK NOT NULL semantics will
    # be enforced at the Postgres cutover (M5) — not retrofitted into baseline.
    entity_id:         Mapped[str | None]  = mapped_column(Text, primary_key=True, nullable=True)
    tenant_id:         Mapped[str]         = mapped_column(Text, nullable=False, server_default=text("'default'"))
    entity_type:       Mapped[str]         = mapped_column(Text, nullable=False)
    display_name:      Mapped[str]         = mapped_column(Text, nullable=False)
    description:       Mapped[str | None]  = mapped_column(Text, server_default=text("''"))
    product_keywords:  Mapped[str]         = mapped_column(Text, nullable=False)
    connector:         Mapped[str | None]  = mapped_column(Text, server_default=text("'mock'"))
    metadata_json:     Mapped[str | None]  = mapped_column(Text, server_default=text("'{}'"))
    created_at:        Mapped[str]         = mapped_column(Text, nullable=False)
    last_refreshed_at: Mapped[str | None]  = mapped_column(Text)
    refresh_count:     Mapped[int | None]  = mapped_column(Integer, server_default=text("0"))
