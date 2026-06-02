"""task_runs: append-only run log. tmp only."""

from __future__ import annotations

import datetime as dt

import pytest
import task_runs as tr

REQUIRED = {
    "run_id", "task_id", "approval_ref", "prompt_hash", "runner_action", "status",
    "files_created", "files_modified", "rollback_plan", "codex_review_status",
    "started_at", "finished_at", "failure_reason", "dry_run_preview",
}


def _fixed():
    return dt.datetime(2026, 6, 8, 9, 0, 0, tzinfo=dt.timezone.utc)


def test_make_run_record_has_all_fields():
    r = tr.make_run_record(task_id="task_1", runner_action="scaffold_packet",
                           status="dry_run", now=_fixed)
    assert set(r) == REQUIRED
    assert r["run_id"].startswith("run_") and r["started_at"] == "2026-06-08T09:00:00Z"
    assert r["status"] == "dry_run" and r["codex_review_status"] == "n/a"


def test_invalid_status_and_review_rejected():
    with pytest.raises(ValueError):
        tr.make_run_record(task_id="t", runner_action="x", status="bogus")
    with pytest.raises(ValueError):
        tr.make_run_record(task_id="t", runner_action="x", status="dry_run",
                           codex_review_status="maybe")


def test_append_read_append_only(tmp_path):
    p = tmp_path / "task_runs.jsonl"
    for st in ("dry_run", "dry_run", "failed"):
        tr.append_run(tr.make_run_record(task_id="t", runner_action="scaffold_packet",
                                         status=st), p)
    recs = tr.read_runs(p)
    assert [r["status"] for r in recs] == ["dry_run", "dry_run", "failed"]
    assert len(p.read_text(encoding="utf-8").splitlines()) == 3


def test_find_latest_run(tmp_path):
    p = tmp_path / "task_runs.jsonl"
    tr.append_run(tr.make_run_record(task_id="a", runner_action="scaffold_packet",
                                     status="dry_run"), p)
    tr.append_run(tr.make_run_record(task_id="a", runner_action="scaffold_packet",
                                     status="failed"), p)
    tr.append_run(tr.make_run_record(task_id="b", runner_action="scaffold_packet",
                                     status="dry_run"), p)
    assert tr.find_latest_run("a", runs_path=p)["status"] == "failed"
    assert tr.find_latest_run("a", status="dry_run", runs_path=p)["status"] == "dry_run"
    assert tr.find_latest_run("missing", runs_path=p) is None


def test_read_missing_returns_empty(tmp_path):
    assert tr.read_runs(tmp_path / "nope.jsonl") == []
