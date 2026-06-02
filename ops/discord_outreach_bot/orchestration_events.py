"""Append-only event spine for the v0.3 orchestration core (M1).

The immutable audit trail of what the orchestrator did: every task creation and
transition appends one event. Same shape/style as approval_log.py (stdlib only,
injectable `now`, JSONL append-only, no update/delete).

Writing an event has NO side effects beyond this log: it does NOT send, collect,
render, commit, or mutate any packet status.json / send_log.md. `approvals.log.jsonl`
remains the separate, authoritative record of explicit operator approval intent;
events here may *reference* an approval but never replace it.
"""

from __future__ import annotations

import datetime as _dt
import json
import uuid
from pathlib import Path
from typing import Any, Callable, Optional

# Recognized event types (open-ish, but these are the M1 transitions).
EVENT_TYPES = (
    "task_created",
    "task_assigned",
    "gate_checked",
    "report_produced",
    "approval_requested",
    "approval_recorded",
    "awaiting_manual_execution",
    "task_blocked",
    "task_done",
    "task_failed",
    "task_cancelled",
    "clarification_requested",
    "task_input_set",
    "approval_invalidated_due_to_input_change",
    "run_rolled_back",
    "codex_review_requested",
    "codex_review_passed",
    "codex_review_failed",
)

_DEFAULT_NAME = "orchestration_events.jsonl"


def find_repo_root(start: Optional[Path] = None) -> Path:
    here = (start or Path(__file__)).resolve()
    for parent in [here, *here.parents]:
        if (parent / ".git").exists() or (parent / "CLAUDE.md").exists():
            return parent
    return Path(__file__).resolve().parents[2]


def default_events_path(repo_root: Optional[Path] = None) -> Path:
    root = repo_root or find_repo_root()
    return root / "ops" / "discord_outreach_bot" / _DEFAULT_NAME


def make_event(
    *,
    event_type: str,
    source: str = "system",
    requested_by: Optional[str] = None,
    operator_discord_id: Optional[str] = None,
    task_id: Optional[str] = None,
    parent_task_id: Optional[str] = None,
    workflow: Optional[str] = None,
    target_slug: Optional[str] = None,
    current_state: Optional[str] = None,
    intended_stage: Optional[str] = None,
    gate: Optional[str] = None,
    status: Optional[str] = None,
    message: str = "",
    now: Optional[Callable[[], _dt.datetime]] = None,
) -> dict[str, Any]:
    """Build one event record (does not write it). Schema is fixed."""
    if event_type not in EVENT_TYPES:
        raise ValueError(f"event_type must be one of {EVENT_TYPES}, got {event_type!r}")
    ts = now() if now else _dt.datetime.now(_dt.timezone.utc)
    timestamp_utc = ts.astimezone(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "event_id": uuid.uuid4().hex,
        "ts_utc": timestamp_utc,
        "event_type": event_type,
        "source": source,
        "requested_by": requested_by,
        "operator_discord_id": operator_discord_id,
        "task_id": task_id,
        "parent_task_id": parent_task_id,
        "workflow": workflow,
        "target_slug": target_slug,
        "current_state": current_state,
        "intended_stage": intended_stage,
        "gate": gate,
        "status": status,
        "message": message,
    }


def append_event(event: dict[str, Any], events_path: Optional[Path] = None) -> Path:
    """Append one event as a JSONL line. Append-only: never truncates."""
    path = Path(events_path) if events_path else default_events_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(event, ensure_ascii=False, sort_keys=False)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")
    return path


def read_events(events_path: Optional[Path] = None) -> list[dict[str, Any]]:
    """Read all events. Returns [] if the log is absent."""
    path = Path(events_path) if events_path else default_events_path()
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if raw:
            out.append(json.loads(raw))
    return out
