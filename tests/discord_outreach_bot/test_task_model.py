"""task_model: validation, (de)serialization, vocab. Pure, no I/O."""

from __future__ import annotations

import pytest
import task_model as tm
from task_model import Task, TaskRequest


def test_task_request_roundtrip_and_validate():
    req = TaskRequest(goal="prepare cold email", source="test", requested_by="op",
                      raw_text="…", target_ref="에스네이처", slots={"k": 1})
    req.validate()
    rec = req.to_record()
    back = TaskRequest.from_record(rec)
    assert back.goal == req.goal and back.slots == {"k": 1}
    assert rec["request_id"].startswith("req_") and rec["ts_utc"].endswith("Z")


def test_task_request_rejects_bad_vocab():
    with pytest.raises(ValueError):
        TaskRequest(goal="x", workflow="nope").validate()
    with pytest.raises(ValueError):
        TaskRequest(goal="x", source="bogus").validate()
    with pytest.raises(ValueError):
        TaskRequest(goal="").validate()


def test_task_roundtrip():
    t = Task(goal="g", assigned_agent="FollowupAgent", intended_stage="outreach:follow_up",
             gate="red", approval_required=True, dependencies=["a", "b"])
    t.validate()
    back = Task.from_record(t.to_record())
    assert back.task_id == t.task_id
    assert back.dependencies == ["a", "b"]
    assert back.gate == "red"


def test_task_validation_rules():
    with pytest.raises(ValueError):  # no agent
        Task(goal="g").validate()
    with pytest.raises(ValueError):  # bad status
        Task(goal="g", assigned_agent="X", status="weird").validate()
    with pytest.raises(ValueError):  # red without approval_required
        Task(goal="g", assigned_agent="X", gate="red", approval_required=False).validate()


def test_red_requires_approval_required():
    ok = Task(goal="g", assigned_agent="X", gate="red", approval_required=True)
    ok.validate()  # no raise


def test_gen_id_unique_and_prefixed():
    ids = {tm.gen_id("task") for _ in range(200)}
    assert len(ids) == 200
    assert all(i.startswith("task_") for i in ids)


def test_touch_updates_timestamp():
    import datetime as dt

    def fixed():
        return dt.datetime(2030, 1, 1, tzinfo=dt.timezone.utc)

    t = Task(goal="g", assigned_agent="X")
    t.touch(fixed)
    assert t.updated_at == "2030-01-01T00:00:00Z"


def test_is_terminal():
    assert Task(goal="g", assigned_agent="X", status="done").is_terminal()
    assert not Task(goal="g", assigned_agent="X", status="queued").is_terminal()
