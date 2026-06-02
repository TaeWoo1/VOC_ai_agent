"""Tests for derived.py — segment × signal cross-cut + rating × content
divergence analyses.

Covers threshold enforcement for both derived layers, empty-inputs
graceful case, and the JSON-string vs dict ``derived`` input shapes.
"""

from __future__ import annotations

import json

from src.voc.reporting.phase1.derived import (
    _MAX_FINDINGS,
    _MIN_DIVERGENCE_COUNT,
    _MIN_DIVERGENCE_RATE,
    _MIN_EVIDENCE_IN_SEGMENT,
    _MIN_EVIDENCE_IN_SHADE,
    _MIN_LIFT,
    _MIN_LIFT_SHADE,
    _MIN_POPULATION_SIZE,
    _MIN_SEGMENT_SIZE,
    _MIN_SHADE_SIZE,
    compute_derived_findings,
)
from src.voc.reporting.phase1.schema import SignalCandidate, SignalsBundle


def _row(rid: str, bucket: str | None = None, *, use_json: bool = False) -> dict:
    """Build a minimal row dict with an optional segment bucket embedded
    in either the parsed-dict ``derived`` slot or the JSON-string
    ``derived_json`` slot, matching the two real-world shapes."""
    derived = {"normalized_skin_type": {"bucket": bucket}} if bucket else {}
    if use_json:
        return {"review_id": rid, "derived_json": json.dumps(derived)}
    return {"review_id": rid, "derived": derived}


class TestSegmentSignalCrosstab:
    def test_empty_inputs_returns_empty(self) -> None:
        result = compute_derived_findings(
            [], SignalsBundle(), {},
        )
        assert result.segment_signal_findings == []

    def test_requires_min_segment_size(self) -> None:
        """A segment with fewer than _MIN_SEGMENT_SIZE rows is skipped even
        if it looks overrepresented."""
        rows = [_row(f"r{i}", "sensitive") for i in range(_MIN_SEGMENT_SIZE - 1)]
        rows += [_row(f"bg{i}", "dry") for i in range(50)]
        signals = SignalsBundle(cautionary=[SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=5, coverage_ratio=0.08,
            sample_review_ids=[],
        )])
        membership = {"s1": {"r0", "r1", "r2", "r3", "r4"}}
        result = compute_derived_findings(rows, signals, membership)
        # "sensitive" is under-sized; no finding should emerge even though
        # the whole signal hit in that small segment.
        assert result.segment_signal_findings == []

    def test_requires_min_evidence_in_segment(self) -> None:
        """A single hit in a large segment is noise-level — dropped."""
        rows = [_row(f"s{i}", "sensitive") for i in range(15)]
        rows += [_row(f"d{i}", "dry") for i in range(50)]
        signals = SignalsBundle(cautionary=[SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=1, coverage_ratio=0.015,
            sample_review_ids=["s0"],
        )])
        membership = {"s1": {"s0"}}
        result = compute_derived_findings(rows, signals, membership)
        # Only 1 hit in 'sensitive' (n_signal_in_segment=1 < _MIN_EVIDENCE=2)
        assert result.segment_signal_findings == []

    def test_requires_min_lift(self) -> None:
        """If within-segment rate isn't meaningfully higher than overall,
        drop — even with adequate counts."""
        # 100 rows total, 50 sensitive. Signal hits 10 overall, 5 in
        # sensitive. within=5/50=10%, overall=10/100=10%, lift=1.0.
        rows = [_row(f"s{i}", "sensitive") for i in range(50)]
        rows += [_row(f"d{i}", "dry") for i in range(50)]
        signals = SignalsBundle(cautionary=[SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=10, coverage_ratio=0.1,
            sample_review_ids=[],
        )])
        hit_ids = {f"s{i}" for i in range(5)} | {f"d{i}" for i in range(5)}
        membership = {"s1": hit_ids}
        result = compute_derived_findings(rows, signals, membership)
        # lift is 1.0 in both buckets — below _MIN_LIFT=2.0
        assert result.segment_signal_findings == []

    def test_reports_overrepresentation_when_all_thresholds_pass(self) -> None:
        """Canonical positive case: sensitive skin users overrepresented
        on a signal."""
        # 20 rows total, 10 sensitive, 10 dry. Signal hits 3 total: all 3 on
        # sensitive. within=3/10=30%, overall=3/20=15%, lift=2.0 — exactly
        # at the boundary and inclusive.
        rows = [_row(f"s{i}", "sensitive") for i in range(10)]
        rows += [_row(f"d{i}", "dry") for i in range(10)]
        signals = SignalsBundle(cautionary=[SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=3, coverage_ratio=0.15,
            sample_review_ids=[],
        )])
        membership = {"s1": {"s0", "s1", "s2"}}
        result = compute_derived_findings(rows, signals, membership)
        assert len(result.segment_signal_findings) == 1
        f = result.segment_signal_findings[0]
        assert f.bucket == "sensitive"
        assert f.signal_name == "s1"
        assert f.n_segment == 10
        assert f.n_signal_in_segment == 3
        assert f.within_segment_rate == 0.3
        assert f.overall_rate == 0.15
        assert f.lift == 2.0

    def test_excluded_buckets_never_surface(self) -> None:
        """'unknown' (and missing bucket) rows are never treated as a
        segment, even if they cluster."""
        rows = [_row(f"u{i}", "unknown") for i in range(30)]
        rows += [_row(f"d{i}", "dry") for i in range(30)]
        signals = SignalsBundle(cautionary=[SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=6, coverage_ratio=0.1,
            sample_review_ids=[],
        )])
        # All 6 hits in 'unknown' rows
        membership = {"s1": {f"u{i}" for i in range(6)}}
        result = compute_derived_findings(rows, signals, membership)
        assert result.segment_signal_findings == []

    def test_max_findings_cap(self) -> None:
        """When many (segment, signal) pairs pass, the output is capped at
        _MAX_FINDINGS, sorted by lift descending."""
        # 5 segments × 1 signal each, all passing the thresholds.
        # Build 10 rows per segment × 5 segments = 50 rows.
        # Each signal has 4 hits, all in its matched segment → within=40%,
        # overall=4/50=8%, lift=5.0.
        buckets = ["dry", "oily", "normal", "combination", "sensitive"]
        rows = []
        for b in buckets:
            rows += [_row(f"{b}_{i}", b) for i in range(10)]

        signals_list = []
        membership = {}
        # Create 6 signals (more than _MAX_FINDINGS=5), each concentrated in
        # a different bucket rotation.
        for i, b in enumerate(buckets + [buckets[0]]):
            sname = f"sig_{i}"
            signals_list.append(SignalCandidate(
                name=sname, display_label=sname, category="cautionary",
                evidence_count=4, coverage_ratio=4 / 50,
                sample_review_ids=[],
            ))
            membership[sname] = {f"{b}_{j}" for j in range(4)}
        result = compute_derived_findings(
            rows,
            SignalsBundle(cautionary=signals_list),
            membership,
        )
        assert len(result.segment_signal_findings) == _MAX_FINDINGS

    def test_accepts_json_string_derived(self) -> None:
        """Real DB rows carry derived as a JSON string; fixture rows carry
        it as a dict. Both must work identically."""
        rows = [_row(f"s{i}", "sensitive", use_json=True) for i in range(10)]
        rows += [_row(f"d{i}", "dry", use_json=True) for i in range(10)]
        signals = SignalsBundle(cautionary=[SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=3, coverage_ratio=0.15,
            sample_review_ids=[],
        )])
        membership = {"s1": {"s0", "s1", "s2"}}
        result = compute_derived_findings(rows, signals, membership)
        assert len(result.segment_signal_findings) == 1
        assert result.segment_signal_findings[0].bucket == "sensitive"

    def test_malformed_derived_silently_skipped(self) -> None:
        """A row with broken derived_json doesn't crash; it just isn't
        assigned a segment."""
        rows = [
            {"review_id": "x1", "derived_json": "{not valid json"},
            {"review_id": "x2", "derived_json": "[]"},   # wrong shape
            {"review_id": "x3"},                         # missing entirely
        ]
        rows += [_row(f"s{i}", "sensitive") for i in range(10)]
        signals = SignalsBundle(cautionary=[SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=3, coverage_ratio=3 / 13,
            sample_review_ids=[],
        )])
        # Hits include a malformed row (x1) and two sensitive rows
        membership = {"s1": {"x1", "s0", "s1"}}
        result = compute_derived_findings(rows, signals, membership)
        # Malformed rows don't inflate or crash analysis — finding may
        # still surface on 'sensitive' based on its two in-segment hits
        # (within=2/10=20%, overall=3/13≈23%, lift≈0.87 — below threshold)
        # so we expect no findings.
        assert result.segment_signal_findings == []


# ---------------------------------------------------------------------------
# Rating × content divergence
# ---------------------------------------------------------------------------


def _rating_row(rid: str, rating: int) -> dict:
    """Minimal row with a rating and no segment data (not needed for
    rating-axis tests)."""
    return {"review_id": rid, "rating_raw": rating, "derived": {}}


class TestRatingContentDivergence:
    def test_empty_rows_returns_empty(self) -> None:
        result = compute_derived_findings([], SignalsBundle(), {})
        assert result.rating_content_divergences == []

    def test_high_rated_with_concerns_fires_when_thresholds_pass(self) -> None:
        """Canonical primary-cell case: enough high-rated rows, enough of
        them carry a cautionary signal, rate above floor."""
        rows = [_rating_row(f"h{i}", 5) for i in range(20)]
        rows += [_rating_row(f"m{i}", 3) for i in range(5)]   # mid, unused
        # Hits on 4 of the high-rated rows = 4/20 = 20%, well above 2% floor
        cautionary_sig = SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=4, coverage_ratio=4 / 25,
            sample_review_ids=[],
        )
        membership = {"s1": {"h0", "h1", "h2", "h3"}}
        result = compute_derived_findings(
            rows, SignalsBundle(cautionary=[cautionary_sig]), membership,
        )
        divs = result.rating_content_divergences
        assert len(divs) == 1
        d = divs[0]
        assert d.kind == "high_rated_with_concerns"
        assert d.rating_bound == 4
        assert d.rating_condition == ">="
        assert d.population_size == 20
        assert d.cell_count == 4
        assert d.within_rate == 0.2
        assert d.sample_review_ids == ["h0", "h1", "h2"]

    def test_population_below_min_skipped(self) -> None:
        """If the rating-band population is below _MIN_POPULATION_SIZE the
        divergence cell is suppressed entirely, even when cell_count and
        rate look fine."""
        rows = [_rating_row(f"h{i}", 5) for i in range(_MIN_POPULATION_SIZE - 1)]
        cautionary_sig = SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=5, coverage_ratio=5 / 19,
            sample_review_ids=[],
        )
        membership = {"s1": {f"h{i}" for i in range(5)}}
        result = compute_derived_findings(
            rows, SignalsBundle(cautionary=[cautionary_sig]), membership,
        )
        # Not enough high-rated rows to speak confidently about the cell.
        high_cells = [d for d in result.rating_content_divergences
                       if d.kind == "high_rated_with_concerns"]
        assert high_cells == []

    def test_cell_count_below_min_skipped(self) -> None:
        """If cell_count < _MIN_DIVERGENCE_COUNT the cell is dropped."""
        rows = [_rating_row(f"h{i}", 5) for i in range(50)]
        cautionary_sig = SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=_MIN_DIVERGENCE_COUNT - 1,
            coverage_ratio=(_MIN_DIVERGENCE_COUNT - 1) / 50,
            sample_review_ids=[],
        )
        # Only 2 hits — below the 3-row floor
        membership = {"s1": {"h0", "h1"}}
        result = compute_derived_findings(
            rows, SignalsBundle(cautionary=[cautionary_sig]), membership,
        )
        high_cells = [d for d in result.rating_content_divergences
                       if d.kind == "high_rated_with_concerns"]
        assert high_cells == []

    def test_rate_below_min_skipped(self) -> None:
        """If within-rate < _MIN_DIVERGENCE_RATE the cell is dropped even
        when count clears the floor."""
        # 1000 high-rated rows, only 3 hits = 0.3% < 1% floor
        rows = [_rating_row(f"h{i}", 5) for i in range(1000)]
        cautionary_sig = SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=3, coverage_ratio=3 / 1000,
            sample_review_ids=[],
        )
        membership = {"s1": {"h0", "h1", "h2"}}
        result = compute_derived_findings(
            rows, SignalsBundle(cautionary=[cautionary_sig]), membership,
        )
        high_cells = [d for d in result.rating_content_divergences
                       if d.kind == "high_rated_with_concerns"]
        assert high_cells == []

    def test_low_rated_without_concerns_secondary_cell(self) -> None:
        """Secondary cell: enough low-rated rows, most without cautionary
        signal hits → cell surfaces."""
        rows = [_rating_row(f"l{i}", 1) for i in range(20)]
        rows += [_rating_row(f"h{i}", 5) for i in range(30)]   # high rows unused
        # Only 2 of the low-rated rows hit the cautionary — 18/20 low-rated
        # are WITHOUT concerns → cell fires at 18/20 = 90%
        cautionary_sig = SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=2, coverage_ratio=2 / 50,
            sample_review_ids=[],
        )
        membership = {"s1": {"l0", "l1"}}
        result = compute_derived_findings(
            rows, SignalsBundle(cautionary=[cautionary_sig]), membership,
        )
        low_cells = [d for d in result.rating_content_divergences
                      if d.kind == "low_rated_without_concerns"]
        assert len(low_cells) == 1
        d = low_cells[0]
        assert d.rating_bound == 2
        assert d.rating_condition == "<="
        assert d.population_size == 20
        assert d.cell_count == 18
        assert d.within_rate == 0.9

    def test_low_rated_cell_suppressed_on_small_low_pop(self) -> None:
        """Expected on very-positive products: too few low-rated reviews
        means the secondary cell doesn't fire, and that's the restraint
        behavior, not an error."""
        rows = [_rating_row(f"h{i}", 5) for i in range(50)]
        rows += [_rating_row(f"l{i}", 1) for i in range(5)]  # < _MIN_POPULATION_SIZE
        result = compute_derived_findings(rows, SignalsBundle(), {})
        # No low-rated cell at all — we refuse to speak about n<20
        low_cells = [d for d in result.rating_content_divergences
                      if d.kind == "low_rated_without_concerns"]
        assert low_cells == []

    def test_missing_rating_rows_excluded(self) -> None:
        """Rows with rating_raw=None aren't counted in either population."""
        rows = [_rating_row(f"h{i}", 5) for i in range(20)]
        # 10 rows with missing rating — should not count
        rows += [{"review_id": f"null{i}", "rating_raw": None, "derived": {}}
                 for i in range(10)]
        cautionary_sig = SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=4, coverage_ratio=4 / 30,
            sample_review_ids=[],
        )
        membership = {"s1": {"h0", "h1", "h2", "h3"}}
        result = compute_derived_findings(
            rows, SignalsBundle(cautionary=[cautionary_sig]), membership,
        )
        high_cells = [d for d in result.rating_content_divergences
                       if d.kind == "high_rated_with_concerns"]
        assert len(high_cells) == 1
        # Population is 20 high-rated, not 30 — null-rating rows don't count
        assert high_cells[0].population_size == 20

    def test_both_cells_fire_when_corpus_supports_both(self) -> None:
        """When both conditions pass, both findings return in the expected
        order (primary first)."""
        rows = [_rating_row(f"h{i}", 5) for i in range(25)]
        rows += [_rating_row(f"l{i}", 1) for i in range(20)]
        cautionary_sig = SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=5, coverage_ratio=5 / 45,
            sample_review_ids=[],
        )
        # 3 hits on high rows (cell 1 fires), 2 hits on low rows
        # (cell 2 = 18 low rows without concerns — fires).
        membership = {"s1": {"h0", "h1", "h2", "l0", "l1"}}
        result = compute_derived_findings(
            rows, SignalsBundle(cautionary=[cautionary_sig]), membership,
        )
        kinds = [d.kind for d in result.rating_content_divergences]
        assert kinds == ["high_rated_with_concerns", "low_rated_without_concerns"]

    def test_tightened_2pct_threshold_suppresses_borderline_cell(self) -> None:
        """After the _MIN_DIVERGENCE_RATE tightening from 1% to 2%, a
        borderline high-rated cell like 4/325 = 1.23% — the exact shape
        observed on the deardahlia matched-pair corpus — is suppressed.
        Regression test for that calibration."""
        rows = [_rating_row(f"h{i}", 5) for i in range(325)]
        sig = SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=4, coverage_ratio=4 / 325,
            sample_review_ids=[],
        )
        membership = {"s1": {f"h{i}" for i in range(4)}}
        result = compute_derived_findings(
            rows, SignalsBundle(cautionary=[sig]), membership,
        )
        high_cells = [d for d in result.rating_content_divergences
                       if d.kind == "high_rated_with_concerns"]
        assert high_cells == []


class TestSegmentFindingContextFields:
    """Regression: the new sample_review_ids / segment_share_of_known /
    segment_avg_rating fields are populated when a finding surfaces."""

    def test_context_populated_on_surfaced_finding(self) -> None:
        rows = [_row(f"s{i}", "sensitive") for i in range(10)]
        rows += [_row(f"d{i}", "dry") for i in range(10)]
        # Give both buckets a rating so avg_rating isn't None
        for r in rows:
            r["rating_raw"] = 5
        lex_sig = SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=3, coverage_ratio=0.15,
            sample_review_ids=[],
        )
        membership = {"s1": {"s0", "s1", "s2"}}
        result = compute_derived_findings(
            rows, SignalsBundle(cautionary=[lex_sig]), membership,
        )
        assert len(result.segment_signal_findings) == 1
        f = result.segment_signal_findings[0]
        assert f.sample_review_ids == ["s0", "s1", "s2"]
        # sensitive = 10 rows, total_known_segmented = 20 → share = 0.5
        assert f.segment_share_of_known == 0.5
        assert f.segment_avg_rating == 5.0


class TestShadeFindingContextFields:
    def test_context_populated_on_surfaced_finding(self) -> None:
        rows = [_shade_row(f"t{i}", "target") for i in range(20)]
        rows += [_shade_row(f"o{i}", "other") for i in range(80)]
        for r in rows:
            r["rating_raw"] = 4
        sig = SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=5, coverage_ratio=0.05,
            sample_review_ids=[],
        )
        membership = {"s1": {f"t{i}" for i in range(5)}}
        result = compute_derived_findings(
            rows, SignalsBundle(cautionary=[sig]), membership,
            dominant_product_id="P_dom",
        )
        assert len(result.shade_signal_findings) == 1
        f = result.shade_signal_findings[0]
        assert f.sample_review_ids == ["t0", "t1", "t2"]
        # target shade = 20, product total = 100 → share = 0.2
        assert f.shade_share_of_product == 0.2
        assert f.shade_avg_rating == 4.0


# ---------------------------------------------------------------------------
# Shade × signal concentration
# ---------------------------------------------------------------------------


def _shade_row(
    rid: str,
    shade: str | None,
    product_id: str = "P_dom",
    *,
    use_json: bool = False,
) -> dict:
    """Build a minimal row with an optional shade assignment. The row belongs
    to ``product_id`` (defaults to the dominant-product sentinel used in the
    shade tests below)."""
    derived: dict = {}
    if shade is not None:
        derived["normalized_product_option"] = {"shade": shade}
    row: dict = {"review_id": rid, "product_external_id": product_id}
    if use_json:
        row["derived_json"] = json.dumps(derived)
    else:
        row["derived"] = derived
    return row


class TestShadeSignalFindings:
    def test_requires_dominant_product_id(self) -> None:
        """Without dominant_product_id, shade findings are always empty."""
        rows = [_shade_row(f"r{i}", "shade_a") for i in range(20)]
        sig = SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=4, coverage_ratio=0.2, sample_review_ids=[],
        )
        membership = {"s1": {f"r{i}" for i in range(4)}}
        result = compute_derived_findings(
            rows, SignalsBundle(cautionary=[sig]), membership,
            dominant_product_id=None,
        )
        assert result.shade_signal_findings == []

    def test_excludes_non_dominant_product_rows(self) -> None:
        """Rows from other products don't feed the baseline or shade
        populations."""
        # Dominant product: 20 rows, all shade_a; 10 hits on signal.
        # Other product: 100 rows, ALL hit the same signal. If leak, the
        # baseline would be massively inflated and shade_a would not
        # appear over-represented.
        rows = [_shade_row(f"dom{i}", "shade_a", "P_dom") for i in range(20)]
        rows += [_shade_row(f"oth{i}", None, "P_other") for i in range(100)]
        sig = SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=110, coverage_ratio=0.92, sample_review_ids=[],
        )
        membership = {
            "s1": {f"dom{i}" for i in range(10)} | {f"oth{i}" for i in range(100)},
        }
        result = compute_derived_findings(
            rows, SignalsBundle(cautionary=[sig]), membership,
            dominant_product_id="P_dom",
        )
        # Within dominant product: 10 hits in 20 rows (shade_a = all).
        # Lift: 10/20 (shade rate) / 10/20 (product baseline) = 1.0 → no
        # finding, correctly.
        assert result.shade_signal_findings == []

    def test_requires_min_shade_size(self) -> None:
        """Long-tail shade with fewer than _MIN_SHADE_SIZE rows is
        suppressed even when fully concentrated."""
        rows = [_shade_row(f"a{i}", "rare_shade") for i in range(_MIN_SHADE_SIZE - 1)]
        rows += [_shade_row(f"b{i}", "common") for i in range(50)]
        sig = SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=9, coverage_ratio=0.15, sample_review_ids=[],
        )
        # All hits concentrated on rare_shade
        membership = {"s1": {f"a{i}" for i in range(_MIN_SHADE_SIZE - 1)}}
        result = compute_derived_findings(
            rows, SignalsBundle(cautionary=[sig]), membership,
            dominant_product_id="P_dom",
        )
        assert result.shade_signal_findings == []

    def test_requires_min_evidence_in_shade(self) -> None:
        """A single hit in a sizable shade is below the noise floor."""
        rows = [_shade_row(f"a{i}", "target") for i in range(20)]
        rows += [_shade_row(f"b{i}", "other") for i in range(20)]
        sig = SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=1, coverage_ratio=0.025, sample_review_ids=[],
        )
        membership = {"s1": {"a0"}}
        result = compute_derived_findings(
            rows, SignalsBundle(cautionary=[sig]), membership,
            dominant_product_id="P_dom",
        )
        assert result.shade_signal_findings == []

    def test_requires_min_lift(self) -> None:
        """Even 2 hits in a large shade don't surface when overall rate
        is already high (no real over-representation)."""
        # 50 target-shade rows, 50 other-shade rows. Signal hits 50 across
        # both shades uniformly (25 each). within = 25/50 = 50%,
        # overall = 50/100 = 50%, lift = 1.0.
        rows = [_shade_row(f"t{i}", "target") for i in range(50)]
        rows += [_shade_row(f"o{i}", "other") for i in range(50)]
        sig = SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=50, coverage_ratio=0.5, sample_review_ids=[],
        )
        membership = {
            "s1": {f"t{i}" for i in range(25)} | {f"o{i}" for i in range(25)},
        }
        result = compute_derived_findings(
            rows, SignalsBundle(cautionary=[sig]), membership,
            dominant_product_id="P_dom",
        )
        assert result.shade_signal_findings == []

    def test_surfaces_concentrated_finding(self) -> None:
        """Canonical case: signal heavily concentrated on one shade
        produces a finding with correct counts and lift."""
        # 20 target rows, 80 other rows. Signal hits 5 rows: all on target.
        # within = 5/20 = 25%, overall = 5/100 = 5%, lift = 5.0.
        rows = [_shade_row(f"t{i}", "target") for i in range(20)]
        rows += [_shade_row(f"o{i}", "other") for i in range(80)]
        sig = SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=5, coverage_ratio=0.05, sample_review_ids=[],
        )
        membership = {"s1": {f"t{i}" for i in range(5)}}
        result = compute_derived_findings(
            rows, SignalsBundle(cautionary=[sig]), membership,
            dominant_product_id="P_dom",
        )
        assert len(result.shade_signal_findings) == 1
        f = result.shade_signal_findings[0]
        assert f.product_id == "P_dom"
        assert f.shade == "target"
        assert f.signal_name == "s1"
        assert f.n_shade == 20
        assert f.n_signal_in_shade == 5
        assert f.within_shade_rate == 0.25
        assert f.overall_rate == 0.05
        assert f.lift == 5.0

    def test_missing_shade_rows_excluded_from_shade_buckets(self) -> None:
        """Rows in the dominant product but without a shade assignment
        still count toward the baseline denominator but do not populate
        any shade bucket. Tests overall_rate stays honest."""
        rows = [_shade_row(f"t{i}", "target") for i in range(15)]
        # 15 dominant-product rows with no shade → contribute to baseline
        # denominator only
        rows += [_shade_row(f"n{i}", None) for i in range(15)]
        sig = SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=5, coverage_ratio=5 / 30, sample_review_ids=[],
        )
        # 3 hits on target shade, 2 hits on no-shade rows (baseline only)
        membership = {"s1": {"t0", "t1", "t2", "n0", "n1"}}
        result = compute_derived_findings(
            rows, SignalsBundle(cautionary=[sig]), membership,
            dominant_product_id="P_dom",
        )
        # Baseline: 5 hits / 30 rows = 16.67%
        # target shade: 3 hits / 15 rows = 20%, lift = 1.2 → below _MIN_LIFT
        assert result.shade_signal_findings == []

    def test_accepts_json_string_derived(self) -> None:
        """Real DB rows carry derived as a JSON string."""
        rows = [_shade_row(f"t{i}", "target", use_json=True) for i in range(20)]
        rows += [_shade_row(f"o{i}", "other", use_json=True) for i in range(80)]
        sig = SignalCandidate(
            name="s1", display_label="S1", category="cautionary",
            evidence_count=5, coverage_ratio=0.05, sample_review_ids=[],
        )
        membership = {"s1": {f"t{i}" for i in range(5)}}
        result = compute_derived_findings(
            rows, SignalsBundle(cautionary=[sig]), membership,
            dominant_product_id="P_dom",
        )
        assert len(result.shade_signal_findings) == 1
        assert result.shade_signal_findings[0].shade == "target"
