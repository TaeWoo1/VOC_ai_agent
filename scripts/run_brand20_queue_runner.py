#!/usr/bin/env python3
"""Brand-20 OliveYoung queue runner CLI.

Phase B scope:
  - Select the next runnable queue row (with optional operator override).
  - Run the precondition gate (HEAD, no competing process, CDP probe,
    target tab open + on product page, queue-wide cooldown horizon).
    With `--allow-open-tab` AND `--i-authorize-live-collection`, the
    gate may call `cdp_tab_probe.open_tab` exactly once and re-check.
  - Print the plan block describing what the runner is about to do.
  - When `--i-authorize-live-collection` is passed AND `--dry-run` is
    NOT, invoke `scripts/run_oy_collection_batch.py` via subprocess
    against a temporary single-product manifest, then apply the
    resulting `batch_summary.json` to the queue.
  - Loop up to `--max-items-per-session N` (default 1, cap 3); ANY
    429-class signal stops the loop immediately (session-global).

NEVER:
  - opens a CDP tab without BOTH `--allow-open-tab` AND
    `--i-authorize-live-collection`.
  - invokes the collection subprocess without
    `--i-authorize-live-collection`.
  - mutates the queue file under `--dry-run`.

Exit codes:
  0 — plan printed (`--dry-run`, `--check` OK), or the loop completed
      cleanly without hitting a stop signal.
  1 — collection subprocess returned non-zero AND no batch_summary
      was written, OR a stop signal was hit (operator action
      required).
  2 — precondition gate failed OR operator override invalid.
  3 — no runnable queue item.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

REPO = Path(__file__).resolve().parent.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from src.voc.app.brand20_queue import (  # noqa: E402
    Brand20Queue,
    apply_batch_summary,
    load_queue,
    save_queue,
)
from src.voc.app.brand20_runner_core import (  # noqa: E402
    NoRunnableItemError,
    RowNotRunnableError,
    build_product_url,
    build_temporary_manifest,
    format_plan_block,
    load_batch_summary,
    pick_next_runnable,
    resolve_batch_summary_path,
    should_stop_loop,
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

# Conservative env vars per CLAUDE.md OY rate-limit policy. These are
# set on the child's environment only — the runner never mutates its
# own `os.environ`.
PINNED_ENV: dict[str, str] = {
    "OY_CURSOR_PACING_MS": "500",
    "OY_CURSOR_RATE_LIMIT_COOLDOWN_SEC": "120",
    "OY_CURSOR_RATE_LIMIT_MAX_RETRIES": "1",
}

MAX_ITEMS_PER_SESSION_CAP: int = 3


# ---------------------------------------------------------------------------
# argparse helpers
# ---------------------------------------------------------------------------


def _max_items_per_session_type(raw: str) -> int:
    """argparse `type=` validator for `--max-items-per-session N`.

    Accepts integers in `[1, MAX_ITEMS_PER_SESSION_CAP]`; anything
    outside raises `argparse.ArgumentTypeError` so the operator sees a
    clear error instead of a runtime surprise.
    """
    try:
        v = int(raw)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"--max-items-per-session must be an integer, got {raw!r}",
        ) from exc
    if v < 1:
        raise argparse.ArgumentTypeError(
            f"--max-items-per-session must be >= 1, got {v}",
        )
    if v > MAX_ITEMS_PER_SESSION_CAP:
        raise argparse.ArgumentTypeError(
            f"--max-items-per-session capped at "
            f"{MAX_ITEMS_PER_SESSION_CAP}, got {v}",
        )
    return v


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="run_brand20_queue_runner.py",
        description=(
            "Drive Brand-20 OliveYoung review collection one batch at a "
            "time. Live collection requires explicit per-turn operator "
            "authorization via --i-authorize-live-collection."
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
        type=_max_items_per_session_type,
        default=1,
        help=(
            f"Maximum number of queue items to process in this session. "
            f"Default 1; capped at {MAX_ITEMS_PER_SESSION_CAP}. ANY 429-"
            f"class signal stops the loop immediately, session-global."
        ),
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
            "Allow the runner to call CDP /json/new to open the target "
            "product tab when it is missing. Has no effect WITHOUT "
            "--i-authorize-live-collection; the runner refuses to open "
            "tabs silently."
        ),
    )
    p.add_argument(
        "--i-authorize-live-collection",
        action="store_true",
        dest="authorize_live",
        help=(
            "Authorize a live collection run for this session. Without "
            "this flag the runner prints the plan and exits without "
            "calling subprocess.run on the collection script."
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
            "Select + gate + plan block + exit. NEVER invokes the "
            "collection subprocess; NEVER mutates the queue; NEVER "
            "calls /json/new. Wins over --i-authorize-live-collection."
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
# Subprocess invocation
# ---------------------------------------------------------------------------


@dataclass
class _CollectionInvocation:
    """Bundle of what the runner just ran. Returned by
    `_invoke_collection` so the loop driver can decide what to do
    next without re-deriving the manifest / batch_id / argv."""

    item: Any  # QueueItem; kept as Any here to avoid a forward import.
    batch_id: str
    manifest_path: Path
    argv: list[str]
    env_overrides: dict[str, str]
    completed: subprocess.CompletedProcess


SubprocessRunner = Callable[..., subprocess.CompletedProcess]


def _invoke_collection(
    item: Any,
    *,
    artifact_root: str | Path,
    now: datetime,
    interpreter: str = DEFAULT_INTERPRETER,
    subprocess_runner: SubprocessRunner | None = None,
) -> _CollectionInvocation:
    """Build the manifest, run the collection child, and clean up the
    manifest tempfile. Returns the invocation record.

    `subprocess_runner` is the only seam tests need: every test path
    patches it with a stub that writes a fixture `batch_summary.json`
    at the deterministic location. The real `subprocess.run` is only
    used when an operator actually invokes the CLI with
    `--i-authorize-live-collection`.

    The child's env is built as `{**os.environ, **PINNED_ENV}` —
    the runner's own `os.environ` is never mutated. `check=False`
    because we always inspect `batch_summary.json` ourselves rather
    than trusting the child's exit code to mean "no work was done"
    (the connector exits 1 on auth-wall halts but still writes a
    summary).
    """
    if subprocess_runner is None:
        # Resolve at call time so tests that monkeypatch
        # `cli.subprocess.run` (or attach a different default via the
        # `subprocess_runner` kwarg) are honoured.
        subprocess_runner = subprocess.run
    manifest_path, batch_id = build_temporary_manifest(item, now=now)
    argv = [
        interpreter,
        str(REPO / "scripts" / "run_oy_collection_batch.py"),
        "--manifest", str(manifest_path),
        "--artifact-root", str(artifact_root),
    ]
    env_overrides = dict(PINNED_ENV)
    child_env = {**os.environ, **env_overrides}
    try:
        completed = subprocess_runner(
            argv,
            env=child_env,
            check=False,
            capture_output=False,
        )
    finally:
        # Always unlink the temp manifest; tests that patch
        # subprocess_runner produce a stub result and we still want
        # the manifest cleaned up.
        try:
            os.unlink(manifest_path)
        except FileNotFoundError:
            pass
    return _CollectionInvocation(
        item=item,
        batch_id=batch_id,
        manifest_path=manifest_path,
        argv=argv,
        env_overrides=env_overrides,
        completed=completed,
    )


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
    """Render the literal command the runner WILL invoke (phase B) or
    WOULD invoke (dry-run). Kept as a single string so the plan block
    can drop it in verbatim."""
    _ = queue_path  # queue_path is the runner's input, not the child's
    return (
        f"{interpreter} scripts/run_oy_collection_batch.py "
        f"--manifest <tmp_manifest.json> "
        f"--artifact-root {artifact_root}"
    )


def _format_resume_after_cooldown(item: Any) -> str:
    """Render the verbatim resume command for a row that landed in
    retry_after_cooldown. Matches the planning handoff §7 contract so
    the operator can copy-paste."""
    return (
        f"  python3 scripts/run_brand20_queue_runner.py \\\n"
        f"    --goods-no {item.goods_no} \\\n"
        f"    --sort-type {item.sort_type} \\\n"
        f"    --allow-open-tab \\\n"
        f"    --i-authorize-live-collection\n"
        f"  (next_run_after={item.next_run_after})"
    )


def _format_certify_command(item: Any) -> str:
    """Render the verbatim certify command for a row that landed in
    manual_checkpoint."""
    return (
        f"  python3 scripts/mark_brand20_checkpoint_certified.py \\\n"
        f"    --goods-no {item.goods_no} \\\n"
        f"    --sort-type {item.sort_type} \\\n"
        f"    --note '<operator note: login cleared / human-check passed>'"
    )


def _format_resume_max_cap_reached(item: Any) -> str:
    """Render the verbatim resume command for a primary row that
    landed on local cap (`max_cap_reached`).

    I-OY-BRAND20-RUNNER-MAX-CAP-AND-STATUS-MAPPING-FIX §5: when the
    DATETIME_DESC primary hits the local cap (BRAND20_PRIMARY_MAX),
    surface a clear PARTIAL line plus the exact re-run command. The
    operator can re-invoke the runner against the same row to extend
    coverage; the row has been left in `status=ready` by the queue
    layer so a default-mode run picks it up directly.
    """
    return (
        f"  PYTHONPATH=. /Users/taewookang/.pyenv/shims/python3 \\\n"
        f"    scripts/run_brand20_queue_runner.py \\\n"
        f"    --goods-no {item.goods_no} \\\n"
        f"    --sort-type {item.sort_type} \\\n"
        f"    --i-authorize-live-collection"
    )


def _is_max_cap_reached(summary: dict[str, Any]) -> bool:
    """Return True iff this batch_summary records a primary's local
    `max_cap_reached` exhaustion (and is otherwise a clean run).

    Two surfaces carry the marker — the connector classifier sets
    `products[0].status = "max_cap_reached"`, and the resume-state
    block mirrors it onto `final_status`. Either is sufficient to
    surface the PARTIAL message; we tolerate both shapes the same way
    `apply_batch_summary` does.
    """
    products = summary.get("products") or []
    if products and isinstance(products, list):
        first = products[0]
        if isinstance(first, dict):
            if first.get("status") == "max_cap_reached":
                return True
            resume = first.get("resume_state")
            if isinstance(resume, dict) and resume.get("final_status") == "max_cap_reached":
                return True
    # Top-level fallback (the batch driver currently nests; future-
    # proof against a flatter surface).
    if summary.get("final_status") == "max_cap_reached":
        return True
    if summary.get("status") == "max_cap_reached":
        return True
    return False


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def main(
    argv: list[str] | None = None,
    *,
    subprocess_runner: SubprocessRunner | None = None,
) -> int:
    """Entry point. Tests call this directly and patch
    `subprocess_runner` to a stub. Production code invokes
    `subprocess.run` (the default)."""
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

    # ----------------------------------------------------------------
    # --check mode: gate only. No target selection beyond what the
    # tab-URL check needs. Phase A/B identical behaviour here.
    # ----------------------------------------------------------------
    if args.check:
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
            authorize_live=args.authorize_live,
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

    # ----------------------------------------------------------------
    # Select the first target.
    # ----------------------------------------------------------------
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

    # ----------------------------------------------------------------
    # Gate the first target.
    # ----------------------------------------------------------------
    # Open-tab is only permitted when both flags are present AND we're
    # actually going to run collection (i.e. not --dry-run). Under
    # --dry-run we explicitly suppress the open path even with both
    # flags so the gate behaves identically to phase A's "plan only".
    effective_authorize_live = bool(args.authorize_live and not args.dry_run)
    pre_result = evaluate_preconditions(
        queue,
        goods_no=item.goods_no,
        sort_type=item.sort_type,
        now=now,
        allow_open_tab=args.allow_open_tab,
        authorize_live=effective_authorize_live,
        head_baseline=args.head_baseline,
    )

    # I-OY-BRAND20-RUNNER-MAX-CAP-AND-STATUS-MAPPING-FIX: pick the plan-
    # block mode up-front so the header/trailing-note matches what the
    # runner is actually about to do. "live" iff the auth flag is set
    # AND --dry-run is NOT (the same predicate the loop driver uses).
    plan_mode = "live" if (args.authorize_live and not args.dry_run) else "plan_only"
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
        mode=plan_mode,
    )
    print(plan_block)

    if not pre_result.ok:
        # Plan block already enumerates the failure; CLI exit code
        # carries the operator-actionable signal. Print target hint at
        # bottom so it survives terminal truncation.
        print(f"target_url (open in CDP Chrome): {build_product_url(item.goods_no)}")
        return 2

    # ----------------------------------------------------------------
    # --dry-run / no --i-authorize-live-collection: plan only.
    # ----------------------------------------------------------------
    if args.dry_run or not args.authorize_live:
        if not args.authorize_live:
            print(
                "plan-only: --i-authorize-live-collection was NOT "
                "passed. No live collection invoked. Re-run with the "
                "flag to actually launch collection."
            )
        else:
            print(
                "--dry-run: collection subprocess NOT invoked, queue "
                "NOT mutated."
            )
        print(f"target_url (open in CDP Chrome): {build_product_url(item.goods_no)}")
        return 0

    # ----------------------------------------------------------------
    # Live collection loop. We're authorized; gate passed.
    # ----------------------------------------------------------------
    exit_code = _run_loop(
        queue=queue,
        queue_path=queue_path,
        first_item=item,
        artifact_root=args.artifact_root,
        max_items=args.max_items_per_session,
        now=now,
        subprocess_runner=subprocess_runner,
        head_baseline=args.head_baseline,
        allow_open_tab=args.allow_open_tab,
    )
    return exit_code


def _run_loop(
    *,
    queue: Brand20Queue,
    queue_path: Path,
    first_item: Any,
    artifact_root: str,
    max_items: int,
    now: datetime,
    subprocess_runner: SubprocessRunner | None,
    head_baseline: str | None,
    allow_open_tab: bool,
) -> int:
    """Run up to `max_items` collection attempts. Stops immediately on
    any 429-class signal (session-global). Returns the CLI exit code.

    Loop invariants:
      - Every attempt has had its precondition gate run BEFORE
        invocation. The first attempt's gate was run by `main()`;
        subsequent attempts run their own gate so a tab-close /
        page-redirect between SKUs is caught.
      - The queue file is reloaded from disk between attempts so a
        concurrent operator action (e.g. checkpoint certification)
        is honoured. Same disk path; same atomic-replace pattern.
      - `subprocess_runner` is the seam every test patches. The real
        `subprocess.run` is only used when an operator actually
        runs the CLI with `--i-authorize-live-collection`.
    """
    items_done = 0
    completed_count = 0
    current_item = first_item

    while items_done < max_items:
        # Run collection.
        invocation = _invoke_collection(
            current_item,
            artifact_root=artifact_root,
            now=now,
            subprocess_runner=subprocess_runner,
        )
        items_done += 1

        # Locate batch_summary.json.
        summary_path = resolve_batch_summary_path(
            artifact_root, invocation.batch_id,
        )
        if summary_path is None:
            print(
                f"error: collection child returned "
                f"{invocation.completed.returncode}; no "
                f"batch_summary.json found at "
                f"{Path(artifact_root) / invocation.batch_id}",
                file=sys.stderr,
            )
            return 1

        try:
            summary = load_batch_summary(summary_path)
        except (OSError, ValueError) as exc:
            print(
                f"error: failed to load batch_summary.json at "
                f"{summary_path}: {exc}",
                file=sys.stderr,
            )
            return 1

        # Apply to queue.
        try:
            updated_item = apply_batch_summary(queue, summary)
        except KeyError as exc:
            # Queue row missing — surface and stop. This should not
            # happen for well-formed runs since the runner picked the
            # item from the same queue.
            print(
                f"error: batch_summary references unknown queue row: "
                f"{exc}",
                file=sys.stderr,
            )
            return 1
        save_queue(queue_path, queue)

        # Post-run operator status.
        print("")
        print(
            f"applied batch_summary: status={updated_item.status} "
            f"retry_intent={updated_item.retry_intent!r} "
            f"next_run_after={updated_item.next_run_after!r} "
            f"last_attempted_at={updated_item.last_attempt_at!r}"
        )

        # Stop policy first: ANY 429-class signal halts the session
        # immediately, regardless of `max_items` remaining.
        decision = should_stop_loop(summary)
        if not decision.stop:
            decision = should_stop_loop(updated_item)

        if decision.stop:
            assert decision.operator_message is not None  # type-narrow
            print(decision.operator_message)
            if decision.reason in (
                "retry_after_cooldown", "cursor_api_rate_limited",
                "cursor_api_silenced",
            ):
                print("resume command (after cooldown elapses):")
                print(_format_resume_after_cooldown(updated_item))
            elif decision.reason == "manual_checkpoint":
                print("certify command:")
                print(_format_certify_command(updated_item))
            return 1

        # Clean done → may continue.
        if updated_item.status == "done":
            completed_count += 1
            print(
                f"DONE: {updated_item.product_name}/{updated_item.sort_type} "
                f"(rows={updated_item.rows_inserted_last}). "
                f"{completed_count}/{max_items} targets done."
            )
        elif updated_item.status == "ready" and _is_max_cap_reached(summary):
            # I-OY-BRAND20-RUNNER-MAX-CAP-AND-STATUS-MAPPING-FIX §5:
            # primary DATETIME_DESC hit the local cap. The queue layer
            # has routed this to `status=ready` (NOT `inconclusive`)
            # because re-running extends coverage. Surface a PARTIAL
            # line + the exact resume command and exit cleanly. The
            # loop deliberately does NOT advance to another SKU here
            # — the operator should decide whether to keep going on
            # this row or accept the partial coverage.
            print(
                f"PARTIAL: {updated_item.product_name}/"
                f"{updated_item.sort_type} "
                f"(rows={updated_item.rows_inserted_last}, "
                f"local cap reached). This is NOT an error — re-run "
                f"to extend coverage."
            )
            print("resume command (to extend coverage):")
            print(_format_resume_max_cap_reached(updated_item))
            return 0
        else:
            # Non-stop, non-done (e.g. inconclusive): surface and stop
            # — the operator should triage explicitly rather than the
            # loop silently advancing.
            print(
                f"inconclusive: {updated_item.product_name}/"
                f"{updated_item.sort_type}. Operator triage required "
                f"before advancing."
            )
            return 1

        if items_done >= max_items:
            break

        # Advance: reload queue (in case an operator certified a row
        # mid-session) and pick the next runnable item.
        queue = load_queue(queue_path)
        now = datetime.now(timezone.utc)
        try:
            next_item = pick_next_runnable(queue, now=now)
        except NoRunnableItemError:
            print(
                "no more runnable queue rows; session ending early at "
                f"{items_done}/{max_items} completed."
            )
            return 0

        # Gate the next item independently.
        pre = evaluate_preconditions(
            queue,
            goods_no=next_item.goods_no,
            sort_type=next_item.sort_type,
            now=now,
            allow_open_tab=allow_open_tab,
            authorize_live=True,
            head_baseline=head_baseline,
        )
        if not pre.ok:
            _print_precondition_failure(pre, stream=sys.stderr)
            return 2
        current_item = next_item

    return 0


if __name__ == "__main__":
    sys.exit(main())
