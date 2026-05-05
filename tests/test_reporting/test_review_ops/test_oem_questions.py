from __future__ import annotations

from src.voc.reporting.review_ops.oem_questions import (
    EVIDENCE_ID_CAP,
    OEM_QUESTIONS_CAP,
    generate,
)

ALLOWED_HEDGES = ("검토", "확인", "가능성", "권장")
FORBIDDEN = ("해야 합니다", "원인은", "결함", "방치")


def _cluster(cid: str, count: int = 4, ev_ids: list[str] | None = None, attr=None) -> dict:
    return {
        "cluster_id": cid,
        "label": cid,
        "method": "keyword_v1",
        "evidence_count": count,
        "evidence_review_ids": ev_ids or [f"{cid}_{i}" for i in range(count)],
        "linked_attribute": attr,
    }


def test_empty_clusters_yield_no_questions():
    assert generate(emergent_clusters=[]) == []


def test_one_cluster_produces_one_question_with_category_and_evidence():
    out = generate(
        emergent_clusters=[_cluster("packaging_pump_leak", attr="packaging_container")]
    )
    assert len(out) == 1
    q = out[0]
    assert q["category"] == "용기/포장"
    assert q["question"].endswith("확인 가능할까요?")
    assert q["source_cluster_id"] == "packaging_pump_leak"
    assert q["linked_attribute"] == "packaging_container"
    assert q["evidence_review_ids"]


def test_unknown_cluster_id_is_skipped():
    out = generate(emergent_clusters=[_cluster("unknown")])
    assert out == []


def test_caps_questions_at_five():
    clusters = [
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
    out = generate(emergent_clusters=clusters)
    assert len(out) == OEM_QUESTIONS_CAP


def test_evidence_ids_are_capped():
    cluster = _cluster(
        "packaging_pump_leak", count=20, ev_ids=[f"id_{i}" for i in range(20)]
    )
    out = generate(emergent_clusters=[cluster])
    assert len(out[0]["evidence_review_ids"]) == EVIDENCE_ID_CAP


def test_skincare_pad_packaging_uses_pad_vocab_not_pump():
    out = generate(
        emergent_clusters=[_cluster("packaging_pump_leak", attr="packaging_container")],
        profile_id="skincare_pad",
    )
    assert len(out) == 1
    q = out[0]["question"]
    assert "펌프" not in q
    # Pad-format vocabulary present.
    for term in ("용기", "뚜껑", "집게", "포장"):
        assert term in q
    assert q.endswith("확인 가능할까요?")
    assert out[0]["category"] == "용기/포장"


def test_profile_without_override_keeps_generic_pump_template():
    # An unmapped profile_id (e.g. a future hair_care category) keeps the
    # generic pump/container question — no silent fallback to other profiles.
    out = generate(
        emergent_clusters=[_cluster("packaging_pump_leak", attr="packaging_container")],
        profile_id="hair_care_unknown",
    )
    assert len(out) == 1
    assert "펌프" in out[0]["question"]


def test_no_profile_id_keeps_existing_pump_template():
    out = generate(
        emergent_clusters=[_cluster("packaging_pump_leak", attr="packaging_container")]
    )
    assert "펌프" in out[0]["question"]


def test_lip_makeup_packaging_uses_lip_vocab_not_pump():
    out = generate(
        emergent_clusters=[_cluster("packaging_pump_leak", attr="packaging_container")],
        profile_id="lip_makeup",
    )
    assert len(out) == 1
    q = out[0]["question"]
    assert "펌프" not in q
    for term in ("튜브", "캡", "도포구", "밀봉"):
        assert term in q
    assert q.endswith("확인 가능할까요?")
    assert out[0]["category"] == "용기/포장"


def test_base_makeup_packaging_uses_cushion_vocab_not_pump():
    out = generate(
        emergent_clusters=[_cluster("packaging_pump_leak", attr="packaging_container")],
        profile_id="base_makeup",
    )
    assert len(out) == 1
    q = out[0]["question"]
    assert "펌프" not in q
    for term in ("케이스", "퍼프", "리필", "포장"):
        assert term in q
    assert q.endswith("확인 가능할까요?")


def test_fallback_profile_with_lip_product_name_uses_lip_vocab():
    out = generate(
        emergent_clusters=[_cluster("packaging_pump_leak", attr="packaging_container")],
        profile_id="fallback_generic",
        product_name="힌스 로 글로우 젤 틴트 24 Colors",
    )
    q = out[0]["question"]
    assert "펌프" not in q
    assert "튜브" in q


def test_fallback_profile_with_cushion_product_name_uses_base_vocab():
    out = generate(
        emergent_clusters=[_cluster("packaging_pump_leak", attr="packaging_container")],
        profile_id="default",
        product_name="퓌 올데이 커버 블랙 쿠션 리필기획",
    )
    q = out[0]["question"]
    assert "펌프" not in q
    assert "케이스" in q


def test_fallback_profile_with_unrelated_product_name_keeps_generic_pump():
    out = generate(
        emergent_clusters=[_cluster("packaging_pump_leak", attr="packaging_container")],
        profile_id="default",
        product_name="알 수 없는 제품 이름",
    )
    # No category cue → keep the generic pump template (operator can edit).
    assert "펌프" in out[0]["question"]


def test_explicit_lip_profile_overrides_product_name_inference():
    # When profile_id is already specific, name-based inference must not fire.
    out = generate(
        emergent_clusters=[_cluster("packaging_pump_leak", attr="packaging_container")],
        profile_id="lip_makeup",
        product_name="이름에 쿠션 들어 있어도",
    )
    q = out[0]["question"]
    # lip vocabulary wins (튜브/캡), not base (케이스/퍼프).
    assert "튜브" in q
    assert "퍼프" not in q


def test_other_clusters_unchanged_under_skincare_pad_profile():
    # skincare_pad override only targets packaging_pump_leak; others unchanged.
    out = generate(
        emergent_clusters=[
            _cluster("skin_reaction"),
            _cluster("scent_change"),
            _cluster("color_mismatch"),
            _cluster("refill_size_request"),
            _cluster("texture_separation"),
        ],
        profile_id="skincare_pad",
    )
    assert len(out) == 5
    # All hedged endings preserved.
    for q in out:
        assert q["question"].endswith("확인 가능할까요?")


def test_questions_use_hedged_wording_no_directives():
    clusters = [
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
    out = generate(emergent_clusters=clusters)
    for q in out:
        text = q["question"]
        assert any(h in text for h in ALLOWED_HEDGES), text
        for forbidden in FORBIDDEN:
            assert forbidden not in text
