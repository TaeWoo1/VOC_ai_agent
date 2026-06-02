"""Tests for PR1 semantic rules: channel registration, text floor, rating clamp."""

from __future__ import annotations

import logging
from datetime import datetime

import pytest

from src.voc.ingestion.normalizer import (
    CHANNEL_DOMAIN_MAP,
    CHANNEL_RATING_SCALES,
    TEXT_LENGTH_FLOOR,
    _normalize_rating,
    normalize,
)
from src.voc.schemas.raw import RawReview


def test_coupang_in_domain_map():
    assert CHANNEL_DOMAIN_MAP["coupang"] == "coupang.com"


def test_oliveyoung_in_domain_map():
    assert CHANNEL_DOMAIN_MAP["oliveyoung"] == "oliveyoung.co.kr"


def test_coupang_rating_scale_registered():
    assert CHANNEL_RATING_SCALES["coupang"] == (1, 5)


def test_oliveyoung_rating_scale_registered():
    assert CHANNEL_RATING_SCALES["oliveyoung"] == (1, 5)


def test_normalize_rating_coupang_returns_075_for_four():
    assert _normalize_rating(4, "coupang") == 0.75


def test_normalize_rating_oliveyoung_returns_075_for_four():
    assert _normalize_rating(4, "oliveyoung") == 0.75


def test_normalize_rating_in_range_emits_no_warning(caplog):
    with caplog.at_level(logging.WARNING, logger="src.voc.ingestion.normalizer"):
        result = _normalize_rating(5, "coupang")
    assert result == 1.0
    assert not any("clamping" in r.message for r in caplog.records)


def test_normalize_rating_above_range_clamps_to_one_with_warning(caplog):
    with caplog.at_level(logging.WARNING, logger="src.voc.ingestion.normalizer"):
        result = _normalize_rating(6, "coupang")
    assert result == 1.0
    assert any("clamping" in r.message for r in caplog.records)


def test_normalize_rating_below_range_clamps_to_zero_with_warning(caplog):
    with caplog.at_level(logging.WARNING, logger="src.voc.ingestion.normalizer"):
        result = _normalize_rating(0, "coupang")
    assert result == 0.0
    assert any("clamping" in r.message for r in caplog.records)


def test_normalize_rating_unknown_channel_returns_none():
    assert _normalize_rating(4, "unknown_channel") is None


def test_normalize_rating_none_input_returns_none():
    assert _normalize_rating(None, "coupang") is None


# ------------------------------------------------------------------
# Text length floor
# ------------------------------------------------------------------

def _make_raw(text: str, channel: str = "csv") -> RawReview:
    return RawReview(
        source_channel=channel,
        raw_text=text,
        collected_at=datetime(2026, 1, 1),
        keyword_used="test",
    )


def test_text_length_floor_constant_is_ten():
    assert TEXT_LENGTH_FLOOR == 10


def test_text_floor_rejects_single_char():
    with pytest.raises(ValueError, match="below 10-char floor"):
        normalize(_make_raw("굿"))


def test_text_floor_rejects_nine_char_latin():
    with pytest.raises(ValueError, match="below 10-char floor"):
        normalize(_make_raw("abcdefghi"))  # 9 chars


def test_text_floor_accepts_exact_ten_chars():
    canonical = normalize(_make_raw("abcdefghij"))  # 10 chars — at floor, accepted
    assert canonical.text == "abcdefghij"


def test_text_floor_applies_after_whitespace_collapse():
    # raw has leading/trailing + collapsible internal whitespace; cleaned text = 6 chars "좋아요 정말"
    with pytest.raises(ValueError, match="below 10-char floor"):
        normalize(_make_raw("   좋아요    정말   "))


def test_empty_string_still_raises_original_error():
    with pytest.raises(ValueError, match="empty or whitespace-only"):
        normalize(_make_raw(""))


def test_whitespace_only_still_raises_original_error():
    with pytest.raises(ValueError, match="empty or whitespace-only"):
        normalize(_make_raw("   "))
