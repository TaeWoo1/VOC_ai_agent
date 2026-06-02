"""orchestrator: request → task DAG, gate halting, and safety invariants.

All state lives in tmp_path (task store, events, approvals, generated prompts).
A synthetic SENT packet is built in a tmp targets dir; real packet folders are
never written. No Discord, no network, no Chrome.
"""

from __future__ import annotations

import json

import orchestrator as orch
import task_store as ts
from agent_registry import AGENTS
from task_model import TaskRequest


# --- fixtures ----------------------------------------------------------------
def _paths(tmp_path):
    return {
        "store_path": tmp_path / "orchestration_tasks.jsonl",
        "events_path": tmp_path / "orchestration_events.jsonl",
    }


def _sent_targets(tmp_path):
    """A tmp targets dir holding one SENT snature packet (status.json only)."""
    tdir = tmp_path / "targets"
    pdir = tdir / "snature_aqua_squalane_cream_v1"
    pdir.mkdir(parents=True)
    (pdir / "status.json").write_text(json.dumps({
        "brand": "에스네이처 (S.NATURE)", "goods_no": "A000000156230",
        "slug": "snature_aqua_squalane_cream_v1", "state": "SENT",
        "send": {"recipient_primary": "mkt@snature.kr",
                 "sent_time": "2026-06-01 11:00 KST", "follow_up_due": "2026-06-08"},
        "response": None,
    }, ensure_ascii=False), encoding="utf-8")
    return tdir, pdir / "status.json"


def _req(goal, **kw):
    kw.setdefault("source", "test")
    kw.setdefault("requested_by", "op1")
    kw.setdefault("raw_text", goal)
    return TaskRequest(goal=goal, **kw)


# --- Example A: cold-email pipeline, do NOT send -----------------------------
def test_A_cold_email_pipeline_plan_and_advance(tmp_path):
    p = _paths(tmp_path)
    req = _req("다음 브랜드 하나 골라서 콜드메일까지 준비해줘. 보내지는 마.")
    tasks = orch.plan(req)
    assert orch._classify(req) == "cold_email_pipeline"
    stages = [t.intended_stage for t in tasks]
    # parent (None) + 10 children, in order, NO mark_sent
    assert stages[0] is None
    assert "outreach:mark_sent" not in stages
    assert stages[1:] == [
        "outreach:candidate_check", "outreach:candidate_shortlist_pick",
        "outreach:collect_plan", "outreach:collect_execute", "outreach:corpus_review",
        "outreach:angle_select", "outreach:draft_packet", "outreach:copy_qa",
        "outreach:render_pdf", "outreach:prepare_send",
    ]
    # red gates exactly on the gated stages
    red = {t.intended_stage for t in tasks if t.gate == "red"}
    assert red == {"outreach:collect_execute", "outreach:angle_select",
                   "outreach:render_pdf", "outreach:prepare_send"}

    parent_id = orch.create_task_graph_for_request(req, **p)
    summary = orch.advance(parent_id, **p)
    # only candidate_research auto-completes; shortlist waits; rest blocked
    assert summary["counts"].get("done") == 1
    assert summary["counts"].get("needs_approval") == 1
    assert summary["counts"].get("blocked") == 8
    assert summary["root_status"] == "running"


# --- Example B: follow-up draft only, red gate -------------------------------
def test_B_followup_needs_approval_and_produces_draft(tmp_path):
    p = _paths(tmp_path)
    tdir, _ = _sent_targets(tmp_path)
    req = _req("에스네이처 답장 없으면 팔로업 초안 만들어줘.")
    assert orch._classify(req) == "follow_up"
    parent_id = orch.create_task_graph_for_request(req, targets_dir=tdir, **p)
    summary = orch.advance(parent_id, targets_dir=tdir, **p)

    task = ts.get_task(parent_id, p["store_path"])
    assert task.target_slug == "snature_aqua_squalane_cream_v1"
    assert task.intended_stage == "outreach:follow_up"
    assert task.gate == "red" and task.approval_required is True
    assert task.status == "needs_approval"
    # the draft (inert text) WAS produced as an artifact
    assert task.artifact_paths and "outreach:follow_up" in \
        open(task.artifact_paths[0], encoding="utf-8").read()
    assert summary["counts"].get("needs_approval") == 1


def test_B_approval_then_done_lifecycle(tmp_path):
    p = _paths(tmp_path)
    tdir, _ = _sent_targets(tmp_path)
    req = _req("에스네이처 답장 없으면 팔로업 초안 만들어줘.")
    parent_id = orch.create_task_graph_for_request(req, targets_dir=tdir, **p)
    orch.advance(parent_id, targets_dir=tdir, **p)

    approvals = tmp_path / "approvals.log.jsonl"
    res = orch.record_task_approval(parent_id, operator_discord_id="606",
                                    approvals_path=approvals, targets_dir=tdir, **p)
    assert res["ok"] and res["approval_ref"]
    t = ts.get_task(parent_id, p["store_path"])
    assert t.status == "queued" and t.approval_ref  # approved, awaiting MANUAL run
    # approval was recorded in the separate append-only approvals log
    assert len(approvals.read_text(encoding="utf-8").splitlines()) == 1
    # re-advancing does NOT auto-execute the red action (stays queued)
    orch.advance(parent_id, targets_dir=tdir, **p)
    assert ts.get_task(parent_id, p["store_path"]).status == "queued"
    # now it can be marked done (it has an approval_ref)
    orch.mark_task_done(parent_id, result_summary="manually sent", **p)
    assert ts.get_task(parent_id, p["store_path"]).status == "done"


# --- Example C: packet revision ----------------------------------------------
def test_C_packet_revision_with_target(tmp_path):
    p = _paths(tmp_path)
    tdir, _ = _sent_targets(tmp_path)
    req = _req("이 PDF 너무 약해 보여. 다시 고쳐.", slots={"target_slug": "snature_aqua_squalane_cream_v1"})
    assert orch._classify(req) == "packet_revision"
    parent_id = orch.create_task_graph_for_request(req, targets_dir=tdir, **p)
    orch.advance(parent_id, targets_dir=tdir, **p)
    t = ts.get_task(parent_id, p["store_path"])
    assert t.assigned_agent == "OutreachPacketAgent"
    assert t.intended_stage == "outreach:packet_revision"
    assert t.gate == "green" and t.status == "done"
    body = open(t.artifact_paths[0], encoding="utf-8").read()
    assert "NO send" in body and "NO PDF render" in body


def test_C_packet_revision_ambiguous_target_blocks(tmp_path):
    p = _paths(tmp_path)
    req = _req("이거 다시 고쳐.")  # no resolvable target
    parent_id = orch.create_task_graph_for_request(req, **p)
    orch.advance(parent_id, **p)
    t = ts.get_task(parent_id, p["store_path"])
    assert t.intended_stage == "ops:clarification" and t.status == "blocked"


# --- Example D: instagram cardnews -------------------------------------------
def test_D_cardnews_separate_namespace(tmp_path):
    p = _paths(tmp_path)
    req = _req("오늘 인스타 카드뉴스 하나 만들어줘.")
    assert orch._classify(req) == "cardnews"
    parent_id = orch.create_task_graph_for_request(req, **p)
    orch.advance(parent_id, **p)
    t = ts.get_task(parent_id, p["store_path"])
    assert t.workflow == "instagram"
    assert t.target_slug is None         # does NOT use an outreach target
    assert t.assigned_agent == "InstagramCardnewsAgent"
    assert t.status == "done"
    assert "publish" in open(t.artifact_paths[0], encoding="utf-8").read().lower()


# --- Example E: ambiguous send -----------------------------------------------
def test_E_ambiguous_send_clarifies_no_action(tmp_path):
    p = _paths(tmp_path)
    req = _req("그거 그냥 보내.")
    assert orch._classify(req) == "send_ambiguous"
    parent_id = orch.create_task_graph_for_request(req, **p)
    summary = orch.advance(parent_id, **p)
    t = ts.get_task(parent_id, p["store_path"])
    assert t.intended_stage == "ops:clarification"
    assert t.status == "blocked"          # never runs
    assert t.gate == "red"                # sending is always a red gate
    # NO send/mark_sent task exists anywhere
    all_stages = [x.intended_stage for x in ts.load_tasks(p["store_path"])]
    assert "outreach:mark_sent" not in all_stages
    assert "outreach:prepare_send" not in all_stages
    assert summary["counts"].get("done") is None


# --- SAFETY INVARIANTS -------------------------------------------------------
def test_inv_no_packet_files_mutated(tmp_path):
    p = _paths(tmp_path)
    tdir, status_json = _sent_targets(tmp_path)
    before = status_json.read_bytes()
    send_log = status_json.parent / "send_log.md"
    # exercise several workflows that read the target
    for goal, slots in [
        ("에스네이처 답장 없으면 팔로업 초안 만들어줘.", None),
        ("이 PDF 약해 보여 고쳐", {"target_slug": "snature_aqua_squalane_cream_v1"}),
    ]:
        req = _req(goal, slots=slots or {})
        pid = orch.create_task_graph_for_request(req, targets_dir=tdir, **p)
        orch.advance(pid, targets_dir=tdir, **p)
    # packet status.json is byte-for-byte unchanged; no send_log.md created
    assert status_json.read_bytes() == before
    assert not send_log.exists()
    # every generated artifact lives under the tmp store dir, NOT the targets dir
    arts = [a for t in ts.load_tasks(p["store_path"]) for a in t.artifact_paths]
    assert arts and all(str(tdir) not in a for a in arts)


def test_inv_all_tasks_have_known_agent(tmp_path):
    p = _paths(tmp_path)
    tdir, _ = _sent_targets(tmp_path)
    for goal in ["다음 브랜드 하나 골라서 콜드메일까지 준비해줘. 보내지는 마.",
                 "에스네이처 팔로업 초안 만들어줘", "오늘 카드뉴스 만들어줘", "그거 보내", "뭔가 해줘"]:
        pid = orch.create_task_graph_for_request(_req(goal), targets_dir=tdir, **p)
        orch.advance(pid, targets_dir=tdir, **p)
    for t in ts.load_tasks(p["store_path"]):
        assert t.assigned_agent in AGENTS


def test_inv_red_stages_need_approval(tmp_path):
    req = _req("다음 브랜드 하나 골라서 콜드메일까지 준비해줘. 보내지는 마.")
    for t in orch.plan(req):
        if t.gate == "red":
            assert t.approval_required is True


def test_inv_red_task_cannot_be_done_without_approval(tmp_path):
    p = _paths(tmp_path)
    tdir, _ = _sent_targets(tmp_path)
    req = _req("에스네이처 답장 없으면 팔로업 초안 만들어줘.")
    pid = orch.create_task_graph_for_request(req, targets_dir=tdir, **p)
    orch.advance(pid, targets_dir=tdir, **p)  # -> needs_approval, no approval_ref
    import pytest
    with pytest.raises(ValueError):
        orch.mark_task_done(pid, **p)  # red + no approval_ref -> refused


def test_inv_execution_is_proposal_only(tmp_path):
    # artifacts are plain text proposals; no executable side effects recorded
    p = _paths(tmp_path)
    tdir, _ = _sent_targets(tmp_path)
    pid = orch.create_task_graph_for_request(
        _req("에스네이처 답장 없으면 팔로업 초안 만들어줘."), targets_dir=tdir, **p)
    orch.advance(pid, targets_dir=tdir, **p)
    art = ts.get_task(pid, p["store_path"]).artifact_paths[0]
    assert art.endswith(".md")  # a prompt file, not an action


def test_inv_instagram_does_not_touch_outreach_status(tmp_path):
    p = _paths(tmp_path)
    pid = orch.create_task_graph_for_request(_req("오늘 카드뉴스 만들어줘"), **p)
    orch.advance(pid, **p)
    t = ts.get_task(pid, p["store_path"])
    assert t.workflow == "instagram" and t.target_slug is None


# --- CodexReviewAgent fixes: idempotency + approval governance + namespacing -
def test_fix1_repeated_advance_emits_one_clarification_event(tmp_path):
    import orchestration_events as ev
    p = _paths(tmp_path)
    pid = orch.create_task_graph_for_request(_req("그거 그냥 보내."), **p)
    for _ in range(3):
        orch.advance(pid, **p)
    clar = [e for e in ev.read_events(p["events_path"])
            if e["event_type"] == "clarification_requested"]
    assert len(clar) == 1                       # surfaced exactly once


def test_fix1_repeated_advance_does_not_grow_snapshots(tmp_path):
    p = _paths(tmp_path)
    pid = orch.create_task_graph_for_request(_req("그거 그냥 보내."), **p)
    orch.advance(pid, **p)
    n_after_first = len(p["store_path"].read_text(encoding="utf-8").splitlines())
    for _ in range(3):
        orch.advance(pid, **p)
    n_after_more = len(p["store_path"].read_text(encoding="utf-8").splitlines())
    assert n_after_more == n_after_first        # no new snapshots appended
    assert ts.get_task(pid, p["store_path"]).status == "blocked"


def test_fix2_green_approval_required_task_needs_approval_ref_to_finish(tmp_path):
    import pytest
    p = _paths(tmp_path)
    pid = orch.create_task_graph_for_request(
        _req("다음 브랜드 하나 골라서 콜드메일까지 준비해줘. 보내지는 마."), **p)
    orch.advance(pid, **p)
    pick = [t for t in ts.load_tasks(p["store_path"])
            if t.intended_stage == "outreach:candidate_shortlist_pick"][0]
    assert pick.gate == "green" and pick.approval_required is True
    assert pick.status == "needs_approval" and pick.approval_ref is None
    # cannot finish without approval_ref, even though it's a GREEN gate
    with pytest.raises(ValueError):
        orch.mark_task_done(pick.task_id, **p)


def test_fix2_succeeds_once_approval_recorded(tmp_path):
    p = _paths(tmp_path)
    approvals = tmp_path / "approvals.log.jsonl"
    pid = orch.create_task_graph_for_request(
        _req("다음 브랜드 하나 골라서 콜드메일까지 준비해줘. 보내지는 마."), **p)
    orch.advance(pid, **p)
    pick = [t for t in ts.load_tasks(p["store_path"])
            if t.intended_stage == "outreach:candidate_shortlist_pick"][0]
    orch.record_task_approval(pick.task_id, operator_discord_id="606",
                              approvals_path=approvals, **p)
    done = orch.mark_task_done(pick.task_id, result_summary="picked SKU", **p)
    assert done.status == "done" and done.approval_ref


def test_fix3_all_planned_stages_are_namespaced_or_none(tmp_path):
    tdir, _ = _sent_targets(tmp_path)
    goals = [
        "다음 브랜드 하나 골라서 콜드메일까지 준비해줘. 보내지는 마.",
        "에스네이처 답장 없으면 팔로업 초안 만들어줘.",
        "이 PDF 약해 보여 고쳐",
        "이거 다시 고쳐",                     # ambiguous revision
        "오늘 인스타 카드뉴스 하나 만들어줘.",
        "그거 그냥 보내.",
        "뭔가 해줘",                          # unknown
    ]
    allowed = ("outreach:", "instagram:", "ops:")
    for g in goals:
        for t in orch.plan(_req(g), targets_dir=tdir):
            assert t.intended_stage is None or t.intended_stage.startswith(allowed), \
                f"non-namespaced stage: {t.intended_stage!r}"
