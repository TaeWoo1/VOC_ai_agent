"""SQLAlchemy model for the ``accounts`` table.

Tenancy root.  Mirrors the DDL emitted by 0002_tenancy_and_new_domain.py
exactly so autogenerate detects no drift.

Imports limited to ``sqlalchemy`` and the local ``Base``.  See entity.py
for the PK-nullability rationale.
"""

from __future__ import annotations

from sqlalchemy import Text, text
from sqlalchemy.orm import Mapped, mapped_column

from src.voc.persistence.models.base import Base


class Account(Base):
    __tablename__ = "accounts"

    # Baseline fidelity: TEXT PK is nullable in SQLite.  See entity.py.
    account_id: Mapped[str | None] = mapped_column(Text, primary_key=True, nullable=True)
    name:       Mapped[str]        = mapped_column(Text, nullable=False)
    plan:       Mapped[str]        = mapped_column(Text, nullable=False, server_default=text("'free'"))
    created_at: Mapped[str]        = mapped_column(Text, nullable=False)
