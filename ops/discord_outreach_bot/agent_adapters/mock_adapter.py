"""M6-B: hermetic mock agent runtime adapter (AI-SCAFFOLD).

Deterministic, fully offline test double for `agent_runtime.AgentRuntimeAdapter`.
It NEVER spawns a subprocess, opens a socket, or touches the network — it just
writes canned stdout/stderr/summary artifacts under the provided run_dir and
returns an `AgentRunResult`. Outcome is controlled by constructor config or by a
`[[MOCK:...]]` marker inside the prompt file, so tests can exercise done / failed
/ timed_out / blocked and the validator gates without any real runtime.

Needs no ANTHROPIC_API_KEY and reads no env.
"""

from __future__ import annotations

import datetime as _dt
import json
from pathlib import Path

from agent_runtime import AgentRunResult

_MARKER_PREFIX = "[[MOCK:"  # e.g. [[MOCK:failed]] / [[MOCK:timed_out]] / [[MOCK:blocked]]
_VALID_OUTCOMES = ("done", "failed", "timed_out", "blocked")


def _stamp() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class MockAdapter:
    """Configurable hermetic adapter.

    outcome:        one of done/failed/timed_out/blocked (default "done").
    sim_duration_s: pretend the run "would take" this long; if it exceeds the
                    caller's timeout_s the run resolves to timed_out (no real sleep).
    changed_files:  files the run "touched" (relative paths); used by the post-run
                    validator. Default a single allowed draft artifact.
    summary:        summary.md body (can be set to claim an external action so the
                    post-run validator blocks it).
    available:      what is_available() returns.
    """

    def __init__(self, name: str = "mock_adapter", *, outcome: str = "done",
                 sim_duration_s: int = 0,
                 changed_files: tuple[str, ...] = (
                     "ops/discord_outreach_bot/generated_prompts/mock_draft.md",),
                 summary: str = "후보군 요약 초안을 작성했습니다 (실행 아님).",
                 stdout: str = "[mock] agent reasoning...\n",
                 stderr: str = "",
                 available: bool = True) -> None:
        if outcome not in _VALID_OUTCOMES:
            raise ValueError(f"outcome must be one of {_VALID_OUTCOMES}")
        self.name = name
        self._outcome = outcome
        self._sim_duration_s = sim_duration_s
        self._changed_files = tuple(changed_files)
        self._summary = summary
        self._stdout = stdout
        self._stderr = stderr
        self._available = available

    # --- interface -----------------------------------------------------------
    def is_available(self) -> bool:
        return self._available

    def _resolve_outcome(self, prompt_text: str, timeout_s: int) -> str:
        for line in prompt_text.splitlines():
            line = line.strip()
            if line.startswith(_MARKER_PREFIX) and line.endswith("]]"):
                marker = line[len(_MARKER_PREFIX):-2].strip()
                if marker in _VALID_OUTCOMES:
                    return marker
        if self._sim_duration_s and self._sim_duration_s > timeout_s:
            return "timed_out"
        return self._outcome

    def _read_prompt(self, prompt_path: Path) -> str:
        try:
            return Path(prompt_path).read_text(encoding="utf-8")
        except OSError:
            return ""

    def dry_run(self, prompt_path: Path, *, cwd: Path, timeout_s: int,
                run_dir: Path) -> AgentRunResult:
        run_dir = Path(run_dir)
        run_dir.mkdir(parents=True, exist_ok=True)
        started = _stamp()
        stdout_path = run_dir / "stdout.log"
        stdout_path.write_text(
            f"[mock dry_run / plan-mode]\nprompt={Path(prompt_path).name}\n"
            "would-execute: nothing (preview only)\n", encoding="utf-8")
        return AgentRunResult(
            run_id=run_dir.name, adapter_name=self.name, status="dry_run",
            prompt_path=str(prompt_path), cwd=str(cwd), started_at=started,
            ended_at=_stamp(), stdout_path=str(stdout_path), exit_code=0,
            safety_notes=("dry_run: plan-mode, no edits",))

    def run(self, prompt_path: Path, *, cwd: Path, timeout_s: int, mode: str,
            run_dir: Path) -> AgentRunResult:
        run_dir = Path(run_dir)
        run_dir.mkdir(parents=True, exist_ok=True)
        started = _stamp()
        prompt_text = self._read_prompt(prompt_path)
        outcome = self._resolve_outcome(prompt_text, timeout_s)

        stdout_path = run_dir / "stdout.log"
        stderr_path = run_dir / "stderr.log"
        summary_path = run_dir / "summary.md"

        if outcome == "timed_out":
            stdout_path.write_text(self._stdout + "[mock] ...(partial)\n",
                                   encoding="utf-8")
            stderr_path.write_text("[mock] killed at timeout\n", encoding="utf-8")
            return self._finish(run_dir, "timed_out", prompt_path, cwd, started,
                                stdout_path, stderr_path, None, exit_code=None,
                                changed=(),
                                notes=(f"timed_out: sim_duration_s="
                                       f"{self._sim_duration_s} > timeout_s={timeout_s}",))

        if outcome == "failed":
            stdout_path.write_text(self._stdout, encoding="utf-8")
            stderr_path.write_text(self._stderr or "[mock] error: simulated failure\n",
                                   encoding="utf-8")
            return self._finish(run_dir, "failed", prompt_path, cwd, started,
                                stdout_path, stderr_path, None, exit_code=1,
                                changed=(), notes=("failed: simulated nonzero exit",))

        # done or blocked both "complete"; blocked self-reports via status, but the
        # authoritative block decision is the post-run validator (changed_files /
        # external claims). We still let the adapter mark blocked when asked.
        stdout_path.write_text(self._stdout + "[mock] done\n", encoding="utf-8")
        if self._stderr:
            stderr_path.write_text(self._stderr, encoding="utf-8")
        summary_path.write_text(self._summary + "\n", encoding="utf-8")
        status = "blocked" if outcome == "blocked" else "done"
        notes = ("blocked: simulated out-of-scope result",) if outcome == "blocked" else ()
        return self._finish(run_dir, status, prompt_path, cwd, started, stdout_path,
                            stderr_path if self._stderr else None, summary_path,
                            exit_code=0, changed=self._changed_files, notes=notes)

    def collect_result(self, run_id: str, *, run_dir: Path) -> AgentRunResult:
        run_dir = Path(run_dir)
        result_json = run_dir / "result.json"
        if result_json.exists():
            return AgentRunResult.from_record(
                json.loads(result_json.read_text(encoding="utf-8")))
        # minimal reconstruction if result.json is absent
        return AgentRunResult(run_id=run_id, adapter_name=self.name,
                              status="unavailable", prompt_path="", cwd=str(run_dir))

    # --- helper --------------------------------------------------------------
    def _finish(self, run_dir: Path, status: str, prompt_path, cwd, started,
                stdout_path, stderr_path, summary_path, *, exit_code, changed,
                notes) -> AgentRunResult:
        result = AgentRunResult(
            run_id=run_dir.name, adapter_name=self.name, status=status,
            prompt_path=str(prompt_path), cwd=str(cwd), started_at=started,
            ended_at=_stamp(),
            stdout_path=str(stdout_path) if stdout_path else None,
            stderr_path=str(stderr_path) if stderr_path else None,
            summary_path=str(summary_path) if summary_path else None,
            changed_files=changed, exit_code=exit_code, safety_notes=notes)
        (run_dir / "result.json").write_text(
            json.dumps(result.to_record(), ensure_ascii=False), encoding="utf-8")
        if changed:
            (run_dir / "changed_files.txt").write_text(
                "\n".join(changed) + "\n", encoding="utf-8")
        return result
