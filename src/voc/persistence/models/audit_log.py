"""SQLAlchemy model for the ``audit_log`` table.

Append-only.  ``actor_type`` is Text with a closed value set
('api_key' | 'user' | 'system') enforced at the application layer.

FKs RESTRICT to both accounts and workspaces — audit log MUST outlive the
entity it tracks.  Operator must explicitly archive or delete audit
entries before deleting an account/workspace.

Indexes: account-scoped timeline, workspace-scoped timeline.
"""

from __future__ import annotations

from sqlalchemy import ForeignKey, Index, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.voc.persistence.models.base import Base


class AuditLog(Base):
    __tablename__ = "audit_log"

    audit_id:     Mapped[str | None] = mapped_column(Text, primary_key=True, nullable=True)
    account_id:   Mapped[str]        = mapped_column(
        Text,
        ForeignKey("accounts.account_id", name="fk_audit_log_account_id", ondelete="RESTRICT"),
        nullable=False,
    )
    workspace_id: Mapped[str | None] = mapped_column(
        Text,
        ForeignKey("workspaces.workspace_id", name="fk_audit_log_workspace_id", ondelete="RESTRICT"),
    )
    actor_type:   Mapped[str]        = mapped_column(Text, nullable=False)
    actor_id:     Mapped[str]        = mapped_column(Text, nullable=False)
    action:       Mapped[str]        = mapped_column(Text, nullable=False)
    target_type:  Mapped[str | None] = mapped_column(Text)
    target_id:    Mapped[str | None] = mapped_column(Text)
    before_json:  Mapped[str | None] = mapped_column(Text)
    after_json:   Mapped[str | None] = mapped_column(Text)
    occurred_at:  Mapped[str]        = mapped_column(Text, nullable=False)
    source_ip:    Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        Index("ix_audit_log_account_occurred",   "account_id",   "occurred_at"),
        Index("ix_audit_log_workspace_occurred", "workspace_id", "occurred_at"),
    )
