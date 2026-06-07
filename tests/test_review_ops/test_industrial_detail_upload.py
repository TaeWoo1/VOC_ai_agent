"""Uploaded-image ingest wiring (S2x.6b): ingest_uploaded_images,
plus the tile-generation wrapper (S2x.6c): make_snapshot_tiles.

Offline, no Streamlit E2E, no OpenAI, no network. Exercises the pure
helpers the Streamlit upload/tile buttons wrap; the directory ingest and the
tiling engine themselves are covered by the S2x.2-local / S2x.3a tests in
test_industrial_detail_snapshot.py.
"""

from __future__ import annotations

import io
import json
from pathlib import Path

from src.voc.review_ops.industrial.detail_snapshot import guidance_gap_wiring as ggw


def _png_bytes(width: int = 4, height: int = 6) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (width, height), (200, 30, 30)).save(buf, format="PNG")
    return buf.getvalue()


def test_uploaded_images_create_snapshot_artifact(tmp_path):
    out = ggw.ingest_uploaded_images(
        [("page1.png", _png_bytes())], product_name="선바로", out_root=tmp_path
    )
    assert out["status"] == "ok"
    snap = Path(out["snapshot_dir"])
    assert snap.is_dir()
    assert snap.parent == tmp_path  # artifact lands directly under out_root
    assert snap.name.startswith("local-")
    assert [p.name for p in sorted((snap / "images").iterdir())] == ["image_000.png"]
    assert (snap / "snapshot_metadata.json").exists()
    assert (snap / "image_manifest.json").exists()
    assert (snap / "extracted_text.txt").exists()


def test_metadata_is_ingest_only(tmp_path):
    out = ggw.ingest_uploaded_images(
        [("page1.png", _png_bytes())], product_name="선바로", out_root=tmp_path
    )
    meta = out["metadata"]
    assert meta["source_type"] == "local_detail_images"
    assert meta["visibility"] == "consumer_visible"
    assert meta["extraction_mode"] == "none"
    assert meta["ocr"] is False
    assert meta["multimodal"] is False
    assert meta["product_name"] == "선바로"
    # ingest ONLY: no extraction draft/review files appear
    snap = Path(out["snapshot_dir"])
    assert not (snap / "product_guidance_draft.json").exists()
    assert not (snap / ggw.REVIEW_FILENAME).exists()


def test_manifest_records_image_details(tmp_path):
    out = ggw.ingest_uploaded_images(
        [("page1.png", _png_bytes(4, 6))], product_name="p", out_root=tmp_path
    )
    manifest = json.loads(
        (Path(out["snapshot_dir"]) / "image_manifest.json").read_text(encoding="utf-8")
    )
    rec = manifest["images"][0]
    assert rec["width"] == 4
    assert rec["height"] == 6
    assert rec["format"] == "PNG"
    assert rec["file_size_bytes"] > 0
    assert rec["copied"] is True


def test_multiple_images_preserve_upload_order(tmp_path):
    # filenames sort against upload order on purpose — order must follow the
    # upload sequence (= detail-page order), not the names.
    out = ggw.ingest_uploaded_images(
        [("z_last.png", _png_bytes(2, 2)), ("a_first.png", _png_bytes(3, 3))],
        product_name="p",
        out_root=tmp_path,
    )
    assert out["status"] == "ok"
    manifest = json.loads(
        (Path(out["snapshot_dir"]) / "image_manifest.json").read_text(encoding="utf-8")
    )
    assert [r["order_index"] for r in manifest["images"]] == [0, 1]
    assert [r["width"] for r in manifest["images"]] == [2, 3]


def test_same_upload_is_idempotent(tmp_path):
    files = [("page1.png", _png_bytes()), ("page2.png", _png_bytes(8, 8))]
    first = ggw.ingest_uploaded_images(files, product_name="p", out_root=tmp_path)
    second = ggw.ingest_uploaded_images(files, product_name="p", out_root=tmp_path)
    assert first["status"] == second["status"] == "ok"
    assert first["snapshot_dir"] == second["snapshot_dir"]


def test_empty_or_blank_uploads_fail_soft(tmp_path):
    for empty in (None, [], [("", b"")], [("x.png", b"")], [("", _png_bytes())]):
        out = ggw.ingest_uploaded_images(empty, product_name="p", out_root=tmp_path)
        assert out["status"] == "error"
        assert out["snapshot_dir"] == ""
    # nothing written for empty inputs
    assert list(tmp_path.iterdir()) == []


def test_unreadable_image_bytes_fail_soft(tmp_path):
    out = ggw.ingest_uploaded_images(
        [("bad.png", b"not an image")], product_name="p", out_root=tmp_path
    )
    # artifact still written (status error), app keeps working
    assert out["status"] == "error"
    assert Path(out["snapshot_dir"]).is_dir()
    assert (Path(out["snapshot_dir"]) / "snapshot_metadata.json").exists()


# --- S2x.6c: snapshot -> tiles wrapper ---------------------------------------


def _uploaded_snapshot(tmp_path, *, height: int = 250) -> Path:
    out = ggw.ingest_uploaded_images(
        [("tall.png", _png_bytes(8, height))], product_name="p", out_root=tmp_path
    )
    assert out["status"] == "ok"
    return Path(out["snapshot_dir"])


def test_tiles_created_for_tall_image(tmp_path):
    snap = _uploaded_snapshot(tmp_path, height=250)
    # 250px tall at tile_height=100/overlap=10 -> bounds (0,100),(90,190),(180,250)
    out = ggw.make_snapshot_tiles(snap, tile_height=100, overlap_px=10)
    assert out["status"] == "ok"
    assert out["tile_count"] == 3
    tiles_dir = Path(out["tiles_dir"])
    assert tiles_dir == snap / "tiles"
    assert sorted(p.name for p in tiles_dir.iterdir()) == [
        "tile_000_000.jpg",
        "tile_000_001.jpg",
        "tile_000_002.jpg",
    ]
    manifest = json.loads((snap / "tiles_manifest.json").read_text(encoding="utf-8"))
    assert manifest["status"] == "ok"
    assert manifest["tiling_params"]["tile_count"] == 3
    assert manifest["tiling_params"]["source_image_count"] == 1


def test_short_image_yields_single_tile(tmp_path):
    snap = _uploaded_snapshot(tmp_path, height=50)
    out = ggw.make_snapshot_tiles(snap, tile_height=100, overlap_px=10)
    assert out["status"] == "ok"
    assert out["tile_count"] == 1


def test_missing_snapshot_fails_soft(tmp_path):
    for bad in (None, "", "   "):
        out = ggw.make_snapshot_tiles(bad)
        assert out["status"] == "error"
        assert out["tile_count"] == 0
    assert list(tmp_path.iterdir()) == []  # blank inputs touch nothing
    out = ggw.make_snapshot_tiles(tmp_path / "nope")
    assert out["status"] == "error"
    assert out["tile_count"] == 0


def test_missing_images_fails_soft(tmp_path):
    import shutil

    snap = _uploaded_snapshot(tmp_path)
    shutil.rmtree(snap / "images")
    out = ggw.make_snapshot_tiles(snap, tile_height=100, overlap_px=10)
    assert out["status"] == "error"
    assert out["tile_count"] == 0
    # failure is still recorded in the manifest, app keeps working
    manifest = json.loads((snap / "tiles_manifest.json").read_text(encoding="utf-8"))
    assert manifest["status"] == "error"


def test_regeneration_is_deterministic_overwrite(tmp_path):
    snap = _uploaded_snapshot(tmp_path, height=250)
    first = ggw.make_snapshot_tiles(snap, tile_height=100, overlap_px=10)
    second = ggw.make_snapshot_tiles(snap, tile_height=100, overlap_px=10)
    assert first["tile_count"] == second["tile_count"] == 3
    # no duplicated/stale tiles linger
    assert len(list((snap / "tiles").iterdir())) == 3
    # smaller re-run replaces, never accumulates
    third = ggw.make_snapshot_tiles(snap, tile_height=300, overlap_px=10)
    assert third["tile_count"] == 1
    assert len(list((snap / "tiles").iterdir())) == 1


def test_tiling_creates_no_guidance_files(tmp_path):
    snap = _uploaded_snapshot(tmp_path)
    ggw.make_snapshot_tiles(snap, tile_height=100, overlap_px=10)
    assert not (snap / "product_guidance_draft.json").exists()
    assert not (snap / ggw.REVIEW_FILENAME).exists()


def test_wiring_module_stays_ingest_only():
    src = Path(ggw.__file__).read_text(encoding="utf-8")
    low = src.lower()
    for bad in (
        "import openai",
        "from openai",
        "import requests",
        "import httpx",
        "import socket",
        "urllib.request",
        "multimodal_extract",
        "guidance_postprocess",
        "import streamlit",
        "from streamlit",
    ):
        assert bad not in low, bad
