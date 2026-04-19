"""SQLAlchemy 2.0 declarative base.

The single ``Base`` here owns the shared ``MetaData`` instance.  All models
in this package inherit from ``Base`` so their tables register against one
metadata, which is then imported by Alembic's env.py as ``target_metadata``
to enable autogenerate.

Imports are limited to ``sqlalchemy`` only — no application config, no
runtime modules — so this file is safe to import from any context including
``alembic`` CLI invocations that have no application environment loaded.
"""

from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """Project-wide declarative base.  Models inherit from this."""

    pass


# Convenience alias for env.py and tests that want the bare MetaData.
metadata = Base.metadata
