"""Derived cross-cut analyses over already-detected signals + row metadata.

Signals tell the operator *what* the corpus is saying. Derived findings
tell the operator *which slice* of the corpus is saying it — a bivariate
view that turns univariate hit counts into something analytically
meaningful.

v1 ships a single cross-cut: segment × signal, keyed on
``normalized_skin_type``. Future cross-cuts (content-vs-flag divergence,
rating-vs-content divergence, shade × signal concentration) land in this
module as additional computations, all feeding the same
``DerivedFindings`` container.

Everything here is deterministic. No LLM, no stats tests. The restraint
thresholds at module level (``_MIN_SEGMENT_SIZE``, ``_MIN_EVIDENCE_IN_SEGMENT``,
``_MIN_LIFT``, ``_MAX_FINDINGS``) are the only lever against noise; the rest
is rate arithmetic.
"""

from __future__ import annotations

import json
from typing import Any

from src.voc.reporting.phase1.schema import (
    DerivedFindings,
    RatingContentDivergence,
    SegmentSignalFinding,
    ShadeSignalFinding,
    SignalsBundle,
)

Row = dict[str, Any]


# Restraint thresholds. Exposed at module level so callers / tests can
# introspect; not currently parameterised on a per-report basis.
_MIN_SEGMENT_SIZE = 10         # segments with fewer rows ignored
_MIN_EVIDENCE_IN_SEGMENT = 2    # need ≥ 2 hits to avoid single-anecdote noise
_MIN_LIFT = 2.0                 # within-segment rate must be ≥ 2× overall
_MAX_FINDINGS = 5               # cap on surfaced findings per report

# Segment bucket values we refuse to surface (unstructured / missing).
_EXCLUDED_BUCKETS = frozenset({"unknown", "", None})

# Segment variable we inspect in v1. Architecture supports multiple; for
# v1 we deliberately ship only one to keep the surfaced finding count
# low and the mechanism simple.
_SEGMENT_VARIABLE = "normalized_skin_type"


# Rating × content divergence thresholds. Tuned conservatively: a
# divergence cell is surfaced only when (a) the rating-band population
# is large enough for within-rate to be interpretable, (b) the cell
# count clears a headline-eligibility floor, and (c) the within-rate is
# non-trivial. See the v2-plan conversation for the rationale.
_MIN_DIVERGENCE_COUNT = 3         # cell must contain ≥ 3 rows
_MIN_POPULATION_SIZE = 20         # rating-band population must be ≥ 20 rows
# within-rate must be ≥ 2%. Raised from 1% after rendering-quality review:
# on very-positive products (blush with 85% 5★), 1.2% cells surface but
# don't earn the analytical real estate — reader feedback indicated the
# rating-divergence block feels thin at that density. A 2% floor keeps
# the section active for products with meaningful complaint density and
# silent on products like the current matched pair where the finding is
# technically present but outweighed by the surrounding positive signal.
_MIN_DIVERGENCE_RATE = 0.02

# Rating-band boundaries.
_HIGH_RATING_MIN = 4              # 4★–5★ inclusive
_LOW_RATING_MAX = 2               # 1★–2★ inclusive


# Shade × signal concentration thresholds. Deliberately identical to the
# segment×signal thresholds — both are "overrepresentation within a
# categorical slice of the population," and the same restraint logic
# applies. Kept as separate constants so shade-specific calibration
# doesn't silently affect segment findings.
_MIN_SHADE_SIZE = 10
_MIN_EVIDENCE_IN_SHADE = 2
_MIN_LIFT_SHADE = 2.0
_MAX_SHADE_FINDINGS = 5


def compute_derived_findings(
    rows: list[Row],
    signals: SignalsBundle,
    membership: dict[str, set[str]],
    *,
    dominant_product_id: str | None = None,
) -> DerivedFindings:
    """Compute all derived cross-cuts for a single report.

    ``membership``: the ``{signal_name: {review_id, ...}}`` map returned by
    ``detect_signals_with_membership``. Required — derived findings can't
    be computed without per-signal hit membership at the row level.

    ``dominant_product_id``: when provided, enables shade×signal analysis
    scoped to that product. When omitted, shade findings are always
    empty — caller that wants shade analysis is responsible for resolving
    the dominant product (typically via ``DeterministicMetrics.dominant_product``).
    """
    segment_findings = _compute_segment_signal_findings(rows, signals, membership)
    rating_divergences = _compute_rating_content_divergences(
        rows, signals, membership,
    )
    shade_findings = _compute_shade_signal_findings(
        rows, signals, membership, dominant_product_id,
    )
    return DerivedFindings(
        segment_signal_findings=segment_findings,
        shade_signal_findings=shade_findings,
        rating_content_divergences=rating_divergences,
    )


# ---------------------------------------------------------------------------
# Segment × signal cross-tab
# ---------------------------------------------------------------------------


def _compute_segment_signal_findings(
    rows: list[Row],
    signals: SignalsBundle,
    membership: dict[str, set[str]],
) -> list[SegmentSignalFinding]:
    """Return signal-segment overrepresentation findings, sorted by lift
    descending, capped at ``_MAX_FINDINGS``.

    Filters applied, in order:
      1. Bucket is not in ``_EXCLUDED_BUCKETS``.
      2. Segment size ≥ ``_MIN_SEGMENT_SIZE``.
      3. Signal's overall_rate > 0 (else lift is undefined).
      4. ``n_signal_in_segment`` ≥ ``_MIN_EVIDENCE_IN_SEGMENT``.
      5. Lift ≥ ``_MIN_LIFT``.

    A failure of ANY filter drops the (segment, signal) pair from output.
    """
    # review_id → segment bucket (rows without a meaningful bucket are not
    # added to the map at all — they contribute to the overall denominator
    # but to no segment).
    seg_by_rid: dict[str, str] = {}
    rating_by_rid: dict[str, float] = {}
    for r in rows:
        rid = r.get("review_id")
        if not rid:
            continue
        bucket = _extract_segment_bucket(r, _SEGMENT_VARIABLE)
        if bucket in _EXCLUDED_BUCKETS:
            continue
        rid_str = str(rid)
        seg_by_rid[rid_str] = bucket
        # Capture rating for per-segment average (None / non-numeric ratings
        # are skipped; avg uses only rated rows).
        rating = r.get("rating_raw")
        try:
            rating_by_rid[rid_str] = float(rating)
        except (TypeError, ValueError):
            pass

    # segment_bucket → count of rows in that segment
    segment_sizes: dict[str, int] = {}
    for bucket in seg_by_rid.values():
        segment_sizes[bucket] = segment_sizes.get(bucket, 0) + 1

    # segment_bucket → (rating_sum, rating_n) for mean computation
    seg_rating_accum: dict[str, tuple[float, int]] = {}
    for rid, bucket in seg_by_rid.items():
        if rid in rating_by_rid:
            cur_sum, cur_n = seg_rating_accum.get(bucket, (0.0, 0))
            seg_rating_accum[bucket] = (cur_sum + rating_by_rid[rid], cur_n + 1)

    # Total segment-tagged rows for share-of-known denominator
    total_known_segmented = sum(segment_sizes.values())

    total_rows = len(rows)
    if total_rows == 0:
        return []

    all_signals = list(signals.positive) + list(signals.cautionary) + list(signals.gaps)
    findings: list[SegmentSignalFinding] = []

    for sig in all_signals:
        overall_rate = sig.evidence_count / total_rows
        if overall_rate <= 0:
            continue
        sig_rids = membership.get(sig.name, set())
        if not sig_rids:
            continue

        for bucket, seg_size in segment_sizes.items():
            if seg_size < _MIN_SEGMENT_SIZE:
                continue
            # Capture the intersection review_ids (signal hits landing in
            # this segment) so the renderer can quote one.
            seg_hit_ids = sorted(
                rid for rid in sig_rids if seg_by_rid.get(rid) == bucket
            )
            n_in_seg = len(seg_hit_ids)
            if n_in_seg < _MIN_EVIDENCE_IN_SEGMENT:
                continue
            within_rate = n_in_seg / seg_size
            lift = within_rate / overall_rate
            if lift < _MIN_LIFT:
                continue

            # Per-segment context (same for every finding in this bucket)
            share_of_known = (
                seg_size / total_known_segmented
                if total_known_segmented else 0.0
            )
            rsum, rn = seg_rating_accum.get(bucket, (0.0, 0))
            avg_rating = round(rsum / rn, 2) if rn else None

            findings.append(SegmentSignalFinding(
                segment_variable=_SEGMENT_VARIABLE,
                bucket=bucket,
                signal_name=sig.name,
                signal_display_label=sig.display_label,
                signal_category=sig.category,
                n_segment=seg_size,
                n_signal_in_segment=n_in_seg,
                within_segment_rate=round(within_rate, 4),
                overall_rate=round(overall_rate, 4),
                lift=round(lift, 2),
                sample_review_ids=seg_hit_ids[:3],
                segment_share_of_known=round(share_of_known, 4),
                segment_avg_rating=avg_rating,
            ))

    # Sort: lift desc; ties broken by category priority (gap > cautionary >
    # positive) so the more outbound-interesting findings surface first at
    # equal lift; tie-break again by display_label for determinism.
    _CATEGORY_PRIORITY = {"gap": 0, "cautionary": 1, "positive": 2}
    findings.sort(key=lambda f: (
        -f.lift,
        _CATEGORY_PRIORITY.get(f.signal_category, 3),
        f.signal_display_label,
        f.bucket,
    ))
    return findings[:_MAX_FINDINGS]


# ---------------------------------------------------------------------------
# Shade × signal concentration (dominant product only)
# ---------------------------------------------------------------------------


def _compute_shade_signal_findings(
    rows: list[Row],
    signals: SignalsBundle,
    membership: dict[str, set[str]],
    dominant_product_id: str | None,
) -> list[ShadeSignalFinding]:
    """Return findings of the form "signal S is overrepresented on shade X
    within the dominant product," filtered by restraint thresholds.

    Explicitly scoped to the dominant product. Rows from other products in
    the report (matched-pair reports, for example) do not contribute to
    either the baseline rate or the shade populations — this keeps
    comparisons apples-to-apples and prevents one product's shade structure
    from being mixed with another product's.

    Filters applied, in order:
      1. ``dominant_product_id`` is provided.
      2. Row belongs to the dominant product AND has a non-empty shade.
      3. Shade size ≥ ``_MIN_SHADE_SIZE``.
      4. Signal's within-product overall rate > 0.
      5. ``n_signal_in_shade`` ≥ ``_MIN_EVIDENCE_IN_SHADE``.
      6. Lift ≥ ``_MIN_LIFT_SHADE``.
    """
    if not dominant_product_id:
        return []

    # Restrict to dominant-product rows. Build review_id → shade mapping;
    # keep a parallel total count including rows without shade info so the
    # product-wide baseline (overall_rate) isn't biased by shade-tagged
    # rows alone.
    total_in_product = 0
    shade_by_rid: dict[str, str] = {}
    rating_by_rid: dict[str, float] = {}
    for r in rows:
        if r.get("product_external_id") != dominant_product_id:
            continue
        total_in_product += 1
        rid = r.get("review_id")
        if not rid:
            continue
        rid_str = str(rid)
        shade = _extract_shade(r)
        if shade and shade not in _EXCLUDED_BUCKETS:
            shade_by_rid[rid_str] = shade
        rating = r.get("rating_raw")
        try:
            rating_by_rid[rid_str] = float(rating)
        except (TypeError, ValueError):
            pass

    if total_in_product == 0:
        return []

    shade_sizes: dict[str, int] = {}
    for shade in shade_by_rid.values():
        shade_sizes[shade] = shade_sizes.get(shade, 0) + 1

    # shade → (rating_sum, rating_n) for per-shade mean.
    shade_rating_accum: dict[str, tuple[float, int]] = {}
    for rid, shade in shade_by_rid.items():
        if rid in rating_by_rid:
            cur_sum, cur_n = shade_rating_accum.get(shade, (0.0, 0))
            shade_rating_accum[shade] = (cur_sum + rating_by_rid[rid], cur_n + 1)

    all_signals = list(signals.positive) + list(signals.cautionary) + list(signals.gaps)
    findings: list[ShadeSignalFinding] = []

    for sig in all_signals:
        sig_rids_all = membership.get(sig.name, set())
        # Filter to rows that belong to dominant product — this prevents
        # e.g. Coupang-side hits from inflating the baseline on an OY-side
        # shade analysis.
        sig_rids_in_product: set[str] = set()
        for r in rows:
            if r.get("product_external_id") != dominant_product_id:
                continue
            rid = r.get("review_id")
            if rid and str(rid) in sig_rids_all:
                sig_rids_in_product.add(str(rid))
        if not sig_rids_in_product:
            continue
        overall_rate = len(sig_rids_in_product) / total_in_product
        if overall_rate <= 0:
            continue

        for shade, shade_size in shade_sizes.items():
            if shade_size < _MIN_SHADE_SIZE:
                continue
            shade_hit_ids = sorted(
                rid for rid in sig_rids_in_product if shade_by_rid.get(rid) == shade
            )
            n_in_shade = len(shade_hit_ids)
            if n_in_shade < _MIN_EVIDENCE_IN_SHADE:
                continue
            within_rate = n_in_shade / shade_size
            lift = within_rate / overall_rate
            if lift < _MIN_LIFT_SHADE:
                continue

            share_of_product = shade_size / total_in_product
            rsum, rn = shade_rating_accum.get(shade, (0.0, 0))
            avg_rating = round(rsum / rn, 2) if rn else None

            findings.append(ShadeSignalFinding(
                product_id=dominant_product_id,
                shade=shade,
                signal_name=sig.name,
                signal_display_label=sig.display_label,
                signal_category=sig.category,
                n_shade=shade_size,
                n_signal_in_shade=n_in_shade,
                within_shade_rate=round(within_rate, 4),
                overall_rate=round(overall_rate, 4),
                lift=round(lift, 2),
                sample_review_ids=shade_hit_ids[:3],
                shade_share_of_product=round(share_of_product, 4),
                shade_avg_rating=avg_rating,
            ))

    # Same category priority as segment findings: gap > cautionary > positive.
    _CATEGORY_PRIORITY = {"gap": 0, "cautionary": 1, "positive": 2}
    findings.sort(key=lambda f: (
        -f.lift,
        _CATEGORY_PRIORITY.get(f.signal_category, 3),
        f.signal_display_label,
        f.shade,
    ))
    return findings[:_MAX_SHADE_FINDINGS]


def _extract_shade(row: Row) -> str | None:
    """Pull the normalized shade for a row.

    Looks at ``derived.normalized_product_option.shade``. Accepts both
    already-parsed dict and JSON-string shapes, same as
    ``_extract_segment_bucket``. Returns None on absence or malformation.
    """
    derived = row.get("derived")
    if derived is None:
        derived = row.get("derived_json")
    if derived is None:
        return None
    if isinstance(derived, str):
        try:
            derived = json.loads(derived)
        except (json.JSONDecodeError, TypeError):
            return None
    if not isinstance(derived, dict):
        return None
    option = derived.get("normalized_product_option")
    if not isinstance(option, dict):
        return None
    shade = option.get("shade")
    return shade if isinstance(shade, str) and shade else None


# ---------------------------------------------------------------------------
# Rating × content divergence
# ---------------------------------------------------------------------------


def _compute_rating_content_divergences(
    rows: list[Row],
    signals: SignalsBundle,
    membership: dict[str, set[str]],
) -> list[RatingContentDivergence]:
    """Return rating×content divergence cells that clear restraint thresholds.

    Two cells are considered:

      1. ``high_rated_with_concerns`` (PRIMARY):
         population = rows with ``rating_raw >= _HIGH_RATING_MIN`` (4 or 5★).
         cell = rows in population AND ≥ 1 cautionary signal hit.
         Interpretation: "customers love it but raised specific feedback."

      2. ``low_rated_without_concerns`` (SECONDARY):
         population = rows with ``rating_raw <= _LOW_RATING_MAX`` (1 or 2★).
         cell = rows in population AND 0 cautionary signal hits.
         Interpretation: "low-rated reviews we couldn't categorize — potential
         lexicon-coverage gap or diffuse dissatisfaction."

    Cells are emitted only when all three thresholds pass:
      - population_size ≥ _MIN_POPULATION_SIZE
      - cell_count ≥ _MIN_DIVERGENCE_COUNT
      - cell_count / population_size ≥ _MIN_DIVERGENCE_RATE

    The secondary cell is allowed to fail silently on corpora where low-
    rated rows are rare — this is the expected path on very positive
    products and should not be treated as an error.

    Returns the findings sorted with the primary cell first when both fire.
    """
    # Union of review_ids hitting ANY cautionary signal — that's the
    # "content says there's a concern" signal layer used by both cells.
    cautionary_rids: set[str] = set()
    for sig in signals.cautionary:
        cautionary_rids.update(membership.get(sig.name, set()))

    # Partition rows by rating band, carrying review_id for sample-id
    # extraction. Rows with missing rating are excluded from both
    # populations (they can't be in either divergence cell).
    high_pop_rids: list[str] = []
    low_pop_rids: list[str] = []
    for r in rows:
        rid = r.get("review_id")
        rating = r.get("rating_raw")
        if rid is None or rating is None:
            continue
        try:
            rating_int = int(rating)
        except (TypeError, ValueError):
            continue
        rid_str = str(rid)
        if rating_int >= _HIGH_RATING_MIN:
            high_pop_rids.append(rid_str)
        elif rating_int <= _LOW_RATING_MAX:
            low_pop_rids.append(rid_str)

    out: list[RatingContentDivergence] = []

    # Cell 1: high-rated with concerns.
    cell1 = _build_divergence_cell(
        kind="high_rated_with_concerns",
        rating_bound=_HIGH_RATING_MIN,
        rating_condition=">=",
        population_rids=high_pop_rids,
        cell_predicate=lambda rid: rid in cautionary_rids,
    )
    if cell1 is not None:
        out.append(cell1)

    # Cell 2: low-rated without concerns.
    cell2 = _build_divergence_cell(
        kind="low_rated_without_concerns",
        rating_bound=_LOW_RATING_MAX,
        rating_condition="<=",
        population_rids=low_pop_rids,
        cell_predicate=lambda rid: rid not in cautionary_rids,
    )
    if cell2 is not None:
        out.append(cell2)

    return out


def _build_divergence_cell(
    *,
    kind: str,
    rating_bound: int,
    rating_condition: str,
    population_rids: list[str],
    cell_predicate,
) -> RatingContentDivergence | None:
    """Apply the three restraint thresholds and materialize a cell, or
    return None when any threshold fails.

    ``cell_predicate`` takes a review_id and returns True when the row
    belongs in the divergence cell. Kept as a callable so cell 1 and cell 2
    can share this materializer despite opposite content-condition logic.
    """
    population_size = len(population_rids)
    if population_size < _MIN_POPULATION_SIZE:
        return None
    cell_rids = [rid for rid in population_rids if cell_predicate(rid)]
    cell_count = len(cell_rids)
    if cell_count < _MIN_DIVERGENCE_COUNT:
        return None
    within_rate = cell_count / population_size
    if within_rate < _MIN_DIVERGENCE_RATE:
        return None
    sample = sorted(set(cell_rids))[:3]
    return RatingContentDivergence(
        kind=kind,
        rating_bound=rating_bound,
        rating_condition=rating_condition,
        population_size=population_size,
        cell_count=cell_count,
        within_rate=round(within_rate, 4),
        sample_review_ids=sample,
    )


def _extract_segment_bucket(row: Row, variable: str) -> str | None:
    """Pull the segment bucket for ``variable`` from a row.

    Rows can carry ``derived`` as either a JSON string (DB row) or an
    already-parsed dict (fixtures / tests). We accept both. Absence or
    malformation quietly returns None — the caller then skips the row
    for segment assignment.
    """
    derived = row.get("derived")
    if derived is None:
        derived = row.get("derived_json")
    if derived is None:
        return None
    if isinstance(derived, str):
        try:
            derived = json.loads(derived)
        except (json.JSONDecodeError, TypeError):
            return None
    if not isinstance(derived, dict):
        return None
    slot = derived.get(variable)
    if not isinstance(slot, dict):
        return None
    bucket = slot.get("bucket")
    return bucket if isinstance(bucket, str) else None
