"""D5-2a: pure Discord status route for the read-only operator status indexer.

This module turns a small set of anchored, full-message operator phrases into a
formatted status card string, by delegating to the D5-1 read-only indexer
(`operator_status`). It is intentionally tiny and side-effect free:

  - Anchored full-message regex only — no substring / broad-NL matching, so it
    never shadows `진행해`, `취소`, final-approval phrases, or any action route.
  - Returns a plain `str` (the card, or a fixed safe error string) on a match,
    or `None` on no match so the caller's existing flow runs unchanged.
  - No `discord` import, no action-dispatch module, no provider/network import.
  - Reads nothing and writes nothing itself; the only work is calling the
    already-read-only `operator_status` functions.

D5-2b (separate change) wires `try_handle_status_message` into
`task_discord_adapter.handle_nl_message` as a one-line step. This module adds no
wiring of its own.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

import operator_status  # flat import (bot is not a src.* package; see conftest)

# Anchored, full-message phrase grammar.
#   group 1 = the status trigger
#   group 2 = optional smoke modifier (presence => include_smoke=True)
# IGNORECASE only affects the ASCII alternatives ("operator status" / "status" /
# "include smoke"); Korean phrases are unaffected.
_STATUS_RE = re.compile(
    r"^\s*"
    r"(상태(?:\s*알려줘)?|오늘\s*작업\s*보여줘|operator\s*status|status)"
    r"(?:\s+(smoke\s*포함|include[_\s]?smoke|smoke))?"
    r"\s*$",
    re.IGNORECASE,
)

_STATUS_UNAVAILABLE = "⚠️ operator status unavailable (indexer error). No state was changed."


def try_handle_status_message(
    text: str,
    repo_root: Optional[Path] = None,
) -> Optional[str]:
    """Return a status card string if `text` is a status request, else None.

    On a match, builds the read-only operator status (smoke included only when
    the optional smoke modifier is present) and formats it. Any error from the
    indexer/formatter degrades to a fixed safe string — this never raises.
    """
    if not isinstance(text, str):
        return None
    match = _STATUS_RE.match(text)
    if match is None:
        return None

    include_smoke = match.group(2) is not None
    try:
        status = operator_status.build_operator_status(
            repo_root=repo_root, include_smoke=include_smoke
        )
        return operator_status.format_status_card(status)
    except Exception:  # noqa: BLE001 — degrade to a safe message, never leak/raise
        return _STATUS_UNAVAILABLE
