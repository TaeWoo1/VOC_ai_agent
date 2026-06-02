"""task_formatting: pure Discord string builders. No discord.py, no I/O."""

from __future__ import annotations

import task_formatting as fmt
from task_model import Task


def _t(stage, agent="FollowupAgent", **kw):
    return Task(goal="do a thing", assigned_agent=agent, intended_stage=stage, **kw)


def test_format_tasks_lists_and_filters():
    tasks = [
        _t("outreach:follow_up", status="needs_approval", gate="red",
           approval_required=True, target_slug="snature_x"),
        _t("instagram:cardnews_plan", agent="InstagramCardnewsAgent",
           workflow="instagram", status="done"),
    ]
    out = fmt.format_tasks(tasks)
    assert "Tasks (2" in out and "snature_x" in out and "🔴" in out and "🟢" in out
    only = fmt.format_tasks(tasks, status="done")
    assert "instagram:cardnews_plan" not in only  # goal shown, not stage, but...
    assert "InstagramCardnewsAgent" in only and "needs_approval" not in only
    assert "No orchestration tasks" in fmt.format_tasks([])


def test_format_task_status_shows_blockers_and_approval():
    parent = _t(None, agent="OpsLoggerAgent", workflow="outreach")
    child_red = _t("outreach:follow_up", status="needs_approval", gate="red",
                   approval_required=True, parent_task_id=parent.task_id,
                   target_slug="snature_x")
    summary = {
        "counts": {"needs_approval": 1}, "blocked": [],
        "needs_approval": [{"task_id": child_red.task_id, "agent": "FollowupAgent",
                            "intended_stage": "outreach:follow_up", "gate": "red"}],
        "done": [], "artifacts": ["/tmp/gen/x.md"],
    }
    out = fmt.format_task_status(parent.task_id, [parent, child_red], summary)
    assert "needs approval" in out and "/task_approve" in out
    assert "artifacts" in out and "/tmp/gen/x.md" in out


def test_format_task_create_result_flags_clarification_send_warning():
    clar = _t("ops:clarification", agent="RecipientAgent", status="blocked",
              gate="red", approval_required=True,
              inputs={"reason": "ambiguous target/action"})
    summary = {"counts": {"blocked": 1}, "needs_approval": [], "blocked": [clar.task_id],
               "done": [], "artifacts": []}
    out = fmt.format_task_create_result(clar.task_id, [clar], summary)
    assert "Clarification needed" in out
    assert "🔴 gate" in out and "never auto-executed" in out
    assert "propose-only" in out


def test_green_operator_decision_task_labelled_distinctly():
    # a GREEN gate that still needs an operator decision (e.g. candidate pick)
    pick = _t("outreach:candidate_shortlist_pick", agent="CandidateResearchAgent",
              status="needs_approval", gate="green", approval_required=True,
              parent_task_id="P1")
    # 1) in the task list it shows 🟡 (operator-decision), NOT a bare 🟢
    row = fmt.format_tasks([pick])
    assert "🟡" in row and "needs_approval" in row
    # 2) in the create result the approval block calls it operator-decision +
    #    states intent-only / not external execution
    summary = {"counts": {"needs_approval": 1}, "needs_approval": [
        {"task_id": pick.task_id, "agent": "CandidateResearchAgent",
         "intended_stage": "outreach:candidate_shortlist_pick", "gate": "green"}],
        "blocked": [], "done": [], "artifacts": []}
    out = fmt.format_task_create_result(pick.task_id, [pick], summary)
    assert "operator-decision" in out
    assert "records intent only" in out and "NOT external execution" in out
    assert "/task_approve" in out


def test_red_gate_label_distinct_from_green_decision():
    summary = {"counts": {}, "blocked": [], "done": [], "artifacts": [],
               "needs_approval": [{"task_id": "task_r", "agent": "FollowupAgent",
                                   "intended_stage": "outreach:follow_up", "gate": "red"}]}
    parent = _t(None, agent="OpsLoggerAgent")
    out = fmt.format_task_status(parent.task_id, [parent], summary)
    assert "🔴 red gate" in out                       # red shown as red gate
    assert "operator-decision" not in out             # not mislabelled


def test_format_agent_status_all_nine_and_boundaries():
    out = fmt.format_agent_status()
    assert "Registered agents (9)" in out
    assert "OpsLoggerAgent" in out and "writes-logs" in out
    # a non-logger agent shows read-only
    assert "read-only" in out


def test_format_approval_and_cancel():
    ok = fmt.format_approval_result({"ok": True, "task_id": "task_1", "approval_ref": "r1"})
    assert "intent only" in ok and "NOT executed" in ok and "task_1" in ok
    bad = fmt.format_approval_result({"ok": False, "message": "nope"})
    assert "nope" in bad
    c = fmt.format_cancel_result(_t("outreach:packet_revision", status="cancelled"))
    assert "Cancelled" in c and "No packet files touched" in c
