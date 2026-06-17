"""M6-B: Discord report formatting for agent runs (AI-SCAFFOLD).

Pure formatting — renders an AgentRunResult (+ validator verdict) into a concise
Korean Discord report. Never executes, writes, or mutates anything.
"""

from __future__ import annotations

from typing import Optional

from agent_runtime import AgentRunResult

# operator-friendly status labels
_STATUS_LABEL = {
    "unavailable": "사용 불가 (unavailable)",
    "dry_run": "미리보기 완료 (dry_run, 실행 아님)",
    "running": "실행 중 (running)",
    "done": "완료 (done)",
    "failed": "실패 (failed)",
    "timed_out": "시간 초과 (timed_out)",
    "blocked": "차단됨 (blocked)",
}

_DEFAULT_NEXT_STEPS = ("후보 승인", "후보 더 요청", "그래프 취소")


def _artifact_lines(result: AgentRunResult) -> list[str]:
    out = []
    if result.stdout_path:
        out.append(f"  - stdout: `{result.stdout_path}`")
    if result.summary_path:
        out.append(f"  - summary: `{result.summary_path}`")
    if result.changed_files:
        out.append(f"  - changed_files: {len(result.changed_files)}개")
    return out


def format_success(result: AgentRunResult, *, agent_name: str, task_id: str,
                   next_steps: tuple[str, ...] = _DEFAULT_NEXT_STEPS) -> str:
    lines = [
        "✅ Agent run completed",
        f"- adapter: {result.adapter_name}",
        f"- agent: {agent_name}",
        f"- task/root: `{task_id}`",
        f"- status: {_STATUS_LABEL.get(result.status, result.status)}",
        f"- run_id: `{result.run_id}`",
    ]
    artifacts = _artifact_lines(result)
    if artifacts:
        lines.append("- artifacts:")
        lines.extend(artifacts)
    lines.append("- next suggestions:")
    lines.extend(f"  {i}. {s}" for i, s in enumerate(next_steps, 1))
    return "\n".join(lines)


def format_failure(result: AgentRunResult, *, agent_name: str, stage: str,
                   reason: Optional[str] = None,
                   next_safe_action: str = "운영자 검토 후 재시도하거나 범위를 축소하세요."
                   ) -> str:
    why = reason or {
        "failed": "실행 실패 (nonzero exit)",
        "timed_out": "시간 초과로 프로세스를 종료했습니다.",
        "blocked": "허용되지 않은 변경/주장으로 결과를 차단했습니다.",
        "unavailable": "런타임을 사용할 수 없습니다.",
    }.get(result.status, result.status)
    lines = [
        "⚠ Agent run blocked/failed",
        f"- adapter: {result.adapter_name}",
        f"- agent: {agent_name}",
        f"- stage: {stage}",
        f"- status: {_STATUS_LABEL.get(result.status, result.status)}",
        f"- reason: {why}",
    ]
    if result.stdout_path:
        lines.append(f"- stdout: `{result.stdout_path}`")
    if result.stderr_path:
        lines.append(f"- stderr: `{result.stderr_path}`")
    if result.safety_notes:
        lines.append(f"- safety_notes: {'; '.join(result.safety_notes)}")
    lines.append(f"- next safe action: {next_safe_action}")
    return "\n".join(lines)


def format_result(result: AgentRunResult, *, agent_name: str, stage: str,
                  task_id: str, reason: Optional[str] = None) -> str:
    """Dispatch on status -> success vs failure/blocked report."""
    if result.status == "done":
        return format_success(result, agent_name=agent_name, task_id=task_id)
    return format_failure(result, agent_name=agent_name, stage=stage, reason=reason)


def format_proposal(*, adapter_name: str, agent_name: str, stage: str,
                    task_id: str) -> str:
    """The pre-run proposal shown to the operator (no run yet)."""
    return (
        f"{agent_name} 실행 계획을 만들었습니다. 실행 전 확인:\n"
        f"- adapter: {adapter_name}\n"
        f"- stage: {stage}\n"
        f"- task: `{task_id}`\n"
        "- 이 작업은 수집/발송/PDF/게시를 하지 않습니다 (worktree 안에서만 동작).\n"
        '진행할까요? ("진행해" / "취소")'
    )


def format_unavailable(*, adapter_name: str, note: str) -> str:
    return ("⚠ Agent run blocked/failed\n"
            f"- adapter: {adapter_name}\n"
            "- status: 사용 불가 (unavailable)\n"
            f"- reason: {note}\n"
            "- next safe action: 로컬 런타임이 준비되면 다시 시도하세요 (M6-C).")
