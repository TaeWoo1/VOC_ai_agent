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
import action_dispatch as _action   # D4-3a: render_report guarded pipeline action

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
    packets_root: Optional[Path] = None,
    staging_root: Optional[Path] = None,
    collect_queue_path: Optional[Path] = None,
    collect_staging_root: Optional[Path] = None,
    head_baseline: Optional[str] = None,
    send_staging_root: Optional[Path] = None,
    publish_packages_root: Optional[Path] = None,
    publish_staging_root: Optional[Path] = None,
) -> dict[str, Any]:
    """Route a validated intent. Returns a handler dict ({intent, handled, reply,
    executed}). Executes only the D4-2 allowlist + D4-3a render; else report-only."""
    op = operator_discord_id
    root, arp, ard = _ad._resolve_paths(repo_root, agent_runs_path, agent_runs_dir)
    intent = v.get("intent")

    # clarify / refuse / non-report -> report card, no execution.
    if v.get("outcome") != _ai.REPORT:
        return _card(v)

    # D4-3a: render_report is a guarded yellow PIPELINE action (not agent_dispatch).
    # propose-only here (precondition gate + arm pending); confirm runs via
    # confirm_pending -> action-pending. Requires a packets_root to resolve.
    if intent == "render_report":
        if packets_root is None:
            return _card(v)  # no packet root configured -> stay report-only
        # return the action result verbatim (preserves failed_check/artifacts).
        return _action.propose_render(
            op, task_id=(v.get("targets") or {}).get("task_id"),
            packets_root=Path(packets_root), staging_root=staging_root)

    # D4-3b1: collect_reviews is a guarded yellow PIPELINE action (plan/dry-run).
    # propose-only here (target resolution + precondition gate + staging plan);
    # confirm runs via confirm_pending -> action-pending(kind=collect), which in
    # D4-3b1 hard-blocks (collect_live_not_enabled). Requires a queue path.
    if intent == "collect_reviews":
        if collect_queue_path is None:
            return _card(v)  # no queue configured -> stay report-only
        staging = collect_staging_root or (root / "outputs" / "agent_collect_plan")
        # return the action result verbatim (preserves failed_check).
        return _action.propose_collect(
            op, target=(v.get("targets") or {}).get("target"),
            queue_path=Path(collect_queue_path), staging_root=Path(staging),
            repo_root=root, head_baseline=head_baseline)

    # D4-4a: send_outreach is a guarded RED PIPELINE action (preview/draft only).
    # propose-only here (precondition gate + inert staging preview + arm pending);
    # confirm runs via confirm_pending -> action-pending(kind=send), which in
    # D4-4a hard-blocks (send_not_enabled). Requires a packets_root to resolve.
    if intent == "send_outreach":
        if packets_root is None:
            return _card(v)  # no packet root configured -> stay report-only
        staging = send_staging_root  # per-task default computed in action_dispatch
        # return the action result verbatim (preserves failed_check / artifacts).
        return _action.propose_send_preview(
            op, task_id=(v.get("targets") or {}).get("task_id"),
            packets_root=Path(packets_root),
            staging_root=Path(staging) if staging else None,
            approval_log_path=approval_log_path)

    # D4-4c: publish_post is a guarded RED PIPELINE action (preview/draft only).
    # propose-only here (precondition gate incl. rights + safety + inert staging
    # preview); confirm runs via confirm_pending -> action-pending(kind=publish),
    # which in D4-4c hard-blocks (publish_not_enabled). Requires a packages_root.
    if intent == "publish_post":
        if publish_packages_root is None:
            return _card(v)  # no publish packages root configured -> report-only
        staging = publish_staging_root  # per-package default computed downstream
        # return the action result verbatim (preserves failed_check / artifacts).
        return _action.propose_publish_preview(
            op, target=(v.get("targets") or {}).get("target"),
            packages_root=Path(publish_packages_root),
            staging_root=Path(staging) if staging else None,
            approval_log_path=approval_log_path)

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

    # --- yellow: confirm. Precedence: agent run-pending -> action-pending ----
    #     (render, D4-3a) -> edit-pending guidance -> clarify. NEVER bounded_edit.
    if intent == "confirm_pending":
        if _disp._get_pending(op) is not None:
            res = _disp.confirm_agent_run(
                op, repo_root=root, agent_runs_path=arp, agent_runs_dir=ard,
                approval_log_path=approval_log_path, adapter=adapter)
            return _reply("intent_confirm", res["report"],
                          executed=res.get("outcome") == "dry_run")
        pend_action = _action.get_pending_action(op)
        if pend_action is not None:
            # dispatch by kind (render -> confirm_action; collect -> confirm_collect).
            # return verbatim (preserves failed_check / artifacts). Planner NL never
            # sets authorize_live, so confirm_collect lands on its auth/D4-3b1 block.
            if pend_action.get("kind") == "collect":
                return _action.confirm_collect(op, approval_log_path=approval_log_path)
            if pend_action.get("kind") == "send":
                # RED: planner NL / generic confirm NEVER set authorize_send.
                return _action.confirm_send_final(
                    op, authorize_send=False, approval_log_path=approval_log_path)
            if pend_action.get("kind") == "publish":
                # RED: planner NL / generic confirm NEVER set authorize_publish.
                # In D4-4c this hard-blocks publish_not_enabled regardless.
                return _action.confirm_publish_final(
                    op, authorize_publish=False, approval_log_path=approval_log_path)
            return _action.confirm_action(op, approval_log_path=approval_log_path)
        if _disp._get_pending_edit(op) is not None:
            # an edit is pending, but planner NL must NOT apply it.
            return _reply("intent_confirm",
                          '편집 적용은 평문이 아니라 "편집 진행해"로 명시해 주세요.',
                          executed=False)
        return _reply("intent_confirm",
                      "대기 중인 실행 제안이 없습니다. 먼저 제안해 주세요.",
                      executed=False)

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
