"""Phase 2E observed-usage-patterns helper.

Pure presentation-layer derivation. Reads already-aggregated
`ProductReportData` (and optionally the underlying review_blocks for
evidence-span scanning) and emits Korean sentences describing
patterns ACROSS reviews - not per-attribute scores.

Three pattern kinds:

1. **contradiction** - same attribute appears as both clear positive
   and clear negative across the corpus. Surfaces "this isn't a
   simple problem; some users like it, some don't."

2. **usage_context** - a context keyword (mask, season, skin type,
   etc.) co-occurs with negative evidence on a high-volume
   attribute. Surfaces "complaints cluster around a specific use
   condition."

3. **tradeoff** - explicit cross-attribute trade-off pairs the
   aggregator already detected via conjunction markers
   (`data.tradeoff_pairs`). Surfaces "users praise X while conceding Y."

Hard rules
----------
- **No speculation beyond observed evidence.** Every pattern carries
  a count from real aggregated data or substring matches against
  evidence spans. No causal claims, no inference, no LLM.
- **Observational tone.** Sentences end in 관측됩니다 / 등장합니다 /
  언급됩니다 - not directive verbs.
- **Korean grammar safety.** Attribute mentions use em-dash or
  "관련 의견 / 관련 언급" prefix to avoid 은(는) / 을(를) particle
  agreement bugs across attribute names.

Out of scope
------------
- Detector / aggregation logic - read-only consumer
- Narrative summary across patterns - caller composes the section
- Causal inference between patterns

Threshold rationale (heuristic, not tuned)
------------------------------------------
- `CONTRADICTION_MIN_PER_SIDE = 5` - both n_pos AND n_neg must clear
  before we call it a contradiction. Below this it's noise.
- `CONTEXT_MIN_HITS = 5` - a context keyword needs ≥5 matches on
  an attribute's negative spans to surface as a pattern. Below this
  it's a coincidence.
- `TRADEOFF_MIN_COUNT = 3` - tradeoff pairs need ≥3 conjunction-marked
  reviews before the pattern is repeatable.
- `MAX_PATTERNS_DEFAULT = 6` - section length cap; report stays
  scannable in 30 seconds.
"""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from typing import Iterable, Literal

from src.voc.reporting.phase2e.report import (
    ATTRIBUTE_LABELS_KO,
    ProductReportData,
)


PatternKind = Literal["contradiction", "usage_context", "tradeoff"]


@dataclass(frozen=True)
class ObservedPattern:
    """One observed pattern across reviews.

    `sentence_ko` is the operator-facing Korean sentence (HTML
    markup allowed for the renderer). `evidence_count` is the raw
    count backing the pattern - used to sort patterns by signal
    strength when truncating to `max_patterns`. `kind` lets the
    renderer optionally style different pattern types differently.
    """
    kind: PatternKind
    sentence_ko: str
    evidence_count: int


# Thresholds - see module docstring; revisit after operator feedback.
CONTRADICTION_MIN_PER_SIDE: int = 5
CONTEXT_MIN_HITS: int = 5
CONTEXT_MIN_PER_ATTR: int = 5  # attribute needs ≥N negative spans before context-scan
TRADEOFF_MIN_COUNT: int = 3
MAX_PATTERNS_DEFAULT: int = 6


# Korean usage-context buckets. Each bucket = (token_tuple, label).
# Tokens are matched as case-insensitive substrings against evidence
# spans. Labels are the operator-facing context name printed in the
# sentence. Buckets are scoped to physical/situational use (not
# affective: "좋아요", "별로" tokens are sentiment, not context).
USAGE_CONTEXT_BUCKETS_KO: dict[str, tuple[tuple[str, ...], str]] = {
    "mask_outdoor": (
        ("마스크", "외출", "출근"),
        "마스크/외출 상황",
    ),
    "summer_humid": (
        ("여름", "땀", "더위", "습한", "고온"),
        "여름/고온 환경",
    ),
    "winter_dry": (
        ("겨울", "찬바람", "히터", "건조한 날"),
        "겨울/건조 환경",
    ),
    "skin_dry": (
        ("건성", "건조한 피부", "각질"),
        "건성 피부",
    ),
    "skin_oily": (
        ("지성", "번들", "유분"),
        "지성 피부",
    ),
    "skin_sensitive": (
        ("민감", "트러블", "예민한"),
        "민감/트러블 피부",
    ),
    "physical_motion": (
        ("운동", "땀나", "활동"),
        "운동/활동 상황",
    ),
}


# Polarity sets reused from report.py (kept inline so this module
# does not pull a private symbol).
_POSITIVE_LIKE = ("positive", "mixed")
_NEGATIVE_LIKE = ("negative_weak", "negative_strong", "mixed")


def _short_attr_label(attribute: str) -> str:
    """Korean label for an attribute key, with the English gloss
    stripped - keeps the section readable without parens noise."""
    label = ATTRIBUTE_LABELS_KO.get(attribute, attribute)
    return label.split("(")[0].strip()


def _collect_negative_spans(
    review_blocks: Iterable[dict],
) -> dict[str, list[str]]:
    """Group negative-side evidence spans by attribute. Used by the
    usage-context pattern. Returns an empty dict when review_blocks
    is None / empty / all positive."""
    out: dict[str, list[str]] = defaultdict(list)
    for rb in review_blocks or []:
        for r in rb.get("records", []):
            if r.get("polarity") not in _NEGATIVE_LIKE:
                continue
            span = r.get("evidence_span") or ""
            attr = r.get("attribute")
            if not span or not attr:
                continue
            out[attr].append(span)
    return out


_TRADEOFF_PAIR_RE = re.compile(
    r"^([a-z_]+):[a-z_]+\s*->\s*([a-z_]+):[a-z_]+$"
)


def _parse_tradeoff_pair(pair: str) -> tuple[str, str] | None:
    """Parse 'attr_a:polarity_a -> attr_b:polarity_b' → (attr_a, attr_b).
    Returns None for malformed pairs (defensive: aggregator format
    has been stable but pattern emission must not raise)."""
    m = _TRADEOFF_PAIR_RE.match(pair or "")
    if not m:
        return None
    return m.group(1), m.group(2)


def detect_patterns(
    data: ProductReportData,
    *,
    review_blocks: Iterable[dict] | None = None,
    max_patterns: int = MAX_PATTERNS_DEFAULT,
) -> list[ObservedPattern]:
    """Return a list of ObservedPattern records for the report's
    "Observed Usage Patterns" section.

    Patterns are deduplicated implicitly by kind+attribute and
    sorted by `evidence_count` descending; the top `max_patterns`
    are returned. Empty list is a valid return value when no
    patterns clear thresholds - caller renders a graceful "no
    notable patterns observed" message.

    Idempotent: same input → same output. No side effects.
    """
    patterns: list[ObservedPattern] = []

    # ---- 1. Usage context (only when review_blocks available) ----
    # Per-attribute scan: which context bucket dominates the negative
    # spans for an attribute? "Dominant" = ≥ CONTEXT_MIN_HITS spans
    # AND the attribute has ≥ CONTEXT_MIN_PER_ATTR negative spans
    # to begin with (avoid surfacing a context on a thin attribute).
    if review_blocks is not None:
        attr_neg_spans = _collect_negative_spans(review_blocks)
        for attr, spans in attr_neg_spans.items():
            if len(spans) < CONTEXT_MIN_PER_ATTR:
                continue
            # For each context bucket, count hits.
            for bucket_key, (tokens, ctx_label) in USAGE_CONTEXT_BUCKETS_KO.items():
                hits = sum(
                    1 for s in spans
                    if any(t in s for t in tokens)
                )
                if hits < CONTEXT_MIN_HITS:
                    continue
                attr_label = _short_attr_label(attr)
                patterns.append(ObservedPattern(
                    kind="usage_context",
                    sentence_ko=(
                        f"<b>{attr_label}</b> 관련 언급은 "
                        f"{ctx_label}에서 반복적으로 등장합니다 "
                        f"({hits}건)."
                    ),
                    evidence_count=hits,
                ))

    # ---- 2. Contradictions (per attribute, both pos+neg threshold) ----
    # Iterate sorted by attribute key for deterministic output ordering
    # before the final score-based sort.
    for attr in sorted(data.attribute_summaries.keys()):
        s = data.attribute_summaries[attr]
        if (
            s.n_positive >= CONTRADICTION_MIN_PER_SIDE
            and s.n_negative >= CONTRADICTION_MIN_PER_SIDE
        ):
            attr_label = _short_attr_label(attr)
            # Denominator-aware framing: "X 언급 N건 중 긍정 M건,
            # 부정 K건, 혼합 L건" reads as a clear basis statement,
            # not a raw count list.
            n_mixed = getattr(s, "n_mixed", 0) or 0
            n_total_mentions = s.n_positive + s.n_negative + n_mixed
            if n_mixed > 0:
                breakdown = (
                    f"긍정 {s.n_positive}건, 부정 {s.n_negative}건, "
                    f"혼합 {n_mixed}건"
                )
            else:
                breakdown = (
                    f"긍정 {s.n_positive}건, 부정 {s.n_negative}건"
                )
            patterns.append(ObservedPattern(
                kind="contradiction",
                sentence_ko=(
                    f"<b>{attr_label}</b> 언급 {n_total_mentions}건 중 "
                    f"{breakdown} - 일부 사용자에게는 장점으로, "
                    f"일부에게는 단점으로 언급됩니다."
                ),
                evidence_count=s.n_positive + s.n_negative,
            ))

    # ---- 3. Cross-attribute trade-offs ----
    # data.tradeoff_pairs is a Counter[str, int] keyed on the
    # pair-string format "attr_a:polarity_a -> attr_b:polarity_b".
    # We surface only the top 2 to keep the section concise.
    if data.tradeoff_pairs:
        for pair, n in data.tradeoff_pairs.most_common(3):
            if n < TRADEOFF_MIN_COUNT:
                continue
            parsed = _parse_tradeoff_pair(pair)
            if parsed is None:
                continue
            a_attr, b_attr = parsed
            if a_attr == b_attr:  # self-loop guard (schema also forbids)
                continue
            a_label = _short_attr_label(a_attr)
            b_label = _short_attr_label(b_attr)
            patterns.append(ObservedPattern(
                kind="tradeoff",
                sentence_ko=(
                    f"<b>{a_label}</b> 관련 만족과 "
                    f"<b>{b_label}</b> 관련 양보가 함께 언급되는 "
                    f"패턴이 {n}건 관측됩니다."
                ),
                evidence_count=n,
            ))

    # Sort by evidence count desc; ties broken by kind ordering
    # (usage_context first, then contradiction, then tradeoff -
    # most operator-actionable first).
    kind_order = {"usage_context": 0, "contradiction": 1, "tradeoff": 2}
    patterns.sort(
        key=lambda p: (-p.evidence_count, kind_order.get(p.kind, 99)),
    )
    return patterns[:max_patterns]
