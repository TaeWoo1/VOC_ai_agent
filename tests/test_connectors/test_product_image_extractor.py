"""Tests for the per-channel product image extractor."""
from __future__ import annotations

import pytest

from src.voc.connectors.product_image_extractor import (
    extract_coupang_product_image_url,
    extract_image_url_from_html,
    extract_oy_product_image_url,
)


# ---------------------------------------------------------------------------
# HTML parsing — og:image
# ---------------------------------------------------------------------------


def test_extract_og_image_property_first() -> None:
    html = """
    <html><head>
        <meta property="og:image" content="https://cdn.example.com/p1.jpg">
    </head><body></body></html>
    """
    assert extract_image_url_from_html(html) == "https://cdn.example.com/p1.jpg"


def test_extract_og_image_content_first() -> None:
    """Some servers emit `content` before `property` — the regex must
    tolerate either order."""
    html = (
        '<meta content="https://cdn.example.com/p2.jpg" '
        'property="og:image">'
    )
    assert extract_image_url_from_html(html) == "https://cdn.example.com/p2.jpg"


def test_extract_og_image_returns_first_when_multiple() -> None:
    """Multiple og:image tags → return the first."""
    html = """
    <meta property="og:image" content="https://cdn.example.com/a.jpg">
    <meta property="og:image" content="https://cdn.example.com/b.jpg">
    """
    assert extract_image_url_from_html(html) == "https://cdn.example.com/a.jpg"


# ---------------------------------------------------------------------------
# HTML parsing — JSON-LD Product image
# ---------------------------------------------------------------------------


def test_extract_jsonld_string_image() -> None:
    html = """
    <script type="application/ld+json">
    {"@type": "Product", "image": "https://cdn.example.com/jl1.jpg"}
    </script>
    """
    assert extract_image_url_from_html(html) == "https://cdn.example.com/jl1.jpg"


def test_extract_jsonld_array_image() -> None:
    html = """
    <script type="application/ld+json">
    {"@type": "Product",
     "image": ["https://cdn.example.com/jl2a.jpg", "https://cdn.example.com/jl2b.jpg"]}
    </script>
    """
    assert extract_image_url_from_html(html) == "https://cdn.example.com/jl2a.jpg"


def test_extract_jsonld_imageobject() -> None:
    html = """
    <script type="application/ld+json">
    {"@type": "Product",
     "image": {"@type": "ImageObject", "url": "https://cdn.example.com/jl3.jpg"}}
    </script>
    """
    assert extract_image_url_from_html(html) == "https://cdn.example.com/jl3.jpg"


def test_extract_jsonld_in_graph_wrapper() -> None:
    html = """
    <script type="application/ld+json">
    {"@graph": [
        {"@type": "BreadcrumbList"},
        {"@type": "Product", "image": "https://cdn.example.com/jl4.jpg"}
    ]}
    </script>
    """
    assert extract_image_url_from_html(html) == "https://cdn.example.com/jl4.jpg"


def test_og_image_wins_over_jsonld() -> None:
    """When both og:image and JSON-LD are present, og:image wins
    (priority order: og:image first, JSON-LD fallback)."""
    html = """
    <meta property="og:image" content="https://cdn.example.com/og.jpg">
    <script type="application/ld+json">
    {"@type": "Product", "image": "https://cdn.example.com/ld.jpg"}
    </script>
    """
    assert extract_image_url_from_html(html) == "https://cdn.example.com/og.jpg"


def test_jsonld_with_trailing_comma_tolerated() -> None:
    """Operators sometimes ship JSON-LD with trailing commas (browsers
    tolerate it). The extractor should accept it after a forgiving
    cleanup pass rather than dropping the whole image."""
    html = """
    <script type="application/ld+json">
    {"@type": "Product", "image": "https://cdn.example.com/jl5.jpg",}
    </script>
    """
    assert extract_image_url_from_html(html) == "https://cdn.example.com/jl5.jpg"


# ---------------------------------------------------------------------------
# Empty / malformed input
# ---------------------------------------------------------------------------


def test_empty_html_returns_none() -> None:
    assert extract_image_url_from_html("") is None
    assert extract_image_url_from_html(None) is None  # type: ignore[arg-type]


def test_html_without_image_returns_none() -> None:
    html = "<html><body><h1>Hi</h1></body></html>"
    assert extract_image_url_from_html(html) is None


def test_malformed_jsonld_doesnt_raise() -> None:
    html = """
    <script type="application/ld+json">
    {this is not json}
    </script>
    """
    # No og:image, no parseable JSON-LD → None, NOT a raise.
    assert extract_image_url_from_html(html) is None


# ---------------------------------------------------------------------------
# OY detail-page fetch (no network — error paths only)
# ---------------------------------------------------------------------------


def test_extract_oy_with_empty_goods_no_returns_none() -> None:
    assert extract_oy_product_image_url("") is None
    assert extract_oy_product_image_url(None) is None  # type: ignore[arg-type]


def test_extract_oy_handles_unreachable_host() -> None:
    """A real-time failure (connection refused, timeout) must return
    None, not raise."""
    out = extract_oy_product_image_url(
        "FAKE_GOODS_NO_THAT_DOES_NOT_EXIST_XXXXX",
        timeout_sec=2,
    )
    # Either None (404 / not found) or whatever extract_image_url_from_html
    # finds in OliveYoung's 404 page (None, in practice — they don't ship
    # og:image on error pages). The hard guarantee is "no raise".
    assert out is None or isinstance(out, str)


# ---------------------------------------------------------------------------
# Coupang CSV column extraction
# ---------------------------------------------------------------------------


def test_coupang_extract_picks_first_image_column() -> None:
    rows = [
        {"review_content": "...", "image_url": "https://image.coupang.com/p1.jpg"},
        {"review_content": "...", "image_url": "https://image.coupang.com/p2.jpg"},
    ]
    assert extract_coupang_product_image_url(rows) == (
        "https://image.coupang.com/p1.jpg"
    )


def test_coupang_extract_falls_through_empty_first_row() -> None:
    rows = [
        {"image_url": ""},
        {"image_url": "https://image.coupang.com/p3.jpg"},
    ]
    assert extract_coupang_product_image_url(rows) == (
        "https://image.coupang.com/p3.jpg"
    )


def test_coupang_extract_tries_alternate_column_names() -> None:
    rows = [{"thumbnail_url": "https://image.coupang.com/thumb.jpg"}]
    assert extract_coupang_product_image_url(rows) == (
        "https://image.coupang.com/thumb.jpg"
    )
    rows2 = [{"product_image": "https://image.coupang.com/pi.jpg"}]
    assert extract_coupang_product_image_url(rows2) == (
        "https://image.coupang.com/pi.jpg"
    )


def test_coupang_extract_rejects_non_http_value() -> None:
    """A column with non-HTTP content (e.g. internal SKU id) must not
    be returned as an image URL."""
    rows = [{"image_url": "SKU-12345"}]
    assert extract_coupang_product_image_url(rows) is None


def test_coupang_extract_returns_none_for_empty_rows() -> None:
    assert extract_coupang_product_image_url([]) is None
    assert extract_coupang_product_image_url([{}]) is None
