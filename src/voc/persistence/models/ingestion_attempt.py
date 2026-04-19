"""SQLAlchemy model for the ``ingestion_attempts`` table.

One row per strategy attempt within a sync_jobs row.  ``outcome_code`` is
stored as Text (closed enum enforced at the application layer; native ENUM
would require dialect-specific migrations to evolve the value set).
``connection_id`` is a plain TEXT pointer in PR 3 — FK to
``channel_connections`` is added in PR 4.

FK to sync_jobs (CASCADE — an attempt has no meaning without its parent
job).
"""

from __future__ import annotations

from sqlalchemy import ForeignKey, Index, Integer, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from src.voc.persistence.models.base import Base


class IngestionAttempt(Base):
    __tablename__ = "ingestion_attempts"

    attempt_id:        Mapped[str | None] = mapped_column(Text, primary_key=True, nullable=True)
    job_id:            Mapped[str]        = mapped_column(
        Text,
        ForeignKey("sync_jobs.job_id", name="fk_ingestion_attempts_job_id", ondelete="CASCADE"),
        nullable=False,
    )
    connection_id:     Mapped[str | None] = mapped_column(Text)
    strategy_id:       Mapped[str]        = mapped_column(Text, nullable=False)
    attempt_index:     Mapped[int]        = mapped_column(Integer, nullable=False)
    status:            Mapped[str]        = mapped_column(Text, nullable=False)
    outcome_code:      Mapped[str]        = mapped_column(Text, nullable=False)
    started_at:        Mapped[str]        = mapped_column(Text, nullable=False)
    finished_at:       Mapped[str | None] = mapped_column(Text)
    reviews_collected: Mapped[int | None] = mapped_column(Integer, server_default=text("0"))
    reviews_persisted: Mapped[int | None] = mapped_column(Integer, server_default=text("0"))
    error_summary:     Mapped[str | None] = mapped_column(Text)
    error_chain_json:  Mapped[str | None] = mapped_column(Text)
    metadata_json:     Mapped[str | None] = mapped_column(Text, server_default=text("'{}'"))

    __table_args__ = (
        Index("ix_ingestion_attempts_job_id",        "job_id"),
        Index("ix_ingestion_attempts_connection_id", "connection_id"),
        Index("ix_ingestion_attempts_started_at",    "started_at"),
    )
