"""Pass-19F: lip_makeup profile-aware quote summary tests.

The hince and muzigae lip-makeup runs surfaced the bug this pass
fixes: report-facing display_quote_summary cells fell through to
the generic last-resort label ("발색 관련 만족 의견" / "발림성 관련
만족 의견") because the lip_makeup fallback table only carried 4
attributes. Pass-19F extends the table to 9 attributes with
operator-locked wording, plus separate `negative_weak` entries for
pigmentation / dryness_skin_texture / persistence.

Test surface (per user spec §D):
  1. lip_makeup + pigmentation + positive → spec wording
  2. lip_makeup + application_blending + positive → not generic
  3. lip_makeup + dryness_skin_texture + negative → 입술/각질/주름
  4. lip_makeup + persistence + negative_weak → 식사/시간 경과
  5. report-facing generic detector accepts new lip summaries
  6. old generic phrases still flagged
  7. hince/muzigae representative fixture produces 0 generic summaries
"""
from __future__ import annotations

import pytest

from src.voc.content.quote_summary_normalizer import (
    attribute_specific_summary,
    is_degraded_quote_summary,
    looks_too_generic,
    normalize_display_quote_summary,
)


# ---------- Test 1: pigmentation positive --------------------------------


class TestPigmentation:
    def test_positive_uses_spec_wording(self):
        out = attribute_specific_summary(
            profile_id="lip_makeup",
            attribute_key="pigmentation",
            polarity="positive",
        )
        assert out == "색이 선명하게 올라오고 얼굴빛을 살린다는 의견"

    def test_negative_uses_spec_wording(self):
        out = attribute_specific_summary(
            profile_id="lip_makeup",
            attribute_key="pigmentation",
            polarity="negative",
        )
        assert out == "기대 색상과 다르거나 발색이 약하다는 의견"

    def test_negative_weak_uses_dedicated_wording(self):
        # negative_weak has a distinct, more nuanced phrasing.
        out = attribute_specific_summary(
            profile_id="lip_makeup",
            attribute_key="pigmentation",
            polarity="negative_weak",
        )
        assert out == (
            "처음 발색은 괜찮지만 시간이 지나며 색감 만족도가 낮아진다는 의견"
        )


# ---------- Test 2: application_blending positive ------------------------


class TestApplicationBlending:
    def test_positive_uses_spec_wording_not_generic(self):
        out = attribute_specific_summary(
            profile_id="lip_makeup",
            attribute_key="application_blending",
            polarity="positive",
        )
        assert out == "부드럽게 발리고 입술에 편하게 밀착된다는 의견"
        # Direct guarantee: this is not the banned generic phrase.
        assert out != "발림성 관련 만족 의견"
        # And it doesn't trip the inspector's generic detector.
        assert not looks_too_generic(out)
        assert not is_degraded_quote_summary(out)

    def test_negative_uses_spec_wording(self):
        out = attribute_specific_summary(
            profile_id="lip_makeup",
            attribute_key="application_blending",
            polarity="negative",
        )
        assert out == "뭉침, 얼룩짐, 경계 남음을 아쉬워하는 의견"
        assert not is_degraded_quote_summary(out)


# ---------- Test 3: dryness_skin_texture negative includes lip context ---


class TestDrynessSkinTexture:
    def test_negative_includes_lip_context(self):
        out = attribute_specific_summary(
            profile_id="lip_makeup",
            attribute_key="dryness_skin_texture",
            polarity="negative",
        )
        # Spec demands lip-anchored vocabulary (입술 / 각질 / 주름).
        assert "입술" in out or "각질" in out or "주름" in out
        assert out == "입술이 마르거나 각질·주름이 부각된다는 의견"
        # And NOT the banned generic.
        assert out != "건조함이 덜하다는 의견"
        assert not is_degraded_quote_summary(out)

    def test_negative_weak_includes_time_context(self):
        out = attribute_specific_summary(
            profile_id="lip_makeup",
            attribute_key="dryness_skin_texture",
            polarity="negative_weak",
        )
        assert "시간이 지나며" in out
        assert out == "초반은 편하지만 시간이 지나며 건조함이 느껴진다는 의견"


# ---------- Test 4: persistence negative_weak with meal/time context ----


class TestPersistence:
    def test_negative_weak_includes_meal_or_time_context(self):
        out = attribute_specific_summary(
            profile_id="lip_makeup",
            attribute_key="persistence",
            polarity="negative_weak",
        )
        # Spec demands meal-or-time context (식사 / 시간이 지난 뒤).
        assert "식사" in out or "시간이 지난 뒤" in out
        assert out == "식사나 시간이 지난 뒤 색 유지가 아쉽다는 의견"
        assert not is_degraded_quote_summary(out)

    def test_negative_uses_spec_wording_not_generic(self):
        out = attribute_specific_summary(
            profile_id="lip_makeup",
            attribute_key="persistence",
            polarity="negative",
        )
        assert out == "색이 금방 지워지거나 지속력이 기대보다 짧다는 의견"
        assert out != "지속감이 짧다는 의견"
        assert not looks_too_generic(out)


# ---------- Test 5: generic detector accepts new lip summaries ----------


class TestGenericDetectorAcceptsNewLipSummaries:
    @pytest.mark.parametrize("text", [
        "색이 선명하게 올라오고 얼굴빛을 살린다는 의견",
        "기대 색상과 다르거나 발색이 약하다는 의견",
        "처음 발색은 괜찮지만 시간이 지나며 색감 만족도가 낮아진다는 의견",
        "부드럽게 발리고 입술에 편하게 밀착된다는 의견",
        "뭉침, 얼룩짐, 경계 남음을 아쉬워하는 의견",
        "건조함이나 각질 부각이 덜하다는 의견",
        "입술이 마르거나 각질·주름이 부각된다는 의견",
        "초반은 편하지만 시간이 지나며 건조함이 느껴진다는 의견",
        "색이 오래 남고 착색 유지력이 좋다는 의견",
        "색이 금방 지워지거나 지속력이 기대보다 짧다는 의견",
        "식사나 시간이 지난 뒤 색 유지가 아쉽다는 의견",
        "컵이나 마스크 묻어남이 적다는 의견",
        "컵, 마스크, 치아에 묻어남을 아쉬워하는 의견",
        "끈적임이 적고 마무리감이 편하다는 의견",
        "끈적임, 답답함, 무거운 사용감을 아쉬워하는 의견",
        "향이나 맛이 부담스럽지 않다는 의견",
        "향이나 맛이 강하게 느껴진다는 의견",
        "패키지 디자인과 휴대성을 만족 포인트로 언급",
        "용기 사용감이나 누수, 포장 상태를 아쉬워하는 의견",
        "가격 대비 컬러와 사용감 만족도가 높다는 의견",
        "가격 대비 용량이나 지속력 기대에 못 미친다는 의견",
    ])
    def test_lip_makeup_summary_not_flagged_generic(self, text):
        assert not looks_too_generic(text), f"unexpectedly generic: {text!r}"
        assert not is_degraded_quote_summary(text), (
            f"summary unexpectedly degraded: {text!r}"
        )


# ---------- Test 6: banned phrases STILL flagged generic -----------------


class TestOldGenericPhrasesStillFlagged:
    @pytest.mark.parametrize("text", [
        "발색 관련 만족 의견",
        "발색 관련 아쉬움 의견",
        "발림성 관련 만족 의견",
        "건조함이 덜하다는 의견",
        "지속감이 짧다는 의견",
    ])
    def test_old_phrase_flagged(self, text):
        # The user explicitly listed these as banned; the generic
        # detector must continue catching them so they never sneak
        # back into a future report.
        assert is_degraded_quote_summary(text), (
            f"old generic phrase unexpectedly clean: {text!r}"
        )


# ---------- Test 7: hince / muzigae representative fixture ---------------


class TestHinceMuzigaeFixtureNoGeneric:
    """Reproduces the hince+muzigae warning pattern. The user reported
    15 generic summaries on hince and 12 on muzigae — every one of
    them maps to one of the lip_makeup attributes in the spec table.

    With pass-19F's extended fallback, calling the resolver on every
    (attr, polarity) combination must yield ZERO generic outputs.
    """

    LIP_ATTRS_AND_POLARITIES = [
        ("pigmentation", "positive"),
        ("pigmentation", "negative"),
        ("pigmentation", "negative_weak"),
        ("application_blending", "positive"),
        ("application_blending", "negative"),
        ("dryness_skin_texture", "positive"),
        ("dryness_skin_texture", "negative"),
        ("dryness_skin_texture", "negative_weak"),
        ("persistence", "positive"),
        ("persistence", "negative"),
        ("persistence", "negative_weak"),
        ("transfer_resistance", "positive"),
        ("transfer_resistance", "negative"),
        ("finish_texture", "positive"),
        ("finish_texture", "negative"),
        ("scent_taste", "positive"),
        ("scent_taste", "negative"),
        ("packaging_container", "positive"),
        ("packaging_container", "negative"),
        ("value_price", "positive"),
        ("value_price", "negative"),
    ]

    def test_no_generic_summary_for_any_lip_attribute(self):
        bad: list[str] = []
        for attr, polarity in self.LIP_ATTRS_AND_POLARITIES:
            out = attribute_specific_summary(
                profile_id="lip_makeup",
                attribute_key=attr,
                polarity=polarity,
            )
            assert out is not None, (
                f"missing fallback for ({attr}, {polarity})"
            )
            if is_degraded_quote_summary(out):
                bad.append(f"({attr}, {polarity}) → {out!r}")
        assert not bad, f"degraded summaries: {bad}"

    def test_normalize_display_routes_lip_attrs_to_clean_summary(self):
        # End-to-end through normalize_display_quote_summary, which
        # is what the adapter calls. Every lip attribute should
        # resolve to a clean (non-degraded) fallback.
        for attr, polarity in self.LIP_ATTRS_AND_POLARITIES:
            out = normalize_display_quote_summary(
                None,  # raw_summary degraded / missing
                attribute_key=attr,
                polarity=polarity,
                profile_id="lip_makeup",
            )
            assert isinstance(out, str) and out.strip()
            assert not is_degraded_quote_summary(out), (
                f"lip_makeup ({attr}, {polarity}) → degraded: {out!r}"
            )

    def test_negative_weak_falls_back_to_negative_when_unset(self):
        # transfer_resistance has no negative_weak entry → falls back
        # to negative. This must still produce a clean, non-generic
        # summary (the resolver fallback chain is tested directly
        # here so future attribute additions don't accidentally
        # downgrade to last-resort).
        out = attribute_specific_summary(
            profile_id="lip_makeup",
            attribute_key="transfer_resistance",
            polarity="negative_weak",
        )
        assert out == "컵, 마스크, 치아에 묻어남을 아쉬워하는 의견"
        assert not is_degraded_quote_summary(out)


# ---------- Bonus: section-B implicit coverage ---------------------------


class TestDanglingDisplayTextNoLongerBlocks:
    """User §B: when display_quote_summary is clean, the inspector
    must NOT count display_text dangling as blocking. With pass-19F's
    9-attribute table, every lip attribute now produces a clean
    summary, so a dangling display_text on a lip_makeup quote is
    automatically downgraded from blocking to audit-only by the
    existing inspector logic at scripts/inspect_run_quality.py:457.

    This test confirms the upstream guarantee: every lip_makeup
    fallback summary survives is_degraded_quote_summary, which is
    the exact predicate the inspector uses to decide audit-vs-block.
    """

    def test_lip_summary_passes_inspector_predicate(self):
        # The inspector calls `is_degraded_quote_summary(summary)` —
        # if it returns False, the dangling display_text is
        # audit-only (no warning fires).
        for attr in ("pigmentation", "application_blending",
                      "dryness_skin_texture", "persistence",
                      "transfer_resistance", "finish_texture"):
            for polarity in ("positive", "negative"):
                summary = attribute_specific_summary(
                    profile_id="lip_makeup",
                    attribute_key=attr,
                    polarity=polarity,
                )
                assert summary is not None
                assert not is_degraded_quote_summary(summary)
