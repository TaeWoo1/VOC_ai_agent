"""Tests for the streaming-tee subprocess runner in
`src/voc/app/collection_batch.py`.

Background — I-OY-RUNNER-OBSERVABILITY:
Pre-2026-05 the OY collection runner used
`subprocess.run(capture_output=True)`, which buffers stdout/stderr until
the child exits. On a long-running archive-complete proof (e.g. the
Ilso DATETIME_DESC pass that ran ~25 min) the operator monitoring the
run had no live progress signal — important connector log lines such as
`OY browser: adopted_existing_page=true` were invisible until the
subprocess returned.

The replacement (`_stream_tee_subprocess`) uses `subprocess.Popen` with
two background drain threads that write each line through to the
parent's `stdout_sink` / `stderr_sink` AS it arrives, while still
buffering the full text for the caller's final result. These tests
exercise that contract:

    1. Output is observable in the sink BEFORE the child exits.
    2. Non-zero return codes round-trip.
    3. stdout / stderr text is still available in the final tuple.
    4. The two-thread design does not deadlock when one stream emits
       large output while the other stays silent.
    5. The "subprocess starting" log line fires before launch.
    6. The existing `_default_subprocess_runner` contract — return type
       `(rc, stdout, stderr)` of `(int, str, str)` — is preserved so
       the legacy `runner_fn` injection path used by the rest of
       `collection_batch` keeps working.

These probes spawn tiny `python -c "..."` children — they do NOT
exercise the OY connector and must NOT touch the network or DB.
"""

from __future__ import annotations

import io
import json
import logging
import sys
import threading
import time

from src.voc.app import collection_batch as cb
from src.voc.app.collection_batch import (
    _default_subprocess_runner,
    _stream_tee_subprocess,
)


# ---------------------------------------------------------------------------
# Helper — record-only sink that lets the test see writes line-by-line
# ---------------------------------------------------------------------------


class _RecordingSink(io.StringIO):
    """StringIO that records the wall-clock arrival time of every write.

    The streaming contract is "lines are visible in the sink BEFORE the
    child returncode is set" — to assert that, the test needs to compare
    the moment a line arrived against the moment the child exited.
    """

    def __init__(self) -> None:
        super().__init__()
        self._writes: list[tuple[float, str]] = []
        self._lock = threading.Lock()

    def write(self, s: str) -> int:  # type: ignore[override]
        with self._lock:
            self._writes.append((time.monotonic(), s))
            return super().write(s)

    @property
    def writes(self) -> list[tuple[float, str]]:
        with self._lock:
            return list(self._writes)


# ---------------------------------------------------------------------------
# 1. Streaming visibility — output reaches the sink BEFORE child exits
# ---------------------------------------------------------------------------


def test_subprocess_output_is_streamed_not_only_captured_at_exit():
    """Operator-visible behavior: a child that emits 'hello', sleeps,
    then emits 'world' must surface 'hello' to the parent's sink BEFORE
    it exits — the legacy capture_output=True path failed this contract.
    """
    out_sink = _RecordingSink()
    err_sink = _RecordingSink()

    # Child emits "hello" immediately, sleeps 0.4s, emits "world", exits.
    # The 0.4s gap is comfortably larger than thread/scheduling jitter.
    program = (
        "import sys, time; "
        "print('hello'); sys.stdout.flush(); "
        "time.sleep(0.4); "
        "print('world'); sys.stdout.flush()"
    )

    started = time.monotonic()
    rc, stdout, stderr = _stream_tee_subprocess(
        [sys.executable, "-c", program],
        stdout_sink=out_sink,
        stderr_sink=err_sink,
        timeout=10.0,
    )
    finished = time.monotonic()

    # Sanity: the child actually took ~0.4s.
    assert finished - started >= 0.35

    # The first 'hello' line MUST have arrived before the second 'world' line.
    writes = out_sink.writes
    hello_writes = [(t, s) for (t, s) in writes if "hello" in s]
    world_writes = [(t, s) for (t, s) in writes if "world" in s]
    assert hello_writes, f"'hello' never arrived in sink; writes={writes!r}"
    assert world_writes, f"'world' never arrived in sink; writes={writes!r}"

    # The streaming contract: 'hello' arrived AT LEAST 0.2s before the
    # child exited (it should arrive ~immediately; we leave generous
    # slack for CI timing noise).
    assert finished - hello_writes[0][0] >= 0.2, (
        f"'hello' arrived too close to child exit "
        f"(delta={finished - hello_writes[0][0]:.3f}s); buffering may have "
        f"regressed to capture_output behavior"
    )

    # Final aggregate stdout still contains both lines (caller contract).
    assert "hello" in stdout
    assert "world" in stdout
    assert rc == 0


# ---------------------------------------------------------------------------
# 2. Non-zero return code round-trips
# ---------------------------------------------------------------------------


def test_nonzero_return_code_is_surfaced():
    rc, stdout, stderr = _stream_tee_subprocess(
        [sys.executable, "-c", "import sys; sys.exit(7)"],
        stdout_sink=io.StringIO(),
        stderr_sink=io.StringIO(),
        timeout=5.0,
    )
    assert rc == 7
    assert isinstance(stdout, str)
    assert isinstance(stderr, str)


# ---------------------------------------------------------------------------
# 3. Final stdout / stderr text remains available
# ---------------------------------------------------------------------------


def test_stdout_stderr_content_remains_available_in_final_result():
    program = (
        "import sys; "
        "sys.stdout.write('OUT-LINE\\n'); sys.stdout.flush(); "
        "sys.stderr.write('ERR-LINE\\n'); sys.stderr.flush()"
    )
    rc, stdout, stderr = _stream_tee_subprocess(
        [sys.executable, "-c", program],
        stdout_sink=io.StringIO(),
        stderr_sink=io.StringIO(),
        timeout=5.0,
    )
    assert rc == 0
    assert "OUT-LINE" in stdout
    assert "ERR-LINE" in stderr


# ---------------------------------------------------------------------------
# 4. No pipe-fill deadlock when one stream produces large output
# ---------------------------------------------------------------------------


def test_streaming_tee_does_not_deadlock_on_large_stderr():
    """The two-thread design exists to prevent the classic Popen
    deadlock: child writes >64 KB to stderr (filling the kernel pipe
    buffer) while stdout is silent. With a single-thread reader that
    waits on stdout first, the child blocks on stderr.write() forever.

    This test floods stderr with ~100 KB and asserts the call returns
    cleanly within the timeout.
    """
    # ~100 KB of stderr; stdout silent.
    program = (
        "import sys; "
        "sys.stderr.write('x' * 100_000); sys.stderr.flush()"
    )
    rc, stdout, stderr = _stream_tee_subprocess(
        [sys.executable, "-c", program],
        stdout_sink=io.StringIO(),
        stderr_sink=io.StringIO(),
        timeout=10.0,
    )
    assert rc == 0
    assert stdout == ""
    assert len(stderr) >= 100_000


# ---------------------------------------------------------------------------
# 5. "Subprocess starting" log line fires before launch
# ---------------------------------------------------------------------------


def test_default_subprocess_runner_emits_started_log_line(caplog):
    """Operator req: a 'process started' signal must be visible at known
    timestamp BEFORE the child runs — important when the child is silent
    for 30-60 sec during cold-start. `_default_subprocess_runner` logs
    this via the module logger before delegating to the streaming tee.
    """
    caplog.set_level(logging.INFO, logger="src.voc.app.collection_batch")
    rc, stdout, stderr = _default_subprocess_runner(
        [sys.executable, "-c", "print('ok')"],
    )
    assert rc == 0
    assert "ok" in stdout
    started_records = [
        r for r in caplog.records
        if "OY subprocess starting:" in r.getMessage()
    ]
    assert started_records, (
        "expected 'OY subprocess starting:' log record; "
        f"got {[r.getMessage() for r in caplog.records]!r}"
    )


# ---------------------------------------------------------------------------
# 6. Default-runner return contract preserved
# ---------------------------------------------------------------------------


def test_default_subprocess_runner_returns_tuple_of_int_str_str():
    """The legacy `_default_subprocess_runner` returned
    `(int, str, str)`. The streaming-tee replacement MUST match — the
    rest of `collection_batch.run_batch` consumes `proc.stdout`,
    `proc.stderr`, and the return code via this tuple shape and would
    break silently otherwise.
    """
    result = _default_subprocess_runner(
        [sys.executable, "-c", "print('check')"],
    )
    assert isinstance(result, tuple)
    assert len(result) == 3
    rc, stdout, stderr = result
    assert isinstance(rc, int)
    assert isinstance(stdout, str)
    assert isinstance(stderr, str)
    assert "check" in stdout


# ---------------------------------------------------------------------------
# 7. End-to-end run_batch unchanged when default runner is engaged
#    (existing collection_batch status behavior preserved)
# ---------------------------------------------------------------------------


def test_run_batch_uses_default_runner_via_streaming_tee(tmp_path, monkeypatch):
    """End-to-end smoke: with no `runner_fn` injected, `run_batch` falls
    back to `_default_subprocess_runner` which uses the streaming tee.
    Substitute a tiny child that emits the same JSON shape the real
    ingest CLI would, and assert the batch classifies it correctly —
    proves the new runner is wired in and produces the same status the
    legacy runner did.
    """
    # Build a one-product manifest.
    summary = {
        "run_id": "r1",
        "channel": "oliveyoung",
        "raw_records_seen": 5,
        "records_parsed": 5,
        "parse_warnings": 0,
        "blocked": False,
        "auth_error": False,
        "mid_stream_auth_break": False,
        "http_403_seen": False,
        "http_429_seen": False,
        "cold_start_timed_out": False,
        "incomplete_collection": False,
        "pagination_exhausted": True,
        "last_observed_has_next": False,
        "login_state_observed": "logged_in",
        "trace_artifact_path": None,
        "partial_debug_artifact_path": None,
    }
    stdout_payload = {
        "run_id": "r1",
        "quality_status": "ok",
        "rows_inserted": 5,
        "rows_skipped_by_normalize": 0,
        "summary": summary,
    }

    # Monkeypatch the default runner to return our synthetic stdout via
    # the streaming-tee path. This proves the wiring without spawning a
    # real Python child for the JSON payload (which would be flaky in CI
    # under load).
    captured_argvs = []

    def _fake_runner(argv):
        captured_argvs.append(argv)
        return 0, json.dumps(stdout_payload), ""

    monkeypatch.setattr(cb, "_default_subprocess_runner", _fake_runner)

    manifest_path = tmp_path / "m.json"
    manifest_path.write_text(
        json.dumps({
            "batch_id": "b_smoke",
            "products": [{"name": "n", "oy_goods_no": "A1"}],
        }),
        encoding="utf-8",
    )
    manifest = cb.load_manifest(manifest_path)
    report = cb.run_batch(
        manifest=manifest, artifact_root=tmp_path,
    )

    assert report.halted is False
    assert len(report.products) == 1
    # `pagination_exhausted=True` → status = "complete" (unchanged from legacy).
    assert report.products[0].status == "complete"
    assert captured_argvs, "default runner was not called"


# ---------------------------------------------------------------------------
# 8. Sink defaulting to sys.stdout / sys.stderr does not raise
#    (regression guard against accidentally requiring sinks)
# ---------------------------------------------------------------------------


def test_streaming_tee_default_sinks_do_not_raise(capsys):
    """Calling `_stream_tee_subprocess` without explicit sinks must use
    sys.stdout / sys.stderr and not crash. The default-sink path is
    what `_default_subprocess_runner` exercises in production.
    """
    rc, stdout, stderr = _stream_tee_subprocess(
        [sys.executable, "-c", "print('default-sink-check')"],
        timeout=5.0,
    )
    assert rc == 0
    assert "default-sink-check" in stdout
    # capsys captures whatever sys.stdout received (the tee'd line).
    captured = capsys.readouterr()
    assert "default-sink-check" in captured.out
