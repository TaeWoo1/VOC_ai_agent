"""Tests for the transport-independent core of discord_bot.py (v0.2).

The module imports cleanly whether or not discord.py is installed; these tests
never connect to Discord. record_approval is exercised against a synthetic
packet and a tmp approvals log — it must record intent WITHOUT mutating any
packet file.
"""

from __future__ import annotations

import json

import discord_bot as bot


def _make_packet(tmp_path, slug, status):
    pdir = tmp_path / slug
    pdir.mkdir()
    (pdir / "status.json").write_text(json.dumps(status), encoding="utf-8")
    return pdir


def test_module_imports_without_discord():
    # HAS_DISCORD may be False in this env; the module must still import and
    # expose its core helpers.
    assert hasattr(bot, "record_approval")
    assert hasattr(bot, "run_bot")
    assert isinstance(bot.HAS_DISCORD, bool)


def test_allowlist_is_fail_closed():
    assert bot._allowed({"discord": {"allowed_operator_ids": []}}, 123) is False
    assert bot._allowed({"discord": {"allowed_operator_ids": [123]}}, 123) is True
    assert bot._allowed({"discord": {"allowed_operator_ids": [999]}}, 123) is False


def test_run_bot_raises_clear_message_without_discord(monkeypatch):
    monkeypatch.setattr(bot, "HAS_DISCORD", False)
    try:
        bot.run_bot()
    except NotImplementedError as exc:
        assert "discord.py" in str(exc)
        return
    raise AssertionError("expected NotImplementedError when discord.py is absent")


def test_record_approval_writes_log_without_touching_packet(tmp_path):
    status = {"state": "PDF_READY", "brand": "테스트", "goods_no": "A1"}
    pdir = _make_packet(tmp_path, "alpha_v1", status)
    before = (pdir / "status.json").read_text(encoding="utf-8")
    log = tmp_path / "approvals.log.jsonl"

    config = {
        "targets_dir": str(tmp_path),
        "discord": {"allowed_operator_ids": [1]},
        "approvals": {"log_path": str(log)},
    }
    result = bot.record_approval(
        slug="alpha_v1", stage="outreach:prepare_send",
        operator_discord_id="1", operator_display_name="founder",
        notes="ok to prepare", config=config)

    assert result["ok"] is True
    rec = result["record"]
    assert rec["target_slug"] == "alpha_v1"
    assert rec["current_state"] == "PDF_READY"
    assert rec["approved_stage"] == "prepare_send"   # prefix stripped
    assert rec["execution_mode"] == "prompt_only"
    assert rec["source"] == "discord"
    assert rec["prompt_hash"].startswith("sha256:")

    # packet file is byte-for-byte unchanged
    assert (pdir / "status.json").read_text(encoding="utf-8") == before
    # only the tmp log was written
    assert log.exists()
    assert len(log.read_text(encoding="utf-8").splitlines()) == 1


def test_record_approval_unknown_slug(tmp_path):
    config = {"targets_dir": str(tmp_path), "discord": {}, "approvals": {}}
    result = bot.record_approval(
        slug="nope", stage="outreach:prepare_send",
        operator_discord_id="1", operator_display_name=None,
        notes="", config=config)
    assert result["ok"] is False
