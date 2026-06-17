"""M6-D1: agent-run dispatch lifecycle tests.

Hermetic — mock_adapter only, throwaway temp git repos, no real Claude Code, no
network, no ANTHROPIC_API_KEY. Exercises propose -> confirm -> dispatch, the
prompt_hash binding, the append-only spine, post-run blocking, and worktree
non-deletion / no copy-back.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

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

    def confirm(self, *, adapter=None, operator_id=OP, do_run=False):
        return disp.confirm_agent_run(
            operator_id, repo_root=self.repo, agent_runs_path=self.spine,
            agent_runs_dir=self.runs_dir, approval_log_path=self.approval,
            adapter=adapter, do_run=do_run)

    def confirm_edit(self, *, adapter=None, operator_id=OP):
        return disp.confirm_bounded_edit_run(
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


# === M6-D2: claude_code_local dry_run allowed (plan), edits rejected =========
import agent_adapters.claude_code_local as ccl  # noqa: E402


def _fake_claude_popen(*, stdout='{"result": "plan ok"}', returncode=0):
    """A FakePopen for the real ClaudeCodeLocalAdapter, capturing argv/stdin."""
    rec: dict = {"called": False}

    class _FP:
        def __init__(self, argv, **kwargs):
            rec["called"] = True
            rec["argv"] = argv
            rec["kwargs"] = kwargs
            self.pid = 4242
            self.returncode = None

        def communicate(self, input=None, timeout=None):
            rec["input"] = input
            self.returncode = returncode
            return stdout, ""

        def kill(self):
            rec["killed"] = True

    return _FP, rec


def test_claude_code_local_dry_run_allowed_plan_mode(ctx, monkeypatch):
    # real ClaudeCodeLocalAdapter via the registry, but FAKE subprocess (no claude)
    monkeypatch.setattr(ccl, "which", lambda _b: "/bin/claude")
    fp, rec = _fake_claude_popen()
    monkeypatch.setattr(ccl, "_Popen", fp)

    p = ctx.propose(adapter_name="claude_code_local", mode="plan")
    out = ctx.confirm()  # no injected adapter -> registry claude_code_local
    assert out["outcome"] == "dry_run" and out["ok"]
    assert ctx.statuses(p["run_id"]) == [
        "proposed", "approved", "running", "dry_run"]
    # exact dry_run argv shape, via the dispatch path
    argv = rec["argv"]
    assert argv[0] == "claude" and "-p" in argv
    assert argv[argv.index("--permission-mode") + 1] == "plan"
    assert argv[argv.index("--output-format") + 1] == "json"
    assert "--add-dir" in argv
    assert "--no-session-persistence" in argv and "--disable-slash-commands" in argv
    assert "--bare" not in argv
    assert "acceptEdits" not in argv          # never the edit mode
    assert rec["input"] == ctx.prompt.read_text(encoding="utf-8")  # prompt via stdin
    assert rec["kwargs"]["stdin"] is __import__("subprocess").PIPE
    assert rec["kwargs"].get("shell", False) is False
    assert rec["kwargs"]["start_new_session"] is True
    # artifacts captured, worktree preserved
    assert (ctx.runs_dir / p["run_id"] / "stdout.log").exists()
    assert (ctx.repo / wt.WORKTREE_BASE / p["run_id"]).is_dir()


def test_claude_code_local_bounded_edit_rejected(ctx, monkeypatch):
    # guard against any accidental real claude invocation
    fp, rec = _fake_claude_popen()
    monkeypatch.setattr(ccl, "_Popen", fp)
    monkeypatch.setattr(ccl, "which", lambda _b: "/bin/claude")
    p = ctx.propose(adapter_name="claude_code_local", mode="bounded_edit")
    assert p["ok"]  # pre-run allows bounded_edit as a valid mode
    out = ctx.confirm()
    assert out["outcome"] == "blocked"
    # first-phase bounded_edit (no edit path) is refused
    assert out["reason"].startswith("bounded_edit_requires_edit_path")
    assert ctx.statuses(p["run_id"]) == ["proposed", "approved", "blocked"]
    assert rec["called"] is False  # adapter never invoked
    assert not (ctx.repo / wt.WORKTREE_BASE / p["run_id"]).exists()


def test_claude_code_local_do_run_rejected(ctx, monkeypatch):
    fp, rec = _fake_claude_popen()
    monkeypatch.setattr(ccl, "_Popen", fp)
    monkeypatch.setattr(ccl, "which", lambda _b: "/bin/claude")
    p = ctx.propose(adapter_name="claude_code_local", mode="plan")
    out = ctx.confirm(do_run=True)  # do_run requested -> refused even in plan
    assert out["outcome"] == "blocked"
    assert out["reason"].startswith("dry_run_only")
    assert rec["called"] is False
    assert not (ctx.repo / wt.WORKTREE_BASE / p["run_id"]).exists()


def test_dispatch_never_calls_run_for_claude(ctx, monkeypatch):
    # if dispatch ever called adapter.run() it would raise here.
    monkeypatch.setattr(ccl, "which", lambda _b: "/bin/claude")
    fp, _ = _fake_claude_popen()
    monkeypatch.setattr(ccl, "_Popen", fp)
    real = ccl.ClaudeCodeLocalAdapter()

    def _boom(*a, **k):
        raise AssertionError("adapter.run() must not be called in M6-D2")

    monkeypatch.setattr(real, "run", _boom)
    ctx.propose(adapter_name="claude_code_local", mode="plan")
    out = ctx.confirm(adapter=real)
    assert out["outcome"] == "dry_run"


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


# === M6-D3: bounded_edit after clean dry_run + second confirmation ===========
ALLOWED_DRAFT = "ops/discord_outreach_bot/generated_prompts/draft.md"


class _TrackMock(MockAdapter):
    """MockAdapter that counts dry_run vs run calls (same instance reused)."""
    def __init__(self, **kw):
        super().__init__(**kw)
        self.dry_calls = 0
        self.run_calls = 0

    def dry_run(self, *a, **k):
        self.dry_calls += 1
        return super().dry_run(*a, **k)

    def run(self, *a, **k):
        self.run_calls += 1
        return super().run(*a, **k)


def test_clean_dry_run_arms_edit_pending(ctx):
    p = ctx.propose()  # stage candidate_shortlist_summary_prompt (edit-eligible)
    out = ctx.confirm()
    assert out["outcome"] == "dry_run"
    assert out.get("edit_pending") is True
    assert "편집 진행해" in out["report"]
    assert disp._get_pending_edit(OP)["run_id"] == p["run_id"]


def test_non_eligible_stage_no_edit_pending(ctx, tmp_path):
    # CorpusReviewAgent/corpus_review_prompt is a valid runtime stage but NOT
    # in ALLOWED_BOUNDED_EDIT_STAGES.
    pdir = ctx.repo / "ops" / "discord_outreach_bot" / "generated_prompts"
    pr = pdir / "corpus.md"
    pr.write_text("# corpus prompt\n", encoding="utf-8")
    out = disp.propose_agent_run(
        operator_id=OP, agent_name="CorpusReviewAgent", stage="corpus_review_prompt",
        task_id=TASK, adapter_name="mock_adapter", prompt_path=pr, mode="plan",
        timeout_s=60, repo_root=ctx.repo, known_task_ids={TASK},
        agent_runs_path=ctx.spine)
    assert out["ok"]
    res = ctx.confirm()
    assert res["outcome"] == "dry_run"
    assert res.get("edit_pending") is not True
    assert "편집 진행해" not in res["report"]
    assert disp._get_pending_edit(OP) is None


def test_edit_no_pending_is_noop(ctx):
    out = ctx.confirm_edit()
    assert out["outcome"] == "no_pending"
    assert aruns.read_runs(ctx.spine) == []


def test_edit_prompt_hash_mismatch_blocks(ctx):
    p = ctx.propose()
    track = _TrackMock()
    ctx.confirm(adapter=track)            # dry_run arms edit-pending
    ctx.prompt.write_text("# TAMPERED\n", encoding="utf-8")
    out = ctx.confirm_edit(adapter=track)
    assert out["outcome"] == "blocked" and out["reason"] == "prompt_hash_mismatch"
    assert track.run_calls == 0           # never executed an edit
    assert ctx.statuses(p["run_id"]) == ["proposed", "approved", "running",
                                         "dry_run", "blocked"]


def test_bounded_edit_happy_allowed_path(ctx):
    track = _TrackMock(changed_files=(ALLOWED_DRAFT,))
    p = ctx.propose()
    ctx.confirm(adapter=track)
    assert track.dry_calls == 1 and track.run_calls == 0  # run not called yet
    out = ctx.confirm_edit(adapter=track)
    assert out["outcome"] == "done" and out["ok"]
    assert track.run_calls == 1                            # run only in edit path
    assert ctx.statuses(p["run_id"]) == [
        "proposed", "approved", "running", "dry_run",
        "approved", "running", "done"]
    # reused the dry_run worktree (would raise worktree_exists if recreated)
    assert out["worktree"].endswith(p["run_id"])
    assert (ctx.repo / wt.WORKTREE_BASE / p["run_id"]).is_dir()


def test_duplicate_second_confirm_is_noop(ctx):
    track = _TrackMock(changed_files=(ALLOWED_DRAFT,))
    ctx.propose()
    ctx.confirm(adapter=track)
    first = ctx.confirm_edit(adapter=track)
    assert first["outcome"] == "done"
    before = len(aruns.read_runs(ctx.spine))
    second = ctx.confirm_edit(adapter=track)
    assert second["outcome"] == "no_pending"
    assert len(aruns.read_runs(ctx.spine)) == before  # nothing new


def test_bounded_edit_unsafe_src_blocked(ctx):
    track = _TrackMock(changed_files=("src/voc/secret.py",))
    p = ctx.propose()
    ctx.confirm(adapter=track)
    out = ctx.confirm_edit(adapter=track)
    assert out["outcome"] == "blocked"
    assert out["reason"].startswith("changed_file_outside_allowed_paths")
    assert (ctx.repo / wt.WORKTREE_BASE / p["run_id"]).is_dir()  # preserved


def test_bounded_edit_packet_file_blocked(ctx):
    track = _TrackMock(changed_files=("outputs/outreach/x/status.json",))
    ctx.propose()
    ctx.confirm(adapter=track)
    out = ctx.confirm_edit(adapter=track)
    assert out["outcome"] == "blocked"
    assert out["reason"].startswith("packet_file_mutation")


def test_no_copy_back_after_edit(ctx):
    track = _TrackMock(changed_files=(ALLOWED_DRAFT,))
    ctx.propose()
    ctx.confirm(adapter=track)
    ctx.confirm_edit(adapter=track)
    # the draft exists only as a declared change; nothing copied to repo root
    assert not (ctx.repo / "draft.md").exists()
    assert not (ctx.repo / ALLOWED_DRAFT).exists()  # not promoted to live repo


def test_cleanup_run_removes_worktree(ctx):
    p = ctx.propose()
    ctx.confirm()
    wtp = ctx.repo / wt.WORKTREE_BASE / p["run_id"]
    assert wtp.is_dir()
    out = disp.cleanup_run(p["run_id"], repo_root=ctx.repo)
    assert out["worktree_removed"] is True
    assert not wtp.exists()


def test_stage_not_edit_eligible_refused_in_dispatch(ctx):
    # directly invoke the edit dispatch path with a non-eligible stage
    wtp = wt.create_worktree(ctx.repo, "run_x")
    out = disp.dispatch_agent_run(
        run_id="run_x", agent_name="CorpusReviewAgent", stage="corpus_review_prompt",
        task_id=TASK, adapter_name="mock_adapter", prompt_path=ctx.prompt,
        mode="bounded_edit", timeout_s=60, repo_root=ctx.repo,
        agent_runs_path=ctx.spine, agent_runs_dir=ctx.runs_dir,
        adapter=MockAdapter(), do_run=True, existing_worktree=wtp)
    assert out["outcome"] == "blocked"
    assert out["reason"].startswith("stage_not_edit_eligible")


# === cost_usd capture ========================================================
def test_read_cost_usd_helper(tmp_path):
    rd = tmp_path / "rd"
    rd.mkdir()
    assert disp._read_cost_usd(rd) is None  # absent
    (rd / "claude_output.json").write_text(
        '{"total_cost_usd": 0.0215, "result": "OK"}', encoding="utf-8")
    assert disp._read_cost_usd(rd) == 0.0215


def test_cost_usd_recorded_when_present(ctx, monkeypatch):
    # claude_code_local edit path with a FakePopen that writes claude_output.json
    # (with cost) AND an allowed-prefix file in the worktree.
    monkeypatch.setattr(ccl, "which", lambda _b: "/bin/claude")
    cost_json = '{"type":"result","result":"done","total_cost_usd":0.0312}'

    def make_writer():
        rec = {}

        class _FP:
            def __init__(self, argv, **kw):
                rec["argv"] = argv
                rec["kw"] = kw
                self.pid = 1
                self.returncode = None

            def communicate(self, input=None, timeout=None):
                cwd = Path(rec["kw"]["cwd"])
                # only the edit (acceptEdits) run writes a file
                if "acceptEdits" in rec["argv"]:
                    fp = cwd / "ops" / "discord_outreach_bot" / "generated_prompts"
                    fp.mkdir(parents=True, exist_ok=True)
                    (fp / "draft.md").write_text("draft\n", encoding="utf-8")
                self.returncode = 0
                return cost_json, ""

            def kill(self):
                pass
        return _FP
    monkeypatch.setattr(ccl, "_Popen", make_writer())

    p = ctx.propose(adapter_name="claude_code_local", mode="plan")
    ctx.confirm()                       # claude dry_run (plan) -> arms edit pending
    out = ctx.confirm_edit()            # claude bounded_edit (acceptEdits)
    assert out["outcome"] == "done"
    assert out["cost_usd"] == 0.0312
    assert "ops/discord_outreach_bot/generated_prompts/draft.md" in out["result"].changed_files
    # recorded on the spine terminal record
    term = [r for r in aruns.read_runs(ctx.spine)
            if r["run_id"] == p["run_id"]][-1]
    assert term["cost_usd"] == 0.0312 and term["status"] == "done"


# === optional gated live bounded_edit smoke (skipped by default) =============
@pytest.mark.skipif(
    __import__("os").environ.get("RUN_LIVE_CLAUDE_CODE_EDIT_TEST") != "1",
    reason="live Claude Code bounded_edit smoke disabled "
           "(set RUN_LIVE_CLAUDE_CODE_EDIT_TEST=1)")
def test_live_claude_bounded_edit_smoke(ctx):
    """Live: dry_run then a single bounded_edit in a temp worktree. NOT default."""
    ctx.prompt.write_text(
        "Create a file ops/discord_outreach_bot/generated_prompts/ok.md "
        "containing the word OK.", encoding="utf-8")
    if not ccl.ClaudeCodeLocalAdapter().is_available():
        pytest.skip("claude binary not available")
    ctx.propose(adapter_name="claude_code_local", mode="plan")
    ctx.confirm()
    out = ctx.confirm_edit()
    assert out["outcome"] in ("done", "blocked", "failed", "timed_out")


# === optional gated live dry_run smoke (skipped by default) ==================
@pytest.mark.skipif(
    __import__("os").environ.get("RUN_LIVE_CLAUDE_CODE_DRY_RUN_TEST") != "1",
    reason="live Claude Code dry_run smoke disabled "
           "(set RUN_LIVE_CLAUDE_CODE_DRY_RUN_TEST=1)")
def test_live_claude_dry_run_smoke(ctx):
    """Trivial, plan-mode, short-timeout live dry_run through the lifecycle.

    Temp worktree only; no project task; no repo mutation expected. NOT run by
    default and never invoked during M6-D2 implementation/CI.
    """
    ctx.prompt.write_text("Return only the word OK.", encoding="utf-8")
    if not ccl.ClaudeCodeLocalAdapter().is_available():
        pytest.skip("claude binary not available")
    p = disp.propose_agent_run(
        operator_id=OP, agent_name=AGENT, stage=STAGE, task_id=TASK,
        adapter_name="claude_code_local", prompt_path=ctx.prompt, mode="plan",
        timeout_s=60, repo_root=ctx.repo, known_task_ids={TASK},
        agent_runs_path=ctx.spine)
    out = ctx.confirm()
    assert out["outcome"] in ("dry_run", "failed", "timed_out")
    # plan mode must not have changed repo files in the worktree
    assert wt.list_changed_files(ctx.repo / wt.WORKTREE_BASE / p["run_id"]) == ()


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
