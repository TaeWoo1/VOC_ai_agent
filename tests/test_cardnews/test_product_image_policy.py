"""Tests for the v2.4 product image policy.

Covers:
  * `product_image_fetcher.fetch_and_cache_product_image` — writes only
    under `<run>/assets/`, refuses paths outside, fail-soft on bad URL.
  * Cardnews layout — wires `analysis_report.product.image_local_path`
    into the cover page record's `product_image.local_path` and sets
    `usage="cover_cutout"` when a local path is present.
  * Cardnews layout — falls back to the no-image cover when neither
    `image_local_path` nor `image_url` is set.
  * Renderer `_resolve_product_image` — prefers a present local_path
    over URL fetching; falls through to the gradient when the local
    file is missing on disk.
  * Backfill CLI `_copy_local_image` — refuses to write outside
    `<run>/assets/`.

These tests do NOT exercise live HTTP — they validate the boundary
behaviors that the policy guarantees. The fetch utility's HTTP path
is exercised against a stub via `responses` is OUT of scope here;
the behavior we care about is the path-safety + failure-passthrough.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from cardnews.render import (
    ResolvedImage,
    _resolve_local_path,
    _resolve_product_image,
)
from src.voc.content.cardnews_long_layout import build_long_cardnews_layout
from src.voc.content.product_image_fetcher import (
    fetch_and_cache_product_image,
    sanitize_slug,
)


# ---------------------------------------------------------------------------
# Fetcher — boundary behaviors (no network)
# ---------------------------------------------------------------------------


def test_fetcher_returns_none_for_non_http_url(tmp_path: Path) -> None:
    out = fetch_and_cache_product_image(
        url="ftp://example.com/x.jpg",
        run_dir=tmp_path,
        slug="x",
    )
    assert out is None
    # No file should be written when the URL is rejected.
    assert not (tmp_path / "assets").exists() or not list(
        (tmp_path / "assets").iterdir()
    )


def test_fetcher_returns_none_for_empty_url(tmp_path: Path) -> None:
    assert fetch_and_cache_product_image(
        url=None, run_dir=tmp_path, slug="x",
    ) is None
    assert fetch_and_cache_product_image(
        url="", run_dir=tmp_path, slug="x",
    ) is None


def test_sanitize_slug_strips_unsafe_chars() -> None:
    # Spaces, slashes, dots → underscores; preserved Korean + digits.
    assert sanitize_slug("Mediheal Pad / 200매") == "Mediheal_Pad_200매"
    assert sanitize_slug("/etc/passwd") == "etc_passwd"
    assert sanitize_slug("") == "product"
    # Truncates long slugs.
    long = "a" * 200
    assert len(sanitize_slug(long)) == 48


def test_fetcher_real_http_failure_is_soft(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A real-time failure (timeout / connection refused) must not raise.

    We redirect to a guaranteed-non-routable host so requests fails
    cleanly. The function must return None and leave the assets dir
    free of partial writes."""
    out = fetch_and_cache_product_image(
        url="http://127.0.0.1:1/never_listening.jpg",
        run_dir=tmp_path,
        slug="x",
    )
    assert out is None
    # Either no assets dir, or empty.
    assets = tmp_path / "assets"
    if assets.exists():
        assert list(assets.iterdir()) == [], (
            "fetcher must not leave partial files when fetch fails"
        )


# ---------------------------------------------------------------------------
# Layout — image_local_path threading
# ---------------------------------------------------------------------------


def _minimal_report_with_image(local_path: str | None) -> dict:
    """A minimal valid analysis_report for layout build, with optional
    image_local_path on the product block."""
    report: dict = {
        "schema_version": "3.0",
        "product": {
            "slug": "test-product",
            "name_ko": "테스트 제품",
            "category": "테스트",
            "source_url": "https://example.com/p/123",
        },
        "corpus": {
            "n_reviews_total": 200,
            "primary_sort": "DATETIME_DESC",
            "confidence_level": "medium",
        },
        "attributes": [
            {"key": "a", "label_ko": "사용감",
             "n_positive": 60, "n_negative": 8},
        ],
    }
    if local_path is not None:
        report["product"]["image_local_path"] = local_path
        report["product"]["image_source"] = "oliveyoung"
        report["product"]["image_url"] = "https://example.com/img.jpg"
    return report


def test_layout_threads_image_local_path_to_cover_page() -> None:
    report = _minimal_report_with_image("assets/test-product.jpg")
    layout = build_long_cardnews_layout(report)
    cover = next(p for p in layout["pages"] if p["type"] == "cover")
    pi = cover.get("product_image") or {}
    assert pi.get("local_path") == "assets/test-product.jpg"
    assert pi.get("usage") == "cover_cutout"
    assert pi.get("source") == "oliveyoung"


def test_layout_uses_full_bleed_when_no_image() -> None:
    """No image at all → the cover keeps its no-image gradient,
    `usage` is `cover_full_bleed` so the template falls through to the
    text-only treatment."""
    report = _minimal_report_with_image(None)
    layout = build_long_cardnews_layout(report)
    cover = next(p for p in layout["pages"] if p["type"] == "cover")
    pi = cover.get("product_image") or {}
    assert pi.get("local_path") is None
    assert pi.get("usage") == "cover_full_bleed"


def test_layout_url_only_still_records_cutout_usage() -> None:
    """When only `image_url` is set (no pre-fetched local), the layout
    still tags `cover_cutout` so the renderer's URL-fetch path can
    surface the image. Falls back to gradient at render time if the
    URL fetch fails."""
    report = _minimal_report_with_image(None)
    report["product"]["image_url"] = "https://example.com/x.jpg"
    layout = build_long_cardnews_layout(report)
    cover = next(p for p in layout["pages"] if p["type"] == "cover")
    pi = cover.get("product_image") or {}
    assert pi.get("url") == "https://example.com/x.jpg"
    assert pi.get("usage") == "cover_cutout"


# ---------------------------------------------------------------------------
# Renderer — local-path resolution + fail-soft on missing
# ---------------------------------------------------------------------------


def test_resolve_local_path_finds_existing_run_relative(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    assets = run_dir / "assets"
    assets.mkdir(parents=True)
    img = assets / "test.jpg"
    img.write_bytes(b"\xff\xd8\xff\xe0fake")

    resolved = _resolve_local_path(
        raw_path="assets/test.jpg",
        candidate_roots=[run_dir],
    )
    assert resolved is not None
    assert resolved == img


def test_resolve_local_path_returns_none_for_missing_file(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    resolved = _resolve_local_path(
        raw_path="assets/never-saved.jpg",
        candidate_roots=[run_dir],
    )
    assert resolved is None


def test_resolve_product_image_prefers_local_over_url(tmp_path: Path) -> None:
    run_dir = tmp_path / "run"
    assets = run_dir / "assets"
    assets.mkdir(parents=True)
    img = assets / "x.jpg"
    img.write_bytes(b"fake")

    work_dir = tmp_path / "work"
    work_dir.mkdir()

    resolved = _resolve_product_image(
        cli_path=None,
        cli_url=None,
        report_local_path="assets/x.jpg",
        report_url="https://example.com/x.jpg",
        report_local_root=[run_dir],
        work_dir=work_dir,
        layout_usage="cover_cutout",
    )
    assert resolved.source == "analysis_report_local"
    assert resolved.local_path == str(img.resolve())
    assert resolved.usage == "cover_cutout"


def test_resolve_product_image_falls_back_to_gradient_on_missing_local(
    tmp_path: Path,
) -> None:
    """When the local_path is set but the file is missing on disk and
    no URL is available, the resolver falls through to the gradient
    fallback. The rendered cover is still valid (text-only)."""
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    work_dir = tmp_path / "work"
    work_dir.mkdir()

    resolved = _resolve_product_image(
        cli_path=None,
        cli_url=None,
        report_local_path="assets/never-saved.jpg",
        report_url=None,
        report_local_root=[run_dir],
        work_dir=work_dir,
        layout_usage="cover_cutout",
    )
    assert resolved.source == "fallback_gradient"
    assert resolved.local_path is None
    assert resolved.usage == "cover_full_bleed"


# ---------------------------------------------------------------------------
# Backfill CLI — assets-dir write boundary
# ---------------------------------------------------------------------------


def test_backfill_copy_writes_only_under_assets(tmp_path: Path) -> None:
    """`_copy_local_image` must refuse to write outside `<run>/assets/`."""
    from scripts.backfill_product_image import _copy_local_image

    run_dir = tmp_path / "run"
    run_dir.mkdir()
    src = tmp_path / "src.jpg"
    src.write_bytes(b"\xff\xd8\xff\xe0fake")

    meta = _copy_local_image(
        src=src,
        run_dir=run_dir,
        slug="my-product",
        source="manual",
    )
    assert meta["local_path"].startswith("assets/")
    target = run_dir / meta["local_path"]
    assert target.is_file()
    assert target.parent == run_dir / "assets"
    # Sidecar lives next to the image
    sidecar = run_dir / "assets" / "my-product_meta.json"
    assert sidecar.is_file()
    parsed = json.loads(sidecar.read_text(encoding="utf-8"))
    assert parsed["source"] == "manual"
    assert parsed["copied_from"] == str(src.resolve())


def test_backfill_copy_rejects_unsafe_slug_traversal(tmp_path: Path) -> None:
    """A slug like `../../etc/passwd` must NOT escape the run's assets
    dir. `sanitize_slug` collapses `/` to `_` so this happens at the
    slug normalization step."""
    from scripts.backfill_product_image import _copy_local_image

    run_dir = tmp_path / "run"
    run_dir.mkdir()
    src = tmp_path / "src.jpg"
    src.write_bytes(b"fake")

    meta = _copy_local_image(
        src=src,
        run_dir=run_dir,
        slug="../../etc/passwd",
        source="manual",
    )
    target = run_dir / meta["local_path"]
    # The traversal must be sanitized away — target is under <run>/assets/
    assert target.parent == run_dir / "assets"
    assert ".." not in target.as_posix()


# ---------------------------------------------------------------------------
# End-to-end: layout → renderer round-trip with image present
# ---------------------------------------------------------------------------


def test_renderer_does_not_break_on_missing_local_path(tmp_path: Path) -> None:
    """A layout that points at a non-existent local image must still
    produce a valid cover page record (renderer's chain returns the
    gradient ResolvedImage). This is the fail-soft contract: missing
    image NEVER aborts a render."""
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    work_dir = tmp_path / "work"
    work_dir.mkdir()

    resolved = _resolve_product_image(
        cli_path=None,
        cli_url=None,
        report_local_path="assets/missing.jpg",
        report_url=None,
        report_local_root=[run_dir],
        work_dir=work_dir,
        layout_usage="cover_cutout",
    )
    assert isinstance(resolved, ResolvedImage)
    # Either a successful resolve (local file exists) or the gradient
    # fallback. Never a raise.


# ---------------------------------------------------------------------------
# v2.4.1 — renderer default = no live URL fetches
# ---------------------------------------------------------------------------


def test_renderer_default_does_not_fetch_url(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Default `allow_live_fetch=False` → URLs are not fetched.

    We poison `_try_fetch_image` so any call to it would fail the test,
    proving the renderer never reaches the URL-fetch branch in default
    mode."""
    from cardnews import render as render_module

    def _boom(*_a, **_kw):
        raise AssertionError(
            "renderer fetched a URL despite allow_live_fetch=False"
        )

    monkeypatch.setattr(render_module, "_try_fetch_image", _boom)

    work_dir = tmp_path / "work"
    work_dir.mkdir()
    resolved = _resolve_product_image(
        cli_path=None,
        cli_url=None,
        report_local_path=None,
        report_url="https://cdn.example.com/never_fetched.jpg",
        report_local_root=[],
        work_dir=work_dir,
        layout_usage="cover_cutout",
        allow_live_fetch=False,
    )
    assert resolved.source == "fallback_gradient"
    assert resolved.local_path is None
    assert resolved.usage == "cover_full_bleed"


def test_renderer_with_allow_live_fetches_url(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`allow_live_fetch=True` → renderer calls `_try_fetch_image` for
    URL sources. We stub the fetch to return a real on-disk file so we
    can assert the chain reached that branch and produced a resolved
    image with the expected source label."""
    from cardnews import render as render_module

    work_dir = tmp_path / "work"
    work_dir.mkdir()
    fake_image = tmp_path / "fake.jpg"
    fake_image.write_bytes(b"\xff\xd8\xff\xe0fake")

    calls: list[str] = []

    def _stub_fetch(url: str, _wd: Path):
        calls.append(url)
        return fake_image

    monkeypatch.setattr(render_module, "_try_fetch_image", _stub_fetch)

    resolved = _resolve_product_image(
        cli_path=None,
        cli_url=None,
        report_local_path=None,
        report_url="https://cdn.example.com/p.jpg",
        report_local_root=[],
        work_dir=work_dir,
        layout_usage="cover_cutout",
        allow_live_fetch=True,
    )
    assert calls == ["https://cdn.example.com/p.jpg"]
    assert resolved.source == "analysis_report"
    assert resolved.local_path == str(fake_image)


def test_renderer_default_skips_cli_url_too(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Default-off applies to both `cli_url` and `report_url` — CLI
    can no longer ad-hoc fetch a URL without `--allow-live-image-fetch`."""
    from cardnews import render as render_module

    def _boom(*_a, **_kw):
        raise AssertionError(
            "renderer fetched cli_url despite allow_live_fetch=False"
        )
    monkeypatch.setattr(render_module, "_try_fetch_image", _boom)

    work_dir = tmp_path / "work"
    work_dir.mkdir()
    resolved = _resolve_product_image(
        cli_path=None,
        cli_url="https://cdn.example.com/operator.jpg",
        report_local_path=None,
        report_url=None,
        report_local_root=[],
        work_dir=work_dir,
        layout_usage="cover_cutout",
        allow_live_fetch=False,
    )
    assert resolved.source == "fallback_gradient"


# ---------------------------------------------------------------------------
# Republish CLI — image collection failure does NOT abort the run
# ---------------------------------------------------------------------------


def test_republish_image_collection_failure_does_not_abort(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`_collect_product_image_if_missing` must NEVER raise out — even
    when both the URL extractor and the fetcher fail. The function
    returns the report unchanged so the rest of republish proceeds."""
    from scripts.republish_run import _collect_product_image_if_missing

    run_dir = tmp_path / "run"
    run_dir.mkdir()

    # Neither image_url nor image_local_path; source_url is OY format
    # so the OY detail-page extractor would be called.
    report = {
        "product": {
            "slug": "ax",
            "name_ko": "test",
            "source_url": "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000FAKE",
        },
    }

    # Make the OY extractor return None (no image found).
    import src.voc.connectors.product_image_extractor as ext_mod
    monkeypatch.setattr(
        ext_mod, "extract_oy_product_image_url",
        lambda *a, **kw: None,
    )

    out = _collect_product_image_if_missing(
        run_dir=run_dir,
        analysis_report=report,
    )
    # The function returned a dict (no raise) and product fields are
    # left blank because nothing succeeded.
    assert isinstance(out, dict)
    assert out["product"].get("image_local_path") is None
    assert out["product"].get("image_url") is None

