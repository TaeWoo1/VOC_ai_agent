"""M6-C: per-run git worktree lifecycle + git-derived change detection (SELF).

The local Claude Code adapter NEVER edits the live repo root. Each bounded run
gets its own throwaway git worktree under `.agent_worktrees/<run_id>`, created
from a base ref (HEAD by default). After a run, the set of changed files is read
back from `git status` *inside that worktree* — never inferred from the model's
stdout — and that list is what the post-run validator gates on.

Safety rules baked in here:
  - run_id is strictly validated (`[A-Za-z0-9_-]+`) so it can never traverse out
    of `.agent_worktrees/` or hit a hidden path.
  - all git calls use an explicit argv list (NEVER `shell=True`) and a timeout.
  - creation fails safely if the worktree already exists (no silent reuse).
  - cleanup is EXPLICIT (`remove_worktree`); nothing here auto-deletes.
  - this module never commits, pushes, sends, collects, renders, or publishes.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

WORKTREE_BASE = ".agent_worktrees"
_RUN_ID_RE = re.compile(r"\A[A-Za-z0-9_-]+\Z")
_GIT_TIMEOUT_S = 30


class WorktreeError(RuntimeError):
    """Raised on any unsafe / failed worktree operation."""


def _validate_run_id(run_id: str) -> str:
    if not run_id or not _RUN_ID_RE.match(run_id):
        raise WorktreeError(f"unsafe_run_id:{run_id!r}")
    return run_id


def worktree_base(repo_root: Path) -> Path:
    return Path(repo_root) / WORKTREE_BASE


def worktree_path(repo_root: Path, run_id: str) -> Path:
    """The (validated) worktree dir for a run. Guaranteed under WORKTREE_BASE."""
    _validate_run_id(run_id)
    base = worktree_base(repo_root)
    path = base / run_id
    # defense in depth: resolve and confirm containment (no symlink/.. escape)
    if not _is_under(path, base):
        raise WorktreeError(f"worktree_path_escape:{run_id!r}")
    return path


def _is_under(path: Path, base: Path) -> bool:
    try:
        rp = path.resolve()
        rb = base.resolve()
    except (OSError, RuntimeError):
        return False
    return rp == rb or rp.is_relative_to(rb)


def _run_git(args: list[str], *, cwd: Path, timeout_s: int = _GIT_TIMEOUT_S
             ) -> subprocess.CompletedProcess:
    """Run one git command with an explicit argv (no shell), capturing output."""
    return subprocess.run(  # noqa: S603 - explicit argv, never shell=True
        ["git", "-C", str(cwd), *args],
        capture_output=True, text=True, timeout=timeout_s, check=False)


def create_worktree(repo_root: Path, run_id: str, *, base_ref: str = "HEAD"
                    ) -> Path:
    """Create `.agent_worktrees/<run_id>` from `base_ref`. Fails if it exists."""
    repo_root = Path(repo_root)
    path = worktree_path(repo_root, run_id)
    if path.exists():
        raise WorktreeError(f"worktree_exists:{path}")
    worktree_base(repo_root).mkdir(parents=True, exist_ok=True)
    # --detach: an unnamed, throwaway checkout at base_ref; no branch is moved.
    proc = _run_git(["worktree", "add", "--detach", str(path), base_ref],
                    cwd=repo_root)
    if proc.returncode != 0:
        raise WorktreeError(
            f"worktree_add_failed(rc={proc.returncode}):{proc.stderr.strip()}")
    return path


def remove_worktree(repo_root: Path, run_id: str, *, force: bool = True) -> bool:
    """EXPLICIT cleanup. Returns True if git reported success. Never auto-called."""
    repo_root = Path(repo_root)
    path = worktree_path(repo_root, run_id)
    args = ["worktree", "remove", str(path)]
    if force:
        args.insert(2, "--force")
    proc = _run_git(args, cwd=repo_root)
    return proc.returncode == 0


def _parse_porcelain(text: str) -> tuple[str, ...]:
    """Parse `git status --porcelain` output into changed relative paths.

    Handles renames (`R  old -> new` -> takes new) and untracked (`?? path`).
    """
    out: list[str] = []
    for line in text.splitlines():
        if not line.strip():
            continue
        # porcelain v1: 2 status chars + space + path (rename uses ' -> ')
        rest = line[3:] if len(line) > 3 else line.strip()
        if " -> " in rest:
            rest = rest.split(" -> ", 1)[1]
        rest = rest.strip().strip('"')
        if rest:
            out.append(rest)
    # stable, de-duplicated
    seen: dict[str, None] = {}
    for p in out:
        seen.setdefault(p, None)
    return tuple(seen)


def list_changed_files(worktree: Path) -> tuple[str, ...]:
    """Changed files in `worktree` per `git status --porcelain` (authoritative).

    Returns () if git fails (caller treats an empty/uncomputable set as
    "no detected changes"; the post-run validator still gates whatever is here).
    """
    worktree = Path(worktree)
    # --untracked-files=all lists each new file individually (git otherwise
    # collapses a wholly-new directory to just "dir/", hiding the real paths).
    proc = _run_git(["status", "--porcelain", "--untracked-files=all"],
                    cwd=worktree)
    if proc.returncode != 0:
        return ()
    return _parse_porcelain(proc.stdout)


def capture_diff(worktree: Path) -> str:
    """Best-effort unified diff vs HEAD for audit. Empty string on failure."""
    worktree = Path(worktree)
    proc = _run_git(["diff", "HEAD"], cwd=worktree)
    return proc.stdout if proc.returncode == 0 else ""
