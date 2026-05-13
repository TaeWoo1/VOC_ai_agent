"""Tests for scripts/pick_next_brand20_target.py."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from src.voc.app.brand20_queue import Brand20Queue, QueueItem, QueueMeta, save_queue


REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts" / "pick_next_brand20_target.py"


def _queue_path(tmp_path: Path, items: list[QueueItem]) -> Path:
    path = tmp_path / "queue.json"
    save_queue(path, Brand20Queue(meta=QueueMeta(schema_version=1), items=items))
    return path


def _run_picker(queue: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--queue", str(queue), *args],
        cwd=str(REPO),
        env={"PYTHONPATH": str(REPO), "PATH": "/usr/bin:/bin"},
        capture_output=True,
        text=True,
        check=False,
    )


def test_picks_ready_datetime_desc_over_pending_signal_sort(tmp_path: Path) -> None:
    queue = _queue_path(tmp_path, [
        QueueItem(
            goods_no="A000000222222",
            product_name="Signal Product",
            sort_type="RATING_ASC",
            target_type="signal",
            status="pending",
        ),
        QueueItem(
            goods_no="A000000111111",
            product_name="Primary Product",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="ready",
        ),
    ])

    result = _run_picker(queue, "--include-signal-sorts", "--shell")

    assert result.returncode == 0
    assert result.stdout.strip() == "A000000111111 DATETIME_DESC"


def test_excludes_done_and_manual_checkpoint(tmp_path: Path) -> None:
    queue = _queue_path(tmp_path, [
        QueueItem(
            goods_no="A000000111111",
            product_name="Done Product",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="done",
        ),
        QueueItem(
            goods_no="A000000222222",
            product_name="Manual Product",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="manual_checkpoint",
        ),
        QueueItem(
            goods_no="A000000333333",
            product_name="Pending Product",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="pending",
        ),
    ])

    result = _run_picker(queue, "--shell")

    assert result.returncode == 0
    assert result.stdout.strip() == "A000000333333 DATETIME_DESC"


def test_never_attempted_ready_above_recent_retry_after_cooldown(
    tmp_path: Path,
) -> None:
    queue = _queue_path(tmp_path, [
        QueueItem(
            goods_no="A000000111111",
            product_name="Recent Retry",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="ready",
            retry_intent="retry_after_cooldown",
            attempts=1,
            last_attempt_at="2026-05-13T13:00:00Z",
        ),
        QueueItem(
            goods_no="A000000222222",
            product_name="Never Ready",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="ready",
        ),
    ])

    result = _run_picker(queue, "--shell")

    assert result.returncode == 0
    assert result.stdout.strip() == "A000000222222 DATETIME_DESC"


def test_zero_insert_recent_retry_ranks_below_other_ready(
    tmp_path: Path,
) -> None:
    queue = _queue_path(tmp_path, [
        QueueItem(
            goods_no="A000000111111",
            product_name="Zero Insert",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="ready",
            rows_inserted_last=0,
            attempts=1,
            last_attempt_at="2026-05-13T13:00:00Z",
            operator_note="cursor_api_rate_limited observed",
        ),
        QueueItem(
            goods_no="A000000222222",
            product_name="Other Ready",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="ready",
            rows_inserted_last=24,
            attempts=1,
            last_attempt_at="2026-05-13T12:00:00Z",
        ),
    ])

    result = _run_picker(queue, "--json")

    assert result.returncode == 0
    payload = json.loads(result.stdout)
    assert payload["goods_no"] == "A000000222222"
    assert payload["reason"] == "ready, last attempted 2026-05-13T12:00:00Z"


def test_shell_prints_exactly_two_tokens(tmp_path: Path) -> None:
    queue = _queue_path(tmp_path, [
        QueueItem(
            goods_no="A000000111111",
            product_name="Primary Product",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="ready",
        ),
    ])

    result = _run_picker(queue, "--shell")

    assert result.returncode == 0
    assert result.stdout == "A000000111111 DATETIME_DESC\n"
    assert result.stderr == ""


def test_no_runnable_target_exits_2(tmp_path: Path) -> None:
    queue = _queue_path(tmp_path, [
        QueueItem(
            goods_no="A000000111111",
            product_name="Done Product",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="done",
        ),
        QueueItem(
            goods_no="A000000222222",
            product_name="Manual Product",
            sort_type="DATETIME_DESC",
            target_type="primary",
            status="manual_checkpoint",
        ),
    ])

    result = _run_picker(queue, "--shell")

    assert result.returncode == 2
    assert result.stdout == ""
    assert "no runnable Brand-20 target found" in result.stderr
