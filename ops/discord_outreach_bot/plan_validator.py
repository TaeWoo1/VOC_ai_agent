"""M6-A: strict validator for a Claude-proposed plan.

Principle: **Claude proposes. Python validates. Python decides.** This module is
the gate. It NEVER trusts Claude's self-declared `safety_level` / `requires_approval`
/ `allowed_action` — it re-derives safety in Python from a fixed table and forces
the read-only envelope. A plan that asks for anything outside M6-A's read-only set
becomes a refusal; a malformed/ungrounded plan becomes a clarification.

This module is PURE: it imports only the read-only agent registry constant and the
task data model. It does NOT import task_runner / task_inputs / subprocess /
network clients, performs no I/O, and writes nothing. Callers pass the already
loaded tasks (or their ids) so the validator stays side-effect-free.

M6-A accepted intents (read-only / proposal-only):
    answer_status, summarize_candidates, list_active_graphs, propose_next_action,
    create_subagent_prompt, clarify, refuse
M6-A rejected intents (would execute or escalate — become a refusal):
    cancel_task_graph, select_active_graph, approve_task, run_dry_run, run_scaffold,
    rollback, run_collection, render_pdf, send_email, publish_instagram,
    invoke_claude_code
"""

from __future__ import annotations

from typing import Any, Iterable, Optional

from agent_registry import AGENTS as _AGENTS

# --- vocabularies ------------------------------------------------------------
ACCEPTED_INTENTS = frozenset({
    "answer_status", "summarize_candidates", "list_active_graphs",
    "propose_next_action", "create_subagent_prompt", "clarify", "refuse",
})
REJECTED_INTENTS = frozenset({
    "cancel_task_graph", "select_active_graph", "approve_task", "run_dry_run",
    "run_scaffold", "rollback", "run_collection", "render_pdf", "send_email",
    "publish_instagram", "invoke_claude_code",
})

REQUIRED_KEYS = frozenset({
    "intent", "target", "agent", "safety_level", "requires_approval",
    "allowed_action", "reply", "proposed_next_steps", "runner_action", "confidence",
})
_TARGET_KEYS = frozenset({"root_task_id", "task_id", "slug"})

ALLOWED_SAFETY = frozenset({"read_only", "external_blocked"})

# outcomes
VALID = "valid"
REFUSED = "refused"
CLARIFY = "clarify"

# Phrases in a reply that would claim execution already happened. A read-only
# proposal must never assert completion; if it does, we refuse the plan.
_EXECUTION_CLAIM_MARKERS = (
    "보냈", "발송했", "발송 완료", "전송했", "수집했", "수집 완료", "크롤링했",
    "삭제했", "취소했", "취소 완료", "승인했", "승인 완료", "실행했", "실행 완료",
    "롤백했", "되돌렸", "생성 완료했", "렌더링했", "렌더했", "게시했", "업로드했",
    "올렸습니다", "completed", "executed", "has been sent", "have sent", "sent the",
    "deleted", "cancelled the", "canceled the", "approved and", "rolled back",
    "rendered the", "published", "uploaded",
)


def _known_agent_names(known_agents: Optional[Iterable[str]]) -> set[str]:
    return set(known_agents) if known_agents is not None else set(_AGENTS.keys())


def _result(outcome: str, intent: str, *, safety_level: str, reason: Optional[str],
            plan: Optional[dict[str, Any]]) -> dict[str, Any]:
    return {
        "ok": outcome == VALID,
        "outcome": outcome,
        "intent": intent,
        "safety_level": safety_level,
        "reason": reason,
        "plan": plan,
    }


def _refuse(intent: str, reason: str) -> dict[str, Any]:
    return _result(REFUSED, "refuse", safety_level="external_blocked",
                   reason=reason, plan=None)


def _clarify(reason: str) -> dict[str, Any]:
    return _result(CLARIFY, "clarify", safety_level="read_only",
                   reason=reason, plan=None)


def _reply_claims_execution(reply: str) -> bool:
    low = (reply or "").lower()
    raw = reply or ""
    for marker in _EXECUTION_CLAIM_MARKERS:
        if marker.isascii():
            if marker.lower() in low:
                return True
        elif marker in raw:
            return True
    return False


def validate(plan: Any, *, tasks: Optional[list] = None,
             known_task_ids: Optional[Iterable[str]] = None,
             known_agents: Optional[Iterable[str]] = None) -> dict[str, Any]:
    """Validate an untrusted Claude plan against the M6-A read-only envelope.

    Returns a result dict: {ok, outcome(valid|refused|clarify), intent,
    safety_level, reason, plan}. `plan` is a sanitized copy only when ok=True.
    Pass either `tasks` (list of Task) or `known_task_ids` to ground target ids.
    """
    # 0. shape -----------------------------------------------------------------
    if not isinstance(plan, dict):
        return _clarify("plan_not_object")

    keys = set(plan.keys())
    extra = keys - REQUIRED_KEYS
    if extra:
        return _clarify(f"extra_keys:{','.join(sorted(extra))}")
    missing = REQUIRED_KEYS - keys
    if missing:
        return _clarify(f"missing_keys:{','.join(sorted(missing))}")

    intent = plan.get("intent")
    if not isinstance(intent, str) or (
            intent not in ACCEPTED_INTENTS and intent not in REJECTED_INTENTS):
        return _clarify("unknown_intent")

    # 1. hard refusals: explicit escalation/execution intents or actions -------
    if intent in REJECTED_INTENTS:
        return _refuse(intent, f"rejected_intent:{intent}")
    if plan.get("runner_action") is not None:
        return _refuse(intent, "runner_action_not_allowed")
    if plan.get("allowed_action") is not None:
        return _refuse(intent, "allowed_action_not_allowed_in_m6a")
    if plan.get("requires_approval") is True:
        return _refuse(intent, "requires_approval_implies_action")

    # 2. safety_level must be a sane value (we still recompute below) ----------
    if plan.get("safety_level") not in ALLOWED_SAFETY:
        return _clarify("bad_safety_level")

    # 3. target shape + grounding ---------------------------------------------
    target = plan.get("target")
    if not isinstance(target, dict):
        return _clarify("target_not_object")
    if set(target.keys()) - _TARGET_KEYS:
        return _clarify("target_extra_keys")

    ids = set(known_task_ids) if known_task_ids is not None else {
        t.task_id for t in (tasks or [])}
    for key in ("root_task_id", "task_id"):
        tid = target.get(key)
        if tid is not None:
            if not isinstance(tid, str) or tid not in ids:
                return _clarify(f"unknown_task_id:{key}")  # hallucinated/ungrounded

    # 4. agent grounding -------------------------------------------------------
    agent = plan.get("agent")
    if agent is not None:
        if not isinstance(agent, str) or agent not in _known_agent_names(known_agents):
            return _clarify("unknown_agent")
    if intent == "create_subagent_prompt" and not agent:
        return _clarify("create_subagent_prompt_requires_agent")

    # 5. proposed_next_steps must be a list of strings -------------------------
    steps = plan.get("proposed_next_steps")
    if not isinstance(steps, list) or not all(isinstance(s, str) for s in steps):
        return _clarify("bad_proposed_next_steps")

    # 6. reply must not claim an action already happened -----------------------
    reply = plan.get("reply")
    if not isinstance(reply, str) or not reply.strip():
        return _clarify("empty_reply")
    if _reply_claims_execution(reply):
        return _refuse(intent, "reply_claims_execution")

    # 7. accept — re-derive the read-only envelope in Python (ignore Claude) ---
    sanitized = {
        "intent": intent,
        "target": {k: target.get(k) for k in _TARGET_KEYS},
        "agent": agent,
        "safety_level": "read_only",      # recomputed; never trust the model's value
        "requires_approval": False,        # forced
        "allowed_action": None,            # forced
        "runner_action": None,             # forced
        "reply": reply.strip(),
        "proposed_next_steps": [s.strip() for s in steps if s.strip()],
        "confidence": _coerce_confidence(plan.get("confidence")),
    }
    return _result(VALID, intent, safety_level="read_only", reason=None,
                   plan=sanitized)


def _coerce_confidence(value: Any) -> float:
    try:
        c = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(1.0, c))
