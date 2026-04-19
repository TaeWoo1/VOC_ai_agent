"""SQLAlchemy model for the ``alerts`` table.

FK to workspaces (CASCADE).  ``snapshot_id`` and ``monitored_entity_id``
are plain TEXT pointers in PR 3 — adding FKs to those is left to PR 5
(when ``entities`` becomes ``monitored_entities``) or later, to keep PR 3
strictly additive.

Indexes for: tenant scope, open-alerts query (workspace + status), and
timeline ordering.
"""

from __future__ import annotations

from sqlalchemy import ForeignKey, Index, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from src.voc.persistence.models.base import Base


class Alert(Base):
    __tablename__ = "alerts"

    alert_id:            Mapped[str | None] = mapped_column(Text, primary_key=True, nullable=True)
    workspace_id:        Mapped[str]        = mapped_column(
        Text,
        ForeignKey("workspaces.workspace_id", name="fk_alerts_workspace_id", ondelete="CASCADE"),
        nullable=False,
    )
    monitored_entity_id: Mapped[str | None] = mapped_column(Text)
    snapshot_id:         Mapped[str | None] = mapped_column(Text)
    rule_id:             Mapped[str]        = mapped_column(Text, nullable=False)
    severity:            Mapped[str]        = mapped_column(Text, nullable=False, server_default=text("'info'"))
    status:              Mapped[str]        = mapped_column(Text, nullable=False, server_default=text("'open'"))
    fired_at:            Mapped[str]        = mapped_column(Text, nullable=False)
    acknowledged_at:     Mapped[str | None] = mapped_column(Text)
    payload_json:        Mapped[str | None] = mapped_column(Text, server_default=text("'{}'"))

    __table_args__ = (
        Index("ix_alerts_workspace_id",     "workspace_id"),
        Index("ix_alerts_workspace_status", "workspace_id", "status"),
        Index("ix_alerts_fired_at",         "fired_at"),
    )
