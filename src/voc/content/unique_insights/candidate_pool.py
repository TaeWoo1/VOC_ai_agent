"""Deterministic candidate-pool builder.

Pure function over `analysis_report.json` (and an optional category
profile dict). Produces five evidence-anchored bucket lists for the
Phase E3 LLM extractor to consume.

Hard contracts
--------------
- Reads `analysis_report` ONLY. No DB, no scraping, no LLM.
- Uses `attributes[*].top_quotes[*]` and
  `monitoring_candidates[*].top_negative_quotes[*]` as the evidence
  source. Raw review text is NOT accessed (it's not in the report).
- `bounded_review_excerpts` is the union of every excerpt across
  attributes + monitoring candidates, keyed by `review_id`. Multiple
  excerpts for the same review_id are concatenated with a newline so
  the validator's substring check has the broadest possible anchor
  surface for an LLM-cited quote.
- Output is byte-stable for byte-stable input (sort orders are
  total; tie-breakers are deterministic).
- No analysis-logic changes; this is a presentation-layer
  re-shaping of already-aggregated fields.

Bucket selection rules
----------------------
Mirror the Phase E design doc. Constants live in `schema.py` so
operators changing thresholds change one place.
"""
from __future__ import annotations

import re
from dataclasses import replace
from typing import Any, Iterable

from src.voc.content.unique_insights.schema import (
    BASELINE_CAVEAT_PROFILE_CURATED_KO,
    BASELINE_CAVEAT_UNCERTAIN_KO,
    CANDIDATE_ID_PREFIX_BY_BUCKET,
    CONCENTRATED_COMPLAINTS_MIN_N_NEGATIVE,
    CROSS_ATTRIBUTE_TRADEOFFS_MIN_COUNT,
    DEFAULT_BOUNDED_EXCERPT_MAX_CHARS,
    HIGH_FREQUENCY_STRENGTHS_MIN_N_POSITIVE,
    MAX_CONCENTRATED_COMPLAINTS,
    MAX_CROSS_ATTRIBUTE_TRADEOFFS,
    MAX_HIGH_FREQUENCY_STRENGTHS,
    MAX_POLARITY_OUTLIERS,
    MAX_USAGE_CONTEXT_SIGNALS,
    POLARITY_OUTLIER_DEVIATION_THRESHOLD,
    POLARITY_OUTLIER_MIN_TOTAL,
    POLARITY_OUTLIER_NEGATIVE_SHARE_THRESHOLD,
    CandidateBucketEntry,
    CandidatePool,
)


# Tradeoff key parser — same shape as the seller pipeline emits.
_TRADEOFF_PAIR_RE = re.compile(
    r"^([a-z_]+):[a-z_]+\s*->\s*([a-z_]+):[a-z_]+$"
)


def _assign_candidate_ids(
    entries: list[CandidateBucketEntry],
    bucket_name: str,
) -> tuple[CandidateBucketEntry, ...]:
    """Replace placeholder candidate_ids with stable bucket-scoped ids.

    Index is 1-based, post-sort + post-cap, so two runs with the
    same input produce identical ids."""
    prefix = CANDIDATE_ID_PREFIX_BY_BUCKET[bucket_name]
    return tuple(
        replace(e, candidate_id=f"{prefix}_{i:03d}")
        for i, e in enumerate(entries, start=1)
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _attribute_index(report: dict) -> dict[str, dict]:
    """Map `attribute_key → attribute_block` for fast lookup."""
    out: dict[str, dict] = {}
    for a in report.get("attributes") or []:
        key = a.get("key")
        if isinstance(key, str) and key:
            out[key] = a
    return out


def _attribute_label_ko(attr: dict) -> str | None:
    label = attr.get("label_ko")
    return label if isinstance(label, str) and label else None


def _quote_review_id(q: Any) -> str | None:
    if not isinstance(q, dict):
        return None
    rid = q.get("review_id")
    return rid if isinstance(rid, str) and rid else None


def _quote_text(q: Any) -> str | None:
    if not isinstance(q, dict):
        return None
    t = q.get("text")
    if not isinstance(t, str):
        return None
    t = t.strip()
    return t or None


def _split_quotes_by_polarity(
    quotes: Iterable[Any],
) -> tuple[list[dict], list[dict]]:
    """Partition a `top_quotes` list into (positive, negative). Quotes
    without polarity default to positive (best-effort; the adapter
    typically tags them)."""
    pos: list[dict] = []
    neg: list[dict] = []
    for q in quotes or []:
        if not isinstance(q, dict):
            continue
        pol = (q.get("polarity") or "").lower()
        if pol in ("negative", "negative_weak", "negative_strong"):
            neg.append(q)
        else:
            pos.append(q)
    return pos, neg


def _evidence_pair(
    quotes: Iterable[Any],
    *,
    cap: int = 5,
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Pull review_id+text pairs from a quote list. Caps both at `cap`,
    drops malformed entries, dedupes review_ids while preserving
    order (keeps the first quote for any review_id)."""
    seen_ids: set[str] = set()
    ids: list[str] = []
    texts: list[str] = []
    for q in quotes or []:
        rid = _quote_review_id(q)
        txt = _quote_text(q)
        if not rid or not txt:
            continue
        if rid in seen_ids:
            continue
        seen_ids.add(rid)
        ids.append(rid)
        texts.append(txt)
        if len(ids) >= cap:
            break
    return tuple(ids), tuple(texts)


# ---------------------------------------------------------------------------
# Bucket builders
# ---------------------------------------------------------------------------


def _build_high_frequency_strengths(
    attribute_index: dict[str, dict],
    profile_baselines: dict[str, dict] | None,
) -> tuple[CandidateBucketEntry, ...]:
    rows: list[tuple[int, str, CandidateBucketEntry]] = []
    for key in sorted(attribute_index.keys()):
        attr = attribute_index[key]
        n_pos = int(attr.get("n_positive") or 0)
        n_neg = int(attr.get("n_negative") or 0)
        n_mix = int(attr.get("n_mixed") or 0)
        if n_pos <= n_neg or n_pos < HIGH_FREQUENCY_STRENGTHS_MIN_N_POSITIVE:
            continue
        pos_quotes, _ = _split_quotes_by_polarity(attr.get("top_quotes") or [])
        ids, texts = _evidence_pair(pos_quotes)
        deviation = _deviation_from_baseline(
            actual_positive_share=_safe_share(n_pos, n_pos + n_neg + n_mix),
            attribute_key=key,
            profile_baselines=profile_baselines,
        )
        entry = CandidateBucketEntry(
            candidate_id="",  # assigned post-sort/cap by _assign_candidate_ids
            attribute_key=key,
            label_ko=_attribute_label_ko(attr),
            n_pos=n_pos,
            n_neg=n_neg,
            n_mixed=n_mix,
            evidence_review_ids=ids,
            evidence_excerpts_preview=texts,
            baseline_comparison=deviation,
        )
        rows.append((-n_pos, key, entry))
    rows.sort()
    capped = [e for _, _, e in rows[:MAX_HIGH_FREQUENCY_STRENGTHS]]
    return _assign_candidate_ids(capped, "high_frequency_strengths")


def _build_concentrated_complaints(
    report: dict,
    attribute_index: dict[str, dict],
    profile_baselines: dict[str, dict] | None,
) -> tuple[CandidateBucketEntry, ...]:
    rows: list[tuple[int, str, CandidateBucketEntry]] = []
    seen_keys: set[str] = set()
    for c in report.get("monitoring_candidates") or []:
        key = c.get("attribute_key")
        if not isinstance(key, str) or not key:
            continue
        if key in seen_keys:
            continue
        n_neg = int(c.get("n_negative") or 0)
        if n_neg < CONCENTRATED_COMPLAINTS_MIN_N_NEGATIVE:
            continue
        seen_keys.add(key)
        attr = attribute_index.get(key) or {}
        n_pos = int(attr.get("n_positive") or 0)
        n_mix = int(attr.get("n_mixed") or 0)
        ids, texts = _evidence_pair(c.get("top_negative_quotes") or [])
        if not ids:
            # Fallback: pull from the attribute's top_quotes negative side.
            _, neg_quotes = _split_quotes_by_polarity(attr.get("top_quotes") or [])
            ids, texts = _evidence_pair(neg_quotes)
        deviation = _deviation_from_baseline(
            actual_positive_share=_safe_share(n_pos, n_pos + n_neg + n_mix),
            attribute_key=key,
            profile_baselines=profile_baselines,
        )
        label_ko = c.get("concern_label_ko")
        if not isinstance(label_ko, str) or not label_ko:
            label_ko = _attribute_label_ko(attr)
        entry = CandidateBucketEntry(
            candidate_id="",
            attribute_key=key,
            label_ko=label_ko,
            n_pos=n_pos,
            n_neg=n_neg,
            n_mixed=n_mix,
            evidence_review_ids=ids,
            evidence_excerpts_preview=texts,
            baseline_comparison=deviation,
        )
        rows.append((-n_neg, key, entry))
    rows.sort()
    capped = [e for _, _, e in rows[:MAX_CONCENTRATED_COMPLAINTS]]
    return _assign_candidate_ids(capped, "concentrated_complaints")


def _build_cross_attribute_tradeoffs(
    report: dict,
    attribute_index: dict[str, dict],
) -> tuple[CandidateBucketEntry, ...]:
    """Tradeoffs are pair-keyed; we synthesize evidence by unioning
    the two attributes' top_quotes (for_attribute positive side +
    against_attribute negative side). Pair string preserved verbatim
    in `attribute_key`."""
    rows: list[tuple[int, str, CandidateBucketEntry]] = []
    for t in report.get("tradeoffs") or []:
        pair = t.get("pair")
        count = int(t.get("count") or 0)
        if not isinstance(pair, str) or count < CROSS_ATTRIBUTE_TRADEOFFS_MIN_COUNT:
            continue
        m = _TRADEOFF_PAIR_RE.match(pair)
        if not m:
            continue
        attr_a, attr_b = m.group(1), m.group(2)
        attr_a_block = attribute_index.get(attr_a) or {}
        attr_b_block = attribute_index.get(attr_b) or {}

        # Synthesize evidence: positive side of attr_a + negative side of attr_b.
        a_pos, _ = _split_quotes_by_polarity(attr_a_block.get("top_quotes") or [])
        _, b_neg = _split_quotes_by_polarity(attr_b_block.get("top_quotes") or [])
        merged_quotes = list(a_pos) + list(b_neg)
        ids, texts = _evidence_pair(merged_quotes)

        # Counts are the pair's `count` field; per-attribute n_pos/n_neg
        # are not directly meaningful here, so we pin n_pos/n_neg/n_mixed
        # to zero and use baseline_comparison=None for tradeoffs (the LLM
        # has the pair string + evidence; that's enough).
        entry = CandidateBucketEntry(
            candidate_id="",
            attribute_key=pair,
            label_ko=None,
            n_pos=0,
            n_neg=0,
            n_mixed=0,
            evidence_review_ids=ids,
            evidence_excerpts_preview=texts,
            baseline_comparison=None,
        )
        rows.append((-count, pair, entry))
    rows.sort()
    capped = [e for _, _, e in rows[:MAX_CROSS_ATTRIBUTE_TRADEOFFS]]
    return _assign_candidate_ids(capped, "cross_attribute_tradeoffs")


def _build_polarity_outliers(
    attribute_index: dict[str, dict],
    profile_baselines: dict[str, dict] | None,
) -> tuple[CandidateBucketEntry, ...]:
    """Two paths:
      - With baseline: |actual_positive_share - expected| ≥ deviation_threshold.
      - Without baseline: negative_share ≥ negative_share_threshold AND
                          n_pos+n_neg ≥ POLARITY_OUTLIER_MIN_TOTAL.
    """
    rows: list[tuple[float, str, CandidateBucketEntry]] = []
    for key in sorted(attribute_index.keys()):
        attr = attribute_index[key]
        n_pos = int(attr.get("n_positive") or 0)
        n_neg = int(attr.get("n_negative") or 0)
        n_mix = int(attr.get("n_mixed") or 0)
        total = n_pos + n_neg + n_mix
        if total < POLARITY_OUTLIER_MIN_TOTAL:
            continue
        actual_share = _safe_share(n_pos, total)
        deviation = _deviation_from_baseline(
            actual_positive_share=actual_share,
            attribute_key=key,
            profile_baselines=profile_baselines,
        )
        sort_metric: float
        included = False
        if deviation is not None:
            if abs(deviation) >= POLARITY_OUTLIER_DEVIATION_THRESHOLD:
                included = True
                sort_metric = -abs(deviation)
        else:
            negative_share = _safe_share(n_neg, n_pos + n_neg)
            if negative_share >= POLARITY_OUTLIER_NEGATIVE_SHARE_THRESHOLD:
                included = True
                # Sort by descending negative_share. Negate for ascending sort.
                sort_metric = -negative_share
        if not included:
            continue
        # Mix both polarity quotes — the LLM should see both sides.
        all_pos, all_neg = _split_quotes_by_polarity(attr.get("top_quotes") or [])
        merged = list(all_pos) + list(all_neg)
        ids, texts = _evidence_pair(merged)
        entry = CandidateBucketEntry(
            candidate_id="",
            attribute_key=key,
            label_ko=_attribute_label_ko(attr),
            n_pos=n_pos,
            n_neg=n_neg,
            n_mixed=n_mix,
            evidence_review_ids=ids,
            evidence_excerpts_preview=texts,
            baseline_comparison=deviation,
        )
        rows.append((sort_metric, key, entry))
    rows.sort()
    capped = [e for _, _, e in rows[:MAX_POLARITY_OUTLIERS]]
    return _assign_candidate_ids(capped, "polarity_outliers")


def _build_usage_context_signals(
    report: dict,
) -> tuple[CandidateBucketEntry, ...]:
    """Reads `usage_patterns[*]` of kind=`usage_context`. Per-row
    evidence_review_ids is empty (the analysis report doesn't carry
    per-pattern review_ids today); the LLM is expected to anchor
    using attribute-level quotes from `bounded_review_excerpts`."""
    rows: list[tuple[int, str, CandidateBucketEntry]] = []
    for i, p in enumerate(report.get("usage_patterns") or []):
        if not isinstance(p, dict):
            continue
        if p.get("kind") != "usage_context":
            continue
        sentence = p.get("sentence_ko")
        if not isinstance(sentence, str) or not sentence.strip():
            continue
        evidence_count = int(p.get("evidence_count") or 0)
        # Use the sentence as both the attribute_key (no real key
        # exists) and the only excerpt preview. The LLM gets a
        # readable prompt; substring anchoring still routes through
        # the broader bounded_review_excerpts pool.
        synthetic_key = f"usage_context__{i}"
        entry = CandidateBucketEntry(
            candidate_id="",
            attribute_key=synthetic_key,
            label_ko=sentence.strip(),
            n_pos=0,
            n_neg=0,
            n_mixed=0,
            evidence_review_ids=tuple(),
            evidence_excerpts_preview=tuple(),
            baseline_comparison=None,
        )
        rows.append((-evidence_count, synthetic_key, entry))
    rows.sort()
    capped = [e for _, _, e in rows[:MAX_USAGE_CONTEXT_SIGNALS]]
    return _assign_candidate_ids(capped, "usage_context_signals")


# ---------------------------------------------------------------------------
# Bounded-excerpts assembly
# ---------------------------------------------------------------------------


def _build_bounded_review_excerpts(
    report: dict,
    *,
    max_chars: int,
) -> tuple[tuple[str, str], ...]:
    """Union all top_quotes + top_negative_quotes across attributes
    and monitoring candidates, keyed by review_id. Multiple excerpts
    for the same review_id are joined with `\\n`. Total cumulative
    text is capped at `max_chars` (oldest-encountered excerpts are
    truncated to fit; review_id keys are sorted for determinism)."""
    by_review: dict[str, list[str]] = {}

    def _absorb(quotes: Iterable[Any]) -> None:
        for q in quotes or []:
            rid = _quote_review_id(q)
            txt = _quote_text(q)
            if not rid or not txt:
                continue
            bucket = by_review.setdefault(rid, [])
            if txt not in bucket:
                bucket.append(txt)

    for a in report.get("attributes") or []:
        _absorb(a.get("top_quotes") or [])
    for c in report.get("monitoring_candidates") or []:
        _absorb(c.get("top_negative_quotes") or [])

    # Compose `{rid: joined_text}` deterministically (rid ascending),
    # truncating cumulative size to max_chars.
    out: list[tuple[str, str]] = []
    cum_chars = 0
    for rid in sorted(by_review.keys()):
        joined = "\n".join(by_review[rid])
        if cum_chars + len(joined) > max_chars:
            remaining = max_chars - cum_chars
            if remaining <= 0:
                break
            joined = joined[:remaining]
        out.append((rid, joined))
        cum_chars += len(joined)
        if cum_chars >= max_chars:
            break
    return tuple(out)


# ---------------------------------------------------------------------------
# Baseline comparison
# ---------------------------------------------------------------------------


def _safe_share(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return numerator / denominator


def _deviation_from_baseline(
    *,
    actual_positive_share: float,
    attribute_key: str,
    profile_baselines: dict[str, dict] | None,
) -> float | None:
    """Compare actual_positive_share against the profile's
    `expected_positive_share` for this attribute. Return signed
    deviation, or None when no baseline exists for the key."""
    if not profile_baselines:
        return None
    entry = profile_baselines.get(attribute_key)
    if not isinstance(entry, dict):
        return None
    expected = entry.get("expected_positive_share")
    if not isinstance(expected, (int, float)):
        return None
    return round(actual_positive_share - float(expected), 4)


def _extract_profile_baselines(
    profile: dict | None,
) -> tuple[str, dict[str, dict] | None]:
    """Inspect a category profile for a baseline distribution. Returns
    `(category_baseline_source, baselines_or_None)`.

    The expected shape under the profile is:
        profile["baseline_attribute_distribution"] = {
            "<attribute_key>": {"expected_positive_share": 0.85, ...},
            ...
        }
    Anything else falls through to "uncertain"."""
    if not isinstance(profile, dict):
        return "uncertain", None
    bdist = profile.get("baseline_attribute_distribution")
    if not isinstance(bdist, dict) or not bdist:
        return "uncertain", None
    # Filter to entries that actually carry expected_positive_share
    cleaned: dict[str, dict] = {}
    for k, v in bdist.items():
        if not isinstance(k, str) or not isinstance(v, dict):
            continue
        if isinstance(v.get("expected_positive_share"), (int, float)):
            cleaned[k] = v
    if not cleaned:
        return "uncertain", None
    return "profile_curated", cleaned


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def build_candidate_pool(
    analysis_report: dict,
    *,
    profile: dict | None = None,
    bounded_excerpt_max_chars: int = DEFAULT_BOUNDED_EXCERPT_MAX_CHARS,
) -> CandidatePool:
    """Build the deterministic candidate pool from an analysis report.

    Pure: no DB, no LLM, no I/O. Same input → same output.

    `profile` is a category-profile dict (Phase E2's category-aware
    surface). When the profile carries a
    `baseline_attribute_distribution` block, polarity-share deviations
    are computed against it; otherwise `category_baseline_source` is
    `"uncertain"` and downstream insights inherit the hypothesis flag.
    """
    if not isinstance(analysis_report, dict):
        raise TypeError(
            "analysis_report must be a dict; got "
            f"{type(analysis_report).__name__}"
        )

    attribute_index = _attribute_index(analysis_report)
    baseline_source, baselines = _extract_profile_baselines(profile)
    if baseline_source == "profile_curated":
        baseline_caveat = BASELINE_CAVEAT_PROFILE_CURATED_KO
    else:
        baseline_caveat = BASELINE_CAVEAT_UNCERTAIN_KO

    return CandidatePool(
        high_frequency_strengths=_build_high_frequency_strengths(
            attribute_index, baselines,
        ),
        concentrated_complaints=_build_concentrated_complaints(
            analysis_report, attribute_index, baselines,
        ),
        cross_attribute_tradeoffs=_build_cross_attribute_tradeoffs(
            analysis_report, attribute_index,
        ),
        polarity_outliers=_build_polarity_outliers(
            attribute_index, baselines,
        ),
        usage_context_signals=_build_usage_context_signals(
            analysis_report,
        ),
        category_baseline_source=baseline_source,
        baseline_caveat_ko=baseline_caveat,
        bounded_review_excerpts=_build_bounded_review_excerpts(
            analysis_report,
            max_chars=bounded_excerpt_max_chars,
        ),
    )
