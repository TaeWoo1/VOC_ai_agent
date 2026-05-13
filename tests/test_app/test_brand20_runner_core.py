"""Tests for `src.voc.app.brand20_runner_core` (phase A).

Covers `pick_next_runnable`, `build_product_url`, `format_plan_block`,
and `should_stop_loop`. Pure-logic only — no subprocess, no CDP, no
disk I/O.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

import pytest

from src.voc.app.brand20_queue import (
    Brand20Queue,
    QueueItem,
    QueueMeta,
    make_full_sort_set,
)
from src.voc.app.brand20_runner_core import (
    PHASE_A_PLAN_NOTE,
    NoRunnableItemError,
    RowNotRunnableError,
    StopDecision,
    build_product_url,
    format_plan_block,
    pick_next_runnable,
    should_stop_loop,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _now() -> datetime:
    return datetime(2026, 5, 13, 12, 0, 0, tzinfo=timezone.utc)


def _make_queue(items: list[QueueItem]) -> Brand20Queue:
    return Brand20Queue(meta=QueueMeta(schema_version=1), items=items)


def _two_sku_queue() -> Brand20Queue:
    rows: list[QueueItem] = []
    rows.extend(make_full_sort_set(goods_no="A000000111111", product_name="Brand-A"))
    rows.extend(make_full_sort_set(goods_no="A000000222222", product_name="Brand-B"))
    return _make_queue(rows)


@dataclass
class _FakePre:
    """Stand-in for `PreconditionResult` so the core module's
    `format_plan_block` test doesn't import the precondition module."""

    ok: bool = True
    failed_check: str | None = None
    required_action: str | None = None
    notes: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# build_product_url
# ---------------------------------------------------------------------------


def test_build_product_url_exact_format_with_tab_review_suffix() -> None:
    """The `&tab=review` suffix is a contract — the connector lands on
    the review tab directly. Exact string match."""
    assert build_product_url("A000000179126") == (
        "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?"
        "goodsNo=A000000179126&tab=review"
    )


# ---------------------------------------------------------------------------
# pick_next_runnable — default mode
# ---------------------------------------------------------------------------


def test_pick_next_runnable_picks_pending_row() -> None:
    """Fresh seed with all-pending rows: runnable selection returns
    primary DATETIME_DESC of the lowest goods_no SKU."""
    queue = _two_sku_queue()
    item = pick_next_runnable(queue, now=_now())
    assert item.goods_no == "A000000111111"
    assert item.sort_type == "DATETIME_DESC"
    assert item.target_type == "primary"


def test_pick_next_runnable_primary_preferred_over_signal_sorts() -> None:
    """Even when the primary row has been touched once (attempts=1),
    it still wins over any signal sort: primary bucket=0 always
    outranks signal bucket=1+."""
    # Single-SKU queue so the test isolates the primary-vs-signal
    # decision (avoiding the cold-start tie-break with a second SKU's
    # primary).
    rows = make_full_sort_set(goods_no="A000000111111", product_name="Brand-A")
    for it in rows:
        if it.sort_type == "DATETIME_DESC":
            it.status = "ready"
            it.attempts = 1
            it.last_attempt_at = "2026-05-13T10:00:00Z"
    queue = _make_queue(rows)
    item = pick_next_runnable(queue, now=_now())
    # Brand-A primary "ready" (bucket 0, cold_start=1) beats Brand-A
    # RATING_ASC "pending" (bucket 1+, cold_start=0) because target
    # bucket dominates.
    assert item.goods_no == "A000000111111"
    assert item.sort_type == "DATETIME_DESC"


def test_pick_next_runnable_cold_start_preferred_within_datetime_desc() -> None:
    """When two primary rows are both runnable, the cold-start one
    (attempts=0, last_attempt_at=None) wins over the previously-
    attempted one."""
    queue = _two_sku_queue()
    # Mark Brand-A's primary as attempted-but-ready; Brand-B's primary
    # stays cold-start pending.
    for it in queue.items:
        if it.goods_no == "A000000111111" and it.sort_type == "DATETIME_DESC":
            it.status = "ready"
            it.attempts = 1
            it.last_attempt_at = "2026-05-13T10:00:00Z"
    item = pick_next_runnable(queue, now=_now())
    # Brand-B primary cold-start (bucket 0, cold_start=0) wins over
    # Brand-A primary ready (bucket 0, cold_start=1).
    assert item.goods_no == "A000000222222"
    assert item.sort_type == "DATETIME_DESC"


def test_pick_next_runnable_tie_break_by_goods_no_ascending() -> None:
    """Two SKUs both at primary cold-start: goods_no ascending breaks
    the tie deterministically."""
    queue = _two_sku_queue()
    item = pick_next_runnable(queue, now=_now())
    assert item.goods_no == "A000000111111"  # < "A000000222222"


def test_pick_next_runnable_cooldown_blocks_until_expiry() -> None:
    """A retry_after_cooldown row with next_run_after > now is not
    selected; the next pending row wins instead."""
    queue = _two_sku_queue()
    # Brand-A primary in cooldown, expiring in 1h.
    cooldown_iso = "2026-05-13T13:00:00Z"
    for it in queue.items:
        if it.goods_no == "A000000111111" and it.sort_type == "DATETIME_DESC":
            it.status = "retry_after_cooldown"
            it.next_run_after = cooldown_iso
            it.attempts = 1
            it.last_attempt_at = "2026-05-13T11:30:00Z"
    item = pick_next_runnable(queue, now=_now())
    # Brand-A primary is blocked; Brand-B primary (cold-start, bucket 0)
    # wins over any signal sort.
    assert item.goods_no == "A000000222222"
    assert item.sort_type == "DATETIME_DESC"


def test_pick_next_runnable_cooldown_runnable_after_expiry() -> None:
    """Same cooldown row, but at a later `now`: it becomes runnable
    again and is preferred (bucket 0 primary beats signal sorts)."""
    queue = _two_sku_queue()
    cooldown_iso = "2026-05-13T13:00:00Z"
    for it in queue.items:
        if it.goods_no == "A000000111111" and it.sort_type == "DATETIME_DESC":
            it.status = "retry_after_cooldown"
            it.next_run_after = cooldown_iso
            it.attempts = 1
            it.last_attempt_at = "2026-05-13T11:30:00Z"
    later = datetime(2026, 5, 13, 14, 0, 0, tzinfo=timezone.utc)
    item = pick_next_runnable(queue, now=later)
    # Brand-A primary (attempts=1, runnable from cooldown elapsed)
    # beats Brand-B primary cold-start? No — cold-start (0) outranks
    # attempted (1) within the same bucket. So Brand-B wins.
    assert item.goods_no == "A000000222222"
    # But verify Brand-A is no longer blocked: if Brand-B didn't
    # exist, Brand-A would be picked.
    one_sku_queue = _make_queue([
        it for it in queue.items if it.goods_no == "A000000111111"
    ])
    solo_item = pick_next_runnable(one_sku_queue, now=later)
    assert solo_item.goods_no == "A000000111111"
    assert solo_item.sort_type == "DATETIME_DESC"


def test_pick_next_runnable_skips_done_and_manual_and_inconclusive() -> None:
    """Terminal / manual_checkpoint / running statuses are never
    selected even when they're the only rows that look 'recent'."""
    queue = _two_sku_queue()
    # Mark all Brand-A rows as one-of-each terminal status.
    a_rows = [it for it in queue.items if it.goods_no == "A000000111111"]
    a_rows[0].status = "done"
    a_rows[1].status = "manual_checkpoint"
    a_rows[2].status = "running"
    a_rows[3].status = "inconclusive"
    # Leave a_rows[4] as pending so we can confirm it's still picked
    # if Brand-B didn't outrank it.
    item = pick_next_runnable(queue, now=_now())
    # Brand-B primary (bucket 0, cold-start) wins.
    assert item.goods_no == "A000000222222"


def test_pick_next_runnable_raises_when_no_row_runnable() -> None:
    """Every row terminal or blocked → NoRunnableItemError."""
    rows = make_full_sort_set(goods_no="A000000111111", product_name="Brand-A")
    for it in rows:
        it.status = "done"
    queue = _make_queue(rows)
    with pytest.raises(NoRunnableItemError):
        pick_next_runnable(queue, now=_now())


# ---------------------------------------------------------------------------
# pick_next_runnable — operator override
# ---------------------------------------------------------------------------


def test_pick_next_runnable_operator_override_returns_exact_row() -> None:
    """Operator override returns the exact (goods_no, sort_type) row,
    bypassing the suggestion order."""
    queue = _two_sku_queue()
    item = pick_next_runnable(
        queue,
        now=_now(),
        goods_no_override="A000000222222",
        sort_type_override="RATING_ASC",
    )
    assert item.goods_no == "A000000222222"
    assert item.sort_type == "RATING_ASC"


def test_pick_next_runnable_operator_override_unknown_row_raises_key_error() -> None:
    """Operator override against an unseeded (goods_no, sort_type)
    pair raises KeyError via Brand20Queue.require."""
    queue = _two_sku_queue()
    with pytest.raises(KeyError):
        pick_next_runnable(
            queue,
            now=_now(),
            goods_no_override="A000000999999",
            sort_type_override="DATETIME_DESC",
        )


def test_pick_next_runnable_operator_override_done_row_raises_row_not_runnable() -> None:
    """Operator override against a `done` row raises
    RowNotRunnableError. The runner refuses to re-run a clean done."""
    queue = _two_sku_queue()
    for it in queue.items:
        if it.goods_no == "A000000222222" and it.sort_type == "DATETIME_DESC":
            it.status = "done"
    with pytest.raises(RowNotRunnableError) as ei:
        pick_next_runnable(
            queue,
            now=_now(),
            goods_no_override="A000000222222",
            sort_type_override="DATETIME_DESC",
        )
    assert ei.value.reason in ("done",)


def test_pick_next_runnable_operator_override_active_cooldown_raises() -> None:
    """Operator override on a row still in active cooldown also
    raises RowNotRunnableError — the operator must wait."""
    queue = _two_sku_queue()
    for it in queue.items:
        if it.goods_no == "A000000222222" and it.sort_type == "DATETIME_DESC":
            it.status = "retry_after_cooldown"
            it.next_run_after = "2026-05-13T13:00:00Z"
    with pytest.raises(RowNotRunnableError) as ei:
        pick_next_runnable(
            queue,
            now=_now(),
            goods_no_override="A000000222222",
            sort_type_override="DATETIME_DESC",
        )
    assert ei.value.reason == "cooldown"


# ---------------------------------------------------------------------------
# format_plan_block
# ---------------------------------------------------------------------------


def test_format_plan_block_contains_phase_a_note_and_target_url() -> None:
    """The plan block must contain (a) the verbatim phase-A note,
    (b) the target_url with `&tab=review`, (c) the env vars."""
    queue = _two_sku_queue()
    item = queue.items[0]
    pre = _FakePre(
        ok=True,
        notes=["queue-wide cooldown: 0 row(s)"],
    )
    block = format_plan_block(
        item,
        queue_path="ops/brand20_collection_queue.json",
        artifact_root="data/collection_artifacts",
        env_vars={
            "OY_CURSOR_PACING_MS": "500",
            "OY_CURSOR_RATE_LIMIT_COOLDOWN_SEC": "120",
            "OY_CURSOR_RATE_LIMIT_MAX_RETRIES": "1",
        },
        command_line="/Users/taewookang/.pyenv/shims/python3 scripts/run_oy_collection_batch.py --manifest <tmp>",
        precondition_result=pre,
    )
    assert "phase A. No live collection launched." in block
    assert PHASE_A_PLAN_NOTE in block
    assert build_product_url(item.goods_no) in block
    assert "OY_CURSOR_PACING_MS=500" in block
    assert "OY_CURSOR_RATE_LIMIT_COOLDOWN_SEC=120" in block
    assert "OY_CURSOR_RATE_LIMIT_MAX_RETRIES=1" in block
    assert "queue-wide cooldown: 0 row(s)" in block


def test_format_plan_block_surfaces_precondition_failure() -> None:
    """When the gate failed, the plan block surfaces the
    failed_check / required_action so the operator sees them without
    scrolling back to the gate output."""
    queue = _two_sku_queue()
    item = queue.items[0]
    pre = _FakePre(
        ok=False,
        failed_check="cdp_unreachable",
        required_action="Start Chrome with --remote-debugging-port=9222.",
    )
    block = format_plan_block(
        item,
        queue_path="x.json",
        artifact_root="data/collection_artifacts",
        env_vars={},
        command_line="(none)",
        precondition_result=pre,
    )
    assert "cdp_unreachable" in block
    assert "Start Chrome" in block


# ---------------------------------------------------------------------------
# should_stop_loop
# ---------------------------------------------------------------------------


def test_stop_policy_retry_after_cooldown_stops() -> None:
    decision = should_stop_loop({"retry_intent": "retry_after_cooldown"})
    assert decision.stop is True
    assert decision.reason == "retry_after_cooldown"
    assert decision.operator_message is not None


def test_stop_policy_cursor_api_rate_limited_stops() -> None:
    decision = should_stop_loop({"cursor_api_rate_limited": True})
    assert decision.stop is True
    assert decision.reason == "cursor_api_rate_limited"


def test_stop_policy_cursor_api_silenced_stops() -> None:
    decision = should_stop_loop({"cursor_api_silenced": True})
    assert decision.stop is True
    assert decision.reason == "cursor_api_silenced"


def test_stop_policy_manual_checkpoint_status_stops() -> None:
    """A QueueItem (post-apply_batch_summary) with
    status='manual_checkpoint' stops the loop."""
    item = QueueItem(
        goods_no="A000000111111",
        product_name="X",
        sort_type="DATETIME_DESC",
        target_type="primary",
        status="manual_checkpoint",
    )
    decision = should_stop_loop(item)
    assert decision.stop is True
    assert decision.reason == "manual_checkpoint"


def test_stop_policy_retry_after_cooldown_status_stops() -> None:
    item = QueueItem(
        goods_no="A000000111111",
        product_name="X",
        sort_type="DATETIME_DESC",
        target_type="primary",
        status="retry_after_cooldown",
    )
    decision = should_stop_loop(item)
    assert decision.stop is True
    assert decision.reason == "retry_after_cooldown"


def test_stop_policy_done_does_not_stop() -> None:
    """A clean done is NOT a stop signal — the loop driver can
    advance to the next item if max-items-per-session allows."""
    item = QueueItem(
        goods_no="A000000111111",
        product_name="X",
        sort_type="DATETIME_DESC",
        target_type="primary",
        status="done",
    )
    decision = should_stop_loop(item)
    assert decision.stop is False
    assert decision.reason is None
    assert decision.operator_message is None


def test_stop_policy_returns_stop_decision_dataclass() -> None:
    """Smoke: the return type is the documented dataclass."""
    decision = should_stop_loop({"retry_intent": "none"})
    assert isinstance(decision, StopDecision)
