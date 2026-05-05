from __future__ import annotations

from datetime import date

from src.voc.reporting.review_ops.landing_copy import (
    LANDING_COPY_CAP,
    SOURCE_REVIEW_ID_CAP,
    generate,
)
from src.voc.reporting.review_ops.schema import AssetItem

ALLOWED_HEDGES = ("검토", "확인", "가능성", "권장", "안내해볼 수 있습니다")
FORBIDDEN = ("해야 합니다", "원인은", "결함", "방치")


def _cluster(cid: str, count: int = 5, ev_ids: list[str] | None = None) -> dict:
    return {
        "cluster_id": cid,
        "label": cid,
        "method": "keyword_v1",
        "evidence_count": count,
        "evidence_review_ids": ev_ids or [f"{cid}_{i}" for i in range(count)],
        "linked_attribute": None,
    }


def _stale_asset(rid: str) -> AssetItem:
    return AssetItem(
        review_id=rid,
        quote="과거 부정 의견",
        rating=2.0,
        review_date=date(2024, 8, 1),
        asset_classes=["stale"],
        is_stale_candidate=True,
    )


def test_empty_inputs_yield_empty_list():
    assert generate(emergent_clusters=[], stale_assets=[]) == []


def test_one_cluster_produces_one_landing_copy():
    out = generate(
        emergent_clusters=[_cluster("packaging_pump_leak")],
        stale_assets=[],
    )
    assert len(out) == 1
    item = out[0]
    assert item["topic"] == "용기·펌프 사용감"
    assert item["source_cluster_id"] == "packaging_pump_leak"
    assert item["source_review_ids"]


def test_unknown_cluster_id_is_skipped():
    out = generate(
        emergent_clusters=[_cluster("unknown_cluster")],
        stale_assets=[],
    )
    assert out == []


def test_caps_total_at_five_even_with_many_inputs():
    clusters = [
        _cluster("packaging_pump_leak"),
        _cluster("skin_reaction"),
        _cluster("scent_change"),
        _cluster("color_mismatch"),
        _cluster("refill_size_request"),
        _cluster("texture_separation"),
    ]
    out = generate(
        emergent_clusters=clusters,
        stale_assets=[_stale_asset("s1"), _stale_asset("s2")],
    )
    assert len(out) == LANDING_COPY_CAP


def test_stale_only_input_emits_a_single_stale_item():
    stale = [_stale_asset(f"s{i}") for i in range(5)]
    out = generate(emergent_clusters=[], stale_assets=stale)
    assert len(out) == 1
    assert out[0]["source_cluster_id"] is None
    # SOURCE_REVIEW_ID_CAP applied.
    assert len(out[0]["source_review_ids"]) == SOURCE_REVIEW_ID_CAP


def test_skin_reaction_copy_is_paste_ready_and_safe():
    out = generate(
        emergent_clusters=[_cluster("skin_reaction")],
        stale_assets=[],
    )
    copy = out[0]["copy"]
    # Concrete safe phrasing — patch test guidance for sensitive skin.
    assert "국소 부위 테스트" in copy
    # No medical claim, no directive, no defect claim.
    for forbidden in ("치료", "완치", "의학적 효능", "해야 합니다", "결함"):
        assert forbidden not in copy


def test_skincare_pad_packaging_copy_uses_pad_vocab_not_pump():
    out = generate(
        emergent_clusters=[_cluster("packaging_pump_leak")],
        stale_assets=[],
        profile_id="skincare_pad",
    )
    copy = out[0]["copy"]
    assert "펌프" not in copy
    for term in ("뚜껑", "집게", "보관"):
        assert term in copy


def test_lip_makeup_packaging_copy_uses_lip_vocab_not_pump():
    out = generate(
        emergent_clusters=[_cluster("packaging_pump_leak")],
        stale_assets=[],
        profile_id="lip_makeup",
    )
    item = out[0]
    copy = item["copy"]
    assert "펌프" not in copy
    assert "펌프" not in item["topic"]
    for term in ("튜브", "캡", "도포구", "밀봉"):
        assert term in copy


def test_base_makeup_packaging_copy_uses_cushion_vocab_not_pump():
    out = generate(
        emergent_clusters=[_cluster("packaging_pump_leak")],
        stale_assets=[],
        profile_id="base_makeup",
    )
    item = out[0]
    copy = item["copy"]
    assert "펌프" not in copy
    assert "펌프" not in item["topic"]
    for term in ("케이스", "퍼프", "리필", "포장"):
        assert term in copy or term in item["topic"]


def test_unmapped_profile_keeps_default_pump_packaging_copy():
    # Future / unmapped profile (e.g. hair_care) keeps the generic pump
    # template — no silent cross-profile fallback.
    out = generate(
        emergent_clusters=[_cluster("packaging_pump_leak")],
        stale_assets=[],
        profile_id="hair_care_unknown",
    )
    assert "펌프" in out[0]["copy"]


def test_no_profile_id_keeps_default_packaging_copy():
    out = generate(
        emergent_clusters=[_cluster("packaging_pump_leak")],
        stale_assets=[],
    )
    assert "펌프" in out[0]["copy"]


def test_all_paste_ready_copy_avoids_medical_and_directive_wording():
    clusters = [_cluster(cid) for cid in (
        "packaging_pump_leak",
        "skin_reaction",
        "scent_change",
        "color_mismatch",
        "refill_size_request",
        "texture_separation",
    )]
    out = generate(emergent_clusters=clusters, stale_assets=[])
    forbidden = ("치료", "완치", "의학적 효능", "해야 합니다", "결함", "방치", "원인은")
    for item in out:
        for word in forbidden:
            assert word not in item["copy"]
            assert word not in item["rationale"]


def test_all_copy_uses_hedged_wording_no_directives():
    clusters = [_cluster(cid) for cid in (
        "packaging_pump_leak",
        "skin_reaction",
        "scent_change",
        "color_mismatch",
        "refill_size_request",
        "texture_separation",
    )]
    out = generate(emergent_clusters=clusters, stale_assets=[_stale_asset("s1")])
    for item in out:
        copy = item["copy"]
        assert any(h in copy for h in ALLOWED_HEDGES), copy
        for forbidden in FORBIDDEN:
            assert forbidden not in copy
