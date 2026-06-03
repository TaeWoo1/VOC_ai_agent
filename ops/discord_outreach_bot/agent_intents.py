"""D4-1: intent schema + green/yellow/red category policy + validator (SELF).

The Python half of the operator console's "Claude proposes, Python disposes"
loop. A planner turns operator NL into a structured intent object (untrusted);
this module RECOMPUTES the action category and the confirmation policy in Python
— it never trusts a model-supplied category — and decides whether the bot should
report, clarify, or refuse. D4-1 is REPORT-ONLY: the highest outcome here is
"report"; nothing executes, nothing mutates a packet, nothing is sent.

Categories:
  🟢 green  — read-only / preview. No side effects.
  🟡 yellow — real but contained/reversible; allowed later behind one explicit
              confirmation + precondition checks (D4-2/D4-3).
  🔴 red    — external / irreversible (send, publish); requires a SEPARATE,
              scoped final approval (D4-4/D4-5). Never reachable by broad NL.
"""

from __future__ import annotations

from typing import Any, Optional

# the closed intent vocabulary (model must map NL into exactly one of these).
INTENTS = (
    "ask_status", "summarize_state",
    "propose_agent_run", "confirm_pending", "cancel_pending", "cleanup_worktree",
    "collect_reviews", "render_report",
    "send_outreach", "publish_post",
    "clarify", "refuse",
)

# action-category policy — the SINGLE source of truth. A model-proposed category
# is ignored; categorize() recomputes from the intent name alone.
GREEN = frozenset({"ask_status", "summarize_state", "clarify", "refuse"})
YELLOW = frozenset({"propose_agent_run", "confirm_pending", "cancel_pending",
                    "cleanup_worktree", "collect_reviews", "render_report"})
RED = frozenset({"send_outreach", "publish_post"})

# required target fields per intent; missing -> clarify.
REQUIRED_TARGETS: dict[str, tuple[str, ...]] = {
    "ask_status": (),
    "summarize_state": (),
    "propose_agent_run": ("task_id", "stage"),
    "confirm_pending": (),
    "cancel_pending": (),
    "cleanup_worktree": ("run_id",),
    "collect_reviews": ("target",),
    "render_report": ("task_id",),
    "send_outreach": ("task_id",),
    "publish_post": ("target",),
    "clarify": (),
    "refuse": (),
}

# confirmation policy per category (what WOULD be required to execute).
CONFIRMATION = {
    "green": "none",                      # read-only; no confirmation
    "yellow": "single_explicit",          # one explicit confirmation + preconditions
    "red": "separate_final_approval",     # scoped, logged, never broad-NL reachable
}

REPORT = "report"
CLARIFY = "clarify"
REFUSE = "refuse"


def categorize(intent: str) -> Optional[str]:
    """Recompute the category from the intent name. None for unknown intents."""
    if intent in GREEN:
        return "green"
    if intent in YELLOW:
        return "yellow"
    if intent in RED:
        return "red"
    return None


def _missing_targets(intent: str, targets: dict[str, Any]) -> list[str]:
    targets = targets or {}
    return [t for t in REQUIRED_TARGETS.get(intent, ())
            if not str(targets.get(t) or "").strip()]


def validate(intent_obj: dict[str, Any]) -> dict[str, Any]:
    """Validate an untrusted planner intent. Returns
    {ok, outcome(report|clarify|refuse), intent, category, confirmation,
     missing, targets, reason}. NEVER returns an "execute" outcome (D4-1).
    """
    intent = (intent_obj or {}).get("intent")
    targets = (intent_obj or {}).get("targets") or {}

    # unknown / explicit-refuse intents
    if intent not in INTENTS:
        return _result(REFUSE, None, intent, None, missing=[], targets=targets,
                       reason=f"unknown_intent:{intent!r}")
    if intent == "refuse":
        return _result(REFUSE, "green", intent, "green", missing=[],
                       targets=targets, reason="model_refused")

    category = categorize(intent)  # recomputed; model's category is ignored

    if intent == "clarify":
        return _result(CLARIFY, "green", intent, category, missing=[],
                       targets=targets, reason="model_requested_clarify")

    missing = _missing_targets(intent, targets)
    if missing:
        return _result(CLARIFY, category, intent, category, missing=missing,
                       targets=targets, reason="missing_targets")

    return _result(REPORT, category, intent, category, missing=[],
                   targets=targets, reason=None)


def _result(outcome, _cat_unused, intent, category, *, missing, targets, reason):
    return {
        "ok": outcome == REPORT,
        "outcome": outcome,
        "intent": intent,
        "category": category,
        "confirmation": CONFIRMATION.get(category) if category else None,
        "missing": missing,
        "targets": targets,
        "reason": reason,
    }


# --- Korean report-only card -------------------------------------------------
_CATEGORY_EMOJI = {"green": "🟢", "yellow": "🟡", "red": "🔴"}
_CATEGORY_LINE = {
    "green": "조회/요약 요청으로 이해했습니다. (실행 아님)",
    "yellow": "실행 가능한 작업이지만 확인이 필요합니다. (아직 실행 안 함)",
    "red": "외부 영향 작업이라 최종 명시 승인이 필요합니다. (아직 실행 안 함)",
}
_CONFIRM_LINE = {
    "none": "확인: 불필요 (읽기 전용)",
    "single_explicit": "확인: 1회 명시 확인 + 선행조건 검증 필요",
    "separate_final_approval": "확인: 별도 최종 승인(대상 지정 + 승인 로그) 필요",
}


def format_report(v: dict[str, Any]) -> str:
    """Render a report-only Korean card. Never implies execution happened."""
    intent = v.get("intent")
    cat = v.get("category")
    if v["outcome"] == REFUSE:
        return (f"⛔ 거부: 이 요청은 실행할 수 없습니다.\n- intent: `{intent}`\n"
                f"- reason: {v.get('reason')}")
    if v["outcome"] == CLARIFY:
        miss = ", ".join(f"`{m}`" for m in v.get("missing", []))
        need = f" (누락: {miss})" if miss else ""
        return (f"❓ 더 확인이 필요합니다{need}.\n- intent(추정): `{intent}`\n"
                "- 대상/조건을 알려주시면 다시 해석하겠습니다 (실행 안 함).")
    emoji = _CATEGORY_EMOJI.get(cat, "")
    lines = [
        f"{emoji} 이해한 작업: `{intent}` ({cat})",
        f"- {_CATEGORY_LINE.get(cat, '')}",
        f"- {_CONFIRM_LINE.get(v.get('confirmation'), '')}",
    ]
    targets = {k: vv for k, vv in (v.get("targets") or {}).items() if vv}
    if targets:
        lines.append("- 대상: " + ", ".join(f"{k}=`{vv}`" for k, vv in targets.items()))
    lines.append("- (D4-1 보고 전용: 아직 아무것도 실행하지 않았습니다.)")
    return "\n".join(lines)
