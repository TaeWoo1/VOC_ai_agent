"""M6-B agent runtime scaffold tests.

Hermetic: uses the mock adapter only — no subprocess, no network, no real Claude
Code, no ANTHROPIC_API_KEY. Covers the runtime framework, the append-only spine,
the pre/post safety validator, adapter behavior, report formatting, and the
import boundary.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

import agent_run_formatting as fmt
import agent_run_validator as val
import agent_runs as aruns
import agent_runtime as rt
from agent_adapters.claude_code_local import ClaudeCodeLocalAdapter
from agent_adapters.mock_adapter import MockAdapter

AGENT = "CandidateResearchAgent"
STAGE = "candidate_shortlist_summary_prompt"
TASK = "task_abc123def456"


def _repo(tmp_path):
    """A fake repo root with the allowed prompt dir present."""
    pdir = tmp_path / "ops" / "discord_outreach_bot" / "generated_prompts"
    pdir.mkdir(parents=True, exist_ok=True)
    return tmp_path, pdir


def _prompt(pdir, body=""):
    p = pdir / f"{TASK}__{AGENT}__{STAGE}.md"
    p.write_text(body or "# 후보 요약 프롬프트\n(proposal only)\n", encoding="utf-8")
    return p


def _pre(**over):
    """validate_pre_run with sensible valid defaults; override per test."""
    base = dict(agent_name=AGENT, stage=STAGE, task_id=TASK,
                adapter_name="mock_adapter", mode="plan", timeout_s=60,
                known_task_ids={TASK})
    base.update(over)
    return val.validate_pre_run(**base)


# === framework ===============================================================
def test_runtime_statuses_and_result_roundtrip():
    assert set(rt.RUNTIME_STATUSES) == {
        "unavailable", "dry_run", "running", "done", "failed", "timed_out", "blocked"}
    r = rt.AgentRunResult(run_id="run_1", adapter_name="mock_adapter", status="done",
                          prompt_path="p.md", cwd="/repo", changed_files=("a.md",))
    r.validate()
    assert rt.AgentRunResult.from_record(r.to_record()) == r


def test_registry_has_allowlisted_adapters():
    assert set(rt.ADAPTERS) == {"mock_adapter", "claude_code_local"}
    assert rt.get_adapter("ghost") is None


def test_dispatch_agent_run_is_scaffold_only(tmp_path):
    with pytest.raises(NotImplementedError):
        rt.dispatch_agent_run(
            agent_name=AGENT, stage=STAGE, task_id=TASK, adapter_name="mock_adapter",
            prompt_path=tmp_path / "p.md", cwd=tmp_path, timeout_s=60, mode="plan",
            store_path=tmp_path / "tasks.jsonl")


# === append-only spine =======================================================
def test_spine_append_read_fold(tmp_path):
    spine = tmp_path / "agent_runs.jsonl"
    assert aruns.read_runs(spine) == []  # absent -> []
    rec1 = aruns.make_run_record(run_id="run_1", adapter_name="mock_adapter",
                                 agent_name=AGENT, stage=STAGE, task_id=TASK,
                                 status="dry_run")
    aruns.append_run(rec1, spine)
    rec2 = aruns.make_run_record(run_id="run_1", adapter_name="mock_adapter",
                                 agent_name=AGENT, stage=STAGE, task_id=TASK,
                                 status="done")
    aruns.append_run(rec2, spine)
    assert len(aruns.read_runs(spine)) == 2          # append-only: both kept
    folded = aruns.fold_runs_by_run_id(spine)
    assert folded["run_1"]["status"] == "done"        # last wins
    assert aruns.get_run("run_1", spine)["status"] == "done"


def test_make_run_record_rejects_bad_status():
    with pytest.raises(ValueError):
        aruns.make_run_record(run_id="r", adapter_name="mock_adapter",
                              agent_name=AGENT, stage=STAGE, task_id=TASK,
                              status="explode")


# === pre-run validator =======================================================
def test_pre_run_valid(tmp_path):
    repo, pdir = _repo(tmp_path)
    res = _pre(prompt_path=_prompt(pdir), cwd=repo, repo_root=repo)
    assert res["ok"] is True and res["outcome"] == val.VALID


def test_unknown_adapter_rejected(tmp_path):
    repo, pdir = _repo(tmp_path)
    res = _pre(adapter_name="ghost_adapter", prompt_path=_prompt(pdir),
               cwd=repo, repo_root=repo)
    assert res["outcome"] == val.REJECTED and res["reason"].startswith("unknown_adapter")


def test_unknown_agent_rejected(tmp_path):
    repo, pdir = _repo(tmp_path)
    res = _pre(agent_name="GhostAgent", prompt_path=_prompt(pdir),
               cwd=repo, repo_root=repo)
    assert res["outcome"] == val.REJECTED and res["reason"].startswith("unknown_agent")


def test_disallowed_stage_rejected(tmp_path):
    repo, pdir = _repo(tmp_path)
    res = _pre(stage="render_pdf_prompt", prompt_path=_prompt(pdir),
               cwd=repo, repo_root=repo)
    assert res["outcome"] == val.REJECTED and res["reason"].startswith("disallowed_stage")


def test_stage_outside_agent_scope_rejected(tmp_path):
    repo, pdir = _repo(tmp_path)
    # collect_plan_prompt is a real runtime stage but not in CandidateResearchAgent
    res = _pre(stage="collect_plan_prompt", prompt_path=_prompt(pdir),
               cwd=repo, repo_root=repo)
    assert res["outcome"] == val.REJECTED
    assert res["reason"].startswith("stage_not_in_agent_scope")


def test_unknown_task_id_rejected(tmp_path):
    repo, pdir = _repo(tmp_path)
    res = _pre(task_id="task_nope", prompt_path=_prompt(pdir), cwd=repo,
               repo_root=repo, known_task_ids={TASK})
    assert res["outcome"] == val.REJECTED and res["reason"].startswith("unknown_task_id")


def test_prompt_path_outside_allowed_dir_rejected(tmp_path):
    repo, _pdir = _repo(tmp_path)
    bad = repo / "somewhere" / "evil.md"
    bad.parent.mkdir(parents=True, exist_ok=True)
    bad.write_text("x", encoding="utf-8")
    res = _pre(prompt_path=bad, cwd=repo, repo_root=repo)
    assert res["outcome"] == val.REJECTED and res["reason"] == "prompt_path_outside_allowed_dir"


def test_prompt_path_escape_rejected(tmp_path):
    repo, pdir = _repo(tmp_path)
    res = _pre(prompt_path=pdir / ".." / ".." / ".." / "etc_passwd.md",
               cwd=repo, repo_root=repo)
    assert res["outcome"] == val.REJECTED


def test_cwd_outside_repo_rejected(tmp_path):
    repo, pdir = _repo(tmp_path)
    res = _pre(prompt_path=_prompt(pdir), cwd=tmp_path.parent, repo_root=repo)
    assert res["outcome"] == val.REJECTED and res["reason"] == "cwd_outside_repo_or_worktree"


def test_cwd_in_worktree_accepted(tmp_path):
    repo, pdir = _repo(tmp_path)
    wt = repo / ".agent_worktrees" / "run_xyz"
    wt.mkdir(parents=True, exist_ok=True)
    res = _pre(prompt_path=_prompt(pdir), cwd=wt, repo_root=repo)
    assert res["ok"] is True


def test_timeout_over_max_rejected(tmp_path):
    repo, pdir = _repo(tmp_path)
    res = _pre(prompt_path=_prompt(pdir), cwd=repo, repo_root=repo,
               timeout_s=val.MAX_TIMEOUT_S + 1)
    assert res["outcome"] == val.REJECTED and res["reason"].startswith("timeout_exceeds_max")


def test_bad_mode_rejected(tmp_path):
    repo, pdir = _repo(tmp_path)
    res = _pre(prompt_path=_prompt(pdir), cwd=repo, repo_root=repo, mode="yolo")
    assert res["outcome"] == val.REJECTED and res["reason"].startswith("bad_mode")


# === mock adapter behavior ===================================================
def test_mock_adapter_captures_stdout_summary(tmp_path):
    repo, pdir = _repo(tmp_path)
    run_dir = aruns.run_dir_for("run_done", tmp_path / "agent_runs")
    res = MockAdapter().run(_prompt(pdir), cwd=repo, timeout_s=60, mode="plan",
                            run_dir=run_dir)
    assert res.status == "done"
    assert Path(res.stdout_path).read_text(encoding="utf-8")
    assert Path(res.summary_path).read_text(encoding="utf-8")
    assert (run_dir / "result.json").exists()


def test_mock_adapter_failure_writes_stderr(tmp_path):
    repo, pdir = _repo(tmp_path)
    run_dir = tmp_path / "agent_runs" / "run_fail"
    res = MockAdapter(outcome="failed").run(_prompt(pdir), cwd=repo, timeout_s=60,
                                            mode="plan", run_dir=run_dir)
    assert res.status == "failed" and res.exit_code == 1
    assert Path(res.stderr_path).read_text(encoding="utf-8")


def test_mock_adapter_timeout_enforced(tmp_path):
    repo, pdir = _repo(tmp_path)
    run_dir = tmp_path / "agent_runs" / "run_to"
    res = MockAdapter(sim_duration_s=100).run(_prompt(pdir), cwd=repo, timeout_s=5,
                                              mode="plan", run_dir=run_dir)
    assert res.status == "timed_out"
    assert "killed at timeout" in Path(res.stderr_path).read_text(encoding="utf-8")


def test_mock_adapter_timeout_via_prompt_marker(tmp_path):
    repo, pdir = _repo(tmp_path)
    run_dir = tmp_path / "agent_runs" / "run_marker"
    res = MockAdapter().run(_prompt(pdir, "[[MOCK:timed_out]]\n"), cwd=repo,
                            timeout_s=600, mode="plan", run_dir=run_dir)
    assert res.status == "timed_out"


def test_mock_adapter_dry_run_no_edits(tmp_path):
    repo, pdir = _repo(tmp_path)
    run_dir = tmp_path / "agent_runs" / "run_dry"
    res = MockAdapter().dry_run(_prompt(pdir), cwd=repo, timeout_s=60, run_dir=run_dir)
    assert res.status == "dry_run" and res.changed_files == ()


def test_mock_adapter_unavailable_safe_report():
    adapter = MockAdapter(available=False)
    assert adapter.is_available() is False
    report = fmt.format_unavailable(adapter_name=adapter.name, note="runtime off")
    assert "사용 불가" in report and "unavailable" in report


# === post-run validator ======================================================
def test_post_run_clean_done(tmp_path):
    repo, pdir = _repo(tmp_path)
    run_dir = tmp_path / "agent_runs" / "run_ok"
    res = MockAdapter().run(_prompt(pdir), cwd=repo, timeout_s=60, mode="plan",
                            run_dir=run_dir)
    v = val.validate_post_run(res, stage=STAGE, repo_root=repo,
                              summary_text="후보 요약 초안")
    assert v["ok"] is True


def test_post_run_dangerous_changed_files_blocked(tmp_path):
    repo, pdir = _repo(tmp_path)
    run_dir = tmp_path / "agent_runs" / "run_danger"
    res = MockAdapter(changed_files=("src/voc/secret.py",)).run(
        _prompt(pdir), cwd=repo, timeout_s=60, mode="plan", run_dir=run_dir)
    v = val.validate_post_run(res, stage=STAGE, repo_root=repo)
    assert v["outcome"] == val.BLOCKED
    assert v["reason"].startswith("changed_file_outside_allowed_paths")


def test_post_run_packet_file_mutation_blocked(tmp_path):
    repo, pdir = _repo(tmp_path)
    run_dir = tmp_path / "agent_runs" / "run_packet"
    res = MockAdapter(changed_files=(
        "outputs/outreach/new_targets/foo/status.json",)).run(
        _prompt(pdir), cwd=repo, timeout_s=60, mode="plan", run_dir=run_dir)
    v = val.validate_post_run(res, stage=STAGE, repo_root=repo)
    assert v["outcome"] == val.BLOCKED and v["reason"].startswith("packet_file_mutation")


def test_post_run_external_claim_blocked(tmp_path):
    repo, _pdir = _repo(tmp_path)
    res = rt.AgentRunResult(run_id="r", adapter_name="mock_adapter", status="done",
                            prompt_path="p.md", cwd=str(repo))
    v = val.validate_post_run(res, stage=STAGE, repo_root=repo,
                              summary_text="후보 메일을 보냈습니다. 발송 완료.")
    assert v["outcome"] == val.BLOCKED and v["reason"].startswith("external_action_claimed")


# === report formatting =======================================================
def test_format_success_and_failure(tmp_path):
    repo, pdir = _repo(tmp_path)
    run_dir = tmp_path / "agent_runs" / "run_rep"
    done = MockAdapter().run(_prompt(pdir), cwd=repo, timeout_s=60, mode="plan",
                             run_dir=run_dir)
    ok = fmt.format_result(done, agent_name=AGENT, stage=STAGE, task_id=TASK)
    assert ok.startswith("✅ Agent run completed") and AGENT in ok

    failed = MockAdapter(outcome="failed").run(
        _prompt(pdir), cwd=repo, timeout_s=60, mode="plan",
        run_dir=tmp_path / "agent_runs" / "run_rep2")
    bad = fmt.format_result(failed, agent_name=AGENT, stage=STAGE, task_id=TASK)
    assert bad.startswith("⚠ Agent run blocked/failed")


def test_format_proposal_is_pre_run_no_execution():
    msg = fmt.format_proposal(adapter_name="claude_code_local", agent_name=AGENT,
                              stage=STAGE, task_id=TASK)
    assert "진행할까요" in msg and "수집/발송/PDF" in msg


# === claude_code_local stub ==================================================
def test_claude_code_local_unavailable_and_not_implemented(tmp_path):
    a = ClaudeCodeLocalAdapter()
    assert a.is_available() is False
    assert isinstance(a.availability_note(), str)
    with pytest.raises(NotImplementedError):
        a.run(tmp_path / "p.md", cwd=tmp_path, timeout_s=60, mode="plan",
              run_dir=tmp_path)
    with pytest.raises(NotImplementedError):
        a.dry_run(tmp_path / "p.md", cwd=tmp_path, timeout_s=60, run_dir=tmp_path)


# === no ANTHROPIC_API_KEY required ===========================================
def test_no_api_key_required(monkeypatch, tmp_path):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("CLAUDE_ORCHESTRATOR_ENABLED", raising=False)
    repo, pdir = _repo(tmp_path)
    run_dir = tmp_path / "agent_runs" / "run_nokey"
    adapter = MockAdapter()
    assert adapter.is_available() is True
    res = adapter.run(_prompt(pdir), cwd=repo, timeout_s=60, mode="plan",
                      run_dir=run_dir)
    assert res.status == "done"
    assert val.validate_post_run(res, stage=STAGE, repo_root=repo,
                                 summary_text="초안")["ok"] is True


# === .gitignore covers agent_runs/ ===========================================
def test_gitignore_covers_agent_runs():
    repo = aruns.find_repo_root()
    gi = (repo / ".gitignore").read_text(encoding="utf-8")
    assert "ops/discord_outreach_bot/agent_runs/" in gi


# === import boundary: validator stays pure ===================================
def test_validator_import_boundary():
    src = Path(val.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                imported.add(a.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    for banned in ("task_runner", "task_inputs", "subprocess", "socket",
                   "requests", "urllib", "anthropic"):
        assert banned not in imported, banned


def test_adapters_no_subprocess_against_claude():
    # claude_code_local must not call subprocess at all in M6-B (stub).
    path = Path(val.__file__).parent / "agent_adapters" / "claude_code_local.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                imported.add(a.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    assert "subprocess" not in imported
    assert "anthropic" not in imported
