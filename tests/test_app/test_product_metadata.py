"""Tests for src/voc/app/product_metadata.py — pipeline-start product
metadata collection (source detection, identifier extraction, image
caching, sidecar emission).

These tests cover the boundary behaviors the v2.4.2 image policy
guarantees:
  * Source detection by URL host
  * OY goodsNo / Coupang product-id extraction from URL paths
  * Sidecar JSON written to <run>/shared/product_metadata.json
  * Image cache lands under <run>/assets/ (and only there)
  * Image extraction failures degrade silently — metadata fields = None
  * Coupang CSV-row image extraction wires through

Network-dependent paths (live HTTP fetch of OY detail pages) are stubbed
via monkeypatch so the tests stay offline + deterministic.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.voc.app.product_metadata import (
    collect_product_metadata,
    detect_source,
    extract_source_identifier,
    read_product_metadata,
)


# ---------------------------------------------------------------------------
# Source detection
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("url, expected", [
    ("https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A123",
     "oliveyoung"),
    ("https://oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A456",
     "oliveyoung"),
    ("https://m.oliveyoung.co.kr/m/goods/getGoodsDetail.do?goodsNo=A789",
     "oliveyoung"),
    ("https://www.coupang.com/vp/products/123456789?vendorItemId=987654321",
     "coupang"),
    ("https://link.coupang.com/abcdef", "coupang"),
    ("https://www.example.com/p/123", "unknown"),
    ("", "unknown"),
    (None, "unknown"),
])
def test_detect_source(url, expected) -> None:
    assert detect_source(url) == expected


# ---------------------------------------------------------------------------
# Identifier extraction
# ---------------------------------------------------------------------------


def test_extract_oy_goods_no() -> None:
    url = (
        "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
        "?goodsNo=A000000220203&dispCatNo=900000100100008"
    )
    assert extract_source_identifier(url) == "A000000220203"


def test_extract_oy_goods_no_lowercase_param() -> None:
    """Defensive — operators sometimes paste with lowercase `goodsno=`."""
    url = (
        "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
        "?goodsno=B000000999999"
    )
    assert extract_source_identifier(url) == "B000000999999"


def test_extract_coupang_vendor_item_id_preferred() -> None:
    """When both productId and vendorItemId are present, vendorItemId
    wins (Coupang's review API uses vendorItemId as the canonical
    identifier — productId is a coarser grouping)."""
    url = (
        "https://www.coupang.com/vp/products/12345"
        "?vendorItemId=987654321"
    )
    assert extract_source_identifier(url) == "987654321"


def test_extract_coupang_product_id_fallback() -> None:
    url = "https://www.coupang.com/vp/products/77777"
    assert extract_source_identifier(url) == "77777"


def test_extract_unknown_returns_none() -> None:
    assert extract_source_identifier("https://example.com/p/1") is None
    assert extract_source_identifier("") is None
    assert extract_source_identifier(None) is None


# ---------------------------------------------------------------------------
# collect_product_metadata — happy path (OY, image stubbed)
# ---------------------------------------------------------------------------


@pytest.fixture
def isolated_run_dir(tmp_path: Path) -> Path:
    """A fresh `<run>/` dir for each test — assets / shared subdirs
    are created lazily by the module under test."""
    run = tmp_path / "run"
    run.mkdir()
    return run


def test_collect_metadata_oy_happy_path(
    isolated_run_dir: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """OY URL with successful image extraction + cache should:
      * detect source as oliveyoung
      * extract goodsNo
      * cache the image under <run>/assets/
      * write a sidecar JSON under <run>/shared/
    """
    # Stub the OY URL extractor to return a fake URL.
    import src.voc.app.product_metadata as pm_mod
    monkeypatch.setattr(
        pm_mod,
        "_extract_oy_image_url",
        lambda **kw: ("https://cdn.example.com/p.jpg", "oliveyoung"),
    )
    # Stub the asset cache to write a file directly without HTTP.
    def _stub_cache(*, url: str, run_dir: Path, slug: str, source, **kw):
        from src.voc.content.product_image_fetcher import sanitize_slug
        target = run_dir / "assets" / f"{sanitize_slug(slug)}.jpg"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"\xff\xd8\xff\xe0fake")
        return {
            "url": url,
            "local_path": target.relative_to(run_dir).as_posix(),
            "source": source,
            "byte_size": target.stat().st_size,
            "content_type": "image/jpeg",
            "is_known_image_type": True,
            "fetched_at": "2026-05-03T10:00:00Z",
        }
    monkeypatch.setattr(
        "src.voc.content.product_image_fetcher.fetch_and_cache_product_image",
        _stub_cache,
    )

    out = collect_product_metadata(
        product_url=(
            "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
            "?goodsNo=A000000220203"
        ),
        run_dir=isolated_run_dir,
        goods_no="A000000220203",
        product_name_raw="메디힐 더마 패드",
    )

    assert out["source"] == "oliveyoung"
    assert out["source_id"] == "A000000220203"
    assert out["product_image_url"] == "https://cdn.example.com/p.jpg"
    assert out["product_image_source"] == "oliveyoung"
    assert out["product_image_local_path"] == "assets/A000000220203.jpg"
    # Image actually exists at the recorded path
    assert (isolated_run_dir / out["product_image_local_path"]).is_file()
    # Sidecar exists with the same content
    sidecar = isolated_run_dir / "shared" / "product_metadata.json"
    assert sidecar.is_file()
    parsed = json.loads(sidecar.read_text(encoding="utf-8"))
    assert parsed["product_image_local_path"] == "assets/A000000220203.jpg"


def test_collect_metadata_writes_image_only_under_assets_dir(
    isolated_run_dir: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Path-safety contract — even with a slug containing traversal,
    the cached file lands under <run>/assets/, never above it."""
    import src.voc.app.product_metadata as pm_mod
    monkeypatch.setattr(
        pm_mod,
        "_extract_oy_image_url",
        lambda **kw: ("https://cdn.example.com/x.jpg", "oliveyoung"),
    )
    out = collect_product_metadata(
        product_url=(
            "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
            "?goodsNo=../../etc/passwd"
        ),
        run_dir=isolated_run_dir,
        goods_no="../../etc/passwd",
    )
    if out["product_image_local_path"]:
        cached = isolated_run_dir / out["product_image_local_path"]
        assert cached.is_file()
        # Resolved path must be UNDER the assets dir
        assert cached.resolve().parent == (isolated_run_dir / "assets").resolve()


# ---------------------------------------------------------------------------
# collect_product_metadata — failure paths
# ---------------------------------------------------------------------------


def test_collect_metadata_image_extract_failure_does_not_block(
    isolated_run_dir: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When image URL extraction returns None (no image found), the
    metadata dict is still emitted with image fields = None and the
    sidecar is still written. The function never raises."""
    import src.voc.app.product_metadata as pm_mod
    monkeypatch.setattr(
        pm_mod, "_extract_oy_image_url",
        lambda **kw: (None, None),
    )
    out = collect_product_metadata(
        product_url=(
            "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
            "?goodsNo=A_NO_IMAGE"
        ),
        run_dir=isolated_run_dir,
        goods_no="A_NO_IMAGE",
    )
    assert out["product_image_url"] is None
    assert out["product_image_local_path"] is None
    # v2.4.3 — explicit "none" sentinel so the sidecar reads as
    # "tried but found nothing" rather than ambiguous null.
    assert out["product_image_source"] == "none"
    # No file in assets/ (or assets/ may not exist)
    assets = isolated_run_dir / "assets"
    if assets.exists():
        assert list(assets.iterdir()) == []
    # But sidecar IS written
    assert (isolated_run_dir / "shared" / "product_metadata.json").is_file()


def test_collect_metadata_extractor_raises_does_not_block(
    isolated_run_dir: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Even if the extractor itself raises (e.g. a logic bug), the
    pipeline should not abort."""
    import src.voc.app.product_metadata as pm_mod

    def _boom(**_kw):
        raise RuntimeError("unexpected extractor crash")
    monkeypatch.setattr(pm_mod, "_extract_oy_image_url", _boom)

    out = collect_product_metadata(
        product_url=(
            "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
            "?goodsNo=A_BOOM"
        ),
        run_dir=isolated_run_dir,
        goods_no="A_BOOM",
    )
    assert out["product_image_url"] is None
    assert out["product_image_local_path"] is None


def test_collect_metadata_cache_failure_keeps_url(
    isolated_run_dir: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When extraction succeeds but the cache step fails, metadata
    keeps the URL but local_path stays None."""
    import src.voc.app.product_metadata as pm_mod
    monkeypatch.setattr(
        pm_mod,
        "_extract_oy_image_url",
        lambda **kw: ("https://cdn.example.com/x.jpg", "oliveyoung"),
    )
    monkeypatch.setattr(
        "src.voc.content.product_image_fetcher.fetch_and_cache_product_image",
        lambda **kw: None,  # simulated cache failure
    )
    out = collect_product_metadata(
        product_url=(
            "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
            "?goodsNo=A_CACHE_FAIL"
        ),
        run_dir=isolated_run_dir,
        goods_no="A_CACHE_FAIL",
    )
    assert out["product_image_url"] == "https://cdn.example.com/x.jpg"
    assert out["product_image_local_path"] is None
    # Source label is still recorded — operators see "we tried OY"
    assert out["product_image_source"] == "oliveyoung"


# ---------------------------------------------------------------------------
# Coupang CSV path
# ---------------------------------------------------------------------------


def test_collect_metadata_coupang_with_csv_rows(
    isolated_run_dir: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Coupang URL + CSV rows containing image_url → image is cached
    and source is recorded as 'coupang'."""
    def _stub_cache(*, url, run_dir, slug, source, **kw):
        from src.voc.content.product_image_fetcher import sanitize_slug
        target = run_dir / "assets" / f"{sanitize_slug(slug)}.jpg"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"\xff\xd8\xff\xe0fake")
        return {
            "url": url,
            "local_path": target.relative_to(run_dir).as_posix(),
            "source": source,
            "byte_size": target.stat().st_size,
            "content_type": "image/jpeg",
            "is_known_image_type": True,
            "fetched_at": "2026-05-03T10:00:00Z",
        }
    monkeypatch.setattr(
        "src.voc.content.product_image_fetcher.fetch_and_cache_product_image",
        _stub_cache,
    )
    out = collect_product_metadata(
        product_url="https://www.coupang.com/vp/products/12345?vendorItemId=987654321",
        run_dir=isolated_run_dir,
        csv_rows=[
            {"review_content": "...", "image_url": "https://image.coupang.com/p.jpg"},
        ],
    )
    assert out["source"] == "coupang"
    assert out["source_id"] == "987654321"
    assert out["product_image_url"] == "https://image.coupang.com/p.jpg"
    # v2.4.3 — explicit per-channel source label.
    assert out["product_image_source"] == "coupang_csv"
    assert out["product_image_local_path"]


def test_collect_metadata_coupang_without_csv_rows_returns_none(
    isolated_run_dir: Path,
) -> None:
    """No csv_rows → no image (the Coupang adapter has no other source
    in this codebase). Metadata still emitted with image=None."""
    out = collect_product_metadata(
        product_url="https://www.coupang.com/vp/products/12345",
        run_dir=isolated_run_dir,
        csv_rows=None,
    )
    assert out["source"] == "coupang"
    assert out["product_image_url"] is None
    assert out["product_image_local_path"] is None


# ---------------------------------------------------------------------------
# read_product_metadata
# ---------------------------------------------------------------------------


def test_read_product_metadata_returns_dict_when_present(
    isolated_run_dir: Path,
) -> None:
    shared = isolated_run_dir / "shared"
    shared.mkdir()
    payload = {"product_url": "https://example.com", "source": "manual"}
    (shared / "product_metadata.json").write_text(
        json.dumps(payload), encoding="utf-8",
    )
    assert read_product_metadata(isolated_run_dir) == payload


def test_read_product_metadata_returns_none_when_absent(
    isolated_run_dir: Path,
) -> None:
    assert read_product_metadata(isolated_run_dir) is None


# ---------------------------------------------------------------------------
# write_sidecar=False — opt-out for tests / one-off runs
# ---------------------------------------------------------------------------


def test_collect_metadata_with_write_sidecar_false(
    isolated_run_dir: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    import src.voc.app.product_metadata as pm_mod
    monkeypatch.setattr(
        pm_mod, "_extract_oy_image_url", lambda **kw: (None, None),
    )
    out = collect_product_metadata(
        product_url=(
            "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
            "?goodsNo=A_NO_SIDECAR"
        ),
        run_dir=isolated_run_dir,
        goods_no="A_NO_SIDECAR",
        write_sidecar=False,
    )
    assert isinstance(out, dict)
    assert not (isolated_run_dir / "shared" / "product_metadata.json").exists()


# ---------------------------------------------------------------------------
# v2.4.3 — image_url_hint (warm-session capture)
# ---------------------------------------------------------------------------


def test_image_url_hint_skips_extractor(
    isolated_run_dir: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When `image_url_hint` is set, the extractor MUST NOT be called.
    The hint comes from the OY connector's warm Playwright session
    capture; calling the extractor would either re-do the work or
    issue a fresh HTTP fetch the user explicitly wants to avoid."""
    import src.voc.app.product_metadata as pm_mod

    def _fail_extractor(**_kw):
        raise AssertionError(
            "extractor was called despite image_url_hint being set"
        )
    monkeypatch.setattr(pm_mod, "_extract_oy_image_url", _fail_extractor)
    monkeypatch.setattr(pm_mod, "_extract_coupang_image_url", _fail_extractor)

    # Stub the cache so we don't hit the network.
    def _stub_cache(*, url, run_dir, slug, source, **kw):
        from src.voc.content.product_image_fetcher import sanitize_slug
        target = run_dir / "assets" / f"{sanitize_slug(slug)}.jpg"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"fake")
        return {
            "url": url,
            "local_path": target.relative_to(run_dir).as_posix(),
            "source": source,
            "byte_size": target.stat().st_size,
            "content_type": "image/jpeg",
            "is_known_image_type": True,
            "fetched_at": "2026-05-03T12:00:00Z",
        }
    monkeypatch.setattr(
        "src.voc.content.product_image_fetcher.fetch_and_cache_product_image",
        _stub_cache,
    )

    out = collect_product_metadata(
        product_url=(
            "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
            "?goodsNo=A_HINT"
        ),
        run_dir=isolated_run_dir,
        goods_no="A_HINT",
        image_url_hint="https://image.example.com/warm.jpg",
        image_source_hint="oliveyoung_detail_page_playwright",
    )
    assert out["product_image_url"] == "https://image.example.com/warm.jpg"
    assert out["product_image_source"] == "oliveyoung_detail_page_playwright"
    assert out["product_image_local_path"]


def test_image_url_hint_cache_failure_keeps_url(
    isolated_run_dir: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Hint is set but cache fails → URL/source recorded, local_path
    stays None. Pipeline continues."""
    import src.voc.app.product_metadata as pm_mod
    monkeypatch.setattr(
        pm_mod, "_extract_oy_image_url",
        lambda **kw: pytest.fail("extractor must not run"),
    )
    monkeypatch.setattr(
        "src.voc.content.product_image_fetcher.fetch_and_cache_product_image",
        lambda **kw: None,
    )
    out = collect_product_metadata(
        product_url=(
            "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
            "?goodsNo=A_HINT_FAIL"
        ),
        run_dir=isolated_run_dir,
        goods_no="A_HINT_FAIL",
        image_url_hint="https://image.example.com/x.jpg",
        image_source_hint="oliveyoung_detail_page_playwright",
    )
    assert out["product_image_url"] == "https://image.example.com/x.jpg"
    assert out["product_image_source"] == "oliveyoung_detail_page_playwright"
    assert out["product_image_local_path"] is None


def test_oy_extractor_returns_explicit_source_labels(
    isolated_run_dir: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """v2.4.3 — the OY extractor distinguishes between the playwright
    path and the HTTP fallback path via separate source labels."""
    from src.voc.app.product_metadata import _extract_oy_image_url

    # Path A: playwright session matches → playwright label.
    class _FakePage:
        def goto(self, *_a, **_kw): return None
        def content(self): return (
            '<meta property="og:image" content="https://cdn.example.com/p.jpg">'
        )
    url, label = _extract_oy_image_url(
        goods_no="A_PW", playwright_page=_FakePage(),
    )
    assert url == "https://cdn.example.com/p.jpg"
    assert label == "oliveyoung_detail_page_playwright"

    # Path B: no playwright, HTTP extractor matches → http label.
    monkeypatch.setattr(
        "src.voc.connectors.product_image_extractor.extract_oy_product_image_url",
        lambda goods_no, **kw: "https://cdn.example.com/http.jpg",
    )
    url2, label2 = _extract_oy_image_url(goods_no="A_HTTP")
    assert url2 == "https://cdn.example.com/http.jpg"
    assert label2 == "oliveyoung_detail_page_http"


def test_no_image_records_none_source_label(
    isolated_run_dir: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """v2.4.3 — when no extraction matches, the sidecar records
    `product_image_source = "none"` so operators can audit at a glance
    that the pipeline tried-but-found-nothing (vs not-attempted)."""
    import src.voc.app.product_metadata as pm_mod
    monkeypatch.setattr(
        pm_mod, "_extract_oy_image_url", lambda **kw: (None, None),
    )
    out = collect_product_metadata(
        product_url=(
            "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
            "?goodsNo=A_NONE"
        ),
        run_dir=isolated_run_dir,
        goods_no="A_NONE",
    )
    assert out["product_image_url"] is None
    assert out["product_image_source"] == "none"
    assert out["product_image_local_path"] is None


def test_coupang_extractor_returns_csv_label(
    isolated_run_dir: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """v2.4.3 — Coupang adapter records `coupang_csv` as the source
    label when the CSV row carries a usable image URL."""
    def _stub_cache(*, url, run_dir, slug, source, **kw):
        from src.voc.content.product_image_fetcher import sanitize_slug
        target = run_dir / "assets" / f"{sanitize_slug(slug)}.jpg"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"fake")
        return {
            "url": url, "local_path": target.relative_to(run_dir).as_posix(),
            "source": source, "byte_size": target.stat().st_size,
            "content_type": "image/jpeg", "is_known_image_type": True,
            "fetched_at": "2026-05-03T12:00:00Z",
        }
    monkeypatch.setattr(
        "src.voc.content.product_image_fetcher.fetch_and_cache_product_image",
        _stub_cache,
    )
    out = collect_product_metadata(
        product_url="https://www.coupang.com/vp/products/123?vendorItemId=456",
        run_dir=isolated_run_dir,
        csv_rows=[{"image_url": "https://image.coupang.com/p.jpg"}],
    )
    assert out["product_image_source"] == "coupang_csv"
