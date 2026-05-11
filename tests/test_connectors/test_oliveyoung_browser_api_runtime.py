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
async def test_collect_emits_progress_heartbeat_per_ok_response(
    page1_body, page2_last, capsys,
):
    """I-OY-STEP5-PROGRESS-INDICATOR — assert one heartbeat line per
    successful cursor response (cold-start + each continuation), so a
    long-running OY pagination loop is visibly alive to ops.

    Asserts only structural facts (line count, marker prefix, presence
    of grep-friendly fields). Does NOT lock the exact format string —
    heartbeat content is allowed to evolve. The contract being tested is
    "ops can distinguish progress from hang," not "this exact wording."

    Channel contract (I-OY-HEARTBEAT-STDOUT-REGRESSION): heartbeat lines
    MUST go to stderr, never stdout. The ingest subprocess wrapper
    (scripts/ingest_oliveyoung_browser_phase1.py) prints exactly one
    JSON object to stdout; src/voc/app/collection_batch.py then parses
    that stdout via json.loads. Heartbeat noise on stdout corrupted the
    JSON envelope and broke Anua A000000205555 v2 re-collection across
    all sorts ("Expecting value: line 1 column 2"). This test guards
    that regression by asserting stdout stays heartbeat-free.
    """
    session = FakeBrowserReviewSession([(200, page1_body), (200, page2_last)])
    c, params = _build_connector(session)

    await c.collect(keyword="x", params=params)

    captured_pair = capsys.readouterr()
    heartbeat_lines = [
        ln for ln in captured_pair.err.splitlines()
        if ln.startswith("[oy-heartbeat]")
    ]
    # One per ok response: cold-start (page1) + continuation (page2).
    assert len(heartbeat_lines) == 2, captured_pair.err
    for ln in heartbeat_lines:
        # Grep-friendly field presence — values can shift, names cannot.
        assert "goods=" in ln
        assert "sort=" in ln
        assert "cursor=" in ln
        assert "raw=" in ln
        assert "parsed=" in ln
        assert "has_next=" in ln
        assert "t=+" in ln

    # Subprocess JSON contract guard: stdout must stay heartbeat-free
    # so json.loads(stdout) in collection_batch.py does not fault on
    # "[oy-heartbeat] ..." preceding the JSON envelope. This is the
    # exact production failure that I-OY-HEARTBEAT-STDOUT-REGRESSION
    # fixes.
    assert "[oy-heartbeat]" not in captured_pair.out, captured_pair.out


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


# ---------------------------------------------------------------------------
# I-OY-SCROLL-CONTINUATION-IMPL — connector recovery branch + telemetry
#
# When the per-page scroll budget is exhausted while the server still
# signals `hasNext=True`, the connector now calls
# `_PlaywrightReviewSession.reload_and_reopen_review_tab()` up to
# `MAX_SCROLL_RECOVERY_RECREATES` times before declaring the run
# scroll-continuation-exhausted. The existing `seen_ids` dedup set
# carries the prefix forward so re-walked rows do not double-count.
# These tests exercise the new branch end-to-end against a fake
# session that records recreate calls, prefilled response queues, and
# an injectable `reload_and_reopen_review_tab` mock.
# ---------------------------------------------------------------------------


class _RecoveryFakeSession(FakeBrowserReviewSession):
    """`FakeBrowserReviewSession` extended with the recovery primitive.

    `reload_and_reopen_review_tab` is implemented as an awaitable that
    increments `recreate_calls`. Tests can override it to prime
    additional responses into the queue at recreate time so the
    connector's post-recreate cold-start can land a real body.
    """

    def __init__(self, responses, *, recreate_responses=None, **kw):
        super().__init__(responses, **kw)
        self.recreate_calls = 0
        # `recreate_responses` is a list-of-lists: the i-th element
        # is the queue prefix to prepend on the i-th recreate call.
        # Each prefix is consumed wholesale when the recreate fires.
        self._recreate_responses = list(recreate_responses or [])

    async def reload_and_reopen_review_tab(self) -> None:
        self.recreate_calls += 1
        if self._recreate_responses:
            prefix = self._recreate_responses.pop(0)
            # Prepend so the next wait_for_next_response sees the
            # prefix before any existing tail.
            self._responses = list(prefix) + list(self._responses)


def _build_recovery_connector(
    session, *, recovery_budget=2, max_results=100,
):
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
        max_scroll_recovery_recreates=recovery_budget,
    )
    return c, CollectParams(max_results=max_results)


def test_max_scroll_recovery_recreates_class_constant_present():
    """The new constant is exposed on the connector class so tests /
    callers can read the default budget."""
    assert hasattr(
        OliveYoungBrowserAPIConnector, "MAX_SCROLL_RECOVERY_RECREATES",
    )
    assert OliveYoungBrowserAPIConnector.MAX_SCROLL_RECOVERY_RECREATES == 2


def test_max_scroll_recovery_recreates_default_matches_constant():
    """Constructor with no override falls back to the class constant."""
    c = OliveYoungBrowserAPIConnector(product_url=PRODUCT_URL)
    assert (
        c._max_scroll_recovery_recreates
        == OliveYoungBrowserAPIConnector.MAX_SCROLL_RECOVERY_RECREATES
    )


def test_max_scroll_recovery_recreates_override_applied():
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        max_scroll_recovery_recreates=5,
    )
    assert c._max_scroll_recovery_recreates == 5


def test_max_scroll_recovery_recreates_zero_disables_recovery():
    """Passing 0 explicitly preserves pre-patch behavior — no recreates."""
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        max_scroll_recovery_recreates=0,
    )
    assert c._max_scroll_recovery_recreates == 0


def test_max_scroll_recovery_recreates_rejects_negative():
    with pytest.raises(ValueError, match="max_scroll_recovery_recreates"):
        OliveYoungBrowserAPIConnector(
            product_url=PRODUCT_URL,
            max_scroll_recovery_recreates=-1,
        )


@pytest.mark.asyncio
async def test_scroll_recovery_calls_reload_when_has_next_true(
    page1_body, page2_last, monkeypatch,
):
    """Scroll-attempt exhaustion while hasNext=True triggers the
    page-recreate primitive. After recovery the connector resumes
    continuation and reaches a clean `hasNext=False` body."""
    # cold-start ok (page1, hasNext=True) → 3 None scrolls (per
    # default MAX_SCROLL_ATTEMPTS_PER_PAGE = 3) → recovery → recreate
    # primes a final hasNext=False body → connector terminates clean.
    session = _RecoveryFakeSession(
        [(200, page1_body), None, None, None],
        recreate_responses=[[(200, page2_last)]],
    )
    # Make the recovery sleep instant so tests stay fast.
    import src.voc.connectors.oliveyoung_browser_api as mod
    monkeypatch.setattr(mod.asyncio, "sleep", _no_sleep)

    c, params = _build_recovery_connector(session)
    raws = await c.collect(keyword="x", params=params)

    # Recovery primitive fired exactly once.
    assert session.recreate_calls == 1
    # The post-recovery body had hasNext=False so the run exits
    # cleanly via _should_stop_pagination.
    s = c.last_run_summary
    assert s.scroll_continuation_recovery_attempts == 1
    assert s.scroll_continuation_recovery_recovered is True
    assert s.pagination_exhausted is True
    assert s.last_observed_has_next is False
    # The connector still preserves the historical "no continuation"
    # note so log/regex consumers don't regress.
    assert any(
        "scroll_continuation_recovery" in r for r in s.sample_dropped_reasons
    )
    # Both pages contributed unique rows.
    assert len(raws) == 18


@pytest.mark.asyncio
async def test_scroll_recovery_dedup_prevents_double_counting(
    page1_body, page2_last, monkeypatch,
):
    """Recreate that re-emits the same page1 rows must not double-count.
    The seen_ids set carries the prefix forward across the recreate."""
    session = _RecoveryFakeSession(
        [(200, page1_body), None, None, None],
        # First recreate response is page1 again (re-walking the
        # already-collected prefix); follow with hasNext=False so
        # the run terminates.
        recreate_responses=[[(200, page1_body), (200, page2_last)]],
    )
    import src.voc.connectors.oliveyoung_browser_api as mod
    monkeypatch.setattr(mod.asyncio, "sleep", _no_sleep)

    c, params = _build_recovery_connector(session)
    raws = await c.collect(keyword="x", params=params)

    # Same 18 unique rows as the happy-path two-page run — the
    # re-emitted page1 was deduped by source_id.
    assert len(raws) == 18
    s = c.last_run_summary
    assert session.recreate_calls == 1
    assert s.scroll_continuation_recovery_attempts == 1


@pytest.mark.asyncio
async def test_scroll_recovery_capped_by_budget(
    page1_body, monkeypatch,
):
    """`MAX_SCROLL_RECOVERY_RECREATES` (overridable) caps total
    page-recreate attempts. After the budget is exhausted with
    hasNext=True the run is marked
    `scroll_continuation_terminated_with_has_next=True` and
    `incomplete_collection=True`."""
    # Sequence: cold-start ok → 3 None → recreate #1 → 3 None →
    # recreate #2 → 3 None → terminus (budget exhausted).
    nones = [None] * 3
    session = _RecoveryFakeSession(
        [(200, page1_body)] + nones,
        recreate_responses=[
            # recreate 1 → primes another page1 (re-walk prefix), then
            # 3 Nones so the inner scroll loop exhausts again.
            [(200, page1_body)] + nones,
            # recreate 2 → same shape; after this the budget is gone.
            [(200, page1_body)] + nones,
        ],
    )
    import src.voc.connectors.oliveyoung_browser_api as mod
    monkeypatch.setattr(mod.asyncio, "sleep", _no_sleep)

    c, params = _build_recovery_connector(session, recovery_budget=2)
    await c.collect(keyword="x", params=params)

    s = c.last_run_summary
    # Both recoveries used.
    assert session.recreate_calls == 2
    assert s.scroll_continuation_recovery_attempts == 2
    # Budget exhausted with server still saying hasNext=True →
    # incomplete + terminus flag.
    assert s.scroll_continuation_terminated_with_has_next is True
    assert s.incomplete_collection is True
    assert s.last_observed_has_next is True
    assert s.pagination_exhausted is False


@pytest.mark.asyncio
async def test_scroll_recovery_skipped_when_recovery_budget_zero(
    page1_body,
):
    """recovery_budget=0 preserves pre-patch behavior exactly: no
    recreate is attempted even when hasNext=True."""
    session = _RecoveryFakeSession([(200, page1_body), None, None, None])
    c, params = _build_recovery_connector(session, recovery_budget=0)
    await c.collect(keyword="x", params=params)

    assert session.recreate_calls == 0
    s = c.last_run_summary
    assert s.scroll_continuation_recovery_attempts == 0
    # The run terminated with hasNext=True; incomplete_collection is
    # set as before. The terminus flag stays False because the
    # connector did not consume any recovery budget — recovery was
    # disabled rather than exhausted.
    assert s.incomplete_collection is True
    assert s.last_observed_has_next is True


@pytest.mark.asyncio
async def test_scroll_recovery_not_attempted_on_natural_exhaustion(
    page1_body, page2_last,
):
    """When the last body advertises hasNext=False the recovery branch
    must NOT engage — the run already reached natural exhaustion."""
    session = _RecoveryFakeSession([(200, page1_body), (200, page2_last)])
    c, params = _build_recovery_connector(session)
    await c.collect(keyword="x", params=params)

    s = c.last_run_summary
    assert session.recreate_calls == 0
    assert s.scroll_continuation_recovery_attempts == 0
    assert s.scroll_continuation_terminated_with_has_next is False
    assert s.pagination_exhausted is True
    assert s.last_observed_has_next is False


@pytest.mark.asyncio
async def test_scroll_recovery_telemetry_serialized_on_summary(
    page1_body, page2_last, monkeypatch,
):
    """`ConnectorRunSummary` carries the new fields in its dump."""
    session = _RecoveryFakeSession(
        [(200, page1_body), None, None, None],
        recreate_responses=[[(200, page2_last)]],
    )
    import src.voc.connectors.oliveyoung_browser_api as mod
    monkeypatch.setattr(mod.asyncio, "sleep", _no_sleep)

    c, params = _build_recovery_connector(session)
    await c.collect(keyword="x", params=params)
    s = c.last_run_summary

    payload = s.model_dump()
    assert payload["scroll_continuation_recovery_attempts"] == 1
    assert payload["scroll_continuation_recovery_recovered"] is True
    assert payload["scroll_continuation_terminated_with_has_next"] is False
    # cursor_depth_at_termination tracks len(cursor_sequence). Real
    # Playwright sessions populate `request_log`; the fake's empty log
    # collapses to 0 — assert the field is at least present and an int.
    assert isinstance(payload["cursor_depth_at_termination"], int)
    # Construction-time knobs surface so the summary is self-describing.
    assert payload["max_scroll_attempts_per_page"] == c._max_scroll_attempts
    assert (
        payload["max_scroll_recovery_recreates"]
        == c._max_scroll_recovery_recreates
    )


@pytest.mark.asyncio
async def test_scroll_recovery_summary_defaults_for_legacy_payloads():
    """A pre-patch summary without the new fields deserializes cleanly
    via `ConnectorRunSummary`; new fields take their defaults."""
    from datetime import datetime
    from src.voc.app.connector_run_summary import ConnectorRunSummary

    legacy_payload = {
        "run_id": "r1", "channel": "oliveyoung",
        "requested_target": "https://example", "started_at": datetime.now(),
    }
    s = ConnectorRunSummary.model_validate(legacy_payload)
    assert s.scroll_continuation_recovery_attempts == 0
    assert s.scroll_continuation_recovery_recovered is False
    assert s.scroll_continuation_terminated_with_has_next is False
    assert s.cursor_depth_at_termination == 0
    assert s.max_scroll_attempts_per_page == 0
    assert s.max_scroll_recovery_recreates == 0


@pytest.mark.asyncio
async def test_scroll_recovery_handles_missing_recreate_primitive(
    page1_body,
):
    """When the session does NOT expose `reload_and_reopen_review_tab`
    (legacy fakes), the recovery branch falls through to the historical
    terminus message without raising — and recovery_attempts stays 0
    (no false-positive telemetry)."""
    # Use the original FakeBrowserReviewSession which lacks
    # reload_and_reopen_review_tab.
    session = FakeBrowserReviewSession([(200, page1_body), None, None, None])
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
        max_scroll_recovery_recreates=2,  # budget present, primitive missing
    )
    await c.collect(keyword="x", params=CollectParams(max_results=100))

    s = c.last_run_summary
    assert s.scroll_continuation_recovery_attempts == 0
    # Legacy "no continuation after N scroll attempts" still emitted.
    assert any(
        "no continuation after" in r for r in s.sample_dropped_reasons
    )


@pytest.mark.asyncio
async def test_scroll_recovery_aborts_when_recreate_raises(
    page1_body, monkeypatch,
):
    """If `reload_and_reopen_review_tab` itself raises, the recovery
    branch logs and breaks out cleanly — the run is marked
    incomplete + terminated_with_has_next without leaking the
    exception."""

    class _RaisingRecoverySession(FakeBrowserReviewSession):
        def __init__(self, responses, **kw):
            super().__init__(responses, **kw)
            self.recreate_calls = 0

        async def reload_and_reopen_review_tab(self) -> None:
            self.recreate_calls += 1
            raise RuntimeError("recreate failed")

    session = _RaisingRecoverySession([(200, page1_body), None, None, None])
    import src.voc.connectors.oliveyoung_browser_api as mod
    monkeypatch.setattr(mod.asyncio, "sleep", _no_sleep)

    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
        max_scroll_recovery_recreates=2,
    )
    await c.collect(keyword="x", params=CollectParams(max_results=100))

    s = c.last_run_summary
    # The recreate fired once and raised; budget is consumed.
    assert session.recreate_calls == 1
    assert s.scroll_continuation_recovery_attempts == 1
    # Terminus flag set because hasNext was True at recreate time.
    assert s.scroll_continuation_terminated_with_has_next is True
    assert s.incomplete_collection is True
    # Drop reason surfaces the abandonment.
    assert any(
        "abandoning" in r for r in s.sample_dropped_reasons
    )


async def _no_sleep(_seconds):
    """Replacement for asyncio.sleep used in tests so the recovery
    backoff doesn't add real wall-time."""
    return None


# ---------------------------------------------------------------------------
# I-OY-OPEN-HANDSHAKE-TIMEOUT — bound `await session.open(...)` with
# `asyncio.wait_for`. Prior to this patch a wedged Playwright/CDP
# target-attach could hang the connector for >99 minutes per attempt
# (see `ops/agent_handoffs/I-OY-ILSO-VISIBLE-REVIEWS-COLLECTOR-MISS-
# TRIAGE.md` §11). The wrapper turns that silent hang into an explicit
# `page_open_failed` summary with a distinct `open_handshake_timeout`
# diagnostic in `sample_dropped_reasons`.
#
# Required test cases (per ticket):
#   1. session.open succeeds before timeout → normal happy path.
#   2. session.open hangs → connector exits with controlled diagnostic.
#   3. timeout does NOT classify as anti_bot.
#   4. timeout does NOT classify as max_cap_reached.
# Plus a regression that the existing scroll-continuation tests (above)
# still pass against a session whose open() is fast.
# ---------------------------------------------------------------------------


class _HangingOpenSession(FakeBrowserReviewSession):
    """Session whose `open()` blocks forever via `asyncio.Event().wait()`.

    Combined with a small `cold_start_timeout_s` on the connector
    (e.g. 0.05s), `asyncio.wait_for` fires `TimeoutError` quickly so the
    test stays fast. `open_calls` is incremented on entry to keep parity
    with the parent fake's call-count contract.
    """

    async def open(self, product_url: str) -> None:
        self.open_calls += 1
        self.opened_url = product_url
        # Wait forever — the connector's `asyncio.wait_for` wrapper
        # is what we are testing.
        await asyncio.Event().wait()


def _build_open_timeout_connector(session, *, cold_start_timeout_s=0.05):
    """Build a connector with a tiny `cold_start_timeout_s` so a hanging
    `session.open()` produces a TimeoutError in milliseconds rather than
    the production default of 60–90s."""
    c = OliveYoungBrowserAPIConnector(
        product_url=PRODUCT_URL,
        code_mapper=ProfileCodeMapper(),
        session_factory=lambda: session,
        cold_start_timeout_s=cold_start_timeout_s,
    )
    return c, CollectParams(max_results=100)


@pytest.mark.asyncio
async def test_session_open_succeeds_before_timeout_normal_path(
    page1_body, page2_last,
):
    """Existing happy path: `session.open()` returns immediately (well
    within the cold-start timeout), continuation proceeds, and the
    summary carries no open-handshake diagnostic."""
    session = FakeBrowserReviewSession([(200, page1_body), (200, page2_last)])
    # Use a generous timeout (1s) so even a slow CI fake completes well
    # before the wait_for budget elapses.
    c, params = _build_open_timeout_connector(session, cold_start_timeout_s=1.0)

    raws = await c.collect(keyword="블러셔", params=params)

    assert len(raws) == 18
    assert session.open_calls == 1
    assert session.close_calls == 1

    s = c.last_run_summary
    assert s is not None
    # The new flag stays False on the happy path — no open-handshake
    # timeout fired.
    assert s.page_open_failed is False
    assert s.page_open_error is None
    # The dropped-reasons trail must NOT contain the open-handshake marker.
    assert not any(
        "open_handshake_timeout" in r for r in s.sample_dropped_reasons
    )
    # Existing happy-path invariants preserved.
    assert s.blocked is False
    assert s.auth_error is False
    assert s.cold_start_timed_out is False


@pytest.mark.asyncio
async def test_session_open_hangs_emits_open_handshake_timeout_diagnostic():
    """When `session.open()` waits indefinitely, `asyncio.wait_for` fires
    its TimeoutError and the connector exits cleanly with a distinct
    `open_handshake_timeout` diagnostic in `sample_dropped_reasons`. No
    rows are collected; the run terminates without re-entering the
    cold-start path."""
    session = _HangingOpenSession([])  # empty queue — never reached
    c, params = _build_open_timeout_connector(session, cold_start_timeout_s=0.05)

    raws = await c.collect(keyword="x", params=params)

    # No rows collected (open never completed → cold-start never ran).
    assert raws == []
    # The fake's open() was entered exactly once; the wrapper aborted it.
    assert session.open_calls == 1
    # Session.close() still ran via the connector's `finally` block.
    assert session.close_calls == 1

    s = c.last_run_summary
    assert s is not None
    # Distinct open-handshake telemetry surfaced.
    assert s.page_open_failed is True
    assert s.page_open_error is not None
    assert "open_handshake_timeout" in s.page_open_error
    # The diagnostic also lands in sample_dropped_reasons so the
    # operator's log/grep path catches it.
    assert any(
        "open_handshake_timeout" in r for r in s.sample_dropped_reasons
    ), s.sample_dropped_reasons
    # Distinct from the downstream cold-start timeout flag — the
    # connector never reached `wait_for_next_response` because
    # session.open() itself never returned.
    assert s.cold_start_timed_out is False
    # Critical: do NOT set `blocked=True` on this path. The classifier
    # treats `blocked=True` as `anti_bot`, which would misclassify a
    # CDP-handshake wedge as a server-side block.
    assert s.blocked is False
    # No HTTP traffic ever fired, so anti-bot signals stay False.
    assert s.http_403_seen is False
    assert s.http_429_seen is False
    assert s.http_401_or_login_required_seen is False
    # No data was parsed.
    assert s.records_parsed == 0
    assert s.raw_records_seen == 0


@pytest.mark.asyncio
async def test_open_handshake_timeout_does_not_classify_as_anti_bot():
    """The summary fields produced by an open-handshake timeout must
    NOT cause `classify_status()` to return `anti_bot`. The
    `page_open_failed` flag short-circuits BEFORE the
    `blocked / http_403 / http_429` branch, mapping the failure to the
    semantically-correct `page_open_failed` taxonomy bucket instead."""
    from src.voc.app.collection_batch import classify_status

    session = _HangingOpenSession([])
    c, params = _build_open_timeout_connector(session, cold_start_timeout_s=0.05)
    await c.collect(keyword="x", params=params)

    s = c.last_run_summary
    summary_dict = s.model_dump()
    # Quality gate — open-handshake timeout takes the `blocked` path
    # via `evaluate_quality_gates` because we deliberately did NOT set
    # blocked=True. With 0 records, `parse_yield = 0/1 = 0 < 0.5` so
    # the gate returns "invalid". That status combined with
    # page_open_failed=True is what classify_status() consumes.
    summary_dict["quality_status"] = "invalid"

    status = classify_status(summary_dict)
    # The contract: the open-handshake timeout MUST NOT be classified
    # as anti_bot. This is the operator's primary acceptance criterion
    # for the patch.
    assert status != "anti_bot", (
        f"open-handshake timeout misclassified as anti_bot: "
        f"page_open_failed={summary_dict.get('page_open_failed')}, "
        f"blocked={summary_dict.get('blocked')}, "
        f"sample_dropped_reasons={summary_dict.get('sample_dropped_reasons')}"
    )
    # Positive assertion: it lands in the correct page_open_failed
    # bucket. (The existing classify_status priority is: cdp_attach_failed
    # → page_open_failed → anti_bot → ...).
    assert status == "page_open_failed"


@pytest.mark.asyncio
async def test_open_handshake_timeout_does_not_classify_as_max_cap_reached():
    """A connector that never made an HTTP request cannot be
    `max_cap_reached`. The `page_open_failed` short-circuit prevents
    the (in any case unreachable) `last_observed_has_next is True`
    branch from firing for this failure mode."""
    from src.voc.app.collection_batch import classify_status

    session = _HangingOpenSession([])
    c, params = _build_open_timeout_connector(session, cold_start_timeout_s=0.05)
    await c.collect(keyword="x", params=params)

    s = c.last_run_summary
    summary_dict = s.model_dump()
    summary_dict["quality_status"] = "invalid"

    status = classify_status(summary_dict)
    # Operator's secondary forbidden status.
    assert status != "max_cap_reached", (
        f"open-handshake timeout misclassified as max_cap_reached: "
        f"last_observed_has_next={summary_dict.get('last_observed_has_next')}, "
        f"page_open_failed={summary_dict.get('page_open_failed')}"
    )
    # last_observed_has_next is None on this path (last_body is None
    # because no body was ever parsed), so even without the
    # page_open_failed guard the max_cap_reached branch would not fire.
    # We still assert the contract explicitly because the regression
    # path the patch closes is "long silent hang masquerading as
    # something else."
    assert summary_dict.get("last_observed_has_next") in (None, False)


@pytest.mark.asyncio
async def test_open_handshake_timeout_runs_session_close_in_finally():
    """The connector's `finally` block must still call `session.close()`
    even when the open-handshake wrapper aborted. Without this, a
    timed-out attempt would leak the underlying Playwright objects
    across the multi-sort orchestrator's subsequent attempts."""
    session = _HangingOpenSession([])
    c, params = _build_open_timeout_connector(session, cold_start_timeout_s=0.05)
    await c.collect(keyword="x", params=params)

    # session.close() ran exactly once via the connector's `finally`.
    assert session.close_calls == 1


@pytest.mark.asyncio
async def test_open_handshake_timeout_uses_cold_start_timeout_value():
    """The wrapper reuses `self._cold_start_timeout_s` per the ticket's
    explicit instruction (no new constructor knob). A larger configured
    timeout means the wait persists longer before firing."""
    import time as _time

    session = _HangingOpenSession([])
    # Use a slightly larger budget so the difference vs the ~0.05s
    # baseline is observable but still fast.
    c, params = _build_open_timeout_connector(session, cold_start_timeout_s=0.30)

    t0 = _time.monotonic()
    await c.collect(keyword="x", params=params)
    elapsed = _time.monotonic() - t0

    # Lower-bound the elapsed time by the configured timeout (minus a
    # small slack for scheduler jitter on slow CI). Upper-bound by a
    # generous ceiling — we are not testing scheduler precision, only
    # that the timeout is plumbed through.
    assert elapsed >= 0.20, f"timed out too early: {elapsed:.3f}s"
    assert elapsed < 5.0, f"timed out too late: {elapsed:.3f}s"

    s = c.last_run_summary
    assert s.page_open_failed is True
    # Verbatim diagnostic includes the configured timeout value (rounded
    # via the format string in the connector).
    assert "exceeded 0s" in s.page_open_error or "exceeded 1s" in s.page_open_error


# ---------------------------------------------------------------------------
# I-OY-CDP-PAGE-ADOPTION — `_PlaywrightReviewSession.open()` now adopts an
# existing CDP page whose URL targets the same goodsNo before falling back
# to `_ctx.new_page()`. Closes the gap diagnosed in
# `ops/agent_handoffs/I-OY-ILSO-VISIBLE-REVIEWS-COLLECTOR-MISS-TRIAGE.md`:
# the operator-visible `&tab=review` page was being ignored.
#
# Required test cases (operator's spec):
#   1. adopts existing page when URL contains target goodsNo
#   2. prefers tab=review page over bare product page
#   3. does not adopt page for different goodsNo
#   4. falls back to new_page when no matching page exists
#   5. adoption avoids calling new_page
#   6. fallback still calls new_page
#   7. skips blank / devtools pages
#   8. adoption records local diagnostics
#
# All tests below drive the unit-level `_maybe_adopt_existing_page`
# helper plus a focused integration test of `open()`'s CDP branch
# against fakes — no real Playwright is instantiated. Existing
# scroll-continuation and open-handshake-timeout tests remain green
# because their fakes never enter `_PlaywrightReviewSession.open`.
# ---------------------------------------------------------------------------


_TARGET_GOODS = "A000000238828"
_PRODUCT_URL_TAB_REVIEW = (
    "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
    "?goodsNo=A000000238828&tab=review"
)


class _FakePage:
    """Stand-in for a Playwright Page exposing the surface the
    connector touches on adopted pages.

    `_maybe_adopt_existing_page` reads only `page.url`. After the
    helper returns, however, `open()` calls
    `_attach_response_handler(self._page)`, which invokes
    `page.on("response", ...)`. So adopted pages need at minimum a
    no-op `.on(...)` and the locator/evaluate/content surface
    `_trigger_review_list_api` would touch (we monkey-patch that out
    in the integration tests, but the no-op surface is cheap).
    """

    def __init__(self, url: str):
        self.url = url
        self.on_calls: list[tuple[str, object]] = []

    def on(self, event, handler):
        self.on_calls.append((event, handler))

    async def goto(self, url, wait_until=None):  # pragma: no cover
        # Adopted pages must NOT have goto called on them — the
        # adoption branch in open() skips navigation entirely. If a
        # test ever lands here it is a regression.
        raise AssertionError("goto called on adopted page — adoption branch broken")

    async def content(self):
        return "<html></html>"

    def locator(self, selector):
        class _ZeroLoc:
            async def count(self_inner):
                return 0

            async def click(self_inner, timeout=None):  # pragma: no cover
                return None

            async def scroll_into_view_if_needed(self_inner, timeout=None):
                return None

            @property
            def first(self_inner):
                return self_inner
        return _ZeroLoc()

    async def evaluate(self, script):
        return None


class _FakeAsyncPage:
    """Stand-in for a freshly-created Playwright Page on the fallback path.

    `open()` calls `page.goto(...)` and `_attach_response_handler(page)`
    for new pages. `goto` is async; the response handler attaches via
    `page.on("response", ...)`. We record both for assertions.
    """

    def __init__(self, url: str = "about:blank"):
        self.url = url
        self.goto_calls: list[tuple[str, dict]] = []
        self.on_calls: list[tuple[str, object]] = []

    async def goto(self, url, wait_until=None, timeout=None):  # noqa: D401
        # `timeout` is accepted (defaulted None) so the recovery path
        # `reload_and_reopen_review_tab` — which calls
        # `goto(url, wait_until="domcontentloaded", timeout=20000)` —
        # exercises this fake without raising a TypeError on the
        # extra kwarg. Existing adoption tests do not pass `timeout`
        # and continue to record `None` in the call dict, preserving
        # their assertion contracts.
        self.goto_calls.append(
            (url, {"wait_until": wait_until, "timeout": timeout}),
        )
        # Update URL so subsequent diagnostics see the navigated page.
        self.url = url

    def on(self, event, handler):
        self.on_calls.append((event, handler))

    async def content(self):  # used by the post-goto image capture hook
        return "<html></html>"

    def locator(self, selector):
        # The trigger-review-list-api cascade walks locators and counts.
        # Our fake returns zero matches so every cascade step is a no-op.
        class _ZeroLoc:
            async def count(self_inner):
                return 0

            async def click(self_inner, timeout=None):  # pragma: no cover
                return None

            async def scroll_into_view_if_needed(self_inner, timeout=None):
                return None

            @property
            def first(self_inner):
                return self_inner
        return _ZeroLoc()

    async def evaluate(self, script):
        return None


class _FakeBrowser:
    def __init__(self, contexts):
        self.contexts = list(contexts)


class _FakeBrowserContext:
    """Captures `pages`, `new_page` calls, and exposes
    `new_context`-shaped accessors needed by the CDP branch of
    `_PlaywrightReviewSession.open()`. Tests inject this directly onto
    the session instance via `object.__new__`."""

    def __init__(self, pages):
        self.pages = list(pages)
        self.new_page_calls = 0
        self._next_page_url = "about:blank"

    async def new_page(self):
        self.new_page_calls += 1
        page = _FakeAsyncPage(self._next_page_url)
        self.pages.append(page)
        return page


def _make_session_for_adoption(pages):
    """Build a `_PlaywrightReviewSession` instance with just enough
    state for `_maybe_adopt_existing_page` to run.

    Bypasses `__init__` (which would launch Playwright). Mirrors the
    pattern at line ~2487 used by
    `test_trigger_review_list_api_runs_without_attribute_error`.
    """
    from src.voc.connectors import oliveyoung_browser_api as mod
    sess = object.__new__(mod._PlaywrightReviewSession)
    sess._ctx = _FakeBrowserContext(pages)
    sess._existing_page_candidate_count = 0
    sess._adopted_existing_page = False
    sess._adopted_page_url_at_open = None
    return sess


def test_adopts_existing_page_when_url_contains_target_goods_no():
    """Single existing page on the target goodsNo → adopted; the
    `_existing_page_candidate_count` counter records 1 candidate."""
    page = _FakePage(_PRODUCT_URL_TAB_REVIEW)
    sess = _make_session_for_adoption([page])

    chosen = sess._maybe_adopt_existing_page(_PRODUCT_URL_TAB_REVIEW)

    assert chosen is page
    assert sess._existing_page_candidate_count == 1


def test_prefers_tab_review_page_over_bare_product_page():
    """Two candidates: bare detail + `&tab=review`. The `tab=review`
    page wins because the score (3+2+1=6) beats the bare detail
    (2+1=3)."""
    bare = _FakePage(
        "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
        f"?goodsNo={_TARGET_GOODS}",
    )
    tab_review = _FakePage(_PRODUCT_URL_TAB_REVIEW)
    sess = _make_session_for_adoption([bare, tab_review])

    chosen = sess._maybe_adopt_existing_page(_PRODUCT_URL_TAB_REVIEW)

    assert chosen is tab_review
    assert sess._existing_page_candidate_count == 2


def test_prefers_tab_review_regardless_of_list_order():
    """Order-independence: putting `tab=review` first must still pick
    it over the bare detail page, and putting it last must still pick
    it. This guards against accidental `pages[0]` shortcuts."""
    bare_url = (
        "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
        f"?goodsNo={_TARGET_GOODS}"
    )
    # Tab-review last
    sess = _make_session_for_adoption([
        _FakePage(bare_url),
        _FakePage(_PRODUCT_URL_TAB_REVIEW),
    ])
    chosen = sess._maybe_adopt_existing_page(_PRODUCT_URL_TAB_REVIEW)
    assert "tab=review" in chosen.url

    # Tab-review first
    sess = _make_session_for_adoption([
        _FakePage(_PRODUCT_URL_TAB_REVIEW),
        _FakePage(bare_url),
    ])
    chosen = sess._maybe_adopt_existing_page(_PRODUCT_URL_TAB_REVIEW)
    assert "tab=review" in chosen.url


def test_does_not_adopt_page_for_different_goods_no():
    """Pages exist but none target the requested goodsNo → no
    adoption, candidate_count is 0."""
    foreign = _FakePage(
        "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
        "?goodsNo=A999999999999&tab=review",
    )
    other = _FakePage(
        "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
        "?goodsNo=B000000000000",
    )
    sess = _make_session_for_adoption([foreign, other])

    chosen = sess._maybe_adopt_existing_page(_PRODUCT_URL_TAB_REVIEW)

    assert chosen is None
    assert sess._existing_page_candidate_count == 0


def test_falls_back_to_new_page_when_no_matching_page_exists():
    """Empty `pages` list → helper returns None (fallback path
    activates in `open()`)."""
    sess = _make_session_for_adoption([])

    chosen = sess._maybe_adopt_existing_page(_PRODUCT_URL_TAB_REVIEW)

    assert chosen is None
    assert sess._existing_page_candidate_count == 0


def test_skips_blank_and_devtools_pages():
    """Pages with `about:blank`, `chrome://newtab/`, `devtools://`
    URLs must not adopt even if a downstream substring match would
    otherwise fire — defense against pathological mocks and against
    accidental devtools/newtab adoption when the operator opens a new
    tab."""
    blank = _FakePage("about:blank")
    newtab = _FakePage("chrome://newtab/")
    devtools = _FakePage(
        f"devtools://devtools/bundled/inspector.html?goodsNo={_TARGET_GOODS}",
    )
    # Even if a stray internal URL contains the goodsNo marker (it does
    # in the devtools fake), the prefix filter must drop it.
    real = _FakePage(_PRODUCT_URL_TAB_REVIEW)
    sess = _make_session_for_adoption([blank, newtab, devtools, real])

    chosen = sess._maybe_adopt_existing_page(_PRODUCT_URL_TAB_REVIEW)

    assert chosen is real
    assert sess._existing_page_candidate_count == 1


def test_helper_handles_url_without_goods_no_param():
    """When the connector is configured with a URL that doesn't carry
    `goodsNo` (degenerate case), the helper returns None without
    raising — the fallback path stays safe for unknown-target callers."""
    sess = _make_session_for_adoption([_FakePage(_PRODUCT_URL_TAB_REVIEW)])
    chosen = sess._maybe_adopt_existing_page("https://example.com/")
    assert chosen is None
    assert sess._existing_page_candidate_count == 0


def test_extract_target_goods_no_pulls_query_param():
    """Static helper — confirms goodsNo extraction matches the URL
    contract OY uses (and does NOT regex it)."""
    from src.voc.connectors import oliveyoung_browser_api as mod
    fn = mod._PlaywrightReviewSession._extract_target_goods_no
    assert fn(_PRODUCT_URL_TAB_REVIEW) == _TARGET_GOODS
    # No goodsNo → None, no exception.
    assert fn("https://www.oliveyoung.co.kr/") is None
    # Empty / None → None, no exception.
    assert fn("") is None
    assert fn(None) is None  # type: ignore[arg-type]


# ---- integration-shaped tests against the open() CDP branch -------------


def _build_cdp_session(pages):
    """Build a session ready to run `open()` against a fake CDP context.

    Bypasses `__init__` (so Playwright never launches), then sets the
    fields `open()` reads on the CDP branch:
      - `_cdp_endpoint` non-None → CDP branch
      - `_force_fresh_context = False` → reuse existing context
      - `_browser.contexts[0]` is the fake context
      - all the diagnostic flags `__init__` would normally seed
    """
    from src.voc.connectors import oliveyoung_browser_api as mod
    sess = object.__new__(mod._PlaywrightReviewSession)
    sess._cdp_endpoint = "http://127.0.0.1:9222"
    sess._force_fresh_context = False
    sess._headless = True
    sess._user_agent = ""
    sess._viewport = {"width": 1280, "height": 800}
    sess._storage_state_path = None
    sess._review_tab_locator = "div.review-tab"
    sess._scroll_candidates = ()
    sess._sort_button_label_ko = None
    sess._sort_button_selector = None
    sess._sort_container_candidates = ()
    sess._sort_disclosure_affordance_labels_ko = ()
    sess._sort_hunt_settle_s = 0.0
    sess._sort_hunt_poll_interval_s = 1.0
    sess._false_empty_markers_ko = ()
    sess._interstitial_markers_ko = ()
    sess._expected_sort_type = None
    sess._review_more_button_clicked = False
    sess._scrolled_to_review_area = False
    sess._adopted_existing_page = False
    sess._existing_page_candidate_count = 0
    sess._adopted_page_url_at_open = None
    sess._opened_product_url = None
    sess._observed_product_image_url = None
    sess._observed_total_review_count = None
    sess._observed_breadcrumb = None
    sess._product_image_capture_diagnostic = {
        "attempted": False,
        "page_url": None,
        "html_length": None,
        "og_count": 0,
        "jsonld_count": 0,
        "twitter_count": 0,
        "link_image_src_count": 0,
        "oy_thumbnail_img_count": 0,
        "selected_source": None,
        "error": None,
        "session_id": id(sess),
        "session_class": "fake",
        "session_open_called": False,
        "session_open_url_at_start": None,
        "capture_hook_reached": False,
        "session_received_cdp_endpoint": sess._cdp_endpoint,
    }
    sess._queue = asyncio.Queue()
    sess._request_log = []
    sess._observed_sort_types_count = {}
    sess._responses_filtered_out_by_sort = 0
    sess._last_seen_sort_labels = []
    sess._sort_control_unreachable = False
    sess._api_path = "/review/api/v2/reviews/cursor"
    sess._owns_browser = False
    sess._owns_context = False
    sess._closed = False

    ctx = _FakeBrowserContext(pages)
    sess._ctx_for_test = ctx  # back-reference for assertions
    sess._browser_for_test = _FakeBrowser([ctx])
    return sess


class _FakePlaywright:
    """Drop-in for `async_playwright().start()`'s return value.

    We patch `async_playwright` at the module level to return an object
    whose `.start()` yields a chromium-shaped helper that connects over
    CDP and produces our fake browser. Avoids needing Playwright on
    the test path.
    """

    def __init__(self, browser):
        self._browser = browser
        self.chromium = self  # so `pw.chromium.connect_over_cdp` works

    async def connect_over_cdp(self, endpoint):
        return self._browser

    async def stop(self):
        return None


class _FakeAsyncPlaywright:
    def __init__(self, browser):
        self._browser = browser

    async def start(self):
        return _FakePlaywright(self._browser)


@pytest.mark.asyncio
async def test_adoption_avoids_calling_new_page(monkeypatch):
    """Operator's spec test #5: when adoption succeeds, `_ctx.new_page`
    is NOT awaited. The integration test runs the full `open()` flow
    against a fake CDP browser/context."""
    target_page = _FakePage(_PRODUCT_URL_TAB_REVIEW)
    sess = _build_cdp_session([target_page])

    from src.voc.connectors import oliveyoung_browser_api as mod
    monkeypatch.setattr(
        mod, "async_playwright",
        lambda: _FakeAsyncPlaywright(sess._browser_for_test),
        raising=False,
    )
    # The capture-image hook calls page.content() — our _FakePage doesn't
    # have it. Adoption skips the goto AND the capture hook is gated on
    # the goto-side conditions, but the open() body still runs the
    # capture try/except. Patch the capture method to a no-op so we can
    # focus on adoption behavior.
    async def _noop_capture(*a, **kw):
        return None
    sess._capture_product_image_url_from_page = _noop_capture

    async def _noop_trigger(initial_click=True):
        return None
    sess._trigger_review_list_api = _noop_trigger
    sess._capture_total_review_count_from_dom = _noop_capture
    sess._capture_breadcrumb_from_dom = _noop_capture

    # Inject the import path used inside open() so the real
    # `from playwright.async_api import async_playwright` line resolves
    # to our fake. We patch the actual symbol used at runtime.
    import sys as _sys
    fake_pw_module = type(_sys)("playwright.async_api")
    fake_pw_module.async_playwright = lambda: _FakeAsyncPlaywright(
        sess._browser_for_test,
    )
    monkeypatch.setitem(
        _sys.modules, "playwright", type(_sys)("playwright"),
    )
    monkeypatch.setitem(
        _sys.modules, "playwright.async_api", fake_pw_module,
    )

    await sess.open(_PRODUCT_URL_TAB_REVIEW)

    # Operator contract #5: new_page MUST NOT have been called.
    assert sess._ctx_for_test.new_page_calls == 0
    # Operator contract #1: the adopted page is the existing page.
    assert sess._page is target_page
    # Operator contract #8: diagnostics recorded.
    assert sess._adopted_existing_page is True
    assert sess._existing_page_candidate_count == 1
    assert sess._adopted_page_url_at_open == _PRODUCT_URL_TAB_REVIEW


@pytest.mark.asyncio
async def test_fallback_still_calls_new_page_and_navigates(monkeypatch):
    """Operator's spec test #6: when no candidate matches, the
    fallback path must still call `_ctx.new_page()` and the connector
    must `goto(product_url)` so the prior happy path stays intact."""
    # No matching pages in the context.
    sess = _build_cdp_session(pages=[])

    from src.voc.connectors import oliveyoung_browser_api as mod

    async def _noop_capture(*a, **kw):
        return None
    sess._capture_product_image_url_from_page = _noop_capture

    async def _noop_trigger(initial_click=True):
        return None
    sess._trigger_review_list_api = _noop_trigger
    sess._capture_total_review_count_from_dom = _noop_capture
    sess._capture_breadcrumb_from_dom = _noop_capture

    import sys as _sys
    fake_pw_module = type(_sys)("playwright.async_api")
    fake_pw_module.async_playwright = lambda: _FakeAsyncPlaywright(
        sess._browser_for_test,
    )
    monkeypatch.setitem(
        _sys.modules, "playwright", type(_sys)("playwright"),
    )
    monkeypatch.setitem(
        _sys.modules, "playwright.async_api", fake_pw_module,
    )

    await sess.open(_PRODUCT_URL_TAB_REVIEW)

    # Fallback path activated: a fresh page was created in the context.
    assert sess._ctx_for_test.new_page_calls == 1
    # Diagnostic flag flipped to False — operator can grep this.
    assert sess._adopted_existing_page is False
    assert sess._existing_page_candidate_count == 0
    # The fresh page received a goto(product_url) call.
    assert isinstance(sess._page, _FakeAsyncPage)
    assert len(sess._page.goto_calls) == 1
    assert sess._page.goto_calls[0][0] == _PRODUCT_URL_TAB_REVIEW


@pytest.mark.asyncio
async def test_adoption_records_diagnostics(monkeypatch):
    """Operator's spec test #8: after adoption, the three diagnostic
    fields are populated as described in the ticket spec.

    `_adopted_existing_page=True`, `_existing_page_candidate_count>=1`,
    `_adopted_page_url_at_open` is the chosen URL.
    """
    target_page = _FakePage(_PRODUCT_URL_TAB_REVIEW)
    sess = _build_cdp_session([target_page])

    async def _noop_capture(*a, **kw):
        return None
    sess._capture_product_image_url_from_page = _noop_capture

    async def _noop_trigger(initial_click=True):
        return None
    sess._trigger_review_list_api = _noop_trigger
    sess._capture_total_review_count_from_dom = _noop_capture
    sess._capture_breadcrumb_from_dom = _noop_capture

    import sys as _sys
    fake_pw_module = type(_sys)("playwright.async_api")
    fake_pw_module.async_playwright = lambda: _FakeAsyncPlaywright(
        sess._browser_for_test,
    )
    monkeypatch.setitem(
        _sys.modules, "playwright", type(_sys)("playwright"),
    )
    monkeypatch.setitem(
        _sys.modules, "playwright.async_api", fake_pw_module,
    )

    await sess.open(_PRODUCT_URL_TAB_REVIEW)

    assert sess._adopted_existing_page is True
    assert sess._existing_page_candidate_count >= 1
    assert sess._adopted_page_url_at_open == _PRODUCT_URL_TAB_REVIEW


# ---------------------------------------------------------------------------
# I-OY-SCROLL-RECOVERY-COLD-START-REARM — connector recovery cold-start
# re-arm. The page-recreate step in `reload_and_reopen_review_tab` was
# previously a passive wait: close old page → new page → re-attach
# listener → goto → review-tab cascade. It did NOT re-fire the
# sort-button click, so the recreated page emitted its page-default
# sort (USEFUL_SCORE_DESC) and the `_attach_response_handler` filter
# (keyed on `_expected_sort_type`) dropped every response —
# post-recreate cold-start timed out on Ilso A000000225736.
#
# Fix: after the review-tab cascade, mirror the initial `open()`
# sequence by calling `_click_sort_button_robust()` when a sort
# label or legacy selector is configured. The listener was already
# re-attached so the install-before-trigger ordering is preserved.
#
# Required test cases (mirror the dispatch's required coverage):
#   A. Recovery re-arm calls sort-button click after page recreate.
#   B. Listener installed BEFORE sort-button click (ordering invariant).
#   C. Recovery skips sort-button click when no sort label configured
#      (legacy behavior preserved for page-default sort).
#   D. Sort-button click failure is swallowed — recovery does not raise.
#
# Tests below drive the REAL `_PlaywrightReviewSession.reload_and_reopen_review_tab`
# method against an `object.__new__` instance with a minimal hand-built
# surface (mirrors the pattern at line ~2487 / line ~3265). The earlier
# E2E recovery tests (`_RecoveryFakeSession`, line ~2517+) exercise the
# connector loop with an OVERRIDDEN recovery method; they do not cover
# the post-recreate sort-button click path because the override
# bypasses the real method entirely. These unit-level tests close that
# gap.
# ---------------------------------------------------------------------------


class _RearmFakeAsyncPage(_FakeAsyncPage):
    """Extension of `_FakeAsyncPage` that adds the `.close()` coroutine
    `reload_and_reopen_review_tab` calls on the OLD page. Also records
    `close_calls` so tests can assert the page-recreate sequence ran
    end-to-end."""

    def __init__(self, url: str = "about:blank"):
        super().__init__(url)
        self.close_calls = 0

    async def close(self):
        self.close_calls += 1


def _build_rearm_session(*, sort_button_label_ko: str | None):
    """Construct a `_PlaywrightReviewSession` instance with just enough
    state for `reload_and_reopen_review_tab` to execute end-to-end
    without launching Playwright. Mirrors the `_make_session_for_adoption`
    pattern but configures the surface the recovery method touches:
    `_ctx`, `_page`, `_opened_product_url`, sort-button config,
    response-handler-attach state (queue, request log, observed-sort
    counters, expected sort, api_path), and the trigger-cascade
    state (`_review_tab_locator`, telemetry flags).

    Returns `(session, ordering_log, old_page)` where `ordering_log`
    records the method-call sequence on the session for
    install-before-trigger assertions.
    """
    from src.voc.connectors import oliveyoung_browser_api as mod

    sess = object.__new__(mod._PlaywrightReviewSession)
    # Context with a fake old page; `new_page()` returns a fresh
    # `_FakeAsyncPage` (defined above) which the recovery method
    # attaches the response handler to.
    old_page = _RearmFakeAsyncPage(url=_PRODUCT_URL_TAB_REVIEW)
    sess._ctx = _FakeBrowserContext([])
    sess._page = old_page
    sess._opened_product_url = _PRODUCT_URL_TAB_REVIEW
    # Response-handler closure inputs (captured by `_attach_response_handler`).
    sess._queue = asyncio.Queue()
    sess._request_log = []
    sess._observed_sort_types_count = {}
    sess._responses_filtered_out_by_sort = 0
    sess._observed_total_review_count = None
    sess._api_path = "/review/api/v2/reviews/cursor"
    sess._expected_sort_type = "DATETIME_DESC" if sort_button_label_ko else None
    # Trigger-cascade state.
    sess._review_tab_locator = "div.review-tab"
    sess._review_more_button_clicked = False
    sess._scrolled_to_review_area = False
    # Sort-button config (recovery's new step).
    sess._sort_button_label_ko = sort_button_label_ko
    sess._sort_button_selector = None
    # Spy out the inner helpers so we can assert call order without
    # driving the full Playwright surface. The internals of
    # `_attach_response_handler`, `_trigger_review_list_api`, and
    # `_click_sort_button_robust` are covered by their dedicated
    # tests elsewhere in this file.
    ordering_log: list[str] = []

    real_attach = sess._attach_response_handler

    def _spy_attach(page):
        ordering_log.append("attach_response_handler")
        return real_attach(page)

    async def _spy_trigger(*, initial_click: bool = True):
        ordering_log.append(
            f"trigger_review_list_api(initial_click={initial_click})",
        )

    async def _spy_click_sort():
        ordering_log.append("click_sort_button_robust")

    # Bind the spies onto the instance.
    sess._attach_response_handler = _spy_attach  # type: ignore[assignment]
    sess._trigger_review_list_api = _spy_trigger  # type: ignore[assignment]
    sess._click_sort_button_robust = _spy_click_sort  # type: ignore[assignment]
    return sess, ordering_log, old_page


@pytest.mark.asyncio
async def test_recovery_rearm_calls_sort_button_click_after_recreate():
    """`reload_and_reopen_review_tab` re-fires the sort-button click
    after creating the fresh page. Without this the response filter
    (keyed on `_expected_sort_type`) drops every response from the
    page-default sort and the post-recreate cold-start times out
    (the symptom on Ilso A000000225736).
    """
    sess, ordering_log, old_page = _build_rearm_session(
        sort_button_label_ko="최신순",
    )

    await sess.reload_and_reopen_review_tab()

    # Old page closed; fresh page created and attached.
    assert old_page.close_calls == 1
    assert sess._ctx.new_page_calls == 1
    # Sort-button click is in the ordering log AFTER the response
    # handler attach AND after the review-tab cascade.
    assert "click_sort_button_robust" in ordering_log


@pytest.mark.asyncio
async def test_recovery_rearm_listener_installed_before_sort_click():
    """Install-before-trigger invariant: `_attach_response_handler`
    must run BEFORE `_click_sort_button_robust`. If the listener
    is installed after the sort-button click, the post-click cursor
    API response races past the listener and the connector misses
    its cold-start signal. This invariant mirrors the initial
    `open()` sequence (attach → trigger → click).
    """
    sess, ordering_log, _ = _build_rearm_session(
        sort_button_label_ko="최신순",
    )

    await sess.reload_and_reopen_review_tab()

    attach_index = ordering_log.index("attach_response_handler")
    trigger_index = ordering_log.index(
        "trigger_review_list_api(initial_click=True)",
    )
    click_index = ordering_log.index("click_sort_button_robust")
    # Attach must happen first; trigger must happen before click
    # (the review-tab cascade primes the page so the sort row renders
    # — the actual sort-button click then re-fires the cursor API).
    assert attach_index < trigger_index < click_index, (
        f"recovery cold-start re-arm ordering broken: {ordering_log!r}"
    )


@pytest.mark.asyncio
async def test_recovery_rearm_skips_sort_click_when_no_label():
    """When the session has no sort-button label/selector configured
    (page-default sort path, e.g. USEFUL_SCORE_DESC), the recovery
    method must NOT call `_click_sort_button_robust`. Preserves legacy
    behavior for untargeted sorts."""
    sess, ordering_log, _ = _build_rearm_session(sort_button_label_ko=None)

    await sess.reload_and_reopen_review_tab()

    # Listener + review-tab cascade still run.
    assert "attach_response_handler" in ordering_log
    assert any(
        s.startswith("trigger_review_list_api") for s in ordering_log
    )
    # Sort-button click was NOT invoked.
    assert "click_sort_button_robust" not in ordering_log


@pytest.mark.asyncio
async def test_recovery_rearm_swallows_sort_click_failure():
    """`_click_sort_button_robust` raising must NOT propagate out of
    `reload_and_reopen_review_tab`. The recovery method is best-effort
    — a failed sort-button hunt falls through to the recovery
    cold-start which will time out cleanly via the existing
    diagnostic path. Mirrors the existing review-tab cascade's
    try/except contract (`_trigger_review_list_api` exception swallow)."""
    sess, ordering_log, _ = _build_rearm_session(
        sort_button_label_ko="최신순",
    )

    async def _raising_click():
        ordering_log.append("click_sort_button_robust_raised")
        raise RuntimeError("sort-button click failed")

    sess._click_sort_button_robust = _raising_click  # type: ignore[assignment]

    # MUST NOT raise — best-effort, falls through to the connector's
    # post-recreate `wait_for_next_response` which will then time out
    # via the existing diagnostic path.
    await sess.reload_and_reopen_review_tab()

    assert "click_sort_button_robust_raised" in ordering_log
