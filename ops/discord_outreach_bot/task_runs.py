"""Append-only run log for the guarded local runner (v0.3 M3-A).

Records what the runner verified/did, one JSON object per line. Same append-only
discipline as approval_log.py / orchestration_events.py: no update/delete path.

M3-A writes ONLY `dry_run` records here. It never writes packet files, never
creates target folders, never mutates status.json / send_log.md.
"""

from __future__ import annotations

import datetime as _dt
import json
import uuid
from pathlib import Path
from typing import Any, Callable, Optional

RUN_STATUSES = ("dry_run", "running", "done", "failed", "rolled_back")
CODEX_REVIEW_STATUSES = ("pending", "pass", "fail", "n/a")

_DEFAULT_NAME = "task_runs.jsonl"


def find_repo_root(start: Optional[Path] = None) -> Path:
    here = (start or Path(__file__)).resolve()
    for parent in [here, *here.parents]:
        if (parent / ".git").exists() or (parent / "CLAUDE.md").exists():
            return parent
    return Path(__file__).resolve().parents[2]


def default_runs_path(repo_root: Optional[Path] = None) -> Path:
    root = repo_root or find_repo_root()
    return root / "ops" / "discord_outreach_bot" / _DEFAULT_NAME


def new_run_id() -> str:
    return f"run_{uuid.uuid4().hex[:12]}"


def make_run_record(
    *,
    task_id: str,
    runner_action: str,
    status: str,
    approval_ref: Optional[str] = None,
    prompt_hash: Optional[str] = None,
    files_created: Optional[list[str]] = None,
    files_modified: Optional[list[str]] = None,
    rollback_plan: Optional[list[str]] = None,
    codex_review_status: str = "n/a",
    failure_reason: Optional[str] = None,
    dry_run_preview: Optional[dict[str, Any]] = None,
    run_id: Optional[str] = None,
    now: Optional[Callable[[], _dt.datetime]] = None,
) -> dict[str, Any]:
    """Build one run record (does not write it). Schema is fixed."""
    if status not in RUN_STATUSES:
        raise ValueError(f"status must be one of {RUN_STATUSES}, got {status!r}")
    if codex_review_status not in CODEX_REVIEW_STATUSES:
        raise ValueError(
            f"codex_review_status must be one of {CODEX_REVIEW_STATUSES}, "
            f"got {codex_review_status!r}")
    ts = now() if now else _dt.datetime.now(_dt.timezone.utc)
    stamp = ts.astimezone(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "run_id": run_id or new_run_id(),
        "task_id": task_id,
        "approval_ref": approval_ref,
        "prompt_hash": prompt_hash,
        "runner_action": runner_action,
        "status": status,
        "files_created": files_created or [],
        "files_modified": files_modified or [],
        "rollback_plan": rollback_plan or [],
        "codex_review_status": codex_review_status,
        "started_at": stamp,
        "finished_at": stamp,
        "failure_reason": failure_reason,
        "dry_run_preview": dry_run_preview,
    }


def append_run(record: dict[str, Any], runs_path: Optional[Path] = None) -> Path:
    """Append one run record as a JSONL line. Append-only: never truncates."""
    path = Path(runs_path) if runs_path else default_runs_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, ensure_ascii=False, sort_keys=False)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")
    return path


def read_runs(runs_path: Optional[Path] = None) -> list[dict[str, Any]]:
    """Read all run records. Returns [] if the log is absent."""
    path = Path(runs_path) if runs_path else default_runs_path()
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if raw:
            out.append(json.loads(raw))
    return out


def find_latest_run(task_id: str, status: Optional[str] = None,
                    runs_path: Optional[Path] = None) -> Optional[dict[str, Any]]:
    """Latest run for a task (optionally filtered by status). None if absent."""
    matches = [r for r in read_runs(runs_path)
               if r.get("task_id") == task_id
               and (status is None or r.get("status") == status)]
    return matches[-1] if matches else None


def find_latest_run_for_task_action(task_id: str, runner_action: str,
                                    runs_path: Optional[Path] = None
                                    ) -> Optional[dict[str, Any]]:
    """Latest run (any status) for a (task_id, runner_action) pair."""
    matches = [r for r in read_runs(runs_path)
               if r.get("task_id") == task_id
               and r.get("runner_action") == runner_action]
    return matches[-1] if matches else None


def find_matching_dry_run(task_id: str, runner_action: str, approval_ref: str,
                          prompt_hash: str, runs_path: Optional[Path] = None
                          ) -> Optional[dict[str, Any]]:
    """Latest `dry_run` record exactly matching this approval-bound proposal."""
    matches = [r for r in read_runs(runs_path)
               if r.get("task_id") == task_id
               and r.get("runner_action") == runner_action
               and r.get("status") == "dry_run"
               and r.get("approval_ref") == approval_ref
               and r.get("prompt_hash") == prompt_hash]
    return matches[-1] if matches else None


def records_for_run(run_id: str, runs_path: Optional[Path] = None) -> list[dict[str, Any]]:
    """All records sharing a run_id, in append order (running → done → rolled_back)."""
    return [r for r in read_runs(runs_path) if r.get("run_id") == run_id]


def append_review_outcome(
    run_id: str,
    *,
    codex_review_status: str,
    review_id: str,
    failure_reason: Optional[str] = None,
    runs_path: Optional[Path] = None,
    now: Optional[Callable[[], _dt.datetime]] = None,
) -> Path:
    """Append a post-review run record for `run_id` (v0.3 M3-C).

    The physical write already succeeded, so `status` stays `done`; only
    `codex_review_status` flips to pass/fail (plus the linking `review_id` and,
    on fail, a `failure_reason`). Carries files/plan forward from the prior
    `done` record so the run fold stays self-consistent. Append-only.
    """
    recs = records_for_run(run_id, runs_path)
    base = next((r for r in reversed(recs) if r.get("status") == "done"), None)
    base = base or (recs[-1] if recs else {})
    rec = make_run_record(
        run_id=run_id,
        task_id=base.get("task_id"),
        runner_action=base.get("runner_action") or "scaffold_packet",
        status="done",
        approval_ref=base.get("approval_ref"),
        prompt_hash=base.get("prompt_hash"),
        files_created=base.get("files_created"),
        files_modified=base.get("files_modified"),
        rollback_plan=base.get("rollback_plan"),
        codex_review_status=codex_review_status,
        failure_reason=failure_reason,
        now=now,
    )
    rec["review_id"] = review_id
    return append_run(rec, runs_path)
