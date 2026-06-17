"""Append-only review log for CodexReviewAgent verdicts (v0.3 M3-C).

The authoritative record of every post-run scaffold review: one JSON object per
line. Same append-only discipline as task_runs.py / orchestration_events.py —
no update/delete path. Writing a review record has NO side effects beyond this
log: it never deletes, mutates, sends, collects, renders, or commits. The
verdict it carries gates `task_done`, but the run fold (task_runs.jsonl) holds
the machine-checked `codex_review_status`; this log holds the full findings.
"""

from __future__ import annotations

import datetime as _dt
import json
import uuid
from pathlib import Path
from typing import Any, Callable, Optional

REVIEW_STATUSES = ("pass", "fail")
RECOMMENDED_ACTIONS = ("accept", "rollback", "manual_review")
REVIEWER = "CodexReviewAgent"

_DEFAULT_NAME = "codex_reviews.jsonl"


def find_repo_root(start: Optional[Path] = None) -> Path:
    here = (start or Path(__file__)).resolve()
    for parent in [here, *here.parents]:
        if (parent / ".git").exists() or (parent / "CLAUDE.md").exists():
            return parent
    return Path(__file__).resolve().parents[2]


def default_reviews_path(repo_root: Optional[Path] = None) -> Path:
    root = repo_root or find_repo_root()
    return root / "ops" / "discord_outreach_bot" / _DEFAULT_NAME


def new_review_id() -> str:
    return f"rev_{uuid.uuid4().hex[:12]}"


def make_review_record(
    *,
    run_id: str,
    task_id: Optional[str],
    status: str,
    findings: list[dict[str, Any]],
    files_checked: Optional[list[str]] = None,
    recommended_action: str,
    review_id: Optional[str] = None,
    now: Optional[Callable[[], _dt.datetime]] = None,
) -> dict[str, Any]:
    """Build one review record (does not write it). Schema is fixed."""
    if status not in REVIEW_STATUSES:
        raise ValueError(f"status must be one of {REVIEW_STATUSES}, got {status!r}")
    if recommended_action not in RECOMMENDED_ACTIONS:
        raise ValueError(
            f"recommended_action must be one of {RECOMMENDED_ACTIONS}, "
            f"got {recommended_action!r}")
    ts = now() if now else _dt.datetime.now(_dt.timezone.utc)
    stamp = ts.astimezone(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "review_id": review_id or new_review_id(),
        "run_id": run_id,
        "task_id": task_id,
        "reviewer": REVIEWER,
        "status": status,
        "findings": findings or [],
        "files_checked": files_checked or [],
        "recommended_action": recommended_action,
        "created_at": stamp,
    }


def append_review(record: dict[str, Any], reviews_path: Optional[Path] = None) -> Path:
    """Append one review record as a JSONL line. Append-only: never truncates."""
    path = Path(reviews_path) if reviews_path else default_reviews_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, ensure_ascii=False, sort_keys=False)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")
    return path


def read_reviews(reviews_path: Optional[Path] = None) -> list[dict[str, Any]]:
    """Read all review records. Returns [] if the log is absent."""
    path = Path(reviews_path) if reviews_path else default_reviews_path()
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if raw:
            out.append(json.loads(raw))
    return out


def find_latest_review_for_run(run_id: str,
                               reviews_path: Optional[Path] = None
                               ) -> Optional[dict[str, Any]]:
    """Latest review record for a run_id. None if never reviewed."""
    matches = [r for r in read_reviews(reviews_path) if r.get("run_id") == run_id]
    return matches[-1] if matches else None
