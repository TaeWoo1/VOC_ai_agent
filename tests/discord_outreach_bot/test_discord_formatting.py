"""Read-only tests for the v0.2 Discord formatting helpers.

No Discord connection. Synthetic packets are built in tmp_path so assertions
are deterministic; a tolerant pass also runs against the real targets dir.
"""

from __future__ import annotations

import datetime as _dt
import json

import discord_formatting as fmt
import status_reader as sr


def _make_packet(tmp_path, slug, status):
    pdir = tmp_path / slug
    pdir.mkdir()
    (pdir / "status.json").write_text(json.dumps(status), encoding="utf-8")
    return pdir


def _ready_status():
    return {
        "state": "READY_TO_SCHEDULE",
        "brand": "테스트브랜드",
        "goods_no": "A000000000001",
        "product_name": "테스트 수분크림",
        "corpus": {"unique": 488},
        "send": {
            "recipient_primary": "mkt@example.com",
            "scheduled_send_time": "TBD",
            "follow_up_due": "TBD",
        },
    }


def test_format_list_shows_gate_state_recipient(tmp_path):
    _make_packet(tmp_path, "alpha_v1", _ready_status())
    out = fmt.format_list(tmp_path)
    assert "테스트브랜드" in out
    assert "`READY_TO_SCHEDULE`" in out
    assert "mkt@example.com" in out
    assert "🟢" in out  # READY_TO_SCHEDULE is a green gate


def test_format_list_empty(tmp_path):
    assert "No outreach targets" in fmt.format_list(tmp_path)


def test_format_status_compact(tmp_path):
    _make_packet(tmp_path, "alpha_v1", _ready_status())
    out = fmt.format_status("alpha_v1", tmp_path)
    assert "테스트브랜드" in out
    assert "corpus: 488" in out
    assert "recipient: mkt@example.com" in out
    assert "next:" in out


def test_format_status_unknown_slug(tmp_path):
    assert "No packet matching" in fmt.format_status("nope", tmp_path)


def test_format_next_red_gate_shows_approval(tmp_path):
    _make_packet(tmp_path, "beta_v1", {"state": "PDF_READY", "brand": "B"})
    out = fmt.format_next("beta_v1", tmp_path)
    assert "🔴" in out
    assert "prepare_send" in out
    assert "operator approval" in out


def test_format_validate_ok_and_missing(tmp_path):
    # PACKET_DRAFTED requires the 4 packet files; none exist -> MISSING
    _make_packet(tmp_path, "gamma_v1", {"state": "PACKET_DRAFTED", "brand": "G"})
    out = fmt.format_validate("gamma_v1", tmp_path)
    assert "❌" in out
    assert "MISSING" in out

    # CANDIDATE_SELECTED requires nothing yet -> OK
    _make_packet(tmp_path, "delta_v1", {"state": "CANDIDATE_SELECTED", "brand": "D"})
    out2 = fmt.format_validate("delta_v1", tmp_path)
    assert "✅ OK" in out2


def test_build_prompt_delivery_inline(tmp_path):
    _make_packet(tmp_path, "alpha_v1", _ready_status())
    # generous inline limit so a full guardrail-laden prompt still fits inline
    d = fmt.build_prompt_delivery("alpha_v1", targets_dir=tmp_path,
                                  inline_limit=10_000)
    assert d["ok"] is True
    assert d["kind"] == "inline"
    assert d["message"].startswith("```")
    assert "outreach_packet workflow" in d["prompt"]


def test_build_prompt_delivery_saves_when_too_long(tmp_path):
    _make_packet(tmp_path, "alpha_v1", _ready_status())
    gdir = tmp_path / "generated"
    d = fmt.build_prompt_delivery("alpha_v1", targets_dir=tmp_path,
                                  generated_dir=gdir, inline_limit=10)
    assert d["kind"] == "file"
    saved = gdir / "alpha_v1__auto.md"
    assert saved.exists()
    assert saved.read_text(encoding="utf-8") == d["prompt"]
    # the saved prompt path is NOT inside any packet folder
    assert "generated" in d["path"]


def test_build_prompt_delivery_unknown_slug(tmp_path):
    d = fmt.build_prompt_delivery("nope", targets_dir=tmp_path)
    assert d["ok"] is False


def test_format_followups_no_write(tmp_path):
    _make_packet(tmp_path, "alpha_v1", _ready_status())
    out = fmt.format_followups(_dt.date(2026, 6, 1), tmp_path)
    # READY_TO_SCHEDULE is not a SCHEDULED/SENT state -> no follow-up rows
    assert "No SCHEDULED/SENT" in out


# --- tolerant pass over the REAL targets dir (read-only) ---------------------
def test_real_targets_format_without_error():
    targets = sr.discover_targets()
    if not targets:
        return  # nothing to assert in a fresh checkout
    listing = fmt.format_list()
    assert isinstance(listing, str) and listing
    for t in targets:
        assert isinstance(fmt.format_status(t.slug), str)
        assert isinstance(fmt.format_next(t.slug), str)
        assert isinstance(fmt.format_validate(t.slug), str)
