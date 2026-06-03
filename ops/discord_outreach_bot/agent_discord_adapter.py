"""M6-D4 (fallback tier): deterministic phrase shortcuts for the agent-run
dispatch lifecycle (SELF).

This is the SHORTCUT / FALLBACK layer of the planned D4 operator console — NOT a
final command bot. The end-state is: operator NL -> Claude intent planner ->
Python validator (green/yellow/red) -> confirmation -> validator-allowed action.
This module is what runs when the planner is disabled/unconfigured, when a
message is unambiguous, or as an explicit power-user shortcut. The intent planner
+ action-category validator (D4-1+) will sit ABOVE this and fall back to it.

It is a thin routing/reporting layer between Discord natural language and the
existing `agent_dispatch` functions. It adds NO new agent capability — it only
recognizes a small set of DETERMINISTIC, anchored phrases and forwards to
propose / confirm / confirm_bounded_edit / cancel / cleanup, then returns a
concise Korean reply.

Safety design:
  - Broad natural language NEVER proposes or confirms an edit. Proposal needs the
    explicit structured phrase "에이전트 제안 <task_id> <stage>"; edits need the
    distinct "편집 진행해".
  - "진행해" is claimed ONLY when the operator has a pending agent run; otherwise
    try_handle returns None so the existing M5-A.5 cancel-confirm / NL flow is
    preserved untouched.
  - This module sends nothing, mutates no packet, copies nothing back, and never
    git commits/pushes. Cleanup is explicit and only frees a worktree checkout.

`try_handle(...)` returns a handler dict ({"intent","handled","reply"}) when it
claims the message, or None to fall through to the rest of handle_nl_message.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Iterable, Optional

import agent_dispatch as _disp
import agent_run_validator as _val
import agent_runs as _runs
from agent_registry import AGENTS as _AGENTS

# anchored, exact phrases — never broad NL.
_RE_EDIT_CONFIRM = re.compile(r"^\s*편집\s*진행\s*해?\s*[.!~]*\s*$")
_RE_RUN_CONFIRM = re.compile(r"^\s*(?:실행\s*)?진행\s*해?\s*[.!~]*\s*$")
_RE_CANCEL = re.compile(r"^\s*(?:실행\s*)?(?:취소|취소해)\s*[.!~]*\s*$")
_RE_CLEANUP = re.compile(
    r"^\s*(?:cleanup|worktree\s*정리|정리)\s+(run_[A-Za-z0-9_-]+)\s*$", re.I)
_RE_CLEANUP_BARE = re.compile(r"^\s*(?:worktree\s*정리|정리)\s*[.!?]*\s*$")
_RE_STATUS = re.compile(r"^\s*(?:에이전트\s*상태|agent\s*status)\s*[?]*\s*$", re.I)
_RE_PROPOSE = re.compile(
    r"^\s*에이전트\s*제안\s+(task_[A-Za-z0-9_-]+)\s+([a-z_]+)\s*$")

_DEFAULT_TIMEOUT_S = 120
_DEFAULT_ADAPTER = "claude_code_local"


def _reply(intent: str, text: str) -> dict[str, Any]:
    return {"intent": intent, "handled": True, "reply": text}


def _agent_for_stage(stage: str) -> Optional[str]:
    """Resolve the registered agent that owns a runtime stage (deterministic)."""
    base = _val.RUNTIME_STAGE_TO_AGENT_STAGE.get(stage)
    if not base:
        return None
    for name, spec in _AGENTS.items():
        if base in spec.allowed_stages:
            return name
    return None


def _resolve_paths(repo_root, agent_runs_path, agent_runs_dir):
    root = Path(repo_root) if repo_root else _runs.find_repo_root()
    arp = Path(agent_runs_path) if agent_runs_path else _runs.default_agent_runs_path(root)
    ard = Path(agent_runs_dir) if agent_runs_dir else _runs.default_agent_runs_dir(root)
    return root, arp, ard


def try_handle(
    text: str, *, operator_discord_id: str,
    repo_root: Optional[Path] = None,
    agent_runs_path: Optional[Path] = None,
    agent_runs_dir: Optional[Path] = None,
    approval_log_path: Optional[Path] = None,
    generated_prompts_dir: Optional[Path] = None,
    store_path: Optional[Path] = None,
    known_task_ids: Optional[Iterable[str]] = None,
    adapter: Any = None,
) -> Optional[dict[str, Any]]:
    """Route an agent-lifecycle phrase, or return None to fall through."""
    op = operator_discord_id
    root, arp, ard = _resolve_paths(repo_root, agent_runs_path, agent_runs_dir)

    # 1. "편집 진행해" — unambiguous; always claimed.
    if _RE_EDIT_CONFIRM.match(text):
        if _disp._get_pending_edit(op) is None:
            return _reply("agent_edit_no_pending",
                          "대기 중인 편집 제안이 없습니다. dry_run이 깨끗하면 "
                          '"편집 진행해"로 적용할 수 있습니다.')
        res = _disp.confirm_bounded_edit_run(
            op, repo_root=root, agent_runs_path=arp, agent_runs_dir=ard,
            approval_log_path=approval_log_path, adapter=adapter)
        return _reply("agent_bounded_edit", res["report"])

    # 2. explicit structured propose.
    m = _RE_PROPOSE.match(text)
    if m:
        task_id, stage = m.group(1), m.group(2)
        agent = _agent_for_stage(stage)
        if agent is None:
            return _reply("agent_propose",
                          f"알 수 없는 stage 입니다: `{stage}`.")
        pdir = Path(generated_prompts_dir) if generated_prompts_dir else (
            root / "ops" / "discord_outreach_bot" / "generated_prompts")
        prompt_path = pdir / f"{task_id}__{agent}__{stage}.md"
        if not prompt_path.exists():
            return _reply("agent_propose",
                          f"프롬프트 파일이 없습니다: `{prompt_path.name}` "
                          "(먼저 프롬프트를 생성하세요).")
        known = known_task_ids
        if known is None and store_path is not None:
            try:
                import task_store as _store
                known = {t.task_id for t in _store.load_tasks(store_path)}
            except Exception:
                known = None
        res = _disp.propose_agent_run(
            operator_id=op, agent_name=agent, stage=stage, task_id=task_id,
            adapter_name=_DEFAULT_ADAPTER, prompt_path=prompt_path, mode="plan",
            timeout_s=_DEFAULT_TIMEOUT_S, repo_root=root,
            known_task_ids=known, agent_runs_path=arp)
        return _reply("agent_propose", res["report"])

    # 3. cleanup (explicit run_id), and bare cleanup -> list-only.
    m = _RE_CLEANUP.match(text)
    if m:
        run_id = m.group(1)
        out = _disp.cleanup_run(run_id, repo_root=root, agent_runs_path=arp)
        msg = (f"🧹 worktree 제거됨 (`{run_id}`). 감사 로그/아티팩트는 보존됩니다."
               if out["worktree_removed"]
               else f"worktree를 찾지 못했거나 제거 실패: `{run_id}`.")
        return _reply("agent_cleanup", msg)
    if _RE_CLEANUP_BARE.match(text):
        ids = _operator_run_ids(op, arp)
        if not ids:
            return _reply("agent_cleanup_list", "정리할 run이 없습니다.")
        listing = ", ".join(f"`{r}`" for r in ids[-10:])
        return _reply("agent_cleanup_list",
                      f"정리할 run_id를 지정하세요 (삭제 안 함): {listing}\n"
                      '예: "cleanup run_xxxx"')

    # 4. read-only agent status.
    if _RE_STATUS.match(text):
        return _reply("agent_status", _format_status(op, arp))

    # 5. "진행해" — claimed ONLY if an agent run is pending; else fall through.
    if _RE_RUN_CONFIRM.match(text):
        if _disp._get_pending(op) is None:
            return None  # preserve M5-A.5 cancel-confirm / other flows
        res = _disp.confirm_agent_run(
            op, repo_root=root, agent_runs_path=arp, agent_runs_dir=ard,
            approval_log_path=approval_log_path, adapter=adapter)
        return _reply("agent_dry_run", res["report"])

    # 6. "취소" — claimed ONLY if an agent run/edit is pending; else fall through.
    if _RE_CANCEL.match(text):
        if _disp._get_pending(op) is not None:
            res = _disp.cancel_pending_agent_run(op, agent_runs_path=arp)
            return _reply("agent_cancel", res["report"])
        if _disp._get_pending_edit(op) is not None:
            _disp._clear_pending_edit(op)
            return _reply("agent_cancel", "편집 제안을 취소했습니다.")
        return None  # no agent pending -> existing cancel/NL flow

    return None


# === read-only helpers =======================================================
def _operator_run_ids(operator_id: str, agent_runs_path: Path) -> list[str]:
    seen: dict[str, None] = {}
    for rec in _runs.read_runs(agent_runs_path):
        if rec.get("operator_id") == _disp._op_key(operator_id) and rec.get("run_id"):
            seen.setdefault(rec["run_id"], None)
    return list(seen)


def _format_status(operator_id: str, agent_runs_path: Path) -> str:
    lines = ["에이전트 상태:"]
    run_pend = _disp._get_pending(operator_id)
    edit_pend = _disp._get_pending_edit(operator_id)
    if run_pend:
        lines.append(f'- 대기(run): `{run_pend["run_id"]}` — "진행해" 대기 중')
    if edit_pend:
        lines.append(f'- 대기(edit): `{edit_pend["run_id"]}` — "편집 진행해" 대기 중')
    if not run_pend and not edit_pend:
        lines.append("- 대기: 없음")
    folded = _runs.fold_runs_by_run_id(agent_runs_path)
    mine = [(rid, rec) for rid, rec in folded.items()
            if rec.get("operator_id") == _disp._op_key(operator_id)]
    for rid, rec in mine[-5:]:
        cost = rec.get("cost_usd")
        cost_s = f" · cost_usd: {cost}" if cost is not None else ""
        lines.append(f"- `{rid}`: {rec.get('status')} ({rec.get('mode')}){cost_s}")
    return "\n".join(lines)
