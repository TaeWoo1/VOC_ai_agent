"""Tests for the strict-mode + retry-queue paths in
`scripts/run_phase2e_pipeline.py:run_multi_sort_scrape`.

Loads the script as a module (it lives outside the package tree) and
monkeypatches `_run_one_sort_attempt` to produce scripted outcomes.
The real subprocess invocation is never exercised — these tests
isolate the orchestrator logic.
"""
from __future__ import annotations

import importlib.util
import json
import sys
import time
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def rpp():
    sys.path.insert(0, str(REPO))
    spec = importlib.util.spec_from_file_location(
        "rpp", REPO / "scripts" / "run_phase2e_pipeline.py",
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _ok(rows: int = 10, status: str = "authenticated_ok") -> dict:
    return {
        "sort_type": None,
        "max_reviews_arg": "100",
        "summary": {},
        "rows_inserted": rows,
        "raw_records_seen": rows,
        "status": status,
        "quality_status": "ok",
        "prod_summary": {},
        "artifact_root": "/tmp/x",
    }


def _fail(status: str = "anti_bot") -> dict:
    return {
        "sort_type": None,
        "max_reviews_arg": "100",
        "summary": None,
        "rows_inserted": 0,
        "raw_records_seen": 0,
        "status": status,
        "quality_status": "blocked",
        "prod_summary": None,
        "artifact_root": None,
    }


# ---------------------------------------------------------------------------
# Strict mode
# ---------------------------------------------------------------------------


class TestStrictMode:
    def test_retries_until_recovery(self, rpp, monkeypatch, tmp_path):
        """Two failures then success → strict loop continues past
        every failure and only stops when a non-failure arrives."""
        # Per-sort outcome script: every sort fails twice then succeeds.
        per_sort_calls: dict[str, int] = {}

        def _fake(*, goods_no, product_name, sort_type, cap, suffix, **kw):
            per_sort_calls.setdefault(sort_type, 0)
            per_sort_calls[sort_type] += 1
            n = per_sort_calls[sort_type]
            if n <= 2:
                r = _fail("anti_bot")
            else:
                r = _ok(rows=10)
            r["sort_type"] = sort_type
            return r

        monkeypatch.setattr(rpp, "_run_one_sort_attempt", _fake)
        # Skip jitters in tests.
        monkeypatch.setattr(rpp.time, "sleep", lambda *_a, **_k: None)
        monkeypatch.setattr(rpp.random, "uniform", lambda *_a, **_k: 0.0)

        queue_path = tmp_path / "queue.json"
        summaries = rpp.run_multi_sort_scrape(
            "A0001", "Test Product",
            wait_until_sort_loaded=True,
            retry_queue_path=queue_path,
            product_url="https://example.com/?goodsNo=A0001",
        )

        # Every sort succeeded after 3 attempts.
        assert len(summaries) == len(rpp.MULTI_SORT_PLAN)
        for s in summaries:
            assert s["rows_inserted"] == 10
            assert s["attempts"] == 3
            assert s.get("strict_recovered") is True
        # Strict mode must NEVER write to the retry queue.
        assert not queue_path.exists()

    def test_keyboard_interrupt_during_attempt_propagates(
        self, rpp, monkeypatch, tmp_path,
    ):
        """Ctrl+C during a strict-mode subprocess attempt must
        propagate out of run_multi_sort_scrape without partial
        queue writes."""
        def _fake(*_a, **_k):
            raise KeyboardInterrupt()

        monkeypatch.setattr(rpp, "_run_one_sort_attempt", _fake)
        monkeypatch.setattr(rpp.time, "sleep", lambda *_a, **_k: None)
        monkeypatch.setattr(rpp.random, "uniform", lambda *_a, **_k: 0.0)

        queue_path = tmp_path / "queue.json"
        with pytest.raises(KeyboardInterrupt):
            rpp.run_multi_sort_scrape(
                "A0001", "Test Product",
                wait_until_sort_loaded=True,
                retry_queue_path=queue_path,
                product_url="https://example.com/?goodsNo=A0001",
            )
        assert not queue_path.exists()

    def test_keyboard_interrupt_during_inter_attempt_sleep(
        self, rpp, monkeypatch, tmp_path,
    ):
        """Ctrl+C arriving during the jitter sleep between strict
        retries also propagates cleanly (covers the second except
        block)."""
        per_sort_calls = {"counter": 0}

        def _fake(*, sort_type, **_k):
            per_sort_calls["counter"] += 1
            return {**_fail(), "sort_type": sort_type}

        def _kbi_sleep(*_a, **_k):
            raise KeyboardInterrupt()

        monkeypatch.setattr(rpp, "_run_one_sort_attempt", _fake)
        monkeypatch.setattr(rpp.time, "sleep", _kbi_sleep)
        monkeypatch.setattr(rpp.random, "uniform", lambda *_a, **_k: 0.0)

        queue_path = tmp_path / "queue.json"
        with pytest.raises(KeyboardInterrupt):
            rpp.run_multi_sort_scrape(
                "A0001", "Test Product",
                wait_until_sort_loaded=True,
                retry_queue_path=queue_path,
                product_url="https://example.com/?goodsNo=A0001",
            )
        assert not queue_path.exists()
        # Exactly one attempt fired before sleep raised.
        assert per_sort_calls["counter"] == 1

    def test_strict_passes_zero_human_check_timeout(
        self, rpp, monkeypatch, tmp_path,
    ):
        """Strict mode must force human_check_timeout=0 regardless
        of what the caller passed in."""
        captured: list[int] = []

        def _fake(*, sort_type, human_check_timeout_seconds, **_k):
            captured.append(human_check_timeout_seconds)
            return {**_ok(), "sort_type": sort_type}

        monkeypatch.setattr(rpp, "_run_one_sort_attempt", _fake)
        monkeypatch.setattr(rpp.time, "sleep", lambda *_a, **_k: None)
        monkeypatch.setattr(rpp.random, "uniform", lambda *_a, **_k: 0.0)

        rpp.run_multi_sort_scrape(
            "A0001", "Test Product",
            wait_until_sort_loaded=True,
            human_check_timeout_seconds=600,  # caller value — should be overridden
            retry_queue_path=tmp_path / "queue.json",
            product_url="https://example.com/?goodsNo=A0001",
        )
        assert all(t == 0 for t in captured), captured


# ---------------------------------------------------------------------------
# Strict-mode adaptive backoff
# ---------------------------------------------------------------------------


class TestStrictBackoff:
    """Default profile is conservative — strict-mode retries must
    pull their wait band from `strict_backoff.strict_backoff_band`,
    not from the legacy 3–6s `_MULTI_SORT_RETRY_JITTER_RANGE_S`."""

    def test_default_profile_calls_into_backoff_helper(
        self, rpp, monkeypatch,
    ):
        """When a sort fails once and recovers, the wait band on the
        first retry must come from `strict_backoff_band(attempt=1,
        profile="conservative", failure_reason="anti_bot")` — i.e.
        the anti_bot floor of 900s, not the legacy 3–6s jitter."""
        from src.voc.app import strict_backoff

        seen_bands: list[tuple[float, float]] = []

        # Fail with anti_bot once, then succeed.
        outcomes = [
            {**_fail("anti_bot"), "sort_type": None},
            {**_ok(), "sort_type": None},
        ]
        # Use a single-sort plan so we don't need 5 outcomes per slot.
        monkeypatch.setattr(rpp, "MULTI_SORT_PLAN", [
            {"sort_type": "DATETIME_DESC", "cap": "100", "role": "primary"},
        ])

        def _fake(*, sort_type, **_k):
            r = dict(outcomes.pop(0))
            r["sort_type"] = sort_type
            return r

        original = strict_backoff.strict_backoff_band

        def _spy(*args, **kwargs):
            band = original(*args, **kwargs)
            seen_bands.append(band)
            return band

        monkeypatch.setattr(strict_backoff, "strict_backoff_band", _spy)
        monkeypatch.setattr(rpp, "_run_one_sort_attempt", _fake)
        monkeypatch.setattr(rpp.time, "sleep", lambda *_a, **_k: None)
        monkeypatch.setattr(rpp.random, "uniform", lambda *_a, **_k: 0.0)

        rpp.run_multi_sort_scrape(
            "A0001", "Test Product",
            wait_until_sort_loaded=True,
            product_url="https://example.com/?goodsNo=A0001",
            retry_queue_path=None,
        )
        assert seen_bands, "strict_backoff_band was never called"
        # First (and only) retry: attempt=1 conservative anti_bot →
        # floor 900 should override the 45-90 conservative band.
        first_lo, first_hi = seen_bands[0]
        assert first_lo >= 900.0, (first_lo, first_hi)
        assert first_hi >= 900.0, (first_lo, first_hi)

    def test_fast_profile_bypasses_anti_bot_floor_overrides_only_when_band_already_higher(
        self, rpp, monkeypatch,
    ):
        """`fast` profile bands are tiny (3-6s) — anti_bot floor of
        900s still applies, so the actual wait band is anti-bot
        floor, not 3-6s. Defends against an operator picking `fast`
        and accidentally hammering OY."""
        from src.voc.app import strict_backoff

        seen_bands: list[tuple[float, float]] = []
        outcomes = [
            {**_fail("anti_bot"), "sort_type": None},
            {**_ok(), "sort_type": None},
        ]
        monkeypatch.setattr(rpp, "MULTI_SORT_PLAN", [
            {"sort_type": "X", "cap": "100", "role": "primary"},
        ])

        def _fake(*, sort_type, **_k):
            r = dict(outcomes.pop(0))
            r["sort_type"] = sort_type
            return r

        orig = strict_backoff.strict_backoff_band

        def _spy(*args, **kwargs):
            b = orig(*args, **kwargs)
            seen_bands.append(b)
            return b

        monkeypatch.setattr(strict_backoff, "strict_backoff_band", _spy)
        monkeypatch.setattr(rpp, "_run_one_sort_attempt", _fake)
        monkeypatch.setattr(rpp.time, "sleep", lambda *_a, **_k: None)
        monkeypatch.setattr(rpp.random, "uniform", lambda *_a, **_k: 0.0)

        rpp.run_multi_sort_scrape(
            "A0001", "Test Product",
            wait_until_sort_loaded=True,
            strict_retry_backoff_profile="fast",
            product_url="https://example.com/?goodsNo=A0001",
        )
        assert seen_bands
        lo, hi = seen_bands[0]
        # Fast profile baseline (3-6) but anti_bot floor still wins.
        assert lo >= 900.0


# ---------------------------------------------------------------------------
# Strict mode — max-attempts cap
# ---------------------------------------------------------------------------


class TestStrictMaxAttempts:
    def test_caps_at_max_attempts(self, rpp, monkeypatch):
        """With max=3, a perpetually-failing sort makes exactly 3
        attempts, then surfaces a giveup result and moves on."""
        monkeypatch.setattr(rpp, "MULTI_SORT_PLAN", [
            {"sort_type": "X", "cap": "100", "role": "primary"},
        ])
        per_sort_calls = {"counter": 0}

        def _fake(*, sort_type, **_k):
            per_sort_calls["counter"] += 1
            r = _fail("anti_bot")
            r["sort_type"] = sort_type
            return r

        monkeypatch.setattr(rpp, "_run_one_sort_attempt", _fake)
        monkeypatch.setattr(rpp.time, "sleep", lambda *_a, **_k: None)
        monkeypatch.setattr(rpp.random, "uniform", lambda *_a, **_k: 0.0)

        summaries = rpp.run_multi_sort_scrape(
            "A0001", "Test Product",
            wait_until_sort_loaded=True,
            strict_max_attempts=3,
            product_url="https://example.com/?goodsNo=A0001",
        )
        assert per_sort_calls["counter"] == 3
        assert len(summaries) == 1
        assert summaries[0]["attempts"] == 3
        assert summaries[0].get("strict_recovered") is False
        assert "strict_giveup_reason" in summaries[0]

    def test_max_attempts_zero_keeps_infinite_contract(self, rpp, monkeypatch):
        """max=0 → loop until success. Verified by injecting a
        success at attempt 4."""
        monkeypatch.setattr(rpp, "MULTI_SORT_PLAN", [
            {"sort_type": "X", "cap": "100", "role": "primary"},
        ])
        outcomes = [_fail("anti_bot")] * 3 + [_ok()]
        per_sort_calls = {"counter": 0}

        def _fake(*, sort_type, **_k):
            per_sort_calls["counter"] += 1
            r = dict(outcomes.pop(0))
            r["sort_type"] = sort_type
            return r

        monkeypatch.setattr(rpp, "_run_one_sort_attempt", _fake)
        monkeypatch.setattr(rpp.time, "sleep", lambda *_a, **_k: None)
        monkeypatch.setattr(rpp.random, "uniform", lambda *_a, **_k: 0.0)

        summaries = rpp.run_multi_sort_scrape(
            "A0001", "Test Product",
            wait_until_sort_loaded=True,
            strict_max_attempts=0,
            product_url="https://example.com/?goodsNo=A0001",
        )
        assert per_sort_calls["counter"] == 4
        assert summaries[0].get("strict_recovered") is True
        assert summaries[0]["attempts"] == 4


# ---------------------------------------------------------------------------
# Strict mode — confirm-before-retry
# ---------------------------------------------------------------------------


class TestStrictResetSessionOnBlock:
    """`--strict-reset-session-on-block` injects
    `force_fresh_context=True` into the NEXT subprocess attempt
    after a sticky failure. The flag is opt-in; default behavior
    is unchanged."""

    def _capture_force_fresh(self, rpp, monkeypatch):
        """Return a list that grows once per attempt with the value
        of `force_fresh_context` the orchestrator passed in."""
        captured: list[bool] = []

        def _fake_factory(outcomes_iter):
            def _fake(*, sort_type, force_fresh_context=False, **_k):
                captured.append(bool(force_fresh_context))
                r = dict(next(outcomes_iter))
                r["sort_type"] = sort_type
                return r
            return _fake

        return captured, _fake_factory

    def test_anti_bot_failure_triggers_reset_on_next_attempt(
        self, rpp, monkeypatch,
    ):
        monkeypatch.setattr(rpp, "MULTI_SORT_PLAN", [
            {"sort_type": "X", "cap": "100", "role": "primary"},
        ])
        outcomes = iter([
            _fail("anti_bot"),  # attempt 1
            _ok(),              # attempt 2 — should run with fresh context
        ])
        captured, factory = self._capture_force_fresh(rpp, monkeypatch)
        monkeypatch.setattr(rpp, "_run_one_sort_attempt", factory(outcomes))
        monkeypatch.setattr(rpp.time, "sleep", lambda *_a, **_k: None)
        monkeypatch.setattr(rpp.random, "uniform", lambda *_a, **_k: 0.0)

        rpp.run_multi_sort_scrape(
            "A0001", "Test Product",
            wait_until_sort_loaded=True,
            strict_reset_session_on_block=True,
            product_url="https://example.com/?goodsNo=A0001",
        )
        # Attempt 1 starts WITHOUT force_fresh_context — only after
        # the failure does the flag flip on for attempt 2.
        assert captured == [False, True], captured

    def test_false_empty_does_not_trigger_reset(
        self, rpp, monkeypatch,
    ):
        """false_empty is a transient render race the existing
        in-session page-recreate handles; it MUST NOT escalate to a
        full session reset."""
        monkeypatch.setattr(rpp, "MULTI_SORT_PLAN", [
            {"sort_type": "X", "cap": "100", "role": "primary"},
        ])
        outcomes = iter([
            _fail("blocked_or_empty_state"),
            _ok(),
        ])
        captured, factory = self._capture_force_fresh(rpp, monkeypatch)
        monkeypatch.setattr(rpp, "_run_one_sort_attempt", factory(outcomes))
        monkeypatch.setattr(rpp.time, "sleep", lambda *_a, **_k: None)
        monkeypatch.setattr(rpp.random, "uniform", lambda *_a, **_k: 0.0)

        rpp.run_multi_sort_scrape(
            "A0001", "Test Product",
            wait_until_sort_loaded=True,
            strict_reset_session_on_block=True,
            product_url="https://example.com/?goodsNo=A0001",
        )
        assert captured == [False, False], captured

    def test_plain_scraper_failure_does_not_trigger_reset(
        self, rpp, monkeypatch,
    ):
        """Plain `scraper_subprocess_failed` without an anti_bot /
        auth_wall substring should NOT trigger a reset — that's a
        run-of-the-mill subprocess error, not a sticky session
        block."""
        monkeypatch.setattr(rpp, "MULTI_SORT_PLAN", [
            {"sort_type": "X", "cap": "100", "role": "primary"},
        ])
        # Plain status without the keyword + empty error.
        plain = {
            **_fail("scraper_subprocess_failed"),
            "error": "subprocess exited with code 1",
            "quality_status": None,
        }
        outcomes = iter([plain, _ok()])
        captured, factory = self._capture_force_fresh(rpp, monkeypatch)
        monkeypatch.setattr(rpp, "_run_one_sort_attempt", factory(outcomes))
        monkeypatch.setattr(rpp.time, "sleep", lambda *_a, **_k: None)
        monkeypatch.setattr(rpp.random, "uniform", lambda *_a, **_k: 0.0)

        rpp.run_multi_sort_scrape(
            "A0001", "Test Product",
            wait_until_sort_loaded=True,
            strict_reset_session_on_block=True,
            product_url="https://example.com/?goodsNo=A0001",
        )
        assert captured == [False, False], captured

    def test_anti_bot_in_error_field_triggers_reset(
        self, rpp, monkeypatch,
    ):
        """The orchestrator must scan `result["error"]` too —
        because the batch runner often surfaces anti_bot inside
        the stderr-captured error field while `status` is the
        generic `scraper_subprocess_failed`."""
        monkeypatch.setattr(rpp, "MULTI_SORT_PLAN", [
            {"sort_type": "X", "cap": "100", "role": "primary"},
        ])
        composite = {
            **_fail("scraper_subprocess_failed"),
            "error": "Scraper failed (exit 1). stderr: classified as 'anti_bot' — re-establish ...",
            "quality_status": None,
        }
        outcomes = iter([composite, _ok()])
        captured, factory = self._capture_force_fresh(rpp, monkeypatch)
        monkeypatch.setattr(rpp, "_run_one_sort_attempt", factory(outcomes))
        monkeypatch.setattr(rpp.time, "sleep", lambda *_a, **_k: None)
        monkeypatch.setattr(rpp.random, "uniform", lambda *_a, **_k: 0.0)

        rpp.run_multi_sort_scrape(
            "A0001", "Test Product",
            wait_until_sort_loaded=True,
            strict_reset_session_on_block=True,
            product_url="https://example.com/?goodsNo=A0001",
        )
        assert captured == [False, True], captured

    def test_reset_signal_is_one_shot_after_recovery(
        self, rpp, monkeypatch,
    ):
        """A reset-worthy failure → fresh context on the next
        attempt → success. The signal must NOT propagate to other
        sorts in the plan: each sort starts fresh-context-False."""
        monkeypatch.setattr(rpp, "MULTI_SORT_PLAN", [
            {"sort_type": "X", "cap": "100", "role": "primary"},
            {"sort_type": "Y", "cap": "100", "role": "primary"},
        ])
        outcomes = iter([
            # X: fail anti_bot, then recover.
            _fail("anti_bot"),
            _ok(),
            # Y: succeed first try. force_fresh_context MUST be False
            # — the signal does not bleed across sorts.
            _ok(),
        ])
        captured, factory = self._capture_force_fresh(rpp, monkeypatch)
        monkeypatch.setattr(rpp, "_run_one_sort_attempt", factory(outcomes))
        monkeypatch.setattr(rpp.time, "sleep", lambda *_a, **_k: None)
        monkeypatch.setattr(rpp.random, "uniform", lambda *_a, **_k: 0.0)

        rpp.run_multi_sort_scrape(
            "A0001", "Test Product",
            wait_until_sort_loaded=True,
            strict_reset_session_on_block=True,
            product_url="https://example.com/?goodsNo=A0001",
        )
        # X: [False(fail), True(reset on retry)] | Y: [False(fresh sort)]
        assert captured == [False, True, False], captured

    def test_reset_clears_after_non_reset_failure(
        self, rpp, monkeypatch,
    ):
        """After a reset-worthy failure followed by a non-reset
        failure, the next attempt MUST drop force_fresh_context — we
        only force a reset when the LATEST failure was reset-worthy."""
        monkeypatch.setattr(rpp, "MULTI_SORT_PLAN", [
            {"sort_type": "X", "cap": "100", "role": "primary"},
        ])
        outcomes = iter([
            _fail("anti_bot"),                # attempt 1: reset-worthy
            _fail("scraper_subprocess_failed"),  # attempt 2: NOT reset-worthy
            _ok(),                             # attempt 3
        ])
        captured, factory = self._capture_force_fresh(rpp, monkeypatch)
        monkeypatch.setattr(rpp, "_run_one_sort_attempt", factory(outcomes))
        monkeypatch.setattr(rpp.time, "sleep", lambda *_a, **_k: None)
        monkeypatch.setattr(rpp.random, "uniform", lambda *_a, **_k: 0.0)

        rpp.run_multi_sort_scrape(
            "A0001", "Test Product",
            wait_until_sort_loaded=True,
            strict_reset_session_on_block=True,
            product_url="https://example.com/?goodsNo=A0001",
        )
        # 1: False (initial)
        # 2: True  (anti_bot just failed)
        # 3: False (plain failure cleared the signal)
        assert captured == [False, True, False], captured

    def test_flag_off_disables_reset_even_for_anti_bot(
        self, rpp, monkeypatch,
    ):
        """Without --strict-reset-session-on-block, anti_bot still
        retries (strict mode) but never sets force_fresh_context."""
        monkeypatch.setattr(rpp, "MULTI_SORT_PLAN", [
            {"sort_type": "X", "cap": "100", "role": "primary"},
        ])
        outcomes = iter([_fail("anti_bot"), _ok()])
        captured, factory = self._capture_force_fresh(rpp, monkeypatch)
        monkeypatch.setattr(rpp, "_run_one_sort_attempt", factory(outcomes))
        monkeypatch.setattr(rpp.time, "sleep", lambda *_a, **_k: None)
        monkeypatch.setattr(rpp.random, "uniform", lambda *_a, **_k: 0.0)

        rpp.run_multi_sort_scrape(
            "A0001", "Test Product",
            wait_until_sort_loaded=True,
            strict_reset_session_on_block=False,  # explicitly off
            product_url="https://example.com/?goodsNo=A0001",
        )
        assert captured == [False, False], captured


class TestStrictConfirmBeforeRetry:
    def test_prompts_input_between_attempts(self, rpp, monkeypatch):
        """When confirm-before-retry is on, the orchestrator should
        call `input()` between attempts instead of sleeping. Verify
        it's called once per failure, not per success."""
        monkeypatch.setattr(rpp, "MULTI_SORT_PLAN", [
            {"sort_type": "X", "cap": "100", "role": "primary"},
        ])
        # 2 fails then success → input() called twice.
        outcomes = [_fail("anti_bot"), _fail("anti_bot"), _ok()]

        def _fake(*, sort_type, **_k):
            r = dict(outcomes.pop(0))
            r["sort_type"] = sort_type
            return r

        # `time.sleep` MUST NOT be called when confirm-before-retry
        # is on. Patch it to a sentinel that fails the test.
        sleep_calls = {"n": 0}

        def _sleep(*_a, **_k):
            sleep_calls["n"] += 1

        input_calls: list[str] = []
        # builtins.input → emulate Enter press.
        monkeypatch.setattr("builtins.input", lambda prompt="": (
            input_calls.append(prompt) or ""
        ))
        monkeypatch.setattr(rpp, "_run_one_sort_attempt", _fake)
        monkeypatch.setattr(rpp.time, "sleep", _sleep)
        monkeypatch.setattr(rpp.random, "uniform", lambda *_a, **_k: 0.0)

        summaries = rpp.run_multi_sort_scrape(
            "A0001", "Test Product",
            wait_until_sort_loaded=True,
            strict_confirm_before_retry=True,
            product_url="https://example.com/?goodsNo=A0001",
        )
        assert len(input_calls) == 2
        # Sleep must not have been called from the confirm path
        # (existing inter-sort jitter is also patched out here, so
        # any non-zero count would mean confirm path called sleep).
        assert sleep_calls["n"] == 0
        # Final attempt succeeded.
        assert summaries[0].get("strict_recovered") is True
        assert summaries[0]["attempts"] == 3

    def test_eof_on_input_treated_as_continue(self, rpp, monkeypatch):
        """Stdin closed (non-TTY) → EOFError from input(). The
        orchestrator must keep retrying rather than crashing."""
        monkeypatch.setattr(rpp, "MULTI_SORT_PLAN", [
            {"sort_type": "X", "cap": "100", "role": "primary"},
        ])
        outcomes = [_fail("anti_bot"), _ok()]

        def _fake(*, sort_type, **_k):
            r = dict(outcomes.pop(0))
            r["sort_type"] = sort_type
            return r

        def _eof(_prompt=""):
            raise EOFError()

        monkeypatch.setattr("builtins.input", _eof)
        monkeypatch.setattr(rpp, "_run_one_sort_attempt", _fake)
        monkeypatch.setattr(rpp.time, "sleep", lambda *_a, **_k: None)
        monkeypatch.setattr(rpp.random, "uniform", lambda *_a, **_k: 0.0)

        summaries = rpp.run_multi_sort_scrape(
            "A0001", "Test Product",
            wait_until_sort_loaded=True,
            strict_confirm_before_retry=True,
            product_url="https://example.com/?goodsNo=A0001",
        )
        assert summaries[0].get("strict_recovered") is True
        assert summaries[0]["attempts"] == 2

    def test_keyboard_interrupt_at_prompt_propagates(self, rpp, monkeypatch):
        """Ctrl+C at the confirm prompt must abort the run cleanly."""
        monkeypatch.setattr(rpp, "MULTI_SORT_PLAN", [
            {"sort_type": "X", "cap": "100", "role": "primary"},
        ])

        def _fake(*, sort_type, **_k):
            r = _fail("anti_bot")
            r["sort_type"] = sort_type
            return r

        def _kbi(_prompt=""):
            raise KeyboardInterrupt()

        monkeypatch.setattr("builtins.input", _kbi)
        monkeypatch.setattr(rpp, "_run_one_sort_attempt", _fake)
        monkeypatch.setattr(rpp.time, "sleep", lambda *_a, **_k: None)
        monkeypatch.setattr(rpp.random, "uniform", lambda *_a, **_k: 0.0)

        with pytest.raises(KeyboardInterrupt):
            rpp.run_multi_sort_scrape(
                "A0001", "Test Product",
                wait_until_sort_loaded=True,
                strict_confirm_before_retry=True,
                product_url="https://example.com/?goodsNo=A0001",
            )


# ---------------------------------------------------------------------------
# Non-strict mode + retry queue
# ---------------------------------------------------------------------------


class TestNonStrictRetryQueue:
    def test_failed_sort_appended_to_queue(self, rpp, monkeypatch, tmp_path):
        """Non-strict mode: a sort that fails both attempts is
        appended to the queue with the required fields populated."""
        def _fake(*, sort_type, **_k):
            r = _fail("anti_bot")
            r["sort_type"] = sort_type
            return r

        monkeypatch.setattr(rpp, "_run_one_sort_attempt", _fake)
        monkeypatch.setattr(rpp.time, "sleep", lambda *_a, **_k: None)
        monkeypatch.setattr(rpp.random, "uniform", lambda *_a, **_k: 0.0)

        queue_path = tmp_path / "queue.json"
        summaries = rpp.run_multi_sort_scrape(
            "A0001", "Test Product",
            wait_until_sort_loaded=False,
            retry_queue_path=queue_path,
            product_url="https://example.com/?goodsNo=A0001",
        )

        assert len(summaries) == len(rpp.MULTI_SORT_PLAN)
        # Queue must exist and contain one entry per sort in the plan.
        assert queue_path.is_file()
        items = json.loads(queue_path.read_text(encoding="utf-8"))
        assert len(items) == len(rpp.MULTI_SORT_PLAN)
        for it in items:
            assert it["product_url"] == "https://example.com/?goodsNo=A0001"
            assert it["goods_no"] == "A0001"
            assert it["sort_type"] in {e["sort_type"] for e in rpp.MULTI_SORT_PLAN}
            assert it["failure_reason"] == "anti_bot"
            assert it["last_status"] == "blocked"
            assert it["attempted_at"].endswith("Z")
            assert "extra" in it
            assert it["extra"]["attempts"] == 2

    def test_successful_sort_not_enqueued(self, rpp, monkeypatch, tmp_path):
        def _fake(*, sort_type, **_k):
            r = _ok(rows=42)
            r["sort_type"] = sort_type
            return r

        monkeypatch.setattr(rpp, "_run_one_sort_attempt", _fake)
        monkeypatch.setattr(rpp.time, "sleep", lambda *_a, **_k: None)
        monkeypatch.setattr(rpp.random, "uniform", lambda *_a, **_k: 0.0)

        queue_path = tmp_path / "queue.json"
        rpp.run_multi_sort_scrape(
            "A0001", "Test Product",
            retry_queue_path=queue_path,
            product_url="https://example.com/?goodsNo=A0001",
        )
        # Either no queue file was written, or it's an empty list.
        if queue_path.is_file():
            assert json.loads(queue_path.read_text(encoding="utf-8")) == []

    def test_no_queue_when_path_omitted(self, rpp, monkeypatch, tmp_path):
        """When `retry_queue_path=None`, failures don't get persisted
        anywhere — caller opted out of the queue."""
        def _fake(*, sort_type, **_k):
            r = _fail("anti_bot")
            r["sort_type"] = sort_type
            return r

        monkeypatch.setattr(rpp, "_run_one_sort_attempt", _fake)
        monkeypatch.setattr(rpp.time, "sleep", lambda *_a, **_k: None)
        monkeypatch.setattr(rpp.random, "uniform", lambda *_a, **_k: 0.0)

        # No assertion on filesystem because we don't pass a path.
        rpp.run_multi_sort_scrape(
            "A0001", "Test Product",
            retry_queue_path=None,
            product_url="https://example.com/?goodsNo=A0001",
        )

    def test_no_queue_when_product_url_missing(self, rpp, monkeypatch, tmp_path):
        """The orchestrator can't write a useful queue entry without
        a product_url — it must skip the write rather than enqueue
        an entry with a None URL."""
        def _fake(*, sort_type, **_k):
            r = _fail("anti_bot")
            r["sort_type"] = sort_type
            return r

        monkeypatch.setattr(rpp, "_run_one_sort_attempt", _fake)
        monkeypatch.setattr(rpp.time, "sleep", lambda *_a, **_k: None)
        monkeypatch.setattr(rpp.random, "uniform", lambda *_a, **_k: 0.0)

        queue_path = tmp_path / "queue.json"
        rpp.run_multi_sort_scrape(
            "A0001", "Test Product",
            retry_queue_path=queue_path,
            product_url=None,
        )
        assert not queue_path.exists()
