from __future__ import annotations

from datetime import date
from pathlib import Path

from src.voc.reporting.review_ops import asset_classifier as ac
from src.voc.reporting.review_ops.loaders import ReviewOpsInputs, ReviewRow
from src.voc.reporting.review_ops.report_model import (
    ASSETS_PER_CLASS_CAP,
    REASON_KO,
    SUGGESTED_ACTION_KO,
    build,
)

TODAY = date(2026, 5, 4)
HEDGE_ENDINGS = ("후보", "가능성", "검토", "권장", "확인")
DIRECTIVE_FORBIDDEN = ("필요", "해야 함", "원인은", "결함", "방치")


def _row(
    review_id: str,
    text: str,
    rating_raw: float | None = None,
    review_date: date | None = None,
    has_brand_reply: bool = False,
    product_option: str | None = None,
) -> ReviewRow:
    return ReviewRow(
        review_id=review_id,
        text=text,
        rating_raw=rating_raw,
        review_date=review_date,
        product_option=product_option,
        has_brand_reply=has_brand_reply,
        source_channel="oliveyoung",
    )


def _inputs(reviews: list[ReviewRow]) -> ReviewOpsInputs:
    return ReviewOpsInputs(
        run_dir=Path("/tmp/fake_run_dir"),
        run_id=None,
        analysis_report={
            "product": {
                "display_product_name": "테스트 제품",
                "raw_product_name": "테스트 제품 풀네임",
                "selected_profile_id": "skincare_pad",
                "source_url": "https://example.test/p/abc",
            },
            "corpus": {"observation_window": {"start": None, "end": None}},
        },
        manifest={},
        reviews=reviews,
        selected_profile_id="skincare_pad",
    )


def test_asset_counts_match_classifier_totals_uncapped():
    # 7 reviews qualifying as risk (low rating), 3 as usable.
    reviews: list[ReviewRow] = []
    for i in range(7):
        reviews.append(_row(f"risk{i:02d}", "별로예요.", rating_raw=1.0))
    for i in range(3):
        reviews.append(
            _row(
                f"good{i:02d}",
                "흡수도 좋고 발림성 만족이에요. 향이 좋아서 재구매 의사 있어요.",
                rating_raw=5.0,
                review_date=TODAY,
            )
        )
    report = build(_inputs(reviews), today=TODAY)

    # Counts are total, not capped.
    assert report.asset_counts.risk == 7
    assert report.asset_counts.usable == 3
    # Lists are capped.
    assert len(report.assets.risk) == ASSETS_PER_CLASS_CAP
    assert len(report.assets.usable) == 3


def test_each_asset_section_capped_at_five():
    reviews = [
        _row(f"r{i:02d}", "별로예요.", rating_raw=1.0) for i in range(12)
    ]
    report = build(_inputs(reviews), today=TODAY)
    assert report.asset_counts.risk == 12
    assert len(report.assets.risk) == ASSETS_PER_CLASS_CAP


def test_asset_item_carries_required_fields_and_hedged_wording():
    reviews = [
        _row(
            "rev_aaaaaaaaaaaa",
            "흡수도 좋고 만족스러워서 재구매했어요. 향이 좋아요.",
            rating_raw=5.0,
            review_date=date(2026, 4, 1),
            has_brand_reply=True,
            product_option="기본",
        )
    ]
    report = build(_inputs(reviews), today=TODAY)
    assert len(report.assets.usable) == 1
    item = report.assets.usable[0]
    assert item.review_id == "rev_aaaaaaaaaaaa"
    assert item.rating == 5.0
    assert item.review_date == date(2026, 4, 1)
    assert item.product_option == "기본"
    assert item.has_brand_reply is True
    assert ac.USABLE in item.asset_classes
    assert item.reason == REASON_KO[ac.USABLE]
    assert item.suggested_action == SUGGESTED_ACTION_KO[ac.USABLE]
    # Wording contract: hedge ending + no directive words.
    assert any(item.suggested_action.endswith(s) for s in HEDGE_ENDINGS)
    for forbidden in DIRECTIVE_FORBIDDEN:
        assert forbidden not in item.reason
        assert forbidden not in item.suggested_action


def test_quote_is_trimmed_and_whitespace_collapsed():
    long_body = "촉촉하고 만족스러워서 재구매. " + ("끝까지 좋아요. " * 50)
    row = _row(
        "long01",
        long_body,
        rating_raw=5.0,
        review_date=date(2026, 4, 1),
    )
    report = build(_inputs([row]), today=TODAY)
    item = report.assets.usable[0]
    # 200-char cap with ellipsis suffix.
    assert len(item.quote) <= 201
    assert item.quote.endswith("…")
    # Whitespace collapsed (no double spaces).
    assert "  " not in item.quote


def test_stale_items_carry_is_stale_candidate_flag():
    row = _row(
        "old01",
        "그냥 무난했어요.",
        rating_raw=2.0,
        review_date=date(2024, 8, 1),
        has_brand_reply=True,
    )
    report = build(_inputs([row]), today=TODAY)
    assert report.asset_counts.stale == 1
    assert report.assets.stale[0].is_stale_candidate is True


def test_multi_class_review_appears_in_each_qualifying_bucket():
    # rating 4 + positive keyword (usable) + risk keyword "펌프" (risk).
    row = _row(
        "mix01",
        "향이 좋아서 재구매. 그런데 펌프가 잘 안 나와요. 만족도는 있어요.",
        rating_raw=4.0,
        review_date=date(2026, 4, 1),
        has_brand_reply=True,
    )
    report = build(_inputs([row]), today=TODAY)
    usable_ids = [i.review_id for i in report.assets.usable]
    risk_ids = [i.review_id for i in report.assets.risk]
    assert "mix01" in usable_ids
    assert "mix01" in risk_ids
    # asset_classes preserves all classes regardless of bucket.
    assert set(report.assets.usable[0].asset_classes) >= {ac.USABLE, ac.RISK}


def test_risk_sort_prefers_lowest_rating_then_unreplied():
    reviews = [
        _row("r_high_replied", "별로.", rating_raw=2.0, has_brand_reply=True),
        _row("r_high_unreplied", "별로.", rating_raw=2.0, has_brand_reply=False),
        _row("r_low", "최악.", rating_raw=1.0, has_brand_reply=True),
    ]
    report = build(_inputs(reviews), today=TODAY)
    ordered = [i.review_id for i in report.assets.risk]
    assert ordered[0] == "r_low"
    assert ordered[1] == "r_high_unreplied"
    assert ordered[2] == "r_high_replied"


def test_empty_reviews_produces_empty_buckets_and_zero_counts():
    report = build(_inputs([]), today=TODAY)
    assert report.asset_counts.usable == 0
    assert report.asset_counts.stale == 0
    assert report.asset_counts.risk == 0
    assert report.asset_counts.insight == 0
    assert report.assets.usable == []
    assert report.assets.stale == []
    assert report.assets.risk == []
    assert report.assets.insight == []
    assert report.emergent_clusters == []


def test_emergent_clusters_wired_into_report():
    reviews = [
        _row(f"p{i}", "용기 펌프가 막혔어요.", rating_raw=2.0)
        for i in range(3)
    ]
    report = build(_inputs(reviews), today=TODAY)
    cluster_ids = [c["cluster_id"] for c in report.emergent_clusters]
    assert "packaging_pump_leak" in cluster_ids
    cluster = next(
        c for c in report.emergent_clusters if c["cluster_id"] == "packaging_pump_leak"
    )
    assert cluster["method"] == "keyword_v1"
    assert cluster["evidence_count"] == 3


def test_generated_actions_wired_from_cluster_and_risk_assets():
    # 3 pump-leak rows → cluster fires; rows are also low-rating risk assets.
    reviews = [
        _row(f"p{i}", "용기 펌프가 잘 안 나와요.", rating_raw=2.0) for i in range(3)
    ]
    report = build(_inputs(reviews), today=TODAY)

    # landing_copy: at least the packaging cluster item.
    landing = report.generated_actions.landing_page_copy
    assert any(item["source_cluster_id"] == "packaging_pump_leak" for item in landing)

    # reply_drafts: humble drafts capped (we have 3 risks → 3 drafts).
    drafts = report.generated_actions.reply_drafts
    assert 1 <= len(drafts) <= 3
    assert all(d["tone"] in ("humble", "humble_stale") for d in drafts)
    assert all("감사합니다" in d["draft"] for d in drafts)

    # oem_questions: one per cluster.
    questions = report.generated_actions.oem_questions
    assert any(q["source_cluster_id"] == "packaging_pump_leak" for q in questions)
    assert all(q["question"].endswith("확인 가능할까요?") for q in questions)


def test_generated_actions_default_empty_when_no_signals():
    report = build(_inputs([]), today=TODAY)
    assert report.generated_actions.landing_page_copy == []
    assert report.generated_actions.reply_drafts == []
    assert report.generated_actions.oem_questions == []


def test_consumer_safe_signals_wired_from_emergent_clusters():
    reviews = [
        _row(f"p{i}", "용기 펌프가 잘 안 나와요.", rating_raw=2.0) for i in range(3)
    ]
    report = build(_inputs(reviews), today=TODAY)
    signals = report.consumer_safe_signals
    assert any(s["topic_label"] == "packaging_container" for s in signals)
    sig = next(s for s in signals if s["topic_label"] == "packaging_container")
    assert sig["tone"] == "caution"
    # Public summary stays sanitized.
    for banned in ("결함", "방치", "숨긴", "실체", "폭로", "속았다"):
        assert banned not in sig["summary"]


def test_displayed_risk_excludes_cold_stale_items():
    # Build an input mix:
    #   - 1 cold-stale risk row (rating ≤ 2 + age > 720d) → must be excluded
    #     from displayed assets.risk so section 5 doesn't show "장기 과거" wording
    #   - 2 fresh risk rows → must remain in displayed assets.risk
    # asset_counts.risk should still equal the FULL classifier total (3).
    reviews = [
        _row("cold_risk", "별로예요.", rating_raw=1.0,
             review_date=date(2023, 11, 1)),  # ~915 days before TODAY
        _row("fresh_risk_1", "별로예요.", rating_raw=1.0,
             review_date=date(2026, 4, 1)),
        _row("fresh_risk_2", "별로예요.", rating_raw=2.0,
             review_date=date(2026, 4, 15)),
    ]
    report = build(_inputs(reviews), today=TODAY)
    displayed_ids = {it.review_id for it in report.assets.risk}
    assert "cold_risk" not in displayed_ids, "cold-stale row leaked into displayed risk"
    assert {"fresh_risk_1", "fresh_risk_2"}.issubset(displayed_ids)
    # Full classifier count is preserved.
    assert report.asset_counts.risk == 3
    # Cold-stale row still appears in the stale bucket (in the cold band).
    stale_ids = {it.review_id for it in report.assets.stale}
    assert "cold_risk" in stale_ids
    cold_item = next(it for it in report.assets.stale if it.review_id == "cold_risk")
    assert cold_item.stale_band == "cold"
    # No risk-displayed item carries the cold action override.
    for it in report.assets.risk:
        assert "장기 과거 리뷰" not in it.suggested_action


def test_landing_copy_items_sorted_by_cluster_evidence_count_desc():
    # Mix two clusters with very different counts; landing copy must lead with
    # the larger one (refill 265) ahead of the smaller (color_mismatch 6).
    refill_review = "리필 옵션 추가되면 좋겠어요."
    skin_review = "트러블 났어요."
    reviews = []
    for i in range(8):
        reviews.append(_row(f"refill{i:02d}", refill_review, rating_raw=4.0,
                            review_date=date(2026, 4, 1)))
    for i in range(3):
        reviews.append(_row(f"skin{i:02d}", skin_review, rating_raw=2.0,
                            review_date=date(2026, 4, 1)))
    report = build(_inputs(reviews), today=TODAY)
    landing_topics = [item["topic"] for item in report.generated_actions.landing_page_copy]
    # Sanity: both clusters fired.
    assert "리필·대용량 옵션" in landing_topics
    assert "민감 피부 안내" in landing_topics
    # Order: refill (8 hits) before skin_reaction (3 hits).
    assert landing_topics.index("리필·대용량 옵션") < landing_topics.index("민감 피부 안내")


def test_oliveyoung_channel_swaps_risk_suggested_action_to_cs_response():
    # _inputs() seeds source_channel via review rows → oliveyoung.
    reviews = [_row(f"r{i}", "별로예요.", rating_raw=1.0) for i in range(3)]
    report = build(_inputs(reviews), today=TODAY)
    assert report.assets.risk, "expected at least one risk asset"
    risk = report.assets.risk[0]
    # oliveyoung override: "답글 회수" wording is replaced by CS-response phrasing.
    assert risk.suggested_action == "CS 응대 문구 및 OEM 확인 질문 검토"
    assert "답글" not in risk.suggested_action


def test_consumer_safe_signals_default_empty_when_no_clusters():
    report = build(_inputs([]), today=TODAY)
    assert report.consumer_safe_signals == []


def test_build_passes_selected_profile_id_into_group_risks(monkeypatch):
    """report_model.build must hand inputs.selected_profile_id to risk_cluster."""
    from src.voc.reporting.review_ops import risk_cluster as rc_mod

    captured = {}

    def fake_group_risks(reviews, *, profile_id=None):
        captured["profile_id"] = profile_id
        return []

    monkeypatch.setattr(rc_mod, "group_risks", fake_group_risks)
    build(_inputs([]), today=TODAY)
    # _inputs() seeds analysis_report.product.selected_profile_id="skincare_pad".
    assert captured["profile_id"] == "skincare_pad"


def test_risk_groups_built_from_cluster_evidence_ids():
    # 3 risk reviews that share a packaging cluster.
    reviews = [
        _row(f"p{i}", "용기 펌프가 잘 안 나와요.", rating_raw=2.0)
        for i in range(3)
    ]
    report = build(_inputs(reviews), today=TODAY)
    # Should produce one risk_group with cluster_id=packaging_pump_leak.
    cids = [g.cluster_id for g in report.risk_groups]
    assert "packaging_pump_leak" in cids
    group = next(g for g in report.risk_groups if g.cluster_id == "packaging_pump_leak")
    assert group.label == "용기·포장 사용감"
    # All 3 review_ids belong to the cluster, but items cap at 2.
    assert len(group.items) == 2
    assert group.evidence_count >= 3  # cluster's full count, not the cap


def test_risk_groups_capped_at_five_total():
    # Build risks that span more than 5 distinct cluster mappings.
    # We can't easily get 5 different *active* clusters from one fixture,
    # so we add many other_risk-only items and confirm the cap holds.
    reviews = [_row(f"r{i}", f"별로예요 {i}.", rating_raw=1.0) for i in range(8)]
    report = build(_inputs(reviews), today=TODAY)
    assert len(report.risk_groups) <= 5


def test_risk_group_items_capped_at_two():
    reviews = [
        _row(f"p{i}", "용기 펌프가 잘 안 나와요.", rating_raw=2.0)
        for i in range(5)
    ]
    report = build(_inputs(reviews), today=TODAY)
    pump = next(g for g in report.risk_groups if g.cluster_id == "packaging_pump_leak")
    assert len(pump.items) == 2


def test_risk_group_falls_back_to_other_risks_when_no_match():
    # Single low-rating risk asset whose quote text matches no detector.
    reviews = [_row("solo", "그냥 별로예요.", rating_raw=1.0)]
    report = build(_inputs(reviews), today=TODAY)
    cids = [g.cluster_id for g in report.risk_groups]
    assert "other_risks" in cids
    other = next(g for g in report.risk_groups if g.cluster_id == "other_risks")
    assert other.label == "기타 리스크"
    assert other.items[0].review_id == "solo"


def test_no_risk_groups_when_no_risk_assets():
    report = build(_inputs([]), today=TODAY)
    assert report.risk_groups == []


def test_risk_group_falls_back_via_quote_topic_detector():
    # Solo risk asset; cluster is not active (only 1 review, threshold 3),
    # but quote keywords route it to packaging via the topic detector.
    reviews = [_row("alone", "용기 뚜껑이 안 닫혀요.", rating_raw=2.0)]
    report = build(_inputs(reviews), today=TODAY)
    # No active cluster, so detector backup picks packaging_pump_leak.
    cids = [g.cluster_id for g in report.risk_groups]
    assert "packaging_pump_leak" in cids


def test_analysis_period_derived_from_review_dates_when_source_missing():
    reviews = [
        _row("a", "ok", rating_raw=5.0, review_date=date(2025, 8, 1)),
        _row("b", "ok", rating_raw=5.0, review_date=date(2026, 4, 1)),
        _row("c", "ok", rating_raw=5.0, review_date=date(2024, 2, 15)),
        _row("d", "ok", rating_raw=5.0, review_date=None),  # ignored
    ]
    report = build(_inputs(reviews), today=TODAY)
    assert report.product.analysis_period.start == date(2024, 2, 15)
    assert report.product.analysis_period.end == date(2026, 4, 1)


def test_analysis_period_preserves_source_period_when_present():
    inputs = _inputs([
        _row("a", "ok", rating_raw=5.0, review_date=date(2026, 4, 1)),
    ])
    inputs.analysis_report["corpus"]["observation_window"] = {
        "start": "2025-01-01",
        "end": "2025-12-31",
    }
    report = build(inputs, today=TODAY)
    # Source period wins; reviews are ignored when window is non-null.
    assert report.product.analysis_period.start == date(2025, 1, 1)
    assert report.product.analysis_period.end == date(2025, 12, 31)


def test_analysis_period_empty_when_no_review_dates_and_no_source():
    reviews = [_row("a", "ok", rating_raw=5.0, review_date=None)]
    report = build(_inputs(reviews), today=TODAY)
    assert report.product.analysis_period.start is None
    assert report.product.analysis_period.end is None


def test_stale_asset_at_200_days_has_actionable_band():
    row = _row(
        "old", "그냥 무난.",
        rating_raw=2.0,
        review_date=date(2025, 10, 16),  # ~200 days before TODAY=2026-05-04
        has_brand_reply=True,
    )
    report = build(_inputs([row]), today=TODAY)
    item = report.assets.stale[0]
    assert item.stale_band == "actionable"
    assert 180 <= item.age_days <= 720
    # Reason/action keep the standard stale phrasing.
    assert "현재 상태 확인" in item.reason


def test_stale_asset_at_900_days_has_cold_band_and_cold_action():
    row = _row(
        "ancient", "그냥 무난.",
        rating_raw=2.0,
        review_date=date(2023, 11, 16),  # ~900 days before TODAY
        has_brand_reply=True,
    )
    report = build(_inputs([row]), today=TODAY)
    item = report.assets.stale[0]
    assert item.stale_band == "cold"
    assert item.age_days > 720
    # Cold band switches reason + suggested_action to long-tail wording.
    assert "장기 과거 리뷰" in item.reason
    assert "장기 과거 리뷰" in item.suggested_action
    # Hedge ending preserved.
    assert any(item.suggested_action.endswith(t) for t in ("검토", "확인", "권장"))


def test_stale_split_caps_three_actionable_plus_two_cold():
    actionable_dates = [date(2025, 10, 1), date(2025, 9, 1), date(2025, 8, 1),
                        date(2025, 7, 1), date(2025, 6, 1)]
    cold_dates = [date(2023, 1, 1), date(2022, 12, 1), date(2022, 11, 1)]
    reviews = []
    for i, d in enumerate(actionable_dates):
        reviews.append(_row(f"a{i}", "그냥 무난.", rating_raw=2.0, review_date=d, has_brand_reply=True))
    for i, d in enumerate(cold_dates):
        reviews.append(_row(f"c{i}", "그냥 무난.", rating_raw=2.0, review_date=d, has_brand_reply=True))
    report = build(_inputs(reviews), today=TODAY)
    bands = [it.stale_band for it in report.assets.stale]
    assert bands.count("actionable") == 3
    assert bands.count("cold") == 2
    # Order: actionable first.
    assert bands[:3] == ["actionable"] * 3
    assert bands[3:] == ["cold"] * 2


def test_age_days_present_on_dated_items_absent_otherwise():
    text = "흡수도 좋고 발림성 만족이에요. 향이 좋아서 재구매 의사 있어요."
    reviews = [
        _row("dated", text, rating_raw=5.0, review_date=date(2026, 4, 1)),
        _row("nodate", text, rating_raw=5.0, review_date=None),
    ]
    report = build(_inputs(reviews), today=TODAY)
    by_id = {it.review_id: it for it in report.assets.usable}
    assert by_id["dated"].age_days == (TODAY - date(2026, 4, 1)).days
    assert by_id["nodate"].age_days is None
    # Non-stale items: stale_band is None.
    assert by_id["dated"].stale_band is None


def test_brand_name_derived_from_first_token_of_display_name():
    inputs = _inputs([])  # display_product_name="테스트 제품" → "테스트"
    report = build(inputs, today=TODAY)
    assert report.product.brand_name == "테스트"


def test_brand_name_none_for_single_token_display_name():
    inputs = _inputs([])
    inputs.analysis_report["product"]["display_product_name"] = "단일토큰"
    inputs.analysis_report["product"]["brand_name"] = None
    report = build(inputs, today=TODAY)
    assert report.product.brand_name is None


def test_brand_name_strips_single_leading_bracket_promo_token():
    inputs = _inputs([])
    inputs.analysis_report["product"]["display_product_name"] = (
        "[NEW단독기획] 티르티르 마스크 핏 레드 쿠션 (기획/단품)"
    )
    inputs.analysis_report["product"]["brand_name"] = None
    report = build(inputs, today=TODAY)
    assert report.product.brand_name == "티르티르"
    # display_product_name itself is unchanged.
    assert (
        report.product.display_product_name
        == "[NEW단독기획] 티르티르 마스크 핏 레드 쿠션 (기획/단품)"
    )


def test_brand_name_strips_multiple_leading_bracket_tokens():
    inputs = _inputs([])
    inputs.analysis_report["product"]["display_product_name"] = (
        "[프로모][말끔모공] 비플레인 녹두 약산성 클렌징폼"
    )
    inputs.analysis_report["product"]["brand_name"] = None
    report = build(inputs, today=TODAY)
    assert report.product.brand_name == "비플레인"


def test_brand_name_strips_brackets_with_internal_spaces():
    inputs = _inputs([])
    inputs.analysis_report["product"]["display_product_name"] = (
        "[뮤트스위치글로스 증정/신규컬러] 힌스 로 글로우 젤 틴트"
    )
    inputs.analysis_report["product"]["brand_name"] = None
    report = build(inputs, today=TODAY)
    assert report.product.brand_name == "힌스"


def test_brand_name_strips_collab_bracket_token():
    inputs = _inputs([])
    inputs.analysis_report["product"]["display_product_name"] = (
        "[퓌X민스코] 퓌 올데이 커버 블랙 쿠션 리필기획 5종"
    )
    inputs.analysis_report["product"]["brand_name"] = None
    report = build(inputs, today=TODAY)
    assert report.product.brand_name == "퓌"


def test_brand_name_after_bracket_strip_with_no_whitespace_returns_none():
    inputs = _inputs([])
    # After strip, only "단일토큰" remains — no whitespace → no brand derived.
    inputs.analysis_report["product"]["display_product_name"] = "[A] 단일토큰"
    inputs.analysis_report["product"]["brand_name"] = None
    report = build(inputs, today=TODAY)
    assert report.product.brand_name is None


def test_header_title_strips_leading_brackets_and_trailing_parens():
    inputs = _inputs([])
    inputs.analysis_report["product"]["display_product_name"] = (
        "[NEW단독기획] 티르티르 마스크 핏 레드 쿠션 (기획/단품)"
    )
    report = build(inputs, today=TODAY)
    # h1-friendly title is cleaned…
    assert report.product.header_title == "티르티르 마스크 핏 레드 쿠션"
    # …but display_product_name itself stays untouched for downstream/audit.
    assert (
        report.product.display_product_name
        == "[NEW단독기획] 티르티르 마스크 핏 레드 쿠션 (기획/단품)"
    )


def test_header_title_strips_multiple_trailing_paren_phrases():
    inputs = _inputs([])
    inputs.analysis_report["product"]["display_product_name"] = (
        "니들리 데일리 토너 패드 (+ 증정기획) (OY단독)"
    )
    report = build(inputs, today=TODAY)
    assert report.product.header_title == "니들리 데일리 토너 패드"


def test_header_title_falls_back_to_original_when_strip_yields_empty():
    inputs = _inputs([])
    # All-bracket name: cleaned form is empty → fall back to the original.
    inputs.analysis_report["product"]["display_product_name"] = "[A][B]"
    report = build(inputs, today=TODAY)
    assert report.product.header_title == "[A][B]"


def test_header_title_unchanged_for_plain_display_name():
    inputs = _inputs([])
    inputs.analysis_report["product"]["display_product_name"] = "메디힐 더마 패드"
    report = build(inputs, today=TODAY)
    assert report.product.header_title == "메디힐 더마 패드"


def test_brand_name_unchanged_for_plain_name_without_brackets():
    inputs = _inputs([])
    inputs.analysis_report["product"]["display_product_name"] = "메디힐 더마 패드"
    inputs.analysis_report["product"]["brand_name"] = None
    report = build(inputs, today=TODAY)
    assert report.product.brand_name == "메디힐"


def test_brand_name_preserves_explicit_source_value():
    inputs = _inputs([])
    inputs.analysis_report["product"]["brand_name"] = "공식브랜드"
    report = build(inputs, today=TODAY)
    assert report.product.brand_name == "공식브랜드"


def test_executive_summary_contains_total_and_average_rating():
    reviews = [
        _row("a", "흡수도 좋고 발림성 만족이에요. 향이 좋아서 재구매 의사 있어요.",
             rating_raw=5.0, review_date=date(2026, 4, 1)),
        _row("b", "별로예요.", rating_raw=2.0, review_date=date(2026, 4, 1),
             has_brand_reply=False),
    ]
    report = build(_inputs(reviews), today=TODAY)
    assert report.executive_summary
    assert "총 2건" in report.executive_summary
    assert "★3.50" in report.executive_summary or "★3.5" in report.executive_summary


def test_executive_summary_includes_top_cluster_signals_when_present():
    reviews = [
        _row(f"p{i}", "용기 펌프가 잘 안 나와요.", rating_raw=2.0,
             review_date=date(2026, 4, 1))
        for i in range(3)
    ]
    report = build(_inputs(reviews), today=TODAY)
    summary = report.executive_summary
    assert "주요 반복 신호" in summary
    assert "용기·포장 사용감" in summary or "packaging_pump_leak" in summary


def test_executive_summary_omits_signal_section_when_no_clusters():
    # Single low-rating review → no cluster fires (threshold=3).
    reviews = [_row("solo", "그냥 별로.", rating_raw=1.0,
                    review_date=date(2026, 4, 1))]
    report = build(_inputs(reviews), today=TODAY)
    assert "주요 반복 신호" not in report.executive_summary


def test_executive_summary_uses_no_banned_or_directive_wording():
    reviews = [
        _row(f"p{i}", "용기 펌프가 잘 안 나와요.", rating_raw=2.0,
             review_date=date(2026, 4, 1))
        for i in range(3)
    ]
    report = build(_inputs(reviews), today=TODAY)
    text = report.executive_summary
    for forbidden in ("해야 합니다", "원인은", "결함", "방치", "치료", "완치", "반드시"):
        assert forbidden not in text


def test_build_passes_selected_profile_id_into_oem_questions(monkeypatch):
    """report_model.build must hand inputs.selected_profile_id and the
    display_product_name to oem_questions for packaging-vocab inference."""
    from src.voc.reporting.review_ops import oem_questions as oq_mod

    captured = {}

    def fake_generate(*, emergent_clusters, profile_id=None, product_name=None):
        captured["profile_id"] = profile_id
        captured["product_name"] = product_name
        captured["clusters_in"] = list(emergent_clusters)
        return []

    monkeypatch.setattr(oq_mod, "generate", fake_generate)
    build(_inputs([]), today=TODAY)
    assert captured["profile_id"] == "skincare_pad"
    # _inputs() seeds analysis_report.product.display_product_name="테스트 제품".
    assert captured["product_name"] == "테스트 제품"
