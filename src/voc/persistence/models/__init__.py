"""Persistence models package.

Importing this package transitively imports each model module, which causes
the SQLAlchemy table definitions to register against the shared
``Base.metadata``.  Alembic's env.py imports ``metadata`` from here as
``target_metadata`` so autogenerate can compare the live DB schema against
the model definitions.

Add new models in PR 3 by importing them here as well.
"""

from __future__ import annotations

from src.voc.persistence.models.base import Base, metadata
from src.voc.persistence.models.entity import Entity
from src.voc.persistence.models.snapshot import Snapshot
from src.voc.persistence.models.source_connection import SourceConnection
from src.voc.persistence.models.sync_job import SyncJob

__all__ = [
    "Base",
    "metadata",
    "Entity",
    "Snapshot",
    "SourceConnection",
    "SyncJob",
]
