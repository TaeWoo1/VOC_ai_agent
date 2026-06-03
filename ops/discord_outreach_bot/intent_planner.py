"""D4-1: natural-language -> structured intent planner (report-only) (SELF).

Mirrors the M6-A `claude_orchestrator` pattern: the model PROPOSES a strict-JSON
intent; Python (`agent_intents.validate`) DISPOSES. Differences for D4-1:

  - REPORT-ONLY. `report_only()` never executes, never mutates, never sends.
  - INERT in production: there is NO live backend wired in D4-1. With no injected
    `responder`, `report_only()` returns None so the caller falls back to the
    deterministic shortcut layer (agent_discord_adapter). Tests drive it by
    injecting a `responder` that returns canned JSON — no real Claude / API.
  - Needs no ANTHROPIC_API_KEY (no live call path in D4-1).

The strict-JSON contract the planner must emit:
  {"intent": "<one of agent_intents.INTENTS>",
   "targets": {"task_id": "...", "run_id": "...", "stage": "...", "target": "..."},
   "rationale": "<왜 그렇게 해석했는지>",
   "confidence": 0.0-1.0}
A model-supplied "category" is ignored by the validator.
"""

from __future__ import annotations

import json
import os
from typing import Any, Callable, Optional

import agent_intents as _intents

_ENV_FLAG = "AGENT_INTENT_PLANNER_ENABLED"

INTENT_SYSTEM_PROMPT = (
    "You are a read-only intent parser for a Korean-first outreach ops bot. "
    "Map the operator's message to EXACTLY ONE intent from this set: "
    + ", ".join(_intents.INTENTS) + ". "
    "Respond with STRICT JSON only: {\"intent\": <one of the set>, \"targets\": "
    "{\"task_id\": str?, \"run_id\": str?, \"stage\": str?, \"target\": str?}, "
    "\"rationale\": str, \"confidence\": number}. Do NOT include a category, do "
    "NOT decide permissions, do NOT propose execution. If unsure, use \"clarify\"."
)

STATUS_OK = "ok"
STATUS_DISABLED = "disabled"
STATUS_UNPARSABLE = "unparsable"


def is_enabled() -> bool:
    return os.environ.get(_ENV_FLAG, "").strip().lower() in ("1", "true", "yes", "on")


def _resolve_responder(
    responder: Optional[Callable[[list[dict[str, str]]], str]],
) -> Optional[Callable[[list[dict[str, str]]], str]]:
    """Pick the planner backend (D4-2b).

    - An injected `responder` (tests) always wins.
    - Else, ONLY if AGENT_INTENT_PLANNER_ENABLED is set AND the local `claude`
      binary is present, use the live local-Claude backend.
    - Otherwise None -> plan_and_act returns None -> deterministic fallback.
    Default (flag unset) stays inert: no live Claude, no behavior change.
    """
    if responder is not None:
        return responder
    if not is_enabled():
        return None
    import intent_planner_backend as _backend
    if not _backend.is_available():
        return None
    return _backend.local_claude_responder


def build_messages(text: str) -> list[dict[str, str]]:
    return [{"role": "user", "content": text}]


def parse_intent(raw: str) -> Optional[dict[str, Any]]:
    """Strict JSON parse of the planner output. None if unparsable."""
    try:
        obj = json.loads((raw or "").strip())
    except json.JSONDecodeError:
        return None
    return obj if isinstance(obj, dict) else None


def report_only(
    text: str, *,
    operator_discord_id: Optional[str] = None,
    responder: Optional[Callable[[list[dict[str, str]]], str]] = None,
) -> Optional[dict[str, Any]]:
    """Plan -> validate -> report-only card, or None to fall back.

    Returns None when: no responder is provided (D4-1 has no live backend), the
    planner is disabled, or the output is unparsable. Otherwise returns a
    report-only handler dict. NEVER executes anything.
    """
    # D4-1: only the injected-responder path is live. No responder -> inert.
    if responder is None:
        return None
    try:
        raw = responder(build_messages(text))
    except Exception:
        return None  # any backend error -> fall back to deterministic shortcut

    obj = parse_intent(raw)
    if obj is None:
        return None  # unparsable -> fall back

    v = _intents.validate(obj)
    return {
        "intent": f"intent_{v['outcome']}",
        "handled": True,
        "reply": _intents.format_report(v),
        "category": v["category"],
        "outcome": v["outcome"],
        "validated": v,
        "executed": False,
    }


def plan_and_act(
    text: str, *,
    operator_discord_id: Optional[str] = None,
    repo_root: Optional[Any] = None,
    agent_runs_path: Optional[Any] = None,
    agent_runs_dir: Optional[Any] = None,
    approval_log_path: Optional[Any] = None,
    generated_prompts_dir: Optional[Any] = None,
    known_task_ids: Optional[Any] = None,
    adapter: Any = None,
    responder: Optional[Callable[[list[dict[str, str]]], str]] = None,
) -> Optional[dict[str, Any]]:
    """D4-2: plan -> validate -> DISPATCH (execute allowlist) or report-only card.

    Same inert-by-default contract as report_only: with no responder (D4-2 has no
    live backend; that is D4-2b) this returns None so the deterministic shortcut
    + existing pipeline run unchanged. Tests inject a `responder`. Execution is
    delegated to intent_dispatcher, which only runs the D4-2 allowlist and never
    reaches bounded_edit / collect / render / send / publish.
    """
    responder = _resolve_responder(responder)
    if responder is None:
        return None
    try:
        raw = responder(build_messages(text))
    except Exception:
        return None
    obj = parse_intent(raw)
    if obj is None:
        return None

    import intent_dispatcher as _dispatch
    v = _intents.validate(obj)
    return _dispatch.dispatch_intent(
        v, operator_discord_id=operator_discord_id, repo_root=repo_root,
        agent_runs_path=agent_runs_path, agent_runs_dir=agent_runs_dir,
        approval_log_path=approval_log_path,
        generated_prompts_dir=generated_prompts_dir,
        known_task_ids=known_task_ids, adapter=adapter)
