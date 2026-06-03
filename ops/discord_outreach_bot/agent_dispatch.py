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

import json
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

# mock_adapter + claude_code_local may execute. Plan-mode dry_run is the default;
# bounded_edit is allowed ONLY via the M6-D3 second-confirm edit path (see the
# bounded_edit gate in dispatch_agent_run) and only for the stages below.
_ALLOWED_DISPATCH_ADAPTERS = ("mock_adapter", "claude_code_local")

# M6-D3: stages for which a clean dry_run may be followed by a bounded_edit.
# Strictly narrower than agent_run_validator.ALLOWED_RUNTIME_STAGES. The first
# allowed stage writes a draft into generated_prompts/ — never a packet file.
ALLOWED_BOUNDED_EDIT_STAGES = frozenset({"candidate_shortlist_summary_prompt"})

# in-memory, per-operator confirmation handshakes (same pattern as M5-A.5 cancel):
# deliberately NOT persisted — lost on restart, never auto-acted. The durable
# audit is the agent_runs spine + approval_log.
#   _PENDING_RUNS  : first confirmation ("진행해")      -> dry_run
#   _PENDING_EDITS : second confirmation ("편집 진행해") -> bounded_edit (M6-D3)
_PENDING_RUNS: dict[str, dict[str, Any]] = {}
_PENDING_EDITS: dict[str, dict[str, Any]] = {}
_PENDING_TTL_SECONDS = 600  # 10 min


# === pending handshake =======================================================
def reset_pending_runs() -> None:
    """Clear all in-memory pending confirmations (test hygiene / restart)."""
    _PENDING_RUNS.clear()
    _PENDING_EDITS.clear()


# M6-D4 will alias this from the Discord layer; kept explicit for symmetry.
reset_pending_edits = reset_pending_runs


def _op_key(operator_id: Optional[str]) -> str:
    return str(operator_id) if operator_id is not None else "_anon"


def _ttl_get(store: dict[str, dict[str, Any]], operator_id: Optional[str]
             ) -> Optional[dict[str, Any]]:
    key = _op_key(operator_id)
    pend = store.get(key)
    if not pend:
        return None
    if time.time() - pend.get("created_at", 0) > _PENDING_TTL_SECONDS:
        store.pop(key, None)  # expired -> drop; never auto-run
        return None
    return pend


def _set_pending(operator_id: Optional[str], payload: dict[str, Any]) -> None:
    _PENDING_RUNS[_op_key(operator_id)] = payload


def _get_pending(operator_id: Optional[str]) -> Optional[dict[str, Any]]:
    return _ttl_get(_PENDING_RUNS, operator_id)


def _clear_pending(operator_id: Optional[str]) -> None:
    _PENDING_RUNS.pop(_op_key(operator_id), None)


def _set_pending_edit(operator_id: Optional[str], payload: dict[str, Any]) -> None:
    _PENDING_EDITS[_op_key(operator_id)] = payload


def _get_pending_edit(operator_id: Optional[str]) -> Optional[dict[str, Any]]:
    return _ttl_get(_PENDING_EDITS, operator_id)


def _clear_pending_edit(operator_id: Optional[str]) -> None:
    _PENDING_EDITS.pop(_op_key(operator_id), None)


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

    result = dispatch_agent_run(
        run_id=run_id, agent_name=pend["agent_name"], stage=pend["stage"],
        task_id=pend["task_id"], adapter_name=pend["adapter_name"],
        prompt_path=Path(pend["prompt_path"]), mode=pend["mode"],
        timeout_s=pend["timeout_s"], repo_root=repo_root,
        operator_id=operator_id, agent_runs_path=agent_runs_path,
        agent_runs_dir=agent_runs_dir, adapter=adapter, do_run=do_run)

    # M6-D3: a CLEAN dry_run on an edit-eligible stage arms the SECOND
    # confirmation. No edit happens here — the operator must say "편집 진행해".
    if (result.get("outcome") == "dry_run"
            and pend["stage"] in ALLOWED_BOUNDED_EDIT_STAGES
            and result.get("worktree")):
        _set_pending_edit(operator_id, {
            "run_id": run_id, "worktree": result["worktree"],
            "prompt_hash": pend["prompt_hash"], "prompt_path": pend["prompt_path"],
            "stage": pend["stage"], "agent_name": pend["agent_name"],
            "task_id": pend["task_id"], "adapter_name": pend["adapter_name"],
            "timeout_s": pend["timeout_s"], "repo_root": str(repo_root),
            "created_at": time.time(),
        })
        result = {**result, "edit_pending": True,
                  "report": result["report"]
                  + "\n\n편집(worktree 내)을 적용하려면 \"편집 진행해\" / "
                    "끝내려면 \"취소\"."}
    return result


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


# === M6-D3: second confirmation -> bounded_edit ==============================
def _last_status(run_id: str, agent_runs_path: Optional[Path]) -> Optional[str]:
    recs = [r for r in _runs.read_runs(agent_runs_path)
            if r.get("run_id") == run_id]
    return recs[-1]["status"] if recs else None


def confirm_bounded_edit_run(
    operator_id: Optional[str], *,
    repo_root: Optional[Path] = None,
    agent_runs_path: Optional[Path] = None,
    agent_runs_dir: Optional[Path] = None,
    approval_log_path: Optional[Path] = None,
    adapter: Any = None,
) -> dict[str, Any]:
    """Second confirmation ("편집 진행해"): apply a bounded_edit in the dry_run's
    worktree. Requires an armed edit-pending, an unchanged prompt, and a clean
    prior dry_run for the run. Single-use; never copies back; worktree preserved.
    """
    edit = _get_pending_edit(operator_id)
    if not edit:
        return {"ok": False, "outcome": "no_pending", "run_id": None,
                "report": ('대기 중인 편집 제안이 없습니다. 먼저 dry_run을 실행하고 '
                           '깨끗하면 "편집 진행해"로 적용하세요.')}

    repo_root = Path(repo_root) if repo_root else Path(edit["repo_root"])
    run_id = edit["run_id"]
    base = dict(run_id=run_id, adapter_name=edit["adapter_name"],
                agent_name=edit["agent_name"], stage=edit["stage"],
                task_id=edit["task_id"], mode="bounded_edit",
                prompt_path=edit["prompt_path"], operator_id=_op_key(operator_id))

    # anti-stale: prompt must be byte-identical to the proposal.
    current = _read_prompt(edit["prompt_path"])
    if current is None or _approval.prompt_hash(current) != edit["prompt_hash"]:
        _append({**base, "status": "blocked", "prompt_hash": edit["prompt_hash"],
                 "reason": "prompt_hash_mismatch"}, agent_runs_path)
        _clear_pending_edit(operator_id)
        return {"ok": False, "outcome": "blocked", "run_id": run_id,
                "reason": "prompt_hash_mismatch",
                "report": _fmt.format_unavailable(
                    adapter_name=edit["adapter_name"],
                    note="프롬프트가 변경되었습니다. 편집을 차단했습니다.")}

    # spine guard: bounded_edit only right after a CLEAN dry_run; never twice.
    if _last_status(run_id, agent_runs_path) != "dry_run":
        _clear_pending_edit(operator_id)
        return {"ok": False, "outcome": "blocked", "run_id": run_id,
                "reason": "no_clean_dry_run_or_already_edited",
                "report": _fmt.format_unavailable(
                    adapter_name=edit["adapter_name"],
                    note="깨끗한 dry_run 직후에만 편집할 수 있습니다 (재편집 불가).")}

    _append({**base, "status": "approved", "prompt_hash": edit["prompt_hash"]},
            agent_runs_path)
    _approval.append_record(
        _approval.make_record(
            target_slug=edit["task_id"], current_state="agent_run_bounded_edit",
            approved_stage=edit["stage"], prompt=current,
            operator_discord_id=_op_key(operator_id),
            execution_mode="manual_record",
            notes=f"bounded_edit {run_id} (worktree only, no copy-back)"),
        approval_log_path)

    # single-use: drop BEFORE executing.
    _clear_pending_edit(operator_id)

    return dispatch_agent_run(
        run_id=run_id, agent_name=edit["agent_name"], stage=edit["stage"],
        task_id=edit["task_id"], adapter_name=edit["adapter_name"],
        prompt_path=Path(edit["prompt_path"]), mode="bounded_edit",
        timeout_s=edit["timeout_s"], repo_root=repo_root, operator_id=operator_id,
        agent_runs_path=agent_runs_path, agent_runs_dir=agent_runs_dir,
        adapter=adapter, do_run=True, existing_worktree=Path(edit["worktree"]))


# === explicit worktree cleanup (NOT auto, NOT Discord-wired) =================
def cleanup_run(run_id: str, *, repo_root: Path,
                agent_runs_path: Optional[Path] = None) -> dict[str, Any]:
    """Explicitly remove a run's worktree. Never called automatically; the spine
    + run_dir artifacts are retained (this only frees the checkout)."""
    removed = _wt.remove_worktree(Path(repo_root), run_id)
    return {"ok": removed, "run_id": run_id, "worktree_removed": removed}


# === internal executor =======================================================
def dispatch_agent_run(
    *, run_id: str, agent_name: str, stage: str, task_id: str,
    adapter_name: str, prompt_path: Path, mode: str, timeout_s: int,
    repo_root: Path, operator_id: Optional[str] = None,
    agent_runs_path: Optional[Path] = None,
    agent_runs_dir: Optional[Path] = None,
    adapter: Any = None, do_run: bool = False,
    existing_worktree: Optional[Path] = None,
) -> dict[str, Any]:
    """Worktree -> running -> (dry_run | bounded_edit) -> post-validate -> record.

    Two paths:
      - plan (default): create a fresh worktree, call adapter.dry_run.
      - bounded_edit (M6-D3): ONLY via confirm_bounded_edit_run, which supplies
        do_run=True + existing_worktree + an edit-eligible stage. Reuses the
        dry_run worktree and calls adapter.run (acceptEdits, confined to it).
    Never copies changes back; never auto-deletes the worktree.
    """
    import dataclasses

    repo_root = Path(repo_root)
    is_edit = mode == "bounded_edit"
    base = dict(run_id=run_id, adapter_name=adapter_name, agent_name=agent_name,
                stage=stage, task_id=task_id, mode=mode,
                prompt_path=str(prompt_path), operator_id=_op_key(operator_id))

    def _block(reason, note):
        _append({**base, "status": "blocked", "reason": reason}, agent_runs_path)
        return {"ok": False, "outcome": "blocked", "run_id": run_id,
                "reason": reason,
                "report": _fmt.format_unavailable(adapter_name=adapter_name,
                                                  note=note)}

    # adapter allowlist gate.
    if adapter_name not in _ALLOWED_DISPATCH_ADAPTERS:
        return _block(f"adapter_not_allowed:{adapter_name}",
                      "이 어댑터는 dispatch에서 허용되지 않습니다.")

    # mode gate.
    if is_edit:
        # bounded_edit is allowed ONLY through the second-confirm edit path:
        # do_run + an existing worktree + an edit-eligible stage. A first-phase
        # bounded_edit (no existing_worktree) is refused exactly as before.
        if not (do_run and existing_worktree is not None):
            return _block("bounded_edit_requires_edit_path",
                          "bounded_edit는 dry_run 후 2차 확인으로만 가능합니다.")
        if stage not in ALLOWED_BOUNDED_EDIT_STAGES:
            return _block(f"stage_not_edit_eligible:{stage}",
                          "이 stage는 편집이 허용되지 않습니다.")
    elif mode != "plan" or do_run:
        return _block(f"dry_run_only:mode={mode},do_run={do_run}",
                      "plan(dry_run)만 허용됩니다.")

    adapter = adapter or get_adapter(adapter_name)
    if adapter is None or not adapter.is_available():
        _append({**base, "status": "unavailable", "reason": "adapter_unavailable"},
                agent_runs_path)
        return {"ok": False, "outcome": "unavailable", "run_id": run_id,
                "reason": "adapter_unavailable",
                "report": _fmt.format_unavailable(
                    adapter_name=adapter_name, note="런타임을 사용할 수 없습니다.")}

    # worktree: reuse the dry_run's for an edit; otherwise create a fresh one.
    if is_edit:
        worktree = Path(existing_worktree)
        if not worktree.exists():
            return _block("worktree_missing", "편집 대상 worktree가 없습니다.")
    else:
        try:
            worktree = _wt.create_worktree(repo_root, run_id)
        except _wt.WorktreeError as exc:
            return _block(f"worktree_failed:{exc}", "worktree 생성 실패.")

    _append({**base, "status": "running", "cwd": str(worktree),
             "timeout_s": timeout_s}, agent_runs_path)

    # artifacts: dry_run -> runs/<run_id>; bounded_edit -> runs/<run_id>/edit
    # (so the edit never clobbers the preserved dry_run artifacts).
    run_dir = _runs.run_dir_for(run_id, agent_runs_dir)
    exec_dir = (run_dir / "edit") if is_edit else run_dir

    if is_edit:
        result = adapter.run(prompt_path, cwd=worktree, timeout_s=timeout_s,
                             mode="bounded_edit", run_dir=exec_dir)
    else:
        result = adapter.dry_run(prompt_path, cwd=worktree, timeout_s=timeout_s,
                                 run_dir=exec_dir)

    summary_text = ""
    if result.summary_path and Path(result.summary_path).exists():
        summary_text = Path(result.summary_path).read_text(encoding="utf-8")

    # post-run validation re-derives safety in Python; it can force `blocked`.
    reason: Optional[str] = None
    if result.status in ("failed", "timed_out", "blocked", "unavailable"):
        final_status = result.status
        reason = "; ".join(result.safety_notes) or result.status
    else:
        post = _val.validate_post_run(result, stage=stage, repo_root=repo_root,
                                      summary_text=summary_text)
        if not post["ok"]:
            final_status = "blocked"
            reason = post["reason"]
        else:
            final_status = result.status  # "dry_run" or "done"

    cost_usd = _read_cost_usd(exec_dir)
    notes = result.safety_notes + ((reason,) if reason else ())
    final = dataclasses.replace(result, status=final_status, safety_notes=notes,
                                run_id=run_id)

    _append({**base, "status": final_status, "cwd": str(worktree),
             "stdout_path": final.stdout_path, "stderr_path": final.stderr_path,
             "summary_path": final.summary_path,
             "changed_files": list(final.changed_files),
             "exit_code": final.exit_code, "reason": reason,
             "cost_usd": cost_usd, "safety_notes": list(notes)}, agent_runs_path)

    ok = final_status in ("dry_run", "done")
    report = (_fmt.format_success(final, agent_name=agent_name, task_id=task_id)
              if ok else
              _fmt.format_failure(final, agent_name=agent_name, stage=stage,
                                  reason=reason))
    report = _augment_report(report, final, exec_dir, cost_usd, is_edit)
    return {"ok": ok, "outcome": final_status, "run_id": run_id,
            "reason": reason, "report": report, "result": final,
            "worktree": str(worktree), "cost_usd": cost_usd}


def _read_cost_usd(run_dir: Path) -> Optional[float]:
    """Best-effort: pull total_cost_usd from claude_output.json. None if absent."""
    f = Path(run_dir) / "claude_output.json"
    if not f.exists():
        return None
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    cost = data.get("total_cost_usd") if isinstance(data, dict) else None
    return cost if isinstance(cost, (int, float)) else None


def _augment_report(report: str, final: Any, run_dir: Path,
                    cost_usd: Optional[float], is_edit: bool) -> str:
    """Append changed-file list, diff path, and cost to a bounded_edit report."""
    extra: list[str] = []
    if is_edit and final.changed_files:
        extra.append("- 변경 파일:")
        extra.extend(f"  - `{cf}`" for cf in final.changed_files)
        diff = Path(run_dir) / "diff.patch"
        if diff.exists():
            extra.append(f"- diff: `{diff}`")
        extra.append("- (worktree 내 변경, 자동 반영 안 함 / cleanup은 명시적)")
    if cost_usd is not None:
        extra.append(f"- cost_usd: {cost_usd}")
    return report + ("\n" + "\n".join(extra) if extra else "")
