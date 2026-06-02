"""orchestration_events: required fields, vocab guard, append-only. tmp only."""

from __future__ import annotations

import datetime as dt

import orchestration_events as ev
import pytest

REQUIRED = {
    "event_id", "ts_utc", "event_type", "source", "requested_by", "operator_discord_id",
    "task_id", "parent_task_id", "workflow", "target_slug", "current_state",
    "intended_stage", "gate", "status", "message",
}


def _fixed():
    return dt.datetime(2026, 6, 1, 12, 0, 0, tzinfo=dt.timezone.utc)


def test_make_event_has_all_required_fields():
    e = ev.make_event(event_type="task_created", source="test", task_id="t1",
                      workflow="outreach", gate="green", status="queued", now=_fixed)
    assert set(e) == REQUIRED
    assert e["ts_utc"] == "2026-06-01T12:00:00Z"
    assert e["event_id"]  # non-empty


def test_invalid_event_type_rejected():
    with pytest.raises(ValueError):
        ev.make_event(event_type="not_a_type")


def test_append_and_read_append_only(tmp_path):
    p = tmp_path / "events.jsonl"
    for et in ("task_created", "approval_requested", "task_done"):
        ev.append_event(ev.make_event(event_type=et, task_id="t1"), p)
    recs = ev.read_events(p)
    assert [r["event_type"] for r in recs] == ["task_created", "approval_requested", "task_done"]
    assert len(p.read_text(encoding="utf-8").splitlines()) == 3


def test_read_missing_returns_empty(tmp_path):
    assert ev.read_events(tmp_path / "nope.jsonl") == []
