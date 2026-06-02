"""Phase 1 mini-report JSON schema — the contract across all pipeline layers.

This module is the stable hand-off between:
  - deterministic metrics (``metrics.py``, PR5A)
  - rule-based signals     (``signals.py``,  PR5B — not yet wired)
  - narrative rendering    (``narrative.py``, PR5C/D — not yet wired)

The ``Phase1Report`` root aggregates all three layers plus the originating
query, resolved scope, and provenance. Layers that are not yet wired default
to empty / ``None`` so the model round-trips cleanly today.

Stability discipline: additive, non-breaking schema changes only. Bump
``schema_version`` when an existing field's meaning or type changes.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

SCHEMA_VERSION: Literal["1.0"] = "1.0"


# ---------------------------------------------------------------------------
# Query + scope
# ---------------------------------------------------------------------------


class ReportQuery(BaseModel):
    """The operator's original request, echoed back for traceability."""

    channel_filter: list[str] | None = None
    product_ids: list[str] | None = None
    window_start: date | None = None
    window_end: date | None = None


class ProductInScope(BaseModel):
    product_id: str
    channel: str
    display_label: str | None = None
    n_reviews: int


class ReportScope(BaseModel):
    channels: list[str]
    products: list[ProductInScope]
    total_reviews: int


# ---------------------------------------------------------------------------
# Deterministic metrics (populated by metrics.py — PR5A)
# ---------------------------------------------------------------------------


class TimeWindow(BaseModel):
    start_date: date | None = None
    end_date: date | None = None
    days_span: int | None = None  # inclusive: (end - start).days + 1
    missing_dates: int = 0        # rows with no review_date


class RatingMetrics(BaseModel):
    """Ratings are reported on the original 1–5 ``rating_raw`` scale.

    ``rating_normalized`` (internal [0,1]) is deliberately not surfaced — the
    operator reads stars, not normalized floats.
    """

    n: int                          # rows with a non-null rating_raw
    missing: int                    # rows with rating_raw is None
    avg_raw: float | None = None    # rounded to 4 decimals; None when n == 0
    distribution_raw: dict[int, int] = Field(default_factory=dict)  # {4: 3, 5: 17}


class ShadeCount(BaseModel):
    shade: str
    n: int


class ProductMetrics(BaseModel):
    product_id: str
    channel: str
    display_label: str | None = None
    n_reviews: int
    pct_of_total: float             # rounded to 4 decimals, [0, 1]
    rating: RatingMetrics
    shades: list[ShadeCount] = Field(default_factory=list)  # sorted: n desc, then shade asc


class SegmentMetrics(BaseModel):
    """Bucketed segment counts from ``derived.normalized_*``.

    Each map is ``{bucket_name: count}``. Empty dicts when no row carries the
    relevant derived attribute — i.e. PR4B enrichment wasn't run on any row.
    """

    normalized_skin_type: dict[str, int] = Field(default_factory=dict)
    normalized_age_group: dict[str, int] = Field(default_factory=dict)


class TriStateCount(BaseModel):
    """Counts for a boolean channel flag plus the missing bucket."""

    true: int = 0
    false: int = 0
    missing: int = 0


class ChannelSignals(BaseModel):
    """Channel-specific rollups. Every field is optional — OY-only runs leave
    Coupang-specific buckets as ``None``, and vice versa.

    The names mirror the underlying source of truth:
      - ``photo_attached``        → coupang.channel_meta.photo_attached
      - ``oy_has_photo``          → oliveyoung.raw_metadata.oy_has_photo
      - ``oy_review_type``        → oliveyoung.raw_metadata.oy_review_type (NORMAL/OFFLINE/GIFT)
      - ``oy_is_repurchase``      → oliveyoung.raw_metadata.oy_is_repurchase
    """

    photo_attached: TriStateCount | None = None
    oy_has_photo: TriStateCount | None = None
    oy_review_type: dict[str, int] | None = None
    oy_is_repurchase: TriStateCount | None = None


class DominantProduct(BaseModel):
    """The product that v1 narrative should treat as the main subject.

    v1 policy: the product with the most reviews in ``per_product``. Ties are
    broken by ``product_id`` ascending for determinism.
    """

    product_id: str
    channel: str
    n_reviews: int
    pct_of_total: float             # rounded to 4 decimals


class DeterministicMetrics(BaseModel):
    total_reviews: int
    n_products: int
    channels: dict[str, int] = Field(default_factory=dict)   # {channel: count}
    languages: dict[str, int] = Field(default_factory=dict)  # {lang: count}
    rating: RatingMetrics
    time_window: TimeWindow
    per_product: list[ProductMetrics] = Field(default_factory=list)
    dominant_product: DominantProduct | None = None
    segments: SegmentMetrics = Field(default_factory=SegmentMetrics)
    channel_signals: ChannelSignals = Field(default_factory=ChannelSignals)


# ---------------------------------------------------------------------------
# Signals (populated by signals.py — PR5B)
# ---------------------------------------------------------------------------


SignalCategory = Literal["positive", "cautionary", "gap"]


class SignalCandidate(BaseModel):
    name: str                       # machine-stable id, e.g. "no_base_crumbling"
    display_label: str              # operator-facing Korean label
    category: SignalCategory
    evidence_count: int
    coverage_ratio: float           # evidence_count / total_reviews, rounded to 4 decimals
    sample_review_ids: list[str] = Field(default_factory=list)  # ≤3, sorted ascending


class SignalsBundle(BaseModel):
    positive: list[SignalCandidate] = Field(default_factory=list)
    cautionary: list[SignalCandidate] = Field(default_factory=list)
    gaps: list[SignalCandidate] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Narrative (populated by narrative.py — PR5C/D)
# ---------------------------------------------------------------------------


NarrativeSource = Literal["template", "llm"]


class NarrativeBlock(BaseModel):
    summary_md: str | None = None
    sections_md: dict[str, str] = Field(default_factory=dict)
    caveats: list[str] = Field(default_factory=list)
    source: NarrativeSource | None = None


# ---------------------------------------------------------------------------
# Provenance
# ---------------------------------------------------------------------------


class SignalCoverage(BaseModel):
    """Bucket counts describing how much of the corpus is actually touched
    by at least one signal.

    Five mutually exclusive buckets (sum = total_reviews):
      - ``positive_only``: ≥1 positive, 0 cautionary, 0 gap
      - ``cautionary_only``: 0 positive, ≥1 cautionary, 0 gap
      - ``gap_only``: 0 positive, 0 cautionary, ≥1 gap (operational signals)
      - ``mixed``: ≥2 signal types fire on the same row
      - ``no_signal``: nothing fires — the "silent" rows

    Rule-based detection with a precision-first lexicon inherently leaves
    many rows silent (attribute-vague praise, short reviews, etc.).
    Surfacing these numbers prevents the reader from assuming "all 591
    rows were analyzed for every signal class" — they weren't; most rows
    contribute only to rating / volume, not to any specific attribute
    finding. The ``no_signal_by_rating`` breakdown flags whether silent
    rows concentrate in 5★ (expected, vague praise) or spill into low
    ratings (concerning — coverage gap).
    """

    total_reviews: int
    rows_with_any_signal: int
    rows_with_no_signal: int
    positive_only: int
    cautionary_only: int
    gap_only: int
    mixed: int
    # {5: count, 4: count, 3: count, 2: count, 1: count} — silent rows per
    # integer rating bucket. Rows with missing/unparseable rating are not
    # included here (counted in rows_with_no_signal but not keyed).
    no_signal_by_rating: dict[int, int] = Field(default_factory=dict)


class ReportProvenance(BaseModel):
    phase1_run_ids: list[str] = Field(default_factory=list)
    sample_review_ids: list[str] = Field(default_factory=list)  # sorted ascending
    lexicon_version: str | None = None
    llm_model: str | None = None
    llm_prompt_hash: str | None = None


# ---------------------------------------------------------------------------
# Derived findings (populated by derived.py)
#
# Cross-cut analyses computed over the already-detected signals + existing
# row-level metadata. Signals answer "what is the corpus saying?"; derived
# findings answer "which segment / flag / dimension concentrates a given
# signal?" — a step toward genuinely analytical reports without adding new
# data.
# ---------------------------------------------------------------------------


class SegmentSignalFinding(BaseModel):
    """One bivariate finding: a signal is overrepresented within a specific
    segment bucket relative to the overall population.

    Reads as: "{bucket} 이용자에서 {signal} 언급률 {within_segment_rate} —
    전체 평균 {overall_rate}의 {lift}× 수준."

    Not a causal claim, not a significance test. Pure descriptive rate
    comparison, filtered by restraint thresholds in derived.py to avoid
    surfacing small-n noise.
    """

    segment_variable: str         # e.g. "normalized_skin_type"
    bucket: str                   # e.g. "sensitive"
    signal_name: str
    signal_display_label: str
    signal_category: SignalCategory
    n_segment: int                # rows in this segment
    n_signal_in_segment: int      # rows in this segment hitting this signal
    within_segment_rate: float    # 4 decimals
    overall_rate: float           # 4 decimals
    lift: float                   # 2 decimals: within_segment_rate / overall_rate
    # Fields populated when the renderer should show quoted evidence +
    # absolute context beside the finding. Defaults keep older callers /
    # synthetic-test fixtures backward-compatible.
    sample_review_ids: list[str] = Field(default_factory=list)  # ≤3 from hit intersection
    segment_share_of_known: float = 0.0  # segment size / sum of known-bucket segments
    segment_avg_rating: float | None = None  # 2-decimal avg rating of segment rows


class ShadeSignalFinding(BaseModel):
    """One bivariate finding: within the dominant product, a signal is
    overrepresented on a specific shade (SKU color variant) relative to the
    product-wide rate.

    Reads as: "대표 제품의 {shade} 셰이드에서 {signal} 언급률
    {within_shade_rate} — 제품 평균 {overall_rate}의 {lift}× 수준."

    Scoped to the dominant product only to keep comparisons within a
    single SKU lineage. Not a causal claim. Filtered by restraint
    thresholds in derived.py (``_MIN_SHADE_SIZE``, ``_MIN_EVIDENCE_IN_SHADE``,
    ``_MIN_LIFT``).
    """

    product_id: str
    shade: str
    signal_name: str
    signal_display_label: str
    signal_category: SignalCategory
    n_shade: int                 # rows of the dominant product with this shade
    n_signal_in_shade: int       # rows in this shade hitting the signal
    within_shade_rate: float     # 4 decimals
    overall_rate: float          # 4 decimals: signal rate within dominant product
    lift: float                  # 2 decimals
    # Context fields for richer rendering. Same back-compat pattern as
    # SegmentSignalFinding.
    sample_review_ids: list[str] = Field(default_factory=list)  # ≤3 from hit intersection
    shade_share_of_product: float = 0.0   # shade size / dominant-product total
    shade_avg_rating: float | None = None  # 2-decimal avg rating of shade rows


class RatingContentDivergence(BaseModel):
    """One divergence cell: the rating axis says one thing and the
    signal-layer content-interpretation says something in tension with it.

    Two cells supported in v1:
      - ``high_rated_with_concerns`` (rating >= 4 AND ≥ 1 cautionary hit)
        — the primary outbound-actionable finding.
      - ``low_rated_without_concerns`` (rating <= 2 AND 0 cautionary hits)
        — secondary, may legitimately not surface on small-low-rating
        corpora; useful as a lexicon-coverage gap indicator.

    Not a causal claim. Descriptive only: "X of Y rows in this rating band
    also meet the content condition." Filtered by restraint thresholds in
    derived.py (MIN_DIVERGENCE_COUNT, MIN_POPULATION_SIZE, MIN_DIVERGENCE_RATE).
    """

    kind: Literal["high_rated_with_concerns", "low_rated_without_concerns"]
    rating_bound: int                  # 4 (for ≥4) or 2 (for ≤2)
    rating_condition: Literal[">=", "<="]
    population_size: int               # rows matching the rating condition
    cell_count: int                    # rows in the divergence cell
    within_rate: float                 # cell_count / population_size, 4 decimals
    sample_review_ids: list[str] = Field(default_factory=list)  # ≤3, sorted ascending


class DerivedFindings(BaseModel):
    """Container for cross-cut analyses. v1 carries segment×signal plus
    rating×content findings; future cross-cuts (shade×signal concentration,
    oy_has_photo divergence, review-type bias) will join here as sibling
    fields without changing existing ones.
    """

    segment_signal_findings: list[SegmentSignalFinding] = Field(default_factory=list)
    shade_signal_findings: list[ShadeSignalFinding] = Field(default_factory=list)
    rating_content_divergences: list[RatingContentDivergence] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Root
# ---------------------------------------------------------------------------


class Phase1Report(BaseModel):
    report_id: str
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    generated_at: datetime
    query: ReportQuery
    scope: ReportScope
    deterministic_metrics: DeterministicMetrics
    signals: SignalsBundle = Field(default_factory=SignalsBundle)
    narrative: NarrativeBlock | None = None
    derived: DerivedFindings = Field(default_factory=DerivedFindings)
    coverage: SignalCoverage | None = None
    provenance: ReportProvenance = Field(default_factory=ReportProvenance)
