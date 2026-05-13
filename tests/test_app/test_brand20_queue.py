"""Tests for src.voc.app.brand20_queue.

Covers Req 7 of I-OY-BRAND20-COLLECTION-QUEUE-AND-COVERAGE-DASHBOARD:
state-transition rules, dashboard bucketing, manual_checkpoint
certification, and the collection-isolation guard.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
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
# 2. retry_after_cooldown ingestion
# ---------------------------------------------------------------------------


def test_apply_batch_summary_retry_after_cooldown() -> None:
    queue = _two_sku_queue()
    # Re-target the fixture's goods_no onto a row that exists in the
    # test queue so the lookup succeeds.
    batch = _load_fixture("brand20_batch_retry_after_cooldown.json")
    batch["products"][0]["oy_goods_no"] = "A000000111111"
    batch["products"][0]["resume_state"]["goods_no"] = "A000000111111"

    now = datetime(2026, 5, 13, 13, 52, 22, tzinfo=timezone.utc)
    item = apply_batch_summary(queue, batch, now=now)

    assert item.status == "retry_after_cooldown"
    assert item.retry_intent == "retry_after_cooldown"
    assert item.retry_after_minutes == 90
    assert item.last_attempt_at == "2026-05-13T13:52:22Z"
    # next_run_after = last_attempt_at + 90 min
    expected_next = (now + timedelta(minutes=90)).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert item.next_run_after == expected_next
    assert item.checkpoint_reason is None
    assert item.attempts == 1
    assert item.raw_records_seen_last == 630
    assert item.last_run_id == "run_20260513_134328_a1e307"


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
# 11. Precedence: rate_limited beats final_status=complete
# ---------------------------------------------------------------------------


def test_precedence_rate_limited_over_complete() -> None:
    """final_status='complete' + retry_intent='retry_after_cooldown'
    → retry_after_cooldown wins (CLAUDE.md OY rate-limit policy)."""
    queue = _two_sku_queue()
    batch = _load_fixture("brand20_batch_precedence_complete_and_rate_limited.json")
    batch["products"][0]["oy_goods_no"] = "A000000111111"
    batch["products"][0]["resume_state"]["goods_no"] = "A000000111111"

    item = apply_batch_summary(queue, batch)
    assert item.status == "retry_after_cooldown"
    assert item.retry_intent == "retry_after_cooldown"
    # Even though final_status was "complete", the row is NOT done.
    assert item.status != "done"


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

    # Canonical signal-sort taxonomy for this campaign (see ticket
    # I-OY-BRAND20-FULL-QUEUE-SEED). Note this is the operator-canonical
    # set for the seed file, distinct from the module-level SIGNAL_SORTS
    # constant which carries the legacy taxonomy.
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
