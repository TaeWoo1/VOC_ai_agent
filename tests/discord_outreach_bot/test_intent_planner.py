"""D4-1: intent schema + category validator + report-only planner tests.

Hermetic — the planner is driven by an injected responder returning canned JSON;
no real Claude, no API, no ANTHROPIC_API_KEY. Asserts: broad NL becomes a
structured intent but NEVER executes; collect/render are yellow (not forbidden);
send/publish are red; model-supplied category is ignored; missing targets ->
clarify; planner inert (None) without a responder so the deterministic shortcut
remains the fallback.
"""

from __future__ import annotations

import json

import agent_intents as ai
import intent_planner as ip


def _responder(obj):
    return lambda _messages: json.dumps(obj)


# === category policy ==========================================================
def test_category_table_partitions_intents():
    assert ai.GREEN | ai.YELLOW | ai.RED == set(ai.INTENTS)
    assert not (ai.GREEN & ai.YELLOW) and not (ai.YELLOW & ai.RED)


def test_categorize_values():
    assert ai.categorize("ask_status") == "green"
    assert ai.categorize("collect_reviews") == "yellow"
    assert ai.categorize("render_report") == "yellow"
    assert ai.categorize("send_outreach") == "red"
    assert ai.categorize("publish_post") == "red"
    assert ai.categorize("nonsense") is None


# === validator ================================================================
def test_collect_render_are_yellow_not_forbidden():
    v = ai.validate({"intent": "collect_reviews", "targets": {"target": "A123"}})
    assert v["outcome"] == ai.REPORT and v["category"] == "yellow"
    assert v["confirmation"] == "single_explicit"
    v2 = ai.validate({"intent": "render_report", "targets": {"task_id": "task_1"}})
    assert v2["category"] == "yellow" and v2["ok"]


def test_send_publish_are_red():
    v = ai.validate({"intent": "send_outreach", "targets": {"task_id": "task_1"}})
    assert v["category"] == "red"
    assert v["confirmation"] == "separate_final_approval"
    v2 = ai.validate({"intent": "publish_post", "targets": {"target": "ig_1"}})
    assert v2["category"] == "red"


def test_model_category_is_ignored():
    # model lies: claims green for a send. validator recomputes -> red.
    v = ai.validate({"intent": "send_outreach", "category": "green",
                     "targets": {"task_id": "task_1"}})
    assert v["category"] == "red"


def test_missing_targets_cause_clarify():
    v = ai.validate({"intent": "propose_agent_run", "targets": {"task_id": "task_1"}})
    assert v["outcome"] == ai.CLARIFY and "stage" in v["missing"]
    v2 = ai.validate({"intent": "cleanup_worktree", "targets": {}})
    assert v2["outcome"] == ai.CLARIFY and "run_id" in v2["missing"]


def test_unknown_intent_refused():
    v = ai.validate({"intent": "delete_everything"})
    assert v["outcome"] == ai.REFUSE


def test_report_outcome_never_executes():
    # the validator's strongest outcome is "report" — never "execute".
    for intent in ai.INTENTS:
        v = ai.validate({"intent": intent, "targets": {
            "task_id": "t", "run_id": "run_x", "stage": "candidate_shortlist_summary_prompt",
            "target": "A1"}})
        assert v["outcome"] in (ai.REPORT, ai.CLARIFY, ai.REFUSE)


# === report formatting ========================================================
def test_report_cards_are_korean_and_nonexecuting():
    g = ai.format_report(ai.validate({"intent": "ask_status"}))
    assert "조회/요약" in g and "실행 아님" in g
    y = ai.format_report(ai.validate({"intent": "collect_reviews",
                                      "targets": {"target": "A1"}}))
    assert "확인이 필요" in y and "아직 실행 안 함" in y
    r = ai.format_report(ai.validate({"intent": "send_outreach",
                                      "targets": {"task_id": "t"}}))
    assert "최종 명시 승인" in r


# === planner (report-only, injected responder) ===============================
def test_broad_nl_becomes_intent_but_does_not_execute():
    out = ip.report_only(
        "올리브영 리뷰 좀 모아줘",
        responder=_responder({"intent": "collect_reviews",
                              "targets": {"target": "A0001"},
                              "rationale": "수집 요청", "confidence": 0.8}))
    assert out is not None and out["handled"]
    assert out["outcome"] == "report" and out["category"] == "yellow"
    assert out["executed"] is False
    assert "아직 실행 안 함" in out["reply"]


def test_planner_inert_without_responder():
    # D4-1 has no live backend -> None so the deterministic shortcut runs.
    assert ip.report_only("진행해") is None


def test_planner_unparsable_falls_back():
    assert ip.report_only("x", responder=lambda _m: "not json") is None


def test_planner_responder_error_falls_back():
    def boom(_m):
        raise RuntimeError("backend down")
    assert ip.report_only("x", responder=boom) is None


def test_send_via_planner_is_red_report_only():
    out = ip.report_only(
        "이거 발송해",
        responder=_responder({"intent": "send_outreach",
                              "targets": {"task_id": "task_1"},
                              "rationale": "발송 요청", "confidence": 0.9}))
    assert out["category"] == "red" and out["executed"] is False
    assert "최종 명시 승인" in out["reply"]


def test_missing_targets_via_planner_clarifies():
    out = ip.report_only(
        "에이전트 돌려",
        responder=_responder({"intent": "propose_agent_run",
                              "targets": {"task_id": "task_1"},
                              "rationale": "stage 없음", "confidence": 0.5}))
    assert out["outcome"] == "clarify"


# === handle_nl_message wiring: planner inert by default ======================
def test_handle_nl_message_planner_inert_by_default(monkeypatch, tmp_path):
    # with no live backend, the planner step returns None and the existing
    # deterministic/M5 flow handles the message (no behavior change).
    import task_discord_adapter as tda
    store = tmp_path / "tasks.jsonl"
    events = tmp_path / "events.jsonl"
    out = tda.handle_nl_message("다음 후보군이 뭐지?", operator_discord_id="op1",
                                store_path=store, events_path=events)
    # planner did not claim it (intent_* would be the planner's namespace)
    assert not str(out.get("intent", "")).startswith("intent_")
