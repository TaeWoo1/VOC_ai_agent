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


# --- pipeline display ordering (M-UX: formatting only) ---------------------

_PIPELINE = [
    "outreach:candidate_check",
    "outreach:candidate_shortlist_pick",
    "outreach:collect_plan",
    "outreach:collect_execute",
    "outreach:corpus_review",
    "outreach:angle_select",
    "outreach:draft_packet",
    "outreach:copy_qa",
    "outreach:render_pdf",
    "outreach:prepare_send",
]


def _scrambled_pipeline(parent="P1"):
    # Deliberately NOT in pipeline order (store/hash order).
    scrambled = [
        "outreach:copy_qa", "outreach:collect_plan", "outreach:candidate_check",
        "outreach:draft_packet", "outreach:collect_execute", "outreach:angle_select",
        "outreach:prepare_send", "outreach:render_pdf", "outreach:corpus_review",
        "outreach:candidate_shortlist_pick",
    ]
    return [_t(s, status="blocked", parent_task_id=parent) for s in scrambled]


def test_stage_sort_key_orders_cold_email_pipeline():
    tasks = _scrambled_pipeline()
    ordered = [t.intended_stage for t in fmt.order_tasks(tasks)]
    assert ordered == _PIPELINE


def test_create_result_renders_children_in_pipeline_order_and_numbered():
    tasks = _scrambled_pipeline("P1")
    summary = {"counts": {"blocked": 10}, "needs_approval": [], "blocked": [],
               "done": [], "artifacts": []}
    out = fmt.format_task_create_result("P1", tasks, summary)
    # numbering is present and in pipeline order
    assert "01 " in out and "10 " in out
    positions = [out.index(s) for s in _PIPELINE]
    assert positions == sorted(positions)
    assert out.index("01 ") < out.index("candidate_check")


def test_task_status_child_list_sorted_by_pipeline_stage():
    parent = _t(None, agent="OpsLoggerAgent", workflow="outreach")
    children = _scrambled_pipeline(parent.task_id)
    summary = {"counts": {}, "needs_approval": [], "blocked": [], "done": [],
               "artifacts": []}
    out = fmt.format_task_status(parent.task_id, [parent, *children], summary)
    positions = [out.index(s) for s in _PIPELINE]
    assert positions == sorted(positions)
    assert "01 " in out  # numbered child list


def test_unknown_stage_sorts_after_known_but_still_shown():
    parent = "P2"
    known = _t("outreach:draft_packet", status="blocked", parent_task_id=parent)
    unknown = _t("outreach:some_future_stage", status="blocked", parent_task_id=parent)
    ordered = fmt.order_tasks([unknown, known])
    assert ordered[0] is known and ordered[1] is unknown
    summary = {"counts": {}, "needs_approval": [], "blocked": [], "done": [],
               "artifacts": []}
    out = fmt.format_task_create_result(parent, [known, unknown], summary)
    assert "outreach:some_future_stage" in out  # never dropped
    assert out.index("draft_packet") < out.index("some_future_stage")


def test_clarification_floats_to_top_only_when_sole_active_blocker():
    parent = "P3"
    # sole active blocker -> clarification first
    clar = _t("ops:clarification", agent="RecipientAgent", status="blocked",
              parent_task_id=parent, inputs={"reason": "ambiguous"})
    done_stage = _t("outreach:candidate_check", status="done", parent_task_id=parent)
    ordered = fmt.order_tasks([done_stage, clar])
    assert ordered[0] is clar
    # but with other active work, clarification sits after workflow stages
    active_stage = _t("outreach:draft_packet", status="blocked", parent_task_id=parent)
    ordered2 = fmt.order_tasks([clar, active_stage])
    assert ordered2[0] is active_stage and ordered2[1] is clar


def test_instagram_pipeline_order():
    parent = "P4"
    stages = ["instagram:render", "instagram:collection", "instagram:manuscript",
              "instagram:product_detail_context", "instagram:cardnews_content_packet",
              "instagram:cardnews_plan"]
    tasks = [_t(s, agent="InstagramCardnewsAgent", workflow="instagram",
                status="blocked", parent_task_id=parent) for s in stages]
    ordered = [t.intended_stage for t in fmt.order_tasks(tasks)]
    assert ordered == [
        "instagram:collection", "instagram:product_detail_context",
        "instagram:cardnews_content_packet", "instagram:manuscript",
        "instagram:render", "instagram:cardnews_plan",
    ]


def _tg(stage, goal, parent):
    return Task(goal=goal, assigned_agent="FollowupAgent", intended_stage=stage,
                status="blocked", parent_task_id=parent)


def test_format_tasks_groups_by_graph_then_pipeline_stage():
    # /tasks shows the goal (not the stage); use distinct goals as the observable
    # signal. Two graphs interleaved in store order must come out grouped +
    # pipeline-ordered within each graph.
    rows = [
        _tg("outreach:copy_qa", "G1 copy qa", "G1"),
        _tg("outreach:draft_packet", "G2 draft", "G2"),
        _tg("outreach:candidate_check", "G1 candidate", "G1"),
        _tg("outreach:collect_plan", "G2 collect", "G2"),
    ]
    out = fmt.format_tasks(rows)
    # each graph stays contiguous (G1 rows before any G2 row, since G1<G2)
    assert out.index("G1 candidate") < out.index("G1 copy qa") < out.index("G2 collect")
    assert out.index("G2 collect") < out.index("G2 draft")
