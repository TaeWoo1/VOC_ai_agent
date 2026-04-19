"""SQLAlchemy model for the ``source_connections`` table.

Mirrors the DDL in ``0001_baseline.py`` exactly.  See entity.py for the
column-style rationale (Text + server_default).
"""

from __future__ import annotations

from sqlalchemy import Text, text
from sqlalchemy.orm import Mapped, mapped_column

from src.voc.persistence.models.base import Base


class SourceConnection(Base):
    __tablename__ = "source_connections"

    # Baseline fidelity: see entity.py for the NULL-in-TEXT-PK rationale.
    connection_id:     Mapped[str | None]  = mapped_column(Text, primary_key=True, nullable=True)
    entity_id:         Mapped[str]         = mapped_column(Text, nullable=False)
    connector_type:    Mapped[str]         = mapped_column(Text, nullable=False)
    source_type:       Mapped[str]         = mapped_column(Text, nullable=False, server_default=text("'owned'"))
    display_name:      Mapped[str]         = mapped_column(Text, nullable=False)
    status:            Mapped[str]         = mapped_column(Text, nullable=False, server_default=text("'active'"))
    config_json:       Mapped[str | None]  = mapped_column(Text, server_default=text("'{}'"))
    capabilities_json: Mapped[str | None]  = mapped_column(Text, server_default=text("'{}'"))
    last_synced_at:    Mapped[str | None]  = mapped_column(Text)
    error_message:     Mapped[str | None]  = mapped_column(Text)
    created_at:        Mapped[str]         = mapped_column(Text, nullable=False)
