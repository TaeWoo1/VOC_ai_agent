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
from src.voc.review_ops.industrial.detail_snapshot import guidance_gap as gg
from src.voc.review_ops.industrial.detail_snapshot import guidance_gap_apply as gga
from src.voc.review_ops.industrial.detail_snapshot import guidance_postprocess as gp
from src.voc.review_ops.industrial.detail_snapshot import guidance_schema as gs
from src.voc.review_ops.industrial.detail_snapshot import ingest_local as il
from src.voc.review_ops.industrial.detail_snapshot import multimodal_extract as me
from src.voc.review_ops.industrial.detail_snapshot import parse as ps
from src.voc.review_ops.industrial.detail_snapshot import tiling as tl

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


# --- S2x.2-local: local detail-image ingest ---------------------------------


def _make_images(dirpath: Path) -> list[Path]:
    """Create 3 tiny local fixture images (deterministic, no network)."""
    from PIL import Image

    dirpath.mkdir(parents=True, exist_ok=True)
    specs = [
        ("01_first.png", "PNG", (12, 8)),
        ("02_second.jpg", "JPEG", (20, 10)),
        ("03_third.png", "PNG", (16, 16)),
    ]
    made = []
    for name, fmt, size in specs:
        p = dirpath / name
        Image.new("RGB", size, (180, 180, 180)).save(p, format=fmt)
        made.append(p)
    return made


def test_local_ingest_creates_metadata_and_manifest(tmp_path):
    _make_images(tmp_path / "src")
    result = il.ingest_local_images(
        tmp_path / "src", product_name="선바로 전선 몰딩 1호", out_root=tmp_path / "out"
    )
    assert result["status"] == "ok"
    meta = json.loads(Path(result["paths"]["metadata"]).read_text(encoding="utf-8"))
    assert meta["source_type"] == "local_detail_images"
    assert meta["visibility"] == "consumer_visible"
    assert meta["product_name"] == "선바로 전선 몰딩 1호"
    assert meta["image_count"] == 3
    assert meta["copied_image_count"] == 3
    assert meta["text_length"] == 0
    assert meta["extraction_mode"] == "none"
    assert meta["ocr"] is False and meta["multimodal"] is False

    manifest = json.loads(Path(result["paths"]["image_manifest"]).read_text(encoding="utf-8"))
    assert manifest["image_source_region"] == "operator_local_detail_images"
    assert len(manifest["images"]) == 3


def test_local_ingest_copies_images_deterministically_without_mutating_source(tmp_path):
    src = tmp_path / "src"
    originals = _make_images(src)
    before = sorted(p.name for p in src.iterdir())

    result = il.ingest_local_images(src, product_name="p", out_root=tmp_path / "out")
    manifest = json.loads(Path(result["paths"]["image_manifest"]).read_text(encoding="utf-8"))
    imgs = manifest["images"]

    # deterministic order by source filename; sequential order_index + names
    assert [r["order_index"] for r in imgs] == [0, 1, 2]
    assert [r["local_filename"] for r in imgs] == [
        "image_000.png", "image_001.jpg", "image_002.png"
    ]
    assert [Path(r["original_path"]).name for r in imgs] == [p.name for p in originals]

    images_dir = Path(result["snapshot_dir"]) / "images"
    for r in imgs:
        assert (images_dir / r["local_filename"]).exists()
    # source folder untouched
    assert sorted(p.name for p in src.iterdir()) == before


def test_local_ingest_records_dimensions_format_and_size(tmp_path):
    _make_images(tmp_path / "src")
    result = il.ingest_local_images(tmp_path / "src", product_name="p", out_root=tmp_path / "out")
    imgs = json.loads(Path(result["paths"]["image_manifest"]).read_text(encoding="utf-8"))["images"]
    first = imgs[0]
    assert first["width"] == 12 and first["height"] == 8
    assert first["format"] == "PNG"
    assert first["file_size_bytes"] > 0
    assert imgs[1]["format"] == "JPEG" and imgs[1]["width"] == 20


def test_local_ingest_extracted_text_note_present_and_no_ocr(tmp_path):
    _make_images(tmp_path / "src")
    result = il.ingest_local_images(tmp_path / "src", product_name="p", out_root=tmp_path / "out")
    text = Path(result["paths"]["text"]).read_text(encoding="utf-8")
    assert "텍스트 추출은 아직" in text
    assert "소비자에게 노출되는" in text
    # no draft / multimodal artifact ever written
    assert not (Path(result["snapshot_dir"]) / "product_guidance_draft.json").exists()


def test_local_ingest_no_images_fail_soft(tmp_path):
    (tmp_path / "empty").mkdir()
    result = il.ingest_local_images(tmp_path / "empty", product_name="p", out_root=tmp_path / "out")
    assert result["status"] == "error"
    meta = json.loads(Path(result["paths"]["metadata"]).read_text(encoding="utf-8"))
    assert meta["image_count"] == 0
    assert meta["notes"]


def test_local_ingest_missing_dir_fail_soft(tmp_path):
    result = il.ingest_local_images(tmp_path / "nope", product_name="p", out_root=tmp_path / "out")
    assert result["status"] == "error"
    assert Path(result["paths"]["metadata"]).exists()  # no half-state


def test_local_ingest_partial_on_unreadable_image(tmp_path):
    src = tmp_path / "src"
    _make_images(src)
    (src / "00_broken.png").write_bytes(b"not a real image")  # sorts first
    result = il.ingest_local_images(src, product_name="p", out_root=tmp_path / "out")
    assert result["status"] == "partial"
    imgs = json.loads(Path(result["paths"]["image_manifest"]).read_text(encoding="utf-8"))["images"]
    broken = [r for r in imgs if Path(r["original_path"]).name == "00_broken.png"][0]
    assert broken["copied"] is False
    assert "error" in broken
    good = [r for r in imgs if r.get("copied")]
    assert len(good) == 3


def test_ingest_local_module_has_no_network_or_openai_import():
    src = (Path(il.__file__)).read_text(encoding="utf-8")
    low = src.lower()
    for bad in ("import requests", "import httpx", "import socket",
                "urllib.request", "import openai", "from openai",
                "import playwright", "from playwright"):
        assert bad not in low, bad


def test_cli_modes_and_url_capture_path_unchanged(tmp_path):
    import importlib.util

    root = Path(cap.__file__).parents[5]
    spec = importlib.util.spec_from_file_location(
        "snap_spike_cli", root / "scripts" / "review_ops_detail_snapshot_spike.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    # neither mode → reject
    assert mod.main([]) == 2
    # both modes → reject
    assert mod.main(["--url", "https://www.coupang.com/vp/products/1",
                     "--image-dir", str(tmp_path)]) == 2
    # URL mode still validates (offline reject, existing behavior unchanged)
    assert mod.main(["--url", "https://www.example.com/vp/products/1"]) == 2
    # local mode runs offline end-to-end
    _make_images(tmp_path / "src")
    assert mod.main(["--image-dir", str(tmp_path / "src"),
                     "--product-name", "p", "--out-dir", str(tmp_path / "out")]) == 0


# --- S2x.3a: vertical tiling -------------------------------------------------


def _snapshot_with_tall_image(root: Path, *, width=1000, height=4300) -> Path:
    """Build a minimal snapshot folder (images/ + image_manifest.json)."""
    from PIL import Image

    snap = root / "local-test"
    images = snap / "images"
    images.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (width, height), (170, 170, 170)).save(images / "image_000.jpg", "JPEG")
    manifest = {
        "image_source_region": "operator_local_detail_images",
        "images": [{"original_path": "/x/a.jpg", "order_index": 0,
                    "local_filename": "image_000.jpg", "width": width, "height": height,
                    "format": "JPEG", "file_size_bytes": 1, "copied": True}],
    }
    (snap / "image_manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return snap


def test_compute_tile_bounds_tall_image():
    bounds = tl.compute_tile_bounds(18333, tile_height=2000, overlap_px=150)
    assert len(bounds) == 10
    assert bounds[0] == (0, 2000)
    assert bounds[-1][1] == 18333          # last tile clamped to bottom
    # monotonic starts; constant 150px overlap between consecutive tiles
    for (a0, a1), (b0, b1) in zip(bounds, bounds[1:]):
        assert b0 > a0
        assert a1 - b0 == 150


def test_compute_tile_bounds_short_image_single_tile():
    assert tl.compute_tile_bounds(1500, tile_height=2000, overlap_px=150) == [(0, 1500)]
    assert tl.compute_tile_bounds(2000, tile_height=2000, overlap_px=150) == [(0, 2000)]


def test_compute_tile_bounds_rejects_bad_overlap():
    with pytest.raises(ValueError):
        tl.compute_tile_bounds(5000, tile_height=2000, overlap_px=2000)


def test_make_tiles_creates_tiles_and_manifest(tmp_path):
    snap = _snapshot_with_tall_image(tmp_path, height=4300)
    result = tl.make_tiles(snap, tile_height=2000, overlap_px=150)
    assert result["status"] == "ok"
    # (4300-2000)/1850 -> 2 + 1 = 3 tiles
    assert result["tile_count"] == 3

    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    assert manifest["status"] == "ok"
    assert manifest["tiling_params"] == {
        "tile_height": 2000, "overlap_px": 150, "source_image_count": 1, "tile_count": 3
    }
    tiles = manifest["tiles"]
    assert [t["local_filename"] for t in tiles] == [
        "tile_000_000.jpg", "tile_000_001.jpg", "tile_000_002.jpg"
    ]
    assert [t["order_index"] for t in tiles] == [0, 1, 2]
    assert all(t["source_image"] == "images/image_000.jpg" for t in tiles)
    assert all(t["width"] == 1000 for t in tiles)
    assert tiles[-1]["y1"] == 4300
    for t in tiles:
        assert (snap / "tiles" / t["local_filename"]).exists()
        assert t["file_size_bytes"] > 0
        assert t["height"] == t["y1"] - t["y0"]


def test_make_tiles_short_image_single_tile(tmp_path):
    snap = _snapshot_with_tall_image(tmp_path, height=1200)
    result = tl.make_tiles(snap, tile_height=2000, overlap_px=150)
    assert result["status"] == "ok"
    assert result["tile_count"] == 1
    manifest = json.loads(Path(result["manifest_path"]).read_text(encoding="utf-8"))
    assert manifest["tiles"][0]["y0"] == 0 and manifest["tiles"][0]["y1"] == 1200


def test_make_tiles_replaces_stale_tiles(tmp_path):
    snap = _snapshot_with_tall_image(tmp_path, height=4300)
    tl.make_tiles(snap, tile_height=2000, overlap_px=150)          # 3 tiles
    (snap / "tiles" / "ORPHAN.jpg").write_bytes(b"stale")
    result = tl.make_tiles(snap, tile_height=4300, overlap_px=150)  # single tile now
    assert result["tile_count"] == 1
    assert not (snap / "tiles" / "ORPHAN.jpg").exists()
    assert not (snap / "tiles" / "tile_000_001.jpg").exists()


def test_make_tiles_missing_snapshot_dir(tmp_path):
    result = tl.make_tiles(tmp_path / "nope", tile_height=2000, overlap_px=150)
    assert result["status"] == "error"
    assert result["tile_count"] == 0


def test_make_tiles_missing_manifest_fail_soft(tmp_path):
    snap = tmp_path / "empty-snap"
    snap.mkdir()
    result = tl.make_tiles(snap, tile_height=2000, overlap_px=150)
    assert result["status"] == "error"
    # a tiles_manifest record is still written when the folder exists
    assert (snap / "tiles_manifest.json").exists()


def test_make_tiles_no_images_fail_soft(tmp_path):
    snap = tmp_path / "snap"
    snap.mkdir()
    (snap / "image_manifest.json").write_text(json.dumps({"images": []}), encoding="utf-8")
    result = tl.make_tiles(snap, tile_height=2000, overlap_px=150)
    assert result["status"] == "error"
    assert "이미지" in json.loads(
        (snap / "tiles_manifest.json").read_text(encoding="utf-8")
    )["reason"]


def test_tiling_module_has_no_network_or_openai_import():
    src = (Path(tl.__file__)).read_text(encoding="utf-8")
    low = src.lower()
    for bad in ("import requests", "import httpx", "import socket",
                "urllib.request", "import openai", "from openai",
                "import playwright", "from playwright"):
        assert bad not in low, bad


def test_protected_surfaces_do_not_reference_tiling():
    root = Path(tl.__file__).parents[5]
    for rel in (
        "app_industrial_review_ops.py",
        "src/voc/review_ops/industrial/notion_export.py",
        "src/voc/review_ops/industrial/store.py",
        "src/voc/review_ops/industrial/rag.py",
        "src/voc/review_ops/industrial/issue_discovery.py",
        "src/voc/review_ops/industrial/taxonomy.py",
    ):
        assert "tiling" not in (root / rel).read_text(encoding="utf-8"), rel


def test_cli_make_tiles_modes(tmp_path):
    import importlib.util

    root = Path(cap.__file__).parents[5]
    spec = importlib.util.spec_from_file_location(
        "snap_spike_cli_tiles", root / "scripts" / "review_ops_detail_snapshot_spike.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    # invalid combinations rejected
    assert mod.main(["--make-tiles"]) == 2  # no --snapshot-dir
    assert mod.main(["--make-tiles", "--snapshot-dir", str(tmp_path),
                     "--url", "https://www.coupang.com/vp/products/1"]) == 2
    assert mod.main(["--make-tiles", "--snapshot-dir", str(tmp_path),
                     "--image-dir", str(tmp_path)]) == 2
    # happy path: tile an offline snapshot
    snap = _snapshot_with_tall_image(tmp_path, height=4300)
    assert mod.main(["--make-tiles", "--snapshot-dir", str(snap)]) == 0
    assert (snap / "tiles_manifest.json").exists()


# --- S2x.3b: multimodal guidance extraction (mock client only) ---------------


def _snapshot_with_tiles_manifest(root: Path, tile_names: list[str]) -> Path:
    snap = root / "local-extract"
    snap.mkdir(parents=True, exist_ok=True)
    manifest = {
        "status": "ok",
        "tiling_params": {"tile_count": len(tile_names)},
        "tiles": [{"local_filename": n, "order_index": i}
                  for i, n in enumerate(tile_names)],
    }
    (snap / "tiles_manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return snap


def test_extract_guidance_merges_two_tiles_and_dedups(tmp_path):
    snap = _snapshot_with_tiles_manifest(tmp_path, ["tile_000_000.jpg", "tile_000_001.jpg"])

    def mock_extractor(path, *, model):
        # both tiles report the SAME usage step (overlap duplicate); tile 1 adds a component
        if path.name == "tile_000_000.jpg":
            return {
                "product_identity": {
                    "product_name": {"value": "선바로 전선 몰딩", "verbatim": "선바로", "confidence": "high"},
                    "package_composition": [],
                },
                "usage_installation": [
                    {"value": "부착 전 먼지 제거", "verbatim": "먼지 제거", "confidence": "medium"}
                ],
                "surface_adhesion": [{"value": "실크벽지 주의", "confidence": "low"}],
            }
        return {
            "usage_installation": [
                {"value": "부착 전 먼지 제거", "confidence": "high"}  # dup, higher conf
            ],
            "included_components": [{"value": "마감캡", "confidence": "medium"}],
        }

    result = me.extract_guidance(
        snap, enable_multimodal=True, model="mock-model", tile_extractor=mock_extractor
    )
    assert result["status"] == "ok"
    draft = json.loads(Path(result["draft_path"]).read_text(encoding="utf-8"))

    usage = draft["fields"]["usage_installation"]
    assert len(usage) == 1                       # deduped across overlapping tiles
    assert sorted(usage[0]["source_tiles"]) == ["tile_000_000.jpg", "tile_000_001.jpg"]
    assert usage[0]["confidence"] == "high"      # max of medium/high
    assert draft["fields"]["product_identity"]["product_name"]["value"] == "선바로 전선 몰딩"
    assert draft["fields"]["included_components"][0]["value"] == "마감캡"
    assert draft["model"] == "mock-model"
    assert draft["generated_from_tiles"] == ["tile_000_000.jpg", "tile_000_001.jpg"]


def test_extract_guidance_draft_flags(tmp_path):
    snap = _snapshot_with_tiles_manifest(tmp_path, ["tile_000_000.jpg"])
    result = me.extract_guidance(
        snap, enable_multimodal=True, tile_extractor=lambda p, *, model: {
            "size_spec": [{"value": "1호 / 1m", "confidence": "high"}]
        }
    )
    draft = json.loads(Path(result["draft_path"]).read_text(encoding="utf-8"))
    assert draft["extraction_mode"] == "multimodal_draft"
    assert draft["needs_operator_review"] is True
    assert draft["visibility"] == "consumer_visible"
    assert draft["source_type"] == "local_detail_images"
    assert "운영자 확인" in draft["extraction_notes"]


def test_extract_guidance_disabled_is_skipped(tmp_path):
    snap = _snapshot_with_tiles_manifest(tmp_path, ["t.jpg"])
    result = me.extract_guidance(snap, enable_multimodal=False)
    assert result["status"] == "skipped"
    assert not (snap / "product_guidance_draft.json").exists()


def test_extract_guidance_missing_key_fails_soft(tmp_path, monkeypatch):
    # no injected extractor + no key → skip, no draft, no OpenAI
    monkeypatch.setattr(me, "resolve_api_key", lambda: None)
    snap = _snapshot_with_tiles_manifest(tmp_path, ["t.jpg"])
    result = me.extract_guidance(snap, enable_multimodal=True)
    assert result["status"] == "skipped_no_key"
    assert result["draft_path"] is None
    assert not (snap / "product_guidance_draft.json").exists()


def test_extract_guidance_missing_tiles_manifest_asks_to_tile(tmp_path):
    snap = tmp_path / "no-tiles"
    snap.mkdir()
    result = me.extract_guidance(
        snap, enable_multimodal=True, tile_extractor=lambda p, *, model: {}
    )
    assert result["status"] == "error"
    assert "make-tiles" in result["reason"]
    assert not (snap / "product_guidance_draft.json").exists()


def test_extract_guidance_malformed_tile_recorded_partial(tmp_path):
    snap = _snapshot_with_tiles_manifest(tmp_path, ["good.jpg", "bad.jpg"])

    def extractor(path, *, model):
        if path.name == "bad.jpg":
            raise ValueError("not valid json")
        return {"warnings_faq": [{"value": "설치 전 표면 확인", "confidence": "medium"}]}

    result = me.extract_guidance(
        snap, enable_multimodal=True, tile_extractor=extractor
    )
    assert result["status"] == "partial"
    draft = json.loads(Path(result["draft_path"]).read_text(encoding="utf-8"))
    assert any(e["tile"] == "bad.jpg" for e in draft["errors"])
    assert draft["fields"]["warnings_faq"][0]["value"] == "설치 전 표면 확인"


def test_extract_guidance_all_tiles_fail_no_draft(tmp_path):
    snap = _snapshot_with_tiles_manifest(tmp_path, ["a.jpg", "b.jpg"])

    def boom(path, *, model):
        raise RuntimeError("fail")

    result = me.extract_guidance(snap, enable_multimodal=True, tile_extractor=boom)
    assert result["status"] == "error"
    assert not (snap / "product_guidance_draft.json").exists()


def test_overall_confidence_is_conservative():
    fields = gs.empty_fields()
    fields["usage_installation"] = [
        {"value": "a", "confidence": "high"}, {"value": "b", "confidence": "low"}
    ]
    assert gs.overall_confidence(fields) == "low"  # min, not max


def test_multimodal_module_has_no_toplevel_openai_or_network_import():
    src = (Path(me.__file__)).read_text(encoding="utf-8")
    # OpenAI must be imported lazily (inside a function), never at module top level
    assert "\nfrom openai" not in src
    assert "\nimport openai" not in src
    assert not src.startswith(("from openai", "import openai"))
    low = src.lower()
    for bad in ("import requests", "import httpx", "import socket", "urllib.request",
                "import playwright", "from playwright"):
        assert bad not in low, bad


def test_protected_surfaces_do_not_reference_multimodal_extract():
    root = Path(me.__file__).parents[5]
    for rel in (
        "app_industrial_review_ops.py",
        "src/voc/review_ops/industrial/notion_export.py",
        "src/voc/review_ops/industrial/store.py",
        "src/voc/review_ops/industrial/issue_discovery.py",
        "src/voc/review_ops/industrial/taxonomy.py",
    ):
        text = (root / rel).read_text(encoding="utf-8")
        assert "multimodal_extract" not in text, rel
        assert "guidance_schema" not in text, rel


def test_cli_extract_guidance_modes(tmp_path):
    import importlib.util

    root = Path(cap.__file__).parents[5]
    spec = importlib.util.spec_from_file_location(
        "snap_spike_cli_extract", root / "scripts" / "review_ops_detail_snapshot_spike.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    snap = _snapshot_with_tiles_manifest(tmp_path, ["t.jpg"])
    # requires --snapshot-dir
    assert mod.main(["--extract-guidance", "--enable-multimodal"]) == 2
    # requires --enable-multimodal (the explicit opt-in)
    assert mod.main(["--extract-guidance", "--snapshot-dir", str(snap)]) == 2
    # cannot combine with other modes
    assert mod.main(["--extract-guidance", "--enable-multimodal",
                     "--snapshot-dir", str(snap), "--make-tiles"]) == 2


# --- S2x.3c: deterministic guidance-draft post-process -----------------------


def _draft_with_fields(**field_overrides) -> dict:
    """Synthetic draft dict: empty fields with the given list-field overrides."""
    fields = gs.empty_fields()
    fields.update(field_overrides)
    return {
        "source_type": "local_detail_images",
        "visibility": "consumer_visible",
        "extraction_mode": "multimodal_draft",
        "needs_operator_review": True,
        "confidence": "high",
        "model": "mock",
        "fields": fields,
    }


def test_postprocess_routes_usage_items_into_buckets():
    draft = _draft_with_fields(
        usage_installation=[
            {"value": "부착 전 먼지 제거", "verbatim": "물기나 먼지를 닦아내", "confidence": "high",
             "source_tiles": ["tile_000_005.jpg"]},
            {"value": "피스로 고정", "verbatim": "피스나 실리콘을 이용", "confidence": "high",
             "source_tiles": ["tile_000_006.jpg"]},
            {"value": "가위로 재단", "verbatim": "다용도 가위로 재단", "confidence": "high",
             "source_tiles": ["tile_000_005.jpg"]},
        ]
    )
    cg = gp.build_review(draft)["confirmed_guidance"]
    assert any("먼지" in i["value"] for i in cg["surface_preparation"])
    assert any("피스" in i["value"] for i in cg["fixation_guidance"])
    assert any("재단" in i["value"] for i in cg["cutting_guidance"])
    # audit fields preserved on routed items
    routed = cg["surface_preparation"][0]
    assert routed["source_tiles"] == ["tile_000_005.jpg"]
    assert routed["confidence"] == "high"


def test_postprocess_routes_components_and_size():
    draft = _draft_with_fields(
        included_components=[
            {"value": "마감캡", "confidence": "high"},
            {"value": "연결캡", "confidence": "high"},
            {"value": "곡선 엘보캡", "confidence": "high"},
        ],
        size_spec=[
            {"value": "모든 제품의 길이는 1M", "confidence": "high"},
            {"value": "색상 화이트, 그레이, 블랙, 우드", "confidence": "high"},
        ],
    )
    cg = gp.build_review(draft)["confirmed_guidance"]
    comp_vals = [i["value"] for i in cg["component_guidance"]]
    assert "마감캡" in comp_vals and "연결캡" in comp_vals and "곡선 엘보캡" in comp_vals
    size_vals = [i["value"] for i in cg["size_spec_guidance"]]
    assert any("1M" in v for v in size_vals)
    assert any("색상" in v for v in size_vals)


def test_postprocess_not_found_when_topics_absent():
    draft = _draft_with_fields(
        usage_installation=[{"value": "부착 전 먼지 제거", "confidence": "high"}]
    )
    not_found = gp.build_review(draft)["not_found_guidance"]
    topics = {n["topic"] for n in not_found}
    assert "실크벽지" in topics
    assert "깨짐 방지" in topics
    assert "추가 양면테이프" in topics
    for n in not_found:
        assert "찾지 못함" in n["reason"]


def test_postprocess_quality_flags_detect_misread_conflict_and_confidence():
    draft = _draft_with_fields(
        usage_installation=[
            {"value": "다용도 가위나 식품 등의 도구를 이용하여 재단", "confidence": "high"},
        ],
        size_spec=[
            {"value": "사이즈는 외경 기준", "confidence": "high"},
            {"value": "사이즈는 외곽 기준", "confidence": "high"},
        ],
    )
    flags = gp.build_review(draft)["quality_flags"]
    types = {f["type"] for f in flags}
    assert "possible_vision_misread" in types
    assert "near_duplicate_or_conflict" in types
    assert "confidence_review" in types
    misread = [f for f in flags if f["type"] == "possible_vision_misread"][0]
    assert "식품" in misread["text"]
    conflict = [f for f in flags if f["type"] == "near_duplicate_or_conflict"][0]
    assert "외경" in conflict["text"] and "외곽" in conflict["text"]


def test_postprocess_gap_signal_partial_status():
    draft = _draft_with_fields(
        usage_installation=[
            {"value": "부착 전 먼지 제거", "confidence": "high"},
            {"value": "피스로 고정", "confidence": "high"},
            {"value": "가위로 재단", "confidence": "high"},
        ]
    )
    signals = {s["topic"]: s for s in gp.build_review(draft)["review_gap_ready_signals"]}
    adhesion = signals["접착력 부족"]
    assert adhesion["detail_page_status"] == "partial_guidance"
    assert "부착 전 물기/먼지 제거" in adhesion["found"]
    assert "실크벽지 조건" in adhesion["not_found"]
    cutting = signals["절단 시 깨짐"]
    assert "재단 안내" in cutting["found"]
    assert "깨짐 방지 주의" in cutting["not_found"]


def test_postprocess_keeps_review_invariants():
    review = gp.build_review(_draft_with_fields())
    assert review["needs_operator_review"] is True
    assert review["consumer_visible_only"] is True
    assert review["postprocess_mode"] == "deterministic_review"
    assert review["source_draft"] == "product_guidance_draft.json"
    assert set(review["confirmed_guidance"]) == set(gp.CONFIRMED_BUCKETS)


def test_review_guidance_writes_review_artifact(tmp_path):
    snap = tmp_path / "snap"
    snap.mkdir()
    draft = _draft_with_fields(
        included_components=[{"value": "마감캡", "confidence": "high"}]
    )
    (snap / "product_guidance_draft.json").write_text(
        json.dumps(draft, ensure_ascii=False), encoding="utf-8"
    )
    result = gp.review_guidance_draft(snap)
    assert result["status"] == "ok"
    review = json.loads((snap / "product_guidance_review.json").read_text(encoding="utf-8"))
    assert review["source_draft"] == "product_guidance_draft.json"
    assert review["confirmed_guidance"]["component_guidance"][0]["value"] == "마감캡"


def test_review_guidance_missing_draft_fail_soft(tmp_path):
    snap = tmp_path / "snap"
    snap.mkdir()
    result = gp.review_guidance_draft(snap)
    assert result["status"] == "error"
    assert result["review_path"] is None
    assert "product_guidance_draft.json" in result["reason"]
    assert not (snap / "product_guidance_review.json").exists()


def test_review_guidance_missing_dir_fail_soft(tmp_path):
    result = gp.review_guidance_draft(tmp_path / "nope")
    assert result["status"] == "error"
    assert result["review_path"] is None


def test_postprocess_module_has_no_network_or_openai_import():
    src = (Path(gp.__file__)).read_text(encoding="utf-8")
    low = src.lower()
    for bad in ("import requests", "import httpx", "import socket", "urllib.request",
                "import openai", "from openai", "import playwright", "from playwright"):
        assert bad not in low, bad


def test_protected_surfaces_do_not_reference_postprocess():
    root = Path(gp.__file__).parents[5]
    for rel in (
        "app_industrial_review_ops.py",
        "src/voc/review_ops/industrial/notion_export.py",
        "src/voc/review_ops/industrial/store.py",
        "src/voc/review_ops/industrial/rag.py",
        "src/voc/review_ops/industrial/issue_discovery.py",
        "src/voc/review_ops/industrial/taxonomy.py",
    ):
        assert "guidance_postprocess" not in (root / rel).read_text(encoding="utf-8"), rel


def test_cli_review_guidance_modes(tmp_path):
    import importlib.util

    root = Path(cap.__file__).parents[5]
    spec = importlib.util.spec_from_file_location(
        "snap_spike_cli_review", root / "scripts" / "review_ops_detail_snapshot_spike.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    # requires --snapshot-dir
    assert mod.main(["--review-guidance-draft"]) == 2
    # cannot combine with other modes
    assert mod.main(["--review-guidance-draft", "--snapshot-dir", str(tmp_path),
                     "--make-tiles"]) == 2
    assert mod.main(["--review-guidance-draft", "--snapshot-dir", str(tmp_path),
                     "--extract-guidance", "--enable-multimodal"]) == 2
    # happy path: post-process an offline draft (exit 0 even via fail-soft)
    snap = tmp_path / "snap"
    snap.mkdir()
    draft = _draft_with_fields(included_components=[{"value": "마감캡", "confidence": "high"}])
    (snap / "product_guidance_draft.json").write_text(
        json.dumps(draft, ensure_ascii=False), encoding="utf-8"
    )
    assert mod.main(["--review-guidance-draft", "--snapshot-dir", str(snap)]) == 0
    assert (snap / "product_guidance_review.json").exists()


# --- S2x.4a: review issue × detail guidance gap analysis ---------------------


def _guidance_review() -> dict:
    """Synthetic product_guidance_review mirroring the S2x.3c output shape."""
    return {
        "confirmed_guidance": {
            "surface_preparation": [{"value": "부착할 위치의 물기/먼지 제거", "confidence": "high"}],
            "fixation_guidance": [{"value": "피스/실리콘 고정", "confidence": "high"}],
            "cutting_guidance": [{"value": "다용도 가위로 재단", "confidence": "high"}],
            "component_guidance": [
                {"value": "마감캡", "confidence": "high"},
                {"value": "연결캡", "confidence": "high"},
            ],
            "size_spec_guidance": [],
        },
        "not_found_guidance": [
            {"topic": "실크벽지", "reason": "draft fields/verbatim에서 관련 표현을 찾지 못함"},
            {"topic": "추가 양면테이프", "reason": "draft fields/verbatim에서 관련 표현을 찾지 못함"},
            {"topic": "거친 벽면", "reason": "draft fields/verbatim에서 관련 표현을 찾지 못함"},
            {"topic": "습기", "reason": "draft fields/verbatim에서 관련 표현을 찾지 못함"},
            {"topic": "깨짐 방지", "reason": "draft fields/verbatim에서 관련 표현을 찾지 못함"},
            {"topic": "권장 절단 도구", "reason": "draft fields/verbatim에서 관련 표현을 찾지 못함"},
        ],
        "review_gap_ready_signals": [
            {
                "topic": "접착력 부족",
                "detail_page_status": "partial_guidance",
                "found": ["부착 전 물기/먼지 제거", "피스/실리콘 고정"],
                "not_found": ["실크벽지 조건", "추가 양면테이프", "거친 벽면/습기 조건"],
                "operator_note": "리뷰의 실크벽지/접착력 불만과 상세페이지 안내 사이의 gap 점검 후보",
            },
            {
                "topic": "절단 시 깨짐",
                "detail_page_status": "partial_guidance",
                "found": ["재단 안내", "다용도 가위 등 도구 언급"],
                "not_found": ["깨짐 방지 주의", "권장 절단 도구의 명확한 안내"],
                "operator_note": "절단 방법 안내의 구체성 및 깨짐 방지 안내 gap 점검 후보",
            },
        ],
    }


def test_gap_adhesion_issue_partial_guidance():
    issue = {"title": "접착력 부족", "canonical_label": "durability_adhesion_finish"}
    result = gg.analyze_issue_guidance_gap(issue, _guidance_review())
    assert result["detail_page_status"] == "partial_guidance"
    assert any("물기/먼지" in f for f in result["found_guidance"])
    assert any("피스/실리콘" in f for f in result["found_guidance"])
    assert any("실크벽지" in n for n in result["not_found_guidance"])
    assert any("추가 양면테이프" in n for n in result["not_found_guidance"])
    # cautious wording, no absolute "없습니다" claim
    assert "추출 결과 기준" in result["operator_check"]
    assert "없습니다" not in result["operator_check"]
    assert "찾지 못했습니다" in result["operator_check"]


def test_gap_cutting_issue_partial_guidance():
    issue = {"title": "절단 시 깨짐", "canonical_label": "cutting_breakage"}
    result = gg.analyze_issue_guidance_gap(issue, _guidance_review())
    assert result["detail_page_status"] == "partial_guidance"
    assert any("재단 안내" in f for f in result["found_guidance"])
    assert any("깨짐 방지" in n for n in result["not_found_guidance"])
    assert "추출 결과 기준" in result["operator_check"]


def test_gap_component_issue_does_not_infer_fulfillment():
    issue = {"title": "구성품 누락", "canonical_label": "missing_components"}
    result = gg.analyze_issue_guidance_gap(issue, _guidance_review())
    assert result["detail_page_status"] == "guidance_present"
    assert "마감캡" in result["found_guidance"]
    assert "연결캡" in result["found_guidance"]
    # never infer a fulfillment cause
    assert "원인" not in result["operator_check"]
    assert "출고" not in result["operator_check"]
    assert "반드시" not in result["operator_check"]


def test_gap_unknown_issue_no_mapped_guidance():
    issue = {"title": "향이 별로예요", "canonical_label": "scent_dislike"}
    result = gg.analyze_issue_guidance_gap(issue, _guidance_review())
    assert result["detail_page_status"] == "no_mapped_guidance"
    assert result["found_guidance"] == []
    assert result["not_found_guidance"] == []


def test_gap_missing_guidance_review():
    for empty in (None, {}):
        result = gg.analyze_issue_guidance_gap({"title": "접착력 부족"}, empty)
        assert result["detail_page_status"] == "no_guidance_review"
        assert result["found_guidance"] == []


def test_gap_output_keeps_basis_and_review_flag():
    for issue in (
        {"title": "접착력 부족"},
        {"title": "구성품 누락"},
        {"title": "알 수 없는 이슈"},
    ):
        result = gg.analyze_issue_guidance_gap(issue, _guidance_review())
        assert result["needs_operator_review"] is True
        assert result["basis"] == "consumer_visible_detail_image_draft"
        assert result["confidence"] == "review_needed"
        assert "추출 draft에서 찾지 못했다" in result["caution"]


def test_gap_adhesion_fallback_without_precomputed_signal():
    # review with NO review_gap_ready_signals → fallback from confirmed/not_found
    review = _guidance_review()
    review["review_gap_ready_signals"] = []
    result = gg.analyze_issue_guidance_gap({"title": "접착력 부족"}, review)
    assert result["detail_page_status"] == "partial_guidance"
    assert "부착 전 물기/먼지 제거" in result["found_guidance"]
    assert "실크벽지 조건" in result["not_found_guidance"]


def test_gap_module_has_no_network_or_openai_import():
    src = (Path(gg.__file__)).read_text(encoding="utf-8")
    low = src.lower()
    for bad in ("import requests", "import httpx", "import socket", "urllib.request",
                "import openai", "from openai", "import playwright", "from playwright"):
        assert bad not in low, bad


def test_protected_surfaces_do_not_reference_guidance_gap():
    root = Path(gg.__file__).parents[5]
    for rel in (
        "app_industrial_review_ops.py",
        "src/voc/review_ops/industrial/notion_export.py",
        "src/voc/review_ops/industrial/store.py",
        "src/voc/review_ops/industrial/rag.py",
        "src/voc/review_ops/industrial/issue_discovery.py",
        "src/voc/review_ops/industrial/taxonomy.py",
    ):
        assert "guidance_gap" not in (root / rel).read_text(encoding="utf-8"), rel


# --- S2x.4b: apply gap helper over a list of issues --------------------------


def _issue_list() -> list[dict]:
    return [
        {
            "issue_title": "접착력 부족",
            "canonical_label": "durability_adhesion_finish",
            "summary": "실크벽지에서 잘 떨어진다는 의견",
            "recommended_action": "부착면 조건 안내 점검 후보",
            "review_count": 12,
            "severity": "high",
        },
        {
            "title": "절단 시 깨짐",
            "canonical_label": "cutting_breakage",
            "recommended_action": "절단 방법 안내 점검 후보",
            "review_count": 5,
        },
    ]


def test_apply_gap_over_issue_list_preserves_order():
    results = gga.analyze_issue_list_guidance_gaps(_issue_list(), _guidance_review())
    assert [r["issue_title"] for r in results] == ["접착력 부족", "절단 시 깨짐"]


def test_apply_gap_adhesion_result():
    results = gga.analyze_issue_list_guidance_gaps(_issue_list(), _guidance_review())
    adhesion = results[0]
    assert adhesion["detail_page_status"] == "partial_guidance"
    assert any("부착 전 물기/먼지 제거" in f for f in adhesion["found_guidance"])
    assert any("실크벽지 조건" in n for n in adhesion["not_found_guidance"])


def test_apply_gap_cutting_result():
    results = gga.analyze_issue_list_guidance_gaps(_issue_list(), _guidance_review())
    cutting = results[1]
    assert cutting["detail_page_status"] == "partial_guidance"
    assert any("재단 안내" in f for f in cutting["found_guidance"])
    assert any("깨짐 방지" in n for n in cutting["not_found_guidance"])


def test_apply_gap_preserves_issue_metadata():
    results = gga.analyze_issue_list_guidance_gaps(_issue_list(), _guidance_review())
    assert results[0]["review_count"] == 12
    assert results[0]["severity"] == "high"
    assert results[0]["recommended_action"] == "부착면 조건 안내 점검 후보"
    assert results[1]["review_count"] == 5
    # cutting item had no severity → not fabricated
    assert "severity" not in results[1]


def test_apply_gap_missing_guidance_review_per_issue():
    for empty in (None, {}):
        results = gga.analyze_issue_list_guidance_gaps(_issue_list(), empty)
        assert len(results) == 2
        assert all(r["detail_page_status"] == "no_guidance_review" for r in results)
        # passthrough still attached even when no review
        assert results[0]["review_count"] == 12


def test_apply_gap_empty_issue_list():
    assert gga.analyze_issue_list_guidance_gaps([], _guidance_review()) == []
    assert gga.analyze_issue_list_guidance_gaps(None, _guidance_review()) == []


def test_apply_gap_does_not_mutate_inputs():
    issues = _issue_list()
    review = _guidance_review()
    import copy

    issues_before = copy.deepcopy(issues)
    review_before = copy.deepcopy(review)
    gga.analyze_issue_list_guidance_gaps(issues, review)
    assert issues == issues_before
    assert review == review_before


def test_load_guidance_review_present_missing_and_invalid(tmp_path):
    # missing → None
    assert gga.load_guidance_review(tmp_path / "nope") is None
    snap = tmp_path / "snap"
    snap.mkdir()
    assert gga.load_guidance_review(snap) is None
    # present → dict
    review = _guidance_review()
    (snap / "product_guidance_review.json").write_text(
        json.dumps(review, ensure_ascii=False), encoding="utf-8"
    )
    loaded = gga.load_guidance_review(snap)
    assert isinstance(loaded, dict)
    assert "review_gap_ready_signals" in loaded
    # invalid JSON → None (fail-soft)
    (snap / "product_guidance_review.json").write_text("{not json", encoding="utf-8")
    assert gga.load_guidance_review(snap) is None


def test_apply_gap_module_has_no_network_or_openai_import():
    src = (Path(gga.__file__)).read_text(encoding="utf-8")
    low = src.lower()
    for bad in ("import requests", "import httpx", "import socket", "urllib.request",
                "import openai", "from openai", "import playwright", "from playwright"):
        assert bad not in low, bad


def test_protected_surfaces_do_not_reference_guidance_gap_apply():
    root = Path(gga.__file__).parents[5]
    for rel in (
        "app_industrial_review_ops.py",
        "src/voc/review_ops/industrial/notion_export.py",
        "src/voc/review_ops/industrial/store.py",
        "src/voc/review_ops/industrial/rag.py",
        "src/voc/review_ops/industrial/issue_discovery.py",
        "src/voc/review_ops/industrial/taxonomy.py",
    ):
        assert "guidance_gap_apply" not in (root / rel).read_text(encoding="utf-8"), rel
