"""M5-A conversational_orchestrator: deterministic, READ-ONLY query handler.

All state in tmp_path; no Discord, no network, no writes. These tests pin the
core M5-A contract: question-like follow-ups are answered from existing state
WITHOUT creating a task graph or writing anything, while M4-A/M4-B operational
routing and genuine new-task commands are unchanged.
"""

from __future__ import annotations

import ast
from pathlib import Path

import conversational_orchestrator as co
import nl_router as r
import task_discord_adapter as adapter
import task_store as ts
from task_model import Task

_BROAD = "다음 브랜드 하나 골라서 콜드메일까지 준비해줘. 보내지는 마."
_QUESTIONS = [
    "다음 후보군이 뭐지?",
    "지금 어디까지 됐어?",
    "왜 승인해야 돼?",
    "이건 수집까지 가능한 상태야?",
    "이 task에서 다음에 뭘 해야 해?",
    "후보 리서치 결과 요약해줘.",
]


def _paths(tmp_path):
    return {"store_path": tmp_path / "tasks.jsonl",
            "events_path": tmp_path / "events.jsonl"}


def _seed(tmp_path, *, pick_status="needs_approval", approval_ref=None,
          with_check_artifact=False, root_status="running"):
    """Hand-seed a minimal active cold-email graph (root + candidate_check(done)
    + candidate_shortlist_pick). Deterministic; bypasses advance() so artifact
    presence is controlled by the test."""
    p = _paths(tmp_path)
    root = Task(goal="cold email pipeline", assigned_agent="OpsLoggerAgent",
                intended_stage=None, status=root_status, gate="green")
    check = Task(goal="Research next candidate", assigned_agent="CandidateResearchAgent",
                 parent_task_id=root.task_id, intended_stage="outreach:candidate_check",
                 status="done", gate="green")
    pick = Task(goal="Operator picks ONE candidate",
                assigned_agent="CandidateResearchAgent", parent_task_id=root.task_id,
                intended_stage="outreach:candidate_shortlist_pick", status=pick_status,
                gate="green", approval_required=True, approval_ref=approval_ref)
    for t in (root, check, pick):
        ts.append_task_snapshot(t, p["store_path"])
    if with_check_artifact:
        gdir = p["store_path"].parent / "generated_prompts"
        gdir.mkdir(parents=True, exist_ok=True)
        (gdir / f"{check.task_id}__outreach_candidate_check.md").write_text(
            "# 후보 리서치 결과\n- 후보 A: 브링그린 티트리 시카\n- ICP 적합\n",
            encoding="utf-8")
    return p, root, check, pick


# --- 1. classifier -----------------------------------------------------------
def test_classify_candidate_query():
    assert co.classify_conversation("다음 후보군이 뭐지?") == co.CANDIDATE_QUERY


def test_classify_status_query():
    assert co.classify_conversation("지금 어디까지 됐어?") == co.STATUS_QUERY


def test_classify_followup_approval_and_collection():
    assert co.classify_conversation("왜 승인해야 돼?") == co.FOLLOWUP_QUESTION
    assert co.classify_conversation("이건 수집까지 가능한 상태야?") == co.FOLLOWUP_QUESTION
    assert co.classify_conversation("이 task에서 다음에 뭘 해야 해?") == co.FOLLOWUP_QUESTION


def test_classify_artifact_query():
    assert co.classify_conversation("후보 리서치 결과 요약해줘.") == co.ARTIFACT_QUERY


def test_classify_new_task_and_clarification():
    assert co.classify_conversation(_BROAD) == co.NEW_TASK
    assert co.classify_conversation("음 글쎄 그냥") == co.CLARIFICATION


# --- 2. "다음 후보군이 뭐지?" does NOT create a graph; returns candidate summary ---
def test_candidate_query_no_graph_no_artifact(tmp_path):
    p, *_ = _seed(tmp_path, with_check_artifact=False)
    before = len(ts.load_tasks(p["store_path"]))
    out = adapter.handle_nl_message("다음 후보군이 뭐지?", operator_discord_id="606", **p)
    assert out["handled"] is True and out["intent"] == co.CANDIDATE_QUERY
    assert "parent_task_id" not in out                       # NO new graph
    assert len(ts.load_tasks(p["store_path"])) == before     # no new tasks
    assert "아직 후보군 요약 artifact가 없습니다" in out["reply"]
    assert "candidate_check=done" in out["reply"]
    assert "candidate_shortlist_pick=needs_approval" in out["reply"]


def test_candidate_query_summarizes_existing_artifact(tmp_path):
    p, *_ = _seed(tmp_path, with_check_artifact=True)
    out = co.answer("다음 후보군이 뭐지?", **p)
    assert out["intent"] == co.CANDIDATE_QUERY
    assert "후보군 요약" in out["reply"] and "후보 리서치 결과" in out["reply"]


# --- 3. "지금 어디까지 됐어?" returns a status summary --------------------------
def test_status_query_summary(tmp_path):
    p, root, *_ = _seed(tmp_path)
    out = co.answer("지금 어디까지 됐어?", **p)
    assert out["intent"] == co.STATUS_QUERY
    assert root.task_id in out["reply"]
    assert "상태 집계" in out["reply"]
    assert "승인" in out["reply"]                              # next-action hint


# --- 4. "왜 승인해야 돼?" returns an approval explanation -----------------------
def test_followup_approval_explanation(tmp_path):
    p, *_ = _seed(tmp_path)
    out = co.answer("왜 승인해야 돼?", **p)
    assert out["intent"] == co.FOLLOWUP_QUESTION
    assert "의도(intent) 기록만" in out["reply"]
    assert "prompt_hash" in out["reply"]


# --- 5. "이건 수집까지 가능한 상태야?" refuses collection + explains the gate ----
def test_collection_gate_refusal(tmp_path):
    p, *_ = _seed(tmp_path)
    out = co.answer("이건 수집까지 가능한 상태야?", **p)
    assert out["intent"] == co.FOLLOWUP_QUESTION
    assert "자연어로 실행되지 않습니다" in out["reply"]
    assert "별도 승인" in out["reply"]


# --- 6. empty store + status question -> explain + suggest, zero writes -------
def test_empty_store_explain_suggest(tmp_path):
    p = _paths(tmp_path)
    out = adapter.handle_nl_message("지금 어디까지 됐어?", operator_discord_id="606", **p)
    assert out["handled"] is True
    assert "진행 중인 작업이 없습니다" in out["reply"]
    assert "콜드메일 파이프라인을 만들까요" in out["reply"]
    assert "parent_task_id" not in out
    assert not p["store_path"].exists()                       # nothing written
    assert not p["events_path"].exists()


# --- 7. multiple active roots -> clarification --------------------------------
def test_multiple_active_roots_clarify(tmp_path):
    p = _paths(tmp_path)
    a = Task(goal="cold email A", assigned_agent="OpsLoggerAgent", status="running")
    b = Task(goal="cold email B", assigned_agent="OpsLoggerAgent", status="running")
    ts.append_task_snapshot(a, p["store_path"])
    ts.append_task_snapshot(b, p["store_path"])
    out = co.answer("지금 어디까지 됐어?", **p)
    assert out["intent"] == co.CLARIFICATION
    assert "여러 개" in out["reply"]
    assert a.task_id in out["reply"] and b.task_id in out["reply"]


# --- 8. broad command STILL creates the 10-task cold_email graph --------------
def test_broad_command_still_creates_graph(tmp_path):
    p = _paths(tmp_path)
    out = adapter.handle_nl_message(_BROAD, operator_discord_id="606", **p)
    assert out["handled"] is False
    assert out["plan_kind"] == "cold_email_pipeline"
    assert out["intent"] == r.CREATE_GRAPH
    children = ts.list_tasks(p["store_path"], parent_task_id=out["parent_task_id"])
    assert len(children) == 10


# --- 9/10/11. M4-A / M4-B operational routing precedence is unchanged ---------
def test_dangerous_still_refused(tmp_path):
    assert r.classify_action("그냥 보내")[0] == r.DANGEROUS
    p = _paths(tmp_path)
    out = adapter.handle_nl_message("그냥 보내", operator_discord_id="606", **p)
    assert out["handled"] is True and out["intent"] == r.DANGEROUS
    assert "parent_task_id" not in out
    assert not p["store_path"].exists()


def test_approve_routes_to_m4():
    # "승인해" is an M4-A operational intent, never a conversational query.
    assert r.classify_action("승인해")[0] == r.APPROVE_ONE


def test_dry_run_routes_to_m4b():
    # "dry-run까지 해봐" is an M4-B operational intent, never conversational.
    assert r.classify_action("dry-run까지 해봐")[0] == r.DRY_RUN


# --- 12. zero-write for ALL question-like messages ---------------------------
def test_zero_writes_for_all_questions(tmp_path):
    p, *_ = _seed(tmp_path, with_check_artifact=True)
    store_before = p["store_path"].read_bytes()
    n_before = len(ts.load_tasks(p["store_path"]))
    sibling_files_before = sorted(x.name for x in tmp_path.iterdir())
    for msg in _QUESTIONS:
        out = adapter.handle_nl_message(msg, operator_discord_id="606", **p)
        assert out["handled"] is True
        assert "parent_task_id" not in out                    # no graph
    # store byte-identical; task count unchanged; no approvals/runs/reviews files
    assert p["store_path"].read_bytes() == store_before
    assert len(ts.load_tasks(p["store_path"])) == n_before
    assert not p["events_path"].exists()                      # queries write no events
    assert sorted(x.name for x in tmp_path.iterdir()) == sibling_files_before


# --- 13. read-only import boundary (no task_runner / task_inputs / write fns) -
def test_module_import_boundary():
    src = Path(co.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)
    imported_modules: set[str] = set()
    from_imports: list[tuple] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                imported_modules.add(a.name)
        elif isinstance(node, ast.ImportFrom):
            for a in node.names:
                from_imports.append((node.module, a.name))
    # the runner / inputs modules must not be imported at all
    assert "task_runner" not in imported_modules
    assert "task_inputs" not in imported_modules
    # write-capable orchestrator functions must not be pulled in. The ONLY write
    # path M5-A.5 allows is orchestrator.cancel_task (confirmed cancel); the
    # broad graph-creation / advance / approval / raw-snapshot writers stay out.
    banned = {"create_task_graph_for_request", "advance", "record_task_approval",
              "append_task_snapshot", "append_event"}
    assert not any(name in banned for _mod, name in from_imports)
    # no escape hatches, and no Claude/LLM client (the planner is M6, not here)
    for mod in ("subprocess", "socket", "webbrowser", "urllib", "requests", "http",
                "anthropic"):
        assert mod not in imported_modules


# === M5-A.5: deterministic explicit-cancel handshake =========================
def _seed_graph(tmp_path, *, root_status="running",
                child_statuses=("queued", "needs_approval")):
    """Seed root + N children with explicit (non-terminal by default) statuses,
    so 'cancel the graph' has unambiguous expected targets."""
    p = _paths(tmp_path)
    root = Task(goal="cold email pipeline", assigned_agent="OpsLoggerAgent",
                status=root_status, gate="green")
    children = []
    for i, st in enumerate(child_statuses):
        c = Task(goal=f"child {i}", assigned_agent="CandidateResearchAgent",
                 parent_task_id=root.task_id,
                 intended_stage="outreach:candidate_check", status=st, gate="green")
        children.append(c)
    for t in (root, *children):
        ts.append_task_snapshot(t, p["store_path"])
    return p, root, children


# --- 1. "진행 중인 작업 삭제도 가능한가?" -> capability + active root list, zero write
def test_cancel_capability_lists_roots_zero_write(tmp_path):
    co.reset_pending()
    p, root, _ = _seed_graph(tmp_path)
    before = p["store_path"].read_bytes()
    out = adapter.handle_nl_message("진행 중인 작업 삭제도 가능한가?",
                                    operator_discord_id="606", **p)
    assert out["handled"] is True and out["intent"] == co.CANCEL_CAPABILITY
    assert "물리 삭제" in out["reply"] and root.task_id in out["reply"]
    assert "parent_task_id" not in out                       # no graph created
    assert p["store_path"].read_bytes() == before            # zero write
    assert not p["events_path"].exists()


# --- 2. "task_<root_id> 삭제" -> confirmation prompt, NOT ambiguity, zero write
def test_cancel_request_explicit_id_asks_confirm_zero_write(tmp_path):
    co.reset_pending()
    p, root, _ = _seed_graph(tmp_path)
    before = p["store_path"].read_bytes()
    out = adapter.handle_nl_message(f"{root.task_id} 삭제",
                                    operator_discord_id="606", **p)
    assert out["intent"] == co.CANCEL_REQUEST
    assert "진행할까요" in out["reply"]
    assert "여러 개" not in out["reply"]                      # did NOT re-ask ambiguity
    assert p["store_path"].read_bytes() == before            # no write yet
    assert not p["events_path"].exists()


# --- 3. "task_<child_id> 삭제" resolves to the ROOT graph ----------------------
def test_cancel_request_child_id_resolves_root(tmp_path):
    co.reset_pending()
    p, root, children = _seed_graph(tmp_path)
    out = adapter.handle_nl_message(f"{children[0].task_id} 삭제",
                                    operator_discord_id="606", **p)
    assert out["intent"] == co.CANCEL_REQUEST
    assert root.task_id in out["reply"]                      # resolved up to root


# --- 4. confirm after pending -> root + children cancelled via append-only ----
def test_confirm_cancels_root_and_children(tmp_path):
    co.reset_pending()
    p, root, children = _seed_graph(tmp_path)
    adapter.handle_nl_message(f"{root.task_id} 삭제", operator_discord_id="606", **p)
    out = adapter.handle_nl_message("응", operator_discord_id="606", **p)
    assert out["intent"] == co.CANCEL_CONFIRM
    by_id = {t.task_id: t for t in ts.load_tasks(p["store_path"])}
    assert by_id[root.task_id].status == "cancelled"
    for c in children:
        assert by_id[c.task_id].status == "cancelled"
    assert p["events_path"].exists()                         # audit event written


# --- 5. cancel never physically deletes records; no packet files touched ------
def test_cancel_no_physical_delete(tmp_path):
    co.reset_pending()
    p, root, children = _seed_graph(tmp_path)
    n_before = len(ts.load_tasks(p["store_path"]))
    adapter.handle_nl_message(f"{root.task_id} 삭제", operator_discord_id="606", **p)
    adapter.handle_nl_message("응", operator_discord_id="606", **p)
    after = ts.load_tasks(p["store_path"])
    assert len(after) == n_before                            # records still present
    ids = {t.task_id for t in after}
    assert root.task_id in ids and all(c.task_id in ids for c in children)
    assert not (tmp_path / "status.json").exists()           # no packet mutation
    assert not (tmp_path / "send_log.md").exists()


# --- 6. bare "응" with NO pending cancel writes nothing ------------------------
def test_bare_confirm_no_pending_writes_nothing(tmp_path):
    co.reset_pending()
    p, _root, _ = _seed_graph(tmp_path)
    before = p["store_path"].read_bytes()
    out = adapter.handle_nl_message("응", operator_discord_id="606", **p)
    assert out["handled"] is True
    assert "parent_task_id" not in out
    assert p["store_path"].read_bytes() == before
    assert not p["events_path"].exists()
    assert all(t.status != "cancelled" for t in ts.load_tasks(p["store_path"]))


# --- 7. unknown task id -> not-found, zero write, no pending armed -------------
def test_cancel_unknown_id_not_found(tmp_path):
    co.reset_pending()
    p, _root, _ = _seed_graph(tmp_path)
    before = p["store_path"].read_bytes()
    out = adapter.handle_nl_message("task_deadbeef00 삭제",
                                    operator_discord_id="606", **p)
    assert out["intent"] == co.CANCEL_REQUEST
    assert "찾을 수 없습니다" in out["reply"]
    assert p["store_path"].read_bytes() == before
    # a nonexistent id must NOT arm a pending cancel -> a later "응" does nothing
    adapter.handle_nl_message("응", operator_discord_id="606", **p)
    assert all(t.status != "cancelled" for t in ts.load_tasks(p["store_path"]))


# --- 8. cancel verb without an explicit id -> ask which root, zero write -------
def test_cancel_ambiguous_no_id_asks_which(tmp_path):
    co.reset_pending()
    p = _paths(tmp_path)
    a = Task(goal="cold email A", assigned_agent="OpsLoggerAgent", status="running")
    b = Task(goal="cold email B", assigned_agent="OpsLoggerAgent", status="running")
    ts.append_task_snapshot(a, p["store_path"])
    ts.append_task_snapshot(b, p["store_path"])
    before = p["store_path"].read_bytes()
    out = adapter.handle_nl_message("작업 삭제해줘", operator_discord_id="606", **p)
    assert out["intent"] == co.CANCEL_CAPABILITY
    assert "어떤 root task_id" in out["reply"]
    assert a.task_id in out["reply"] and b.task_id in out["reply"]
    assert p["store_path"].read_bytes() == before


# --- 9. classifier: cancel intents + status query still distinct --------------
def test_classify_cancel_intents():
    assert co.classify_conversation("task_abc123 삭제") == co.CANCEL_REQUEST
    assert co.classify_conversation("진행 중인 작업 삭제도 가능한가?") == co.CANCEL_CAPABILITY
    assert co.classify_conversation("다음 후보군이 뭐지?") == co.CANDIDATE_QUERY  # unchanged
    assert co.classify_conversation("지금 어디까지 됐어?") == co.STATUS_QUERY      # unchanged


# --- 10. pending cancel is per-operator (a different operator can't confirm) ---
def test_pending_is_per_operator(tmp_path):
    co.reset_pending()
    p, root, _ = _seed_graph(tmp_path)
    adapter.handle_nl_message(f"{root.task_id} 삭제", operator_discord_id="606", **p)
    # a DIFFERENT operator's "응" must not act on operator 606's pending cancel
    adapter.handle_nl_message("응", operator_discord_id="999", **p)
    assert all(t.status != "cancelled" for t in ts.load_tasks(p["store_path"]))
