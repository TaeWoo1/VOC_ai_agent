"""Tests for the phase-A CLI script `run_brand20_queue_runner.py`.

All tests call `main([...])` directly — no test forks a subprocess.
All tests patch `cdp_tab_probe` so no test contacts 127.0.0.1:9222.
All tests patch the `_default_pgrep` runner so no test forks `pgrep`.

The CLI in phase A never invokes `subprocess.run` on the collection
script; tests assert this property by patching `subprocess.run` at the
script's import scope (only the precondition gate's _default_*
helpers use subprocess) and asserting it is not called against the
collection entrypoint.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest

# Ensure repo root is on sys.path so `scripts.run_brand20_queue_runner`
# imports cleanly when pytest runs from the repo root.
REPO = Path(__file__).resolve().parent.parent.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from scripts import run_brand20_queue_runner as cli  # noqa: E402
from src.voc.app import brand20_runner_precondition as precond  # noqa: E402
from src.voc.app import cdp_tab_probe as cdp_probe  # noqa: E402
from src.voc.app.brand20_queue import (  # noqa: E402
    Brand20Queue,
    QueueItem,
    QueueMeta,
    make_full_sort_set,
    save_queue,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def queue_path(tmp_path: Path) -> Path:
    """Write a small two-SKU queue to disk and return its path."""
    rows: list[QueueItem] = []
    rows.extend(make_full_sort_set(goods_no="A000000111111", product_name="Brand-A"))
    rows.extend(make_full_sort_set(goods_no="A000000222222", product_name="Brand-B"))
    queue = Brand20Queue(meta=QueueMeta(schema_version=1), items=rows)
    path = tmp_path / "queue.json"
    save_queue(path, queue)
    return path


@pytest.fixture
def patch_cdp_happy(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Default CDP probe: reachable, target tab open on the product
    page for either Brand-A or Brand-B."""

    def _get_version() -> dict:
        return {"Browser": "Chrome/123"}

    def _list_tabs() -> list[dict]:
        return [
            {
                "id": "a",
                "url": (
                    "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?"
                    "goodsNo=A000000111111&tab=review"
                ),
            },
            {
                "id": "b",
                "url": (
                    "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?"
                    "goodsNo=A000000222222&tab=review"
                ),
            },
        ]

    open_tab_calls: list[str] = []

    def _open_tab(url: str, *_a: Any, **_kw: Any) -> dict:
        open_tab_calls.append(url)
        raise AssertionError("phase A must never call cdp_tab_probe.open_tab")

    monkeypatch.setattr(cdp_probe, "get_version", _get_version)
    monkeypatch.setattr(cdp_probe, "list_tabs", _list_tabs)
    monkeypatch.setattr(cdp_probe, "open_tab", _open_tab)
    monkeypatch.setattr(precond, "_default_pgrep", lambda _cmd: [])
    return {"open_tab_calls": open_tab_calls}


@pytest.fixture
def patch_cdp_unreachable(monkeypatch: pytest.MonkeyPatch) -> None:
    """CDP probe raises CdpUnreachableError on /json/version."""

    def _get_version() -> dict:
        raise cdp_probe.CdpUnreachableError("connection refused (test)")

    def _list_tabs() -> list[dict]:
        return []

    monkeypatch.setattr(cdp_probe, "get_version", _get_version)
    monkeypatch.setattr(cdp_probe, "list_tabs", _list_tabs)
    monkeypatch.setattr(precond, "_default_pgrep", lambda _cmd: [])


@pytest.fixture
def assert_no_subprocess_collection_run(monkeypatch: pytest.MonkeyPatch) -> dict[str, list]:
    """Patch subprocess.run AT THE script-module scope so we can prove
    the runner never invokes the collection child in phase A.

    The phase-A CLI never calls subprocess.run on
    `scripts/run_oy_collection_batch.py`. The precondition gate uses
    `_default_pgrep` and `_default_git_head_short` which use
    `subprocess.run`, but those are patched elsewhere (`_default_pgrep`)
    or not exercised (no `--head-baseline` passed).
    """
    calls: list[tuple[tuple, dict]] = []

    def _fake_run(*args: Any, **kwargs: Any) -> Any:
        calls.append((args, kwargs))
        raise AssertionError(
            f"subprocess.run unexpectedly invoked in phase A: args={args!r}"
        )

    # Patch in the CLI module so any direct call is caught.
    monkeypatch.setattr(cli, "sys", cli.sys)  # no-op, satisfies the assertion below
    # Phase A doesn't import subprocess in cli.py, but we attach the
    # sentinel anyway so callers can verify by attribute.
    monkeypatch.setattr(
        "subprocess.run",
        _fake_run,
    )
    return {"calls": calls}


# ---------------------------------------------------------------------------
# Default mode
# ---------------------------------------------------------------------------


def test_default_mode_prints_plan_block_and_exits_zero(
    queue_path: Path,
    patch_cdp_happy: dict[str, Any],
    capsys: pytest.CaptureFixture,
) -> None:
    """Default mode (no flags beyond --queue): plan block printed, no
    subprocess call, exit 0 because the gate is OK."""
    exit_code = cli.main([
        "--queue", str(queue_path),
        "--artifact-root", "/tmp/test-artifacts",
    ])
    assert exit_code == 0
    out = capsys.readouterr().out
    assert "Brand-20 runner — phase A plan block" in out
    assert "phase A. No live collection launched." in out
    assert "goods_no:        A000000111111" in out
    assert "target_url:      https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000111111&tab=review" in out
    # Confirm open_tab was never invoked.
    assert patch_cdp_happy["open_tab_calls"] == []


def test_default_mode_exits_two_on_gate_failure(
    queue_path: Path,
    patch_cdp_unreachable: None,
    capsys: pytest.CaptureFixture,
) -> None:
    exit_code = cli.main([
        "--queue", str(queue_path),
    ])
    assert exit_code == 2
    out = capsys.readouterr().out
    # Plan block is still printed (so the operator sees the target).
    assert "Brand-20 runner — phase A plan block" in out
    assert "cdp_unreachable" in out


# ---------------------------------------------------------------------------
# --check mode
# ---------------------------------------------------------------------------


def test_check_mode_gate_ok_exits_zero(
    queue_path: Path,
    patch_cdp_happy: dict[str, Any],
    capsys: pytest.CaptureFixture,
) -> None:
    exit_code = cli.main([
        "--queue", str(queue_path),
        "--check",
    ])
    assert exit_code == 0
    out = capsys.readouterr().out
    assert "preconditions: ok" in out


def test_check_mode_gate_failure_exits_two(
    queue_path: Path,
    patch_cdp_unreachable: None,
    capsys: pytest.CaptureFixture,
) -> None:
    exit_code = cli.main([
        "--queue", str(queue_path),
        "--check",
    ])
    assert exit_code == 2
    err = capsys.readouterr().err
    assert "cdp_unreachable" in err


# ---------------------------------------------------------------------------
# --dry-run
# ---------------------------------------------------------------------------


def test_dry_run_does_not_invoke_collection_subprocess(
    queue_path: Path,
    patch_cdp_happy: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Patch subprocess.run; assert it's never called against the
    collection script in --dry-run mode."""
    captured: list = []

    def _fake_run(*args: Any, **kwargs: Any) -> Any:
        captured.append((args, kwargs))
        # If anything DOES call subprocess.run, make sure it isn't
        # for the collection script. The precondition gate uses
        # subprocess for pgrep/git, but we've patched _default_pgrep
        # above and we don't pass --head-baseline.
        cmd = args[0] if args else kwargs.get("args")
        if cmd:
            joined = " ".join(str(x) for x in cmd) if isinstance(cmd, (list, tuple)) else str(cmd)
            assert "run_oy_collection_batch" not in joined, (
                f"phase A must not invoke collection: {joined!r}"
            )
        # Return a minimal CompletedProcess-like object.
        from subprocess import CompletedProcess
        return CompletedProcess(args=cmd or [], returncode=0, stdout="", stderr="")

    monkeypatch.setattr("subprocess.run", _fake_run)
    exit_code = cli.main([
        "--queue", str(queue_path),
        "--dry-run",
    ])
    assert exit_code == 0


# ---------------------------------------------------------------------------
# --i-authorize-live-collection (phase A short-circuit)
# ---------------------------------------------------------------------------


def test_authorize_live_collection_short_circuits_in_phase_a(
    queue_path: Path,
    patch_cdp_happy: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture,
) -> None:
    """Phase A: --i-authorize-live-collection prints the 'not yet
    implemented' notice and exits 0. subprocess.run is NEVER called
    on the collection script."""
    def _fake_run(*args: Any, **kwargs: Any) -> Any:
        cmd = args[0] if args else kwargs.get("args")
        joined = " ".join(str(x) for x in cmd) if isinstance(cmd, (list, tuple)) else str(cmd)
        assert "run_oy_collection_batch" not in joined, (
            f"phase A must not invoke collection: {joined!r}"
        )
        from subprocess import CompletedProcess
        return CompletedProcess(args=cmd or [], returncode=0, stdout="", stderr="")

    monkeypatch.setattr("subprocess.run", _fake_run)
    exit_code = cli.main([
        "--queue", str(queue_path),
        "--i-authorize-live-collection",
    ])
    assert exit_code == 0
    out = capsys.readouterr().out
    assert "phase A: collection invocation not yet implemented" in out
    assert "Brand-20 runner — phase A plan block" in out
    assert patch_cdp_happy["open_tab_calls"] == []


# ---------------------------------------------------------------------------
# Operator override
# ---------------------------------------------------------------------------


def test_override_single_flag_exits_two(
    queue_path: Path,
    patch_cdp_happy: dict[str, Any],
    capsys: pytest.CaptureFixture,
) -> None:
    """--goods-no without --sort-type → exit 2 with exact message."""
    exit_code = cli.main([
        "--queue", str(queue_path),
        "--goods-no", "A000000111111",
    ])
    assert exit_code == 2
    err = capsys.readouterr().err
    assert "operator override requires both --goods-no and --sort-type" in err


def test_override_on_done_row_exits_two_with_clear_message(
    tmp_path: Path,
    patch_cdp_happy: dict[str, Any],
    capsys: pytest.CaptureFixture,
) -> None:
    """Operator override against a `done` row → RowNotRunnableError →
    exit 2 with a message naming the row."""
    rows: list[QueueItem] = []
    rows.extend(make_full_sort_set(goods_no="A000000111111", product_name="Brand-A"))
    rows.extend(make_full_sort_set(goods_no="A000000222222", product_name="Brand-B"))
    for it in rows:
        if it.goods_no == "A000000222222" and it.sort_type == "DATETIME_DESC":
            it.status = "done"
    queue = Brand20Queue(meta=QueueMeta(schema_version=1), items=rows)
    path = tmp_path / "queue.json"
    save_queue(path, queue)

    exit_code = cli.main([
        "--queue", str(path),
        "--goods-no", "A000000222222",
        "--sort-type", "DATETIME_DESC",
    ])
    assert exit_code == 2
    err = capsys.readouterr().err
    assert "not runnable" in err or "done" in err
    assert "A000000222222" in err


def test_override_on_unknown_row_exits_two(
    queue_path: Path,
    patch_cdp_happy: dict[str, Any],
    capsys: pytest.CaptureFixture,
) -> None:
    exit_code = cli.main([
        "--queue", str(queue_path),
        "--goods-no", "A000009999999",
        "--sort-type", "DATETIME_DESC",
    ])
    assert exit_code == 2
    err = capsys.readouterr().err
    assert "A000009999999" in err


# ---------------------------------------------------------------------------
# --allow-open-tab parsed but never acted on
# ---------------------------------------------------------------------------


def test_allow_open_tab_flag_parsed_but_never_calls_open_tab(
    queue_path: Path,
    patch_cdp_happy: dict[str, Any],
) -> None:
    """--allow-open-tab is parsed; with the tab already open the gate
    passes; cdp_tab_probe.open_tab is NEVER called."""
    exit_code = cli.main([
        "--queue", str(queue_path),
        "--allow-open-tab",
    ])
    assert exit_code == 0
    assert patch_cdp_happy["open_tab_calls"] == []


# ---------------------------------------------------------------------------
# No-runnable-item path
# ---------------------------------------------------------------------------


def test_no_runnable_items_exits_three(
    tmp_path: Path,
    patch_cdp_happy: dict[str, Any],
    capsys: pytest.CaptureFixture,
) -> None:
    """Every row terminal → exit 3."""
    rows = make_full_sort_set(goods_no="A000000111111", product_name="Brand-A")
    for it in rows:
        it.status = "done"
    queue = Brand20Queue(meta=QueueMeta(schema_version=1), items=rows)
    path = tmp_path / "queue.json"
    save_queue(path, queue)

    exit_code = cli.main([
        "--queue", str(path),
    ])
    assert exit_code == 3
