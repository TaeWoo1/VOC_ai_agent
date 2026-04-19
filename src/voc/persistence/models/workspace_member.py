"""SQLAlchemy model for the ``workspace_members`` table — SCAFFOLDED INACTIVE in v1.

See user.py for the inactive-scaffolding rule.

FKs: workspace (CASCADE), user (RESTRICT).  Composite UNIQUE on
(workspace_id, user_id) so a user can have at most one role per workspace.
"""

from __future__ import annotations

from sqlalchemy import ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from src.voc.persistence.models.base import Base


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"

    member_id:    Mapped[str | None] = mapped_column(Text, primary_key=True, nullable=True)
    workspace_id: Mapped[str]        = mapped_column(
        Text,
        ForeignKey("workspaces.workspace_id", name="fk_workspace_members_workspace_id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id:      Mapped[str]        = mapped_column(
        Text,
        ForeignKey("users.user_id", name="fk_workspace_members_user_id", ondelete="RESTRICT"),
        nullable=False,
    )
    role:         Mapped[str]        = mapped_column(Text, nullable=False)
    invited_at:   Mapped[str | None] = mapped_column(Text)
    joined_at:    Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id", name="uq_workspace_members_ws_user"),
    )
