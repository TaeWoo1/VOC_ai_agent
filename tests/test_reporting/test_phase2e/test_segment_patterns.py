"""Tests for `src/voc/reporting/phase2e/segment_patterns.py`.

Coverage:
  - tone keywords detected only when explicitly mentioned
  - skin-type keywords detected only when explicitly mentioned
  - usage-context groups aggregate multi-token mentions
  - finish-preference groups aggregate multi-token mentions
  - no inferred tone/skin type from product color or polarity
  - SEGMENT_MIN_MENTIONS floor honored
  - buyer_fit_positive populated when positive mentions dominate
  - buyer_fit_caution populated when negative mentions dominate
  - representative_quote is verbatim from review text
  - build_pdf_buyer_signals returns max-3 cards with denominators
  - BuyerContentSummary structured fields populated correctly
  - SNS-export wording avoids prescriptive/medical phrases
"""

from __future__ import annotations

from collections import Counter

import pytest

from src.voc.reporting.phase2e.report import (
    AttributeSummary,
    ProductReportData,
)
from src.voc.reporting.phase2e.segment_patterns import (
    BuyerContentSummary,
    BuyerSegmentSignal,
    SEGMENT_MIN_MENTIONS,
    SKIN_TYPE_KEYWORDS_KO,
    SegmentBucket,
    SegmentDetection,
    SegmentMention,
    TONE_KEYWORDS_KO,
    USAGE_CONTEXT_GROUPS_KO,
    build_buyer_content_summary,
    build_pdf_buyer_signals,
    detect_segments,
)


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


def _block(rid: str, polarity: str, span: str, attribute: str = "x") -> dict:
    return {
        "review_id": rid,
        "mixed_review_flag": False,
        "tradeoff_pair": None,
        "records": [{
            "attribute": attribute,
            "polarity": polarity,
            "intensity": 2,
            "evidence_span": span,
            "confidence": "high",
            "delivery_condition_flag": False,
        }],
    }


# ---------------------------------------------------------------------------
# Tone detection — explicit mention only
# ---------------------------------------------------------------------------


def test_tone_detected_when_keyword_appears_in_span():
    blocks = [
        _block(f"r{i}", "positive", "쿨톤에 정말 잘 맞아요")
        for i in range(SEGMENT_MIN_MENTIONS)
    ]
    det = detect_segments(blocks)
    labels = {b.label_ko for b in det.tone_buckets}
    assert "쿨톤" in labels


def test_tone_not_detected_when_keyword_absent():
    """Locked: no inference. A review that says '잘 맞아요' WITHOUT
    a tone keyword must not surface in tone buckets."""
    blocks = [
        _block(f"r{i}", "positive", "정말 잘 맞아요")
        for i in range(SEGMENT_MIN_MENTIONS)
    ]
    det = detect_segments(blocks)
    assert det.tone_buckets == ()


def test_tone_not_inferred_from_product_color():
    """A review mentioning '레드' or '블루' (color) must not be
    classified as a tone mention. Only explicit tone vocabulary
    (쿨톤/웜톤/personal-color labels) counts."""
    blocks = [
        _block(f"r{i}", "positive", "레드 컬러 너무 예뻐요")
        for i in range(10)
    ]
    det = detect_segments(blocks)
    assert det.tone_buckets == ()


def test_tone_personal_color_keywords_count_independently():
    blocks = [
        _block(f"sp_{i}", "positive", "봄웜라이트인데 잘 맞아요")
        for i in range(SEGMENT_MIN_MENTIONS)
    ]
    blocks += [
        _block(f"yu_{i}", "positive", "여쿨한테 너무 예쁘게 발색")
        for i in range(SEGMENT_MIN_MENTIONS)
    ]
    det = detect_segments(blocks)
    labels = {b.label_ko for b in det.tone_buckets}
    assert "봄웜라이트" in labels
    assert "여쿨" in labels


# ---------------------------------------------------------------------------
# Skin-type detection — explicit mention only
# ---------------------------------------------------------------------------


def test_skin_type_detected_when_explicit():
    blocks = [
        _block(f"r{i}", "positive", "건성 피부인데 안 당기네요")
        for i in range(SEGMENT_MIN_MENTIONS)
    ]
    det = detect_segments(blocks)
    labels = {b.label_ko for b in det.skin_type_buckets}
    # Exact-match longer phrase wins over '건성' alone.
    assert "건성 피부" in labels


def test_skin_type_not_inferred_from_dryness_complaint():
    """A review complaining of dryness ('건조해요') without
    explicitly saying '건성' / '건성 피부' must NOT be classified
    as a skin-type mention."""
    blocks = [
        _block(f"r{i}", "negative_weak", "쓰면 건조해져요")
        for i in range(10)
    ]
    det = detect_segments(blocks)
    assert det.skin_type_buckets == ()


# ---------------------------------------------------------------------------
# Usage-context grouped scan
# ---------------------------------------------------------------------------


def test_usage_context_aggregates_group_tokens():
    blocks = [
        _block("r1", "positive", "데일리로 쓰기 좋아요"),
        _block("r2", "positive", "매일 쓰는 제품이에요"),
        _block("r3", "positive", "평상시 발라요"),
    ]
    det = detect_segments(blocks)
    daily_buckets = [
        b for b in det.usage_context_buckets
        if b.label_ko == "데일리 사용"
    ]
    assert daily_buckets
    # 3 tokens (데일리, 매일, 평상시) all collapse into one bucket.
    assert daily_buckets[0].n_total == 3


def test_usage_context_mask_outdoor_aggregation():
    blocks = [
        _block(f"r{i}", "negative_weak", "마스크에 다 묻어요")
        for i in range(SEGMENT_MIN_MENTIONS)
    ]
    det = detect_segments(blocks)
    mask_b = next(
        (b for b in det.usage_context_buckets
         if b.label_ko == "마스크/외출 상황"), None,
    )
    assert mask_b is not None
    assert mask_b.n_negative >= SEGMENT_MIN_MENTIONS


def test_segment_below_min_mentions_floor_excluded():
    """An attribute mentioned in only 1-2 reviews shouldn't surface."""
    blocks = [
        _block("r1", "positive", "쿨톤에 잘 맞아요"),
        _block("r2", "positive", "쿨톤이라 좋아요"),
    ]
    det = detect_segments(blocks)
    # 2 < SEGMENT_MIN_MENTIONS=3 → tone bucket excluded.
    assert det.tone_buckets == ()


# ---------------------------------------------------------------------------
# buyer_fit_positive / buyer_fit_caution cross-cut
# ---------------------------------------------------------------------------


def test_buyer_fit_positive_populated_when_positive_dominant():
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 너무 잘 맞음")
        for i in range(8)
    ]
    blocks += [
        _block("n1", "negative_weak", "쿨톤에는 약간 어색"),
    ]
    det = detect_segments(blocks)
    pos_labels = {b.label_ko for b in det.buyer_fit_positive}
    assert "쿨톤" in pos_labels
    assert det.buyer_fit_caution == () or all(
        b.label_ko != "쿨톤" for b in det.buyer_fit_caution
    )


def test_buyer_fit_caution_populated_when_negative_dominant():
    blocks = [
        _block(f"n{i}", "negative_strong", "건성 피부에 안 맞아요")
        for i in range(6)
    ]
    blocks += [
        _block("p1", "positive", "건성 피부도 괜찮아요"),
    ]
    det = detect_segments(blocks)
    caution_labels = {b.label_ko for b in det.buyer_fit_caution}
    assert "건성 피부" in caution_labels


def test_representative_quote_is_verbatim_from_review():
    """Locked: representative_quote must be exact reviewer text -
    no paraphrasing, no truncation that loses meaning."""
    span = "건성 피부인데 정말 촉촉하게 발리고 좋아요"
    blocks = [
        _block(f"r{i}", "positive", span)
        for i in range(SEGMENT_MIN_MENTIONS)
    ]
    det = detect_segments(blocks)
    bucket = next(
        (b for b in det.skin_type_buckets if "건성" in b.label_ko),
        None,
    )
    assert bucket is not None
    assert bucket.representative_quote == span


# ---------------------------------------------------------------------------
# PDF buyer signals
# ---------------------------------------------------------------------------


def test_build_pdf_buyer_signals_returns_max_3_cards():
    blocks: list[dict] = []
    blocks += [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(8)
    ]
    blocks += [
        _block(f"n{i}", "negative_strong", "건성 피부에 안 맞아요")
        for i in range(6)
    ]
    raw = [{"option_text": "21호 라이트 베이지"}, {"option_text": "23호 미디엄"}]
    det = detect_segments(blocks, raw_reviews=raw)
    signals = build_pdf_buyer_signals(det, n_reviews_total=100)
    assert 1 <= len(signals) <= 3


def test_pdf_buyer_signal_includes_denominator():
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(8)
    ]
    det = detect_segments(blocks)
    signals = build_pdf_buyer_signals(det, n_reviews_total=1135)
    assert signals
    assert signals[0].denominator == 1135
    assert "분석 리뷰 1,135건" in signals[0].denominator_basis_ko


def test_pdf_buyer_signal_avoids_prescriptive_wording():
    """Locked: seller and buyer notes must not read as
    medical/dermatological advice."""
    BANNED = (
        "이 피부에 적합", "민감성 피부 추천", "반드시",
        "필수", "해야 합니다", "권고합니다",
    )
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(8)
    ]
    blocks += [
        _block(f"n{i}", "negative_strong", "건성 피부에 안 맞음")
        for i in range(6)
    ]
    det = detect_segments(blocks)
    signals = build_pdf_buyer_signals(det, n_reviews_total=100)
    for sig in signals:
        for term in BANNED:
            assert term not in sig.seller_note_ko, \
                f"banned wording '{term}' in seller_note: {sig.seller_note_ko!r}"
            assert term not in sig.buyer_note_ko, \
                f"banned wording '{term}' in buyer_note: {sig.buyer_note_ko!r}"


def test_pdf_buyer_signal_uses_observational_phrasing():
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(8)
    ]
    det = detect_segments(blocks)
    signals = build_pdf_buyer_signals(det, n_reviews_total=100)
    assert signals
    text_blob = " ".join(
        s.seller_note_ko + " " + s.buyer_note_ko for s in signals
    )
    # At least one observational phrase appears.
    assert (
        "관찰됩니다" in text_blob or "잘 맞았다는" in text_blob
        or "후보" in text_blob or "권장" in text_blob
        or "확인" in text_blob
    )


# ---------------------------------------------------------------------------
# BuyerContentSummary export
# ---------------------------------------------------------------------------


def test_buyer_content_summary_returns_structured_fields():
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(8)
    ]
    det = detect_segments(blocks)
    summary = build_buyer_content_summary(
        product_name="테스트 제품",
        detection=det,
        overall_level="LOW",
        n_reviews_total=1135,
    )
    assert isinstance(summary, BuyerContentSummary)
    assert summary.product_name == "테스트 제품"
    assert summary.one_line_summary
    assert isinstance(summary.best_fit_contexts, tuple)
    assert isinstance(summary.check_before_buying, tuple)
    assert isinstance(summary.top_positive_quotes, tuple)
    assert isinstance(summary.top_caution_quotes, tuple)
    assert isinstance(summary.seller_notes, tuple)


def test_buyer_content_summary_low_level_uses_positive_lead():
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(8)
    ]
    det = detect_segments(blocks)
    summary = build_buyer_content_summary(
        product_name="P",
        detection=det,
        overall_level="LOW",
        n_reviews_total=1135,
    )
    assert "긍정 신호" in summary.one_line_summary or \
           "낮은 수준" in summary.one_line_summary or \
           "긍정" in summary.one_line_summary


def test_buyer_content_summary_no_prescriptive_wording():
    BANNED = (
        "이 피부에 적합", "민감성 피부 추천", "반드시",
        "필수", "해야 합니다", "권고합니다",
    )
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(8)
    ]
    blocks += [
        _block(f"n{i}", "negative_strong", "건성 피부에 안 맞음")
        for i in range(6)
    ]
    det = detect_segments(blocks)
    summary = build_buyer_content_summary(
        product_name="P",
        detection=det,
        overall_level="LOW",
        n_reviews_total=1000,
    )
    text_blob = " ".join([
        summary.one_line_summary,
        " ".join(summary.best_fit_contexts),
        " ".join(summary.check_before_buying),
        " ".join(summary.seller_notes),
    ])
    for term in BANNED:
        assert term not in text_blob, \
            f"banned wording '{term}' in summary: {text_blob[:200]!r}"


def test_buyer_content_summary_top_quotes_are_verbatim():
    span = "쿨톤한테 정말 잘 맞고 발색도 예뻐요"
    blocks = [_block(f"p{i}", "positive", span) for i in range(8)]
    det = detect_segments(blocks)
    summary = build_buyer_content_summary(
        product_name="P", detection=det,
        overall_level="LOW", n_reviews_total=100,
    )
    if summary.top_positive_quotes:
        assert summary.top_positive_quotes[0] == span


# ---------------------------------------------------------------------------
# Vocabulary lock
# ---------------------------------------------------------------------------


def test_tone_vocabulary_locked():
    """The tone keyword list is stakeholder-visible. Adding a token
    should be a deliberate edit + this assertion update."""
    expected_subset = {
        "쿨톤", "웜톤", "뉴트럴톤", "뮤트톤",
        "봄웜", "여쿨", "가을웜", "겨울쿨",
    }
    assert expected_subset.issubset(set(TONE_KEYWORDS_KO))


def test_skin_type_vocabulary_locked():
    expected_subset = {
        "건성", "지성", "복합성", "민감성",
        "건성 피부", "지성 피부", "민감성 피부",
    }
    assert expected_subset.issubset(set(SKIN_TYPE_KEYWORDS_KO))


def test_usage_context_groups_locked():
    """Five context groups: daily / point_makeup / layering /
    mask_outdoor / beginner."""
    expected_groups = {
        "daily", "point_makeup", "layering",
        "mask_outdoor", "beginner",
    }
    assert set(USAGE_CONTEXT_GROUPS_KO.keys()) == expected_groups


# ---------------------------------------------------------------------------
# Decision-support upgrade — decision_hint, QuickDecisionSummary,
# hook_lines, content quotes, theme contrasts
# ---------------------------------------------------------------------------


def test_buyer_signal_carries_decision_hint():
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(8)
    ]
    from src.voc.reporting.phase2e.segment_patterns import (
        build_pdf_buyer_signals,
    )
    det = detect_segments(blocks)
    signals = build_pdf_buyer_signals(det, n_reviews_total=100)
    assert signals
    # First (best-fit) signal must carry a non-empty decision hint.
    assert signals[0].decision_hint_ko
    # Soft-rec form: contains "잘 맞았다" / "무난하" or
    # "확인하는 것이 좋습니다".
    hint = signals[0].decision_hint_ko
    assert any(
        marker in hint
        for marker in ("잘 맞았다", "무난하", "확인하는 것이 좋")
    )


def test_decision_hint_for_caution_targets_related_attribute():
    """Caution segment for "마스크/외출 상황" mentions 지속력 in
    its decision hint (mapping locked in
    _CAUTION_RELATED_ATTRIBUTE_KO)."""
    blocks = [
        _block(f"n{i}", "negative_strong", "마스크 쓰면 다 묻어요")
        for i in range(6)
    ]
    from src.voc.reporting.phase2e.segment_patterns import (
        build_pdf_buyer_signals,
    )
    det = detect_segments(blocks)
    signals = build_pdf_buyer_signals(det, n_reviews_total=100)
    caution_signals = [
        s for s in signals if "주의 신호" in s.label_ko
    ]
    assert caution_signals
    hint = caution_signals[0].decision_hint_ko
    # The mask-context caution should mention 지속력.
    assert "지속력" in hint or "확인하는 것이 좋" in hint


def test_quick_decision_summary_returns_three_lines():
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(8)
    ]
    blocks += [
        _block(f"n{i}", "negative_strong", "마스크 쓰면 다 묻어요")
        for i in range(6)
    ]
    from src.voc.reporting.phase2e.segment_patterns import (
        QuickDecisionSummary, build_quick_decision_summary,
    )
    det = detect_segments(blocks)
    quick = build_quick_decision_summary(
        det, overall_level="LOW", n_reviews_total=1135,
    )
    assert isinstance(quick, QuickDecisionSummary)
    assert quick.who_it_works_for
    assert quick.who_should_check_more
    assert quick.simple_takeaway


def test_quick_decision_who_it_works_for_uses_segment_label():
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(8)
    ]
    from src.voc.reporting.phase2e.segment_patterns import (
        build_quick_decision_summary,
    )
    det = detect_segments(blocks)
    quick = build_quick_decision_summary(
        det, overall_level="LOW", n_reviews_total=100,
    )
    assert "쿨톤" in quick.who_it_works_for
    assert "잘 맞았다" in quick.who_it_works_for or \
           "잘 맞" in quick.who_it_works_for


def test_quick_decision_uses_observational_phrasing_only():
    """Locked: must not read as prescriptive/medical advice."""
    BANNED = (
        "이 피부에 적합", "민감성 피부 추천", "반드시", "필수",
        "해야 합니다", "권고합니다",
    )
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(8)
    ]
    blocks += [
        _block(f"n{i}", "negative_strong", "마스크 쓰면 다 묻어요")
        for i in range(6)
    ]
    from src.voc.reporting.phase2e.segment_patterns import (
        build_quick_decision_summary,
    )
    det = detect_segments(blocks)
    quick = build_quick_decision_summary(
        det, overall_level="LOW", n_reviews_total=100,
    )
    text_blob = (
        quick.who_it_works_for + " "
        + quick.who_should_check_more + " "
        + quick.simple_takeaway
    )
    for term in BANNED:
        assert term not in text_blob, \
            f"banned wording '{term}' in quick decision: {text_blob!r}"


# Hook lines (SNS only) -----------------------------------------------------


def test_buyer_content_summary_includes_hook_lines():
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(8)
    ]
    from src.voc.reporting.phase2e.segment_patterns import (
        build_buyer_content_summary,
    )
    det = detect_segments(blocks)
    summary = build_buyer_content_summary(
        product_name="P", detection=det,
        overall_level="LOW", n_reviews_total=1135,
    )
    assert summary.hook_lines
    assert len(summary.hook_lines) <= 3
    # First hook is the universal "이런 사용자에게 잘 맞았다" form
    # whenever buyer_fit_positive exists.
    assert "잘 맞았다" in summary.hook_lines[0]


def test_buyer_content_summary_hook_count_hook_only_for_large_corpora():
    """The "리뷰 N건 기준 반복 패턴" hook surfaces only when the
    corpus is meaningfully large AND confidence is moderate+.
    Small corpora or weak signals fall back to the "초기 패턴"
    framing instead."""
    # Need 10+ positive mentions so confidence reaches "moderate".
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(15)
    ]
    from src.voc.reporting.phase2e.segment_patterns import (
        build_buyer_content_summary,
    )
    det = detect_segments(blocks)
    small = build_buyer_content_summary(
        product_name="P", detection=det,
        overall_level="LOW", n_reviews_total=80,
    )
    big = build_buyer_content_summary(
        product_name="P", detection=det,
        overall_level="LOW", n_reviews_total=1135,
    )
    # Big corpus + moderate+ confidence → "리뷰 N건" hook present.
    assert any(
        "1,135건" in h or "1,135" in h for h in big.hook_lines
    )
    # Small corpus → "초기 패턴" framing, no exact-N hook.
    assert any("초기 패턴" in h for h in small.hook_lines)


def test_buyer_content_summary_hook_lines_avoid_prescriptive_wording():
    BANNED = (
        "반드시", "필수", "해야 합니다", "권고합니다",
        "이 피부에 적합",
    )
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(8)
    ]
    blocks += [
        _block(f"n{i}", "negative_strong", "건성 피부에 안 맞아요")
        for i in range(6)
    ]
    from src.voc.reporting.phase2e.segment_patterns import (
        build_buyer_content_summary,
    )
    det = detect_segments(blocks)
    summary = build_buyer_content_summary(
        product_name="P", detection=det,
        overall_level="LOW", n_reviews_total=1135,
    )
    text_blob = " ".join(summary.hook_lines)
    for term in BANNED:
        assert term not in text_blob


# Content quote selection ---------------------------------------------------


def test_pick_content_quote_filters_long_neutral_spans():
    from src.voc.reporting.phase2e.segment_patterns import (
        pick_content_quote, QUOTE_MAX_CHARS_FOR_CONTENT,
    )
    long_span = "ㄱ" * (QUOTE_MAX_CHARS_FOR_CONTENT + 5)
    neutral_span = "보통 무난해요 적당히 쓸 만해요"
    candidates = [long_span, neutral_span]
    assert pick_content_quote(candidates) is None


def test_pick_content_quote_prefers_emotional_short_spans():
    from src.voc.reporting.phase2e.segment_patterns import (
        pick_content_quote,
    )
    candidates = [
        "괜찮은 편입니다",                  # neutral, fine length
        "정말 너무 잘 맞아요 짱!",          # emotional + short
        "이런저런 평가가 있는 듯합니다",    # neutral
    ]
    pick = pick_content_quote(candidates)
    assert pick == "정말 너무 잘 맞아요 짱!"


def test_pick_content_quote_returns_none_when_no_candidates():
    from src.voc.reporting.phase2e.segment_patterns import (
        pick_content_quote,
    )
    assert pick_content_quote([]) is None
    assert pick_content_quote(["ㅋ", ""]) is None  # too short


# Theme contrasts -----------------------------------------------------------


def test_theme_contrast_surfaces_only_when_both_sides_observed():
    """When only one side of a theme has mentions, the contrast
    is omitted - no fabricated comparison."""
    # Only daily mentions, no point_makeup → no daily-vs-point theme.
    blocks = [
        _block(f"r{i}", "positive", "데일리로 쓰기 좋아요")
        for i in range(8)
    ]
    from src.voc.reporting.phase2e.segment_patterns import (
        detect_theme_contrasts,
    )
    det = detect_segments(blocks)
    contrasts = detect_theme_contrasts(det)
    daily_vs_point = [
        c for c in contrasts
        if "데일리" in c.theme_label_ko
        and "포인트" in c.theme_label_ko
    ]
    assert daily_vs_point == []


def test_theme_contrast_emits_when_both_sides_observed():
    """daily mentions + mask_outdoor mentions → 실내 vs 야외 theme
    contrast surfaces."""
    blocks = [
        _block(f"daily_{i}", "positive", "데일리로 쓰기 좋아요")
        for i in range(5)
    ]
    blocks += [
        _block(f"mask_{i}", "negative_strong", "마스크 쓰면 다 묻어요")
        for i in range(5)
    ]
    from src.voc.reporting.phase2e.segment_patterns import (
        detect_theme_contrasts,
    )
    det = detect_segments(blocks)
    contrasts = detect_theme_contrasts(det)
    # The "실내 vs 야외/마스크" theme should fire.
    indoor_outdoor = [
        c for c in contrasts if "실내" in c.theme_label_ko
    ]
    assert indoor_outdoor
    assert "데일리 사용" in indoor_outdoor[0].contrast_sentence_ko
    assert "마스크/외출" in indoor_outdoor[0].contrast_sentence_ko


# BuyerContentSummary structure (extended) ----------------------------------


def test_buyer_content_summary_includes_quick_decision():
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(8)
    ]
    from src.voc.reporting.phase2e.segment_patterns import (
        QuickDecisionSummary,
        build_buyer_content_summary,
    )
    det = detect_segments(blocks)
    summary = build_buyer_content_summary(
        product_name="P", detection=det,
        overall_level="LOW", n_reviews_total=100,
    )
    assert isinstance(summary.quick_decision, QuickDecisionSummary)
    assert summary.quick_decision.who_it_works_for


def test_buyer_content_summary_includes_contrast_sentences():
    blocks = [
        _block(f"daily_{i}", "positive", "데일리로 쓰기 좋아요")
        for i in range(5)
    ]
    blocks += [
        _block(f"mask_{i}", "negative_strong", "마스크 쓰면 다 묻어요")
        for i in range(5)
    ]
    from src.voc.reporting.phase2e.segment_patterns import (
        build_buyer_content_summary,
    )
    det = detect_segments(blocks)
    summary = build_buyer_content_summary(
        product_name="P", detection=det,
        overall_level="LOW", n_reviews_total=100,
    )
    assert summary.contrast_sentences  # non-empty when theme fires


# ---------------------------------------------------------------------------
# Confidence-strength layer
# ---------------------------------------------------------------------------


# compute_segment_confidence rubric ----------------------------------------


def test_segment_confidence_strong_branch():
    from src.voc.reporting.phase2e.segment_patterns import (
        compute_segment_confidence,
    )
    # 30 dominant on 35 total → 0.857 dominance, ≥ thresholds.
    assert compute_segment_confidence(
        dominant_count=30, total_mentions=35, n_reviews_total=1000,
    ) == "strong"


def test_segment_confidence_moderate_branch():
    from src.voc.reporting.phase2e.segment_patterns import (
        compute_segment_confidence,
    )
    # 12 dominant on 18 total → 0.667 dominance, ≥ moderate thresholds.
    assert compute_segment_confidence(
        dominant_count=12, total_mentions=18, n_reviews_total=500,
    ) == "moderate"


def test_segment_confidence_weak_when_count_too_low():
    from src.voc.reporting.phase2e.segment_patterns import (
        compute_segment_confidence,
    )
    # Only 5 dominant - below moderate floor of 10.
    assert compute_segment_confidence(
        dominant_count=5, total_mentions=6, n_reviews_total=500,
    ) == "weak"


def test_segment_confidence_weak_when_dominance_too_low():
    from src.voc.reporting.phase2e.segment_patterns import (
        compute_segment_confidence,
    )
    # 12 dominant on 25 total → 0.48 dominance, below 0.60 floor.
    assert compute_segment_confidence(
        dominant_count=12, total_mentions=25, n_reviews_total=500,
    ) == "weak"


def test_segment_confidence_demoted_on_small_corpus():
    """A signal that would normally be 'strong' caps at 'moderate'
    when the corpus is < 100 reviews."""
    from src.voc.reporting.phase2e.segment_patterns import (
        compute_segment_confidence,
    )
    assert compute_segment_confidence(
        dominant_count=30, total_mentions=35, n_reviews_total=80,
    ) == "moderate"


def test_segment_confidence_capped_at_weak_on_tiny_corpus():
    """When N < 30, no segment can claim more than weak."""
    from src.voc.reporting.phase2e.segment_patterns import (
        compute_segment_confidence,
    )
    assert compute_segment_confidence(
        dominant_count=12, total_mentions=15, n_reviews_total=25,
    ) == "weak"


def test_segment_confidence_at_exact_thresholds():
    """Boundary check - rubric uses >= comparisons."""
    from src.voc.reporting.phase2e.segment_patterns import (
        compute_segment_confidence,
    )
    # Exactly at strong floor: count=30, dominance=0.75.
    assert compute_segment_confidence(
        dominant_count=30, total_mentions=40, n_reviews_total=1000,
    ) == "strong"
    # Exactly at moderate floor: count=10, dominance=0.60.
    assert compute_segment_confidence(
        dominant_count=10, total_mentions=17,  # 10/17 ≈ 0.588 → weak
        n_reviews_total=500,
    ) == "weak"  # just below 0.60 → weak
    # Bump dominance to exactly 0.60 (count=12 / total=20):
    assert compute_segment_confidence(
        dominant_count=12, total_mentions=20, n_reviews_total=500,
    ) == "moderate"


# BuyerSegmentSignal carries confidence_level + matching wording -----------


def test_buyer_signal_confidence_level_strong_uses_consistent_phrasing():
    """30+ dominant + 75%+ dominance + N>=100 → strong → "일관되게
    나타납니다" form."""
    from src.voc.reporting.phase2e.segment_patterns import (
        build_pdf_buyer_signals,
    )
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(35)
    ]
    det = detect_segments(blocks)
    signals = build_pdf_buyer_signals(det, n_reviews_total=500)
    assert signals
    pos_card = signals[0]
    assert pos_card.confidence_level == "strong"
    assert "일관되게" in pos_card.decision_hint_ko or \
           "일관되게" in pos_card.buyer_note_ko


def test_buyer_signal_confidence_level_moderate_uses_repeated_phrasing():
    from src.voc.reporting.phase2e.segment_patterns import (
        build_pdf_buyer_signals,
    )
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(15)
    ]
    det = detect_segments(blocks)
    signals = build_pdf_buyer_signals(det, n_reviews_total=500)
    pos_card = signals[0]
    assert pos_card.confidence_level == "moderate"
    assert "반복적으로 관찰됩니다" in pos_card.decision_hint_ko or \
           "반복적으로 관찰됩니다" in pos_card.buyer_note_ko


def test_buyer_signal_confidence_level_weak_uses_partial_phrasing():
    """Below moderate count floor → weak → "일부 보입니다" form."""
    from src.voc.reporting.phase2e.segment_patterns import (
        build_pdf_buyer_signals,
    )
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(7)
    ]
    det = detect_segments(blocks)
    signals = build_pdf_buyer_signals(det, n_reviews_total=500)
    pos_card = signals[0]
    assert pos_card.confidence_level == "weak"
    assert "일부 보입니다" in pos_card.decision_hint_ko or \
           "일부 보입니다" in pos_card.buyer_note_ko


def test_confidence_phrasing_avoids_banned_strong_wording():
    """Banned regardless of level: 확실히 / 반드시 / 강력 추천 /
    절대."""
    from src.voc.reporting.phase2e.segment_patterns import (
        build_pdf_buyer_signals,
    )
    BANNED = ("확실히", "반드시", "강력 추천", "절대",)
    for n_count in (5, 15, 35):
        blocks = [
            _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
            for i in range(n_count)
        ]
        det = detect_segments(blocks)
        signals = build_pdf_buyer_signals(det, n_reviews_total=1000)
        for sig in signals:
            text_blob = (
                sig.decision_hint_ko + " "
                + sig.seller_note_ko + " "
                + sig.buyer_note_ko
            )
            for term in BANNED:
                assert term not in text_blob, \
                    f"banned wording '{term}' in card with " \
                    f"n={n_count}: {text_blob!r}"


# QuickDecisionSummary confidence_level ------------------------------------


def test_quick_decision_carries_confidence_level():
    from src.voc.reporting.phase2e.segment_patterns import (
        build_quick_decision_summary,
    )
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(35)
    ]
    det = detect_segments(blocks)
    quick = build_quick_decision_summary(
        det, overall_level="LOW", n_reviews_total=500,
    )
    assert quick.confidence_level == "strong"
    # Strong corpus reads as "일관되게" in at least one line.
    assert (
        "일관되게" in quick.who_it_works_for
        or "일관되게" in quick.simple_takeaway
    )


def test_quick_decision_weak_low_corpus_uses_partial_phrasing():
    """Tiny corpus + few mentions → weak → "일부 보입니다" form."""
    from src.voc.reporting.phase2e.segment_patterns import (
        build_quick_decision_summary,
    )
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(5)
    ]
    det = detect_segments(blocks)
    quick = build_quick_decision_summary(
        det, overall_level="LOW", n_reviews_total=50,
    )
    assert quick.confidence_level == "weak"
    text_blob = (
        quick.who_it_works_for + " "
        + quick.simple_takeaway
    )
    assert "일부 보입니다" in text_blob


# Confidence badge ---------------------------------------------------------


def test_confidence_badge_for_strong_large_corpus():
    """N >= 1000 + confidence != weak → '리뷰 기반 판단 (표본 1,000+)'"""
    from src.voc.reporting.phase2e.segment_patterns import (
        build_buyer_content_summary,
    )
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(35)
    ]
    det = detect_segments(blocks)
    summary = build_buyer_content_summary(
        product_name="P", detection=det,
        overall_level="LOW", n_reviews_total=1135,
    )
    assert summary.confidence_badge_ko == "리뷰 기반 판단 (표본 1,000+)"


def test_confidence_badge_for_weak_or_small_corpus():
    """N < 200 OR weak confidence → '초기 신호 (표본 적음)'"""
    from src.voc.reporting.phase2e.segment_patterns import (
        build_buyer_content_summary,
    )
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(5)
    ]
    det = detect_segments(blocks)
    small = build_buyer_content_summary(
        product_name="P", detection=det,
        overall_level="LOW", n_reviews_total=50,
    )
    assert small.confidence_badge_ko == "초기 신호 (표본 적음)"


def test_confidence_badge_mid_corpus_shows_count():
    """N in [200, 1000) + confidence != weak → '리뷰 기반 판단 (표본 N건)'"""
    from src.voc.reporting.phase2e.segment_patterns import (
        build_buyer_content_summary,
    )
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(15)
    ]
    det = detect_segments(blocks)
    summary = build_buyer_content_summary(
        product_name="P", detection=det,
        overall_level="LOW", n_reviews_total=350,
    )
    assert summary.confidence_badge_ko == "리뷰 기반 판단 (표본 350건)"


# Hook line variation ------------------------------------------------------


def test_hook_lines_strong_corpus_uses_consistent_pattern_phrasing():
    from src.voc.reporting.phase2e.segment_patterns import (
        build_buyer_content_summary,
    )
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(35)
    ]
    det = detect_segments(blocks)
    summary = build_buyer_content_summary(
        product_name="P", detection=det,
        overall_level="LOW", n_reviews_total=1135,
    )
    text_blob = " ".join(summary.hook_lines)
    assert "일관되게 나타납니다" in text_blob or \
           "반복 패턴" in text_blob


def test_hook_lines_weak_corpus_uses_initial_pattern_phrasing():
    from src.voc.reporting.phase2e.segment_patterns import (
        build_buyer_content_summary,
    )
    blocks = [
        _block(f"p{i}", "positive", "쿨톤한테 잘 맞음")
        for i in range(5)
    ]
    det = detect_segments(blocks)
    summary = build_buyer_content_summary(
        product_name="P", detection=det,
        overall_level="LOW", n_reviews_total=80,
    )
    text_blob = " ".join(summary.hook_lines)
    assert "초기 패턴" in text_blob or "일부 리뷰에서" in text_blob


# Threshold constants locked -----------------------------------------------


def test_confidence_threshold_constants_are_locked():
    """Locked: changing these affects every PDF + SNS surface."""
    from src.voc.reporting.phase2e.segment_patterns import (
        SEGMENT_MODERATE_MIN_COUNT, SEGMENT_MODERATE_MIN_DOMINANCE,
        SEGMENT_SMALL_CORPUS_DEMOTE_FLOOR,
        SEGMENT_STRONG_MIN_COUNT, SEGMENT_STRONG_MIN_DOMINANCE,
        SEGMENT_TINY_CORPUS_DEMOTE_FLOOR,
    )
    assert SEGMENT_STRONG_MIN_COUNT == 30
    assert SEGMENT_STRONG_MIN_DOMINANCE == 0.75
    assert SEGMENT_MODERATE_MIN_COUNT == 10
    assert SEGMENT_MODERATE_MIN_DOMINANCE == 0.60
    assert SEGMENT_SMALL_CORPUS_DEMOTE_FLOOR == 100
    assert SEGMENT_TINY_CORPUS_DEMOTE_FLOOR == 30
