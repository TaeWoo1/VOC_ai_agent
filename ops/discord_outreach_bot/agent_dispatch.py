"""M6-D1: agent-run dispatch lifecycle (SELF — security-critical orchestration).

Wires the M6 pieces into an operator-gated lifecycle, following the unchanged
rule "Claude proposes; Python disposes". Nothing runs without a fresh,
prompt-bound operator confirmation, and every transition is recorded to the
append-only agent_runs spine.

Public API:
  propose_agent_run(...)        -> validate pre-run, hash the prompt, record
                                   `proposed`, set an in-memory pending. NO
                                   worktree, NO adapter execution.
  confirm_agent_run(operator)   -> match pending + RE-VERIFY prompt_hash, record
                                   `approved` (+ approval_log), create worktree,
                                   execute (M6-D1: mock dry_run only), post-
                                   validate, record terminal status, report.
  cancel_pending_agent_run(op)  -> record `cancelled`, drop pending.
  dispatch_agent_run(...)       -> internal executor (worktree -> running ->
                                   dry_run -> post-validate -> terminal record).

M6-D1 constraints baked in here:
  - mock_adapter ONLY; claude_code_local is rejected in dispatch (no real Claude
    Code, no Anthropic API, no ANTHROPIC_API_KEY).
  - dry_run only (bounded_edit is deferred to M6-D3; `do_run` is accepted but not
    acted on).
  - worktree is created on confirmation and NEVER auto-deleted; changes are NEVER
    copied back to the live repo.
  - prompt_hash is bound at propose and re-checked at confirm: a stale/modified
    prompt cannot run.
  - pending is single-use; a repeated confirmation with no pending writes nothing.
This module sends no email, runs no collection, renders no PDF, publishes no
Instagram, mutates no packet status.json/send_log.md, and never git commit/pushes.
"""

from __future__ import annotations

import time
import uuid
from pathlib import Path
from typing import Any, Iterable, Optional

import agent_run_formatting as _fmt
import agent_run_validator as _val
import agent_runs as _runs
import agent_worktree as _wt
import approval_log as _approval
from agent_runtime import get_adapter

# M6-D1: only this adapter may execute. claude_code_local is gated off until D2.
_ALLOWED_DISPATCH_ADAPTERS = ("mock_adapter",)

# in-memory, per-operator confirmation handshake (same pattern as M5-A.5 cancel):
# deliberately NOT persisted — a 2-message handshake, lost on restart, never
# auto-acted. The durable audit is the agent_runs spine + approval_log.
_PENDING_RUNS: dict[str, dict[str, Any]] = {}
_PENDING_TTL_SECONDS = 600  # 10 min


# === pending handshake =======================================================
def reset_pending_runs() -> None:
    """Clear all in-memory pending confirmations (test hygiene / restart)."""
    _PENDING_RUNS.clear()


def _op_key(operator_id: Optional[str]) -> str:
    return str(operator_id) if operator_id is not None else "_anon"


def _set_pending(operator_id: Optional[str], payload: dict[str, Any]) -> None:
    _PENDING_RUNS[_op_key(operator_id)] = payload


def _get_pending(operator_id: Optional[str]) -> Optional[dict[str, Any]]:
    key = _op_key(operator_id)
    pend = _PENDING_RUNS.get(key)
    if not pend:
        return None
    if time.time() - pend.get("created_at", 0) > _PENDING_TTL_SECONDS:
        _PENDING_RUNS.pop(key, None)  # expired -> drop; never auto-run
        return None
    return pend


def _clear_pending(operator_id: Optional[str]) -> None:
    _PENDING_RUNS.pop(_op_key(operator_id), None)


# === helpers =================================================================
def _new_run_id() -> str:
    return f"run_{uuid.uuid4().hex[:12]}"


def _read_prompt(prompt_path: Path) -> Optional[str]:
    try:
        return Path(prompt_path).read_text(encoding="utf-8")
    except OSError:
        return None


def _append(record_kwargs: dict[str, Any], agent_runs_path: Optional[Path]) -> None:
    _runs.append_run(_runs.make_run_record(**record_kwargs), agent_runs_path)


# === propose =================================================================
def propose_agent_run(
    *, operator_id: Optional[str], agent_name: str, stage: str, task_id: str,
    adapter_name: str, prompt_path: Path, mode: str, timeout_s: int,
    repo_root: Optional[Path] = None,
    known_task_ids: Optional[Iterable[str]] = None,
    tasks: Optional[list] = None,
    agent_runs_path: Optional[Path] = None,
    run_id: Optional[str] = None,
) -> dict[str, Any]:
    """Validate + record a proposal and arm a per-operator confirmation.

    Creates NO worktree and executes NO adapter. Returns a formatter-ready dict.
    """
    repo_root = Path(repo_root) if repo_root else _runs.find_repo_root()

    pre = _val.validate_pre_run(
        agent_name=agent_name, stage=stage, task_id=task_id,
        adapter_name=adapter_name, prompt_path=Path(prompt_path), cwd=repo_root,
        timeout_s=timeout_s, mode=mode, repo_root=repo_root,
        known_task_ids=known_task_ids, tasks=tasks)
    if not pre["ok"]:
        # rejected before any run_id is allocated — nothing recorded, no worktree
        return {"ok": False, "outcome": "rejected", "reason": pre["reason"],
                "run_id": None,
                "report": _fmt.format_unavailable(
                    adapter_name=adapter_name,
                    note=f"제안이 거부되었습니다: {pre['reason']}")}

    prompt_text = _read_prompt(prompt_path)
    if prompt_text is None:
        return {"ok": False, "outcome": "rejected", "reason": "prompt_unreadable",
                "run_id": None,
                "report": _fmt.format_unavailable(
                    adapter_name=adapter_name, note="프롬프트 파일을 읽을 수 없습니다.")}

    run_id = run_id or _new_run_id()
    phash = _approval.prompt_hash(prompt_text)

    _append(dict(run_id=run_id, adapter_name=adapter_name, agent_name=agent_name,
                 stage=stage, task_id=task_id, status="proposed", mode=mode,
                 prompt_path=str(prompt_path), cwd=str(repo_root),
                 prompt_hash=phash, timeout_s=timeout_s,
                 operator_id=_op_key(operator_id)), agent_runs_path)

    _set_pending(operator_id, {
        "run_id": run_id, "prompt_hash": phash, "prompt_path": str(prompt_path),
        "adapter_name": adapter_name, "agent_name": agent_name, "stage": stage,
        "task_id": task_id, "mode": mode, "timeout_s": timeout_s,
        "repo_root": str(repo_root), "created_at": time.time(),
    })

    return {"ok": True, "outcome": "proposed", "run_id": run_id,
            "prompt_hash": phash,
            "report": _fmt.format_proposal(adapter_name=adapter_name,
                                           agent_name=agent_name, stage=stage,
                                           task_id=task_id)}


# === confirm =================================================================
def confirm_agent_run(
    operator_id: Optional[str], *,
    repo_root: Optional[Path] = None,
    agent_runs_path: Optional[Path] = None,
    agent_runs_dir: Optional[Path] = None,
    approval_log_path: Optional[Path] = None,
    adapter: Any = None,
    do_run: bool = False,
) -> dict[str, Any]:
    """Consume a pending proposal and run it (M6-D1: mock dry_run only).

    No pending -> no-op (writes nothing). prompt_hash mismatch -> blocked, no run.
    Pending is single-use: cleared the moment it is consumed.
    """
    pend = _get_pending(operator_id)
    if not pend:
        return {"ok": False, "outcome": "no_pending", "run_id": None,
                "report": ("대기 중인 실행 제안이 없습니다. 먼저 제안을 만들어 주세요 "
                           '("진행해"는 직전 제안에만 적용됩니다).')}

    repo_root = Path(repo_root) if repo_root else Path(pend["repo_root"])
    run_id = pend["run_id"]
    base = dict(run_id=run_id, adapter_name=pend["adapter_name"],
                agent_name=pend["agent_name"], stage=pend["stage"],
                task_id=pend["task_id"], mode=pend["mode"],
                prompt_path=pend["prompt_path"], operator_id=_op_key(operator_id))

    # re-verify the prompt has not changed since the proposal (anti-stale).
    current = _read_prompt(pend["prompt_path"])
    if current is None or _approval.prompt_hash(current) != pend["prompt_hash"]:
        _append({**base, "status": "blocked", "prompt_hash": pend["prompt_hash"],
                 "reason": "prompt_hash_mismatch"}, agent_runs_path)
        _clear_pending(operator_id)
        return {"ok": False, "outcome": "blocked", "run_id": run_id,
                "reason": "prompt_hash_mismatch",
                "report": _fmt.format_unavailable(
                    adapter_name=pend["adapter_name"],
                    note="프롬프트가 제안 이후 변경되었습니다. 다시 제안해 주세요 "
                         "(stale prompt blocked).")}

    # operator confirmed -> record intent (spine + durable approval log)
    _append({**base, "status": "approved", "prompt_hash": pend["prompt_hash"]},
            agent_runs_path)
    _approval.append_record(
        _approval.make_record(
            target_slug=pend["task_id"], current_state="agent_run",
            approved_stage=pend["stage"], prompt=current,
            operator_discord_id=_op_key(operator_id),
            execution_mode="manual_record",
            notes=f"agent_run dispatch {run_id} (mock, dry_run)"),
        approval_log_path)

    # single-use: drop the pending BEFORE executing (no double-run on repeat).
    _clear_pending(operator_id)

    return dispatch_agent_run(
        run_id=run_id, agent_name=pend["agent_name"], stage=pend["stage"],
        task_id=pend["task_id"], adapter_name=pend["adapter_name"],
        prompt_path=Path(pend["prompt_path"]), mode=pend["mode"],
        timeout_s=pend["timeout_s"], repo_root=repo_root,
        operator_id=operator_id, agent_runs_path=agent_runs_path,
        agent_runs_dir=agent_runs_dir, adapter=adapter, do_run=do_run)


# === cancel ==================================================================
def cancel_pending_agent_run(
    operator_id: Optional[str], *, agent_runs_path: Optional[Path] = None,
) -> dict[str, Any]:
    """Operator aborts a pending proposal before any execution."""
    pend = _get_pending(operator_id)
    if not pend:
        return {"ok": False, "outcome": "no_pending", "run_id": None,
                "report": "취소할 대기 제안이 없습니다."}
    _append(dict(run_id=pend["run_id"], adapter_name=pend["adapter_name"],
                 agent_name=pend["agent_name"], stage=pend["stage"],
                 task_id=pend["task_id"], status="cancelled", mode=pend["mode"],
                 prompt_path=pend["prompt_path"], prompt_hash=pend["prompt_hash"],
                 operator_id=_op_key(operator_id), reason="operator_cancelled"),
            agent_runs_path)
    _clear_pending(operator_id)
    return {"ok": True, "outcome": "cancelled", "run_id": pend["run_id"],
            "report": f"실행 제안을 취소했습니다 (run_id: `{pend['run_id']}`)."}


# === internal executor =======================================================
def dispatch_agent_run(
    *, run_id: str, agent_name: str, stage: str, task_id: str,
    adapter_name: str, prompt_path: Path, mode: str, timeout_s: int,
    repo_root: Path, operator_id: Optional[str] = None,
    agent_runs_path: Optional[Path] = None,
    agent_runs_dir: Optional[Path] = None,
    adapter: Any = None, do_run: bool = False,
) -> dict[str, Any]:
    """Worktree -> running -> mock dry_run -> post-validate -> terminal record.

    M6-D1: mock_adapter only; dry_run only. Never copies changes back, never
    auto-deletes the worktree.
    """
    import dataclasses

    repo_root = Path(repo_root)
    base = dict(run_id=run_id, adapter_name=adapter_name, agent_name=agent_name,
                stage=stage, task_id=task_id, mode=mode,
                prompt_path=str(prompt_path), operator_id=_op_key(operator_id))

    # M6-D1 adapter gate: claude_code_local (and anything else) is rejected.
    if adapter_name not in _ALLOWED_DISPATCH_ADAPTERS:
        reason = f"adapter_not_allowed_in_m6d1:{adapter_name}"
        _append({**base, "status": "blocked", "reason": reason}, agent_runs_path)
        return {"ok": False, "outcome": "blocked", "run_id": run_id,
                "reason": reason,
                "report": _fmt.format_unavailable(
                    adapter_name=adapter_name,
                    note="M6-D1은 mock_adapter만 실행합니다 (claude_code_local은 "
                         "M6-D2 이후).")}

    adapter = adapter or get_adapter(adapter_name)
    if adapter is None or not adapter.is_available():
        _append({**base, "status": "unavailable", "reason": "adapter_unavailable"},
                agent_runs_path)
        return {"ok": False, "outcome": "unavailable", "run_id": run_id,
                "reason": "adapter_unavailable",
                "report": _fmt.format_unavailable(
                    adapter_name=adapter_name, note="런타임을 사용할 수 없습니다.")}

    # dedicated worktree (created only now, on confirmation). Never auto-removed.
    try:
        worktree = _wt.create_worktree(repo_root, run_id)
    except _wt.WorktreeError as exc:
        _append({**base, "status": "blocked", "reason": f"worktree_failed:{exc}"},
                agent_runs_path)
        return {"ok": False, "outcome": "blocked", "run_id": run_id,
                "reason": "worktree_failed",
                "report": _fmt.format_unavailable(
                    adapter_name=adapter_name, note="worktree 생성 실패.")}

    _append({**base, "status": "running", "cwd": str(worktree),
             "timeout_s": timeout_s}, agent_runs_path)

    run_dir = _runs.run_dir_for(run_id, agent_runs_dir)
    # M6-D1: dry_run ONLY. bounded_edit is deferred to M6-D3 (do_run ignored).
    result = adapter.dry_run(prompt_path, cwd=worktree, timeout_s=timeout_s,
                             run_dir=run_dir)

    summary_text = ""
    if result.summary_path and Path(result.summary_path).exists():
        summary_text = Path(result.summary_path).read_text(encoding="utf-8")

    # post-run validation re-derives safety in Python; it can force `blocked`.
    reason: Optional[str] = None
    if result.status in ("failed", "timed_out"):
        final_status = result.status
        reason = "; ".join(result.safety_notes) or result.status
    else:
        post = _val.validate_post_run(result, stage=stage, repo_root=repo_root,
                                      summary_text=summary_text)
        if not post["ok"]:
            final_status = "blocked"
            reason = post["reason"]
        else:
            final_status = result.status  # "dry_run"

    notes = result.safety_notes + ((reason,) if reason else ())
    final = dataclasses.replace(result, status=final_status, safety_notes=notes)

    _append({**base, "status": final_status, "cwd": str(worktree),
             "stdout_path": final.stdout_path, "stderr_path": final.stderr_path,
             "summary_path": final.summary_path,
             "changed_files": list(final.changed_files),
             "exit_code": final.exit_code, "reason": reason,
             "safety_notes": list(notes)}, agent_runs_path)

    ok = final_status in ("dry_run", "done")
    report = (_fmt.format_success(final, agent_name=agent_name, task_id=task_id)
              if ok else
              _fmt.format_failure(final, agent_name=agent_name, stage=stage,
                                  reason=reason))
    return {"ok": ok, "outcome": final_status, "run_id": run_id,
            "reason": reason, "report": report, "result": final,
            "worktree": str(worktree)}
