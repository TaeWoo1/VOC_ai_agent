"""M6-B: runtime safety validator for agent runs (SELF — security-critical).

Pure, side-effect-free gate. It NEVER runs a process, reads no env, writes
nothing, and imports none of: task_runner, task_inputs, subprocess, socket,
requests, urllib, anthropic. Callers pass already-loaded task ids so the
validator does no I/O.

Two phases, mirroring the M6-A "recompute in Python, never trust the model" rule:

  validate_pre_run(...)  — BEFORE any adapter is touched. Allowlists agent / stage
    / adapter, grounds task_id, and contains cwd + prompt_path to approved
    directories (resolved; no `..` escape). Reject -> the run never starts.

  validate_post_run(...) — AFTER the adapter returns. Confirms every changed file
    is under the stage's allowed write paths and that no summary/stdout claims an
    external action (send / collection / PDF render / Instagram publish / git
    commit-push) happened. Any violation forces status `blocked`.

Outcomes:
  pre-run :  "valid" | "rejected"
  post-run:  "valid" | "blocked"
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable, Optional

from agent_registry import AGENTS as _AGENTS
from agent_runtime import ADAPTERS as _ADAPTERS
from agent_runtime import RUN_MODES

# --- M6-B allowlists ---------------------------------------------------------
# Runtime stages permitted in M6-B/M6-C. All are *prompt / reason / draft* stages;
# none performs an external effect. Each maps to the agent base-stage it belongs
# to (for the "stage in agent's allowed stages" check).
ALLOWED_RUNTIME_STAGES = frozenset({
    "candidate_shortlist_summary_prompt",
    "collect_plan_prompt",
    "corpus_review_prompt",
    "angle_select_prompt",
    "packet_revision_prompt",
    "code_review_prompt",
})
RUNTIME_STAGE_TO_AGENT_STAGE = {
    "candidate_shortlist_summary_prompt": "candidate_shortlist_pick",
    "collect_plan_prompt": "collect_plan",
    "corpus_review_prompt": "corpus_review",
    "angle_select_prompt": "angle_select",
    "packet_revision_prompt": "packet_revision",
    "code_review_prompt": "code_review",
}

MAX_TIMEOUT_S = 900  # 15 min hard ceiling; callers may set lower

# prompt artifacts may live only here (relative to repo root)
_PROMPT_DIRS = (
    "ops/discord_outreach_bot/generated_prompts",
    "ops/discord_outreach_bot/agent_runs/prompts",
)
# the per-run worktree base; cwd must be repo root OR under this
_WORKTREE_BASE = ".agent_worktrees"
# changed files may only land under these prefixes (drafts + run artifacts).
# Packet folders, src/, scripts/, configs/ etc. are NOT writable by M6-B stages.
_ALLOWED_CHANGED_PREFIXES = (
    "ops/discord_outreach_bot/generated_prompts/",
    "ops/discord_outreach_bot/agent_runs/",
)
# never allowed regardless of prefix (defense in depth)
_DENY_BASENAMES = ("status.json", "send_log.md")

# external-action claims: if a summary/stdout asserts one of these HAPPENED, the
# result is blocked (M6-B stages never do these). Korean + English markers.
_EXTERNAL_CLAIM_MARKERS = (
    "발송했", "발송 완료", "메일을 보냈", "전송 완료", "이메일을 보냈",
    "수집했", "수집 완료", "크롤링했", "크롤링 완료",
    "pdf를 생성했", "pdf 렌더", "렌더링 완료", "리포트를 출력했",
    "인스타그램에 게시", "게시 완료", "업로드 완료", "포스팅했",
    "git push", "git commit", "커밋했", "푸시했", "푸시 완료",
    "sent the email", "emails sent", "collection complete", "crawled",
    "rendered the pdf", "pdf rendered", "published to instagram",
    "pushed to", "committed and pushed",
)

VALID = "valid"
REJECTED = "rejected"
BLOCKED = "blocked"


def _result(outcome: str, reason: Optional[str], **extra: Any) -> dict[str, Any]:
    return {"ok": outcome == VALID, "outcome": outcome, "reason": reason, **extra}


def _resolve_under(path: Path, base: Path) -> bool:
    """True iff `path` resolves to `base` or somewhere inside it (no `..` escape)."""
    try:
        rp = path.resolve()
        rb = base.resolve()
    except (OSError, RuntimeError):
        return False
    return rp == rb or rp.is_relative_to(rb)


def validate_pre_run(*, agent_name: str, stage: str, task_id: str,
                     adapter_name: str, prompt_path: Path, cwd: Path,
                     timeout_s: int, mode: str, repo_root: Path,
                     known_task_ids: Optional[Iterable[str]] = None,
                     tasks: Optional[list] = None,
                     known_adapters: Optional[Iterable[str]] = None
                     ) -> dict[str, Any]:
    """Validate a run request BEFORE any adapter call. Returns
    {ok, outcome(valid|rejected), reason}."""
    repo_root = Path(repo_root)

    # adapter must be allowlisted
    adapters = set(known_adapters) if known_adapters is not None else set(_ADAPTERS)
    if adapter_name not in adapters:
        return _result(REJECTED, f"unknown_adapter:{adapter_name}")

    # agent must be registered
    if agent_name not in _AGENTS:
        return _result(REJECTED, f"unknown_agent:{agent_name}")

    # stage must be an allowed runtime stage AND within the agent's scope
    if stage not in ALLOWED_RUNTIME_STAGES:
        return _result(REJECTED, f"disallowed_stage:{stage}")
    base_stage = RUNTIME_STAGE_TO_AGENT_STAGE.get(stage)
    if base_stage and base_stage not in _AGENTS[agent_name].allowed_stages:
        return _result(REJECTED, f"stage_not_in_agent_scope:{stage}")

    # task must exist
    ids = set(known_task_ids) if known_task_ids is not None else {
        t.task_id for t in (tasks or [])}
    if task_id not in ids:
        return _result(REJECTED, f"unknown_task_id:{task_id}")

    # mode + timeout
    if mode not in RUN_MODES:
        return _result(REJECTED, f"bad_mode:{mode}")
    if not isinstance(timeout_s, int) or timeout_s <= 0:
        return _result(REJECTED, "bad_timeout")
    if timeout_s > MAX_TIMEOUT_S:
        return _result(REJECTED, f"timeout_exceeds_max:{timeout_s}>{MAX_TIMEOUT_S}")

    # prompt_path must live inside an approved prompt dir (no escape)
    if not any(_resolve_under(Path(prompt_path), repo_root / d) for d in _PROMPT_DIRS):
        return _result(REJECTED, "prompt_path_outside_allowed_dir")

    # cwd must be repo root or an approved worktree under .agent_worktrees/
    cwd_p = Path(cwd)
    if not (_resolve_under(cwd_p, repo_root)
            and (cwd_p.resolve() == repo_root.resolve()
                 or _resolve_under(cwd_p, repo_root / _WORKTREE_BASE))):
        return _result(REJECTED, "cwd_outside_repo_or_worktree")

    return _result(VALID, None, base_stage=base_stage)


def _claims_external_action(text: str) -> Optional[str]:
    low = (text or "").lower()
    raw = text or ""
    for marker in _EXTERNAL_CLAIM_MARKERS:
        if marker.isascii():
            if marker.lower() in low:
                return marker
        elif marker in raw:
            return marker
    return None


def _changed_file_violation(rel_or_abs: str, repo_root: Path) -> Optional[str]:
    """Return a reason if this changed file is outside the allowed write paths."""
    p = Path(rel_or_abs)
    if p.is_absolute():
        rp = p.resolve()
        rr = repo_root.resolve()
        if not (rp == rr or rp.is_relative_to(rr)):
            return f"changed_file_outside_repo:{rel_or_abs}"
        rel = str(rp.relative_to(rr))
    else:
        # normalize and reject any traversal
        if ".." in p.parts:
            return f"changed_file_path_escape:{rel_or_abs}"
        rel = p.as_posix()
    if Path(rel).name in _DENY_BASENAMES:
        return f"packet_file_mutation:{rel}"
    if not any(rel.startswith(prefix) for prefix in _ALLOWED_CHANGED_PREFIXES):
        return f"changed_file_outside_allowed_paths:{rel}"
    return None


def validate_post_run(result: Any, *, stage: str, repo_root: Path,
                      summary_text: Optional[str] = None) -> dict[str, Any]:
    """Validate an adapter's AgentRunResult AFTER it returns. Returns
    {ok, outcome(valid|blocked), reason}. Any violation -> blocked."""
    repo_root = Path(repo_root)
    changed = getattr(result, "changed_files", None)
    if changed is None and isinstance(result, dict):
        changed = result.get("changed_files")
    changed = tuple(changed or ())

    for cf in changed:
        reason = _changed_file_violation(cf, repo_root)
        if reason:
            return _result(BLOCKED, reason)

    # scan the run summary (and any provided text) for external-action claims
    summary = summary_text or ""
    if not summary and isinstance(result, dict):
        summary = result.get("summary_text", "") or ""
    claim = _claims_external_action(summary)
    if claim:
        return _result(BLOCKED, f"external_action_claimed:{claim}")

    return _result(VALID, None)
