"""SQLAlchemy model for the ``api_keys`` table.

FK to workspaces (CASCADE).  Indexes on workspace_id and key_hash for
per-workspace listing and auth-time lookup respectively.
"""

from __future__ import annotations

from sqlalchemy import ForeignKey, Index, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from src.voc.persistence.models.base import Base


class ApiKey(Base):
    __tablename__ = "api_keys"

    api_key_id:   Mapped[str | None] = mapped_column(Text, primary_key=True, nullable=True)
    workspace_id: Mapped[str]        = mapped_column(
        Text,
        ForeignKey("workspaces.workspace_id", name="fk_api_keys_workspace_id", ondelete="CASCADE"),
        nullable=False,
    )
    key_hash:     Mapped[str]        = mapped_column(Text, nullable=False)
    key_salt:     Mapped[str]        = mapped_column(Text, nullable=False)
    name:         Mapped[str]        = mapped_column(Text, nullable=False)
    status:       Mapped[str]        = mapped_column(Text, nullable=False, server_default=text("'active'"))
    created_at:   Mapped[str]        = mapped_column(Text, nullable=False)
    last_used_at: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        Index("ix_api_keys_workspace_id", "workspace_id"),
        Index("ix_api_keys_key_hash",     "key_hash"),
    )
