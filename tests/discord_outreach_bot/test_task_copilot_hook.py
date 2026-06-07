"""D6-1b: wiring tests for the advisory operator-copilot hook (step 0d) in
task_discord_adapter.handle_nl_message.

The hook must:
  - stay INERT by default (flag off AND responder seam None -> behavior
    byte-identical to pre-D6-1b),
  - claim only the safe conversational bucket when flag on + responder wired,
  - never claim 진행해 / 응 / 취소 / final-approval / live-collect / status /
    new-task / explicit-task-id-cancel phrases,
  - fall through to the existing deterministic flow on responder failure.

All orchestration state lives in tmp_path; every test uses a fake responder —
no real Claude, no subprocess, no network.
"""

from __future__ import annotations

import operator_copilot
import task_discord_adapter as adapter

_FLAG = "AGENT_OPERATOR_COPILOT_ENABLED"


def _paths(tmp_path):
    return {"store_path": tmp_path / "orchestration_tasks.jsonl",
            "events_path": tmp_path / "orchestration_events.jsonl"}


def _wire(monkeypatch, reply: str = "조언 텍스트"):
    monkeypatch.setenv(_FLAG, "1")
    monkeypatch.setattr(adapter, "_COPILOT_RESPONDER", lambda prompt: reply)


# --------------------------------------------------------------------------- #
# Default-inert: flag off and/or responder unwired
# --------------------------------------------------------------------------- #


def test_default_state_is_inert(tmp_path, monkeypatch):
    monkeypatch.delenv(_FLAG, raising=False)
    assert adapter._COPILOT_RESPONDER is None  # production seam stays empty
    out = adapter.handle_nl_message(
        "진행된 내용 정리", operator_discord_id="606", **_paths(tmp_path))
    assert out["intent"] != "operator_copilot"


def test_flag_on_but_responder_unwired_is_inert(tmp_path, monkeypatch):
    monkeypatch.setenv(_FLAG, "1")
    out = adapter.handle_nl_message(
        "진행된 내용 정리", operator_discord_id="606", **_paths(tmp_path))
    assert out["intent"] != "operator_copilot"


def test_responder_wired_but_flag_off_is_inert(tmp_path, monkeypatch):
    monkeypatch.delenv(_FLAG, raising=False)
    monkeypatch.setattr(adapter, "_COPILOT_RESPONDER", lambda prompt: "조언")
    out = adapter.handle_nl_message(
        "진행된 내용 정리", operator_discord_id="606", **_paths(tmp_path))
    assert out["intent"] != "operator_copilot"


def test_flag_off_output_identical_to_wired_failure(tmp_path, monkeypatch):
    # Baseline reply with everything off…
    monkeypatch.delenv(_FLAG, raising=False)
    base = adapter.handle_nl_message(
        "진행된 내용 정리", operator_discord_id="606", **_paths(tmp_path))
    # …must equal the reply when the wired responder fails (fall-through).
    monkeypatch.setenv(_FLAG, "1")

    def _boom(prompt):
        raise RuntimeError("backend gone")

    monkeypatch.setattr(adapter, "_COPILOT_RESPONDER", _boom)
    failed = adapter.handle_nl_message(
        "진행된 내용 정리", operator_discord_id="606", **_paths(tmp_path))
    assert failed == base


# --------------------------------------------------------------------------- #
# Flag on + fake responder claims the safe bucket
# --------------------------------------------------------------------------- #


def test_cancel_capability_prose_goes_to_copilot(tmp_path, monkeypatch):
    _wire(monkeypatch)
    out = adapter.handle_nl_message(
        "진행된 내용 정리", operator_discord_id="606", **_paths(tmp_path))
    assert out["intent"] == "operator_copilot"
    assert out["handled"] is True
    assert out["reply"].startswith("🤖 copilot(조언 전용) · 실행 없음\n")
    assert out["reply"].endswith("조언 텍스트")


def test_next_action_question_goes_to_copilot(tmp_path, monkeypatch):
    _wire(monkeypatch)
    out = adapter.handle_nl_message(
        "지금 뭐부터 하면 돼?", operator_discord_id="606", **_paths(tmp_path))
    assert out["intent"] == "operator_copilot"


def test_store_and_events_paths_passed_through(tmp_path, monkeypatch):
    _wire(monkeypatch)
    captured = {}
    real = operator_copilot.try_handle_copilot_message

    def _spy(text, **kwargs):
        captured.update(kwargs)
        return real(text, **kwargs)

    monkeypatch.setattr(adapter._copilot, "try_handle_copilot_message", _spy)
    paths = _paths(tmp_path)
    adapter.handle_nl_message("진행된 내용 정리", operator_discord_id="606", **paths)
    assert captured["store_path"] == paths["store_path"]
    assert captured["events_path"] == paths["events_path"]


# --------------------------------------------------------------------------- #
# Preserved phrases are NEVER claimed, even fully wired
# --------------------------------------------------------------------------- #


def test_proceed_phrase_not_claimed(tmp_path, monkeypatch):
    _wire(monkeypatch)
    out = adapter.handle_nl_message(
        "진행해", operator_discord_id="606", **_paths(tmp_path))
    assert out["intent"] != "operator_copilot"


def test_bare_confirmation_not_claimed(tmp_path, monkeypatch):
    _wire(monkeypatch)
    out = adapter.handle_nl_message(
        "응", operator_discord_id="606", **_paths(tmp_path))
    assert out["intent"] != "operator_copilot"


def test_bare_cancel_not_claimed(tmp_path, monkeypatch):
    _wire(monkeypatch)
    out = adapter.handle_nl_message(
        "취소", operator_discord_id="606", **_paths(tmp_path))
    assert out["intent"] != "operator_copilot"


def test_final_send_approval_not_claimed(tmp_path, monkeypatch):
    _wire(monkeypatch)
    out = adapter.handle_nl_message(
        "최종 발송 승인", operator_discord_id="606", **_paths(tmp_path))
    assert out["intent"] != "operator_copilot"


def test_final_publish_approval_not_claimed(tmp_path, monkeypatch):
    _wire(monkeypatch)
    out = adapter.handle_nl_message(
        "최종 게시 승인", operator_discord_id="606", **_paths(tmp_path))
    assert out["intent"] != "operator_copilot"


def test_live_collect_approval_not_claimed(tmp_path, monkeypatch):
    _wire(monkeypatch)
    out = adapter.handle_nl_message(
        "라이브 수집 승인", operator_discord_id="606", **_paths(tmp_path))
    assert out["intent"] != "operator_copilot"


def test_status_phrase_still_operator_status(tmp_path, monkeypatch):
    # 0c outranks 0d: anchored status phrases keep their deterministic owner.
    _wire(monkeypatch)
    out = adapter.handle_nl_message(
        "상태 알려줘", operator_discord_id="606", **_paths(tmp_path))
    assert out["intent"] == "operator_status"
    out_en = adapter.handle_nl_message(
        "status", operator_discord_id="606", **_paths(tmp_path))
    assert out_en["intent"] == "operator_status"


def test_explicit_task_id_cancel_not_claimed(tmp_path, monkeypatch):
    _wire(monkeypatch)
    out = adapter.handle_nl_message(
        "task_3fa2c1 정리", operator_discord_id="606", **_paths(tmp_path))
    assert out["intent"] != "operator_copilot"


def test_new_task_imperative_not_claimed_and_still_creates_graph(tmp_path, monkeypatch):
    _wire(monkeypatch)
    out = adapter.handle_nl_message(
        "snature 카드뉴스 만들어줘", operator_discord_id="606", **_paths(tmp_path))
    assert out["intent"] != "operator_copilot"
    assert "parent_task_id" in out  # graph-creation path unchanged


# --------------------------------------------------------------------------- #
# Static wiring guards
# --------------------------------------------------------------------------- #


def test_copilot_hook_placed_after_status_hook_and_before_question_gate():
    import inspect

    src = inspect.getsource(adapter.handle_nl_message)
    pos_status = src.index("_status_discord.try_handle_status_message")
    pos_copilot = src.index("_copilot.try_handle_copilot_message")
    pos_question = src.index("is_question_like")
    assert pos_status < pos_copilot < pos_question


def test_adapter_adds_no_forbidden_imports():
    import inspect

    src = inspect.getsource(adapter)
    assert "import operator_copilot" in src
    for tok in ("import action_dispatch", "smtplib", "googleapiclient",
                "import instagram", "from instagram", "import subprocess",
                "import requests", "import httpx", "urllib.request", "import socket"):
        assert tok not in src, f"unexpected import/reference added: {tok}"


def test_copilot_module_unchanged_by_wiring():
    # D6-1b wires; it must not alter the D6-1a module's flag or eligibility.
    assert operator_copilot.is_enabled.__module__ == "operator_copilot"
    assert operator_copilot.is_copilot_eligible("진행된 내용 정리") is True
    assert operator_copilot.is_copilot_eligible("task_3fa2c1 정리") is False
