"""Read-only / tmp-only tests for the append-only approval log (v0.2).

These tests never connect to Discord and never touch real packet folders or the
real approvals.log.jsonl — every write goes to a pytest tmp_path.
"""

from __future__ import annotations

import datetime as _dt
import json

import approval_log as alog


def _fixed_now():
    return _dt.datetime(2026, 6, 8, 2, 0, 0, tzinfo=_dt.timezone.utc)


REQUIRED_FIELDS = {
    "timestamp_utc",
    "operator_discord_id",
    "operator_display_name",
    "target_slug",
    "current_state",
    "approved_stage",
    "execution_mode",
    "prompt_hash",
    "prompt_preview",
    "notes",
    "source",
}


def _make(**over):
    base = dict(
        target_slug="snature_aqua_squalane_cream_v1",
        current_state="SCHEDULED",
        approved_stage="follow_up",
        prompt="Use the outreach_packet workflow ...",
        operator_discord_id="123456789",
        operator_display_name="founder",
        notes="no reply by due date",
        now=_fixed_now,
    )
    base.update(over)
    return alog.make_record(**base)


def test_record_has_all_required_fields():
    rec = _make()
    assert set(rec) == REQUIRED_FIELDS
    assert rec["execution_mode"] == "prompt_only"
    assert rec["source"] == "discord"
    assert rec["timestamp_utc"] == "2026-06-08T02:00:00Z"
    assert rec["approved_stage"] == "follow_up"


def test_prompt_hash_is_stable_and_prefixed():
    h1 = alog.prompt_hash("identical prompt text")
    h2 = alog.prompt_hash("identical prompt text")
    h3 = alog.prompt_hash("different prompt text")
    assert h1 == h2
    assert h1.startswith("sha256:")
    assert h1 != h3
    # record carries the same hash as the standalone function
    rec = _make(prompt="identical prompt text")
    assert rec["prompt_hash"] == h1


def test_prompt_preview_is_truncated_and_single_line():
    long_prompt = "line one\nline two\n" + ("x" * 500)
    rec = _make(prompt=long_prompt)
    assert "\n" not in rec["prompt_preview"]
    assert len(rec["prompt_preview"]) <= 200


def test_invalid_execution_mode_rejected():
    try:
        _make(execution_mode="auto_send")
    except ValueError:
        return
    raise AssertionError("expected ValueError for bad execution_mode")


def test_append_is_append_only(tmp_path):
    log = tmp_path / "approvals.log.jsonl"
    alog.append_record(_make(notes="first"), log)
    alog.append_record(_make(notes="second"), log)
    alog.append_record(_make(notes="third"), log)

    recs = alog.read_records(log)
    assert len(recs) == 3
    assert [r["notes"] for r in recs] == ["first", "second", "third"]

    # raw file is exactly 3 JSONL lines, each a valid object
    lines = log.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 3
    for line in lines:
        assert set(json.loads(line)) == REQUIRED_FIELDS


def test_append_creates_parent_dir(tmp_path):
    log = tmp_path / "nested" / "dir" / "approvals.log.jsonl"
    path = alog.append_record(_make(), log)
    assert path.exists()
    assert len(alog.read_records(log)) == 1


def test_read_records_missing_log_is_empty(tmp_path):
    assert alog.read_records(tmp_path / "absent.jsonl") == []
