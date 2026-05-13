#!/usr/bin/env python3
"""Inspect the Brand-20 OY collection queue / coverage dashboard.

This script is READ-ONLY:
  - It does NOT generate any report, PDF, or cardnews artifact.
    Report / PDF / cardnews generation is a separate operator action;
    coverage must be inspected here BEFORE triggering any
    analysis/publishing pipeline.
  - It does NOT run live collection. Live collection requires
    explicit per-turn operator authorization, and is launched only
    via scripts/run_oy_collection_batch.py.
  - It does NOT write to data/voc_data.db.

Usage:
    python scripts/inspect_brand20_collection_status.py
    python scripts/inspect_brand20_collection_status.py --queue ops/brand20_collection_queue.json
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from src.voc.app.brand20_queue import (  # noqa: E402
    Brand20Queue,
    DashboardView,
    MANUAL_CHECKPOINT_HINT,
    _parse_iso,
    dashboard_view,
    generate_next_run_prompt,
    load_queue,
)


DEFAULT_QUEUE_PATH = REPO / "ops" / "brand20_collection_queue.json"


def _git_head_short() -> str:
    """Best-effort `git rev-parse --short HEAD`. Returns '?' on any
    failure (missing git, detached worktree, etc.)."""
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(REPO), stderr=subprocess.DEVNULL,
        )
        return out.decode("utf-8").strip()
    except (OSError, subprocess.CalledProcessError):
        return "?"


def _fmt_relative(now: datetime, target_iso: str | None) -> str:
    """Render a duration relative to `now` for cooldown rows.

    Returns "RUNNABLE NOW" if next_run_after is in the past, else
    "expires in <X>m" (rounded down to minutes). On parse failure,
    returns the raw ISO string for visibility."""
    if not target_iso:
        return "(no cooldown anchor)"
    target = _parse_iso(target_iso)
    if target is None:
        return target_iso
    delta = target - now
    if delta.total_seconds() <= 0:
        return "RUNNABLE NOW"
    mins = int(delta.total_seconds() // 60)
    if mins < 60:
        return f"expires in {mins}m"
    hrs = mins // 60
    rem = mins % 60
    return f"expires in {hrs}h{rem:02d}m"


def _render(view: DashboardView, *, head_short: str, queue_path: Path) -> str:
    """Build the ~80-col plain-text dashboard. Returns a single string."""
    now_dt = _parse_iso(view.generated_at) or datetime.now(timezone.utc)
    lines: list[str] = []

    # Header
    lines.append("=" * 78)
    lines.append(
        f"Brand-20 OY collection coverage  | HEAD={head_short}  "
        f"schema=v{view.schema_version}"
    )
    lines.append(f"queue: {queue_path}")
    lines.append(f"as of: {view.generated_at}")
    lines.append("=" * 78)
    lines.append("")

    # Summary counts
    lines.append("SUMMARY")
    lines.append("-" * 78)
    lines.append(
        f"  products seeded:       {view.total_products:>3}  "
        f"(20 ideal — {20 - view.total_products} brands not yet seeded)"
    )
    lines.append(
        f"  targets seeded:        {view.total_targets_seeded:>3}  "
        f"(ideal {view.total_targets_ideal} = 20 brands x 5 sorts)"
    )
    for status in (
        "pending", "ready", "running",
        "retry_after_cooldown", "manual_checkpoint",
        "done", "inconclusive",
    ):
        lines.append(
            f"  {status:<22} {view.counts.get(status, 0):>3}"
        )
    lines.append("")

    # Per-product table
    lines.append("PER-PRODUCT")
    lines.append("-" * 78)
    lines.append(
        f"  {'product':<28} {'primary':<22} "
        f"{'signals':>8}  last_attempt"
    )
    for row in view.per_product:
        name = row.product_name[:26]
        primary = row.primary_status[:20]
        sig = f"{row.signal_done}/{row.signal_total}"
        last = row.last_attempt or "-"
        lines.append(
            f"  {name:<28} {primary:<22} {sig:>8}  {last}"
        )
    lines.append("")

    # Per-sort table
    lines.append("PER-SORT")
    lines.append("-" * 78)
    lines.append(
        f"  {'sort_type':<18} {'pend':>5} {'rdy':>4} {'run':>4} "
        f"{'cool':>5} {'manl':>5} {'done':>5} {'inc':>4}"
    )
    for row in view.per_sort:
        lines.append(
            f"  {row.sort_type:<18} "
            f"{row.pending:>5} {row.ready:>4} {row.running:>4} "
            f"{row.retry_after_cooldown:>5} {row.manual_checkpoint:>5} "
            f"{row.done:>5} {row.inconclusive:>4}"
        )
    lines.append("")

    # Coverage detail block (placeholder note per ticket Req 2)
    lines.append("COVERAGE DETAIL")
    lines.append("-" * 78)
    lines.append("  DATETIME_DESC primary coverage: see per-product table above.")
    lines.append("  Signal-sort membership coverage: see per-sort table above.")
    lines.append("  DB rows inserted (per goods_no): "
                 "(not yet populated; queue rows carry total_db_rows_for_goods=null)")
    lines.append("  Sidecar review_id counts: "
                 "(sidecar counts not yet populated)")
    lines.append("")

    # Ready Now
    #
    # I-OY-BRAND20-OPERATOR-RETRY-NO-COOLDOWN-GATE: rows whose previous
    # attempt observed a cursor-429 signal now land here (status=ready)
    # instead of WAITING. Surface the `retry_intent` audit signal and
    # the `operator_note` audit hint so the operator sees WHY the row
    # is in `ready` and not the older retry_after_cooldown.
    lines.append("READY NOW")
    lines.append("-" * 78)
    if not view.ready_now:
        lines.append("  (none)")
    else:
        for it in view.ready_now:
            lines.append(
                f"  {it.goods_no}  {it.sort_type:<16} "
                f"target={it.target_type}  product={it.product_name}"
            )
            # Operator-retry context: 429-routed rows carry
            # `retry_intent="retry_after_cooldown"` plus an
            # `operator_note`. Render a single sub-line so the operator
            # can see the prior 429 cause without scrolling.
            if it.retry_intent == "retry_after_cooldown":
                lines.append(
                    f"      [operator retry ready: prior "
                    f"retry_intent={it.retry_intent}; "
                    f"last_attempt={it.last_attempt_at}]"
                )
                if it.operator_note:
                    lines.append(f"      note: {it.operator_note}")
            elif it.operator_note:
                # Non-429 ready row that still carries a note (e.g. a
                # certified manual_checkpoint). Show it verbatim.
                lines.append(f"      note: {it.operator_note}")
    lines.append("")

    # Runnable / Pending — first-collection candidates (status=pending,
    # never attempted). These feed SUGGESTED NEXT RUNS alongside
    # READY NOW; surfacing them here makes the dashboard usable to
    # operators who didn't read the dispatching turn.
    lines.append("RUNNABLE / PENDING (never attempted)")
    lines.append("-" * 78)
    if not view.runnable_pending:
        lines.append("  (none)")
    else:
        # Cap the display to keep the dashboard scannable; the full set
        # is still available via the queue JSON and PER-SORT counts.
        display_cap = 10
        for it in view.runnable_pending[:display_cap]:
            lines.append(
                f"  {it.goods_no}  {it.sort_type:<16} "
                f"target={it.target_type}  product={it.product_name}"
            )
        remaining = len(view.runnable_pending) - display_cap
        if remaining > 0:
            lines.append(
                f"  ... (+{remaining} more pending — see PER-SORT counts)"
            )
    lines.append("")

    # Waiting
    #
    # I-OY-BRAND20-OPERATOR-RETRY-NO-COOLDOWN-GATE: new 429 outcomes no
    # longer land here — they route to READY NOW with an audit note.
    # This block now only contains LEGACY rows that were seeded at
    # `retry_after_cooldown` before the change. The advisory hint
    # tells the operator that `next_run_after` is no longer a hard wall:
    # if the product page recovers earlier, the operator may run
    # `mark_brand20_checkpoint_certified.py` or simply edit the row
    # back to `ready` (no live-collection authorization required for
    # the queue edit itself).
    lines.append("WAITING (retry_after_cooldown — legacy)")
    lines.append("-" * 78)
    if not view.waiting:
        lines.append("  (none)")
    else:
        lines.append(
            "  hint: next_run_after is advisory for cursor-429 rows; "
            "operator may retry once the page recovers"
        )
        for it in view.waiting:
            rel = _fmt_relative(now_dt, it.next_run_after)
            lines.append(
                f"  {it.goods_no}  {it.sort_type:<16} "
                f"next_run_after={it.next_run_after}  ({rel})"
            )
            lines.append(
                f"      product={it.product_name}  attempts={it.attempts}  "
                f"raw_last={it.raw_records_seen_last}"
            )
    lines.append("")

    # Manual Action Needed
    lines.append("MANUAL ACTION NEEDED (manual_checkpoint)")
    lines.append("-" * 78)
    if not view.manual:
        lines.append("  (none)")
    else:
        for it in view.manual:
            lines.append(
                f"  {it.goods_no}  {it.sort_type:<16} "
                f"reason={it.checkpoint_reason}"
            )
            lines.append(f"      product={it.product_name}")
            lines.append(f"      {MANUAL_CHECKPOINT_HINT}")
    lines.append("")

    # Suggestions
    lines.append("SUGGESTED NEXT RUNS (up to 3)")
    lines.append("-" * 78)
    if not view.suggestions:
        # Reaching this branch means every row is in a blocked state
        # (manual_checkpoint, running, done, inconclusive) or in a
        # cooldown whose next_run_after is still in the future.
        lines.append(
            "  (none — every row is blocked: manual_checkpoint / "
            "running / done / inconclusive / cooldown not yet elapsed)"
        )
    else:
        for it in view.suggestions:
            lines.append("")
            lines.append(generate_next_run_prompt(it))
    lines.append("")

    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="inspect_brand20_collection_status",
        description=(
            "Read-only Brand-20 OY collection coverage dashboard. "
            "Does NOT trigger collection or report generation."
        ),
    )
    parser.add_argument(
        "--queue", type=Path, default=DEFAULT_QUEUE_PATH,
        help="Path to the Brand-20 queue JSON. "
             f"Default: {DEFAULT_QUEUE_PATH.relative_to(REPO)}",
    )
    args = parser.parse_args(argv)

    try:
        queue: Brand20Queue = load_queue(args.queue)
    except FileNotFoundError as e:
        print(f"failed_check: {e}", file=sys.stderr)
        print(
            "required_action: seed the queue file or pass --queue.",
            file=sys.stderr,
        )
        return 2

    view = dashboard_view(queue, queue_path=str(args.queue))
    text = _render(view, head_short=_git_head_short(), queue_path=args.queue)
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
