"""SQLAlchemy model for the ``sync_jobs`` table.

Mirrors the DDL in ``0001_baseline.py`` exactly.  See entity.py for the
column-style rationale (Text + server_default).
"""

from __future__ import annotations

from sqlalchemy import Integer, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from src.voc.persistence.models.base import Base


class SyncJob(Base):
    __tablename__ = "sync_jobs"

    # Baseline fidelity: see entity.py for the NULL-in-TEXT-PK rationale.
    job_id:          Mapped[str | None]  = mapped_column(Text, primary_key=True, nullable=True)
    entity_id:       Mapped[str]         = mapped_column(Text, nullable=False)
    job_type:        Mapped[str]         = mapped_column(Text, nullable=False, server_default=text("'refresh'"))
    status:          Mapped[str]         = mapped_column(Text, nullable=False)
    started_at:      Mapped[str]         = mapped_column(Text, nullable=False)
    finished_at:     Mapped[str | None]  = mapped_column(Text)
    total_collected: Mapped[int | None]  = mapped_column(Integer, server_default=text("0"))
    total_indexed:   Mapped[int | None]  = mapped_column(Integer, server_default=text("0"))
    stages_json:     Mapped[str | None]  = mapped_column(Text)
    errors_json:     Mapped[str | None]  = mapped_column(Text, server_default=text("'[]'"))
    metadata_json:   Mapped[str | None]  = mapped_column(Text, server_default=text("'{}'"))
