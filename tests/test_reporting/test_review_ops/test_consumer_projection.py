from __future__ import annotations

import re

from src.voc.reporting.review_ops.consumer_projection import (
    AUDIT_ID_CAP,
    TRUNCATE_TO,
    derive,
)

# Cardnews-aligned banned framings + the user-listed buyer-safe ban set.
BANNED_FRAMINGS = (
    "숨긴",
    "실체",
    "폭로",
    "속았다",
    "결함",
    "방치",
)

# Cardnews safety_validator's _HEX12 leak pattern: ≥12 contiguous hex chars.
HEX12_RE = re.compile(r"\b[0-9a-f]{12}\b")


def _cluster(
    cid: str,
    *,
    count: int = 5,
    ev_ids: list[str] | None = None,
    label: str | None = None,
) -> dict:
    return {
        "cluster_id": cid,
        "label": label or cid,
        "method": "keyword_v1",
        "evidence_count": count,
        "evidence_review_ids": ev_ids
        or [f"abcdef0123456{i:03d}" for i in range(count)],
        "linked_attribute": None,
    }


def test_generates_signals_one_per_known_cluster():
    out = derive(
        emergent_clusters=[
            _cluster("packaging_pump_leak"),
            _cluster("scent_change"),
        ]
    )
    assert len(out) == 2
    topics = {s["topic_label"] for s in out}
    assert topics == {"packaging_container", "scent"}


def test_unknown_cluster_id_is_skipped_safely():
    out = derive(emergent_clusters=[_cluster("unknown_cluster")])
    assert out == []


def test_public_fields_have_no_review_id_hex_leak():
    ids = [f"deadbeef{i:08x}" for i in range(5)]  # 16-char hex review_ids
    out = derive(
        emergent_clusters=[_cluster("packaging_pump_leak", ev_ids=ids)]
    )
    sig = out[0]
    # Public fields: topic_label, tone, summary, evidence_count.
    public_text = " ".join([
        sig["topic_label"],
        sig["tone"],
        sig["summary"],
        str(sig["evidence_count"]),
    ])
    assert HEX12_RE.search(public_text) is None
    # Audit IDs are truncated below the 12-hex leak threshold.
    for trunc in sig["audit"]["evidence_review_id_truncated"]:
        # Strip the ellipsis and check the hex prefix length.
        prefix = trunc.rstrip("…")
        assert len(prefix) <= TRUNCATE_TO
        assert HEX12_RE.search(trunc) is None


def test_public_summary_has_no_banned_framing():
    out = derive(
        emergent_clusters=[
            _cluster("packaging_pump_leak"),
            _cluster("skin_reaction"),
            _cluster("scent_change"),
            _cluster("color_mismatch"),
            _cluster("refill_size_request"),
            _cluster("texture_separation"),
        ]
    )
    assert len(out) == 6
    for sig in out:
        for banned in BANNED_FRAMINGS:
            assert banned not in sig["summary"]
            assert banned not in sig["topic_label"]


def test_audit_ids_are_truncated_and_capped():
    long_ids = [f"abcdef0123456{i:03d}" for i in range(20)]  # 16+ chars each
    out = derive(
        emergent_clusters=[_cluster("packaging_pump_leak", ev_ids=long_ids)]
    )
    audit_ids = out[0]["audit"]["evidence_review_id_truncated"]
    assert len(audit_ids) == AUDIT_ID_CAP
    for tid in audit_ids:
        assert tid.endswith("…")
        prefix = tid.rstrip("…")
        assert len(prefix) == TRUNCATE_TO


def test_short_ids_are_left_alone_without_truncation_marker():
    out = derive(
        emergent_clusters=[
            _cluster("packaging_pump_leak", ev_ids=["abc", "12345678"])
        ]
    )
    audit_ids = out[0]["audit"]["evidence_review_id_truncated"]
    assert "abc" in audit_ids
    assert "12345678" in audit_ids
    for tid in audit_ids:
        assert "…" not in tid


def test_signal_carries_evidence_count_from_cluster():
    out = derive(
        emergent_clusters=[_cluster("packaging_pump_leak", count=42)]
    )
    assert out[0]["evidence_count"] == 42


def test_tone_values_are_constrained_to_known_set():
    allowed = {"positive", "mixed", "caution"}
    out = derive(
        emergent_clusters=[
            _cluster(cid)
            for cid in (
                "packaging_pump_leak",
                "skin_reaction",
                "scent_change",
                "color_mismatch",
                "refill_size_request",
                "texture_separation",
            )
        ]
    )
    for sig in out:
        assert sig["tone"] in allowed
