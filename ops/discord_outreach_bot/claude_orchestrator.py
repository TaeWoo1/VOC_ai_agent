"""M6-A: Claude-backed SEMANTIC PLANNER for Discord operator messages.

Principle: **Claude proposes. Python validates. Python decides. Claude never
directly executes.** This module is the "proposes" half — it builds a compact,
READ-ONLY context bundle from current orchestration state, asks Claude to return
a strict JSON plan, parses it, and returns the (still UNTRUSTED) plan object. It
runs nothing. `plan_validator.py` is the "disposes" half: it re-derives safety in
Python and rejects anything outside the M6-A read-only envelope.

Hard guarantees (enforced structurally + by tests):
  - Read-only. Reads via task_store.load_tasks, orchestrator.task_status,
    orchestration_events.read_events, task_runs.read_runs, codex_reviews.read_reviews,
    agent_registry.AGENTS, and the FILENAMES under generated_prompts/. It writes
    nothing, creates no task graph, approves nothing, cancels nothing, and drives
    no runner.
  - It does NOT import task_runner / task_inputs, never runs collection / send /
    PDF / publish / Claude Code, opens no browser/CDP, and shells out to nothing.
  - The anthropic SDK is imported LAZILY inside the network call, so importing
    this module never requires the package, and unit tests inject a fake
    responder and never touch the real API.

Gating (env, to avoid config-loading scope creep):
  - CLAUDE_ORCHESTRATOR_ENABLED ∈ {1,true,yes,on}   (default OFF)
  - ANTHROPIC_API_KEY present                        (else "unconfigured")
  - CLAUDE_ORCHESTRATOR_MODEL                         (optional model override)
  - CLAUDE_ORCHESTRATOR_MAX_CONTEXT_CHARS             (optional, default 6000)
  - CLAUDE_ORCHESTRATOR_TIMEOUT_SECONDS               (optional, default 20)
Secrets are never logged or placed in the context bundle / reply.
"""

from __future__ import annotations

import glob
import json
import os
import re
from pathlib import Path
from typing import Any, Callable, Optional

import codex_reviews as _reviews
import orchestration_events as _events
import task_runs as _runs
import task_store as _store
from agent_registry import AGENTS as _AGENTS
from orchestrator import task_status as _task_status  # read-only summary

# --- env gating --------------------------------------------------------------
_ENABLE_ENV = "CLAUDE_ORCHESTRATOR_ENABLED"
_MODEL_ENV = "CLAUDE_ORCHESTRATOR_MODEL"
_MAX_CHARS_ENV = "CLAUDE_ORCHESTRATOR_MAX_CONTEXT_CHARS"
_TIMEOUT_ENV = "CLAUDE_ORCHESTRATOR_TIMEOUT_SECONDS"
_API_KEY_ENV = "ANTHROPIC_API_KEY"

_DEFAULT_MODEL = "claude-opus-4-8"
_DEFAULT_MAX_CONTEXT_CHARS = 6000
_DEFAULT_TIMEOUT_SECONDS = 20
_TRUTHY = {"1", "true", "yes", "on"}

# bundle size caps (read-only; keep the prompt small)
_MAX_TASKS = 40
_MAX_EVENTS = 10
_MAX_RUNS = 5
_MAX_REVIEWS = 5
_MAX_PROMPT_FILES = 20

# planner result status values
STATUS_OK = "ok"
STATUS_DISABLED = "disabled"
STATUS_UNCONFIGURED = "unconfigured"
STATUS_ERROR = "error"
STATUS_UNPARSABLE = "unparsable"

UNAVAILABLE_REPLY = "Claude planner is not enabled/configured."


def is_enabled() -> bool:
    return (os.environ.get(_ENABLE_ENV, "") or "").strip().lower() in _TRUTHY


def is_configured() -> bool:
    return bool((os.environ.get(_API_KEY_ENV, "") or "").strip())


def is_active() -> bool:
    """Planner runs only when explicitly enabled AND an API key is present."""
    return is_enabled() and is_configured()


def _model() -> str:
    return (os.environ.get(_MODEL_ENV, "") or "").strip() or _DEFAULT_MODEL


def _max_context_chars() -> int:
    raw = (os.environ.get(_MAX_CHARS_ENV, "") or "").strip()
    try:
        return max(500, int(raw)) if raw else _DEFAULT_MAX_CONTEXT_CHARS
    except ValueError:
        return _DEFAULT_MAX_CONTEXT_CHARS


def _timeout_seconds() -> float:
    raw = (os.environ.get(_TIMEOUT_ENV, "") or "").strip()
    try:
        return max(1.0, float(raw)) if raw else float(_DEFAULT_TIMEOUT_SECONDS)
    except ValueError:
        return float(_DEFAULT_TIMEOUT_SECONDS)


# --- read-only context bundle -------------------------------------------------
def _generated_dir(store_path: Path, generated_prompts_dir: Optional[Path]) -> Path:
    if generated_prompts_dir:
        return Path(generated_prompts_dir)
    return Path(store_path).parent / "generated_prompts"


def _active_roots(tasks: list) -> list:
    roots = [t for t in tasks if not t.parent_task_id]
    out = []
    for r in roots:
        kids = [t for t in tasks if t.parent_task_id == r.task_id]
        if (not r.is_terminal()) or any(not c.is_terminal() for c in kids):
            out.append(r)
    return out


def build_context(text: str, *, store_path: Path,
                  events_path: Optional[Path] = None,
                  runs_path: Optional[Path] = None,
                  reviews_path: Optional[Path] = None,
                  generated_prompts_dir: Optional[Path] = None,
                  max_chars: Optional[int] = None) -> dict[str, Any]:
    """Build a compact, read-only snapshot of orchestration state for the planner.

    No secrets, no raw packet PDFs, no full file reads — only filenames for the
    generated_prompts/ index and clipped strings everywhere. Size-capped.
    """
    tasks = _store.load_tasks(store_path)
    by_id = {t.task_id: t for t in tasks}

    roots = _active_roots(tasks)
    active_roots = []
    for r in roots:
        try:
            summary = _task_status(r.task_id, store_path)
            counts = summary.get("counts", {})
        except ValueError:
            counts = {}
        active_roots.append({
            "task_id": r.task_id,
            "status": r.status,
            "goal": (r.goal or "")[:60],
            "counts": counts,
        })

    task_rows = [{
        "task_id": t.task_id,
        "parent_task_id": t.parent_task_id,
        "agent": t.assigned_agent,
        "intended_stage": t.intended_stage,
        "status": t.status,
        "gate": t.gate,
        "goal": (t.goal or "")[:60],
    } for t in tasks[:_MAX_TASKS]]

    events = _events.read_events(events_path) if events_path else []
    recent_events = [{
        "event_type": e.get("event_type"),
        "task_id": e.get("task_id"),
        "message": (e.get("message") or "")[:80],
    } for e in events[-_MAX_EVENTS:]]

    runs = _runs.read_runs(runs_path) if runs_path else []
    recent_runs = [{
        "run_id": r.get("run_id"),
        "task_id": r.get("task_id"),
        "runner_action": r.get("runner_action"),
        "status": r.get("status"),
    } for r in runs[-_MAX_RUNS:]]

    reviews = _reviews.read_reviews(reviews_path) if reviews_path else []
    recent_reviews = [{
        "review_id": rv.get("review_id"),
        "run_id": rv.get("run_id"),
        "status": rv.get("status"),
    } for rv in reviews[-_MAX_REVIEWS:]]

    gdir = _generated_dir(store_path, generated_prompts_dir)
    prompt_files = [Path(p).name
                    for p in sorted(glob.glob(str(gdir / "*.md")))[-_MAX_PROMPT_FILES:]]

    bundle = {
        "operator_message": text or "",
        "active_roots": active_roots,
        "tasks": task_rows,
        "task_id_count": len(by_id),
        "recent_events": recent_events,
        "recent_runs": recent_runs,
        "recent_reviews": recent_reviews,
        "generated_prompts": prompt_files,
        "agents": sorted(_AGENTS.keys()),
    }
    return _truncate_bundle(bundle, max_chars or _max_context_chars())


def _truncate_bundle(bundle: dict[str, Any], max_chars: int) -> dict[str, Any]:
    """Hard-cap the serialized bundle; drop the bulkiest lists first if oversize."""
    for dropper in (
        lambda b: b,
        lambda b: {**b, "tasks": b["tasks"][:10]},
        lambda b: {**b, "tasks": b["tasks"][:5], "recent_events": b["recent_events"][:3]},
        lambda b: {**b, "tasks": [], "recent_events": [], "recent_runs": [],
                   "recent_reviews": [], "generated_prompts": []},
    ):
        trimmed = dropper(bundle)
        if len(json.dumps(trimmed, ensure_ascii=False)) <= max_chars:
            return trimmed
    return trimmed


# --- prompt assembly ----------------------------------------------------------
PLAN_SYSTEM_PROMPT = (
    "You are the semantic planner for a Korean-first B2B outreach operator bot. "
    "You PROPOSE a plan; a deterministic Python layer validates and decides — you "
    "never execute anything. Return STRICT JSON only (no prose, no markdown fence) "
    "matching exactly this schema and key set:\n"
    "{\n"
    '  "intent": "answer_status | summarize_candidates | list_active_graphs | '
    'propose_next_action | create_subagent_prompt | clarify | refuse",\n'
    '  "target": {"root_task_id": null, "task_id": null, "slug": null},\n'
    '  "agent": null,\n'
    '  "safety_level": "read_only",\n'
    '  "requires_approval": false,\n'
    '  "allowed_action": null,\n'
    '  "reply": "Korean operator-facing reply",\n'
    '  "proposed_next_steps": [],\n'
    '  "runner_action": null,\n'
    '  "confidence": 0.0\n'
    "}\n"
    "Rules:\n"
    "- You may ONLY use these intents: answer_status, summarize_candidates, "
    "list_active_graphs, propose_next_action, create_subagent_prompt, clarify, refuse.\n"
    "- This is a READ-ONLY planning step. Never request execution: no cancel/"
    "approve/dry-run/scaffold/rollback/collection/PDF/email/Instagram/Claude Code.\n"
    "- safety_level must be \"read_only\". requires_approval must be false. "
    "runner_action and allowed_action must be null.\n"
    "- Only reference task_id / root_task_id values that appear in the context. "
    "Never invent ids. If unsure which graph, use intent \"clarify\".\n"
    "- For create_subagent_prompt, set \"agent\" to one of the listed agents; this "
    "is a PROPOSAL to generate a prompt later (M6-B), not a request to run it.\n"
    "- Never claim in \"reply\" that an action was performed — you only propose.\n"
    "- Keep \"reply\" concise and in Korean."
)


def build_messages(text: str, context: dict[str, Any]) -> list[dict[str, str]]:
    user = (
        "Operator message (Korean):\n"
        f"{text or ''}\n\n"
        "Read-only orchestration context (JSON):\n"
        f"{json.dumps(context, ensure_ascii=False)}\n\n"
        "Return the strict JSON plan now."
    )
    return [{"role": "user", "content": user}]


# --- JSON parsing -------------------------------------------------------------
_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.I)


def parse_plan(raw: str) -> Optional[dict[str, Any]]:
    """Parse the model's text into a JSON object. Returns None if not an object.

    Tolerates an accidental ```json fence but does not 'repair' content — a
    non-object or invalid JSON returns None so the validator emits a clarification.
    """
    if not raw:
        return None
    stripped = _FENCE_RE.sub("", raw.strip())
    try:
        obj = json.loads(stripped)
    except (json.JSONDecodeError, ValueError):
        return None
    return obj if isinstance(obj, dict) else None


# --- network call (lazy import; mockable) ------------------------------------
def call_claude(messages: list[dict[str, str]], *, model: str,
                timeout_seconds: float, max_tokens: int = 1024) -> str:
    """Call the Anthropic Messages API and return the text. Imported lazily so the
    module imports without the SDK; tests inject a `responder` and never reach here.
    """
    import anthropic  # lazy: never required at import time

    client = anthropic.Anthropic(timeout=timeout_seconds)
    resp = client.messages.create(
        model=model, max_tokens=max_tokens,
        system=PLAN_SYSTEM_PROMPT, messages=messages)
    parts = [getattr(b, "text", "") for b in getattr(resp, "content", []) or []]
    return "".join(parts)


def plan(text: str, *, store_path: Path, events_path: Optional[Path] = None,
         runs_path: Optional[Path] = None, reviews_path: Optional[Path] = None,
         generated_prompts_dir: Optional[Path] = None,
         responder: Optional[Callable[[list[dict[str, str]]], str]] = None,
         ) -> dict[str, Any]:
    """Produce an UNTRUSTED plan proposal from Claude (or report unavailability).

    Returns {"available", "status", "plan", "raw", "reason"}. `available` is True
    only when the planner is active AND a model response was obtained. The plan is
    NOT validated here — pass it to plan_validator.validate(). `responder` lets
    tests inject a fake model (str-returning callable) so no real API is called.
    """
    if responder is None:
        if not is_enabled():
            return _unavailable(STATUS_DISABLED, "planner disabled (env)")
        if not is_configured():
            return _unavailable(STATUS_UNCONFIGURED, "ANTHROPIC_API_KEY missing")

    context = build_context(
        text, store_path=store_path, events_path=events_path, runs_path=runs_path,
        reviews_path=reviews_path, generated_prompts_dir=generated_prompts_dir)
    messages = build_messages(text, context)

    try:
        if responder is not None:
            raw = responder(messages)
        else:
            raw = call_claude(messages, model=_model(),
                              timeout_seconds=_timeout_seconds())
    except Exception as exc:  # network/SDK/timeout — never leak a secret
        return {"available": False, "status": STATUS_ERROR, "plan": None,
                "raw": None, "reason": f"{type(exc).__name__}"}

    parsed = parse_plan(raw)
    if parsed is None:
        return {"available": True, "status": STATUS_UNPARSABLE, "plan": None,
                "raw": raw, "reason": "model did not return a JSON object"}
    return {"available": True, "status": STATUS_OK, "plan": parsed,
            "raw": raw, "reason": None}


def _unavailable(status: str, reason: str) -> dict[str, Any]:
    return {"available": False, "status": status, "plan": None,
            "raw": None, "reason": reason}
