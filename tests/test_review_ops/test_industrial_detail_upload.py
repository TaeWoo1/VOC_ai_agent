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


# --- S2x.6d: tiles -> guidance draft wrapper (mocks only, never OpenAI) ------


def _tiled_snapshot(tmp_path) -> Path:
    snap = _uploaded_snapshot(tmp_path, height=250)
    out = ggw.make_snapshot_tiles(snap, tile_height=100, overlap_px=10)
    assert out["status"] == "ok"
    return snap


def _raise_extractor(path, *, model):  # noqa: ARG001 - signature fixed by seam
    raise AssertionError("extractor must not be called")


def test_extract_disabled_is_skipped_and_calls_nothing(tmp_path):
    snap = _tiled_snapshot(tmp_path)
    out = ggw.extract_snapshot_guidance_draft(
        snap, enable_multimodal=False, tile_extractor=_raise_extractor
    )
    assert out["status"] == "skipped"
    assert out["draft_path"] is None
    assert not (snap / "product_guidance_draft.json").exists()


def test_extract_empty_path_fails_soft(tmp_path):
    for empty in (None, "", "   "):
        out = ggw.extract_snapshot_guidance_draft(empty, enable_multimodal=True)
        assert out["status"] == "error"
        assert out["draft_path"] is None
    assert list(tmp_path.iterdir()) == []  # nothing written anywhere


def test_extract_without_tiles_asks_to_create_tiles_first(tmp_path):
    snap = _uploaded_snapshot(tmp_path)  # ingested, but no tiles generated
    out = ggw.extract_snapshot_guidance_draft(
        snap, enable_multimodal=True, tile_extractor=_raise_extractor
    )
    assert out["status"] == "error"
    assert "타일을 생성하세요" in out["reason"]
    assert not (snap / "product_guidance_draft.json").exists()


def test_extract_missing_key_skips_without_draft(tmp_path, monkeypatch):
    snap = _tiled_snapshot(tmp_path)
    # no injected extractor -> key gate applies; force "no key" regardless of env
    monkeypatch.setattr(
        "src.voc.review_ops.industrial.detail_snapshot.multimodal_extract.resolve_api_key",
        lambda: None,
    )
    out = ggw.extract_snapshot_guidance_draft(snap, enable_multimodal=True)
    assert out["status"] == "skipped_no_key"
    assert out["draft_path"] is None
    assert not (snap / "product_guidance_draft.json").exists()


def test_extract_with_mock_extractor_writes_draft(tmp_path):
    snap = _tiled_snapshot(tmp_path)
    calls: list[str] = []

    def mock_extractor(path, *, model):
        calls.append(path.name)
        return {
            "usage_installation": [
                {"value": "부착 전 물기/먼지 제거", "confidence": "high"}
            ],
        }

    out = ggw.extract_snapshot_guidance_draft(
        snap, enable_multimodal=True, model="mock-model", tile_extractor=mock_extractor
    )
    assert out["status"] == "ok"
    assert out["tile_count"] == 3
    assert out["success_count"] == 3
    assert out["confidence"]
    assert calls == ["tile_000_000.jpg", "tile_000_001.jpg", "tile_000_002.jpg"]
    draft_path = Path(out["draft_path"])
    assert draft_path == snap / "product_guidance_draft.json"
    draft = json.loads(draft_path.read_text(encoding="utf-8"))
    assert draft["extraction_mode"] == "multimodal_draft"
    assert draft["needs_operator_review"] is True
    assert draft["model"] == "mock-model"
    # draft ONLY: no postprocess output, no review file
    assert not (snap / ggw.REVIEW_FILENAME).exists()


def test_app_reaches_extraction_only_via_wiring_helper():
    root = Path(ggw.__file__).parents[5]
    app_src = (root / "app_industrial_review_ops.py").read_text(encoding="utf-8")
    assert "extract_snapshot_guidance_draft" in app_src
    assert "multimodal_extract" not in app_src
    assert "extract_guidance(" not in app_src  # engine entrypoint stays unimported


# --- S2x.6e: draft -> review postprocess wrapper (local-only) ----------------


def _drafted_snapshot(tmp_path) -> Path:
    """Snapshot with a real extraction draft, built via the mock seam."""
    snap = _tiled_snapshot(tmp_path)
    out = ggw.extract_snapshot_guidance_draft(
        snap,
        enable_multimodal=True,
        model="mock-model",
        tile_extractor=lambda p, *, model: {
            "usage_installation": [
                {"value": "부착 전 물기/먼지 제거",
                 "verbatim": "부착할 위치의 물기나 먼지를 깨끗이 닦아내 주세요.",
                 "confidence": "high"},
                {"value": "피스/실리콘 고정",
                 "verbatim": "피스나 실리콘을 이용하면 더욱 단단하게 고정이 가능합니다.",
                 "confidence": "high"},
            ],
            "cutting_handling": [
                {"value": "가위로 재단", "verbatim": "가위로 재단하세요.",
                 "confidence": "high"},
            ],
        },
    )
    assert out["status"] == "ok"
    return snap


def test_review_empty_path_fails_soft(tmp_path):
    for empty in (None, "", "   "):
        out = ggw.review_snapshot_guidance_draft(empty)
        assert out["status"] == "error"
        assert out["review_path"] is None
    assert list(tmp_path.iterdir()) == []  # nothing written anywhere


def test_review_missing_draft_asks_to_extract_first(tmp_path):
    snap = _tiled_snapshot(tmp_path)  # tiles exist, but no draft
    out = ggw.review_snapshot_guidance_draft(snap)
    assert out["status"] == "error"
    assert "초안을 생성하세요" in out["reason"]
    assert not (snap / ggw.REVIEW_FILENAME).exists()


def test_review_written_from_existing_draft(tmp_path):
    snap = _drafted_snapshot(tmp_path)
    out = ggw.review_snapshot_guidance_draft(snap)
    assert out["status"] == "ok"
    review_path = Path(out["review_path"])
    assert review_path == snap / ggw.REVIEW_FILENAME
    review = json.loads(review_path.read_text(encoding="utf-8"))
    # schema consumed by gap_apply / preview / Notion export
    for key in ("confirmed_guidance", "not_found_guidance",
                "review_gap_ready_signals", "quality_flags"):
        assert key in review, key
    assert review["needs_operator_review"] is True
    assert review["consumer_visible_only"] is True
    # summary counts surfaced for the UI
    assert out["confirmed_count"] >= 1
    assert isinstance(out["not_found_count"], int)
    assert isinstance(out["gap_signal_count"], int)
    assert isinstance(out["quality_flag_count"], int)


def test_review_flows_into_existing_gap_attach(tmp_path):
    # once the review exists, the S2x.5b attach path works naturally
    snap = _drafted_snapshot(tmp_path)
    assert ggw.review_snapshot_guidance_draft(snap)["status"] == "ok"
    result = {"issue_items": [{"issue_title": "접착력 부족"},
                              {"issue_title": "절단 시 깨짐"}]}
    out = ggw.attach_detail_guidance_gaps(result, snap)
    assert "detail_guidance_gaps" in out
    assert [g["issue_title"] for g in out["detail_guidance_gaps"]] == [
        "접착력 부족", "절단 시 깨짐"]


def test_review_overwrite_is_deterministic_and_draft_untouched(tmp_path):
    import hashlib

    snap = _drafted_snapshot(tmp_path)
    draft_path = snap / "product_guidance_draft.json"
    draft_hash_before = hashlib.sha256(draft_path.read_bytes()).hexdigest()

    first = ggw.review_snapshot_guidance_draft(snap)
    r1 = json.loads(Path(first["review_path"]).read_text(encoding="utf-8"))
    second = ggw.review_snapshot_guidance_draft(snap)
    r2 = json.loads(Path(second["review_path"]).read_text(encoding="utf-8"))
    # identical content modulo the run timestamp; nothing duplicated
    r1.pop("generated_at"), r2.pop("generated_at")
    assert r1 == r2
    assert first["confirmed_count"] == second["confirmed_count"]
    # the draft is read, never modified
    assert hashlib.sha256(draft_path.read_bytes()).hexdigest() == draft_hash_before


def test_app_reaches_postprocess_only_via_wiring_helper():
    root = Path(ggw.__file__).parents[5]
    app_src = (root / "app_industrial_review_ops.py").read_text(encoding="utf-8")
    assert "review_snapshot_guidance_draft" in app_src
    assert "guidance_postprocess" not in app_src
    assert "review_guidance_draft(" not in app_src  # engine entrypoint stays unimported


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


def test_wiring_module_has_no_direct_network_or_ui_import():
    # S2x.6d/6e note: the wiring module now intentionally imports
    # multimodal_extract (the opt-in extraction seam — the extractor owns the
    # key gate and the only OpenAI use) and guidance_postprocess (the
    # deterministic local review seam). Direct network/UI imports stay banned.
    src = Path(ggw.__file__).read_text(encoding="utf-8")
    low = src.lower()
    for bad in (
        "import openai",
        "from openai",
        "import requests",
        "import httpx",
        "import socket",
        "urllib.request",
        "import streamlit",
        "from streamlit",
    ):
        assert bad not in low, bad
