"""M6-D4: Discord NL wiring tests for the agent dispatch lifecycle.

Hermetic — mock_adapter only, throwaway temp git repos, no real Claude Code, no
ANTHROPIC_API_KEY. Verifies deterministic phrase routing, pending-state gating
(esp. that "진행해" falls through when no agent run is pending), and that broad
NL never proposes/confirms.
"""

from __future__ import annotations

import subprocess

import pytest

import agent_discord_adapter as ad
import agent_dispatch as disp
import agent_runs as aruns
import agent_worktree as wt
from agent_adapters.mock_adapter import MockAdapter

AGENT = "CandidateResearchAgent"
STAGE = "candidate_shortlist_summary_prompt"
TASK = "task_abc123def456"
OP = "op1"
ALLOWED_DRAFT = "ops/discord_outreach_bot/generated_prompts/draft.md"


@pytest.fixture(autouse=True)
def _clear():
    disp.reset_pending_runs()
    yield
    disp.reset_pending_runs()


def _git(a, c):
    return subprocess.run(["git", "-C", str(c), *a], capture_output=True,
                          text=True, check=True)


def _repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(["init", "-q"], repo)
    _git(["config", "user.email", "t@e.com"], repo)
    _git(["config", "user.name", "t"], repo)
    (repo / "seed.txt").write_text("seed\n", encoding="utf-8")
    _git(["add", "seed.txt"], repo)
    _git(["commit", "-q", "-m", "s"], repo)
    pdir = repo / "ops" / "discord_outreach_bot" / "generated_prompts"
    pdir.mkdir(parents=True)
    (pdir / f"{TASK}__{AGENT}__{STAGE}.md").write_text("# p\n", encoding="utf-8")
    return repo, pdir


class _Ctx:
    def __init__(self, tmp_path):
        self.repo, self.pdir = _repo(tmp_path)
        self.spine = tmp_path / "spine.jsonl"
        self.runs = tmp_path / "runs"
        self.appr = tmp_path / "appr.jsonl"

    def handle(self, text, *, adapter=None):
        return ad.try_handle(
            text, operator_discord_id=OP, repo_root=self.repo,
            agent_runs_path=self.spine, agent_runs_dir=self.runs,
            approval_log_path=self.appr, generated_prompts_dir=self.pdir,
            known_task_ids={TASK}, adapter=adapter)

    def arm_run(self, *, adapter_name="mock_adapter"):
        return disp.propose_agent_run(
            operator_id=OP, agent_name=AGENT, stage=STAGE, task_id=TASK,
            adapter_name=adapter_name, prompt_path=self.pdir
            / f"{TASK}__{AGENT}__{STAGE}.md", mode="plan", timeout_s=60,
            repo_root=self.repo, known_task_ids={TASK}, agent_runs_path=self.spine)

    def confirm_dry(self, adapter):
        return disp.confirm_agent_run(
            OP, repo_root=self.repo, agent_runs_path=self.spine,
            agent_runs_dir=self.runs, approval_log_path=self.appr, adapter=adapter)


@pytest.fixture
def ctx(tmp_path):
    return _Ctx(tmp_path)


# === fall-through (None) =====================================================
def test_unrelated_text_returns_none(ctx):
    assert ctx.handle("다음 후보군이 뭐지?") is None
    assert ctx.handle("task_x 만들어줘") is None


def test_jinhaehae_no_pending_falls_through(ctx):
    # critical: "진행해" with no agent run pending MUST fall through (None) so the
    # existing M5-A.5 cancel-confirm keeps working.
    assert ctx.handle("진행해") is None


def test_broad_nl_does_not_propose(ctx):
    assert ctx.handle("이 작업 에이전트로 검토해줘") is None
    assert ctx.handle("에이전트 한번 돌려봐") is None


def test_cancel_no_agent_pending_falls_through(ctx):
    assert ctx.handle("취소") is None


# === run confirmation ========================================================
def test_jinhaehae_with_run_pending_confirms_dry_run(ctx):
    ctx.arm_run()
    out = ctx.handle("진행해", adapter=MockAdapter())
    assert out is not None and out["handled"]
    assert out["intent"] == "agent_dry_run"
    assert "dry_run" in out["reply"]
    # pending consumed -> a second "진행해" falls through again
    assert ctx.handle("진행해") is None


# === edit confirmation =======================================================
def test_edit_jinhaehae_with_edit_pending_confirms_bounded_edit(ctx):
    ctx.arm_run()
    ctx.confirm_dry(MockAdapter())            # arms edit-pending (eligible stage)
    assert disp._get_pending_edit(OP) is not None
    out = ctx.handle("편집 진행해", adapter=MockAdapter(changed_files=(ALLOWED_DRAFT,)))
    assert out["intent"] == "agent_bounded_edit"
    assert "done" in out["reply"] or "완료" in out["reply"]


def test_edit_jinhaehae_no_pending_is_noop(ctx):
    out = ctx.handle("편집 진행해")
    assert out is not None and out["intent"] == "agent_edit_no_pending"
    assert "편집" in out["reply"]


# === cancel ==================================================================
def test_cancel_with_run_pending_cancels(ctx):
    ctx.arm_run()
    out = ctx.handle("취소")
    assert out["intent"] == "agent_cancel"
    assert disp._get_pending(OP) is None


# === propose =================================================================
def test_explicit_propose(ctx):
    out = ctx.handle(f"에이전트 제안 {TASK} {STAGE}")
    assert out["intent"] == "agent_propose"
    assert disp._get_pending(OP) is not None  # run-pending armed
    assert TASK in out["reply"] or "진행" in out["reply"]


def test_propose_missing_prompt_file(ctx):
    (ctx.pdir / f"{TASK}__{AGENT}__{STAGE}.md").unlink()
    out = ctx.handle(f"에이전트 제안 {TASK} {STAGE}")
    assert out["intent"] == "agent_propose"
    assert "프롬프트 파일이 없습니다" in out["reply"]
    assert disp._get_pending(OP) is None


def test_propose_unknown_stage(ctx):
    out = ctx.handle(f"에이전트 제안 {TASK} render_pdf_prompt")
    assert out["intent"] == "agent_propose"
    assert "stage" in out["reply"]


# === cleanup =================================================================
def test_cleanup_with_run_id(ctx):
    ctx.arm_run()
    p = ctx.handle("진행해", adapter=MockAdapter())  # creates worktree via dry_run
    run_id = [r for r in aruns.read_runs(ctx.spine)][-1]["run_id"]
    assert (ctx.repo / wt.WORKTREE_BASE / run_id).is_dir()
    out = ctx.handle(f"cleanup {run_id}")
    assert out["intent"] == "agent_cleanup" and "제거됨" in out["reply"]
    assert not (ctx.repo / wt.WORKTREE_BASE / run_id).exists()
    assert p is not None  # silence unused


def test_bare_cleanup_lists_only(ctx):
    ctx.arm_run()
    ctx.handle("진행해", adapter=MockAdapter())
    out = ctx.handle("worktree 정리")
    assert out["intent"] == "agent_cleanup_list"
    # nothing deleted
    run_id = [r for r in aruns.read_runs(ctx.spine)][-1]["run_id"]
    assert (ctx.repo / wt.WORKTREE_BASE / run_id).is_dir()


# === status (read-only) ======================================================
def test_status_is_read_only(ctx):
    ctx.arm_run()
    before = len(aruns.read_runs(ctx.spine))
    out = ctx.handle("에이전트 상태")
    assert out["intent"] == "agent_status"
    assert "에이전트 상태" in out["reply"]
    assert len(aruns.read_runs(ctx.spine)) == before  # no writes


# === capture_diff includes untracked new files ===============================
def test_capture_diff_includes_untracked_file(tmp_path):
    repo, _ = _repo(tmp_path)
    worktree = wt.create_worktree(repo, "run_diff")
    (worktree / "ops" / "discord_outreach_bot" / "generated_prompts").mkdir(
        parents=True, exist_ok=True)
    (worktree / "ops" / "discord_outreach_bot" / "generated_prompts"
     / "new.md").write_text("HELLO_NEW_FILE\n", encoding="utf-8")
    diff = wt.capture_diff(worktree)
    assert "HELLO_NEW_FILE" in diff      # untracked new file now appears in diff
    assert "new.md" in diff


# === reports are concise Korean ==============================================
def test_reports_are_korean(ctx):
    ctx.arm_run()
    out = ctx.handle("진행해", adapter=MockAdapter())
    assert any(0xAC00 <= ord(ch) <= 0xD7A3 for ch in out["reply"])  # has Hangul
