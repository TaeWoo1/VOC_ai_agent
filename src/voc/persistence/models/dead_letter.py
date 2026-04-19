"""SQLAlchemy model for the ``dead_letter`` table.

Failed-jobs payload after retries are exhausted.  FK to sync_jobs is
RESTRICT — DLQ entries are failure-mode evidence that should outlive the
original job row.

Indexes: per-job lookup (for forensic correlation) and timeline ordering.
"""

from __future__ import annotations

from sqlalchemy import ForeignKey, Index, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.voc.persistence.models.base import Base


class DeadLetter(Base):
    __tablename__ = "dead_letter"

    dead_letter_id:   Mapped[str | None] = mapped_column(Text, primary_key=True, nullable=True)
    job_id:           Mapped[str]        = mapped_column(
        Text,
        ForeignKey("sync_jobs.job_id", name="fk_dead_letter_job_id", ondelete="RESTRICT"),
        nullable=False,
    )
    queue_name:       Mapped[str]        = mapped_column(Text, nullable=False)
    payload_json:     Mapped[str]        = mapped_column(Text, nullable=False)
    error_chain_json: Mapped[str]        = mapped_column(Text, nullable=False)
    attempts:         Mapped[int]        = mapped_column(Integer, nullable=False)
    moved_at:         Mapped[str]        = mapped_column(Text, nullable=False)
    replayed_at:      Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        Index("ix_dead_letter_job_id",   "job_id"),
        Index("ix_dead_letter_moved_at", "moved_at"),
    )
