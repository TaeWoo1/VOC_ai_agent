"""Layer B (runtime loop) tests for OliveYoungBrowserAPIConnector.

The real Playwright session is never instantiated here — tests inject a
`FakeBrowserReviewSession` that pops pre-recorded responses from a queue.
Layer A parsing is exercised indirectly via the real fixture payloads; any
divergence between these tests and the Layer A contract is a bug.

Responses can be one of:
    (http_status, body_dict)  — delivered to the connector
    (http_status, None)       — simulates non-JSON / decode failure
    None                      — simulates `wait_for_next_response` timeout
"""

from __future__ import annotations

import copy
import json
from datetime import datetime
from pathlib import Path

import asyncio

import pytest

from src.voc.connectors.base import CollectParams
from src.voc.connectors.oliveyoung_browser_api import (
    OliveYoungBrowserAPIConnector,
    ProfileCodeMapper,
    _classify_http_response,
    _count_records,
    _should_stop_pagination,
)

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "oliveyoung_api"
PAGE1_PATH = FIXTURE_DIR / "goods_review_list_page1.json"
PAGE2_PATH = FIXTURE_DIR / "goods_review_list_page2.json"
PRODUCT_URL = (
    "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
    "?goodsNo=A000000238828&tab=review"
)


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def page1_body() -> dict:
    return json.loads(PAGE1_PATH.read_text(encoding="utf-8"))


@pytest.fixture
def page2_body() -> dict:
    return json.loads(PAGE2_PATH.read_text(encoding="utf-8"))


@pytest.fixture
def page2_last(page2_body) -> dict:
    """Page 2 but with hasNext=False so the runtime loop terminates cleanly."""
    out = copy.deepcopy(page2_body)
    out["data"]["hasNext"] = False
    return out


@pytest.fixture
def empty_mapper() -> ProfileCodeMapper:
    return ProfileCodeMapper()


class FakeBrowserReviewSession:
    """Queue-backed `BrowserReviewSession` for Layer B tests.

    `responses` is a list where each element is either:
      - a `(status, body)` tuple delivered via `wait_for_next_response`, or
      - `None` meaning "the next wait_for_next_response call times out".
    The queue is popped in order regardless of which scroll attempt calls it.

    PR-4 additions:
      - Optional `request_log` attribute can be pre-populated by tests to
        simulate the per-API-call records a real Playwright session would
        capture in `_on_response`. When non-empty, `get_request_log()`
        returns it. When the test doesn't care about request-side capture,
        `request_log` defaults to []  and `get_request_log()` returns [].
      - Optional `login_state` attribute lets tests pin the result of
        `observe_login_state()`. Defaults to None ("probe not run").
    """

    def __init__(self, responses, *, request_log=None, login_state=None):
        self._responses = list(responses)
        self.open_calls = 0
        self.close_calls = 0
        self.scroll_calls = 0
        self.opened_url: str | None = None
        # PR-4: tests may pass a pre-built list of request-log entries to
        # simulate request-side capture. Default empty list = no capture.
        self.request_log: list[dict] = list(request_log) if request_log else []
        self._login_state = login_state

    async def open(self, product_url: str) -> None:
        self.open_calls += 1
        self.opened_url = product_url

    async def wait_for_next_response(self, *, timeout_s: float):
        if not self._responses:
            return None
        return self._responses.pop(0)

    async def scroll_for_next(self) -> None:
        self.scroll_calls += 1

    async def close(self) -> None:
        self.close_calls += 1

    def get_request_log(self) -> list[dict]:
        # Return a copy — connector mutates entries (adds attempt_index).
        return list(self.request_log)

    async def observe_login_state(self) -> str | None:
        return self._login_state


def _build_connector(session, *, mapper=None, max_results=100):
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=mapper or ProfileCodeMapper(),
        session_factory=lambda: session,
    )
    return c, CollectParams(max_results=max_results)


# ---------------------------------------------------------------------------
# _classify_http_response
# ---------------------------------------------------------------------------

def test_classify_ok(page1_body):
    assert _classify_http_response(200, page1_body) == "ok"


def test_classify_login_required_from_200_body():
    body = {"data": {"loginRequired": True, "goodsReviewList": []}}
    assert _classify_http_response(200, body) == "auth_error"


def test_classify_401():
    assert _classify_http_response(401, None) == "auth_error"


def test_classify_403():
    assert _classify_http_response(403, None) == "blocked"


def test_classify_429():
    assert _classify_http_response(429, None) == "rate_limited"


def test_classify_500_is_malformed():
    assert _classify_http_response(500, None) == "malformed"


def test_classify_200_body_none():
    assert _classify_http_response(200, None) == "malformed"


def test_classify_200_no_data_key():
    assert _classify_http_response(200, {"code": 200}) == "malformed"


def test_classify_200_data_not_dict():
    assert _classify_http_response(200, {"data": "nope"}) == "malformed"


def test_classify_200_goods_list_not_list():
    assert _classify_http_response(200, {"data": {"goodsReviewList": "nope"}}) == "malformed"


def test_classify_200_empty_goods_list_is_ok():
    # hasNext/loginRequired not present — empty-but-shaped body is still "ok"
    # (it's a degenerate final page, not a malformed response).
    assert _classify_http_response(200, {"data": {"goodsReviewList": []}}) == "ok"


# ---------------------------------------------------------------------------
# _should_stop_pagination
# ---------------------------------------------------------------------------

def test_should_stop_when_max_results_reached():
    assert _should_stop_pagination({"data": {"hasNext": True}}, 10, 10)
    assert _should_stop_pagination({"data": {"hasNext": True}}, 11, 10)


def test_should_stop_when_has_next_false():
    assert _should_stop_pagination({"data": {"hasNext": False}}, 5, 100)


def test_should_stop_when_has_next_missing_or_none():
    assert _should_stop_pagination({"data": {}}, 5, 100)
    assert _should_stop_pagination({"data": {"hasNext": None}}, 5, 100)
    assert _should_stop_pagination({}, 5, 100)


def test_should_continue_when_has_next_true_and_quota_remaining():
    assert not _should_stop_pagination({"data": {"hasNext": True}}, 5, 100)


# ---------------------------------------------------------------------------
# _count_records
# ---------------------------------------------------------------------------

def test_count_records_from_fixture(page1_body):
    assert _count_records(page1_body) == 10


def test_count_records_missing_data():
    assert _count_records({}) == 0
    assert _count_records({"data": None}) == 0
    assert _count_records({"data": {"goodsReviewList": "not-a-list"}}) == 0


# ---------------------------------------------------------------------------
# connector basics
# ---------------------------------------------------------------------------

def test_channel_name():
    c = OliveYoungBrowserAPIConnector(product_url=PRODUCT_URL)
    assert c.channel_name == "oliveyoung"


def test_constructor_requires_product_url():
    with pytest.raises(ValueError):
        OliveYoungBrowserAPIConnector(product_url="")


# ---------------------------------------------------------------------------
# happy path: two fixture pages stitched by the runtime loop
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_collect_two_pages_yields_all_reviews(page1_body, page2_last):
    session = FakeBrowserReviewSession([(200, page1_body), (200, page2_last)])
    c, params = _build_connector(session)

    raws = await c.collect(keyword="블러셔", params=params)

    # 18, not 20: the saved fixtures contain 1 sibling-goodsNumber row
    # per page (A000000205145) which the new goods-filter drops on
    # PRODUCT_URL=goodsNo=A000000238828. See parse_response_body's
    # `target_goods_no` semantics. The pre-filter count is still 20
    # (asserted via `raw_records_seen` where the test exposes it).
    assert len(raws) == 18
    assert session.open_calls == 1
    assert session.close_calls == 1
    assert session.opened_url == PRODUCT_URL
    # First page is the cold-start response; page 2 required one scroll.
    assert session.scroll_calls == 1

    s = c.last_run_summary
    assert s is not None
    assert s.channel == "oliveyoung"
    assert s.requested_target == PRODUCT_URL
    # raw_records_seen counts BEFORE the goods-filter, so it stays at 20.
    # records_parsed counts AFTER (= len(raws)), so it drops to 18.
    assert s.raw_records_seen == 20
    assert s.records_parsed == 18
    # New (2026-05-01) filter telemetry — exact split.
    assert s.raw_records_seen_total_before_filter == 20
    assert s.rows_kept_after_goods_no_filter == 18
    assert s.rows_filtered_by_goods_no == 2
    assert s.blocked is False
    assert s.auth_error is False
    assert s.parse_warnings == 0
    assert s.sample_dropped_reasons == []

    # PR-1 telemetry assertions: clean two-page run sets pagination_exhausted
    # cleanly and clears all failure-class flags.
    assert s.cold_start_timed_out is False
    assert s.http_403_seen is False
    assert s.http_429_seen is False
    assert s.http_401_or_login_required_seen is False
    assert s.mid_stream_auth_break is False
    assert s.incomplete_collection is False
    assert s.pagination_exhausted is True
    assert s.last_observed_has_next is False


@pytest.mark.asyncio
async def test_collect_stops_on_has_next_false_without_extra_scroll(page1_body):
    page1_last = copy.deepcopy(page1_body)
    page1_last["data"]["hasNext"] = False
    session = FakeBrowserReviewSession([(200, page1_last)])
    c, params = _build_connector(session)

    raws = await c.collect(keyword="x", params=params)

    # 9, not 10: page 1 fixture has 1 sibling-goodsNumber row that
    # the new goods-filter drops on the test's PRODUCT_URL.
    assert len(raws) == 9
    assert session.scroll_calls == 0  # never scrolled past the first page
    assert c.last_run_summary.blocked is False
    assert c.last_run_summary.auth_error is False


@pytest.mark.asyncio
async def test_collect_populates_last_collected_review_ids(page1_body, page2_last):
    """Phase 2E membership tracking: after collect() returns, the
    connector's `last_collected_review_ids` attribute carries the canonical
    review_ids of every parsed row, in the same hash format the normalizer
    produces. The membership-tracker reads this attribute (via the ingest
    CLI's stdout JSON) to write per-sort sidecars.
    """
    from src.voc.connectors.oliveyoung_browser_api import parse_response_body
    from src.voc.ingestion.normalizer import generate_review_id

    session = FakeBrowserReviewSession([(200, page1_body), (200, page2_last)])
    c, params = _build_connector(session)
    raws = await c.collect(keyword="x", params=params)

    expected_rids = [
        generate_review_id(r.source_channel, r.source_id) for r in raws
    ]
    assert c.last_collected_review_ids == expected_rids
    assert len(c.last_collected_review_ids) == len(raws)
    # Hash format: 16-char hex.
    assert all(
        len(rid) == 16 and all(ch in "0123456789abcdef" for ch in rid)
        for rid in c.last_collected_review_ids
    )


@pytest.mark.asyncio
async def test_last_collected_review_ids_resets_between_runs(page1_body, page2_last):
    """A second collect() invocation must NOT leak review_ids from the
    first. The list is reset at the start of every collect() so callers
    always see only the current run's IDs.
    """
    session1 = FakeBrowserReviewSession([(200, page1_body), (200, page2_last)])
    c, params = _build_connector(session1)
    await c.collect(keyword="x", params=params)
    first = list(c.last_collected_review_ids)
    assert first

    # Second run with a single empty response → 0 review_ids.
    session2 = FakeBrowserReviewSession([
        (200, {"data": {"goodsReviewList": [], "hasNext": False}}),
    ])
    c._session_factory = lambda: session2
    await c.collect(keyword="x", params=params)
    assert c.last_collected_review_ids == []


@pytest.mark.asyncio
async def test_collect_preserves_parser_layer_a_output(page1_body, page2_last):
    """Fuzz against the direct parser: runtime-loop output == concat(Layer A outputs)."""
    from src.voc.connectors.oliveyoung_browser_api import parse_response_body

    session = FakeBrowserReviewSession([(200, page1_body), (200, page2_last)])
    c, params = _build_connector(session)
    raws_via_runtime = await c.collect(keyword="블러셔", params=params)

    # The runtime path passes `target_goods_no` derived from
    # PRODUCT_URL into parse_response_body. Parity check must pass
    # the same target so the layer-A output matches.
    ref_p1 = parse_response_body(
        page1_body, code_mapper=ProfileCodeMapper(),
        keyword="블러셔", collected_at=datetime.now(),
        target_goods_no="A000000238828",
    )
    ref_p2 = parse_response_body(
        page2_last, code_mapper=ProfileCodeMapper(),
        keyword="블러셔", collected_at=datetime.now(),
        target_goods_no="A000000238828",
    )

    assert [r.source_id for r in raws_via_runtime] == \
           [r.source_id for r in ref_p1] + [r.source_id for r in ref_p2]
    for r in raws_via_runtime:
        assert r.source_channel == "oliveyoung"
        assert r.keyword_used == "블러셔"


# ---------------------------------------------------------------------------
# quota handling
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_max_results_truncates_output(page1_body, page2_last):
    session = FakeBrowserReviewSession([(200, page1_body), (200, page2_last)])
    c, params = _build_connector(session, max_results=5)

    raws = await c.collect(keyword="x", params=params)

    # Quota trimmed AFTER parsing the cold-start page; no further scroll.
    assert len(raws) == 5
    assert session.scroll_calls == 0
    assert c.last_run_summary.records_parsed == 5


@pytest.mark.asyncio
async def test_max_results_exactly_equal_to_one_page(page1_body, page2_last):
    session = FakeBrowserReviewSession([(200, page1_body), (200, page2_last)])
    c, params = _build_connector(session, max_results=10)

    raws = await c.collect(keyword="x", params=params)

    # Post-2026-05-01 (goods-filter): page 1 yields 9 target rows
    # after dropping the 1 sibling-goodsNumber. 9 < quota(10), so the
    # connector scrolls into page 2 (also 9 target rows). Total = 18,
    # then the post-loop quota trim truncates to 10.
    assert len(raws) == 10
    assert session.scroll_calls == 1


# ---------------------------------------------------------------------------
# blocked / auth / rate-limited paths
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cold_start_timeout_is_blocked():
    session = FakeBrowserReviewSession([None])  # first wait times out
    c, params = _build_connector(session)

    raws = await c.collect(keyword="x", params=params)

    assert raws == []
    s = c.last_run_summary
    assert s.blocked is True
    assert s.auth_error is False
    assert s.raw_records_seen == 0
    assert s.records_parsed == 0
    assert any("cold_start_timeout" in r for r in s.sample_dropped_reasons)
    assert session.close_calls == 1

    # PR-1 telemetry: cold-start timeout sets the distinct flag in addition
    # to the legacy `blocked=True`.
    assert s.cold_start_timed_out is True
    assert s.http_403_seen is False
    assert s.http_401_or_login_required_seen is False
    assert s.mid_stream_auth_break is False
    assert s.incomplete_collection is False
    assert s.pagination_exhausted is False


@pytest.mark.asyncio
async def test_http_403_on_cold_start_is_blocked():
    session = FakeBrowserReviewSession([(403, None)])
    c, params = _build_connector(session)

    raws = await c.collect(keyword="x", params=params)

    assert raws == []
    s = c.last_run_summary
    assert s.blocked is True
    assert s.auth_error is False
    assert any("HTTP 403" in r for r in s.sample_dropped_reasons)
    # PR-1 telemetry
    assert s.http_403_seen is True
    assert s.cold_start_timed_out is False
    assert s.http_401_or_login_required_seen is False


@pytest.mark.asyncio
async def test_http_429_on_cold_start_is_blocked_with_rate_limited_reason():
    session = FakeBrowserReviewSession([(429, None)])
    c, params = _build_connector(session)

    await c.collect(keyword="x", params=params)

    s = c.last_run_summary
    assert s.blocked is True
    assert s.auth_error is False
    # 429 collapses to blocked=True but the reason tag must distinguish it
    # so an operator can see this was rate-limiting, not a ban.
    assert any("rate_limited" in r for r in s.sample_dropped_reasons)
    # PR-1 telemetry: dedicated 429 flag separates rate-limit from ban.
    assert s.http_429_seen is True
    assert s.http_403_seen is False


@pytest.mark.asyncio
async def test_http_401_on_cold_start_is_auth_error():
    session = FakeBrowserReviewSession([(401, None)])
    c, params = _build_connector(session)

    await c.collect(keyword="x", params=params)

    s = c.last_run_summary
    assert s.auth_error is True
    assert s.blocked is False
    # PR-1 telemetry
    assert s.http_401_or_login_required_seen is True
    assert s.mid_stream_auth_break is False  # cold-start, not mid-stream


@pytest.mark.asyncio
async def test_login_required_200_body_is_auth_error():
    body = {"data": {"loginRequired": True, "goodsReviewList": []}}
    session = FakeBrowserReviewSession([(200, body)])
    c, params = _build_connector(session)

    raws = await c.collect(keyword="x", params=params)

    assert raws == []
    s = c.last_run_summary
    assert s.auth_error is True
    assert s.blocked is False
    # PR-1 telemetry: HTTP-200 with loginRequired is the same class as 401.
    assert s.http_401_or_login_required_seen is True
    assert s.mid_stream_auth_break is False


@pytest.mark.asyncio
async def test_malformed_cold_start_counts_parse_warning_and_still_closes():
    session = FakeBrowserReviewSession([(200, None)])  # JSON decode failed
    c, params = _build_connector(session)

    await c.collect(keyword="x", params=params)

    s = c.last_run_summary
    assert s.parse_warnings == 1
    assert s.blocked is False
    assert s.auth_error is False
    assert s.records_parsed == 0
    assert session.close_calls == 1


# ---------------------------------------------------------------------------
# mid-stream failure paths (cold start OK, later page fails)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_blocked_mid_stream_keeps_first_page(page1_body):
    # Page 1 ok (hasNext=True) → scroll → 403 on page 2 → stop.
    session = FakeBrowserReviewSession([(200, page1_body), (403, None)])
    c, params = _build_connector(session)

    raws = await c.collect(keyword="x", params=params)

    # 9, not 10: page 1 fixture has 1 sibling-goodsNumber row that
    # the new goods-filter drops on the test's PRODUCT_URL.
    assert len(raws) == 9
    s = c.last_run_summary
    assert s.blocked is True
    assert s.auth_error is False
    assert s.records_parsed == 9
    assert any("mid-stream" in r for r in s.sample_dropped_reasons)
    # PR-1 telemetry: 403 flag set on the mid-stream block path.
    assert s.http_403_seen is True
    assert s.cold_start_timed_out is False


@pytest.mark.asyncio
async def test_auth_error_mid_stream_keeps_first_page(page1_body):
    body_expired = {"data": {"loginRequired": True, "goodsReviewList": []}}
    session = FakeBrowserReviewSession([(200, page1_body), (200, body_expired)])
    c, params = _build_connector(session)

    raws = await c.collect(keyword="x", params=params)

    # 9, not 10: page 1 fixture has 1 sibling-goodsNumber row that
    # the new goods-filter drops on the test's PRODUCT_URL.
    assert len(raws) == 9
    s = c.last_run_summary
    assert s.auth_error is True
    assert s.blocked is False
    # PR-1 telemetry: mid-stream auth break has its own flag distinct from
    # cold-start auth.
    assert s.mid_stream_auth_break is True
    assert s.http_401_or_login_required_seen is True


@pytest.mark.asyncio
async def test_scroll_retries_before_giving_up(page1_body, caplog):
    # First page ok (hasNext=True), then 3 timeouts → stop gracefully.
    session = FakeBrowserReviewSession([(200, page1_body), None, None, None])
    c, params = _build_connector(session)

    import logging
    with caplog.at_level(logging.WARNING):
        raws = await c.collect(keyword="x", params=params)

    # 9, not 10: page 1 fixture has 1 sibling-goodsNumber row that
    # the new goods-filter drops on the test's PRODUCT_URL.
    assert len(raws) == 9
    # MAX_SCROLL_ATTEMPTS_PER_PAGE = 3 → exactly 3 scrolls attempted.
    assert session.scroll_calls == OliveYoungBrowserAPIConnector.MAX_SCROLL_ATTEMPTS_PER_PAGE
    s = c.last_run_summary
    assert s.blocked is False  # gave up cleanly, not blocked
    assert any("no continuation" in r for r in s.sample_dropped_reasons)
    # Post-condition: hasNext=True was on the last parsed body, so the
    # connector must shout the silent-incompleteness warning (else operators
    # see a clean-looking summary while data is missing).
    assert any("incomplete_collection" in r for r in s.sample_dropped_reasons)
    assert any(
        "incomplete_collection" in rec.message and rec.levelno >= logging.WARNING
        for rec in caplog.records
    )
    # PR-1 telemetry: explicit boolean for incomplete_collection plus
    # last_observed_has_next captured for diagnosis.
    assert s.incomplete_collection is True
    assert s.last_observed_has_next is True
    assert s.pagination_exhausted is False  # break-out, not clean exhaustion


@pytest.mark.asyncio
async def test_scroll_retry_recovers_on_later_attempt(page1_body, page2_last):
    # First scroll → timeout, second scroll → success.
    session = FakeBrowserReviewSession([
        (200, page1_body),
        None,               # first scroll misses
        (200, page2_last),  # second scroll wins
    ])
    c, params = _build_connector(session)

    raws = await c.collect(keyword="x", params=params)

    # 18, not 20: the saved fixtures contain 1 sibling-goodsNumber row
    # per page (A000000205145) which the new goods-filter drops on
    # PRODUCT_URL=goodsNo=A000000238828. See parse_response_body's
    # `target_goods_no` semantics. The pre-filter count is still 20
    # (asserted via `raw_records_seen` where the test exposes it).
    assert len(raws) == 18
    assert session.scroll_calls == 2
    assert c.last_run_summary.blocked is False


@pytest.mark.asyncio
async def test_no_incomplete_warning_on_clean_termination(page1_body, page2_last, caplog):
    """Happy path: last body has hasNext=False → no incompleteness warning."""
    import logging
    session = FakeBrowserReviewSession([(200, page1_body), (200, page2_last)])
    c, params = _build_connector(session)

    with caplog.at_level(logging.WARNING):
        await c.collect(keyword="x", params=params)

    s = c.last_run_summary
    assert not any("incomplete_collection" in r for r in s.sample_dropped_reasons)
    assert not any("incomplete_collection" in rec.message for rec in caplog.records)
    # PR-1 telemetry: clean run sets pagination_exhausted, not incomplete.
    assert s.incomplete_collection is False
    assert s.pagination_exhausted is True
    assert s.last_observed_has_next is False


@pytest.mark.asyncio
async def test_no_incomplete_warning_when_quota_triggers_stop(page1_body):
    """Quota-reached stop with hasNext=True is user-requested, not incomplete."""
    session = FakeBrowserReviewSession([(200, page1_body)])
    c, params = _build_connector(session, max_results=9)  # exactly matches page1 (post goods-filter)

    await c.collect(keyword="x", params=params)
    s = c.last_run_summary
    assert not any("incomplete_collection" in r for r in s.sample_dropped_reasons)
    # PR-1 telemetry: quota stop with hasNext=True is NOT clean exhaustion.
    # Neither incomplete_collection nor pagination_exhausted should fire here.
    assert s.incomplete_collection is False
    assert s.pagination_exhausted is False
    assert s.last_observed_has_next is True


@pytest.mark.asyncio
async def test_incomplete_warning_on_malformed_streak_with_has_next_true(
    page1_body, caplog,
):
    """Malformed-streak termination with hasNext=True triggers the visible warning."""
    import logging
    session = FakeBrowserReviewSession([
        (200, page1_body),
        (200, None), (200, None), (200, None),  # 3 malformed → circuit break
    ])
    c, params = _build_connector(session)

    with caplog.at_level(logging.WARNING):
        await c.collect(keyword="x", params=params)

    s = c.last_run_summary
    assert any("incomplete_collection" in r for r in s.sample_dropped_reasons)
    assert any(
        "incomplete_collection" in rec.message and rec.levelno >= logging.WARNING
        for rec in caplog.records
    )


@pytest.mark.asyncio
async def test_three_consecutive_malformed_mid_stream_stops(page1_body):
    # Page 1 ok → continuation returns 3 malformed in a row → circuit breaker.
    session = FakeBrowserReviewSession([
        (200, page1_body),
        (200, None),  # malformed #1
        (200, None),  # malformed #2
        (200, None),  # malformed #3
    ])
    c, params = _build_connector(session)

    raws = await c.collect(keyword="x", params=params)

    # 9, not 10: page 1 fixture has 1 sibling-goodsNumber row that
    # the new goods-filter drops on the test's PRODUCT_URL.
    assert len(raws) == 9
    s = c.last_run_summary
    assert s.parse_warnings == 3
    assert s.blocked is False
    assert s.auth_error is False
    assert any("consecutive" in r for r in s.sample_dropped_reasons)


# ---------------------------------------------------------------------------
# resource hygiene
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_session_close_is_called_on_exception_in_open():
    class BrokenSession(FakeBrowserReviewSession):
        async def open(self, product_url: str) -> None:
            await super().open(product_url)
            raise RuntimeError("navigation failed")

    session = BrokenSession([])
    c, params = _build_connector(session)

    with pytest.raises(RuntimeError, match="navigation failed"):
        await c.collect(keyword="x", params=params)

    assert session.close_calls == 1


@pytest.mark.asyncio
async def test_session_close_failure_is_swallowed(page1_body, page2_last, caplog):
    class NoisyCloseSession(FakeBrowserReviewSession):
        async def close(self) -> None:
            await super().close()
            raise RuntimeError("close exploded")

    session = NoisyCloseSession([(200, page1_body), (200, page2_last)])
    c, params = _build_connector(session)

    import logging
    with caplog.at_level(logging.WARNING):
        raws = await c.collect(keyword="x", params=params)

    # 18, not 20: the saved fixtures contain 1 sibling-goodsNumber row
    # per page (A000000205145) which the new goods-filter drops on
    # PRODUCT_URL=goodsNo=A000000238828. See parse_response_body's
    # `target_goods_no` semantics. The pre-filter count is still 20
    # (asserted via `raw_records_seen` where the test exposes it).
    assert len(raws) == 18  # parse results preserved despite close failure
    assert any("session close failed" in r.message for r in caplog.records)


# ---------------------------------------------------------------------------
# Playwright soft-dep: default session factory must fail cleanly if missing
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_default_session_factory_raises_clear_error_when_playwright_missing(
    monkeypatch,
):
    """If playwright is not installed, `collect()` must raise RuntimeError with
    an install hint — not an import error bubbling out of the type system."""
    import builtins
    real_import = builtins.__import__

    def _fake_import(name, globals=None, locals=None, fromlist=(), level=0):
        if name.startswith("playwright"):
            raise ImportError("No module named 'playwright'")
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", _fake_import)
    c = OliveYoungBrowserAPIConnector(product_url=PRODUCT_URL)  # no session_factory

    with pytest.raises(RuntimeError, match="playwright"):
        await c.collect(keyword="x")


# ---------------------------------------------------------------------------
# PR-1 hardening: configurable timeouts + scroll attempts
# ---------------------------------------------------------------------------

def test_default_timeouts_match_class_constants():
    """Constructor with no timeout overrides falls back to the class constants.

    Guards backward compatibility for callers that don't pass the new
    parameters — behavior must be identical to pre-PR-1.
    """
    c = OliveYoungBrowserAPIConnector(product_url=PRODUCT_URL)
    assert c._cold_start_timeout_s == OliveYoungBrowserAPIConnector.COLD_START_TIMEOUT_S
    assert c._page_n_timeout_s == OliveYoungBrowserAPIConnector.PAGE_N_TIMEOUT_S
    assert c._max_scroll_attempts == OliveYoungBrowserAPIConnector.MAX_SCROLL_ATTEMPTS_PER_PAGE


def test_timeout_overrides_are_applied():
    """Per-instance timeout/scroll overrides take precedence over class constants."""
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        cold_start_timeout_s=60.0,
        page_n_timeout_s=15.0,
        max_scroll_attempts_per_page=5,
    )
    assert c._cold_start_timeout_s == 60.0
    assert c._page_n_timeout_s == 15.0
    assert c._max_scroll_attempts == 5


def test_class_constants_remain_visible_on_class():
    """Existing call sites reference class-level constants directly (e.g.
    OliveYoungBrowserAPIConnector.MAX_SCROLL_ATTEMPTS_PER_PAGE in tests).
    PR-1 keeps them available for backward compatibility."""
    assert hasattr(OliveYoungBrowserAPIConnector, "COLD_START_TIMEOUT_S")
    assert hasattr(OliveYoungBrowserAPIConnector, "PAGE_N_TIMEOUT_S")
    assert hasattr(OliveYoungBrowserAPIConnector, "MAX_SCROLL_ATTEMPTS_PER_PAGE")


@pytest.mark.asyncio
async def test_cold_start_timeout_param_is_used_by_collect(monkeypatch):
    """Connector constructed with a custom cold_start_timeout passes that value
    through to the session's wait_for_next_response."""
    observed: list[float] = []

    class TimeoutObservingSession(FakeBrowserReviewSession):
        async def wait_for_next_response(self, *, timeout_s: float):
            observed.append(timeout_s)
            return await super().wait_for_next_response(timeout_s=timeout_s)

    session = TimeoutObservingSession([None])  # cold-start timeout
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        session_factory=lambda: session,
        cold_start_timeout_s=2.5,
    )
    await c.collect(keyword="x", params=CollectParams(max_results=10))

    # The first wait_for_next_response is the cold start; it must receive 2.5.
    assert observed, "wait_for_next_response was never called"
    assert observed[0] == 2.5
    assert c.last_run_summary.cold_start_timed_out is True


@pytest.mark.asyncio
async def test_continuation_timeout_param_is_used_by_collect(page1_body):
    """Connector constructed with a custom page_n_timeout_s passes that value
    through to the per-continuation wait."""
    observed: list[float] = []

    class TimeoutObservingSession(FakeBrowserReviewSession):
        async def wait_for_next_response(self, *, timeout_s: float):
            observed.append(timeout_s)
            return await super().wait_for_next_response(timeout_s=timeout_s)

    # cold-start ok → scroll → timeout (None) once is enough to observe
    # the per-continuation timeout value.
    session = TimeoutObservingSession([(200, page1_body), None, None, None])
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        session_factory=lambda: session,
        cold_start_timeout_s=30.0,
        page_n_timeout_s=4.5,
    )
    await c.collect(keyword="x", params=CollectParams(max_results=100))

    assert observed[0] == 30.0  # cold start
    # Subsequent waits are continuation waits — all should be the override.
    for t in observed[1:]:
        assert t == 4.5


@pytest.mark.asyncio
async def test_scroll_attempts_param_caps_retries(page1_body):
    """Custom max_scroll_attempts_per_page caps the number of scroll attempts
    per next-page request when continuations time out."""
    # cold-start ok, then enough Nones to exceed any reasonable scroll cap.
    session = FakeBrowserReviewSession(
        [(200, page1_body)] + [None] * 20,
    )
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        session_factory=lambda: session,
        max_scroll_attempts_per_page=2,  # tighter than default of 3
    )
    await c.collect(keyword="x", params=CollectParams(max_results=100))

    # Exactly 2 scroll attempts on the single next-page request before
    # the connector gives up on continuation.
    assert session.scroll_calls == 2


# ---------------------------------------------------------------------------
# PR-1 telemetry: stable serialization across schema additions
# ---------------------------------------------------------------------------

def test_summary_serializes_new_fields_with_defaults():
    """A pre-PR-1 summary record (only legacy fields) must deserialize cleanly
    via ConnectorRunSummary; new fields take their defaults."""
    from datetime import datetime
    from src.voc.app.connector_run_summary import ConnectorRunSummary

    legacy_payload = {
        "run_id": "r1", "channel": "oliveyoung",
        "requested_target": "https://example", "started_at": datetime.now(),
    }
    s = ConnectorRunSummary.model_validate(legacy_payload)
    # Legacy defaults preserved
    assert s.blocked is False
    assert s.auth_error is False
    # PR-1 fields populated with defaults
    assert s.cold_start_timed_out is False
    assert s.http_403_seen is False
    assert s.http_429_seen is False
    assert s.http_401_or_login_required_seen is False
    assert s.mid_stream_auth_break is False
    assert s.incomplete_collection is False
    assert s.pagination_exhausted is False
    assert s.last_observed_has_next is None
    # PR-2 fields populated with defaults
    assert s.auth_retry_attempts_used == 0
    assert s.auth_retry_exhausted is False
    assert s.partial_debug_artifact_path is None


# ---------------------------------------------------------------------------
# PR-2 hardening: opt-in auth retry / resume + debug artifacts
# ---------------------------------------------------------------------------

def test_constructor_rejects_negative_auth_retry():
    """auth_retry must be >= 0; negative values are user error."""
    with pytest.raises(ValueError, match="auth_retry must be >= 0"):
        OliveYoungBrowserAPIConnector(product_url=PRODUCT_URL, auth_retry=-1)


def test_default_pr2_constructor_params():
    """Constructor without PR-2 overrides matches PR-1 behavior exactly."""
    c = OliveYoungBrowserAPIConnector(product_url=PRODUCT_URL)
    assert c._auth_retry == 0
    assert c._debug_dir is None
    assert c._capture_partial_on_invalid is False


# ---- auth retry behavior ----

@pytest.mark.asyncio
async def test_auth_retry_default_off_preserves_pr1_behavior(page1_body):
    """auth_retry=0 (default): mid-stream auth_break still terminates with
    auth_error=True, no retry attempted, no auth_retry telemetry."""
    body_expired = {"data": {"loginRequired": True, "goodsReviewList": []}}
    session = FakeBrowserReviewSession([(200, page1_body), (200, body_expired)])
    c, params = _build_connector(session)  # auth_retry not set → 0

    raws = await c.collect(keyword="x", params=params)

    # Still 10 rows from page 1
    # 9, not 10: page 1 fixture has 1 sibling-goodsNumber row that
    # the new goods-filter drops on the test's PRODUCT_URL.
    assert len(raws) == 9
    s = c.last_run_summary
    assert s.auth_error is True
    assert s.mid_stream_auth_break is True
    # PR-2: no retry was attempted, no telemetry change
    assert s.auth_retry_attempts_used == 0
    assert s.auth_retry_exhausted is False
    # Session opened exactly once
    assert session.open_calls == 1


@pytest.mark.asyncio
async def test_auth_retry_one_attempt_recovers_via_session_rebuild(
    page1_body, page2_last,
):
    """auth_retry=1: mid-stream auth_break triggers session rebuild;
    retry attempt sees full pagination on a fresh session and recovers."""
    body_expired = {"data": {"loginRequired": True, "goodsReviewList": []}}
    # Sequence: original cold-start ok → continuation auth_break →
    # retry cold-start ok (page1 again) → retry continuation page2_last.
    # The fake's queue advances through both attempts in order.
    session = FakeBrowserReviewSession([
        (200, page1_body),  # attempt 0 cold-start
        (200, body_expired),  # attempt 0 continuation: auth break
        (200, page1_body),  # attempt 1 cold-start (after retry)
        (200, page2_last),  # attempt 1 continuation: completes
    ])
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
        auth_retry=1,
    )
    params = CollectParams(max_results=100)
    raws = await c.collect(keyword="x", params=params)

    # Page 1 records appear once each — the retry's re-scrape of page 1
    # was deduplicated against the seen-id set, so only NEW records (page 2)
    # were added on the retry.
    # 18, not 20: the saved fixtures contain 1 sibling-goodsNumber row
    # per page (A000000205145) which the new goods-filter drops on
    # PRODUCT_URL=goodsNo=A000000238828. See parse_response_body's
    # `target_goods_no` semantics. The pre-filter count is still 20
    # (asserted via `raw_records_seen` where the test exposes it).
    assert len(raws) == 18  # 10 page-1 + 10 page-2

    s = c.last_run_summary
    # Recovery succeeded: final auth_error is False
    assert s.auth_error is False
    # The mid-stream auth break DID happen (fact about the run)
    assert s.mid_stream_auth_break is True
    assert s.http_401_or_login_required_seen is True
    # PR-2 retry telemetry
    assert s.auth_retry_attempts_used == 1
    assert s.auth_retry_exhausted is False
    # Session was rebuilt once → open called twice (initial + retry)
    assert session.open_calls == 2
    assert session.close_calls == 2  # one pre-retry + one in finally


@pytest.mark.asyncio
async def test_auth_retry_dedups_rows_via_seen_ids(page1_body, page2_last):
    """When the retry re-scrapes the same page, the source_id seen-set
    prevents duplicate RawReviews from entering `raws`."""
    body_expired = {"data": {"loginRequired": True, "goodsReviewList": []}}
    session = FakeBrowserReviewSession([
        (200, page1_body),
        (200, body_expired),
        (200, page1_body),  # retry sees the SAME records as attempt 0
        (200, page2_last),
    ])
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
        auth_retry=1,
    )
    raws = await c.collect(keyword="x", params=CollectParams(max_results=100))

    # 10 unique source_ids from page 1 + 10 unique from page 2 = 20.
    # 18, not 20: the saved fixtures contain 1 sibling-goodsNumber row
    # per page (A000000205145) which the new goods-filter drops on
    # PRODUCT_URL=goodsNo=A000000238828. See parse_response_body's
    # `target_goods_no` semantics. The pre-filter count is still 20
    # (asserted via `raw_records_seen` where the test exposes it).
    assert len(raws) == 18
    source_ids = [r.source_id for r in raws]
    assert len(source_ids) == len(set(source_ids))  # all unique


@pytest.mark.asyncio
async def test_auth_retry_exhausted_is_invalid(page1_body):
    """auth_retry=1: if every retry also hits auth_break, final state is
    invalid with auth_retry_exhausted=True."""
    body_expired = {"data": {"loginRequired": True, "goodsReviewList": []}}
    session = FakeBrowserReviewSession([
        (200, page1_body),  # attempt 0 cold-start
        (200, body_expired),  # attempt 0 continuation: auth break
        (200, page1_body),  # attempt 1 cold-start
        (200, body_expired),  # attempt 1 continuation: auth break again
    ])
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
        auth_retry=1,
    )
    raws = await c.collect(keyword="x", params=CollectParams(max_results=100))

    # 9, not 10: page 1 fixture has 1 sibling-goodsNumber row that
    # the new goods-filter drops on the test's PRODUCT_URL.
    assert len(raws) == 9  # only page 1 (deduped on retry)
    s = c.last_run_summary
    assert s.auth_error is True
    assert s.mid_stream_auth_break is True
    assert s.auth_retry_attempts_used == 1
    assert s.auth_retry_exhausted is True


@pytest.mark.asyncio
async def test_auth_retry_cold_start_failure_does_not_consume_more_retries(
    page1_body,
):
    """If a retry's cold-start hits auth_error (not mid-stream), per PR-2 spec
    we do NOT attempt further retries — only mid_stream_auth_break is
    retryable."""
    body_expired = {"data": {"loginRequired": True, "goodsReviewList": []}}
    session = FakeBrowserReviewSession([
        (200, page1_body),  # attempt 0 cold-start
        (200, body_expired),  # attempt 0 continuation: auth break
        (200, body_expired),  # attempt 1 cold-start: also auth, but cold-start
        # No further retry attempted because cold-start failure is non-retryable
    ])
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
        auth_retry=2,  # budget allows 2 retries, but we only use 1
    )
    raws = await c.collect(keyword="x", params=CollectParams(max_results=100))

    # 9, not 10: page 1 fixture has 1 sibling-goodsNumber row that
    # the new goods-filter drops on the test's PRODUCT_URL.
    assert len(raws) == 9  # page 1 only
    s = c.last_run_summary
    assert s.auth_error is True
    assert s.auth_retry_attempts_used == 1  # used one retry slot
    # auth_retry_exhausted because final state is auth_error AND we used a retry
    assert s.auth_retry_exhausted is True
    # session opened twice (initial + 1 retry); third would have required another retry
    assert session.open_calls == 2


# ---- partial-rows debug artifact ----

@pytest.mark.asyncio
async def test_partial_artifact_not_written_by_default(tmp_path, page1_body):
    """Default: --debug-dir not set → no artifact written even on invalid run."""
    body_expired = {"data": {"loginRequired": True, "goodsReviewList": []}}
    session = FakeBrowserReviewSession([(200, page1_body), (200, body_expired)])
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
        # debug_dir not set; capture_partial_on_invalid not set
    )
    await c.collect(keyword="x", params=CollectParams(max_results=100))
    # No JSONL exists anywhere under tmp_path
    assert list(tmp_path.iterdir()) == []
    assert c.last_run_summary.partial_debug_artifact_path is None


@pytest.mark.asyncio
async def test_partial_artifact_not_written_without_opt_in(tmp_path, page1_body):
    """--debug-dir set but --capture-partial-on-invalid not set → no write."""
    body_expired = {"data": {"loginRequired": True, "goodsReviewList": []}}
    session = FakeBrowserReviewSession([(200, page1_body), (200, body_expired)])
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
        debug_dir=tmp_path,
        capture_partial_on_invalid=False,  # explicit off
    )
    await c.collect(keyword="x", params=CollectParams(max_results=100))
    assert list(tmp_path.iterdir()) == []
    assert c.last_run_summary.partial_debug_artifact_path is None


@pytest.mark.asyncio
async def test_partial_artifact_written_when_both_flags_set_and_invalid(
    tmp_path, page1_body,
):
    """Both flags set + invalid run + parsed rows exist → JSONL is written."""
    body_expired = {"data": {"loginRequired": True, "goodsReviewList": []}}
    session = FakeBrowserReviewSession([(200, page1_body), (200, body_expired)])
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
        debug_dir=tmp_path,
        capture_partial_on_invalid=True,
    )
    await c.collect(keyword="x", params=CollectParams(max_results=100))

    s = c.last_run_summary
    assert s.partial_debug_artifact_path is not None
    artifact_path = Path(s.partial_debug_artifact_path)
    assert artifact_path.exists()
    assert artifact_path.parent == tmp_path
    assert artifact_path.name.startswith("oy_browser_partial_")
    assert artifact_path.suffix == ".jsonl"

    # Verify JSONL contents — one record per parsed row, each with the
    # operator-relevant fields for offline inspection.
    lines = artifact_path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 9  # 9 target rows; 1 sibling-goodsNumber row filtered
    first = json.loads(lines[0])
    assert first["run_id"] == s.run_id
    assert first["product_url"] == PRODUCT_URL
    assert "collected_at" in first
    assert first["record_index"] == 0
    raw_review = first["raw_review"]
    # Inspectable: source_id, raw_text, raw_rating, raw_date,
    # plus product option (in raw_metadata) — enough for diagnosis.
    assert "source_id" in raw_review
    assert "raw_text" in raw_review
    assert "raw_rating" in raw_review
    assert "raw_date" in raw_review
    assert raw_review["source_channel"] == "oliveyoung"


@pytest.mark.asyncio
async def test_partial_artifact_written_on_incomplete_collection(
    tmp_path, page1_body,
):
    """Even when not invalid (no auth/blocked), an incomplete_collection run
    with parsed rows still warrants a debug artifact."""
    # page1 has hasNext=True; 3 timeouts during continuation → no auth/blocked,
    # but incomplete_collection=True.
    session = FakeBrowserReviewSession([(200, page1_body), None, None, None])
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
        debug_dir=tmp_path,
        capture_partial_on_invalid=True,
    )
    await c.collect(keyword="x", params=CollectParams(max_results=100))

    s = c.last_run_summary
    assert s.blocked is False
    assert s.auth_error is False
    assert s.incomplete_collection is True
    assert s.partial_debug_artifact_path is not None
    assert Path(s.partial_debug_artifact_path).exists()


@pytest.mark.asyncio
async def test_partial_artifact_not_written_on_clean_run(
    tmp_path, page1_body, page2_last,
):
    """A fully clean run (no auth, no block, no incomplete) does NOT emit
    an artifact even when both flags are set."""
    session = FakeBrowserReviewSession([(200, page1_body), (200, page2_last)])
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
        debug_dir=tmp_path,
        capture_partial_on_invalid=True,
    )
    await c.collect(keyword="x", params=CollectParams(max_results=100))

    assert c.last_run_summary.partial_debug_artifact_path is None
    assert list(tmp_path.iterdir()) == []


@pytest.mark.asyncio
async def test_partial_artifact_skips_when_no_rows(tmp_path):
    """Cold-start timeout means raws is empty; nothing useful to write,
    so the artifact is skipped to avoid creating a misleading 0-line file."""
    session = FakeBrowserReviewSession([None])  # cold-start times out
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
        debug_dir=tmp_path,
        capture_partial_on_invalid=True,
    )
    await c.collect(keyword="x", params=CollectParams(max_results=100))

    assert c.last_run_summary.blocked is True
    assert c.last_run_summary.partial_debug_artifact_path is None
    assert list(tmp_path.iterdir()) == []


@pytest.mark.asyncio
async def test_partial_artifact_creates_debug_dir_if_missing(
    tmp_path, page1_body,
):
    """If --debug-dir points at a missing directory, the connector creates it."""
    nested = tmp_path / "subdir" / "more"
    assert not nested.exists()
    body_expired = {"data": {"loginRequired": True, "goodsReviewList": []}}
    session = FakeBrowserReviewSession([(200, page1_body), (200, body_expired)])
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
        debug_dir=nested,
        capture_partial_on_invalid=True,
    )
    await c.collect(keyword="x", params=CollectParams(max_results=100))

    assert nested.exists()
    artifact_path = Path(c.last_run_summary.partial_debug_artifact_path)
    assert artifact_path.parent == nested


# ---- retry + artifact interaction ----

@pytest.mark.asyncio
async def test_artifact_written_on_retry_exhausted_with_recovered_rows(
    tmp_path, page1_body,
):
    """Combined: retry exhausted (final invalid) + capture-partial → artifact
    contains all unique rows captured across attempts (page 1 only here, since
    every retry also fails)."""
    body_expired = {"data": {"loginRequired": True, "goodsReviewList": []}}
    session = FakeBrowserReviewSession([
        (200, page1_body),
        (200, body_expired),
        (200, page1_body),  # retry's cold-start
        (200, body_expired),  # retry's continuation: auth break again
    ])
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
        auth_retry=1,
        debug_dir=tmp_path,
        capture_partial_on_invalid=True,
    )
    await c.collect(keyword="x", params=CollectParams(max_results=100))

    s = c.last_run_summary
    assert s.auth_error is True
    assert s.auth_retry_exhausted is True
    assert s.partial_debug_artifact_path is not None
    artifact = Path(s.partial_debug_artifact_path)
    lines = artifact.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 9  # 9 unique page-1 target rows (deduped across attempts); 1 sibling filtered


@pytest.mark.asyncio
async def test_artifact_not_written_on_clean_recovered_run(
    tmp_path, page1_body, page2_last,
):
    """Retry recovered fully + clean termination → quality is degraded (retry
    happened), but the gate's "invalid/blocked/incomplete" condition is False
    so no artifact is written."""
    body_expired = {"data": {"loginRequired": True, "goodsReviewList": []}}
    session = FakeBrowserReviewSession([
        (200, page1_body),
        (200, body_expired),
        (200, page1_body),
        (200, page2_last),  # retry continuation completes cleanly
    ])
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
        auth_retry=1,
        debug_dir=tmp_path,
        capture_partial_on_invalid=True,
    )
    await c.collect(keyword="x", params=CollectParams(max_results=100))

    s = c.last_run_summary
    assert s.auth_error is False  # recovered
    assert s.auth_retry_attempts_used == 1
    # partial-artifact gate: blocked OR auth_error OR incomplete_collection
    # All three are False for a recovered clean run → no artifact.
    assert s.partial_debug_artifact_path is None
    # PR-4 added the trace artifact (always-on with --debug-dir). Filter
    # to NON-trace artifacts for the partial-only assertion.
    leftover = [p for p in tmp_path.iterdir() if not p.name.startswith("oy_browser_trace_")]
    assert leftover == []


# ---------------------------------------------------------------------------
# PR-4 hardening: request-side capture + cursor persistence
# ---------------------------------------------------------------------------

# Helper: build a synthetic request-log entry mirroring the shape that
# `_PlaywrightReviewSession._on_response` produces. Tests use this to drive
# `FakeBrowserReviewSession.request_log` without needing a real browser.
def _trace_entry(idx, *, status=200, tag="ok", next_cursor=None,
                 has_next=True, record_count=10, login_required=False,
                 cookie_present=True, auth_header_present=False,
                 url=None):
    return {
        "request_index": idx,
        "timestamp": "2026-04-25T00:00:00",
        "request": {
            "method": "GET",
            "url": url or f"https://www.oliveyoung.co.kr/review/api/v2/reviews/cursor?goodsNo=A000000238828&cursor={idx}",
            "query_params": {"goodsNo": "A000000238828", "cursor": str(idx)},
            "headers_sample": {"accept": "application/json", "accept-language": "ko-KR"},
            "cookie_present": cookie_present,
            "auth_header_present": auth_header_present,
            "redacted_headers": ["cookie"] if cookie_present else [],
        },
        "response": {
            "status": status,
            "tag": tag,
            "next_cursor_id": str(next_cursor) if next_cursor is not None else None,
            "has_next": has_next,
            "record_count": record_count,
            "login_required": login_required,
        },
    }


# ---- Header redaction (pure-function) ----

def test_redact_request_headers_strips_cookie_and_auth():
    """Sensitive headers are NEVER returned verbatim; presence is recorded."""
    from src.voc.connectors.oliveyoung_browser_api import _redact_request_headers

    headers = {
        "cookie": "session=abc; csrf=xyz",
        "Authorization": "Bearer secret-token-12345",
        "Accept": "application/json",
        "Accept-Language": "ko-KR",
        "X-CSRF-Token": "csrf-token-content",
        "X-Custom-Auth": "should-be-dropped",  # not in safe list, not in sensitive list
    }
    out = _redact_request_headers(headers)
    assert out["cookie_present"] is True
    assert out["auth_header_present"] is True
    assert "cookie" in out["redacted_headers"]
    assert "authorization" in out["redacted_headers"]
    # Safe headers preserved
    assert out["headers_sample"]["accept"] == "application/json"
    assert out["headers_sample"]["accept-language"] == "ko-KR"
    # Sensitive headers' values are never in the output anywhere
    serialized = json.dumps(out)
    assert "secret-token" not in serialized
    assert "csrf-token-content" not in serialized
    assert "session=abc" not in serialized
    # X-Custom-Auth wasn't in the safe list AND wasn't in the explicit sensitive
    # list, so it's dropped entirely (defensive default).
    assert "x-custom-auth" not in out["headers_sample"]
    assert "should-be-dropped" not in serialized


def test_redact_request_headers_no_sensitive():
    from src.voc.connectors.oliveyoung_browser_api import _redact_request_headers
    out = _redact_request_headers({"Accept": "*/*"})
    assert out["cookie_present"] is False
    assert out["auth_header_present"] is False
    assert out["redacted_headers"] == []


def test_extract_query_params_basic():
    from src.voc.connectors.oliveyoung_browser_api import _extract_query_params
    qp = _extract_query_params(
        "https://www.oliveyoung.co.kr/review/api/v2/reviews/cursor?goodsNo=ABC&cursor=42&pageSize=10"
    )
    assert qp == {"goodsNo": "ABC", "cursor": "42", "pageSize": "10"}


def test_extract_query_params_handles_empty():
    from src.voc.connectors.oliveyoung_browser_api import _extract_query_params
    assert _extract_query_params("https://example/no/query") == {}


def test_extract_response_cursor_meta_ok_body():
    from src.voc.connectors.oliveyoung_browser_api import _extract_response_cursor_meta
    body = {
        "data": {
            "goodsReviewList": [{}, {}, {}, {}, {}],
            "nextCursorId": 12345,
            "hasNext": True,
            "loginRequired": False,
        }
    }
    meta = _extract_response_cursor_meta(body, 200)
    assert meta == {
        "next_cursor_id": "12345",
        "has_next": True,
        "record_count": 5,
        "login_required": False,
    }


def test_extract_response_cursor_meta_loginrequired():
    from src.voc.connectors.oliveyoung_browser_api import _extract_response_cursor_meta
    body = {"data": {"goodsReviewList": [], "loginRequired": True, "hasNext": True}}
    meta = _extract_response_cursor_meta(body, 200)
    assert meta["login_required"] is True
    assert meta["has_next"] is True
    assert meta["record_count"] == 0


def test_extract_response_cursor_meta_non_200_returns_none_fields():
    from src.voc.connectors.oliveyoung_browser_api import _extract_response_cursor_meta
    meta = _extract_response_cursor_meta(None, 403)
    assert meta == {
        "next_cursor_id": None,
        "has_next": None,
        "record_count": None,
        "login_required": None,
    }


# ---- Connector summary plumbing ----

@pytest.mark.asyncio
async def test_summary_pr4_defaults_when_session_logs_empty(page1_body, page2_last):
    """A session that doesn't populate request_log leaves PR-4 fields at
    their backward-compatible defaults. No regression for existing tests."""
    session = FakeBrowserReviewSession([(200, page1_body), (200, page2_last)])
    c, params = _build_connector(session)
    await c.collect(keyword="x", params=params)
    s = c.last_run_summary
    # PR-4 defaults: request_log was empty, so derived fields stay default
    assert s.review_api_request_count == 0
    assert s.review_api_response_count == 0
    assert s.cursor_sequence == []
    assert s.last_known_cursor is None
    assert s.failed_at_request_index is None
    assert s.login_state_observed is None  # fake didn't set login_state
    assert s.trace_artifact_path is None  # no debug_dir


@pytest.mark.asyncio
async def test_cursor_sequence_populated_from_request_log(page1_body, page2_last):
    """When session reports a request log with successful responses, the
    summary's cursor_sequence captures every nextCursorId in order."""
    session = FakeBrowserReviewSession(
        [(200, page1_body), (200, page2_last)],
        request_log=[
            _trace_entry(0, next_cursor="cursor-a", has_next=True),
            _trace_entry(1, next_cursor="cursor-b", has_next=False),
        ],
    )
    c, params = _build_connector(session)
    await c.collect(keyword="x", params=params)
    s = c.last_run_summary
    assert s.cursor_sequence == ["cursor-a", "cursor-b"]
    assert s.last_known_cursor == "cursor-b"
    assert s.review_api_request_count == 2
    assert s.review_api_response_count == 2
    assert s.failed_at_request_index is None  # all OK


@pytest.mark.asyncio
async def test_failed_at_request_index_set_on_auth_break(page1_body):
    """Mid-stream auth_error → failed_at_request_index = the 1-indexed
    request that returned the auth response."""
    body_expired = {"data": {"loginRequired": True, "goodsReviewList": []}}
    session = FakeBrowserReviewSession(
        [(200, page1_body), (200, body_expired)],
        request_log=[
            _trace_entry(0, next_cursor="cursor-a", has_next=True),
            _trace_entry(1, status=200, tag="auth_error",
                         next_cursor=None, has_next=True,
                         record_count=0, login_required=True),
        ],
    )
    c, params = _build_connector(session)
    await c.collect(keyword="x", params=params)
    s = c.last_run_summary
    # 1-indexed: the 2nd request was the failure
    assert s.failed_at_request_index == 2
    assert s.cursor_sequence == ["cursor-a"]
    assert s.last_known_cursor == "cursor-a"
    assert s.auth_error is True


@pytest.mark.asyncio
async def test_failed_at_request_index_on_cold_start_block():
    """Cold-start 403 → failed_at_request_index = 1 (only one request seen)."""
    session = FakeBrowserReviewSession(
        [(403, None)],
        request_log=[
            _trace_entry(0, status=403, tag="blocked", record_count=None,
                         next_cursor=None, has_next=None,
                         login_required=None),
        ],
    )
    c, params = _build_connector(session)
    await c.collect(keyword="x", params=params)
    s = c.last_run_summary
    assert s.failed_at_request_index == 1
    assert s.cursor_sequence == []
    assert s.last_known_cursor is None


@pytest.mark.asyncio
async def test_login_state_observed_threaded_through(page1_body, page2_last):
    """Connector calls session.observe_login_state once on attempt 0; result
    is recorded in summary."""
    session = FakeBrowserReviewSession(
        [(200, page1_body), (200, page2_last)],
        login_state="logged_in",
    )
    c, params = _build_connector(session)
    await c.collect(keyword="x", params=params)
    assert c.last_run_summary.login_state_observed == "logged_in"


@pytest.mark.asyncio
async def test_login_state_unknown_when_session_returns_none(page1_body, page2_last):
    """When session.observe_login_state returns None (probe not run),
    summary preserves None — quality gate ignores it either way."""
    session = FakeBrowserReviewSession(
        [(200, page1_body), (200, page2_last)],
        login_state=None,
    )
    c, params = _build_connector(session)
    await c.collect(keyword="x", params=params)
    assert c.last_run_summary.login_state_observed is None


# ---- Trace artifact JSONL ----

@pytest.mark.asyncio
async def test_trace_artifact_written_when_debug_dir_set(
    tmp_path, page1_body, page2_last,
):
    """--debug-dir + non-empty request_log → trace JSONL lands. Always-on,
    even on clean runs (unlike the partial artifact)."""
    session = FakeBrowserReviewSession(
        [(200, page1_body), (200, page2_last)],
        request_log=[
            _trace_entry(0, next_cursor="cursor-a"),
            _trace_entry(1, next_cursor="cursor-b", has_next=False),
        ],
    )
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
        debug_dir=tmp_path,
    )
    await c.collect(keyword="x", params=CollectParams(max_results=100))
    s = c.last_run_summary
    assert s.trace_artifact_path is not None
    p = Path(s.trace_artifact_path)
    assert p.exists()
    assert p.parent == tmp_path
    assert p.name.startswith("oy_browser_trace_")
    lines = p.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2  # one per API call
    rec0 = json.loads(lines[0])
    assert rec0["run_id"] == s.run_id
    assert rec0["attempt_index"] == 0
    assert rec0["request_index"] == 0
    assert rec0["response"]["next_cursor_id"] == "cursor-a"


@pytest.mark.asyncio
async def test_trace_artifact_not_written_without_debug_dir(
    page1_body, page2_last, tmp_path,
):
    """Default — no --debug-dir → no trace artifact even if request_log present."""
    session = FakeBrowserReviewSession(
        [(200, page1_body), (200, page2_last)],
        request_log=[_trace_entry(0)],
    )
    c, params = _build_connector(session)  # no debug_dir
    await c.collect(keyword="x", params=params)
    assert c.last_run_summary.trace_artifact_path is None


@pytest.mark.asyncio
async def test_trace_artifact_redacts_cookies(tmp_path, page1_body):
    """The trace artifact NEVER contains raw cookie values. Even when the
    request_log entry was constructed with cookie_present=True, only the
    boolean and the safe-header subset land in the JSONL."""
    # Use a synthetic entry with cookie_present=True; the entry's
    # redacted_headers and headers_sample are the only places cookie info
    # appears, and the value is never in the entry by construction.
    session = FakeBrowserReviewSession(
        [(200, page1_body)],
        request_log=[_trace_entry(0, has_next=False, cookie_present=True)],
    )
    page1_last = copy.deepcopy(page1_body)
    page1_last["data"]["hasNext"] = False
    session._responses = [(200, page1_last)]
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
        debug_dir=tmp_path,
    )
    await c.collect(keyword="x", params=CollectParams(max_results=100))
    p = Path(c.last_run_summary.trace_artifact_path)
    text = p.read_text(encoding="utf-8")
    # Hard requirement: no cookie / authorization VALUE strings should ever
    # appear. The fake's _trace_entry only sets booleans, so this is a
    # test of the boundary itself.
    assert "session=abc" not in text  # synthetic value used in redact test
    assert "Bearer " not in text
    # Presence boolean visible
    rec = json.loads(text.splitlines()[0])
    assert rec["request"]["cookie_present"] is True
    assert "headers_sample" in rec["request"]
    assert "redacted_headers" in rec["request"]


@pytest.mark.asyncio
async def test_trace_artifact_attempt_index_tagged_across_retry(
    tmp_path, page1_body,
):
    """Each retry attempt's trace records carry the correct `attempt_index`
    so downstream analysis can split the trace by attempt."""
    body_expired = {"data": {"loginRequired": True, "goodsReviewList": []}}
    page1_clean = copy.deepcopy(page1_body)
    page1_clean["data"]["hasNext"] = False  # so retry's cold-start completes naturally
    # We need TWO sessions because retry rebuilds. Each session has its
    # own request_log. Use a session-factory that pops from a list.
    sess0 = FakeBrowserReviewSession(
        [(200, page1_body), (200, body_expired)],
        request_log=[
            _trace_entry(0, next_cursor="c0", has_next=True),
            _trace_entry(1, status=200, tag="auth_error", next_cursor=None,
                         login_required=True, record_count=0),
        ],
    )
    sess1 = FakeBrowserReviewSession(
        [(200, page1_clean)],
        request_log=[_trace_entry(0, next_cursor="c1-final", has_next=False)],
    )
    sessions = iter([sess0, sess1])
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: next(sessions),
        auth_retry=1,
        debug_dir=tmp_path,
    )
    await c.collect(keyword="x", params=CollectParams(max_results=100))
    p = Path(c.last_run_summary.trace_artifact_path)
    lines = [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines()]
    # 2 entries from attempt 0 (sess0 had 2) + 1 from attempt 1 (sess1 had 1)
    assert len(lines) == 3
    attempt_indices = [r["attempt_index"] for r in lines]
    assert attempt_indices == [0, 0, 1]
    # cursor_sequence picked up only the OK responses' cursors across attempts
    s = c.last_run_summary
    assert s.cursor_sequence == ["c0", "c1-final"]
    assert s.last_known_cursor == "c1-final"
    assert s.failed_at_request_index == 2  # 1-indexed across the whole run
    # Recovered: auth_error final state is False
    assert s.auth_error is False
    assert s.auth_retry_attempts_used == 1


# ---- Quality gate unchanged by PR-4 ----

@pytest.mark.asyncio
async def test_pr4_fields_do_not_change_quality_gate_for_clean_run(
    page1_body, page2_last,
):
    """Adding cursor / request-count / trace fields must NOT shift a clean
    run's classification. Backward-compat regression check."""
    session = FakeBrowserReviewSession(
        [(200, page1_body), (200, page2_last)],
        request_log=[
            _trace_entry(0, next_cursor="a"),
            _trace_entry(1, next_cursor="b", has_next=False),
        ],
        login_state="logged_in",
    )
    c, params = _build_connector(session)
    await c.collect(keyword="x", params=params)
    from src.voc.app.connector_run_summary import evaluate_quality_gates
    assert evaluate_quality_gates(c.last_run_summary) == "ok"


# ---------------------------------------------------------------------------
# Phase 2E sort-aware crawl: requested_sort_type + observed_sort_types +
# responses_filtered_out_by_sort summary fields
# ---------------------------------------------------------------------------

def _sort_trace_entry(idx, *, sort_type=None, forwarded=True, status=200,
                       tag="ok", next_cursor=None, has_next=True):
    """Build a trace entry that matches the new schema with `post_data_sort_type`
    and `forwarded_to_queue` keys. Mirrors what _PlaywrightReviewSession._on_response
    produces in the live path."""
    return {
        "request_index": idx,
        "timestamp": "2026-04-27T00:00:00",
        "request": {
            "method": "POST",
            "url": "https://m.oliveyoung.co.kr/review/api/v2/reviews/cursor",
            "query_params": {},
            "post_data_sort_type": sort_type,
            "headers_sample": {"accept": "application/json"},
            "cookie_present": True,
            "auth_header_present": False,
            "redacted_headers": ["cookie"],
        },
        "response": {
            "status": status,
            "tag": tag,
            "next_cursor_id": str(next_cursor) if next_cursor is not None else None,
            "has_next": has_next,
            "record_count": 10,
            "login_required": False,
        },
        "forwarded_to_queue": forwarded,
    }


@pytest.mark.asyncio
async def test_summary_records_requested_sort_type_when_set(page1_body, page2_last):
    """When the operator passes `sort_type=...`, the connector echoes it into
    the summary's requested_sort_type field, even though the FakeSession
    doesn't exercise the real filter. This is the operator's audit trail."""
    session = FakeBrowserReviewSession(
        [(200, page1_body), (200, page2_last)],
        request_log=[
            _sort_trace_entry(0, sort_type="DATETIME_DESC", next_cursor="c0"),
            _sort_trace_entry(1, sort_type="DATETIME_DESC", next_cursor="c1", has_next=False),
        ],
    )
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
        sort_type="DATETIME_DESC",
    )
    await c.collect(keyword="x", params=CollectParams(max_results=100))
    s = c.last_run_summary
    assert s.requested_sort_type == "DATETIME_DESC"


@pytest.mark.asyncio
async def test_summary_requested_sort_type_default_is_none(page1_body, page2_last):
    """Legacy callers that don't pass sort_type see `requested_sort_type=None` in
    the summary — preserves pre-Phase-2E serialization shape."""
    session = FakeBrowserReviewSession([(200, page1_body), (200, page2_last)])
    c, params = _build_connector(session)
    await c.collect(keyword="x", params=params)
    assert c.last_run_summary.requested_sort_type is None


@pytest.mark.asyncio
async def test_summary_observed_sort_types_tally_from_trace(page1_body, page2_last):
    """observed_sort_types is derived from trace_records (each entry's
    request.post_data_sort_type). Tally must be unaffected by which entries
    were filtered out — tracking ALL observed sortTypes is the point."""
    session = FakeBrowserReviewSession(
        [(200, page1_body), (200, page2_last)],
        request_log=[
            _sort_trace_entry(0, sort_type="USEFUL_SCORE_DESC", forwarded=False),
            _sort_trace_entry(1, sort_type="DATETIME_DESC", next_cursor="c1", forwarded=True),
            _sort_trace_entry(2, sort_type="DATETIME_DESC", next_cursor="c2",
                              has_next=False, forwarded=True),
        ],
    )
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
        sort_type="DATETIME_DESC",
    )
    await c.collect(keyword="x", params=CollectParams(max_results=100))
    s = c.last_run_summary
    assert s.observed_sort_types == {"USEFUL_SCORE_DESC": 1, "DATETIME_DESC": 2}
    assert s.responses_filtered_out_by_sort == 1


@pytest.mark.asyncio
async def test_summary_observed_sort_types_handles_missing_field(page1_body, page2_last):
    """Trace entries from older sessions / fakes that don't set
    post_data_sort_type are tolerated — they simply don't contribute to the
    tally. forwarded_to_queue defaulting to None / missing similarly does
    not increment the filtered-out count."""
    session = FakeBrowserReviewSession(
        [(200, page1_body), (200, page2_last)],
        request_log=[
            _trace_entry(0, next_cursor="a"),  # no post_data_sort_type
            _trace_entry(1, next_cursor="b", has_next=False),
        ],
    )
    c, params = _build_connector(session)
    await c.collect(keyword="x", params=params)
    s = c.last_run_summary
    assert s.observed_sort_types == {}
    assert s.responses_filtered_out_by_sort == 0


def test_constructor_rejects_invalid_sort_type():
    with pytest.raises(ValueError, match="sort_type must be one of"):
        OliveYoungBrowserAPIConnector(
            product_url=PRODUCT_URL, sort_type="NONSENSE",
        )


def test_constructor_accepts_each_valid_sort_type():
    from src.voc.connectors.oliveyoung_browser_api import _VALID_SORT_TYPES
    for st in _VALID_SORT_TYPES:
        c = OliveYoungBrowserAPIConnector(product_url=PRODUCT_URL, sort_type=st)
        assert c._sort_type == st


def _capture_build_session_args(connector):
    """Drive `connector._build_session()` and capture the `_PlaywrightReviewSession`
    constructor kwargs without actually launching Playwright. Returns the
    captured kwargs dict.
    """
    from src.voc.connectors import oliveyoung_browser_api as mod
    captured: dict = {}
    real_cls = mod._PlaywrightReviewSession

    class _CaptureSession:
        def __init__(self, **kw):
            captured.update(kw)
        async def open(self, url): pass
        async def wait_for_next_response(self, *, timeout_s): return None
        async def scroll_for_next(self): pass
        async def close(self): pass
        def get_request_log(self): return []
        async def observe_login_state(self): return None
        def get_observed_sort_types(self): return {}
        def get_responses_filtered_out_by_sort(self): return 0

    mod._PlaywrightReviewSession = _CaptureSession
    try:
        connector._build_session()
    finally:
        mod._PlaywrightReviewSession = real_cls
    return captured


def test_build_session_skips_sort_button_for_useful_score_desc():
    """USEFUL_SCORE_DESC is the page-default sort; the connector must NOT pass
    a sort_button_label_ko to the session for it (no click needed). The
    expected_sort_type is still passed so the response filter activates."""
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL, sort_type="USEFUL_SCORE_DESC",
    )
    kw = _capture_build_session_args(c)
    assert kw["sort_button_label_ko"] is None
    assert kw["expected_sort_type"] == "USEFUL_SCORE_DESC"


def test_build_session_passes_korean_label_for_non_default_sort():
    """Non-default sorts must result in a non-None sort_button_label_ko so the
    session's robust hunter looks for the matching Korean text."""
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL, sort_type="DATETIME_DESC",
    )
    kw = _capture_build_session_args(c)
    assert kw["sort_button_label_ko"] == "최신순"
    assert kw["expected_sort_type"] == "DATETIME_DESC"


def test_build_session_passes_label_for_each_non_default_sort():
    """Every non-default sort_type maps to its Korean label exactly. Catches
    a typo in SORT_BUTTON_LABELS_KO that would silently produce the wrong
    click target."""
    expected = {
        "RECOMMENDED_DESC": "도움순",
        "DATETIME_DESC":    "최신순",
        "RATING_DESC":      "평점 높은순",
        "RATING_ASC":       "평점 낮은순",
    }
    for sort_type, label in expected.items():
        c = OliveYoungBrowserAPIConnector(
            product_url=PRODUCT_URL, sort_type=sort_type,
        )
        kw = _capture_build_session_args(c)
        assert kw["sort_button_label_ko"] == label, sort_type
        assert kw["expected_sort_type"] == sort_type


# ---------------------------------------------------------------------------
# Phase 2E false-empty review-state recovery
# ---------------------------------------------------------------------------

@pytest.fixture
def _fast_false_empty_delays(monkeypatch):
    """Zero out the false-empty backoff sleeps + final cooldown for tests.

    The production constants (5–8s, 10–20s, 10–30s cooldown) would make
    each false-empty test take 25–58s; this fixture brings them to ~0
    while leaving the retry-count and exhaustion semantics intact.
    """
    monkeypatch.setattr(
        OliveYoungBrowserAPIConnector,
        "FALSE_EMPTY_RETRY_DELAYS_S",
        ((0.0, 0.0), (0.0, 0.0)),
    )
    monkeypatch.setattr(
        OliveYoungBrowserAPIConnector,
        "FALSE_EMPTY_FINAL_COOLDOWN_RANGE_S",
        (0.0, 0.0),
    )
    yield


class _FalseEmptyFakeSession(FakeBrowserReviewSession):
    """Extends the standard fake with controllable false-empty + reload
    behavior. `false_empty_sequence` is a list of bools (or None) returned
    by successive calls to `is_false_empty_state()`. `reload_calls` tracks
    how many times `reload_and_reopen_review_tab` was invoked.
    """

    def __init__(self, responses, *, false_empty_sequence, **kw):
        super().__init__(responses, **kw)
        self._false_empty_sequence = list(false_empty_sequence)
        self._fe_call_index = 0
        self.reload_calls = 0
        self.last_seen_sort_labels: list[str] = []

    async def is_false_empty_state(self) -> bool | None:
        if self._fe_call_index < len(self._false_empty_sequence):
            v = self._false_empty_sequence[self._fe_call_index]
            self._fe_call_index += 1
            return v
        return False

    async def reload_and_reopen_review_tab(self) -> None:
        self.reload_calls += 1

    def get_seen_sort_labels(self) -> list[str]:
        return list(self.last_seen_sort_labels)

    def get_observed_sort_types(self) -> dict[str, int]:
        return {}

    def get_responses_filtered_out_by_sort(self) -> int:
        return 0


@pytest.mark.asyncio
async def test_false_empty_recovers_after_one_retry(
    page1_body, page2_last, _fast_false_empty_delays,
):
    """Probe returns True once, then False — connector reloads, then proceeds
    to cold-start successfully. Summary records the detection + 1 retry."""
    session = _FalseEmptyFakeSession(
        [(200, page1_body), (200, page2_last)],
        false_empty_sequence=[True, False],
    )
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
    )
    raws = await c.collect(keyword="x", params=CollectParams(max_results=100))
    # 18, not 20: the saved fixtures contain 1 sibling-goodsNumber row
    # per page (A000000205145) which the new goods-filter drops on
    # PRODUCT_URL=goodsNo=A000000238828. See parse_response_body's
    # `target_goods_no` semantics. The pre-filter count is still 20
    # (asserted via `raw_records_seen` where the test exposes it).
    assert len(raws) == 18  # cold-start eventually succeeded
    assert session.reload_calls == 1
    s = c.last_run_summary
    assert s.false_empty_state_detected is True
    assert s.false_empty_retry_count == 1
    assert s.blocked is False
    assert s.auth_error is False


@pytest.mark.asyncio
async def test_false_empty_exhausts_retries_classifies_blocked(
    page1_body, _fast_false_empty_delays,
):
    """Probe returns True every call — connector exhausts the 2 retry budget
    and breaks with blocked=True. Summary's false_empty_state_detected=True
    and retry_count == FALSE_EMPTY_MAX_RETRIES."""
    # Sequence longer than max retries so every probe hits True.
    session = _FalseEmptyFakeSession(
        [(200, page1_body)],  # never consumed (cold-start short-circuits)
        false_empty_sequence=[True, True, True, True, True],
    )
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
    )
    raws = await c.collect(keyword="x", params=CollectParams(max_results=100))
    assert raws == []
    s = c.last_run_summary
    assert s.false_empty_state_detected is True
    assert s.false_empty_retry_count == OliveYoungBrowserAPIConnector.FALSE_EMPTY_MAX_RETRIES
    assert s.blocked is True
    # 1 reload per retry attempt
    assert session.reload_calls == OliveYoungBrowserAPIConnector.FALSE_EMPTY_MAX_RETRIES


@pytest.mark.asyncio
async def test_false_empty_unknown_does_not_trigger_retry(page1_body, page2_last):
    """Probe returning None ('unknown') is treated as 'don't retry' — proceed
    to cold-start. This protects fakes / partial implementations from
    breaking the run."""
    session = _FalseEmptyFakeSession(
        [(200, page1_body), (200, page2_last)],
        false_empty_sequence=[None, None],
    )
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
    )
    raws = await c.collect(keyword="x", params=CollectParams(max_results=100))
    # 18, not 20: the saved fixtures contain 1 sibling-goodsNumber row
    # per page (A000000205145) which the new goods-filter drops on
    # PRODUCT_URL=goodsNo=A000000238828. See parse_response_body's
    # `target_goods_no` semantics. The pre-filter count is still 20
    # (asserted via `raw_records_seen` where the test exposes it).
    assert len(raws) == 18
    assert session.reload_calls == 0
    s = c.last_run_summary
    assert s.false_empty_state_detected is False
    assert s.false_empty_retry_count == 0


@pytest.mark.asyncio
async def test_legacy_fake_without_false_empty_skips_path(page1_body, page2_last):
    """Sessions that don't implement is_false_empty_state (legacy Fake) must
    pass through unaffected — getattr fallback returns None, treated as
    'no false-empty path engaged'. Backward-compat regression check."""
    session = FakeBrowserReviewSession([(200, page1_body), (200, page2_last)])
    c, params = _build_connector(session)
    raws = await c.collect(keyword="x", params=params)
    # 18, not 20: the saved fixtures contain 1 sibling-goodsNumber row
    # per page (A000000205145) which the new goods-filter drops on
    # PRODUCT_URL=goodsNo=A000000238828. See parse_response_body's
    # `target_goods_no` semantics. The pre-filter count is still 20
    # (asserted via `raw_records_seen` where the test exposes it).
    assert len(raws) == 18
    s = c.last_run_summary
    assert s.false_empty_state_detected is False
    assert s.false_empty_retry_count == 0


@pytest.mark.asyncio
async def test_seen_sort_labels_drained_into_summary(page1_body, page2_last):
    """`available_sort_button_labels` is populated from the session's
    `get_seen_sort_labels()` getter. Empty for sessions without the
    getter."""
    session = _FalseEmptyFakeSession(
        [(200, page1_body), (200, page2_last)],
        false_empty_sequence=[False],
    )
    session.last_seen_sort_labels = ["유용한 순", "최신순", "도움순"]
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
    )
    await c.collect(keyword="x", params=CollectParams(max_results=100))
    s = c.last_run_summary
    assert s.available_sort_button_labels == ["유용한 순", "최신순", "도움순"]


# ---------------------------------------------------------------------------
# classify_status: blocked_or_empty_state mapping
# ---------------------------------------------------------------------------

def test_classify_false_empty_only_returns_blocked_or_empty_state():
    from src.voc.app.collection_batch import classify_status
    summary = {
        "blocked": True,           # connector sets blocked=True on exhaustion
        "false_empty_state_detected": True,
        "http_403_seen": False,
        "http_429_seen": False,
    }
    assert classify_status(summary) == "blocked_or_empty_state"


def test_classify_false_empty_with_http_403_returns_anti_bot():
    """A real HTTP block always wins — even if false-empty was also seen,
    the operator must back off, so we surface anti_bot."""
    from src.voc.app.collection_batch import classify_status
    summary = {
        "blocked": True,
        "false_empty_state_detected": True,
        "http_403_seen": True,
    }
    assert classify_status(summary) == "anti_bot"


def test_classify_false_empty_not_set_returns_anti_bot():
    """When false-empty wasn't observed, blocked → anti_bot as before
    (backward compat)."""
    from src.voc.app.collection_batch import classify_status
    summary = {
        "blocked": True,
        "false_empty_state_detected": False,
        "http_403_seen": False,
        "http_429_seen": False,
    }
    assert classify_status(summary) == "anti_bot"


def test_blocked_or_empty_state_is_not_a_halt_status():
    """Multi-sort orchestrator depends on blocked_or_empty_state being a
    NON-halt status so subsequent sorts get a chance. Regression guard."""
    from src.voc.app.collection_batch import HALT_STATUSES
    assert "blocked_or_empty_state" not in HALT_STATUSES


# ---------------------------------------------------------------------------
# Stepped backoff + final cooldown (anti-bot hardening)
# ---------------------------------------------------------------------------

def test_false_empty_constants_have_expected_shape():
    """Stepped delays are a sequence of (min, max) tuples; the FIRST entry
    must be the SHORTER backoff and the LAST entry the LONGEST. Sanity
    check so a future edit doesn't accidentally invert the escalation."""
    delays = OliveYoungBrowserAPIConnector.FALSE_EMPTY_RETRY_DELAYS_S
    assert isinstance(delays, tuple)
    assert len(delays) == OliveYoungBrowserAPIConnector.FALSE_EMPTY_MAX_RETRIES, (
        "FALSE_EMPTY_RETRY_DELAYS_S length must equal FALSE_EMPTY_MAX_RETRIES "
        "so each retry has its own jitter range."
    )
    for lo, hi in delays:
        assert 0.0 <= lo <= hi, f"invalid range ({lo}, {hi})"
    # First retry must be SHORTER than the last (escalation guarantee).
    assert delays[0][1] <= delays[-1][0] or len(delays) == 1, (
        f"escalation inverted: first range {delays[0]} should not exceed "
        f"last range {delays[-1]}"
    )
    cd = OliveYoungBrowserAPIConnector.FALSE_EMPTY_FINAL_COOLDOWN_RANGE_S
    assert isinstance(cd, tuple) and len(cd) == 2
    assert 0.0 <= cd[0] <= cd[1]


@pytest.mark.asyncio
async def test_false_empty_uses_stepped_delays(
    monkeypatch, page1_body,
):
    """Each retry's sleep is drawn from FALSE_EMPTY_RETRY_DELAYS_S[i].
    Final exhaustion sleeps from FALSE_EMPTY_FINAL_COOLDOWN_RANGE_S.
    Asserted by recording every `asyncio.sleep` argument."""
    # Set distinctive ranges so we can identify which range a recorded
    # sleep came from. Ranges are tight (constant) for predictability.
    monkeypatch.setattr(
        OliveYoungBrowserAPIConnector,
        "FALSE_EMPTY_RETRY_DELAYS_S",
        ((0.10, 0.10), (0.20, 0.20)),
    )
    monkeypatch.setattr(
        OliveYoungBrowserAPIConnector,
        "FALSE_EMPTY_FINAL_COOLDOWN_RANGE_S",
        (0.30, 0.30),
    )
    sleeps: list[float] = []
    real_sleep = asyncio.sleep

    async def _record(delay):
        sleeps.append(float(delay))
        # Don't actually sleep in the test; pass through immediately.
        await real_sleep(0)
    monkeypatch.setattr(asyncio, "sleep", _record)

    session = _FalseEmptyFakeSession(
        [(200, page1_body)],
        false_empty_sequence=[True, True, True, True],
    )
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
    )
    await c.collect(keyword="x", params=CollectParams(max_results=10))
    # The connector also calls asyncio.sleep elsewhere (e.g., the
    # sort-hunt poll loop) — but those don't run because the fake's
    # `_click_sort_button_robust` path isn't engaged (no sort_type set).
    # So the only sleeps we expect are: 2 retry delays + 1 final cooldown.
    assert 0.10 in sleeps, f"expected first-retry delay 0.10 in {sleeps}"
    assert 0.20 in sleeps, f"expected second-retry delay 0.20 in {sleeps}"
    assert 0.30 in sleeps, f"expected final cooldown 0.30 in {sleeps}"
    s = c.last_run_summary
    assert s.false_empty_state_detected is True
    assert s.false_empty_retry_count == 2
    assert s.blocked is True


class _PositiveSignalFakeSession(_FalseEmptyFakeSession):
    """Fake that asserts positive-signal pre-check: when
    `has_pending_response` returns True, the connector must skip the
    false-empty escalation entirely.

    `pending_sequence` controls successive `has_pending_response`
    return values; when exhausted, returns False.
    """

    def __init__(self, responses, *, pending_sequence, **kw):
        super().__init__(responses, false_empty_sequence=[], **kw)
        self._pending_sequence = list(pending_sequence)
        self._pending_call_index = 0
        self.has_pending_calls = 0

    async def has_pending_response(self) -> bool:
        self.has_pending_calls += 1
        if self._pending_call_index < len(self._pending_sequence):
            v = self._pending_sequence[self._pending_call_index]
            self._pending_call_index += 1
            return v
        return False


@pytest.mark.asyncio
async def test_positive_signal_skips_false_empty_probe(
    page1_body, page2_last, _fast_false_empty_delays,
):
    """When `has_pending_response()` returns True within the settle
    window, the false-empty probe must be skipped entirely (no
    reload, no retry counter increment)."""
    session = _PositiveSignalFakeSession(
        [(200, page1_body), (200, page2_last)],
        pending_sequence=[True],  # immediate positive signal
    )
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
    )
    raws = await c.collect(keyword="x", params=CollectParams(max_results=100))

    # Cold-start consumed the response normally
    # 18, not 20: the saved fixtures contain 1 sibling-goodsNumber row
    # per page (A000000205145) which the new goods-filter drops on
    # PRODUCT_URL=goodsNo=A000000238828. See parse_response_body's
    # `target_goods_no` semantics. The pre-filter count is still 20
    # (asserted via `raw_records_seen` where the test exposes it).
    assert len(raws) == 18
    # Positive-signal probe was consulted at least once
    assert session.has_pending_calls >= 1
    # No reload triggered, no false-empty bookkeeping
    assert session.reload_calls == 0
    s = c.last_run_summary
    assert s.false_empty_state_detected is False
    assert s.false_empty_retry_count == 0
    assert s.blocked is False


@pytest.mark.asyncio
async def test_settle_timeout_falls_through_to_false_empty(
    page1_body, page2_last, _fast_false_empty_delays,
):
    """When `has_pending_response()` keeps returning False (queue
    stays empty during the settle window), the connector must fall
    through to the existing false-empty probe path. This preserves
    soft-block detection — the new positive-signal layer is purely
    a fast-path."""
    # Fake session: positive signal NEVER fires; false-empty probe
    # returns True once, then False (mimicking a recovered page).
    class _Combined(_FalseEmptyFakeSession):
        def __init__(self, responses, **kw):
            super().__init__(responses, false_empty_sequence=[True, False], **kw)
            self.has_pending_calls = 0

        async def has_pending_response(self) -> bool:
            self.has_pending_calls += 1
            return False

    session = _Combined([(200, page1_body), (200, page2_last)])
    # Shrink the settle window to 0 so the test runs instantly.
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
    )
    c._post_sort_settle_s = 0.0
    raws = await c.collect(keyword="x", params=CollectParams(max_results=100))
    # 18, not 20: the saved fixtures contain 1 sibling-goodsNumber row
    # per page (A000000205145) which the new goods-filter drops on
    # PRODUCT_URL=goodsNo=A000000238828. See parse_response_body's
    # `target_goods_no` semantics. The pre-filter count is still 20
    # (asserted via `raw_records_seen` where the test exposes it).
    assert len(raws) == 18
    # False-empty path engaged exactly once (matches existing semantics)
    assert session.reload_calls == 1
    s = c.last_run_summary
    assert s.false_empty_state_detected is True
    assert s.false_empty_retry_count == 1
    assert s.blocked is False


def test_post_sort_settle_constant_present():
    """Locked: the new POST_SORT_SETTLE_S class constant exists with
    a positive default. Operators bumping the window should change
    the class constant, not patch in code."""
    from src.voc.connectors.oliveyoung_browser_api import (
        OliveYoungBrowserAPIConnector,
    )
    assert hasattr(OliveYoungBrowserAPIConnector, "POST_SORT_SETTLE_S")
    assert OliveYoungBrowserAPIConnector.POST_SORT_SETTLE_S > 0


def test_allow_full_browser_restart_constant_present():
    """Plumbed for Phase-2 recovery layer; default off."""
    from src.voc.connectors.oliveyoung_browser_api import (
        OliveYoungBrowserAPIConnector,
    )
    assert OliveYoungBrowserAPIConnector.ALLOW_FULL_BROWSER_RESTART is False


def test_reload_method_name_preserved_for_back_compat():
    """The strengthened recovery (page-recreate) MUST still be exposed under
    the original method name `reload_and_reopen_review_tab` so existing
    fakes / external callers don't break."""
    from src.voc.connectors import oliveyoung_browser_api as mod
    sess_cls = mod._PlaywrightReviewSession
    assert hasattr(sess_cls, "reload_and_reopen_review_tab")
    # Also check the helper that the recreate path now uses.
    assert hasattr(sess_cls, "_attach_response_handler")


# ---------------------------------------------------------------------------
# 2026-05-01 — `_PlaywrightReviewSession` carries the lazy-load trigger
# locator constant directly. Regression: when the constant only lived on
# the connector class, `_trigger_review_list_api` raised
# `AttributeError: '_PlaywrightReviewSession' object has no attribute
# 'REVIEW_MORE_LOCATORS'` after every Playwright open() — fully blocking
# scraping under the bundled-Chromium 143 workaround.
# ---------------------------------------------------------------------------


def test_session_has_review_more_locators():
    from src.voc.connectors import oliveyoung_browser_api as mod
    sess_cls = mod._PlaywrightReviewSession
    assert hasattr(sess_cls, "REVIEW_MORE_LOCATORS")
    locators = sess_cls.REVIEW_MORE_LOCATORS
    assert isinstance(locators, tuple) and len(locators) >= 1
    for sel in locators:
        assert isinstance(sel, str) and sel.strip()


def test_session_locators_match_connector_source_of_truth():
    """Bound to the connector's tuple — single source of truth.
    Drift (the two diverging) would silently cause the lazy-load
    cascade to behave differently across the diagnostic/connector
    paths."""
    from src.voc.connectors import oliveyoung_browser_api as mod
    assert (
        mod._PlaywrightReviewSession.REVIEW_MORE_LOCATORS
        == mod.OliveYoungBrowserAPIConnector.REVIEW_MORE_LOCATORS
    )


@pytest.mark.asyncio
async def test_trigger_review_list_api_runs_without_attribute_error():
    """End-to-end-shape regression for the AttributeError that blocked
    every scrape under Chromium 143. Drives `_trigger_review_list_api`
    against a fake Page that returns zero matches (so each cascade step
    is a no-op) — the method must complete without raising, and the
    telemetry getters must report False/False (no actual click)."""
    from src.voc.connectors import oliveyoung_browser_api as mod

    class _FakeLocator:
        async def count(self):  # zero matches — every step is a no-op
            return 0

        async def click(self, timeout=None):
            raise AssertionError("should not click — count == 0")

        async def scroll_into_view_if_needed(self, timeout=None):
            return None

        @property
        def first(self):
            return self

    class _FakePage:
        def locator(self, sel):
            return _FakeLocator()

        async def evaluate(self, script):
            return None

    sess_cls = mod._PlaywrightReviewSession
    sess = object.__new__(sess_cls)  # bypass __init__; set only what we need
    sess._page = _FakePage()
    sess._review_tab_locator = "div.review-tab"
    sess._review_more_button_clicked = False
    sess._scrolled_to_review_area = False

    # The bug: this used to raise AttributeError on `self.REVIEW_MORE_LOCATORS`.
    await sess._trigger_review_list_api(initial_click=True)

    # Cascade ran cleanly with zero matches → no clicks recorded.
    assert sess.get_review_more_button_clicked() is False
    assert sess.get_scrolled_to_review_area() is False
