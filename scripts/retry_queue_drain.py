"""Drain the per-sort retry queue.

Reads `retry_queue.json` (default `<repo>/retry_queue.json`) and
re-runs each entry's failed sort by invoking
`scripts/run_phase2e_pipeline.py` with `--sort-type <X>` and
`--corpus-mode primary_only` (we don't want a single retry to
re-trigger the full multi-sort plan).

After each entry:
  - On success → remove the matching entry from the queue.
  - On failure → leave the entry; print a clear status line.

Strict mode is opt-in: pass `--wait-until-sort-loaded` to make
each drained sort retry indefinitely.

Usage:
    python scripts/retry_queue_drain.py
    python scripts/retry_queue_drain.py --queue-path ./retry_queue.json
    python scripts/retry_queue_drain.py --wait-until-sort-loaded
    python scripts/retry_queue_drain.py --dry-run
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


REPO = Path(__file__).resolve().parent.parent
PHASE2E_RUNNER = REPO / "scripts" / "run_phase2e_pipeline.py"

sys.path.insert(0, str(REPO))

from src.voc.app import retry_queue as _retry_queue  # noqa: E402


def _build_argv(
    *,
    entry: dict,
    queue_path: Path,
    wait_until_sort_loaded: bool,
    human_check_timeout_seconds: int | None,
    human_check_poll_seconds: int | None,
) -> list[str]:
    """Construct the argv for one drain attempt."""
    argv = [
        sys.executable, str(PHASE2E_RUNNER),
        entry["product_url"],
        "--sort-type", str(entry["sort_type"]),
        "--corpus-mode", "primary_only",
        # Suppress the multi-sort plan: we only want to re-run THIS
        # one sort. `--sort-type` is mutually exclusive with
        # `--multi-sort` in the runner — explicit corpus-mode keeps
        # downstream classification consistent.
        "--retry-queue-path", str(queue_path),
    ]
    if wait_until_sort_loaded:
        argv.append("--wait-until-sort-loaded")
    if human_check_timeout_seconds is not None:
        argv.extend([
            "--human-check-timeout-seconds",
            str(int(human_check_timeout_seconds)),
        ])
    if human_check_poll_seconds is not None:
        argv.extend([
            "--human-check-poll-seconds",
            str(int(human_check_poll_seconds)),
        ])
    return argv


def _run_entry(argv: list[str]) -> int:
    """Subprocess invocation. Returns the runner's exit code.

    KeyboardInterrupt during the child propagates as
    SIGINT-equivalent — the parent catches it at `main()` so the
    queue isn't half-mutated.
    """
    try:
        completed = subprocess.run(argv, cwd=str(REPO), check=False)
        return completed.returncode
    except FileNotFoundError as e:
        print(f"  ✗ runner not found: {e}", file=sys.stderr)
        return 127


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="retry_queue_drain",
        description="Re-run sorts queued by the multi-sort orchestrator.",
    )
    p.add_argument(
        "--queue-path", type=Path,
        default=REPO / "retry_queue.json",
        help="Path to the JSON queue file. Default: <repo>/retry_queue.json.",
    )
    p.add_argument(
        "--wait-until-sort-loaded", "--no-skip-sorts",
        dest="wait_until_sort_loaded", action="store_true",
        help="Pass through to the runner: keep retrying each drained "
             "sort until it loads. Implies indefinite human-check wait.",
    )
    p.add_argument(
        "--human-check-timeout-seconds", type=int, default=None,
        help="Forwarded to the runner. 0 = indefinite.",
    )
    p.add_argument(
        "--human-check-poll-seconds", type=int, default=None,
        help="Forwarded to the runner.",
    )
    p.add_argument(
        "--dry-run", action="store_true",
        help="Print the planned argv per entry without invoking the runner.",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    queue_path: Path = args.queue_path
    entries = _retry_queue.load(queue_path)
    if not entries:
        print(f"queue empty at {queue_path}")
        return 0

    print(f"draining {len(entries)} entries from {queue_path}")
    n_ok = 0
    n_fail = 0
    try:
        for i, entry in enumerate(entries, start=1):
            sort_type = entry.get("sort_type")
            goods_no = entry.get("goods_no")
            print(
                f"\n[{i}/{len(entries)}] retry "
                f"goods_no={goods_no} sort_type={sort_type} "
                f"reason={entry.get('failure_reason')!r}",
            )
            cmd = _build_argv(
                entry=entry,
                queue_path=queue_path,
                wait_until_sort_loaded=args.wait_until_sort_loaded,
                human_check_timeout_seconds=args.human_check_timeout_seconds,
                human_check_poll_seconds=args.human_check_poll_seconds,
            )
            print("  cmd:", " ".join(cmd))
            if args.dry_run:
                continue
            rc = _run_entry(cmd)
            if rc == 0:
                # Success → remove this exact (goods_no, sort_type)
                # combination from the queue. The runner already
                # appended fresh failures (if any) under the same
                # path, so this surgical remove is safe.
                removed = _retry_queue.remove_matching(
                    queue_path,
                    goods_no=goods_no, sort_type=sort_type,
                    product_url=entry.get("product_url"),
                )
                print(f"  ✓ ok — removed {removed} matching queue entr(y/ies)")
                n_ok += 1
            else:
                print(f"  ✗ runner exited rc={rc}; entry kept in queue")
                n_fail += 1
    except KeyboardInterrupt:
        print("\nCtrl+C received; queue left as-is.", file=sys.stderr)
        return 130

    print(f"\ndrain complete: ok={n_ok} fail={n_fail}")
    return 0 if n_fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
