"""Tests for the 4-axis confidence/coverage breakdown.

Run-003 surfaced a single-axis bug: `confidence_level=high` (size n=2115)
masked a partial-success collection where RATING_ASC failed and the
negative-signal pool was under-observed. The four axes split the
verdict so each surface can show the right caveat.
"""
from __future__ import annotations

from src.voc.content.confidence_axes import (
    compute_confidence_axes,
    derive_collection_completeness,
    derive_evidence_reliability,
    derive_negative_signal_coverage,
    derive_sample_size_confidence,
)


# ---------------------------------------------------------------------------
# Per-axis helpers
# ---------------------------------------------------------------------------


def test_sample_size_confidence_thresholds():
    assert derive_sample_size_confidence(2115) == "high"
    assert derive_sample_size_confidence(500) == "medium"
    assert derive_sample_size_confidence(50) == "low"
    assert derive_sample_size_confidence(0) == "low"
    assert derive_sample_size_confidence(None) == "low"


def test_collection_completeness_levels():
    # All succeeded
    assert derive_collection_completeness(
        sorts_attempted=["A", "B", "C"],
        sorts_succeeded=["A", "B", "C"],
        sorts_failed=[],
        partial_success=False,
    ) == "complete"
    # Some failed → partial
    assert derive_collection_completeness(
        sorts_attempted=["A", "B"],
        sorts_succeeded=["A"],
        sorts_failed=["B"],
        partial_success=True,
    ) == "partial"
    # Nothing succeeded → failed
    assert derive_collection_completeness(
        sorts_attempted=["A", "B"],
        sorts_succeeded=[],
        sorts_failed=["A", "B"],
        partial_success=True,
    ) == "failed"


def test_negative_signal_coverage_rating_asc_failure_downgrades_to_degraded():
    """The headline run-003 rule: RATING_ASC failure → degraded
    regardless of how many other sorts succeeded."""
    result = derive_negative_signal_coverage(
        sorts_succeeded=["DATETIME_DESC", "RATING_DESC", "USEFUL_SCORE_DESC"],
        sorts_failed=["RATING_ASC", "RECOMMENDED_DESC"],
    )
    assert result == "degraded"


def test_negative_signal_coverage_rating_asc_ok_recommended_failed():
    """When RATING_ASC succeeded but a secondary negative-signal sort
    failed, the level is `partial` (not `degraded`)."""
    result = derive_negative_signal_coverage(
        sorts_succeeded=["DATETIME_DESC", "RATING_ASC", "USEFUL_SCORE_DESC"],
        sorts_failed=["RECOMMENDED_DESC"],
    )
    assert result == "partial"


def test_negative_signal_coverage_clean_collection():
    result = derive_negative_signal_coverage(
        sorts_succeeded=["DATETIME_DESC", "RATING_ASC", "RATING_DESC"],
        sorts_failed=[],
    )
    assert result == "complete"


def test_evidence_reliability_high_when_no_suspect_quotes():
    audit = {"n_total_quotes": 50, "n_total_suspect_share": 0.0}
    assert derive_evidence_reliability(audit) == "high"


def test_evidence_reliability_medium_when_few_suspect_quotes():
    audit = {"n_total_quotes": 50, "n_total_suspect_share": 0.04}
    assert derive_evidence_reliability(audit) == "medium"


def test_evidence_reliability_low_when_many_suspect_quotes():
    audit = {"n_total_quotes": 50, "n_total_suspect_share": 0.10}
    assert derive_evidence_reliability(audit) == "low"


def test_evidence_reliability_low_when_audit_missing():
    assert derive_evidence_reliability(None) == "low"
    assert derive_evidence_reliability({}) == "low"


# ---------------------------------------------------------------------------
# compute_confidence_axes — the operator-facing surface
# ---------------------------------------------------------------------------


def test_compute_confidence_axes_run003_shape():
    """Locked run-003 verdict: large corpus + RATING_ASC failed →
      sample_size = high
      collection_completeness = partial
      negative_signal_coverage = degraded
      evidence_reliability = high (1 suspect / 63 = ~1.6%)
    Headline caveat must surface the RATING_ASC degradation.
    """
    axes = compute_confidence_axes(
        n_reviews=2115,
        polarity_audit={
            "n_total_quotes": 63,
            "n_total_suspect_share": 0.0159,
        },
        sorts_attempted=[
            "DATETIME_DESC", "RATING_ASC", "RATING_DESC",
            "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
        ],
        sorts_succeeded=[
            "DATETIME_DESC", "RATING_DESC", "USEFUL_SCORE_DESC",
        ],
        sorts_failed=["RATING_ASC", "RECOMMENDED_DESC"],
        partial_success=True,
    )
    assert axes["sample_size_confidence"]["level"] == "high"
    assert axes["collection_completeness"]["level"] == "partial"
    assert axes["negative_signal_coverage"]["level"] == "degraded"
    assert axes["evidence_reliability"]["level"] == "medium"
    # Headline must be the RATING_ASC degradation note, not the
    # generic partial-success or low-sample-size caveat.
    headline = axes["headline_caution"]
    assert headline is not None
    assert "RATING_ASC" in headline
    # Run-003 QA pass-4: headline phrasing rewritten to seller-friendly
    # Korean. The substring "과소 관측" was the analyst-tool form;
    # the new copy reads "실제보다 적게 반영" so a brand reader can
    # parse the caveat without internal jargon.
    assert "적게 반영" in headline


def test_compute_confidence_axes_clean_run_no_headline():
    """When every axis is healthy there's no headline caveat."""
    axes = compute_confidence_axes(
        n_reviews=2000,
        polarity_audit={"n_total_quotes": 50, "n_total_suspect_share": 0.0},
        sorts_attempted=["A", "B"],
        sorts_succeeded=["A", "B"],
        sorts_failed=[],
        partial_success=False,
    )
    assert axes["sample_size_confidence"]["level"] == "high"
    assert axes["collection_completeness"]["level"] == "complete"
    assert axes["negative_signal_coverage"]["level"] == "complete"
    assert axes["evidence_reliability"]["level"] == "high"
    assert axes["headline_caution"] is None


def test_axis_labels_use_reader_friendly_korean():
    """Locked: each axis carries a Korean label that does NOT use
    internal jargon ("관찰 신호", "신뢰도 낮음", "안정성 높음")."""
    axes = compute_confidence_axes(
        n_reviews=200,
        polarity_audit={"n_total_quotes": 10, "n_total_suspect_share": 0.0},
        sorts_succeeded=["DATETIME_DESC"],
        sorts_failed=[],
    )
    for axis_key, axis_block in axes.items():
        if axis_key == "headline_caution":
            continue
        label = axis_block["label_ko"]
        for forbidden in (
            "관찰 신호", "모니터링 후보", "신뢰도 낮음", "안정성 높음",
            "안정성 보통", "안정성 낮음",
        ):
            assert forbidden not in label, (
                f"axis {axis_key} label leaked internal jargon "
                f"{forbidden!r}: {label!r}"
            )
