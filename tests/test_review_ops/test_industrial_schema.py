"""IndustrialReview schema + fingerprint-alias reuse."""

from __future__ import annotations

from src.voc.ingestion.normalizer import (
    _compute_content_fingerprint,
    compute_content_fingerprint,
)
from src.voc.review_ops.industrial.schema import IndustrialReview


def test_industrial_review_minimal_construction():
    r = IndustrialReview(
        review_id="abc123",
        channel="네이버",
        text="사이즈가 안맞아요",
        content_fingerprint="f" * 64,
    )
    assert r.rating is None
    assert r.has_reply is False
    assert r.is_duplicate is False
    assert r.language == "unknown"


def test_public_fingerprint_alias_matches_private():
    text = "박스가 터져서 왔어요"
    assert compute_content_fingerprint(text) == _compute_content_fingerprint(text)


def test_fingerprint_is_stable_and_case_insensitive():
    assert compute_content_fingerprint("Cable Tray") == compute_content_fingerprint("cable tray")
    assert compute_content_fingerprint("같은 글") == compute_content_fingerprint("  같은   글  ")
