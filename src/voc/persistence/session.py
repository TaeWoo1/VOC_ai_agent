"""Async SQLAlchemy session foundation.

Created in M1 PR 1.  Provides:
  - make_engine(url)           — build an AsyncEngine from a URL
  - make_session_factory(eng)  — build an async_sessionmaker bound to an engine
  - session_scope(factory)     — async context manager (commit on success,
                                 rollback on exception, close on exit)

Intentionally NOT imported by any application code path in PR 1.  The legacy
sqlite3 init_db() in src/voc/persistence/migrations.py remains the source of
truth for the running app until M5 cutover.  PR 2 introduces the first
SQLAlchemy models that consume this module.

URL conventions:
  - SQLite (local dev / tests):  sqlite+aiosqlite:///./voc_data.db
  - Postgres (production):       postgresql+asyncpg://user:pass@host:5432/voc

Migrations use SYNC URLs (configured in alembic.ini); the application uses
ASYNC URLs through this module.  Keeping the two channels separate lets
operators run alembic without an event loop and lets the app remain async
end-to-end.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def make_engine(url: str, *, echo: bool = False) -> AsyncEngine:
    """Build an async SQLAlchemy engine from a URL.

    Args:
        url:  An async SQLAlchemy URL — for example
              ``sqlite+aiosqlite:///./voc_data.db`` (dev) or
              ``postgresql+asyncpg://user:pass@host:5432/voc`` (production).
        echo: When True, SQLAlchemy logs every statement to the ``sqlalchemy``
              logger.  Off by default; useful for local debugging only.

    Returns:
        AsyncEngine.  The caller is responsible for disposing it on shutdown
        (``await engine.dispose()``).
    """
    return create_async_engine(url, echo=echo, future=True)


def make_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """Build an async session factory bound to ``engine``.

    ``expire_on_commit=False`` so callers can read attribute values from
    ORM objects after commit without triggering a fresh round-trip — this
    matches the prevailing pattern in repositories that hand back dict-shaped
    results to the service layer.
    """
    return async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@asynccontextmanager
async def session_scope(
    factory: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    """Open a session, commit on success, rollback on exception, close on exit.

    Usage::

        async with session_scope(factory) as session:
            session.add(some_row)
            ...

    No nesting handling — callers that need savepoints should use
    ``session.begin_nested()`` explicitly inside the scope.
    """
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
