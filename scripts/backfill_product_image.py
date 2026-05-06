"""Backfill a product image into an existing run package.

Use case
--------
Collection runs prior to the v2.4 image policy did not capture a
product image. The cardnews skill renders cover-cutout pages from a
LOCAL pre-fetched image, never a live URL fetch at render time. This
CLI populates an existing run's `assets/<slug>.{ext}` and updates
`shared/analysis_report.json` so re-rendering the cardnews picks up
the image automatically.

Usage
-----

    # Fetch from URL (most common — operator paste from product page)
    python -m scripts.backfill_product_image \
        --run-dir outputs/content_packages/2026-04-30_mediheal_pad_run-010 \
        --image-url https://image.oliveyoung.co.kr/.../mediheal-pad.jpg \
        --source oliveyoung

    # Copy from a local file (operator pre-saved image)
    python -m scripts.backfill_product_image \
        --run-dir outputs/content_packages/<run> \
        --image-path /tmp/mediheal-pad.jpg \
        --source manual

The CLI:

  * Writes the image to `<run-dir>/assets/<sanitized_slug>.{ext}`
    (refuses to write outside that dir).
  * Writes a sidecar `<run-dir>/assets/<sanitized_slug>_meta.json`
    with the URL, content_type, source label, and fetched_at.
  * Updates `<run-dir>/shared/analysis_report.json` in place:
    `product.image_url` (when fetched from URL),
    `product.image_local_path` (run-relative), and
    `product.image_source`.

The CLI is idempotent — re-running with the same args overwrites the
cached image and the analysis_report fields. Failures are reported
non-zero; nothing is written on a failed fetch.
"""
from __future__ import annotations

import argparse
import json
import logging
import shutil
import sys
from pathlib import Path

from src.voc.content.product_image_fetcher import (
    fetch_and_cache_product_image,
    sanitize_slug,
)


_LOG = logging.getLogger("voc.scripts.backfill_product_image")


def _load_analysis_report(run_dir: Path) -> tuple[Path, dict]:
    report_path = run_dir / "shared" / "analysis_report.json"
    if not report_path.is_file():
        raise FileNotFoundError(
            f"analysis_report.json not found at {report_path}"
        )
    return report_path, json.loads(report_path.read_text(encoding="utf-8"))


def _copy_local_image(
    *, src: Path, run_dir: Path, slug: str, source: str | None,
) -> dict:
    """Copy a local file into `<run-dir>/assets/<slug>.{ext}`.

    Mirrors the URL-fetch path's contract — same return shape (meta
    dict) and same write boundary."""
    src = src.expanduser().resolve()
    if not src.is_file():
        raise FileNotFoundError(f"image-path not found: {src}")
    safe_slug = sanitize_slug(slug)
    assets_dir = run_dir.resolve() / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    ext = src.suffix.lower() or ".bin"
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
        _LOG.warning(
            "image-path %s has unrecognized extension %r; "
            "saving with .bin and is_known_image_type=False",
            src, ext,
        )
        ext = ".bin"
        is_known = False
    else:
        is_known = True
        if ext == ".jpeg":
            ext = ".jpg"

    target = assets_dir / f"{safe_slug}{ext}"
    if target.resolve().parent != assets_dir.resolve():
        raise RuntimeError(
            f"refusing to write outside assets dir (target={target})"
        )
    shutil.copyfile(src, target)
    rel_path = target.relative_to(run_dir.resolve()).as_posix()

    meta = {
        "url": None,
        "local_path": rel_path,
        "source": source or "manual",
        "content_type": None,
        "is_known_image_type": is_known,
        "fetched_at": None,
        "byte_size": target.stat().st_size,
        "copied_from": str(src),
    }
    sidecar = assets_dir / f"{safe_slug}_meta.json"
    sidecar.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    return meta


def _update_analysis_report(
    *,
    report_path: Path,
    report: dict,
    image_url: str | None,
    local_path: str,
    source: str | None,
) -> None:
    product = report.setdefault("product", {})
    if image_url is not None:
        product["image_url"] = image_url
    product["image_local_path"] = local_path
    product["image_source"] = source
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    parser = argparse.ArgumentParser(
        description=(
            "Backfill a product image into an existing run package. "
            "Writes the image to <run-dir>/assets/ and updates "
            "<run-dir>/shared/analysis_report.json so the cardnews "
            "renderer can use the local image at render time."
        )
    )
    parser.add_argument("--run-dir", required=True, type=Path,
                        help="Path to outputs/content_packages/<run>/")
    src_group = parser.add_mutually_exclusive_group(required=True)
    src_group.add_argument("--image-url", type=str, default=None,
                           help="HTTPS URL to fetch the image from.")
    src_group.add_argument("--image-path", type=Path, default=None,
                           help="Local file to copy into the run's assets/.")
    parser.add_argument(
        "--source", type=str, default=None,
        help="Source label recorded in the sidecar + analysis_report. "
             "Conventional values: oliveyoung | coupang | manual | "
             "og_image | json_ld.",
    )
    parser.add_argument(
        "--user-agent", type=str, default=None,
        help="User-Agent header for the URL fetch. Optional.",
    )
    args = parser.parse_args(argv)

    run_dir = Path(args.run_dir).expanduser().resolve()
    if not run_dir.is_dir():
        parser.error(f"run-dir not found or not a directory: {run_dir}")

    try:
        report_path, report = _load_analysis_report(run_dir)
    except FileNotFoundError as e:
        parser.error(str(e))

    product_block = report.get("product") or {}
    slug = (
        product_block.get("slug")
        or (product_block.get("name_ko") or "")
        or run_dir.name
    )

    if args.image_url:
        meta = fetch_and_cache_product_image(
            url=args.image_url,
            run_dir=run_dir,
            slug=slug,
            source=args.source,
            user_agent=args.user_agent,
        )
        if meta is None:
            print(
                f"product image fetch failed for url={args.image_url}",
                file=sys.stderr, flush=True,
            )
            return 2
        image_url = args.image_url
        local_path = meta["local_path"]
    else:
        try:
            meta = _copy_local_image(
                src=args.image_path,
                run_dir=run_dir,
                slug=slug,
                source=args.source,
            )
        except (FileNotFoundError, RuntimeError) as e:
            print(f"product image copy failed: {e}", file=sys.stderr, flush=True)
            return 2
        image_url = None
        local_path = meta["local_path"]

    _update_analysis_report(
        report_path=report_path,
        report=report,
        image_url=image_url,
        local_path=local_path,
        source=args.source,
    )

    print(
        f"backfilled product image → {run_dir}/{local_path} "
        f"(source={args.source or 'unspecified'}, "
        f"size={meta['byte_size']} bytes)",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
