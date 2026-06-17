"""M6-C: local Claude Code adapter tests.

Hermetic by default — a FakePopen seam replaces subprocess.Popen so NO real
Claude Code is invoked, NO network, NO ANTHROPIC_API_KEY. Real git is used only
for the worktree-backed change-detection test (throwaway repo under tmp_path).

A single optional live smoke is gated behind RUN_LIVE_CLAUDE_CODE_TEST=1 and is
skipped by default.
"""

from __future__ import annotations

import ast
import os
import subprocess
from pathlib import Path

import pytest

import agent_adapters.claude_code_local as ccl
import agent_run_validator as val
import agent_worktree as wt


# --- fake subprocess seam ----------------------------------------------------
def make_fake_popen(*, stdout="{}", stderr="", returncode=0, timeout_first=False,
                    writes=None):
    """Build a (PopenClass, record) pair. `writes` = {relpath: content} the fake
    'claude' creates in cwd during communicate (to simulate real edits)."""
    rec: dict = {"called": False}

    class _FakePopen:
        def __init__(self, argv, **kwargs):
            rec["called"] = True
            rec["argv"] = argv
            rec["kwargs"] = kwargs
            self.pid = 9999
            self.returncode = None
            self._timed = timeout_first

        def communicate(self, input=None, timeout=None):
            rec["input"] = input
            rec["timeout"] = timeout
            if self._timed:
                self._timed = False
                raise subprocess.TimeoutExpired(cmd="claude", timeout=timeout)
            if writes:
                cwd = Path(rec["kwargs"]["cwd"])
                for rel, content in writes.items():
                    fp = cwd / rel
                    fp.parent.mkdir(parents=True, exist_ok=True)
                    fp.write_text(content, encoding="utf-8")
            self.returncode = returncode
            return stdout, stderr

        def kill(self):
            rec["killed"] = True

    return _FakePopen, rec


def _prompt(tmp_path, body="Return the word OK."):
    p = tmp_path / "prompt.md"
    p.write_text(body, encoding="utf-8")
    return p


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


# === argv construction =======================================================
def test_dry_run_argv_is_plan_mode_readonly():
    argv = ccl.build_dry_run_argv(add_dir=Path("/wt"))
    assert argv[0] == "claude" and "-p" in argv
    assert argv[argv.index("--permission-mode") + 1] == "plan"
    assert argv[argv.index("--output-format") + 1] == "json"
    assert argv[argv.index("--add-dir") + 1] == "/wt"
    assert "--no-session-persistence" in argv and "--disable-slash-commands" in argv
    assert "--bare" not in argv


def test_run_argv_is_accept_edits_with_denied_vcs_and_web():
    argv = ccl.build_run_argv(add_dir=Path("/wt"))
    assert argv[argv.index("--permission-mode") + 1] == "acceptEdits"
    denied = argv[argv.index("--disallowedTools") + 1]
    assert "git commit" in denied and "git push" in denied and "rm" in denied
    assert "WebFetch" in denied and "WebSearch" in denied
    assert "--bare" not in argv


def test_run_argv_never_commits_or_pushes():
    argv = ccl.build_run_argv(add_dir=Path("/wt"))
    # no positional git mutation verbs in the launch argv itself
    joined = " ".join(argv)
    assert " commit" not in joined.replace("git commit:", "")  # only inside deny pattern
    # the launcher itself issues no git subcommand
    assert "worktree" not in argv and argv.count("git") == 0


# === availability ============================================================
def test_unavailable_when_binary_missing(monkeypatch, tmp_path):
    monkeypatch.setattr(ccl, "which", lambda _b: None)
    a = ccl.ClaudeCodeLocalAdapter()
    assert a.is_available() is False
    res = a.dry_run(_prompt(tmp_path), cwd=tmp_path, timeout_s=30,
                    run_dir=tmp_path / "rd")
    assert res.status == "unavailable"


def test_is_available_true_when_present(monkeypatch):
    monkeypatch.setattr(ccl, "which", lambda _b: "/opt/homebrew/bin/claude")
    assert ccl.ClaudeCodeLocalAdapter().is_available() is True


# === dry_run (no longer NotImplementedError) =================================
def test_dry_run_success_with_fake_subprocess(monkeypatch, tmp_path):
    monkeypatch.setattr(ccl, "which", lambda _b: "/bin/claude")
    fp, rec = make_fake_popen(stdout='{"result": "plan looks fine"}')
    monkeypatch.setattr(ccl, "_Popen", fp)
    a = ccl.ClaudeCodeLocalAdapter()
    run_dir = tmp_path / "rd"
    res = a.dry_run(_prompt(tmp_path), cwd=tmp_path, timeout_s=30, run_dir=run_dir)
    assert res.status == "dry_run"
    # argv was the plan-mode argv
    assert rec["argv"][rec["argv"].index("--permission-mode") + 1] == "plan"
    # JSON output saved + summary derived
    assert (run_dir / "claude_output.json").exists()
    assert "plan looks fine" in (run_dir / "summary.md").read_text(encoding="utf-8")
    assert (run_dir / "result.json").exists()


# === prompt via stdin, no shell, env scrub ===================================
def test_prompt_piped_via_stdin_no_shell(monkeypatch, tmp_path):
    monkeypatch.setattr(ccl, "which", lambda _b: "/bin/claude")
    fp, rec = make_fake_popen()
    monkeypatch.setattr(ccl, "_Popen", fp)
    body = "Return the word OK."
    ccl.ClaudeCodeLocalAdapter().dry_run(_prompt(tmp_path, body), cwd=tmp_path,
                                         timeout_s=30, run_dir=tmp_path / "rd")
    assert rec["input"] == body                       # prompt via stdin
    assert rec["kwargs"]["stdin"] is subprocess.PIPE
    assert rec["kwargs"].get("shell", False) is False  # never shell=True
    assert "shell" not in rec["kwargs"] or rec["kwargs"]["shell"] is False
    assert rec["kwargs"]["start_new_session"] is True  # own process group


def test_env_scrubbed_of_api_key(monkeypatch, tmp_path):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-secret")
    monkeypatch.setenv("ANTHROPIC_AUTH_TOKEN", "tok")
    monkeypatch.setattr(ccl, "which", lambda _b: "/bin/claude")
    fp, rec = make_fake_popen()
    monkeypatch.setattr(ccl, "_Popen", fp)
    ccl.ClaudeCodeLocalAdapter().dry_run(_prompt(tmp_path), cwd=tmp_path,
                                         timeout_s=30, run_dir=tmp_path / "rd")
    env = rec["kwargs"]["env"]
    assert "ANTHROPIC_API_KEY" not in env
    assert "ANTHROPIC_AUTH_TOKEN" not in env
    assert "PATH" in env  # minimal env preserved for local CLI/auth


def test_scrub_env_helper_is_pure():
    out = ccl.scrub_env({"ANTHROPIC_API_KEY": "x", "PATH": "/bin", "HOME": "/h"})
    assert out == {"PATH": "/bin", "HOME": "/h"}


# === stdout/stderr captured ==================================================
def test_stdout_stderr_captured(monkeypatch, tmp_path):
    monkeypatch.setattr(ccl, "which", lambda _b: "/bin/claude")
    fp, rec = make_fake_popen(stdout='{"result":"ok"}', stderr="some warning\n")
    monkeypatch.setattr(ccl, "_Popen", fp)
    run_dir = tmp_path / "rd"
    res = ccl.ClaudeCodeLocalAdapter().dry_run(_prompt(tmp_path), cwd=tmp_path,
                                               timeout_s=30, run_dir=run_dir)
    assert Path(res.stdout_path).read_text(encoding="utf-8")
    assert "some warning" in Path(res.stderr_path).read_text(encoding="utf-8")


# === json parse failure handled ==============================================
def test_json_parse_failure_preserves_raw_stdout(monkeypatch, tmp_path):
    monkeypatch.setattr(ccl, "which", lambda _b: "/bin/claude")
    fp, rec = make_fake_popen(stdout="this is not json", returncode=0)
    monkeypatch.setattr(ccl, "_Popen", fp)
    run_dir = tmp_path / "rd"
    res = ccl.ClaudeCodeLocalAdapter().dry_run(_prompt(tmp_path), cwd=tmp_path,
                                               timeout_s=30, run_dir=run_dir)
    assert res.status == "dry_run"  # exit 0 -> still dry_run
    assert not (run_dir / "claude_output.json").exists()
    assert "this is not json" in Path(res.stdout_path).read_text(encoding="utf-8")
    assert any("unparseable" in n for n in res.safety_notes)


def test_nonzero_exit_is_failed(monkeypatch, tmp_path):
    monkeypatch.setattr(ccl, "which", lambda _b: "/bin/claude")
    fp, rec = make_fake_popen(stdout="", stderr="boom", returncode=2)
    monkeypatch.setattr(ccl, "_Popen", fp)
    res = ccl.ClaudeCodeLocalAdapter().dry_run(_prompt(tmp_path), cwd=tmp_path,
                                               timeout_s=30, run_dir=tmp_path / "rd")
    assert res.status == "failed" and res.exit_code == 2


# === timeout kills the process group =========================================
def test_timeout_kills_process_group(monkeypatch, tmp_path):
    monkeypatch.setattr(ccl, "which", lambda _b: "/bin/claude")
    fp, rec = make_fake_popen(stdout="partial", timeout_first=True)
    monkeypatch.setattr(ccl, "_Popen", fp)
    killed = {}
    monkeypatch.setattr(ccl.os, "getpgid", lambda pid: pid)
    monkeypatch.setattr(ccl.os, "killpg",
                        lambda pgid, sig: killed.update(pgid=pgid, sig=sig))
    res = ccl.ClaudeCodeLocalAdapter().dry_run(_prompt(tmp_path), cwd=tmp_path,
                                               timeout_s=1, run_dir=tmp_path / "rd")
    assert res.status == "timed_out"
    assert killed.get("pgid") == 9999  # the fake pid's group was signalled
    assert any("timed_out" in n for n in res.safety_notes)


# === run() requires a worktree cwd ===========================================
def test_run_refuses_non_worktree_cwd(monkeypatch, tmp_path):
    monkeypatch.setattr(ccl, "which", lambda _b: "/bin/claude")
    fp, rec = make_fake_popen()
    monkeypatch.setattr(ccl, "_Popen", fp)
    # cwd is a plain dir, not under .agent_worktrees/
    res = ccl.ClaudeCodeLocalAdapter().run(_prompt(tmp_path), cwd=tmp_path,
                                           timeout_s=30, mode="bounded_edit",
                                           run_dir=tmp_path / "rd")
    assert res.status == "blocked"
    assert rec["called"] is False  # no subprocess ever spawned
    assert any("worktree" in n for n in res.safety_notes)


# === changed_files come from git, not stdout =================================
def test_run_changed_files_from_git_not_stdout(monkeypatch, tmp_path):
    repo = _init_repo(tmp_path / "repo")
    worktree = wt.create_worktree(repo, "run_edit")
    monkeypatch.setattr(ccl, "which", lambda _b: "/bin/claude")
    # fake claude CLAIMS it edited FAKE_CLAIM.md, but actually writes real_edit.md
    fp, rec = make_fake_popen(
        stdout='{"result": "I edited FAKE_CLAIM.md"}',
        writes={"real_edit.md": "real change\n"})
    monkeypatch.setattr(ccl, "_Popen", fp)
    run_dir = tmp_path / "rd"
    res = ccl.ClaudeCodeLocalAdapter().run(_prompt(tmp_path), cwd=worktree,
                                           timeout_s=30, mode="bounded_edit",
                                           run_dir=run_dir)
    assert res.status == "done"
    assert "real_edit.md" in res.changed_files       # git truth
    assert "FAKE_CLAIM.md" not in res.changed_files    # stdout claim ignored
    assert (run_dir / "changed_files.txt").exists()


def test_run_out_of_scope_change_blocked_by_post_validator(monkeypatch, tmp_path):
    repo = _init_repo(tmp_path / "repo")
    worktree = wt.create_worktree(repo, "run_oos")
    monkeypatch.setattr(ccl, "which", lambda _b: "/bin/claude")
    fp, rec = make_fake_popen(stdout='{"result":"done"}',
                              writes={"src/secret.py": "x = 1\n"})
    monkeypatch.setattr(ccl, "_Popen", fp)
    res = ccl.ClaudeCodeLocalAdapter().run(_prompt(tmp_path), cwd=worktree,
                                           timeout_s=30, mode="bounded_edit",
                                           run_dir=tmp_path / "rd")
    # adapter itself returns done with git-derived changes; the SEPARATE Python
    # validator is what blocks the out-of-scope edit.
    assert "src/secret.py" in res.changed_files
    v = val.validate_post_run(res, stage="code_review_prompt", repo_root=repo)
    assert v["outcome"] == val.BLOCKED


# === collect_result ==========================================================
def test_collect_result_reads_result_json(monkeypatch, tmp_path):
    monkeypatch.setattr(ccl, "which", lambda _b: "/bin/claude")
    fp, rec = make_fake_popen(stdout='{"result":"ok"}')
    monkeypatch.setattr(ccl, "_Popen", fp)
    a = ccl.ClaudeCodeLocalAdapter()
    run_dir = tmp_path / "rd"
    written = a.dry_run(_prompt(tmp_path), cwd=tmp_path, timeout_s=30, run_dir=run_dir)
    reread = a.collect_result(run_dir.name, run_dir=run_dir)
    assert reread.status == written.status == "dry_run"
    assert reread.run_id == run_dir.name


def test_collect_result_missing_is_unavailable(tmp_path):
    res = ccl.ClaudeCodeLocalAdapter().collect_result("run_x", run_dir=tmp_path / "none")
    assert res.status == "unavailable"


# === source-level safety guarantees ==========================================
def test_adapter_source_has_no_shell_true_and_no_bare():
    src = Path(ccl.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.keyword) and node.arg == "shell":
            assert not (isinstance(node.value, ast.Constant)
                        and node.value.value is True)
    assert '"--bare"' not in src and "'--bare'" not in src


def test_adapter_does_not_import_anthropic():
    tree = ast.parse(Path(ccl.__file__).read_text(encoding="utf-8"))
    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                imported.add(a.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    assert "anthropic" not in imported


# === optional gated live smoke (skipped by default) ==========================
@pytest.mark.skipif(os.environ.get("RUN_LIVE_CLAUDE_CODE_TEST") != "1",
                    reason="live Claude Code smoke disabled (set RUN_LIVE_CLAUDE_CODE_TEST=1)")
def test_live_plan_mode_smoke(tmp_path):
    """Trivial, read-only, short-timeout live probe in a temp worktree.

    Touches no project files, runs no project task. Plan mode only.
    """
    repo = _init_repo(tmp_path / "repo")
    worktree = wt.create_worktree(repo, "run_live")
    prompt = _prompt(tmp_path, "Return only the word OK.")
    a = ccl.ClaudeCodeLocalAdapter()
    if not a.is_available():
        pytest.skip("claude binary not available")
    res = a.dry_run(prompt, cwd=worktree, timeout_s=60, run_dir=tmp_path / "rd")
    assert res.status in ("dry_run", "failed", "timed_out")
    # plan mode must not have changed repo files
    assert wt.list_changed_files(worktree) == ()
