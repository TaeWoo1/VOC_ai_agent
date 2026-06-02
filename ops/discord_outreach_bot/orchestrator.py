"""Headless orchestration core for v0.3 M1 (Paperclip-style).

The orchestrator is the CENTER: it turns a normalized `TaskRequest` into a
parent task + dependent subtasks, assigns each to a logical agent, derives the
gate from the workflow state machine (NOT from request wording), advances the
green/ready tasks, halts at red gates as `needs_approval`, and writes the
append-only task + event logs.

Hard M1 boundaries (enforced by simply not having the code to break them):
  - No autonomous execution: agents only return prompt/proposal TEXT.
  - No send / collection / PDF render.
  - No packet mutation: nothing here opens a packet status.json / send_log.md
    for writing. The only writes are the task store, the event log (both passed
    in by the caller / tmp in tests), generated_prompts/ artifacts, and — only
    on explicit approval — approvals.log.jsonl via approval_log.
  - A red task never auto-completes; it can reach `done` only with an
    `approval_ref` (see mark_task_done).

The request classifier here is a minimal keyword stopgap, not the NL handler —
that arrives in M2 as a Discord input adapter that emits the same TaskRequest.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Optional

import approval_log as _alog
import prompt_builder as _pb
import status_reader as _sr
import task_store as _store
from agent_registry import AGENTS
from orchestration_events import append_event, make_event
from task_model import Task, TaskRequest

# Normalized synthetic stage keys (every intended_stage is namespaced or None).
CLARIFICATION = "ops:clarification"

# Brand → slug-prefix aliases for simple target resolution (M1).
_ALIASES = {
    "에스네이처": "snature", "s.nature": "snature", "snature": "snature",
    "휩드": "whipd", "whipped": "whipd", "whipd": "whipd",
    "메노킨": "menokin", "menokin": "menokin",
    "그레이멜린": "graymelin", "graymelin": "graymelin",
}


# --- request classification (M1 stopgap; NOT the NL handler) -----------------
def _classify(request: TaskRequest) -> str:
    explicit = (request.slots or {}).get("plan_kind")
    if explicit:
        return str(explicit)
    text = f"{request.goal} {request.raw_text or ''}".lower()
    no_send = any(k in text for k in ("보내지", "보내지마", "don't send", "do not send", "발송 금지"))
    if request.workflow == "instagram" or any(
        k in text for k in ("카드뉴스", "cardnews", "인스타", "instagram")
    ):
        return "cardnews"
    if (("콜드메일" in text or "cold" in text or "메일" in text or "콜드" in text)
            and ("다음" in text or "후보" in text or "브랜드" in text or "준비" in text)) or (
            "준비" in text and no_send):
        return "cold_email_pipeline"
    if any(k in text for k in ("팔로업", "follow", "답장 없으면", "답장없으면")):
        return "follow_up"
    if any(k in text for k in ("약해", "다시 고쳐", "다시고쳐", "수정", "revision",
                               "ai 냄새", "낮춰", "고쳐")):
        return "packet_revision"
    if "보내" in text and not no_send:
        return "send_ambiguous"
    return "unknown"


def classify(request: TaskRequest) -> str:
    """Public request classifier. M2 input adapters call this to set
    slots['plan_kind'] explicitly, so plan() no longer relies on its internal
    keyword fallback. Returns one of the plan-kind keys (or 'unknown')."""
    return _classify(request)


# --- target resolution -------------------------------------------------------
def _resolve_slug(request: TaskRequest, targets_dir: Optional[Path]) -> Optional[str]:
    slug = (request.slots or {}).get("target_slug")
    if slug:
        t = _sr.get_target(slug, targets_dir)
        return t.slug if t else slug
    ref = request.target_ref or _ref_from_text(request)
    if not ref:
        return None
    direct = _sr.get_target(ref, targets_dir)
    if direct:
        return direct.slug
    low = ref.lower()
    prefix = next((v for k, v in _ALIASES.items() if k in low), None)
    targets = _sr.discover_targets(targets_dir)
    if prefix:
        for t in targets:
            if t.slug.startswith(prefix):
                return t.slug
    for t in targets:
        if ref in (t.brand or "") or low in (t.brand or "").lower():
            return t.slug
    return None


def _ref_from_text(request: TaskRequest) -> Optional[str]:
    text = f"{request.target_ref or ''} {request.raw_text or ''} {request.goal}".lower()
    for k in _ALIASES:
        if k in text:
            return k
    return None


# --- gate derivation (from the state machine, never from text) ---------------
def _stage_command(stage: Optional[str]) -> Optional[str]:
    if not stage:
        return None
    return stage.split(":", 1)[1] if stage.startswith("outreach:") else stage


def _gate_for_stage(stage: Optional[str]) -> str:
    cmd = _stage_command(stage)
    from_state = _pb.COMMAND_FROM_STATE.get(cmd) if cmd else None
    if from_state and _pb.step_for(from_state).gate == _pb.RED:
        return "red"
    return "green"


def _assert_stage_allowed(task: Task) -> None:
    """For REAL workflow stages, the assigned agent must list the command."""
    cmd = _stage_command(task.intended_stage)
    if cmd in _pb.COMMAND_FROM_STATE:  # only validate real stages
        spec = AGENTS.get(task.assigned_agent)
        if not spec or cmd not in spec.allowed_stages:
            raise ValueError(
                f"agent {task.assigned_agent!r} may not run stage {cmd!r}"
            )


# --- task construction -------------------------------------------------------
def _mk(
    *, request: TaskRequest, agent: str, stage: Optional[str], goal: str,
    workflow: Optional[str] = None, parent_id: Optional[str] = None,
    target_slug: Optional[str] = None, deps: Optional[list[str]] = None,
    status: str = "queued", gate: Optional[str] = None,
    approval_required: Optional[bool] = None, inputs: Optional[dict] = None,
) -> Task:
    g = gate if gate is not None else _gate_for_stage(stage)
    ar = approval_required if approval_required is not None else (g == "red")
    return Task(
        goal=goal,
        workflow=workflow or request.workflow,
        assigned_agent=agent,
        requested_by=request.requested_by,
        parent_task_id=parent_id,
        target_slug=target_slug,
        intended_stage=stage,
        status=status,
        gate=g,
        approval_required=ar,
        dependencies=deps or [],
        inputs=inputs or {},
    )


# --- planners ----------------------------------------------------------------
def _plan_cold_email(request: TaskRequest) -> list[Task]:
    parent = _mk(request=request, agent="OpsLoggerAgent", stage=None,
                 goal=request.goal, gate="green", approval_required=False,
                 inputs={"plan_kind": "cold_email_pipeline"})
    parent.intended_stage = None
    # (agent, stage, goal, operator_pick)
    spec = [
        ("CandidateResearchAgent", "outreach:candidate_check", "Research next candidate", False),
        ("CandidateResearchAgent", "outreach:candidate_shortlist_pick",
         "Operator picks ONE candidate", True),
        ("CollectionAgent", "outreach:collect_plan", "Write the collection plan", False),
        ("CollectionAgent", "outreach:collect_execute", "Run live collection", False),
        ("CorpusReviewAgent", "outreach:corpus_review", "Corpus review + claim-risk gate", False),
        ("CorpusReviewAgent", "outreach:angle_select", "Operator selects the angle", False),
        ("OutreachPacketAgent", "outreach:draft_packet", "Draft the packet", False),
        ("OutreachPacketAgent", "outreach:copy_qa", "Copy QA", False),
        ("OutreachPacketAgent", "outreach:render_pdf", "Render the 2-page PDF", False),
        ("RecipientAgent", "outreach:prepare_send", "Prepare send (do NOT send)", False),
    ]
    children: list[Task] = []
    prev_id: Optional[str] = None
    for agent, stage, goal, operator_pick in spec:
        deps = [prev_id] if prev_id else []
        ar = True if operator_pick else None  # operator pick = needs approval (green)
        t = _mk(request=request, agent=agent, stage=stage, goal=goal,
                parent_id=parent.task_id, deps=deps, approval_required=ar)
        children.append(t)
        prev_id = t.task_id
    return [parent, *children]


def _plan_follow_up(request: TaskRequest, targets_dir: Optional[Path]) -> list[Task]:
    slug = _resolve_slug(request, targets_dir)
    target = _sr.get_target(slug, targets_dir) if slug else None
    if not slug or target is None:
        return [_mk(request=request, agent="OpsLoggerAgent", stage="clarification",
                    goal=request.goal, workflow="outreach", status="blocked",
                    gate="green", approval_required=False,
                    inputs={"reason": "follow-up target not resolved"})]
    state = target.state
    return [_mk(request=request, agent="FollowupAgent", stage="outreach:follow_up",
                goal=request.goal, target_slug=slug, status="queued",
                inputs={"current_state": state, "follow_up_due": target.follow_up_due})]


def _plan_packet_revision(request: TaskRequest, targets_dir: Optional[Path]) -> list[Task]:
    slug = _resolve_slug(request, targets_dir)
    if not slug:
        return [_mk(request=request, agent="OutreachPacketAgent", stage=CLARIFICATION,
                    goal=request.goal, workflow="outreach", status="queued",
                    gate="green", approval_required=False,
                    inputs={"reason": "revision target ambiguous"})]
    return [_mk(request=request, agent="OutreachPacketAgent", stage="outreach:packet_revision",
                goal=request.goal, target_slug=slug, status="queued",
                gate="green", approval_required=False)]


def _plan_cardnews(request: TaskRequest) -> list[Task]:
    return [_mk(request=request, agent="InstagramCardnewsAgent",
                stage="instagram:cardnews_plan", goal=request.goal,
                workflow="instagram", status="queued", gate="green",
                approval_required=False)]


def _plan_send_ambiguous(request: TaskRequest, targets_dir: Optional[Path]) -> list[Task]:
    return [_mk(request=request, agent="RecipientAgent", stage=CLARIFICATION,
                goal=request.goal, workflow="outreach", status="queued",
                gate="red", approval_required=True,
                inputs={"reason": "ambiguous target/action; sending is a red gate "
                                  "and is never auto-executed — specify the target"})]


def _plan_unknown(request: TaskRequest) -> list[Task]:
    return [_mk(request=request, agent="OpsLoggerAgent", stage=CLARIFICATION,
                goal=request.goal, workflow="ops", status="queued",
                gate="green", approval_required=False,
                inputs={"reason": "intent not recognized"})]


def plan(request: TaskRequest, targets_dir: Optional[Path] = None) -> list[Task]:
    """Turn a TaskRequest into a parent + dependent subtasks (no persistence)."""
    request.validate()
    kind = _classify(request)
    planners = {
        "cold_email_pipeline": lambda: _plan_cold_email(request),
        "follow_up": lambda: _plan_follow_up(request, targets_dir),
        "packet_revision": lambda: _plan_packet_revision(request, targets_dir),
        "cardnews": lambda: _plan_cardnews(request),
        "send_ambiguous": lambda: _plan_send_ambiguous(request, targets_dir),
    }
    tasks = planners.get(kind, lambda: _plan_unknown(request))()
    for t in tasks:
        _assert_stage_allowed(t)
        t.validate()
    return tasks


# --- persistence + events ----------------------------------------------------
def _emit(events_path, **kw) -> None:
    append_event(make_event(**kw), events_path)


def create_task_graph_for_request(
    request: TaskRequest, store_path: Path, events_path: Path,
    targets_dir: Optional[Path] = None,
) -> str:
    """Plan, persist snapshots, emit created/assigned events. Returns root id."""
    tasks = plan(request, targets_dir)
    root = tasks[0]
    for t in tasks:
        _store.append_task_snapshot(t, store_path)
        common = dict(source=request.source, requested_by=request.requested_by,
                      task_id=t.task_id, parent_task_id=t.parent_task_id,
                      workflow=t.workflow, target_slug=t.target_slug,
                      intended_stage=t.intended_stage, gate=t.gate, status=t.status)
        _emit(events_path, event_type="task_created", message=t.goal, **common)
        _emit(events_path, event_type="task_assigned",
              message=t.assigned_agent, **common)
    return root.task_id


# --- advancing ---------------------------------------------------------------
def _generated_dir(store_path: Path) -> Path:
    return Path(store_path).parent / "generated_prompts"


def _save_artifact(store_path: Path, task: Task, text: str) -> str:
    gdir = _generated_dir(store_path)
    gdir.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9_]+", "_", (task.intended_stage or "stage")).strip("_")
    p = gdir / f"{task.task_id}__{safe}.md"
    p.write_text(text, encoding="utf-8")
    return str(p)


def _summary_line(text: str) -> str:
    for line in text.splitlines():
        line = line.strip().lstrip("# ").strip()
        if line:
            return line[:160]
    return ""


def _run_agent(task: Task, target, store_path: Path) -> None:
    """Produce the prompt/proposal TEXT and attach it as an artifact. No exec."""
    spec = AGENTS[task.assigned_agent]
    text = spec.build_report(task, target)
    path = _save_artifact(store_path, task, text)
    task.artifact_paths = [path]
    task.result_summary = _summary_line(text)


def _process_leaf(task: Task, by_id: dict[str, Task], targets_dir, store_path,
                  events_path) -> bool:
    """Evaluate one ready leaf. Returns True if its status changed."""
    # clarification / blocked-by-design: surface ONCE, then no-op (idempotent).
    # Handled before deps/gate so repeated advance() emits nothing further.
    if task.intended_stage == CLARIFICATION:
        if task.status != "blocked":
            task.status = "blocked"
            task.touch()
            _persist_and_event(task, store_path, events_path, "clarification_requested",
                               (task.inputs or {}).get("reason", "clarification required"))
            return True
        return False  # already surfaced — no new snapshot, no new event

    deps_done = all(by_id[d].status == "done" for d in task.dependencies if d in by_id)
    if not deps_done:
        if task.status != "blocked":
            task.status = "blocked"
            task.touch()
            _persist_and_event(task, store_path, events_path, "task_blocked",
                               "waiting on dependencies")
            return True
        return False

    target = _sr.get_target(task.target_slug, targets_dir) if task.target_slug else None
    cur_state = (task.inputs or {}).get("current_state") or (
        target.state if target else None)
    _emit(events_path, event_type="gate_checked", task_id=task.task_id,
          parent_task_id=task.parent_task_id, workflow=task.workflow,
          target_slug=task.target_slug, current_state=cur_state,
          intended_stage=task.intended_stage, gate=task.gate, status=task.status)

    # red gate: produce the (inert) proposal, then HALT for approval
    if task.gate == "red":
        if task.approval_ref:
            return False  # approved already; awaiting manual execution, never auto-run
        _run_agent(task, target, store_path)
        task.status = "needs_approval"
        task.approval_required = True
        task.touch()
        _persist_and_event(task, store_path, events_path, "report_produced",
                           task.result_summary or "")
        _emit(events_path, event_type="approval_requested", task_id=task.task_id,
              parent_task_id=task.parent_task_id, workflow=task.workflow,
              target_slug=task.target_slug, current_state=cur_state,
              intended_stage=task.intended_stage, gate=task.gate,
              status=task.status, message="🔴 gate — operator approval required")
        return True

    # green operator-pick: produce proposal, then wait for operator approval
    if task.approval_required:
        if task.approval_ref:
            return False
        _run_agent(task, target, store_path)
        task.status = "needs_approval"
        task.touch()
        _persist_and_event(task, store_path, events_path, "approval_requested",
                           task.result_summary or "operator decision required")
        return True

    # green, no approval: produce the prompt; the task's deliverable is the prompt
    _run_agent(task, target, store_path)
    task.status = "done"
    task.touch()
    _persist_and_event(task, store_path, events_path, "report_produced",
                       task.result_summary or "")
    _emit(events_path, event_type="task_done", task_id=task.task_id,
          parent_task_id=task.parent_task_id, workflow=task.workflow,
          target_slug=task.target_slug, intended_stage=task.intended_stage,
          gate=task.gate, status="done", message=task.result_summary or "")
    return True


def _persist_and_event(task: Task, store_path, events_path, event_type, message) -> None:
    _store.append_task_snapshot(task, store_path)
    _emit(events_path, event_type=event_type, task_id=task.task_id,
          parent_task_id=task.parent_task_id, workflow=task.workflow,
          target_slug=task.target_slug, intended_stage=task.intended_stage,
          gate=task.gate, status=task.status, message=message)


def advance(parent_task_id: str, store_path: Path, events_path: Path,
            targets_dir: Optional[Path] = None) -> dict[str, Any]:
    """Run ready green tasks; halt red/approval tasks as needs_approval."""
    tasks = _store.load_tasks(store_path)
    by_id = {t.task_id: t for t in tasks}
    root = by_id.get(parent_task_id)
    if root is None:
        raise ValueError(f"no task with id {parent_task_id!r}")
    children = [t for t in tasks if t.parent_task_id == parent_task_id]
    leaves = children if children else [root]

    changed = True
    while changed:
        changed = False
        for t in leaves:
            if t.is_terminal() or t.status == "needs_approval":
                continue
            if _process_leaf(t, by_id, targets_dir, store_path, events_path):
                changed = True

    # roll up a container parent (it runs no agent of its own)
    if children:
        root.status = "done" if all(c.is_terminal() for c in children) else "running"
        root.touch()
        _store.append_task_snapshot(root, store_path)

    return task_status(parent_task_id, store_path)


# --- read-only views ---------------------------------------------------------
def task_status(parent_task_id: str, store_path: Path) -> dict[str, Any]:
    tasks = _store.load_tasks(store_path)
    by_id = {t.task_id: t for t in tasks}
    root = by_id.get(parent_task_id)
    if root is None:
        raise ValueError(f"no task with id {parent_task_id!r}")
    children = [t for t in tasks if t.parent_task_id == parent_task_id]
    scope = children if children else [root]
    counts: dict[str, int] = {}
    for t in scope:
        counts[t.status] = counts.get(t.status, 0) + 1
    return {
        "parent_task_id": parent_task_id,
        "root_status": root.status,
        "counts": counts,
        "needs_approval": [
            {"task_id": t.task_id, "agent": t.assigned_agent,
             "intended_stage": t.intended_stage, "gate": t.gate}
            for t in scope if t.status == "needs_approval"
        ],
        "blocked": [t.task_id for t in scope if t.status == "blocked"],
        "done": [t.task_id for t in scope if t.status == "done"],
        "artifacts": [p for t in scope for p in t.artifact_paths],
    }


# --- approval + completion (no external execution in M1) ---------------------
def record_task_approval(
    task_id: str, *, operator_discord_id: str, store_path: Path, events_path: Path,
    operator_display_name: Optional[str] = None, notes: str = "",
    approvals_path: Optional[Path] = None, targets_dir: Optional[Path] = None,
) -> dict[str, Any]:
    """Record operator approval intent for a needs_approval task.

    Writes approvals.log.jsonl (existing append-only path), links approval_ref,
    flips the task to `queued` (approved, awaiting MANUAL execution). It does
    NOT execute the red action — M1 never sends/collects/renders.
    """
    task = _store.get_task(task_id, store_path)
    if task is None:
        raise ValueError(f"no task with id {task_id!r}")
    if task.status != "needs_approval":
        return {"ok": False, "message": f"task {task_id} is {task.status}, not needs_approval"}

    target = _sr.get_target(task.target_slug, targets_dir) if task.target_slug else None
    prompt = AGENTS[task.assigned_agent].build_report(task, target)
    cmd = _stage_command(task.intended_stage) or "stage"
    cur_state = (task.inputs or {}).get("current_state") or (
        target.state if target else _pb.COMMAND_FROM_STATE.get(cmd, "(unknown)"))
    rec = _alog.make_record(
        target_slug=task.target_slug or "(none)", current_state=str(cur_state),
        approved_stage=cmd, prompt=prompt, operator_discord_id=operator_discord_id,
        operator_display_name=operator_display_name, execution_mode="prompt_only",
        notes=notes, source="orchestrator")
    _alog.append_record(rec, approvals_path)

    task.approval_ref = f"{rec['timestamp_utc']}|{rec['prompt_hash']}"
    task.status = "queued"
    task.touch()
    _persist_and_event(task, store_path, events_path, "approval_recorded",
                       f"approved by {operator_discord_id} (intent only)")
    _emit(events_path, event_type="awaiting_manual_execution", task_id=task.task_id,
          parent_task_id=task.parent_task_id, workflow=task.workflow,
          target_slug=task.target_slug, intended_stage=task.intended_stage,
          gate=task.gate, status=task.status,
          message="approved; run in an authorized Claude Code turn — not auto-executed")
    return {"ok": True, "task_id": task_id, "approval_ref": task.approval_ref}


def mark_task_done(task_id: str, *, store_path: Path, events_path: Path,
                   result_summary: str = "") -> Task:
    """Mark a task done. Any red OR approval_required task REQUIRES an
    approval_ref first (invariant)."""
    task = _store.get_task(task_id, store_path)
    if task is None:
        raise ValueError(f"no task with id {task_id!r}")
    if (task.gate == "red" or task.approval_required) and not task.approval_ref:
        raise ValueError(
            "a gated/approval-required task cannot be done without approval_ref")
    task.status = "done"
    if result_summary:
        task.result_summary = result_summary
    task.touch()
    _persist_and_event(task, store_path, events_path, "task_done",
                       result_summary or "marked done")
    return task


def cancel_task(task_id: str, *, store_path: Path, events_path: Path,
                reason: str = "") -> Task:
    """Mark a task cancelled. Records-only — never touches packet files."""
    task = _store.get_task(task_id, store_path)
    if task is None:
        raise ValueError(f"no task with id {task_id!r}")
    task.status = "cancelled"
    if reason:
        task.result_summary = reason
    task.touch()
    _persist_and_event(task, store_path, events_path, "task_cancelled",
                       reason or "cancelled by operator")
    return task
