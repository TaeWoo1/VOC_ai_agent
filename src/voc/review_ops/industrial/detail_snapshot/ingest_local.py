"""Local detail-image ingest for the snapshot spike (S2x.2-local).

The live URL capture (:mod:`capture`) is blocked by Coupang anti-bot, which we
will not bypass. Instead, an operator manually saves the product detail-page
images locally and we ingest that folder into the *same* gitignored snapshot
artifact shape — with NO network, NO OCR, NO multimodal, NO OpenAI call.

Visibility boundary (load-bearing): the detail images are **consumer-visible**
product page content. This artifact therefore carries
``source_type="local_detail_images"`` / ``visibility="consumer_visible"`` and
intentionally holds NO operator-internal / seller-only fields. Do not mix
seller-only knowledge into this artifact.

Image dimensions/format are read with Pillow (already a dependency, imported
lazily); files are copied with :mod:`shutil` — the source folder is never
mutated.
"""

from __future__ import annotations

import hashlib
import shutil
from datetime import datetime
from pathlib import Path

from src.voc.review_ops.industrial.detail_snapshot.capture import (
    DEFAULT_ARTIFACT_ROOT,
    write_snapshot_artifacts,
)

LOCAL_SOURCE_TYPE = "local_detail_images"
LOCAL_VISIBILITY = "consumer_visible"
IMAGE_SOURCE_REGION = "operator_local_detail_images"
SUPPORTED_EXTS = (".png", ".jpg", ".jpeg", ".webp")

# extracted_text.txt is a placeholder in this slice: no OCR/text extraction runs.
NO_TEXT_NOTE = (
    "텍스트 추출은 아직 수행하지 않았습니다. "
    "이 스냅샷은 소비자에게 노출되는 상세페이지 이미지 입력입니다."
)


def local_slug(product_name: str, image_dir: str) -> str:
    """A filesystem-safe folder name for a local-image snapshot.

    Derived from a hash of (product_name, source dir) so re-ingesting the same
    folder lands in the same artifact directory.
    """
    digest = hashlib.sha1(f"{product_name}|{image_dir}".encode("utf-8")).hexdigest()[:10]
    return f"local-{digest}"


def _list_images(image_dir: Path) -> list[Path]:
    """Supported image files in ``image_dir``, sorted deterministically by name."""
    files = [
        p
        for p in image_dir.iterdir()
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS
    ]
    return sorted(files, key=lambda p: p.name)


def _read_image_info(path: Path) -> tuple[int, int, str]:
    """(width, height, format) via Pillow. Raises on unreadable images."""
    from PIL import Image  # lazy: keep top-level import free of PIL

    with Image.open(path) as im:
        return int(im.width), int(im.height), (im.format or "").upper()


def _build_local_metadata(
    *,
    status: str,
    product_name: str,
    source_image_dir: str,
    image_count: int,
    copied_image_count: int,
    created_at: str,
    notes: str = "",
) -> dict:
    """Assemble ``snapshot_metadata.json`` for a local-image snapshot.

    Consumer-visible fields only — no operator-internal / seller-only keys.
    """
    return {
        "source_type": LOCAL_SOURCE_TYPE,
        "visibility": LOCAL_VISIBILITY,
        "product_name": product_name or "",
        "source_image_dir": source_image_dir,
        "image_count": image_count,
        "copied_image_count": copied_image_count,
        "text_length": 0,
        "extraction_mode": "none",
        "ocr": False,
        "multimodal": False,
        "status": status,  # ok | partial | error
        "created_at": created_at,
        "notes": notes,
    }


def ingest_local_images(
    image_dir: str | Path,
    *,
    product_name: str = "",
    out_root: str | Path = DEFAULT_ARTIFACT_ROOT,
    now: datetime | None = None,
) -> dict:
    """Ingest a local folder of detail images into a snapshot artifact.

    Copies supported images into ``<out_root>/<slug>/images/`` (source folder is
    never mutated), records per-image dimensions/format/size, and writes the
    standard ``snapshot_metadata.json`` / ``extracted_text.txt`` /
    ``image_manifest.json``. No network, no OCR, no LLM.

    Returns ``{status, snapshot_dir, metadata, paths}``. Fail-soft: a missing
    folder or no supported images yields ``status="error"`` (artifacts still
    written); a per-image failure yields ``status="partial"`` with the error
    recorded on that image entry.
    """
    src = Path(image_dir)
    created_at = (now or datetime.now()).isoformat(timespec="seconds")
    snapshot_dir = Path(out_root) / local_slug(product_name, str(src))

    def _write(status: str, records: list[dict], notes: str) -> dict:
        copied = sum(1 for r in records if r.get("copied"))
        metadata = _build_local_metadata(
            status=status,
            product_name=product_name,
            source_image_dir=str(src),
            image_count=len(records),
            copied_image_count=copied,
            created_at=created_at,
            notes=notes,
        )
        manifest = {"image_source_region": IMAGE_SOURCE_REGION, "images": records}
        paths = write_snapshot_artifacts(
            snapshot_dir,
            metadata=metadata,
            extracted_text=NO_TEXT_NOTE,
            image_manifest=manifest,
        )
        return {"status": status, "snapshot_dir": str(snapshot_dir),
                "metadata": metadata, "paths": paths}

    if not src.exists() or not src.is_dir():
        return _write("error", [], "이미지 폴더를 찾을 수 없습니다.")

    images = _list_images(src)
    if not images:
        return _write("error", [], "지원되는 이미지 파일을 찾지 못했습니다.")

    images_dir = snapshot_dir / "images"
    records: list[dict] = []
    any_error = False
    for i, p in enumerate(images):
        entry: dict = {"original_path": str(p), "order_index": i}
        try:
            local_filename = f"image_{i:03d}{p.suffix.lower()}"
            images_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, images_dir / local_filename)  # copy; never mutate source
            w, h, fmt = _read_image_info(p)
            entry.update(
                {
                    "local_filename": local_filename,
                    "width": w,
                    "height": h,
                    "format": fmt,
                    "file_size_bytes": p.stat().st_size,
                    "copied": True,
                }
            )
        except Exception as exc:  # fail-soft per image
            any_error = True
            entry.update({"copied": False, "error": str(exc)})
        records.append(entry)

    copied = sum(1 for r in records if r.get("copied"))
    if copied == len(records) and not any_error:
        return _write("ok", records, "")
    if copied:
        return _write("partial", records, "일부 이미지를 처리하지 못했습니다.")
    return _write("error", records, "이미지를 하나도 처리하지 못했습니다.")
