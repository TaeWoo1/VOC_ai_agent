"""Discord → orchestrator input adapter + command cores (v0.3 M2).

This is the M2 boundary: it turns Discord input (a slash command's args, or a
free-form natural-language message) into a `TaskRequest`, runs the headless
orchestrator in PROPOSE-ONLY mode (create graph + advance once), and returns a
compact reply string. discord_bot.py wires these cores to slash commands /
on_message; everything here is pure and importable WITHOUT discord.py so it is
unit-testable with tmp paths and no network.

Propose-only invariants (inherited from the orchestrator; nothing here weakens
them): no send, no collection, no PDF render, no packet status.json/send_log.md
mutation, no Claude Code execution. The only writes are the orchestration task
store, the event log, generated_prompts/ proposals, and — on /task_approve —
the append-only approvals.log.jsonl (records intent; never executes).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

import orchestrator as _orch
import task_formatting as _fmt
import task_inputs as _ti
import task_store as _store
from task_model import TaskRequest

# plan-kind → request workflow (the planners then set each task's own workflow)
_KIND_WORKFLOW = {"cardnews": "instagram", "unknown": "ops"}


def request_from_nl(text: str, *, requested_by: str,
                    targets_dir: Optional[Path] = None) -> TaskRequest:
    """Build a TaskRequest from a free-form message, with plan_kind set EXPLICITLY.

    Classification happens here (the adapter), not in the orchestrator core.
    """
    probe = TaskRequest(goal=text, source="discord_nl", requested_by=requested_by,
                        raw_text=text)
    kind = _orch.classify(probe)
    workflow = _KIND_WORKFLOW.get(kind, "outreach")
    return TaskRequest(goal=text, workflow=workflow, source="discord_nl",
                       requested_by=requested_by, raw_text=text,
                       slots={"plan_kind": kind})


def _create_and_advance(req: TaskRequest, store_path: Path, events_path: Path,
                        targets_dir: Optional[Path]) -> str:
    pid = _orch.create_task_graph_for_request(
        req, store_path=store_path, events_path=events_path, targets_dir=targets_dir)
    _orch.advance(pid, store_path=store_path, events_path=events_path,
                  targets_dir=targets_dir)
    tasks = _store.load_tasks(store_path)
    summary = _orch.task_status(pid, store_path)
    return pid, _fmt.format_task_create_result(pid, tasks, summary)


# --- command cores (called by discord_bot.py slash handlers) -----------------
def cmd_tasks(store_path: Path, status: Optional[str] = None) -> str:
    return _fmt.format_tasks(_store.load_tasks(store_path), status=status)


def cmd_task_status(task_id: str, store_path: Path) -> str:
    tasks = _store.load_tasks(store_path)
    if not any(t.task_id == task_id for t in tasks):
        return f"No task matching `{task_id}`."
    return _fmt.format_task_status(task_id, tasks, _orch.task_status(task_id, store_path))


def cmd_task_create(*, workflow: str, goal: str, requested_by: str,
                    store_path: Path, events_path: Path,
                    target_slug: Optional[str] = None,
                    plan_kind: Optional[str] = None, source: str = "slash",
                    targets_dir: Optional[Path] = None) -> dict[str, Any]:
    if plan_kind is None:
        plan_kind = _orch.classify(TaskRequest(
            goal=goal, workflow=workflow, source=source,
            requested_by=requested_by, raw_text=goal))
    slots: dict[str, Any] = {"plan_kind": plan_kind}
    if target_slug:
        slots["target_slug"] = target_slug
    req = TaskRequest(goal=goal, workflow=workflow, source=source,
                      requested_by=requested_by, raw_text=goal, slots=slots)
    pid, reply = _create_and_advance(req, store_path, events_path, targets_dir)
    return {"parent_task_id": pid, "plan_kind": plan_kind, "reply": reply}


def handle_nl_message(text: str, *, operator_discord_id: str, store_path: Path,
                      events_path: Path,
                      targets_dir: Optional[Path] = None) -> dict[str, Any]:
    req = request_from_nl(text, requested_by=operator_discord_id, targets_dir=targets_dir)
    pid, reply = _create_and_advance(req, store_path, events_path, targets_dir)
    return {"parent_task_id": pid, "plan_kind": req.slots["plan_kind"], "reply": reply}


def cmd_task_approve(*, task_id: str, operator_discord_id: str, store_path: Path,
                     events_path: Path, notes: str = "",
                     operator_display_name: Optional[str] = None,
                     approvals_path: Optional[Path] = None,
                     targets_dir: Optional[Path] = None) -> str:
    """Record approval intent ONLY. Deliberately does NOT call advance(): M2 never
    auto-executes a gated action; the operator runs the next step manually."""
    result = _orch.record_task_approval(
        task_id, operator_discord_id=operator_discord_id,
        operator_display_name=operator_display_name, notes=notes,
        store_path=store_path, events_path=events_path,
        approvals_path=approvals_path, targets_dir=targets_dir)
    return _fmt.format_approval_result(result)


def cmd_task_cancel(*, task_id: str, store_path: Path, events_path: Path,
                    reason: str = "") -> str:
    task = _store.get_task(task_id, store_path)
    if task is None:
        return f"No task matching `{task_id}`."
    task = _orch.cancel_task(task_id, store_path=store_path,
                             events_path=events_path, reason=reason)
    return _fmt.format_cancel_result(task)


def cmd_agent_status() -> str:
    return _fmt.format_agent_status()


def cmd_set_candidate(*, task_id: str, store_path: Path, events_path: Path,
                      slug: str, brand: str, goods_no: str, product_name: str,
                      product_url: Optional[str] = None,
                      note: Optional[str] = None) -> str:
    """Attach a structured candidate to a candidate_shortlist_pick task.

    Records-only via task_inputs.set_candidate: edits inputs, appends a task
    snapshot + event, and invalidates any stale approval. Never scaffolds /
    executes. Returns a compact reply string.
    """
    candidate: dict[str, Any] = {"slug": slug, "brand": brand,
                                 "goods_no": goods_no, "product_name": product_name}
    if product_url:
        candidate["product_url"] = product_url
    if note:
        candidate["note"] = note
    try:
        result = _ti.set_candidate(task_id, candidate, store_path=store_path,
                                   events_path=events_path)
    except _ti.CandidateInputError as exc:
        return _fmt.format_set_candidate_result(
            {"ok": False, "reason": exc.reason, "message": str(exc)})
    return _fmt.format_set_candidate_result(result)
