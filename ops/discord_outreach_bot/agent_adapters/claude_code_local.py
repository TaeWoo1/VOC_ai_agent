"""M6-C: local Claude Code runtime adapter (SELF — security-critical).

Drives the already-authenticated LOCAL Claude Code CLI (`claude`) — NOT the
Anthropic API, and with NO `ANTHROPIC_API_KEY`. Every safety-relevant decision is
made here in Python, never by the model:

  - the prompt is read by Python and piped via **stdin** (never an argv arg, never
    a shell string);
  - the process runs with an explicit **argv list** and `shell=False`, in a fresh
    process group (`start_new_session=True`) so a Python-enforced timeout can kill
    the whole group;
  - the environment is **scrubbed** of API-key / token vars before spawn (and we
    never pass `--bare`, which would force `ANTHROPIC_API_KEY` and bypass the
    logged-in OAuth/keychain session);
  - `dry_run` uses `--permission-mode plan` (no edits); `run` uses `acceptEdits`
    confined to the per-run worktree via `--add-dir`, with git commit/push/rm and
    web tools denied;
  - **changed files come from `git status` in the worktree**, never from stdout —
    the model's claims about what it did are not trusted;
  - the adapter NEVER commits, pushes, copies changes back to the repo root,
    sends mail, collects, renders PDFs, or publishes. Those remain Python's job
    behind the validator, and most are blocked outright.

Invocation shapes (validated against the M6-C discovery doc,
docs/agents/m6c_claude_code_cli_discovery.md):

  dry_run : claude -p --permission-mode plan --output-format json
            --add-dir <worktree> --no-session-persistence --disable-slash-commands
            --tools "Read,Grep,Glob"
  run     : claude -p --permission-mode acceptEdits --output-format json
            --add-dir <worktree> --no-session-persistence --disable-slash-commands
            --disallowedTools "<git push/commit/rm + web>"
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
from pathlib import Path
from shutil import which
from typing import TYPE_CHECKING, Optional

import agent_worktree

if TYPE_CHECKING:  # annotations only — no runtime import (avoids the cycle)
    from agent_runtime import AgentRunResult

# NOTE: AgentRunResult is imported LAZILY (inside methods), not at module top.
# agent_runtime builds its adapter registry at import time by importing this
# module; a top-level `from agent_runtime import ...` here would deadlock when
# this adapter is the first thing imported. Annotations are strings (future
# annotations), so the lazy import is enough.

CLAUDE_BIN = "claude"

# narrow subprocess seam: tests patch THIS name (not subprocess.Popen globally,
# which would also intercept agent_worktree's git calls).
_Popen = subprocess.Popen

# env var names scrubbed before spawning claude (defense in depth — we rely on the
# logged-in OAuth/keychain session, NOT an API key). We deliberately do NOT pass
# `--bare`, which would force ANTHROPIC_API_KEY.
_SCRUBBED_ENV_VARS = (
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_API_KEY",
)

# read-only tool set for plan/dry-run previews
_DRY_RUN_TOOLS = "Read,Grep,Glob"
# tools explicitly denied during a bounded edit run (no VCS mutation / no network)
_RUN_DISALLOWED_TOOLS = (
    "Bash(git commit:*)",
    "Bash(git push:*)",
    "Bash(rm:*)",
    "Bash(rm -rf:*)",
    "WebFetch",
    "WebSearch",
)

_DEFAULT_GRACE_S = 5  # seconds to drain output after a timeout kill


def build_dry_run_argv(*, add_dir: Path) -> list[str]:
    """argv for a read-only plan-mode preview. Pure; no side effects."""
    return [
        CLAUDE_BIN, "-p",
        "--permission-mode", "plan",
        "--output-format", "json",
        "--add-dir", str(add_dir),
        "--no-session-persistence",
        "--disable-slash-commands",
        "--tools", _DRY_RUN_TOOLS,
    ]


def build_run_argv(*, add_dir: Path) -> list[str]:
    """argv for a bounded edit run, confined to `add_dir`. Pure; no side effects.

    Edits are accepted automatically (`acceptEdits`) but VCS-mutating and network
    tools are denied; the worktree + post-run validator are the real containment.
    """
    return [
        CLAUDE_BIN, "-p",
        "--permission-mode", "acceptEdits",
        "--output-format", "json",
        "--add-dir", str(add_dir),
        "--no-session-persistence",
        "--disable-slash-commands",
        "--disallowedTools", " ".join(_RUN_DISALLOWED_TOOLS),
    ]


def scrub_env(env: Optional[dict] = None) -> dict:
    """Return a copy of `env` (os.environ by default) with secret vars removed.

    Keeps everything else (PATH, HOME, etc.) so the local OAuth/keychain session
    keeps working. Never logs values; never adds ANTHROPIC_API_KEY.
    """
    src = dict(os.environ if env is None else env)
    for key in _SCRUBBED_ENV_VARS:
        src.pop(key, None)
    return src


class ClaudeCodeLocalAdapter:
    name = "claude_code_local"

    def __init__(self, *, claude_bin: str = CLAUDE_BIN,
                 grace_s: int = _DEFAULT_GRACE_S) -> None:
        self._claude_bin = claude_bin
        self._grace_s = grace_s

    # --- availability --------------------------------------------------------
    def is_available(self) -> bool:
        """True iff the `claude` binary is on PATH. Cheap, side-effect free.

        Does NOT invoke claude, start a session, read/print secrets, or require
        ANTHROPIC_API_KEY. (A deeper `claude auth status` check is intentionally
        not run here — presence is enough for the registry, and an auth probe is
        a separately-authorized, slower step.)
        """
        return which(self._claude_bin) is not None

    def availability_note(self) -> str:
        if which(self._claude_bin) is None:
            return ("claude_code_local: `claude` CLI not found on PATH. "
                    "Install / log in to local Claude Code to enable runs.")
        return ("claude_code_local: `claude` present. Uses the logged-in local "
                "session (no ANTHROPIC_API_KEY, no --bare).")

    # --- public runtime ------------------------------------------------------
    def dry_run(self, prompt_path: Path, *, cwd: Path, timeout_s: int,
                run_dir: Path) -> AgentRunResult:
        return self._execute(
            prompt_path, cwd=cwd, timeout_s=timeout_s, run_dir=run_dir,
            argv=build_dry_run_argv(add_dir=Path(cwd)),
            success_status="dry_run", mode="plan", compute_changes=False)

    def run(self, prompt_path: Path, *, cwd: Path, timeout_s: int, mode: str,
            run_dir: Path) -> AgentRunResult:
        # a real edit run must NEVER touch the live repo root — only a throwaway
        # worktree under .agent_worktrees/<run_id>. Refuse otherwise (no edits).
        cwd = Path(cwd)
        if agent_worktree.WORKTREE_BASE not in cwd.parts:
            return self._refuse(
                prompt_path, cwd=cwd, run_dir=run_dir, mode=mode,
                note=("bounded_edit run refused: cwd is not a "
                      f"{agent_worktree.WORKTREE_BASE}/<run_id> worktree"))
        return self._execute(
            prompt_path, cwd=cwd, timeout_s=timeout_s, run_dir=run_dir,
            argv=build_run_argv(add_dir=cwd),
            success_status="done", mode=mode, compute_changes=True)

    def collect_result(self, run_id: str, *, run_dir: Path) -> "AgentRunResult":
        from agent_runtime import AgentRunResult
        run_dir = Path(run_dir)
        result_json = run_dir / "result.json"
        if result_json.exists():
            try:
                return AgentRunResult.from_record(
                    json.loads(result_json.read_text(encoding="utf-8")))
            except (json.JSONDecodeError, OSError):
                pass
        return AgentRunResult(run_id=run_id, adapter_name=self.name,
                              status="unavailable", prompt_path="",
                              cwd=str(run_dir))

    # --- internals -----------------------------------------------------------
    def _refuse(self, prompt_path, *, cwd, run_dir, mode, note) -> AgentRunResult:
        run_dir = Path(run_dir)
        run_dir.mkdir(parents=True, exist_ok=True)
        return self._finalize(
            run_dir, status="blocked", prompt_path=prompt_path, cwd=cwd,
            stdout_path=None, stderr_path=None, summary_path=None,
            exit_code=None, changed=(), notes=(note,))

    def _execute(self, prompt_path: Path, *, cwd: Path, timeout_s: int,
                 run_dir: Path, argv: list[str], success_status: str, mode: str,
                 compute_changes: bool) -> AgentRunResult:
        run_dir = Path(run_dir)
        run_dir.mkdir(parents=True, exist_ok=True)
        cwd = Path(cwd)

        if which(self._claude_bin) is None:
            return self._finalize(
                run_dir, status="unavailable", prompt_path=prompt_path, cwd=cwd,
                stdout_path=None, stderr_path=None, summary_path=None,
                exit_code=None, changed=(),
                notes=("claude binary not found on PATH",))

        try:
            prompt_text = Path(prompt_path).read_text(encoding="utf-8")
        except OSError as exc:
            return self._finalize(
                run_dir, status="failed", prompt_path=prompt_path, cwd=cwd,
                stdout_path=None, stderr_path=None, summary_path=None,
                exit_code=None, changed=(),
                notes=(f"prompt unreadable: {exc.__class__.__name__}",))

        stdout, stderr, exit_code, timed_out = self._spawn(
            argv, cwd=cwd, prompt_text=prompt_text, timeout_s=timeout_s)

        stdout_path = run_dir / "stdout.log"
        stderr_path = run_dir / "stderr.log"
        stdout_path.write_text(stdout or "", encoding="utf-8")
        stderr_path.write_text(stderr or "", encoding="utf-8")

        notes: list[str] = []
        if timed_out:
            return self._finalize(
                run_dir, status="timed_out", prompt_path=prompt_path, cwd=cwd,
                stdout_path=stdout_path, stderr_path=stderr_path,
                summary_path=None, exit_code=exit_code, changed=(),
                notes=(f"timed_out after {timeout_s}s; process group killed",))

        # parse claude's --output-format json (schema not contractually fixed)
        summary_text, parsed = self._parse_json_output(stdout, run_dir)
        if parsed is None:
            notes.append("claude json output unparseable; raw stdout preserved")

        # changed files come from GIT, never from stdout claims
        changed: tuple[str, ...] = ()
        if compute_changes:
            changed = agent_worktree.list_changed_files(cwd)
            diff = agent_worktree.capture_diff(cwd)
            if diff:
                (run_dir / "diff.patch").write_text(diff, encoding="utf-8")

        summary_path = None
        if summary_text:
            summary_path = run_dir / "summary.md"
            summary_path.write_text(summary_text + "\n", encoding="utf-8")

        if exit_code != 0:
            status = "failed"
            notes.append(f"nonzero exit: {exit_code}")
        else:
            status = success_status

        return self._finalize(
            run_dir, status=status, prompt_path=prompt_path, cwd=cwd,
            stdout_path=stdout_path, stderr_path=stderr_path,
            summary_path=summary_path, exit_code=exit_code, changed=changed,
            notes=tuple(notes))

    def _spawn(self, argv: list[str], *, cwd: Path, prompt_text: str,
               timeout_s: int) -> tuple[str, str, Optional[int], bool]:
        """Spawn claude with explicit argv, prompt on stdin, scrubbed env, in its
        own process group. Returns (stdout, stderr, exit_code, timed_out).

        On timeout the whole process group is SIGKILLed and partial output is
        preserved. NEVER uses shell=True.
        """
        proc = _Popen(  # noqa: S603 - explicit argv list, shell=False
            argv,
            cwd=str(cwd),
            env=scrub_env(),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,  # own process group for group-kill on timeout
        )
        try:
            stdout, stderr = proc.communicate(input=prompt_text, timeout=timeout_s)
            return stdout, stderr, proc.returncode, False
        except subprocess.TimeoutExpired:
            self._kill_group(proc)
            try:
                stdout, stderr = proc.communicate(timeout=self._grace_s)
            except subprocess.TimeoutExpired:
                stdout, stderr = "", ""
            return stdout or "", stderr or "", proc.returncode, True

    @staticmethod
    def _kill_group(proc: subprocess.Popen) -> None:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError, OSError):
            try:
                proc.kill()
            except OSError:
                pass

    @staticmethod
    def _parse_json_output(stdout: str, run_dir: Path
                           ) -> tuple[Optional[str], Optional[object]]:
        """Parse claude's JSON stdout defensively. Returns (summary_text, parsed).

        We do not assume a fixed schema: we save the parsed object to
        claude_output.json and derive a human summary from common string fields if
        present. Parse failure -> (None, None); raw stdout stays in stdout.log.
        """
        text = (stdout or "").strip()
        if not text:
            return None, None
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return None, None
        (run_dir / "claude_output.json").write_text(
            json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8")
        summary = None
        if isinstance(parsed, dict):
            for key in ("result", "text", "summary", "response", "content"):
                val = parsed.get(key)
                if isinstance(val, str) and val.strip():
                    summary = val.strip()
                    break
        return summary, parsed

    def _finalize(self, run_dir: Path, *, status: str, prompt_path, cwd,
                  stdout_path, stderr_path, summary_path, exit_code, changed,
                  notes) -> "AgentRunResult":
        from agent_runtime import AgentRunResult
        result = AgentRunResult(
            run_id=run_dir.name, adapter_name=self.name, status=status,
            prompt_path=str(prompt_path), cwd=str(cwd),
            stdout_path=str(stdout_path) if stdout_path else None,
            stderr_path=str(stderr_path) if stderr_path else None,
            summary_path=str(summary_path) if summary_path else None,
            changed_files=tuple(changed), exit_code=exit_code,
            safety_notes=tuple(notes))
        result.validate()
        (run_dir / "result.json").write_text(
            json.dumps(result.to_record(), ensure_ascii=False), encoding="utf-8")
        if changed:
            (run_dir / "changed_files.txt").write_text(
                "\n".join(changed) + "\n", encoding="utf-8")
        return result
