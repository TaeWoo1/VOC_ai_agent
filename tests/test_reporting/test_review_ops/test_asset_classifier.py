from __future__ import annotations

from datetime import date
from pathlib import Path

from src.voc.reporting.review_ops.asset_classifier import (
    INSIGHT,
    RISK,
    STALE,
    USABLE,
    classify_all,
    classify_row,
)
from src.voc.reporting.review_ops.loaders import ReviewOpsInputs, ReviewRow

TODAY = date(2026, 5, 4)


def _row(
    review_id: str = "rid",
    text: str = "",
    rating_raw: float | None = None,
    review_date: date | None = None,
    has_brand_reply: bool = False,
    product_option: str | None = None,
    source_channel: str = "oliveyoung",
) -> ReviewRow:
    return ReviewRow(
        review_id=review_id,
        text=text,
        rating_raw=rating_raw,
        review_date=review_date,
        product_option=product_option,
        has_brand_reply=has_brand_reply,
        source_channel=source_channel,
    )


# ── single-class cases ───────────────────────────────────────────────


def test_usable_only_high_rating_with_positive_keyword():
    row = _row(
        text="피부에 잘 흡수되고 만족스러워서 재구매했어요. 발림성도 좋네요.",
        rating_raw=5.0,
        review_date=date(2026, 4, 20),  # recent → not stale
    )
    assert classify_row(row, today=TODAY) == [USABLE]


def test_risk_only_low_rating_no_keywords():
    # rating ≤ 2 alone is enough for risk; no other class triggers.
    row = _row(text="별로예요.", rating_raw=1.0, review_date=date(2026, 4, 20))
    assert classify_row(row, today=TODAY) == [RISK]


def test_stale_only_old_negative_review():
    # Old + rating ≤ 3, no risk keywords, rating not ≤ 2.
    row = _row(
        text="그냥 무난했어요.",
        rating_raw=3.0,
        review_date=date(2024, 8, 12),  # 631 days old vs TODAY
        has_brand_reply=True,  # avoid unreplied → risk path
    )
    assert classify_row(row, today=TODAY) == [STALE]


def test_insight_only_request_keyword():
    # No rating, just an insight keyword.
    row = _row(text="대용량 옵션 추가되면 좋을 것 같아요.")
    assert classify_row(row, today=TODAY) == [INSIGHT]


# ── multi-class cases ────────────────────────────────────────────────


def test_usable_and_risk_mixed_review():
    # rating 4 + positive keyword qualifies for usable;
    # risk keyword "펌프" qualifies for risk.
    row = _row(
        text="향이 좋아서 재구매했는데 펌프가 잘 안 나와서 불편해요. 만족하지만 아쉬워요.",
        rating_raw=4.0,
        review_date=date(2026, 4, 1),
        has_brand_reply=True,
    )
    classes = classify_row(row, today=TODAY)
    assert USABLE in classes
    assert RISK in classes
    # "아쉬워요" is also an insight keyword → multi-class is allowed.
    assert INSIGHT in classes
    # Recent date → not stale.
    assert STALE not in classes


def test_unreplied_low_rating_is_risk_even_without_keyword():
    row = _row(
        text="음 그냥 그래요.",
        rating_raw=3.0,
        review_date=date(2026, 4, 1),
        has_brand_reply=False,
    )
    assert classify_row(row, today=TODAY) == [RISK]


def test_replied_three_star_is_not_risk_without_keyword():
    # rating == 3, has reply, no risk keyword → no class.
    row = _row(
        text="평범했어요.",
        rating_raw=3.0,
        review_date=date(2026, 4, 1),
        has_brand_reply=True,
    )
    assert classify_row(row, today=TODAY) == []


def test_old_low_rating_is_both_stale_and_risk():
    row = _row(
        text="용기 펌프가 깨져서 받았어요.",
        rating_raw=1.0,
        review_date=date(2024, 1, 1),
        has_brand_reply=False,
    )
    classes = classify_row(row, today=TODAY)
    assert STALE in classes
    assert RISK in classes


# ── edge cases ───────────────────────────────────────────────────────


def test_empty_text_no_rating_unknown_date_yields_no_class():
    row = _row(text="", rating_raw=None, review_date=None)
    assert classify_row(row, today=TODAY) == []


def test_short_positive_text_below_min_length_is_not_usable():
    # 5★ but text < 20 chars and contains positive keyword.
    row = _row(text="만족!", rating_raw=5.0, review_date=date(2026, 4, 20))
    assert classify_row(row, today=TODAY) == []


def test_high_rating_long_text_without_positive_keyword_is_not_usable():
    row = _row(
        text="구매했고 사용해봤습니다. 사용한 지 며칠 됐어요. 그냥 평범합니다.",
        rating_raw=5.0,
        review_date=date(2026, 4, 20),
    )
    assert classify_row(row, today=TODAY) == []


def test_stale_boundary_exactly_180_days_qualifies():
    row = _row(
        text="평범해요.",
        rating_raw=2.0,
        review_date=date(2025, 11, 5),  # exactly 180 days before TODAY
        has_brand_reply=True,
    )
    classes = classify_row(row, today=TODAY)
    assert STALE in classes


def test_stale_boundary_179_days_does_not_qualify_as_stale():
    row = _row(
        text="평범해요.",
        rating_raw=2.0,
        review_date=date(2025, 11, 6),  # 179 days
        has_brand_reply=True,
    )
    classes = classify_row(row, today=TODAY)
    assert STALE not in classes


# ── classify_all ──────────────────────────────────────────────────────


def test_negated_cautionary_keyword_at_high_rating_is_not_risk():
    # "트러블 안 났어요" is a positive review even though it contains "트러블".
    row = _row(
        text="트러블 안 났어요. 정말 좋아요. 재구매 의사 있어요.",
        rating_raw=5.0,
        review_date=date(2026, 4, 20),
        has_brand_reply=True,
    )
    classes = classify_row(row, today=TODAY)
    assert RISK not in classes


def test_low_rating_with_cautionary_keyword_is_risk():
    row = _row(
        text="트러블 났어요.",
        rating_raw=2.0,
        review_date=date(2026, 4, 1),
        has_brand_reply=True,
    )
    assert RISK in classify_row(row, today=TODAY)


def test_positive_broad_keyword_at_high_rating_is_not_risk():
    # "향이 좋아요" — broad keyword 향 with no complaint marker, ★5.
    row = _row(
        text="향이 정말 좋아요. 재구매했어요.",
        rating_raw=5.0,
        review_date=date(2026, 4, 20),
        has_brand_reply=True,
    )
    assert RISK not in classify_row(row, today=TODAY)


def test_negative_broad_keyword_with_marker_at_high_rating_is_risk():
    # ★5 but a complaint marker ('역해') sits within ±20 chars of '향'.
    row = _row(
        text="향이 너무 역해요. 인공적이에요.",
        rating_raw=5.0,
        review_date=date(2026, 4, 1),
        has_brand_reply=True,
    )
    assert RISK in classify_row(row, today=TODAY)


def test_low_rating_alone_is_still_risk_without_keyword():
    # Hard rule: rating ≤ 2 is risk regardless of keywords.
    row = _row(
        text="그냥 별로.",
        rating_raw=1.0,
        review_date=date(2026, 4, 1),
        has_brand_reply=True,
    )
    assert RISK in classify_row(row, today=TODAY)


def test_broad_keyword_far_marker_does_not_count_as_risk_at_high_rating():
    # ★5, '향' at start, '아쉬' >20 chars away → polarity gate fails.
    far_text = "향" + ("가" * 40) + "아쉬워요"
    row = _row(
        text=far_text,
        rating_raw=5.0,
        review_date=date(2026, 4, 1),
        has_brand_reply=True,
    )
    assert RISK not in classify_row(row, today=TODAY)


def test_classify_all_skips_unclassified_reviews_and_keeps_multi_class():
    inputs = ReviewOpsInputs(
        run_dir=Path("/tmp/fake"),
        run_id=None,
        analysis_report={},
        manifest={},
        reviews=[
            _row(
                review_id="r1",
                text="흡수도 좋고 발림성 만족이에요. 재구매 의사 있어요.",
                rating_raw=5.0,
                review_date=date(2026, 4, 1),
            ),
            _row(
                review_id="r2",
                text="평범했어요.",
                rating_raw=3.0,
                has_brand_reply=True,
            ),  # no class
            _row(
                review_id="r3",
                text="대용량 리필 옵션 추가 되면 좋겠어요.",
                rating_raw=4.0,
                review_date=date(2026, 3, 1),
            ),
        ],
    )

    result = classify_all(inputs, today=TODAY)
    assert "r2" not in result
    assert result["r1"] == [USABLE]
    # r3: positive keyword absent (no usable), insight keywords present.
    assert result["r3"] == [INSIGHT]
