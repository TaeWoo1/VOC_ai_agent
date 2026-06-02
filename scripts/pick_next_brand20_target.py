#!/usr/bin/env python3
"""Pick the next Brand-20 OY queue target without mutating queue state."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from src.voc.app.brand20_queue import PRIMARY_SORT, QueueItem, load_queue  # noqa: E402


DEFAULT_QUEUE_PATH = REPO / "ops" / "brand20_collection_queue.json"
EXCLUDED_STATUSES = {"done", "manual_checkpoint", "running"}


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read the Brand-20 queue and print the next runnable target. "
            "This is read-only and does not start collection."
        ),
    )
    parser.add_argument(
        "--queue",
        type=Path,
        default=DEFAULT_QUEUE_PATH,
        help="Queue JSON path. Default: ops/brand20_collection_queue.json",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--shell",
        action="store_true",
        help="Print exactly: <goods_no> <sort_type>",
    )
    mode.add_argument(
        "--json",
        action="store_true",
        help="Print the selected queue row as JSON.",
    )
    parser.add_argument(
        "--include-signal-sorts",
        action="store_true",
        help="Allow non-DATETIME_DESC signal sorts. Default: primary only.",
    )
    return parser.parse_args(argv)


def _is_clean_retry_intent(item: QueueItem) -> bool:
    return item.retry_intent in (None, "", "none")


def _has_cursor_retry_note(item: QueueItem) -> bool:
    note = item.operator_note or ""
    return "cursor_api_rate_limited" in note or "cursor_api_silenced" in note


def _status_rank(status: str) -> int:
    return {
        "ready": 0,
        "pending": 1,
        "retry_after_cooldown": 2,
        "inconclusive": 3,
    }.get(status, 4)


def _selection_key(item: QueueItem) -> tuple[int, int, int, int, int, str, str, str]:
    sort_rank = 0 if item.sort_type == PRIMARY_SORT else 1
    retry_rank = 0 if _is_clean_retry_intent(item) else 1
    attempted_rank = 0 if (
        item.attempts == 0 and item.last_attempt_at is None
    ) else 1
    last_attempt = item.last_attempt_at or ""
    zero_insert_penalty = 1 if item.rows_inserted_last == 0 else 0
    cursor_note_penalty = 1 if _has_cursor_retry_note(item) else 0
    return (
        _status_rank(item.status),
        sort_rank,
        retry_rank,
        attempted_rank,
        zero_insert_penalty + cursor_note_penalty,
        last_attempt,
        item.goods_no,
        item.sort_type,
    )


def _reason(item: QueueItem) -> str:
    parts: list[str] = [item.status]
    if item.attempts == 0 and item.last_attempt_at is None:
        parts.append("never attempted")
    elif item.last_attempt_at:
        parts.append(f"last attempted {item.last_attempt_at}")
    else:
        parts.append("attempted")
    if item.retry_intent not in (None, "", "none"):
        parts.append(f"retry_intent={item.retry_intent}")
    if item.rows_inserted_last == 0:
        parts.append("last insert was 0 rows")
    if _has_cursor_retry_note(item):
        parts.append("cursor retry note present")
    if (
        item.rows_filtered_by_goods_no_last is not None
        and item.rows_filtered_by_goods_no_last > 0
    ):
        parts.append(
            f"rows_filtered_by_goods_no_last="
            f"{item.rows_filtered_by_goods_no_last}",
        )
    return ", ".join(parts)


def pick_next_target(
    queue_path: Path,
    *,
    include_signal_sorts: bool = False,
) -> QueueItem | None:
    queue = load_queue(queue_path)
    candidates: list[QueueItem] = []
    for item in queue.items:
        if item.status in EXCLUDED_STATUSES:
            continue
        if not include_signal_sorts and item.sort_type != PRIMARY_SORT:
            continue
        candidates.append(item)
    if not candidates:
        return None
    return sorted(candidates, key=_selection_key)[0]


def _row_json(item: QueueItem) -> dict[str, Any]:
    return {
        "goods_no": item.goods_no,
        "product_name": item.product_name,
        "sort_type": item.sort_type,
        "status": item.status,
        "retry_intent": item.retry_intent,
        "last_attempted_at": item.last_attempt_at,
        "rows_inserted_last": item.rows_inserted_last,
        "records_parsed_last": item.records_parsed_last,
        "raw_records_seen_last": item.raw_records_seen_last,
        "rows_filtered_by_goods_no_last": item.rows_filtered_by_goods_no_last,
        "reason": _reason(item),
    }


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv if argv is not None else sys.argv[1:])
    try:
        selected = pick_next_target(
            args.queue,
            include_signal_sorts=args.include_signal_sorts,
        )
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"error: failed to read queue: {exc}", file=sys.stderr)
        return 1
    if selected is None:
        print("no runnable Brand-20 target found", file=sys.stderr)
        return 2

    if args.shell:
        print(f"{selected.goods_no} {selected.sort_type}")
    elif args.json:
        print(json.dumps(_row_json(selected), ensure_ascii=False, sort_keys=True))
    else:
        print(
            f"{selected.goods_no} {selected.sort_type} "
            f"{selected.product_name} - {_reason(selected)}",
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
