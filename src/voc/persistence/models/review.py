"""SQLAlchemy model for the ``reviews`` table.

The new canonical review row.  Replaces the legacy ``canonical_reviews``
shape across PRs 6+.  In PR 3 the table is created and indexed but no
production code writes to it yet.

FKs (all RESTRICT to prevent silent data loss): account, workspace,
listing.  ``channel_connection_id`` is a plain TEXT pointer in PR 3 — the
FK is added in PR 4 when ``source_connections`` is renamed to
``channel_connections``.

Indexes:
  - ``ix_reviews_workspace_listing_fingerprint`` on
    (workspace_id, listing_id, content_fingerprint) is **NON-UNIQUE** in
    PR 3.  The UNIQUE constraint on this triple is intentionally deferred
    to PR 6, when dual-write and synthesized listing_id behavior land.
  - ``ix_reviews_workspace_posted_at``         — recent reviews per workspace
  - ``ix_reviews_workspace_listing_posted_at`` — recent reviews per listing
  - ``ix_reviews_workspace_connection``        — reviews per channel connection

JSON columns (``owner_reply_json``, ``metadata_json``) are stored as Text
and serialized via explicit json.loads/dumps in the repository layer.
``is_duplicate`` is stored as Integer (0/1) per the cross-dialect
portability convention; SA Boolean would create a dialect-class identity
issue similar to REAL ↔ Float.
"""

from __future__ import annotations

from sqlalchemy import Float, ForeignKey, Index, Integer, Text
from sqlalchemy import text as sa_text  # local alias: this model has a "text" column that would shadow sqlalchemy.text inside the class body
from sqlalchemy.orm import Mapped, mapped_column

from src.voc.persistence.models.base import Base


class Review(Base):
    __tablename__ = "reviews"

    review_id:             Mapped[str | None]   = mapped_column(Text, primary_key=True, nullable=True)
    account_id:            Mapped[str]          = mapped_column(
        Text,
        ForeignKey("accounts.account_id", name="fk_reviews_account_id", ondelete="RESTRICT"),
        nullable=False,
    )
    workspace_id:          Mapped[str]          = mapped_column(
        Text,
        ForeignKey("workspaces.workspace_id", name="fk_reviews_workspace_id", ondelete="RESTRICT"),
        nullable=False,
    )
    listing_id:            Mapped[str]          = mapped_column(
        Text,
        ForeignKey("listings.listing_id", name="fk_reviews_listing_id", ondelete="RESTRICT"),
        nullable=False,
    )
    channel_connection_id: Mapped[str | None]   = mapped_column(Text)
    source_channel:        Mapped[str]          = mapped_column(Text, nullable=False)
    source_external_id:    Mapped[str | None]   = mapped_column(Text)
    source_url:            Mapped[str | None]   = mapped_column(Text)
    text:                  Mapped[str]          = mapped_column(Text, nullable=False)
    rating_normalized:     Mapped[float | None] = mapped_column(Float)
    rating_raw:            Mapped[float | None] = mapped_column(Float)
    language:              Mapped[str]          = mapped_column(Text, nullable=False)
    author_handle_hash:    Mapped[str | None]   = mapped_column(Text)
    posted_at:             Mapped[str | None]   = mapped_column(Text)
    collected_at:          Mapped[str]          = mapped_column(Text, nullable=False)
    ingested_at:           Mapped[str]          = mapped_column(Text, nullable=False)
    content_fingerprint:   Mapped[str]          = mapped_column(Text, nullable=False)
    is_duplicate:          Mapped[int]          = mapped_column(Integer, nullable=False, server_default=sa_text("0"))
    duplicate_of:          Mapped[str | None]   = mapped_column(Text)
    owner_reply_json:      Mapped[str | None]   = mapped_column(Text)
    metadata_json:         Mapped[str | None]   = mapped_column(Text, server_default=sa_text("'{}'"))

    __table_args__ = (
        Index(
            "ix_reviews_workspace_listing_fingerprint",
            "workspace_id", "listing_id", "content_fingerprint",
        ),
        Index("ix_reviews_workspace_posted_at",         "workspace_id", "posted_at"),
        Index("ix_reviews_workspace_listing_posted_at", "workspace_id", "listing_id", "posted_at"),
        Index("ix_reviews_workspace_connection",        "workspace_id", "channel_connection_id"),
    )
