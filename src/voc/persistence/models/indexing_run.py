"""SQLAlchemy model for the ``indexing_runs`` table.

Tracks Indexer Worker progress per review batch.  FK to workspaces only
(CASCADE — indexing-run records are operational and go with the workspace
they index for); no FK to reviews because runs operate on batches whose
membership is recorded in metadata_json.

Indexes: tenant scope, timeline.
"""

from __future__ import annotations

from sqlalchemy import ForeignKey, Index, Integer, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from src.voc.persistence.models.base import Base


class IndexingRun(Base):
    __tablename__ = "indexing_runs"

    indexing_run_id:   Mapped[str | None] = mapped_column(Text, primary_key=True, nullable=True)
    workspace_id:      Mapped[str]        = mapped_column(
        Text,
        ForeignKey("workspaces.workspace_id", name="fk_indexing_runs_workspace_id", ondelete="CASCADE"),
        nullable=False,
    )
    review_batch_size: Mapped[int]        = mapped_column(Integer, nullable=False)
    status:            Mapped[str]        = mapped_column(Text, nullable=False)
    started_at:        Mapped[str]        = mapped_column(Text, nullable=False)
    finished_at:       Mapped[str | None] = mapped_column(Text)
    chunks_created:    Mapped[int | None] = mapped_column(Integer, server_default=text("0"))
    error_summary:     Mapped[str | None] = mapped_column(Text)
    metadata_json:     Mapped[str | None] = mapped_column(Text, server_default=text("'{}'"))

    __table_args__ = (
        Index("ix_indexing_runs_workspace_id", "workspace_id"),
        Index("ix_indexing_runs_started_at",   "started_at"),
    )
