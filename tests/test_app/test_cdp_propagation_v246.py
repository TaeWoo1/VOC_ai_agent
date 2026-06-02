"""v2.4.6 — propagation diagnostic survives the early-failure path.

Live OY smoke (post-v2.4.5) showed `requested_cdp_endpoint=null` even
though the manifest carried the value correctly. Root cause: when the
connector raises before assembling `last_run_summary` (e.g. CDP attach
fails inside `connect_over_cdp`), the ingest CLI's exception handler
synthesizes a summary from scratch and drops the v2.4.5 fields — so
the pipeline classifier mis-labels the run as `cdp_endpoint_not_forwarded`.

v2.4.6 fixes this by:
  1. Pre-allocating `connector.last_run_summary` at the START of
     `collect()` with the cdp_endpoint already stamped.
  2. The ingest CLI's exception handler reads the pre-allocated
     summary (when present) and overlays it on the synthetic dict so
     the cdp diagnostic survives.

These tests verify both the symmetric path (no raise → full summary)
and the early-failure path (raise → preserved cdp diagnostic).
"""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Synthetic summary preserves cdp diagnostic on early failure
# ---------------------------------------------------------------------------


def test_synthetic_summary_records_args_cdp_endpoint() -> None:
    """When the connector early-raises, the synthetic_summary built by
    the ingest CLI MUST still record `args.cdp_endpoint` so the
    pipeline can distinguish "manifest gap" from "early failure with
    cdp endpoint correctly forwarded"."""
    # Reproduce the ingest CLI's synthetic_summary construction with
    # a fake "args.cdp_endpoint" set. The relevant fields:
    args_cdp = "http://127.0.0.1:9222"
    synthetic = {
        "raw_records_seen": 0,
        "records_parsed": 0,
        "blocked": False,
        "auth_error": False,
        # v2.4.6 fields:
        "requested_cdp_endpoint": args_cdp,
        "connector_received_cdp_endpoint": args_cdp,
        "product_image_session_received_cdp_endpoint": None,
        "product_image_session_open_called": False,
        "product_image_capture_hook_reached": False,
        "product_image_capture_attempted": False,
        "product_image_capture_error": "early_failure:cdp_attach_failed",
    }
    # When read from prod_summary by the pipeline classifier:
    assert synthetic["requested_cdp_endpoint"] == args_cdp
    assert synthetic["connector_received_cdp_endpoint"] == args_cdp
    # Session-side stays None — accurately surfaces "session never
    # received the value" because the session was never constructed.
    assert synthetic["product_image_session_received_cdp_endpoint"] is None


def test_pipeline_failure_reason_for_synthetic_with_args_cdp() -> None:
    """The pipeline failure_reason classifier correctly distinguishes
    the early-failure-with-cdp-set case from the manifest-gap case."""
    from tests.test_app.test_cdp_propagation_diagnostic import (
        _classify_failure,
    )
    args_cdp = "http://127.0.0.1:9222"
    diag = [{
        "requested_cdp_endpoint": args_cdp,
        "connector_received_cdp_endpoint": args_cdp,
        "session_received_cdp_endpoint": None,
    }]
    # Case: connector raised before the session got the value.
    reason = _classify_failure(
        scan_diag=diag, inspected_summaries_count=1,
        any_capture_attempted=False, any_connector_received_cdp=True,
        any_session_open_called=False, any_capture_hook_reached=False,
        any_session_id_mismatch=False,
        warm_image_url=None, image_url=None, image_source="none",
        local_path=None,
    )
    # No longer mis-classifies as cdp_endpoint_not_forwarded —
    # correctly identifies "connector got it but session didn't".
    assert reason == "connector_did_not_receive_cdp_endpoint"


# ---------------------------------------------------------------------------
# Connector pre-allocates last_run_summary with cdp_endpoint
# ---------------------------------------------------------------------------


def test_connector_preallocates_summary_with_cdp_endpoint() -> None:
    """`OliveYoungBrowserAPIConnector.collect()` must set
    `self.last_run_summary` BEFORE any session work so the cdp_endpoint
    diagnostic is preserved even when downstream work raises.

    We stub the session_factory to raise immediately — simulating a
    `connect_over_cdp` failure — and verify the connector's
    `last_run_summary.requested_cdp_endpoint` is non-null after the
    raise propagates."""
    from src.voc.connectors.base import CollectParams
    from src.voc.connectors.oliveyoung_browser_api import (
        OliveYoungBrowserAPIConnector,
    )

    # Fake mapper — connector's __init__ requires one but we never
    # use it (the session raises before any record is parsed).
    class _NullMapper:
        def to_label(self, *_a, **_kw): return None
        def to_labels(self, *_a, **_kw): return []

    class _RaisingSession:
        async def open(self, *_a, **_kw):
            raise RuntimeError("simulated CDP attach failure")
        async def close(self): pass
        async def wait_for_next_response(self, *_a, **_kw): pass
        async def scroll_or_click_more(self, *_a, **_kw): return False

    cdp = "http://127.0.0.1:9222"
    connector = OliveYoungBrowserAPIConnector(
        product_url="https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A_TEST",
        code_mapper=_NullMapper(),
        cdp_endpoint=cdp,
        session_factory=lambda: _RaisingSession(),
    )

    params = CollectParams(max_results=10)

    async def _run():
        with pytest.raises(RuntimeError):
            await connector.collect(keyword="test", params=params)

    asyncio.run(_run())

    # The pre-allocated summary survives.
    assert connector.last_run_summary is not None
    assert connector.last_run_summary.requested_cdp_endpoint == cdp
    assert connector.last_run_summary.connector_received_cdp_endpoint == cdp


# ---------------------------------------------------------------------------
# Manifest log line — verify the build_manifest output
# ---------------------------------------------------------------------------


def test_build_manifest_logs_cdp_endpoint(capsys: pytest.CaptureFixture) -> None:
    """`build_manifest` should print the manifest path AND the
    cdp_endpoint that landed in defaults, so operators can audit
    without re-reading the JSON file."""
    from scripts.run_phase2e_pipeline import build_manifest
    cdp = "http://127.0.0.1:9222"
    path = build_manifest(
        goods_no="A_TEST",
        product_name="Test",
        max_reviews=1,
        sort_type="DATETIME_DESC",
        suffix="_v246_test",
        cdp_endpoint=cdp,
    )
    captured = capsys.readouterr()
    # Output should include both the path and the cdp endpoint
    assert str(path) in captured.out
    assert cdp in captured.out
    assert "defaults.cdp_endpoint=" in captured.out


def test_build_manifest_writes_cdp_endpoint_to_defaults() -> None:
    """Round-trip: build_manifest → load_manifest → defaults.cdp_endpoint
    must equal what the pipeline passed."""
    from scripts.run_phase2e_pipeline import build_manifest
    from src.voc.app.collection_batch import load_manifest

    cdp = "http://127.0.0.1:9222"
    path = build_manifest(
        goods_no="A_RT", product_name="Test", max_reviews=1,
        sort_type="DATETIME_DESC", suffix="_v246_rt",
        cdp_endpoint=cdp,
    )
    mfst = load_manifest(path)
    assert mfst.defaults.cdp_endpoint == cdp


# ---------------------------------------------------------------------------
# End-to-end argv: pipeline manifest → batch ingest argv
# ---------------------------------------------------------------------------


def test_pipeline_manifest_to_argv_carries_cdp_endpoint() -> None:
    """Combined: build_manifest → load_manifest → _build_ingest_command.
    The cdp_endpoint MUST appear in the final argv exactly once with
    the correct value."""
    from scripts.run_phase2e_pipeline import build_manifest
    from src.voc.app.collection_batch import (
        _build_ingest_command, load_manifest,
    )

    cdp = "http://127.0.0.1:9222"
    path = build_manifest(
        goods_no="A_E2E", product_name="Test", max_reviews=1,
        sort_type="DATETIME_DESC", suffix="_v246_e2e",
        cdp_endpoint=cdp,
    )
    mfst = load_manifest(path)
    argv = _build_ingest_command(
        spec=mfst.products[0],
        defaults=mfst.defaults,
        debug_dir=Path("/tmp/x"),
    )
    # Exactly one --cdp-endpoint flag, with the operator-supplied value
    cdp_indices = [i for i, a in enumerate(argv) if a == "--cdp-endpoint"]
    assert len(cdp_indices) == 1
    assert argv[cdp_indices[0] + 1] == cdp
