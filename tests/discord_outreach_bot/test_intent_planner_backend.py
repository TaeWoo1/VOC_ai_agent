"""D4-2b: live local-Claude intent-planner backend tests.

Hermetic by default — a FakePopen seam replaces the planner's subprocess so NO
real Claude is invoked, NO network, NO ANTHROPIC_API_KEY. A single optional live
smoke is gated behind RUN_LIVE_INTENT_PLANNER_TEST=1 and skipped by default.
"""

from __future__ import annotations

import json
import os
import subprocess

import pytest

import intent_planner as ip
import intent_planner_backend as be


# --- fake subprocess seam ----------------------------------------------------
def make_fake_popen(*, stdout="", returncode=0, timeout=False):
    rec: dict = {}

    class _FP:
        def __init__(self, argv, **kw):
            rec["argv"] = argv
            rec["kw"] = kw
            self.pid = 4321
            self.returncode = None

        def communicate(self, input=None, timeout=None):
            rec["input"] = input
            if timeout and rec.get("_raised") is None and _FP._timeout:
                rec["_raised"] = True
                raise subprocess.TimeoutExpired(cmd="claude", timeout=timeout)
            self.returncode = returncode
            return stdout, ""

        def kill(self):
            rec["killed"] = True

    _FP._timeout = timeout
    return _FP, rec


def _envelope(intent_obj):
    """claude --output-format json envelope wrapping the model's text."""
    return json.dumps({"type": "result", "subtype": "success",
                       "result": json.dumps(intent_obj), "is_error": False})


# === argv / safety ===========================================================
def test_argv_is_planmode_notools_no_bare():
    argv = be.build_argv()
    assert argv[0] == "claude" and "-p" in argv
    assert argv[argv.index("--permission-mode") + 1] == "plan"
    assert argv[argv.index("--output-format") + 1] == "json"
    assert argv[argv.index("--tools") + 1] == ""        # all tools disabled
    assert "--no-session-persistence" in argv and "--disable-slash-commands" in argv
    assert "--bare" not in argv and "acceptEdits" not in argv


def test_scrub_env_removes_api_key():
    out = be.scrub_env({"ANTHROPIC_API_KEY": "x", "PATH": "/bin"})
    assert out == {"PATH": "/bin"}


def test_backend_no_shell_true_source():
    import ast
    import inspect
    tree = ast.parse(inspect.getsource(be))
    for node in ast.walk(tree):
        if isinstance(node, ast.keyword) and node.arg == "shell":
            assert not (isinstance(node.value, ast.Constant)
                        and node.value.value is True)


# === run_planner unwrapping + failure modes ==================================
def test_run_planner_unwraps_envelope(monkeypatch):
    monkeypatch.setattr(be, "which", lambda _b: "/bin/claude")
    fp, rec = make_fake_popen(stdout=_envelope({"intent": "ask_status"}))
    monkeypatch.setattr(be, "_PLANNER_POPEN", fp)
    out = be.run_planner("hello")
    assert json.loads(out)["intent"] == "ask_status"
    assert rec["input"].endswith("hello") or "operator message" in rec["input"]
    assert rec["kw"]["start_new_session"] is True
    assert rec["kw"].get("shell", False) is False


def test_run_planner_missing_binary(monkeypatch):
    monkeypatch.setattr(be, "which", lambda _b: None)
    assert be.run_planner("x") is None


def test_run_planner_timeout(monkeypatch):
    monkeypatch.setattr(be, "which", lambda _b: "/bin/claude")
    fp, rec = make_fake_popen(stdout="partial", timeout=True)
    monkeypatch.setattr(be, "_PLANNER_POPEN", fp)
    killed = {}
    monkeypatch.setattr(be.os, "getpgid", lambda pid: pid)
    monkeypatch.setattr(be.os, "killpg", lambda pg, sig: killed.update(pg=pg))
    assert be.run_planner("x", timeout_s=1) is None
    assert killed.get("pg") == 4321


def test_run_planner_nonzero_exit(monkeypatch):
    monkeypatch.setattr(be, "which", lambda _b: "/bin/claude")
    fp, rec = make_fake_popen(stdout="{}", returncode=2)
    monkeypatch.setattr(be, "_PLANNER_POPEN", fp)
    assert be.run_planner("x") is None


# === plan_and_act with the live backend (faked) ==============================
def _enable_live(monkeypatch, *, stdout):
    monkeypatch.setenv("AGENT_INTENT_PLANNER_ENABLED", "1")
    monkeypatch.setattr(be, "which", lambda _b: "/bin/claude")
    fp, rec = make_fake_popen(stdout=stdout)
    monkeypatch.setattr(be, "_PLANNER_POPEN", fp)
    return rec


def test_live_backend_disabled_by_default():
    # flag unset -> inert -> fall back
    assert ip.plan_and_act("아무 말") is None


def test_live_backend_valid_json_dispatches(monkeypatch):
    _enable_live(monkeypatch, stdout=_envelope(
        {"intent": "ask_status", "targets": {}, "rationale": "상태", "confidence": 0.9}))
    out = ip.plan_and_act("지금 상태 어때", operator_discord_id="op1")
    assert out is not None and out["intent"] == "intent_ask_status"
    assert out["executed"] is True  # read-only status


def test_live_backend_invalid_json_falls_back(monkeypatch):
    _enable_live(monkeypatch, stdout="not json at all")
    assert ip.plan_and_act("뭐라도", operator_discord_id="op1") is None


def test_live_backend_unavailable_falls_back(monkeypatch):
    monkeypatch.setenv("AGENT_INTENT_PLANNER_ENABLED", "1")
    monkeypatch.setattr(be, "which", lambda _b: None)  # claude missing
    assert ip.plan_and_act("x", operator_discord_id="op1") is None


def test_model_category_ignored_via_live(monkeypatch):
    # model lies category=green for a send -> validator recomputes red, report-only
    _enable_live(monkeypatch, stdout=_envelope(
        {"intent": "send_outreach", "category": "green",
         "targets": {"task_id": "task_1"}, "rationale": "발송", "confidence": 0.9}))
    out = ip.plan_and_act("이거 발송해", operator_discord_id="op1")
    assert out["executed"] is False
    assert "최종 명시 승인" in out["reply"]


def test_collect_render_report_only_via_live(monkeypatch):
    _enable_live(monkeypatch, stdout=_envelope(
        {"intent": "collect_reviews", "targets": {"target": "A1"},
         "rationale": "수집", "confidence": 0.8}))
    out = ip.plan_and_act("리뷰 모아줘", operator_discord_id="op1")
    assert out["executed"] is False and "아직 실행 안 함" in out["reply"]


def test_bounded_edit_unreachable_via_live(monkeypatch):
    # even if the model emits an edit-ish intent, it's not in the schema -> refuse
    _enable_live(monkeypatch, stdout=_envelope(
        {"intent": "apply_edit", "targets": {}, "rationale": "x", "confidence": 0.9}))
    out = ip.plan_and_act("편집해", operator_discord_id="op1")
    assert out["executed"] is False and out["intent"] == "intent_refuse"


# === injected responder still works (D4-2 contract) ==========================
def test_injected_responder_still_works():
    def responder(_m):
        return json.dumps({"intent": "summarize_state", "targets": {},
                           "rationale": "r", "confidence": 0.7})
    out = ip.plan_and_act("요약", operator_discord_id="op1", responder=responder)
    assert out["intent"] == "intent_summarize_state"


# === optional gated live smoke (skipped by default) ==========================
@pytest.mark.skipif(
    os.environ.get("RUN_LIVE_INTENT_PLANNER_TEST") != "1",
    reason="live intent planner smoke disabled (set RUN_LIVE_INTENT_PLANNER_TEST=1)")
def test_live_intent_planner_smoke():
    if not be.is_available():
        pytest.skip("claude binary not available")
    raw = be.run_planner(
        ip.INTENT_SYSTEM_PROMPT + "\n\n[operator message]\n지금 상태 알려줘")
    assert raw is None or isinstance(raw, str)
