"""M6-C: git worktree helper tests.

Hermetic — each test inits a throwaway git repo under tmp_path. No network, no
Claude Code, no ANTHROPIC_API_KEY. Verifies worktree isolation, run_id safety,
explicit-only cleanup, and git-derived change detection.
"""

from __future__ import annotations

import subprocess

import pytest

import agent_worktree as wt


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


# === run_id safety ===========================================================
@pytest.mark.parametrize("bad", ["", "..", "a/b", "../escape", ".hidden", "a b"])
def test_worktree_path_rejects_unsafe_run_id(tmp_path, bad):
    with pytest.raises(wt.WorktreeError):
        wt.worktree_path(tmp_path, bad)


def test_worktree_path_is_under_base(tmp_path):
    p = wt.worktree_path(tmp_path, "run_abc123")
    assert p == tmp_path / wt.WORKTREE_BASE / "run_abc123"
    assert wt.WORKTREE_BASE in p.parts


# === create / changed / remove ===============================================
def test_create_worktree_under_agent_worktrees(tmp_path):
    repo = _init_repo(tmp_path / "repo")
    path = wt.create_worktree(repo, "run_xyz")
    assert path == repo / wt.WORKTREE_BASE / "run_xyz"
    assert path.is_dir()
    assert (path / "seed.txt").exists()  # checked out from HEAD


def test_create_worktree_fails_if_exists(tmp_path):
    repo = _init_repo(tmp_path / "repo")
    wt.create_worktree(repo, "run_dup")
    with pytest.raises(wt.WorktreeError) as ei:
        wt.create_worktree(repo, "run_dup")
    assert "worktree_exists" in str(ei.value)


def test_list_changed_files_from_git(tmp_path):
    repo = _init_repo(tmp_path / "repo")
    path = wt.create_worktree(repo, "run_chg")
    (path / "ops").mkdir(parents=True, exist_ok=True)
    (path / "ops" / "draft.md").write_text("hi\n", encoding="utf-8")  # untracked
    (path / "seed.txt").write_text("changed\n", encoding="utf-8")     # modified
    changed = wt.list_changed_files(path)
    assert "ops/draft.md" in changed
    assert "seed.txt" in changed


def test_list_changed_files_clean_is_empty(tmp_path):
    repo = _init_repo(tmp_path / "repo")
    path = wt.create_worktree(repo, "run_clean")
    assert wt.list_changed_files(path) == ()


def test_capture_diff_contains_change(tmp_path):
    repo = _init_repo(tmp_path / "repo")
    path = wt.create_worktree(repo, "run_diff")
    (path / "seed.txt").write_text("mutated\n", encoding="utf-8")
    diff = wt.capture_diff(path)
    assert "mutated" in diff


def test_remove_worktree_is_explicit(tmp_path):
    repo = _init_repo(tmp_path / "repo")
    path = wt.create_worktree(repo, "run_rm")
    assert path.is_dir()
    assert wt.remove_worktree(repo, "run_rm") is True
    assert not path.exists()


def test_parse_porcelain_handles_rename_and_untracked():
    text = " M seed.txt\n?? new.md\nR  old.py -> new.py\n"
    parsed = wt._parse_porcelain(text)
    assert "seed.txt" in parsed
    assert "new.md" in parsed
    assert "new.py" in parsed and "old.py" not in parsed


# === module never uses shell=True ============================================
def test_worktree_module_no_shell_true():
    import ast
    from pathlib import Path
    tree = ast.parse(Path(wt.__file__).read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.keyword) and node.arg == "shell":
            assert not (isinstance(node.value, ast.Constant) and node.value.value is True)
