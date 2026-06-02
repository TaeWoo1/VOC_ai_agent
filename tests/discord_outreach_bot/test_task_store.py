"""task_store: append-only snapshot store, last-wins fold, filters. tmp only."""

from __future__ import annotations

import task_store as ts
from task_model import Task


def _t(agent="FollowupAgent", **kw):
    return Task(goal="g", assigned_agent=agent, **kw)


def test_append_and_load_latest_wins(tmp_path):
    p = tmp_path / "tasks.jsonl"
    t = _t(target_slug="snature")
    ts.append_task_snapshot(t, p)
    t.status = "blocked"
    t.touch()
    ts.append_task_snapshot(t, p)         # second snapshot, same task_id
    loaded = ts.load_tasks(p)
    assert len(loaded) == 1               # folded to one
    assert loaded[0].status == "blocked"  # latest wins
    # append-only: the file has BOTH lines
    assert len(p.read_text(encoding="utf-8").splitlines()) == 2


def test_get_task_and_missing(tmp_path):
    p = tmp_path / "tasks.jsonl"
    t = _t()
    ts.append_task_snapshot(t, p)
    assert ts.get_task(t.task_id, p).task_id == t.task_id
    assert ts.get_task("does-not-exist", p) is None


def test_list_tasks_filters(tmp_path):
    p = tmp_path / "tasks.jsonl"
    a = _t(agent="FollowupAgent", workflow="outreach", status="queued")
    b = _t(agent="InstagramCardnewsAgent", workflow="instagram", status="done")
    c = _t(agent="FollowupAgent", workflow="outreach", status="needs_approval",
           parent_task_id="P1")
    for t in (a, b, c):
        ts.append_task_snapshot(t, p)
    assert {t.task_id for t in ts.list_tasks(p, workflow="instagram")} == {b.task_id}
    assert {t.task_id for t in ts.list_tasks(p, status="needs_approval")} == {c.task_id}
    assert {t.task_id for t in ts.list_tasks(p, parent_task_id="P1")} == {c.task_id}
    assert {t.task_id for t in ts.list_tasks(p, assigned_agent="FollowupAgent")} == {
        a.task_id, c.task_id}


def test_load_empty_and_dir_creation(tmp_path):
    nested = tmp_path / "deep" / "tasks.jsonl"
    assert ts.load_tasks(nested) == []        # absent -> []
    ts.append_task_snapshot(_t(), nested)     # creates parent dirs
    assert nested.exists() and len(ts.load_tasks(nested)) == 1
