"""SQLAlchemy model for the ``users`` table — SCAFFOLDED INACTIVE in v1.

The schema exists so v1.1 (when JWT auth lands) is purely additive — no
migration needed at activation time.  In v1, NO application code under
``src/voc/api/``, ``src/voc/app/``, ``src/voc/workers/``, or
``app_demo.py`` is allowed to import this model or its repository.  A
static test enforces this rule.

UNIQUE on email so future SSO/login flows can lookup by email cleanly.
"""

from __future__ import annotations

from sqlalchemy import Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from src.voc.persistence.models.base import Base


class User(Base):
    __tablename__ = "users"

    user_id:       Mapped[str | None] = mapped_column(Text, primary_key=True, nullable=True)
    email:         Mapped[str]        = mapped_column(Text, nullable=False)
    display_name:  Mapped[str | None] = mapped_column(Text)
    password_hash: Mapped[str | None] = mapped_column(Text)
    status:        Mapped[str]        = mapped_column(Text, nullable=False, server_default=text("'active'"))
    created_at:    Mapped[str]        = mapped_column(Text, nullable=False)
    last_login_at: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        UniqueConstraint("email", name="uq_users_email"),
    )
