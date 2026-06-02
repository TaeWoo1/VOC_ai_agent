"""M4-A/M4-B nl_router: deterministic NL operator router.

All state in tmp_path; no Discord, no network, no real-packet writes (the M4-B
runner tests write a scaffold under a tmp targets dir — the existing guarded
runner path, never a real packet). Covers the classifier, the M4-A handlers
(set_candidate / approve_one), and the M4-B handlers (dry-run / run+review /
rollback) plus their resolver ambiguity and no-write/no-auto-rollback guarantees.
"""

from __future__ import annotations

import codex_review as cr
import nl_router as r
import task_discord_adapter as adapter
import task_inputs as ti
import task_runs as truns
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


# =========================================================================
# M4-B: dry-run / run+review / rollback (guarded scaffold_packet runner)
# =========================================================================

_CAND = {"slug": "acme_dew_cream_v1", "brand": "ACME",
         "goods_no": "A000000111111", "product_name": "ACME 수분크림"}


def _runner_paths(tmp_path):
    """Full path set for the guarded runner, plus a tmp targets dir."""
    targets = tmp_path / "targets"
    targets.mkdir(exist_ok=True)
    return {"approvals_path": tmp_path / "approvals.log.jsonl",
            "runs_path": tmp_path / "task_runs.jsonl",
            "reviews_path": tmp_path / "codex_reviews.jsonl",
            "targets_dir": targets}


def _approved(p, rp, candidate=_CAND):
    """Append a pick task, attach candidate, record approval -> queued + ref."""
    t = _pick()
    ts.append_task_snapshot(t, p["store_path"])
    ti.set_candidate(t.task_id, candidate, store_path=p["store_path"],
                     events_path=p["events_path"])
    record_task_approval(t.task_id, operator_discord_id="606",
                         approvals_path=rp["approvals_path"], **p)
    return t


def _route(msg, p, rp, **extra):
    return r.route(msg, operator_discord_id="606", store_path=p["store_path"],
                   events_path=p["events_path"], approvals_path=rp["approvals_path"],
                   runs_path=rp["runs_path"], reviews_path=rp["reviews_path"],
                   targets_dir=rp["targets_dir"], **extra)


# --- classifier (M4-B intents) -----------------------------------------------
def test_classify_dry_run_intent():
    for msg in ("dry-run까지 해봐", "미리보기만 해줘", "scaffold 미리보기 해줘"):
        intent, _ = r.classify_action(msg)
        assert intent == r.DRY_RUN, msg


def test_classify_run_review_intent():
    for msg in ("scaffold 생성하고 review까지 진행해. 수집은 하지 마.",
                "폴더만 만들고 검수까지 해줘.", "status.json scaffold만 만들고 review해."):
        intent, _ = r.classify_action(msg)
        assert intent == r.RUN_REVIEW, msg


def test_classify_rollback_intent():
    for msg in ("방금 만든 scaffold rollback해", "마지막 run 되돌려", "최근 scaffold 되돌려"):
        intent, _ = r.classify_action(msg)
        assert intent == r.ROLLBACK, msg


def test_classify_claude_code_is_dangerous():
    for msg in ("Claude Code로 실행해", "클로드로 돌려"):
        intent, _ = r.classify_action(msg)
        assert intent == r.DANGEROUS, msg


def test_negated_collection_in_run_review_not_dangerous():
    intent, _ = r.classify_action("scaffold 생성하고 review까지 진행해. 수집은 하지 마.")
    assert intent == r.RUN_REVIEW           # negated 수집 must not flip to dangerous


def test_affirmative_collection_still_dangerous():
    assert r.classify_action("수집까지 해")[0] == r.DANGEROUS


# --- dry-run -----------------------------------------------------------------
def test_dry_run_requires_approved_queued(tmp_path):
    p, rp = _paths(tmp_path), _runner_paths(tmp_path)
    # a pick that is only needs_approval (not approved) -> ask approval first
    ts.append_task_snapshot(_pick(), p["store_path"])
    out = _route("dry-run까지 해봐", p, rp)
    assert out["intent"] == r.CLARIFY and out["handled"]
    assert "승인" in out["reply"]
    assert not rp["runs_path"].exists()                  # no dry_run record written


def test_dry_run_happy_path_writes_only_run_record(tmp_path):
    p, rp = _paths(tmp_path), _runner_paths(tmp_path)
    _approved(p, rp)
    out = _route("dry-run까지 해봐", p, rp)
    assert out["intent"] == r.DRY_RUN and out["handled"]
    assert "dry-run 통과" in out["reply"]
    runs = truns.read_runs(rp["runs_path"])
    assert len(runs) == 1 and runs[0]["status"] == "dry_run"
    # NO packet folder created under the targets dir
    assert list(rp["targets_dir"].iterdir()) == []


# --- run + review ------------------------------------------------------------
def test_run_review_refuses_without_clean_dry_run(tmp_path):
    p, rp = _paths(tmp_path), _runner_paths(tmp_path)
    _approved(p, rp)                                     # approved but NO dry-run yet
    out = _route("scaffold 생성하고 review까지 진행해. 수집은 하지 마.", p, rp)
    assert out["intent"] == r.RUN_REVIEW and out["handled"]
    assert "dry-run" in out["reply"]                     # told to dry-run first
    assert list(rp["targets_dir"].iterdir()) == []       # no folder created
    # no run record beyond (there was none); definitely no 'done' scaffold
    assert all(x["status"] != "done" for x in truns.read_runs(rp["runs_path"]))


def test_run_review_happy_path_creates_scaffold_and_done(tmp_path):
    p, rp = _paths(tmp_path), _runner_paths(tmp_path)
    t = _approved(p, rp)
    _route("dry-run까지 해봐", p, rp)                      # clean dry-run first
    out = _route("scaffold 생성하고 review까지 진행해. 수집은 하지 마.", p, rp)
    assert out["intent"] == r.RUN_REVIEW and out["handled"]
    assert "review pass" in out["reply"]
    # scaffold folder + status.json now exist under tmp targets
    folder = rp["targets_dir"] / _CAND["slug"]
    assert (folder / "status.json").exists()
    assert ts.get_task(t.task_id, p["store_path"]).status == "done"


def test_review_fail_blocks_task_and_keeps_files(tmp_path, monkeypatch):
    p, rp = _paths(tmp_path), _runner_paths(tmp_path)
    t = _approved(p, rp)
    _route("dry-run까지 해봐", p, rp)

    # force a deterministic review FAIL while keeping task_runner's real
    # blocking / no-delete behavior (verdict producer is swapped, not the gate).
    def _fail_verdict(run_id, *, runs_path, targets_dir=None, now=None):
        recs = truns.records_for_run(run_id, runs_path)
        tid = recs[-1].get("task_id") if recs else None
        return cr.ReviewOutcome(
            status="fail", run_id=run_id, task_id=tid, recommended_action="rollback",
            findings=[{"check": "folder_contents_exact", "ok": False, "detail": "stray"}])
    monkeypatch.setattr("task_runner._cr.review_scaffold_run", _fail_verdict)

    out = _route("scaffold 생성하고 review까지 진행해. 수집은 하지 마.", p, rp)
    assert out["intent"] == r.RUN_REVIEW and "review FAIL" in out["reply"]
    assert "rollback" in out["reply"]
    folder = rp["targets_dir"] / _CAND["slug"]
    assert (folder / "status.json").exists()             # files NOT deleted
    assert ts.get_task(t.task_id, p["store_path"]).status == "blocked"
    # no auto-rollback: no rolled_back run record was appended
    assert all(x["status"] != "rolled_back" for x in truns.read_runs(rp["runs_path"]))


# --- rollback ----------------------------------------------------------------
def _scaffolded(p, rp, candidate=_CAND):
    """Produce one done scaffold run via the router; return (task, run_id)."""
    t = _approved(p, rp, candidate)
    _route("dry-run까지 해봐", p, rp)
    out = _route("scaffold 생성하고 review까지 진행해.", p, rp)
    assert "review pass" in out["reply"]
    done = [x for x in truns.read_runs(rp["runs_path"])
            if x["status"] == "done" and x.get("task_id") == t.task_id]
    return t, done[-1]["run_id"]


def test_rollback_unique_removes_run_files_and_requeues(tmp_path):
    p, rp = _paths(tmp_path), _runner_paths(tmp_path)
    t, _ = _scaffolded(p, rp)
    folder = rp["targets_dir"] / _CAND["slug"]
    assert (folder / "status.json").exists()
    out = _route("방금 만든 scaffold rollback해", p, rp)
    assert out["intent"] == r.ROLLBACK and "rollback 완료" in out["reply"]
    assert not folder.exists()                           # files removed
    assert ts.get_task(t.task_id, p["store_path"]).status == "queued"


def test_rollback_ambiguous_asks_run_id(tmp_path):
    p, rp = _paths(tmp_path), _runner_paths(tmp_path)
    _, run_a = _scaffolded(p, rp)
    _, run_b = _scaffolded(p, rp, {**_CAND, "slug": "acme_dew_cream_v2"})
    out = _route("마지막 run 되돌려", p, rp)
    assert out["intent"] == r.CLARIFY and out["handled"]
    assert run_a in out["reply"] and run_b in out["reply"]
    # nothing deleted: both folders still present
    assert all(x["status"] != "rolled_back" for x in truns.read_runs(rp["runs_path"]))


def test_rollback_none_found(tmp_path):
    p, rp = _paths(tmp_path), _runner_paths(tmp_path)
    out = _route("마지막 run 되돌려", p, rp)
    assert out["intent"] == r.ROLLBACK and "되돌릴 scaffold run이 없습니다" in out["reply"]


# --- dangerous still zero-write under the M4-B router ------------------------
def test_dangerous_zero_write_m4b(tmp_path):
    p, rp = _paths(tmp_path), _runner_paths(tmp_path)
    out = _route("메일 보내", p, rp)
    assert out["intent"] == r.DANGEROUS and "자연어로 실행하지 않습니다" in out["reply"]
    assert not p["store_path"].exists() and not rp["runs_path"].exists()
    assert not rp["approvals_path"].exists()
