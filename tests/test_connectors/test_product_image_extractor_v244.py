"""v2.4.4 — extended HTML extractor + per-source diagnostic.

The live OY smoke run on 2026-05-03 returned image=None even though
the operator had a CDP-attached browser running. The diagnostic
extractor exposes per-source counts so operators can see WHICH
fallback path failed (or whether the warm session never reached the
extractor at all).
"""
from __future__ import annotations

from src.voc.connectors.product_image_extractor import (
    extract_image_diagnostic_from_html,
    extract_image_url_from_html,
)


# ---------------------------------------------------------------------------
# Diagnostic shape
# ---------------------------------------------------------------------------


def test_diagnostic_for_empty_html() -> None:
    d = extract_image_diagnostic_from_html("")
    assert d["html_length"] == 0
    assert d["og_count"] == 0
    assert d["jsonld_count"] == 0
    assert d["twitter_count"] == 0
    assert d["link_image_src_count"] == 0
    assert d["oy_thumbnail_img_count"] == 0
    assert d["extracted_image_url"] is None
    assert d["selected_source"] is None


def test_diagnostic_records_og_image_match() -> None:
    html = '<meta property="og:image" content="https://cdn.example.com/p.jpg">'
    d = extract_image_diagnostic_from_html(html)
    assert d["og_count"] == 1
    assert d["selected_source"] == "og_image"
    assert d["extracted_image_url"] == "https://cdn.example.com/p.jpg"


def test_diagnostic_falls_through_to_twitter_when_no_og() -> None:
    html = (
        '<meta name="twitter:image" content="https://cdn.example.com/tw.jpg">'
    )
    d = extract_image_diagnostic_from_html(html)
    assert d["og_count"] == 0
    assert d["twitter_count"] == 1
    assert d["selected_source"] == "twitter_image"
    assert d["extracted_image_url"] == "https://cdn.example.com/tw.jpg"


def test_diagnostic_falls_through_to_link_image_src() -> None:
    html = '<link rel="image_src" href="https://cdn.example.com/lk.jpg">'
    d = extract_image_diagnostic_from_html(html)
    assert d["link_image_src_count"] == 1
    assert d["selected_source"] == "link_image_src"
    assert d["extracted_image_url"] == "https://cdn.example.com/lk.jpg"


# ---------------------------------------------------------------------------
# OY thumbnail img fallback (narrow)
# ---------------------------------------------------------------------------


def test_oy_thumbnail_matches_when_url_contains_goods_no() -> None:
    html = (
        '<img src="https://image.oliveyoung.co.kr/uploads/images/'
        'thumbnails/A000000220203/main.jpg">'
    )
    d = extract_image_diagnostic_from_html(html, goods_no="A000000220203")
    assert d["oy_thumbnail_img_count"] == 1
    assert d["selected_source"] == "oy_thumbnail_img"
    assert "A000000220203" in d["extracted_image_url"]


def test_oy_thumbnail_matches_known_display_path_without_goods_no() -> None:
    """The OY display directory is a known thumbnail container — accept
    even without goodsNo match because product page <img> tags inside
    /uploads/images/display/ are reliably the hero image."""
    html = (
        '<img src="https://image.oliveyoung.co.kr/uploads/images/display/'
        '300/A000000999999_1.jpg">'
    )
    d = extract_image_diagnostic_from_html(html, goods_no=None)
    assert d["selected_source"] == "oy_thumbnail_img"
    assert d["extracted_image_url"].endswith("A000000999999_1.jpg")


def test_oy_thumbnail_rejects_random_image_domain() -> None:
    """The OY-thumbnail fallback must NOT match arbitrary image domains
    (review-photo CDN, banner CDN, etc.)."""
    html = (
        '<img src="https://image.coupang.com/p.jpg">'
        '<img src="https://other-cdn.example.com/banner.png">'
    )
    d = extract_image_diagnostic_from_html(html, goods_no="A000000111111")
    assert d["oy_thumbnail_img_count"] == 0
    assert d["selected_source"] is None
    assert d["extracted_image_url"] is None


def test_oy_thumbnail_rejects_oy_url_without_goods_no_or_known_path() -> None:
    """An OY image URL that's not under a known thumbnail directory and
    doesn't carry the goods_no must be rejected to avoid false positives."""
    html = (
        '<img src="https://image.oliveyoung.co.kr/banner/promo.jpg">'
    )
    d = extract_image_diagnostic_from_html(html, goods_no="A000000111111")
    # The img IS counted by the host scan, but the path filter rejects it.
    assert d["oy_thumbnail_img_count"] == 1
    assert d["selected_source"] is None


# ---------------------------------------------------------------------------
# Priority — og:image still wins when multiple sources are present
# ---------------------------------------------------------------------------


def test_og_image_priority_over_all_fallbacks() -> None:
    html = """
    <meta property="og:image" content="https://cdn.example.com/og.jpg">
    <meta name="twitter:image" content="https://cdn.example.com/tw.jpg">
    <link rel="image_src" href="https://cdn.example.com/lk.jpg">
    <script type="application/ld+json">
    {"@type": "Product", "image": "https://cdn.example.com/ld.jpg"}
    </script>
    """
    d = extract_image_diagnostic_from_html(html)
    assert d["selected_source"] == "og_image"
    assert d["og_count"] == 1
    assert d["twitter_count"] == 1
    assert d["link_image_src_count"] == 1
    assert d["jsonld_count"] == 1
    assert d["extracted_image_url"] == "https://cdn.example.com/og.jpg"


# ---------------------------------------------------------------------------
# extract_image_url_from_html stays backwards-compatible
# ---------------------------------------------------------------------------


def test_extract_image_url_from_html_still_works_without_goods_no() -> None:
    html = '<meta property="og:image" content="https://cdn.example.com/p.jpg">'
    assert extract_image_url_from_html(html) == "https://cdn.example.com/p.jpg"


def test_extract_image_url_from_html_uses_goods_no_for_oy_fallback() -> None:
    html = (
        '<img src="https://image.oliveyoung.co.kr/uploads/images/'
        'thumbnails/A000000220203/main.jpg">'
    )
    # No goods_no → still passes via the known-path heuristic? No — the
    # path is `/uploads/images/thumbnails/`, not the display path. Without
    # goods_no there's no anchor, so the extractor returns None.
    assert extract_image_url_from_html(html) is None
    assert extract_image_url_from_html(
        html, goods_no="A000000220203",
    ) == (
        "https://image.oliveyoung.co.kr/uploads/images/thumbnails/"
        "A000000220203/main.jpg"
    )
