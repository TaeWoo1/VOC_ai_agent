"""M6-A claude_orchestrator + adapter-routing tests.

The planner is the 'Claude proposes' half: it builds a read-only context bundle
and returns an UNTRUSTED plan. These tests inject a fake responder / monkeypatch
the planner so NO real API is called, and assert:
  - deterministic M4/M5/new-task routes never reach the planner;
  - an eligible ambiguous message goes propose -> validate -> format;
  - everything stays zero-write;
  - disabled/unavailable falls back to the deterministic read-only answer.
"""

from __future__ import annotations

import ast
import json
from pathlib import Path

import claude_orchestrator as clo
import conversational_orchestrator as co
import nl_router as r
import task_discord_adapter as adapter
import task_store as ts
from task_model import Task

_ENV_VARS = ("CLAUDE_ORCHESTRATOR_ENABLED", "ANTHROPIC_API_KEY",
             "CLAUDE_ORCHESTRATOR_MODEL", "CLAUDE_ORCHESTRATOR_MAX_CONTEXT_CHARS",
             "CLAUDE_ORCHESTRATOR_TIMEOUT_SECONDS")


def _clean_env(monkeypatch):
    for v in _ENV_VARS:
        monkeypatch.delenv(v, raising=False)


def _paths(tmp_path):
    return {"store_path": tmp_path / "tasks.jsonl",
            "events_path": tmp_path / "events.jsonl"}


def _seed_graph(tmp_path, *, child_statuses=("queued", "needs_approval")):
    p = _paths(tmp_path)
    root = Task(goal="cold email pipeline", assigned_agent="OpsLoggerAgent",
                status="running", gate="green")
    children = []
    for i, st in enumerate(child_statuses):
        c = Task(goal=f"child {i}", assigned_agent="CandidateResearchAgent",
                 parent_task_id=root.task_id,
                 intended_stage="outreach:candidate_check", status=st, gate="green")
        children.append(c)
    for t in (root, *children):
        ts.append_task_snapshot(t, p["store_path"])
    return p, root, children


def _valid_plan_json(root_id):
    return json.dumps({
        "intent": "summarize_candidates",
        "target": {"root_task_id": root_id, "task_id": None, "slug": None},
        "agent": None,
        "safety_level": "read_only",
        "requires_approval": False,
        "allowed_action": None,
        "reply": "후보군 요약입니다.",
        "proposed_next_steps": ["후보 선택", "승인"],
        "runner_action": None,
        "confidence": 0.8,
    }, ensure_ascii=False)


# === claude_orchestrator unit ================================================
# --- 20. config/env missing path --------------------------------------------
def test_inactive_when_env_unset(monkeypatch):
    _clean_env(monkeypatch)
    assert clo.is_enabled() is False
    assert clo.is_active() is False


def test_plan_disabled_without_env(monkeypatch, tmp_path):
    _clean_env(monkeypatch)
    p = _paths(tmp_path)
    res = clo.plan("후보군 요약해줘", store_path=p["store_path"])
    assert res["available"] is False
    assert res["status"] == clo.STATUS_DISABLED


def test_plan_unconfigured_without_api_key(monkeypatch, tmp_path):
    _clean_env(monkeypatch)
    monkeypatch.setenv("CLAUDE_ORCHESTRATOR_ENABLED", "1")  # enabled but no key
    p = _paths(tmp_path)
    res = clo.plan("후보군 요약해줘", store_path=p["store_path"])
    assert res["available"] is False
    assert res["status"] == clo.STATUS_UNCONFIGURED


# --- 19. mockable responder; parse ------------------------------------------
def test_plan_with_injected_responder_parses(tmp_path):
    p, root, _ = _seed_graph(tmp_path)
    captured = {}

    def responder(messages):
        captured["messages"] = messages
        return _valid_plan_json(root.task_id)

    res = clo.plan("후보군 요약해줘", store_path=p["store_path"],
                   events_path=p["events_path"], responder=responder)
    assert res["available"] is True
    assert res["status"] == clo.STATUS_OK
    assert res["plan"]["intent"] == "summarize_candidates"
    # context bundle was passed to the model and is JSON-serializable text
    assert "operator_message" in captured["messages"][0]["content"]


def test_parse_plan_tolerates_fence_and_rejects_junk():
    obj = clo.parse_plan('```json\n{"intent": "clarify"}\n```')
    assert obj == {"intent": "clarify"}
    assert clo.parse_plan("not json at all") is None
    assert clo.parse_plan("[1,2,3]") is None  # not an object


def test_responder_error_is_caught(tmp_path):
    p = _paths(tmp_path)

    def boom(_messages):
        raise RuntimeError("network down")

    res = clo.plan("후보군 요약해줘", store_path=p["store_path"], responder=boom)
    assert res["available"] is False
    assert res["status"] == clo.STATUS_ERROR


# --- context bundle is read-only + size-capped -------------------------------
def test_build_context_read_only_and_capped(tmp_path):
    p, root, _ = _seed_graph(tmp_path)
    before = p["store_path"].read_bytes()
    ctx = clo.build_context("상태?", store_path=p["store_path"],
                            events_path=p["events_path"], max_chars=4000)
    assert any(ar["task_id"] == root.task_id for ar in ctx["active_roots"])
    assert len(json.dumps(ctx, ensure_ascii=False)) <= 4000
    assert p["store_path"].read_bytes() == before  # zero write


# === adapter routing =========================================================
# --- 1. disabled -> ambiguous returns deterministic fallback, zero write -----
def test_disabled_ambiguous_falls_back_no_write(monkeypatch, tmp_path):
    _clean_env(monkeypatch)
    co.reset_pending()
    p, root, _ = _seed_graph(tmp_path)
    before = p["store_path"].read_bytes()
    ev_before = p["events_path"].read_bytes() if p["events_path"].exists() else b""
    out = adapter.handle_nl_message("후보군 중에서 뭐가 제일 나아?",
                                    operator_discord_id="606", **p)
    assert out["handled"] is True
    assert "m6a" not in out                       # planner never engaged
    assert out["intent"] == co.CANDIDATE_QUERY     # deterministic M5-A answer
    assert p["store_path"].read_bytes() == before
    after_ev = p["events_path"].read_bytes() if p["events_path"].exists() else b""
    assert after_ev == ev_before


# --- 2. valid Claude plan formats answer -------------------------------------
def test_valid_plan_formats_answer(monkeypatch, tmp_path):
    co.reset_pending()
    p, root, _ = _seed_graph(tmp_path)
    monkeypatch.setattr(clo, "is_active", lambda: True)

    def fake_plan(text, **kw):
        return {"available": True, "status": clo.STATUS_OK, "raw": "{}",
                "reason": None,
                "plan": json.loads(_valid_plan_json(root.task_id))}

    monkeypatch.setattr(clo, "plan", fake_plan)
    before = p["store_path"].read_bytes()
    out = adapter.handle_nl_message("후보군 중에서 뭐가 제일 나아?",
                                    operator_discord_id="606", **p)
    assert out.get("m6a") is True
    assert out["intent"] == "summarize_candidates"
    assert "Claude Orchestrator 판단" in out["reply"]
    assert p["store_path"].read_bytes() == before  # zero write


# --- 3. invalid JSON -> clarification ----------------------------------------
def test_unparsable_plan_clarifies(monkeypatch, tmp_path):
    co.reset_pending()
    p, _root, _ = _seed_graph(tmp_path)
    monkeypatch.setattr(clo, "is_active", lambda: True)
    monkeypatch.setattr(clo, "plan", lambda text, **kw: {
        "available": True, "status": clo.STATUS_UNPARSABLE, "plan": None,
        "raw": "garbage", "reason": "no json"})
    out = adapter.handle_nl_message("이 task에서 다음 agent가 뭘 해야 해?",
                                    operator_discord_id="606", **p)
    assert out.get("m6a") is True
    assert out["intent"] == "clarify"
    assert "확인 필요" in out["reply"]


# --- unavailable (error) -> deterministic fallback ---------------------------
def test_unavailable_plan_falls_back(monkeypatch, tmp_path):
    co.reset_pending()
    p, _root, _ = _seed_graph(tmp_path)
    monkeypatch.setattr(clo, "is_active", lambda: True)
    monkeypatch.setattr(clo, "plan", lambda text, **kw: {
        "available": False, "status": clo.STATUS_ERROR, "plan": None,
        "raw": None, "reason": "RuntimeError"})
    out = adapter.handle_nl_message("후보군 중에서 뭐가 제일 나아?",
                                    operator_discord_id="606", **p)
    assert "m6a" not in out
    assert out["intent"] == co.CANDIDATE_QUERY  # deterministic fallback


# --- 13-16. deterministic routes must NOT call the planner -------------------
def _planner_must_not_run(monkeypatch):
    calls = {"n": 0}

    def trap(*a, **k):
        calls["n"] += 1
        raise AssertionError("planner must not be called for deterministic routes")

    monkeypatch.setattr(clo, "is_active", lambda: True)
    monkeypatch.setattr(clo, "plan", trap)
    return calls


def test_approve_goes_to_m4_not_claude(monkeypatch, tmp_path):
    co.reset_pending()
    calls = _planner_must_not_run(monkeypatch)
    p, root, children = _seed_graph(tmp_path, child_statuses=("needs_approval",))
    out = adapter.handle_nl_message("승인해", operator_discord_id="606", **p)
    assert calls["n"] == 0
    assert out["intent"] == r.APPROVE_ONE
    assert "m6a" not in out


def test_dry_run_goes_to_m4b_not_claude(monkeypatch, tmp_path):
    co.reset_pending()
    calls = _planner_must_not_run(monkeypatch)
    p, _root, _ = _seed_graph(tmp_path)
    out = adapter.handle_nl_message("dry-run까지 해봐", operator_discord_id="606", **p)
    assert calls["n"] == 0          # planner never consulted -> stayed in M4-B
    # DRY_RUN classified; with no approved-queued candidate the handler clarifies.
    assert out["intent"] in (r.DRY_RUN, r.CLARIFY)
    assert "m6a" not in out


def test_cancel_goes_to_m5a5_not_claude(monkeypatch, tmp_path):
    co.reset_pending()
    calls = _planner_must_not_run(monkeypatch)
    p, root, _ = _seed_graph(tmp_path)
    out = adapter.handle_nl_message(f"{root.task_id} 삭제",
                                    operator_discord_id="606", **p)
    assert calls["n"] == 0
    assert out["intent"] == co.CANCEL_REQUEST
    assert "m6a" not in out


def test_cancel_capability_goes_to_m5a5_not_claude(monkeypatch, tmp_path):
    co.reset_pending()
    calls = _planner_must_not_run(monkeypatch)
    p, _root, _ = _seed_graph(tmp_path)
    out = adapter.handle_nl_message("진행 중인 작업 삭제도 가능한가?",
                                    operator_discord_id="606", **p)
    assert calls["n"] == 0
    assert out["intent"] == co.CANCEL_CAPABILITY
    assert "m6a" not in out


def test_new_task_creates_graph_not_claude(monkeypatch, tmp_path):
    co.reset_pending()
    calls = _planner_must_not_run(monkeypatch)
    p = _paths(tmp_path)  # empty store: a genuine new-task request
    out = adapter.handle_nl_message(
        "다음 브랜드 하나 골라서 콜드메일까지 준비해줘. 보내지는 마.",
        operator_discord_id="606", **p)
    assert calls["n"] == 0
    assert out["intent"] == r.CREATE_GRAPH
    assert out["handled"] is False
    assert "parent_task_id" in out


# --- 17. zero-write invariant for a valid M6-A dispatch ----------------------
def test_m6a_dispatch_zero_write(monkeypatch, tmp_path):
    co.reset_pending()
    p, root, _ = _seed_graph(tmp_path)
    monkeypatch.setattr(clo, "is_active", lambda: True)
    monkeypatch.setattr(clo, "plan", lambda text, **kw: {
        "available": True, "status": clo.STATUS_OK, "raw": "{}", "reason": None,
        "plan": json.loads(_valid_plan_json(root.task_id))})
    store_before = p["store_path"].read_bytes()
    ev_before = p["events_path"].read_bytes() if p["events_path"].exists() else b""

    out = adapter.handle_nl_message("후보군 중에서 뭐가 제일 나아?",
                                    operator_discord_id="606",
                                    runs_path=tmp_path / "runs.jsonl",
                                    reviews_path=tmp_path / "reviews.jsonl", **p)
    assert out.get("m6a") is True
    assert p["store_path"].read_bytes() == store_before
    after_ev = p["events_path"].read_bytes() if p["events_path"].exists() else b""
    assert after_ev == ev_before
    # no runs / reviews / approvals / packet files were created by the planner
    assert not (tmp_path / "runs.jsonl").exists()
    assert not (tmp_path / "reviews.jsonl").exists()
    assert not list(tmp_path.rglob("status.json"))
    assert not list(tmp_path.rglob("send_log.md"))


# --- planner-eligibility helper ----------------------------------------------
def test_planner_eligibility(monkeypatch):
    monkeypatch.setattr(clo, "is_active", lambda: True)
    assert adapter._planner_eligible("후보군 중에서 뭐가 제일 나아?") is True
    assert adapter._planner_eligible("이 task에서 다음 agent가 뭘 해야 해?") is True
    # deterministic ones are NOT eligible
    assert adapter._planner_eligible("승인해") is False
    assert adapter._planner_eligible("dry-run까지 해봐") is False
    assert adapter._planner_eligible("task_abc123 삭제") is False
    assert adapter._planner_eligible("진행 중인 작업 삭제도 가능한가?") is False
    assert adapter._planner_eligible("응") is False
    assert adapter._planner_eligible(
        "다음 브랜드 하나 골라서 콜드메일까지 준비해줘. 보내지는 마.") is False


def test_eligibility_false_when_planner_inactive(monkeypatch):
    monkeypatch.setattr(clo, "is_active", lambda: False)
    assert adapter._planner_eligible("후보군 중에서 뭐가 제일 나아?") is False


# --- import boundary: planner never imports runner/inputs/subprocess ---------
def test_orchestrator_import_boundary():
    src = Path(clo.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)
    top_level: set[str] = set()
    nested: set[str] = set()
    for node in tree.body:  # module-level statements only
        if isinstance(node, ast.Import):
            for a in node.names:
                top_level.add(a.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom) and node.module:
            top_level.add(node.module.split(".")[0])
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                nested.add(a.name.split(".")[0])
    # never import the execution surfaces
    for banned in ("task_runner", "task_inputs", "subprocess", "socket",
                   "webbrowser"):
        assert banned not in nested, banned
    # anthropic is allowed ONLY as a lazy import inside a function, never top-level
    assert "anthropic" not in top_level
