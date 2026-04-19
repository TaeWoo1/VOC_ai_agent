"""Stable, well-known UUIDs for system seed rows.

The constants below are inserted by Alembic migration 0002 and referenced
by future PRs that need to address the default tenancy rows (PR 6 dual-write,
PR 7 auth bootstrap).  They are LOCKED — changing them after this commit
would break PR 6+ which write data scoped to these UUIDs.

Derivation (informational; the values below are hardcoded literals):

    import uuid
    DEFAULT_ACCOUNT_ID   = str(uuid.uuid5(uuid.NAMESPACE_DNS, "voc-default-account"))
    DEFAULT_WORKSPACE_ID = str(uuid.uuid5(uuid.NAMESPACE_DNS, "voc-default-workspace"))

This module is safe to import from any context including Alembic env.py
and migration files: it has no dependencies beyond ``__future__`` and no
side effects.  Constants are baked-in literals; nothing is computed at
import time.
"""

from __future__ import annotations

DEFAULT_ACCOUNT_ID:   str = "a2d6a1af-ba9b-50f2-94f1-6be446a7da23"
DEFAULT_WORKSPACE_ID: str = "d0e216a8-6b8f-5003-8153-00207ae60033"
