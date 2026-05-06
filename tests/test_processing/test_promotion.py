"""Tests for the promotion-strip helper."""

from __future__ import annotations

from src.voc.processing.promotion import strip_promoted_keys


def test_strip_drops_named_keys():
    raw = {"a": 1, "b": 2, "c": 3}
    result = strip_promoted_keys(raw, {"a", "c"})
    assert result == {"b": 2}


def test_strip_leaves_other_keys_alone():
    raw = {"a": 1, "b": 2}
    result = strip_promoted_keys(raw, {"a"})
    assert result == {"b": 2}


def test_strip_idempotent_on_missing_keys():
    raw = {"a": 1, "b": 2}
    result = strip_promoted_keys(raw, {"x", "y", "z"})
    assert result == {"a": 1, "b": 2}


def test_strip_does_not_mutate_input():
    raw = {"a": 1, "b": 2}
    strip_promoted_keys(raw, {"a"})
    assert raw == {"a": 1, "b": 2}


def test_strip_with_empty_promoted_set_returns_copy():
    raw = {"a": 1, "b": 2}
    result = strip_promoted_keys(raw, set())
    assert result == {"a": 1, "b": 2}
    # confirm it's a new dict, not the same reference
    assert result is not raw


def test_strip_with_empty_metadata():
    assert strip_promoted_keys({}, {"a", "b"}) == {}


def test_strip_partial_overlap():
    raw = {"verified_purchase": True, "review_title": "굿", "product_index": "12345"}
    promoted = {"verified_purchase", "review_title"}
    assert strip_promoted_keys(raw, promoted) == {"product_index": "12345"}
