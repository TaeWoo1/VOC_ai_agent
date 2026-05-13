#!/usr/bin/env python3
"""Brand-20 OliveYoung queue runner CLI (phase A).

Phase A scope:
  - Select the next runnable queue row (with optional operator override).
  - Run the precondition gate (HEAD, no competing process, CDP probe,
    target tab open + on product page, queue-wide cooldown horizon).
  - Print the plan block describing what phase B WOULD invoke.
  - Exit.

Phase A NEVER:
  - calls subprocess.run on scripts/run_oy_collection_batch.py
  - mutates the queue file
  - opens a CDP tab via /json/new

The `--i-authorize-live-collection` flag is parsed but short-circuits
with a friendly "phase A: not yet implemented" notice. Phase B will
replace that short-circuit with the actual subprocess call.

Exit codes:
  0 — plan printed (default mode, `--dry-run`, `--check` OK,
      `--i-authorize-live-collection` in phase-A short-circuit).
  2 — precondition gate failed OR operator override invalid.
  3 — no runnable queue item.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parent.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from src.voc.app.brand20_queue import load_queue  # noqa: E402
from src.voc.app.brand20_runner_core import (  # noqa: E402
    NoRunnableItemError,
    RowNotRunnableError,
    build_product_url,
    format_plan_block,
    pick_next_runnable,
)
from src.voc.app.brand20_runner_precondition import (  # noqa: E402
    PreconditionResult,
    evaluate_preconditions,
)


# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

DEFAULT_QUEUE_PATH = REPO / "ops" / "brand20_collection_queue.json"
DEFAULT_ARTIFACT_ROOT = REPO / "data" / "collection_artifacts"
DEFAULT_INTERPRETER = "/Users/taewookang/.pyenv/shims/python3"

# Conservative env vars per CLAUDE.md OY rate-limit policy. Pinned
# here so phase B inherits the same values without an additional edit.
PINNED_ENV: dict[str, str] = {
    "OY_CURSOR_PACING_MS": "500",
    "OY_CURSOR_RATE_LIMIT_COOLDOWN_SEC": "120",
    "OY_CURSOR_RATE_LIMIT_MAX_RETRIES": "1",
}


# ---------------------------------------------------------------------------
# argparse
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="run_brand20_queue_runner.py",
        description=(
            "Drive Brand-20 OliveYoung review collection one batch at a "
            "time. Phase A: prints the plan and exits; phase B will wire "
            "the actual subprocess invocation. Live collection requires "
            "explicit per-turn operator authorization."
        ),
    )
    p.add_argument(
        "--queue",
        default=str(DEFAULT_QUEUE_PATH),
        help="Path to the Brand-20 queue JSON. Default: ops/brand20_collection_queue.json",
    )
    p.add_argument(
        "--artifact-root",
        default=str(DEFAULT_ARTIFACT_ROOT),
        help="Root directory for batch artifacts. Default: data/collection_artifacts",
    )
    p.add_argument(
        "--max-items-per-session",
        type=int,
        default=1,
        help="Phase B will use this. Phase A ignores it (single-shot plan).",
    )
    p.add_argument("--goods-no", default=None, help="Operator override goodsNo.")
    p.add_argument(
        "--sort-type",
        default=None,
        help="Operator override sortType (must accompany --goods-no).",
    )
    p.add_argument(
        "--allow-open-tab",
        action="store_true",
        help=(
            "Phase A: accepted but never acted on (no /json/new). "
            "Phase B may use this in combination with "
            "--i-authorize-live-collection."
        ),
    )
    p.add_argument(
        "--i-authorize-live-collection",
        action="store_true",
        dest="authorize_live",
        help=(
            "Phase A: short-circuits with a 'not yet implemented' notice "
            "after the plan block. Phase B will use this to invoke the "
            "child process."
        ),
    )
    p.add_argument(
        "--head-baseline",
        default=None,
        help=(
            "Expected `git rev-parse --short HEAD`. When provided, the "
            "gate fails with failed_check=head_mismatch if HEAD differs."
        ),
    )
    mode = p.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run",
        action="store_true",
        help=(
            "Same behavior as default in phase A (select + gate + plan "
            "block). Phase B will distinguish this from "
            "--i-authorize-live-collection."
        ),
    )
    mode.add_argument(
        "--check",
        action="store_true",
        help=(
            "Run the precondition gate ONLY. Do not pick a target, do "
            "not print the plan block, do not invoke collection."
        ),
    )
    return p


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _print_precondition_failure(
    result: PreconditionResult,
    *,
    stream: Any,
) -> None:
    """Emit the operator-facing failure block in the established
    failed_check / required_action two-line format."""
    print(f"failed_check: {result.failed_check}", file=stream)
    print(f"required_action: {result.required_action}", file=stream)
    if result.notes:
        print("notes:", file=stream)
        for n in result.notes:
            print(f"  - {n}", file=stream)


def _format_command_line(
    *,
    queue_path: str,
    artifact_root: str,
    interpreter: str = DEFAULT_INTERPRETER,
) -> str:
    """Render the literal command phase B WOULD invoke. Kept as a
    single string so the plan block can drop it in verbatim."""
    return (
        f"{interpreter} scripts/run_oy_collection_batch.py "
        f"--manifest <tmp_manifest.json> "
        f"--artifact-root {artifact_root}"
    )


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    """Phase-A entry point. Returns the exit code; tests call this
    directly without spawning a subprocess."""
    args = _build_parser().parse_args(argv)

    # Operator-override pair validation. Done early so the error is
    # surfaced before any queue / CDP I/O.
    if (args.goods_no is None) != (args.sort_type is None):
        print(
            "error: operator override requires both --goods-no and --sort-type",
            file=sys.stderr,
        )
        return 2

    queue_path = Path(args.queue)
    queue = load_queue(queue_path)
    now = datetime.now(timezone.utc)

    # --check: gate only. No target selection. Uses the operator
    # override (if both flags are passed) to scope the tab check; if
    # only one row is needed the gate can be scoped tightly. Otherwise
    # the first runnable row is used purely for the tab-URL match.
    if args.check:
        # Use the operator override if present; otherwise fall back to
        # the first runnable row so the tab-URL check has a goods_no
        # to look for.
        if args.goods_no and args.sort_type:
            target_goods_no = args.goods_no
            target_sort_type = args.sort_type
        else:
            try:
                item = pick_next_runnable(queue, now=now)
            except NoRunnableItemError as exc:
                print(f"error: {exc}", file=sys.stderr)
                return 3
            target_goods_no = item.goods_no
            target_sort_type = item.sort_type
        result = evaluate_preconditions(
            queue,
            goods_no=target_goods_no,
            sort_type=target_sort_type,
            now=now,
            allow_open_tab=args.allow_open_tab,
            head_baseline=args.head_baseline,
        )
        if not result.ok:
            _print_precondition_failure(result, stream=sys.stderr)
            return 2
        if result.notes:
            print("preconditions: ok")
            for n in result.notes:
                print(f"  note: {n}")
        else:
            print("preconditions: ok")
        return 0

    # Default / --dry-run / --i-authorize-live-collection: select →
    # gate → print plan block.
    try:
        item = pick_next_runnable(
            queue,
            now=now,
            goods_no_override=args.goods_no,
            sort_type_override=args.sort_type,
        )
    except RowNotRunnableError as exc:
        print(f"error: {exc} (reason={exc.reason})", file=sys.stderr)
        return 2
    except KeyError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except NoRunnableItemError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 3

    pre_result = evaluate_preconditions(
        queue,
        goods_no=item.goods_no,
        sort_type=item.sort_type,
        now=now,
        allow_open_tab=args.allow_open_tab,
        head_baseline=args.head_baseline,
    )

    plan_block = format_plan_block(
        item,
        queue_path=str(queue_path),
        artifact_root=args.artifact_root,
        env_vars=PINNED_ENV,
        command_line=_format_command_line(
            queue_path=str(queue_path),
            artifact_root=args.artifact_root,
        ),
        precondition_result=pre_result,
    )
    print(plan_block)

    if args.authorize_live:
        # Phase A: collection invocation not yet wired. Print the
        # explicit notice and exit 0 so operators understand the flag
        # was parsed correctly but no child process was launched.
        print(
            "phase A: collection invocation not yet implemented; "
            "re-run in phase B to actually launch collection"
        )

    # Target URL hint at the very bottom so it survives terminal
    # truncation of the plan block.
    print(f"target_url (open in CDP Chrome): {build_product_url(item.goods_no)}")

    if not pre_result.ok:
        # Plan block already enumerates the failure; CLI exit code
        # carries the operator-actionable signal.
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
