"""Tests for the anti-bot / human-check wait-and-resume path on
OliveYoungBrowserAPIConnector.

Covers:
  - `_wait_for_human_check` direct probe sequencing (recover, timeout,
    not_detected, missing accessor).
  - End-to-end `collect()` integration: detect→recover continues the
    sort and reads reviews; detect→timeout-skip returns empty rows
    without raising; detect→timeout-fail also returns cleanly but
    flips `recovery_action` to the harsher verb.
  - Telemetry surfaces: `last_run_summary.human_check_*` fields
    populated correctly for each path.
"""
from __future__ import annotations

import asyncio
import copy
import json
from datetime import datetime
from pathlib import Path

import pytest

from src.voc.connectors.base import CollectParams
from src.voc.connectors.oliveyoung_browser_api import (
    OliveYoungBrowserAPIConnector,
    ProfileCodeMapper,
)
from tests.test_connectors.test_oliveyoung_browser_api_runtime import (
    FakeBrowserReviewSession,
    PRODUCT_URL,
)


FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "oliveyoung_api"
PAGE1_PATH = FIXTURE_DIR / "goods_review_list_page1.json"
PAGE2_PATH = FIXTURE_DIR / "goods_review_list_page2.json"


@pytest.fixture
def page1_body() -> dict:
    return json.loads(PAGE1_PATH.read_text(encoding="utf-8"))


@pytest.fixture
def page2_body() -> dict:
    return json.loads(PAGE2_PATH.read_text(encoding="utf-8"))


@pytest.fixture
def page2_last(page2_body) -> dict:
    out = copy.deepcopy(page2_body)
    out["data"]["hasNext"] = False
    return out


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeSessionWithInterstitial(FakeBrowserReviewSession):
    """Adds a scriptable `is_interstitial_state` queue to the
    standard fake. Each `complete()` pop advances the queue;
    when exhausted, returns the last value forever (so the
    operator-clears-then-stays-cleared steady state is easy to
    model)."""

    def __init__(
        self,
        *args,
        interstitial_states: list[bool | None] | None = None,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self._states = list(interstitial_states or [])
        self._states_consumed = 0
        self.reload_calls = 0

    async def is_interstitial_state(self) -> bool | None:
        if self._states:
            v = self._states.pop(0)
        else:
            v = False  # steady-state once script exhausted
        self._states_consumed += 1
        return v

    async def reload_and_reopen_review_tab(self) -> None:
        self.reload_calls += 1


def _build_connector(session, **kwargs) -> tuple[OliveYoungBrowserAPIConnector, CollectParams]:
    # Fast defaults for tests; callers can override via kwargs.
    kwargs.setdefault("human_check_poll_s", 0.5)
    kwargs.setdefault("human_check_timeout_s", 2.0)
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
        **kwargs,
    )
    return c, CollectParams(max_results=100)


# ---------------------------------------------------------------------------
# _wait_for_human_check direct unit tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_wait_returns_not_detected_when_first_probe_false():
    session = FakeSessionWithInterstitial(
        responses=[], interstitial_states=[False],
    )
    c, _ = _build_connector(session)
    detected, waited, recovered, action = await c._wait_for_human_check(session)
    assert detected is False
    assert waited == 0
    assert recovered is False
    assert action == "not_detected"


@pytest.mark.asyncio
async def test_wait_returns_not_detected_when_session_lacks_probe():
    session = FakeBrowserReviewSession(responses=[])
    c, _ = _build_connector(session)
    detected, waited, recovered, action = await c._wait_for_human_check(session)
    assert detected is False
    assert action == "not_detected"


@pytest.mark.asyncio
async def test_wait_returns_not_detected_when_first_probe_none():
    """Probe returns None ("can't tell") on first call → treat as no
    detection, not as a soft positive. Otherwise a one-shot DOM error
    would block every run for the full timeout."""
    session = FakeSessionWithInterstitial(
        responses=[], interstitial_states=[None],
    )
    c, _ = _build_connector(session)
    detected, waited, recovered, action = await c._wait_for_human_check(session)
    assert detected is False
    assert action == "not_detected"


@pytest.mark.asyncio
async def test_wait_recovers_when_probe_clears_within_timeout():
    # First probe: True (detect). Then True again (still waiting).
    # Then False (operator solved it).
    session = FakeSessionWithInterstitial(
        responses=[], interstitial_states=[True, True, False],
    )
    c, _ = _build_connector(session)
    detected, waited, recovered, action = await c._wait_for_human_check(session)
    assert detected is True
    assert recovered is True
    assert action == "recovered"
    assert waited >= 0


@pytest.mark.asyncio
async def test_wait_times_out_in_skip_mode():
    """Probe stays True forever — caller should report
    `skipped_on_timeout` when fail_on_human_check_timeout=False."""
    session = FakeSessionWithInterstitial(
        responses=[], interstitial_states=[True] * 50,
    )
    c, _ = _build_connector(
        session,
        human_check_timeout_s=1.0,
        human_check_poll_s=0.5,
        fail_on_human_check_timeout=False,
    )
    detected, waited, recovered, action = await c._wait_for_human_check(session)
    assert detected is True
    assert recovered is False
    assert action == "skipped_on_timeout"
    assert waited == 1  # int(round(timeout))


@pytest.mark.asyncio
async def test_wait_times_out_in_fail_mode():
    """Same probe sequence but fail-flag flips the verb."""
    session = FakeSessionWithInterstitial(
        responses=[], interstitial_states=[True] * 50,
    )
    c, _ = _build_connector(
        session,
        human_check_timeout_s=1.0,
        human_check_poll_s=0.5,
        fail_on_human_check_timeout=True,
    )
    detected, waited, recovered, action = await c._wait_for_human_check(session)
    assert detected is True
    assert recovered is False
    assert action == "failed_on_timeout"


@pytest.mark.asyncio
async def test_wait_treats_intermittent_none_as_keep_polling():
    """Probe returns True, None, True, False — the None should NOT
    count as recovery; only an explicit False does. The operator
    might still be solving the CAPTCHA when a transient DOM read
    fails."""
    session = FakeSessionWithInterstitial(
        responses=[], interstitial_states=[True, None, True, False],
    )
    c, _ = _build_connector(session, human_check_timeout_s=5.0)
    detected, waited, recovered, action = await c._wait_for_human_check(session)
    assert detected is True
    assert recovered is True
    assert action == "recovered"


# ---------------------------------------------------------------------------
# Constructor validation
# ---------------------------------------------------------------------------


def test_negative_timeout_rejected():
    with pytest.raises(ValueError, match="human_check_timeout_s"):
        OliveYoungBrowserAPIConnector(
            product_url=PRODUCT_URL,
            human_check_timeout_s=-1,
        )


def test_zero_or_negative_poll_rejected():
    with pytest.raises(ValueError, match="human_check_poll_s"):
        OliveYoungBrowserAPIConnector(
            product_url=PRODUCT_URL,
            human_check_poll_s=0,
        )


# ---------------------------------------------------------------------------
# End-to-end collect() integration
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_collect_no_interstitial_passthrough(page1_body, page2_last):
    """No interstitial → human_check_detected stays False, summary
    untouched, reviews collected normally."""
    session = FakeSessionWithInterstitial(
        responses=[(200, page1_body), (200, page2_last)],
        interstitial_states=[False, False],
    )
    c, params = _build_connector(session)
    raws = await c.collect(keyword="x", params=params)
    assert len(raws) > 0
    s = c.last_run_summary
    assert s is not None
    assert s.human_check_detected is False
    assert s.human_check_waited_seconds == 0
    assert s.human_check_recovered is False
    assert s.human_check_recovery_action == "not_detected"
    assert s.blocked is False


@pytest.mark.asyncio
async def test_collect_detect_recover_continues_sort(page1_body, page2_last):
    """Interstitial detected → wait → operator clears → sort
    proceeds and reviews are returned."""
    session = FakeSessionWithInterstitial(
        responses=[(200, page1_body), (200, page2_last)],
        interstitial_states=[True, True, False],
    )
    c, params = _build_connector(session)
    raws = await c.collect(keyword="x", params=params)
    assert len(raws) > 0, "recovery should let the sort collect normally"
    s = c.last_run_summary
    assert s is not None
    assert s.human_check_detected is True
    assert s.human_check_recovered is True
    assert s.human_check_recovery_action == "recovered"
    assert s.blocked is False
    # Recovery triggers a review-tab re-click.
    assert session.reload_calls >= 1


@pytest.mark.asyncio
async def test_collect_detect_timeout_skip_returns_clean(page1_body, page2_last):
    """Persistent interstitial → timeout in skip mode → return
    cleanly with empty rows and `skipped_on_timeout` action.
    fail_on_human_check_timeout=False is the default."""
    # Even though responses are queued, the wait helper detects
    # interstitial first and short-circuits before cold-start.
    session = FakeSessionWithInterstitial(
        responses=[(200, page1_body), (200, page2_last)],
        interstitial_states=[True] * 50,
    )
    c, params = _build_connector(
        session,
        human_check_timeout_s=1.0,
        human_check_poll_s=0.5,
        fail_on_human_check_timeout=False,
    )
    raws = await c.collect(keyword="x", params=params)
    # Rows MAY be empty — the sort is skipped, not raised.
    assert raws == []
    s = c.last_run_summary
    assert s is not None
    assert s.human_check_detected is True
    assert s.human_check_recovered is False
    assert s.human_check_recovery_action == "skipped_on_timeout"
    assert s.blocked is True


@pytest.mark.asyncio
async def test_collect_detect_timeout_fail_marks_blocked(page1_body, page2_last):
    """Same sequence but with fail-flag — same blocked outcome but
    the verb reflects the harsher policy so the orchestrator can
    distinguish."""
    session = FakeSessionWithInterstitial(
        responses=[(200, page1_body), (200, page2_last)],
        interstitial_states=[True] * 50,
    )
    c, params = _build_connector(
        session,
        human_check_timeout_s=1.0,
        human_check_poll_s=0.5,
        fail_on_human_check_timeout=True,
    )
    raws = await c.collect(keyword="x", params=params)
    assert raws == []
    s = c.last_run_summary
    assert s is not None
    assert s.human_check_detected is True
    assert s.human_check_recovered is False
    assert s.human_check_recovery_action == "failed_on_timeout"
    assert s.blocked is True


@pytest.mark.asyncio
async def test_wait_indefinite_with_eventual_recovery():
    """timeout_s=0 → no deadline; the loop polls forever (or until
    an explicit False from the probe). Even with many True probes
    in a row, the wait MUST keep going and recover when False finally
    arrives — there is no `failed_on_timeout` path in this mode."""
    # 6 True probes then a False — must not give up on bounded loop count.
    session = FakeSessionWithInterstitial(
        responses=[],
        interstitial_states=[True] * 6 + [False],
    )
    c, _ = _build_connector(
        session,
        human_check_timeout_s=0,
        human_check_poll_s=0.5,
    )
    detected, waited, recovered, action = await c._wait_for_human_check(session)
    assert detected is True
    assert recovered is True
    assert action == "recovered"
    # `waited` should be non-trivial (≥ 1 poll cycle); don't assert
    # an exact value since it depends on event-loop timing.
    assert waited >= 0


@pytest.mark.asyncio
async def test_wait_indefinite_propagates_cancellation():
    """In indefinite mode, asyncio.CancelledError (the asyncio
    counterpart to KeyboardInterrupt under asyncio.run) MUST
    propagate so the orchestrator can clean up. The wait helper
    must not swallow the cancellation."""
    # Probe always True — the only way out of the loop is cancel.
    session = FakeSessionWithInterstitial(
        responses=[],
        interstitial_states=[True] * 200,
    )
    c, _ = _build_connector(
        session,
        human_check_timeout_s=0,
        human_check_poll_s=0.5,
    )

    async def _runner():
        await c._wait_for_human_check(session)

    task = asyncio.ensure_future(_runner())
    # Give the loop a tick to enter the wait.
    await asyncio.sleep(0.1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


@pytest.mark.asyncio
async def test_collect_legacy_session_without_probe_unchanged(page1_body, page2_last):
    """Sessions without `is_interstitial_state` (legacy fakes,
    older tests) must behave exactly as before — the human-check
    gate is a no-op."""
    session = FakeBrowserReviewSession(
        responses=[(200, page1_body), (200, page2_last)],
    )
    c, params = _build_connector(session)
    raws = await c.collect(keyword="x", params=params)
    assert len(raws) > 0
    s = c.last_run_summary
    assert s is not None
    assert s.human_check_detected is False
    assert s.human_check_recovery_action == "not_detected"
