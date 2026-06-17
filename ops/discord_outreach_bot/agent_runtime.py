"""M6-B: Paperclip-style Agent Runtime Adapter framework (SCAFFOLD).

This is the *framework* half of M6: a small, runtime-agnostic abstraction over
"run one bounded agent process, capture its output as artifacts, hand the result
back to Python for validation and reporting". It introduces NO process execution
itself — adapters do that (mock_adapter now; claude_code_local in M6-C).

Design principle (unchanged from M6-A): **the model never decides its own
permissions.** Python owns whether a run happens, the prompt passed, the cwd, the
timeout, the mode, output capture, rollback/cleanup, and what is reported back to
Discord. An adapter is given a fully-resolved, pre-validated request and may only
produce an `AgentRunResult`; `agent_run_validator` re-derives the safety verdict
in Python and can force `blocked` regardless of what the adapter/model claims.

M6-B is scaffold only:
  - `AgentRunResult` + `RUNTIME_STATUSES` are real.
  - `AgentRuntimeAdapter` is the Protocol every adapter implements.
  - `ADAPTERS` is the allowlisted registry (mock_adapter + claude_code_local).
  - `dispatch_agent_run` is a SIGNATURE + docstring only; the real
    validate -> approve -> dry_run -> run -> capture -> report wiring is M6-C.
This module performs no collection / send / PDF / publish / git / network /
subprocess / Claude Code / Anthropic-API work, and needs no ANTHROPIC_API_KEY.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional, Protocol, runtime_checkable

# --- run status vocabulary ---------------------------------------------------
# Distinct from task_runs.RUN_STATUSES (the pure-Python scaffold runner). Agent
# runs are external processes, so they add timed_out + blocked + unavailable.
RUNTIME_STATUSES = (
    "unavailable",  # adapter/runtime not usable (e.g. CLI absent, not logged in)
    "dry_run",      # plan-mode preview completed; nothing executed for real
    "running",      # process started (transient; spine records it then resolves)
    "done",         # completed, exit 0, post-validation passed
    "failed",       # nonzero exit / adapter error
    "timed_out",    # killed at the Python-enforced timeout
    "blocked",      # post-validation refused the result (e.g. out-of-scope edits)
)

# closed mode vocabulary — never free text from the model/operator
RUN_MODES = ("plan", "bounded_edit")

# M6-D lifecycle vocabulary: a SUPERSET of RUNTIME_STATUSES used by the
# append-only agent_runs spine to record the whole propose -> approve -> run
# lifecycle. RUNTIME_STATUSES (what an adapter result may carry) stays narrower:
# "proposed"/"approved"/"cancelled" are orchestration states, never adapter
# outputs. AgentRunResult.status still validates against RUNTIME_STATUSES only.
LIFECYCLE_STATUSES = (
    "proposed",     # validated proposal recorded; awaiting operator confirmation
    "approved",     # operator confirmed; prompt_hash re-verified
    "running",      # worktree created, adapter invoked (transient)
    "dry_run",      # plan-mode preview completed
    "done",         # bounded run completed clean
    "failed",       # adapter error / nonzero exit
    "timed_out",    # killed at the Python-enforced timeout
    "blocked",      # pre/post validation refused (incl. prompt_hash_mismatch)
    "unavailable",  # runtime/adapter not usable
    "cancelled",    # operator aborted before execution
)
# invariant: RUNTIME_STATUSES ⊆ LIFECYCLE_STATUSES (lifecycle adds the
# orchestration-only states proposed/approved/cancelled).


@dataclass(frozen=True)
class AgentRunResult:
    """Immutable outcome of one agent run. Adapters return this; Python validates
    it. Paths point at write-once artifacts under agent_runs/<run_id>/."""

    run_id: str
    adapter_name: str
    status: str                      # one of RUNTIME_STATUSES (Python-recomputed)
    prompt_path: str
    cwd: str
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    stdout_path: Optional[str] = None
    stderr_path: Optional[str] = None
    summary_path: Optional[str] = None
    changed_files: tuple[str, ...] = ()
    exit_code: Optional[int] = None
    safety_notes: tuple[str, ...] = field(default_factory=tuple)

    def validate(self) -> None:
        if self.status not in RUNTIME_STATUSES:
            raise ValueError(
                f"status must be one of {RUNTIME_STATUSES}, got {self.status!r}")

    def to_record(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "adapter_name": self.adapter_name,
            "status": self.status,
            "prompt_path": self.prompt_path,
            "cwd": self.cwd,
            "started_at": self.started_at,
            "ended_at": self.ended_at,
            "stdout_path": self.stdout_path,
            "stderr_path": self.stderr_path,
            "summary_path": self.summary_path,
            "changed_files": list(self.changed_files),
            "exit_code": self.exit_code,
            "safety_notes": list(self.safety_notes),
        }

    @classmethod
    def from_record(cls, rec: dict[str, Any]) -> "AgentRunResult":
        return cls(
            run_id=rec.get("run_id", ""),
            adapter_name=rec.get("adapter_name", ""),
            status=rec.get("status", "unavailable"),
            prompt_path=rec.get("prompt_path", ""),
            cwd=rec.get("cwd", ""),
            started_at=rec.get("started_at"),
            ended_at=rec.get("ended_at"),
            stdout_path=rec.get("stdout_path"),
            stderr_path=rec.get("stderr_path"),
            summary_path=rec.get("summary_path"),
            changed_files=tuple(rec.get("changed_files") or ()),
            exit_code=rec.get("exit_code"),
            safety_notes=tuple(rec.get("safety_notes") or ()),
        )


@runtime_checkable
class AgentRuntimeAdapter(Protocol):
    """One bounded agent runtime. Implementations MUST NOT widen their own
    permissions: cwd, timeout, and mode are dictated by the caller, output is
    captured to the provided run_dir, and nothing external (send/collect/PDF/
    publish/git push) is ever performed by the adapter."""

    name: str

    def is_available(self) -> bool:
        """True if this runtime can run right now. MUST be cheap and side-effect
        free (no agent invocation; for CLI adapters, at most a presence check)."""
        ...

    def dry_run(self, prompt_path: Path, *, cwd: Path, timeout_s: int,
                run_dir: Path) -> AgentRunResult:
        """Plan-mode preview. Executes no edits; status dry_run/unavailable/failed."""
        ...

    def run(self, prompt_path: Path, *, cwd: Path, timeout_s: int, mode: str,
            run_dir: Path) -> AgentRunResult:
        """Execute one bounded run, capturing stdout/stderr/summary into run_dir."""
        ...

    def collect_result(self, run_id: str, *, run_dir: Path) -> AgentRunResult:
        """Re-read a finished run's captured artifacts into an AgentRunResult."""
        ...


# --- allowlisted adapter registry --------------------------------------------
# Only names here may be dispatched. claude_code_local is registered but is a
# STUB in M6-B (run/dry_run raise NotImplementedError("M6-C")).
def _build_registry() -> dict[str, "AgentRuntimeAdapter"]:
    # imported lazily inside the builder to keep import order simple and to avoid
    # any chance of an adapter import pulling in heavyweight deps at module load.
    from agent_adapters.claude_code_local import ClaudeCodeLocalAdapter
    from agent_adapters.mock_adapter import MockAdapter

    adapters: dict[str, AgentRuntimeAdapter] = {}
    for adapter in (MockAdapter(), ClaudeCodeLocalAdapter()):
        adapters[adapter.name] = adapter
    return adapters


ADAPTERS: dict[str, "AgentRuntimeAdapter"] = _build_registry()


def get_adapter(name: str) -> Optional["AgentRuntimeAdapter"]:
    return ADAPTERS.get(name)


def dispatch_agent_run(*, agent_name: str, stage: str, task_id: str,
                       adapter_name: str, prompt_path: Path, cwd: Path,
                       timeout_s: int, mode: str,
                       store_path: Path, agent_runs_path: Optional[Path] = None,
                       agent_runs_dir: Optional[Path] = None,
                       do_run: bool = False) -> dict[str, Any]:
    """SIGNATURE + CONTRACT ONLY (M6-B). The full pipeline lands in M6-C:

        1. agent_run_validator.validate_pre_run(...)   -> reject -> blocked report
        2. (operator approval is recorded by the adapter/orchestrator layer)
        3. adapter.is_available()                       -> unavailable report
        4. adapter.dry_run(...)                         -> spine record
        5. if do_run and dry-run clean: adapter.run(...) inside a per-run git
           worktree (.agent_worktrees/<run_id>) for edit isolation
        6. agent_run_validator.validate_post_run(...)   -> may force `blocked`
        7. append AgentRunResult to the agent_runs.jsonl spine
        8. return a formatter-ready result dict

    M6-D moved the real lifecycle into `agent_dispatch` (propose_agent_run /
    confirm_agent_run / dispatch_agent_run). This shim stays only to fail loudly
    if an old caller invokes the scaffold signature."""
    raise NotImplementedError(
        "dispatch_agent_run moved to agent_dispatch.dispatch_agent_run (M6-D): "
        "use agent_dispatch.propose_agent_run + confirm_agent_run.")
