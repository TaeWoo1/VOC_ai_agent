"""CLI: run an OliveYoung multi-product authenticated-CDP collection batch.

Usage:
    PYTHONPATH=. python3 scripts/run_oy_collection_batch.py \\
        --manifest path/to/batch_manifest.json \\
        [--artifact-root data/collection_artifacts] \\
        [--jitter-min 15 --jitter-max 45]

Manifest format (JSON):
    {
      "batch_id": "phase2_oy_20_products_20260425",
      "defaults": {
        "max_reviews": 200,
        "cdp_endpoint": "http://localhost:9222",
        "cold_start_timeout": 60,
        "continuation_timeout": 12,
        "scroll_attempts": 5
      },
      "products": [
        {"name": "NAMING Fluffy Powder Blush", "oy_goods_no": "A000000171371"},
        {"name": "GLINT Baked Blusher",        "oy_goods_no": "A000000188442"}
      ]
    }

Per-product entries can override `max_reviews`, `cdp_endpoint`, etc. — see
`src/voc/app/collection_batch.py:ProductSpec`.

Pre-flight (operator):
    1. Launch Chrome with `--remote-debugging-port=9222 --user-data-dir=...`
    2. Sign into oliveyoung.co.kr in that Chrome window
    3. Verify: `curl -s http://localhost:9222/json/version | python3 -m json.tool`

Exit codes:
    0  — batch completed; no halt
    1  — batch halted on an auth/anti-bot status; partial report written
    2  — manifest parse error or other startup failure

Outputs:
    `<artifact-root>/<batch_id>/batch_summary.json`
    `<artifact-root>/<batch_id>/batch_summary.md`
    `<artifact-root>/<batch_id>/<oy_goods_no>/oy_browser_trace_*.jsonl`
    `<artifact-root>/<batch_id>/<oy_goods_no>/oy_browser_partial_*.jsonl`
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from src.voc.app.collection_batch import (
    DEFAULT_ARTIFACT_ROOT,
    load_manifest,
    run_batch,
)


def _parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Run an OliveYoung multi-product authenticated-CDP "
                    "collection batch with per-product status reporting "
                    "and halt-on-auth-failure behavior.",
    )
    p.add_argument(
        "--manifest", type=Path, required=True,
        help="Path to the batch manifest JSON file.",
    )
    p.add_argument(
        "--artifact-root", type=Path, default=DEFAULT_ARTIFACT_ROOT,
        help=(
            f"Root directory for batch artifacts. Default: "
            f"{DEFAULT_ARTIFACT_ROOT.relative_to(Path.cwd()) if DEFAULT_ARTIFACT_ROOT.is_relative_to(Path.cwd()) else DEFAULT_ARTIFACT_ROOT}"
        ),
    )
    p.add_argument(
        "--jitter-min", type=float, default=0.0,
        help="Minimum random sleep (seconds) between products. Default 0 (off).",
    )
    p.add_argument(
        "--jitter-max", type=float, default=0.0,
        help="Maximum random sleep (seconds) between products. Default 0 (off).",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    args = _parse_args(argv if argv is not None else sys.argv[1:])

    if not args.manifest.is_file():
        sys.stderr.write(f"ERROR: manifest not found at {args.manifest}\n")
        return 2

    if args.jitter_min < 0 or args.jitter_max < 0:
        sys.stderr.write("ERROR: --jitter-min and --jitter-max must be >= 0\n")
        return 2
    if args.jitter_max < args.jitter_min:
        sys.stderr.write("ERROR: --jitter-max must be >= --jitter-min\n")
        return 2

    try:
        manifest = load_manifest(args.manifest)
    except (ValueError, OSError, KeyError) as e:
        sys.stderr.write(f"ERROR: failed to load manifest: {e}\n")
        return 2

    report = run_batch(
        manifest=manifest,
        artifact_root=args.artifact_root,
        jitter_min=args.jitter_min,
        jitter_max=args.jitter_max,
    )

    print(
        f"Batch {report.batch_id}: "
        f"{len(report.products)} product(s) attempted; "
        f"halted={report.halted}; "
        f"summary at {report.artifact_root}/batch_summary.md",
    )
    return 1 if report.halted else 0


if __name__ == "__main__":
    sys.exit(main())
