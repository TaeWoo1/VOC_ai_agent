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

import os
from pathlib import Path
from typing import Any, Callable, Optional

import agent_discord_adapter as _agent_discord
import copilot_backend as _copilot_backend
import operator_copilot as _copilot
import status_discord_adapter as _status_discord
import agent_report_formatting as _arf
import claude_orchestrator as _planner
import intent_planner as _intent
import conversational_orchestrator as _conv
import nl_router as _router
import orchestrator as _orch
import plan_validator as _pv
import task_formatting as _fmt
import task_inputs as _ti
import task_store as _store
from task_model import TaskRequest

# plan-kind → request workflow (the planners then set each task's own workflow)
_KIND_WORKFLOW = {"cardnews": "instagram", "unknown": "ops"}

# D6-1b: operator-copilot responder seam. Stays None in production; tests
# monkeypatch this with a fake and it always OUTRANKS the env-selected backend
# below. The copilot module itself remains advisory-only / read-only
# regardless of what is injected here.
_COPILOT_RESPONDER = None

# D6-2b: env-selected backend. Production becomes live ONLY when BOTH gates
# hold at message time: AGENT_OPERATOR_COPILOT_ENABLED (checked inside
# operator_copilot.try_handle_copilot_message) AND
# AGENT_OPERATOR_COPILOT_BACKEND=claude with the local `claude` binary present.
_COPILOT_BACKEND_ENV = "AGENT_OPERATOR_COPILOT_BACKEND"


def _resolve_copilot_responder() -> Optional[Callable[[str], str]]:
    """Pick the copilot responder for this message, or None (hook inert).

    Precedence:
      1. test-injected `_COPILOT_RESPONDER` seam (never overridden by env),
      2. hardened local backend (copilot_backend.respond) when the env selects
         `claude` AND the binary is available — the backend itself runs in plan
         mode with ALL tools disabled and returns "" on any failure,
      3. None -> the 0d hook is skipped and every existing flow runs unchanged.
    """
    if _COPILOT_RESPONDER is not None:
        return _COPILOT_RESPONDER
    if (os.environ.get(_COPILOT_BACKEND_ENV, "").strip().lower() == "claude"
            and _copilot_backend.is_available()):
        return _copilot_backend.respond
    return None


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


def _planner_eligible(text: str) -> bool:
    """Whether a message may fall through to the M6-A Claude semantic planner.

    Eligibility is INTENTIONALLY narrow so deterministic M4/M5 routes are never
    bypassed. A message is eligible ONLY when:
      - the planner is active (env-enabled + ANTHROPIC_API_KEY present), AND
      - it is not a bare confirmation ("응"/"닫아") — those belong to the M5-A.5
        cancel handshake, AND
      - it is not a cancel verb / new-task command (M5-A.5 / graph creation), AND
      - it is not an operational M4 intent (set_candidate/approve/dry-run/
        rollback/scaffold/dangerous) — i.e. classify_action falls through.
    The leftover is the genuinely conversational/ambiguous bucket. The planner is
    OFF by default, so this returns False and behavior is exactly M5-A.5."""
    if not _planner.is_active():
        return False
    if _conv.is_confirmation(text):
        return False
    if _conv.classify_conversation(text) in (
            _conv.CANCEL_REQUEST, _conv.CANCEL_CAPABILITY, _conv.NEW_TASK):
        return False
    intent, _ = _router.classify_action(text)
    return intent == _router.CREATE_GRAPH


def _m6a_dispatch(text: str, *, store_path: Path, events_path: Path,
                  runs_path: Optional[Path], reviews_path: Optional[Path],
                  generated_prompts_dir: Optional[Path]) -> Optional[dict[str, Any]]:
    """Run the M6-A propose→validate→format pipeline. Returns an adapter reply
    dict, or None to signal 'fall back to the deterministic read-only answer'
    (planner unavailable / API error). Writes nothing; creates no graph."""
    res = _planner.plan(text, store_path=store_path, events_path=events_path,
                        runs_path=runs_path, reviews_path=reviews_path,
                        generated_prompts_dir=generated_prompts_dir)
    if not res.get("available"):
        return None  # disabled / unconfigured / network error -> deterministic fallback
    tasks = _store.load_tasks(store_path)
    vres = _pv.validate(res.get("plan"), tasks=tasks)
    return {"intent": vres["intent"], "handled": True,
            "reply": _arf.format_result(vres), "m6a": True}


def handle_nl_message(text: str, *, operator_discord_id: str, store_path: Path,
                      events_path: Path, approvals_path: Optional[Path] = None,
                      runs_path: Optional[Path] = None,
                      reviews_path: Optional[Path] = None,
                      generated_prompts_dir: Optional[Path] = None,
                      targets_dir: Optional[Path] = None,
                      operator_display_name: Optional[str] = None) -> dict[str, Any]:
    """M4-A/M4-B/M5-A/M5-A.5 + M6-A message dispatch.

    Order is load-bearing:
      1. M5-A question gate: a question-like message ("왜 승인?", "다음 후보군이
         뭐지?", "지금 어디까지 됐어?") is answered READ-ONLY from existing state.
         It must NEVER be treated as an operational command (so "왜 승인?" cannot
         trip the approve router) or as a new-task request — no writes, no graph.
      2. operational NL router (UNCHANGED): set_candidate / approve_one / dry-run /
         run+review / rollback / dangerous refusal / clarification.
      3. on fall-through, classify the (non-question) message: a genuine new-task
         command creates the graph (UNCHANGED); anything else is read-only/cancel.
      4. M6-A Claude semantic planner: for the ambiguous/conversational leftover,
         and ONLY when the planner is active and the message is eligible, Claude
         PROPOSES a read-only plan that Python validates before any reply. It never
         executes, creates a graph, approves, cancels, or runs the runner.
      5. deterministic read-only fallback when the planner is disabled/unavailable
         (also the default): the existing M5-A/M5-A.5 conversational answer."""
    # 0a. D4-2 intent planner -> dispatcher (above the deterministic shortcut).
    #     Inert in production (no live backend until D4-2b -> returns None), so
    #     behavior is unchanged by default. When a backend is wired, it parses NL
    #     into a validated intent and routes ONLY the D4-2 allowlist (read-only +
    #     propose/confirm-dry_run/cancel/cleanup) to the existing dispatch
    #     functions; collect/render/send/publish stay report-only, and
    #     bounded_edit is never reachable here. Ambiguous/unavailable -> None ->
    #     falls through to the deterministic shortcut below.
    planned = _intent.plan_and_act(
        text, operator_discord_id=operator_discord_id,
        approval_log_path=approvals_path, generated_prompts_dir=generated_prompts_dir)
    if planned is not None:
        return planned

    # 0b. M6-D4 agent-lifecycle phrases (에이전트 제안 / 진행해 / 편집 진행해 / 취소 /
    #    cleanup / 에이전트 상태). Deterministic + pending-state-gated: it claims
    #    "진행해"/"취소" ONLY when an agent run/edit is pending, otherwise returns
    #    None so the existing M5-A.5 / M4 flows below run unchanged.
    agent_out = _agent_discord.try_handle(
        text, operator_discord_id=operator_discord_id, store_path=store_path,
        approval_log_path=approvals_path, generated_prompts_dir=generated_prompts_dir)
    if agent_out is not None:
        return agent_out

    # 0c. D5-2 read-only operator status. Anchored full-message phrases only
    #    (상태 / 상태 알려줘 / 오늘 작업 보여줘 / operator status / status, plus an
    #    optional smoke modifier). Returns a card string to display, or None so
    #    every flow below runs unchanged. It only reads the existing D5-1 indexer:
    #    no writes, no mutation, no collect/render/send/publish, and it never
    #    claims 진행해/취소/final-approval phrases (those are owned at 0a/0b above).
    status_reply = _status_discord.try_handle_status_message(text)
    if status_reply is not None:
        return {"intent": "operator_status", "handled": True, "reply": status_reply}

    # 0d. D6-1b advisory operator copilot (flag-gated, default OFF; responder
    #    seam empty until D6-2 -> inert in production). For the SAFE
    #    conversational bucket only: the copilot module declines confirmations,
    #    bare cancel verbs, final-approval phrases, operational intents,
    #    NEW_TASK, and explicit-task-id cancels, so 진행해 / 취소 handshakes /
    #    최종 발송·게시 승인 / 라이브 수집 승인 / graph creation are NEVER
    #    claimed here. Advisory-only and read-only: it executes nothing and
    #    writes nothing; on decline/failure it returns None so every flow below
    #    runs unchanged (also the default when the flag is off).
    responder = _resolve_copilot_responder()
    if responder is not None:
        copilot_out = _copilot.try_handle_copilot_message(
            text, responder=responder, store_path=store_path,
            events_path=events_path)
        if copilot_out is not None:
            return copilot_out

    # 1. question-like: M6-A planner (if eligible) else read-only answer. Zero writes.
    if _conv.is_question_like(text):
        if _planner_eligible(text):
            out = _m6a_dispatch(text, store_path=store_path, events_path=events_path,
                                runs_path=runs_path, reviews_path=reviews_path,
                                generated_prompts_dir=generated_prompts_dir)
            if out is not None:
                return out
        ans = _conv.answer(text, store_path=store_path, events_path=events_path,
                           targets_dir=targets_dir, operator_id=operator_discord_id)
        return {"intent": ans["intent"], "handled": True, "reply": ans["reply"]}

    # 2. operational router (M4-A/M4-B) — behavior unchanged.
    routed = _router.route(
        text, operator_discord_id=operator_discord_id,
        operator_display_name=operator_display_name, store_path=store_path,
        events_path=events_path, approvals_path=approvals_path,
        runs_path=runs_path, reviews_path=reviews_path, targets_dir=targets_dir)
    if routed.get("handled"):
        return {"intent": routed["intent"], "handled": True, "reply": routed["reply"]}

    # 3. non-question fall-through: new-task command vs read-only/cancel handling.
    category = _conv.classify_conversation(text)
    if category != _conv.NEW_TASK:
        # 4. ambiguous/conversational leftover -> M6-A planner if eligible.
        if _planner_eligible(text):
            out = _m6a_dispatch(text, store_path=store_path, events_path=events_path,
                                runs_path=runs_path, reviews_path=reviews_path,
                                generated_prompts_dir=generated_prompts_dir)
            if out is not None:
                return out
        # 5. deterministic read-only / cancel answer (default path).
        ans = _conv.answer(text, store_path=store_path, events_path=events_path,
                           targets_dir=targets_dir, operator_id=operator_discord_id)
        return {"intent": ans["intent"], "handled": True, "reply": ans["reply"]}

    # genuine new-task request -> UNCHANGED graph-creation path (handled=False).
    req = request_from_nl(text, requested_by=operator_discord_id, targets_dir=targets_dir)
    pid, reply = _create_and_advance(req, store_path, events_path, targets_dir)
    return {"parent_task_id": pid, "plan_kind": req.slots["plan_kind"], "reply": reply,
            "intent": _router.CREATE_GRAPH, "handled": False}


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
