"""Alembic environment configuration.

Sync-only: Alembic itself runs DDL synchronously.  The application's runtime
session factory (src/voc/persistence/session.py) is independent and async.

URL precedence:
    1. DATABASE_URL environment variable (production override)
    2. sqlalchemy.url from alembic.ini (default: SQLite dev DB)

target_metadata is intentionally an empty MetaData() in PR 1 — no SQLAlchemy
models exist yet.  PR 2 will populate it; once populated, `alembic revision
--autogenerate` will become useful.  Until then, migrations are hand-written.
"""

from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import MetaData, engine_from_config, pool

# Alembic Config object — provides access to alembic.ini values.
config = context.config

# Resolve the URL: env var beats ini default.
_database_url = os.environ.get("DATABASE_URL") or config.get_main_option("sqlalchemy.url")
if _database_url:
    config.set_main_option("sqlalchemy.url", _database_url)

# Initialize logging from alembic.ini if present.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Empty metadata for PR 1 — autogenerate has nothing to compare against yet.
# PR 2 (SQLAlchemy models for existing tables) replaces this with the real
# metadata import: `from src.voc.persistence.models import metadata`.
target_metadata: MetaData = MetaData()


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (emit SQL to stdout, no DB connection)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        # Render type comparisons against the SQL dialect of the URL.
        compare_type=True,
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
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
