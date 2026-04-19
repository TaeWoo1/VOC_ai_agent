"""Persistence models package.

Importing this package transitively imports each model module, which causes
the SQLAlchemy table definitions to register against the shared
``Base.metadata``.  Alembic's env.py imports ``metadata`` from here as
``target_metadata`` so autogenerate can compare the live DB schema against
the model definitions.

Add new models in subsequent PRs by importing them here as well.
"""

from __future__ import annotations

from src.voc.persistence.models.base import Base, metadata

# Baseline (PR 2) — the four tables already created by 0001_baseline.
from src.voc.persistence.models.entity import Entity
from src.voc.persistence.models.snapshot import Snapshot
from src.voc.persistence.models.source_connection import SourceConnection
from src.voc.persistence.models.sync_job import SyncJob

# Tenancy (PR 3 / 0002).
from src.voc.persistence.models.account import Account
from src.voc.persistence.models.workspace import Workspace
from src.voc.persistence.models.api_key import ApiKey
from src.voc.persistence.models.user import User
from src.voc.persistence.models.workspace_member import WorkspaceMember

# Domain (PR 3 / 0002).
from src.voc.persistence.models.listing import Listing
from src.voc.persistence.models.review import Review

# Operational (PR 3 / 0002).
from src.voc.persistence.models.ingestion_attempt import IngestionAttempt
from src.voc.persistence.models.alert import Alert
from src.voc.persistence.models.audit_log import AuditLog
from src.voc.persistence.models.secrets_pointer import SecretsPointer
from src.voc.persistence.models.dead_letter import DeadLetter
from src.voc.persistence.models.indexing_run import IndexingRun

__all__ = [
    "Base",
    "metadata",
    # Baseline
    "Entity",
    "Snapshot",
    "SourceConnection",
    "SyncJob",
    # Tenancy
    "Account",
    "Workspace",
    "ApiKey",
    "User",
    "WorkspaceMember",
    # Domain
    "Listing",
    "Review",
    # Operational
    "IngestionAttempt",
    "Alert",
    "AuditLog",
    "SecretsPointer",
    "DeadLetter",
    "IndexingRun",
]
