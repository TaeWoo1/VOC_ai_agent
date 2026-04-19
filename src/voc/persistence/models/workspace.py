"""SQLAlchemy model for the ``workspaces`` table.

FK to accounts (CASCADE).  Single non-unique index on ``account_id``.
"""

from __future__ import annotations

from sqlalchemy import ForeignKey, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.voc.persistence.models.base import Base


class Workspace(Base):
    __tablename__ = "workspaces"

    workspace_id: Mapped[str | None] = mapped_column(Text, primary_key=True, nullable=True)
    account_id:   Mapped[str]        = mapped_column(
        Text,
        ForeignKey("accounts.account_id", name="fk_workspaces_account_id", ondelete="CASCADE"),
        nullable=False,
    )
    name:         Mapped[str]        = mapped_column(Text, nullable=False)
    created_at:   Mapped[str]        = mapped_column(Text, nullable=False)

    __table_args__ = (
        Index("ix_workspaces_account_id", "account_id"),
    )
