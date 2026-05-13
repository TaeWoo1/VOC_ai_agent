#!/usr/bin/env python3
"""Apply one batch_summary.json to the Brand-20 collection queue.

This script:
  - Does NOT generate any report, PDF, or cardnews artifact. Report /
    PDF / cardnews generation is a separate operator action; coverage
    must be inspected (via scripts/inspect_brand20_collection_status.py)
    BEFORE triggering any analysis/publishing pipeline.
  - Does NOT run live collection. Live collection requires explicit
    per-turn operator authorization, and is launched only via
    scripts/run_oy_collection_batch.py.
  - Does NOT write to data/voc_data.db.
  - Mutates ops/brand20_collection_queue.json (or the path passed via
    --queue) via atomic tmpfile+replace.

Usage:
    python scripts/update_brand20_queue_from_batch.py \\
        --batch-summary path/to/batch_summary.json

    python scripts/update_brand20_queue_from_batch.py \\
        --batch-summary path/to/batch_summary.json \\
        --queue ops/brand20_collection_queue.json \\
        --dry-run
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from src.voc.app.brand20_queue import (  # noqa: E402
    Brand20Queue,
    apply_batch_summary,
    load_queue,
    save_queue,
)


DEFAULT_QUEUE_PATH = REPO / "ops" / "brand20_collection_queue.json"


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="update_brand20_queue_from_batch",
        description=(
            "Apply a single batch_summary.json to the Brand-20 queue. "
            "Does NOT trigger collection or report generation."
        ),
    )
    parser.add_argument(
        "--batch-summary", type=Path, required=True,
        help="Path to a batch_summary.json emitted by "
             "scripts/run_oy_collection_batch.py.",
    )
    parser.add_argument(
        "--queue", type=Path, default=DEFAULT_QUEUE_PATH,
        help="Path to the Brand-20 queue JSON. "
             f"Default: {DEFAULT_QUEUE_PATH.relative_to(REPO)}",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print the proposed update without writing the queue file.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    if not args.batch_summary.is_file():
        print(
            f"failed_check: batch_summary not found: {args.batch_summary}",
            file=sys.stderr,
        )
        print(
            "required_action: pass --batch-summary <existing file>.",
            file=sys.stderr,
        )
        return 2

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
        batch_summary = json.loads(args.batch_summary.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(
            f"failed_check: batch_summary not valid JSON: {e}",
            file=sys.stderr,
        )
        return 2

    # Snapshot the pre-change state so the summary line shows the
    # actual transition rather than just the final value.
    try:
        # Peek the target before applying so we can print the prior
        # status; apply_batch_summary raises with a clear message if
        # the row isn't in the queue (which is the intended behavior).
        from src.voc.app.brand20_queue import _extract_target
        goods_no, sort_type = _extract_target(batch_summary)
        prior = queue.find(goods_no, sort_type)
        prior_status = prior.status if prior else "<missing>"
    except (KeyError, Exception):
        prior_status = "<unknown>"

    try:
        item = apply_batch_summary(queue, batch_summary)
    except KeyError as e:
        print(f"failed_check: {e}", file=sys.stderr)
        print(
            "required_action: add the (goods_no, sort_type) row to the "
            "queue file before applying this batch_summary.",
            file=sys.stderr,
        )
        return 3

    # 5-line summary per Req 3
    print("brand20 queue update:")
    print(f"  target:        {item.goods_no} / {item.sort_type}")
    print(f"  status:        {prior_status} -> {item.status}")
    print(
        f"  attempts:      {item.attempts}  "
        f"last_run_id={item.last_run_id}"
    )
    print(
        f"  retry_intent:  {item.retry_intent}  "
        f"next_run_after={item.next_run_after}"
    )

    if args.dry_run:
        print("  (dry-run; queue file NOT written)")
        return 0

    save_queue(args.queue, queue)
    print(f"  wrote:         {args.queue}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
