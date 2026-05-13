"""Tests for src.voc.app.brand20_queue.

Covers Req 7 of I-OY-BRAND20-COLLECTION-QUEUE-AND-COVERAGE-DASHBOARD:
state-transition rules, dashboard bucketing, manual_checkpoint
certification, and the collection-isolation guard.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

from src.voc.app.brand20_queue import (
    ALL_SORTS,
    LIVE_COLLECTION_AUTH_REMINDER,
    PRIMARY_SORT,
    SIGNAL_SORTS,
    Brand20Queue,
    QueueItem,
    QueueMeta,
    apply_batch_summary,
    dashboard_view,
    generate_next_run_prompt,
    load_queue,
    make_full_sort_set,
    mark_checkpoint_certified,
    save_queue,
)


FIXTURES = Path(__file__).resolve().parent / "fixtures"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _two_sku_queue() -> Brand20Queue:
    """Two SKUs × 5 sorts = 10 items, all 'pending'. Used to exercise
    test_queue_initialization_from_fixture without depending on the
    canonical seed file."""
    items: list[QueueItem] = []
    items.extend(make_full_sort_set(
        goods_no="A000000111111",
        product_name="Brand-A Test",
    ))
    items.extend(make_full_sort_set(
        goods_no="A000000222222",
        product_name="Brand-B Test",
    ))
    return Brand20Queue(
        meta=QueueMeta(
            schema_version=1,
            seed_complete=False,
            seeded_brands=["Brand-A", "Brand-B"],
            pending_brands_count=18,
            notes="two-SKU test fixture",
        ),
        items=items,
    )


def _load_fixture(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# 1. Initialization
# ---------------------------------------------------------------------------


def test_queue_initialization_from_fixture(tmp_path: Path) -> None:
    """A round-trip save + load preserves all 18 QueueItem fields."""
    queue = _two_sku_queue()
    assert len(queue.items) == 10
    # All sorts present for both SKUs.
    for goods_no in ("A000000111111", "A000000222222"):
        seen = {it.sort_type for it in queue.items if it.goods_no == goods_no}
        assert seen == set(ALL_SORTS), seen
    # target_type assignment matches the canonical primary/signal split.
    for it in queue.items:
        if it.sort_type == PRIMARY_SORT:
            assert it.target_type == "primary"
        else:
            assert it.target_type == "signal"
            assert it.sort_type in SIGNAL_SORTS

    path = tmp_path / "queue.json"
    save_queue(path, queue)
    reloaded = load_queue(path)
    assert reloaded.model_dump() == queue.model_dump()


# ---------------------------------------------------------------------------
# 2. cursor-429 ingestion (operator-retry no-cooldown-gate)
# ---------------------------------------------------------------------------
#
# I-OY-BRAND20-OPERATOR-RETRY-NO-COOLDOWN-GATE repurposes this test
# (formerly `test_apply_batch_summary_retry_after_cooldown` which
# asserted `status="retry_after_cooldown"` + `next_run_after = now+90m`).
# A 429-class batch_summary now routes the row to `ready` with
# `next_run_after=None`; the upstream `retry_intent` / `retry_after_minutes`
# audit fields are preserved verbatim so the audit trail still names
# the cause. The runner session-stop policy is tested separately in
# `test_brand20_runner_core.py`.


def test_apply_batch_summary_cursor_429_routes_to_ready_no_time_gate() -> None:
    """A cursor-429 batch_summary (retry_intent=retry_after_cooldown,
    cursor_api_rate_limited=True) leaves the queue row at
    `status="ready"` with `next_run_after=None`. The operator may
    immediately re-select; the runner's session stop is enforced
    elsewhere (`should_stop_loop`)."""
    queue = _two_sku_queue()
    # Re-target the fixture's goods_no onto a row that exists in the
    # test queue so the lookup succeeds.
    batch = _load_fixture("brand20_batch_retry_after_cooldown.json")
    batch["products"][0]["oy_goods_no"] = "A000000111111"
    batch["products"][0]["resume_state"]["goods_no"] = "A000000111111"

    now = datetime(2026, 5, 13, 13, 52, 22, tzinfo=timezone.utc)
    item = apply_batch_summary(queue, batch, now=now)

    # Routed to `ready` (was `retry_after_cooldown` pre-change).
    assert item.status == "ready"
    # No wall-clock gate (was last_attempt_at + 90min pre-change).
    assert item.next_run_after is None
    # Audit trail preserved: connector's retry_intent +
    # retry_after_minutes pass through verbatim.
    assert item.retry_intent == "retry_after_cooldown"
    assert item.retry_after_minutes == 90
    # last_attempt_at written by apply_batch_summary's clock pass.
    assert item.last_attempt_at == "2026-05-13T13:52:22Z"
    assert item.checkpoint_reason is None
    # operator_note records the audit hint so the inspector / CLI can
    # surface why the row is `ready` rather than fresh-pending.
    assert item.operator_note is not None
    assert "cursor_api_rate_limited" in item.operator_note
    # Run-history bookkeeping carries through.
    assert item.attempts == 1
    assert item.raw_records_seen_last == 630
    assert item.last_run_id == "run_20260513_134328_a1e307"


def test_apply_batch_summary_cursor_silenced_routes_to_ready_with_silenced_note() -> None:
    """`cursor_api_silenced=True` (cold-start AND-gate) is also a
    429-class signal and likewise routes the row to `ready` with
    `next_run_after=None`. The `operator_note` carries the silenced
    phrasing so the operator can distinguish the two surfaces."""
    queue = _two_sku_queue()
    batch = _load_fixture("brand20_batch_retry_after_cooldown.json")
    batch["products"][0]["oy_goods_no"] = "A000000111111"
    batch["products"][0]["resume_state"]["goods_no"] = "A000000111111"
    # Flip the surface signal: silenced instead of rate_limited. The
    # silenced phrasing is more specific (cold-start AND-gate).
    batch["products"][0]["summary"]["cursor_api_rate_limited"] = True
    batch["products"][0]["summary"]["cursor_api_silenced"] = True
    batch["products"][0]["resume_state"]["cursor_api_silenced"] = True

    item = apply_batch_summary(queue, batch)
    assert item.status == "ready"
    assert item.next_run_after is None
    assert item.operator_note is not None
    assert "cursor_api_silenced" in item.operator_note


def test_apply_batch_summary_retry_intent_alone_does_not_call_note_429() -> None:
    queue = _two_sku_queue()
    batch = _load_fixture("brand20_batch_retry_after_cooldown.json")
    batch["products"][0]["oy_goods_no"] = "A000000111111"
    batch["products"][0]["resume_state"]["goods_no"] = "A000000111111"
    batch["products"][0]["summary"]["cursor_api_rate_limited"] = False
    batch["products"][0]["summary"]["cursor_api_silenced"] = False
    batch["products"][0]["resume_state"]["cursor_api_rate_limited"] = False
    batch["products"][0]["resume_state"]["cursor_api_silenced"] = False

    item = apply_batch_summary(queue, batch)

    assert item.status == "ready"
    assert item.retry_intent == "retry_after_cooldown"
    assert item.operator_note is not None
    assert "retry_after_cooldown observed" in item.operator_note
    assert "cursor 429" not in item.operator_note
    assert "cursor_api_rate_limited" not in item.operator_note


def test_apply_batch_summary_cursor_429_row_is_picked_by_runnable_selection() -> None:
    """After a cursor-429 batch_summary lands, the row IS selected by
    `pick_next_runnable` on the very next call — no wall-clock wait.
    The operator may immediately re-select the row.

    This test pins the operator-retry-no-cooldown-gate user contract
    via the public runner-core API. The runner's session-stop is
    tested separately (`should_stop_loop`)."""
    from src.voc.app.brand20_runner_core import pick_next_runnable

    queue = _two_sku_queue()
    batch = _load_fixture("brand20_batch_retry_after_cooldown.json")
    batch["products"][0]["oy_goods_no"] = "A000000111111"
    batch["products"][0]["resume_state"]["goods_no"] = "A000000111111"

    now = datetime(2026, 5, 13, 13, 52, 22, tzinfo=timezone.utc)
    apply_batch_summary(queue, batch, now=now)

    # Pick the next runnable from the SAME `now` — no time-gate.
    picked = pick_next_runnable(queue, now=now,
                                goods_no_override="A000000111111",
                                sort_type_override="DATETIME_DESC")
    assert picked.goods_no == "A000000111111"
    assert picked.sort_type == "DATETIME_DESC"
    assert picked.status == "ready"


# ---------------------------------------------------------------------------
# 3. manual_review_required ingestion
# ---------------------------------------------------------------------------


def test_apply_batch_summary_manual_review_required() -> None:
    queue = _two_sku_queue()
    batch = _load_fixture("brand20_batch_manual_review.json")
    batch["products"][0]["oy_goods_no"] = "A000000111111"
    batch["products"][0]["resume_state"]["goods_no"] = "A000000111111"

    item = apply_batch_summary(queue, batch)
    assert item.status == "manual_checkpoint"
    assert item.checkpoint_reason == "auth_or_human_check"
    assert item.next_run_after is None
    assert item.retry_intent == "manual_review_required"


# ---------------------------------------------------------------------------
# 4. complete / ok ingestion
# ---------------------------------------------------------------------------


def test_apply_batch_summary_complete_ok() -> None:
    queue = _two_sku_queue()
    batch = _load_fixture("brand20_batch_complete.json")
    batch["products"][0]["oy_goods_no"] = "A000000111111"
    batch["products"][0]["resume_state"]["goods_no"] = "A000000111111"

    item = apply_batch_summary(queue, batch)
    assert item.status == "done"
    assert item.checkpoint_reason is None
    assert item.next_run_after is None
    assert item.rows_inserted_last == 3120


# ---------------------------------------------------------------------------
# 5. inconclusive ingestion
# ---------------------------------------------------------------------------


def test_apply_batch_summary_inconclusive() -> None:
    queue = _two_sku_queue()
    batch = _load_fixture("brand20_batch_inconclusive.json")
    batch["products"][0]["oy_goods_no"] = "A000000111111"
    batch["products"][0]["resume_state"]["goods_no"] = "A000000111111"

    item = apply_batch_summary(queue, batch)
    assert item.status == "inconclusive"
    assert item.checkpoint_reason is None
    assert item.next_run_after is None


# ---------------------------------------------------------------------------
# 6. Dashboard bucketing
# ---------------------------------------------------------------------------


def test_dashboard_groups_ready_waiting_manual() -> None:
    """Mix one ready, one retry_after_cooldown, one manual_checkpoint
    and assert each lands in its bucket; ready_now is primary-first."""
    now = datetime(2026, 5, 13, 18, 0, 0, tzinfo=timezone.utc)
    items: list[QueueItem] = [
        # ready (primary)
        QueueItem(
            goods_no="A000000111111",
            product_name="Brand-A",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="ready",
        ),
        # ready (signal) — should appear AFTER the primary in ready_now
        QueueItem(
            goods_no="A000000111111",
            product_name="Brand-A",
            sort_type="RATING_ASC",
            target_type="signal",
            status="ready",
        ),
        # retry_after_cooldown (waiting)
        QueueItem(
            goods_no="A000000222222",
            product_name="Brand-B",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="retry_after_cooldown",
            last_attempt_at="2026-05-13T17:00:00Z",
            next_run_after="2026-05-13T18:30:00Z",
            retry_intent="retry_after_cooldown",
            retry_after_minutes=90,
        ),
        # manual_checkpoint
        QueueItem(
            goods_no="A000000333333",
            product_name="Brand-C",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="manual_checkpoint",
            checkpoint_reason="auth_or_human_check",
        ),
    ]
    queue = Brand20Queue(items=items)
    view = dashboard_view(queue, now=now)

    assert len(view.ready_now) == 2
    # Primary-first ordering.
    assert view.ready_now[0].target_type == "primary"
    assert view.ready_now[1].target_type == "signal"

    assert len(view.waiting) == 1
    assert view.waiting[0].goods_no == "A000000222222"

    assert len(view.manual) == 1
    assert view.manual[0].goods_no == "A000000333333"

    # Counts sanity.
    assert view.counts["ready"] == 2
    assert view.counts["retry_after_cooldown"] == 1
    assert view.counts["manual_checkpoint"] == 1

    # Suggestions: capped at 3, primary ready first.
    assert len(view.suggestions) <= 3
    assert view.suggestions[0].sort_type == "DATETIME_DESC"
    assert view.suggestions[0].target_type == "primary"


# ---------------------------------------------------------------------------
# 7. mark_checkpoint_certified flips manual → ready
# ---------------------------------------------------------------------------


def test_mark_checkpoint_certified_flips_to_ready() -> None:
    queue = Brand20Queue(items=[
        QueueItem(
            goods_no="A000000111111",
            product_name="Brand-A",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="manual_checkpoint",
            checkpoint_reason="auth_or_human_check",
        ),
    ])
    note = "operator logged in + verified human-check at 12:34"
    item = mark_checkpoint_certified(
        queue,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
        note=note,
    )
    assert item.status == "ready"
    assert item.checkpoint_reason is None
    assert item.next_run_after is None
    assert item.operator_note == note


# ---------------------------------------------------------------------------
# 8. mark_checkpoint_certified rejects non-checkpoint rows
# ---------------------------------------------------------------------------


def test_mark_checkpoint_certified_rejects_non_checkpoint_item() -> None:
    queue = Brand20Queue(items=[
        QueueItem(
            goods_no="A000000111111",
            product_name="Brand-A",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="done",
        ),
    ])
    with pytest.raises(ValueError, match="manual_checkpoint"):
        mark_checkpoint_certified(
            queue,
            goods_no="A000000111111",
            sort_type="DATETIME_DESC",
            note="should not flip",
        )


# ---------------------------------------------------------------------------
# 9. apply_batch_summary does not invoke collection
# ---------------------------------------------------------------------------


def test_apply_batch_summary_does_not_invoke_collection() -> None:
    """Verify the module never imports a connector and never spawns a
    subprocess during apply. We assert two things:

    (a) `src.voc.app.brand20_queue` does not pull in any connector
        module at import time. Checked in a clean subprocess so the
        result is independent of which other tests have run earlier
        in the session.
    (b) During apply, subprocess.run / urllib.request raise if called,
        proving the apply path doesn't touch them.
    """
    # (a) Static import-graph check, in a clean Python process so
    # earlier-running tests can't pre-import the connectors and
    # contaminate the in-process module table.
    import subprocess as _subprocess

    repo = Path(__file__).resolve().parents[2]
    probe = (
        "import sys;"
        "import src.voc.app.brand20_queue as _m;"
        "bad=[n for n in sys.modules if n.startswith('src.voc.connectors')];"
        "print('BAD=' + ','.join(sorted(bad)))"
    )
    result = _subprocess.run(
        [sys.executable, "-c", probe],
        cwd=str(repo),
        env={"PYTHONPATH": str(repo), "PATH": "/usr/bin:/bin"},
        capture_output=True, text=True, check=True,
    )
    output = result.stdout.strip()
    assert output.startswith("BAD="), output
    bad_csv = output.removeprefix("BAD=")
    assert bad_csv == "", (
        f"brand20_queue must not transitively import connector modules; "
        f"found: {bad_csv}"
    )

    # (b) Behavioral guard: patch subprocess.run / urllib.request and
    # confirm apply_batch_summary completes without touching either.
    import urllib.request as _urllib_request

    calls: list[str] = []

    def _trip_subprocess(*args, **kwargs):  # type: ignore[no-untyped-def]
        calls.append("subprocess.run")
        raise RuntimeError("subprocess.run must not be called from apply")

    def _trip_urlopen(*args, **kwargs):  # type: ignore[no-untyped-def]
        calls.append("urllib.request.urlopen")
        raise RuntimeError("urlopen must not be called from apply")

    real_run = _subprocess.run
    real_urlopen = _urllib_request.urlopen
    _subprocess.run = _trip_subprocess  # type: ignore[assignment]
    _urllib_request.urlopen = _trip_urlopen  # type: ignore[assignment]
    try:
        queue = _two_sku_queue()
        batch = _load_fixture("brand20_batch_retry_after_cooldown.json")
        batch["products"][0]["oy_goods_no"] = "A000000111111"
        batch["products"][0]["resume_state"]["goods_no"] = "A000000111111"
        apply_batch_summary(queue, batch)
    finally:
        _subprocess.run = real_run  # type: ignore[assignment]
        _urllib_request.urlopen = real_urlopen  # type: ignore[assignment]

    assert calls == [], (
        f"apply_batch_summary triggered a forbidden side effect: {calls}"
    )


# ---------------------------------------------------------------------------
# 10. Unknown (goods_no, sort_type) raises
# ---------------------------------------------------------------------------


def test_apply_batch_summary_missing_target_raises() -> None:
    queue = _two_sku_queue()
    batch = _load_fixture("brand20_batch_complete.json")
    # Leave the fixture's goods_no untouched (A000000179126), which is
    # NOT in the two-SKU test queue.
    with pytest.raises(KeyError, match="A000000179126"):
        apply_batch_summary(queue, batch)


# ---------------------------------------------------------------------------
# 11. Precedence: cursor-429 beats final_status=complete (but no time gate)
# ---------------------------------------------------------------------------
#
# I-OY-BRAND20-OPERATOR-RETRY-NO-COOLDOWN-GATE: cursor-throttle still
# beats clean-complete (`done` would mislead the operator into thinking
# the corpus is full when the rate-limit truncated it), but the row no
# longer wall-clock-gates — it routes to `ready` with an audit note.


def test_precedence_cursor_429_over_complete_routes_to_ready() -> None:
    """final_status='complete' + retry_intent='retry_after_cooldown'
    → row lands on `ready` (NOT `done`, NOT `retry_after_cooldown`).
    The cursor-throttle signal beats clean-complete because the
    completion happened under throttling, but the row is operator-retry
    ready immediately, not 90-minute gated."""
    queue = _two_sku_queue()
    batch = _load_fixture("brand20_batch_precedence_complete_and_rate_limited.json")
    batch["products"][0]["oy_goods_no"] = "A000000111111"
    batch["products"][0]["resume_state"]["goods_no"] = "A000000111111"

    item = apply_batch_summary(queue, batch)
    # Cursor-throttle wins over `done`.
    assert item.status != "done"
    # New routing: `ready` (operator-retry no-cooldown-gate). Not
    # `retry_after_cooldown` — that was the pre-ticket behaviour.
    assert item.status == "ready"
    assert item.next_run_after is None
    # retry_intent audit preserved.
    assert item.retry_intent == "retry_after_cooldown"
    # operator_note carries the audit hint.
    assert item.operator_note is not None
    assert "cursor_api_rate_limited" in item.operator_note


# ---------------------------------------------------------------------------
# 12. Next-run prompt contains required env + reminder
# ---------------------------------------------------------------------------


def test_next_run_prompt_contains_required_env() -> None:
    item = QueueItem(
        goods_no="A000000225736",
        product_name="Ilso",
        sort_type="DATETIME_DESC",
        target_type="primary",
        status="ready",
    )
    prompt = generate_next_run_prompt(item)
    assert "OY_CURSOR_PACING_MS=500" in prompt
    assert "OY_CURSOR_RATE_LIMIT_COOLDOWN_SEC=120" in prompt
    assert "OY_CURSOR_RATE_LIMIT_MAX_RETRIES=1" in prompt
    # Verbatim live-collection reminder.
    assert LIVE_COLLECTION_AUTH_REMINDER in prompt
    assert (
        "live collection requires explicit per-turn operator "
        "authorization"
    ) in prompt
    # CDP-tab URL contains the goodsNo.
    assert "goodsNo=A000000225736" in prompt
    # Header line carries the product + sort.
    assert "Ilso" in prompt
    assert "DATETIME_DESC" in prompt


# ---------------------------------------------------------------------------
# 13. Real Brand-20 seed file cardinality invariants
# ---------------------------------------------------------------------------


def test_full_queue_seed_cardinality() -> None:
    """The on-disk Brand-20 seed must hold the full 20-SKU × 5-sort grid.

    Intentionally pinned to the real ops/brand20_collection_queue.json
    so any future edit that violates the invariants (drops a SKU,
    introduces a non-canonical signal sort, leaves seed_complete=False)
    fails in CI rather than silently degrading the campaign scope.
    """
    repo_root = Path(__file__).resolve().parents[2]
    queue_path = repo_root / "ops" / "brand20_collection_queue.json"
    queue = load_queue(queue_path)

    # (1) Exactly 100 total items.
    assert len(queue.items) == 100, len(queue.items)

    # (2) Exactly 20 unique goods_no values.
    goods_set = {it.goods_no for it in queue.items}
    assert len(goods_set) == 20, sorted(goods_set)

    # Canonical signal-sort taxonomy for this campaign (see tickets
    # I-OY-BRAND20-FULL-QUEUE-SEED and I-OY-BRAND20-SIGNAL-SORT-CONSTANT-ALIGN).
    # Pinned literally so this test stays green even if SIGNAL_SORTS is
    # ever re-shuffled or extended; the seed file invariant is the
    # operator-facing contract.
    canonical_signals = {
        "RATING_ASC", "RATING_DESC", "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
    }

    for goods_no in goods_set:
        rows_for_goods = [it for it in queue.items if it.goods_no == goods_no]
        # (3) Each goods_no has exactly 5 items.
        assert len(rows_for_goods) == 5, (goods_no, len(rows_for_goods))
        # (4) Exactly one primary (DATETIME_DESC).
        primaries = [it for it in rows_for_goods if it.target_type == "primary"]
        assert len(primaries) == 1, (goods_no, [p.sort_type for p in primaries])
        assert primaries[0].sort_type == "DATETIME_DESC", primaries[0].sort_type
        # (5) Four non-primary rows use the canonical signal sort names.
        signal_sorts = {it.sort_type for it in rows_for_goods
                        if it.target_type == "signal"}
        assert signal_sorts == canonical_signals, (goods_no, signal_sorts)

    # (6) _meta.seed_complete is True.
    assert queue.meta.seed_complete is True, queue.meta.seed_complete


# ---------------------------------------------------------------------------
# 14. Pending rows are runnable suggestion candidates
# ---------------------------------------------------------------------------
# These tests pin the I-OY-BRAND20-PENDING-AS-RUNNABLE-DASHBOARD contract:
# a freshly-seeded queue (all rows pending, nothing yet attempted) must
# produce a non-empty SUGGESTED NEXT RUNS list — otherwise the dashboard
# is useless to an operator on the first run of a campaign.


def test_dashboard_pending_only_queue_yields_suggestions() -> None:
    """A queue with ONLY pending rows must produce non-empty
    suggestions (size <= 3). This is the "fresh seed" baseline: nothing
    has been attempted, nothing is in cooldown, no manual checkpoint —
    the operator needs a starting list, not silence."""
    now = datetime(2026, 5, 13, 7, 0, 0, tzinfo=timezone.utc)
    queue = _two_sku_queue()  # 10 pending rows
    view = dashboard_view(queue, now=now)

    assert view.counts["pending"] == 10
    assert view.counts["ready"] == 0
    assert 0 < len(view.suggestions) <= 3, len(view.suggestions)
    # runnable_pending should hold every pending row (10), ordered by
    # _suggestion_priority — primary rows first.
    assert len(view.runnable_pending) == 10
    assert view.runnable_pending[0].target_type == "primary"


def test_dashboard_suggestions_prefer_primary_over_signal_pending() -> None:
    """When both pending primary (DATETIME_DESC) and pending signal-sort
    rows exist, the primary rows must lead the suggestion list."""
    now = datetime(2026, 5, 13, 7, 0, 0, tzinfo=timezone.utc)
    # Construct a queue where signal-sort rows come FIRST in queue order
    # so we know ordering is driven by _suggestion_priority, not by
    # insertion order.
    items: list[QueueItem] = [
        QueueItem(
            goods_no="A000000111111",
            product_name="Brand-A",
            sort_type="RATING_ASC",
            target_type="signal",
            status="pending",
        ),
        QueueItem(
            goods_no="A000000111111",
            product_name="Brand-A",
            sort_type="USEFUL_SCORE_DESC",
            target_type="signal",
            status="pending",
        ),
        QueueItem(
            goods_no="A000000222222",
            product_name="Brand-B",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="pending",
        ),
        QueueItem(
            goods_no="A000000111111",
            product_name="Brand-A",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="pending",
        ),
    ]
    queue = Brand20Queue(items=items)
    view = dashboard_view(queue, now=now)

    assert len(view.suggestions) == 3
    # First two suggestions must be the two primary DATETIME_DESC rows;
    # signal-sort pending rows must not displace them.
    assert view.suggestions[0].target_type == "primary"
    assert view.suggestions[0].sort_type == "DATETIME_DESC"
    assert view.suggestions[1].target_type == "primary"
    assert view.suggestions[1].sort_type == "DATETIME_DESC"
    # And within the primaries, goods_no ascending breaks the tie
    # stably (both are cold starts).
    assert view.suggestions[0].goods_no == "A000000111111"
    assert view.suggestions[1].goods_no == "A000000222222"
    # Third suggestion is the first signal-sort row by canonical order
    # (RATING_ASC precedes USEFUL_SCORE_DESC in ALL_SORTS).
    assert view.suggestions[2].target_type == "signal"
    assert view.suggestions[2].sort_type == "RATING_ASC"


def test_dashboard_suggestions_rank_recent_cursor_429_below_never_attempted_ready() -> None:
    now = datetime(2026, 5, 13, 7, 0, 0, tzinfo=timezone.utc)
    queue = Brand20Queue(items=[
        QueueItem(
            goods_no="A000000111111",
            product_name="Brand-A",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="ready",
            attempts=1,
            last_attempt_at="2026-05-13T06:55:00Z",
            rows_inserted_last=0,
            retry_intent="retry_after_cooldown",
            operator_note="cursor_api_rate_limited observed",
        ),
        QueueItem(
            goods_no="A000000222222",
            product_name="Brand-B",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="ready",
        ),
    ])

    view = dashboard_view(queue, now=now)

    assert [it.goods_no for it in view.suggestions[:2]] == [
        "A000000222222",
        "A000000111111",
    ]


def test_dashboard_suggestions_rank_retry_intent_none_above_cooldown() -> None:
    now = datetime(2026, 5, 13, 7, 0, 0, tzinfo=timezone.utc)
    queue = Brand20Queue(items=[
        QueueItem(
            goods_no="A000000111111",
            product_name="Brand-A",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="ready",
            attempts=1,
            last_attempt_at="2026-05-13T06:00:00Z",
            rows_inserted_last=10,
            retry_intent="retry_after_cooldown",
        ),
        QueueItem(
            goods_no="A000000222222",
            product_name="Brand-B",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="ready",
            attempts=1,
            last_attempt_at="2026-05-13T06:00:00Z",
            rows_inserted_last=10,
            retry_intent="none",
        ),
    ])

    view = dashboard_view(queue, now=now)

    assert [it.goods_no for it in view.suggestions[:2]] == [
        "A000000222222",
        "A000000111111",
    ]


def test_dashboard_suggestions_keep_datetime_desc_above_signal_sorts() -> None:
    now = datetime(2026, 5, 13, 7, 0, 0, tzinfo=timezone.utc)
    queue = Brand20Queue(items=[
        QueueItem(
            goods_no="A000000111111",
            product_name="Brand-A",
            sort_type="RATING_ASC",
            target_type="signal",
            status="ready",
        ),
        QueueItem(
            goods_no="A000000222222",
            product_name="Brand-B",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="ready",
            attempts=1,
            last_attempt_at="2026-05-13T06:00:00Z",
            rows_inserted_last=0,
            retry_intent="retry_after_cooldown",
        ),
    ])

    view = dashboard_view(queue, now=now)

    assert view.suggestions[0].sort_type == "DATETIME_DESC"
    assert view.suggestions[0].target_type == "primary"


def test_dashboard_suggestions_are_stable_and_deterministic() -> None:
    now = datetime(2026, 5, 13, 7, 0, 0, tzinfo=timezone.utc)
    queue = Brand20Queue(items=[
        QueueItem(
            goods_no="A000000333333",
            product_name="Brand-C",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="ready",
        ),
        QueueItem(
            goods_no="A000000111111",
            product_name="Brand-A",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="ready",
        ),
        QueueItem(
            goods_no="A000000222222",
            product_name="Brand-B",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="ready",
        ),
    ])

    first = [it.goods_no for it in dashboard_view(queue, now=now).suggestions]
    second = [it.goods_no for it in dashboard_view(queue, now=now).suggestions]

    assert first == second == [
        "A000000111111",
        "A000000222222",
        "A000000333333",
    ]


def test_dashboard_cooldown_future_excluded_past_included() -> None:
    """Cooldown rows whose `next_run_after` is in the future must NOT
    be suggested; cooldown rows whose `next_run_after` has elapsed MUST
    be suggested (they are runnable again)."""
    now = datetime(2026, 5, 13, 18, 0, 0, tzinfo=timezone.utc)
    items: list[QueueItem] = [
        # Cooldown still in the future — must be excluded.
        QueueItem(
            goods_no="A000000111111",
            product_name="Brand-A",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="retry_after_cooldown",
            last_attempt_at="2026-05-13T17:00:00Z",
            next_run_after="2026-05-13T18:30:00Z",
            retry_intent="retry_after_cooldown",
            retry_after_minutes=90,
            attempts=1,
        ),
        # Cooldown elapsed — must be included as runnable.
        QueueItem(
            goods_no="A000000222222",
            product_name="Brand-B",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="retry_after_cooldown",
            last_attempt_at="2026-05-13T15:00:00Z",
            next_run_after="2026-05-13T16:30:00Z",
            retry_intent="retry_after_cooldown",
            retry_after_minutes=90,
            attempts=1,
        ),
    ]
    queue = Brand20Queue(items=items)
    view = dashboard_view(queue, now=now)

    # Both rows are in `waiting` (the status==retry_after_cooldown
    # bucket). The future-cooldown row must not surface in suggestions;
    # the elapsed-cooldown row must.
    assert len(view.waiting) == 2
    suggested_goods = [it.goods_no for it in view.suggestions]
    assert "A000000222222" in suggested_goods
    assert "A000000111111" not in suggested_goods


def test_dashboard_never_suggests_manual_done_inconclusive_running() -> None:
    """manual_checkpoint / done / inconclusive / running rows must
    never appear in suggestions, regardless of how many such rows exist
    and regardless of target_type."""
    now = datetime(2026, 5, 13, 7, 0, 0, tzinfo=timezone.utc)
    items: list[QueueItem] = [
        QueueItem(
            goods_no="A000000111111",
            product_name="Brand-A",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="manual_checkpoint",
            checkpoint_reason="auth_or_human_check",
        ),
        QueueItem(
            goods_no="A000000222222",
            product_name="Brand-B",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="done",
        ),
        QueueItem(
            goods_no="A000000333333",
            product_name="Brand-C",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="inconclusive",
        ),
        QueueItem(
            goods_no="A000000444444",
            product_name="Brand-D",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="running",
        ),
    ]
    queue = Brand20Queue(items=items)
    view = dashboard_view(queue, now=now)

    # Every row is in a blocked status — suggestions must be empty.
    assert view.suggestions == []
    # And none of the blocked goods_nos may appear in runnable_pending
    # either (defensive: pending bucket must not absorb any of them).
    pending_goods = {it.goods_no for it in view.runnable_pending}
    for blocked_goods in (
        "A000000111111", "A000000222222",
        "A000000333333", "A000000444444",
    ):
        assert blocked_goods not in pending_goods


# ---------------------------------------------------------------------------
# 14b. max_cap_reached status mapping
# (I-OY-BRAND20-RUNNER-MAX-CAP-AND-STATUS-MAPPING-FIX Req §4)
# ---------------------------------------------------------------------------
# The connector's `max_cap_reached` status means the run successfully
# ingested up to the local cap and the server still advertised more
# rows. This is a PARTIAL success, not an indeterminate outcome:
#   - primary (DATETIME_DESC) rows route to `ready` so the operator
#     can re-run to extend coverage,
#   - signal sorts route to `inconclusive` (metadata-only; no benefit
#     from re-running, and the operator should triage if it shows up).
# The pre-existing precedence chain (retry_after_cooldown >
# manual_checkpoint > done > inconclusive) is untouched.


def _max_cap_reached_batch_summary(
    *, goods_no: str, sort_type: str,
) -> dict:
    """Build a synthetic batch_summary for a clean max_cap_reached
    run. Mirrors the shape `_extract_target` / `_extract_product_fields`
    actually parse (top-level + nested `products[0]` + `resume_state`)."""
    return {
        "batch_id": "test_batch_max_cap_reached",
        "halted": False,
        "manifest_audit": {"sort_type_in_defaults": sort_type},
        "products": [{
            "name": "Test-A",
            "oy_goods_no": goods_no,
            "status": "max_cap_reached",
            "quality_status": "ok",
            "rows_inserted": 5000,
            "raw_records_seen": 5000,
            "records_parsed": 5000,
            "run_id": "run_test_maxcap_01",
            "summary": {
                "run_id": "run_test_maxcap_01",
                "cursor_api_rate_limited": False,
                "cursor_api_silenced": False,
                "retry_intent": "none",
                "retry_after_minutes": None,
                "requested_sort_type": sort_type,
                "last_observed_has_next": True,
                "pagination_exhausted": False,
            },
            "resume_state": {
                "retryable": False,
                "reason": "max_cap_reached",
                "retry_intent": "none",
                "cursor_api_rate_limited": False,
                "cursor_api_silenced": False,
                "raw_records_seen": 5000,
                "records_parsed": 5000,
                "quality_status": "ok",
                "sort_type": sort_type,
                "goods_no": goods_no,
                "final_status": "max_cap_reached",
                "rows_inserted": 5000,
            },
        }],
    }


def test_apply_batch_summary_max_cap_reached_ok_does_not_become_inconclusive() -> None:
    """A DATETIME_DESC primary row receiving a `max_cap_reached`
    batch_summary with `quality_status=ok` must NOT land on
    `inconclusive`. It must land on `ready` so the operator can
    re-run to extend coverage. The pre-existing precedence chain
    (retry_after_cooldown > manual_checkpoint > done) is unchanged."""
    queue = _two_sku_queue()
    batch = _max_cap_reached_batch_summary(
        goods_no="A000000111111", sort_type="DATETIME_DESC",
    )
    item = apply_batch_summary(queue, batch)
    # NOT inconclusive (this is the bug we fixed).
    assert item.status != "inconclusive"
    # Routed to `ready` so the next default-mode runner invocation
    # picks it up.
    assert item.status == "ready"
    assert item.checkpoint_reason is None
    assert item.next_run_after is None
    # Run-history fields still applied.
    assert item.rows_inserted_last == 5000
    assert item.last_run_id == "run_test_maxcap_01"
    assert item.attempts == 1


def test_apply_batch_summary_max_cap_reached_primary_vs_signal_routing() -> None:
    """Same max_cap_reached input → different terminal status depending
    on `target_type`:
      - primary (DATETIME_DESC) → `ready` (operator may re-run)
      - signal (RATING_ASC)     → `inconclusive` (metadata-only; the
                                   operator should triage rather than
                                   silently re-running the cap)
    The asymmetry is documented behaviour: signal sorts gain nothing
    from extended coverage."""
    # Primary: routes to ready.
    queue_primary = _two_sku_queue()
    batch_primary = _max_cap_reached_batch_summary(
        goods_no="A000000111111", sort_type="DATETIME_DESC",
    )
    item_primary = apply_batch_summary(queue_primary, batch_primary)
    assert item_primary.target_type == "primary"
    assert item_primary.status == "ready"

    # Signal: routes to inconclusive.
    queue_signal = _two_sku_queue()
    batch_signal = _max_cap_reached_batch_summary(
        goods_no="A000000111111", sort_type="RATING_ASC",
    )
    item_signal = apply_batch_summary(queue_signal, batch_signal)
    assert item_signal.target_type == "signal"
    assert item_signal.status == "inconclusive"


def test_apply_batch_summary_max_cap_reached_precedence_cursor_429_wins() -> None:
    """Pinning the precedence chain: a max_cap_reached batch_summary
    that ALSO carries `retry_intent=retry_after_cooldown` /
    `cursor_api_rate_limited=True` (an unlikely-but-possible
    combination if the connector emits the rate-limit signal during a
    max-cap-bound run) still routes via the cursor-429 branch — but
    after I-OY-BRAND20-OPERATOR-RETRY-NO-COOLDOWN-GATE the cursor-429
    branch terminates at `ready` (not `retry_after_cooldown`).

    Repurposes the prior precedence test
    (`test_apply_batch_summary_max_cap_reached_precedence_preserved`)
    which asserted `status == "retry_after_cooldown"`. The precedence
    is preserved (cursor-throttle beats max_cap_reached); only the
    terminal status of the cursor-throttle branch changes."""
    queue = _two_sku_queue()
    batch = _max_cap_reached_batch_summary(
        goods_no="A000000111111", sort_type="DATETIME_DESC",
    )
    # Inject the rate-limit signal on the same summary.
    batch["products"][0]["summary"]["cursor_api_rate_limited"] = True
    batch["products"][0]["summary"]["retry_intent"] = "retry_after_cooldown"
    batch["products"][0]["summary"]["retry_after_minutes"] = 90
    batch["products"][0]["resume_state"]["retry_intent"] = "retry_after_cooldown"
    batch["products"][0]["resume_state"]["retry_after_minutes"] = 90

    item = apply_batch_summary(queue, batch)
    # The cursor-429 branch wins over max_cap_reached, and after this
    # ticket terminates at `ready` (operator-retry no-cooldown-gate).
    # Pre-ticket this was `retry_after_cooldown`.
    assert item.status == "ready"
    assert item.next_run_after is None
    # retry_intent preserved as the audit-trail signal.
    assert item.retry_intent == "retry_after_cooldown"
    # operator_note carries the audit hint.
    assert item.operator_note is not None
    assert "cursor_api_rate_limited" in item.operator_note


def test_dashboard_surfaces_cursor_429_routed_row_in_ready_now() -> None:
    """I-OY-BRAND20-OPERATOR-RETRY-NO-COOLDOWN-GATE: a row that
    previously observed cursor-429 now lands at `status="ready"` and
    must surface in the dashboard's READY NOW bucket (not WAITING).
    The 429-routed row also appears in `suggestions` so the operator
    sees it on the SUGGESTED NEXT RUNS list."""
    now = datetime(2026, 5, 13, 14, 0, 0, tzinfo=timezone.utc)
    items: list[QueueItem] = [
        # The 429-routed row: previous attempt hit cursor 429, now
        # ready with retry_intent + operator_note as audit hints.
        QueueItem(
            goods_no="A000000111111",
            product_name="Brand-A",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="ready",
            retry_intent="retry_after_cooldown",
            retry_after_minutes=90,
            operator_note=(
                "cursor_api_rate_limited observed (OY cursor 429). "
                "Refresh the product tab in Chrome and re-run when "
                "reviews load again (typically a few minutes). "
                "retry_intent preserved for audit."
            ),
            attempts=1,
            last_attempt_at="2026-05-13T13:52:22Z",
        ),
    ]
    queue = Brand20Queue(items=items)
    view = dashboard_view(queue, now=now)

    # The 429-routed row is in READY NOW, NOT WAITING.
    assert len(view.ready_now) == 1
    assert view.ready_now[0].goods_no == "A000000111111"
    assert view.waiting == []
    # It is on the SUGGESTED NEXT RUNS list (runnable pool).
    assert len(view.suggestions) == 1
    assert view.suggestions[0].goods_no == "A000000111111"
    # The audit signals are preserved on the dashboard payload so the
    # inspector renderer can surface them.
    surfaced = view.ready_now[0]
    assert surfaced.retry_intent == "retry_after_cooldown"
    assert surfaced.operator_note is not None
    assert "cursor_api_rate_limited" in surfaced.operator_note


def test_inspector_render_surfaces_cursor_429_audit_under_ready_now() -> None:
    """I-OY-BRAND20-OPERATOR-RETRY-NO-COOLDOWN-GATE: the inspector
    script's `_render` function must surface 429-routed `ready` rows
    under READY NOW with the audit context (retry_intent + operator
    note). Pure substring assertion against the rendered text —
    cheaper than spawning the CLI.

    Imports the script module directly. No subprocess; no disk I/O
    beyond `dashboard_view` which is pure."""
    # Import the script module by file path. The script lives under
    # `scripts/` which is added to sys.path inside the script itself.
    import importlib.util
    repo_root = Path(__file__).resolve().parents[2]
    script_path = repo_root / "scripts" / "inspect_brand20_collection_status.py"
    spec = importlib.util.spec_from_file_location(
        "inspect_brand20_collection_status", script_path,
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

    now = datetime(2026, 5, 13, 14, 0, 0, tzinfo=timezone.utc)
    items: list[QueueItem] = [
        QueueItem(
            goods_no="A000000111111",
            product_name="Brand-A",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="ready",
            retry_intent="retry_after_cooldown",
            retry_after_minutes=90,
            operator_note=(
                "cursor_api_rate_limited observed (OY cursor 429). "
                "Refresh the product tab in Chrome and re-run when "
                "reviews load again (typically a few minutes). "
                "retry_intent preserved for audit."
            ),
            attempts=1,
            last_attempt_at="2026-05-13T13:52:22Z",
        ),
    ]
    queue = Brand20Queue(items=items)
    view = dashboard_view(queue, now=now, queue_path="ops/queue.json")
    text = module._render(view, head_short="abc1234",
                          queue_path=Path("ops/queue.json"))

    # READY NOW section is present and contains the 429-routed row.
    assert "READY NOW" in text
    assert "A000000111111" in text
    # The "operator retry ready" audit sub-line.
    assert "operator retry ready" in text
    assert "retry_after_cooldown" in text  # retry_intent name
    # operator_note rendered verbatim (substring is enough).
    assert "cursor_api_rate_limited" in text
    # Hint for legacy WAITING block is present even when no waiting
    # rows exist — but here we have no waiting rows so the (none)
    # branch fires. Either branch is acceptable; assert the section
    # header exists.
    assert "WAITING" in text


def test_inspector_render_legacy_waiting_block_carries_advisory_hint() -> None:
    """When the queue DOES contain legacy `retry_after_cooldown` rows
    (seeded before this ticket), the WAITING block surfaces the
    advisory hint informing the operator that `next_run_after` is no
    longer a hard wall. Header wording also flagged as 'legacy'."""
    import importlib.util
    repo_root = Path(__file__).resolve().parents[2]
    script_path = repo_root / "scripts" / "inspect_brand20_collection_status.py"
    spec = importlib.util.spec_from_file_location(
        "inspect_brand20_collection_status", script_path,
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

    now = datetime(2026, 5, 13, 12, 0, 0, tzinfo=timezone.utc)
    items: list[QueueItem] = [
        QueueItem(
            goods_no="A000000222222",
            product_name="Legacy-B",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="retry_after_cooldown",
            last_attempt_at="2026-05-13T11:00:00Z",
            next_run_after="2026-05-13T12:30:00Z",
            retry_intent="retry_after_cooldown",
            retry_after_minutes=90,
            attempts=1,
        ),
    ]
    queue = Brand20Queue(items=items)
    view = dashboard_view(queue, now=now, queue_path="ops/queue.json")
    text = module._render(view, head_short="abc1234",
                          queue_path=Path("ops/queue.json"))

    # Header now flags the bucket as legacy and surfaces the advisory.
    assert "WAITING (retry_after_cooldown — legacy)" in text
    assert "advisory" in text
    assert "operator may retry once the page recovers" in text


def test_dashboard_real_seed_runnable_pool_invariant() -> None:
    """The real ops/brand20_collection_queue.json is operational state
    that mutates as live runs apply batch_summary results. This test
    asserts only durable invariants — NOT exact per-status counts —
    so it survives operator-driven queue drift:

    - total seeded = 100 (20 SKUs × 5 sorts)
    - the sum of all known status counts equals 100 (no rows lost)
    - SUGGESTED NEXT RUNS is non-empty and leads with a DATETIME_DESC
      primary candidate (the original bug this test was added for)."""
    repo_root = Path(__file__).resolve().parents[2]
    queue_path = repo_root / "ops" / "brand20_collection_queue.json"
    queue = load_queue(queue_path)

    # Pin a `now` so the test is independent of wall-clock.
    now = datetime(2026, 5, 13, 7, 0, 0, tzinfo=timezone.utc)
    view = dashboard_view(queue, now=now)

    assert view.total_targets_seeded == 100
    # No rows lost across any status bucket.
    assert sum(view.counts.values()) == 100
    # SUGGESTED NEXT RUNS must be non-empty and lead with primary.
    assert 0 < len(view.suggestions) <= 3
    assert view.suggestions[0].target_type == "primary"
    assert view.suggestions[0].sort_type == "DATETIME_DESC"
