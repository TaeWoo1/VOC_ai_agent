"""Offline tests for the Coupang detail-snapshot spike (S2x.1, capture-only).

No network, no browser, no OpenAI. Live capture (Playwright) is NOT exercised
here; only URL validation, pure HTML parsing, the artifact writer, the
injectable image-download seam, lazy-import discipline, and isolation are
tested.
"""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import pytest

from src.voc.review_ops.industrial.detail_snapshot import capture as cap
from src.voc.review_ops.industrial.detail_snapshot import parse as ps

FIXTURE = (
    Path(__file__).parent.parent
    / "fixtures" / "review_ops" / "detail_snapshot" / "coupang_sample.html"
)


def _fixture_html() -> str:
    return FIXTURE.read_text(encoding="utf-8")


# --- URL validation ----------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "https://www.coupang.com/vp/products/123456789?itemId=1&vendorItemId=2",
        "https://m.coupang.com/vm/products/123456789",
        "http://coupang.com/vp/products/987",
    ],
)
def test_valid_product_urls_accepted(url):
    ok, reason = ps.validate_coupang_product_url(url)
    assert ok is True, reason
    assert ps.is_valid_coupang_product_url(url) is True


@pytest.mark.parametrize(
    "url",
    [
        "https://www.coupang.com/np/search?q=전선몰딩",   # search
        "https://www.coupang.com/np/categories/12345",    # category
        "https://www.example.com/vp/products/1",          # foreign host
        "https://www.coupang.com.evil.com/vp/products/1",  # look-alike host
        "ftp://www.coupang.com/vp/products/1",            # bad scheme
        "https://www.coupang.com/",                       # not a product path
        "",                                               # empty
    ],
)
def test_invalid_urls_rejected(url):
    ok, reason = ps.validate_coupang_product_url(url)
    assert ok is False
    assert isinstance(reason, str) and reason


# --- HTML extraction ---------------------------------------------------------


def test_parse_extracts_title_text_and_images():
    out = ps.extract_from_html(
        _fixture_html(), base_url="https://www.coupang.com/vp/products/123"
    )
    assert "전선몰딩" in out["title"]
    assert out["product_name_candidate"] == "전선몰딩 자가시공 케이블 정리 몰드 화이트 1호"
    assert out["image_source_region"] == "detail"

    text = out["visible_text"]
    assert "먼지와 기름을 깨끗이 제거" in text
    assert "실크벽지" in text
    assert "전용 커터" in text
    # script/style content and the search header outside the detail region gone
    assert "window.__APP__" not in text
    assert "console.log" not in text
    assert "푸터 영역" not in text


def test_parse_image_urls_resolved_and_filtered():
    out = ps.extract_from_html(
        _fixture_html(), base_url="https://www.coupang.com/vp/products/123"
    )
    urls = out["image_urls"]
    assert "https://www.coupang.com/images/detail_01.jpg" in urls   # relative resolved
    assert "https://cdn.coupang.test/images/detail_02.jpg" in urls  # protocol-relative
    assert "https://cdn.coupang.test/images/detail_03.png" in urls  # absolute, data-src/src
    assert all(not u.startswith("data:") for u in urls)             # data: URI dropped
    assert len(urls) == 3


def test_parse_falls_back_to_body_when_no_detail_region():
    html = "<html><head><title>T</title></head><body><p>본문 텍스트</p>" \
           "<img src='https://x.test/a.jpg'></body></html>"
    out = ps.extract_from_html(html, base_url="https://www.coupang.com/vp/products/9")
    assert out["image_source_region"] == "page_fallback"
    assert "본문 텍스트" in out["visible_text"]


# --- slug / metadata / block detection (pure) --------------------------------


def test_safe_slug_uses_product_id_and_is_filesystem_safe():
    slug = cap.safe_slug("https://www.coupang.com/vp/products/123456789?x=1")
    assert slug.startswith("product-123456789-")
    assert all(c.isalnum() or c in "-._" for c in slug)


def test_detect_block_flags_login_and_captcha():
    assert cap.detect_block(url="https://login.coupang.com/login", title="", text_sample="")
    assert cap.detect_block(url="https://x", title="", text_sample="보안문자를 입력")
    assert cap.detect_block(url="https://www.coupang.com/vp/products/1",
                            title="전선몰딩", text_sample="설치 방법") is None


def test_build_metadata_marks_no_ocr_no_multimodal():
    meta = cap.build_metadata(url="u", status="ok", extracted={"visible_text": "abc"})
    assert meta["ocr"] is False
    assert meta["multimodal"] is False
    assert meta["text_length"] == 3
    assert meta["status"] == "ok"


# --- artifact writer ---------------------------------------------------------


def _tiny_png_bytes() -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (12, 8), (200, 200, 200)).save(buf, format="PNG")
    return buf.getvalue()


def test_write_snapshot_artifacts_creates_expected_files(tmp_path):
    meta = cap.build_metadata(url="u", status="ok", extracted={"visible_text": "텍스트"})
    paths = cap.write_snapshot_artifacts(
        tmp_path / "snap",
        metadata=meta,
        extracted_text="텍스트 본문",
        image_manifest={"image_urls": ["https://x.test/a.jpg"], "sampled": []},
        screenshot_bytes=_tiny_png_bytes(),
    )
    assert json.loads(Path(paths["metadata"]).read_text(encoding="utf-8"))["status"] == "ok"
    assert Path(paths["text"]).read_text(encoding="utf-8") == "텍스트 본문"
    manifest = json.loads(Path(paths["image_manifest"]).read_text(encoding="utf-8"))
    assert manifest["image_urls"] == ["https://x.test/a.jpg"]
    assert Path(paths["screenshot"]).name == "full_page.png"
    assert Path(paths["screenshot"]).exists()
    # capture-only: no drafted-guidance / multimodal artifact is ever written
    assert not (tmp_path / "snap" / "product_guidance_draft.json").exists()


def test_write_snapshot_artifacts_without_screenshot(tmp_path):
    meta = cap.build_metadata(url="u", status="blocked", reason="차단")
    paths = cap.write_snapshot_artifacts(
        tmp_path / "snap",
        metadata=meta,
        extracted_text="",
        image_manifest={"image_urls": [], "sampled": []},
        screenshot_bytes=None,
    )
    assert "screenshot" not in paths
    assert not (tmp_path / "snap" / "screenshots").exists()


# --- image download (injectable fetcher; no network) -------------------------


def test_download_sample_images_caps_and_records_dimensions(tmp_path):
    png = _tiny_png_bytes()
    calls: list[str] = []

    def fake_fetch(url: str) -> bytes:
        calls.append(url)
        return png

    urls = [f"https://cdn.test/img_{i}.png" for i in range(5)]
    records = cap.download_sample_images(
        urls, tmp_path / "images", fetcher=fake_fetch, max_images=3
    )
    assert len(records) == 3            # capped
    assert len(calls) == 3
    for r in records:
        assert r["downloaded"] is True
        assert r["width"] == 12 and r["height"] == 8
        assert (tmp_path / "images" / r["filename"]).exists()


def test_download_sample_images_fail_soft_on_error(tmp_path):
    def boom(url: str) -> bytes:
        raise RuntimeError("network down")

    records = cap.download_sample_images(
        ["https://cdn.test/a.png"], tmp_path / "images", fetcher=boom, max_images=3
    )
    assert len(records) == 1
    assert records[0]["downloaded"] is False
    assert "network down" in records[0]["error"]


# --- lazy import / no-network / isolation discipline -------------------------


def test_playwright_is_not_imported_at_module_load():
    # Importing parse/capture must not pull in Playwright or OpenAI.
    assert "playwright" not in sys.modules
    assert "openai" not in sys.modules


def test_capture_module_has_no_toplevel_browser_or_openai_import():
    src = (Path(cap.__file__)).read_text(encoding="utf-8")
    # the only Playwright import must be lazy (inside a function body, indented)
    assert "\nfrom playwright" not in src
    assert "\nimport playwright" not in src
    # no OpenAI import anywhere (prose mention in the docstring is fine)
    low = src.lower()
    assert "import openai" not in low
    assert "from openai" not in low


def test_snapshot_module_not_referenced_by_protected_surfaces():
    root = Path(cap.__file__).parents[5]  # repo root
    for rel in (
        "app_industrial_review_ops.py",
        "src/voc/review_ops/industrial/notion_export.py",
        "src/voc/review_ops/industrial/store.py",
        "src/voc/review_ops/industrial/rag.py",
        "src/voc/review_ops/industrial/issue_discovery.py",
        "src/voc/review_ops/industrial/taxonomy.py",
    ):
        text = (root / rel).read_text(encoding="utf-8")
        assert "detail_snapshot" not in text, rel
