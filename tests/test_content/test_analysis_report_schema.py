"""Tests for the analysis_report.schema.json contract.

The schema lives at `src/voc/content/schemas/analysis_report.schema.json`
and is copied into each run directory at run-allocation time. The
adapter writes `corpus.sampling_strategy` from a closed set of values;
the schema's enum must include every value the adapter is allowed to
emit, otherwise downstream consumers reject valid reports as malformed.

Regression: in run-010, the adapter wrote `observable_multi_sort_corpus`
but the schema enum only listed the four legacy values, so validation
failed against the run's own schema copy.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
SCHEMA_PATH = (
    REPO / "src" / "voc" / "content" / "schemas"
    / "analysis_report.schema.json"
)


def _schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def _sampling_enum() -> list[str]:
    return (
        _schema()
        .get("properties", {})
        .get("corpus", {})
        .get("properties", {})
        .get("sampling_strategy", {})
        .get("enum")
        or []
    )


def test_sampling_strategy_enum_includes_observable_multi_sort_corpus():
    """The adapter's `_methodology_block` writes
    `observable_multi_sort_corpus` for the merged-multi-sort run mode.
    Schema must accept it."""
    assert "observable_multi_sort_corpus" in _sampling_enum()


def test_sampling_strategy_enum_keeps_legacy_values():
    enum = _sampling_enum()
    for legacy in (
        "latest_only", "latest_plus_signal", "full_corpus", "incremental",
    ):
        assert legacy in enum, f"legacy value {legacy} dropped from enum"


def test_run010_report_validates_against_schema():
    """Anchor the schema against the actual run-010 payload shape so a
    future drift in either the schema or the adapter trips the test."""
    jsonschema = pytest.importorskip("jsonschema")
    run_dir = (
        REPO / "outputs" / "2026-05-01_product-83743e299623_run-010"
    )
    report_path = run_dir / "shared" / "analysis_report.json"
    if not report_path.is_file():
        pytest.skip(f"run-010 fixture not present at {report_path}")
    report = json.loads(report_path.read_text(encoding="utf-8"))
    # Validate against the canonical schema (the run-dir copy may be
    # stale; canonical is source of truth).
    jsonschema.validate(instance=report, schema=_schema())


def test_adapter_emits_observable_multi_sort_corpus_strategy():
    from src.voc.content.adapters.from_phase2e import _methodology_block
    block = _methodology_block(
        sampling_strategy="observable_multi_sort_corpus",
    )
    assert block["sampling_strategy"] == "observable_multi_sort_corpus"
