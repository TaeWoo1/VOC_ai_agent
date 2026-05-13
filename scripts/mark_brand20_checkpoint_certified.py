#!/usr/bin/env python3
"""Flip a manual_checkpoint Brand-20 queue row to ready.

This script:
  - Does NOT generate any report, PDF, or cardnews artifact. Report /
    PDF / cardnews generation is a separate operator action; coverage
    must be inspected (via scripts/inspect_brand20_collection_status.py)
    BEFORE triggering any analysis/publishing pipeline.
  - Does NOT run live collection. Live collection requires explicit
    per-turn operator authorization, and is launched only via
    scripts/run_oy_collection_batch.py. Certifying a checkpoint here
    only marks the row as ready for the next operator-authorized run.
  - Does NOT write to data/voc_data.db.
  - Refuses to operate on any row whose current status is NOT
    'manual_checkpoint' — accidental status flips are not permitted.

Usage:
    python scripts/mark_brand20_checkpoint_certified.py \\
        --goods-no A000000XXXXXXX \\
        --sort-type DATETIME_DESC \\
        --note "operator logged in + verified human-check at 12:34"

    python scripts/mark_brand20_checkpoint_certified.py \\
        --goods-no A000000XXXXXXX \\
        --sort-type DATETIME_DESC \\
        --queue ops/brand20_collection_queue.json \\
        --note "<short operator note>"
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path


REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from src.voc.app.brand20_queue import (  # noqa: E402
    Brand20Queue,
    load_queue,
    mark_checkpoint_certified,
    save_queue,
)


DEFAULT_QUEUE_PATH = REPO / "ops" / "brand20_collection_queue.json"


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="mark_brand20_checkpoint_certified",
        description=(
            "Flip a Brand-20 queue row from manual_checkpoint to ready. "
            "Does NOT trigger collection or report generation."
        ),
    )
    parser.add_argument(
        "--goods-no", required=True,
        help="OliveYoung goodsNo of the row to certify (e.g. A000000225736).",
    )
    parser.add_argument(
        "--sort-type", required=True,
        help="sort_type of the row (DATETIME_DESC / RATING_ASC / ...).",
    )
    parser.add_argument(
        "--queue", type=Path, default=DEFAULT_QUEUE_PATH,
        help="Path to the Brand-20 queue JSON. "
             f"Default: {DEFAULT_QUEUE_PATH.relative_to(REPO)}",
    )
    parser.add_argument(
        "--note", required=True,
        help="Short operator note recorded on the row "
             "(e.g. 'operator logged in + verified human-check at 12:34').",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    try:
        queue: Brand20Queue = load_queue(args.queue)
    except FileNotFoundError as e:
        print(f"failed_check: {e}", file=sys.stderr)
        print(
            "required_action: seed the queue file or pass --queue.",
            file=sys.stderr,
        )
        return 2

    try:
        item = mark_checkpoint_certified(
            queue,
            goods_no=args.goods_no,
            sort_type=args.sort_type,
            note=args.note,
        )
    except KeyError as e:
        print(f"failed_check: {e}", file=sys.stderr)
        return 3
    except ValueError as e:
        print(f"failed_check: {e}", file=sys.stderr)
        print(
            "required_action: only rows in status 'manual_checkpoint' can "
            "be certified. Inspect the queue first.",
            file=sys.stderr,
        )
        return 4

    save_queue(args.queue, queue)
    print(
        f"certified: {item.goods_no} / {item.sort_type} "
        f"-> status=ready  note={item.operator_note!r}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
