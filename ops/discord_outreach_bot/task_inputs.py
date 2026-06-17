"""M2→M3 bridge: attach a structured candidate to a shortlist-pick task.

Pure logic (no argparse, importable without discord.py). The operator uses this
to capture WHICH SKU an approved `candidate_shortlist_pick` represents, so the
M3-A runner's `scaffold_packet` contract (`task.inputs['candidate']`) is
satisfiable. This module:

  - validates the candidate contract (single source of truth, shared with the
    runner via CANDIDATE_REQUIRED_FIELDS / validate_candidate);
  - sets task.inputs['candidate'] and persists a task snapshot;
  - INVALIDATES any prior approval, because changing the candidate changes the
    task's build_report output (and therefore its prompt_hash) — the operator
    must re-approve the exact candidate-bound proposal before a dry-run.

It NEVER creates packet folders, NEVER mutates packet status.json / send_log.md,
NEVER runs the runner, NEVER sends/collects/renders/publishes, NEVER commits.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import orchestration_events as _oev
import task_store as _store
from task_model import Task

PICK_STAGE = "outreach:candidate_shortlist_pick"
CANDIDATE_REQUIRED_FIELDS = ("slug", "brand", "goods_no", "product_name")
CANDIDATE_OPTIONAL_FIELDS = ("product_url", "note")
_SLUG_RE = re.compile(r"^[a-z0-9_]+$")

# statuses from which attaching candidate input is safe (pre-execution only)
_SETTABLE_STATUSES = ("needs_approval", "queued", "blocked")


class CandidateInputError(ValueError):
    """Raised with a machine-readable `.reason` for the CLI to surface."""

    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason


def validate_candidate(cand: Any) -> dict[str, Any]:
    """Return a normalized candidate dict, or raise CandidateInputError.

    Keeps only known fields; required ones must be non-empty; slug must be safe.
    """
    if not isinstance(cand, dict):
        raise CandidateInputError("missing_candidate_input",
                                  "candidate must be a JSON object")
    for k in CANDIDATE_REQUIRED_FIELDS:
        if not str(cand.get(k) or "").strip():
            raise CandidateInputError(
                "missing_candidate_input",
                f"candidate missing required field {k!r} "
                f"(need {', '.join(CANDIDATE_REQUIRED_FIELDS)})")
    slug = str(cand["slug"])
    if not _SLUG_RE.match(slug):
        raise CandidateInputError("unsafe_slug",
                                  f"slug {slug!r} must match ^[a-z0-9_]+$")
    out: dict[str, Any] = {k: str(cand[k]).strip() for k in CANDIDATE_REQUIRED_FIELDS}
    for k in CANDIDATE_OPTIONAL_FIELDS:
        if str(cand.get(k) or "").strip():
            out[k] = str(cand[k]).strip()
    return out


def set_candidate(task_id: str, candidate: Any, *, store_path: Path,
                  events_path: Path) -> dict[str, Any]:
    """Attach a validated candidate to a shortlist-pick task (no execution).

    Returns {"ok": True, "task_id", "candidate", "approval_invalidated": bool}.
    Raises CandidateInputError on a bad task/stage/status/candidate.
    """
    task = _store.get_task(task_id, store_path)
    if task is None:
        raise CandidateInputError("task_not_found", f"no task with id {task_id!r}")
    if task.intended_stage != PICK_STAGE:
        raise CandidateInputError(
            "wrong_stage",
            f"candidate input only applies to {PICK_STAGE}, task is "
            f"{task.intended_stage!r}")
    if task.status not in _SETTABLE_STATUSES:
        raise CandidateInputError(
            "bad_status",
            f"cannot set candidate on a {task.status!r} task")

    cand = validate_candidate(candidate)
    task.inputs = {**(task.inputs or {}), "candidate": cand}

    # Changing the candidate changes build_report -> prompt_hash; any prior
    # approval is now stale. Invalidate it (Option A) so the operator re-approves
    # the exact candidate-bound proposal before dry-run.
    approval_invalidated = bool(task.approval_ref)
    if approval_invalidated:
        task.approval_ref = None
        task.status = "needs_approval"
        task.approval_required = True
    task.touch()
    _store.append_task_snapshot(task, store_path)

    _emit(events_path, "task_input_set", task,
          message=f"candidate input attached: {cand['slug']}")
    if approval_invalidated:
        _emit(events_path, "approval_invalidated_due_to_input_change", task,
              message="prior approval cleared — re-approve the candidate-bound proposal")

    return {"ok": True, "task_id": task_id, "candidate": cand,
            "approval_invalidated": approval_invalidated,
            "status": task.status}


def _emit(events_path: Path, event_type: str, task: Task, *, message: str) -> None:
    _oev.append_event(_oev.make_event(
        event_type=event_type, source="task_input_cli", task_id=task.task_id,
        parent_task_id=task.parent_task_id, workflow=task.workflow,
        target_slug=task.target_slug, intended_stage=task.intended_stage,
        gate=task.gate, status=task.status, message=message), events_path)
