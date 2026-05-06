"""Four-axis confidence + coverage breakdown for analysis_report.

Background
----------
Run-003 surfaced a known failure mode: a single `confidence_level` field
collapses several distinct concerns into one verdict. When collection is
`partial_success` (e.g. `RATING_ASC` failed) but the corpus is large
(`n=2115`), the legacy size-based rubric reports `confidence_level=high`
while the negative-signal pool is silently under-observed. Operators
read "high" and don't notice the bias.

The fix (this module): expose four orthogonal axes — each computed
from a different evidence stream — so consumer surfaces (PDF, brief,
cardnews) can show the right caveat in the right place.

Axes
----

`sample_size_confidence`
    Pure size signal. high (n≥1000) / medium (n≥300) / low.
    Mirrors the legacy `_resolve_corpus_confidence` rubric so existing
    surfaces don't shift unexpectedly.

`collection_completeness`
    Per-sort scrape outcomes. `complete` when every attempted sort
    succeeded; `partial` when ≥1 sort failed but ≥1 succeeded; `failed`
    when no sort succeeded. Drives the partial-success caution chip.

`negative_signal_coverage`
    Whether the negative-review evidence pool was actually observed.
    `degraded` when RATING_ASC (the dedicated low-rating sort) failed
    even if other sorts succeeded; `partial` when RATING_ASC succeeded
    but other negative-signal sorts (e.g. RECOMMENDED_DESC) failed;
    `complete` otherwise. Surfaced as the "구매 전 확인 포인트" caveat.

`evidence_reliability`
    Polarity audit suspect share. `high` when ≤1% of audited quotes
    were flagged suspect; `medium` when ≤5%; `low` when >5% or audit
    was skipped. Drives the "참고 수준" disclaimer.

Pure: no I/O, no LLM. The four axes are derived solely from
`analysis_report` + `collection_summary` shape. Adapters and PDF
renderers consume the dict.
"""
from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Threshold constants — adjust these in one place when the rubric evolves.
# ---------------------------------------------------------------------------

SAMPLE_SIZE_HIGH_MIN_N: int = 1000
SAMPLE_SIZE_MEDIUM_MIN_N: int = 300

EVIDENCE_RELIABILITY_HIGH_SUSPECT_SHARE_MAX: float = 0.01
EVIDENCE_RELIABILITY_MEDIUM_SUSPECT_SHARE_MAX: float = 0.05

# Sort types whose successful collection drives the negative-signal
# coverage axis. RATING_ASC is the dedicated low-rating sort and the
# strongest signal for negative reviews — its failure is the canonical
# under-observation case run-003 surfaced.
NEGATIVE_SIGNAL_PRIMARY_SORT: str = "RATING_ASC"
NEGATIVE_SIGNAL_SECONDARY_SORTS: tuple[str, ...] = (
    "RECOMMENDED_DESC",
)


# ---------------------------------------------------------------------------
# Reader-friendly Korean phrasing
# ---------------------------------------------------------------------------
#
# Each axis level maps to a short Korean label suitable for the seller
# PDF's headline strip and a one-line operator caveat. Locked phrases
# so PDF tests can assert verbatim.

_SAMPLE_SIZE_LABEL_KO: dict[str, str] = {
    "high": "표본 충분",
    "medium": "표본 보통",
    "low": "표본 작음",
}
_SAMPLE_SIZE_NOTE_KO: dict[str, str] = {
    "high": "리뷰 표본이 충분히 커서 반복되는 패턴을 안정적으로 관찰할 수 있습니다.",
    "medium": "리뷰 표본은 보통 수준이며 신호 해석에 약간의 주의가 필요합니다.",
    "low": "리뷰 표본이 작아 결과는 참고 수준으로 해석해 주십시오.",
}

_COLLECTION_COMPLETENESS_LABEL_KO: dict[str, str] = {
    "complete": "수집 완전",
    "partial": "일부 수집 실패",
    "failed": "수집 실패",
}
_COLLECTION_COMPLETENESS_NOTE_KO: dict[str, str] = {
    "complete": "모든 정렬축 수집이 정상적으로 완료되었습니다.",
    "partial": "일부 정렬에서 수집이 실패하여, 그 정렬의 리뷰는 분석에 포함되지 않았습니다.",
    "failed": "이번 수집은 실패했으며 본 리포트의 신호는 기존 데이터에 의존합니다.",
}

_NEGATIVE_SIGNAL_COVERAGE_LABEL_KO: dict[str, str] = {
    "complete": "아쉬움 의견 반영 충분",
    "partial": "아쉬움 의견 일부만 반영",
    "degraded": "아쉬움 의견 적게 반영",
}
_NEGATIVE_SIGNAL_COVERAGE_NOTE_KO: dict[str, str] = {
    "complete": "낮은 평점 / 불만 리뷰 정렬이 정상 수집되어 아쉬움 의견을 충분히 확인했습니다.",
    "partial": "일부 정렬은 실패했지만 평점 낮은순(RATING_ASC)은 수집되어 핵심 아쉬움 의견은 확인 가능합니다.",
    "degraded": "평점 낮은순(RATING_ASC) 수집 실패로 아쉬움 의견이 실제보다 적게 반영됐을 수 있습니다.",
}

_EVIDENCE_RELIABILITY_LABEL_KO: dict[str, str] = {
    "high": "인용 검증 충분",
    "medium": "일부 인용 추가 확인 필요",
    "low": "인용 추가 확인 필요",
}
_EVIDENCE_RELIABILITY_NOTE_KO: dict[str, str] = {
    "high": "감성 자동 점검에서 의심 인용은 거의 발견되지 않았습니다.",
    "medium": "일부 인용에서 의심 표현이 관측되어 직접 확인을 권장합니다.",
    "low": "의심 표현 비율이 높아 인용은 참고 수준으로 해석해 주십시오.",
}


# ---------------------------------------------------------------------------
# Axis derivations
# ---------------------------------------------------------------------------


def derive_sample_size_confidence(n_reviews: int | None) -> str:
    n = int(n_reviews or 0)
    if n >= SAMPLE_SIZE_HIGH_MIN_N:
        return "high"
    if n >= SAMPLE_SIZE_MEDIUM_MIN_N:
        return "medium"
    return "low"


def derive_collection_completeness(
    *,
    sorts_attempted: list[str] | None,
    sorts_succeeded: list[str] | None,
    sorts_failed: list[str] | None,
    partial_success: bool | None,
) -> str:
    """Reduce the per-sort outcome lists to a 3-state level.

    Defensive: when no list is populated (legacy callers), defaults
    to `complete` to avoid emitting false caveats.
    """
    attempted = list(sorts_attempted or [])
    succeeded = list(sorts_succeeded or [])
    failed = list(sorts_failed or [])
    if not attempted and not succeeded and not failed:
        if partial_success is True:
            return "partial"
        if partial_success is False:
            return "complete"
        return "complete"
    if attempted and not succeeded:
        return "failed"
    if failed:
        return "partial"
    return "complete"


def derive_negative_signal_coverage(
    *,
    sorts_succeeded: list[str] | None,
    sorts_failed: list[str] | None,
) -> str:
    """Specifically scores whether the negative-review evidence pool
    was actually observed. RATING_ASC failure → degraded. Other
    secondary failure → partial. Clean → complete."""
    succeeded = set(sorts_succeeded or [])
    failed = set(sorts_failed or [])
    if NEGATIVE_SIGNAL_PRIMARY_SORT in failed:
        return "degraded"
    if not succeeded and not failed:
        return "complete"
    if any(s in failed for s in NEGATIVE_SIGNAL_SECONDARY_SORTS):
        return "partial"
    return "complete"


def derive_evidence_reliability(
    polarity_audit: dict | None,
) -> str:
    """Score the post-Stage-2 polarity guardrail signal. A high
    suspect-share means quotes Stage 2 labelled positive (or negative)
    appear contradicted by lexical cues — operator should treat them
    as participation evidence, not directional verdicts."""
    if not isinstance(polarity_audit, dict):
        return "low"
    n_total = int(polarity_audit.get("n_total_quotes") or 0)
    if n_total <= 0:
        return "low"
    share = float(polarity_audit.get("n_total_suspect_share") or 0.0)
    if share <= EVIDENCE_RELIABILITY_HIGH_SUSPECT_SHARE_MAX:
        return "high"
    if share <= EVIDENCE_RELIABILITY_MEDIUM_SUSPECT_SHARE_MAX:
        return "medium"
    return "low"


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def compute_confidence_axes(
    *,
    n_reviews: int | None,
    polarity_audit: dict | None = None,
    sorts_attempted: list[str] | None = None,
    sorts_succeeded: list[str] | None = None,
    sorts_failed: list[str] | None = None,
    partial_success: bool | None = None,
) -> dict[str, Any]:
    """Compute the four-axis confidence breakdown.

    Returns a dict shape suitable for placement under
    `analysis_report.corpus.confidence_axes`:

    ```
    {
      "sample_size_confidence":   {"level": "high",     "label_ko": "...", "note_ko": "..."},
      "collection_completeness":  {"level": "partial",  "label_ko": "...", "note_ko": "..."},
      "negative_signal_coverage": {"level": "degraded", "label_ko": "...", "note_ko": "..."},
      "evidence_reliability":     {"level": "high",     "label_ko": "...", "note_ko": "..."},
      "headline_caution":         "<single most-important caveat>" | None
    }
    ```

    `headline_caution` collapses the four axes into a single sentence
    for surfaces that only have room for one caveat (cardnews hero,
    brief tagline). Picks the most operator-relevant caveat by priority:
        degraded negative_signal_coverage > partial collection > low
        evidence_reliability > low sample_size > None.
    """
    sample = derive_sample_size_confidence(n_reviews)
    completeness = derive_collection_completeness(
        sorts_attempted=sorts_attempted,
        sorts_succeeded=sorts_succeeded,
        sorts_failed=sorts_failed,
        partial_success=partial_success,
    )
    neg_coverage = derive_negative_signal_coverage(
        sorts_succeeded=sorts_succeeded,
        sorts_failed=sorts_failed,
    )
    reliability = derive_evidence_reliability(polarity_audit)

    # Headline caution priority — most actionable first. Uses the
    # seller-friendly label so the cardnews / PDF surface inherit it
    # without a translation step.
    headline = None
    if neg_coverage == "degraded":
        headline = _NEGATIVE_SIGNAL_COVERAGE_NOTE_KO["degraded"]
    elif completeness == "partial":
        headline = _COLLECTION_COMPLETENESS_NOTE_KO["partial"]
    elif completeness == "failed":
        headline = _COLLECTION_COMPLETENESS_NOTE_KO["failed"]
    elif reliability == "low":
        headline = _EVIDENCE_RELIABILITY_NOTE_KO["low"]
    elif sample == "low":
        headline = _SAMPLE_SIZE_NOTE_KO["low"]

    return {
        "sample_size_confidence": {
            "level": sample,
            "label_ko": _SAMPLE_SIZE_LABEL_KO[sample],
            "note_ko": _SAMPLE_SIZE_NOTE_KO[sample],
        },
        "collection_completeness": {
            "level": completeness,
            "label_ko": _COLLECTION_COMPLETENESS_LABEL_KO[completeness],
            "note_ko": _COLLECTION_COMPLETENESS_NOTE_KO[completeness],
        },
        "negative_signal_coverage": {
            "level": neg_coverage,
            "label_ko": _NEGATIVE_SIGNAL_COVERAGE_LABEL_KO[neg_coverage],
            "note_ko": _NEGATIVE_SIGNAL_COVERAGE_NOTE_KO[neg_coverage],
        },
        "evidence_reliability": {
            "level": reliability,
            "label_ko": _EVIDENCE_RELIABILITY_LABEL_KO[reliability],
            "note_ko": _EVIDENCE_RELIABILITY_NOTE_KO[reliability],
        },
        "headline_caution": headline,
    }


__all__ = [
    "compute_confidence_axes",
    "derive_sample_size_confidence",
    "derive_collection_completeness",
    "derive_negative_signal_coverage",
    "derive_evidence_reliability",
    "SAMPLE_SIZE_HIGH_MIN_N",
    "SAMPLE_SIZE_MEDIUM_MIN_N",
    "EVIDENCE_RELIABILITY_HIGH_SUSPECT_SHARE_MAX",
    "EVIDENCE_RELIABILITY_MEDIUM_SUSPECT_SHARE_MAX",
    "NEGATIVE_SIGNAL_PRIMARY_SORT",
    "NEGATIVE_SIGNAL_SECONDARY_SORTS",
]
