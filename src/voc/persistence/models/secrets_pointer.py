"""SQLAlchemy model for the ``secrets_pointers`` table.

Lookup-only — no FKs.  Maps an opaque ``secret_ref`` to an external
identifier in the actual secret manager (AWS Secrets Manager / GCP /
SOPS+age).  No secret material is ever stored here.

Single index for reverse lookup by external_id (e.g., when rotating a
secret in the upstream manager and needing to update connector_type
metadata locally).
"""

from __future__ import annotations

from sqlalchemy import Index, Integer, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from src.voc.persistence.models.base import Base


class SecretsPointer(Base):
    __tablename__ = "secrets_pointers"

    secret_ref:     Mapped[str | None] = mapped_column(Text, primary_key=True, nullable=True)
    external_id:    Mapped[str]        = mapped_column(Text, nullable=False)
    schema_version: Mapped[int]        = mapped_column(Integer, nullable=False, server_default=text("1"))
    connector_type: Mapped[str | None] = mapped_column(Text)
    rotated_at:     Mapped[str | None] = mapped_column(Text)
    created_at:     Mapped[str]        = mapped_column(Text, nullable=False)

    __table_args__ = (
        Index("ix_secrets_pointers_external_id", "external_id"),
    )
