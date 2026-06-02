"""M6-B: append-only spine for agent runtime runs (SCAFFOLD).

Same storage model as task_runs.py / task_store.py: every state transition appends
ONE full JSON record to agent_runs.jsonl; the current view folds the file keeping
the LAST record per `run_id`. There is no update/delete path by construction —
cleanup of a run *directory* appends a terminal record, it never rewrites history.

Two artifact homes (kept distinct, both gitignored):
  - agent_runs.jsonl                  -> this append-only spine (the audit log)
  - agent_runs/<run_id>/              -> write-once bulky artifacts (stdout.log,
                                         stderr.log, summary.md, result.json,
                                         changed_files.txt, diff.patch, prompt.md)

This module writes ONLY the spine path passed to it. It never touches a packet's
status.json / send_log.md, runs no process, and makes no network call.
"""

from __future__ import annotations

import datetime as _dt
import json
from pathlib import Path
from typing import Any, Callable, Optional

from agent_runtime import RUNTIME_STATUSES

_DEFAULT_SPINE_NAME = "agent_runs.jsonl"
_DEFAULT_RUNS_DIRNAME = "agent_runs"


def find_repo_root(start: Optional[Path] = None) -> Path:
    here = (start or Path(__file__)).resolve()
    for parent in [here, *here.parents]:
        if (parent / ".git").exists() or (parent / "CLAUDE.md").exists():
            return parent
    return Path(__file__).resolve().parents[2]


def default_agent_runs_path(repo_root: Optional[Path] = None) -> Path:
    root = repo_root or find_repo_root()
    return root / "ops" / "discord_outreach_bot" / _DEFAULT_SPINE_NAME


def default_agent_runs_dir(repo_root: Optional[Path] = None) -> Path:
    root = repo_root or find_repo_root()
    return root / "ops" / "discord_outreach_bot" / _DEFAULT_RUNS_DIRNAME


def run_dir_for(run_id: str, runs_dir: Optional[Path] = None) -> Path:
    """The write-once artifact directory for one run_id."""
    base = Path(runs_dir) if runs_dir else default_agent_runs_dir()
    return base / run_id


def _utc_stamp(now: Optional[Callable[[], _dt.datetime]] = None) -> str:
    ts = now() if now else _dt.datetime.now(_dt.timezone.utc)
    return ts.astimezone(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def make_run_record(
    *,
    run_id: str,
    adapter_name: str,
    agent_name: str,
    stage: str,
    task_id: str,
    status: str,
    mode: Optional[str] = None,
    prompt_path: Optional[str] = None,
    cwd: Optional[str] = None,
    stdout_path: Optional[str] = None,
    stderr_path: Optional[str] = None,
    summary_path: Optional[str] = None,
    changed_files: Optional[list[str]] = None,
    exit_code: Optional[int] = None,
    safety_notes: Optional[list[str]] = None,
    started_at: Optional[str] = None,
    ended_at: Optional[str] = None,
    now: Optional[Callable[[], _dt.datetime]] = None,
) -> dict[str, Any]:
    """Build one agent-run record (does not write it). Schema is fixed."""
    if status not in RUNTIME_STATUSES:
        raise ValueError(f"status must be one of {RUNTIME_STATUSES}, got {status!r}")
    stamp = _utc_stamp(now)
    return {
        "run_id": run_id,
        "adapter_name": adapter_name,
        "agent_name": agent_name,
        "stage": stage,
        "task_id": task_id,
        "status": status,
        "mode": mode,
        "prompt_path": prompt_path,
        "cwd": cwd,
        "stdout_path": stdout_path,
        "stderr_path": stderr_path,
        "summary_path": summary_path,
        "changed_files": changed_files or [],
        "exit_code": exit_code,
        "safety_notes": safety_notes or [],
        "started_at": started_at,
        "ended_at": ended_at,
        "recorded_at": stamp,
    }


def append_run(record: dict[str, Any], agent_runs_path: Optional[Path] = None) -> Path:
    """Append one record as a JSONL line. Append-only: never truncates."""
    path = Path(agent_runs_path) if agent_runs_path else default_agent_runs_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, ensure_ascii=False, sort_keys=False)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")
    return path


def read_runs(agent_runs_path: Optional[Path] = None) -> list[dict[str, Any]]:
    """Read all records in append order. Returns [] if the spine is absent."""
    path = Path(agent_runs_path) if agent_runs_path else default_agent_runs_path()
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if not raw:
            continue
        try:
            out.append(json.loads(raw))
        except json.JSONDecodeError:
            continue  # skip a corrupt line rather than crash the whole view
    return out


def fold_runs_by_run_id(
    agent_runs_path: Optional[Path] = None) -> dict[str, dict[str, Any]]:
    """Current view: last record wins per run_id, in order of last appearance."""
    latest: dict[str, dict[str, Any]] = {}
    for rec in read_runs(agent_runs_path):
        rid = rec.get("run_id")
        if rid is None:
            continue
        latest.pop(rid, None)
        latest[rid] = rec
    return latest


def get_run(run_id: str, agent_runs_path: Optional[Path] = None
            ) -> Optional[dict[str, Any]]:
    return fold_runs_by_run_id(agent_runs_path).get(run_id)
