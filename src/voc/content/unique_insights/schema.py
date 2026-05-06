"""Python literals + dataclasses for unique product insights.

Mirrors `schemas/unique_product_insights.schema.json` v1.0. Keeping
the constants in Python lets tests pin them without re-parsing JSON
at every assertion, and lets the validator share enum values with
the candidate pool.

Frozen dataclasses are used for the candidate pool so the pre-pass
output is unambiguously immutable (operators can't accidentally
mutate the structure between build + validation).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


# ---------------------------------------------------------------------------
# Schema version
# ---------------------------------------------------------------------------

UNIQUE_INSIGHTS_SCHEMA_VERSION: str = "1.0"

# ---------------------------------------------------------------------------
# Enums (mirror the JSON Schema's enum values exactly)
# ---------------------------------------------------------------------------

InsightType = Literal[
    "unique_strength",
    "unique_weakness",
    "unique_tradeoff",
    "usage_context",
    "packaging_value",
]
INSIGHT_TYPES: tuple[str, ...] = (
    "unique_strength",
    "unique_weakness",
    "unique_tradeoff",
    "usage_context",
    "packaging_value",
)

ConfidenceLevel = Literal["weak", "moderate", "strong"]
CONFIDENCE_LEVELS: tuple[str, ...] = ("weak", "moderate", "strong")

RelevanceLevel = Literal["high", "moderate", "low"]
RELEVANCE_LEVELS: tuple[str, ...] = ("high", "moderate", "low")

BaselineSource = Literal["profile_curated", "snapshot_aggregate", "uncertain"]
BASELINE_SOURCES: tuple[str, ...] = (
    "profile_curated",
    "snapshot_aggregate",
    "uncertain",
)

KNOWN_RISK_FLAGS: tuple[str, ...] = (
    "category_baseline_uncertain",
    "evidence_thin",
    "polarity_ambiguous",
    "low_corpus_n",
)

# ---------------------------------------------------------------------------
# Hard limits — mirrored in the JSON Schema; restated here so the
# validator and the extractor's prompt builder share one source of
# truth.
# ---------------------------------------------------------------------------

MAX_INSIGHTS: int = 6
MIN_EVIDENCE_REVIEW_IDS: int = 2
MAX_EVIDENCE_REVIEW_IDS: int = 5
MAX_TITLE_CHARS_KO: int = 30
MAX_EXPLANATION_CHARS_KO: int = 200
MAX_WHAT_MAKES_UNIQUE_CHARS_KO: int = 200

# Every insight must cite ≥1 candidate_pool entry it derived from.
# Caps the LLM's ability to invent unanchored claims even when the
# evidence-quote check would technically pass.
MIN_SOURCE_CANDIDATE_IDS: int = 1
MAX_SOURCE_CANDIDATE_IDS: int = 8

# Candidate-id bucket prefixes. Pinned constants so extractor prompts
# and validator can share the same vocabulary, and so test fixtures
# can construct synthetic ids without hard-coding strings.
CANDIDATE_ID_PREFIX_BY_BUCKET: dict[str, str] = {
    "high_frequency_strengths": "cand_strength",
    "concentrated_complaints": "cand_complaint",
    "cross_attribute_tradeoffs": "cand_tradeoff",
    "polarity_outliers": "cand_outlier",
    "usage_context_signals": "cand_usage",
}

# Per-bucket caps for the deterministic candidate pool. Restated rather
# than re-derived from the JSON Schema's `maxItems` so the candidate
# pool builder can import them cleanly.
MAX_HIGH_FREQUENCY_STRENGTHS: int = 5
MAX_CONCENTRATED_COMPLAINTS: int = 5
MAX_CROSS_ATTRIBUTE_TRADEOFFS: int = 3
MAX_POLARITY_OUTLIERS: int = 5
MAX_USAGE_CONTEXT_SIGNALS: int = 3

# Default thresholds for inclusion in each bucket. Names are loud so
# operators can override at the call site.
HIGH_FREQUENCY_STRENGTHS_MIN_N_POSITIVE: int = 10
CONCENTRATED_COMPLAINTS_MIN_N_NEGATIVE: int = 5
CROSS_ATTRIBUTE_TRADEOFFS_MIN_COUNT: int = 3
POLARITY_OUTLIER_MIN_TOTAL: int = 10
POLARITY_OUTLIER_NEGATIVE_SHARE_THRESHOLD: float = 0.4
POLARITY_OUTLIER_DEVIATION_THRESHOLD: float = 0.25

# Default soft cap on the cumulative size of `bounded_review_excerpts`
# (sum of values' lengths). Keeps LLM-prompt cost bounded in Phase E3.
DEFAULT_BOUNDED_EXCERPT_MAX_CHARS: int = 8000


# ---------------------------------------------------------------------------
# Locked baseline-caveat phrases
# ---------------------------------------------------------------------------
#
# Operator-facing Korean text. The candidate-pool builder picks one of
# these depending on which baseline path was taken. Pinned constants so
# tests can assert exact strings without dragging in template logic.

BASELINE_CAVEAT_PROFILE_CURATED_KO: str = (
    "이 카테고리 프로파일에 정의된 평균 분포와 비교한 결과입니다."
)
BASELINE_CAVEAT_SNAPSHOT_AGGREGATE_KO: str = (
    "동일 카테고리의 과거 스냅샷 평균과 비교한 결과입니다."
)
BASELINE_CAVEAT_UNCERTAIN_KO: str = (
    "이 카테고리의 평균 분포가 아직 정의되지 않아 비교 기준은 가설입니다."
)


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CandidateBucketEntry:
    """One signal observation surfaced by the deterministic pre-pass.

    `candidate_id` is a stable identifier the LLM extractor cites in
    each insight's `source_candidate_ids[]`. Format:
    `cand_<bucket>_<NNN>` (3-digit zero-padded index within the
    bucket, post-sort/cap). The validator rejects any insight whose
    `source_candidate_ids` references an id not present in the
    pool.

    `attribute_key` is the analysis-report attribute key (e.g.
    "pigmentation") for single-attribute buckets, OR the tradeoff
    pair string (e.g. "pigmentation:positive -> transfer_resistance:negative")
    for `cross_attribute_tradeoffs`, OR a synthetic
    `usage_context__<i>` key for usage-context entries.

    `evidence_review_ids` and `evidence_excerpts_preview` are
    parallel: `evidence_excerpts_preview[i]` is a verbatim excerpt
    pulled from the review identified by `evidence_review_ids[i]`.
    Both sequences come from the analysis-report's `top_quotes` /
    `top_negative_quotes` fields — never from raw review text.

    `baseline_comparison` is the deviation metric vs the category
    profile's expected positive-share for this attribute. None when
    no profile baseline exists for the attribute.
    """
    candidate_id: str
    attribute_key: str
    label_ko: str | None
    n_pos: int
    n_neg: int
    n_mixed: int
    evidence_review_ids: tuple[str, ...]
    evidence_excerpts_preview: tuple[str, ...]
    baseline_comparison: float | None

    def to_dict(self) -> dict:
        return {
            "candidate_id": self.candidate_id,
            "attribute_key": self.attribute_key,
            "label_ko": self.label_ko,
            "n_pos": self.n_pos,
            "n_neg": self.n_neg,
            "n_mixed": self.n_mixed,
            "evidence_review_ids": list(self.evidence_review_ids),
            "evidence_excerpts_preview": list(self.evidence_excerpts_preview),
            "baseline_comparison": self.baseline_comparison,
        }


@dataclass(frozen=True)
class CandidatePool:
    """Deterministic pre-pass output. The Phase E3 LLM extractor reads
    this (and only this) as its evidence pool."""
    high_frequency_strengths: tuple[CandidateBucketEntry, ...]
    concentrated_complaints: tuple[CandidateBucketEntry, ...]
    cross_attribute_tradeoffs: tuple[CandidateBucketEntry, ...]
    polarity_outliers: tuple[CandidateBucketEntry, ...]
    usage_context_signals: tuple[CandidateBucketEntry, ...]
    category_baseline_source: str  # one of BASELINE_SOURCES
    baseline_caveat_ko: str
    bounded_review_excerpts: tuple[tuple[str, str], ...]

    def excerpts_as_dict(self) -> dict[str, str]:
        """Convenience: dict view of the (review_id, text) pairs.
        Used by the validator's substring check at lookup time."""
        return dict(self.bounded_review_excerpts)

    def to_dict(self) -> dict:
        return {
            "high_frequency_strengths": [
                e.to_dict() for e in self.high_frequency_strengths
            ],
            "concentrated_complaints": [
                e.to_dict() for e in self.concentrated_complaints
            ],
            "cross_attribute_tradeoffs": [
                e.to_dict() for e in self.cross_attribute_tradeoffs
            ],
            "polarity_outliers": [
                e.to_dict() for e in self.polarity_outliers
            ],
            "usage_context_signals": [
                e.to_dict() for e in self.usage_context_signals
            ],
            "category_baseline_source": self.category_baseline_source,
            "baseline_caveat_ko": self.baseline_caveat_ko,
            "bounded_review_excerpts": dict(self.bounded_review_excerpts),
        }
