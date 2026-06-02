from __future__ import annotations

from datetime import date

from src.voc.reporting.review_ops.loaders import ReviewRow
from src.voc.reporting.review_ops.risk_cluster import (
    CLUSTER_METHOD,
    CLUSTER_RULES,
    EVIDENCE_ID_CAP,
    MIN_EVIDENCE,
    group_risks,
)


def _row(
    review_id: str,
    text: str,
    *,
    rating_raw: float | None = 2.0,
) -> ReviewRow:
    """Helper: defaults to rating 2.0 so polarity-gated clusters fire on
    the keyword alone. Tests for the gate itself override rating_raw."""
    return ReviewRow(
        review_id=review_id,
        text=text,
        rating_raw=rating_raw,
        review_date=date(2026, 4, 1),
        product_option=None,
        has_brand_reply=False,
        source_channel="oliveyoung",
    )


def _by_id(clusters: list[dict]) -> dict[str, dict]:
    return {c["cluster_id"]: c for c in clusters}


# ── existing behaviour preserved ──────────────────────────────────────


def test_emits_cluster_when_keyword_group_count_meets_threshold():
    reviews = [
        _row("a", "용기 펌프가 잘 안 나와요."),
        _row("b", "용기 뚜껑이 헐거워서 샜어요."),
        _row("c", "용기 펌프가 막혔어요."),
    ]
    out = group_risks(reviews)
    by_id = _by_id(out)
    assert "packaging_pump_leak" in by_id
    cluster = by_id["packaging_pump_leak"]
    assert cluster["evidence_count"] == 3
    assert sorted(cluster["evidence_review_ids"]) == ["a", "b", "c"]
    assert cluster["method"] == "keyword_v1"
    assert cluster["linked_attribute"] == "packaging_container"


def test_does_not_emit_below_threshold():
    reviews = [
        _row("a", "용기 펌프가 잘 안 나와요."),
        _row("b", "용기 뚜껑이 헐거워요."),
    ]
    out = group_risks(reviews)
    assert _by_id(out).get("packaging_pump_leak") is None


def test_caps_evidence_ids_but_keeps_full_count():
    reviews = [_row(f"r{i:02d}", "용기 펌프가 막혔어요.") for i in range(12)]
    out = group_risks(reviews)
    cluster = _by_id(out)["packaging_pump_leak"]
    assert cluster["evidence_count"] == 12
    assert len(cluster["evidence_review_ids"]) == EVIDENCE_ID_CAP


def test_method_label_is_never_dbscan_for_any_rule():
    reviews = [
        _row("p1", "용기 펌프 누수"),
        _row("p2", "용기 뚜껑 부서짐"),
        _row("p3", "용기 새요"),
        _row("s1", "트러블 났어요"),
        _row("s2", "따가움 있어요"),
        _row("s3", "발진 생겼어요"),
    ]
    out = group_risks(reviews)
    assert len(out) >= 2
    for cluster in out:
        assert cluster["method"] == CLUSTER_METHOD
        assert "dbscan" not in cluster["method"].lower()


def test_cluster_summary_uses_hedged_korean_wording():
    reviews = [_row(f"r{i}", "용기 펌프가 막혔어요.") for i in range(3)]
    out = group_risks(reviews)
    summary = _by_id(out)["packaging_pump_leak"]["summary"]
    assert summary.endswith("후보")
    for forbidden in ("필요", "해야 함", "결함", "방치", "원인은"):
        assert forbidden not in summary


def test_min_evidence_constant_is_three():
    assert MIN_EVIDENCE == 3


def test_rule_set_covers_required_buckets():
    ids = {rule.cluster_id for rule in CLUSTER_RULES}
    assert {
        "packaging_pump_leak",
        "skin_reaction",
        "scent_change",
        "color_mismatch",
        "refill_size_request",
        "texture_separation",
    } <= ids


def test_unique_review_ids_only_count_once_per_cluster():
    reviews = [
        _row("dup", "용기 펌프 누수"),
        _row("dup", "용기 새요"),
        _row("uniq2", "용기 뚜껑 부서짐"),
    ]
    out = group_risks(reviews)
    assert _by_id(out).get("packaging_pump_leak") is None


# ── A. polarity / complaint gating ────────────────────────────────────


def test_positive_scent_at_five_star_does_not_count_toward_scent_change():
    # rating 5.0, no complaint marker near "향" → should be filtered out.
    reviews = [
        _row(f"pos{i}", "향이 좋아서 재구매해요. 만족이에요.", rating_raw=5.0)
        for i in range(5)
    ]
    out = group_risks(reviews)
    assert _by_id(out).get("scent_change") is None


def test_negative_scent_complaint_at_low_rating_counts():
    reviews = [
        _row(f"neg{i}", "향이 너무 인공적이고 역해요.", rating_raw=2.0)
        for i in range(3)
    ]
    out = group_risks(reviews)
    cluster = _by_id(out).get("scent_change")
    assert cluster is not None
    assert cluster["evidence_count"] == 3


def test_negative_scent_via_marker_proximity_at_high_rating_counts():
    # No low rating, but a complaint marker ('이상') sits near the keyword.
    reviews = [
        _row(f"hi{i}", "향이 좀 이상해요.", rating_raw=5.0) for i in range(3)
    ]
    out = group_risks(reviews)
    assert _by_id(out).get("scent_change") is not None


def test_positive_color_at_five_star_does_not_count_toward_color_mismatch():
    reviews = [
        _row(f"col{i}", "색감이 정말 예뻐서 만족이에요.", rating_raw=5.0)
        for i in range(5)
    ]
    out = group_risks(reviews, profile_id=None)
    assert _by_id(out).get("color_mismatch") is None


def test_refill_size_request_still_counts_at_five_star():
    # Demand signal: rating-agnostic by design (NOT polarity gated).
    reviews = [
        _row(f"r{i}", "리필 옵션이 있으면 좋겠어요.", rating_raw=5.0)
        for i in range(3)
    ]
    out = group_risks(reviews)
    cluster = _by_id(out).get("refill_size_request")
    assert cluster is not None
    assert cluster["evidence_count"] == 3


def test_skin_reaction_still_counts_by_keyword_at_five_star():
    # Cautionary terms are inherently ban-worthy; not polarity gated.
    reviews = [
        _row("s1", "트러블 났어요", rating_raw=5.0),
        _row("s2", "따가움 있어요", rating_raw=5.0),
        _row("s3", "발진 생겼어요", rating_raw=5.0),
    ]
    out = group_risks(reviews)
    cluster = _by_id(out).get("skin_reaction")
    assert cluster is not None
    assert cluster["evidence_count"] == 3


def test_marker_outside_window_does_not_satisfy_polarity_gate():
    # 5★, complaint marker ('아쉬') sits >20 chars from the "향" keyword.
    far_text = "향" + ("가" * 40) + "아쉬워요"
    reviews = [_row(f"x{i}", far_text, rating_raw=5.0) for i in range(3)]
    out = group_risks(reviews)
    assert _by_id(out).get("scent_change") is None


# ── B. profile-aware suppression ──────────────────────────────────────


def test_skincare_pad_suppresses_pump_only_packaging_misfire():
    # Pad profile with low rating but text only mentions "펌프"
    # (no 용기/뚜껑/등 pad-container term) → must NOT count.
    reviews = [
        _row(f"p{i}", "펌프가 잘 안 나와요.", rating_raw=2.0)
        for i in range(5)
    ]
    out = group_risks(reviews, profile_id="skincare_pad")
    assert _by_id(out).get("packaging_pump_leak") is None


def test_skincare_pad_allows_packaging_when_text_has_pad_container_term():
    reviews = [
        _row("p1", "용기 뚜껑이 헐거워요.", rating_raw=2.0),
        _row("p2", "케이스에서 누수 발생", rating_raw=2.0),
        _row("p3", "용기 새요.", rating_raw=2.0),
    ]
    out = group_risks(reviews, profile_id="skincare_pad")
    cluster = _by_id(out).get("packaging_pump_leak")
    assert cluster is not None
    assert cluster["evidence_count"] == 3


def test_skincare_pad_color_cluster_suppressed_without_complaint_evidence():
    # 5★ + color mention + no narrow color complaint marker → suppressed.
    reviews = [
        _row(f"c{i}", "색이 예쁘게 잘 나와요.", rating_raw=5.0) for i in range(5)
    ]
    out = group_risks(reviews, profile_id="skincare_pad")
    assert _by_id(out).get("color_mismatch") is None


def test_skincare_pad_color_cluster_fires_with_low_rating_and_marker():
    reviews = [
        _row("c1", "색이 칙칙하게 나와요.", rating_raw=2.0),
        _row("c2", "발색이 다르게 나와요.", rating_raw=2.0),
        _row("c3", "톤이 별로예요.", rating_raw=2.0),
    ]
    out = group_risks(reviews, profile_id="skincare_pad")
    cluster = _by_id(out).get("color_mismatch")
    assert cluster is not None
    assert cluster["evidence_count"] == 3


def test_skincare_pad_overrides_packaging_label_to_pad_vocab():
    reviews = [_row(f"r{i}", "용기 뚜껑 누수", rating_raw=2.0) for i in range(3)]
    out = group_risks(reviews, profile_id="skincare_pad")
    cluster = _by_id(out)["packaging_pump_leak"]
    assert cluster["label"] == "용기·뚜껑·집게 사용감"
    assert "펌프" not in cluster["label"]
    assert "용기·뚜껑·집게" in cluster["summary"]


def test_lip_makeup_overrides_packaging_label_to_lip_vocab():
    reviews = [_row(f"r{i}", "용기 뚜껑 누수", rating_raw=2.0) for i in range(3)]
    out = group_risks(reviews, profile_id="lip_makeup")
    cluster = _by_id(out)["packaging_pump_leak"]
    assert cluster["label"] == "용기·캡·도포구 사용감"
    assert "펌프" not in cluster["label"]
    assert "용기·캡·도포구" in cluster["summary"]


def test_base_makeup_overrides_packaging_label_to_cushion_vocab():
    reviews = [_row(f"r{i}", "용기 뚜껑 누수", rating_raw=2.0) for i in range(3)]
    out = group_risks(reviews, profile_id="base_makeup")
    cluster = _by_id(out)["packaging_pump_leak"]
    assert cluster["label"] == "케이스·퍼프·리필 용기 사용감"
    assert "펌프" not in cluster["label"]
    assert "케이스·퍼프·리필 용기" in cluster["summary"]


def test_unmapped_profile_keeps_default_packaging_label():
    # cluster_id is unchanged regardless of profile.
    reviews = [_row(f"r{i}", "용기 뚜껑 누수", rating_raw=2.0) for i in range(3)]
    out = group_risks(reviews, profile_id="hair_care_unknown")
    cluster = _by_id(out)["packaging_pump_leak"]
    assert cluster["label"] == "펌프·용기 누수"  # original CLUSTER_RULES wording
    assert cluster["cluster_id"] == "packaging_pump_leak"


def test_non_pad_profile_does_not_apply_pad_specific_packaging_gate():
    # Generic profile: pump-only complaints with low rating still count.
    reviews = [
        _row(f"p{i}", "펌프가 잘 안 나와요.", rating_raw=2.0)
        for i in range(3)
    ]
    out = group_risks(reviews, profile_id="base_makeup")
    assert _by_id(out).get("packaging_pump_leak") is not None
