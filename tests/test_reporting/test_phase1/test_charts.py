"""Smoke test for charts.py. Verifies the rating-distribution bar
produces a valid PNG on a synthetic DeterministicMetrics input. Gated
on matplotlib import — skipped when the [charts] extra is not installed
so core pipeline tests stay independent of the optional dependency."""

from __future__ import annotations

from pathlib import Path

import pytest

matplotlib = pytest.importorskip("matplotlib")

from src.voc.reporting.phase1.charts import render_rating_distribution_bar
from src.voc.reporting.phase1.schema import (
    ChannelSignals,
    DeterministicMetrics,
    RatingMetrics,
    SegmentMetrics,
    TimeWindow,
)


def _metrics_with_distribution(dist: dict[int, int]) -> DeterministicMetrics:
    return DeterministicMetrics(
        total_reviews=sum(dist.values()),
        n_products=1,
        channels={"oliveyoung": sum(dist.values())},
        rating=RatingMetrics(
            n=sum(dist.values()), missing=0,
            avg_raw=4.0, distribution_raw=dist,
        ),
        time_window=TimeWindow(),
        dominant_product=None,
        per_product=[],
        segments=SegmentMetrics(),
        channel_signals=ChannelSignals(),
    )


def test_rating_distribution_bar_produces_valid_png(tmp_path: Path) -> None:
    metrics = _metrics_with_distribution({5: 162, 4: 29, 3: 8, 2: 1, 1: 0})
    out = render_rating_distribution_bar(metrics, tmp_path / "rating.png")
    assert out.is_file()
    # Minimum-viability check: a proper matplotlib PNG is well above 2KB.
    assert out.stat().st_size > 2_000
    # PNG magic bytes
    assert out.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_rating_distribution_bar_handles_zero_counts(tmp_path: Path) -> None:
    """All-zero distribution shouldn't crash — edge case when a product
    has no rated reviews. Returns a PNG with empty bars."""
    metrics = _metrics_with_distribution({5: 0, 4: 0, 3: 0, 2: 0, 1: 0})
    out = render_rating_distribution_bar(metrics, tmp_path / "zero.png")
    assert out.is_file()
    assert out.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_coverage_composition_bar_produces_valid_png(tmp_path: Path) -> None:
    from src.voc.reporting.phase1.charts import render_coverage_composition_bar
    from src.voc.reporting.phase1.schema import SignalCoverage
    coverage = SignalCoverage(
        total_reviews=500,
        rows_with_any_signal=150,
        rows_with_no_signal=350,
        positive_only=100,
        cautionary_only=20,
        gap_only=10,
        mixed=20,
        no_signal_by_rating={5: 300, 4: 40, 3: 5, 2: 3, 1: 2},
    )
    out = render_coverage_composition_bar(coverage, tmp_path / "coverage.png")
    assert out.is_file()
    assert out.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    assert out.stat().st_size > 2_000


def test_coverage_composition_bar_rejects_zero_total(tmp_path: Path) -> None:
    """Zero-row reports have nothing to chart; renderer raises ValueError
    so the caller can suppress the embed cleanly."""
    import pytest as _pytest
    from src.voc.reporting.phase1.charts import render_coverage_composition_bar
    from src.voc.reporting.phase1.schema import SignalCoverage
    coverage = SignalCoverage(
        total_reviews=0, rows_with_any_signal=0, rows_with_no_signal=0,
        positive_only=0, cautionary_only=0, gap_only=0, mixed=0,
    )
    with _pytest.raises(ValueError, match="total_reviews"):
        render_coverage_composition_bar(coverage, tmp_path / "should_not_exist.png")


def test_segment_signal_heatmap_produces_valid_png(tmp_path: Path) -> None:
    from src.voc.reporting.phase1.charts import render_segment_signal_heatmap
    from src.voc.reporting.phase1.schema import (
        SignalCandidate, SignalsBundle,
    )
    # Build 2 eligible segments (sensitive=10, dry=15) + 2 signals that
    # fire on at least one segment.
    rows: list[dict] = []
    for i in range(10):
        rows.append({
            "review_id": f"s{i}",
            "derived": {"normalized_skin_type": {"bucket": "sensitive"}},
        })
    for i in range(15):
        rows.append({
            "review_id": f"d{i}",
            "derived": {"normalized_skin_type": {"bucket": "dry"}},
        })
    signals = SignalsBundle(
        cautionary=[SignalCandidate(
            name="sig1", display_label="신호 A", category="cautionary",
            evidence_count=5, coverage_ratio=0.2,
            sample_review_ids=[],
        )],
        positive=[SignalCandidate(
            name="sig2", display_label="신호 B", category="positive",
            evidence_count=3, coverage_ratio=0.12,
            sample_review_ids=[],
        )],
    )
    membership = {
        "sig1": {f"s{i}" for i in range(3)} | {f"d{i}" for i in range(2)},
        "sig2": {f"d{i}" for i in range(3)},
    }
    out = render_segment_signal_heatmap(
        rows, signals, membership, tmp_path / "heatmap.png",
    )
    assert out.is_file()
    assert out.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    assert out.stat().st_size > 2_000


def test_segment_signal_heatmap_rejects_insufficient_segments(
    tmp_path: Path,
) -> None:
    """Needs at least 2 segments meeting the size threshold."""
    import pytest as _pytest
    from src.voc.reporting.phase1.charts import render_segment_signal_heatmap
    from src.voc.reporting.phase1.schema import SignalsBundle
    rows = [
        {"review_id": f"s{i}",
         "derived": {"normalized_skin_type": {"bucket": "sensitive"}}}
        for i in range(15)
    ]  # only one eligible segment
    with _pytest.raises(ValueError, match="≥2 segments"):
        render_segment_signal_heatmap(
            rows, SignalsBundle(), {}, tmp_path / "should_not_exist.png",
        )


def test_segment_signal_heatmap_rejects_no_signal_fires(tmp_path: Path) -> None:
    """Two eligible segments but no signals fire on any of them."""
    import pytest as _pytest
    from src.voc.reporting.phase1.charts import render_segment_signal_heatmap
    from src.voc.reporting.phase1.schema import SignalsBundle
    rows = (
        [{"review_id": f"s{i}",
          "derived": {"normalized_skin_type": {"bucket": "sensitive"}}}
         for i in range(15)]
        + [{"review_id": f"d{i}",
            "derived": {"normalized_skin_type": {"bucket": "dry"}}}
           for i in range(15)]
    )
    with _pytest.raises(ValueError, match="no signals fire"):
        render_segment_signal_heatmap(
            rows, SignalsBundle(), {}, tmp_path / "should_not_exist.png",
        )
