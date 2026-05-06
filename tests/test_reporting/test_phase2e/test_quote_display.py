"""Tests for evidence-quote display normalization.

The aggregator emits raw character-window spans for attribute-detection
recall; those spans are not designed to read well in a business
report. `normalize_for_display` produces a sentence-ish, length-
bounded string that PDF/cardnews surfaces use, while the raw span
is preserved on the same dict for audit.

Acceptance is qualitative — every test asserts a property the
display string must satisfy.
"""
from __future__ import annotations

from src.voc.reporting.phase2e.quote_display import (
    DEFAULT_MAX_LEN,
    normalize_for_display,
    synthesize_phrase_display,
)


# -----------------------------------------------------------------------------
# Length cap.
# -----------------------------------------------------------------------------


def test_short_text_passes_through():
    s = "촉촉하고 만족해요."
    out = normalize_for_display(s)
    assert out.endswith(".")
    assert len(out) <= DEFAULT_MAX_LEN


def test_max_len_is_enforced():
    s = "가" * 400
    out = normalize_for_display(s, max_len=100)
    assert len(out) <= 100


def test_truncation_appends_ellipsis_or_terminator():
    s = (
        "이 패드는 정말 좋습니다. 촉촉하고 만족스러우며 가성비도 뛰어나요. "
        "특히 대용량이라 매일매일 꺼내 쓰기 좋고 피부에 자극도 없어서 "
        "친구들에게도 적극 추천하고 있습니다."
    )
    out = normalize_for_display(s, max_len=60)
    # Either ends with a sentence terminator or with the ellipsis
    # marker. Crucially, NOT mid-word.
    assert out.endswith((".", "!", "?", "…", "~", "ㅎㅎ", "ㅋㅋ"))


# -----------------------------------------------------------------------------
# Mid-word / mid-grapheme protection — the canonical run-010 case.
# -----------------------------------------------------------------------------


def test_run010_packaging_does_not_end_with_dangling_dat():
    # Original raw span: ends mid-word at "닫" (should be "닫혀요").
    s = (
        "패드 크기도 크고 면도 피부에 자극이 가거나 하지않아서 좋았는데 "
        "안에 토너액이 넉넉하게 들어있는건 아니기도 하고 뚜껑이 대충눌러서는 "
        "완벽하게 닫"
    )
    out = normalize_for_display(s, max_len=120)
    # Must not end with the dangling syllable. Either snaps to an
    # earlier sentence boundary or trims the partial word.
    assert not out.endswith("닫")


def test_run010_persistence_does_not_end_with_partial_clause():
    s = (
        "도톰한데 빨리 마르는느낌이 있음- 밀착력도 아쉬움 리뉴되고 픽업집게??는"
    )
    out = normalize_for_display(s, max_len=120)
    # Heuristic: should not end with bare topic particle "는" hanging
    # off "픽업집게??". Either snap to "있음-" or "아쉬움" earlier.
    # We can't assert exact form, but verify the output doesn't end
    # in a question mark sequence followed by a particle.
    assert not out.endswith("는")


def test_leading_ellipsis_is_stripped():
    s = "…해서 재구매했어요! 정말 좋아요"
    out = normalize_for_display(s, max_len=120)
    assert not out.startswith("…")
    assert not out.startswith(".")


def test_leading_orphan_punctuation_stripped():
    s = ",,,, 패드가 부드러워요"
    out = normalize_for_display(s, max_len=120)
    assert out.startswith("패")


def test_whitespace_collapse():
    s = "촉촉하고      만족\n\n해요"
    out = normalize_for_display(s, max_len=120)
    assert "  " not in out
    assert "\n" not in out


# -----------------------------------------------------------------------------
# Idempotence.
# -----------------------------------------------------------------------------


def test_idempotent():
    s = (
        "이 패드는 정말 좋습니다. 촉촉하고 만족스러우며 가성비도 뛰어나요. "
        "특히 대용량이라 매일매일 꺼내 쓰기 좋고 피부에 자극도 없어서 좋아요."
    )
    once = normalize_for_display(s, max_len=120)
    twice = normalize_for_display(once, max_len=120)
    assert once == twice


# -----------------------------------------------------------------------------
# Boundary conditions.
# -----------------------------------------------------------------------------


def test_empty_returns_empty():
    assert normalize_for_display("") == ""
    assert normalize_for_display("   ") == ""
    assert normalize_for_display(None) == ""  # type: ignore[arg-type]


def test_single_sentence_with_terminator_unchanged():
    s = "정말 만족합니다."
    out = normalize_for_display(s, max_len=120)
    assert out == "정말 만족합니다."


def test_soft_terminator_tilde():
    s = "촉촉해요~ 다음에 또 살게요"
    out = normalize_for_display(s, max_len=120)
    # Should retain or snap meaningfully; doesn't crash.
    assert out
    assert "촉촉" in out


# -----------------------------------------------------------------------------
# Raw text invariant — the function does NOT mutate or own the
# raw span. Display normalization is a separate string that an
# adapter places alongside the raw text.
# -----------------------------------------------------------------------------


def test_function_does_not_mutate_input():
    s = "원본 텍스트입니다."
    _ = normalize_for_display(s, max_len=10)
    # Python strings are immutable — this is a smoke test that the
    # caller's reference is not aliased to internal state.
    assert s == "원본 텍스트입니다."


# -----------------------------------------------------------------------------
# Run-010 regression cases — the canonical bug list from the report.
# Before the complete-form fix, every one of these dropped a sentiment-
# bearing tail or ended mid-stem. After the fix, the display either
# preserves the full clean ending or signals truncation with "…".
# -----------------------------------------------------------------------------


def test_run010_keeps_polite_ending_yo():
    # Bug: "밀착시켜줘서 좋아요" → "밀착시켜줘서" (drops 좋아요).
    out = normalize_for_display("밀착시켜줘서 좋아요")
    assert out == "밀착시켜줘서 좋아요"


def test_run010_keeps_polite_ending_yo_short():
    out = normalize_for_display("생각보다 괜찮아요")
    assert out == "생각보다 괜찮아요"


def test_run010_keeps_formal_ending_nida():
    out = normalize_for_display("촉촉하게 밀착되고, 자극 없이 편안하게 사용할 수 있었습니다")
    assert out.endswith("있었습니다")


def test_run010_keeps_informal_dang_ending():
    out = normalize_for_display(
        "재구매 할 정도로 좋아용 붙이기 편하고 수분감도 많아서 촉촉합니당"
    )
    assert out.endswith("촉촉합니당")


def test_run010_keeps_informal_yong_ending():
    out = normalize_for_display("진짜 촉촉하게 화장 잘돼요 무조건 사세용")
    assert out.endswith("사세용")


def test_run010_dangling_stem_gets_ellipsis():
    # Bug: "편하고 ... 너무 좋" → "...너무" (silent drop).
    # Fix: trim the dangling 좋 stem AND signal truncation.
    out = normalize_for_display("편하고 촉촉하고 건조함을 수분으로 채울 수 있어 너무 좋")
    assert out.endswith("…")
    assert "너무" in out
    assert not out.endswith("좋")


def test_run010_short_dangling_emits_ellipsis():
    out = normalize_for_display("갓성비라 매")
    assert out == "갓성비라…"


def test_run010_polite_after_question_marks_kept():
    # ".. ?건조한 느낌?이에요" — 이에요 must survive.
    out = normalize_for_display("수분 날라간 느낌?건조한 느낌?이에요")
    assert out.endswith("이에요")


def test_run010_polite_after_negative_kept():
    out = normalize_for_display("모공에 큰 효과는 못 봤어요")
    assert out.endswith("봤어요")


def test_run010_ip_nida_kept():
    out = normalize_for_display("맘편히 매일 사용중 입니다")
    assert out.endswith("입니다")


def test_run010_haeyo_kept():
    out = normalize_for_display("휴대용 케이스가 있어 들고 다니기 편해요")
    assert out.endswith("편해요")


# -----------------------------------------------------------------------------
# No directive sentiment-bearing endings should be lost. Spot-check a
# handful from the user-supplied 'do not truncate before' list.
# -----------------------------------------------------------------------------


def test_does_not_truncate_before_johayo():
    out = normalize_for_display("정말 만족하고 좋아요")
    assert out.endswith("좋아요")


def test_does_not_truncate_before_aswiwoyo():
    out = normalize_for_display("기대했는데 약간 아쉬워요")
    assert out.endswith("아쉬워요")


def test_does_not_truncate_before_bulpyeonhaeyo():
    out = normalize_for_display("디자인은 마음에 드는데 사용은 불편해요")
    assert out.endswith("불편해요")


def test_does_not_truncate_before_keunjeokim():
    # 끈적임 is a nominalization — ㅁ-final ending. Must be preserved.
    out = normalize_for_display("바른 직후 살짝 끈적임")
    assert out.endswith("끈적임")


def test_does_not_truncate_before_chokchokham():
    out = normalize_for_display("바르고 나면 한참 촉촉함")
    assert out.endswith("촉촉함")


def test_does_not_truncate_before_bissayo():
    out = normalize_for_display("성능은 좋은데 살짝 비싸요")
    assert out.endswith("비싸요")


def test_does_not_truncate_before_moreugesseoyo():
    out = normalize_for_display("효과는 솔직히 잘 모르겠어요")
    assert out.endswith("모르겠어요")


# -----------------------------------------------------------------------------
# Polarity-anchor contradiction lock (run-003 QA finding).
#
# Bug: when polarity was negative but the matched anchor keyword
# carried a positive-coded phrase template (밀착, 흡수, 진정, 촉촉,
# 부드러), the synthesizer emitted contradictory phrases like
# "밀착이 잘 된다는 아쉬움 의견". The fix gives each polarity-flexible
# keyword separate {positive, negative, default} phrases AND adds a
# contradiction fallback gate that drops any synthesized phrase whose
# directional lean disagrees with the requested polarity.
# -----------------------------------------------------------------------------


def test_synth_negative_does_not_emit_positive_anchor_for_milchak():
    out = synthesize_phrase_display("밀착력은 아쉽고", polarity="negative_weak")
    assert "잘 된다는" not in out
    # Either the matched anchor's negative phrase or a fallback to
    # the cleaned span is acceptable.
    assert (
        "밀착" in out and "아쉽" in out
    ) or "밀착 관련" in out or out == "밀착력은…"


def test_synth_positive_does_not_emit_negative_anchor_for_milchak():
    out = synthesize_phrase_display("밀착이 잘 됨", polarity="positive")
    assert "아쉽다는" not in out


def test_synth_negative_does_not_emit_positive_anchor_for_jinjeong():
    out = synthesize_phrase_display("진정 효과 별로", polarity="negative_weak")
    assert "효과가 좋다는" not in out
    assert "잘 된다는" not in out


def test_synth_negative_does_not_emit_positive_anchor_for_chokchok():
    out = synthesize_phrase_display(
        "촉촉하지 않다는 의견이 들어 살짝 아쉬",
        polarity="negative_weak",
    )
    assert "잘 된다는" not in out
    assert "효과가 좋다는" not in out


def test_synth_negative_does_not_emit_positive_anchor_for_heupsu():
    out = synthesize_phrase_display(
        "흡수 진짜 별로",
        polarity="negative_weak",
    )
    assert "잘 된다는" not in out


def test_synth_positive_picks_positive_phrase_for_milchak():
    out = synthesize_phrase_display(
        "밀착감이 좋다는 디기 만족짱짱",
        polarity="positive",
    )
    # Either the polarity-aware phrase fires, or the cleaned span is
    # already readable enough that no synth happens. The lock is on
    # NEGATIVE markers being absent.
    assert "아쉽다는" not in out
    assert "부담된다는" not in out


def test_synth_positive_picks_positive_phrase_for_heupsu():
    out = synthesize_phrase_display(
        "흡수 진짜 잘 됨",
        polarity="positive",
    )
    assert "아쉽다는" not in out


def test_synth_negative_for_polarity_loaded_keywords_uses_default():
    """Polarity-loaded keywords (비추 / 별로 / 아쉬 / 비싸) only carry
    a `default` phrase — the keyword itself encodes direction. The
    synthesizer must use the default for both polarity hints without
    introducing a contradiction."""
    out_neg = synthesize_phrase_display("비추입", polarity="negative_weak")
    # Run-003 QA pass-5: quote-surface policy locks single-suffix
    # output across the cardnews + PDF synthesizers. The polarity-
    # loaded keyword 비추 already encodes negative sentiment so the
    # trailing "아쉬움 의견" duplication is suppressed.
    assert out_neg == "비추라는 의견"


def test_synth_raw_text_field_argument_is_never_mutated():
    """The function returns a NEW string and never mutates its input.
    Python strings are immutable so this is a smoke check that the
    caller's reference is unchanged after the call."""
    raw = "밀착력은 아쉽고"
    _ = synthesize_phrase_display(raw, polarity="negative_weak")
    assert raw == "밀착력은 아쉽고"


def test_synth_falls_back_to_cleaned_when_only_positive_phrase_available():
    """If the table somehow only has a positive phrase but the caller
    asks for negative, the contradiction gate must fall back to the
    cleaned raw — never ship a positive-leaning phrase under a
    negative claim."""
    # Use a keyword that ONLY has a default and force a fragmented
    # input. Verify the negative-claim path never produces a
    # positive-leaning phrase.
    raw = "두장 같이 쓰는데 별로"
    out = synthesize_phrase_display(raw, polarity="negative_weak")
    # 별로 keyword fires before 두장 in the iteration order, and 별로's
    # default is "별로라는" — semantically negative. Lock that the
    # output does not contain a positive phrase.
    assert "잘 된다는" not in out
    assert "효과가 좋다는" not in out
