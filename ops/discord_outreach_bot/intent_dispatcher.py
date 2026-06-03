"""D4-2: intent -> action dispatcher (SELF).

Takes a Python-VALIDATED intent (from agent_intents.validate) and routes a strict
allowlist of green/yellow intents to the ALREADY-VERIFIED agent_dispatch
functions. It adds no new execution capability — it is a second NL front-end onto
the same dispatch lifecycle the deterministic fallback already uses.

D4-2 executes ONLY: ask_status, summarize_state (read-only), propose_agent_run
(arms a dry_run pending — no run), confirm_pending (dry_run iff a run-pending
exists), cancel_pending, cleanup_worktree. Everything else — collect_reviews,
render_report, send_outreach, publish_post — stays REPORT-ONLY (D4-3/D4-4).

Hard safety lines:
  - NO intent maps to confirm_bounded_edit_run. bounded_edit stays reachable ONLY
    via the explicit deterministic phrase "편집 진행해" in agent_discord_adapter.
    confirm_pending NEVER triggers an edit (even if an edit-pending exists).
  - collect/render/send/publish have NO executor here.
  - no packet mutation, no copy-back; cleanup is explicit; dry_run is plan-mode.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable, Optional

import agent_dispatch as _disp
import agent_discord_adapter as _ad   # reuse _agent_for_stage / _resolve_paths / _format_status
import agent_intents as _ai

# the ONLY intents D4-2 will execute; anything else is report-only.
D4_2_EXECUTABLE_INTENTS = frozenset({
    "ask_status", "summarize_state",
    "propose_agent_run", "confirm_pending", "cancel_pending", "cleanup_worktree",
})

_DEFAULT_ADAPTER = "claude_code_local"
_DEFAULT_TIMEOUT_S = 120


def _reply(intent: str, text: str, *, executed: bool) -> dict[str, Any]:
    return {"intent": intent, "handled": True, "reply": text, "executed": executed}


def _card(v: dict[str, Any]) -> dict[str, Any]:
    """Report-only card (no execution) for non-executable / clarify / refuse."""
    return {"intent": f"intent_{v['outcome']}", "handled": True,
            "reply": _ai.format_report(v), "executed": False,
            "category": v.get("category"), "validated": v}


def dispatch_intent(
    v: dict[str, Any], *, operator_discord_id: str,
    repo_root: Optional[Path] = None,
    agent_runs_path: Optional[Path] = None,
    agent_runs_dir: Optional[Path] = None,
    approval_log_path: Optional[Path] = None,
    generated_prompts_dir: Optional[Path] = None,
    known_task_ids: Optional[Iterable[str]] = None,
    adapter: Any = None,
) -> dict[str, Any]:
    """Route a validated intent. Returns a handler dict ({intent, handled, reply,
    executed}). Executes only the D4-2 allowlist; else report-only."""
    op = operator_discord_id
    root, arp, ard = _ad._resolve_paths(repo_root, agent_runs_path, agent_runs_dir)
    intent = v.get("intent")

    # clarify / refuse / non-report -> report card, no execution.
    if v.get("outcome") != _ai.REPORT:
        return _card(v)
    # report outcome but not in the D4-2 executable allowlist -> report-only.
    if intent not in D4_2_EXECUTABLE_INTENTS:
        return _card(v)

    targets = v.get("targets") or {}

    # --- green: read-only state views ---------------------------------------
    if intent in ("ask_status", "summarize_state"):
        return _reply(f"intent_{intent}", _ad._format_status(op, arp),
                      executed=True)

    # --- yellow: propose (arms a dry_run pending; NO run) --------------------
    if intent == "propose_agent_run":
        stage = targets.get("stage")
        task_id = targets.get("task_id")
        agent = _ad._agent_for_stage(stage)
        if agent is None:
            return _reply("intent_propose", f"알 수 없는 stage 입니다: `{stage}`.",
                          executed=False)
        pdir = Path(generated_prompts_dir) if generated_prompts_dir else (
            root / "ops" / "discord_outreach_bot" / "generated_prompts")
        prompt_path = pdir / f"{task_id}__{agent}__{stage}.md"
        if not prompt_path.exists():
            return _reply("intent_propose",
                          f"프롬프트 파일이 없습니다: `{prompt_path.name}`.",
                          executed=False)
        res = _disp.propose_agent_run(
            operator_id=op, agent_name=agent, stage=stage, task_id=task_id,
            adapter_name=_DEFAULT_ADAPTER, prompt_path=prompt_path, mode="plan",
            timeout_s=_DEFAULT_TIMEOUT_S, repo_root=root,
            known_task_ids=known_task_ids, agent_runs_path=arp)
        return _reply("intent_propose", res["report"], executed=res.get("ok", False))

    # --- yellow: confirm -> dry_run ONLY (never bounded_edit) ----------------
    if intent == "confirm_pending":
        if _disp._get_pending(op) is None:
            if _disp._get_pending_edit(op) is not None:
                # an edit is pending, but planner NL must NOT apply it.
                return _reply("intent_confirm",
                              '편집 적용은 평문이 아니라 "편집 진행해"로 명시해 주세요.',
                              executed=False)
            return _reply("intent_confirm",
                          "대기 중인 실행 제안이 없습니다. 먼저 제안해 주세요.",
                          executed=False)
        res = _disp.confirm_agent_run(
            op, repo_root=root, agent_runs_path=arp, agent_runs_dir=ard,
            approval_log_path=approval_log_path, adapter=adapter)
        return _reply("intent_confirm", res["report"],
                      executed=res.get("outcome") == "dry_run")

    # --- yellow: cancel ------------------------------------------------------
    if intent == "cancel_pending":
        if _disp._get_pending(op) is not None:
            res = _disp.cancel_pending_agent_run(op, agent_runs_path=arp)
            return _reply("intent_cancel", res["report"], executed=True)
        if _disp._get_pending_edit(op) is not None:
            _disp._clear_pending_edit(op)
            return _reply("intent_cancel", "편집 제안을 취소했습니다.", executed=True)
        return _reply("intent_cancel", "취소할 대기 작업이 없습니다.", executed=False)

    # --- yellow: cleanup (explicit run_id, validator-required) ---------------
    if intent == "cleanup_worktree":
        run_id = targets.get("run_id")
        out = _disp.cleanup_run(run_id, repo_root=root, agent_runs_path=arp)
        msg = (f"🧹 worktree 제거됨 (`{run_id}`). 아티팩트/로그는 보존됩니다."
               if out.get("worktree_removed")
               else f"worktree를 찾지 못했거나 제거 실패: `{run_id}`.")
        return _reply("intent_cleanup", msg, executed=out.get("worktree_removed", False))

    return _card(v)  # unreachable; defensive
