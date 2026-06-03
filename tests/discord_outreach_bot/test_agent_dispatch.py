"""M6-D1: agent-run dispatch lifecycle tests.

Hermetic — mock_adapter only, throwaway temp git repos, no real Claude Code, no
network, no ANTHROPIC_API_KEY. Exercises propose -> confirm -> dispatch, the
prompt_hash binding, the append-only spine, post-run blocking, and worktree
non-deletion / no copy-back.
"""

from __future__ import annotations

import subprocess

import pytest

import agent_dispatch as disp
import agent_runs as aruns
import agent_runtime as rt
import approval_log as approval
import agent_worktree as wt
from agent_adapters.mock_adapter import MockAdapter

AGENT = "CandidateResearchAgent"
STAGE = "candidate_shortlist_summary_prompt"
TASK = "task_abc123def456"
OP = "operator_1"


@pytest.fixture(autouse=True)
def _clear_pending():
    disp.reset_pending_runs()
    yield
    disp.reset_pending_runs()


def _git(args, cwd):
    return subprocess.run(["git", "-C", str(cwd), *args],
                          capture_output=True, text=True, check=True)


def _init_repo(path):
    path.mkdir(parents=True, exist_ok=True)
    _git(["init", "-q"], path)
    _git(["config", "user.email", "t@example.com"], path)
    _git(["config", "user.name", "t"], path)
    (path / "seed.txt").write_text("seed\n", encoding="utf-8")
    _git(["add", "seed.txt"], path)
    _git(["commit", "-q", "-m", "seed"], path)
    return path


def _prompt(repo, body="# 후보 요약 프롬프트\n(proposal only)\n"):
    pdir = repo / "ops" / "discord_outreach_bot" / "generated_prompts"
    pdir.mkdir(parents=True, exist_ok=True)
    p = pdir / f"{TASK}__{AGENT}__{STAGE}.md"
    p.write_text(body, encoding="utf-8")
    return p


class _Ctx:
    """Bundle the per-test temp paths."""
    def __init__(self, tmp_path):
        self.repo = _init_repo(tmp_path / "repo")
        self.prompt = _prompt(self.repo)
        self.spine = tmp_path / "agent_runs.jsonl"
        self.runs_dir = tmp_path / "agent_runs"
        self.approval = tmp_path / "approvals.log.jsonl"

    def propose(self, *, adapter_name="mock_adapter", mode="plan", timeout_s=60,
                operator_id=OP):
        return disp.propose_agent_run(
            operator_id=operator_id, agent_name=AGENT, stage=STAGE, task_id=TASK,
            adapter_name=adapter_name, prompt_path=self.prompt, mode=mode,
            timeout_s=timeout_s, repo_root=self.repo, known_task_ids={TASK},
            agent_runs_path=self.spine)

    def confirm(self, *, adapter=None, operator_id=OP):
        return disp.confirm_agent_run(
            operator_id, repo_root=self.repo, agent_runs_path=self.spine,
            agent_runs_dir=self.runs_dir, approval_log_path=self.approval,
            adapter=adapter)

    def statuses(self, run_id=None):
        recs = aruns.read_runs(self.spine)
        if run_id:
            recs = [r for r in recs if r["run_id"] == run_id]
        return [r["status"] for r in recs]


@pytest.fixture
def ctx(tmp_path):
    return _Ctx(tmp_path)


# === lifecycle vocabulary ====================================================
def test_lifecycle_statuses_superset_of_runtime():
    assert set(rt.RUNTIME_STATUSES).issubset(set(rt.LIFECYCLE_STATUSES))
    for extra in ("proposed", "approved", "cancelled"):
        assert extra in rt.LIFECYCLE_STATUSES
        assert extra not in rt.RUNTIME_STATUSES


# === propose =================================================================
def test_propose_records_proposed_no_worktree_no_execution(ctx):
    out = ctx.propose()
    assert out["ok"] and out["outcome"] == "proposed" and out["run_id"]
    assert ctx.statuses() == ["proposed"]
    # no worktree created at proposal time
    assert not (ctx.repo / wt.WORKTREE_BASE / out["run_id"]).exists()
    # no run_dir / adapter artifacts
    assert not (ctx.runs_dir / out["run_id"]).exists()
    # pending armed
    assert disp._get_pending(OP)["run_id"] == out["run_id"]


def test_invalid_pre_run_rejected_no_worktree(ctx):
    out = ctx.propose(timeout_s=999999)  # exceeds MAX_TIMEOUT_S
    assert out["ok"] is False and out["outcome"] == "rejected"
    assert ctx.statuses() == []          # nothing recorded
    assert disp._get_pending(OP) is None
    assert not (ctx.repo / wt.WORKTREE_BASE).exists()


def test_propose_unreadable_prompt_rejected(ctx):
    ctx.prompt.unlink()
    out = ctx.propose()
    assert out["outcome"] == "rejected" and out["reason"] == "prompt_unreadable"
    assert ctx.statuses() == []


# === confirm happy path ======================================================
def test_confirm_happy_path_records_lifecycle(ctx):
    p = ctx.propose()
    out = ctx.confirm()
    assert out["ok"] and out["outcome"] == "dry_run"
    assert ctx.statuses(p["run_id"]) == [
        "proposed", "approved", "running", "dry_run"]
    # worktree created and NOT auto-deleted
    assert (ctx.repo / wt.WORKTREE_BASE / p["run_id"]).is_dir()
    # report is the success/preview form
    assert "dry_run" in out["report"]


def test_confirm_appends_approval_log(ctx):
    p = ctx.propose()
    ctx.confirm()
    recs = approval.read_records(ctx.approval)
    assert len(recs) == 1
    assert recs[0]["prompt_hash"] == p["prompt_hash"]
    assert recs[0]["approved_stage"] == STAGE


# === prompt_hash binding =====================================================
def test_prompt_hash_mismatch_blocks_no_execution(ctx):
    p = ctx.propose()
    ctx.prompt.write_text("# TAMPERED\n", encoding="utf-8")  # change after propose
    out = ctx.confirm()
    assert out["outcome"] == "blocked" and out["reason"] == "prompt_hash_mismatch"
    # blocked recorded, but never ran (no running/dry_run)
    assert ctx.statuses(p["run_id"]) == ["proposed", "blocked"]
    assert not (ctx.runs_dir / p["run_id"]).exists()
    assert not (ctx.repo / wt.WORKTREE_BASE / p["run_id"]).exists()


# === pending semantics =======================================================
def test_no_pending_confirm_writes_nothing(ctx):
    out = ctx.confirm()
    assert out["outcome"] == "no_pending"
    assert ctx.statuses() == []


def test_duplicate_confirm_is_noop(ctx):
    p = ctx.propose()
    first = ctx.confirm()
    assert first["ok"]
    before = len(aruns.read_runs(ctx.spine))
    second = ctx.confirm()
    assert second["outcome"] == "no_pending"
    assert len(aruns.read_runs(ctx.spine)) == before  # nothing new written
    assert ctx.statuses(p["run_id"]).count("dry_run") == 1  # ran exactly once


def test_cancel_pending_records_cancelled(ctx):
    p = ctx.propose()
    out = disp.cancel_pending_agent_run(OP, agent_runs_path=ctx.spine)
    assert out["outcome"] == "cancelled"
    assert ctx.statuses(p["run_id"]) == ["proposed", "cancelled"]
    assert disp._get_pending(OP) is None
    # a subsequent confirm finds no pending
    assert ctx.confirm()["outcome"] == "no_pending"


# === post-run validation forces blocked ======================================
def test_post_run_violation_forces_blocked(ctx):
    p = ctx.propose()
    bad = MockAdapter(dry_run_changed_files=("src/voc/secret.py",))
    out = ctx.confirm(adapter=bad)
    assert out["outcome"] == "blocked"
    assert out["reason"].startswith("changed_file_outside_allowed_paths")
    assert ctx.statuses(p["run_id"]) == [
        "proposed", "approved", "running", "blocked"]
    # worktree preserved for forensics
    assert (ctx.repo / wt.WORKTREE_BASE / p["run_id"]).is_dir()


# === adapter dry_run failure/timeout statuses map to records/reports =========
class _FakeDryAdapter:
    """Adapter whose dry_run returns a configurable terminal status, to exercise
    dispatch's status mapping (D1 only ever calls dry_run)."""
    name = "mock_adapter"

    def __init__(self, status):
        self._status = status

    def is_available(self):
        return True

    def dry_run(self, prompt_path, *, cwd, timeout_s, run_dir):
        from pathlib import Path as _P
        _P(run_dir).mkdir(parents=True, exist_ok=True)
        return rt.AgentRunResult(
            run_id=_P(run_dir).name, adapter_name="mock_adapter",
            status=self._status, prompt_path=str(prompt_path), cwd=str(cwd),
            safety_notes=(f"adapter reported {self._status}",))


@pytest.mark.parametrize("status", ["failed", "timed_out"])
def test_dispatch_maps_adapter_failure_status(ctx, status):
    p = ctx.propose()
    out = ctx.confirm(adapter=_FakeDryAdapter(status))
    assert out["outcome"] == status and out["ok"] is False
    assert ctx.statuses(p["run_id"]) == ["proposed", "approved", "running", status]
    assert out["report"].startswith("⚠ Agent run blocked/failed")


# === claude_code_local rejected in dispatch ==================================
def test_claude_code_local_rejected_in_dispatch(ctx):
    p = ctx.propose(adapter_name="claude_code_local")
    assert p["ok"]  # pre-run allows it (registered adapter)
    out = ctx.confirm()
    assert out["outcome"] == "blocked"
    assert out["reason"].startswith("adapter_not_allowed_in_m6d1")
    assert ctx.statuses(p["run_id"]) == ["proposed", "approved", "blocked"]
    # never created a worktree or run_dir
    assert not (ctx.repo / wt.WORKTREE_BASE / p["run_id"]).exists()


# === spine / no copy-back ====================================================
def test_spine_append_only_and_fold(ctx):
    p = ctx.propose()
    ctx.confirm()
    all_recs = aruns.read_runs(ctx.spine)
    assert len(all_recs) == 4  # append-only: every transition retained
    folded = aruns.fold_runs_by_run_id(ctx.spine)
    assert folded[p["run_id"]]["status"] == "dry_run"  # last wins


def test_no_copy_back_to_repo_root(ctx):
    p = ctx.propose()
    out = ctx.confirm()
    # artifacts live under the runs_dir, not the repo root
    assert (ctx.runs_dir / p["run_id"]).exists()
    assert not (ctx.repo / "summary.md").exists()
    assert not (ctx.repo / "result.json").exists()
    # the worktree (under .agent_worktrees) is the only repo-side dir touched
    assert out["worktree"].endswith(p["run_id"])


# === safety / hermetic =======================================================
def test_no_api_key_required(monkeypatch, ctx):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    ctx.propose()
    out = ctx.confirm()
    assert out["ok"] and out["outcome"] == "dry_run"


def test_dispatch_module_no_subprocess_or_anthropic():
    import ast
    from pathlib import Path
    tree = ast.parse(Path(disp.__file__).read_text(encoding="utf-8"))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                imported.add(a.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    assert "subprocess" not in imported
    assert "anthropic" not in imported
