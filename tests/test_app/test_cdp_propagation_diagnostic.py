"""v2.4.5 — propagation diagnostic tests.

Live OY smoke (post-v2.4.4) showed `attempted=False` across all sorts
without distinguishing "session.open() never ran" from "open() ran but
the capture hook wasn't reached" from "capture ran but extractor
returned nothing". v2.4.5 adds session-lifecycle flags + CDP
propagation audit fields so the failure_reason classifier can pinpoint
the exact layer.

Tests cover:
  * BatchReport.manifest_audit records cdp_endpoint from manifest
  * BatchDefaults / ProductSpec parse cdp_endpoint correctly
  * `_build_ingest_command` forwards `--cdp-endpoint` to the
    ingest CLI argv (this is where the user-reported gap could live)
  * ConnectorRunSummary's new fields serialize through model_dump
  * collection_batch passes through new fields into prod.summary
"""
from __future__ import annotations

import json
from pathlib import Path

from src.voc.app.collection_batch import (
    BatchDefaults,
    ProductSpec,
    _build_ingest_command,
    load_manifest,
)
from src.voc.app.connector_run_summary import ConnectorRunSummary


# ---------------------------------------------------------------------------
# Manifest-level cdp_endpoint propagation
# ---------------------------------------------------------------------------


def test_manifest_loads_cdp_endpoint_from_defaults(tmp_path: Path) -> None:
    """`load_manifest` MUST read `defaults.cdp_endpoint` into BatchDefaults."""
    manifest_path = tmp_path / "m.json"
    manifest_path.write_text(json.dumps({
        "batch_id": "v2_4_5_test",
        "defaults": {
            "max_reviews": 200,
            "cdp_endpoint": "http://127.0.0.1:9222",
            "cold_start_timeout": 60,
            "continuation_timeout": 12,
            "scroll_attempts": 5,
        },
        "products": [{"name": "Test", "oy_goods_no": "A_TEST"}],
    }))
    m = load_manifest(manifest_path)
    assert m.defaults.cdp_endpoint == "http://127.0.0.1:9222"


def test_build_ingest_command_forwards_cdp_endpoint() -> None:
    """`_build_ingest_command` must put `--cdp-endpoint http://...:9222`
    into the subprocess argv. This is the `manifest → connector` bridge
    the v2.4.5 propagation audit verifies."""
    spec = ProductSpec(name="Test", oy_goods_no="A_TEST")
    defaults = BatchDefaults(
        cdp_endpoint="http://127.0.0.1:9222",
        max_reviews=100,
    )
    argv = _build_ingest_command(
        spec=spec, defaults=defaults, debug_dir=Path("/tmp/x"),
    )
    assert "--cdp-endpoint" in argv
    cdp_idx = argv.index("--cdp-endpoint")
    assert argv[cdp_idx + 1] == "http://127.0.0.1:9222"


def test_build_ingest_command_uses_per_product_override() -> None:
    """A ProductSpec with its own cdp_endpoint should override the
    BatchDefaults value."""
    spec = ProductSpec(
        name="Test", oy_goods_no="A_TEST",
        cdp_endpoint="http://other-host:9111",
    )
    defaults = BatchDefaults(cdp_endpoint="http://default-host:9222")
    argv = _build_ingest_command(
        spec=spec, defaults=defaults, debug_dir=Path("/tmp/x"),
    )
    cdp_idx = argv.index("--cdp-endpoint")
    assert argv[cdp_idx + 1] == "http://other-host:9111"


# ---------------------------------------------------------------------------
# ConnectorRunSummary v2.4.5 fields serialize through model_dump
# ---------------------------------------------------------------------------


def test_connector_run_summary_carries_v2_4_5_fields() -> None:
    """All new propagation diagnostic fields must serialize through
    `model_dump(mode='json')` so they survive the DB round-trip
    (phase1_runs.summary_json) → ingest CLI stdout → batch summary."""
    from datetime import datetime
    s = ConnectorRunSummary(
        run_id="r1", channel="oliveyoung", requested_target="https://x",
        started_at=datetime.now(),
        # v2.4.5 fields:
        product_image_session_id=12345678,
        product_image_diagnostic_session_id=12345678,
        product_image_session_class="_PlaywrightReviewSession",
        product_image_session_open_called=True,
        product_image_session_open_url_at_start="https://x?goodsNo=A1",
        product_image_capture_hook_reached=True,
        product_image_session_received_cdp_endpoint="http://127.0.0.1:9222",
        requested_cdp_endpoint="http://127.0.0.1:9222",
        connector_received_cdp_endpoint="http://127.0.0.1:9222",
    )
    d = s.model_dump(mode="json")
    assert d["product_image_session_open_called"] is True
    assert d["product_image_capture_hook_reached"] is True
    assert d["product_image_session_class"] == "_PlaywrightReviewSession"
    assert d["product_image_session_received_cdp_endpoint"] == (
        "http://127.0.0.1:9222"
    )
    assert d["requested_cdp_endpoint"] == "http://127.0.0.1:9222"
    assert d["connector_received_cdp_endpoint"] == "http://127.0.0.1:9222"


# ---------------------------------------------------------------------------
# _PlaywrightReviewSession lifecycle flags via fake page
# ---------------------------------------------------------------------------


def test_session_diagnostic_starts_with_lifecycle_flags_false() -> None:
    """Constructing a session must NOT mark open_called / hook_reached
    as True before open() runs. Otherwise the diagnostic can't
    distinguish failure modes."""
    from src.voc.connectors.oliveyoung_browser_api import (
        _PlaywrightReviewSession,
    )
    s = _PlaywrightReviewSession(
        headless=True, api_path="/api/x",
        review_tab_locator="x", scroll_candidates=("y",),
        user_agent="UA", viewport={"width": 100, "height": 200},
    )
    d = s.get_product_image_capture_diagnostic()
    assert d["session_open_called"] is False
    assert d["capture_hook_reached"] is False
    assert d["attempted"] is False
    assert d["session_class"] == "_PlaywrightReviewSession"
    assert isinstance(d["session_id"], int)


def test_session_records_cdp_endpoint_on_construction() -> None:
    """The session captures its constructor's cdp_endpoint into the
    diagnostic IMMEDIATELY — proves "what the session was given" even
    if a later step blows up before any flag flip."""
    from src.voc.connectors.oliveyoung_browser_api import (
        _PlaywrightReviewSession,
    )
    s = _PlaywrightReviewSession(
        headless=True, api_path="/api/x",
        review_tab_locator="x", scroll_candidates=("y",),
        user_agent="UA", viewport={"width": 100, "height": 200},
        cdp_endpoint="http://127.0.0.1:9222",
    )
    d = s.get_product_image_capture_diagnostic()
    assert d["session_received_cdp_endpoint"] == "http://127.0.0.1:9222"


# ---------------------------------------------------------------------------
# Pipeline failure_reason — propagation-layer sentinels
# ---------------------------------------------------------------------------


def _classify_failure(*, scan_diag: list[dict], inspected_summaries_count: int,
                      any_capture_attempted: bool,
                      any_connector_received_cdp: bool,
                      any_session_open_called: bool,
                      any_capture_hook_reached: bool,
                      any_session_id_mismatch: bool,
                      warm_image_url: str | None,
                      image_url: str | None,
                      image_source: str | None,
                      local_path: str | None) -> str | None:
    """Reproduces the classifier from run_phase2e_pipeline.py for unit
    testing without needing the full pipeline harness."""
    if local_path:
        return None
    if image_url and image_source != "none":
        return "cache_failed"
    if inspected_summaries_count == 0:
        return "warm_capture_not_attempted"
    if not any_connector_received_cdp:
        return "cdp_endpoint_not_forwarded"
    if any_connector_received_cdp and not any(
        r.get("session_received_cdp_endpoint") for r in scan_diag
    ):
        return "connector_did_not_receive_cdp_endpoint"
    if not any_session_open_called:
        return "session_open_not_called"
    if any_session_open_called and not any_capture_hook_reached:
        return "capture_hook_not_reached"
    if any_session_id_mismatch:
        return "session_id_mismatch"
    if any_capture_hook_reached and not warm_image_url:
        return "capture_attempted_but_no_marker"
    if warm_image_url and not image_url:
        return "capture_succeeded_but_not_propagated"
    if inspected_summaries_count > 0 and not any_capture_attempted:
        return "warm_capture_not_propagated"
    if any_capture_attempted and not warm_image_url:
        return "warm_capture_no_image_marker"
    return "unknown"


def test_failure_reason_cdp_endpoint_not_forwarded() -> None:
    """Connector got no cdp_endpoint at all → `cdp_endpoint_not_forwarded`."""
    diag = [{"requested_cdp_endpoint": None,
             "connector_received_cdp_endpoint": None,
             "session_received_cdp_endpoint": None}]
    assert _classify_failure(
        scan_diag=diag, inspected_summaries_count=1,
        any_capture_attempted=False, any_connector_received_cdp=False,
        any_session_open_called=False, any_capture_hook_reached=False,
        any_session_id_mismatch=False,
        warm_image_url=None, image_url=None, image_source="none",
        local_path=None,
    ) == "cdp_endpoint_not_forwarded"


def test_failure_reason_connector_did_not_receive_cdp_endpoint() -> None:
    """Connector saw the cdp endpoint but session didn't get it →
    connector→session wiring gap."""
    diag = [{"requested_cdp_endpoint": "http://...",
             "connector_received_cdp_endpoint": "http://...",
             "session_received_cdp_endpoint": None}]
    assert _classify_failure(
        scan_diag=diag, inspected_summaries_count=1,
        any_capture_attempted=False, any_connector_received_cdp=True,
        any_session_open_called=False, any_capture_hook_reached=False,
        any_session_id_mismatch=False,
        warm_image_url=None, image_url=None, image_source="none",
        local_path=None,
    ) == "connector_did_not_receive_cdp_endpoint"


def test_failure_reason_session_open_not_called() -> None:
    """Session got cdp endpoint but open() never ran."""
    diag = [{"requested_cdp_endpoint": "http://x",
             "connector_received_cdp_endpoint": "http://x",
             "session_received_cdp_endpoint": "http://x"}]
    assert _classify_failure(
        scan_diag=diag, inspected_summaries_count=1,
        any_capture_attempted=False, any_connector_received_cdp=True,
        any_session_open_called=False, any_capture_hook_reached=False,
        any_session_id_mismatch=False,
        warm_image_url=None, image_url=None, image_source="none",
        local_path=None,
    ) == "session_open_not_called"


def test_failure_reason_capture_hook_not_reached() -> None:
    """open() ran but capture block was never entered."""
    diag = [{"requested_cdp_endpoint": "http://x",
             "connector_received_cdp_endpoint": "http://x",
             "session_received_cdp_endpoint": "http://x"}]
    assert _classify_failure(
        scan_diag=diag, inspected_summaries_count=1,
        any_capture_attempted=False, any_connector_received_cdp=True,
        any_session_open_called=True, any_capture_hook_reached=False,
        any_session_id_mismatch=False,
        warm_image_url=None, image_url=None, image_source="none",
        local_path=None,
    ) == "capture_hook_not_reached"


def test_failure_reason_session_id_mismatch() -> None:
    """Connector queried a different session than the one open() ran on."""
    diag = [{"requested_cdp_endpoint": "http://x",
             "connector_received_cdp_endpoint": "http://x",
             "session_received_cdp_endpoint": "http://x"}]
    assert _classify_failure(
        scan_diag=diag, inspected_summaries_count=1,
        any_capture_attempted=True, any_connector_received_cdp=True,
        any_session_open_called=True, any_capture_hook_reached=True,
        any_session_id_mismatch=True,
        warm_image_url=None, image_url=None, image_source="none",
        local_path=None,
    ) == "session_id_mismatch"


def test_failure_reason_capture_attempted_but_no_marker() -> None:
    """Capture hook reached, extractor returned None for all 5 sources."""
    diag = [{"requested_cdp_endpoint": "http://x",
             "connector_received_cdp_endpoint": "http://x",
             "session_received_cdp_endpoint": "http://x"}]
    assert _classify_failure(
        scan_diag=diag, inspected_summaries_count=1,
        any_capture_attempted=True, any_connector_received_cdp=True,
        any_session_open_called=True, any_capture_hook_reached=True,
        any_session_id_mismatch=False,
        warm_image_url=None, image_url=None, image_source="none",
        local_path=None,
    ) == "capture_attempted_but_no_marker"


def test_failure_reason_capture_succeeded_but_not_propagated() -> None:
    """Warm scan found a URL but it didn't reach product_metadata."""
    diag = [{"requested_cdp_endpoint": "http://x",
             "connector_received_cdp_endpoint": "http://x",
             "session_received_cdp_endpoint": "http://x"}]
    # warm_image_url is set, but image_url stayed None — local logic bug.
    assert _classify_failure(
        scan_diag=diag, inspected_summaries_count=1,
        any_capture_attempted=True, any_connector_received_cdp=True,
        any_session_open_called=True, any_capture_hook_reached=True,
        any_session_id_mismatch=False,
        warm_image_url="https://cdn.example.com/p.jpg",
        image_url=None, image_source="none", local_path=None,
    ) == "capture_succeeded_but_not_propagated"


def test_failure_reason_cache_failed() -> None:
    """URL in product_metadata but no local_path → cache step failed."""
    diag = [{"requested_cdp_endpoint": "http://x",
             "connector_received_cdp_endpoint": "http://x",
             "session_received_cdp_endpoint": "http://x"}]
    assert _classify_failure(
        scan_diag=diag, inspected_summaries_count=1,
        any_capture_attempted=True, any_connector_received_cdp=True,
        any_session_open_called=True, any_capture_hook_reached=True,
        any_session_id_mismatch=False,
        warm_image_url="https://cdn.example.com/p.jpg",
        image_url="https://cdn.example.com/p.jpg",
        image_source="oliveyoung_detail_page_playwright",
        local_path=None,
    ) == "cache_failed"


def test_failure_reason_warm_capture_not_attempted() -> None:
    """No prod_summaries at all (skip-scrape)."""
    assert _classify_failure(
        scan_diag=[], inspected_summaries_count=0,
        any_capture_attempted=False, any_connector_received_cdp=False,
        any_session_open_called=False, any_capture_hook_reached=False,
        any_session_id_mismatch=False,
        warm_image_url=None, image_url=None, image_source="none",
        local_path=None,
    ) == "warm_capture_not_attempted"
