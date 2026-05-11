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
    """Extension of `_FakeAsyncPage` that adds the `.close()` and
    `.reload()` coroutines `reload_and_reopen_review_tab` calls. Also
    records `close_calls` and `reload_calls` so tests can assert the
    page-recovery sequence ran end-to-end.

    `reload_should_raise` controls whether `reload()` raises (forcing
    the I-OY-RECOVERY-RECREATE-STRATEGY-REVISION reload-first path to
    fall through to recreate) or succeeds (allowing the reload-first
    path to proceed into the shared post-navigation cascade).
    Defaults to `True` so tests built with `_build_rearm_session` /
    `_build_readiness_session` continue to exercise the historical
    recreate path; new I-OY-RECOVERY-RECREATE-STRATEGY-REVISION tests
    that want the reload-first success path pass `reload_should_raise=False`.
    """

    def __init__(
        self,
        url: str = "about:blank",
        *,
        reload_should_raise: bool = True,
    ):
        super().__init__(url)
        self.close_calls = 0
        self.reload_calls: list[dict] = []
        self._reload_should_raise = reload_should_raise

    async def close(self):
        self.close_calls += 1

    async def reload(self, wait_until=None, timeout=None):
        # Record the call regardless of outcome so tests can assert
        # the reload-first path was at least attempted.
        self.reload_calls.append(
            {"wait_until": wait_until, "timeout": timeout},
        )
        if self._reload_should_raise:
            raise RuntimeError("reload failed (fake)")
        # Successful reload is a no-op in the fake — the production
        # readiness wait + cascade then runs against the fake page
        # exactly as it would after `goto`. Tests using
        # `_RearmReadinessFakePage` get count-flipping locator
        # semantics on the SAME page object (no new_page() involved),
        # which is the key behavioral difference vs the recreate
        # path.
        return None


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


# ---------------------------------------------------------------------------
# I-OY-RECOVERY-WAIT-FOR-REVIEW-TAB-RENDER — bounded readiness wait
# between the post-recreate review-tab cascade and the sort-button
# click. Without this, on Ilso A000000225736 the sort-button hunt
# enumerated only generic site-nav buttons (`최신순` absent in DOM)
# and the hunt deadlined → status `sort_control_unreachable`.
#
# Fix: poll for `div.pc-sort` (or any `_sort_container_candidates`
# selector) to exist BEFORE the sort-button hunt starts. When the
# wait deadlines, single-shot re-trigger of the review-tab cascade
# then re-wait. Readiness signal surfaces via the tri-state getter
# `get_post_recreate_sort_area_ready()` so the connector loop can
# emit a narrow `_note` for `sample_dropped_reasons`.
#
# Required test cases (mirror the dispatch's required coverage):
#   A. Wait succeeds — sort area appears on first probe; click fires.
#   B. Wait-before-click ordering — attach → trigger → wait → click.
#   C. Wait timeout — sort area never renders; click still runs
#      (preserves current failure-mode contract); single-shot
#      re-trigger fired; `_post_recreate_sort_area_ready` is False.
#   D. Re-trigger behavior — wait fails once, re-trigger fires,
#      wait succeeds on second attempt → click happens.
# ---------------------------------------------------------------------------


class _SortAreaSimulatorLocator:
    """Locator stand-in for `_RearmReadinessFakePage` whose `count()`
    return value is driven by a per-selector predicate captured at
    construction. `first` returns the same instance so the `.first`
    chain at `page.locator(sel).first.count()` works."""

    def __init__(self, count_provider):
        # `count_provider` is a zero-arg callable returning the
        # locator's current count. Re-invoked on every `count()` so
        # the production poll loop sees the latest simulator state.
        self._count_provider = count_provider

    async def count(self):
        return self._count_provider()

    @property
    def first(self):
        return self

    def locator(self, _tag_selector):
        # The readiness probe's target-label inner-text path drills
        # into `container.locator("button"/"a"/"[role=button]")`. We
        # provide a zero-count nested locator so the inner-text path
        # short-circuits (count==0 → loop body skipped). The
        # CONTAINER count is what gates the readiness signal in our
        # tests; that is enough to drive both ready (container
        # visible) and not-ready (container absent) paths.
        return _SortAreaSimulatorLocator(lambda: 0)

    async def inner_text(self, timeout=None):  # pragma: no cover
        return ""

    async def click(self, timeout=None):  # pragma: no cover
        return None

    async def scroll_into_view_if_needed(self, timeout=None):  # pragma: no cover
        return None

    def nth(self, _i):  # pragma: no cover
        return self


class _RearmReadinessFakePage(_RearmFakeAsyncPage):
    """Extension of `_RearmFakeAsyncPage` that lets a test drive
    "review sort area appears after N polls" semantics. The
    production readiness wait calls
    `page.locator(_sort_container_candidates[i]).first.count()` on
    each poll; we return a count that flips from 0 to 1 once
    `sort_area_visible_after_count` calls have been observed.
    """

    def __init__(
        self,
        url: str = "about:blank",
        *,
        sort_area_visible_after_count: int = 0,
        sort_container_selectors: tuple[str, ...] = (
            "div.pc-sort",
            ".sort-container",
            "[class*='sort']",
        ),
        reload_should_raise: bool = True,
    ):
        # I-OY-RECOVERY-RECREATE-STRATEGY-REVISION — `reload_should_raise`
        # forwarded to the parent `_RearmFakeAsyncPage`. Default True
        # preserves the prior recreate-only behavior in existing tests.
        # The new reload-first tests pass False so the reload-first
        # path's readiness wait runs against the simulator on the
        # SAME page object.
        super().__init__(url=url, reload_should_raise=reload_should_raise)
        # Number of count() invocations that must elapse before the
        # sort container starts to report count>0. 0 means visible
        # from the first probe.
        self._sort_area_visible_after_count = sort_area_visible_after_count
        self._sort_container_selectors = set(sort_container_selectors)
        # Records every container-selector locator() call so tests
        # can assert the production code actually probed.
        self.container_count_calls = 0

    def locator(self, selector):
        # When the readiness wait probes one of our configured sort
        # container selectors, return a Simulator locator whose
        # count() flips True once the threshold is reached.
        if selector in self._sort_container_selectors:
            def _count_provider():
                self.container_count_calls += 1
                return (
                    1
                    if self.container_count_calls
                    > self._sort_area_visible_after_count
                    else 0
                )
            return _SortAreaSimulatorLocator(_count_provider)
        # Fall back to the zero-count locator from the parent class
        # for any other selector (review-tab cascade selectors, etc.).
        return super().locator(selector)


def _build_readiness_session(
    *,
    sort_button_label_ko: str | None,
    sort_area_visible_after_count: int = 0,
    sort_hunt_settle_s: float = 0.2,
    sort_hunt_poll_interval_s: float = 0.02,
):
    """`_build_rearm_session` variant that wires in the readiness-
    aware fake page. Crucially, this DOES NOT spy
    `_wait_for_review_sort_area_ready` — the real method runs against
    the fake page so we can prove (a) it gets called in the right
    order, (b) it observes the simulated DOM state, and (c) it
    updates `_post_recreate_sort_area_ready` correctly.

    Compresses the production deadline so the test runs in <1s even
    on the negative-path (`not_ready`) case.

    Returns `(session, ordering_log, old_page, new_page_ref)`.
    `new_page_ref` is a list whose first element will be set to the
    fresh page object once `_FakeBrowserContext.new_page()` runs;
    tests can read it to assert against `container_count_calls`.
    """
    from src.voc.connectors import oliveyoung_browser_api as mod

    sess = object.__new__(mod._PlaywrightReviewSession)
    # Old page is a basic rearm fake (will be close()d).
    old_page = _RearmFakeAsyncPage(url=_PRODUCT_URL_TAB_REVIEW)
    # Context's `new_page()` returns a readiness-aware fake.
    new_page_ref: list = []

    class _ReadinessCtx(_FakeBrowserContext):
        def __init__(self, pages, visible_after):
            super().__init__(pages)
            self._visible_after = visible_after

        async def new_page(self):
            self.new_page_calls += 1
            page = _RearmReadinessFakePage(
                url=self._next_page_url,
                sort_area_visible_after_count=self._visible_after,
            )
            self.pages.append(page)
            new_page_ref.append(page)
            return page

    sess._ctx = _ReadinessCtx([], sort_area_visible_after_count)
    sess._page = old_page
    sess._opened_product_url = _PRODUCT_URL_TAB_REVIEW
    sess._queue = asyncio.Queue()
    sess._request_log = []
    sess._observed_sort_types_count = {}
    sess._responses_filtered_out_by_sort = 0
    sess._observed_total_review_count = None
    sess._api_path = "/review/api/v2/reviews/cursor"
    sess._expected_sort_type = "DATETIME_DESC" if sort_button_label_ko else None
    sess._review_tab_locator = "div.review-tab"
    sess._review_more_button_clicked = False
    sess._scrolled_to_review_area = False
    sess._sort_button_label_ko = sort_button_label_ko
    sess._sort_button_selector = None
    # Sort-area readiness wait depends on these.
    sess._sort_container_candidates = (
        "div.pc-sort",
        ".sort-container",
        "[class*='sort']",
    )
    sess._sort_hunt_settle_s = float(sort_hunt_settle_s)
    sess._sort_hunt_poll_interval_s = float(sort_hunt_poll_interval_s)
    # Tri-state readiness initialised by the constructor in
    # production; mirror that here so the recovery method sees the
    # same starting state.
    sess._post_recreate_sort_area_ready = None

    ordering_log: list[str] = []
    real_attach = sess._attach_response_handler

    def _spy_attach(page):
        ordering_log.append("attach_response_handler")
        return real_attach(page)

    async def _spy_trigger(*, initial_click: bool = True):
        ordering_log.append(
            f"trigger_review_list_api(initial_click={initial_click})",
        )

    # Wrap the REAL readiness wait so the ordering log records when
    # it ran (we don't replace it — the test's whole point is to
    # exercise the production wait logic against the simulated DOM).
    real_wait = sess._wait_for_review_sort_area_ready

    async def _spied_wait(*, timeout_s, poll_interval_s):
        ordering_log.append("wait_for_review_sort_area_ready")
        result = await real_wait(
            timeout_s=timeout_s, poll_interval_s=poll_interval_s,
        )
        ordering_log.append(
            f"wait_for_review_sort_area_ready_returned={result}",
        )
        return result

    async def _spy_click_sort():
        ordering_log.append("click_sort_button_robust")

    sess._attach_response_handler = _spy_attach  # type: ignore[assignment]
    sess._trigger_review_list_api = _spy_trigger  # type: ignore[assignment]
    sess._wait_for_review_sort_area_ready = _spied_wait  # type: ignore[assignment]
    sess._click_sort_button_robust = _spy_click_sort  # type: ignore[assignment]
    return sess, ordering_log, old_page, new_page_ref


@pytest.mark.asyncio
async def test_recovery_wait_succeeds_when_sort_area_visible_on_first_probe():
    """Test A — readiness wait observes `div.pc-sort` on the first
    probe (`sort_area_visible_after_count=0` → container count flips
    from 0 to 1 immediately). The wait returns True, the sort-button
    click fires, and `_post_recreate_sort_area_ready` is set to True.
    """
    sess, ordering_log, old_page, new_page_ref = _build_readiness_session(
        sort_button_label_ko="최신순",
        sort_area_visible_after_count=0,
    )

    await sess.reload_and_reopen_review_tab()

    assert old_page.close_calls == 1
    assert sess._ctx.new_page_calls == 1
    assert "wait_for_review_sort_area_ready_returned=True" in ordering_log
    # Click fires AFTER the wait succeeds.
    assert "click_sort_button_robust" in ordering_log
    # Tri-state readiness recorded as True for the connector's _note.
    assert sess._post_recreate_sort_area_ready is True
    assert sess.get_post_recreate_sort_area_ready() is True
    # The new page was probed for the sort container.
    assert len(new_page_ref) == 1
    assert new_page_ref[0].container_count_calls >= 1


@pytest.mark.asyncio
async def test_recovery_wait_before_click_ordering():
    """Test B — install-before-trigger-before-wait-before-click
    invariant. The full ordering for the recovery path is:

        attach_response_handler
          → trigger_review_list_api(initial_click=True)
          → wait_for_review_sort_area_ready
          → click_sort_button_robust

    Extends the prior `test_recovery_rearm_listener_installed_before_sort_click`
    contract with the new wait step inserted between trigger and
    click.
    """
    sess, ordering_log, _, _ = _build_readiness_session(
        sort_button_label_ko="최신순",
        sort_area_visible_after_count=0,
    )

    await sess.reload_and_reopen_review_tab()

    attach_index = ordering_log.index("attach_response_handler")
    trigger_index = ordering_log.index(
        "trigger_review_list_api(initial_click=True)",
    )
    wait_index = ordering_log.index("wait_for_review_sort_area_ready")
    click_index = ordering_log.index("click_sort_button_robust")
    assert attach_index < trigger_index < wait_index < click_index, (
        f"recovery readiness wait ordering broken: {ordering_log!r}"
    )


@pytest.mark.asyncio
async def test_recovery_wait_times_out_then_single_shot_retrigger_then_click_still_runs():
    """Test C — sort area never renders (`sort_area_visible_after_count`
    set absurdly high). The first wait deadlines, the single-shot
    re-trigger fires, the second wait also deadlines,
    `_post_recreate_sort_area_ready` becomes False, and the sort-button
    click STILL runs (preserves current failure-mode contract: the
    hunt's own deadline + diagnostic path classifies the run as
    `sort_control_unreachable`, exactly as today).
    """
    sess, ordering_log, _, new_page_ref = _build_readiness_session(
        sort_button_label_ko="최신순",
        # Threshold far higher than any plausible poll count within
        # the compressed (0.2s, 0.02s) budget; both waits will
        # exhaust without seeing the container.
        sort_area_visible_after_count=10_000,
    )

    await sess.reload_and_reopen_review_tab()

    # Both waits returned False (one before re-trigger, one after).
    false_returns = [
        line for line in ordering_log
        if line == "wait_for_review_sort_area_ready_returned=False"
    ]
    assert len(false_returns) == 2, (
        f"expected two wait deadlines (one before re-trigger, one "
        f"after); got {ordering_log!r}"
    )
    # Single-shot re-trigger fired between the two waits.
    trigger_indices = [
        i for i, line in enumerate(ordering_log)
        if line == "trigger_review_list_api(initial_click=True)"
    ]
    assert len(trigger_indices) == 2, (
        f"expected exactly two trigger calls (cascade + single-shot "
        f"re-trigger); got {ordering_log!r}"
    )
    # Sort click STILL runs — preserves current failure-mode contract.
    assert "click_sort_button_robust" in ordering_log
    # Tri-state readiness recorded as False for the connector's _note.
    assert sess._post_recreate_sort_area_ready is False
    assert sess.get_post_recreate_sort_area_ready() is False


@pytest.mark.asyncio
async def test_recovery_wait_succeeds_after_single_shot_retrigger():
    """Test D — sort area renders only AFTER the re-trigger. Set
    `sort_area_visible_after_count` so the first wait deadlines but
    enough container-count probes accumulate during the second wait
    that it succeeds. The single-shot re-trigger is the load-bearing
    intervention; assert it fired exactly once and the second wait
    returned True.
    """
    # With sort_hunt_settle_s=0.2 and poll_interval_s=0.02, each
    # wait's probe loop performs up to ~10 iterations × 3 selector
    # probes = 30 container-count() calls per wait (less if the
    # first selector matches and the loop short-circuits; here
    # the threshold guarantees no short-circuit). Setting the
    # visibility threshold at 30 — equal to one full wait's probe
    # budget — means the first wait deadlines (probes 1..30 all
    # return 0 because 30 is NOT > 30), and the second wait's
    # very first probe (#31) returns 1 (31 > 30). This produces
    # the "deadline first, succeed-immediately second" ordering.
    sess, ordering_log, _, new_page_ref = _build_readiness_session(
        sort_button_label_ko="최신순",
        sort_area_visible_after_count=30,
    )

    await sess.reload_and_reopen_review_tab()

    # Exactly one False return (before re-trigger) followed by one
    # True return (after re-trigger).
    wait_returns = [
        line for line in ordering_log
        if line.startswith("wait_for_review_sort_area_ready_returned=")
    ]
    assert wait_returns == [
        "wait_for_review_sort_area_ready_returned=False",
        "wait_for_review_sort_area_ready_returned=True",
    ], (
        f"expected wait-deadline-then-success ordering; got "
        f"{ordering_log!r}"
    )
    # Single-shot re-trigger ran between the two waits.
    trigger_indices = [
        i for i, line in enumerate(ordering_log)
        if line == "trigger_review_list_api(initial_click=True)"
    ]
    assert len(trigger_indices) == 2, (
        f"expected exactly two trigger calls (cascade + single-shot "
        f"re-trigger); got {ordering_log!r}"
    )
    # Listener install ordering preserved across the re-trigger:
    # `_attach_response_handler` must precede BOTH triggers AND the
    # re-trigger AND the click.
    attach_index = ordering_log.index("attach_response_handler")
    for trigger_index in trigger_indices:
        assert attach_index < trigger_index
    click_index = ordering_log.index("click_sort_button_robust")
    assert attach_index < click_index
    # Tri-state readiness recorded as True (second wait succeeded).
    assert sess._post_recreate_sort_area_ready is True
    assert sess.get_post_recreate_sort_area_ready() is True


@pytest.mark.asyncio
async def test_post_recreate_sort_area_ready_getter_none_before_recreate():
    """Tri-state contract: `_post_recreate_sort_area_ready` is None
    when the session has not yet recreated the page (or when the
    recreate early-returned before reaching the readiness wait —
    e.g. context loss, sort label not configured). The connector's
    `_note` path treats None as "no diagnostic to emit," which keeps
    `sample_dropped_reasons` under the 5-entry cap.
    """
    sess, ordering_log, _, _ = _build_readiness_session(
        sort_button_label_ko=None,
    )

    # Before any recreate, readiness is None (initialised by the
    # constructor / `_build_readiness_session`).
    assert sess.get_post_recreate_sort_area_ready() is None

    # When sort_button_label_ko is None, the recovery method does
    # NOT run the readiness wait OR the sort click — it's a
    # page-default-sort path. Readiness stays None.
    await sess.reload_and_reopen_review_tab()
    assert "wait_for_review_sort_area_ready" not in ordering_log
    assert "click_sort_button_robust" not in ordering_log
    assert sess.get_post_recreate_sort_area_ready() is None


# ---------------------------------------------------------------------------
# I-OY-RECOVERY-RECREATE-STRATEGY-REVISION — Option A (reload-first)
# recovery path. The Ilso A000000225736 live proof
# (O-OY-SCROLL-RECOVERY-WAIT-LIVE-PROOF-ILSO) showed the
# close+new_page+goto recreate landing on a page where the
# review-tab DOM never re-mounts (`최신순` absent in the enumerated
# buttons after the 1c1c1f6 12s + 12s wait + single-shot re-trigger).
# The wedged page itself had successfully served 49 cursors before
# the scroll-attempt budget exhausted — proof its review-tab DOM was
# fully functional. Reloading it (preserving page identity, cookies,
# Playwright listener registration) is a less disruptive recovery.
#
# Order of operations on the production path:
#
#   0. Reload-first (Option A) — when eligible (page is on the
#      target goodsNo): drain queue + reset counters in place;
#      `await self._page.reload(...)`; shared post-navigation
#      cascade (trigger → readiness wait + optional single-shot
#      re-trigger → sort click). If readiness wait observes the
#      sort area within budget → strategy = "reload_succeeded";
#      RETURN (skip recreate entirely).
#   1–8. Recreate fallback — historical close+new_page+goto path,
#      runs when reload-first was ineligible OR when reload itself
#      raised OR when post-reload readiness deadlined. Strategy
#      becomes "reload_failed_recreate_fallback" or "recreate_only"
#      depending on which condition triggered the fallback.
#
# Required test coverage (mirror the dispatch's required cases):
#   A1. Reload-first success — same page object reloaded; readiness
#       wait observes sort area; click runs on reloaded page;
#       strategy = "reload_succeeded"; close + new_page NOT called.
#   A2. Reload raises → fallback to recreate; close + new_page
#       called; strategy = "reload_failed_recreate_fallback".
#   A3. Reload succeeds but readiness fails → fallback to recreate;
#       close + new_page called; strategy =
#       "reload_failed_recreate_fallback". Document chosen behavior:
#       the connector falls through to recreate (the production code
#       picked this over "accept the failed reload" because Ilso live
#       proof showed that ONE more page-recreate attempt is exactly
#       what the existing failure-mode contract budgets for).
#   A4. URL mismatch → reload-first ineligible; strategy =
#       "recreate_only"; recreate path runs unchanged.
#   A5. Initial getter state — `get_post_recreate_strategy_used` is
#       None before any recovery call.
#   A6. Listener-before-trigger ordering preserved on reload-first
#       success — no re-attach occurs (listener persists across
#       reload); but the cascade triggers/click still run, AFTER
#       reload completes.
# ---------------------------------------------------------------------------


def _build_reload_first_session(
    *,
    sort_button_label_ko: str | None,
    reload_should_raise: bool = False,
    sort_area_visible_after_count: int = 0,
    sort_hunt_settle_s: float = 0.2,
    sort_hunt_poll_interval_s: float = 0.02,
    opened_product_url: str | None = None,
    old_page_url: str | None = None,
):
    """Test fixture for I-OY-RECOVERY-RECREATE-STRATEGY-REVISION.

    Builds a session whose OLD page is a `_RearmReadinessFakePage` —
    the same simulator the prior I-OY-RECOVERY-WAIT-FOR-REVIEW-TAB-RENDER
    tests use, except it now supports `reload()` and the readiness
    wait runs against the same page object on the reload-first path
    (no new_page() involved).

    Differs from `_build_readiness_session` in two ways:
      1. The OLD page is itself a `_RearmReadinessFakePage` (with the
         count-flipping locator) rather than a basic `_RearmFakeAsyncPage`.
         The reload-first path's cascade probes the SAME page object,
         so the simulator must live on it.
      2. `reload_should_raise` is exposed so tests can drive both
         "reload succeeds" (default — A1, A3, A6 scenarios) and
         "reload raises" (A2 scenario) cases.

    `opened_product_url` and `old_page_url` default to the same URL
    (`_PRODUCT_URL_TAB_REVIEW`) so reload-first is eligible by
    default. Tests that exercise the URL-mismatch eligibility path
    (A4) override `old_page_url` to a different product URL.

    Returns `(session, ordering_log, old_page, new_page_ref)`. The
    new_page_ref will be populated only if the recreate fallback
    fires (reload-first failure path).
    """
    from src.voc.connectors import oliveyoung_browser_api as mod

    sess = object.__new__(mod._PlaywrightReviewSession)
    opened_url = opened_product_url or _PRODUCT_URL_TAB_REVIEW
    old_url = old_page_url or _PRODUCT_URL_TAB_REVIEW
    old_page = _RearmReadinessFakePage(
        url=old_url,
        sort_area_visible_after_count=sort_area_visible_after_count,
        reload_should_raise=reload_should_raise,
    )

    new_page_ref: list = []

    class _ReloadFirstCtx(_FakeBrowserContext):
        def __init__(self, pages, visible_after):
            super().__init__(pages)
            self._visible_after = visible_after

        async def new_page(self):
            self.new_page_calls += 1
            # The fallback recreate path creates a new page when
            # reload-first fails. We give it the same simulator
            # config so the cascade running on the recreate-path
            # new page observes count = 0 (sort area never visible);
            # tests that exercise the fallback should check that the
            # recreate path ran but the readiness on the new page
            # stayed False.
            page = _RearmReadinessFakePage(
                url=self._next_page_url,
                sort_area_visible_after_count=10_000,
                reload_should_raise=True,
            )
            self.pages.append(page)
            new_page_ref.append(page)
            return page

    sess._ctx = _ReloadFirstCtx([], sort_area_visible_after_count)
    sess._page = old_page
    sess._opened_product_url = opened_url
    sess._queue = asyncio.Queue()
    sess._request_log = []
    sess._observed_sort_types_count = {}
    sess._responses_filtered_out_by_sort = 0
    sess._observed_total_review_count = None
    sess._api_path = "/review/api/v2/reviews/cursor"
    sess._expected_sort_type = "DATETIME_DESC" if sort_button_label_ko else None
    sess._review_tab_locator = "div.review-tab"
    sess._review_more_button_clicked = False
    sess._scrolled_to_review_area = False
    sess._sort_button_label_ko = sort_button_label_ko
    sess._sort_button_selector = None
    sess._sort_container_candidates = (
        "div.pc-sort",
        ".sort-container",
        "[class*='sort']",
    )
    sess._sort_hunt_settle_s = float(sort_hunt_settle_s)
    sess._sort_hunt_poll_interval_s = float(sort_hunt_poll_interval_s)
    sess._post_recreate_sort_area_ready = None
    sess._post_recreate_strategy_used = None

    ordering_log: list[str] = []
    real_attach = sess._attach_response_handler

    def _spy_attach(page):
        ordering_log.append("attach_response_handler")
        return real_attach(page)

    async def _spy_trigger(*, initial_click: bool = True):
        ordering_log.append(
            f"trigger_review_list_api(initial_click={initial_click})",
        )

    real_wait = sess._wait_for_review_sort_area_ready

    async def _spied_wait(*, timeout_s, poll_interval_s):
        ordering_log.append("wait_for_review_sort_area_ready")
        result = await real_wait(
            timeout_s=timeout_s, poll_interval_s=poll_interval_s,
        )
        ordering_log.append(
            f"wait_for_review_sort_area_ready_returned={result}",
        )
        return result

    async def _spy_click_sort():
        ordering_log.append("click_sort_button_robust")

    sess._attach_response_handler = _spy_attach  # type: ignore[assignment]
    sess._trigger_review_list_api = _spy_trigger  # type: ignore[assignment]
    sess._wait_for_review_sort_area_ready = _spied_wait  # type: ignore[assignment]
    sess._click_sort_button_robust = _spy_click_sort  # type: ignore[assignment]
    return sess, ordering_log, old_page, new_page_ref


@pytest.mark.asyncio
async def test_reload_first_success_skips_close_and_new_page():
    """Test A1 — reload-first happy path.

    The old page reloads successfully and the readiness wait observes
    the sort area on the first probe. The shared cascade runs on the
    SAME page object: trigger → wait → click. The recreate fallback
    (close + new_page + goto) is NOT invoked. Strategy is recorded as
    "reload_succeeded". This is the load-bearing case for the Ilso
    A000000225736 fix — the wedged page that had served 49 cursors
    successfully gets a less disruptive recovery than the
    close+new_page+goto that demonstrated the structural DOM gap.
    """
    sess, ordering_log, old_page, new_page_ref = _build_reload_first_session(
        sort_button_label_ko="최신순",
        reload_should_raise=False,
        sort_area_visible_after_count=0,
    )

    await sess.reload_and_reopen_review_tab()

    # Reload was attempted on the old page exactly once.
    assert len(old_page.reload_calls) == 1
    # Strategy recorded as "reload_succeeded".
    assert sess.get_post_recreate_strategy_used() == "reload_succeeded"
    # Old page was NOT closed — we reused it.
    assert old_page.close_calls == 0
    # No fresh page was created via the context.
    assert sess._ctx.new_page_calls == 0
    assert new_page_ref == []
    # Cascade ran on the reloaded page: trigger → wait → click.
    assert "wait_for_review_sort_area_ready_returned=True" in ordering_log
    assert "click_sort_button_robust" in ordering_log
    # Readiness recorded as True for the connector's `_note` path.
    assert sess.get_post_recreate_sort_area_ready() is True
    # Listener was NOT re-attached on the reload-first path — the
    # Playwright registration persists across reload (same page
    # object identity). The install-before-trigger invariant remains
    # preserved trivially because the listener was already attached
    # during the prior `open()` call (in production); in test, the
    # spy is registered at construction time, before any cascade
    # call could fire.
    assert "attach_response_handler" not in ordering_log
    # The simulator on the old page WAS probed (proves the production
    # code is actually waiting against the right page object).
    assert old_page.container_count_calls >= 1


@pytest.mark.asyncio
async def test_reload_first_falls_back_to_recreate_when_reload_raises():
    """Test A2 — reload itself raises.

    `_RearmReadinessFakePage(reload_should_raise=True)` makes
    `page.reload()` throw. The connector logs and swallows the
    exception, marks strategy "reload_failed_recreate_fallback", and
    falls through to the historical close+new_page+goto recreate
    path. Listener IS re-attached on the new page (preserving the
    install-before-trigger invariant on the recreate path).
    """
    sess, ordering_log, old_page, new_page_ref = _build_reload_first_session(
        sort_button_label_ko="최신순",
        reload_should_raise=True,
        # New page simulator never shows sort area (10_000 visibility
        # threshold) — proves the fallback path still runs to
        # completion even when the recreated page also fails.
        sort_area_visible_after_count=0,
    )

    await sess.reload_and_reopen_review_tab()

    # Reload was attempted on the old page exactly once.
    assert len(old_page.reload_calls) == 1
    # Strategy recorded as the fallback marker.
    assert (
        sess.get_post_recreate_strategy_used()
        == "reload_failed_recreate_fallback"
    )
    # Old page WAS closed by the recreate fallback.
    assert old_page.close_calls == 1
    # A fresh page WAS created via the context (recreate path ran).
    assert sess._ctx.new_page_calls == 1
    assert len(new_page_ref) == 1
    # Listener was re-attached on the new page — preserves the
    # install-before-trigger invariant on the recreate path.
    assert "attach_response_handler" in ordering_log
    # Trigger fired AFTER attach (install-before-trigger).
    attach_index = ordering_log.index("attach_response_handler")
    trigger_index = ordering_log.index(
        "trigger_review_list_api(initial_click=True)",
    )
    assert attach_index < trigger_index, (
        f"listener install before trigger broken on recreate fallback: "
        f"{ordering_log!r}"
    )


@pytest.mark.asyncio
async def test_reload_first_falls_back_to_recreate_when_readiness_fails():
    """Test A3 — reload succeeds but post-reload readiness deadlines.

    The reloaded page never shows the sort area (high visibility
    threshold). Both reload-first waits deadline, the single-shot
    re-trigger fires between them but doesn't make the sort area
    appear, so `_run_post_navigation_review_cascade` returns False.
    The connector then falls through to the historical recreate
    path. Strategy is recorded as "reload_failed_recreate_fallback".

    Behavior choice: fall-through to recreate (vs accept the failed
    reload and end with `sort_control_unreachable`). Rationale:
      - The existing failure-mode contract budgets up to
        `MAX_SCROLL_RECOVERY_RECREATES` (default 2) page-recreate
        attempts. Treating the reload-first failure as one of the
        ways the FIRST attempt can degrade keeps the budget
        accounting straightforward — the connector still consumes
        one recovery_attempt, and downstream tooling sees the
        existing `scroll_continuation_recovery_attempts=1`
        telemetry.
      - The recreate fallback's `_post_recreate_sort_area_ready =
        False` still fires (via the cascade on the new page), so
        the existing `sort_control_unreachable` classifier path is
        preserved on the worst case where both paths fail.
      - The new `_post_recreate_strategy_used` flag distinguishes
        "reload_failed_recreate_fallback" from "recreate_only" so
        the post-mortem can see whether the smaller fix was tried.
    """
    sess, ordering_log, old_page, new_page_ref = _build_reload_first_session(
        sort_button_label_ko="최신순",
        reload_should_raise=False,
        # Never visible: simulator threshold higher than any plausible
        # poll count within the compressed (0.2s, 0.02s) budget.
        sort_area_visible_after_count=10_000,
    )

    await sess.reload_and_reopen_review_tab()

    # Reload was attempted exactly once (the readiness wait failures
    # don't re-trigger another reload).
    assert len(old_page.reload_calls) == 1
    # Strategy recorded as the fallback marker.
    assert (
        sess.get_post_recreate_strategy_used()
        == "reload_failed_recreate_fallback"
    )
    # Cascade on the reloaded page ran (trigger + wait + re-trigger +
    # wait + click). Both waits returned False.
    false_returns_before_recreate = [
        line for line in ordering_log
        if line == "wait_for_review_sort_area_ready_returned=False"
    ]
    # 4 total Falses: 2 from reload-first cascade, 2 from recreate
    # cascade (since the new page in this fixture also has the
    # never-visible simulator threshold — by design, to prove the
    # fallback also runs to completion).
    assert len(false_returns_before_recreate) == 4, (
        f"expected four wait deadlines (two reload-first, two "
        f"recreate); got {ordering_log!r}"
    )
    # Old page closed + new page created on the recreate fallback.
    assert old_page.close_calls == 1
    assert sess._ctx.new_page_calls == 1
    assert len(new_page_ref) == 1


@pytest.mark.asyncio
async def test_reload_first_skipped_when_page_url_mismatch():
    """Test A4 — URL mismatch makes reload-first ineligible.

    The OLD page's URL contains a DIFFERENT goodsNo than
    `_opened_product_url`. `_reload_strategy_eligible()` returns
    False; the connector goes straight to the recreate path.
    Strategy is recorded as "recreate_only".
    """
    foreign_url = (
        "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
        "?goodsNo=B999999999999"
    )
    sess, ordering_log, old_page, new_page_ref = _build_reload_first_session(
        sort_button_label_ko="최신순",
        # opened_product_url stays on _TARGET_GOODS; old_page_url is
        # on a foreign goodsNo. Eligibility short-circuits.
        old_page_url=foreign_url,
        # `reload_should_raise` is irrelevant in this scenario because
        # reload should NOT be called. Use the raising default so any
        # accidental call would surface as an exception too.
        reload_should_raise=True,
    )

    await sess.reload_and_reopen_review_tab()

    # Reload was NEVER called on the old page (eligibility failed).
    assert old_page.reload_calls == []
    # Strategy recorded as "recreate_only".
    assert sess.get_post_recreate_strategy_used() == "recreate_only"
    # Recreate path ran: old page closed, new page created.
    assert old_page.close_calls == 1
    assert sess._ctx.new_page_calls == 1


@pytest.mark.asyncio
async def test_reload_first_skipped_when_opened_product_url_none():
    """Test A4 (variant) — missing `_opened_product_url` makes
    reload-first ineligible.

    `_reload_strategy_eligible` returns False when
    `_opened_product_url` is None (the session was constructed but
    `open()` never ran, or was reset). Recreate-only path runs;
    strategy = "recreate_only". The recreate path itself then
    early-returns at step 5 (the "no remembered product_url" guard)
    so close + new_page + attach run, but goto + cascade do not.
    """
    sess, ordering_log, old_page, new_page_ref = _build_reload_first_session(
        sort_button_label_ko="최신순",
        reload_should_raise=True,
    )
    # Clear the opened URL after fixture construction.
    sess._opened_product_url = None

    await sess.reload_and_reopen_review_tab()

    # Reload was NEVER called.
    assert old_page.reload_calls == []
    # Strategy = "recreate_only".
    assert sess.get_post_recreate_strategy_used() == "recreate_only"
    # Recreate path's steps 1–4 still ran (close + drain + new_page +
    # attach). Step 5 (goto) early-returns on the None guard.
    assert old_page.close_calls == 1
    assert sess._ctx.new_page_calls == 1


@pytest.mark.asyncio
async def test_post_recreate_strategy_used_getter_none_before_recovery():
    """Test A5 — getter initial state.

    `get_post_recreate_strategy_used()` returns None when the
    session has never invoked `reload_and_reopen_review_tab` (mirror
    of the prior `get_post_recreate_sort_area_ready` tri-state
    contract). The connector's strategy-note path treats None as
    "no diagnostic to emit," keeping `sample_dropped_reasons` clean
    on pre-recovery summaries.
    """
    sess, _, _, _ = _build_reload_first_session(
        sort_button_label_ko="최신순",
    )

    # Before any recreate call, the getter reflects the constructor
    # default (None).
    assert sess.get_post_recreate_strategy_used() is None


@pytest.mark.asyncio
async def test_reload_first_success_listener_not_re_attached():
    """Test A6 — on the reload-first SUCCESS path, the connector
    does NOT call `_attach_response_handler` (the Playwright response
    listener registration persists across `page.reload()` because
    the page object identity is preserved). The install-before-
    trigger invariant remains preserved by the prior `open()` call
    in production: by the time any trigger fires inside
    `reload_and_reopen_review_tab`, the listener has been installed
    since `open()`, well before any cascade call.

    This test pins that contract explicitly: spy never sees an
    "attach_response_handler" entry on the success path, but the
    cascade triggers + click still ran on the reloaded page.
    """
    sess, ordering_log, old_page, new_page_ref = _build_reload_first_session(
        sort_button_label_ko="최신순",
        reload_should_raise=False,
        sort_area_visible_after_count=0,
    )

    await sess.reload_and_reopen_review_tab()

    # Reload-first succeeded → no recreate.
    assert sess.get_post_recreate_strategy_used() == "reload_succeeded"
    # Listener re-attach did NOT happen (production semantics: the
    # listener persists across page.reload).
    assert "attach_response_handler" not in ordering_log
    # But the trigger and click DID fire (cascade ran on the reloaded
    # page). Trigger appears at least once before click.
    triggers = [
        i for i, line in enumerate(ordering_log)
        if line == "trigger_review_list_api(initial_click=True)"
    ]
    assert len(triggers) >= 1, (
        f"expected trigger to fire on reload-first cascade; "
        f"got {ordering_log!r}"
    )
    click_index = ordering_log.index("click_sort_button_robust")
    assert triggers[0] < click_index, (
        f"trigger must precede click on reload-first cascade; "
        f"got {ordering_log!r}"
    )


# ---------------------------------------------------------------------------
# I-OY-RECOVERY-SCROLL-TO-REVIEW-SORT-AND-CLICK — between the readiness
# wait and the robust sort-button hunt, scroll the readiness-matched
# element into view AND attempt a scoped immediate click on the button
# handle the readiness probe already validated. Closes the 12-second
# race observed on Ilso A000000225736 where
# `_wait_for_review_sort_area_ready` emitted
#   signal=target_label_visible target='최신순' poll_attempt=1
# at 15:01:20 and `_click_sort_button_robust` deadlined 12s later
# without finding `최신순` in its enumeration.
#
# Required test coverage (mirror the dispatch's required cases):
#   A. Recovery scroll-to-sort-area runs before the sort click on the
#      recreate path (ordering: attach → trigger → wait → scroll →
#      click). Scoped click succeeds → robust click NOT invoked.
#   B. Scoped click after readiness — readiness signal
#      `target_label_visible` returns a matched element; scoped click
#      fires on that element; robust hunt NOT called.
#   C. Fallback to robust click — when the matched button's click
#      raises, the cascade falls through to `_click_sort_button_robust`.
#   D. Listener-before-trigger ordering preserved across all new code
#      paths.
# ---------------------------------------------------------------------------


class _ScopedClickLocator:
    """Locator stand-in that supports `scroll_into_view_if_needed` /
    `click` for the button matched by the readiness probe. The
    production code reads `self._last_readiness_matched_button` set
    by `_target_label_visible` and calls `scroll_into_view_if_needed`
    + `click` on it; this fake records both and can be configured to
    raise on click so the fallback path is exercised.
    """

    def __init__(
        self,
        *,
        inner_text: str,
        click_should_raise: bool = False,
        scroll_should_raise: bool = False,
    ):
        self._inner_text = inner_text
        self._click_should_raise = click_should_raise
        self._scroll_should_raise = scroll_should_raise
        self.scroll_into_view_calls = 0
        self.click_calls = 0

    async def count(self):
        return 1

    @property
    def first(self):
        return self

    def nth(self, _i):
        return self

    async def inner_text(self, timeout=None):
        return self._inner_text

    async def scroll_into_view_if_needed(self, timeout=None):
        self.scroll_into_view_calls += 1
        if self._scroll_should_raise:
            raise RuntimeError("scroll_into_view_if_needed failed (fake)")
        return None

    async def click(self, timeout=None):
        self.click_calls += 1
        if self._click_should_raise:
            raise RuntimeError("scoped click failed (fake)")
        return None


class _ScopedClickButtonLocatorWrapper:
    """Bridges `container.locator("button")` to the
    `_ScopedClickLocator` instance shared between test and production.
    Production's `_target_label_visible` calls
    `el_locator.count()` then `el_locator.nth(i)` to walk candidates;
    we model a single-button list whose normalized inner_text matches
    the target label so the probe records the button on
    `self._last_readiness_matched_button`.
    """

    def __init__(self, button: _ScopedClickLocator | None):
        self._button = button

    async def count(self):
        return 1 if self._button is not None else 0

    def nth(self, _i):
        return self._button


class _ScopedClickContainerLocator:
    """Container locator served by `_ScrollableReadinessFakePage` for
    `_sort_container_candidates`. Carries a per-selector
    visible-after-count predicate AND, once visible, exposes a child
    `_ScopedClickButtonLocatorWrapper` so the readiness probe's
    inner-text drill matches the target label.

    `scroll_into_view_if_needed` is recorded on the OWNER page so
    tests can assert the production code scrolled the container
    before the click.
    """

    def __init__(
        self,
        *,
        owner_page,
        selector: str,
        count_provider,
        button_factory,
    ):
        self._owner_page = owner_page
        self._selector = selector
        self._count_provider = count_provider
        self._button_factory = button_factory

    async def count(self):
        return self._count_provider()

    @property
    def first(self):
        return self

    def locator(self, tag_selector):
        # The production code drills container.locator("button" / "a"
        # / "[role='button']"). Only the first ("button") returns the
        # matched-text wrapper; the others return zero-count so the
        # probe doesn't double-record.
        if tag_selector == "button":
            return _ScopedClickButtonLocatorWrapper(self._button_factory())
        return _ScopedClickButtonLocatorWrapper(None)

    async def scroll_into_view_if_needed(self, timeout=None):
        self._owner_page.container_scroll_into_view_calls += 1
        if self._owner_page.container_scroll_should_raise:
            raise RuntimeError(
                "container scroll_into_view_if_needed failed (fake)"
            )
        return None


class _ScrollableReadinessFakePage(_RearmFakeAsyncPage):
    """Page fake that drives the FULL real readiness wait + cascade
    surface. Unlike `_RearmReadinessFakePage` (which only models
    container-count semantics) this fake also models the inner
    target-label match AND a clickable button handle so the new
    scoped-click cascade can exercise its scroll + click path end
    to end.

    Configuration knobs:
      - `target_button_label`: text the readiness probe's inner-text
        check normalizes against `_sort_button_label_ko`. Set equal
        to the production target so the probe records a button on
        `_last_readiness_matched_button`. Set to a different string
        to drive the `container_visible` only branch (no button
        handle, no scoped click).
      - `click_should_raise`: when True, the matched button's
        `click()` raises so the cascade falls back to
        `_click_sort_button_robust`.
      - `scroll_should_raise`: when True, the matched button's
        `scroll_into_view_if_needed()` raises; per the production
        contract the cascade still attempts the scoped click.
      - `container_scroll_should_raise`: when True, the matched
        container's `scroll_into_view_if_needed()` raises; cascade
        falls through to the robust hunt.
    """

    def __init__(
        self,
        url: str = "about:blank",
        *,
        target_button_label: str | None = "최신순",
        click_should_raise: bool = False,
        scroll_should_raise: bool = False,
        container_scroll_should_raise: bool = False,
        sort_container_selectors: tuple[str, ...] = (
            "div.pc-sort",
            ".sort-container",
            "[class*='sort']",
        ),
        reload_should_raise: bool = True,
    ):
        super().__init__(url=url, reload_should_raise=reload_should_raise)
        self._target_button_label = target_button_label
        self._click_should_raise = click_should_raise
        self._scroll_should_raise = scroll_should_raise
        self.container_scroll_should_raise = container_scroll_should_raise
        self._sort_container_selectors = set(sort_container_selectors)
        # Observability for assertions.
        self.container_scroll_into_view_calls = 0
        # Shared button instance — the readiness probe records it on
        # `_last_readiness_matched_button` and the cascade calls
        # scroll + click on the SAME instance. Created lazily so each
        # production poll re-uses one stable handle.
        self._matched_button: _ScopedClickLocator | None = None

    def _make_button(self) -> _ScopedClickLocator | None:
        if self._target_button_label is None:
            return None
        if self._matched_button is None:
            self._matched_button = _ScopedClickLocator(
                inner_text=self._target_button_label,
                click_should_raise=self._click_should_raise,
                scroll_should_raise=self._scroll_should_raise,
            )
        return self._matched_button

    def locator(self, selector):
        if selector in self._sort_container_selectors:
            # First container selector visible from the first probe.
            def _count_provider():
                return 1
            return _ScopedClickContainerLocator(
                owner_page=self,
                selector=selector,
                count_provider=_count_provider,
                button_factory=self._make_button,
            )
        return super().locator(selector)


def _build_scroll_to_sort_session(
    *,
    sort_button_label_ko: str | None = "최신순",
    target_button_label: str | None = "최신순",
    click_should_raise: bool = False,
    scroll_should_raise: bool = False,
    container_scroll_should_raise: bool = False,
    sort_hunt_settle_s: float = 0.2,
    sort_hunt_poll_interval_s: float = 0.02,
):
    """Fixture for I-OY-RECOVERY-SCROLL-TO-REVIEW-SORT-AND-CLICK.

    Wires a session whose context's `new_page()` returns a
    `_ScrollableReadinessFakePage`. The cascade's REAL readiness
    wait runs against it so the production code populates
    `_last_readiness_matched_button` / `_last_readiness_matched_container`.
    Only `_attach_response_handler`, `_trigger_review_list_api`, and
    `_click_sort_button_robust` are spied; the readiness wait and
    the new scoped-click branch run un-mocked.

    `target_button_label` controls whether `_target_label_visible`
    fires (matched button recorded → scoped click attempted) or only
    `_container_visible` fires (no button → cascade pre-scrolls
    container then falls through to robust hunt).

    Returns `(session, ordering_log, old_page, new_page_ref)`.
    `new_page_ref[0]` is the `_ScrollableReadinessFakePage` on which
    tests assert `container_scroll_into_view_calls`,
    `_matched_button.click_calls`, etc.
    """
    from src.voc.connectors import oliveyoung_browser_api as mod

    sess = object.__new__(mod._PlaywrightReviewSession)
    # Old page raises on reload so the cascade exercises the recreate
    # fallback path; the new fake then drives the cascade on the
    # recreated page (the typical Ilso-style scenario).
    old_page = _RearmFakeAsyncPage(
        url=_PRODUCT_URL_TAB_REVIEW, reload_should_raise=True,
    )

    new_page_ref: list = []

    class _ScrollableCtx(_FakeBrowserContext):
        def __init__(
            self,
            pages,
            target_button_label,
            click_should_raise,
            scroll_should_raise,
            container_scroll_should_raise,
        ):
            super().__init__(pages)
            self._target_button_label = target_button_label
            self._click_should_raise = click_should_raise
            self._scroll_should_raise = scroll_should_raise
            self._container_scroll_should_raise = container_scroll_should_raise

        async def new_page(self):
            self.new_page_calls += 1
            page = _ScrollableReadinessFakePage(
                url=self._next_page_url,
                target_button_label=self._target_button_label,
                click_should_raise=self._click_should_raise,
                scroll_should_raise=self._scroll_should_raise,
                container_scroll_should_raise=(
                    self._container_scroll_should_raise
                ),
            )
            self.pages.append(page)
            new_page_ref.append(page)
            return page

    sess._ctx = _ScrollableCtx(
        [],
        target_button_label,
        click_should_raise,
        scroll_should_raise,
        container_scroll_should_raise,
    )
    sess._page = old_page
    sess._opened_product_url = _PRODUCT_URL_TAB_REVIEW
    sess._queue = asyncio.Queue()
    sess._request_log = []
    sess._observed_sort_types_count = {}
    sess._responses_filtered_out_by_sort = 0
    sess._observed_total_review_count = None
    sess._api_path = "/review/api/v2/reviews/cursor"
    sess._expected_sort_type = "DATETIME_DESC" if sort_button_label_ko else None
    sess._review_tab_locator = "div.review-tab"
    sess._review_more_button_clicked = False
    sess._scrolled_to_review_area = False
    sess._sort_button_label_ko = sort_button_label_ko
    sess._sort_button_selector = None
    sess._sort_container_candidates = (
        "div.pc-sort",
        ".sort-container",
        "[class*='sort']",
    )
    sess._sort_hunt_settle_s = float(sort_hunt_settle_s)
    sess._sort_hunt_poll_interval_s = float(sort_hunt_poll_interval_s)
    sess._post_recreate_sort_area_ready = None
    sess._post_recreate_strategy_used = None
    # Mirror the production constructor: the new side-channel
    # handles default to None and are set by the real readiness
    # wait when its probes succeed.
    sess._last_readiness_matched_button = None
    sess._last_readiness_matched_container = None

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

    sess._attach_response_handler = _spy_attach  # type: ignore[assignment]
    sess._trigger_review_list_api = _spy_trigger  # type: ignore[assignment]
    sess._click_sort_button_robust = _spy_click_sort  # type: ignore[assignment]
    # NOTE: `_wait_for_review_sort_area_ready` is intentionally NOT
    # spied — the test's purpose is to drive the REAL wait + the
    # new scoped-click branch end-to-end against the page fake.
    return sess, ordering_log, old_page, new_page_ref


@pytest.mark.asyncio
async def test_scroll_to_sort_area_runs_before_sort_click_on_recreate():
    """Test A — ordering invariant: on the recreate fallback path,
    the new scroll-to-sort-area step fires BEFORE any sort click.

    The cascade's expected ordering on a recreate with the target
    label matched on the first probe is:

        attach_response_handler
          → trigger_review_list_api(initial_click=True)
          → (readiness wait runs against new page — populates
             `_last_readiness_matched_button` /
             `_last_readiness_matched_container`)
          → container scroll_into_view_if_needed
          → button scroll_into_view_if_needed + click (scoped)
          → robust click NOT invoked (scoped click succeeded)

    The matched container's scroll count must be >= 1 BEFORE the
    matched button's click count flips, and the spy
    `_click_sort_button_robust` must NOT appear in the ordering log.
    """
    sess, ordering_log, _, new_page_ref = _build_scroll_to_sort_session(
        sort_button_label_ko="최신순",
        target_button_label="최신순",
    )

    await sess.reload_and_reopen_review_tab()

    # Cascade ran on the recreate path (old-page reload raises).
    assert sess._ctx.new_page_calls == 1
    assert len(new_page_ref) == 1
    new_page = new_page_ref[0]

    # Container was scrolled into view at least once before any
    # robust click would fire.
    assert new_page.container_scroll_into_view_calls >= 1

    # The matched button was clicked exactly once via the scoped
    # path; the robust hunt was NOT invoked.
    assert new_page._matched_button is not None
    assert new_page._matched_button.click_calls == 1
    assert "click_sort_button_robust" not in ordering_log

    # Tri-state readiness still flips to True (readiness wait found
    # the container on the first probe).
    assert sess._post_recreate_sort_area_ready is True


@pytest.mark.asyncio
async def test_scoped_click_skips_robust_hunt_when_readiness_matches_target():
    """Test B — scoped click on the readiness-matched button.

    When `_wait_for_review_sort_area_ready` records a matched button
    handle (secondary signal `target_label_visible`), the cascade
    clicks that handle directly with a short timeout. The robust
    hunt (`_click_sort_button_robust`) is NOT invoked because the
    scoped click already fired the target sort.

    This eliminates the DOM-re-query race observed on Ilso
    A000000225736 where the readiness probe saw `최신순` at
    poll_attempt=1 but the subsequent robust hunt could not find it
    12 seconds later.
    """
    sess, ordering_log, _, new_page_ref = _build_scroll_to_sort_session(
        sort_button_label_ko="최신순",
        target_button_label="최신순",
    )

    await sess.reload_and_reopen_review_tab()

    # Matched button handle was populated by the readiness probe.
    assert sess._last_readiness_matched_button is not None
    # Robust hunt was NOT invoked.
    assert "click_sort_button_robust" not in ordering_log
    # Scoped click landed on the matched button exactly once.
    new_page = new_page_ref[0]
    assert new_page._matched_button.click_calls == 1


@pytest.mark.asyncio
async def test_scoped_click_falls_back_to_robust_when_click_raises():
    """Test C — when the matched button's `click()` raises, the
    cascade falls through to `_click_sort_button_robust`. The
    existing `sort_control_unreachable` failure-mode contract is
    preserved on the worst case where the robust hunt also fails.
    """
    sess, ordering_log, _, new_page_ref = _build_scroll_to_sort_session(
        sort_button_label_ko="최신순",
        target_button_label="최신순",
        click_should_raise=True,
    )

    await sess.reload_and_reopen_review_tab()

    new_page = new_page_ref[0]
    # Scoped click WAS attempted (count incremented) but raised.
    assert new_page._matched_button.click_calls == 1
    # Robust hunt WAS invoked as the fallback.
    assert "click_sort_button_robust" in ordering_log


@pytest.mark.asyncio
async def test_scoped_click_falls_back_when_container_scroll_raises():
    """Container `scroll_into_view_if_needed` raising must not
    prevent the cascade from completing — the scoped click still
    attempts on the matched button. If the click also raises, the
    cascade falls through to the robust hunt.

    This covers the edge case where the matched container locator
    becomes stale between the readiness probe and the cascade's
    scroll attempt (production: the page state can drift).
    """
    sess, ordering_log, _, new_page_ref = _build_scroll_to_sort_session(
        sort_button_label_ko="최신순",
        target_button_label="최신순",
        container_scroll_should_raise=True,
        # Make the scoped click also raise so the fallback path is
        # exercised end-to-end.
        click_should_raise=True,
    )

    await sess.reload_and_reopen_review_tab()

    new_page = new_page_ref[0]
    # Container scroll WAS attempted (then raised).
    assert new_page.container_scroll_into_view_calls >= 1
    # Scoped click attempt followed (then raised).
    assert new_page._matched_button.click_calls == 1
    # Robust hunt fell back as expected.
    assert "click_sort_button_robust" in ordering_log


@pytest.mark.asyncio
async def test_no_scoped_click_when_container_visible_only_signal():
    """When the readiness wait fires on the weaker
    `container_visible` primary signal (no target label match in
    DOM), there is no matched button to click directly. The cascade
    pre-scrolls the matched container into view and falls through
    to `_click_sort_button_robust` for the standard hunt.

    Driven by `target_button_label=None` on the fake so the inner
    text-match probe never records a button; the container probe
    still succeeds, so the readiness wait returns True via
    `container_visible` only.
    """
    sess, ordering_log, _, new_page_ref = _build_scroll_to_sort_session(
        sort_button_label_ko="최신순",
        target_button_label=None,
    )

    await sess.reload_and_reopen_review_tab()

    new_page = new_page_ref[0]
    # Container was pre-scrolled (provides the deterministic
    # scroll-to-area benefit even without a button handle).
    assert new_page.container_scroll_into_view_calls >= 1
    # No matched button → no scoped click attempted.
    assert sess._last_readiness_matched_button is None
    # Robust hunt fell back as the click path.
    assert "click_sort_button_robust" in ordering_log


@pytest.mark.asyncio
async def test_scoped_click_listener_install_ordering_preserved():
    """Test D — listener-before-trigger invariant preserved across
    the new scoped-click branch.

    On the recreate fallback path, `_attach_response_handler` runs
    BEFORE `_trigger_review_list_api` AND BEFORE any sort-click
    (scoped or robust). This pins the existing
    `test_recovery_wait_before_click_ordering` contract with the
    new scoped-click step inserted between trigger and click.
    """
    sess, ordering_log, _, new_page_ref = _build_scroll_to_sort_session(
        sort_button_label_ko="최신순",
        target_button_label="최신순",
    )

    await sess.reload_and_reopen_review_tab()

    attach_index = ordering_log.index("attach_response_handler")
    trigger_index = ordering_log.index(
        "trigger_review_list_api(initial_click=True)",
    )
    # The scoped click on the matched button is observable on the
    # page-fake itself (not via the ordering log) — assert that the
    # scoped click happened AFTER both attach and trigger by reading
    # the call counter (which only increments inside the cascade,
    # AFTER the readiness wait, which the trigger precedes).
    new_page = new_page_ref[0]
    assert attach_index < trigger_index
    assert new_page._matched_button is not None
    assert new_page._matched_button.click_calls == 1
    # Robust hunt was NOT invoked (scoped click succeeded). No
    # ordering check against the robust click is needed because it
    # never fired.
    assert "click_sort_button_robust" not in ordering_log


@pytest.mark.asyncio
async def test_scoped_click_uses_readiness_matched_handle_not_reprobe():
    """The scoped click MUST operate on the same locator instance
    the readiness probe recorded. This pins the contract: no DOM
    re-query between readiness signal and scoped click.

    Asserts that the locator instance stored on
    `_last_readiness_matched_button` is the SAME object whose
    `click_calls` counter incremented — i.e. no separate
    re-enumeration produced a different button handle.
    """
    sess, _, _, new_page_ref = _build_scroll_to_sort_session(
        sort_button_label_ko="최신순",
        target_button_label="최신순",
    )

    await sess.reload_and_reopen_review_tab()

    new_page = new_page_ref[0]
    # The recorded handle on the session IS the page's matched
    # button instance — identity equality, not just count parity.
    assert sess._last_readiness_matched_button is new_page._matched_button
    # And that exact handle was clicked.
    assert new_page._matched_button.click_calls == 1


@pytest.mark.asyncio
async def test_scoped_click_skipped_when_readiness_wait_deadlines():
    """Defensive contract: when readiness returns False (container
    never observed within budget), the scoped-click branch must NOT
    fire on a stale or never-set handle. The cascade falls through
    to `_click_sort_button_robust` as today, preserving the existing
    failure-mode contract.

    Uses `_build_readiness_session` with a never-visible threshold,
    which is the same fixture the prior
    `test_recovery_wait_times_out_then_single_shot_retrigger_then_click_still_runs`
    test exercises. The new contract is that the matched-button
    handle stays None (or is reset to None on entry to the wait),
    so the cascade cannot accidentally click a previous run's
    button.
    """
    sess, ordering_log, _, _ = _build_readiness_session(
        sort_button_label_ko="최신순",
        sort_area_visible_after_count=10_000,
    )

    await sess.reload_and_reopen_review_tab()

    # Readiness deadlined → no matched-button handle was set.
    matched_button = getattr(
        sess, "_last_readiness_matched_button", None,
    )
    assert matched_button is None
    # Robust hunt still fired (preserves current failure-mode
    # contract: hunt's own deadline maps to `sort_control_unreachable`).
    assert "click_sort_button_robust" in ordering_log
    # Tri-state readiness recorded as False.
    assert sess._post_recreate_sort_area_ready is False


# ---------------------------------------------------------------------------
# I-OY-RECOVERY-POST-CLICK-RESPONSE-CAPTURE — diagnostic-only response
# listener probe.
#
# Background: the latest Ilso A000000225736 live proof
# (`O-OY-SCROLL-RECOVERY-SCOPED-CLICK-LIVE-PROOF-ILSO`) demonstrated that
# the scoped click on the readiness-matched sort button DID fire
# (`OY sort-button clicked: target='최신순' expected_sort='DATETIME_DESC'
# scope=readiness_matched_button poll_attempt=1`) but
# `scroll_continuation_recovery_recovered=false` and the post-recreate
# `wait_for_next_response` timed out at the cold-start deadline. The
# wedge has moved off the DOM layer onto the post-recreate cursor /
# response-queue layer. The probe added in this ticket is
# diagnostic-only — it does NOT change recovery behavior — and exists so
# the next live proof can disambiguate four candidate failure modes:
#   1. No cursor request fired after the scoped click.
#   2. Cursor request fired but filtered by `_expected_sort_type`.
#   3. Cursor response arrived with unexpected shape (parse error).
#   4. Response queue / cursor state stale after recovery.
# Tests below exercise the listener's new per-response log emission +
# session-local counter increments under the recovery diagnostic flag.
# ---------------------------------------------------------------------------


class _FakeRequest:
    """Minimal stand-in for `playwright.Request` that exposes the
    fields `_on_response` reads: `method`, `url`, `headers`, `post_data`.
    Headers default to a single accept entry so the redact helper has
    something to work with."""

    def __init__(self, *, method: str = "POST", url: str | None = None,
                 post_data: str | None = None,
                 headers: dict | None = None):
        self.method = method
        self.url = url or "https://m.oliveyoung.co.kr/review/api/v2/reviews/cursor"
        self.post_data = post_data
        self.headers = headers if headers is not None else {
            "accept": "application/json",
        }


class _FakeResponse:
    """Minimal stand-in for `playwright.Response` that exposes the
    fields `_on_response` reads: `url`, `status`, `headers`, `request`,
    and an async `json()`. The test controls the JSON outcome by
    passing `body_json` (the parsed dict) OR `json_should_raise=True`
    to simulate `response.json()` raising — i.e. the parse-error path.
    """

    def __init__(
        self,
        *,
        url: str = "https://m.oliveyoung.co.kr/review/api/v2/reviews/cursor",
        status: int = 200,
        body_json: dict | None = None,
        json_should_raise: bool = False,
        content_type: str = "application/json; charset=utf-8",
        request: _FakeRequest | None = None,
    ):
        self.url = url
        self.status = status
        self.headers = {"content-type": content_type}
        self._body_json = body_json
        self._json_should_raise = json_should_raise
        self.request = request or _FakeRequest()

    async def json(self):
        if self._json_should_raise:
            raise ValueError("simulated JSON decode failure")
        return self._body_json


def _build_diagnostic_session(
    *,
    expected_sort: str | None = "DATETIME_DESC",
):
    """Build a minimal `_PlaywrightReviewSession` instance via
    `object.__new__` and seed exactly the attributes the closure
    `_on_response` reads. The session does NOT need any browser /
    Playwright surface — we invoke the closure directly with a fake
    response object.

    Pattern mirrors `_build_scroll_to_sort_session` (uses
    `object.__new__` then assigns required attrs) but stripped to the
    response-handler subset.
    """
    from src.voc.connectors import oliveyoung_browser_api as mod

    sess = object.__new__(mod._PlaywrightReviewSession)
    sess._api_path = "/review/api/v2/reviews/cursor"
    sess._queue = asyncio.Queue()
    sess._request_log = []
    sess._observed_sort_types_count = {}
    sess._responses_filtered_out_by_sort = 0
    sess._expected_sort_type = expected_sort
    sess._observed_total_review_count = None
    # I-OY-RECOVERY-POST-CLICK-RESPONSE-CAPTURE — diagnostic gate +
    # counters. Default False; tests flip it True to exercise the
    # probe path.
    sess._diagnose_post_recovery_responses = False
    sess._post_recovery_response_probe_count = 0
    sess._post_recovery_response_accepted_count = 0
    sess._post_recovery_response_sort_mismatch_count = 0
    sess._post_recovery_response_parse_error_count = 0
    return sess


def _attach_and_get_handler(sess):
    """Attach the response handler to a tiny fake page and return the
    inner `_on_response` closure for direct invocation. The fake page
    records the registration but is otherwise a no-op."""
    captured: list = []

    class _FakePage:
        def on(self, event, handler):
            assert event == "response"
            captured.append(handler)

    sess._attach_response_handler(_FakePage())
    assert len(captured) == 1
    return captured[0]


@pytest.mark.asyncio
async def test_post_recovery_diagnostic_flag_default_false_on_init():
    """A. Flag-lifecycle: `_diagnose_post_recovery_responses` is False
    at session init. The real constructor (not the test fixture) must
    default the gate to False so initial-open / happy-path collection
    emits no probe logs.
    """
    from src.voc.connectors import oliveyoung_browser_api as mod
    sess = object.__new__(mod._PlaywrightReviewSession)
    # Re-invoke __init__ with the minimum kwargs required.
    sess.__init__(
        headless=True,
        api_path="/review/api/v2/reviews/cursor",
        review_tab_locator="div.review-tab",
        scroll_candidates=(),
        user_agent="ua",
        viewport={"width": 800, "height": 600},
    )
    assert sess._diagnose_post_recovery_responses is False
    assert sess._post_recovery_response_probe_count == 0
    assert sess._post_recovery_response_accepted_count == 0
    assert sess._post_recovery_response_sort_mismatch_count == 0
    assert sess._post_recovery_response_parse_error_count == 0


@pytest.mark.asyncio
async def test_post_recovery_diagnostic_flag_true_before_recreate_and_false_after(
    page1_body, page2_last, monkeypatch,
):
    """A. Flag-lifecycle: in `collect()`'s recovery branch the flag is
    flipped True immediately BEFORE `reload_and_reopen_review_tab` is
    awaited (so the cascade's scoped click runs with diagnostics on),
    and flipped False after the post-recreate `wait_for_next_response`
    exits.
    """
    # Custom recovery session that records the flag value at the moment
    # `reload_and_reopen_review_tab` was entered.
    class _FlagSpyRecoverySession(_RecoveryFakeSession):
        def __init__(self, *a, **kw):
            super().__init__(*a, **kw)
            self.flag_at_recreate_entry: bool | None = None

        async def reload_and_reopen_review_tab(self) -> None:
            self.flag_at_recreate_entry = bool(
                getattr(
                    self, "_diagnose_post_recovery_responses", False,
                ),
            )
            await super().reload_and_reopen_review_tab()

    session = _FlagSpyRecoverySession(
        [(200, page1_body), None, None, None],
        recreate_responses=[[(200, page2_last)]],
    )
    import src.voc.connectors.oliveyoung_browser_api as mod
    monkeypatch.setattr(mod.asyncio, "sleep", _no_sleep)

    c, params = _build_recovery_connector(session)
    await c.collect(keyword="x", params=params)

    # The flag was True at the moment recreate ran (the cascade's
    # scoped click runs INSIDE recreate, so the probe is active for
    # the post-recovery cursor request).
    assert session.flag_at_recreate_entry is True
    # And the flag was reset to False after the recovery window ended
    # (success-path consumption of `r_body` then continue → outer
    # while → eventually clean termination on hasNext=False).
    assert session._diagnose_post_recovery_responses is False


@pytest.mark.asyncio
async def test_post_recovery_diagnostic_flag_false_after_recreate_raise(
    page1_body, monkeypatch,
):
    """A. Flag-lifecycle: when `reload_and_reopen_review_tab` itself
    raises, the flag is still reset to False (the recovery branch's
    `_close_post_recovery_diag` runs in the except block before
    break).
    """
    class _RaisingRecoverySession(_RecoveryFakeSession):
        async def reload_and_reopen_review_tab(self) -> None:
            self.recreate_calls += 1
            raise RuntimeError("simulated recreate failure")

    session = _RaisingRecoverySession([(200, page1_body), None, None, None])
    import src.voc.connectors.oliveyoung_browser_api as mod
    monkeypatch.setattr(mod.asyncio, "sleep", _no_sleep)

    c, params = _build_recovery_connector(session)
    await c.collect(keyword="x", params=params)

    assert session.recreate_calls == 1
    # Flag reset on the raise path too.
    assert session._diagnose_post_recovery_responses is False


@pytest.mark.asyncio
async def test_post_recovery_response_accepted_logs_and_counter(caplog):
    """B. Accepted response: a cursor response whose request
    `post_data.sortType` matches `_expected_sort_type` is placed onto
    the queue (existing behavior) AND emits a single
    `OY recovery response accepted:` log line AND increments
    `_post_recovery_response_accepted_count`.
    """
    import logging
    sess = _build_diagnostic_session(expected_sort="DATETIME_DESC")
    sess._diagnose_post_recovery_responses = True
    handler = _attach_and_get_handler(sess)

    # Construct an OK body that matches the production cursor-API shape
    # so `_extract_response_cursor_meta` populates has_next / cursor /
    # review_count.
    body = {
        "data": {
            "hasNext": True,
            "nextCursorId": "abc123",
            "goodsReviewList": [{"goodsReviewSeq": "r1"}, {"goodsReviewSeq": "r2"}],
        },
    }
    fake_req = _FakeRequest(
        post_data=json.dumps({"sortType": "DATETIME_DESC"}),
    )
    fake_resp = _FakeResponse(body_json=body, request=fake_req)

    with caplog.at_level(
        logging.INFO,
        logger="src.voc.connectors.oliveyoung_browser_api",
    ):
        await handler(fake_resp)

    # Existing behavior: queued.
    assert sess._queue.qsize() == 1
    # New diagnostic: counter incremented, log emitted.
    assert sess._post_recovery_response_probe_count == 1
    assert sess._post_recovery_response_accepted_count == 1
    assert sess._post_recovery_response_sort_mismatch_count == 0
    assert sess._post_recovery_response_parse_error_count == 0
    accepted_messages = [
        r.getMessage()
        for r in caplog.records
        if "OY recovery response accepted:" in r.getMessage()
    ]
    assert len(accepted_messages) == 1
    msg = accepted_messages[0]
    assert "url_kind=cursor" in msg
    assert "status=200" in msg
    assert "request_method=POST" in msg
    assert "request_sort=DATETIME_DESC" in msg
    assert "expected_sort=DATETIME_DESC" in msg
    assert "accepted=true" in msg
    assert "drop_reason=none" in msg
    assert "has_next=True" in msg
    assert "review_count=2" in msg
    assert "cursor=abc123" in msg


@pytest.mark.asyncio
async def test_post_recovery_response_sort_mismatch_logs_and_counter(caplog):
    """C. Sort-mismatch: a cursor response whose request
    `post_data.sortType` does NOT match `_expected_sort_type` is
    dropped (existing behavior: `_responses_filtered_out_by_sort` ++,
    queue NOT touched) AND emits an `OY recovery response dropped:
    drop_reason=sort_mismatch` line AND increments
    `_post_recovery_response_sort_mismatch_count`.
    """
    import logging
    sess = _build_diagnostic_session(expected_sort="DATETIME_DESC")
    sess._diagnose_post_recovery_responses = True
    handler = _attach_and_get_handler(sess)

    body = {
        "data": {
            "hasNext": True,
            "nextCursorId": "useful-1",
            "goodsReviewList": [{"goodsReviewSeq": "r3"}],
        },
    }
    fake_req = _FakeRequest(
        # Different sortType → filtered out by the existing filter.
        post_data=json.dumps({"sortType": "USEFUL_SCORE_DESC"}),
    )
    fake_resp = _FakeResponse(body_json=body, request=fake_req)

    with caplog.at_level(
        logging.INFO,
        logger="src.voc.connectors.oliveyoung_browser_api",
    ):
        await handler(fake_resp)

    # Existing behavior: NOT queued (sort mismatch).
    assert sess._queue.qsize() == 0
    assert sess._responses_filtered_out_by_sort == 1
    # New diagnostic.
    assert sess._post_recovery_response_probe_count == 1
    assert sess._post_recovery_response_accepted_count == 0
    assert sess._post_recovery_response_sort_mismatch_count == 1
    assert sess._post_recovery_response_parse_error_count == 0
    dropped_messages = [
        r.getMessage()
        for r in caplog.records
        if "OY recovery response dropped:" in r.getMessage()
    ]
    assert len(dropped_messages) == 1
    msg = dropped_messages[0]
    assert "drop_reason=sort_mismatch" in msg
    assert "accepted=false" in msg
    assert "request_sort=USEFUL_SCORE_DESC" in msg
    assert "expected_sort=DATETIME_DESC" in msg


@pytest.mark.asyncio
async def test_post_recovery_response_parse_error_logs_and_counter(caplog):
    """D. Parse error: a malformed cursor response (e.g.
    `response.json()` raises, OR the body doesn't shape-match the
    classifier's expectations) does NOT crash AND emits an
    `OY recovery response parse failed:` line AND increments
    `_post_recovery_response_parse_error_count`.
    """
    import logging
    sess = _build_diagnostic_session(expected_sort="DATETIME_DESC")
    sess._diagnose_post_recovery_responses = True
    handler = _attach_and_get_handler(sess)

    # Force `response.json()` to raise so the existing handler's
    # decode-failure path sets `body=None` and the diagnostic
    # classifies the outcome as parse_error.
    fake_req = _FakeRequest(
        post_data=json.dumps({"sortType": "DATETIME_DESC"}),
    )
    fake_resp = _FakeResponse(
        body_json=None,
        json_should_raise=True,
        request=fake_req,
    )

    with caplog.at_level(
        logging.INFO,
        logger="src.voc.connectors.oliveyoung_browser_api",
    ):
        # Must not raise — diagnostics are best-effort.
        await handler(fake_resp)

    # Counter incremented.
    assert sess._post_recovery_response_probe_count == 1
    assert sess._post_recovery_response_parse_error_count == 1
    assert sess._post_recovery_response_accepted_count == 0
    assert sess._post_recovery_response_sort_mismatch_count == 0
    parse_messages = [
        r.getMessage()
        for r in caplog.records
        if "OY recovery response parse failed:" in r.getMessage()
    ]
    assert len(parse_messages) == 1
    msg = parse_messages[0]
    assert "drop_reason=parse_error" in msg
    assert "accepted=false" in msg
    # When the body could not be parsed, optional cursor-meta fields
    # are reported as "unknown" rather than a half-cooked value.
    assert "has_next=unknown" in msg
    assert "review_count=unknown" in msg
    assert "cursor=unknown" in msg


@pytest.mark.asyncio
async def test_post_recovery_response_non_cursor_url_is_ignored(caplog):
    """E. Non-cursor response: a response whose URL does NOT contain
    `_api_path` is ignored by the existing handler (early `return`).
    The diagnostic emits NO log line and increments NO counter. This
    is the chosen behavior for non-cursor URLs: the handler's early
    return is preserved unchanged, so non-cursor responses are
    invisible to the probe — which matches the requirement "no log
    spam: at most one log line per response."
    """
    import logging
    sess = _build_diagnostic_session(expected_sort="DATETIME_DESC")
    sess._diagnose_post_recovery_responses = True
    handler = _attach_and_get_handler(sess)

    fake_req = _FakeRequest(
        method="GET",
        url="https://www.oliveyoung.co.kr/store/main",
    )
    fake_resp = _FakeResponse(
        url="https://www.oliveyoung.co.kr/store/main",
        status=200,
        body_json=None,
        request=fake_req,
    )

    with caplog.at_level(
        logging.INFO,
        logger="src.voc.connectors.oliveyoung_browser_api",
    ):
        await handler(fake_resp)

    # No counters touched.
    assert sess._post_recovery_response_probe_count == 0
    # No probe log emitted for non-cursor URL.
    probe_messages = [
        r.getMessage()
        for r in caplog.records
        if r.getMessage().startswith("OY recovery response ")
    ]
    assert probe_messages == []


@pytest.mark.asyncio
async def test_post_recovery_diag_no_logs_when_flag_off(caplog):
    """Sanity: when the diagnostic flag is False (normal happy-path
    collection), the listener emits NO probe logs and increments NO
    counters even for matching cursor responses. This is the
    happy-path-spam guarantee.
    """
    import logging
    sess = _build_diagnostic_session(expected_sort="DATETIME_DESC")
    # Flag intentionally NOT flipped on.
    assert sess._diagnose_post_recovery_responses is False
    handler = _attach_and_get_handler(sess)

    body = {
        "data": {
            "hasNext": True,
            "nextCursorId": "c1",
            "goodsReviewList": [{"goodsReviewSeq": "r9"}],
        },
    }
    fake_req = _FakeRequest(
        post_data=json.dumps({"sortType": "DATETIME_DESC"}),
    )
    fake_resp = _FakeResponse(body_json=body, request=fake_req)

    with caplog.at_level(
        logging.INFO,
        logger="src.voc.connectors.oliveyoung_browser_api",
    ):
        await handler(fake_resp)

    # Existing behavior still works (queued).
    assert sess._queue.qsize() == 1
    # NO diagnostic counters bumped, NO probe logs emitted.
    assert sess._post_recovery_response_probe_count == 0
    assert sess._post_recovery_response_accepted_count == 0
    probe_messages = [
        r.getMessage()
        for r in caplog.records
        if r.getMessage().startswith("OY recovery response ")
    ]
    assert probe_messages == []


@pytest.mark.asyncio
async def test_post_recovery_summary_log_emitted_on_recovery_exit(
    page1_body, page2_last, monkeypatch, caplog,
):
    """End-of-recovery-window summary: the connector emits an
    `OY recovery response timeout summary:` line at every exit from
    the recovery branch, surfacing the four counters. This is the
    only place the counters are exposed (no `ConnectorRunSummary`
    schema change).
    """
    import logging
    session = _RecoveryFakeSession(
        [(200, page1_body), None, None, None],
        recreate_responses=[[(200, page2_last)]],
    )
    import src.voc.connectors.oliveyoung_browser_api as mod
    monkeypatch.setattr(mod.asyncio, "sleep", _no_sleep)

    c, params = _build_recovery_connector(session)
    with caplog.at_level(
        logging.INFO,
        logger="src.voc.connectors.oliveyoung_browser_api",
    ):
        await c.collect(keyword="x", params=params)

    summary_lines = [
        r.getMessage()
        for r in caplog.records
        if "OY recovery response timeout summary:" in r.getMessage()
    ]
    # Exactly one summary line for this single-recovery run.
    assert len(summary_lines) == 1
    msg = summary_lines[0]
    assert "probes=" in msg
    assert "accepted=" in msg
    assert "sort_mismatch=" in msg
    assert "parse_error=" in msg


# ---------------------------------------------------------------------------
# I-OY-RECOVERY-POST-RECREATE-PAGE-STATE-DIAG — page-state snapshot
# diagnostic. The Ilso A000000225736 live proof showed that the
# SAME recovery code produces TWO different post-recreate DOM
# outcomes across runs (`probes=0` on the latest because the review-
# pane never mounted; scoped click fired but no cursor request on a
# prior run). The page-state snapshot characterizes the recovered
# page at six checkpoints so the next live proof has URL / DOM data
# to inform the next behavioral fix. Diagnostic-only — behavior
# unchanged.
# ---------------------------------------------------------------------------


class _SnapshotFakePage:
    """Stand-in Playwright Page for the page-state snapshot tests.

    Exposes the fields the snapshot helper reads:
      - `url`              (attribute)
      - `title()`          (async)
      - `evaluate(script)` (async — returns readyState)
      - `locator(selector)` — returns a configurable counter

    Per-selector locator counts are configurable via the
    `selector_counts` mapping. Substring-search style probes for
    `text=...` selectors are routed through the same mapping; tests
    pre-populate the keys they want to drive.

    `raise_for_selector` (set) — selectors in this set cause
    `locator(sel).count()` to raise, simulating a Playwright hiccup
    on that probe.
    """

    def __init__(
        self,
        *,
        url: str = (
            "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
            "?goodsNo=A000000225736&tab=review"
        ),
        title: str = "리뷰 - Ilso 톤업 크림",
        ready_state: str = "complete",
        selector_counts: dict | None = None,
        raise_for_selector: set | None = None,
    ):
        self.url = url
        self._title = title
        self._ready_state = ready_state
        self.selector_counts = dict(selector_counts or {})
        self.raise_for_selector = set(raise_for_selector or ())
        # Records how many times each selector was probed via
        # `locator(...).count()`. Tests can assert the probe surface.
        self.locator_calls: list[str] = []

    async def title(self):
        return self._title

    async def evaluate(self, script):
        # Only the readyState script is invoked from the snapshot
        # helper. Returning the configured value is enough.
        return self._ready_state

    def locator(self, selector):
        outer = self

        class _Loc:
            async def count(self_inner):
                outer.locator_calls.append(selector)
                if selector in outer.raise_for_selector:
                    raise RuntimeError("simulated locator.count failure")
                return outer.selector_counts.get(selector, 0)

            @property
            def first(self_inner):
                return self_inner

            def locator(self_inner, sub_selector):
                # Nested locator for `sort_button_candidates` probe.
                # Route through the same selector_counts table by
                # concatenating "<outer>::<sub>".
                key = f"{selector}::{sub_selector}"
                outer_obj = outer

                class _SubLoc:
                    async def count(self_sub):
                        outer_obj.locator_calls.append(key)
                        return outer_obj.selector_counts.get(key, 0)

                return _SubLoc()

        return _Loc()


def _build_snapshot_session(
    *,
    page: _SnapshotFakePage | None = None,
    opened_product_url: str = (
        "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
        "?goodsNo=A000000225736&tab=review"
    ),
    sort_container_candidates: tuple[str, ...] = (
        "div.pc-sort",
        ".sort-container",
        "[class*='sort']",
    ),
    review_tab_locator: str = "div.review-tab",
    diagnostic_flag: bool = True,
):
    """Build a `_PlaywrightReviewSession` instance via `object.__new__`
    with just enough state for `_snapshot_recovery_page_state` to run
    against a `_SnapshotFakePage`. Mirrors the construction style used
    by `_build_diagnostic_session`."""
    from src.voc.connectors import oliveyoung_browser_api as mod

    sess = object.__new__(mod._PlaywrightReviewSession)
    sess._page = page if page is not None else _SnapshotFakePage()
    sess._opened_product_url = opened_product_url
    sess._sort_container_candidates = tuple(sort_container_candidates)
    sess._review_tab_locator = review_tab_locator
    sess._diagnose_post_recreate_page_state = diagnostic_flag
    return sess


@pytest.mark.asyncio
async def test_snapshot_page_state_logs_compact_fields_after_goto(caplog):
    """A. The snapshot helper emits ONE `OY recovery page state:` log
    line at the named checkpoint containing all configured fields.
    Drives the helper with a fake page that has the URL containing
    `goodsNo=A000000225736&tab=review`, readyState=`complete`,
    `div.pc-sort` count=1, target sort label visible, review-count
    text present.
    """
    import logging
    page = _SnapshotFakePage(
        url=(
            "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
            "?goodsNo=A000000225736&tab=review"
        ),
        title="리뷰 - Ilso 톤업 크림",
        ready_state="complete",
        selector_counts={
            "div.pc-sort": 1,
            ".sort-container": 0,
            "[class*='sort']": 3,
            "div.review-tab": 1,
            "text=최신순": 1,
            "text=유용한 순": 1,
            "text=평점 높은순": 1,
            "text=평점 낮은순": 1,
            "text=리뷰": 1,
            # Sort-button candidates inside the matched container.
            "div.pc-sort::button": 4,
            "div.pc-sort::a": 0,
            "div.pc-sort::[role='button']": 0,
        },
    )
    sess = _build_snapshot_session(page=page)

    with caplog.at_level(
        logging.INFO,
        logger="src.voc.connectors.oliveyoung_browser_api",
    ):
        await sess._snapshot_recovery_page_state(checkpoint="after_goto")

    state_messages = [
        r.getMessage()
        for r in caplog.records
        if "OY recovery page state:" in r.getMessage()
    ]
    assert len(state_messages) == 1
    msg = state_messages[0]
    assert "checkpoint=after_goto" in msg
    assert "url=https://www.oliveyoung.co.kr" in msg
    assert "goodsNo=A000000225736" in msg
    assert "readyState=complete" in msg
    assert "title=리뷰 - Ilso 톤업 크림" in msg
    assert "url_has_goodsno=true" in msg
    assert "url_has_tab_review=true" in msg
    assert "sort_pc_count=1" in msg
    assert "sort_container_count=0" in msg
    assert "sort_classmatch_count=3" in msg
    assert "review_tab_count=1" in msg
    assert "text_has_choisin=true" in msg
    assert "text_has_yuyong=true" in msg
    assert "text_has_rating_desc=true" in msg
    assert "text_has_rating_asc=true" in msg
    assert "text_has_review_count=true" in msg
    # sort_button_candidates derived from the FIRST matching container
    # (div.pc-sort, count=1) — button(4) + a(0) + [role='button'](0) = 4.
    assert "sort_button_candidates=4" in msg


@pytest.mark.asyncio
async def test_snapshot_page_state_handles_no_sort_or_review_dom(caplog):
    """A (variant). When the recovered page has NO sort container and
    NO target sort labels — the symptom on the prior live proof — the
    snapshot still emits one line with the corresponding `false` /
    `0` fields. Confirms the snapshot's signal value: it distinguishes
    "DOM mounted but missing target" from "DOM not mounted".
    """
    import logging
    # URL on a non-detail page, no goodsNo, no tab=review.
    page = _SnapshotFakePage(
        url="https://www.oliveyoung.co.kr/store/main",
        title="올리브영",
        ready_state="complete",
        selector_counts={
            "div.pc-sort": 0,
            ".sort-container": 0,
            "[class*='sort']": 0,
            "div.review-tab": 0,
            "text=최신순": 0,
            "text=유용한 순": 0,
            "text=평점 높은순": 0,
            "text=평점 낮은순": 0,
            "text=리뷰": 0,
        },
    )
    sess = _build_snapshot_session(page=page)

    with caplog.at_level(
        logging.INFO,
        logger="src.voc.connectors.oliveyoung_browser_api",
    ):
        await sess._snapshot_recovery_page_state(
            checkpoint="sort_readiness_timeout",
        )

    state_messages = [
        r.getMessage()
        for r in caplog.records
        if "OY recovery page state:" in r.getMessage()
    ]
    assert len(state_messages) == 1
    msg = state_messages[0]
    assert "checkpoint=sort_readiness_timeout" in msg
    assert "url_has_goodsno=false" in msg
    assert "url_has_tab_review=false" in msg
    assert "sort_pc_count=0" in msg
    assert "sort_container_count=0" in msg
    assert "sort_classmatch_count=0" in msg
    assert "text_has_choisin=false" in msg
    # No matching container → sort_button_candidates is "0" (the
    # "no container" sentinel).
    assert "sort_button_candidates=0" in msg


@pytest.mark.asyncio
async def test_snapshot_page_state_probe_failure_falls_back_to_unknown(caplog):
    """B. If `locator(selector).count()` raises for a specific
    selector, the snapshot emits the line anyway with that field as
    `unknown`. Other fields populate normally. The helper MUST NOT
    propagate the exception — diagnostics are best-effort.
    """
    import logging
    page = _SnapshotFakePage(
        url=(
            "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
            "?goodsNo=A000000225736&tab=review"
        ),
        ready_state="complete",
        selector_counts={
            "div.pc-sort": 2,
            ".sort-container": 0,
            "[class*='sort']": 5,
            "div.review-tab": 1,
            "text=최신순": 1,
        },
        # Probe failure for sort-classmatch selector — production-style
        # Playwright hiccup that the helper must absorb.
        raise_for_selector={"[class*='sort']"},
    )
    sess = _build_snapshot_session(page=page)

    with caplog.at_level(
        logging.INFO,
        logger="src.voc.connectors.oliveyoung_browser_api",
    ):
        # MUST NOT raise.
        await sess._snapshot_recovery_page_state(checkpoint="after_reload")

    state_messages = [
        r.getMessage()
        for r in caplog.records
        if "OY recovery page state:" in r.getMessage()
    ]
    assert len(state_messages) == 1
    msg = state_messages[0]
    assert "checkpoint=after_reload" in msg
    # Failing field collapses to "unknown".
    assert "sort_classmatch_count=unknown" in msg
    # Other fields still populated normally.
    assert "sort_pc_count=2" in msg
    assert "url_has_goodsno=true" in msg


@pytest.mark.asyncio
async def test_snapshot_page_state_no_log_when_flag_off(caplog):
    """E. When `_diagnose_post_recreate_page_state` is False (default,
    outside the recovery window), the snapshot helper is a fast no-op:
    no log line, no probes against the page.
    """
    import logging
    page = _SnapshotFakePage()
    sess = _build_snapshot_session(page=page, diagnostic_flag=False)

    with caplog.at_level(
        logging.INFO,
        logger="src.voc.connectors.oliveyoung_browser_api",
    ):
        await sess._snapshot_recovery_page_state(checkpoint="after_goto")

    # No log line emitted.
    state_messages = [
        r.getMessage()
        for r in caplog.records
        if r.getMessage().startswith("OY recovery page state:")
    ]
    assert state_messages == []
    # No locator probes against the page either.
    assert page.locator_calls == []


@pytest.mark.asyncio
async def test_snapshot_page_state_no_log_when_page_is_none(caplog):
    """E (variant). The helper bails fast when `self._page` is None
    (e.g. recovery early-returned before any navigation). No log line,
    no exception.
    """
    import logging
    sess = _build_snapshot_session(page=None, diagnostic_flag=True)
    sess._page = None

    with caplog.at_level(
        logging.INFO,
        logger="src.voc.connectors.oliveyoung_browser_api",
    ):
        # MUST NOT raise.
        await sess._snapshot_recovery_page_state(checkpoint="after_goto")

    state_messages = [
        r.getMessage()
        for r in caplog.records
        if r.getMessage().startswith("OY recovery page state:")
    ]
    assert state_messages == []


# ---------------------------------------------------------------------------
# C — Recovery checkpoint logs. Drive the real
# `reload_and_reopen_review_tab` (via `_build_readiness_session`)
# and assert the six named checkpoints fire in order.
# ---------------------------------------------------------------------------


class _RecoveryReadinessSnapshotPage(_RearmReadinessFakePage):
    """Extension of `_RearmReadinessFakePage` that adds the snapshot
    surface (`title()`, `evaluate()`) AND a target-label-visible
    locator path so the readiness wait's `target_label_visible`
    signal fires (which arms the scoped-click block and exercises
    the `before_scoped_click` / `after_scoped_click` checkpoints).

    When `target_label_visible=True`, the container locator returned
    by `locator(sort_container_selector)` exposes a child
    `locator("button")` whose `.count()` returns 1 and whose
    `.nth(0).inner_text()` returns the configured sort label
    (`target_label`). This is just enough surface to drive the
    production readiness wait into the target-label branch.
    """

    def __init__(
        self,
        *args,
        ready_state: str = "complete",
        target_label_visible: bool = False,
        target_label: str = "최신순",
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self._ready_state_for_snapshot = ready_state
        self._target_label_visible = target_label_visible
        self._target_label = target_label

    async def title(self):
        return "리뷰 - Test Product"

    async def evaluate(self, script):
        # The snapshot helper invokes `() => document.readyState`;
        # the parent's `evaluate` returns None which would collapse
        # to "unknown" in the log. Return the configured ready state
        # so the integration test sees `readyState=complete`. The
        # window scroll evaluate in `_trigger_review_list_api` also
        # passes through here — returning a string is harmless
        # because that caller discards the return value.
        return self._ready_state_for_snapshot

    def locator(self, selector):
        # Hand back a target-label-aware locator only when the
        # readiness wait probes one of our sort container selectors
        # AND the test asked for target-label visibility. Otherwise
        # fall through to the parent's count-flipping semantics.
        if (
            self._target_label_visible
            and selector in self._sort_container_selectors
        ):
            outer = self

            class _BtnLoc:
                # The "button-handle" returned for matched_button.
                async def scroll_into_view_if_needed(self_inner, timeout=None):
                    return None

                async def click(self_inner, timeout=None):
                    return None

                async def inner_text(self_inner, timeout=None):
                    return outer._target_label

            class _BtnArrayLoc:
                async def count(self_inner):
                    return 1

                def nth(self_inner, _i):
                    return _BtnLoc()

            class _ContainerLoc:
                async def count(self_inner):
                    return 1

                def locator(self_inner, sub_selector):
                    if sub_selector == "button":
                        return _BtnArrayLoc()
                    # Non-button tag selectors → zero count.
                    class _Zero:
                        async def count(self_z):
                            return 0

                        def nth(self_z, _i):  # pragma: no cover
                            return _BtnLoc()

                    return _Zero()

                @property
                def first(self_inner):
                    return self_inner

                async def scroll_into_view_if_needed(self_inner, timeout=None):
                    return None

            return _ContainerLoc()
        return super().locator(selector)


@pytest.mark.asyncio
async def test_recovery_checkpoints_fire_in_order_on_recreate_path():
    """C. Drive the real `reload_and_reopen_review_tab` through the
    recreate-fallback branch (reload disabled). With the page-state
    diagnostic flag flipped True on the session, the four recreate-
    path checkpoints fire in order:
        after_goto → after_review_cascade →
        before_scoped_click → after_scoped_click
    (Snapshot of `after_reload` is the reload-path-only checkpoint
    and does NOT fire on the recreate-only branch.)
    """
    from src.voc.connectors import oliveyoung_browser_api as mod

    sess = object.__new__(mod._PlaywrightReviewSession)
    # Build a context that hands out a recovery-readiness snapshot page.
    new_page_ref: list = []

    class _SnapshotCtx(_FakeBrowserContext):
        async def new_page(self):
            self.new_page_calls += 1
            page = _RecoveryReadinessSnapshotPage(
                url="about:blank",
                sort_area_visible_after_count=0,
                reload_should_raise=True,
                target_label_visible=True,
                target_label="최신순",
            )
            self.pages.append(page)
            new_page_ref.append(page)
            return page

    old_page = _RearmFakeAsyncPage(url=_PRODUCT_URL_TAB_REVIEW)
    sess._ctx = _SnapshotCtx([])
    sess._page = old_page
    sess._opened_product_url = _PRODUCT_URL_TAB_REVIEW
    sess._queue = asyncio.Queue()
    sess._request_log = []
    sess._observed_sort_types_count = {}
    sess._responses_filtered_out_by_sort = 0
    sess._observed_total_review_count = None
    sess._api_path = "/review/api/v2/reviews/cursor"
    sess._expected_sort_type = "DATETIME_DESC"
    sess._review_tab_locator = "div.review-tab"
    sess._review_more_button_clicked = False
    sess._scrolled_to_review_area = False
    sess._sort_button_label_ko = "최신순"
    sess._sort_button_selector = None
    sess._sort_container_candidates = (
        "div.pc-sort",
        ".sort-container",
        "[class*='sort']",
    )
    sess._sort_hunt_settle_s = 0.2
    sess._sort_hunt_poll_interval_s = 0.02
    sess._post_recreate_sort_area_ready = None
    sess._post_recreate_strategy_used = None
    sess._last_readiness_matched_button = None
    sess._last_readiness_matched_container = None
    # Flag must be True to exercise the snapshot calls. In production
    # the connector flips this before invoking recreate.
    sess._diagnose_post_recreate_page_state = True
    # Spy out heavy primitives to keep this an ordering test.
    sess._trigger_review_list_api = (  # type: ignore[assignment]
        lambda *, initial_click=True: asyncio.sleep(0)
    )
    sess._click_sort_button_robust = (  # type: ignore[assignment]
        lambda: asyncio.sleep(0)
    )

    import logging as _logging
    with pytest_capture_log(_logging.INFO) as records:
        await sess.reload_and_reopen_review_tab()

    state_messages = [
        r.getMessage()
        for r in records
        if r.getMessage().startswith("OY recovery page state:")
    ]
    checkpoints = [
        msg.split("checkpoint=")[1].split(" ")[0]
        for msg in state_messages
    ]
    # Reload-first is eligible by URL contract, but the fake reload
    # raises (reload_should_raise default True on the OLD page), so
    # we go straight to the recreate fallback. On the recreate path:
    # after_goto → after_review_cascade → before_scoped_click →
    # after_scoped_click.
    assert checkpoints[:1] == ["after_goto"], (
        f"first checkpoint must be after_goto on the recreate path; "
        f"got {checkpoints!r}"
    )
    assert "after_review_cascade" in checkpoints
    assert "before_scoped_click" in checkpoints
    assert "after_scoped_click" in checkpoints
    # Order constraints across the recreate path.
    after_goto_idx = checkpoints.index("after_goto")
    after_cascade_idx = checkpoints.index("after_review_cascade")
    before_click_idx = checkpoints.index("before_scoped_click")
    after_click_idx = checkpoints.index("after_scoped_click")
    assert (
        after_goto_idx < after_cascade_idx < before_click_idx < after_click_idx
    ), f"checkpoint order broken: {checkpoints!r}"


@pytest.mark.asyncio
async def test_recovery_checkpoint_after_reload_fires_on_reload_first_path():
    """C (variant). On the reload-first success path the
    `after_reload` checkpoint fires BEFORE `after_review_cascade`.
    The recreate fallback's `after_goto` does NOT fire because the
    reload-first path returned early.
    """
    from src.voc.connectors import oliveyoung_browser_api as mod

    sess = object.__new__(mod._PlaywrightReviewSession)
    # Old page reload SUCCEEDS (reload_should_raise=False). The same
    # page object hosts the post-reload cascade — no new_page() is
    # invoked on the reload-first success path.
    old_page = _RecoveryReadinessSnapshotPage(
        url=_PRODUCT_URL_TAB_REVIEW,
        sort_area_visible_after_count=0,
        reload_should_raise=False,
        target_label_visible=True,
        target_label="최신순",
    )
    sess._ctx = _FakeBrowserContext([])
    sess._page = old_page
    sess._opened_product_url = _PRODUCT_URL_TAB_REVIEW
    sess._queue = asyncio.Queue()
    sess._request_log = []
    sess._observed_sort_types_count = {}
    sess._responses_filtered_out_by_sort = 0
    sess._observed_total_review_count = None
    sess._api_path = "/review/api/v2/reviews/cursor"
    sess._expected_sort_type = "DATETIME_DESC"
    sess._review_tab_locator = "div.review-tab"
    sess._review_more_button_clicked = False
    sess._scrolled_to_review_area = False
    sess._sort_button_label_ko = "최신순"
    sess._sort_button_selector = None
    sess._sort_container_candidates = (
        "div.pc-sort",
        ".sort-container",
        "[class*='sort']",
    )
    sess._sort_hunt_settle_s = 0.2
    sess._sort_hunt_poll_interval_s = 0.02
    sess._post_recreate_sort_area_ready = None
    sess._post_recreate_strategy_used = None
    sess._last_readiness_matched_button = None
    sess._last_readiness_matched_container = None
    sess._diagnose_post_recreate_page_state = True
    sess._trigger_review_list_api = (  # type: ignore[assignment]
        lambda *, initial_click=True: asyncio.sleep(0)
    )
    sess._click_sort_button_robust = (  # type: ignore[assignment]
        lambda: asyncio.sleep(0)
    )

    import logging as _logging
    with pytest_capture_log(_logging.INFO) as records:
        await sess.reload_and_reopen_review_tab()

    state_messages = [
        r.getMessage()
        for r in records
        if r.getMessage().startswith("OY recovery page state:")
    ]
    checkpoints = [
        msg.split("checkpoint=")[1].split(" ")[0]
        for msg in state_messages
    ]
    # Reload-first success path: after_reload fires; recreate-fallback
    # checkpoints (after_goto) do not.
    assert "after_reload" in checkpoints, (
        f"after_reload must fire on the reload-first path; got {checkpoints!r}"
    )
    assert "after_goto" not in checkpoints, (
        f"after_goto must NOT fire on the reload-first success path; "
        f"got {checkpoints!r}"
    )
    assert "after_review_cascade" in checkpoints
    # after_reload precedes after_review_cascade.
    reload_idx = checkpoints.index("after_reload")
    cascade_idx = checkpoints.index("after_review_cascade")
    assert reload_idx < cascade_idx


@pytest.mark.asyncio
async def test_recovery_checkpoint_sort_readiness_timeout_fires_on_deadline(
    caplog,
):
    """C (variant). Drive `_wait_for_review_sort_area_ready` to a
    deadline (sort container never appears) and assert the
    `sort_readiness_timeout` checkpoint fires alongside the existing
    `OY review sort area NOT ready` WARNING.
    """
    import logging
    from src.voc.connectors import oliveyoung_browser_api as mod

    sess = object.__new__(mod._PlaywrightReviewSession)
    # Page whose locator counts are always zero — the container never
    # appears within the compressed deadline.
    page = _SnapshotFakePage(
        url=(
            "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
            "?goodsNo=A000000225736&tab=review"
        ),
        ready_state="complete",
        selector_counts={
            # All zero → container_visible never fires.
            "div.pc-sort": 0,
            ".sort-container": 0,
            "[class*='sort']": 0,
            "div.review-tab": 0,
            "text=최신순": 0,
            "text=유용한 순": 0,
            "text=평점 높은순": 0,
            "text=평점 낮은순": 0,
            "text=리뷰": 0,
        },
    )
    sess._page = page
    sess._sort_button_label_ko = "최신순"
    sess._sort_container_candidates = (
        "div.pc-sort",
        ".sort-container",
        "[class*='sort']",
    )
    sess._opened_product_url = (
        "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
        "?goodsNo=A000000225736&tab=review"
    )
    sess._review_tab_locator = "div.review-tab"
    sess._last_readiness_matched_button = None
    sess._last_readiness_matched_container = None
    sess._diagnose_post_recreate_page_state = True

    with caplog.at_level(
        logging.INFO,
        logger="src.voc.connectors.oliveyoung_browser_api",
    ):
        # Compressed budget so the deadline test stays fast.
        ready = await sess._wait_for_review_sort_area_ready(
            timeout_s=0.05, poll_interval_s=0.01,
        )

    # Existing contract: wait returns False on deadline.
    assert ready is False
    # New checkpoint fires.
    state_messages = [
        r.getMessage()
        for r in caplog.records
        if "OY recovery page state:" in r.getMessage()
    ]
    timeout_messages = [
        msg for msg in state_messages
        if "checkpoint=sort_readiness_timeout" in msg
    ]
    assert len(timeout_messages) == 1


# ---------------------------------------------------------------------------
# D — Trigger outcome diagnostics. Drive `_trigger_review_list_api`
# directly and assert the `OY recovery trigger outcome:` summary
# line shape.
# ---------------------------------------------------------------------------


class _TriggerOutcomeFakePage:
    """Minimal fake page for the trigger-outcome diagnostic tests.
    Configurable per-locator return values so each test can drive a
    specific cascade-step outcome.
    """

    REVIEW_MORE_DEFAULT = "button.review-more"

    def __init__(
        self,
        *,
        review_tab_count: int = 1,
        scroll_into_view_should_raise: bool = False,
        click_should_raise: bool = False,
        evaluate_should_raise: bool = False,
        more_button_count: int = 0,
    ):
        self._review_tab_count = review_tab_count
        self._scroll_into_view_should_raise = scroll_into_view_should_raise
        self._click_should_raise = click_should_raise
        self._evaluate_should_raise = evaluate_should_raise
        self._more_button_count = more_button_count
        self.evaluate_calls: list[str] = []

    def locator(self, selector):
        outer = self

        class _Loc:
            async def count(self_inner):
                # Review-tab locator → configured count.
                # Anything else (review-more selectors) → 0 unless
                # the test set `more_button_count`.
                if selector == "div.review-tab":
                    return outer._review_tab_count
                return outer._more_button_count

            async def click(self_inner, timeout=None):
                if outer._click_should_raise:
                    raise RuntimeError("simulated click failure")
                return None

            async def scroll_into_view_if_needed(self_inner, timeout=None):
                if outer._scroll_into_view_should_raise:
                    raise RuntimeError("simulated scroll failure")
                return None

            @property
            def first(self_inner):
                return self_inner

        return _Loc()

    async def evaluate(self, script):
        self.evaluate_calls.append(script)
        if self._evaluate_should_raise:
            raise RuntimeError("simulated evaluate failure")
        return None


def _build_trigger_session(
    *,
    page: _TriggerOutcomeFakePage,
    diagnostic_flag: bool = True,
):
    """Construct a `_PlaywrightReviewSession` with just enough surface
    for `_trigger_review_list_api` to run end-to-end."""
    from src.voc.connectors import oliveyoung_browser_api as mod

    sess = object.__new__(mod._PlaywrightReviewSession)
    sess._page = page
    sess._review_tab_locator = "div.review-tab"
    sess._review_more_button_clicked = False
    sess._scrolled_to_review_area = False
    sess._diagnose_post_recreate_page_state = diagnostic_flag
    return sess


@pytest.mark.asyncio
async def test_trigger_outcome_diagnostic_success_path_logs_summary(caplog):
    """D. With the diagnostic flag True and the trigger cascade
    succeeding at every step, the `OY recovery trigger outcome:`
    summary line shows the expected outcome fields.
    """
    import logging
    page = _TriggerOutcomeFakePage(
        review_tab_count=1,
        scroll_into_view_should_raise=False,
        click_should_raise=False,
        evaluate_should_raise=False,
    )
    sess = _build_trigger_session(page=page)

    with caplog.at_level(
        logging.INFO,
        logger="src.voc.connectors.oliveyoung_browser_api",
    ):
        await sess._trigger_review_list_api(initial_click=True)

    outcome_messages = [
        r.getMessage()
        for r in caplog.records
        if "OY recovery trigger outcome:" in r.getMessage()
    ]
    assert len(outcome_messages) == 1
    msg = outcome_messages[0]
    assert "review_tab_locator_count=1" in msg
    assert "review_tab_scroll_into_view=ok" in msg
    assert "review_tab_click_attempted=true" in msg
    assert "review_tab_click_raised=false" in msg
    assert "window_scroll_by_executed=true" in msg


@pytest.mark.asyncio
async def test_trigger_outcome_diagnostic_failing_scroll_does_not_change_behavior(
    caplog,
):
    """D (variant). When `scroll_into_view_if_needed` raises, the
    cascade still completes (best-effort) AND the outcome line
    reports `review_tab_scroll_into_view=failed`. Critically the
    cascade's overall return contract is unchanged — no exception
    propagates.
    """
    import logging
    page = _TriggerOutcomeFakePage(
        review_tab_count=1,
        scroll_into_view_should_raise=True,
        click_should_raise=False,
    )
    sess = _build_trigger_session(page=page)

    with caplog.at_level(
        logging.INFO,
        logger="src.voc.connectors.oliveyoung_browser_api",
    ):
        # MUST NOT raise.
        await sess._trigger_review_list_api(initial_click=True)

    outcome_messages = [
        r.getMessage()
        for r in caplog.records
        if "OY recovery trigger outcome:" in r.getMessage()
    ]
    assert len(outcome_messages) == 1
    msg = outcome_messages[0]
    assert "review_tab_scroll_into_view=failed" in msg
    # Click still attempted (the failure was in Step 2, not Step 1).
    assert "review_tab_click_attempted=true" in msg
    # Window scroll ran (Step 2 failure doesn't gate Step 2b's evaluate).
    assert "window_scroll_by_executed=true" in msg


@pytest.mark.asyncio
async def test_trigger_outcome_diagnostic_no_log_when_flag_off(caplog):
    """E (variant). When the diagnostic flag is False (default,
    happy-path collection), `_trigger_review_list_api` runs unchanged
    AND emits NO `OY recovery trigger outcome:` line. The cascade
    still completes and updates `_scrolled_to_review_area`.
    """
    import logging
    page = _TriggerOutcomeFakePage(review_tab_count=1)
    sess = _build_trigger_session(page=page, diagnostic_flag=False)

    with caplog.at_level(
        logging.INFO,
        logger="src.voc.connectors.oliveyoung_browser_api",
    ):
        await sess._trigger_review_list_api(initial_click=True)

    outcome_messages = [
        r.getMessage()
        for r in caplog.records
        if r.getMessage().startswith("OY recovery trigger outcome:")
    ]
    assert outcome_messages == []
    # Existing cascade behavior preserved.
    assert sess._scrolled_to_review_area is True


# ---------------------------------------------------------------------------
# E — Default-flag scope. The new flag is False on init, so no
# page-state / trigger-outcome logs fire outside the recovery
# window.
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_diagnose_post_recreate_page_state_default_false_on_init():
    """E. `_diagnose_post_recreate_page_state` is False at session
    init. Mirrors the contract for the response-probe flag.
    """
    from src.voc.connectors import oliveyoung_browser_api as mod
    sess = object.__new__(mod._PlaywrightReviewSession)
    sess.__init__(
        headless=True,
        api_path="/review/api/v2/reviews/cursor",
        review_tab_locator="div.review-tab",
        scroll_candidates=(),
        user_agent="ua",
        viewport={"width": 800, "height": 600},
    )
    assert sess._diagnose_post_recreate_page_state is False


@pytest.mark.asyncio
async def test_diagnose_post_recreate_page_state_toggled_with_response_probe(
    page1_body, page2_last, monkeypatch,
):
    """E (variant). The connector's recovery branch flips
    `_diagnose_post_recreate_page_state` True alongside
    `_diagnose_post_recovery_responses` BEFORE the recreate, and back
    to False at every exit. The two flags share the recovery-window
    scope.
    """
    class _FlagSpyRecoverySession(_RecoveryFakeSession):
        def __init__(self, *a, **kw):
            super().__init__(*a, **kw)
            self.page_state_flag_at_recreate_entry: bool | None = None
            self.response_flag_at_recreate_entry: bool | None = None

        async def reload_and_reopen_review_tab(self) -> None:
            self.page_state_flag_at_recreate_entry = bool(
                getattr(
                    self, "_diagnose_post_recreate_page_state", False,
                ),
            )
            self.response_flag_at_recreate_entry = bool(
                getattr(
                    self, "_diagnose_post_recovery_responses", False,
                ),
            )
            await super().reload_and_reopen_review_tab()

    session = _FlagSpyRecoverySession(
        [(200, page1_body), None, None, None],
        recreate_responses=[[(200, page2_last)]],
    )
    import src.voc.connectors.oliveyoung_browser_api as mod
    monkeypatch.setattr(mod.asyncio, "sleep", _no_sleep)

    c, params = _build_recovery_connector(session)
    await c.collect(keyword="x", params=params)

    # Both flags True at recreate entry.
    assert session.page_state_flag_at_recreate_entry is True
    assert session.response_flag_at_recreate_entry is True
    # Both flags reset to False after the recovery window ends.
    assert (
        getattr(session, "_diagnose_post_recreate_page_state", None)
        is False
    )
    assert session._diagnose_post_recovery_responses is False


@pytest.mark.asyncio
async def test_diagnose_post_recreate_page_state_false_after_recreate_raise(
    page1_body, monkeypatch,
):
    """E (variant). When `reload_and_reopen_review_tab` raises, the
    page-state flag is still reset to False at the recovery-branch
    exit (the `_close_post_recovery_diag` helper clears BOTH flags).
    """
    class _RaisingRecoverySession(_RecoveryFakeSession):
        async def reload_and_reopen_review_tab(self) -> None:
            self.recreate_calls += 1
            raise RuntimeError("simulated recreate failure")

    session = _RaisingRecoverySession(
        [(200, page1_body), None, None, None],
    )
    import src.voc.connectors.oliveyoung_browser_api as mod
    monkeypatch.setattr(mod.asyncio, "sleep", _no_sleep)

    c, params = _build_recovery_connector(session)
    await c.collect(keyword="x", params=params)

    assert session.recreate_calls == 1
    # Flag reset on the raise path.
    assert (
        getattr(session, "_diagnose_post_recreate_page_state", None)
        is False
    )


# Small in-file helper: capture log records at INFO inside a `with`
# block without the verbose `caplog` boilerplate when the test only
# needs the records list.
class pytest_capture_log:  # noqa: N801 (intentional lowercase context helper)
    """Lightweight log-capture context manager.

    Equivalent to a focused `caplog.at_level(level, logger=<name>)`
    plus access to `records`. Used by the recovery-checkpoint tests
    above where we want the records list as a plain in-scope value
    rather than threading caplog through every assertion.
    """

    LOGGER_NAME = "src.voc.connectors.oliveyoung_browser_api"

    def __init__(self, level):
        self.level = level
        self.records: list = []
        self._handler = None
        self._logger = None
        self._prev_level = None

    def __enter__(self):
        import logging
        self._logger = logging.getLogger(self.LOGGER_NAME)
        self._prev_level = self._logger.level
        self._logger.setLevel(self.level)
        records = self.records

        class _ListHandler(logging.Handler):
            def emit(self_inner, record):
                records.append(record)

        self._handler = _ListHandler(level=self.level)
        self._logger.addHandler(self._handler)
        return self.records

    def __exit__(self, exc_type, exc, tb):
        if self._logger is not None and self._handler is not None:
            self._logger.removeHandler(self._handler)
            self._logger.setLevel(self._prev_level)
        return False
