"""Phase 2E snapshot trend module - cross-run comparison.

Persists a per-attribute summary of one pipeline run (a "snapshot")
and computes simple deltas vs. the most recent prior snapshot of the
same product. The PDF renderer consumes the resulting comparison to
draw the "최근 변화 신호" section.

Sampling-bias safeguard (locked invariant)
-----------------------------------------
Snapshots MUST be built from the DATETIME_DESC primary corpus only.
Signal sorts (`RATING_ASC`, `RATING_DESC`, `USEFUL_SCORE_DESC`,
`RECOMMENDED_DESC`) are biased top-N samples - they may serve as
*evidence-strength metadata* for individual reviews but MUST NOT
contribute to the snapshot's denominators or per-attribute counts.

Enforcement is layered:

  1. `is_primary_corpus_review()` - defensive filter that inspects
     each raw review's `raw_metadata.oy_is_primary_corpus` /
     `oy_sort_type`. Used by `aggregate_primary_only()`.
  2. `build_snapshot()` raises `ValueError` when the caller's
     `provenance.primary_sort_type` is not `"DATETIME_DESC"`.
  3. `compare_snapshots()` refuses to compute deltas across
     incompatible provenance (different sort or cap policy) -
     it returns a comparison with `comparability_status` set
     and empty deltas.
  4. PDF renderer labels every ratio as "최신순 수집 코퍼스 기준"
     so operators do not read trend numbers as whole-corpus rates.

Inputs (read-only)
------------------
- `ProductReportData` from `report.aggregate_product` - already
  carries per-attribute counts, intensities, and evidence samples.
  Caller is responsible for passing a primary-corpus-only
  `ProductReportData` (via `aggregate_primary_only`); this module
  trusts the input shape but verifies provenance.
- `compute_priority_score` from `executive_summary` - reused, not
  redefined.

Outputs
-------
- `Snapshot` (frozen dataclass, schema v2) - JSON-serialized.
- `SnapshotComparison` (frozen dataclass) - pure delta computation;
  carries `comparability_status` and `coverage_warning` flags.

Storage
-------
JSON-per-snapshot at `{root}/{goods_no}/{collected_at}.json` where the
filename is the ISO 8601 UTC timestamp with `:` replaced by `-`.

Out of scope
------------
- Changing the detector, aggregator, or scoring formulas.
- Causal interpretation. Deltas are correlational.
- Multi-channel comparison.
- Snapshot file rotation.

Design notes - noise floors
---------------------------
The numeric thresholds below are **noise floors, not tuned values**.
They prevent a 1-or-2-review wobble from flipping a "stable"
attribute into "rising." Revisit after several runs of real data
have accumulated; do not present them to operators as calibrated.

  - `NOISE_BAND_SHARE = 0.02`         - direction band on negative-share
  - `NOISE_FLOOR_COUNT_DELTA = 3`     - direction band on absolute
                                        n_negative delta (composes AND
                                        with the share band)
  - `TOP_RISING_N_NEG_FLOOR = 5`      - current-run n_negative floor for
                                        a "rising" delta to be top_rising
  - `TOP_IMPROVING_N_NEG_FLOOR = 5`   - same for top_improving
  - `DELTA_DENOMINATOR_FLOOR = 10`    - (n_pos + n_neg) ≥ 10 in BOTH
                                        snapshots required to classify
  - `COVERAGE_WARNING_THRESHOLD = 0.80` - coverage_ratio below this
                                        triggers the "전체 리뷰 중 일부
                                        표본..." caveat in the PDF
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Literal

from src.voc.reporting.phase2e.executive_summary import compute_priority_score
from src.voc.reporting.phase2e.report import (
    ProductReportData,
    aggregate_product,
)


# ---------------------------------------------------------------------------
# Constants - noise floors and rubric thresholds. See module docstring;
# do NOT present these as tuned thresholds to operators.
# ---------------------------------------------------------------------------

# Schema v3 (2026-04-28 data-contract refinement). v2 introduced
# CorpusProvenance with primary_sort_type/cap_policy/coverage; v3
# adds corpus_type, sampling_strategy, is_full_corpus, sampling_notes,
# and a derived confidence_level. Loader rejects any file that isn't
# v3 - older files have no sampling_strategy + confidence_level fields,
# so they cannot be safely compared without silent reclassification.
SNAPSHOT_SCHEMA_VERSION: int = 3

PRIMARY_SORT_TYPE: str = "DATETIME_DESC"

NOISE_BAND_SHARE: float = 0.02
NOISE_FLOOR_COUNT_DELTA: int = 3
TOP_RISING_N_NEG_FLOOR: int = 5
TOP_IMPROVING_N_NEG_FLOOR: int = 5
DELTA_DENOMINATOR_FLOOR: int = 10
COVERAGE_WARNING_THRESHOLD: float = 0.80

# Confidence-level rubric thresholds (see docs/phase2e_review_data_contract.md
# §2.2). Boundaries are interpretation floors, not tuned values.
CONFIDENCE_HIGH_FULL_MIN_N: int = 30          # is_full_corpus path
CONFIDENCE_HIGH_COVERAGE_MIN: float = 0.80    # coverage_ratio path
CONFIDENCE_HIGH_COVERAGE_MIN_N: int = 100
CONFIDENCE_MEDIUM_COVERAGE_MIN: float = 0.50
CONFIDENCE_MEDIUM_COVERAGE_MIN_N: int = 50
CONFIDENCE_MEDIUM_UNKNOWN_COVERAGE_MIN_N: int = 200

# Signal-stability rubric thresholds. Distinct axis from
# confidence_level - stability emphasizes sample SIZE + sampling
# METHOD, while confidence emphasizes coverage + full-corpus
# guarantees. Both flow through to the PDF: confidence drives the
# wording lock, stability drives a separate per-card chip + verdict
# sentence so operators see two complementary trustworthiness
# framings. Boundaries are heuristics; revisit after operator
# feedback.
STABILITY_HIGH_MIN_N: int = 1000
STABILITY_HIGH_COVERAGE_MIN: float = 0.50
STABILITY_MEDIUM_MIN_N: int = 300

# Sample-size guard - even when sort/cap/strategy match, refuse to
# compare snapshots whose primary-corpus sizes are >30% apart. Same
# strategy with very different N can distort trend interpretation
# (e.g. anti-bot abandonment one run, full crawl the next).
SAMPLE_SIZE_GUARD_RELATIVE_THRESHOLD: float = 0.30

# Korean strings the PDF renderer cites verbatim. Lock them here so a
# wording change requires touching this module (and the locked tests)
# rather than rippling through the renderer.
COVERAGE_WARNING_KO: str = (
    "전체 리뷰 중 일부 표본 기준이므로 비율 해석에 주의가 필요합니다."
)
INCOMPARABLE_SORT_REASON_KO: str = (
    "직전 수집과 정렬 기준이 달라 비교 신호를 산출하지 않았습니다."
)
INCOMPARABLE_CAP_REASON_KO: str = (
    "직전 수집과 수집 한도가 달라 비교 신호를 산출하지 않았습니다."
)
INCOMPARABLE_CORPUS_TYPE_REASON_KO: str = (
    "직전 수집과 코퍼스 종류(관측/파트너)가 달라 비교 신호를 산출하지 않았습니다."
)
INCOMPARABLE_STRATEGY_REASON_KO: str = (
    "직전 수집과 표본 추출 전략이 달라 비교 신호를 산출하지 않았습니다."
)
INCOMPARABLE_SAMPLE_SIZE_REASON_KO: str = (
    "직전 수집과 표본 크기 차이가 30%를 초과해 비교 신호를 산출하지 않았습니다."
)
NON_PRIMARY_SORT_REASON_KO: str = (
    "최신순(DATETIME_DESC) 코퍼스가 아니어서 비교 신호를 산출하지 않았습니다."
)
LOW_CONFIDENCE_DIRECTIONAL_RISING_KO: str = "증가 방향 - 정량 비교 보류"
LOW_CONFIDENCE_DIRECTIONAL_IMPROVING_KO: str = "감소 방향 - 정량 비교 보류"
LOW_CONFIDENCE_ACTION_CHIP_KO: str = "추가 관찰 후보"

# Signal-stability sentence appended below the Executive Verdict box
# in the redesigned PDF. Each level reads as a closing caveat for the
# operator, complementary to (not redundant with) the confidence chip
# in Key Metrics. Wording-safety: phrases hedge with 권장 / 판단 /
# 해석 / 보류 - never 원인 / 개선 필요 / 해야 합니다.
STABILITY_VERDICT_HIGH_KO: str = (
    "반복 확인 -신호 해석에 안정적인 리뷰 규모로 판단됩니다."
)
STABILITY_VERDICT_MEDIUM_KO: str = (
    "반복 확인 -방향성 해석에 활용 가능하며, "
    "추가 리뷰 누적이 권장됩니다."
)
STABILITY_VERDICT_LOW_KO: str = (
    "반복 확인 제한적 - 정량 비교는 보류하고 방향성 참고 수준으로 "
    "해석할 것이 권장됩니다."
)


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


Direction = Literal["rising", "improving", "stable", "new", "resolved"]

ComparabilityStatus = Literal[
    "ok",                          # provenance matches; deltas computed
    "no_previous",                 # first run for this product
    "incomparable_sort",           # primary_sort_type differs
    "incomparable_cap",            # cap_policy differs
    "incomparable_corpus_type",    # corpus_type differs (observed vs partner)
    "incomparable_strategy",       # sampling_strategy differs
    "incomparable_sample_size",    # >30% relative size mismatch
    "non_primary_sort",            # current snapshot's sort isn't DATETIME_DESC
]

CorpusType = Literal[
    "observed_scrape",
    "partner_full_export",
    "partner_incremental_api",
]

SamplingStrategy = Literal[
    "latest_only",
    "latest_plus_signal",
    "observable_multi_sort_corpus",
    "stratified",
    "full_export",
]

ConfidenceLevel = Literal["high", "medium", "low"]

SignalStability = Literal["high", "medium", "low"]


def compute_signal_stability(
    *,
    collected_review_count: int,
    coverage_ratio: float | None,
    corpus_type: "CorpusType",
    primary_sort_type: str,
) -> SignalStability:
    """Derive `signal_stability` from sample size + coverage + sampling
    method.

    Rubric (heuristic; boundaries are interpretation floors):
      - heavy_sampling_bias = (corpus_type == "observed_scrape" AND
                                primary_sort_type != "DATETIME_DESC").
        A signal-sort-only corpus is severely biased; signal stability
        is "low" regardless of N.
      - low: collected_review_count < 300 OR heavy_sampling_bias
      - high: collected_review_count >= 1000 AND
              coverage_ratio is known AND coverage_ratio >= 0.50
      - medium: everything else (n >= 300, not heavy bias, not high)

    Distinct from `compute_confidence_level`:
      - confidence weights coverage + full-corpus guarantees
      - stability weights sample SIZE + sampling METHOD
    Both flow through to the PDF; operators read confidence as
    "how representative is the corpus" and stability as "how
    much volume + non-bias backs the per-issue signals."
    """
    heavy_bias = (
        corpus_type == "observed_scrape"
        and primary_sort_type != PRIMARY_SORT_TYPE
    )
    if heavy_bias:
        return "low"
    if collected_review_count < STABILITY_MEDIUM_MIN_N:
        return "low"
    if (
        collected_review_count >= STABILITY_HIGH_MIN_N
        and coverage_ratio is not None
        and coverage_ratio >= STABILITY_HIGH_COVERAGE_MIN
    ):
        return "high"
    return "medium"


def compute_confidence_level(
    *,
    is_full_corpus: bool,
    coverage_ratio: float | None,
    collected_review_count: int,
) -> ConfidenceLevel:
    """Derive `confidence_level` from the other provenance fields.

    Rubric (see docs/phase2e_review_data_contract.md §2.2):
      high:
        - is_full_corpus AND collected_review_count >= 30, OR
        - coverage_ratio >= 0.80 AND collected_review_count >= 100
      medium:
        - coverage_ratio >= 0.50 AND collected_review_count >= 50, OR
        - coverage_ratio is None AND collected_review_count >= 200
      low:
        - everything else

    Boundaries are interpretation floors, NOT tuned values.
    """
    if is_full_corpus and collected_review_count >= CONFIDENCE_HIGH_FULL_MIN_N:
        return "high"
    if (
        coverage_ratio is not None
        and coverage_ratio >= CONFIDENCE_HIGH_COVERAGE_MIN
        and collected_review_count >= CONFIDENCE_HIGH_COVERAGE_MIN_N
    ):
        return "high"
    if (
        coverage_ratio is not None
        and coverage_ratio >= CONFIDENCE_MEDIUM_COVERAGE_MIN
        and collected_review_count >= CONFIDENCE_MEDIUM_COVERAGE_MIN_N
    ):
        return "medium"
    if (
        coverage_ratio is None
        and collected_review_count >= CONFIDENCE_MEDIUM_UNKNOWN_COVERAGE_MIN_N
    ):
        return "medium"
    return "low"


@dataclass(frozen=True)
class CorpusProvenance:
    """Identifies how the snapshot's corpus was assembled.

    `compare_snapshots` consults this to refuse comparisons across
    incompatible collection methods, and the PDF renderer uses it to
    label every ratio as "최신순 수집 코퍼스 기준" rather than letting
    operators read trend numbers as whole-corpus rates.

    Fields
    ------
    corpus_type
        Source-of-truth flag for ratio phrasing. Only
        `partner_full_export` may earn the "전체 리뷰 기준" framing
        (and even then requires `is_full_corpus=true`).
    sampling_strategy
        Caller-declared sampling intent. Even with matching sort/cap,
        cross-strategy comparisons are refused: a `latest_only` run
        and a `latest_plus_signal` run have different selection
        effects on the evidence pool that feeds priority scoring.
    primary_sort_type
        The sort that defined the corpus, e.g. "DATETIME_DESC". Only
        DATETIME_DESC produces a sampling-bias-safe primary corpus
        for observed scrapes; partner exports use `"PARTNER_FULL"`
        / `"PARTNER_INCREMENTAL"` sentinels.
    cap_policy
        The `--max-reviews` arg the runner used. "all" for multi-sort
        primary scrape; otherwise the numeric cap as a string. The
        comparability gate requires byte-exact equality across runs.
    collected_primary_review_count
        Reviews in the snapshot's corpus AFTER the primary-corpus
        filter. The denominator for `negative_share` per attribute.
    total_review_count_available
        Optional - total reviews shown on the source product page,
        when the connector or partner reports it. None when unknown.
    coverage_ratio
        `collected_primary_review_count / total_review_count_available`
        when total is known and > 0; None otherwise. Below
        `COVERAGE_WARNING_THRESHOLD` the PDF emits the
        "전체 리뷰 중 일부 표본..." caveat.
    is_full_corpus
        True only when the corpus is provably the full set of reviews
        for the product (typically `corpus_type=partner_full_export`
        with `coverage_ratio == 1.0`).
    sampling_notes
        Free-text caveats. E.g. "anti-bot abandonment at page 18".
    confidence_level
        DERIVED, not caller-supplied. `field(init=False)` - passing
        it to the constructor raises TypeError. Computed in
        `__post_init__` via `compute_confidence_level()` so a
        partner cannot self-declare `high` with biased data.
    """
    corpus_type: CorpusType
    sampling_strategy: SamplingStrategy
    primary_sort_type: str
    cap_policy: str
    collected_primary_review_count: int
    total_review_count_available: int | None
    coverage_ratio: float | None
    is_full_corpus: bool
    sampling_notes: str | None = None
    # init=False enforces the "derived, not partner-supplied" rule:
    # passing confidence_level=... to the constructor raises TypeError.
    # The default sentinel is overwritten by __post_init__ before any
    # caller observes it.
    confidence_level: ConfidenceLevel = field(init=False, default="low")
    # Same enforcement for signal_stability - distinct axis from
    # confidence_level (size + sampling method, not coverage). Same
    # init=False discipline so a partner cannot self-declare "high"
    # with a small biased sample.
    signal_stability: SignalStability = field(init=False, default="low")

    def __post_init__(self) -> None:
        derived_confidence = compute_confidence_level(
            is_full_corpus=self.is_full_corpus,
            coverage_ratio=self.coverage_ratio,
            collected_review_count=self.collected_primary_review_count,
        )
        derived_stability = compute_signal_stability(
            collected_review_count=self.collected_primary_review_count,
            coverage_ratio=self.coverage_ratio,
            corpus_type=self.corpus_type,
            primary_sort_type=self.primary_sort_type,
        )
        # frozen=True forbids normal assignment; bypass via setattr.
        object.__setattr__(self, "confidence_level", derived_confidence)
        object.__setattr__(self, "signal_stability", derived_stability)


@dataclass(frozen=True)
class AttributeSnapshot:
    """Per-attribute slice of a snapshot.

    `negative_share` denominator is `(n_positive + n_negative)` -
    polarity share, NOT prevalence. Different from
    `executive_summary.compute_priority_score`'s internal
    `n_negative / n_reviews` (which is prevalence). Both are valid
    but answer different questions, so they live in different fields.

    `priority_score` mirrors the report's priority score for this
    attribute, or None when `n_negative == 0` (the priority-score
    function returns 0.0 for both "no data" and "score happens to
    be 0," so the snapshot promotes the no-data case to None to keep
    the delta logic well-defined).
    """
    n_positive: int
    n_negative: int
    negative_share: float | None
    avg_intensity_neg: float
    priority_score: float | None


@dataclass(frozen=True)
class Snapshot:
    """One run's worth of per-product summary, JSON-serializable.

    `n_reviews` and `n_records` count only the primary-corpus rows;
    `provenance.collected_primary_review_count` is the same number
    surfaced explicitly so consumers can read it without re-deriving.
    """
    schema_version: int
    goods_no: str
    product_name: str
    collected_at: str            # ISO 8601 UTC, e.g. "2026-04-28T15:30:00Z"
    n_reviews: int
    n_records: int
    attributes: dict[str, AttributeSnapshot]
    provenance: CorpusProvenance


@dataclass(frozen=True)
class AttributeDelta:
    """One row of the snapshot comparison.

    Direction = stable when EITHER the share band or the count delta
    gate is not cleared, OR when the denominator-floor safeguard
    excludes the attribute. AND-logic is the noise-reducing reading;
    see `_direction` for the rules.
    """
    attribute: str
    direction: Direction
    negative_share_current: float | None
    negative_share_previous: float | None
    negative_share_delta: float | None
    n_negative_current: int | None
    n_negative_previous: int | None
    priority_score_current: float | None
    priority_score_previous: float | None


@dataclass(frozen=True)
class SnapshotComparison:
    """Snapshot-to-snapshot comparison output. Pure data; no rendering.

    `comparability_status` distinguishes among five paths:
      - "ok"                : provenance matches → deltas populated
      - "no_previous"       : first run → all delta fields empty
      - "incomparable_sort" : sort_type differs → empty + reason
      - "incomparable_cap"  : cap_policy differs → empty + reason
      - "non_primary_sort"  : current snapshot is non-primary →
                              snapshot is still emitted for storage
                              but the renderer suppresses the trend
                              section to avoid bias
    The renderer reads `comparability_reason` for the user-facing
    Korean message. The renderer reads `coverage_warning` (set when
    current snapshot's `coverage_ratio < COVERAGE_WARNING_THRESHOLD`)
    independently of comparability status.
    """
    current_collected_at: str
    previous_collected_at: str | None    # None on first run / non-comparable
    days_between: int | None
    deltas: list[AttributeDelta]
    top_rising: AttributeDelta | None
    top_improving: AttributeDelta | None
    new_attributes: list[AttributeDelta]
    comparability_status: ComparabilityStatus
    comparability_reason: str | None
    coverage_warning: str | None


# ---------------------------------------------------------------------------
# Build - ProductReportData → Snapshot
# ---------------------------------------------------------------------------


def _negative_share(n_pos: int, n_neg: int) -> float | None:
    denom = n_pos + n_neg
    if denom <= 0:
        return None
    return n_neg / denom


def _iso(dt: datetime) -> str:
    """ISO 8601 UTC string, second precision, trailing Z."""
    dt = dt.astimezone(timezone.utc).replace(microsecond=0)
    return dt.isoformat().replace("+00:00", "Z")


def _filename_for(collected_at_iso: str) -> str:
    """Filesystem-safe filename. Lexical sort = chronological sort."""
    return collected_at_iso.replace(":", "-") + ".json"


def build_snapshot(
    data: ProductReportData,
    *,
    collected_at: datetime,
    provenance: CorpusProvenance,
) -> Snapshot:
    """Project a `ProductReportData` into a JSON-serializable snapshot.

    Reuses `compute_priority_score()` unchanged - the snapshot's
    `priority_score` field is the same number the executive summary
    already shows.

    The caller MUST pass `provenance` describing how the corpus was
    assembled. This module does not silently default the sort type:
    a missing provenance means the caller didn't think about
    sampling bias, which is exactly the case we want to surface.

    Note: building a snapshot whose `provenance.primary_sort_type`
    is not `"DATETIME_DESC"` is allowed (so callers can store
    historical context) but `compare_snapshots` will refuse to
    compute deltas across or to a non-primary snapshot.
    """
    if collected_at.tzinfo is None:
        # Naive datetimes are silently local-TZ; normalize to UTC so
        # filenames are stable across machines.
        collected_at = collected_at.replace(tzinfo=timezone.utc)
    else:
        collected_at = collected_at.astimezone(timezone.utc)

    attrs: dict[str, AttributeSnapshot] = {}
    for key, s in data.attribute_summaries.items():
        n_pos = int(s.n_positive)
        n_neg = int(s.n_negative)
        priority: float | None
        if n_neg > 0 and data.n_reviews > 0:
            priority = compute_priority_score(s, data.n_reviews)
        else:
            priority = None
        attrs[key] = AttributeSnapshot(
            n_positive=n_pos,
            n_negative=n_neg,
            negative_share=_negative_share(n_pos, n_neg),
            avg_intensity_neg=float(s.avg_intensity_neg or 0.0),
            priority_score=priority,
        )

    return Snapshot(
        schema_version=SNAPSHOT_SCHEMA_VERSION,
        goods_no=data.product_id,
        product_name=data.product_name,
        collected_at=_iso(collected_at),
        n_reviews=int(data.n_reviews),
        n_records=int(data.n_records),
        attributes=attrs,
        provenance=provenance,
    )


# ---------------------------------------------------------------------------
# Primary-corpus filter - defensive guard against signal-sort rows
# leaking into denominator data.
# ---------------------------------------------------------------------------


def is_primary_corpus_review(raw_review: dict) -> bool:
    """True iff the raw review row is in the DATETIME_DESC primary
    corpus.

    Inspection order:
      1. `raw_metadata.oy_is_primary_corpus` - canonical merged flag
         set by `app.sort_membership` after multi-sort scrapes.
      2. `raw_metadata.oy_sort_type == "DATETIME_DESC"` - single-sort
         path where the user explicitly chose primary.
      3. `"DATETIME_DESC" in raw_metadata.oy_observed_sort_types` -
         covers older multi-sort runs where the merged flag wasn't
         set but the observed-sorts list was.
      4. None of the above → False (legacy / unknown / signal-only
         row, conservative exclude).

    Inputs may be raw dicts (with `raw_metadata_json` as a JSON
    string) OR pre-parsed dicts (with `raw_metadata` as an object).
    Both shapes appear in this codebase, so we accept both.
    """
    meta: dict | None = None
    raw_json = raw_review.get("raw_metadata_json")
    if isinstance(raw_json, str):
        try:
            meta = json.loads(raw_json) if raw_json else None
        except (TypeError, ValueError):
            meta = None
    elif isinstance(raw_review.get("raw_metadata"), dict):
        meta = raw_review["raw_metadata"]
    if not isinstance(meta, dict):
        return False
    if meta.get("oy_is_primary_corpus") is True:
        return True
    if meta.get("oy_sort_type") == PRIMARY_SORT_TYPE:
        return True
    observed = meta.get("oy_observed_sort_types")
    if isinstance(observed, list) and PRIMARY_SORT_TYPE in observed:
        return True
    return False


def select_primary_corpus_review_ids(
    raw_reviews: Iterable[dict],
) -> set[str]:
    """Return the set of review_ids that are in the primary corpus."""
    return {
        r["review_id"] for r in raw_reviews
        if r.get("review_id") and is_primary_corpus_review(r)
    }


def aggregate_primary_only(
    raw_reviews: list[dict],
    review_blocks: list[dict],
    *,
    product_id: str,
    product_name: str,
) -> ProductReportData:
    """Filter `review_blocks` to primary-corpus reviews then aggregate.

    The filter joins by `review_id`, so an upstream `fetch_reviews`
    that already filtered at the SQL layer is fine - this is a
    defense-in-depth pass and a no-op when the upstream filter was
    correctly applied.

    Returns a `ProductReportData` that contains only primary-corpus
    rows, suitable for snapshot building. The existing PDF main body
    is unaffected because callers pass the unfiltered aggregation
    there.
    """
    primary_ids = select_primary_corpus_review_ids(raw_reviews)
    filtered_blocks = [
        rb for rb in review_blocks if rb.get("review_id") in primary_ids
    ]
    return aggregate_product(
        product_id=product_id,
        product_name=product_name,
        reviews=filtered_blocks,
    )


def compute_coverage_ratio(
    collected_primary_review_count: int,
    total_review_count_available: int | None,
) -> float | None:
    """Helper to keep the runner from doing this arithmetic itself.

    Returns None when `total_review_count_available` is missing or 0,
    so the caller can pass through a clean `None` into provenance.
    """
    if not total_review_count_available or total_review_count_available <= 0:
        return None
    return collected_primary_review_count / total_review_count_available


# ---------------------------------------------------------------------------
# I/O
# ---------------------------------------------------------------------------


def _snapshot_to_dict(snapshot: Snapshot) -> dict:
    return {
        "schema_version": snapshot.schema_version,
        "goods_no": snapshot.goods_no,
        "product_name": snapshot.product_name,
        "collected_at": snapshot.collected_at,
        "n_reviews": snapshot.n_reviews,
        "n_records": snapshot.n_records,
        "attributes": {
            k: {
                "n_positive": v.n_positive,
                "n_negative": v.n_negative,
                "negative_share": v.negative_share,
                "avg_intensity_neg": v.avg_intensity_neg,
                "priority_score": v.priority_score,
            }
            for k, v in snapshot.attributes.items()
        },
        "provenance": {
            "corpus_type": snapshot.provenance.corpus_type,
            "sampling_strategy": snapshot.provenance.sampling_strategy,
            "primary_sort_type": snapshot.provenance.primary_sort_type,
            "cap_policy": snapshot.provenance.cap_policy,
            "collected_primary_review_count":
                snapshot.provenance.collected_primary_review_count,
            "total_review_count_available":
                snapshot.provenance.total_review_count_available,
            "coverage_ratio": snapshot.provenance.coverage_ratio,
            "is_full_corpus": snapshot.provenance.is_full_corpus,
            "sampling_notes": snapshot.provenance.sampling_notes,
            # confidence_level + signal_stability are derived; saved
            # for human readability of the file but recomputed on
            # load (loader trusts the rubric, not the persisted value).
            "confidence_level": snapshot.provenance.confidence_level,
            "signal_stability": snapshot.provenance.signal_stability,
        },
    }


def _dict_to_snapshot(raw: dict) -> Snapshot | None:
    """Parse a snapshot dict.

    Returns None when the schema version doesn't match - older v1
    files have no provenance and cannot be safely compared, so we
    treat them as "no history" rather than coercing them into v2.
    """
    if raw.get("schema_version") != SNAPSHOT_SCHEMA_VERSION:
        return None
    prov_raw = raw.get("provenance")
    if not isinstance(prov_raw, dict):
        # v2 file missing provenance - treat as malformed, skip.
        return None
    provenance = CorpusProvenance(
        corpus_type=prov_raw["corpus_type"],
        sampling_strategy=prov_raw["sampling_strategy"],
        primary_sort_type=prov_raw["primary_sort_type"],
        cap_policy=prov_raw["cap_policy"],
        collected_primary_review_count=prov_raw[
            "collected_primary_review_count"
        ],
        total_review_count_available=prov_raw.get(
            "total_review_count_available"
        ),
        coverage_ratio=prov_raw.get("coverage_ratio"),
        is_full_corpus=prov_raw["is_full_corpus"],
        sampling_notes=prov_raw.get("sampling_notes"),
    )
    # confidence_level is recomputed by __post_init__ from the loaded
    # base fields. The JSON's persisted value (if any) is informational
    # only - rubric changes affect historical snapshots, which is
    # acceptable since the doc explicitly notes interpretation floors,
    # not calibrated values.
    attrs = {
        k: AttributeSnapshot(
            n_positive=v["n_positive"],
            n_negative=v["n_negative"],
            negative_share=v["negative_share"],
            avg_intensity_neg=v["avg_intensity_neg"],
            priority_score=v["priority_score"],
        )
        for k, v in raw["attributes"].items()
    }
    return Snapshot(
        schema_version=raw["schema_version"],
        goods_no=raw["goods_no"],
        product_name=raw["product_name"],
        collected_at=raw["collected_at"],
        n_reviews=raw["n_reviews"],
        n_records=raw["n_records"],
        attributes=attrs,
        provenance=provenance,
    )


def save_snapshot(snapshot: Snapshot, root: Path) -> Path:
    """Write the snapshot as `{root}/{goods_no}/{collected_at}.json`.
    Returns the path written.
    """
    target_dir = Path(root) / snapshot.goods_no
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / _filename_for(snapshot.collected_at)
    payload = _snapshot_to_dict(snapshot)
    target.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    return target


def load_previous_snapshot(
    goods_no: str,
    current_collected_at: str,
    root: Path,
) -> Snapshot | None:
    """Return the snapshot whose filename is the largest strictly less
    than the filename for `current_collected_at`.

    Returns None when:
      - no prior snapshot file exists, OR
      - every prior file has a non-matching schema version
        (e.g. a v1 file with no provenance - too risky to compare).

    Walks files newest → oldest; the first one that parses cleanly
    into the current schema is returned. Equality is excluded (a
    snapshot saved at the same timestamp is the current run, not
    the previous one).
    """
    snap_dir = Path(root) / goods_no
    if not snap_dir.exists():
        return None
    candidates = sorted(p for p in snap_dir.glob("*.json") if p.is_file())
    if not candidates:
        return None
    target_filename = _filename_for(current_collected_at)
    for path in reversed(candidates):
        if path.name >= target_filename:
            continue
        parsed = _dict_to_snapshot(
            json.loads(path.read_text(encoding="utf-8"))
        )
        if parsed is not None:
            return parsed
        # else: schema mismatch, keep scanning older snapshots.
    return None


# ---------------------------------------------------------------------------
# Compare
# ---------------------------------------------------------------------------


def _classifiable(snap: AttributeSnapshot) -> bool:
    """Has enough polar volume to participate in delta classification."""
    return (snap.n_positive + snap.n_negative) >= DELTA_DENOMINATOR_FLOOR


def _direction(
    cur: AttributeSnapshot | None,
    prev: AttributeSnapshot | None,
) -> Direction:
    """Pure direction classification.

    Both present:
      - either denominator floor failed   → stable
      - share_delta in (-band, +band)     → stable
      - count_delta in (-floor, +floor)   → stable
      - share_delta and count_delta agree on direction → rising/improving
      - mixed signs                        → stable
    Asymmetric presence:
      - only current, n_neg_current ≥ floor → new
      - only previous, n_neg_previous ≥ floor → resolved
      - otherwise                            → stable
    """
    if cur is None and prev is None:
        return "stable"
    if cur is None and prev is not None:
        if prev.n_negative >= TOP_IMPROVING_N_NEG_FLOOR:
            return "resolved"
        return "stable"
    if prev is None and cur is not None:
        if cur.n_negative >= TOP_RISING_N_NEG_FLOOR:
            return "new"
        return "stable"
    assert cur is not None and prev is not None  # for type narrowing
    if not _classifiable(cur) or not _classifiable(prev):
        return "stable"
    if cur.negative_share is None or prev.negative_share is None:
        return "stable"
    share_delta = cur.negative_share - prev.negative_share
    count_delta = cur.n_negative - prev.n_negative
    if (
        share_delta >= NOISE_BAND_SHARE
        and count_delta >= NOISE_FLOOR_COUNT_DELTA
    ):
        return "rising"
    if (
        share_delta <= -NOISE_BAND_SHARE
        and count_delta <= -NOISE_FLOOR_COUNT_DELTA
    ):
        return "improving"
    return "stable"


def _build_delta(
    attribute: str,
    cur: AttributeSnapshot | None,
    prev: AttributeSnapshot | None,
) -> AttributeDelta:
    direction = _direction(cur, prev)
    cs = cur.negative_share if cur else None
    ps = prev.negative_share if prev else None
    share_delta = (
        (cs - ps) if (cs is not None and ps is not None) else None
    )
    return AttributeDelta(
        attribute=attribute,
        direction=direction,
        negative_share_current=cs,
        negative_share_previous=ps,
        negative_share_delta=share_delta,
        n_negative_current=cur.n_negative if cur else None,
        n_negative_previous=prev.n_negative if prev else None,
        priority_score_current=cur.priority_score if cur else None,
        priority_score_previous=prev.priority_score if prev else None,
    )


def _rising_score(d: AttributeDelta) -> float:
    """Higher when share moved up AND absolute volume is non-trivial."""
    assert d.negative_share_delta is not None
    assert d.n_negative_current is not None
    return d.negative_share_delta * math.log(d.n_negative_current + 1)


def _improving_score(d: AttributeDelta) -> float:
    """Weighted by the magnitude of the issue we improved away from
    (n_neg_previous). 'X complaints → Y' is a larger win when X was
    larger.
    """
    assert d.negative_share_delta is not None
    assert d.n_negative_previous is not None
    return abs(d.negative_share_delta) * math.log(d.n_negative_previous + 1)


def _days_between(later_iso: str, earlier_iso: str) -> int:
    later = datetime.fromisoformat(later_iso.replace("Z", "+00:00"))
    earlier = datetime.fromisoformat(earlier_iso.replace("Z", "+00:00"))
    return (later - earlier).days


def _coverage_warning(snapshot: Snapshot) -> str | None:
    """Coverage caveat when the current snapshot's coverage_ratio is
    below the configured threshold. Returns None when the ratio is
    unknown (no total available) - operators see no warning rather
    than a misleading one based on missing data.
    """
    cr = snapshot.provenance.coverage_ratio
    if cr is None:
        return None
    if cr < COVERAGE_WARNING_THRESHOLD:
        return COVERAGE_WARNING_KO
    return None


def _empty_comparison(
    current: Snapshot,
    previous: Snapshot | None,
    *,
    status: ComparabilityStatus,
    reason: str | None,
) -> SnapshotComparison:
    """Build a 'no deltas' comparison for a non-ok comparability path."""
    return SnapshotComparison(
        current_collected_at=current.collected_at,
        previous_collected_at=(
            previous.collected_at if previous is not None else None
        ),
        days_between=None,
        deltas=[],
        top_rising=None,
        top_improving=None,
        new_attributes=[],
        comparability_status=status,
        comparability_reason=reason,
        coverage_warning=_coverage_warning(current),
    )


def _sample_size_too_different(
    current: Snapshot, previous: Snapshot,
) -> bool:
    """Relative size guard. Same strategy with very different N can
    distort trend interpretation (e.g. anti-bot abandonment one run,
    full crawl the next). Refuse to compare when:

        |n_cur - n_prev| / max(n_cur, n_prev) > 0.30

    Uses `provenance.collected_primary_review_count` (not
    `Snapshot.n_reviews`, which is the same number but accessed
    through provenance to keep the gate's intent explicit).
    """
    n_cur = current.provenance.collected_primary_review_count
    n_prev = previous.provenance.collected_primary_review_count
    if n_cur <= 0 or n_prev <= 0:
        # Degenerate; let earlier gates / no-deltas path handle this.
        return False
    relative = abs(n_cur - n_prev) / max(n_cur, n_prev)
    return relative > SAMPLE_SIZE_GUARD_RELATIVE_THRESHOLD


def compare_snapshots(
    current: Snapshot,
    previous: Snapshot | None,
) -> SnapshotComparison:
    """Pure comparison - same input → same output, no side effects.

    Comparability gate (in order - most fundamental first):
      1. `current.provenance.primary_sort_type != "DATETIME_DESC"`
         → status="non_primary_sort". (Bias is in the current
         snapshot itself; even a perfect previous can't fix it.)
      2. `previous is None` → status="no_previous".
      3. corpus_type mismatch → status="incomparable_corpus_type".
      4. sampling_strategy mismatch → status="incomparable_strategy".
      5. primary_sort_type mismatch → status="incomparable_sort".
      6. cap_policy mismatch → status="incomparable_cap".
      7. >30% relative size mismatch → status="incomparable_sample_size".
      8. All gates pass → status="ok", deltas computed.

    `coverage_warning` is set independently of comparability status:
    if the current snapshot's coverage_ratio is below the threshold,
    the warning fires regardless of whether deltas were computed.
    """
    if current.provenance.primary_sort_type != PRIMARY_SORT_TYPE:
        return _empty_comparison(
            current, previous,
            status="non_primary_sort",
            reason=NON_PRIMARY_SORT_REASON_KO,
        )
    if previous is None:
        return _empty_comparison(
            current, previous,
            status="no_previous",
            reason=None,
        )
    if (
        previous.provenance.corpus_type
        != current.provenance.corpus_type
    ):
        return _empty_comparison(
            current, previous,
            status="incomparable_corpus_type",
            reason=INCOMPARABLE_CORPUS_TYPE_REASON_KO,
        )
    if (
        previous.provenance.sampling_strategy
        != current.provenance.sampling_strategy
    ):
        return _empty_comparison(
            current, previous,
            status="incomparable_strategy",
            reason=INCOMPARABLE_STRATEGY_REASON_KO,
        )
    if (
        previous.provenance.primary_sort_type
        != current.provenance.primary_sort_type
    ):
        return _empty_comparison(
            current, previous,
            status="incomparable_sort",
            reason=INCOMPARABLE_SORT_REASON_KO,
        )
    if previous.provenance.cap_policy != current.provenance.cap_policy:
        return _empty_comparison(
            current, previous,
            status="incomparable_cap",
            reason=INCOMPARABLE_CAP_REASON_KO,
        )
    if _sample_size_too_different(current, previous):
        return _empty_comparison(
            current, previous,
            status="incomparable_sample_size",
            reason=INCOMPARABLE_SAMPLE_SIZE_REASON_KO,
        )

    keys = sorted(
        set(current.attributes.keys()) | set(previous.attributes.keys())
    )
    deltas = [
        _build_delta(
            k, current.attributes.get(k), previous.attributes.get(k)
        )
        for k in keys
    ]
    rising = [
        d for d in deltas
        if d.direction == "rising"
        and d.n_negative_current is not None
        and d.n_negative_current >= TOP_RISING_N_NEG_FLOOR
    ]
    top_rising = max(rising, key=_rising_score) if rising else None
    improving = [
        d for d in deltas
        if d.direction == "improving"
        and d.n_negative_previous is not None
        and d.n_negative_current is not None
        and max(
            d.n_negative_current, d.n_negative_previous
        ) >= TOP_IMPROVING_N_NEG_FLOOR
    ]
    top_improving = (
        max(improving, key=_improving_score) if improving else None
    )
    new_attributes = [d for d in deltas if d.direction == "new"]
    return SnapshotComparison(
        current_collected_at=current.collected_at,
        previous_collected_at=previous.collected_at,
        days_between=_days_between(
            current.collected_at, previous.collected_at,
        ),
        deltas=deltas,
        top_rising=top_rising,
        top_improving=top_improving,
        new_attributes=new_attributes,
        comparability_status="ok",
        comparability_reason=None,
        coverage_warning=_coverage_warning(current),
    )
