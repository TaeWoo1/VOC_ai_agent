"""Tests for `src/voc/app/collection_batch.py` and the runner CLI.

No live scraping. The `runner_fn` parameter on `run_batch(...)` lets tests
inject a synthetic per-product result without invoking the real subprocess
or touching the OY connector. All file I/O lands under `tmp_path`.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

from src.voc.app.collection_batch import (
    ALL_STATUSES,
    HALT_STATUSES,
    BatchDefaults,
    BatchManifest,
    ProductResult,
    ProductSpec,
    _build_ingest_command,
    _build_product_result,
    _derive_resume_state,
    _format_resume_line,
    _infer_auth_header_present,
    classify_status,
    load_manifest,
    render_batch_markdown,
    run_batch,
)
from src.voc.app.connector_run_summary import ConnectorRunSummary

REPO_ROOT = Path(__file__).resolve().parents[2]
CLI_PATH = REPO_ROOT / "scripts" / "run_oy_collection_batch.py"


# ---------------------------------------------------------------------------
# classify_status — pure function; one test per status
# ---------------------------------------------------------------------------

def _summary(**overrides):
    """Build a minimal summary dict with optional overrides."""
    base = {
        "quality_status": "ok",
        "rows_inserted": 200,
        "records_parsed": 200,
        "raw_records_seen": 200,
        "blocked": False,
        "auth_error": False,
        "mid_stream_auth_break": False,
        "http_403_seen": False,
        "http_429_seen": False,
        "cold_start_timed_out": False,
        "incomplete_collection": False,
        "pagination_exhausted": False,
        "last_observed_has_next": False,
        "login_state_observed": "logged_in",
        "trace_artifact_path": None,
        "partial_debug_artifact_path": None,
        "parse_warnings": 0,
    }
    base.update(overrides)
    return base


def test_status_authenticated_ok_default():
    """Successful run with no specific shape tag → authenticated_ok."""
    assert classify_status(_summary()) == "authenticated_ok"


def test_status_complete_when_pagination_exhausted():
    """pagination_exhausted=True → complete (full history collected)."""
    assert classify_status(_summary(
        pagination_exhausted=True, last_observed_has_next=False,
    )) == "complete"


def test_status_max_cap_reached_when_has_next_true():
    """last_observed_has_next=True → max_cap_reached (cap hit, more available)."""
    assert classify_status(_summary(last_observed_has_next=True)) == "max_cap_reached"


# ---------------------------------------------------------------------------
# I-OY-SCROLL-CONTINUATION-IMPL — split max_cap_reached into the
# scroll-continuation-exhausted branch when the connector signals
# `incomplete_collection=True`. The flag is set whenever the parsed
# row count is below the operator quota AND the last body advertised
# more rows; it distinguishes "connector gave up" from "operator-cap
# fired."
# ---------------------------------------------------------------------------


def test_status_scroll_continuation_exhausted_when_incomplete_with_has_next():
    """incomplete_collection=True + last_observed_has_next=True →
    scroll_continuation_exhausted (the connector gave up before the
    server did). Distinct from max_cap_reached so audits can tell
    the two apart."""
    s = classify_status(_summary(
        last_observed_has_next=True,
        incomplete_collection=True,
    ))
    assert s == "scroll_continuation_exhausted"


def test_status_max_cap_reached_when_quota_actually_fired():
    """incomplete_collection=False with last_observed_has_next=True →
    max_cap_reached. This is the canonical operator-cap stop: the
    server still has more rows, but the run consumed its requested
    quota."""
    s = classify_status(_summary(
        last_observed_has_next=True,
        incomplete_collection=False,
    ))
    assert s == "max_cap_reached"


def test_status_natural_exhaustion_still_complete():
    """pagination_exhausted=True takes priority — even when
    incomplete_collection=True (degenerate; should not happen) the
    natural-end-of-stream verdict wins."""
    s = classify_status(_summary(
        pagination_exhausted=True,
        last_observed_has_next=False,
        incomplete_collection=False,
    ))
    assert s == "complete"


def test_status_legacy_summary_without_incomplete_flag_collapses_to_max_cap():
    """Pre-patch summaries do not carry `incomplete_collection`. They
    must still classify as max_cap_reached when has_next=True so
    rerun-replay of older artifacts is byte-identical to the
    pre-patch behavior."""
    s = classify_status({
        "quality_status": "ok",
        "rows_inserted": 200,
        "records_parsed": 200,
        "raw_records_seen": 200,
        "blocked": False,
        "auth_error": False,
        "mid_stream_auth_break": False,
        "http_403_seen": False,
        "http_429_seen": False,
        "pagination_exhausted": False,
        "last_observed_has_next": True,
        # incomplete_collection deliberately absent (legacy shape).
    })
    assert s == "max_cap_reached"


def test_status_sort_control_unreachable_still_wins_over_scroll_split():
    """Regression guard: the sort-control-unreachable branch fires
    BEFORE the successful-states block. Even with incomplete_collection
    set, a sort-control failure must classify as
    sort_control_unreachable, not scroll_continuation_exhausted."""
    s = classify_status(_summary(
        quality_status="invalid",
        rows_inserted=0,
        records_parsed=0,
        blocked=True,
        sort_control_unreachable=True,
        false_empty_state_detected=True,
        incomplete_collection=True,
        last_observed_has_next=True,
    ))
    assert s == "sort_control_unreachable"


def test_status_duplicate_only_when_zero_inserts_with_parsed_rows():
    """0 rows_inserted but records_parsed>0 → duplicate_only."""
    assert classify_status(_summary(
        rows_inserted=0, records_parsed=200,
    )) == "duplicate_only"


def test_status_anonymous_auth_wall():
    """auth_error=True + login_state=logged_out → anonymous_auth_wall."""
    assert classify_status(_summary(
        quality_status="invalid", auth_error=True, mid_stream_auth_break=True,
        login_state_observed="logged_out", rows_inserted=0,
    )) == "anonymous_auth_wall"


def test_status_anonymous_auth_wall_when_login_state_unknown():
    """auth_error=True with login_state=None defaults to anonymous_auth_wall."""
    assert classify_status(_summary(
        quality_status="invalid", auth_error=True, mid_stream_auth_break=True,
        login_state_observed=None, rows_inserted=0,
    )) == "anonymous_auth_wall"


def test_status_auth_expired_mid_batch():
    """auth_error=True + login_state=logged_in + mid_stream → auth_expired_mid_batch."""
    assert classify_status(_summary(
        quality_status="invalid", auth_error=True, mid_stream_auth_break=True,
        login_state_observed="logged_in", rows_inserted=0,
    )) == "auth_expired_mid_batch"


def test_status_anti_bot_403():
    assert classify_status(_summary(
        quality_status="invalid", blocked=True, http_403_seen=True, rows_inserted=0,
    )) == "anti_bot"


def test_status_anti_bot_429():
    assert classify_status(_summary(
        quality_status="invalid", blocked=True, http_429_seen=True, rows_inserted=0,
    )) == "anti_bot"


def test_status_anti_bot_priority_over_auth_error():
    """blocked/403/429 takes priority over auth_error in classification."""
    assert classify_status(_summary(
        quality_status="invalid", blocked=True, http_403_seen=True,
        auth_error=True, login_state_observed="logged_in",
        rows_inserted=0,
    )) == "anti_bot"


def test_status_partial_artifact_only():
    """Invalid run with partial artifact (and no auth/blocked) → partial_artifact_only."""
    assert classify_status(_summary(
        quality_status="invalid",
        incomplete_collection=True,
        partial_debug_artifact_path="/tmp/x.jsonl",
        rows_inserted=0, records_parsed=10,
    )) == "partial_artifact_only"


def test_status_parser_error():
    """Invalid run with parse_warnings>0 (no auth/blocked, no partial) → parser_error."""
    assert classify_status(_summary(
        quality_status="invalid",
        parse_warnings=5,
        rows_inserted=0, records_parsed=0,
    )) == "parser_error"


def test_status_unknown_failure_for_invalid_with_no_specific_tag():
    """Catch-all: invalid run with no auth/blocked/partial/parser tag → unknown_failure."""
    assert classify_status(_summary(
        quality_status="invalid",
        rows_inserted=0, records_parsed=0,
    )) == "unknown_failure"


def test_status_cdp_attach_failed_short_circuits():
    """Added 2026-05-01. `cdp_attach_failed=True` takes priority over
    every other classifier branch, including blocked/anti_bot — the
    connector never got far enough for any of those signals to be
    meaningful."""
    assert classify_status(_summary(
        quality_status="invalid",
        rows_inserted=0, records_parsed=0,
        cdp_attach_failed=True,
        # Even with these set, cdp_attach_failed wins.
        blocked=True, http_403_seen=True,
    )) == "cdp_attach_failed"


def test_status_cdp_attach_failed_falls_back_to_sample_dropped_reasons():
    """Added 2026-05-01. Defensive: even if upstream forgets to set
    `cdp_attach_failed=True` on the summary, classify_status scans
    `sample_dropped_reasons` for the canonical CDP-wall markers and
    returns `cdp_attach_failed`. This catches Phase1Pipeline-swallowed
    exceptions on legacy summaries that pre-date the explicit flag."""
    s = classify_status(_summary(
        quality_status="invalid",
        rows_inserted=0, records_parsed=0,
        cdp_attach_failed=False,  # explicitly NOT set
        sample_dropped_reasons=[
            "connector.collect raised: BrowserType.connect_over_cdp: "
            "Protocol error (Browser.setDownloadBehavior): Browser "
            "context management is not supported.",
        ],
    ))
    assert s == "cdp_attach_failed"


def test_status_fallback_does_not_fire_on_unrelated_drop_reasons():
    """The defensive fallback must only fire on canonical CDP markers —
    not on every entry in sample_dropped_reasons. A normal
    parse-warning drop must NOT spuriously route to cdp_attach_failed."""
    s = classify_status(_summary(
        quality_status="invalid",
        rows_inserted=0, records_parsed=0,
        sample_dropped_reasons=[
            "row 4: rating value out of [1,5] range",
            "row 9: text below 10-char floor",
        ],
    ))
    assert s != "cdp_attach_failed"


def test_status_page_open_failed_short_circuits():
    """Added 2026-05-01. `page_open_failed=True` takes priority over
    every other classifier branch except cdp_attach_failed."""
    assert classify_status(_summary(
        quality_status="invalid",
        rows_inserted=0, records_parsed=0,
        page_open_failed=True,
        blocked=True,  # would normally classify as anti_bot
    )) == "page_open_failed"


def test_status_cdp_takes_priority_over_page_open():
    """When both flags are set (defensive — they shouldn't both fire),
    cdp_attach_failed wins because it happened first chronologically."""
    assert classify_status(_summary(
        quality_status="invalid",
        rows_inserted=0, records_parsed=0,
        cdp_attach_failed=True, page_open_failed=True,
    )) == "cdp_attach_failed"


def test_status_review_list_api_seen_but_no_rows_kept_filter_path():
    """Added 2026-05-01. List API fired with content but every parsed
    row was filtered out by goods_no (typical of 기획-set products
    interleaving sibling sub-product reviews). Must NOT classify as
    `unknown_failure`."""
    assert classify_status(_summary(
        quality_status="invalid",
        rows_inserted=0, records_parsed=0,
        review_api_response_count=3,
        rows_filtered_by_goods_no=12,
        rows_dropped_unparseable=0,
    )) == "review_list_api_seen_but_no_rows_kept"


def test_status_review_list_api_seen_but_no_rows_kept_unparseable_path():
    """Same status fires when rows were dropped because the parser
    couldn't extract them, even with rows_filtered_by_goods_no=0."""
    assert classify_status(_summary(
        quality_status="invalid",
        rows_inserted=0, records_parsed=0,
        review_api_response_count=2,
        rows_filtered_by_goods_no=0,
        rows_dropped_unparseable=4,
    )) == "review_list_api_seen_but_no_rows_kept"


def test_status_no_rows_kept_does_not_fire_when_rows_parsed():
    """If `records_parsed > 0` then SOME rows survived the filter — the
    no_rows_kept status must NOT fire even if other rows were filtered."""
    s = classify_status(_summary(
        quality_status="invalid",  # invalid for some other reason
        rows_inserted=0, records_parsed=3,
        review_api_response_count=2,
        rows_filtered_by_goods_no=10,
    ))
    assert s != "review_list_api_seen_but_no_rows_kept"


def test_status_review_api_not_seen_when_cascade_ran_no_apis():
    """Added 2026-05-01. Page opened, cascade ran, but neither meta
    nor list endpoint fired. More specific than unknown_failure."""
    assert classify_status(_summary(
        quality_status="invalid",
        rows_inserted=0, records_parsed=0,
        review_api_response_count=0,
        scrolled_to_review_area=True,
        review_more_button_clicked=True,
        total_review_count_available=0,  # meta did NOT fire
    )) == "review_api_not_seen"


def test_status_review_api_not_seen_does_not_fire_without_cascade():
    """If the cascade did not run, the new specific status MUST NOT
    fire — we can't tell whether the API was suppressed or just never
    triggered. Falls back to unknown_failure."""
    assert classify_status(_summary(
        quality_status="invalid",
        rows_inserted=0, records_parsed=0,
        review_api_response_count=0,
        scrolled_to_review_area=False,
        review_more_button_clicked=False,
        total_review_count_available=None,
    )) == "unknown_failure"


def test_status_review_list_api_not_seen_but_review_meta_seen():
    """Added 2026-05-01. The page knows there are reviews
    (`total_review_count_available` > 0 from a meta-API response),
    the connector ran the lazy-load cascade
    (`scrolled_to_review_area=True` OR `review_more_button_clicked=True`),
    but the cursor API never fired (`review_api_response_count=0`).
    Must classify as the new specific status, not `unknown_failure`."""
    assert classify_status(_summary(
        quality_status="invalid",
        rows_inserted=0, records_parsed=0,
        review_api_response_count=0,
        scrolled_to_review_area=True,
        review_more_button_clicked=True,
        total_review_count_available=73837,
    )) == "review_list_api_not_seen_but_review_meta_seen"


def test_status_unknown_failure_when_cascade_did_not_run():
    """If `scrolled_to_review_area` AND `review_more_button_clicked`
    are both False, the cascade didn't actually execute — fall back
    to `unknown_failure` rather than promoting to the new status."""
    assert classify_status(_summary(
        quality_status="invalid",
        rows_inserted=0, records_parsed=0,
        review_api_response_count=0,
        scrolled_to_review_area=False,
        review_more_button_clicked=False,
        total_review_count_available=73837,
    )) == "unknown_failure"


def test_status_review_api_not_seen_when_meta_count_absent():
    """When the cascade ran and page opened but neither meta nor list
    API fired (`total_review_count_available=None` AND
    `review_api_response_count=0`), the new
    `review_api_not_seen` status is more specific than the legacy
    `unknown_failure` catch-all (added 2026-05-01)."""
    assert classify_status(_summary(
        quality_status="invalid",
        rows_inserted=0, records_parsed=0,
        review_api_response_count=0,
        scrolled_to_review_area=True,
        review_more_button_clicked=True,
        total_review_count_available=None,
    )) == "review_api_not_seen"


def test_new_status_does_not_label_as_anti_bot_when_no_markers():
    """Critical operator-stated contract: never call the new condition
    anti_bot. With no http_403/429 and no false_empty signal, even if
    the cascade ran and meta count is positive, the status must be
    the new specific code — not `anti_bot`."""
    s = classify_status(_summary(
        quality_status="invalid",
        rows_inserted=0, records_parsed=0,
        review_api_response_count=0,
        scrolled_to_review_area=True,
        review_more_button_clicked=True,
        total_review_count_available=73837,
        http_403_seen=False,
        http_429_seen=False,
        false_empty_state_detected=False,
    ))
    assert s != "anti_bot"
    assert s != "blocked_or_empty_state"


# ---------------------------------------------------------------------------
# I-OY-RATING-SORTS-IMPL — `sort_control_unreachable` precedence in
# `classify_status`. The flag is set by the connector when the widened
# sort-row probe exhausts the deadline without finding the target tab.
# It must take priority over the conflated `blocked_or_empty_state`
# branch so downstream consumers (`collection_summary.py`,
# `inspect_run_quality.py`) can distinguish a UI-shape failure from
# a true anti-bot soft-block.
# ---------------------------------------------------------------------------


def test_status_sort_control_unreachable_takes_priority_over_false_empty():
    """The connector sets `sort_control_unreachable=True` when the
    sort tab was not found, AND `false_empty_state_detected=True`
    because the page kept emitting default-sort responses that the
    `_expected_sort_type` filter rejected. The new branch must win."""
    s = classify_status(_summary(
        quality_status="invalid",
        rows_inserted=0, records_parsed=0,
        blocked=True,
        sort_control_unreachable=True,
        false_empty_state_detected=True,
    ))
    assert s == "sort_control_unreachable"


def test_status_sort_control_unreachable_does_not_overshadow_real_http_block():
    """A real HTTP block (403/429) STILL wins over the new flag.
    `sort_control_unreachable` only fires when the connector reached
    the API surface but couldn't find the sort tab; an HTTP-level
    block strictly indicates the connector did NOT reach the API."""
    s_403 = classify_status(_summary(
        quality_status="invalid",
        rows_inserted=0, records_parsed=0,
        blocked=True,
        http_403_seen=True,
        sort_control_unreachable=True,
    ))
    assert s_403 == "anti_bot"
    s_429 = classify_status(_summary(
        quality_status="invalid",
        rows_inserted=0, records_parsed=0,
        blocked=True,
        http_429_seen=True,
        sort_control_unreachable=True,
    ))
    assert s_429 == "anti_bot"


def test_status_blocked_or_empty_state_unchanged_when_unreachable_flag_absent():
    """Regression guard: when the new flag is absent (legacy summaries
    or genuine anti-bot soft blocks), classify_status must still return
    the legacy `blocked_or_empty_state`."""
    s = classify_status(_summary(
        quality_status="invalid",
        rows_inserted=0, records_parsed=0,
        blocked=True,
        false_empty_state_detected=True,
        # sort_control_unreachable absent — this is the genuine
        # anti-bot soft-block signature.
    ))
    assert s == "blocked_or_empty_state"


def test_status_complete_takes_priority_over_max_cap():
    """When both pagination_exhausted=True AND last_observed_has_next=True (impossible
    in practice but defensive), complete wins."""
    # Note: this combination is degenerate; if pagination_exhausted=True, the
    # connector always exits with last_observed_has_next=False. Test confirms
    # the priority anyway.
    assert classify_status(_summary(
        pagination_exhausted=True, last_observed_has_next=True,
    )) == "complete"


def test_all_statuses_are_in_taxonomy():
    """Sanity: every emit-able status is declared in ALL_STATUSES."""
    emitted = {
        "authenticated_ok",
        "complete",
        "max_cap_reached",
        # I-OY-SCROLL-CONTINUATION-IMPL — successful run that gave up
        # before the server did. Distinct from `max_cap_reached` so
        # operator audits can tell scroll-continuation exhaustion from
        # an operator-cap stop.
        "scroll_continuation_exhausted",
        "duplicate_only",
        "anonymous_auth_wall",
        "auth_expired_mid_batch",
        "anti_bot",
        "blocked_or_empty_state",
        # I-OY-RATING-SORTS-IMPL — terminal status emitted when
        # `_click_sort_button_robust` exhausts its hunt deadline
        # without finding the target sort tab even after the widening
        # probe (scroll-into-view + scope-limited disclosure click).
        "sort_control_unreachable",
        "partial_artifact_only",
        "parser_error",
        "unknown_failure",
        "review_list_api_not_seen_but_review_meta_seen",
        "cdp_attach_failed",
        "page_open_failed",
        "review_list_api_seen_but_no_rows_kept",
        "review_api_not_seen",
    }
    assert emitted == ALL_STATUSES


def test_halt_statuses_are_subset_of_all():
    assert HALT_STATUSES.issubset(ALL_STATUSES)


# ---------------------------------------------------------------------------
# Manifest parsing
# ---------------------------------------------------------------------------

def _write_manifest(tmp_path, batch_id, products, defaults=None):
    p = tmp_path / "manifest.json"
    body = {"batch_id": batch_id, "products": products}
    if defaults is not None:
        body["defaults"] = defaults
    p.write_text(json.dumps(body), encoding="utf-8")
    return p


def test_load_manifest_minimal(tmp_path):
    p = _write_manifest(tmp_path, "b1", [
        {"name": "n1", "oy_goods_no": "A1"},
    ])
    m = load_manifest(p)
    assert m.batch_id == "b1"
    assert len(m.products) == 1
    assert m.products[0].name == "n1"
    assert m.products[0].oy_goods_no == "A1"
    # Defaults applied
    assert m.defaults.max_reviews == 200
    assert m.defaults.cdp_endpoint == "http://localhost:9222"


def test_load_manifest_with_defaults(tmp_path):
    p = _write_manifest(tmp_path, "b2", [
        {"name": "n", "oy_goods_no": "A"},
    ], defaults={
        "max_reviews": 500,
        "cdp_endpoint": "http://localhost:9999",
        "cold_start_timeout": 90,
        "continuation_timeout": 20,
        "scroll_attempts": 7,
    })
    m = load_manifest(p)
    assert m.defaults.max_reviews == 500
    assert m.defaults.cdp_endpoint == "http://localhost:9999"
    assert m.defaults.cold_start_timeout == 90
    assert m.defaults.continuation_timeout == 20
    assert m.defaults.scroll_attempts == 7


def test_load_manifest_per_product_overrides(tmp_path):
    p = _write_manifest(tmp_path, "b3", [
        {"name": "default", "oy_goods_no": "A"},
        {"name": "overridden", "oy_goods_no": "B", "max_reviews": 1000, "scroll_attempts": 10},
    ])
    m = load_manifest(p)
    assert m.products[0].max_reviews is None  # uses defaults
    assert m.products[1].max_reviews == 1000
    assert m.products[1].scroll_attempts == 10


def test_load_manifest_rejects_missing_batch_id(tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps({"products": [{"name": "x", "oy_goods_no": "A"}]}), encoding="utf-8")
    with pytest.raises(ValueError, match="batch_id"):
        load_manifest(p)


def test_load_manifest_rejects_empty_products(tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps({"batch_id": "x", "products": []}), encoding="utf-8")
    with pytest.raises(ValueError, match="products"):
        load_manifest(p)


def test_load_manifest_rejects_product_missing_required_fields(tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps({
        "batch_id": "x", "products": [{"oy_goods_no": "A"}],
    }), encoding="utf-8")
    with pytest.raises(ValueError, match="name"):
        load_manifest(p)


# ---------------------------------------------------------------------------
# _build_ingest_command — argv composition
# ---------------------------------------------------------------------------

def test_build_ingest_command_uses_all_required_flags(tmp_path):
    spec = ProductSpec(name="n", oy_goods_no="A000000171371")
    defaults = BatchDefaults()
    argv = _build_ingest_command(
        spec=spec, defaults=defaults, debug_dir=tmp_path,
    )
    # First arg is python; second is script path
    assert argv[0]  # some python interpreter
    assert "ingest_oliveyoung_browser_phase1.py" in argv[1]
    # URL is the third positional
    assert "goodsNo=A000000171371" in argv[2]
    # Required flags appear with correct values
    assert "--max" in argv and "200" in argv
    assert "--cdp-endpoint" in argv and "http://localhost:9222" in argv
    assert "--cold-start-timeout" in argv and "60.0" in argv
    assert "--continuation-timeout" in argv and "12.0" in argv
    assert "--scroll-attempts" in argv and "5" in argv
    assert "--debug-dir" in argv and str(tmp_path) in argv
    assert "--capture-partial-on-invalid" in argv


def test_build_ingest_command_per_product_override(tmp_path):
    spec = ProductSpec(
        name="n", oy_goods_no="A1", max_reviews=999, cdp_endpoint="http://x:1",
    )
    defaults = BatchDefaults()
    argv = _build_ingest_command(
        spec=spec, defaults=defaults, debug_dir=tmp_path,
    )
    assert "999" in argv  # spec.max_reviews wins
    assert "http://x:1" in argv  # spec.cdp_endpoint wins


def test_build_ingest_command_force_fresh_context_omitted_by_default(tmp_path):
    spec = ProductSpec(name="n", oy_goods_no="A1")
    defaults = BatchDefaults()
    argv = _build_ingest_command(
        spec=spec, defaults=defaults, debug_dir=tmp_path,
    )
    assert "--force-fresh-context" not in argv


def test_build_ingest_command_force_fresh_context_via_defaults(tmp_path):
    spec = ProductSpec(name="n", oy_goods_no="A1")
    defaults = BatchDefaults(force_fresh_context=True)
    argv = _build_ingest_command(
        spec=spec, defaults=defaults, debug_dir=tmp_path,
    )
    assert "--force-fresh-context" in argv


def test_build_ingest_command_force_fresh_context_via_spec_override(tmp_path):
    # Spec override (True) wins over defaults (False).
    spec = ProductSpec(
        name="n", oy_goods_no="A1", force_fresh_context=True,
    )
    defaults = BatchDefaults(force_fresh_context=False)
    argv = _build_ingest_command(
        spec=spec, defaults=defaults, debug_dir=tmp_path,
    )
    assert "--force-fresh-context" in argv


def test_build_ingest_command_force_fresh_context_spec_false_overrides_default_true(tmp_path):
    # Defensive: per-product override of False should drop the flag
    # even when defaults say True. (Spec value is None to signify
    # "no override"; explicit False also has effect.)
    spec = ProductSpec(
        name="n", oy_goods_no="A1", force_fresh_context=False,
    )
    defaults = BatchDefaults(force_fresh_context=True)
    argv = _build_ingest_command(
        spec=spec, defaults=defaults, debug_dir=tmp_path,
    )
    assert "--force-fresh-context" not in argv


# ---------------------------------------------------------------------------
# run_batch — end-to-end with injected runner_fn
# ---------------------------------------------------------------------------

def _stub_runner(stdout_dict):
    """Build a runner_fn that returns rc=0 + json-encoded stdout for every call."""
    def _f(argv):
        return 0, json.dumps(stdout_dict), ""
    return _f


def _ok_summary_stdout(run_id="r1", rows_inserted=200, **summary_overrides):
    """Synthetic stdout JSON matching the ingest CLI's shape."""
    summary = {
        "run_id": run_id,
        "channel": "oliveyoung",
        "raw_records_seen": 200,
        "records_parsed": 200,
        "parse_warnings": 0,
        "blocked": False,
        "auth_error": False,
        "mid_stream_auth_break": False,
        "http_403_seen": False,
        "http_429_seen": False,
        "cold_start_timed_out": False,
        "incomplete_collection": False,
        "pagination_exhausted": False,
        "last_observed_has_next": False,
        "login_state_observed": "logged_in",
        "trace_artifact_path": None,
        "partial_debug_artifact_path": None,
    }
    summary.update(summary_overrides)
    return {
        "run_id": run_id,
        "quality_status": summary_overrides.get("quality_status", "ok"),
        "rows_inserted": rows_inserted,
        "rows_skipped_by_normalize": 0,
        "summary": summary,
    }


def _build_manifest(tmp_path, batch_id, product_ids):
    products = [
        {"name": f"p-{pid}", "oy_goods_no": pid} for pid in product_ids
    ]
    p = _write_manifest(tmp_path, batch_id, products)
    return load_manifest(p)


def test_run_batch_success_writes_outputs(tmp_path):
    manifest = _build_manifest(tmp_path, "b_ok", ["A1", "A2"])
    runner = _stub_runner(_ok_summary_stdout(rows_inserted=200))
    report = run_batch(
        manifest=manifest, artifact_root=tmp_path, runner_fn=runner,
    )
    assert report.halted is False
    assert len(report.products) == 2
    assert all(p.status == "authenticated_ok" for p in report.products)
    # Outputs landed
    batch_dir = tmp_path / "b_ok"
    assert (batch_dir / "batch_summary.json").exists()
    assert (batch_dir / "batch_summary.md").exists()
    parsed = json.loads((batch_dir / "batch_summary.json").read_text(encoding="utf-8"))
    assert parsed["batch_id"] == "b_ok"
    assert parsed["product_count_attempted"] == 2


def test_run_batch_creates_per_product_subdir(tmp_path):
    manifest = _build_manifest(tmp_path, "b_dirs", ["A1", "A2"])
    runner = _stub_runner(_ok_summary_stdout())
    run_batch(manifest=manifest, artifact_root=tmp_path, runner_fn=runner)
    assert (tmp_path / "b_dirs" / "A1").is_dir()
    assert (tmp_path / "b_dirs" / "A2").is_dir()


# ---------------------------------------------------------------------------
# Multi-sort membership sidecar write (Phase 2E membership tracking)
# ---------------------------------------------------------------------------

def _ok_summary_with_sort(
    *, sort_type: str, review_ids: list[str], rows_inserted: int = 200,
) -> dict:
    """Synthetic ingest CLI stdout JSON that mirrors the real shape post
    membership-tracking PR: includes sort_type + collected_review_ids."""
    base = _ok_summary_stdout(rows_inserted=rows_inserted)
    base["sort_type"] = sort_type
    base["collected_review_ids"] = review_ids
    return base


def test_run_batch_writes_sort_membership_sidecar_when_sort_type_set(tmp_path):
    """A manifest configuring sort_type=DATETIME_DESC + a stub runner that
    surfaces collected_review_ids must produce a sidecar JSON at the
    documented path."""
    p = _write_manifest(
        tmp_path, "b_sidecar",
        [{"name": "n", "oy_goods_no": "A0001"}],
        defaults={"sort_type": "DATETIME_DESC"},
    )
    manifest = load_manifest(p)
    runner = _stub_runner(_ok_summary_with_sort(
        sort_type="DATETIME_DESC", review_ids=["r1", "r2", "r3"],
    ))
    report = run_batch(
        manifest=manifest, artifact_root=tmp_path, runner_fn=runner,
    )
    sidecar = tmp_path / "b_sidecar" / "A0001_DATETIME_DESC_review_ids.json"
    assert sidecar.is_file(), f"sidecar not written at {sidecar}"
    payload = json.loads(sidecar.read_text(encoding="utf-8"))
    assert payload["goodsNo"] == "A0001"
    assert payload["sort_type"] == "DATETIME_DESC"
    assert payload["role"] == "primary"
    # New rank-aware items format. 1-based ranks taken from the
    # collected_review_ids order — i.e., the API's response order, which
    # matches the sort's ranking direction.
    assert payload["items"] == [
        {"review_id": "r1", "rank": 1},
        {"review_id": "r2", "rank": 2},
        {"review_id": "r3", "rank": 3},
    ]
    # Legacy `review_ids` field is gone.
    assert "review_ids" not in payload
    # ProductResult exposes the path for downstream consumers.
    assert report.products[0].sort_membership_sidecar_path == str(sidecar)


def test_run_batch_signal_sort_writes_role_signal(tmp_path):
    p = _write_manifest(
        tmp_path, "b_signal",
        [{"name": "n", "oy_goods_no": "A0001"}],
        defaults={"sort_type": "RATING_ASC"},
    )
    manifest = load_manifest(p)
    runner = _stub_runner(_ok_summary_with_sort(
        sort_type="RATING_ASC", review_ids=["rA"],
    ))
    run_batch(manifest=manifest, artifact_root=tmp_path, runner_fn=runner)
    sidecar = tmp_path / "b_signal" / "A0001_RATING_ASC_review_ids.json"
    payload = json.loads(sidecar.read_text(encoding="utf-8"))
    assert payload["role"] == "signal"


def test_run_batch_omits_sidecar_when_no_sort_type_configured(tmp_path):
    """Default-sort runs (sort_type unset) MUST NOT write a sidecar —
    the per-row oy_sort_type/oy_sort_role fields aren't stamped, so a
    sidecar would carry an unclassified sort. Maintains legacy behavior."""
    manifest = _build_manifest(tmp_path, "b_default", ["A0001"])
    runner = _stub_runner(_ok_summary_stdout())  # no collected_review_ids
    run_batch(manifest=manifest, artifact_root=tmp_path, runner_fn=runner)
    # No file matching the sidecar pattern.
    matches = list((tmp_path / "b_default").glob("*_review_ids.json"))
    assert matches == []


def test_run_batch_omits_sidecar_when_review_ids_list_is_empty(tmp_path):
    """A failed run that returned 0 review_ids should not produce an
    empty sidecar — that would pollute the artifact dir with files that
    contribute nothing to the merge step."""
    p = _write_manifest(
        tmp_path, "b_empty",
        [{"name": "n", "oy_goods_no": "A0001"}],
        defaults={"sort_type": "DATETIME_DESC"},
    )
    manifest = load_manifest(p)
    runner = _stub_runner(_ok_summary_with_sort(
        sort_type="DATETIME_DESC", review_ids=[], rows_inserted=0,
    ))
    run_batch(manifest=manifest, artifact_root=tmp_path, runner_fn=runner)
    matches = list((tmp_path / "b_empty").glob("*_review_ids.json"))
    assert matches == []


def test_run_batch_halt_on_anonymous_auth_wall_writes_partial_summary(tmp_path):
    manifest = _build_manifest(tmp_path, "b_halt", ["A1", "A2", "A3"])
    # Stub: A1 = ok, A2 = anonymous_auth_wall, A3 = should never be reached
    call_count = {"n": 0}
    def _runner(argv):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return 0, json.dumps(_ok_summary_stdout()), ""
        else:
            return 0, json.dumps(_ok_summary_stdout(
                quality_status="invalid",
                rows_inserted=0,
                auth_error=True,
                mid_stream_auth_break=True,
                login_state_observed="logged_out",
                partial_debug_artifact_path="/tmp/x.jsonl",
            )), ""
    report = run_batch(
        manifest=manifest, artifact_root=tmp_path, runner_fn=_runner,
    )
    assert report.halted is True
    assert "anonymous_auth_wall" in (report.halt_reason or "")
    # Only 2 products were attempted; A3 was not invoked
    assert len(report.products) == 2
    assert report.products[0].status == "authenticated_ok"
    assert report.products[1].status == "anonymous_auth_wall"
    assert call_count["n"] == 2  # A3 never called
    # Partial report still written
    parsed = json.loads(
        (tmp_path / "b_halt" / "batch_summary.json").read_text(encoding="utf-8"),
    )
    assert parsed["halted"] is True
    assert parsed["product_count_attempted"] == 2


def test_run_batch_halt_on_anti_bot(tmp_path):
    manifest = _build_manifest(tmp_path, "b_403", ["A1"])
    runner = _stub_runner(_ok_summary_stdout(
        quality_status="invalid",
        rows_inserted=0,
        blocked=True,
        http_403_seen=True,
    ))
    report = run_batch(
        manifest=manifest, artifact_root=tmp_path, runner_fn=runner,
    )
    assert report.halted is True
    assert report.products[0].status == "anti_bot"


def test_run_batch_halt_on_auth_expired_mid_batch(tmp_path):
    manifest = _build_manifest(tmp_path, "b_exp", ["A1"])
    runner = _stub_runner(_ok_summary_stdout(
        quality_status="invalid",
        rows_inserted=0,
        auth_error=True,
        mid_stream_auth_break=True,
        login_state_observed="logged_in",  # session was active at probe time
    ))
    report = run_batch(
        manifest=manifest, artifact_root=tmp_path, runner_fn=runner,
    )
    assert report.halted is True
    assert report.products[0].status == "auth_expired_mid_batch"


def test_run_batch_routes_sort_control_unreachable_through_projection(tmp_path):
    """Regression guard for I-OY-RATING-SORTS-IMPL-V2.

    The connector sets `sort_control_unreachable=True` on its summary
    dict when the widened sort-row probe exhausts the deadline. The
    flag is serialized into batch_summary.json correctly (verified live
    on Tocobo run-002 — see ops/agent_handoffs/I-OY-RATING-SORTS-RUNTIME-TRIAGE.md
    §3 for the smoking-gun artifact).

    However, fdd5793 forgot to forward this key from the ingest CLI's
    summary dict into the explicit per-key projection dict that
    `_run_one_product` builds and passes into `classify_status`. So
    even though `classify_status` had a working precedence branch
    (collection_batch.py:180-182) and the unit tests for that branch
    passed, at runtime `summary.get("sort_control_unreachable")`
    returned `None` because the key was absent from the projection.
    Execution then fell through to the `false_empty_state_detected`
    branch and emitted `blocked_or_empty_state` instead.

    This test exercises the full `run_batch` → `_run_one_product` →
    `classify_status` seam: the synthetic stdout JSON carries both
    flags True (mirroring the real Tocobo batch_summary.json shape),
    and the resulting `ProductResult.status` must be
    `sort_control_unreachable`, not `blocked_or_empty_state`. If the
    projection key is dropped again, this assertion fails.

    `sort_control_unreachable` is intentionally NOT in HALT_STATUSES,
    so the batch should keep running.
    """
    manifest = _build_manifest(tmp_path, "b_sort_unreach", ["A1"])
    runner = _stub_runner(_ok_summary_stdout(
        quality_status="invalid",
        rows_inserted=0,
        records_parsed=0,
        # Both flags are True on the connector summary, mirroring the
        # observed live shape for Tocobo A000000179126 RATING_ASC.
        sort_control_unreachable=True,
        false_empty_state_detected=True,
        false_empty_retry_count=2,
        # `blocked=True` is what false-empty exhaustion sets; the new
        # branch must still win because `sort_control_unreachable`
        # short-circuits before the `blocked` / false-empty checks.
        blocked=True,
    ))
    report = run_batch(
        manifest=manifest, artifact_root=tmp_path, runner_fn=runner,
    )
    assert len(report.products) == 1
    p = report.products[0]
    assert p.status == "sort_control_unreachable", (
        f"projection should forward sort_control_unreachable to "
        f"classify_status; got status={p.status!r} instead. This "
        f"means the key was dropped before reaching classify_status."
    )
    # Not a halt status — batch keeps running.
    assert report.halted is False


def test_run_batch_continues_on_parser_error(tmp_path):
    """parser_error is invalid but NOT halt-causing; batch continues."""
    manifest = _build_manifest(tmp_path, "b_parser", ["A1", "A2"])
    call_count = {"n": 0}
    def _runner(argv):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return 0, json.dumps(_ok_summary_stdout(
                quality_status="invalid",
                rows_inserted=0,
                parse_warnings=10,
                records_parsed=0,
            )), ""
        else:
            return 0, json.dumps(_ok_summary_stdout()), ""
    report = run_batch(
        manifest=manifest, artifact_root=tmp_path, runner_fn=_runner,
    )
    assert report.halted is False
    assert len(report.products) == 2
    assert report.products[0].status == "parser_error"
    assert report.products[1].status == "authenticated_ok"


def test_run_batch_jitter_disabled_when_zero(tmp_path):
    """jitter_min=0 and jitter_max=0 → no sleep called."""
    sleep_calls: list[float] = []
    manifest = _build_manifest(tmp_path, "b_nojitter", ["A1", "A2"])
    runner = _stub_runner(_ok_summary_stdout())
    run_batch(
        manifest=manifest, artifact_root=tmp_path, runner_fn=runner,
        jitter_min=0.0, jitter_max=0.0,
        sleep_fn=lambda s: sleep_calls.append(s),
    )
    assert sleep_calls == []


def test_run_batch_jitter_invoked_when_enabled(tmp_path):
    """jitter > 0 → sleep called between products (not before product 1)."""
    import random
    sleep_calls: list[float] = []
    manifest = _build_manifest(tmp_path, "b_jitter", ["A1", "A2", "A3"])
    runner = _stub_runner(_ok_summary_stdout())
    run_batch(
        manifest=manifest, artifact_root=tmp_path, runner_fn=runner,
        jitter_min=10.0, jitter_max=20.0,
        sleep_fn=lambda s: sleep_calls.append(s),
        rng=random.Random(42),
    )
    # Two sleeps for three products (between 1→2 and 2→3)
    assert len(sleep_calls) == 2
    for s in sleep_calls:
        assert 10.0 <= s <= 20.0


def test_run_batch_handles_unparseable_stdout(tmp_path):
    """If the ingest CLI produces non-JSON stdout, we record an error and
    classify as unknown_failure."""
    manifest = _build_manifest(tmp_path, "b_bad", ["A1"])
    def _runner(argv):
        return 0, "not valid json output", "stderr msg"
    report = run_batch(
        manifest=manifest, artifact_root=tmp_path, runner_fn=_runner,
    )
    # Bad stdout still records the product
    assert len(report.products) == 1
    assert report.products[0].status == "unknown_failure"
    assert report.products[0].error is not None


def test_run_batch_handles_subprocess_failure(tmp_path):
    """If the ingest CLI exits non-zero with no parseable stdout, we record
    the failure."""
    manifest = _build_manifest(tmp_path, "b_rc", ["A1"])
    def _runner(argv):
        return 2, "", "ImportError: ..."
    report = run_batch(
        manifest=manifest, artifact_root=tmp_path, runner_fn=_runner,
    )
    assert len(report.products) == 1
    assert report.products[0].status == "unknown_failure"
    assert report.products[0].error is not None


# ---------------------------------------------------------------------------
# Markdown rendering
# ---------------------------------------------------------------------------

def test_render_batch_markdown_includes_per_product_rows(tmp_path):
    manifest = _build_manifest(tmp_path, "b_md", ["A1", "A2"])
    runner = _stub_runner(_ok_summary_stdout(run_id="r1", rows_inserted=200))
    report = run_batch(
        manifest=manifest, artifact_root=tmp_path, runner_fn=runner,
    )
    md = render_batch_markdown(report)
    assert "b_md" in md
    assert "A1" in md
    assert "A2" in md
    assert "authenticated_ok" in md


def test_render_batch_markdown_omits_diagnostic_block_on_clean_runs(tmp_path):
    """Clean runs (authenticated_ok / complete / etc) don't need the
    per-product diagnostic block — keep the markdown concise."""
    manifest = _build_manifest(tmp_path, "b_clean", ["A1"])
    runner = _stub_runner(_ok_summary_stdout(run_id="r_ok", rows_inserted=200))
    report = run_batch(
        manifest=manifest, artifact_root=tmp_path, runner_fn=runner,
    )
    md = render_batch_markdown(report)
    assert "diagnostic:" not in md


def test_render_batch_markdown_emits_diagnostic_block_on_failure(tmp_path):
    """Failed runs surface the diagnostic block so the operator can
    see what the connector observed (or didn't) without opening JSON."""
    manifest = _build_manifest(tmp_path, "b_fail", ["A1"])
    runner = _stub_runner(_ok_summary_stdout(
        run_id="r_fail", rows_inserted=0,
        quality_status="invalid",
        records_parsed=0, raw_records_seen=0,
        cdp_attach_failed=True,
        cdp_attach_error="Error: BrowserType.connect_over_cdp: setDownloadBehavior",
    ))
    report = run_batch(
        manifest=manifest, artifact_root=tmp_path, runner_fn=runner,
    )
    md = render_batch_markdown(report)
    assert "diagnostic:" in md
    assert "cdp_attach_failed: True" in md
    # The verbatim error string round-trips into the markdown block.
    assert "setDownloadBehavior" in md


def test_render_batch_markdown_diagnostic_includes_filter_telemetry(tmp_path):
    """`review_list_api_seen_but_no_rows_kept` must show the filter
    counters so the operator can tell goods-filter drops from
    parser drops."""
    manifest = _build_manifest(tmp_path, "b_filter", ["A1"])
    runner = _stub_runner(_ok_summary_stdout(
        run_id="r_filter", rows_inserted=0,
        quality_status="invalid",
        records_parsed=0, raw_records_seen=10,
        review_api_response_count=2,
        rows_filtered_by_goods_no=10,
        rows_dropped_unparseable=0,
    ))
    report = run_batch(
        manifest=manifest, artifact_root=tmp_path, runner_fn=runner,
    )
    md = render_batch_markdown(report)
    assert "review_list_api_seen_but_no_rows_kept" in md
    assert "rows_filtered_by_goods_no: 10" in md
    assert "review_api_response_count: 2" in md


def test_build_product_result_routes_cdp_error_in_stderr(tmp_path):
    """If the ingest CLI crashed with no stdout JSON BUT the stderr tail
    contains a CDP-attach hint, the batch driver classifies the
    product as `cdp_attach_failed` (not `unknown_failure`)."""
    manifest = _build_manifest(tmp_path, "b_stderr", ["A1"])
    # Runner returns rc=2 with empty stdout and a stderr that quotes
    # the canonical Playwright/Chrome wall message.
    def _f(argv):
        return (
            2, "",
            "Error: BrowserType.connect_over_cdp: Protocol error "
            "(Browser.setDownloadBehavior): Browser context "
            "management is not supported.",
        )
    report = run_batch(
        manifest=manifest, artifact_root=tmp_path, runner_fn=_f,
    )
    assert len(report.products) == 1
    p = report.products[0]
    assert p.status == "cdp_attach_failed"
    assert p.cdp_attach_failed is True
    assert "setDownloadBehavior" in (p.cdp_attach_error or p.error or "")


def test_build_product_result_routes_synthetic_cdp_summary(tmp_path):
    """When the ingest CLI emits its synthetic JSON (the `try/except`
    path around `pipeline.run`), the batch driver must classify
    `cdp_attach_failed` from the structured signal — NOT the
    stderr-hint fallback."""
    synthetic = {
        "run_id": None,
        "quality_status": "invalid",
        "rows_inserted": 0,
        "rows_skipped_by_normalize": 0,
        "summary": {
            "run_id": None,
            "channel": "oliveyoung",
            "raw_records_seen": 0,
            "records_parsed": 0,
            "parse_warnings": 0,
            "blocked": False,
            "auth_error": False,
            "cdp_attach_failed": True,
            "cdp_attach_error": "Error: connect_over_cdp: setDownloadBehavior",
            "page_open_failed": False,
            "page_open_error": None,
            "sample_dropped_reasons": [
                "Error: connect_over_cdp: setDownloadBehavior",
            ],
        },
        "early_failure_kind": "cdp_attach_failed",
    }
    manifest = _build_manifest(tmp_path, "b_synth", ["A1"])
    def _f(argv):
        return 2, json.dumps(synthetic), ""
    report = run_batch(
        manifest=manifest, artifact_root=tmp_path, runner_fn=_f,
    )
    p = report.products[0]
    assert p.status == "cdp_attach_failed"
    assert p.cdp_attach_failed is True
    assert "setDownloadBehavior" in (p.cdp_attach_error or "")


# ---------------------------------------------------------------------------
# auth_header_present inference from trace artifact
# ---------------------------------------------------------------------------

def test_infer_auth_header_present_all_true(tmp_path):
    p = tmp_path / "trace.jsonl"
    p.write_text("\n".join([
        json.dumps({"request": {"auth_header_present": True}}),
        json.dumps({"request": {"auth_header_present": True}}),
    ]) + "\n", encoding="utf-8")
    assert _infer_auth_header_present(str(p)) is True


def test_infer_auth_header_present_mixed(tmp_path):
    p = tmp_path / "trace.jsonl"
    p.write_text("\n".join([
        json.dumps({"request": {"auth_header_present": True}}),
        json.dumps({"request": {"auth_header_present": False}}),
    ]) + "\n", encoding="utf-8")
    assert _infer_auth_header_present(str(p)) is False


def test_infer_auth_header_present_returns_none_when_missing():
    assert _infer_auth_header_present(None) is None
    assert _infer_auth_header_present("/nonexistent/path.jsonl") is None


def test_infer_auth_header_present_returns_none_when_empty(tmp_path):
    p = tmp_path / "trace.jsonl"
    p.write_text("", encoding="utf-8")
    assert _infer_auth_header_present(str(p)) is None


# ---------------------------------------------------------------------------
# CLI argparse
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def cli_module():
    """Load the CLI script as a module so we can call _parse_args directly."""
    spec = importlib.util.spec_from_file_location(
        "run_oy_collection_batch_under_test", CLI_PATH,
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_cli_parse_minimal(cli_module):
    args = cli_module._parse_args(["--manifest", "/tmp/x.json"])
    assert str(args.manifest) == "/tmp/x.json"
    assert args.jitter_min == 0.0
    assert args.jitter_max == 0.0


def test_cli_parse_jitter(cli_module):
    args = cli_module._parse_args([
        "--manifest", "/tmp/x.json", "--jitter-min", "15", "--jitter-max", "45",
    ])
    assert args.jitter_min == 15.0
    assert args.jitter_max == 45.0


def test_cli_help_includes_key_flags(cli_module, capsys):
    with pytest.raises(SystemExit):
        cli_module._parse_args(["--help"])
    captured = capsys.readouterr()
    text = captured.out + captured.err
    assert "--manifest" in text
    assert "--jitter-min" in text
    assert "--jitter-max" in text
    assert "--artifact-root" in text


def test_cli_main_errors_on_missing_manifest(cli_module, capsys):
    rc = cli_module.main(["--manifest", "/no/such/file.json"])
    assert rc == 2
    captured = capsys.readouterr()
    assert "manifest not found" in captured.err.lower()


def test_cli_main_errors_on_bad_jitter_args(cli_module, capsys, tmp_path):
    p = tmp_path / "m.json"
    p.write_text(json.dumps({"batch_id": "x", "products": [
        {"name": "n", "oy_goods_no": "A"},
    ]}), encoding="utf-8")
    rc = cli_module.main([
        "--manifest", str(p), "--jitter-min", "20", "--jitter-max", "10",
    ])
    assert rc == 2


def test_cli_main_writes_summary_on_success(cli_module, tmp_path, monkeypatch):
    """End-to-end: CLI parses manifest, runs batch with monkeypatched runner,
    writes artifacts, returns 0."""
    p = tmp_path / "m.json"
    p.write_text(json.dumps({
        "batch_id": "smoke",
        "products": [{"name": "n", "oy_goods_no": "A1"}],
    }), encoding="utf-8")

    # Monkeypatch the subprocess runner inside collection_batch
    from src.voc.app import collection_batch as cb
    monkeypatch.setattr(cb, "_default_subprocess_runner",
                        lambda argv: (0, json.dumps(_ok_summary_stdout()), ""))

    artifact_root = tmp_path / "arts"
    rc = cli_module.main([
        "--manifest", str(p),
        "--artifact-root", str(artifact_root),
    ])
    assert rc == 0
    assert (artifact_root / "smoke" / "batch_summary.json").exists()
    assert (artifact_root / "smoke" / "batch_summary.md").exists()


# ===========================================================================
# I-OY-RESUME-STATE-OPERATOR-SURFACE (step I-C of multi-session resume policy)
# ===========================================================================
#
# These tests cover the new `ProductResult.resume_state` field, the pure
# `_derive_resume_state` helper, the `_format_resume_line` formatter, the
# CLI's per-product resume print, and the Markdown surface. They do not
# touch the I-B classifier (`derive_retry_intent` on ConnectorRunSummary)
# — the summary dicts used here carry `retry_intent` directly, as the
# I-B method would already have written it before the batch driver
# reads the summary back.
#
# Hard-stop posture: no test reaches into `classify_status` or
# `HALT_STATUSES`; both remain byte-identical, per the ticket's "no
# change to the status decision tree" invariant.

def _rate_limited_summary(
    *,
    retry_intent: str = "retry_after_cooldown",
    retry_after_minutes: int | None = 90,
    raw_records_seen: int = 610,
    cursor_rate_limit_exhausted: bool = True,
) -> dict:
    """Build a synthetic connector summary dict carrying I-B's classifier
    output. Mirrors the shape `ConnectorRunSummary.derive_retry_intent`
    would have written before `_build_product_result` reads the
    summary back."""
    base = _ok_summary_stdout(rows_inserted=0)["summary"]
    base["raw_records_seen"] = raw_records_seen
    base["records_parsed"] = raw_records_seen
    base["retry_intent"] = retry_intent
    base["retry_after_minutes"] = retry_after_minutes
    base["cursor_rate_limit_exhausted"] = cursor_rate_limit_exhausted
    base["cursor_api_rate_limited"] = bool(cursor_rate_limit_exhausted)
    return base


def test_derive_resume_state_returns_none_for_retry_intent_none():
    """Clean exits (retry_intent="none") must not emit a resume hint —
    None is the canonical signal for "no operator action needed"."""
    summary = {"retry_intent": "none", "raw_records_seen": 200}
    assert _derive_resume_state(summary, "2026-05-13T00:00:00") is None


def test_derive_resume_state_returns_none_for_missing_retry_intent():
    """Legacy pre-I-B summaries (no retry_intent key) deserialize to
    None just like clean exits — keeps the operator surface stable
    across the I-A → I-B → I-C rollout."""
    summary = {"raw_records_seen": 200}
    assert _derive_resume_state(summary, "2026-05-13T00:00:00") is None


def test_derive_resume_state_returns_none_for_unknown_retry_intent():
    """Forward-compat: an unknown retry_intent string maps to None
    rather than silently inventing a reason. A future ticket that
    adds a new I-B branch must also teach the C surface about it."""
    summary = {"retry_intent": "wait_for_next_business_day"}
    assert _derive_resume_state(summary, "2026-05-13T00:00:00") is None


def test_derive_resume_state_rate_limited_carries_documented_keys():
    """Rule 1 shape — cursor 429 path. All documented keys are populated."""
    summary = _rate_limited_summary(
        retry_intent="retry_after_cooldown",
        retry_after_minutes=90,
        raw_records_seen=610,
        cursor_rate_limit_exhausted=True,
    )
    rs = _derive_resume_state(summary, "2026-05-13T20:26:12")
    assert rs is not None
    assert rs["retryable"] is True
    assert rs["reason"] == "cursor_api_rate_limited"
    assert rs["exhausted"] is True
    assert rs["stopped_at_records_seen"] == 610
    assert rs["retry_after_minutes"] == 90
    assert rs["last_seen_at"] == "2026-05-13T20:26:12"
    assert rs["retry_intent"] == "retry_after_cooldown"


def test_derive_resume_state_manual_review_required_carries_none_retry_after():
    """Rule 2 shape — auth-wall path. `retry_after_minutes` is carried
    AS None (not omitted) so consumers can always read the same key
    set. `exhausted` defaults to False on this path (no cursor 429
    counter)."""
    summary = {
        "retry_intent": "manual_review_required",
        "retry_after_minutes": None,
        "raw_records_seen": 12,
        "cursor_rate_limit_exhausted": False,
    }
    rs = _derive_resume_state(summary, "2026-05-13T20:26:12")
    assert rs is not None
    assert rs["reason"] == "auth_wall"
    assert rs["retry_after_minutes"] is None
    assert "retry_after_minutes" in rs  # carried, not omitted
    assert rs["exhausted"] is False
    assert rs["stopped_at_records_seen"] == 12
    assert rs["retry_intent"] == "manual_review_required"


def test_derive_resume_state_non_dict_input_returns_none():
    """Defensive: a non-dict summary (None, list, etc.) returns None
    rather than crashing the batch driver."""
    assert _derive_resume_state(None, "2026-05-13T00:00:00") is None  # type: ignore[arg-type]
    assert _derive_resume_state([], "2026-05-13T00:00:00") is None  # type: ignore[arg-type]


def test_format_resume_line_rate_limited_shape():
    """The cursor-429 stdout shape matches the spec's example
    verbatim — operators grep for this exact prefix."""
    rs = {
        "reason": "cursor_api_rate_limited",
        "stopped_at_records_seen": 610,
        "retry_after_minutes": 90,
        "retry_intent": "retry_after_cooldown",
    }
    line = _format_resume_line(rs)
    assert line == (
        "resume: cursor_api_rate_limited · stopped_at=610 · "
        "retry_after=90min  (retry_intent=retry_after_cooldown)"
    )


def test_format_resume_line_manual_review_uses_manual_token():
    """The auth-wall path renders `retry_after=manual` rather than a
    minute count (since retry_after_minutes is None)."""
    rs = {
        "reason": "auth_wall",
        "stopped_at_records_seen": 12,
        "retry_after_minutes": None,
        "retry_intent": "manual_review_required",
    }
    line = _format_resume_line(rs)
    assert line == (
        "resume: auth_wall · stopped_at=12 · "
        "retry_after=manual  (retry_intent=manual_review_required)"
    )


def test_resume_state_present_only_for_rate_limited_runs(tmp_path):
    """End-to-end through `_build_product_result`: when the connector
    summary carries `retry_intent="retry_after_cooldown"`, the
    constructed ProductResult.resume_state is a dict with the
    documented keys."""
    spec = ProductSpec(name="Ilso", oy_goods_no="A000000225736")
    stdout_json = {
        "run_id": "r_rl",
        "quality_status": "invalid",
        "rows_inserted": 0,
        "rows_skipped_by_normalize": 0,
        "summary": _rate_limited_summary(),
    }
    result = _build_product_result(
        spec=spec,
        started_at="2026-05-13T18:00:00",
        finished_at="2026-05-13T18:26:12",
        stdout_json=stdout_json,
        error=None,
    )
    assert result.resume_state is not None
    assert result.resume_state["reason"] == "cursor_api_rate_limited"
    assert result.resume_state["stopped_at_records_seen"] == 610
    assert result.resume_state["retry_after_minutes"] == 90
    assert result.resume_state["last_seen_at"] == "2026-05-13T18:26:12"


def test_resume_state_absent_for_clean_runs(tmp_path):
    """`retry_intent="none"` (the I-A / I-B default for clean exits)
    yields `resume_state is None`. Tests the regression guard that
    successful runs do not accidentally surface a resume hint."""
    spec = ProductSpec(name="OK product", oy_goods_no="A0001")
    # A canonical clean summary explicitly carries retry_intent="none"
    # (the I-B classifier writes this at the end of collect()).
    clean = _ok_summary_stdout(rows_inserted=200)
    clean["summary"]["retry_intent"] = "none"
    clean["summary"]["retry_after_minutes"] = None
    result = _build_product_result(
        spec=spec,
        started_at="2026-05-13T18:00:00",
        finished_at="2026-05-13T18:10:00",
        stdout_json=clean,
        error=None,
    )
    assert result.resume_state is None


def test_resume_state_carries_stopped_at_records_seen():
    """`raw_records_seen` flows verbatim into
    `resume_state["stopped_at_records_seen"]` — this is the field the
    operator diffs across passes to confirm coverage is extending."""
    spec = ProductSpec(name="Ilso", oy_goods_no="A000000225736")
    stdout_json = {
        "run_id": "r_rl",
        "quality_status": "invalid",
        "rows_inserted": 0,
        "rows_skipped_by_normalize": 0,
        "summary": _rate_limited_summary(raw_records_seen=540),
    }
    result = _build_product_result(
        spec=spec,
        started_at="2026-05-13T20:18:25",
        finished_at="2026-05-13T20:26:12",
        stdout_json=stdout_json,
        error=None,
    )
    assert result.resume_state is not None
    assert result.resume_state["stopped_at_records_seen"] == 540


def test_resume_state_manual_review_required_omits_retry_after_minutes():
    """Spec-decision: for `retry_intent="manual_review_required"` the
    resume_state carries `retry_after_minutes: None` (not omitted).
    Consumers can always read the key; the value being None is the
    signal to render `retry_after=manual` in the operator surface."""
    spec = ProductSpec(name="AuthWall", oy_goods_no="A0002")
    summary = {
        **_ok_summary_stdout(rows_inserted=0)["summary"],
        "retry_intent": "manual_review_required",
        "retry_after_minutes": None,
        "raw_records_seen": 12,
        "auth_error": True,
        "quality_status": "invalid",
        "login_state_observed": "logged_out",
    }
    stdout_json = {
        "run_id": "r_auth",
        "quality_status": "invalid",
        "rows_inserted": 0,
        "rows_skipped_by_normalize": 0,
        "summary": summary,
    }
    result = _build_product_result(
        spec=spec,
        started_at="2026-05-13T00:00:00",
        finished_at="2026-05-13T00:01:00",
        stdout_json=stdout_json,
        error=None,
    )
    assert result.resume_state is not None
    assert "retry_after_minutes" in result.resume_state
    assert result.resume_state["retry_after_minutes"] is None
    assert result.resume_state["reason"] == "auth_wall"


def test_run_oy_collection_batch_main_prints_resume_line_on_rate_limited_run(
    cli_module, tmp_path, monkeypatch, capsys,
):
    """The CLI's `main()` prints a `resume:` line under the per-product
    status header for any product whose resume_state is populated."""
    p = tmp_path / "m.json"
    p.write_text(json.dumps({
        "batch_id": "rl_smoke",
        "products": [{"name": "Ilso", "oy_goods_no": "A000000225736"}],
    }), encoding="utf-8")

    # Monkeypatch the runner inside collection_batch to emit a synthetic
    # rate-limited summary. This bypasses the real subprocess + connector
    # entirely; the test exercises only the assembly + print path.
    from src.voc.app import collection_batch as cb
    rl_stdout = {
        "run_id": "r_rl",
        "quality_status": "invalid",
        "rows_inserted": 0,
        "rows_skipped_by_normalize": 0,
        "summary": _rate_limited_summary(),
    }
    monkeypatch.setattr(
        cb, "_default_subprocess_runner",
        lambda argv: (0, json.dumps(rl_stdout), ""),
    )

    artifact_root = tmp_path / "arts"
    cli_module.main([
        "--manifest", str(p),
        "--artifact-root", str(artifact_root),
    ])
    captured = capsys.readouterr()
    # The per-product status header must come BEFORE the resume hint.
    status_idx = captured.out.find("product A000000225736")
    resume_idx = captured.out.find("resume: cursor_api_rate_limited")
    assert status_idx >= 0, captured.out
    assert resume_idx > status_idx, captured.out
    assert "stopped_at=610" in captured.out
    assert "retry_after=90min" in captured.out
    assert "retry_intent=retry_after_cooldown" in captured.out


def test_run_oy_collection_batch_main_omits_resume_line_on_clean_run(
    cli_module, tmp_path, monkeypatch, capsys,
):
    """Clean runs (resume_state is None) do NOT print a `resume:` line —
    operators reading the live stdout should not be misled into
    thinking a successful run needs a retry."""
    p = tmp_path / "m.json"
    p.write_text(json.dumps({
        "batch_id": "clean_smoke",
        "products": [{"name": "OK product", "oy_goods_no": "A0001"}],
    }), encoding="utf-8")

    from src.voc.app import collection_batch as cb
    clean_stdout = _ok_summary_stdout(rows_inserted=200)
    clean_stdout["summary"]["retry_intent"] = "none"
    clean_stdout["summary"]["retry_after_minutes"] = None
    monkeypatch.setattr(
        cb, "_default_subprocess_runner",
        lambda argv: (0, json.dumps(clean_stdout), ""),
    )

    artifact_root = tmp_path / "arts"
    cli_module.main([
        "--manifest", str(p),
        "--artifact-root", str(artifact_root),
    ])
    captured = capsys.readouterr()
    assert "product A0001" in captured.out  # status header still prints
    assert "resume:" not in captured.out


def test_render_batch_markdown_includes_resume_line_for_rate_limited(tmp_path):
    """The Markdown rendering mirrors the stdout resume line so an
    operator reading the persisted report sees the same hint that
    the live CLI printed."""
    manifest = _build_manifest(tmp_path, "b_rl_md", ["A000000225736"])
    rl_stdout = {
        "run_id": "r_rl",
        "quality_status": "invalid",
        "rows_inserted": 0,
        "rows_skipped_by_normalize": 0,
        "summary": _rate_limited_summary(),
    }
    runner = _stub_runner(rl_stdout)
    report = run_batch(
        manifest=manifest, artifact_root=tmp_path, runner_fn=runner,
    )
    md = render_batch_markdown(report)
    assert "resume: cursor_api_rate_limited" in md
    assert "stopped_at=610" in md
    assert "retry_after=90min" in md


def test_render_batch_markdown_omits_resume_line_on_clean_runs(tmp_path):
    """The clean-exit Markdown does NOT include a resume bullet — the
    per-product block stays as concise as it was pre-I-C for
    successful runs."""
    manifest = _build_manifest(tmp_path, "b_ok_md", ["A0001"])
    clean = _ok_summary_stdout(rows_inserted=200)
    clean["summary"]["retry_intent"] = "none"
    clean["summary"]["retry_after_minutes"] = None
    runner = _stub_runner(clean)
    report = run_batch(
        manifest=manifest, artifact_root=tmp_path, runner_fn=runner,
    )
    md = render_batch_markdown(report)
    assert "resume:" not in md


def test_product_result_default_resume_state_is_none():
    """Regression guard: a default-constructed ProductResult (used by
    tests that bypass `_build_product_result`) has resume_state=None.
    Mirrors the I-A invariant that additive operator-facing fields
    must not change the default shape."""
    r = ProductResult(
        name="x", oy_goods_no="A0", started_at="2026-05-13T00:00:00",
    )
    assert r.resume_state is None


# ===========================================================================
# I-OY-RESUME-STATE-BATCH-SUMMARY-SURFACE (I-C continuation)
# ===========================================================================
#
# These tests exercise the operator-required keys (goods_no, sort_type,
# final_status, quality_status, cursor_api_rate_limited, rows_inserted,
# raw_records_seen, records_parsed, operator_hint) that the batch summary
# JSON must surface so an operator can read retry/resume state from
# batch_summary.json without grepping per-product summaries.
#
# Empty-when-clean convention chosen: `resume_state is None` for clean
# runs (preserves the pre-batch I-C convention asserted by
# `test_resume_state_absent_for_clean_runs`). Documented in handoff §2.


def _real_summary_dict(**overrides) -> dict:
    """Build a real `ConnectorRunSummary`, run the I-B classifier so
    `retry_intent`/`retry_after_minutes` are derived from rate-limit /
    auth-wall flags exactly as the connector would, then return the
    `.model_dump()` view that the batch driver consumes. No mocks; the
    pydantic class is instantiated directly per ticket constraint."""
    base = dict(
        run_id="r_real",
        channel="oliveyoung",
        requested_target="A_test",
        started_at="2026-05-13T18:00:00",
        finished_at="2026-05-13T18:26:12",
        raw_records_seen=200,
        records_parsed=200,
    )
    base.update(overrides)
    s = ConnectorRunSummary(**base)
    s.derive_retry_intent()
    return s.model_dump(mode="json")


def test_batch_summary_resume_state_present_for_retry_after_cooldown(tmp_path):
    """Cursor-429 path: the per-product entry in batch_summary carries a
    resume_state block whose `retry_intent`, `retry_after_minutes`,
    `cursor_api_rate_limited`, and `operator_hint` reflect the I-B
    classifier output and surface a retryable hint to the operator."""
    spec = ProductSpec(name="Ilso", oy_goods_no="A000000225736")
    rl_summary = _real_summary_dict(
        cursor_api_rate_limited=True,
        cursor_rate_limit_exhausted=True,
        raw_records_seen=610,
        records_parsed=610,
    )
    # Verify the I-B classifier wrote what we expect before feeding it
    # into the batch driver (guards against silent contract drift).
    assert rl_summary["retry_intent"] == "retry_after_cooldown"
    assert rl_summary["retry_after_minutes"] == 90

    stdout_json = {
        "run_id": "r_rl",
        "quality_status": "invalid",
        "rows_inserted": 0,
        "rows_skipped_by_normalize": 0,
        "summary": rl_summary,
    }
    result = _build_product_result(
        spec=spec,
        started_at="2026-05-13T18:00:00",
        finished_at="2026-05-13T18:26:12",
        stdout_json=stdout_json,
        error=None,
    )
    rs = result.resume_state
    assert rs is not None
    assert rs["retry_intent"] == "retry_after_cooldown"
    assert rs["retry_after_minutes"] == 90
    assert rs["cursor_api_rate_limited"] is True
    hint = rs["operator_hint"]
    assert "90" in hint
    assert "retryable" in hint.lower()


def test_batch_summary_resume_state_present_for_manual_review_required(
    tmp_path,
):
    """Auth-wall path: the per-product entry carries a resume_state
    whose `retry_intent="manual_review_required"`, `retry_after_minutes`
    is None, and `operator_hint` cleanly signals manual intervention."""
    spec = ProductSpec(name="AuthWall", oy_goods_no="A0auth")
    auth_summary = _real_summary_dict(
        auth_error=True,
        login_state_observed="logged_out",
        raw_records_seen=12,
        records_parsed=12,
    )
    assert auth_summary["retry_intent"] == "manual_review_required"
    assert auth_summary["retry_after_minutes"] is None

    stdout_json = {
        "run_id": "r_auth",
        "quality_status": "invalid",
        "rows_inserted": 0,
        "rows_skipped_by_normalize": 0,
        "summary": auth_summary,
    }
    result = _build_product_result(
        spec=spec,
        started_at="2026-05-13T00:00:00",
        finished_at="2026-05-13T00:01:00",
        stdout_json=stdout_json,
        error=None,
    )
    rs = result.resume_state
    assert rs is not None
    assert rs["retry_intent"] == "manual_review_required"
    assert rs["retry_after_minutes"] is None
    assert "manual" in rs["operator_hint"].lower()


def test_batch_summary_resume_state_none_intent_on_clean_run(tmp_path):
    """Clean exits (`retry_intent="none"`) map to `resume_state is None`
    per the empty-when-clean convention (documented in handoff §2).
    The full per-product entry is still emitted into batch_summary;
    only the resume_state slot is null."""
    spec = ProductSpec(name="OK", oy_goods_no="A_ok")
    clean_summary = _real_summary_dict()  # no rate-limit / auth flags
    # Sanity-check the I-B classifier's clean-exit output before
    # feeding it to the batch driver.
    assert clean_summary["retry_intent"] == "none"
    assert clean_summary["retry_after_minutes"] is None

    stdout_json = {
        "run_id": "r_ok",
        "quality_status": "ok",
        "rows_inserted": 200,
        "rows_skipped_by_normalize": 0,
        "summary": clean_summary,
    }
    result = _build_product_result(
        spec=spec,
        started_at="2026-05-13T00:00:00",
        finished_at="2026-05-13T00:10:00",
        stdout_json=stdout_json,
        error=None,
    )
    # Empty-when-clean: None (not a populated dict with retry_intent=none).
    assert result.resume_state is None


def test_batch_summary_preserves_existing_fields_after_resume_state_addition(
    tmp_path,
):
    """Additive-only invariant: the rate-limit and clean entries both
    still carry the pre-batch ProductResult fields (`oy_goods_no`,
    `status`, `quality_status`, `rows_inserted`, `records_parsed`)
    unchanged. Picks `oy_goods_no` as the representative anchor — it
    is the field operators sort by, and a silent rename would break
    every downstream consumer."""
    spec = ProductSpec(name="Ilso", oy_goods_no="A000000225736")
    # Rate-limited
    rl_summary = _real_summary_dict(
        cursor_api_rate_limited=True,
        cursor_rate_limit_exhausted=True,
        raw_records_seen=610,
        records_parsed=610,
    )
    rl_result = _build_product_result(
        spec=spec,
        started_at="2026-05-13T18:00:00",
        finished_at="2026-05-13T18:26:12",
        stdout_json={
            "run_id": "r_rl",
            "quality_status": "invalid",
            "rows_inserted": 0,
            "rows_skipped_by_normalize": 0,
            "summary": rl_summary,
        },
        error=None,
    )
    # Pre-existing ProductResult field stays intact.
    assert rl_result.oy_goods_no == "A000000225736"
    assert rl_result.records_parsed == 610
    # And the new resume_state block lives alongside, not on top of, it.
    assert rl_result.resume_state is not None

    # Clean
    clean_result = _build_product_result(
        spec=spec,
        started_at="2026-05-13T00:00:00",
        finished_at="2026-05-13T00:10:00",
        stdout_json=_ok_summary_stdout(rows_inserted=200),
        error=None,
    )
    assert clean_result.oy_goods_no == "A000000225736"
    assert clean_result.rows_inserted == 200
    # Resume_state is None on clean entries (empty-when-clean).
    assert clean_result.resume_state is None


# ---------------------------------------------------------------------------
# I-OY-CURSOR-API-SILENCED-RETRY-INTENT — resume_state operator_hint
# discriminator tests
# ---------------------------------------------------------------------------
# The I-C `_derive_resume_state` builder branches the `operator_hint`
# string on whether the cooldown is driven by a cursor 429 or by a
# silenced cold-start. Both shapes carry `retry_intent="retry_after_cooldown"`
# but a discriminator is needed so operators can tell which shape they
# hit (the silenced shape requires no special action — the next run
# usually succeeds — while the 429 shape may need session pacing).
#
# Precedence (when both flags happen to be True): rate-limited wins.
# `derive_retry_intent` only stamps `cursor_api_silenced=True` when
# `cursor_api_rate_limited` is False, but the resume builder enforces
# precedence defensively so a future change to the AND-gate cannot
# flip the surface to the wrong message.


def _silenced_summary_dict(**overrides) -> dict:
    """Build a synthetic connector-summary dict for the silenced
    cold-start shape. Matches what `derive_retry_intent` would have
    written before `_build_product_result` reads it back."""
    base = _ok_summary_stdout(rows_inserted=0)["summary"]
    base["raw_records_seen"] = 0
    base["records_parsed"] = 0
    base["cold_start_timed_out"] = True
    base["review_more_button_clicked"] = True
    base["sort_control_unreachable"] = False
    base["review_api_request_count"] = 0
    base["review_api_response_count"] = 0
    base["cursor_api_rate_limited"] = False
    base["cursor_api_silenced"] = True
    base["retry_intent"] = "retry_after_cooldown"
    base["retry_after_minutes"] = 90
    base.update(overrides)
    return base


def test_resume_state_carries_silenced_operator_hint():
    """`cursor_api_silenced=True`-only summary → operator_hint contains
    the silenced-specific substring AND the cooldown phrasing. The
    `cursor_api_silenced` field is mirrored into the resume_state for
    direct read."""
    summary = _silenced_summary_dict()
    rs = _derive_resume_state(summary, "2026-05-13T20:26:12")
    assert rs is not None
    assert rs["retry_intent"] == "retry_after_cooldown"
    assert rs["retry_after_minutes"] == 90
    assert rs["cursor_api_silenced"] is True
    assert rs["cursor_api_rate_limited"] is False
    hint = rs["operator_hint"]
    assert "silent" in hint.lower()
    assert "cooldown" in hint.lower()
    assert "90" in hint  # the cadence number is part of the operator-facing string


def test_resume_state_rate_limited_hint_wins_over_silenced():
    """Both `cursor_api_rate_limited=True` AND `cursor_api_silenced=True`
    on the same summary dict → hint resolves to the rate-limited shape,
    NOT the silenced shape. Defensive precedence in the resume builder
    so an out-of-band caller cannot stamp both flags and silently get
    the silenced hint."""
    summary = _silenced_summary_dict(cursor_api_rate_limited=True)
    rs = _derive_resume_state(summary, "2026-05-13T20:26:12")
    assert rs is not None
    hint = rs["operator_hint"]
    assert "silent" not in hint.lower()
    # Pre-existing rate-limited shape — exact prefix the operator greps.
    assert hint == "retryable: re-run after 90 min cooldown"


def test_resume_state_silenced_shape_keys_are_stable():
    """Silenced runs carry the same key set as rate-limited runs so
    downstream consumers can read a uniform shape. `cursor_api_silenced`
    is the only NEW key in the resume_state dict for this ticket."""
    rs = _derive_resume_state(
        _silenced_summary_dict(), "2026-05-13T20:26:12",
    )
    assert rs is not None
    for key in (
        "retryable", "reason", "exhausted", "stopped_at_records_seen",
        "retry_after_minutes", "last_seen_at", "retry_intent",
        "cursor_api_rate_limited", "cursor_api_silenced",
        "raw_records_seen", "records_parsed", "quality_status",
        "sort_type", "operator_hint",
    ):
        assert key in rs, f"missing key: {key}"


def test_resume_state_silenced_via_build_product_result():
    """End-to-end: a silenced summary fed through `_build_product_result`
    yields a ProductResult whose `resume_state.operator_hint` is the
    silenced-specific string. Mirrors the production code path from
    ingest CLI stdout → batch driver."""
    spec = ProductSpec(name="Ilso", oy_goods_no="A000000225736")
    stdout_json = {
        "run_id": "r_silenced",
        "quality_status": "invalid",
        "rows_inserted": 0,
        "rows_skipped_by_normalize": 0,
        "summary": _silenced_summary_dict(),
    }
    result = _build_product_result(
        spec=spec,
        started_at="2026-05-13T18:00:00",
        finished_at="2026-05-13T18:26:12",
        stdout_json=stdout_json,
        error=None,
    )
    assert result.resume_state is not None
    assert result.resume_state["retry_intent"] == "retry_after_cooldown"
    assert result.resume_state["retry_after_minutes"] == 90
    assert result.resume_state["cursor_api_silenced"] is True
    assert "silent" in result.resume_state["operator_hint"].lower()
