"""Append-only snapshot store for orchestration tasks (v0.3 M1).

Storage model: snapshot-append JSONL. Every task mutation appends the FULL
task record as one line. The current view is reconstructed by folding the file
and keeping the LAST snapshot per `task_id`. There is no update/delete path by
construction — like approval_log.py, the file is append-only.

This is deliberately NOT full event-sourcing (no deltas to replay). For a
3-packet operation, snapshot-append is crash-safe, audit-friendly, and trivial
to read. The immutable *event spine* lives in orchestration_events.py.

This module writes ONLY the task-store JSONL passed to it. It never touches a
packet's status.json / send_log.md.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from task_model import Task

# default lives next to the other bot logs; tests pass their own tmp path.
_DEFAULT_NAME = "orchestration_tasks.jsonl"


def find_repo_root(start: Optional[Path] = None) -> Path:
    here = (start or Path(__file__)).resolve()
    for parent in [here, *here.parents]:
        if (parent / ".git").exists() or (parent / "CLAUDE.md").exists():
            return parent
    return Path(__file__).resolve().parents[2]


def default_store_path(repo_root: Optional[Path] = None) -> Path:
    root = repo_root or find_repo_root()
    return root / "ops" / "discord_outreach_bot" / _DEFAULT_NAME


def append_task_snapshot(task: Task, path: Optional[Path] = None) -> Path:
    """Append one full task snapshot as a JSONL line. Append-only."""
    task.validate()
    p = Path(path) if path else default_store_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(task.to_record(), ensure_ascii=False, sort_keys=False)
    with p.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")
    return p


def _fold_latest(path: Path) -> dict[str, Task]:
    """task_id -> latest snapshot, in file order of last appearance."""
    latest: dict[str, Task] = {}
    if not path.exists():
        return latest
    for raw in path.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if not raw:
            continue
        try:
            t = Task.from_record(json.loads(raw))
        except (json.JSONDecodeError, TypeError, ValueError):
            continue  # skip a corrupt line rather than crash the whole view
        # reinsert to keep most-recently-updated ordering deterministic
        latest.pop(t.task_id, None)
        latest[t.task_id] = t
    return latest


def load_tasks(path: Optional[Path] = None) -> list[Task]:
    """Current view: last snapshot wins per task_id. Sorted by created_at, id."""
    p = Path(path) if path else default_store_path()
    tasks = list(_fold_latest(p).values())
    tasks.sort(key=lambda t: (t.created_at, t.task_id))
    return tasks


def get_task(task_id: str, path: Optional[Path] = None) -> Optional[Task]:
    p = Path(path) if path else default_store_path()
    return _fold_latest(p).get(task_id)


def list_tasks(
    path: Optional[Path] = None,
    *,
    workflow: Optional[str] = None,
    status: Optional[str] = None,
    parent_task_id: Optional[str] = None,
    assigned_agent: Optional[str] = None,
) -> list[Task]:
    """Filtered current view (all filters AND-combined; None = no filter)."""
    out = load_tasks(path)
    if workflow is not None:
        out = [t for t in out if t.workflow == workflow]
    if status is not None:
        out = [t for t in out if t.status == status]
    if parent_task_id is not None:
        out = [t for t in out if t.parent_task_id == parent_task_id]
    if assigned_agent is not None:
        out = [t for t in out if t.assigned_agent == assigned_agent]
    return out
