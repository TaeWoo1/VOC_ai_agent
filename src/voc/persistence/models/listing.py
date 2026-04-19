"""SQLAlchemy model for the ``listings`` table.

Channel-side resolved identity (e.g., a Smart Store product, a GBP
location).  FK to workspaces (RESTRICT — listings represent real-world
resources; force explicit cleanup).

Two indexes: per-workspace listing, and reverse lookup by external_id
within a workspace.
"""

from __future__ import annotations

from sqlalchemy import ForeignKey, Index, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from src.voc.persistence.models.base import Base


class Listing(Base):
    __tablename__ = "listings"

    listing_id:    Mapped[str | None] = mapped_column(Text, primary_key=True, nullable=True)
    workspace_id:  Mapped[str]        = mapped_column(
        Text,
        ForeignKey("workspaces.workspace_id", name="fk_listings_workspace_id", ondelete="RESTRICT"),
        nullable=False,
    )
    external_id:   Mapped[str | None] = mapped_column(Text)
    external_url:  Mapped[str | None] = mapped_column(Text)
    kind:          Mapped[str]        = mapped_column(Text, nullable=False)
    display_name:  Mapped[str]        = mapped_column(Text, nullable=False)
    metadata_json: Mapped[str | None] = mapped_column(Text, server_default=text("'{}'"))
    created_at:    Mapped[str]        = mapped_column(Text, nullable=False)

    __table_args__ = (
        Index("ix_listings_workspace_id",       "workspace_id"),
        Index("ix_listings_workspace_external", "workspace_id", "external_id"),
    )
