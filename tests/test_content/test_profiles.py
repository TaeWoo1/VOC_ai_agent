"""Tests for the category profile selector."""
from __future__ import annotations

import pytest

from src.voc.content.profiles import (
    KNOWN_PROFILES,
    PROFILE_DEFAULT,
    PROFILE_MAKEUP_BLUSH,
    PROFILE_SKINCARE_PAD,
    SUPPRESSED_ATTRIBUTES_BY_PROFILE,
    select_profile_id,
    suppressed_attributes_for,
)


# ---------------------------------------------------------------------------
# select_profile_id
# ---------------------------------------------------------------------------


class TestSelectProfileId:
    def test_empty_inputs_default(self):
        assert select_profile_id() == PROFILE_DEFAULT

    def test_none_inputs_default(self):
        assert select_profile_id(category_path=None, product_name=None) == PROFILE_DEFAULT

    def test_empty_path_empty_name_default(self):
        assert select_profile_id(category_path=[], product_name="") == PROFILE_DEFAULT

    @pytest.mark.parametrize("kw", ["패드", "토너패드", "더마패드"])
    def test_skincare_pad_via_breadcrumb(self, kw):
        path = ["뷰티", "스킨케어", kw]
        assert select_profile_id(category_path=path) == PROFILE_SKINCARE_PAD

    def test_skincare_pad_via_product_name_only(self):
        assert select_profile_id(
            category_path=None,
            product_name="메디힐 데일리 토너패드",
        ) == PROFILE_SKINCARE_PAD

    def test_skincare_pad_via_short_token_in_name(self):
        assert select_profile_id(product_name="피부 진정 패드 75매") == PROFILE_SKINCARE_PAD

    @pytest.mark.parametrize("kw", ["블러셔", "치크"])
    def test_makeup_blush_via_breadcrumb(self, kw):
        path = ["뷰티", "메이크업", kw]
        assert select_profile_id(category_path=path) == PROFILE_MAKEUP_BLUSH

    def test_makeup_blush_via_product_name_only(self):
        assert select_profile_id(
            product_name="3CE 무드 리시피 페이스 블러셔",
        ) == PROFILE_MAKEUP_BLUSH

    def test_skincare_pad_takes_precedence_over_blush(self):
        # Hypothetical edge case: "패드형 블러셔" — pad wins because
        # the resolution order is pad → blush → default.
        assert select_profile_id(
            product_name="멀티 패드 블러셔",
        ) == PROFILE_SKINCARE_PAD

    def test_unrelated_category_yields_default(self):
        assert select_profile_id(
            category_path=["뷰티", "헤어케어", "샴푸"],
            product_name="모이스처 샴푸",
        ) == PROFILE_DEFAULT

    def test_lipstick_yields_lip_makeup(self):
        # Pass-19G: lipstick is now routed to the dedicated
        # lip_makeup profile (added because hince/muzigae lip-tint
        # runs surfaced 15+ generic display_quote_summary cells when
        # lip products fell through to default and missed pass-19F's
        # extended lip-makeup quote-summary table).
        from src.voc.content.profiles import PROFILE_LIP_MAKEUP
        assert select_profile_id(
            category_path=["뷰티", "메이크업", "립스틱"],
            product_name="립스틱",
        ) == PROFILE_LIP_MAKEUP

    def test_non_string_path_entries_ignored(self):
        # Defensive: a malformed path with a number node should
        # not raise.
        assert select_profile_id(
            category_path=["뷰티", 42, "토너패드"],  # type: ignore[list-item]
        ) == PROFILE_SKINCARE_PAD

    def test_keyword_only_in_one_of_two_inputs_still_matches(self):
        assert select_profile_id(
            category_path=["뷰티", "스킨케어"],
            product_name="센텔라 토너패드",
        ) == PROFILE_SKINCARE_PAD


# ---------------------------------------------------------------------------
# suppressed_attributes_for
# ---------------------------------------------------------------------------


class TestSuppressedAttributesFor:
    def test_default_profile_empty_set(self):
        assert suppressed_attributes_for(PROFILE_DEFAULT) == frozenset()

    def test_skincare_pad_includes_required_keys(self):
        s = suppressed_attributes_for(PROFILE_SKINCARE_PAD)
        # The five attributes the user explicitly listed.
        for key in (
            "pigmentation",
            "color_tone_matching",
            "application_blending",
            "transfer_resistance",
            "multi_use_lip_cheek_compatibility",
        ):
            assert key in s, f"{key!r} should be suppressed for skincare_pad"

    def test_skincare_pad_does_not_suppress_persistence(self):
        # Persistence is *not* makeup-only — pads have it too. Make
        # sure we didn't accidentally over-suppress.
        s = suppressed_attributes_for(PROFILE_SKINCARE_PAD)
        assert "persistence" not in s
        assert "dryness_skin_texture" not in s
        assert "packaging_container" not in s

    def test_makeup_blush_no_suppression(self):
        # Blush profile is a recognition/labeling hint only — the
        # makeup attributes are all relevant for blush, so no
        # suppression set is configured.
        assert suppressed_attributes_for(PROFILE_MAKEUP_BLUSH) == frozenset()

    def test_unknown_profile_falls_back_to_default(self):
        assert suppressed_attributes_for("nonexistent_profile") == frozenset()

    def test_table_has_entries_for_every_known_profile(self):
        for p in KNOWN_PROFILES:
            assert p in SUPPRESSED_ATTRIBUTES_BY_PROFILE
