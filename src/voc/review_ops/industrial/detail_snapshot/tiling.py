"""Local detail-image tiling/prep for the snapshot spike (S2x.3a).

Pure and offline: splits tall consumer-visible detail images into overlapping
vertical tiles so they can be inspected (and, in a later opt-in slice, read by a
multimodal model). NO OCR, NO multimodal, NO OpenAI, NO network — Pillow only,
imported lazily so this module stays import-light.

Operates on an existing snapshot artifact folder (produced by ``ingest_local`` /
``capture``): reads ``image_manifest.json`` + ``images/``, writes ``tiles/`` +
``tiles_manifest.json``.

Filename scheme (deterministic, multi-image safe):
    tiles/tile_<image_index:03d>_<tile_index:03d>.jpg
``image_index`` is the 0-based position among the ingested images actually
processed; ``tile_index`` is the 0-based tile within that image; ``order_index``
is a global 0-based counter across all tiles in (image, tile) order.

Tiling is vertical only — full image width is preserved. Re-running replaces any
existing ``tiles/`` so stale tiles from a different tile-height never linger.
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path

DEFAULT_TILE_HEIGHT = 2000
DEFAULT_OVERLAP_PX = 150


def compute_tile_bounds(
    image_height: int,
    *,
    tile_height: int = DEFAULT_TILE_HEIGHT,
    overlap_px: int = DEFAULT_OVERLAP_PX,
) -> list[tuple[int, int]]:
    """Return ordered ``(y0, y1)`` vertical tile bounds for one image. Pure.

    Tiles are ``tile_height`` tall, stepping by ``tile_height - overlap_px``; the
    last tile is clamped to the image bottom. An image no taller than
    ``tile_height`` yields a single full-height tile.
    """
    if tile_height <= 0:
        raise ValueError("tile_height must be > 0")
    if overlap_px < 0 or overlap_px >= tile_height:
        raise ValueError("overlap_px must satisfy 0 <= overlap_px < tile_height")
    if image_height <= 0:
        return []
    if image_height <= tile_height:
        return [(0, image_height)]

    step = tile_height - overlap_px
    bounds: list[tuple[int, int]] = []
    y0 = 0
    while y0 < image_height:
        y1 = min(y0 + tile_height, image_height)
        bounds.append((y0, y1))
        if y1 >= image_height:
            break
        y0 += step
    return bounds


def _error_result(snapshot_dir: Path, reason: str, manifest_path: Path | None = None) -> dict:
    return {
        "status": "error",
        "reason": reason,
        "snapshot_dir": str(snapshot_dir),
        "manifest_path": str(manifest_path) if manifest_path else None,
        "tile_count": 0,
        "tiles_dir": None,
    }


def _write_manifest(
    manifest_path: Path,
    *,
    status: str,
    reason: str,
    tiles: list[dict],
    errors: list[dict],
    tile_height: int,
    overlap_px: int,
    source_image_count: int,
    created_at: str,
) -> None:
    manifest = {
        "status": status,
        "reason": reason,
        "created_at": created_at,
        "tiling_params": {
            "tile_height": tile_height,
            "overlap_px": overlap_px,
            "source_image_count": source_image_count,
            "tile_count": len(tiles),
        },
        "tiles": tiles,
        "errors": errors,
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def make_tiles(
    snapshot_dir: str | Path,
    *,
    tile_height: int = DEFAULT_TILE_HEIGHT,
    overlap_px: int = DEFAULT_OVERLAP_PX,
    now: datetime | None = None,
) -> dict:
    """Tile the ingested images in a snapshot folder into ``tiles/``.

    Reads ``<snapshot_dir>/image_manifest.json`` and the copied images under
    ``images/``, writes vertical tiles + ``tiles_manifest.json``. Returns
    ``{status, snapshot_dir, manifest_path, tile_count, tiles_dir}``.

    Fail-soft: a missing folder/manifest/images yields ``status="error"``; a
    single unreadable image yields ``status="partial"`` (or ``error`` if none
    succeed) with the failure recorded in the manifest ``errors``. No network.
    """
    d = Path(snapshot_dir)
    created_at = (now or datetime.now()).isoformat(timespec="seconds")

    if not d.exists() or not d.is_dir():
        return _error_result(d, "snapshot_dir를 찾을 수 없습니다.")

    manifest_path = d / "image_manifest.json"
    tiles_manifest_path = d / "tiles_manifest.json"
    if not manifest_path.exists():
        _write_manifest(
            tiles_manifest_path, status="error", reason="image_manifest.json이 없습니다.",
            tiles=[], errors=[], tile_height=tile_height, overlap_px=overlap_px,
            source_image_count=0, created_at=created_at,
        )
        return _error_result(d, "image_manifest.json이 없습니다.", tiles_manifest_path)

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:
        _write_manifest(
            tiles_manifest_path, status="error", reason=f"image_manifest.json 파싱 실패: {exc}",
            tiles=[], errors=[], tile_height=tile_height, overlap_px=overlap_px,
            source_image_count=0, created_at=created_at,
        )
        return _error_result(d, f"image_manifest.json 파싱 실패: {exc}", tiles_manifest_path)

    images_dir = d / "images"
    sources = [
        img for img in (manifest.get("images") or [])
        if img.get("copied") and img.get("local_filename")
        and (images_dir / img["local_filename"]).exists()
    ]
    if not sources:
        _write_manifest(
            tiles_manifest_path, status="error", reason="처리할 이미지가 없습니다.",
            tiles=[], errors=[], tile_height=tile_height, overlap_px=overlap_px,
            source_image_count=0, created_at=created_at,
        )
        return _error_result(d, "처리할 이미지가 없습니다.", tiles_manifest_path)

    from PIL import Image  # lazy: keep module import free of PIL

    # Replace any prior tiles so a re-run with different params leaves no orphans.
    tiles_dir = d / "tiles"
    if tiles_dir.exists():
        shutil.rmtree(tiles_dir)

    tiles: list[dict] = []
    errors: list[dict] = []
    order_index = 0
    for image_index, img in enumerate(sources):
        rel_source = f"images/{img['local_filename']}"
        src_path = images_dir / img["local_filename"]
        try:
            with Image.open(src_path) as im:
                im = im.convert("RGB") if im.mode not in ("RGB", "L") else im
                width, height = im.width, im.height
                for tile_index, (y0, y1) in enumerate(
                    compute_tile_bounds(height, tile_height=tile_height, overlap_px=overlap_px)
                ):
                    tile = im.crop((0, y0, width, y1))
                    filename = f"tile_{image_index:03d}_{tile_index:03d}.jpg"
                    tiles_dir.mkdir(parents=True, exist_ok=True)
                    tile_path = tiles_dir / filename
                    tile.save(tile_path, format="JPEG", quality=90)
                    tiles.append(
                        {
                            "source_image": rel_source,
                            "local_filename": filename,
                            "order_index": order_index,
                            "image_index": image_index,
                            "tile_index": tile_index,
                            "y0": y0,
                            "y1": y1,
                            "width": width,
                            "height": y1 - y0,
                            "overlap_px": overlap_px,
                            "file_size_bytes": tile_path.stat().st_size,
                        }
                    )
                    order_index += 1
        except Exception as exc:  # fail-soft per source image
            errors.append({"source_image": rel_source, "error": str(exc)})

    if tiles and errors:
        status = "partial"
        reason = "일부 이미지를 타일링하지 못했습니다."
    elif tiles:
        status = "ok"
        reason = ""
    else:
        status = "error"
        reason = "타일을 하나도 생성하지 못했습니다."

    _write_manifest(
        tiles_manifest_path, status=status, reason=reason, tiles=tiles, errors=errors,
        tile_height=tile_height, overlap_px=overlap_px,
        source_image_count=len(sources), created_at=created_at,
    )
    return {
        "status": status,
        "snapshot_dir": str(d),
        "manifest_path": str(tiles_manifest_path),
        "tile_count": len(tiles),
        "tiles_dir": str(tiles_dir) if tiles else None,
    }
