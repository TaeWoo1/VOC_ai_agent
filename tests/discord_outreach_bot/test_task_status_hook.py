"""D5-2b: wiring tests for the read-only operator-status hook (step 0c) in
task_discord_adapter.handle_nl_message.

The hook must:
  - claim only anchored status phrases and return intent=operator_status,
  - never claim 진행해 / 취소 / final-approval / live-collect phrases,
  - never write / mutate / execute anything.

All state lives in tmp_path; no real packet/output dirs are touched.
"""

from __future__ import annotations

import re

import operator_status
import status_discord_adapter
import task_discord_adapter as adapter


def _paths(tmp_path):
    return {"store_path": tmp_path / "orchestration_tasks.jsonl",
            "events_path": tmp_path / "orchestration_events.jsonl"}


# --------------------------------------------------------------------------- #
# Status phrases route to operator_status
# --------------------------------------------------------------------------- #


def test_korean_status_phrase_returns_operator_status(tmp_path):
    out = adapter.handle_nl_message(
        "상태 알려줘", operator_discord_id="606", **_paths(tmp_path))
    assert out["handled"] is True
    assert out["intent"] == "operator_status"
    assert "Operator status" in out["reply"]


def test_english_status_phrase_returns_operator_status(tmp_path):
    out = adapter.handle_nl_message(
        "status", operator_discord_id="606", **_paths(tmp_path))
    assert out["intent"] == "operator_status"
    assert out["handled"] is True


def test_smoke_modifier_passed_through(tmp_path, monkeypatch):
    captured = {}
    real_build = operator_status.build_operator_status

    def _spy(*args, **kwargs):
        captured["include_smoke"] = kwargs.get("include_smoke")
        return real_build(*args, **kwargs)

    # Patch the name the adapter actually calls (operator_status module global).
    monkeypatch.setattr(operator_status, "build_operator_status", _spy)
    out = adapter.handle_nl_message(
        "상태 알려줘 smoke 포함", operator_discord_id="606", **_paths(tmp_path))
    assert out["intent"] == "operator_status"
    assert captured["include_smoke"] is True


# --------------------------------------------------------------------------- #
# Non-status phrases must NOT be claimed by the status hook
# --------------------------------------------------------------------------- #


def test_broad_nl_status_question_not_operator_status(tmp_path):
    out = adapter.handle_nl_message(
        "상태가 어때?", operator_discord_id="606", **_paths(tmp_path))
    assert out["intent"] != "operator_status"


def test_agent_status_phrase_not_operator_status(tmp_path):
    out = adapter.handle_nl_message(
        "에이전트 상태", operator_discord_id="606", **_paths(tmp_path))
    assert out["intent"] != "operator_status"


def test_proceed_phrase_not_claimed_by_status_hook(tmp_path):
    # With no agent run pending, the agent-lifecycle owner returns None and the
    # status hook MUST also decline (returns None at the adapter), so the message
    # falls through to the existing conversational flow — never operator_status.
    out = adapter.handle_nl_message(
        "진행해", operator_discord_id="606", **_paths(tmp_path))
    assert out["intent"] != "operator_status"


def test_final_send_approval_not_claimed_by_status_hook(tmp_path):
    out = adapter.handle_nl_message(
        "최종 발송 승인", operator_discord_id="606", **_paths(tmp_path))
    assert out["intent"] != "operator_status"


def test_final_publish_approval_not_claimed_by_status_hook(tmp_path):
    out = adapter.handle_nl_message(
        "최종 게시 승인", operator_discord_id="606", **_paths(tmp_path))
    assert out["intent"] != "operator_status"


def test_live_collect_approval_not_claimed_by_status_hook(tmp_path):
    out = adapter.handle_nl_message(
        "라이브 수집 승인", operator_discord_id="606", **_paths(tmp_path))
    assert out["intent"] != "operator_status"


# --------------------------------------------------------------------------- #
# Static wiring guards
# --------------------------------------------------------------------------- #


def test_adapter_imports_status_module_and_no_action_dispatch():
    import inspect

    src = inspect.getsource(adapter)
    assert "import status_discord_adapter" in src
    # D5-2b adds no provider / dispatch / network imports. Import-shaped tokens
    # only (the bare word "instagram" legitimately appears as a workflow name).
    for tok in ("import action_dispatch", "smtplib", "googleapiclient",
                "import instagram", "from instagram",
                "import requests", "import httpx", "urllib.request", "import socket"):
        assert tok not in src, f"unexpected import/reference added: {tok}"


def test_status_hook_placed_after_agent_handle_and_before_question_gate():
    import inspect

    src = inspect.getsource(adapter.handle_nl_message)
    pos_agent = src.index("_agent_discord.try_handle")
    pos_status = src.index("_status_discord.try_handle_status_message")
    pos_question = src.index("is_question_like")
    assert pos_agent < pos_status < pos_question


def test_status_adapter_regex_unchanged():
    # D5-2b must not alter the D5-2a phrase regex.
    assert isinstance(status_discord_adapter._STATUS_RE, re.Pattern)
    assert status_discord_adapter._STATUS_RE.match("status") is not None
    assert status_discord_adapter._STATUS_RE.match("상태가 어때?") is None
