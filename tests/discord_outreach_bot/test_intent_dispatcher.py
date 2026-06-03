"""D4-2: intent -> action dispatcher tests.

Hermetic — validated intents are built directly via agent_intents.validate (no
live planner), executed against mock_adapter + throwaway git repos. Asserts the
D4-2 allowlist executes via the existing dispatch functions, that
collect/render/send/publish stay report-only, and that bounded_edit is NEVER
reachable through a planner intent.
"""

from __future__ import annotations

import json
import subprocess

import pytest

import agent_dispatch as disp
import agent_intents as ai
import agent_runs as aruns
import agent_worktree as wt
import intent_dispatcher as idp
import intent_planner as ip
from agent_adapters.mock_adapter import MockAdapter

AGENT = "CandidateResearchAgent"
STAGE = "candidate_shortlist_summary_prompt"
TASK = "task_abc123def456"
OP = "op1"


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

    def dispatch(self, intent, targets=None, *, adapter=None):
        v = ai.validate({"intent": intent, "targets": targets or {}})
        return idp.dispatch_intent(
            v, operator_discord_id=OP, repo_root=self.repo,
            agent_runs_path=self.spine, agent_runs_dir=self.runs,
            approval_log_path=self.appr, generated_prompts_dir=self.pdir,
            known_task_ids={TASK}, adapter=adapter)

    def arm_run(self):
        return disp.propose_agent_run(
            operator_id=OP, agent_name=AGENT, stage=STAGE, task_id=TASK,
            adapter_name="mock_adapter",
            prompt_path=self.pdir / f"{TASK}__{AGENT}__{STAGE}.md", mode="plan",
            timeout_s=60, repo_root=self.repo, known_task_ids={TASK},
            agent_runs_path=self.spine)


@pytest.fixture
def ctx(tmp_path):
    return _Ctx(tmp_path)


# === green: read-only ========================================================
def test_ask_status_read_only(ctx):
    before = len(aruns.read_runs(ctx.spine))
    out = ctx.dispatch("ask_status")
    assert out["executed"] is True and out["intent"] == "intent_ask_status"
    assert len(aruns.read_runs(ctx.spine)) == before  # no writes


def test_summarize_state_read_only(ctx):
    out = ctx.dispatch("summarize_state")
    assert out["intent"] == "intent_summarize_state"
    assert aruns.read_runs(ctx.spine) == []


# === propose arms pending only (no run) ======================================
def test_propose_arms_pending_no_run(ctx):
    out = ctx.dispatch("propose_agent_run", {"task_id": TASK, "stage": STAGE})
    assert out["executed"] is True
    assert disp._get_pending(OP) is not None          # pending armed
    statuses = [r["status"] for r in aruns.read_runs(ctx.spine)]
    assert statuses == ["proposed"]                    # proposed only, no run
    assert not (ctx.repo / wt.WORKTREE_BASE).exists()  # no worktree


# === confirm -> dry_run only when run-pending exists =========================
def test_confirm_runs_dry_run_when_pending(ctx):
    ctx.arm_run()
    out = ctx.dispatch("confirm_pending", adapter=MockAdapter())
    assert out["executed"] is True and out["intent"] == "intent_confirm"
    statuses = [r["status"] for r in aruns.read_runs(ctx.spine)]
    assert statuses == ["proposed", "approved", "running", "dry_run"]


def test_confirm_no_pending_clarifies(ctx):
    out = ctx.dispatch("confirm_pending", adapter=MockAdapter())
    assert out["executed"] is False
    assert "대기 중인 실행 제안이 없습니다" in out["reply"]
    assert aruns.read_runs(ctx.spine) == []


def test_confirm_with_edit_pending_never_bounded_edits(ctx):
    # arm + dry_run -> edit-pending armed, run-pending consumed
    ctx.arm_run()
    ctx.dispatch("confirm_pending", adapter=MockAdapter())
    assert disp._get_pending(OP) is None and disp._get_pending_edit(OP) is not None
    n = len(aruns.read_runs(ctx.spine))
    out = ctx.dispatch("confirm_pending", adapter=MockAdapter())
    assert out["executed"] is False
    assert "편집 진행해" in out["reply"]                 # must be explicit
    assert disp._get_pending_edit(OP) is not None        # edit pending untouched
    assert len(aruns.read_runs(ctx.spine)) == n          # no bounded_edit ran


# === cancel ==================================================================
def test_cancel_only_if_pending(ctx):
    assert ctx.dispatch("cancel_pending")["executed"] is False
    ctx.arm_run()
    out = ctx.dispatch("cancel_pending")
    assert out["executed"] is True and disp._get_pending(OP) is None


# === cleanup requires explicit run_id ========================================
def test_cleanup_requires_run_id(ctx):
    # validator forces clarify when run_id missing -> dispatcher reports, no exec
    out = ctx.dispatch("cleanup_worktree", {})
    assert out["executed"] is False and out["intent"] == "intent_clarify"


def test_cleanup_with_run_id_removes_worktree(ctx):
    ctx.arm_run()
    ctx.dispatch("confirm_pending", adapter=MockAdapter())
    run_id = [r for r in aruns.read_runs(ctx.spine)][-1]["run_id"]
    assert (ctx.repo / wt.WORKTREE_BASE / run_id).is_dir()
    out = ctx.dispatch("cleanup_worktree", {"run_id": run_id})
    assert out["executed"] is True
    assert not (ctx.repo / wt.WORKTREE_BASE / run_id).exists()


# === report-only intents =====================================================
@pytest.mark.parametrize("intent,targets", [
    ("collect_reviews", {"target": "A1"}),
    ("render_report", {"task_id": TASK}),
])
def test_collect_render_report_only(ctx, intent, targets):
    out = ctx.dispatch(intent, targets)
    assert out["executed"] is False
    assert "아직 실행 안 함" in out["reply"]
    assert aruns.read_runs(ctx.spine) == []  # no side effect


@pytest.mark.parametrize("intent,targets", [
    ("send_outreach", {"task_id": TASK}),
    ("publish_post", {"target": "ig_1"}),
])
def test_send_publish_report_only_red(ctx, intent, targets):
    out = ctx.dispatch(intent, targets)
    assert out["executed"] is False
    assert "최종 명시 승인" in out["reply"]


# === bounded_edit unreachable via planner intent =============================
def test_dispatcher_never_calls_bounded_edit():
    # AST check: no attribute named confirm_bounded_edit_run is referenced in
    # code (the name appears only in the module docstring, explaining the rule).
    import ast
    import inspect
    tree = ast.parse(inspect.getsource(idp))
    attrs = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    assert "confirm_bounded_edit_run" not in attrs
    # and no intent in the schema maps to an edit action
    assert "apply_edit" not in ai.INTENTS and "bounded_edit" not in ai.INTENTS


# === plan_and_act integration ================================================
def test_plan_and_act_inert_without_responder():
    assert ip.plan_and_act("진행해") is None


def test_plan_and_act_routes_to_dispatcher(ctx):
    ctx.arm_run()

    def responder(_m):
        return json.dumps({"intent": "confirm_pending", "targets": {},
                           "rationale": "ok", "confidence": 0.9})
    out = ip.plan_and_act(
        "응 진행해", operator_discord_id=OP, repo_root=ctx.repo,
        agent_runs_path=ctx.spine, agent_runs_dir=ctx.runs,
        approval_log_path=ctx.appr, generated_prompts_dir=ctx.pdir,
        known_task_ids={TASK}, adapter=MockAdapter(), responder=responder)
    assert out["executed"] is True and out["intent"] == "intent_confirm"


def test_plan_and_act_collect_is_report_only(ctx):
    def responder(_m):
        return json.dumps({"intent": "collect_reviews", "targets": {"target": "A1"},
                           "rationale": "수집", "confidence": 0.8})
    out = ip.plan_and_act(
        "리뷰 모아줘", operator_discord_id=OP, repo_root=ctx.repo,
        agent_runs_path=ctx.spine, agent_runs_dir=ctx.runs,
        generated_prompts_dir=ctx.pdir, responder=responder)
    assert out["executed"] is False
    assert aruns.read_runs(ctx.spine) == []
