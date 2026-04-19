"""Alembic environment configuration.

Sync-only: Alembic itself runs DDL synchronously.  The application's runtime
session factory (src/voc/persistence/session.py) is independent and async.

URL precedence:
    1. DATABASE_URL environment variable (production override)
    2. sqlalchemy.url from alembic.ini (default: SQLite dev DB)

target_metadata is wired to the SQLAlchemy models registered under
src.voc.persistence.models so `alembic revision --autogenerate` can compare
the live DB schema against the model definitions.
"""

from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import Float, engine_from_config, pool
from sqlalchemy.dialects.sqlite import REAL as SqliteREAL

from src.voc.persistence.models import metadata as models_metadata

# Alembic Config object — provides access to alembic.ini values.
config = context.config

# Resolve the URL: env var beats ini default.
_database_url = os.environ.get("DATABASE_URL") or config.get_main_option("sqlalchemy.url")
if _database_url:
    config.set_main_option("sqlalchemy.url", _database_url)

# Initialize logging from alembic.ini if present.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Wired in PR 2: importing src.voc.persistence.models registers the four
# baseline tables (entities, sync_jobs, source_connections, snapshots) on
# the shared MetaData, so `alembic revision --autogenerate` can compare the
# live DB schema against the model definitions.
target_metadata = models_metadata


def _compare_type(ctx, inspected_column, metadata_column, inspected_type, metadata_type):
    """Narrow comparator override: suppress the SQLite REAL ↔ generic Float
    false positive.

    SQLite reflects REAL columns as ``sqlalchemy.dialects.sqlite.REAL``,
    while our cross-dialect models declare them as ``sqlalchemy.Float``.
    The two render to identical SQLite DDL (``REAL``), so treating them as
    drift would force every snapshot-rating model to import a SQLite-only
    type.  Returning False here means "no change"; returning None defers
    to Alembic's default comparison for everything else.

    This rule fires ONLY for SQLite; on Postgres the dialect-class identity
    issue does not arise and the default comparator runs as usual.
    """
    if ctx.dialect.name == "sqlite":
        if isinstance(inspected_type, SqliteREAL) and isinstance(metadata_type, Float):
            return False
    return None


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (emit SQL to stdout, no DB connection)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        # Render type comparisons against the SQL dialect of the URL.
        compare_type=_compare_type,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode (open a DB connection, apply DDL)."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=_compare_type,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
