#!/usr/bin/env python3
"""S2x.1 — Coupang detail-page snapshot feasibility spike (capture-only).

Read-only, single operator-provided URL. Captures a local snapshot artifact
(page text, image manifest, screenshot) under a gitignored output folder so we
can judge whether product guidance is extractable from the detail page.

This is NOT a scraper: one URL, one read-only page load, no login/captcha/
anti-bot bypass, no crawling, no scheduling, no OCR, no multimodal, no OpenAI.
Run only against a URL the operator explicitly provides and authorizes.

Usage:
    PYTHONPATH=. python3 scripts/review_ops_detail_snapshot_spike.py \
        --url "https://www.coupang.com/vp/products/<id>?..." \
        [--out-dir .review_ops_data/detail_snapshots] \
        [--download-sample-images] \
        [--timeout-ms 30000]
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
from src.voc.review_ops.industrial.detail_snapshot.parse import (
    validate_coupang_product_url,
)


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Coupang detail-page snapshot feasibility spike (capture-only).",
    )
    p.add_argument("--url", required=True, help="One Coupang product detail URL.")
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
    return p


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

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
