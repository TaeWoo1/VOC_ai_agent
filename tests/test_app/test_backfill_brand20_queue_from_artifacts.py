"""Tests for scripts/backfill_brand20_queue_from_artifacts.py.

The backfill script scans `data/collection_artifacts/**/batch_summary.json`
and routes each chosen candidate through `apply_batch_summary` so the
canonical `_decide_status` precedence stays the single source of truth
for queue-state mapping.

These tests build a fake artifact root and a tmp queue under `tmp_path`
— the production seed at `ops/brand20_collection_queue.json` is NEVER
read or modified.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from scripts.backfill_brand20_queue_from_artifacts import (  # noqa: E402
    BRAND20_SIGNAL_SORT_DONE_THRESHOLD,
    classify_candidate,
    collect_candidates,
    main as backfill_main,
    pick_best,
)
from src.voc.app.brand20_queue import (  # noqa: E402
    Brand20Queue,
    QueueItem,
    QueueMeta,
    load_queue,
    make_full_sort_set,
    save_queue,
)


SCRIPT = REPO / "scripts" / "backfill_brand20_queue_from_artifacts.py"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_queue(tmp_path: Path, goods_nos: list[tuple[str, str]]) -> Path:
    """Write a tmp queue with one full sort-set per (goods_no, name).
    Returns the queue path."""
    items: list[QueueItem] = []
    for goods_no, name in goods_nos:
        items.extend(make_full_sort_set(goods_no=goods_no, product_name=name))
    queue = Brand20Queue(
        meta=QueueMeta(
            schema_version=1,
            seed_complete=False,
            seeded_brands=[name for _, name in goods_nos],
            pending_brands_count=0,
            notes="backfill test fixture",
        ),
        items=items,
    )
    path = tmp_path / "brand20_collection_queue.json"
    save_queue(path, queue)
    return path


def _write_summary(
    artifact_root: Path,
    run_label: str,
    payload: dict[str, Any],
) -> Path:
    """Drop `payload` at `<artifact_root>/<run_label>/batch_summary.json`."""
    run_dir = artifact_root / run_label
    run_dir.mkdir(parents=True, exist_ok=True)
    path = run_dir / "batch_summary.json"
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return path


def _summary_done(
    goods_no: str,
    sort_type: str,
    *,
    records_parsed: int = 3120,
    run_id: str = "run_done_001",
    finished_at: str = "2026-05-13T16:45:00",
) -> dict[str, Any]:
    """Clean-terminal batch summary: classifier picks `done`."""
    return {
        "batch_id": f"backfill_test_done_{goods_no}_{sort_type}",
        "started_at": "2026-05-13T16:00:00",
        "finished_at": finished_at,
        "halted": False,
        "manifest_audit": {"sort_type_in_defaults": sort_type},
        "products": [
            {
                "oy_goods_no": goods_no,
                "status": "complete",
                "quality_status": "ok",
                "rows_inserted": records_parsed,
                "raw_records_seen": records_parsed,
                "records_parsed": records_parsed,
                "pagination_exhausted": True,
                "last_observed_has_next": False,
                "run_id": run_id,
                "finished_at": finished_at,
                "summary": {
                    "run_id": run_id,
                    "cursor_api_rate_limited": False,
                    "cursor_api_silenced": False,
                    "incomplete_collection": False,
                    "pagination_exhausted": True,
                    "last_observed_has_next": False,
                    "retry_intent": "none",
                    "retry_after_minutes": None,
                    "requested_sort_type": sort_type,
                },
                "resume_state": {
                    "retryable": False,
                    "reason": "complete",
                    "retry_intent": "none",
                    "cursor_api_rate_limited": False,
                    "cursor_api_silenced": False,
                    "raw_records_seen": records_parsed,
                    "records_parsed": records_parsed,
                    "quality_status": "ok",
                    "sort_type": sort_type,
                    "goods_no": goods_no,
                    "final_status": "complete",
                    "rows_inserted": records_parsed,
                },
            }
        ],
    }


def _summary_429(
    goods_no: str,
    sort_type: str,
    *,
    records_parsed: int = 200,
    run_id: str = "run_429_001",
    finished_at: str = "2026-05-13T13:52:22",
) -> dict[str, Any]:
    """cursor_api_rate_limited mid-pagination → retryable_429_partial."""
    return {
        "batch_id": f"backfill_test_429_{goods_no}_{sort_type}",
        "started_at": "2026-05-13T13:43:27",
        "finished_at": finished_at,
        "halted": True,
        "manifest_audit": {"sort_type_in_defaults": sort_type},
        "products": [
            {
                "oy_goods_no": goods_no,
                "status": "anti_bot",
                "quality_status": "invalid",
                "rows_inserted": 0,
                "raw_records_seen": records_parsed,
                "records_parsed": records_parsed,
                "run_id": run_id,
                "finished_at": finished_at,
                "summary": {
                    "run_id": run_id,
                    "cursor_api_rate_limited": True,
                    "cursor_api_silenced": False,
                    "incomplete_collection": True,
                    "pagination_exhausted": False,
                    "last_observed_has_next": True,
                    "retry_intent": "retry_after_cooldown",
                    "retry_after_minutes": 90,
                    "requested_sort_type": sort_type,
                },
                "resume_state": {
                    "retryable": True,
                    "reason": "cursor_api_rate_limited",
                    "exhausted": True,
                    "retry_after_minutes": 90,
                    "retry_intent": "retry_after_cooldown",
                    "cursor_api_rate_limited": True,
                    "cursor_api_silenced": False,
                    "raw_records_seen": records_parsed,
                    "records_parsed": records_parsed,
                    "sort_type": sort_type,
                    "goods_no": goods_no,
                    "final_status": "anti_bot",
                    "rows_inserted": 0,
                },
            }
        ],
    }


def _summary_local_cap(
    goods_no: str,
    sort_type: str,
    *,
    records_parsed: int = 200,
    run_id: str = "run_cap_001",
    finished_at: str = "2026-05-13T09:00:00",
) -> dict[str, Any]:
    """max_cap_reached terminal — local_cap_partial."""
    return {
        "batch_id": f"backfill_test_cap_{goods_no}_{sort_type}",
        "started_at": "2026-05-13T08:00:00",
        "finished_at": finished_at,
        "halted": False,
        "manifest_audit": {"sort_type_in_defaults": sort_type},
        "products": [
            {
                "oy_goods_no": goods_no,
                "status": "max_cap_reached",
                "quality_status": "ok",
                "rows_inserted": 34,
                "raw_records_seen": records_parsed,
                "records_parsed": records_parsed,
                "run_id": run_id,
                "finished_at": finished_at,
                "summary": {
                    "run_id": run_id,
                    "cursor_api_rate_limited": False,
                    "cursor_api_silenced": False,
                    "incomplete_collection": False,
                    "pagination_exhausted": False,
                    "last_observed_has_next": True,
                    "retry_intent": "none",
                    "retry_after_minutes": None,
                    "requested_sort_type": sort_type,
                },
            }
        ],
    }


def _summary_manual(
    goods_no: str,
    sort_type: str,
    *,
    run_id: str = "run_manual_001",
    finished_at: str = "2026-05-13T15:05:00",
) -> dict[str, Any]:
    """auth_required + retry_intent=manual_review_required."""
    return {
        "batch_id": f"backfill_test_manual_{goods_no}_{sort_type}",
        "started_at": "2026-05-13T15:00:00",
        "finished_at": finished_at,
        "halted": True,
        "manifest_audit": {"sort_type_in_defaults": sort_type},
        "products": [
            {
                "oy_goods_no": goods_no,
                "status": "auth_required",
                "quality_status": "invalid",
                "rows_inserted": 0,
                "raw_records_seen": 0,
                "records_parsed": 0,
                "run_id": run_id,
                "finished_at": finished_at,
                "summary": {
                    "run_id": run_id,
                    "cursor_api_rate_limited": False,
                    "cursor_api_silenced": False,
                    "retry_intent": "manual_review_required",
                    "retry_after_minutes": None,
                    "requested_sort_type": sort_type,
                },
                "resume_state": {
                    "retryable": False,
                    "reason": "auth_required",
                    "retry_intent": "manual_review_required",
                    "cursor_api_rate_limited": False,
                    "cursor_api_silenced": False,
                    "raw_records_seen": 0,
                    "records_parsed": 0,
                    "sort_type": sort_type,
                    "goods_no": goods_no,
                    "final_status": "auth_required",
                    "rows_inserted": 0,
                },
            }
        ],
    }


# ---------------------------------------------------------------------------
# Classifier unit tests
# ---------------------------------------------------------------------------


def test_done_classification() -> None:
    """final_status=complete + pagination_exhausted=True + no 429
    signals classifies as `done`."""
    payload = _summary_done("A000000111111", "DATETIME_DESC")
    assert classify_candidate(payload) == "done"


def test_retryable_429_classification() -> None:
    """cursor_api_rate_limited=True classifies as retryable_429_partial,
    and downstream `apply_batch_summary` maps it to ready+operator_note
    naming the surface."""
    payload = _summary_429("A000000111111", "DATETIME_DESC")
    assert classify_candidate(payload) == "retryable_429_partial"
    # Verify the downstream queue mapping carries the rate-limited
    # operator_note, since the script promises to route through
    # `apply_batch_summary` (single canonical mapping function).
    queue = Brand20Queue(items=make_full_sort_set(
        goods_no="A000000111111", product_name="Test SKU",
    ))
    from src.voc.app.brand20_queue import apply_batch_summary
    updated = apply_batch_summary(queue, payload)
    assert updated.status == "ready"
    assert updated.operator_note is not None
    assert "cursor_api_rate_limited" in updated.operator_note


def test_local_cap_classification_primary_vs_signal(tmp_path: Path) -> None:
    """A `max_cap_reached` summary classifies as local_cap_partial.
    Downstream mapping branches on the QUEUE row's target_type:
      - primary  → status='ready'
      - signal   → status='inconclusive'
    """
    # Primary case
    payload_primary = _summary_local_cap("A000000111111", "DATETIME_DESC")
    assert classify_candidate(payload_primary) == "local_cap_partial"
    # Signal case (RATING_ASC is in SIGNAL_SORTS)
    payload_signal = _summary_local_cap("A000000111111", "RATING_ASC")
    assert classify_candidate(payload_signal) == "local_cap_partial"

    # Verify the downstream mapping divergence via apply_batch_summary.
    from src.voc.app.brand20_queue import apply_batch_summary
    queue = Brand20Queue(items=make_full_sort_set(
        goods_no="A000000111111", product_name="Test SKU",
    ))
    primary_item = apply_batch_summary(queue, payload_primary)
    assert primary_item.status == "ready"
    queue2 = Brand20Queue(items=make_full_sort_set(
        goods_no="A000000111111", product_name="Test SKU",
    ))
    signal_item = apply_batch_summary(queue2, payload_signal)
    assert signal_item.status == "inconclusive"


def test_manual_required_classification() -> None:
    """retry_intent=manual_review_required classifies as manual_required
    and maps to status='manual_checkpoint' on apply."""
    payload = _summary_manual("A000000111111", "DATETIME_DESC")
    assert classify_candidate(payload) == "manual_required"
    queue = Brand20Queue(items=make_full_sort_set(
        goods_no="A000000111111", product_name="Test SKU",
    ))
    from src.voc.app.brand20_queue import apply_batch_summary
    updated = apply_batch_summary(queue, payload)
    assert updated.status == "manual_checkpoint"


# ---------------------------------------------------------------------------
# Scanner / pick_best tests
# ---------------------------------------------------------------------------


def test_scanner_picks_complete_over_partial(tmp_path: Path) -> None:
    """When two summaries map to the same (goods_no, sort_type), the
    `done`-class summary wins over a `retryable_429_partial`."""
    artifact_root = tmp_path / "artifacts"
    _write_summary(artifact_root, "run_429",
                   _summary_429("A000000111111", "DATETIME_DESC"))
    _write_summary(artifact_root, "run_done",
                   _summary_done("A000000111111", "DATETIME_DESC"))
    queue_path = _make_queue(tmp_path, [("A000000111111", "Test SKU")])
    queue = load_queue(queue_path)

    by_pair = collect_candidates(artifact_root, queue)
    assert ("A000000111111", "DATETIME_DESC") in by_pair
    cands = by_pair[("A000000111111", "DATETIME_DESC")]
    assert len(cands) == 2
    best = pick_best(cands)
    assert best.classification == "done"


def test_scanner_picks_higher_parsed_count_among_partials(tmp_path: Path) -> None:
    """Two retryable_429_partial summaries: 200 parsed vs 450 parsed.
    Picks 450 (within-class tie-break by records_parsed)."""
    artifact_root = tmp_path / "artifacts"
    _write_summary(artifact_root, "run_429_200",
                   _summary_429("A000000111111", "DATETIME_DESC",
                                records_parsed=200, run_id="run_low"))
    _write_summary(artifact_root, "run_429_450",
                   _summary_429("A000000111111", "DATETIME_DESC",
                                records_parsed=450, run_id="run_high"))
    queue_path = _make_queue(tmp_path, [("A000000111111", "Test SKU")])
    queue = load_queue(queue_path)

    by_pair = collect_candidates(artifact_root, queue)
    best = pick_best(by_pair[("A000000111111", "DATETIME_DESC")])
    assert best.classification == "retryable_429_partial"
    assert best.records_parsed_effective == 450


def test_scanner_tie_break_newer_finished_at(tmp_path: Path) -> None:
    """Same class + same records_parsed: newer finished_at wins."""
    artifact_root = tmp_path / "artifacts"
    _write_summary(artifact_root, "run_older",
                   _summary_429("A000000111111", "DATETIME_DESC",
                                records_parsed=200, run_id="run_older",
                                finished_at="2026-05-10T10:00:00"))
    _write_summary(artifact_root, "run_newer",
                   _summary_429("A000000111111", "DATETIME_DESC",
                                records_parsed=200, run_id="run_newer",
                                finished_at="2026-05-13T18:00:00"))
    queue_path = _make_queue(tmp_path, [("A000000111111", "Test SKU")])
    queue = load_queue(queue_path)

    by_pair = collect_candidates(artifact_root, queue)
    best = pick_best(by_pair[("A000000111111", "DATETIME_DESC")])
    assert best.fields["run_id"] == "run_newer"


def test_scanner_ignores_pairs_not_in_queue(tmp_path: Path) -> None:
    """Summary contains goods_no not in queue: scanner drops silently."""
    artifact_root = tmp_path / "artifacts"
    _write_summary(artifact_root, "run_not_in_queue",
                   _summary_done("A000000999999", "DATETIME_DESC"))
    queue_path = _make_queue(tmp_path, [("A000000111111", "Test SKU")])
    queue = load_queue(queue_path)

    by_pair = collect_candidates(artifact_root, queue)
    assert by_pair == {}


def test_scanner_ignores_unknown_sort_types(tmp_path: Path) -> None:
    """sort_type not in canonical 5-sort taxonomy: drop."""
    artifact_root = tmp_path / "artifacts"
    _write_summary(artifact_root, "run_unknown_sort",
                   _summary_done("A000000111111", "SOME_UNKNOWN_SORT"))
    queue_path = _make_queue(tmp_path, [("A000000111111", "Test SKU")])
    queue = load_queue(queue_path)

    by_pair = collect_candidates(artifact_root, queue)
    assert by_pair == {}


def test_malformed_summary_skipped_with_warning(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    """0-byte file and a non-JSON file are both skipped with stderr
    warnings; the scan continues and picks up the well-formed file."""
    artifact_root = tmp_path / "artifacts"
    # Empty file
    (artifact_root / "empty_run").mkdir(parents=True)
    (artifact_root / "empty_run" / "batch_summary.json").write_text("")
    # Garbage file
    (artifact_root / "garbage_run").mkdir(parents=True)
    (artifact_root / "garbage_run" / "batch_summary.json").write_text(
        "not valid json {{{",
    )
    # One good file
    _write_summary(artifact_root, "run_good",
                   _summary_done("A000000111111", "DATETIME_DESC"))
    queue_path = _make_queue(tmp_path, [("A000000111111", "Test SKU")])
    queue = load_queue(queue_path)

    by_pair = collect_candidates(artifact_root, queue)
    err = capsys.readouterr().err
    assert "empty batch_summary" in err
    assert "malformed JSON" in err
    # The good file still landed
    assert ("A000000111111", "DATETIME_DESC") in by_pair


# ---------------------------------------------------------------------------
# Dry-run / apply / idempotency (script entry point)
# ---------------------------------------------------------------------------


def _bytes_of(path: Path) -> bytes:
    return path.read_bytes()


def test_dry_run_does_not_mutate_queue(tmp_path: Path) -> None:
    """`--apply=False` (the default) prints the table but does not
    write to the queue file. Verified byte-for-byte."""
    artifact_root = tmp_path / "artifacts"
    _write_summary(artifact_root, "run_done",
                   _summary_done("A000000111111", "DATETIME_DESC"))
    queue_path = _make_queue(tmp_path, [("A000000111111", "Test SKU")])
    pre = _bytes_of(queue_path)

    rc = backfill_main([
        "--artifact-root", str(artifact_root),
        "--queue", str(queue_path),
    ])
    assert rc == 0
    post = _bytes_of(queue_path)
    assert pre == post, "queue file changed under --dry-run"


def test_apply_mutates_queue_via_apply_batch_summary(
    tmp_path: Path,
) -> None:
    """`--apply=True` routes each chosen summary through
    apply_batch_summary. A `done` summary lands the row at `done`; a
    `retryable_429_partial` lands it at `ready` with operator_note.
    """
    artifact_root = tmp_path / "artifacts"
    _write_summary(artifact_root, "run_done_111",
                   _summary_done("A000000111111", "DATETIME_DESC"))
    _write_summary(artifact_root, "run_429_222",
                   _summary_429("A000000222222", "DATETIME_DESC"))
    queue_path = _make_queue(
        tmp_path,
        [("A000000111111", "Brand-A"), ("A000000222222", "Brand-B")],
    )

    rc = backfill_main([
        "--artifact-root", str(artifact_root),
        "--queue", str(queue_path),
        "--apply",
    ])
    assert rc == 0
    queue = load_queue(queue_path)
    done_row = queue.find("A000000111111", "DATETIME_DESC")
    assert done_row is not None
    assert done_row.status == "done"
    assert done_row.last_run_id == "run_done_001"
    assert done_row.next_run_after is None

    ready_row = queue.find("A000000222222", "DATETIME_DESC")
    assert ready_row is not None
    assert ready_row.status == "ready"
    assert ready_row.operator_note is not None
    assert "cursor_api_rate_limited" in ready_row.operator_note


def test_apply_is_idempotent(tmp_path: Path) -> None:
    """Re-running `--apply` after the first apply does not change the
    queue (the same chosen batch_summary lands the same status mapping).
    """
    artifact_root = tmp_path / "artifacts"
    _write_summary(artifact_root, "run_done",
                   _summary_done("A000000111111", "DATETIME_DESC"))
    _write_summary(artifact_root, "run_429",
                   _summary_429("A000000222222", "DATETIME_DESC"))
    queue_path = _make_queue(
        tmp_path,
        [("A000000111111", "Brand-A"), ("A000000222222", "Brand-B")],
    )

    rc = backfill_main([
        "--artifact-root", str(artifact_root),
        "--queue", str(queue_path),
        "--apply",
    ])
    assert rc == 0
    first_state = load_queue(queue_path).model_dump(by_alias=True)

    rc = backfill_main([
        "--artifact-root", str(artifact_root),
        "--queue", str(queue_path),
        "--apply",
    ])
    assert rc == 0
    second_state = load_queue(queue_path).model_dump(by_alias=True)

    # The only legitimate per-row delta is `attempts` (a counter that
    # apply_batch_summary increments each call) and `last_attempt_at`
    # (a wall clock). Both are bookkeeping, not state. The state-
    # carrying fields must be byte-identical.
    def project(state: dict[str, Any]) -> list[dict[str, Any]]:
        bare = []
        for it in state["items"]:
            bare.append({
                k: v for k, v in it.items()
                if k not in {"attempts", "last_attempt_at"}
            })
        return bare

    assert project(first_state) == project(second_state)


# ---------------------------------------------------------------------------
# Subprocess smoke (no live deps)
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Signal-sort cap-done overlay (backfill-only policy)
# ---------------------------------------------------------------------------
#
# Brand-20 signal sorts (RATING_ASC, RATING_DESC, USEFUL_SCORE_DESC,
# RECOMMENDED_DESC) were intentionally capped at 50 records during the
# legacy pilot. A signal-sort artifact that hit `records_parsed >= 50`
# is `done` for backfill purposes — there is no operator benefit from
# re-running, because the metadata is fully captured. The runtime
# `_decide_status` in `brand20_queue.py` still routes signal-sort
# `max_cap_reached` to `inconclusive`; that asymmetry is deliberate and
# scoped to historical artifacts only (a later, separate ticket may
# align the runtime). See I-OY-BRAND20-BACKFILL-SIGNAL-SORT-CAP-POLICY.


def _summary_cap_at(
    goods_no: str,
    sort_type: str,
    *,
    records_parsed: int,
    final_status: str = "max_cap_reached",
    quality_status: str = "ok",
    max_cap_reached: bool = True,
    run_id: str = "run_signal_cap_001",
    finished_at: str = "2026-05-13T10:00:00",
) -> dict[str, Any]:
    """Signal-sort batch summary at the 50-record cap. Defaults match
    the connector's `max_cap_reached` terminal shape."""
    return {
        "batch_id": f"backfill_test_cap_{goods_no}_{sort_type}",
        "started_at": "2026-05-13T09:30:00",
        "finished_at": finished_at,
        "halted": False,
        "max_cap_reached": max_cap_reached,
        "manifest_audit": {"sort_type_in_defaults": sort_type},
        "products": [
            {
                "oy_goods_no": goods_no,
                "status": final_status,
                "quality_status": quality_status,
                "rows_inserted": records_parsed,
                "raw_records_seen": records_parsed,
                "records_parsed": records_parsed,
                "pagination_exhausted": False,
                "last_observed_has_next": True,
                "run_id": run_id,
                "finished_at": finished_at,
                "summary": {
                    "run_id": run_id,
                    "cursor_api_rate_limited": False,
                    "cursor_api_silenced": False,
                    "incomplete_collection": False,
                    "pagination_exhausted": False,
                    "last_observed_has_next": True,
                    "retry_intent": "none",
                    "retry_after_minutes": None,
                    "requested_sort_type": sort_type,
                },
            }
        ],
    }


def _summary_complete_at(
    goods_no: str,
    sort_type: str,
    *,
    records_parsed: int,
    run_id: str = "run_signal_complete_001",
    finished_at: str = "2026-05-13T11:00:00",
) -> dict[str, Any]:
    """Signal-sort batch summary that ran clean to corpus exhaustion
    (no `max_cap_reached` flag, but `records_parsed >= 50`). Models the
    edge case where the SKU's signal-sort corpus had exactly N reviews
    and finished cleanly."""
    return {
        "batch_id": f"backfill_test_complete_{goods_no}_{sort_type}",
        "started_at": "2026-05-13T10:30:00",
        "finished_at": finished_at,
        "halted": False,
        "manifest_audit": {"sort_type_in_defaults": sort_type},
        "products": [
            {
                "oy_goods_no": goods_no,
                "status": "complete",
                "quality_status": "ok",
                "rows_inserted": records_parsed,
                "raw_records_seen": records_parsed,
                "records_parsed": records_parsed,
                "pagination_exhausted": True,
                "last_observed_has_next": False,
                "run_id": run_id,
                "finished_at": finished_at,
                "summary": {
                    "run_id": run_id,
                    "cursor_api_rate_limited": False,
                    "cursor_api_silenced": False,
                    "incomplete_collection": False,
                    "pagination_exhausted": True,
                    "last_observed_has_next": False,
                    "retry_intent": "none",
                    "retry_after_minutes": None,
                    "requested_sort_type": sort_type,
                },
            }
        ],
    }


def test_signal_sort_done_threshold_constant_is_50() -> None:
    """Pin the legacy pilot cap constant. Changing it requires a
    paired ticket / handoff because production seed reconciliation
    depends on this number."""
    assert BRAND20_SIGNAL_SORT_DONE_THRESHOLD == 50


def test_signal_sort_records_50_local_cap_partial_routes_to_done(
    tmp_path: Path,
) -> None:
    """Signal sort, records_parsed=50, max_cap_reached=True,
    final_status=max_cap_reached → status='done' after backfill
    overlay (runtime would route this to 'inconclusive'; the overlay
    re-routes for historical artifacts only)."""
    artifact_root = tmp_path / "artifacts"
    _write_summary(
        artifact_root, "run_signal_cap_50",
        _summary_cap_at("A000000111111", "RATING_ASC", records_parsed=50),
    )
    queue_path = _make_queue(tmp_path, [("A000000111111", "Test SKU")])

    rc = backfill_main([
        "--artifact-root", str(artifact_root),
        "--queue", str(queue_path),
        "--apply",
    ])
    assert rc == 0
    queue = load_queue(queue_path)
    row = queue.find("A000000111111", "RATING_ASC")
    assert row is not None
    assert row.status == "done", (
        f"expected signal-sort-at-cap (records=50) to route to 'done' "
        f"via backfill overlay; got {row.status!r}"
    )
    assert row.records_parsed_last == 50


def test_signal_sort_records_50_complete_routes_to_done(
    tmp_path: Path,
) -> None:
    """Signal sort, records_parsed=50, final_status=complete (no
    max_cap_reached — corpus had exactly 50 reviews). Overlay still
    bumps to 'done' because the 50-threshold + OK-class terminal both
    apply."""
    artifact_root = tmp_path / "artifacts"
    _write_summary(
        artifact_root, "run_signal_complete_50",
        _summary_complete_at("A000000111111", "RATING_ASC", records_parsed=50),
    )
    queue_path = _make_queue(tmp_path, [("A000000111111", "Test SKU")])

    rc = backfill_main([
        "--artifact-root", str(artifact_root),
        "--queue", str(queue_path),
        "--apply",
    ])
    assert rc == 0
    queue = load_queue(queue_path)
    row = queue.find("A000000111111", "RATING_ASC")
    assert row is not None
    # NB: a 'complete' signal-sort summary already routes to 'done' via
    # the runtime path; the overlay is a no-op here but the final state
    # must still be 'done'. This test pins both paths converge.
    assert row.status == "done"


def test_signal_sort_records_48_retryable_429_routes_to_ready(
    tmp_path: Path,
) -> None:
    """Signal sort, records_parsed=48, cursor_api_rate_limited=True
    → status='ready' + operator_note names cursor_api_rate_limited.
    The overlay must NOT fire here (records < 50, AND classification
    is retryable_429_partial, not done/local_cap_partial)."""
    artifact_root = tmp_path / "artifacts"
    _write_summary(
        artifact_root, "run_signal_429_48",
        _summary_429("A000000111111", "RATING_ASC", records_parsed=48),
    )
    queue_path = _make_queue(tmp_path, [("A000000111111", "Test SKU")])

    rc = backfill_main([
        "--artifact-root", str(artifact_root),
        "--queue", str(queue_path),
        "--apply",
    ])
    assert rc == 0
    queue = load_queue(queue_path)
    row = queue.find("A000000111111", "RATING_ASC")
    assert row is not None
    assert row.status == "ready"
    assert row.operator_note is not None
    assert "cursor_api_rate_limited" in row.operator_note


def test_signal_sort_records_0_unknown_routes_to_inconclusive(
    tmp_path: Path,
) -> None:
    """Signal sort, records_parsed=0, no useful terminal signal
    → status='inconclusive'. The overlay is a no-op (parsed < 50)."""
    artifact_root = tmp_path / "artifacts"
    payload = {
        "batch_id": "backfill_test_unknown_signal",
        "started_at": "2026-05-13T08:00:00",
        "finished_at": "2026-05-13T08:05:00",
        "halted": True,
        "manifest_audit": {"sort_type_in_defaults": "RATING_ASC"},
        "products": [
            {
                "oy_goods_no": "A000000111111",
                "status": "unknown",
                "quality_status": "invalid",
                "rows_inserted": 0,
                "raw_records_seen": 0,
                "records_parsed": 0,
                "run_id": "run_unknown_001",
                "finished_at": "2026-05-13T08:05:00",
                "summary": {
                    "run_id": "run_unknown_001",
                    "cursor_api_rate_limited": False,
                    "cursor_api_silenced": False,
                    "incomplete_collection": False,
                    "retry_intent": "none",
                    "retry_after_minutes": None,
                    "requested_sort_type": "RATING_ASC",
                },
            }
        ],
    }
    _write_summary(artifact_root, "run_signal_unknown_0", payload)
    queue_path = _make_queue(tmp_path, [("A000000111111", "Test SKU")])

    rc = backfill_main([
        "--artifact-root", str(artifact_root),
        "--queue", str(queue_path),
        "--apply",
    ])
    assert rc == 0
    queue = load_queue(queue_path)
    row = queue.find("A000000111111", "RATING_ASC")
    assert row is not None
    assert row.status == "inconclusive"


def test_signal_sort_records_0_with_manual_required_routes_to_manual_checkpoint(
    tmp_path: Path,
) -> None:
    """Signal sort, records_parsed=0, retry_intent=manual_review_required
    → status='manual_checkpoint'. The overlay is a no-op (classification
    is manual_required, not done/local_cap_partial)."""
    artifact_root = tmp_path / "artifacts"
    _write_summary(
        artifact_root, "run_signal_manual",
        _summary_manual("A000000111111", "RATING_ASC"),
    )
    queue_path = _make_queue(tmp_path, [("A000000111111", "Test SKU")])

    rc = backfill_main([
        "--artifact-root", str(artifact_root),
        "--queue", str(queue_path),
        "--apply",
    ])
    assert rc == 0
    queue = load_queue(queue_path)
    row = queue.find("A000000111111", "RATING_ASC")
    assert row is not None
    assert row.status == "manual_checkpoint"


def test_datetime_desc_local_cap_partial_remains_ready(
    tmp_path: Path,
) -> None:
    """Primary sort, records_parsed=490, max_cap_reached=True → still
    status='ready' (NOT done). The overlay only targets target_type
    'signal'; primary rows go through the runtime path unchanged."""
    artifact_root = tmp_path / "artifacts"
    _write_summary(
        artifact_root, "run_primary_cap_490",
        _summary_cap_at(
            "A000000111111", "DATETIME_DESC",
            records_parsed=490,
        ),
    )
    queue_path = _make_queue(tmp_path, [("A000000111111", "Test SKU")])

    rc = backfill_main([
        "--artifact-root", str(artifact_root),
        "--queue", str(queue_path),
        "--apply",
    ])
    assert rc == 0
    queue = load_queue(queue_path)
    row = queue.find("A000000111111", "DATETIME_DESC")
    assert row is not None
    assert row.status == "ready"


def test_datetime_desc_complete_remains_done(tmp_path: Path) -> None:
    """Primary sort, pagination exhausted, final_status=ok → status='done'
    via the runtime path. Overlay is a no-op (target_type=primary)."""
    artifact_root = tmp_path / "artifacts"
    _write_summary(
        artifact_root, "run_primary_done",
        _summary_done("A000000111111", "DATETIME_DESC"),
    )
    queue_path = _make_queue(tmp_path, [("A000000111111", "Test SKU")])

    rc = backfill_main([
        "--artifact-root", str(artifact_root),
        "--queue", str(queue_path),
        "--apply",
    ])
    assert rc == 0
    queue = load_queue(queue_path)
    row = queue.find("A000000111111", "DATETIME_DESC")
    assert row is not None
    assert row.status == "done"


def test_apply_signal_sort_cap_overlay_idempotent(tmp_path: Path) -> None:
    """Running --apply twice on a queue that already has signal-cap
    rows at 'done' produces no further state changes."""
    artifact_root = tmp_path / "artifacts"
    _write_summary(
        artifact_root, "run_signal_cap_50",
        _summary_cap_at("A000000111111", "RATING_ASC", records_parsed=50),
    )
    queue_path = _make_queue(tmp_path, [("A000000111111", "Test SKU")])

    rc = backfill_main([
        "--artifact-root", str(artifact_root),
        "--queue", str(queue_path),
        "--apply",
    ])
    assert rc == 0
    first_state = load_queue(queue_path).model_dump(by_alias=True)
    assert any(
        it["status"] == "done"
        and it["sort_type"] == "RATING_ASC"
        for it in first_state["items"]
    )

    rc = backfill_main([
        "--artifact-root", str(artifact_root),
        "--queue", str(queue_path),
        "--apply",
    ])
    assert rc == 0
    second_state = load_queue(queue_path).model_dump(by_alias=True)

    # Same projection used by `test_apply_is_idempotent`: drop the
    # `attempts` counter and the wall-clock `last_attempt_at` field
    # (both are bookkeeping that increments on every call).
    def project(state: dict[str, Any]) -> list[dict[str, Any]]:
        return [
            {k: v for k, v in it.items()
             if k not in {"attempts", "last_attempt_at"}}
            for it in state["items"]
        ]

    assert project(first_state) == project(second_state)


def test_signal_sort_records_75_routes_to_done_even_if_summary_says_local_cap_partial(
    tmp_path: Path,
) -> None:
    """Historical runs may have used a different cap (e.g. 75 records).
    The overlay threshold is 50, so any signal-sort summary with
    records_parsed >= 50 + OK-class terminal routes to 'done'."""
    artifact_root = tmp_path / "artifacts"
    _write_summary(
        artifact_root, "run_signal_cap_75",
        _summary_cap_at("A000000111111", "RATING_ASC", records_parsed=75),
    )
    queue_path = _make_queue(tmp_path, [("A000000111111", "Test SKU")])

    rc = backfill_main([
        "--artifact-root", str(artifact_root),
        "--queue", str(queue_path),
        "--apply",
    ])
    assert rc == 0
    queue = load_queue(queue_path)
    row = queue.find("A000000111111", "RATING_ASC")
    assert row is not None
    assert row.status == "done"
    assert row.records_parsed_last == 75


def test_overlay_does_not_touch_primary_rows(tmp_path: Path) -> None:
    """Round-trip a primary `done`-classified batch_summary through
    --apply. Resulting row has status='done', NOT silently rewritten by
    the overlay (overlay only fires for target_type='signal')."""
    artifact_root = tmp_path / "artifacts"
    _write_summary(
        artifact_root, "run_primary_done",
        _summary_done("A000000111111", "DATETIME_DESC", records_parsed=3120),
    )
    queue_path = _make_queue(tmp_path, [("A000000111111", "Test SKU")])

    rc = backfill_main([
        "--artifact-root", str(artifact_root),
        "--queue", str(queue_path),
        "--apply",
    ])
    assert rc == 0
    queue = load_queue(queue_path)
    row = queue.find("A000000111111", "DATETIME_DESC")
    assert row is not None
    assert row.target_type == "primary"
    assert row.status == "done"
    # Operator-note and retry slots untouched (primary done path).
    assert row.operator_note is None
    assert row.checkpoint_reason is None
    assert row.next_run_after is None


def test_script_runs_as_subprocess_dry_run(tmp_path: Path) -> None:
    """End-to-end: invoking the script via `python3 -m` style with an
    empty artifact root works and exits cleanly."""
    artifact_root = tmp_path / "empty_artifacts"
    artifact_root.mkdir()
    queue_path = _make_queue(tmp_path, [("A000000111111", "Test SKU")])

    proc = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--artifact-root", str(artifact_root),
            "--queue", str(queue_path),
        ],
        cwd=str(REPO),
        env={"PYTHONPATH": str(REPO)},
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    assert "DRY-RUN" in proc.stdout
    assert "(no matching candidates found)" in proc.stdout
