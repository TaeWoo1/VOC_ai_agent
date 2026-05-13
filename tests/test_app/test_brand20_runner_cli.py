"""Tests for the CLI script `run_brand20_queue_runner.py`.

All tests call `main([...])` directly — no test forks a real
subprocess. All tests patch `cdp_tab_probe` so no test contacts
127.0.0.1:9222. All tests patch the `_default_pgrep` runner so no
test forks `pgrep`.

The CLI never invokes a real `subprocess.run` of the collection
script in tests: every phase-B test passes a `subprocess_runner` stub
that writes a fixture `batch_summary.json` at the deterministic
artifact-root location the runner expects.
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
    """Default mode (no flags beyond --queue): plan-only block printed,
    no subprocess call, exit 0 because the gate is OK. The header /
    trailing note are the mode-aware "plan-only" labels (the runner is
    no longer phase A; see
    I-OY-BRAND20-RUNNER-MAX-CAP-AND-STATUS-MAPPING-FIX §1)."""
    exit_code = cli.main([
        "--queue", str(queue_path),
        "--artifact-root", "/tmp/test-artifacts",
    ])
    assert exit_code == 0
    out = capsys.readouterr().out
    assert "Brand-20 runner — plan-only block" in out
    # Forbidden literals from the prior phase-A scaffold.
    assert "phase A" not in out
    assert "No live collection launched" not in out
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
    assert "Brand-20 runner — plan-only block" in out
    assert "phase A" not in out
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
# --i-authorize-live-collection — without flag, no subprocess
# ---------------------------------------------------------------------------


def test_no_auth_flag_never_invokes_subprocess(
    queue_path: Path,
    patch_cdp_happy: dict[str, Any],
    capsys: pytest.CaptureFixture,
) -> None:
    """Without --i-authorize-live-collection, the runner MUST NOT call
    `subprocess.run` on the collection script. Pin the phase-A
    guarantee that authorization is required for any live launch."""
    calls: list[tuple[tuple, dict]] = []

    def _stub(*args: Any, **kwargs: Any) -> Any:
        calls.append((args, kwargs))
        raise AssertionError(
            f"subprocess.run unexpectedly invoked without --i-authorize-"
            f"live-collection: args={args!r}"
        )

    exit_code = cli.main(
        [
            "--queue", str(queue_path),
            "--artifact-root", "/tmp/should-not-be-created",
        ],
        subprocess_runner=_stub,
    )
    assert exit_code == 0
    assert calls == []
    out = capsys.readouterr().out
    assert "Brand-20 runner — plan-only block" in out
    assert "phase A" not in out
    assert "No live collection launched" not in out
    # Operator-facing "no live collection invoked" hint must still
    # appear — just not via the old phase-A literal.
    assert "no live collection" in out.lower()
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


# ===========================================================================
# Phase B: subprocess invocation, queue update, loop, stop policy
# ===========================================================================

import json  # noqa: E402
import shutil  # noqa: E402
from subprocess import CompletedProcess  # noqa: E402

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "brand20_runner"


def _stub_subprocess_runner_writing_fixture(
    fixture_name: str,
    *,
    artifact_root: Path,
    goods_no: str,
    sort_type: str,
    returncode: int = 0,
):
    """Build a `subprocess.run`-compatible stub that, when invoked,
    locates the `--artifact-root` and `--manifest` args in argv,
    reads the manifest to discover the `batch_id`, then copies the
    fixture into `<artifact_root>/<batch_id>/batch_summary.json`.

    The fixture is rewritten on the way out so its `goods_no` /
    `sort_type` match the queue row the runner just picked — this
    keeps fixtures small while still letting the runner apply them
    against arbitrary test queues.
    """
    fixture_path = FIXTURE_DIR / fixture_name
    assert fixture_path.is_file(), (
        f"fixture missing: {fixture_path}"
    )

    def _runner(argv, *_args, **kwargs):
        # Find manifest + artifact-root from argv. The runner always
        # passes them as `--manifest <path>` / `--artifact-root <path>`.
        manifest_path: Path | None = None
        actual_artifact_root: Path | None = None
        for i, tok in enumerate(argv):
            if tok == "--manifest" and i + 1 < len(argv):
                manifest_path = Path(argv[i + 1])
            elif tok == "--artifact-root" and i + 1 < len(argv):
                actual_artifact_root = Path(argv[i + 1])
        assert manifest_path is not None, f"no --manifest in argv: {argv!r}"
        assert actual_artifact_root is not None, (
            f"no --artifact-root in argv: {argv!r}"
        )
        assert manifest_path.is_file(), (
            f"runner did not write manifest before invoking subprocess: "
            f"{manifest_path}"
        )
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        batch_id = manifest["batch_id"]
        batch_dir = actual_artifact_root / batch_id
        batch_dir.mkdir(parents=True, exist_ok=True)
        # Rewrite the fixture's goods_no / sort_type so apply_batch_summary
        # finds the right queue row.
        payload = json.loads(fixture_path.read_text(encoding="utf-8"))
        for p in payload.get("products", []):
            p["oy_goods_no"] = goods_no
            if isinstance(p.get("summary"), dict):
                p["summary"]["requested_sort_type"] = sort_type
            if isinstance(p.get("resume_state"), dict):
                p["resume_state"]["goods_no"] = goods_no
                p["resume_state"]["sort_type"] = sort_type
        if isinstance(payload.get("manifest_audit"), dict):
            payload["manifest_audit"]["sort_type_in_defaults"] = sort_type
        (batch_dir / "batch_summary.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return CompletedProcess(args=argv, returncode=returncode, stdout=None, stderr=None)

    return _runner


def _stub_subprocess_runner_sequence(stubs):
    """Compose a sequence of stubs, calling them in order for each
    successive `subprocess.run` call. Each stub is a callable as
    produced by `_stub_subprocess_runner_writing_fixture`."""
    state = {"i": 0, "calls": []}

    def _runner(argv, *args, **kwargs):
        state["calls"].append(argv)
        idx = state["i"]
        if idx >= len(stubs):
            raise AssertionError(
                f"subprocess.run called {idx + 1} times but only "
                f"{len(stubs)} stubs configured"
            )
        state["i"] += 1
        return stubs[idx](argv, *args, **kwargs)

    _runner.state = state  # type: ignore[attr-defined]
    return _runner


def test_auth_flag_invokes_mock_subprocess_once(
    queue_path: Path,
    patch_cdp_happy: dict[str, Any],
    tmp_path: Path,
    capsys: pytest.CaptureFixture,
) -> None:
    """With --i-authorize-live-collection AND a stubbed subprocess
    that writes a clean-`complete` fixture, the runner invokes the
    subprocess exactly once with the expected argv (interpreter,
    script, --manifest, --artifact-root) and the expected env
    overrides."""
    artifact_root = tmp_path / "artifacts"
    artifact_root.mkdir()
    captured: dict[str, Any] = {"calls": []}

    base_stub = _stub_subprocess_runner_writing_fixture(
        "batch_summary_complete.json",
        artifact_root=artifact_root,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
    )

    def _wrapper(argv, *args, **kwargs):
        captured["calls"].append({"argv": argv, "kwargs": dict(kwargs)})
        return base_stub(argv, *args, **kwargs)

    exit_code = cli.main(
        [
            "--queue", str(queue_path),
            "--artifact-root", str(artifact_root),
            "--i-authorize-live-collection",
        ],
        subprocess_runner=_wrapper,
    )
    assert exit_code == 0
    assert len(captured["calls"]) == 1
    call = captured["calls"][0]
    argv = call["argv"]
    assert argv[0] == cli.DEFAULT_INTERPRETER
    assert argv[1].endswith("scripts/run_oy_collection_batch.py")
    assert "--manifest" in argv
    assert "--artifact-root" in argv
    assert str(artifact_root) in argv
    # Env overrides: PINNED_ENV present in the kwargs `env` dict.
    env = call["kwargs"]["env"]
    for k, v in cli.PINNED_ENV.items():
        assert env.get(k) == v
    # check=False is the contract — the runner inspects batch_summary
    # itself rather than trusting exit code.
    assert call["kwargs"].get("check") is False
    out = capsys.readouterr().out
    assert "applied batch_summary" in out
    assert "status=done" in out
    assert "DONE: Brand-A/DATETIME_DESC" in out
    assert "rows=1250" in out


def test_auth_flag_with_dry_run_does_not_invoke_subprocess(
    queue_path: Path,
    patch_cdp_happy: dict[str, Any],
) -> None:
    """--dry-run wins over --i-authorize-live-collection: plan only,
    no subprocess, no queue mutation."""
    calls: list = []

    def _stub(*args: Any, **kwargs: Any) -> Any:
        calls.append((args, kwargs))
        raise AssertionError("subprocess must not be called under --dry-run")

    exit_code = cli.main(
        [
            "--queue", str(queue_path),
            "--dry-run",
            "--i-authorize-live-collection",
        ],
        subprocess_runner=_stub,
    )
    assert exit_code == 0
    assert calls == []


def test_allow_open_tab_calls_cdp_only_when_auth_present(
    queue_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """`--allow-open-tab` may call cdp_tab_probe.open_tab ONLY when
    `--i-authorize-live-collection` is ALSO passed. Without auth, the
    runner refuses to open a tab (preserves phase-A guarantee)."""
    open_calls: list[str] = []

    def _list_tabs_no_target() -> list[dict]:
        return [{"id": "x", "url": "https://www.google.com/"}]

    monkeypatch.setattr(cdp_probe, "get_version", lambda: {"Browser": "Chrome/123"})
    monkeypatch.setattr(cdp_probe, "list_tabs", _list_tabs_no_target)
    monkeypatch.setattr(precond, "_default_pgrep", lambda _cmd: [])

    def _open_tab(target_url: str, *_a, **_kw) -> dict:
        open_calls.append(target_url)
        return {"id": "new", "url": target_url}

    monkeypatch.setattr(cdp_probe, "open_tab", _open_tab)

    # Case 1: --allow-open-tab WITHOUT auth → never opens tab.
    exit_code = cli.main([
        "--queue", str(queue_path),
        "--allow-open-tab",
    ])
    assert exit_code == 2
    assert open_calls == [], (
        f"open_tab must NOT be called without --i-authorize-"
        f"live-collection; saw: {open_calls!r}"
    )


def test_allow_open_tab_re_checks_target_tab(
    queue_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """When both `--allow-open-tab` AND `--i-authorize-live-collection`
    are passed, the gate calls `open_tab` once and the post-open
    re-list now contains the target tab → runner proceeds."""
    open_calls: list[str] = []
    list_calls = {"count": 0}

    def _list_tabs() -> list[dict]:
        list_calls["count"] += 1
        if list_calls["count"] == 1:
            return [{"id": "x", "url": "https://www.google.com/"}]
        return [{
            "id": "new",
            "url": (
                "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?"
                "goodsNo=A000000111111&tab=review"
            ),
        }]

    def _open_tab(target_url: str, *_a, **_kw) -> dict:
        open_calls.append(target_url)
        return {"id": "new", "url": target_url}

    monkeypatch.setattr(cdp_probe, "get_version", lambda: {"Browser": "Chrome/123"})
    monkeypatch.setattr(cdp_probe, "list_tabs", _list_tabs)
    monkeypatch.setattr(cdp_probe, "open_tab", _open_tab)
    monkeypatch.setattr(precond, "_default_pgrep", lambda _cmd: [])

    artifact_root = tmp_path / "artifacts"
    artifact_root.mkdir()
    stub = _stub_subprocess_runner_writing_fixture(
        "batch_summary_complete.json",
        artifact_root=artifact_root,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
    )

    exit_code = cli.main(
        [
            "--queue", str(queue_path),
            "--artifact-root", str(artifact_root),
            "--allow-open-tab",
            "--i-authorize-live-collection",
        ],
        subprocess_runner=stub,
    )
    assert exit_code == 0, "runner should proceed after open_tab resolves"
    assert len(open_calls) == 1
    assert "goodsNo=A000000111111" in open_calls[0]
    assert list_calls["count"] >= 2


def test_post_run_batch_summary_updates_queue(
    queue_path: Path,
    patch_cdp_happy: dict[str, Any],
    tmp_path: Path,
) -> None:
    """After a stubbed subprocess writes a clean-`complete` fixture,
    the queue file on disk shows the target row as `status=done` with
    `last_attempted_at` populated."""
    artifact_root = tmp_path / "artifacts"
    artifact_root.mkdir()
    stub = _stub_subprocess_runner_writing_fixture(
        "batch_summary_complete.json",
        artifact_root=artifact_root,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
    )
    exit_code = cli.main(
        [
            "--queue", str(queue_path),
            "--artifact-root", str(artifact_root),
            "--i-authorize-live-collection",
        ],
        subprocess_runner=stub,
    )
    assert exit_code == 0
    # Re-load the queue and verify mutation.
    from src.voc.app.brand20_queue import load_queue
    queue = load_queue(queue_path)
    item = queue.require("A000000111111", "DATETIME_DESC")
    assert item.status == "done"
    assert item.last_attempt_at is not None
    assert item.attempts == 1


def test_cursor_429_stops_loop_but_queue_row_is_ready_for_operator_retry(
    queue_path: Path,
    patch_cdp_happy: dict[str, Any],
    tmp_path: Path,
    capsys: pytest.CaptureFixture,
) -> None:
    """I-OY-BRAND20-OPERATOR-RETRY-NO-COOLDOWN-GATE (formerly
    `test_retry_after_cooldown_stops_loop_even_with_max_items_3`).

    With --max-items-per-session 3 and a stubbed subprocess that
    writes a cursor-429 fixture on the FIRST call, the subprocess is
    called EXACTLY ONCE (session-global stop preserved). AFTER the
    stop, the queue row is left at `status=ready` with
    `next_run_after=None` so the operator can immediately re-select
    once the product tab recovers."""
    artifact_root = tmp_path / "artifacts"
    artifact_root.mkdir()
    # The "first call" stub returns a cursor-429 fixture; later stubs
    # would fail loudly if invoked. The runner must not advance.
    first_stub = _stub_subprocess_runner_writing_fixture(
        "batch_summary_retry_after_cooldown.json",
        artifact_root=artifact_root,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
    )

    def _trip(*_a, **_kw):
        raise AssertionError(
            "subprocess.run must not be called after a stop signal"
        )

    seq = _stub_subprocess_runner_sequence([first_stub, _trip, _trip])
    exit_code = cli.main(
        [
            "--queue", str(queue_path),
            "--artifact-root", str(artifact_root),
            "--i-authorize-live-collection",
            "--max-items-per-session", "3",
        ],
        subprocess_runner=seq,
    )
    assert exit_code == 1, "stop signal must produce exit code 1"
    assert seq.state["i"] == 1, (
        f"subprocess invoked {seq.state['i']} times; expected 1"
    )
    out = capsys.readouterr().out
    # Session stop signal still surfaced.
    assert "STOP" in out
    # Operator-retry context surfaced.
    assert "status=ready" in out
    assert "operator-retry command" in out or "operator_note" in out
    # The hint phrasing pinned.
    assert "Refresh the product tab" in out
    # Operator-retry command line printed verbatim (no `next_run_after`
    # tail, no `--allow-open-tab`).
    assert "scripts/run_brand20_queue_runner.py" in out
    assert "--i-authorize-live-collection" in out
    assert "--goods-no A000000111111" in out
    assert "--sort-type DATETIME_DESC" in out

    # And: the on-disk queue row is now `ready`, not
    # `retry_after_cooldown`. The operator may immediately re-select.
    from src.voc.app.brand20_queue import load_queue
    queue = load_queue(queue_path)
    item = queue.require("A000000111111", "DATETIME_DESC")
    assert item.status == "ready"
    assert item.next_run_after is None
    # Audit trail preserved.
    assert item.retry_intent == "retry_after_cooldown"
    assert item.operator_note is not None
    assert "cursor_api_rate_limited" in item.operator_note


def test_cursor_api_rate_limited_stops_loop(
    queue_path: Path,
    patch_cdp_happy: dict[str, Any],
    tmp_path: Path,
) -> None:
    """A batch_summary with `cursor_api_rate_limited=True` (but no
    retry_intent override) still stops the loop on the first call."""
    artifact_root = tmp_path / "artifacts"
    artifact_root.mkdir()
    # The retry_after_cooldown fixture carries cursor_api_rate_limited=True;
    # we reuse it here — both signals must stop the loop.
    first_stub = _stub_subprocess_runner_writing_fixture(
        "batch_summary_retry_after_cooldown.json",
        artifact_root=artifact_root,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
    )
    seq = _stub_subprocess_runner_sequence([
        first_stub,
        lambda *a, **kw: (_ for _ in ()).throw(
            AssertionError("must stop after rate-limit signal")),
    ])
    exit_code = cli.main(
        [
            "--queue", str(queue_path),
            "--artifact-root", str(artifact_root),
            "--i-authorize-live-collection",
            "--max-items-per-session", "2",
        ],
        subprocess_runner=seq,
    )
    assert exit_code == 1
    assert seq.state["i"] == 1


def test_cursor_api_silenced_stops_loop(
    queue_path: Path,
    patch_cdp_happy: dict[str, Any],
    tmp_path: Path,
    capsys: pytest.CaptureFixture,
) -> None:
    """`cursor_api_silenced=True` (cold-start AND-gate) stops the loop."""
    artifact_root = tmp_path / "artifacts"
    artifact_root.mkdir()
    first_stub = _stub_subprocess_runner_writing_fixture(
        "batch_summary_cursor_silenced.json",
        artifact_root=artifact_root,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
    )
    seq = _stub_subprocess_runner_sequence([
        first_stub,
        lambda *a, **kw: (_ for _ in ()).throw(
            AssertionError("must stop after cursor_api_silenced")),
    ])
    exit_code = cli.main(
        [
            "--queue", str(queue_path),
            "--artifact-root", str(artifact_root),
            "--i-authorize-live-collection",
            "--max-items-per-session", "2",
        ],
        subprocess_runner=seq,
    )
    assert exit_code == 1
    assert seq.state["i"] == 1
    out = capsys.readouterr().out
    assert "STOP" in out


def test_manual_checkpoint_stops_loop(
    queue_path: Path,
    patch_cdp_happy: dict[str, Any],
    tmp_path: Path,
    capsys: pytest.CaptureFixture,
) -> None:
    """`retry_intent=manual_review_required` lands as
    `manual_checkpoint`; runner stops and prints the certify command
    verbatim."""
    artifact_root = tmp_path / "artifacts"
    artifact_root.mkdir()
    first_stub = _stub_subprocess_runner_writing_fixture(
        "batch_summary_manual_checkpoint.json",
        artifact_root=artifact_root,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
    )
    seq = _stub_subprocess_runner_sequence([
        first_stub,
        lambda *a, **kw: (_ for _ in ()).throw(
            AssertionError("must stop after manual_checkpoint")),
    ])
    exit_code = cli.main(
        [
            "--queue", str(queue_path),
            "--artifact-root", str(artifact_root),
            "--i-authorize-live-collection",
            "--max-items-per-session", "3",
        ],
        subprocess_runner=seq,
    )
    assert exit_code == 1
    assert seq.state["i"] == 1
    out = capsys.readouterr().out
    assert "mark_brand20_checkpoint_certified.py" in out
    assert "manual_checkpoint" in out.lower() or "STOP" in out


def test_complete_continues_when_max_items_gt_1(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Three clean-`complete` fixtures in sequence: with
    --max-items-per-session 3, the stubbed subprocess is called
    exactly 3 times when the queue has 3 distinct runnable rows."""
    # Build a 3-SKU queue.
    rows: list[QueueItem] = []
    rows.extend(make_full_sort_set(goods_no="A000000111111", product_name="Brand-A"))
    rows.extend(make_full_sort_set(goods_no="A000000222222", product_name="Brand-B"))
    rows.extend(make_full_sort_set(goods_no="A000000333333", product_name="Brand-C"))
    queue = Brand20Queue(meta=QueueMeta(schema_version=1), items=rows)
    queue_p = tmp_path / "queue.json"
    save_queue(queue_p, queue)

    # CDP fixture: tabs for all three SKUs.
    def _list_tabs() -> list[dict]:
        return [
            {"id": s, "url": (
                "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?"
                f"goodsNo={s}&tab=review"
            )}
            for s in ("A000000111111", "A000000222222", "A000000333333")
        ]
    monkeypatch.setattr(cdp_probe, "get_version", lambda: {"Browser": "Chrome/123"})
    monkeypatch.setattr(cdp_probe, "list_tabs", _list_tabs)

    def _open_tab(*_a, **_kw) -> dict:
        raise AssertionError("open_tab must not be called when tabs are present")

    monkeypatch.setattr(cdp_probe, "open_tab", _open_tab)
    monkeypatch.setattr(precond, "_default_pgrep", lambda _cmd: [])

    artifact_root = tmp_path / "artifacts"
    artifact_root.mkdir()

    # Each call picks the lowest-goods_no still-runnable primary; the
    # stub writes a `complete` fixture rewritten to match the runner's
    # picked target. The stub re-derives the target from the
    # manifest's `products[0]`.
    def _make_dynamic_stub():
        def _runner(argv, *args, **kwargs):
            manifest_path = None
            artifact_root_arg = None
            for i, tok in enumerate(argv):
                if tok == "--manifest":
                    manifest_path = Path(argv[i + 1])
                elif tok == "--artifact-root":
                    artifact_root_arg = Path(argv[i + 1])
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            batch_id = manifest["batch_id"]
            target_goods_no = manifest["products"][0]["oy_goods_no"]
            target_sort = manifest["defaults"]["sort_type"]
            batch_dir = artifact_root_arg / batch_id
            batch_dir.mkdir(parents=True, exist_ok=True)
            payload = json.loads(
                (FIXTURE_DIR / "batch_summary_complete.json").read_text(
                    encoding="utf-8"),
            )
            for p in payload["products"]:
                p["oy_goods_no"] = target_goods_no
                p["summary"]["requested_sort_type"] = target_sort
                p["resume_state"]["goods_no"] = target_goods_no
                p["resume_state"]["sort_type"] = target_sort
            payload["manifest_audit"]["sort_type_in_defaults"] = target_sort
            (batch_dir / "batch_summary.json").write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            return CompletedProcess(args=argv, returncode=0, stdout=None, stderr=None)
        return _runner

    state = {"calls": 0}
    dyn = _make_dynamic_stub()

    def _counting(argv, *args, **kwargs):
        state["calls"] += 1
        return dyn(argv, *args, **kwargs)

    exit_code = cli.main(
        [
            "--queue", str(queue_p),
            "--artifact-root", str(artifact_root),
            "--i-authorize-live-collection",
            "--max-items-per-session", "3",
        ],
        subprocess_runner=_counting,
    )
    assert exit_code == 0
    assert state["calls"] == 3, (
        f"expected 3 subprocess calls, got {state['calls']}"
    )


def test_max_items_per_session_above_3_raises(
    queue_path: Path,
    capsys: pytest.CaptureFixture,
) -> None:
    """argparse rejects --max-items-per-session 4 (cap=3)."""
    with pytest.raises(SystemExit) as ei:
        cli.main([
            "--queue", str(queue_path),
            "--max-items-per-session", "4",
        ])
    # argparse exits with code 2 on argument errors.
    assert ei.value.code == 2
    err = capsys.readouterr().err
    assert "capped at 3" in err or "max-items-per-session" in err


def test_max_items_per_session_zero_or_negative_raises(
    queue_path: Path,
    capsys: pytest.CaptureFixture,
) -> None:
    """argparse rejects --max-items-per-session 0 and -1."""
    with pytest.raises(SystemExit):
        cli.main([
            "--queue", str(queue_path),
            "--max-items-per-session", "0",
        ])
    with pytest.raises(SystemExit):
        cli.main([
            "--queue", str(queue_path),
            "--max-items-per-session", "-1",
        ])


def test_dry_run_no_mutation_no_subprocess_no_open_tab(
    queue_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Triple guard for the --dry-run contract: no subprocess call,
    no queue mutation, no /json/new call (even with --allow-open-tab
    AND --i-authorize-live-collection AND a missing target tab)."""
    open_calls: list[str] = []

    def _list_tabs_no_target() -> list[dict]:
        return [{"id": "x", "url": "https://www.google.com/"}]

    monkeypatch.setattr(cdp_probe, "get_version", lambda: {"Browser": "Chrome/123"})
    monkeypatch.setattr(cdp_probe, "list_tabs", _list_tabs_no_target)

    def _open_tab(target_url: str, *_a, **_kw) -> dict:
        open_calls.append(target_url)
        return {"id": "new", "url": target_url}

    monkeypatch.setattr(cdp_probe, "open_tab", _open_tab)
    monkeypatch.setattr(precond, "_default_pgrep", lambda _cmd: [])

    queue_bytes_before = queue_path.read_bytes()

    def _stub_subprocess(*_a, **_kw):
        raise AssertionError("subprocess must not be called under --dry-run")

    # --dry-run is the dominant flag — even with auth + allow-open-tab,
    # nothing should fire.
    exit_code = cli.main(
        [
            "--queue", str(queue_path),
            "--dry-run",
            "--i-authorize-live-collection",
            "--allow-open-tab",
        ],
        subprocess_runner=_stub_subprocess,
    )
    # gate will still fail (target tab missing without effective auth)
    # but the test cares about the triple-no contract:
    assert open_calls == [], (
        f"open_tab must NOT be called under --dry-run; saw {open_calls!r}"
    )
    # Queue file unchanged.
    assert queue_path.read_bytes() == queue_bytes_before
    # exit code: gate will fail because dry-run suppresses the open
    # action and no target tab matches → exit 2 (precondition failure).
    # If the gate passes (e.g. operator passed a queue with a matching
    # tab already), --dry-run exits 0. Both are acceptable; the
    # triple-no contract is the actual assertion.
    assert exit_code in (0, 2)
    _ = shutil  # silence linter when shutil unused


# ===========================================================================
# I-OY-BRAND20-RUNNER-MAX-CAP-AND-STATUS-MAPPING-FIX
# ===========================================================================
#
# Three regressions surfaced by the operator's live smoke against
# A000000107679 / DATETIME_DESC:
#   (1) CLI printed phase-A literals even when live collection ran.
#   (2) Primary DATETIME_DESC was capped at 200 by the connector's
#       BatchDefaults default, producing artificial max_cap_reached.
#   (3) max_cap_reached + final_status=ok was routed to inconclusive.
#
# Each regression has at least one CLI-level test below; the queue-
# layer mapping fix has its own tests in test_brand20_queue.py.


def test_live_mode_does_not_print_phase_a_label(
    queue_path: Path,
    patch_cdp_happy: dict[str, Any],
    tmp_path: Path,
    capsys: pytest.CaptureFixture,
) -> None:
    """With --i-authorize-live-collection AND a patched subprocess
    returning a clean-`complete` fixture, the runner's stdout MUST
    NOT contain the literal 'phase A' or 'No live collection
    launched'. The plan-block header reads "live collection plan"
    instead. (Req §1)"""
    artifact_root = tmp_path / "artifacts"
    artifact_root.mkdir()
    stub = _stub_subprocess_runner_writing_fixture(
        "batch_summary_complete.json",
        artifact_root=artifact_root,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
    )
    exit_code = cli.main(
        [
            "--queue", str(queue_path),
            "--artifact-root", str(artifact_root),
            "--i-authorize-live-collection",
        ],
        subprocess_runner=stub,
    )
    assert exit_code == 0
    out = capsys.readouterr().out
    # Forbidden literals — the runner is no longer phase A.
    assert "phase A" not in out
    assert "No live collection launched" not in out
    # Required live-mode header.
    assert "Brand-20 runner — live collection plan" in out


def test_dry_run_does_not_print_phase_a_label(
    queue_path: Path,
    patch_cdp_happy: dict[str, Any],
    capsys: pytest.CaptureFixture,
) -> None:
    """The dry-run / no-auth path also drops the phase-A literal.
    The header reads "plan-only block" and the trailing note refers
    to a plan-only invocation, not a phase. (Req §1)"""
    # No --i-authorize-live-collection — default plan-only path.
    exit_code = cli.main([
        "--queue", str(queue_path),
    ])
    assert exit_code == 0
    out = capsys.readouterr().out
    assert "phase A" not in out
    assert "No live collection launched" not in out
    assert "Brand-20 runner — plan-only block" in out


def test_primary_datetime_desc_command_max_is_not_200(
    queue_path: Path,
    patch_cdp_happy: dict[str, Any],
    tmp_path: Path,
) -> None:
    """With --i-authorize-live-collection and a patched subprocess,
    capture the argv passed to the collection child. For a
    DATETIME_DESC primary row, the manifest the runner writes must
    pin `defaults.max_reviews` to BRAND20_PRIMARY_MAX (>= 5000), NOT
    the connector's tuned-for-sampling default of 200. (Req §2)

    We assert on the on-disk manifest the subprocess stub reads,
    because the child argv itself only carries `--manifest <path>`
    and `--artifact-root <path>` — the cap lives in the manifest
    body."""
    from src.voc.app.brand20_runner_core import (
        BRAND20_PRIMARY_MAX,
    )

    artifact_root = tmp_path / "artifacts"
    artifact_root.mkdir()
    captured: dict[str, Any] = {"manifest": None}

    base_stub = _stub_subprocess_runner_writing_fixture(
        "batch_summary_complete.json",
        artifact_root=artifact_root,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
    )

    def _wrapper(argv, *args, **kwargs):
        for i, tok in enumerate(argv):
            if tok == "--manifest" and i + 1 < len(argv):
                captured["manifest"] = json.loads(
                    Path(argv[i + 1]).read_text(encoding="utf-8"),
                )
        return base_stub(argv, *args, **kwargs)

    exit_code = cli.main(
        [
            "--queue", str(queue_path),
            "--artifact-root", str(artifact_root),
            "--i-authorize-live-collection",
        ],
        subprocess_runner=_wrapper,
    )
    assert exit_code == 0
    assert captured["manifest"] is not None
    max_reviews = captured["manifest"]["defaults"].get("max_reviews")
    assert max_reviews == BRAND20_PRIMARY_MAX
    assert max_reviews >= 5000, (
        f"primary DATETIME_DESC max_reviews={max_reviews} is too small; "
        f"the prior 200 cap produced artificial max_cap_reached."
    )
    assert max_reviews != 200, (
        "primary DATETIME_DESC max_reviews must NOT inherit the "
        "200-row sampling default"
    )


def test_signal_sort_command_max_is_bounded(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A signal-sort queue row (RATING_ASC) carries
    BRAND20_SIGNAL_MAX in the manifest defaults — a small cap that
    keeps the session-429 budget intact across the four signal
    passes. (Req §3)

    To force the runner to pick a signal-sort row, we mark the SKU's
    primary as `done` so `pick_next_runnable` advances to RATING_ASC.
    """
    from src.voc.app.brand20_runner_core import (
        BRAND20_SIGNAL_MAX,
    )

    rows: list[QueueItem] = []
    rows.extend(make_full_sort_set(goods_no="A000000111111", product_name="Brand-A"))
    # Mark the primary done so the picker advances to the signal sort.
    for it in rows:
        if it.sort_type == "DATETIME_DESC":
            it.status = "done"
    queue = Brand20Queue(meta=QueueMeta(schema_version=1), items=rows)
    queue_p = tmp_path / "queue.json"
    save_queue(queue_p, queue)

    monkeypatch.setattr(cdp_probe, "get_version", lambda: {"Browser": "Chrome/123"})
    monkeypatch.setattr(
        cdp_probe, "list_tabs", lambda: [{
            "id": "a",
            "url": (
                "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?"
                "goodsNo=A000000111111&tab=review"
            ),
        }],
    )
    monkeypatch.setattr(cdp_probe, "open_tab", lambda *a, **kw: (_ for _ in ()).throw(
        AssertionError("must not open tab")))
    monkeypatch.setattr(precond, "_default_pgrep", lambda _cmd: [])

    artifact_root = tmp_path / "artifacts"
    artifact_root.mkdir()
    captured: dict[str, Any] = {"manifest": None}

    base_stub = _stub_subprocess_runner_writing_fixture(
        "batch_summary_complete.json",
        artifact_root=artifact_root,
        goods_no="A000000111111",
        sort_type="RATING_ASC",
    )

    def _wrapper(argv, *args, **kwargs):
        for i, tok in enumerate(argv):
            if tok == "--manifest" and i + 1 < len(argv):
                captured["manifest"] = json.loads(
                    Path(argv[i + 1]).read_text(encoding="utf-8"),
                )
        return base_stub(argv, *args, **kwargs)

    exit_code = cli.main(
        [
            "--queue", str(queue_p),
            "--artifact-root", str(artifact_root),
            "--i-authorize-live-collection",
        ],
        subprocess_runner=_wrapper,
    )
    assert exit_code == 0
    assert captured["manifest"] is not None
    assert captured["manifest"]["defaults"]["sort_type"] == "RATING_ASC"
    assert captured["manifest"]["defaults"]["max_reviews"] == BRAND20_SIGNAL_MAX


def test_dry_run_remains_no_subprocess_no_mutation(
    queue_path: Path,
    patch_cdp_happy: dict[str, Any],
) -> None:
    """Regression guard: the phase-B --dry-run contract (no
    subprocess, no queue mutation) is preserved across this ticket's
    edits. (Req §6 keep)"""
    queue_bytes_before = queue_path.read_bytes()

    def _stub(*_a, **_kw):
        raise AssertionError("subprocess must not run under --dry-run")

    exit_code = cli.main(
        [
            "--queue", str(queue_path),
            "--dry-run",
            "--i-authorize-live-collection",
        ],
        subprocess_runner=_stub,
    )
    assert exit_code == 0
    assert queue_path.read_bytes() == queue_bytes_before


def test_primary_max_cap_reached_prints_partial_message(
    queue_path: Path,
    patch_cdp_happy: dict[str, Any],
    tmp_path: Path,
    capsys: pytest.CaptureFixture,
) -> None:
    """A primary DATETIME_DESC batch_summary with `status=max_cap_reached`
    AND `quality_status=ok` must surface a PARTIAL line plus the
    resume command verbatim, and the runner must exit 0 (not 1). The
    queue row lands on `ready` (NOT `inconclusive`). (Req §4 + §5)"""
    artifact_root = tmp_path / "artifacts"
    artifact_root.mkdir()
    stub = _stub_subprocess_runner_writing_fixture(
        "batch_summary_max_cap_reached.json",
        artifact_root=artifact_root,
        goods_no="A000000111111",
        sort_type="DATETIME_DESC",
    )
    exit_code = cli.main(
        [
            "--queue", str(queue_path),
            "--artifact-root", str(artifact_root),
            "--i-authorize-live-collection",
        ],
        subprocess_runner=stub,
    )
    # NOT an error; the operator chose to extend coverage by re-running.
    assert exit_code == 0
    out = capsys.readouterr().out
    # PARTIAL line is the contract literal.
    assert "PARTIAL:" in out
    # Resume command line printed verbatim with same (goods_no, sort_type).
    assert "scripts/run_brand20_queue_runner.py" in out
    assert "--goods-no A000000111111" in out
    assert "--sort-type DATETIME_DESC" in out
    assert "--i-authorize-live-collection" in out
    # The queue row is NOT inconclusive (it is `ready`, per
    # brand20_queue._decide_status fix).
    from src.voc.app.brand20_queue import load_queue
    queue = load_queue(queue_path)
    item = queue.require("A000000111111", "DATETIME_DESC")
    assert item.status == "ready"
    assert item.status != "inconclusive"
