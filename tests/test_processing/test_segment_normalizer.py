"""Tests for DictionarySegmentNormalizer + LLMSegmentNormalizer stub."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pytest

from src.voc.processing.segment_normalizer import (
    AGE_GROUP_TAXONOMY,
    SKIN_TYPE_TAXONOMY,
    DictionarySegmentNormalizer,
    LLMSegmentNormalizer,
    _preclean_oliveyoung_option,
    _split_first_token,
)


@pytest.fixture
def dictionary_file(tmp_path) -> Path:
    path = tmp_path / "oy.json"
    path.write_text(json.dumps({
        "products": {
            "oy_lipstick_aaa_001": {
                "options": {
                    "베어그레이프": {"color_family": "purple", "shade": "berry-gray"},
                    "로지피치": {"color_family": "pink", "shade": "rose-peach"},
                },
            },
            "oy_serum_bbb_002": {
                "options": {
                    "30ml": {"size": "30ml", "capacity": "30ml"},
                },
            },
        },
    }, ensure_ascii=False), encoding="utf-8")
    return path


@pytest.fixture
def normalizer(dictionary_file):
    return DictionarySegmentNormalizer(dictionary_file)


# ---------- skin_type ----------

class TestSkinType:
    @pytest.mark.parametrize("raw,expected", [
        ("건성", "dry"),
        ("중성", "normal"),
        ("복합성", "combination"),
        ("지성", "oily"),
        ("민감성", "sensitive"),
        ("트러블성", "sensitive"),
    ])
    def test_canonical_buckets(self, normalizer, raw, expected):
        assert normalizer.normalize_skin_type(raw).bucket == expected

    def test_unknown_label_returns_unknown_with_warning(self, normalizer, caplog):
        with caplog.at_level(logging.WARNING):
            result = normalizer.normalize_skin_type("외계인")
        assert result.bucket == "unknown"
        assert any("Unmapped skin_type" in r.message for r in caplog.records)

    def test_none_returns_unknown(self, normalizer):
        assert normalizer.normalize_skin_type(None).bucket == "unknown"

    def test_empty_string_returns_unknown(self, normalizer):
        assert normalizer.normalize_skin_type("").bucket == "unknown"
        assert normalizer.normalize_skin_type("   ").bucket == "unknown"

    def test_mixed_value_with_dot_separator_uses_first_token(self, normalizer, caplog):
        with caplog.at_level(logging.WARNING):
            result = normalizer.normalize_skin_type("건성·복합성")
        assert result.bucket == "dry"
        assert any("Mixed skin_type label" in r.message for r in caplog.records)

    def test_mixed_value_with_slash_uses_first_token(self, normalizer):
        assert normalizer.normalize_skin_type("건성/지성").bucket == "dry"

    def test_mixed_value_with_comma_uses_first_token(self, normalizer):
        assert normalizer.normalize_skin_type("건성, 지성").bucket == "dry"


# ---------- age_group ----------

class TestAgeGroup:
    @pytest.mark.parametrize("raw,expected", [
        ("10대", "under_20"),
        ("20대 초반", "20s"),
        ("20대 후반", "20s"),
        ("20대", "20s"),
        ("30대 초반", "30s"),
        ("30대 후반", "30s"),
        ("30대", "30s"),
        ("40대", "40_plus"),
        ("50대 이상", "40_plus"),
    ])
    def test_canonical_buckets(self, normalizer, raw, expected):
        assert normalizer.normalize_age_group(raw).bucket == expected

    def test_unknown_returns_unknown(self, normalizer):
        assert normalizer.normalize_age_group("백세").bucket == "unknown"

    def test_none_returns_unknown(self, normalizer):
        assert normalizer.normalize_age_group(None).bucket == "unknown"

    def test_space_in_label_is_not_a_separator(self, normalizer):
        # "20대 초반" contains a space but maps directly to "20s"; must NOT be
        # split as "20대" → "20s" and then lose information.
        assert normalizer.normalize_age_group("20대 초반").bucket == "20s"

    def test_mixed_label_uses_first_token(self, normalizer, caplog):
        with caplog.at_level(logging.WARNING):
            result = normalizer.normalize_age_group("20대 후반/30대 초반")
        assert result.bucket == "20s"


# ---------- product_option ----------

class TestProductOption:
    def test_known_product_known_option_resolved(self, normalizer):
        opt = normalizer.normalize_product_option(
            "oliveyoung", "베어그레이프", "oy_lipstick_aaa_001"
        )
        assert opt is not None
        assert opt.color_family == "purple"
        assert opt.shade == "berry-gray"

    def test_known_product_unknown_option_returns_none_with_warning(
        self, normalizer, caplog
    ):
        with caplog.at_level(logging.WARNING):
            opt = normalizer.normalize_product_option(
                "oliveyoung", "외계색", "oy_lipstick_aaa_001"
            )
        assert opt is None
        assert any("Unmapped product option" in r.message for r in caplog.records)

    def test_unknown_product_returns_none(self, normalizer):
        opt = normalizer.normalize_product_option(
            "oliveyoung", "베어그레이프", "no_such_product"
        )
        assert opt is None

    def test_none_raw_returns_none(self, normalizer):
        opt = normalizer.normalize_product_option(
            "oliveyoung", None, "oy_lipstick_aaa_001"
        )
        assert opt is None

    def test_none_product_id_returns_none(self, normalizer):
        opt = normalizer.normalize_product_option(
            "oliveyoung", "베어그레이프", None
        )
        assert opt is None

    def test_size_only_option(self, normalizer):
        opt = normalizer.normalize_product_option(
            "oliveyoung", "30ml", "oy_serum_bbb_002"
        )
        assert opt is not None
        assert opt.size == "30ml"
        assert opt.color_family is None

    # ---- OY leading-bracket preclean integrated into lookup ----

    def test_oy_preclean_resolves_bracket_prefixed_label(self, normalizer):
        # Dictionary key is the clean variant; the raw label arrives with a
        # promotional prefix. The preclean step must strip the bracket and let
        # the lookup succeed.
        opt = normalizer.normalize_product_option(
            "oliveyoung", "[한정 립 듀이젤 기획] 베어그레이프",
            "oy_lipstick_aaa_001",
        )
        assert opt is not None
        assert opt.color_family == "purple"
        assert opt.shade == "berry-gray"

    def test_oy_preclean_handles_multiple_leading_brackets(self, normalizer):
        opt = normalizer.normalize_product_option(
            "oliveyoung", "[옵션] [립 듀이젤] 베어그레이프",
            "oy_lipstick_aaa_001",
        )
        assert opt is not None
        assert opt.shade == "berry-gray"

    def test_oy_preclean_not_applied_for_non_oliveyoung_channels(self, normalizer):
        # Other channels pass through verbatim — they may legitimately use
        # brackets as part of the option key. Here the fixture has no key
        # matching the bracketed literal, so the lookup misses, proving the
        # preclean short-circuits on channel.
        opt = normalizer.normalize_product_option(
            "coupang", "[한정] 베어그레이프", "oy_lipstick_aaa_001",
        )
        assert opt is None

    def test_oy_preclean_empty_result_silently_returns_none(self, normalizer, caplog):
        # A label that collapses to empty after stripping (e.g., only a promo
        # block) must degrade to None WITHOUT firing the "Unmapped product
        # option" warning — there's nothing to map.
        with caplog.at_level(logging.WARNING):
            opt = normalizer.normalize_product_option(
                "oliveyoung", "[피크닉백 증정]", "oy_lipstick_aaa_001",
            )
        assert opt is None
        assert not any(
            "Unmapped product option" in r.message for r in caplog.records
        )


# ---------- DictionarySegmentNormalizer fallback paths ----------

def test_normalizer_with_missing_dictionary_file_warns(tmp_path, caplog):
    with caplog.at_level(logging.WARNING):
        norm = DictionarySegmentNormalizer(tmp_path / "missing.json")
    assert any("Option dictionary not found" in r.message for r in caplog.records)
    assert norm.normalize_product_option("oliveyoung", "any", "any") is None


def test_normalizer_without_dictionary_path_still_handles_skin_and_age():
    norm = DictionarySegmentNormalizer()
    assert norm.normalize_skin_type("건성").bucket == "dry"
    assert norm.normalize_age_group("20대 후반").bucket == "20s"
    # product_option always None without a dictionary
    assert norm.normalize_product_option("oliveyoung", "any", "any") is None


# ---------- LLMSegmentNormalizer stub ----------

def test_llm_normalizer_skin_type_raises():
    with pytest.raises(NotImplementedError):
        LLMSegmentNormalizer().normalize_skin_type("건성")


def test_llm_normalizer_age_group_raises():
    with pytest.raises(NotImplementedError):
        LLMSegmentNormalizer().normalize_age_group("20대 후반")


def test_llm_normalizer_product_option_raises():
    with pytest.raises(NotImplementedError):
        LLMSegmentNormalizer().normalize_product_option("oliveyoung", "x", "y")


# ---------- module-level taxonomy invariants ----------

def test_skin_type_taxonomy_covers_5_buckets():
    assert set(SKIN_TYPE_TAXONOMY.values()) == {
        "dry", "normal", "combination", "oily", "sensitive"
    }


def test_age_group_taxonomy_covers_4_buckets():
    assert set(AGE_GROUP_TAXONOMY.values()) == {
        "under_20", "20s", "30s", "40_plus"
    }


# ---------- _split_first_token ----------

def test_split_first_token_handles_separators():
    assert _split_first_token("a·b") == "a"
    assert _split_first_token("a/b") == "a"
    assert _split_first_token("a,b") == "a"
    assert _split_first_token("a|b") == "a"


def test_split_first_token_keeps_space_intact():
    assert _split_first_token("a b") == "a b"


def test_split_first_token_strips_whitespace_around_token():
    assert _split_first_token(" a · b ") == "a"


def test_split_first_token_handles_none_and_empty():
    assert _split_first_token(None) is None
    assert _split_first_token("") is None
    assert _split_first_token("   ") is None


# ---------- _preclean_oliveyoung_option ----------

class TestPrecleanOliveYoungOption:
    @pytest.mark.parametrize("raw,expected", [
        # Required-by-spec examples
        ("[미니 블러쉬 증정] 레이지", "레이지"),
        ("[한정 립 듀이젤 기획] 베어리", "베어리"),
        ("[옵션] [립 듀이젤] 베어리", "베어리"),
        ("레이지", "레이지"),
    ])
    def test_required_examples(self, raw, expected):
        assert _preclean_oliveyoung_option(raw) == expected

    def test_bracket_inside_body_is_preserved(self):
        # Anchored regex: only leading `[...]` blocks are stripped. A bracket
        # that follows non-bracket content is part of the variant name.
        assert _preclean_oliveyoung_option("레이지 [색상]") == "레이지 [색상]"

    def test_collapses_repeated_whitespace(self):
        # Observed live: "[미니 하이라이터  증정] 샤이" (double space inside the
        # bracket). Also covers any whitespace between stripped blocks.
        assert _preclean_oliveyoung_option("[미니 하이라이터  증정] 샤이") == "샤이"
        assert _preclean_oliveyoung_option("레이지  색감") == "레이지 색감"

    def test_leading_and_trailing_whitespace_trimmed(self):
        assert _preclean_oliveyoung_option("   레이지   ") == "레이지"
        assert _preclean_oliveyoung_option("   [증정] 레이지   ") == "레이지"

    def test_only_bracket_block_returns_none(self):
        # Nothing left after peeling.
        assert _preclean_oliveyoung_option("[피크닉백 증정]") is None
        assert _preclean_oliveyoung_option("[a] [b]") is None

    def test_pure_whitespace_returns_none(self):
        assert _preclean_oliveyoung_option("") is None
        assert _preclean_oliveyoung_option("   ") is None
        assert _preclean_oliveyoung_option("\t\n") is None

    def test_unbalanced_bracket_is_left_alone(self):
        # Pathological input must not hang or corrupt — the regex simply
        # doesn't match, so the string passes through (trimmed + collapsed).
        assert _preclean_oliveyoung_option("[열려있는 프리픽스 레이지") \
            == "[열려있는 프리픽스 레이지"
        assert _preclean_oliveyoung_option("레이지]") == "레이지]"
