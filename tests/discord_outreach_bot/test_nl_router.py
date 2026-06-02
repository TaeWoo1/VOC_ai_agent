"""M4-A nl_router: deterministic NL operator router.

All state in tmp_path; no Discord, no network, no packet writes. Covers the
classifier (set_candidate / approve / dangerous / negation / fallback) and the
two operational handlers (set_candidate attach + invalidate, approve_one with
single / multiple / explicit-id resolution), plus the no-write guarantees.
"""

from __future__ import annotations

import nl_router as r
import task_discord_adapter as adapter
import task_store as ts
from orchestrator import record_task_approval
from task_model import Task

_CAND_MSG = ("이 후보로 진행해. slug는 bringgreen_tea_tree_cica_v1, 브랜드는 브링그린, "
             "goodsNo는 A000000000000, 제품명은 브링그린 티트리 시카 크림이야.")


def _paths(tmp_path):
    return {"store_path": tmp_path / "tasks.jsonl",
            "events_path": tmp_path / "events.jsonl"}


def _pick(status="needs_approval", approval_ref=None):
    return Task(goal="pick", assigned_agent="CandidateResearchAgent",
                intended_stage="outreach:candidate_shortlist_pick", gate="green",
                approval_required=True, status=status, approval_ref=approval_ref)


# --- classifier --------------------------------------------------------------
def test_classify_set_candidate_with_korean_fields():
    intent, parsed = r.classify_action(_CAND_MSG)
    assert intent == r.SET_CANDIDATE
    f = parsed["fields"]
    assert f["slug"] == "bringgreen_tea_tree_cica_v1"
    assert f["brand"] == "브링그린"
    assert f["goods_no"] == "A000000000000"
    assert f["product_name"] == "브링그린 티트리 시카 크림"


def test_classify_set_candidate_beats_approve_when_jinhaeng_and_fields():
    # "진행" + "승인" both present, but candidate fields win the ordering.
    intent, _ = r.classify_action(_CAND_MSG + " 승인.")
    assert intent == r.SET_CANDIDATE


def test_classify_approve_one():
    for msg in ("승인해", "이 후보 승인", "진행 승인"):
        intent, _ = r.classify_action(msg)
        assert intent == r.APPROVE_ONE, msg


def test_classify_dangerous_send():
    for msg in ("그냥 보내", "PDF 만들어서 보내", "인스타에 올려"):
        intent, _ = r.classify_action(msg)
        assert intent == r.DANGEROUS, msg


def test_classify_dangerous_collection():
    intent, _ = r.classify_action("수집까지 해")
    assert intent == r.DANGEROUS


def test_negated_collection_is_not_dangerous():
    # "수집은 하지 마" is a reassurance clause, not an affirmative collect command.
    intent, _ = r.classify_action("scaffold 생성하고 review까지 진행해. 수집은 하지 마.")
    assert intent != r.DANGEROUS


# --- fallback to existing graph creation -------------------------------------
def test_fallback_graph_creation_for_broad_request(tmp_path):
    p = _paths(tmp_path)
    out = adapter.handle_nl_message(
        "다음 브랜드 하나 골라서 콜드메일까지 준비해줘. 보내지는 마.",
        operator_discord_id="606", **p)
    assert out["handled"] is False
    assert out["plan_kind"] == "cold_email_pipeline"
    children = ts.list_tasks(p["store_path"], parent_task_id=out["parent_task_id"])
    assert len(children) == 10


# --- set_candidate handler ---------------------------------------------------
def test_set_candidate_attaches_and_invalidates_prior_approval(tmp_path):
    p = _paths(tmp_path)
    approvals = tmp_path / "approvals.log.jsonl"
    t = _pick()
    ts.append_task_snapshot(t, p["store_path"])
    record_task_approval(t.task_id, operator_discord_id="606",
                         approvals_path=approvals, **p)             # prior approval
    assert ts.get_task(t.task_id, p["store_path"]).approval_ref

    out = r.route(_CAND_MSG, operator_discord_id="606", approvals_path=approvals, **p)
    assert out["handled"] and out["intent"] == r.SET_CANDIDATE
    stored = ts.get_task(t.task_id, p["store_path"])
    assert stored.inputs["candidate"]["slug"] == "bringgreen_tea_tree_cica_v1"
    assert stored.approval_ref is None and stored.status == "needs_approval"
    assert "무효화" in out["reply"] and "승인할까요" in out["reply"]


def test_set_candidate_no_pick_asks_clarification(tmp_path):
    p = _paths(tmp_path)
    out = r.route(_CAND_MSG, operator_discord_id="606", **p)
    assert out["intent"] == r.CLARIFY and out["handled"]
    assert ts.load_tasks(p["store_path"]) == []                    # nothing written


def test_set_candidate_multiple_picks_asks_which(tmp_path):
    p = _paths(tmp_path)
    a, b = _pick(), _pick()
    ts.append_task_snapshot(a, p["store_path"])
    ts.append_task_snapshot(b, p["store_path"])
    out = r.route(_CAND_MSG, operator_discord_id="606", **p)
    assert out["intent"] == r.CLARIFY and out["handled"]
    assert a.task_id in out["reply"] and b.task_id in out["reply"]
    # neither pick got a candidate attached
    assert "candidate" not in (ts.get_task(a.task_id, p["store_path"]).inputs or {})
    assert "candidate" not in (ts.get_task(b.task_id, p["store_path"]).inputs or {})


# --- approve_one handler -----------------------------------------------------
def test_approve_one_single_waiting(tmp_path):
    p = _paths(tmp_path)
    approvals = tmp_path / "approvals.log.jsonl"
    t = _pick()
    ts.append_task_snapshot(t, p["store_path"])
    out = r.route("승인해", operator_discord_id="606", approvals_path=approvals, **p)
    assert out["handled"] and out["intent"] == r.APPROVE_ONE
    stored = ts.get_task(t.task_id, p["store_path"])
    assert stored.status == "queued" and stored.approval_ref
    assert "승인 기록 완료" in out["reply"]
    assert len(approvals.read_text(encoding="utf-8").splitlines()) == 1


def test_approve_one_multiple_waiting_asks(tmp_path):
    p = _paths(tmp_path)
    approvals = tmp_path / "approvals.log.jsonl"
    a, b = _pick(), _pick()
    ts.append_task_snapshot(a, p["store_path"])
    ts.append_task_snapshot(b, p["store_path"])
    out = r.route("승인해", operator_discord_id="606", approvals_path=approvals, **p)
    assert out["intent"] == r.CLARIFY and out["handled"]
    assert ts.get_task(a.task_id, p["store_path"]).status == "needs_approval"
    assert ts.get_task(b.task_id, p["store_path"]).status == "needs_approval"
    assert not approvals.exists()                                  # no approval recorded
    assert a.task_id in out["reply"] and b.task_id in out["reply"]


def test_approve_with_explicit_task_id_among_many(tmp_path):
    p = _paths(tmp_path)
    approvals = tmp_path / "approvals.log.jsonl"
    a, b = _pick(), _pick()
    ts.append_task_snapshot(a, p["store_path"])
    ts.append_task_snapshot(b, p["store_path"])
    out = r.route(f"{b.task_id} 승인", operator_discord_id="606",
                  approvals_path=approvals, **p)
    assert out["intent"] == r.APPROVE_ONE and out["handled"]
    assert ts.get_task(b.task_id, p["store_path"]).status == "queued"
    assert ts.get_task(a.task_id, p["store_path"]).status == "needs_approval"


def test_approve_none_waiting_says_no_target(tmp_path):
    p = _paths(tmp_path)
    out = r.route("승인해", operator_discord_id="606", **p)
    assert out["intent"] == r.APPROVE_ONE and out["handled"]
    assert "승인 대기 중인 작업이 없습니다" in out["reply"]
    assert ts.load_tasks(p["store_path"]) == []                    # nothing written


# --- dangerous action: zero writes, no packet mutation -----------------------
def test_dangerous_action_zero_writes(tmp_path):
    p = _paths(tmp_path)
    approvals = tmp_path / "approvals.log.jsonl"
    out = r.route("그냥 보내", operator_discord_id="606", approvals_path=approvals, **p)
    assert out["intent"] == r.DANGEROUS and out["handled"]
    assert "자연어로 실행하지 않습니다" in out["reply"]
    assert not p["store_path"].exists()
    assert not p["events_path"].exists()
    assert not approvals.exists()


def test_no_packet_status_or_send_log_mutation(tmp_path):
    p = _paths(tmp_path)
    targets = tmp_path / "targets"
    pdir = targets / "bringgreen_tea_tree_cica_v1"
    pdir.mkdir(parents=True)
    sj = pdir / "status.json"
    sj.write_text('{"state":"X"}', encoding="utf-8")
    before = sj.read_bytes()
    t = _pick()
    ts.append_task_snapshot(t, p["store_path"])
    r.route(_CAND_MSG, operator_discord_id="606", targets_dir=targets, **p)
    assert sj.read_bytes() == before                               # packet untouched
    assert not (pdir / "send_log.md").exists()
