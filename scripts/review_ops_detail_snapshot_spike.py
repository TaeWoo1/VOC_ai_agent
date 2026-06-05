#!/usr/bin/env python3
"""S2x.1 — Coupang detail-page snapshot feasibility spike (capture-only).

Read-only, single operator-provided URL. Captures a local snapshot artifact
(page text, image manifest, screenshot) under a gitignored output folder so we
can judge whether product guidance is extractable from the detail page.

This is NOT a scraper: one URL, one read-only page load, no login/captcha/
anti-bot bypass, no crawling, no scheduling, no OCR, no multimodal, no OpenAI.
Run only against a URL the operator explicitly provides and authorizes.

Two modes (mutually exclusive):
- URL capture (--url): live read-only Coupang detail-page snapshot.
- Local ingest (--image-dir): ingest an operator-saved folder of detail images
  (consumer-visible page content) with no network at all.

Usage:
    # URL capture
    PYTHONPATH=. python3 scripts/review_ops_detail_snapshot_spike.py \
        --url "https://www.coupang.com/vp/products/<id>?..." \
        [--out-dir .review_ops_data/detail_snapshots] \
        [--download-sample-images] \
        [--timeout-ms 30000]

    # Local detail-image ingest (no network)
    PYTHONPATH=. python3 scripts/review_ops_detail_snapshot_spike.py \
        --image-dir "/path/to/detail/images" \
        --product-name "<product name>" \
        [--out-dir .review_ops_data/detail_snapshots]
"""

from __future__ import annotations

import argparse
import sys

from src.voc.review_ops.industrial.detail_snapshot.capture import (
    DEFAULT_ARTIFACT_ROOT,
    DEFAULT_MAX_SAMPLE_IMAGES,
    DEFAULT_TIMEOUT_MS,
    SnapshotDependencyError,
    capture_snapshot,
)
from src.voc.review_ops.industrial.detail_snapshot.ingest_local import (
    ingest_local_images,
)
from src.voc.review_ops.industrial.detail_snapshot.parse import (
    validate_coupang_product_url,
)
from src.voc.review_ops.industrial.detail_snapshot.guidance_postprocess import (
    review_guidance_draft,
)
from src.voc.review_ops.industrial.detail_snapshot.multimodal_extract import (
    extract_guidance,
)
from src.voc.review_ops.industrial.detail_snapshot.tiling import (
    DEFAULT_OVERLAP_PX,
    DEFAULT_TILE_HEIGHT,
    make_tiles,
)


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Coupang detail-page snapshot feasibility spike (capture-only).",
    )
    p.add_argument("--url", help="One Coupang product detail URL (URL capture mode).")
    p.add_argument(
        "--image-dir",
        help="Local folder of operator-saved detail images (local ingest mode, no network).",
    )
    p.add_argument(
        "--product-name", default="", help="Product name (local ingest mode)."
    )
    p.add_argument(
        "--out-dir",
        default=DEFAULT_ARTIFACT_ROOT,
        help=f"Artifact root (gitignored). Default: {DEFAULT_ARTIFACT_ROOT}",
    )
    p.add_argument(
        "--download-sample-images",
        action="store_true",
        help=f"Download at most {DEFAULT_MAX_SAMPLE_IMAGES} detail images (default: off).",
    )
    p.add_argument(
        "--timeout-ms", type=int, default=DEFAULT_TIMEOUT_MS, help="Per-load timeout (ms)."
    )
    p.add_argument(
        "--make-tiles",
        action="store_true",
        help="Tile mode: split an existing snapshot's images into vertical tiles (no network).",
    )
    p.add_argument(
        "--snapshot-dir",
        help="Existing snapshot artifact folder to tile (tile mode).",
    )
    p.add_argument(
        "--tile-height", type=int, default=DEFAULT_TILE_HEIGHT,
        help=f"Tile height in px (tile mode). Default: {DEFAULT_TILE_HEIGHT}",
    )
    p.add_argument(
        "--overlap-px", type=int, default=DEFAULT_OVERLAP_PX,
        help=f"Vertical overlap in px (tile mode). Default: {DEFAULT_OVERLAP_PX}",
    )
    p.add_argument(
        "--extract-guidance",
        action="store_true",
        help="Guidance mode: multimodal extraction from an existing snapshot's tiles.",
    )
    p.add_argument(
        "--enable-multimodal",
        action="store_true",
        help="Explicit opt-in to send tile images to the vision model (required for extraction).",
    )
    p.add_argument(
        "--review-guidance-draft",
        action="store_true",
        help="Review mode: deterministic post-process of an existing guidance draft (no network).",
    )
    return p


def _run_local_ingest(args) -> int:
    result = ingest_local_images(
        args.image_dir, product_name=args.product_name, out_root=args.out_dir
    )
    meta = result.get("metadata", {})
    print("mode        : local_detail_images")
    print(f"status      : {result['status']}")
    print(f"snapshot_dir: {result['snapshot_dir']}")
    if meta.get("notes"):
        print(f"notes       : {meta['notes']}")
    print(f"product_name: {meta.get('product_name', '')}")
    print(f"visibility  : {meta.get('visibility', '')}")
    print(f"image_count : {meta.get('image_count', 0)}")
    print(f"copied      : {meta.get('copied_image_count', 0)}")
    print("note        : local ingest — no network, no OCR, no multimodal, no OpenAI.")
    return 0


def _run_make_tiles(args) -> int:
    result = make_tiles(
        args.snapshot_dir, tile_height=args.tile_height, overlap_px=args.overlap_px
    )
    print("mode        : make_tiles")
    print(f"status      : {result['status']}")
    print(f"snapshot_dir: {result['snapshot_dir']}")
    if result.get("reason"):
        print(f"reason      : {result['reason']}")
    print(f"manifest    : {result.get('manifest_path')}")
    print(f"tile_count  : {result.get('tile_count', 0)}")
    print("note        : tiling only — no network, no OCR, no multimodal, no OpenAI.")
    return 0


def _run_extract_guidance(args) -> int:
    result = extract_guidance(args.snapshot_dir, enable_multimodal=True)
    print("mode        : extract_guidance")
    print(f"status      : {result['status']}")
    print(f"snapshot_dir: {result['snapshot_dir']}")
    if result.get("reason"):
        print(f"reason      : {result['reason']}")
    if result.get("draft_path"):
        print(f"draft       : {result['draft_path']}")
        print(f"tiles       : {result.get('success_count', 0)}/{result.get('tile_count', 0)}")
        print(f"confidence  : {result.get('confidence', '')}")
    print("note        : multimodal DRAFT — needs operator review; not auto-applied anywhere.")
    return 0


def _run_review_guidance(args) -> int:
    result = review_guidance_draft(args.snapshot_dir)
    print("mode        : review_guidance_draft")
    print(f"status      : {result['status']}")
    print(f"snapshot_dir: {result['snapshot_dir']}")
    if result.get("reason"):
        print(f"reason      : {result['reason']}")
    if result.get("review_path"):
        print(f"review      : {result['review_path']}")
        print(f"not_found   : {result.get('not_found_count', 0)}")
        print(f"gap_signals : {result.get('gap_signal_count', 0)}")
        print(f"flags       : {result.get('quality_flag_count', 0)}")
    print("note        : deterministic post-process — review/check candidates; no OpenAI, no network.")
    return 0


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    if args.review_guidance_draft:
        if args.url or args.image_dir or args.make_tiles or args.extract_guidance:
            print("[reject] --review-guidance-draft 는 다른 모드와 함께 사용할 수 없습니다.",
                  file=sys.stderr)
            return 2
        if not args.snapshot_dir:
            print("[reject] --review-guidance-draft 에는 --snapshot-dir 가 필요합니다.",
                  file=sys.stderr)
            return 2
        return _run_review_guidance(args)

    if args.extract_guidance:
        if args.url or args.image_dir or args.make_tiles:
            print("[reject] --extract-guidance 는 다른 모드와 함께 사용할 수 없습니다.",
                  file=sys.stderr)
            return 2
        if not args.snapshot_dir:
            print("[reject] --extract-guidance 에는 --snapshot-dir 가 필요합니다.", file=sys.stderr)
            return 2
        if not args.enable_multimodal:
            print("[reject] --extract-guidance 에는 --enable-multimodal 가 필요합니다.",
                  file=sys.stderr)
            return 2
        return _run_extract_guidance(args)

    if args.make_tiles:
        if args.url or args.image_dir:
            print("[reject] --make-tiles 는 --url/--image-dir 와 함께 사용할 수 없습니다.",
                  file=sys.stderr)
            return 2
        if not args.snapshot_dir:
            print("[reject] --make-tiles 에는 --snapshot-dir 가 필요합니다.", file=sys.stderr)
            return 2
        return _run_make_tiles(args)

    if args.image_dir and args.url:
        print("[reject] --url 와 --image-dir 는 함께 사용할 수 없습니다.", file=sys.stderr)
        return 2
    if args.image_dir:
        return _run_local_ingest(args)
    if not args.url:
        print("[reject] --url 또는 --image-dir 중 하나가 필요합니다.", file=sys.stderr)
        return 2

    ok, reason = validate_coupang_product_url(args.url)
    if not ok:
        print(f"[reject] {reason}", file=sys.stderr)
        return 2

    try:
        result = capture_snapshot(
            args.url,
            out_root=args.out_dir,
            download_sample_images_flag=args.download_sample_images,
            timeout_ms=args.timeout_ms,
        )
    except SnapshotDependencyError as exc:
        print(f"[dependency] {exc}", file=sys.stderr)
        return 3
    except ValueError as exc:
        print(f"[reject] {exc}", file=sys.stderr)
        return 2

    status = result["status"]
    print(f"status      : {status}")
    print(f"snapshot_dir: {result['snapshot_dir']}")
    meta = result.get("metadata", {})
    if meta.get("reason"):
        print(f"reason      : {meta['reason']}")
    print(f"title       : {meta.get('title', '')}")
    print(f"text_length : {meta.get('text_length', 0)}")
    print(f"image_count : {meta.get('image_count', 0)}")
    print(f"downloaded  : {meta.get('downloaded_image_count', 0)}")
    print("note        : capture-only — no OCR, no multimodal, no OpenAI call.")
    # blocked/error are valid feasibility outcomes, not crashes → exit 0.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
