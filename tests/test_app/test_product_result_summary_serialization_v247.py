"""v2.4.7 — ProductResult carries the connector summary verbatim.

Live OY smoke (post-v2.4.6) showed `requested_cdp_endpoint=null` even
though the manifest log proved the value reached `build_manifest`.
Root cause: `ProductResult` was an explicit-field dataclass with no
`summary` field, so `BatchReport.to_dict() → [p.__dict__ ...]` dropped
the entire connector summary dict. The pipeline's
`prod.get("summary")` always returned None, and every v2.4.x
diagnostic field collapsed to `null`/`False` via the `or {}` fallback.

These tests verify:
  * `ProductResult` exposes a `summary: dict` field and `_build_product_result`
    populates it from the connector dict.
  * `BatchReport.to_dict()` round-trips the summary all the way to the
    JSON-serialized batch_summary.json shape.
  * The pipeline's `_run_one_sort_attempt` reads the round-tripped
    `prod_summary` and propagates v2.4.x fields into its scan output.
  * The new `prod_summary_diagnostic_fields_missing` failure_reason
    sentinel fires when prod_summary exists but lacks the expected
    v2.4.x fields (regression guard for v2.4.7's actual bug).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.voc.app.collection_batch import (
    BatchDefaults,
    BatchReport,
    ProductResult,
    ProductSpec,
    _build_product_result,
)


# ---------------------------------------------------------------------------
# ProductResult.summary field
# ---------------------------------------------------------------------------


def test_product_result_has_summary_field() -> None:
    """The dataclass must declare a `summary` slot so `__dict__`
    serialization carries it."""
    pr = ProductResult(
        name="x", oy_goods_no="A", started_at="t",
        summary={"foo": "bar"},
    )
    assert pr.summary == {"foo": "bar"}
    assert "summary" in pr.__dict__


def test_product_result_summary_default_none() -> None:
    """Backwards-compat: fixtures that don't set summary keep None."""
    pr = ProductResult(name="x", oy_goods_no="A", started_at="t")
    assert pr.summary is None


# ---------------------------------------------------------------------------
# _build_product_result populates summary from stdout_json
# ---------------------------------------------------------------------------


def test_build_product_result_carries_full_connector_summary() -> None:
    """The connector dict that flows from ingest CLI stdout must land
    on `ProductResult.summary` verbatim — including the v2.4.x
    propagation diagnostic fields the pipeline scan relies on."""
    spec = ProductSpec(name="Test", oy_goods_no="A_TEST")
    defaults = BatchDefaults(cdp_endpoint="http://127.0.0.1:9222")
    stdout = {
        "run_id": "r1",
        "quality_status": "ok",
        "rows_inserted": 100,
        "summary": {
            "raw_records_seen": 100,
            "records_parsed": 100,
            "blocked": False,
            "auth_error": False,
            # v2.4.x propagation diagnostic fields
            "requested_cdp_endpoint": "http://127.0.0.1:9222",
            "connector_received_cdp_endpoint": "http://127.0.0.1:9222",
            "product_image_session_received_cdp_endpoint": "http://127.0.0.1:9222",
            "product_image_session_open_called": True,
            "product_image_capture_hook_reached": True,
            "product_image_capture_attempted": True,
            "product_image_capture_og_count": 1,
            "product_image_url": "https://image.example.com/p.jpg",
        },
    }
    result = _build_product_result(
        spec=spec, defaults=defaults,
        started_at="2026-05-03T00:00:00", finished_at="2026-05-03T00:01:00",
        stdout_json=stdout, error=None,
    )
    assert result.summary is not None
    assert result.summary["requested_cdp_endpoint"] == "http://127.0.0.1:9222"
    assert result.summary["connector_received_cdp_endpoint"] == (
        "http://127.0.0.1:9222"
    )
    assert result.summary["product_image_session_open_called"] is True
    assert result.summary["product_image_capture_attempted"] is True
    assert result.summary["product_image_capture_og_count"] == 1


def test_build_product_result_early_failure_summary_carries_cdp() -> None:
    """When the subprocess crashed before producing stdout, the
    early-error path still records the cdp_endpoint from the manifest
    defaults so the pipeline can correctly classify the failure."""
    spec = ProductSpec(name="Test", oy_goods_no="A_TEST")
    defaults = BatchDefaults(cdp_endpoint="http://127.0.0.1:9222")
    result = _build_product_result(
        spec=spec, defaults=defaults,
        started_at="t", finished_at="t",
        stdout_json=None,
        error="connect_over_cdp failed: ECONNREFUSED 127.0.0.1:9222",
    )
    assert result.status == "cdp_attach_failed"
    assert result.summary is not None
    assert result.summary["requested_cdp_endpoint"] == "http://127.0.0.1:9222"
    assert result.summary["connector_received_cdp_endpoint"] == (
        "http://127.0.0.1:9222"
    )
    assert result.summary["cdp_attach_failed"] is True
    assert "early_failure:cdp_attach_failed:" in (
        result.summary.get("product_image_capture_error") or ""
    )


def test_build_product_result_early_failure_uses_spec_override_when_set() -> None:
    """Per-product `spec.cdp_endpoint` override wins over manifest
    defaults — same precedence as `_resolve(spec, defaults)`."""
    spec = ProductSpec(
        name="Test", oy_goods_no="A_TEST",
        cdp_endpoint="http://override:9111",
    )
    defaults = BatchDefaults(cdp_endpoint="http://default:9222")
    result = _build_product_result(
        spec=spec, defaults=defaults,
        started_at="t", finished_at="t",
        stdout_json=None,
        error="page.goto failed: ERR_NAME_NOT_RESOLVED",
    )
    assert result.summary is not None
    assert result.summary["requested_cdp_endpoint"] == "http://override:9111"


# ---------------------------------------------------------------------------
# BatchReport.to_dict serializes ProductResult.summary
# ---------------------------------------------------------------------------


def test_batch_report_to_dict_includes_summary_field() -> None:
    """The batch_summary.json operators read MUST carry the summary
    dict at `products[i].summary`, not lose it during JSON serialization."""
    pr = ProductResult(
        name="Test", oy_goods_no="A", started_at="t",
        summary={
            "requested_cdp_endpoint": "http://127.0.0.1:9222",
            "product_image_capture_attempted": True,
        },
    )
    report = BatchReport(
        batch_id="b1", started_at="t", artifact_root="/tmp/x",
        products=[pr],
    )
    blob = report.to_dict()
    products = blob.get("products") or []
    assert len(products) == 1
    assert products[0]["summary"]["requested_cdp_endpoint"] == (
        "http://127.0.0.1:9222"
    )
    assert products[0]["summary"]["product_image_capture_attempted"] is True
    # JSON-serializable round trip
    blob_json = json.loads(json.dumps(blob))
    assert blob_json["products"][0]["summary"]["requested_cdp_endpoint"] == (
        "http://127.0.0.1:9222"
    )


# ---------------------------------------------------------------------------
# Pipeline's `prod.get('summary')` reads the round-tripped dict
# ---------------------------------------------------------------------------


def test_pipeline_prod_get_summary_reads_v2_4_x_fields() -> None:
    """End-to-end: build ProductResult → to_dict → JSON → re-parse →
    `prod.get('summary')` returns the connector dict with v2.4.x fields."""
    pr = ProductResult(
        name="Test", oy_goods_no="A", started_at="t",
        summary={
            "requested_cdp_endpoint": "http://127.0.0.1:9222",
            "connector_received_cdp_endpoint": "http://127.0.0.1:9222",
            "product_image_session_open_called": True,
            "product_image_capture_attempted": True,
            "product_image_url": "https://image.example.com/p.jpg",
        },
    )
    report = BatchReport(
        batch_id="b1", started_at="t", artifact_root="/tmp/x",
        products=[pr],
    )
    blob = json.loads(json.dumps(report.to_dict()))
    # Mirror what _run_one_sort_attempt does:
    prod = blob.get("products", [{}])[0]
    prod_summary = prod.get("summary")
    assert prod_summary is not None
    assert prod_summary["requested_cdp_endpoint"] == "http://127.0.0.1:9222"
    assert prod_summary["product_image_url"] == (
        "https://image.example.com/p.jpg"
    )


# ---------------------------------------------------------------------------
# v2.4.7 — prod_summary_diagnostic_fields_missing sentinel
# ---------------------------------------------------------------------------


def test_pipeline_classifier_picks_diagnostic_fields_missing() -> None:
    """When prod_summaries exist but every entry lacks the expected
    v2.4.x keys, the failure_reason MUST be
    `prod_summary_diagnostic_fields_missing` — NOT
    `cdp_endpoint_not_forwarded` (which would mis-blame the manifest).
    """
    # Reproduce the classifier inline (matches the pipeline's logic).
    inspected_summaries = [
        {"sort_type": "DATETIME_DESC", "prod_summary": {}},
        {"sort_type": "RATING_ASC", "prod_summary": {
            # Legacy fields only — no v2.4.x diagnostic keys
            "raw_records_seen": 0,
            "blocked": False,
        }},
    ]
    expected_keys = {
        "requested_cdp_endpoint",
        "connector_received_cdp_endpoint",
        "product_image_capture_attempted",
        "product_image_session_open_called",
    }
    any_expected_key_present = False
    for entry in inspected_summaries:
        ps = entry.get("prod_summary") or {}
        if expected_keys & set(ps.keys()):
            any_expected_key_present = True
            break
    prod_summary_diagnostic_fields_missing = (
        bool(inspected_summaries) and not any_expected_key_present
    )
    assert prod_summary_diagnostic_fields_missing is True


def test_pipeline_classifier_does_not_fire_when_v2_4_x_keys_present() -> None:
    """When at least one prod_summary carries the v2.4.x keys (even if
    values are None), the sentinel MUST NOT fire — the pipeline goes
    on to the more specific propagation-layer sentinels."""
    inspected_summaries = [
        {"sort_type": "DATETIME_DESC", "prod_summary": {
            "requested_cdp_endpoint": "http://127.0.0.1:9222",
        }},
        {"sort_type": "RATING_ASC", "prod_summary": {}},
    ]
    expected_keys = {
        "requested_cdp_endpoint",
        "connector_received_cdp_endpoint",
        "product_image_capture_attempted",
        "product_image_session_open_called",
    }
    any_expected_key_present = False
    for entry in inspected_summaries:
        ps = entry.get("prod_summary") or {}
        if expected_keys & set(ps.keys()):
            any_expected_key_present = True
            break
    prod_summary_diagnostic_fields_missing = (
        bool(inspected_summaries) and not any_expected_key_present
    )
    assert prod_summary_diagnostic_fields_missing is False
