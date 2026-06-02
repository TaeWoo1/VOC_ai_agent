"""M6-B: local Claude Code runtime adapter — STUB ONLY (SELF).

This will (in M6-C) drive the already-authenticated LOCAL Claude Code CLI/session
— NOT the Anthropic API, and with NO ANTHROPIC_API_KEY. Python keeps full control
of whether it runs, the prompt, cwd (a per-run git worktree under .agent_worktrees/),
timeout (process-group kill), mode, and output capture.

M6-B is scaffold only and MUST NOT execute anything:
  - `is_available()` returns False with an explanatory note. It does a cheap,
    side-effect-free PATH presence check for a `claude` binary, but NEVER invokes
    it (no `claude --help`, no subprocess against claude) — the capability-discovery
    probe is the first authorized step of M6-C.
  - `dry_run()` / `run()` raise NotImplementedError("M6-C").
  - No CLI flags are assumed; they are recorded in the M6-C discovery doc first.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from agent_runtime import AgentRunResult

_M6C = "M6-C"


class ClaudeCodeLocalAdapter:
    name = "claude_code_local"

    def is_available(self) -> bool:
        """Always False in M6-B (the runtime is not wired yet).

        We do a presence-only check (`shutil.which`) purely so the eventual M6-C
        report can say *why* it is unavailable, but we deliberately return False:
        even if the binary exists, M6-B has no validated execution path. This does
        NOT invoke claude and starts no agent session."""
        return False

    def availability_note(self) -> str:
        present = shutil.which("claude") is not None
        if not present:
            return ("claude_code_local: `claude` CLI not found on PATH. "
                    "Local Claude Code runtime is required for M6-C.")
        return ("claude_code_local: stub (M6-B). `claude` is present but the "
                "runtime is not wired until M6-C (CLI discovery probe pending).")

    def dry_run(self, prompt_path: Path, *, cwd: Path, timeout_s: int,
                run_dir: Path) -> AgentRunResult:
        raise NotImplementedError(_M6C)

    def run(self, prompt_path: Path, *, cwd: Path, timeout_s: int, mode: str,
            run_dir: Path) -> AgentRunResult:
        raise NotImplementedError(_M6C)

    def collect_result(self, run_id: str, *, run_dir: Path) -> AgentRunResult:
        raise NotImplementedError(_M6C)
