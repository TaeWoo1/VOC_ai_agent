from __future__ import annotations

from datetime import date

from src.voc.reporting.review_ops.reply_drafts import REPLY_DRAFTS_CAP, generate
from src.voc.reporting.review_ops.schema import AssetItem

ALLOWED_HEDGES = ("검토", "확인", "가능성", "권장", "안내")
FORBIDDEN = ("해야 합니다", "원인은", "결함", "방치")


def _asset(
    rid: str,
    *,
    rating: float = 2.0,
    classes=("risk",),
    stale: bool = False,
    quote: str = "텍스트",
) -> AssetItem:
    return AssetItem(
        review_id=rid,
        quote=quote,
        rating=rating,
        review_date=date(2024, 8, 1) if stale else date(2026, 4, 1),
        asset_classes=list(classes),
        is_stale_candidate=stale,
    )


def test_empty_inputs_yield_empty_drafts():
    assert generate(risk_assets=[], stale_assets=[]) == []


def test_caps_at_three_drafts_from_many_risk_assets():
    risks = [_asset(f"r{i}") for i in range(7)]
    out = generate(risk_assets=risks, stale_assets=[])
    assert len(out) == REPLY_DRAFTS_CAP
    for d in out:
        assert d["source"] == "risk"
        assert d["tone"] == "humble"


def test_falls_back_to_stale_when_no_risk_input():
    stale = [_asset(f"s{i}", classes=("stale",), stale=True) for i in range(2)]
    out = generate(risk_assets=[], stale_assets=stale)
    assert len(out) == 2
    for d in out:
        assert d["source"] == "stale"
        assert d["tone"] == "humble_stale"


def test_does_not_duplicate_a_review_appearing_in_both_buckets():
    item = _asset("dup", classes=("risk", "stale"), stale=True)
    out = generate(risk_assets=[item], stale_assets=[item])
    assert len(out) == 1
    assert out[0]["review_id"] == "dup"


def test_drafts_are_humble_and_hedged_with_no_forbidden_phrases():
    risks = [_asset("r1")]
    stale = [_asset("s1", classes=("stale",), stale=True)]
    out = generate(risk_assets=risks, stale_assets=stale)
    assert len(out) == 2
    for d in out:
        text = d["draft"]
        assert any(h in text for h in ALLOWED_HEDGES), text
        for forbidden in FORBIDDEN:
            assert forbidden not in text
        assert "감사합니다" in text  # thanks
        assert "고객센터" in text   # routing to support


def test_default_channel_keeps_existing_risk_rationale():
    out = generate(risk_assets=[_asset("r1")], stale_assets=[])
    assert out[0]["rationale"] == "리스크 후보 — CS 답글 회수 검토"


def test_oliveyoung_channel_swaps_risk_rationale_to_cs_response():
    out = generate(risk_assets=[_asset("r1")], stale_assets=[], channel="oliveyoung")
    # "답글 회수" misframes oliveyoung; rationale becomes CS-response wording.
    rationale = out[0]["rationale"]
    assert "답글" not in rationale
    assert "CS 응대 문구 검토" in rationale


def test_oliveyoung_channel_does_not_change_stale_rationale():
    # Only the risk rationale flips; stale wording stays as-is.
    item = _asset("s1", classes=("stale",), stale=True)
    out = generate(risk_assets=[], stale_assets=[item], channel="oliveyoung")
    assert out[0]["rationale"] == "오래된 부정 리뷰 — 현재 상태 확인 후보"


def test_draft_carries_review_metadata():
    out = generate(
        risk_assets=[_asset("r1", rating=1.0)],
        stale_assets=[],
    )
    d = out[0]
    assert d["review_id"] == "r1"
    assert d["rating"] == 1.0
    assert d["review_date"] == "2026-04-01"


# ── topic injection ───────────────────────────────────────────────────


def test_drafts_differ_when_quotes_carry_different_topics():
    risks = [
        _asset("r_pkg",  quote="용기 뚜껑이 헐거워서 누수 있어요."),
        _asset("r_skin", quote="트러블 났어요. 따가움 있어요."),
        _asset("r_scent", quote="향이 너무 인공적이고 역해요."),
    ]
    out = generate(risk_assets=risks, stale_assets=[])
    assert len(out) == 3
    drafts = [d["draft"] for d in out]
    topics = [d["topic"] for d in out]
    # All three drafts must be distinct (topic was injected per quote).
    assert len(set(drafts)) == 3
    assert topics == ["용기·포장 사용감", "피부 반응", "향 체감"]


def test_packaging_quote_yields_packaging_draft():
    out = generate(
        risk_assets=[_asset("r1", quote="용기 뚜껑이 안 닫혀요.")],
        stale_assets=[],
    )
    assert "용기·포장 사용감" in out[0]["draft"]


def test_skin_reaction_quote_yields_skin_draft():
    out = generate(
        risk_assets=[_asset("r1", quote="피부에 트러블 났어요.")],
        stale_assets=[],
    )
    assert "피부 반응" in out[0]["draft"]


def test_unknown_topic_quote_falls_back_to_generic_phrase():
    out = generate(
        risk_assets=[_asset("r1", quote="음 잘 모르겠어요.")],
        stale_assets=[],
    )
    d = out[0]
    assert d["topic"] == "사용 경험"
    assert "사용 경험" in d["draft"]


def test_topic_label_field_preferred_over_quote_scan():
    """If a future caller populates topic_labels, that wins over the scan."""
    item = AssetItem(
        review_id="r1",
        quote="향이 너무 인공적이에요.",  # scan would say "향 체감"
        rating=2.0,
        topic_labels=["packaging_container"],  # explicit overrides scan
    )
    out = generate(risk_assets=[item], stale_assets=[])
    assert out[0]["topic"] == "용기·포장 사용감"


def test_pad_sheet_quote_yields_pad_sheet_topic():
    out = generate(
        risk_assets=[_asset("r1", quote="패드 거즈가 너무 까슬해요. 보풀 생겨요.")],
        stale_assets=[],
    )
    d = out[0]
    assert d["topic"] == "패드 시트 사용감"
    assert "패드 시트 사용감" in d["draft"]


def test_essence_moisture_quote_yields_essence_topic():
    out = generate(
        risk_assets=[
            _asset("r1", quote="에센스가 너무 적어서 금방 건조해져요. 보습이 부족해요.")
        ],
        stale_assets=[],
    )
    d = out[0]
    assert d["topic"] == "에센스·보습감"


def test_cleansing_wipe_feel_quote_yields_cleansing_topic():
    out = generate(
        risk_assets=[_asset("r1", quote="닦토로 사용했는데 마무리감이 별로예요.")],
        stale_assets=[],
    )
    d = out[0]
    assert d["topic"] == "닦토 사용감"


def test_skin_reaction_outranks_pad_sheet_when_both_present():
    # "트러블" (skin) and "패드/거즈" (pad sheet) both appear.
    # Ordering must route to skin_reaction first.
    out = generate(
        risk_assets=[
            _asset("r1", quote="패드 거즈가 까슬해서 트러블 났어요.")
        ],
        stale_assets=[],
    )
    assert out[0]["topic"] == "피부 반응"


def test_packaging_outranks_pad_sheet_when_both_present():
    # "용기" (packaging) before "패드/시트" (pad_sheet_texture).
    out = generate(
        risk_assets=[_asset("r1", quote="용기 뚜껑이 헐거운데 패드 시트는 괜찮아요.")],
        stale_assets=[],
    )
    assert out[0]["topic"] == "용기·포장 사용감"


def test_new_topic_drafts_remain_humble_and_hedged():
    risks = [
        _asset("r1", quote="패드 거즈 마찰이 심해요."),
        _asset("r2", quote="에센스 흡수가 너무 빨라요."),
        _asset("r3", quote="닦토로 닦아내니 자극 있어요."),
    ]
    out = generate(risk_assets=risks, stale_assets=[])
    for d in out:
        text = d["draft"]
        assert "감사합니다" in text
        assert "고객센터" in text
        assert any(h in text for h in ("확인", "안내", "검토", "가능성", "권장"))
        for forbidden in ("해야 합니다", "원인은", "결함", "방치"):
            assert forbidden not in text


def test_injected_topic_drafts_remain_humble_and_hedged():
    risks = [
        _asset("r_pkg",  quote="용기 누수 있어요."),
        _asset("r_skin", quote="발진 생겼어요."),
        _asset("r_scent", quote="향이 이상해요."),
    ]
    out = generate(risk_assets=risks, stale_assets=[])
    for d in out:
        text = d["draft"]
        assert "감사합니다" in text
        assert "고객센터" in text
        assert any(h in text for h in ("확인", "안내", "검토", "가능성", "권장"))
        for forbidden in ("해야 합니다", "원인은", "결함", "방치"):
            assert forbidden not in text
