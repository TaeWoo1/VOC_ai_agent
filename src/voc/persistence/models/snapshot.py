"""SQLAlchemy model for the ``snapshots`` table.

Mirrors the DDL in ``0001_baseline.py`` exactly.  See entity.py for the
column-style rationale (Text + server_default).  This is the only existing
table that uses REAL columns; they map to SQLAlchemy ``Float``.
"""

from __future__ import annotations

from sqlalchemy import Float, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.voc.persistence.models.base import Base


class Snapshot(Base):
    __tablename__ = "snapshots"

    # Baseline fidelity: see entity.py for the NULL-in-TEXT-PK rationale.
    snapshot_id:      Mapped[str | None]    = mapped_column(Text, primary_key=True, nullable=True)
    entity_id:        Mapped[str]           = mapped_column(Text, nullable=False)
    job_id:           Mapped[str | None]    = mapped_column(Text)
    captured_at:      Mapped[str]           = mapped_column(Text, nullable=False)
    total_reviews:    Mapped[int | None]    = mapped_column(Integer)
    avg_rating:       Mapped[float | None]  = mapped_column(Float)
    negative_count:   Mapped[int | None]    = mapped_column(Integer)
    low_rating_ratio: Mapped[float | None]  = mapped_column(Float)
    channels_json:    Mapped[str | None]    = mapped_column(Text)
    summary_text:     Mapped[str | None]    = mapped_column(Text)
    dashboard_json:   Mapped[str | None]    = mapped_column(Text)
