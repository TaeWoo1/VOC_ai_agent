"""Append-only operator-approval log for the Discord outreach bot (v0.2).

This module records operator *intent* only. Writing a record:
  - does NOT send email, run collection, render a PDF, or commit;
  - does NOT mutate any packet's status.json or send_log.md;
  - does NOT bypass a 🔴 gate.

The actual 🔴 action still runs as an operator-authorized Claude Code turn
(or a future local runner that re-checks the matching record first). The log
is the audit trail of who authorized what, when — nothing more.

Storage is one JSON object per line (JSONL), opened in append mode. There is no
update/delete path here by construction: the log is append-only.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import json
from pathlib import Path
from typing import Any, Callable, Optional

# Stages that are 🔴 gates in the outreach workflow. Approval may be recorded
# for any stage, but these are the ones that genuinely need a fresh record.
GATED_STAGES = ("collect_execute", "render_pdf", "prepare_send", "send_final",
                "prepare_publish", "publish_final", "follow_up")

# Recognized execution modes (the Discord /outreach_approve command fixes this
# to "prompt_only"; the others are reserved for a future local runner).
EXECUTION_MODES = ("prompt_only", "local_run", "manual_record")

_PREVIEW_CHARS = 200


def find_repo_root(start: Optional[Path] = None) -> Path:
    here = (start or Path(__file__)).resolve()
    for parent in [here, *here.parents]:
        if (parent / ".git").exists() or (parent / "CLAUDE.md").exists():
            return parent
    return Path(__file__).resolve().parents[2]


def default_log_path(repo_root: Optional[Path] = None) -> Path:
    root = repo_root or find_repo_root()
    return root / "ops" / "discord_outreach_bot" / "approvals.log.jsonl"


def prompt_hash(prompt: str) -> str:
    """Stable content hash of a generated prompt (tamper / version evidence)."""
    digest = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def _preview(prompt: str) -> str:
    """First ~200 chars, single-lined, for human-readable audit."""
    collapsed = " ".join(prompt.split())
    return collapsed[:_PREVIEW_CHARS]


def make_record(
    *,
    target_slug: str,
    current_state: str,
    approved_stage: str,
    prompt: str,
    operator_discord_id: str,
    operator_display_name: Optional[str] = None,
    execution_mode: str = "prompt_only",
    notes: str = "",
    source: str = "discord",
    now: Optional[Callable[[], _dt.datetime]] = None,
) -> dict[str, Any]:
    """Build one approval record (does not write it).

    `now` is injectable for deterministic tests; it must return a tz-aware UTC
    datetime. The record schema is fixed — every field below is always present.
    """
    if execution_mode not in EXECUTION_MODES:
        raise ValueError(
            f"execution_mode must be one of {EXECUTION_MODES}, got {execution_mode!r}"
        )
    ts = (now() if now else _dt.datetime.now(_dt.timezone.utc))
    timestamp_utc = ts.astimezone(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "timestamp_utc": timestamp_utc,
        "operator_discord_id": str(operator_discord_id),
        "operator_display_name": operator_display_name,
        "target_slug": target_slug,
        "current_state": current_state,
        "approved_stage": approved_stage,
        "execution_mode": execution_mode,
        "prompt_hash": prompt_hash(prompt),
        "prompt_preview": _preview(prompt),
        "notes": notes,
        "source": source,
    }


def append_record(record: dict[str, Any], log_path: Optional[Path] = None) -> Path:
    """Append one record as a JSONL line. Append-only: never truncates."""
    path = Path(log_path) if log_path else default_log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, ensure_ascii=False, sort_keys=False)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")
    return path


def read_records(log_path: Optional[Path] = None) -> list[dict[str, Any]]:
    """Read all records (for inspection/tests). Returns [] if the log is absent."""
    path = Path(log_path) if log_path else default_log_path()
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if raw:
            out.append(json.loads(raw))
    return out
