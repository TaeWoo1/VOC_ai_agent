"""M6-A: render a VALIDATED Claude plan into a concise Korean Discord report.

Pure formatting only — it never executes, writes, or mutates anything. It takes
the structured result from `plan_validator.validate()` and produces operator-facing
text. A valid read-only plan is shown as a labelled "판단" report; a refused or
clarification result is shown with the reason and the allowed-scope reminder so the
operator always knows M6-A stayed inside the read-only envelope.
"""

from __future__ import annotations

from typing import Any

import plan_validator as _pv

_INTENT_LABEL = {
    "answer_status": "상태 답변 (answer_status)",
    "summarize_candidates": "후보 요약 (summarize_candidates)",
    "list_active_graphs": "진행 그래프 목록 (list_active_graphs)",
    "propose_next_action": "다음 액션 제안 (propose_next_action)",
    "create_subagent_prompt": "sub-agent 프롬프트 제안 (create_subagent_prompt)",
    "clarify": "확인 필요 (clarify)",
    "refuse": "거부 (refuse)",
}

_ALLOWED_SCOPE_REMINDER = (
    "허용된 범위: read-only answer / summarize / propose next action "
    "(M6-A는 실행·승인·취소·수집·발송을 하지 않습니다)."
)

# operator-friendly explanations for validator reason codes
_REASON_HINT = {
    "reply_claims_execution": "제안 내용이 '이미 실행했다'는 식이라 차단했습니다.",
    "runner_action_not_allowed": "runner 실행 요청이 포함되어 차단했습니다.",
    "allowed_action_not_allowed_in_m6a": "외부 실행 액션이 포함되어 차단했습니다.",
    "requires_approval_implies_action": "승인이 필요한 실행 제안이라 차단했습니다.",
}


def _target_line(target: dict[str, Any]) -> str:
    parts = []
    if target.get("root_task_id"):
        parts.append(f"root=`{target['root_task_id']}`")
    if target.get("task_id"):
        parts.append(f"task=`{target['task_id']}`")
    if target.get("slug"):
        parts.append(f"slug=`{target['slug']}`")
    return ", ".join(parts) if parts else "(미지정)"


def format_validated_plan(result: dict[str, Any]) -> str:
    plan = result.get("plan") or {}
    intent = plan.get("intent", result.get("intent", ""))
    lines = [
        "🤖 Claude Orchestrator 판단:",
        f"- intent: {_INTENT_LABEL.get(intent, intent)}",
        f"- 대상: {_target_line(plan.get('target') or {})}",
    ]
    if plan.get("agent"):
        lines.append(f"- 제안 agent: {plan['agent']} (프롬프트 생성은 M6-B에서, 실행 아님)")
    reply = (plan.get("reply") or "").strip()
    if reply:
        lines.append(f"- 요약: {reply}")
    steps = plan.get("proposed_next_steps") or []
    if steps:
        lines.append("- 다음 제안:")
        lines.extend(f"  {i}. {s}" for i, s in enumerate(steps, 1))
    lines.append(f"- 안전 등급: {plan.get('safety_level', 'read_only')} (실행 아님, 읽기 전용)")
    return "\n".join(lines)


def format_refusal(result: dict[str, Any]) -> str:
    reason = result.get("reason") or "허용되지 않는 제안"
    hint = _REASON_HINT.get(reason.split(":", 1)[0], reason)
    return ("🤖 Claude Orchestrator가 제안한 작업은 현재 허용되지 않습니다.\n"
            f"이유: {hint}\n"
            f"{_ALLOWED_SCOPE_REMINDER}")


def format_clarification(result: dict[str, Any]) -> str:
    return ("🤖 Claude Orchestrator가 제안을 확정하지 못했습니다 (확인 필요).\n"
            "상태를 보려면 '지금 어디까지 됐어?', 후보는 '후보군 요약해줘', "
            "새 작업은 '다음 브랜드 하나 골라서 콜드메일까지 준비해줘.' 처럼 다시 적어 주세요.\n"
            f"{_ALLOWED_SCOPE_REMINDER}")


def format_result(result: dict[str, Any]) -> str:
    """Dispatch on validator outcome -> operator-facing Discord text."""
    outcome = result.get("outcome")
    if outcome == _pv.VALID:
        return format_validated_plan(result)
    if outcome == _pv.REFUSED:
        return format_refusal(result)
    return format_clarification(result)
