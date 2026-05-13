"""Pure core for the Brand-20 queue runner.

This module composes the existing `Brand20Queue` data layer with the
runner CLI. It is intentionally I/O-free: no subprocess, no HTTP, no
clock reads (callers pass `now` in). Everything in here is unit-
testable without mocking.

Phase A scope:
  - `pick_next_runnable` — select the next runnable QueueItem given a
    snapshot and an optional operator override.
  - `build_product_url` — canonical OliveYoung product-detail URL with
    the `&tab=review` suffix.
  - `format_plan_block` — operator-facing plan block printed before
    any subprocess call would be made.
  - `should_stop_loop` — pure decision function for the session-global
    throttle policy. Phase A ships this for tests; phase B calls it.

Phase B will add:
  - `build_temporary_manifest` (manifest writer)
  - `load_batch_summary_from_artifact_root` (subprocess result reader)

These are deferred per the planning handoff §12.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from src.voc.app.brand20_queue import (
    ALL_SORTS,
    Brand20Queue,
    QueueItem,
    _parse_iso,
)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class NoRunnableItemError(RuntimeError):
    """Raised by `pick_next_runnable` when no queue row is currently
    eligible for collection. The CLI maps this to exit code 3.
    """


class RowNotRunnableError(RuntimeError):
    """Raised by `pick_next_runnable` when the operator override picks
    a row whose status is terminal / blocked (done, manual_checkpoint,
    inconclusive, running) or whose cooldown is still active.

    Carries the underlying reason as a single short token so the CLI
    can surface it without re-deriving from `item.status`.
    """

    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason


# ---------------------------------------------------------------------------
# Stop-policy result
# ---------------------------------------------------------------------------


@dataclass
class StopDecision:
    """Result of `should_stop_loop`.

    `stop` is the boolean the loop driver inspects; `reason` is a
    single short token (e.g. `cursor_api_rate_limited`,
    `manual_checkpoint`) the CLI can attach to its operator-facing
    message; `operator_message` is the verbatim line the CLI prints
    when stopping.
    """

    stop: bool
    reason: str | None
    operator_message: str | None


# ---------------------------------------------------------------------------
# URL helper
# ---------------------------------------------------------------------------


def build_product_url(goods_no: str) -> str:
    """Return the canonical OliveYoung product-detail URL.

    The `&tab=review` suffix is part of the contract — it lands the
    operator directly on the review tab, which is the surface the
    connector scrapes. Tests assert this exact string equality.
    """
    return (
        "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?"
        f"goodsNo={goods_no}&tab=review"
    )


# ---------------------------------------------------------------------------
# Runnable selection
# ---------------------------------------------------------------------------


def _is_runnable_status(item: QueueItem, *, now: datetime) -> tuple[bool, str | None]:
    """Return `(runnable, reason_when_blocked)` for a single row.

    Status taxonomy from `brand20_queue.py`:
      - pending / ready                          → runnable
      - retry_after_cooldown                     → runnable iff next_run_after <= now
      - manual_checkpoint / running / done / inconclusive → never runnable
    """
    if item.status in ("pending", "ready"):
        return True, None
    if item.status == "retry_after_cooldown":
        nra = _parse_iso(item.next_run_after)
        if nra is None:
            # Cooldown row with no anchor — conservatively block. This
            # path should not happen for well-formed queue rows but the
            # runner should not blindly advance a malformed row.
            return False, "cooldown_anchor_missing"
        if nra <= now:
            return True, None
        return False, "cooldown"
    # Terminal / explicit-operator-action statuses.
    return False, item.status


def _selection_priority(item: QueueItem) -> tuple[int, int, str]:
    """Selection key for `pick_next_runnable`.

    Mirrors `brand20_queue._suggestion_priority` exactly: primary
    (DATETIME_DESC) before signal sorts; within each bucket, cold-start
    rows (never attempted) before previously-attempted rows;
    `goods_no` ascending as a stable tie-break.

    The runner deliberately re-implements the key inline rather than
    importing the private helper from `brand20_queue` — phase A treats
    `brand20_queue` as an immutable schema/state surface, and the
    selection key is part of the runner's contract that tests pin
    directly.
    """
    if item.target_type == "primary":
        bucket = 0
    else:
        try:
            idx = ALL_SORTS.index(item.sort_type)
        except ValueError:
            idx = 99
        bucket = 1 + idx
    cold_start = 0 if (item.attempts == 0 and item.last_attempt_at is None) else 1
    return (bucket, cold_start, item.goods_no)


def pick_next_runnable(
    queue: Brand20Queue,
    *,
    now: datetime,
    goods_no_override: str | None = None,
    sort_type_override: str | None = None,
) -> QueueItem:
    """Return the next runnable queue row.

    Default mode (no override): scan every row, keep runnable rows
    per `_is_runnable_status`, return the one with the smallest
    `_selection_priority` key. Raises `NoRunnableItemError` when the
    queue has no runnable row at `now`.

    Operator override (both `goods_no_override` and `sort_type_override`
    set): return that exact row, bypassing suggestion order. Raises
    `KeyError` (via `queue.require`) when the row does not exist.
    Raises `RowNotRunnableError` when the row exists but is currently
    blocked (terminal status or active cooldown). The runner refuses
    to honour an override against a `done` / `manual_checkpoint` /
    `inconclusive` row because those statuses gate themselves on an
    explicit operator transition (`mark_checkpoint_certified.py`,
    triage, etc.).
    """
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    if goods_no_override is not None and sort_type_override is not None:
        # `queue.require` raises KeyError on a missing row, which is
        # the contract the CLI tests pin.
        item = queue.require(goods_no_override, sort_type_override)
        runnable, reason = _is_runnable_status(item, now=now)
        if not runnable:
            raise RowNotRunnableError(
                reason or item.status,
                f"row (goods_no={goods_no_override!r}, "
                f"sort_type={sort_type_override!r}) is not runnable: "
                f"status={item.status!r} reason={reason!r}",
            )
        return item

    runnable_items: list[QueueItem] = []
    for it in queue.items:
        ok, _ = _is_runnable_status(it, now=now)
        if ok:
            runnable_items.append(it)

    if not runnable_items:
        raise NoRunnableItemError(
            "no queue row is currently runnable (every row is either "
            "terminal, manual_checkpoint, or in active cooldown)"
        )
    runnable_items.sort(key=_selection_priority)
    return runnable_items[0]


# ---------------------------------------------------------------------------
# Plan block
# ---------------------------------------------------------------------------


# Operator-facing literal kept as a module-level constant so the CLI
# test can grep for it without depending on render ordering.
PHASE_A_PLAN_NOTE: str = (
    "NOTE: phase A. No live collection launched. Pass --i-authorize-live-collection\n"
    "      AFTER phase B lands to actually invoke the child process."
)


def format_plan_block(
    item: QueueItem,
    *,
    queue_path: str,
    artifact_root: str,
    env_vars: dict[str, str],
    command_line: str,
    precondition_result: Any,
) -> str:
    """Render the phase-A plan block.

    `precondition_result` is duck-typed (matches
    `brand20_runner_precondition.PreconditionResult`) so this module
    has no import-time dependency on the precondition module. Tests
    pass in a tiny stand-in dataclass.
    """
    ok = bool(getattr(precondition_result, "ok", False))
    notes = list(getattr(precondition_result, "notes", []) or [])
    failed_check = getattr(precondition_result, "failed_check", None)
    required_action = getattr(precondition_result, "required_action", None)

    lines: list[str] = []
    sep = "=" * 78
    lines.append(sep)
    lines.append("Brand-20 runner — phase A plan block")
    lines.append(sep)
    lines.append(f"goods_no:        {item.goods_no}")
    lines.append(f"product_name:    {item.product_name}")
    lines.append(f"sort_type:       {item.sort_type}")
    lines.append(f"target_url:      {build_product_url(item.goods_no)}")
    lines.append(f"queue:           {queue_path}")
    lines.append(f"artifact_root:   {artifact_root}")
    lines.append("")
    lines.append("preconditions:")
    lines.append(f"  ok:    {ok}")
    if failed_check:
        lines.append(f"  failed_check:    {failed_check}")
    if required_action:
        lines.append(f"  required_action: {required_action}")
    if notes:
        lines.append("  notes:")
        for n in notes:
            lines.append(f"    - {n}")
    else:
        lines.append("  notes: (none)")
    lines.append("")
    lines.append("env that WOULD be used (phase B):")
    # Sorted for determinism so tests can pin exact text.
    for k in sorted(env_vars.keys()):
        lines.append(f"  {k}={env_vars[k]}")
    lines.append("")
    lines.append("command that WOULD be run (phase B):")
    lines.append(f"  {command_line}")
    lines.append("")
    lines.append(PHASE_A_PLAN_NOTE)
    lines.append(sep)
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Stop policy
# ---------------------------------------------------------------------------


def _get_attr_or_key(obj: Any, key: str, default: Any = None) -> Any:
    """Return `obj.key` if obj is a QueueItem-like model, else
    `obj[key]` if obj is a dict, else `default`. Used so the stop
    policy can accept either a `QueueItem` (post-`apply_batch_summary`)
    or a raw `batch_summary` dict (mid-flight, before queue mutation).
    """
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def should_stop_loop(batch_summary_or_item: Any) -> StopDecision:
    """Return whether the runner loop should stop after this attempt.

    Pure function: no I/O, no clock, no subprocess. Phase A ships this
    for unit tests; phase B's CLI loop calls it after every collection
    attempt to decide whether to advance to the next runnable item.

    Stop conditions (any True → stop):
      - `retry_intent == "retry_after_cooldown"`
      - `cursor_api_rate_limited is True`
      - `cursor_api_silenced is True`
      - resulting QueueItem `status == "manual_checkpoint"`
      - resulting QueueItem `status == "retry_after_cooldown"`

    `inconclusive` is intentionally NOT a stop condition here — phase
    B's CLI handles it separately with an explicit operator-triage
    message (the loop stops because no batch advance is safe, but the
    decision is made by the CLI driver, not by this pure function).
    """
    obj = batch_summary_or_item

    retry_intent = _get_attr_or_key(obj, "retry_intent")
    cursor_api_rate_limited = bool(_get_attr_or_key(obj, "cursor_api_rate_limited", False))
    cursor_api_silenced = bool(_get_attr_or_key(obj, "cursor_api_silenced", False))
    status = _get_attr_or_key(obj, "status")

    if retry_intent == "retry_after_cooldown":
        return StopDecision(
            stop=True,
            reason="retry_after_cooldown",
            operator_message=(
                "STOP: cursor 429 / retry_after_cooldown observed. "
                "Session-global throttle in effect."
            ),
        )
    if cursor_api_rate_limited:
        return StopDecision(
            stop=True,
            reason="cursor_api_rate_limited",
            operator_message=(
                "STOP: cursor_api_rate_limited=True observed. "
                "Session-global throttle in effect."
            ),
        )
    if cursor_api_silenced:
        return StopDecision(
            stop=True,
            reason="cursor_api_silenced",
            operator_message=(
                "STOP: cursor_api_silenced=True observed "
                "(cold-start AND-gate). Session-global throttle."
            ),
        )
    if status == "manual_checkpoint":
        return StopDecision(
            stop=True,
            reason="manual_checkpoint",
            operator_message=(
                "STOP: manual_checkpoint. Operator must log in / clear "
                "the auth wall, then run mark_brand20_checkpoint_certified.py."
            ),
        )
    if status == "retry_after_cooldown":
        return StopDecision(
            stop=True,
            reason="retry_after_cooldown",
            operator_message=(
                "STOP: row landed in retry_after_cooldown. "
                "Session-global throttle in effect."
            ),
        )
    return StopDecision(stop=False, reason=None, operator_message=None)
