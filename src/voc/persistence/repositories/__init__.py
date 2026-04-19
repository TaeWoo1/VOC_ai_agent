"""SQLAlchemy-backed repositories.

These mirror the legacy sqlite3 repositories in
src/voc/persistence/repository.py: same public method names, same arg
names, same dict-shaped return values.  Two intentional differences:

  - constructor takes an ``async_sessionmaker`` factory, not a
    ``sqlite3.Connection``;
  - all methods are ``async`` (require ``await``).

Application code paths still use the legacy sync repos in PR 2.  These SA
repos are exercised by parity tests and become the production path in
later PRs as repos are gradually swapped.

Imports inside this package are restricted to ``sqlalchemy``, ``json``, and
the local model + session-scope modules.  No application config, no
logger, no FastAPI.
"""
