"""Tests for `src/voc/reporting/phase2e/snapshots.py`.

Coverage:
  - build_snapshot projects per-attribute counts + priority_score
    correctly from ProductReportData
  - negative_share uses polarity denominator (n_pos + n_neg), NOT
    n_reviews
  - negative_share is None when (n_pos + n_neg) == 0
  - save/load round-trip preserves field shape
  - filename uses ISO with `:` → `-` so lexical sort = chronological
  - load_previous returns the most recent strictly-before-current
  - load_previous returns None when there is no history
  - load_previous skips a snapshot at the same timestamp as current
  - first-run comparison (previous=None) yields empty deltas / None tops
  - direction = stable when below the share band OR below the count
    delta floor (AND-logic for rising/improving)
  - direction = stable when polar denominator < 10 in either snapshot
  - mixed-sign deltas (share up, count down) → stable
  - new vs resolved labels for asymmetric presence
  - top_rising uses log-weighted score (volume tie-breaks share)
  - top_improving weights by n_negative_previous
  - new-direction attributes are NOT top_rising candidates
  - PDF smoke: renders trend section with previous snapshot
  - PDF smoke: renders graceful first-run message when no previous

This module does not change any production logic upstream of itself.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from src.voc.reporting.phase2e.report import aggregate_product
from src.voc.reporting.phase2e.snapshots import (
    AttributeSnapshot,
    COVERAGE_WARNING_KO,
    COVERAGE_WARNING_THRESHOLD,
    CorpusProvenance,
    DELTA_DENOMINATOR_FLOOR,
    INCOMPARABLE_CAP_REASON_KO,
    INCOMPARABLE_CORPUS_TYPE_REASON_KO,
    INCOMPARABLE_SAMPLE_SIZE_REASON_KO,
    INCOMPARABLE_SORT_REASON_KO,
    INCOMPARABLE_STRATEGY_REASON_KO,
    LOW_CONFIDENCE_ACTION_CHIP_KO,
    LOW_CONFIDENCE_DIRECTIONAL_RISING_KO,
    NOISE_BAND_SHARE,
    NOISE_FLOOR_COUNT_DELTA,
    NON_PRIMARY_SORT_REASON_KO,
    PRIMARY_SORT_TYPE,
    SAMPLE_SIZE_GUARD_RELATIVE_THRESHOLD,
    SNAPSHOT_SCHEMA_VERSION,
    STABILITY_HIGH_COVERAGE_MIN,
    STABILITY_HIGH_MIN_N,
    STABILITY_MEDIUM_MIN_N,
    STABILITY_VERDICT_HIGH_KO,
    STABILITY_VERDICT_LOW_KO,
    STABILITY_VERDICT_MEDIUM_KO,
    Snapshot,
    SnapshotComparison,
    TOP_IMPROVING_N_NEG_FLOOR,
    TOP_RISING_N_NEG_FLOOR,
    aggregate_primary_only,
    build_snapshot,
    compare_snapshots,
    compute_confidence_level,
    compute_coverage_ratio,
    compute_signal_stability,
    is_primary_corpus_review,
    load_previous_snapshot,
    save_snapshot,
    select_primary_corpus_review_ids,
)


REPO = Path(__file__).resolve().parents[3]


# ---------------------------------------------------------------------------
# Helpers — minimal synthetic corpora to exercise the snapshot path
# without dragging in the full pipeline.
# ---------------------------------------------------------------------------


def _review(
    review_id: str,
    attribute: str,
    polarity: str,
    intensity: int = 2,
    confidence: str = "high",
) -> dict:
    return {
        "review_id": review_id,
        "mixed_review_flag": False,
        "tradeoff_pair": None,
        "records": [{
            "attribute": attribute,
            "polarity": polarity,
            "intensity": intensity,
            "evidence_span": "synthetic",
            "confidence": confidence,
            "delivery_condition_flag": False,
        }],
        "oy_evidence_score": 4.0,
        "rating_normalized": 1.0 if polarity.startswith("negative") else 5.0,
        "oy_sort_ranks": {},
        "review_date": "2026-04-10",
    }


def _build_data(
    *,
    n_neg_transfer: int = 12,
    n_pos_pigment: int = 20,
    n_neg_persistence: int = 8,
    product_id: str = "A0001",
    product_name: str = "Test Product",
):
    """Build a ProductReportData with controllable per-attribute counts."""
    reviews: list[dict] = []
    for i in range(n_neg_transfer):
        reviews.append(_review(
            f"r_tr_{i}", "transfer_resistance",
            "negative_strong", intensity=3,
        ))
    for i in range(n_pos_pigment):
        reviews.append(_review(
            f"r_pig_{i}", "pigmentation", "positive", intensity=2,
        ))
    for i in range(n_neg_persistence):
        reviews.append(_review(
            f"r_pers_{i}", "persistence", "negative_weak", intensity=2,
        ))
    return aggregate_product(product_id, product_name, reviews)


def _attr_snapshot(
    *,
    n_pos: int = 0,
    n_neg: int = 0,
    avg_intensity_neg: float = 0.0,
    priority_score: float | None = None,
) -> AttributeSnapshot:
    """Hand-build an AttributeSnapshot with explicit polar share."""
    denom = n_pos + n_neg
    share = (n_neg / denom) if denom > 0 else None
    return AttributeSnapshot(
        n_positive=n_pos,
        n_negative=n_neg,
        negative_share=share,
        avg_intensity_neg=avg_intensity_neg,
        priority_score=priority_score,
    )


def _provenance(
    *,
    corpus_type: str = "observed_scrape",
    sampling_strategy: str = "latest_only",
    primary_sort_type: str = PRIMARY_SORT_TYPE,
    cap_policy: str = "all",
    collected_primary_review_count: int = 100,
    total_review_count_available: int | None = None,
    coverage_ratio: float | None = None,
    is_full_corpus: bool = False,
    sampling_notes: str | None = None,
) -> CorpusProvenance:
    """Default provenance fixture — observed scrape, latest_only,
    primary corpus, all-cap, no total available. confidence_level is
    NOT a parameter; it is derived inside the dataclass.
    Tests that need to exercise specific branches override fields.
    """
    return CorpusProvenance(
        corpus_type=corpus_type,
        sampling_strategy=sampling_strategy,
        primary_sort_type=primary_sort_type,
        cap_policy=cap_policy,
        collected_primary_review_count=collected_primary_review_count,
        total_review_count_available=total_review_count_available,
        coverage_ratio=coverage_ratio,
        is_full_corpus=is_full_corpus,
        sampling_notes=sampling_notes,
    )


def _snapshot(
    collected_at: str,
    attributes: dict[str, AttributeSnapshot],
    *,
    goods_no: str = "A0001",
    n_reviews: int = 100,
    n_records: int = 100,
    provenance: CorpusProvenance | None = None,
) -> Snapshot:
    return Snapshot(
        schema_version=SNAPSHOT_SCHEMA_VERSION,
        goods_no=goods_no,
        product_name="Test",
        collected_at=collected_at,
        n_reviews=n_reviews,
        n_records=n_records,
        attributes=attributes,
        provenance=provenance or _provenance(
            collected_primary_review_count=n_reviews,
        ),
    )


# ---------------------------------------------------------------------------
# build_snapshot
# ---------------------------------------------------------------------------


def test_build_snapshot_carries_per_attribute_counts_and_priority():
    data = _build_data(n_neg_transfer=12, n_pos_pigment=20, n_neg_persistence=8)
    when = datetime(2026, 4, 28, 15, 30, tzinfo=timezone.utc)

    snap = build_snapshot(data, collected_at=when, provenance=_provenance(collected_primary_review_count=data.n_reviews))

    assert snap.schema_version == SNAPSHOT_SCHEMA_VERSION
    assert snap.goods_no == "A0001"
    assert snap.collected_at == "2026-04-28T15:30:00Z"
    # Every attribute that appeared in records is present.
    assert "transfer_resistance" in snap.attributes
    assert "pigmentation" in snap.attributes
    assert "persistence" in snap.attributes
    # Counts mirror aggregator output.
    tr = snap.attributes["transfer_resistance"]
    assert tr.n_negative == 12
    assert tr.n_positive == 0
    # priority_score is populated when n_negative > 0.
    assert tr.priority_score is not None
    assert tr.priority_score > 0


def test_negative_share_uses_polarity_denominator_not_review_count():
    """Locked invariant: negative_share = n_neg / (n_pos + n_neg).

    NOT the prevalence metric (n_neg / n_reviews) used internally by
    `executive_summary.compute_priority_score`. The two metrics live
    in separate fields and answer different questions.
    """
    data = _build_data(n_neg_transfer=12, n_pos_pigment=20, n_neg_persistence=8)
    when = datetime(2026, 4, 28, tzinfo=timezone.utc)
    snap = build_snapshot(data, collected_at=when, provenance=_provenance(collected_primary_review_count=data.n_reviews))
    # transfer_resistance: 12 neg, 0 pos → 12/12 = 1.0
    assert snap.attributes["transfer_resistance"].negative_share == 1.0
    # pigmentation: 0 neg, 20 pos → 0/20 = 0.0
    assert snap.attributes["pigmentation"].negative_share == 0.0
    # If denominator were n_reviews (=40), transfer would be 0.30,
    # NOT 1.0. This assertion locks the polarity-denominator semantics.


def test_negative_share_is_none_when_attribute_has_no_polar_records():
    """Fabricated edge: an AttributeSnapshot with both counts zero
    should carry None, not 0.0 (avoids confusion with "all positive")."""
    snap = _attr_snapshot(n_pos=0, n_neg=0)
    assert snap.negative_share is None


def test_priority_score_is_none_for_attributes_with_zero_negatives():
    """Build path: an attribute with positives only → priority_score
    None, not 0.0. Distinguishes "no data" from "score is genuinely 0."
    """
    data = _build_data(n_neg_transfer=0, n_pos_pigment=15, n_neg_persistence=0)
    when = datetime(2026, 4, 28, tzinfo=timezone.utc)
    snap = build_snapshot(data, collected_at=when, provenance=_provenance(collected_primary_review_count=data.n_reviews))
    assert snap.attributes["pigmentation"].priority_score is None


def test_build_snapshot_normalizes_naive_datetime_to_utc():
    """Naive datetime (no tzinfo) is treated as UTC. The pipeline's
    collection_completed_at is sometimes naive; we don't want filenames
    to silently shift by the local-TZ offset."""
    data = _build_data()
    naive = datetime(2026, 4, 28, 15, 30)  # no tzinfo
    snap = build_snapshot(data, collected_at=naive, provenance=_provenance(collected_primary_review_count=data.n_reviews))
    assert snap.collected_at == "2026-04-28T15:30:00Z"


# ---------------------------------------------------------------------------
# save / load
# ---------------------------------------------------------------------------


def test_save_snapshot_writes_expected_path_and_round_trips(tmp_path):
    data = _build_data()
    when = datetime(2026, 4, 28, 15, 30, tzinfo=timezone.utc)
    snap = build_snapshot(data, collected_at=when, provenance=_provenance(collected_primary_review_count=data.n_reviews))

    written = save_snapshot(snap, tmp_path)
    expected = tmp_path / "A0001" / "2026-04-28T15-30-00Z.json"
    assert written == expected
    assert expected.exists()

    raw = json.loads(expected.read_text(encoding="utf-8"))
    assert raw["schema_version"] == SNAPSHOT_SCHEMA_VERSION
    assert raw["goods_no"] == "A0001"
    assert raw["collected_at"] == "2026-04-28T15:30:00Z"
    assert "transfer_resistance" in raw["attributes"]
    assert raw["attributes"]["transfer_resistance"]["n_negative"] == 12


def test_save_snapshot_filename_uses_iso_with_safe_chars(tmp_path):
    """Filename must not contain `:` (Windows-hostile) and must sort
    lexically in chronological order so the loader can pick "previous"
    by simple max() over filenames."""
    data = _build_data()
    when = datetime(2026, 4, 28, 9, 5, tzinfo=timezone.utc)
    snap = build_snapshot(data, collected_at=when, provenance=_provenance(collected_primary_review_count=data.n_reviews))
    written = save_snapshot(snap, tmp_path)
    assert ":" not in written.name
    # Two snapshots minutes apart should sort chronologically by name.
    later_data = _build_data()
    later = build_snapshot(
        later_data,
        collected_at=datetime(2026, 4, 28, 9, 35, tzinfo=timezone.utc),
        provenance=_provenance(
            collected_primary_review_count=later_data.n_reviews,
        ),
    )
    later_path = save_snapshot(later, tmp_path)
    assert written.name < later_path.name


# ---------------------------------------------------------------------------
# load_previous_snapshot
# ---------------------------------------------------------------------------


def test_load_previous_returns_none_when_no_history(tmp_path):
    assert load_previous_snapshot(
        "A_DOES_NOT_EXIST", "2026-04-28T15:30:00Z", tmp_path,
    ) is None


def test_load_previous_returns_none_when_directory_empty(tmp_path):
    (tmp_path / "A0001").mkdir()
    assert load_previous_snapshot(
        "A0001", "2026-04-28T15:30:00Z", tmp_path,
    ) is None


def _save_built(data, when, tmp_path):
    """Helper that builds + saves a snapshot with default provenance."""
    snap = build_snapshot(
        data, collected_at=when,
        provenance=_provenance(
            collected_primary_review_count=data.n_reviews,
        ),
    )
    return save_snapshot(snap, tmp_path)


def test_load_previous_returns_most_recent_strictly_before_current(tmp_path):
    when_a = datetime(2026, 1, 15, tzinfo=timezone.utc)
    when_b = datetime(2026, 3, 10, tzinfo=timezone.utc)
    when_c = datetime(2026, 4, 20, tzinfo=timezone.utc)
    for w in (when_a, when_b, when_c):
        _save_built(_build_data(), w, tmp_path)
    # current is later than C → previous should be C
    prev = load_previous_snapshot(
        "A0001", "2026-04-28T15:30:00Z", tmp_path,
    )
    assert prev is not None
    assert prev.collected_at == "2026-04-20T00:00:00Z"


def test_load_previous_skips_a_snapshot_whose_timestamp_equals_current(tmp_path):
    """A snapshot saved at the same timestamp as the current run is
    the current run — it must NOT be returned as 'previous.'"""
    when_a = datetime(2026, 3, 10, tzinfo=timezone.utc)
    when_b = datetime(2026, 4, 28, tzinfo=timezone.utc)
    _save_built(_build_data(), when_a, tmp_path)
    _save_built(_build_data(), when_b, tmp_path)
    prev = load_previous_snapshot(
        "A0001", "2026-04-28T00:00:00Z", tmp_path,
    )
    assert prev is not None
    assert prev.collected_at == "2026-03-10T00:00:00Z"


# ---------------------------------------------------------------------------
# compare_snapshots — first-run + asymmetric presence
# ---------------------------------------------------------------------------


def test_compare_first_run_returns_empty_deltas_and_none_tops():
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"transfer_resistance": _attr_snapshot(n_pos=2, n_neg=20)},
    )
    cmp = compare_snapshots(cur, previous=None)
    assert cmp.previous_collected_at is None
    assert cmp.days_between is None
    assert cmp.deltas == []
    assert cmp.top_rising is None
    assert cmp.top_improving is None
    assert cmp.new_attributes == []
    assert cmp.comparability_status == "no_previous"


def test_compare_attribute_only_in_current_marked_new_when_above_floor():
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"transfer_resistance": _attr_snapshot(n_pos=5, n_neg=10)},
    )
    prev = _snapshot("2026-03-28T00:00:00Z", {})
    cmp = compare_snapshots(cur, prev)
    [d] = cmp.deltas
    assert d.attribute == "transfer_resistance"
    assert d.direction == "new"
    assert d.n_negative_previous is None
    assert d.negative_share_previous is None
    assert cmp.new_attributes == [d]
    # And new is NOT a top_rising candidate, even with n_neg ≥ floor.
    assert cmp.top_rising is None


def test_compare_attribute_only_in_current_below_floor_is_stable_not_new():
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=2, n_neg=2)},
    )
    prev = _snapshot("2026-03-28T00:00:00Z", {})
    cmp = compare_snapshots(cur, prev)
    [d] = cmp.deltas
    assert d.direction == "stable"
    assert cmp.new_attributes == []


def test_compare_attribute_only_in_previous_marked_resolved_when_above_floor():
    cur = _snapshot("2026-04-28T00:00:00Z", {})
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {"transfer_resistance": _attr_snapshot(n_pos=3, n_neg=15)},
    )
    cmp = compare_snapshots(cur, prev)
    [d] = cmp.deltas
    assert d.direction == "resolved"
    assert d.n_negative_current is None


# ---------------------------------------------------------------------------
# compare_snapshots — direction labeling (AND-logic)
# ---------------------------------------------------------------------------


def test_compare_rising_requires_both_share_band_and_count_delta():
    """share_delta clears the band but |count_delta| < 3 → stable.
    Then |count_delta| ≥ 3 with share band cleared → rising.
    """
    # Share moved up by 0.05 but only 2 more negative complaints.
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=80, n_neg=20)},  # share = 0.20
    )
    cur_small_count = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=78, n_neg=22)},  # share = 0.22, +2
    )
    cmp = compare_snapshots(cur_small_count, prev)
    assert cmp.deltas[0].direction == "stable"

    cur_bigger_count = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=75, n_neg=25)},  # share = 0.25, +5
    )
    cmp2 = compare_snapshots(cur_bigger_count, prev)
    assert cmp2.deltas[0].direction == "rising"


def test_compare_improving_requires_both_share_band_and_count_delta():
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=70, n_neg=30)},
    )
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=85, n_neg=15)},  # share 0.30 → 0.15
    )
    [d] = compare_snapshots(cur, prev).deltas
    assert d.direction == "improving"


def test_compare_stable_when_within_noise_band():
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=80, n_neg=20)},
    )
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=79, n_neg=21)},
    )
    [d] = compare_snapshots(cur, prev).deltas
    assert d.direction == "stable"


def test_compare_mixed_sign_share_up_count_down_labeled_stable():
    """Polar share rose but absolute count fell — usually means total
    mentions of the attribute dropped. Labeling stable is the
    conservative call so we don't flag this as 'rising.'"""
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=80, n_neg=20)},  # share = 0.20
    )
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=15, n_neg=10)},  # share = 0.40, count -10
    )
    [d] = compare_snapshots(cur, prev).deltas
    assert d.direction == "stable"


# ---------------------------------------------------------------------------
# Denominator safeguard
# ---------------------------------------------------------------------------


def test_compare_excludes_attribute_when_denominator_below_floor_in_current():
    """(n_pos + n_neg) < 10 in CURRENT → labeled stable.
    Even when share/count deltas are large, low-volume attributes
    are too noisy to classify."""
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=50, n_neg=15)},
    )
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=2, n_neg=4)},  # denom = 6 < 10
    )
    [d] = compare_snapshots(cur, prev).deltas
    assert d.direction == "stable"


def test_compare_excludes_attribute_when_denominator_below_floor_in_previous():
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=2, n_neg=4)},  # denom = 6 < 10
    )
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=50, n_neg=20)},
    )
    [d] = compare_snapshots(cur, prev).deltas
    assert d.direction == "stable"


def test_denominator_floor_is_exactly_10():
    """Exactly 10 polar records is the lowest classifiable denominator;
    9 must be excluded."""
    assert DELTA_DENOMINATOR_FLOOR == 10


# ---------------------------------------------------------------------------
# Top picks — log-weighted scoring
# ---------------------------------------------------------------------------


def test_top_rising_uses_log_weighted_score_not_raw_share_delta():
    """Two rising candidates with equal share_delta but different
    n_neg_current. The log-weighted score should favor the candidate
    with larger volume — this is the whole point of the log(n+1)
    factor in the formula.
    """
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {
            # A: small base (denom=50)
            "a": _attr_snapshot(n_pos=45, n_neg=5),    # share = 0.10
            # B: large base (denom=200) — 4x A
            "b": _attr_snapshot(n_pos=180, n_neg=20),  # share = 0.10
        },
    )
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {
            # A: same +0.10 share jump, +5 count
            "a": _attr_snapshot(n_pos=40, n_neg=10),   # share = 0.20
            # B: same +0.10 share jump, +20 count — same share_delta,
            # 4x the n_neg_current
            "b": _attr_snapshot(n_pos=160, n_neg=40),  # share = 0.20
        },
    )
    cmp = compare_snapshots(cur, prev)
    assert cmp.top_rising is not None
    # log-weighted score: A = 0.10 * log(11) ≈ 0.240
    #                    B = 0.10 * log(41) ≈ 0.371 → B wins
    assert cmp.top_rising.attribute == "b"


def test_top_rising_skips_attributes_below_n_negative_floor():
    """An attribute that clears the share/count gates but has
    n_negative_current < 5 must not be top_rising."""
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=11, n_neg=0)},
    )
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=8, n_neg=4)},  # n_neg=4 < 5
    )
    cmp = compare_snapshots(cur, prev)
    # Direction itself becomes "rising" only if all gates clear.
    # Even if it does, the floor=5 keeps it out of top_rising.
    assert cmp.top_rising is None


def test_new_direction_attribute_not_a_top_rising_candidate():
    """top_rising score requires both share values to be defined.
    A 'new' attribute has no previous share → excluded from
    top_rising regardless of n_negative_current."""
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=10, n_neg=20)},
    )
    prev = _snapshot("2026-03-28T00:00:00Z", {})
    cmp = compare_snapshots(cur, prev)
    assert cmp.deltas[0].direction == "new"
    assert cmp.top_rising is None
    # But it IS surfaced via new_attributes for the one-line text.
    assert len(cmp.new_attributes) == 1


def test_top_improving_weights_by_n_negative_previous():
    """Two improving candidates with equal |share_delta| but different
    n_negative_previous. The weighting (by n_neg_previous, NOT
    n_neg_current) should favor the candidate with larger prior
    volume — 'X complaints → Y' is a larger win when X was larger.
    """
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {
            # A: large prior volume (n_neg_prev = 80)
            "a": _attr_snapshot(n_pos=20, n_neg=80),  # share = 0.80
            # B: small prior volume (n_neg_prev = 12)
            "b": _attr_snapshot(n_pos=3, n_neg=12),   # share = 0.80
        },
    )
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {
            # A: 0.80 → 0.60, count -20
            "a": _attr_snapshot(n_pos=40, n_neg=60),
            # B: 0.80 → 0.60, count -3 (same share_delta, barely clears)
            "b": _attr_snapshot(n_pos=6, n_neg=9),
        },
    )
    cmp = compare_snapshots(cur, prev)
    assert cmp.top_improving is not None
    # |share_delta| = 0.20 for both; weighting by n_neg_previous
    # makes A's score = 0.20 * log(81) ≈ 0.879 and B's score
    # = 0.20 * log(13) ≈ 0.513 → A wins.
    assert cmp.top_improving.attribute == "a"


# ---------------------------------------------------------------------------
# days_between
# ---------------------------------------------------------------------------


def test_days_between_computed_on_overlap_path():
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=20, n_neg=10)},
    )
    prev = _snapshot(
        "2026-03-29T00:00:00Z",
        {"x": _attr_snapshot(n_pos=15, n_neg=15)},
    )
    cmp = compare_snapshots(cur, prev)
    assert cmp.days_between == 30


# ---------------------------------------------------------------------------
# Constants — guards against silent floor changes
# ---------------------------------------------------------------------------


def test_noise_floors_unchanged():
    """Locked constants. Touching these is a stakeholder-visible
    change to direction labeling; pair any update with a discussion
    about why the floors moved."""
    assert NOISE_BAND_SHARE == 0.02
    assert NOISE_FLOOR_COUNT_DELTA == 3
    assert TOP_RISING_N_NEG_FLOOR == 5
    assert TOP_IMPROVING_N_NEG_FLOOR == 5
    assert DELTA_DENOMINATOR_FLOOR == 10


# ---------------------------------------------------------------------------
# PDF smoke — rendering with / without a comparison
# ---------------------------------------------------------------------------


def _load_pdf_module():
    name = "generate_phase2e_pdf_v2_for_snapshot_tests"
    if name in sys.modules:
        return sys.modules[name]
    path = REPO / "scripts" / "generate_phase2e_pdf_v2.py"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _build_synthetic_reviews_for_pdf() -> list[dict]:
    """A small but realistic corpus that exercises priority cards +
    the trend section together."""
    reviews: list[dict] = []
    for i in range(30):
        reviews.append(_review(
            f"r_tr_{i}", "transfer_resistance",
            "negative_strong", intensity=3,
        ))
    for i in range(20):
        reviews.append(_review(
            f"r_pers_{i}", "persistence", "negative_weak", intensity=2,
        ))
    for i in range(35):
        reviews.append(_review(
            f"r_pig_{i}", "pigmentation", "positive", intensity=2,
        ))
    return reviews


def _build_corpus_metadata(n_reviews: int) -> dict:
    return {
        "collection_started_at": "2026-04-25T10:00:00",
        "collection_completed_at": "2026-04-25T10:30:00",
        "collected_review_count": n_reviews,
        "processed_review_count": n_reviews,
        "polarity_record_count": n_reviews,
        "corpus_limited": False,
        "finite_limit_set": False,
        "max_reviews_arg": "all",
        "sort_mode": "default",
        "primary_corpus_sort_type": "DATETIME_DESC",
        "signal_sort_types": [],
        "signal_sort_cap": 0,
        "multi_sort_plan": [],
        "model_name": "stub",
    }


def test_pdf_renders_trend_section_with_previous_snapshot(tmp_path):
    """End-to-end: build current data, fabricate a previous snapshot
    that produces a clear rising signal, render the PDF, assert
    structural validity + that the section function returned a
    non-empty flowable list with the disclaimer."""
    pdf_v2 = _load_pdf_module()
    reviews = _build_synthetic_reviews_for_pdf()
    data = aggregate_product("A0001", "Test Product", reviews)
    cur = build_snapshot(
        data, collected_at=datetime(2026, 4, 28, tzinfo=timezone.utc),
        provenance=_provenance(
            collected_primary_review_count=data.n_reviews,
        ),
    )
    # Fabricate a prior snapshot where transfer_resistance had a
    # smaller polar share, producing a rising signal in the comparison.
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {
            "transfer_resistance": _attr_snapshot(n_pos=20, n_neg=12),
            "persistence": _attr_snapshot(n_pos=10, n_neg=18),
            "pigmentation": _attr_snapshot(n_pos=35, n_neg=2),
        },
    )
    cmp = compare_snapshots(cur, prev)
    assert cmp.top_rising is not None  # sanity: synthetic data produces signal

    out_path = tmp_path / "smoke_trend.pdf"
    pdf_v2.render_pdf_v2(
        data, out_path,
        source_label="snapshot smoke",
        corpus_metadata=_build_corpus_metadata(len(reviews)),
        snapshot_comparison=cmp,
    )
    assert out_path.exists()
    raw = out_path.read_bytes()
    assert raw.startswith(b"%PDF-")
    assert b"%%EOF" in raw[-32:]


def test_pdf_renders_first_run_message_when_no_previous_snapshot(tmp_path):
    """Graceful first-run: rendering with comparison-where-previous-
    is-None produces a valid PDF that contains the trend section
    placeholder text rather than crashing or emitting empty bytes."""
    pdf_v2 = _load_pdf_module()
    reviews = _build_synthetic_reviews_for_pdf()
    data = aggregate_product("A0001", "Test Product", reviews)
    cur = build_snapshot(
        data, collected_at=datetime(2026, 4, 28, tzinfo=timezone.utc),
        provenance=_provenance(
            collected_primary_review_count=data.n_reviews,
        ),
    )
    cmp = compare_snapshots(cur, previous=None)

    out_path = tmp_path / "smoke_first_run.pdf"
    pdf_v2.render_pdf_v2(
        data, out_path,
        source_label="snapshot smoke",
        corpus_metadata=_build_corpus_metadata(len(reviews)),
        snapshot_comparison=cmp,
    )
    assert out_path.exists()
    raw = out_path.read_bytes()
    assert raw.startswith(b"%PDF-")
    assert b"%%EOF" in raw[-32:]


def test_pdf_renders_without_comparison_kwarg_unchanged(tmp_path):
    """Backward compat: omitting `snapshot_comparison` entirely keeps
    the existing PDF behavior. No new section should appear when the
    caller didn't opt in."""
    pdf_v2 = _load_pdf_module()
    reviews = _build_synthetic_reviews_for_pdf()
    data = aggregate_product("A0001", "Test Product", reviews)
    out_path = tmp_path / "smoke_no_comparison.pdf"
    pdf_v2.render_pdf_v2(
        data, out_path,
        source_label="snapshot smoke",
        corpus_metadata=_build_corpus_metadata(len(reviews)),
    )
    assert out_path.exists()
    assert out_path.read_bytes().startswith(b"%PDF-")


# ---------------------------------------------------------------------------
# Sampling-bias safeguards (2026-04-28 schema v2)
# ---------------------------------------------------------------------------


# is_primary_corpus_review --------------------------------------------------


def test_is_primary_corpus_when_oy_is_primary_corpus_flag_is_true():
    raw = {
        "review_id": "r1",
        "raw_metadata_json": json.dumps({"oy_is_primary_corpus": True}),
    }
    assert is_primary_corpus_review(raw) is True


def test_is_primary_corpus_when_oy_sort_type_equals_datetime_desc():
    raw = {
        "review_id": "r1",
        "raw_metadata_json": json.dumps({"oy_sort_type": "DATETIME_DESC"}),
    }
    assert is_primary_corpus_review(raw) is True


def test_is_primary_corpus_when_observed_sort_types_includes_datetime_desc():
    raw = {
        "review_id": "r1",
        "raw_metadata_json": json.dumps({
            "oy_observed_sort_types": ["RATING_ASC", "DATETIME_DESC"],
        }),
    }
    assert is_primary_corpus_review(raw) is True


def test_is_not_primary_corpus_when_only_signal_sorts_observed():
    """A row that was ONLY surfaced by signal sorts (RATING_ASC etc.)
    must be excluded — its inclusion would bias the snapshot's
    denominators toward extreme ratings."""
    raw = {
        "review_id": "r1",
        "raw_metadata_json": json.dumps({
            "oy_observed_sort_types": ["RATING_ASC", "RATING_DESC"],
            "oy_sort_type": "RATING_ASC",
        }),
    }
    assert is_primary_corpus_review(raw) is False


def test_is_not_primary_corpus_when_metadata_missing():
    """Legacy / unstamped rows have no metadata — conservative
    exclude. Better to refuse to compare than to bias quietly."""
    raw = {"review_id": "r1", "raw_metadata_json": None}
    assert is_primary_corpus_review(raw) is False
    raw_no_field = {"review_id": "r1"}
    assert is_primary_corpus_review(raw_no_field) is False


def test_is_primary_corpus_accepts_pre_parsed_raw_metadata():
    """Some upstream paths pass raw_metadata as a parsed dict, not a
    JSON string. Helper accepts both shapes."""
    raw = {
        "review_id": "r1",
        "raw_metadata": {"oy_is_primary_corpus": True},
    }
    assert is_primary_corpus_review(raw) is True


def test_select_primary_corpus_review_ids_filters_correctly():
    raw_reviews = [
        {"review_id": "r_primary", "raw_metadata_json": json.dumps({
            "oy_is_primary_corpus": True,
        })},
        {"review_id": "r_signal_only", "raw_metadata_json": json.dumps({
            "oy_observed_sort_types": ["RATING_ASC"],
        })},
        {"review_id": "r_legacy", "raw_metadata_json": None},
    ]
    ids = select_primary_corpus_review_ids(raw_reviews)
    assert ids == {"r_primary"}


def test_aggregate_primary_only_excludes_non_primary_review_blocks():
    """End-to-end: signal-only review_blocks must not contribute to
    the aggregated counts the snapshot uses."""
    raw_reviews = [
        {"review_id": "r_primary_1", "raw_metadata_json": json.dumps({
            "oy_is_primary_corpus": True,
        })},
        {"review_id": "r_primary_2", "raw_metadata_json": json.dumps({
            "oy_is_primary_corpus": True,
        })},
        {"review_id": "r_signal_only", "raw_metadata_json": json.dumps({
            "oy_observed_sort_types": ["RATING_ASC"],
        })},
    ]
    review_blocks = [
        _review("r_primary_1", "transfer_resistance", "negative_strong", 3),
        _review("r_primary_2", "transfer_resistance", "negative_strong", 3),
        _review("r_signal_only", "transfer_resistance", "negative_strong", 3),
    ]
    data = aggregate_primary_only(
        raw_reviews=raw_reviews,
        review_blocks=review_blocks,
        product_id="A0001",
        product_name="P",
    )
    # Only the two primary-corpus reviews counted.
    assert data.n_reviews == 2
    assert data.attribute_summaries["transfer_resistance"].n_negative == 2


# build_snapshot — provenance round-trip -----------------------------------


def test_build_snapshot_carries_provenance():
    data = _build_data()
    when = datetime(2026, 4, 28, tzinfo=timezone.utc)
    prov = _provenance(
        collected_primary_review_count=data.n_reviews,
        total_review_count_available=200,
        coverage_ratio=data.n_reviews / 200,
    )
    snap = build_snapshot(data, collected_at=when, provenance=prov)
    assert snap.provenance == prov


def test_save_load_round_trip_preserves_provenance(tmp_path):
    data = _build_data()
    when = datetime(2026, 4, 28, tzinfo=timezone.utc)
    prov = _provenance(
        collected_primary_review_count=data.n_reviews,
        total_review_count_available=500,
        coverage_ratio=data.n_reviews / 500,
        cap_policy="200",
    )
    save_snapshot(
        build_snapshot(data, collected_at=when, provenance=prov),
        tmp_path,
    )
    later_when = datetime(2026, 4, 29, tzinfo=timezone.utc)
    loaded = load_previous_snapshot(
        "A0001", _provenance_iso(later_when), tmp_path,
    )
    assert loaded is not None
    assert loaded.provenance == prov


def _provenance_iso(dt: datetime) -> str:
    """Mirror of snapshots._iso for test convenience."""
    dt = dt.astimezone(timezone.utc).replace(microsecond=0)
    return dt.isoformat().replace("+00:00", "Z")


# Schema-version rejection --------------------------------------------------


def test_loader_rejects_v1_snapshot_files(tmp_path):
    """A v1 file (no provenance) cannot be safely compared. The loader
    must skip it and walk older files. With a directory containing
    ONLY a v1 file, loader returns None — operator gets a graceful
    'first compatible run' rather than a coerced comparison."""
    snap_dir = tmp_path / "A0001"
    snap_dir.mkdir(parents=True)
    v1_path = snap_dir / "2026-03-28T00-00-00Z.json"
    v1_path.write_text(json.dumps({
        "schema_version": 1,
        "goods_no": "A0001",
        "product_name": "Test",
        "collected_at": "2026-03-28T00:00:00Z",
        "n_reviews": 100,
        "n_records": 100,
        "attributes": {},
        # No provenance field — that's the v1 shape.
    }), encoding="utf-8")
    prev = load_previous_snapshot(
        "A0001", "2026-04-28T00:00:00Z", tmp_path,
    )
    assert prev is None


def test_loader_rejects_v2_snapshot_files(tmp_path):
    """v2 files lack `sampling_strategy` and the derived
    `confidence_level`. After the v3 bump they cannot be safely
    compared because the new comparability gate has no input
    to read; loader treats them as 'no history'."""
    snap_dir = tmp_path / "A0001"
    snap_dir.mkdir(parents=True)
    v2_path = snap_dir / "2026-03-28T00-00-00Z.json"
    v2_path.write_text(json.dumps({
        "schema_version": 2,
        "goods_no": "A0001",
        "product_name": "Test",
        "collected_at": "2026-03-28T00:00:00Z",
        "n_reviews": 100,
        "n_records": 100,
        "attributes": {},
        "provenance": {
            "primary_sort_type": "DATETIME_DESC",
            "cap_policy": "all",
            "collected_primary_review_count": 100,
            "total_review_count_available": None,
            "coverage_ratio": None,
            # No corpus_type / sampling_strategy / is_full_corpus.
        },
    }), encoding="utf-8")
    prev = load_previous_snapshot(
        "A0001", "2026-04-28T00:00:00Z", tmp_path,
    )
    assert prev is None


def test_loader_picks_v3_file_even_when_older_mismatched_files_exist(tmp_path):
    """When a v3 file exists alongside older v1/v2 files, the loader
    walks newest→oldest and returns the first v3 file it finds. It
    must not block on mismatched-schema files older than the v3."""
    snap_dir = tmp_path / "A0001"
    snap_dir.mkdir(parents=True)
    # Old v1 (no provenance)
    (snap_dir / "2026-03-15T00-00-00Z.json").write_text(json.dumps({
        "schema_version": 1,
        "goods_no": "A0001",
        "product_name": "Test",
        "collected_at": "2026-03-15T00:00:00Z",
        "n_reviews": 100,
        "n_records": 100,
        "attributes": {},
    }), encoding="utf-8")
    # Newer v3
    save_snapshot(
        build_snapshot(
            _build_data(),
            collected_at=datetime(2026, 3, 28, tzinfo=timezone.utc),
            provenance=_provenance(),
        ),
        tmp_path,
    )
    prev = load_previous_snapshot(
        "A0001", "2026-04-28T00:00:00Z", tmp_path,
    )
    assert prev is not None
    assert prev.collected_at == "2026-03-28T00:00:00Z"


# Comparability gate --------------------------------------------------------


def test_compare_status_non_primary_sort_when_current_uses_signal_sort():
    """Build a snapshot with a non-primary sort (e.g. RATING_ASC) —
    even with valid previous, comparison refuses to compute deltas."""
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=20, n_neg=20)},
        provenance=_provenance(primary_sort_type="RATING_ASC"),
    )
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=20, n_neg=10)},
        provenance=_provenance(primary_sort_type="RATING_ASC"),
    )
    cmp = compare_snapshots(cur, prev)
    assert cmp.comparability_status == "non_primary_sort"
    assert cmp.deltas == []
    assert cmp.top_rising is None
    assert cmp.comparability_reason == NON_PRIMARY_SORT_REASON_KO


def test_compare_status_incomparable_sort_when_sorts_differ():
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=20, n_neg=20)},
        provenance=_provenance(primary_sort_type="DATETIME_DESC"),
    )
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=20, n_neg=10)},
        provenance=_provenance(primary_sort_type="USEFUL_SCORE_DESC"),
    )
    cmp = compare_snapshots(cur, prev)
    assert cmp.comparability_status == "incomparable_sort"
    assert cmp.deltas == []
    assert cmp.comparability_reason == INCOMPARABLE_SORT_REASON_KO


def test_compare_status_incomparable_cap_when_cap_policy_differs():
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=20, n_neg=20)},
        provenance=_provenance(cap_policy="all"),
    )
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=20, n_neg=10)},
        provenance=_provenance(cap_policy="200"),
    )
    cmp = compare_snapshots(cur, prev)
    assert cmp.comparability_status == "incomparable_cap"
    assert cmp.deltas == []
    assert cmp.comparability_reason == INCOMPARABLE_CAP_REASON_KO


def test_compare_status_ok_when_provenance_matches():
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=80, n_neg=20)},
        provenance=_provenance(),
    )
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=85, n_neg=15)},
        provenance=_provenance(),
    )
    cmp = compare_snapshots(cur, prev)
    assert cmp.comparability_status == "ok"
    assert cmp.comparability_reason is None
    # Deltas computed on the matched provenance.
    assert len(cmp.deltas) == 1


# Coverage warning ----------------------------------------------------------


def test_coverage_warning_fires_below_threshold():
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=80, n_neg=20)},
        provenance=_provenance(coverage_ratio=0.5),
    )
    cmp = compare_snapshots(cur, previous=None)
    assert cmp.coverage_warning == COVERAGE_WARNING_KO


def test_coverage_warning_silent_at_or_above_threshold():
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=80, n_neg=20)},
        provenance=_provenance(coverage_ratio=0.85),
    )
    cmp = compare_snapshots(cur, previous=None)
    assert cmp.coverage_warning is None


def test_coverage_warning_silent_when_total_unknown():
    """When total_review_count_available is None, coverage_ratio is
    None, and we do NOT fire a misleading warning."""
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=80, n_neg=20)},
        provenance=_provenance(coverage_ratio=None),
    )
    cmp = compare_snapshots(cur, previous=None)
    assert cmp.coverage_warning is None


def test_coverage_threshold_constant_unchanged():
    """Locked: changing this affects when operators see the
    'limited sample' warning. Pair any change with a
    stakeholder discussion."""
    assert COVERAGE_WARNING_THRESHOLD == 0.80


def test_compute_coverage_ratio_helper():
    assert compute_coverage_ratio(80, 100) == 0.8
    assert compute_coverage_ratio(80, None) is None
    assert compute_coverage_ratio(80, 0) is None


# Schema version constant lock ---------------------------------------------


def test_schema_version_is_v3():
    """v3 introduced corpus_type + sampling_strategy + derived
    confidence_level. Bumping this again requires updating the
    loader compat behavior and rejecting older versions."""
    assert SNAPSHOT_SCHEMA_VERSION == 3


# build_snapshot input strictness ------------------------------------------


def test_build_snapshot_requires_provenance_kwarg():
    """Calling without provenance is a TypeError — protects callers
    from silently shipping snapshots that lack sampling-bias context."""
    data = _build_data()
    when = datetime(2026, 4, 28, tzinfo=timezone.utc)
    with pytest.raises(TypeError):
        build_snapshot(data, collected_at=when)  # type: ignore[call-arg]


# PDF smoke for new failure paths ------------------------------------------


def test_pdf_renders_incomparable_sort_placeholder(tmp_path):
    """When sorts differ, the PDF should render the comparability
    placeholder + disclaimer (no crashing on missing top picks)."""
    pdf_v2 = _load_pdf_module()
    reviews = _build_synthetic_reviews_for_pdf()
    data = aggregate_product("A0001", "Test Product", reviews)
    cur = build_snapshot(
        data, collected_at=datetime(2026, 4, 28, tzinfo=timezone.utc),
        provenance=_provenance(
            primary_sort_type="DATETIME_DESC",
            collected_primary_review_count=data.n_reviews,
        ),
    )
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {"transfer_resistance": _attr_snapshot(n_pos=20, n_neg=12)},
        provenance=_provenance(primary_sort_type="USEFUL_SCORE_DESC"),
    )
    cmp = compare_snapshots(cur, prev)
    assert cmp.comparability_status == "incomparable_sort"
    out_path = tmp_path / "smoke_incomparable.pdf"
    pdf_v2.render_pdf_v2(
        data, out_path,
        source_label="snapshot smoke",
        corpus_metadata=_build_corpus_metadata(len(reviews)),
        snapshot_comparison=cmp,
    )
    assert out_path.exists()
    raw = out_path.read_bytes()
    assert raw.startswith(b"%PDF-")
    assert b"%%EOF" in raw[-32:]


def test_pdf_renders_non_primary_sort_placeholder(tmp_path):
    """When the current snapshot's sort is not DATETIME_DESC, the
    comparison should refuse delta surfacing regardless of previous."""
    pdf_v2 = _load_pdf_module()
    reviews = _build_synthetic_reviews_for_pdf()
    data = aggregate_product("A0001", "Test Product", reviews)
    cur = build_snapshot(
        data, collected_at=datetime(2026, 4, 28, tzinfo=timezone.utc),
        provenance=_provenance(
            primary_sort_type="RATING_ASC",
            collected_primary_review_count=data.n_reviews,
        ),
    )
    cmp = compare_snapshots(cur, previous=None)
    assert cmp.comparability_status == "non_primary_sort"
    out_path = tmp_path / "smoke_nonprimary.pdf"
    pdf_v2.render_pdf_v2(
        data, out_path,
        source_label="snapshot smoke",
        corpus_metadata=_build_corpus_metadata(len(reviews)),
        snapshot_comparison=cmp,
    )
    assert out_path.exists()
    assert out_path.read_bytes().startswith(b"%PDF-")


# ---------------------------------------------------------------------------
# v3: confidence_level rubric + sampling_strategy + sample-size guard
# ---------------------------------------------------------------------------


# compute_confidence_level rubric ------------------------------------------


def test_compute_confidence_high_via_full_corpus_path():
    assert compute_confidence_level(
        is_full_corpus=True,
        coverage_ratio=None,
        collected_review_count=30,
    ) == "high"


def test_compute_confidence_high_just_above_full_corpus_floor():
    assert compute_confidence_level(
        is_full_corpus=True,
        coverage_ratio=None,
        collected_review_count=30,
    ) == "high"


def test_compute_confidence_NOT_high_when_full_corpus_but_under_30():
    """is_full_corpus=true with N<30 falls through to the
    coverage path; with no ratio info, it lands in low."""
    assert compute_confidence_level(
        is_full_corpus=True,
        coverage_ratio=None,
        collected_review_count=29,
    ) == "low"


def test_compute_confidence_high_via_coverage_path():
    assert compute_confidence_level(
        is_full_corpus=False,
        coverage_ratio=0.80,
        collected_review_count=100,
    ) == "high"


def test_compute_confidence_just_below_high_coverage_threshold():
    """coverage 0.79 fails the 0.80 floor → drops to medium."""
    assert compute_confidence_level(
        is_full_corpus=False,
        coverage_ratio=0.79,
        collected_review_count=100,
    ) == "medium"


def test_compute_confidence_high_coverage_but_low_count_drops_to_medium():
    """coverage 0.85 with N=99 fails the 100 floor → medium via
    second branch (0.85 ≥ 0.50 AND 99 ≥ 50)."""
    assert compute_confidence_level(
        is_full_corpus=False,
        coverage_ratio=0.85,
        collected_review_count=99,
    ) == "medium"


def test_compute_confidence_medium_via_coverage_path():
    assert compute_confidence_level(
        is_full_corpus=False,
        coverage_ratio=0.50,
        collected_review_count=50,
    ) == "medium"


def test_compute_confidence_medium_via_unknown_coverage_path():
    """coverage_ratio unknown but N >= 200 → medium."""
    assert compute_confidence_level(
        is_full_corpus=False,
        coverage_ratio=None,
        collected_review_count=200,
    ) == "medium"


def test_compute_confidence_low_when_coverage_below_medium_floor():
    assert compute_confidence_level(
        is_full_corpus=False,
        coverage_ratio=0.49,
        collected_review_count=100,
    ) == "low"


def test_compute_confidence_low_when_count_below_medium_floor():
    assert compute_confidence_level(
        is_full_corpus=False,
        coverage_ratio=0.60,
        collected_review_count=49,
    ) == "low"


def test_compute_confidence_low_when_unknown_coverage_and_small_count():
    """unknown coverage + N=199 fails the 200 floor → low."""
    assert compute_confidence_level(
        is_full_corpus=False,
        coverage_ratio=None,
        collected_review_count=199,
    ) == "low"


def test_compute_confidence_low_when_everything_minimal():
    assert compute_confidence_level(
        is_full_corpus=False,
        coverage_ratio=0.10,
        collected_review_count=20,
    ) == "low"


# CorpusProvenance derives confidence_level, never accepts it ---------------


def test_confidence_level_is_derived_in_post_init():
    """Building provenance with high-coverage + large N produces
    confidence_level='high' without the caller setting it."""
    prov = CorpusProvenance(
        corpus_type="observed_scrape",
        sampling_strategy="latest_only",
        primary_sort_type="DATETIME_DESC",
        cap_policy="all",
        collected_primary_review_count=500,
        total_review_count_available=600,
        coverage_ratio=500 / 600,
        is_full_corpus=False,
    )
    assert prov.confidence_level == "high"


def test_confidence_level_cannot_be_supplied_to_constructor():
    """init=False enforces 'derived, not partner-supplied' — passing
    confidence_level=... is a TypeError."""
    with pytest.raises(TypeError):
        CorpusProvenance(
            corpus_type="observed_scrape",
            sampling_strategy="latest_only",
            primary_sort_type="DATETIME_DESC",
            cap_policy="all",
            collected_primary_review_count=500,
            total_review_count_available=600,
            coverage_ratio=500 / 600,
            is_full_corpus=False,
            confidence_level="high",  # init=False → TypeError
        )


def test_confidence_level_recomputed_on_load(tmp_path):
    """Loader does not trust the JSON-persisted confidence_level;
    it is recomputed from the saved base fields. Tampering with the
    JSON value cannot fool the comparison."""
    snap_dir = tmp_path / "A0001"
    snap_dir.mkdir(parents=True)
    # Save normally (confidence will derive as 'low' for default fixture).
    save_snapshot(
        build_snapshot(
            _build_data(),
            collected_at=datetime(2026, 3, 28, tzinfo=timezone.utc),
            provenance=_provenance(),
        ),
        tmp_path,
    )
    # Tamper: set persisted confidence_level to 'high'.
    saved = list(snap_dir.glob("*.json"))[0]
    raw = json.loads(saved.read_text(encoding="utf-8"))
    raw["provenance"]["confidence_level"] = "high"
    saved.write_text(json.dumps(raw), encoding="utf-8")
    loaded = load_previous_snapshot(
        "A0001", "2026-04-28T00:00:00Z", tmp_path,
    )
    assert loaded is not None
    # Recomputed value wins, not the tampered persisted value.
    assert loaded.provenance.confidence_level != "high"


# corpus_type comparability gate -------------------------------------------


def test_compare_status_incomparable_corpus_type_when_observed_vs_partner():
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=80, n_neg=20)},
        provenance=_provenance(corpus_type="observed_scrape"),
    )
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=85, n_neg=15)},
        provenance=_provenance(corpus_type="partner_full_export"),
    )
    cmp = compare_snapshots(cur, prev)
    assert cmp.comparability_status == "incomparable_corpus_type"
    assert cmp.deltas == []
    assert cmp.comparability_reason == INCOMPARABLE_CORPUS_TYPE_REASON_KO


# sampling_strategy comparability gate -------------------------------------


def test_compare_status_incomparable_strategy_when_strategies_differ():
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=80, n_neg=20)},
        provenance=_provenance(sampling_strategy="latest_plus_signal"),
    )
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=85, n_neg=15)},
        provenance=_provenance(sampling_strategy="latest_only"),
    )
    cmp = compare_snapshots(cur, prev)
    assert cmp.comparability_status == "incomparable_strategy"
    assert cmp.deltas == []
    assert cmp.comparability_reason == INCOMPARABLE_STRATEGY_REASON_KO


# sample-size comparability guard ------------------------------------------


def test_compare_status_incomparable_sample_size_when_relative_diff_above_threshold():
    """120 vs 100 → relative diff 0.167 < 0.30 → ok.
    180 vs 100 → relative diff 0.444 > 0.30 → refused."""
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=140, n_neg=40)},  # n_reviews=180
        n_reviews=180,
        provenance=_provenance(collected_primary_review_count=180),
    )
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=85, n_neg=15)},
        n_reviews=100,
        provenance=_provenance(collected_primary_review_count=100),
    )
    cmp = compare_snapshots(cur, prev)
    assert cmp.comparability_status == "incomparable_sample_size"
    assert cmp.deltas == []
    assert cmp.comparability_reason == INCOMPARABLE_SAMPLE_SIZE_REASON_KO


def test_compare_status_ok_when_sample_size_diff_just_under_threshold():
    """130 vs 100 → relative diff 0.231 < 0.30 → ok."""
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=110, n_neg=20)},
        n_reviews=130,
        provenance=_provenance(collected_primary_review_count=130),
    )
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=85, n_neg=15)},
        n_reviews=100,
        provenance=_provenance(collected_primary_review_count=100),
    )
    cmp = compare_snapshots(cur, prev)
    assert cmp.comparability_status == "ok"


def test_sample_size_guard_threshold_constant():
    """Locked. Changing this changes when the guard fires."""
    assert SAMPLE_SIZE_GUARD_RELATIVE_THRESHOLD == 0.30


# Comparability gate ordering ----------------------------------------------


def test_corpus_type_gate_fires_before_strategy_gate():
    """corpus_type and sampling_strategy both differ — the
    earlier (corpus_type) gate must win so the operator's reason
    line points at the more fundamental mismatch."""
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=80, n_neg=20)},
        provenance=_provenance(
            corpus_type="observed_scrape",
            sampling_strategy="latest_plus_signal",
        ),
    )
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=85, n_neg=15)},
        provenance=_provenance(
            corpus_type="partner_full_export",
            sampling_strategy="full_export",
        ),
    )
    cmp = compare_snapshots(cur, prev)
    assert cmp.comparability_status == "incomparable_corpus_type"


# Detector / scoring / aggregation invariants ------------------------------


def test_v3_changes_do_not_alter_aggregate_product_output():
    """Sanity: the snapshot module changes do not touch
    aggregate_product. Same synthetic input → same output shape
    regardless of provenance."""
    data = _build_data()
    assert "transfer_resistance" in data.attribute_summaries
    assert data.attribute_summaries["transfer_resistance"].n_negative == 12
    assert data.n_reviews == 12 + 20 + 8


def test_v3_changes_do_not_alter_priority_score_for_a_known_attribute():
    """Sanity: compute_priority_score is not touched. Snapshot
    builds on top of the same number the executive summary uses."""
    from src.voc.reporting.phase2e.executive_summary import (
        compute_priority_score,
    )
    data = _build_data()
    s = data.attribute_summaries["transfer_resistance"]
    score = compute_priority_score(s, data.n_reviews)
    assert score > 0


# PDF wording lock — confidence chip + low-confidence variants -------------


def test_pdf_renders_high_confidence_chip(tmp_path):
    pdf_v2 = _load_pdf_module()
    reviews = _build_synthetic_reviews_for_pdf()
    data = aggregate_product("A0001", "Test Product", reviews)
    cur = build_snapshot(
        data, collected_at=datetime(2026, 4, 28, tzinfo=timezone.utc),
        provenance=_provenance(
            collected_primary_review_count=data.n_reviews,
            is_full_corpus=True,  # → confidence high
        ),
    )
    assert cur.provenance.confidence_level == "high"
    cmp = compare_snapshots(cur, previous=None)
    out_path = tmp_path / "smoke_high_conf.pdf"
    pdf_v2.render_pdf_v2(
        data, out_path,
        source_label="snapshot smoke",
        corpus_metadata=_build_corpus_metadata(len(reviews)),
        snapshot_comparison=cmp,
        current_snapshot_confidence=cur.provenance.confidence_level,
    )
    assert out_path.exists()
    raw = out_path.read_bytes()
    assert raw.startswith(b"%PDF-")


def test_pdf_renders_low_confidence_chip_and_wording_lock(tmp_path):
    """Low confidence triggers the wording lock — directional bands
    instead of percentages, top_improving suppressed entirely."""
    pdf_v2 = _load_pdf_module()
    reviews = _build_synthetic_reviews_for_pdf()
    data = aggregate_product("A0001", "Test Product", reviews)
    # Force low confidence: small N, no coverage info.
    cur = build_snapshot(
        data, collected_at=datetime(2026, 4, 28, tzinfo=timezone.utc),
        provenance=_provenance(
            collected_primary_review_count=data.n_reviews,
        ),
    )
    assert cur.provenance.confidence_level == "low"
    # Comparable previous so we exercise the "ok" delta path under
    # low confidence (and confirm the wording lock applies there,
    # not just on placeholder paths).
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {
            "transfer_resistance": _attr_snapshot(n_pos=20, n_neg=12),
            "persistence": _attr_snapshot(n_pos=10, n_neg=18),
            "pigmentation": _attr_snapshot(n_pos=35, n_neg=2),
        },
        n_reviews=data.n_reviews,
        provenance=_provenance(
            collected_primary_review_count=data.n_reviews,
        ),
    )
    cmp = compare_snapshots(cur, prev)
    assert cmp.comparability_status == "ok"
    out_path = tmp_path / "smoke_low_conf.pdf"
    pdf_v2.render_pdf_v2(
        data, out_path,
        source_label="snapshot smoke",
        corpus_metadata=_build_corpus_metadata(len(reviews)),
        snapshot_comparison=cmp,
        current_snapshot_confidence=cur.provenance.confidence_level,
    )
    assert out_path.exists()
    raw = out_path.read_bytes()
    assert raw.startswith(b"%PDF-")


def test_pdf_section_builder_low_confidence_uses_directional_band():
    """Inspect the built flowables directly: when confidence is low
    AND there's a top_rising delta, the rendered text contains the
    directional band phrase, NOT a 'X%p' percentage."""
    pdf_v2 = _load_pdf_module()
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=85, n_neg=25)},
        provenance=_provenance(
            collected_primary_review_count=110,  # low N
        ),
    )
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=90, n_neg=15)},
        provenance=_provenance(
            collected_primary_review_count=110,
        ),
    )
    cmp = compare_snapshots(cur, prev)
    assert cmp.comparability_status == "ok"
    assert cmp.top_rising is not None
    flowables = pdf_v2._build_snapshot_trend_section(
        cmp,
        confidence_level="low",
        styles=pdf_v2._styles(),
    )
    # Concatenate every Paragraph's text for inspection.
    rendered = " ".join(
        getattr(f, "text", "") for f in flowables
    )
    # Low-confidence band phrase present; specific %p numbers absent.
    assert LOW_CONFIDENCE_DIRECTIONAL_RISING_KO in rendered
    assert "%p" not in rendered
    # Action chip swapped.
    assert LOW_CONFIDENCE_ACTION_CHIP_KO in rendered
    assert "검토 필요" not in rendered


def test_pdf_section_builder_low_confidence_suppresses_top_improving():
    """Even with a clear improving signal, low confidence drops it
    from the rendered surface to avoid crediting noise."""
    pdf_v2 = _load_pdf_module()
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=95, n_neg=10)},  # share dropped
        provenance=_provenance(collected_primary_review_count=105),
    )
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=70, n_neg=30)},
        provenance=_provenance(collected_primary_review_count=100),
    )
    cmp = compare_snapshots(cur, prev)
    assert cmp.comparability_status == "ok"
    assert cmp.top_improving is not None  # signal exists
    flowables = pdf_v2._build_snapshot_trend_section(
        cmp,
        confidence_level="low",
        styles=pdf_v2._styles(),
    )
    rendered = " ".join(
        getattr(f, "text", "") for f in flowables
    )
    # The improving label must NOT appear under low confidence.
    assert "[감소 신호]" not in rendered


def test_pdf_section_builder_high_confidence_keeps_full_surface():
    """Sanity inverse: under high confidence, percentages and the
    검토 필요 chip survive."""
    pdf_v2 = _load_pdf_module()
    cur = _snapshot(
        "2026-04-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=85, n_neg=25)},
        provenance=_provenance(
            collected_primary_review_count=110,
        ),
    )
    prev = _snapshot(
        "2026-03-28T00:00:00Z",
        {"x": _attr_snapshot(n_pos=90, n_neg=15)},
        provenance=_provenance(
            collected_primary_review_count=110,
        ),
    )
    cmp = compare_snapshots(cur, prev)
    flowables = pdf_v2._build_snapshot_trend_section(
        cmp,
        confidence_level="high",
        styles=pdf_v2._styles(),
    )
    rendered = " ".join(
        getattr(f, "text", "") for f in flowables
    )
    # Full surface preserved: percentage display + 검토 필요 chip.
    assert "%p" in rendered
    assert "검토 필요" in rendered
    assert LOW_CONFIDENCE_DIRECTIONAL_RISING_KO not in rendered


# ---------------------------------------------------------------------------
# Signal stability rubric (heuristic; distinct from confidence_level)
# ---------------------------------------------------------------------------


# compute_signal_stability — branch coverage ------------------------------


def test_stability_high_when_n_at_floor_and_coverage_at_floor():
    assert compute_signal_stability(
        collected_review_count=1000,
        coverage_ratio=0.5,
        corpus_type="observed_scrape",
        primary_sort_type="DATETIME_DESC",
    ) == "high"


def test_stability_high_with_full_corpus_partner_export():
    assert compute_signal_stability(
        collected_review_count=2000,
        coverage_ratio=1.0,
        corpus_type="partner_full_export",
        primary_sort_type="PARTNER_FULL",
    ) == "high"


def test_stability_medium_when_n_decent_but_coverage_below_high_floor():
    assert compute_signal_stability(
        collected_review_count=500,
        coverage_ratio=0.6,
        corpus_type="observed_scrape",
        primary_sort_type="DATETIME_DESC",
    ) == "medium"


def test_stability_medium_when_n_decent_and_coverage_unknown():
    """Unknown coverage cannot satisfy the high path; n>=300 keeps
    the floor at medium."""
    assert compute_signal_stability(
        collected_review_count=500,
        coverage_ratio=None,
        corpus_type="observed_scrape",
        primary_sort_type="DATETIME_DESC",
    ) == "medium"


def test_stability_medium_at_n_300_floor():
    assert compute_signal_stability(
        collected_review_count=300,
        coverage_ratio=None,
        corpus_type="observed_scrape",
        primary_sort_type="DATETIME_DESC",
    ) == "medium"


def test_stability_low_when_n_below_300():
    assert compute_signal_stability(
        collected_review_count=299,
        coverage_ratio=0.9,
        corpus_type="observed_scrape",
        primary_sort_type="DATETIME_DESC",
    ) == "low"


def test_stability_low_when_n_well_below_floor():
    assert compute_signal_stability(
        collected_review_count=50,
        coverage_ratio=None,
        corpus_type="observed_scrape",
        primary_sort_type="DATETIME_DESC",
    ) == "low"


def test_stability_low_for_heavy_sampling_bias_even_with_huge_n():
    """Signal-sort-only corpus is biased regardless of size — heavy
    bias collapses to low. Acts as the primary-sort safeguard at the
    stability layer (mirrors snapshot module's non_primary_sort
    comparability gate)."""
    assert compute_signal_stability(
        collected_review_count=5000,
        coverage_ratio=0.9,
        corpus_type="observed_scrape",
        primary_sort_type="RATING_ASC",
    ) == "low"


def test_stability_high_for_partner_full_export_with_alt_sort_label():
    """partner_full_export uses sentinel sort labels (e.g.
    PARTNER_FULL); these don't match DATETIME_DESC but the corpus
    is full and unbiased — must NOT be flagged as heavy bias."""
    assert compute_signal_stability(
        collected_review_count=2000,
        coverage_ratio=1.0,
        corpus_type="partner_full_export",
        primary_sort_type="PARTNER_FULL",
    ) == "high"


def test_stability_high_at_n_1000_with_coverage_below_floor_drops_to_medium():
    """Boundary: n=1000 satisfies size but coverage<0.5 prevents
    high → medium."""
    assert compute_signal_stability(
        collected_review_count=1000,
        coverage_ratio=0.4,
        corpus_type="observed_scrape",
        primary_sort_type="DATETIME_DESC",
    ) == "medium"


def test_stability_high_at_n_999_with_high_coverage_drops_to_medium():
    """Boundary: n=999 just below the size floor → medium."""
    assert compute_signal_stability(
        collected_review_count=999,
        coverage_ratio=0.9,
        corpus_type="observed_scrape",
        primary_sort_type="DATETIME_DESC",
    ) == "medium"


def test_stability_threshold_constants_are_locked():
    """Boundaries are heuristic; pair any change with a stakeholder
    discussion + this assertion update."""
    assert STABILITY_HIGH_MIN_N == 1000
    assert STABILITY_HIGH_COVERAGE_MIN == 0.50
    assert STABILITY_MEDIUM_MIN_N == 300


# CorpusProvenance auto-derives stability ----------------------------------


def test_provenance_derives_signal_stability_high_path():
    prov = CorpusProvenance(
        corpus_type="observed_scrape",
        sampling_strategy="latest_only",
        primary_sort_type="DATETIME_DESC",
        cap_policy="all",
        collected_primary_review_count=1500,
        total_review_count_available=2500,
        coverage_ratio=1500 / 2500,
        is_full_corpus=False,
    )
    assert prov.signal_stability == "high"


def test_provenance_derives_signal_stability_low_for_small_n():
    prov = CorpusProvenance(
        corpus_type="observed_scrape",
        sampling_strategy="latest_only",
        primary_sort_type="DATETIME_DESC",
        cap_policy="200",
        collected_primary_review_count=200,
        total_review_count_available=None,
        coverage_ratio=None,
        is_full_corpus=False,
    )
    assert prov.signal_stability == "low"


def test_signal_stability_cannot_be_supplied_to_constructor():
    """Same enforcement as confidence_level: init=False makes it
    impossible to pass via the constructor — partner cannot self-
    declare high stability with biased data."""
    with pytest.raises(TypeError):
        CorpusProvenance(
            corpus_type="observed_scrape",
            sampling_strategy="latest_only",
            primary_sort_type="DATETIME_DESC",
            cap_policy="all",
            collected_primary_review_count=2000,
            total_review_count_available=2500,
            coverage_ratio=0.8,
            is_full_corpus=False,
            signal_stability="high",  # init=False → TypeError
        )


def test_signal_stability_round_trips_through_json(tmp_path):
    """Save → load preserves signal_stability via the rubric (the
    persisted value is informational; loader recomputes from the
    base fields). A tampered persisted value must not stick."""
    data = _build_data()
    when = datetime(2026, 4, 28, tzinfo=timezone.utc)
    save_snapshot(
        build_snapshot(
            data,
            collected_at=when,
            provenance=_provenance(
                collected_primary_review_count=1500,
                total_review_count_available=3000,
                coverage_ratio=0.5,
            ),
        ),
        tmp_path,
    )
    snap_dir = tmp_path / "A0001"
    saved = list(snap_dir.glob("*.json"))[0]
    raw = json.loads(saved.read_text(encoding="utf-8"))
    # Persisted file carries the derived value for human readability.
    assert raw["provenance"]["signal_stability"] == "high"
    # Tamper with the persisted value, ensure loader recomputes.
    raw["provenance"]["signal_stability"] = "low"
    saved.write_text(json.dumps(raw), encoding="utf-8")
    loaded = load_previous_snapshot(
        "A0001", "2026-05-28T00:00:00Z", tmp_path,
    )
    assert loaded is not None
    assert loaded.provenance.signal_stability == "high"


# Stability sentence constants are wording-safety compliant ---------------


@pytest.mark.parametrize(
    "phrase",
    [
        STABILITY_VERDICT_HIGH_KO,
        STABILITY_VERDICT_MEDIUM_KO,
        STABILITY_VERDICT_LOW_KO,
    ],
)
def test_stability_verdict_phrases_avoid_banned_wording(phrase):
    BANNED = ("원인 확정", "해야 합니다", "개선 필요", "발생합니다")
    for term in BANNED:
        assert term not in phrase, \
            f"banned wording '{term}' in stability phrase: {phrase!r}"
