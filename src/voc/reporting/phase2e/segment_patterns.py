"""Phase 2E buyer-segment pattern extraction.

Detects EXPLICIT mentions of buyer-relevant categories in review text:
tone (쿨톤/웜톤/봄웜/etc.), skin type (건성/지성/민감성), usage context
(데일리/마스크/입문), and desired finish (내추럴/매트/시머). Pairs
each mention with the polarity of the surrounding record to produce
buyer_fit_positive ("review where customer with X liked it") and
buyer_fit_caution ("review where customer with X disliked it") tallies.

Hard rules
----------
- **Explicit mention only.** No inference. If a review doesn't say
  "쿨톤," we don't classify it as a 쿨톤 mention. The token must
  appear as a substring in the evidence span.
- **No demographic inference.** We do not guess age/gender; we only
  count phrases the reviewer chose to write.
- **No medical or dermatological framing.** The output is for
  observational reporting only — not skin-type recommendations.

Out of scope
------------
- LLM-driven extraction (deterministic substring/regex only)
- Detector / scoring / aggregation changes — read-only consumer
- Statistical inference on tone-fit suitability

Use cases
---------
- Seller-facing report: "구매자 관점 세그먼트 신호" PDF section
- Buyer-facing card-news: structured buyer_content_summary export

Wording allowed
---------------
"잘 맞았다는 언급이 관찰됨", "구매 전 확인 포인트",
"관찰된 사용 맥락" - observational, hedged, non-prescriptive.

Wording banned
--------------
"이 피부에 적합", "민감성 피부 추천", "반드시" - sound like
dermatological advice the report has no basis to give.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Iterable, Literal


# ---------------------------------------------------------------------------
# Keyword vocabularies — explicit Korean tokens reviewers use. Locked
# to substrings; no fuzzy match. Add tokens here when operator
# feedback identifies missed mentions.
# ---------------------------------------------------------------------------


TONE_KEYWORDS_KO: tuple[str, ...] = (
    "쿨톤", "웜톤", "뉴트럴톤", "뮤트톤",
    # Personal-color community vocabulary
    "봄웜", "여쿨", "가을웜", "겨울쿨",
    "봄웜라이트", "봄웜브라이트",
    "여쿨라이트", "여쿨뮤트",
    "가을웜뮤트", "가을웜딥",
    "겨울쿨딥", "겨울쿨브라이트",
    # Bare 톤 alone is too generic; require "톤" to be paired with
    # a qualifier (counted via the compound forms above).
)

SKIN_TYPE_KEYWORDS_KO: tuple[str, ...] = (
    "건성", "지성", "복합성", "중성", "민감성",
    "건성 피부", "지성 피부", "민감성 피부",
    "민감한 피부", "예민한 피부",
)

USAGE_CONTEXT_GROUPS_KO: dict[str, tuple[str, ...]] = {
    "daily": ("데일리", "매일", "평상시", "일상"),
    "point_makeup": ("포인트 메이크업", "포인트로", "포인트 메이크"),
    "layering": ("레이어링", "겹발림", "겹쳐 발라", "덧바르"),
    "mask_outdoor": ("마스크", "외출", "출근", "야외"),
    "beginner": ("입문", "처음 써", "초보", "처음이라"),
}

FINISH_PREFERENCE_GROUPS_KO: dict[str, tuple[str, ...]] = {
    "natural": ("내추럴", "자연스러운", "자연스럽게", "자연스러워"),
    "strong_pigment": ("강한 발색", "진한 발색", "선명한 발색", "또렷한"),
    "shimmer_pearl": ("시머", "펄", "광채", "글리터"),
    "matte": ("매트", "무광"),
    "glow": ("글로우", "윤기", "촉촉한 마무리"),
}


# Group-key → operator-facing Korean label
USAGE_CONTEXT_LABELS_KO: dict[str, str] = {
    "daily": "데일리 사용",
    "point_makeup": "포인트 메이크업",
    "layering": "레이어링/겹발림",
    "mask_outdoor": "마스크/외출 상황",
    "beginner": "입문/처음 사용",
}

FINISH_PREFERENCE_LABELS_KO: dict[str, str] = {
    "natural": "내추럴 마무리",
    "strong_pigment": "강한 발색",
    "shimmer_pearl": "시머/펄 마무리",
    "matte": "매트 마무리",
    "glow": "글로우/윤기 마무리",
}


_POSITIVE_LIKE = ("positive", "mixed")
_NEGATIVE_LIKE = ("negative_weak", "negative_strong", "mixed")

# Minimum mentions required before a segment surfaces in the report.
# Same noise-floor philosophy as usage_patterns.py.
SEGMENT_MIN_MENTIONS: int = 3


# ---------------------------------------------------------------------------
# Decision-confidence rubric
# ---------------------------------------------------------------------------


ConfidenceLevel = Literal["weak", "moderate", "strong"]


# Rubric thresholds. Heuristic, not tuned. Distinct from the
# snapshot-level confidence_level rubric in snapshots.py - this
# scores the strength of an INDIVIDUAL segment signal, not the
# overall corpus.
SEGMENT_STRONG_MIN_COUNT: int = 30
SEGMENT_STRONG_MIN_DOMINANCE: float = 0.75
SEGMENT_MODERATE_MIN_COUNT: int = 10
SEGMENT_MODERATE_MIN_DOMINANCE: float = 0.60
# Small-corpus demotion floors: when total reviews are this small,
# we don't let any segment claim "strong" / "moderate" because the
# numerator can't support the framing yet.
SEGMENT_SMALL_CORPUS_DEMOTE_FLOOR: int = 100  # caps strong → moderate
SEGMENT_TINY_CORPUS_DEMOTE_FLOOR: int = 30    # caps anything → weak


def compute_segment_confidence(
    *,
    dominant_count: int,
    total_mentions: int,
    n_reviews_total: int,
) -> ConfidenceLevel:
    """Score one segment's signal strength as weak / moderate / strong.

    Inputs:
      dominant_count    - n_positive (best-fit) or n_negative (caution)
      total_mentions    - bucket.n_total (positive + negative + mixed)
      n_reviews_total   - corpus denominator (for small-corpus demotion)

    Rules (in order):
      strong   - dominant_count >= 30 AND dominance >= 0.75
      moderate - dominant_count >= 10 AND dominance >= 0.60
      weak     - otherwise

    Demotion:
      n_reviews_total < 100 caps "strong" at "moderate"
      n_reviews_total < 30  caps anything at "weak"

    Used to drive language variation (decision_hint_ko, takeaway,
    hook_lines) without changing scoring or detection logic.
    """
    if total_mentions <= 0:
        return "weak"
    dominance = dominant_count / total_mentions
    if (
        dominant_count >= SEGMENT_STRONG_MIN_COUNT
        and dominance >= SEGMENT_STRONG_MIN_DOMINANCE
    ):
        result: ConfidenceLevel = "strong"
    elif (
        dominant_count >= SEGMENT_MODERATE_MIN_COUNT
        and dominance >= SEGMENT_MODERATE_MIN_DOMINANCE
    ):
        result = "moderate"
    else:
        result = "weak"
    # Small-corpus demotion - prevents claiming "strong" on a
    # corpus too small to support the framing.
    if n_reviews_total < SEGMENT_TINY_CORPUS_DEMOTE_FLOOR:
        return "weak"
    if (
        n_reviews_total < SEGMENT_SMALL_CORPUS_DEMOTE_FLOOR
        and result == "strong"
    ):
        return "moderate"
    return result


# Confidence-keyed phrase fragments. These are mixed into
# decision_hint_ko / who_it_works_for / takeaway etc. so the
# wording strength tracks the underlying evidence strength.
_POSITIVE_HINT_BY_CONFIDENCE: dict[ConfidenceLevel, str] = {
    "weak":     "잘 맞았다는 의견이 일부 보입니다",
    "moderate": "잘 맞았다는 의견이 반복적으로 관찰됩니다",
    "strong":   "잘 맞았다는 의견이 일관되게 나타납니다",
}

_CAUTION_HINT_BY_CONFIDENCE: dict[ConfidenceLevel, str] = {
    "weak":     "관련 의견이 일부 보입니다",
    "moderate": "관련 의견이 반복적으로 관찰됩니다",
    "strong":   "관련 의견 분포 차이가 일관되게 관찰됩니다",
}

_TAKEAWAY_LEAD_BY_CONFIDENCE: dict[ConfidenceLevel, str] = {
    "weak":     "경향이 일부 관찰됩니다",
    "moderate": "경향이 반복적으로 관찰됩니다",
    "strong":   "경향이 비교적 일관되게 나타납니다",
}


# ---------------------------------------------------------------------------
# Output dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SegmentMention:
    """One observed segment mention. The exact keyword that matched
    is preserved so the caller can quote it verbatim if needed.
    """
    label_ko: str            # operator-facing label, e.g. "쿨톤"
    keyword_matched: str     # exact substring that matched
    review_id: str
    polarity: str            # "positive" / "negative_weak" / etc.
    evidence_span: str       # verbatim evidence text


@dataclass(frozen=True)
class SegmentBucket:
    """One category bucket aggregated across reviews."""
    label_ko: str
    n_total: int             # total mentions
    n_positive: int          # mentions on positive-polarity records
    n_negative: int          # mentions on negative-polarity records
    n_mixed: int             # mentions on mixed records
    representative_quote: str | None  # verbatim from first matching review


@dataclass(frozen=True)
class SegmentDetection:
    """Full detection output. All buckets and per-mention records."""
    tone_buckets: tuple[SegmentBucket, ...]
    skin_type_buckets: tuple[SegmentBucket, ...]
    usage_context_buckets: tuple[SegmentBucket, ...]
    finish_preference_buckets: tuple[SegmentBucket, ...]
    option_mentions: tuple[str, ...]    # raw option_text values seen
    # Cross-cut: which segments appear primarily on positive vs
    # negative records. Sorted by n_positive / n_negative desc.
    buyer_fit_positive: tuple[SegmentBucket, ...]
    buyer_fit_caution: tuple[SegmentBucket, ...]


@dataclass(frozen=True)
class BuyerSegmentSignal:
    """One PDF-card-shaped signal - used by the renderer.

    `confidence_level` drives subtle wording variation (weak →
    "일부 보입니다", strong → "일관되게 나타납니다") without
    breaking the no-prescriptive-wording contract. Banned tokens
    (확실히 / 반드시 / 강력 추천) never appear regardless of level.
    """
    label_ko: str
    n_count: int
    denominator: int
    denominator_basis_ko: str           # "분석 리뷰 N건 기준"
    representative_quote: str | None
    seller_note_ko: str
    buyer_note_ko: str
    decision_hint_ko: str = ""
    confidence_level: ConfidenceLevel = "weak"


@dataclass(frozen=True)
class QuickDecisionSummary:
    """The 3-line buyer-decision summary - core of the PDF §4 top
    block AND of SNS card 1.

    `confidence_level` is the LEAD signal's confidence (top
    buyer_fit_positive when present, else top buyer_fit_caution).
    Drives language variation in all three lines.
    """
    who_it_works_for: str
    who_should_check_more: str
    simple_takeaway: str
    confidence_level: ConfidenceLevel = "weak"


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------


def _find_keyword_in_span(
    span: str, keywords: Iterable[str],
) -> str | None:
    """Return the first keyword that appears as a substring in the span,
    or None when no keyword matches. Order of `keywords` matters —
    longer/more-specific tokens should come first to avoid prefix
    collisions (e.g. '봄웜라이트' before '봄웜')."""
    if not span:
        return None
    for kw in keywords:
        if kw in span:
            return kw
    return None


def _scan_records_for_keywords(
    review_blocks: Iterable[dict],
    keywords: Iterable[str],
) -> list[SegmentMention]:
    """Walk Stage 2 review blocks and emit one SegmentMention per
    (record, matched keyword) pair. Each record contributes at
    most one mention per keyword scan to avoid double-counting."""
    out: list[SegmentMention] = []
    keywords = tuple(keywords)
    for rb in review_blocks or []:
        review_id = rb.get("review_id") or ""
        for r in rb.get("records", []):
            span = r.get("evidence_span") or ""
            if not span:
                continue
            matched = _find_keyword_in_span(span, keywords)
            if matched is None:
                continue
            out.append(SegmentMention(
                label_ko=matched,
                keyword_matched=matched,
                review_id=review_id,
                polarity=r.get("polarity") or "",
                evidence_span=span,
            ))
    return out


def _aggregate_into_buckets(
    mentions: list[SegmentMention],
    label_lookup: dict[str, str] | None = None,
) -> tuple[SegmentBucket, ...]:
    """Group mentions by (mapped) label, count by polarity, pick the
    first matching evidence span as the representative quote.

    `label_lookup` is an optional keyword → display-label map. When
    provided, mentions are grouped by the mapped label (so all
    members of a usage-context group collapse into one bucket).
    When None, the mention's `label_ko` (the matched keyword) is
    the group key.
    """
    grouped: dict[str, list[SegmentMention]] = defaultdict(list)
    for m in mentions:
        key = (
            label_lookup.get(m.keyword_matched, m.keyword_matched)
            if label_lookup else m.label_ko
        )
        grouped[key].append(m)
    buckets: list[SegmentBucket] = []
    for label, mlist in grouped.items():
        if len(mlist) < SEGMENT_MIN_MENTIONS:
            continue
        n_pos = sum(1 for m in mlist if m.polarity in _POSITIVE_LIKE)
        n_neg = sum(1 for m in mlist if m.polarity in _NEGATIVE_LIKE)
        n_mixed = sum(1 for m in mlist if m.polarity == "mixed")
        # Representative quote: first one with non-trivial length
        rep = next(
            (m.evidence_span for m in mlist if len(m.evidence_span) > 8),
            None,
        )
        buckets.append(SegmentBucket(
            label_ko=label,
            n_total=len(mlist),
            n_positive=n_pos,
            n_negative=n_neg,
            n_mixed=n_mixed,
            representative_quote=rep,
        ))
    # Sort by total mentions descending — most-frequent first
    buckets.sort(key=lambda b: -b.n_total)
    return tuple(buckets)


def _scan_grouped_keywords(
    review_blocks: Iterable[dict],
    groups: dict[str, tuple[str, ...]],
    labels: dict[str, str],
) -> tuple[SegmentBucket, ...]:
    """Scan once per group, produce one bucket per group."""
    # Build a flat reverse lookup: keyword → group_label
    keyword_to_group_label: dict[str, str] = {}
    flat_keywords: list[str] = []
    for group_key, kws in groups.items():
        label = labels.get(group_key, group_key)
        for kw in kws:
            keyword_to_group_label[kw] = label
            flat_keywords.append(kw)
    mentions = _scan_records_for_keywords(review_blocks, flat_keywords)
    return _aggregate_into_buckets(
        mentions, label_lookup=keyword_to_group_label,
    )


def _collect_option_mentions(
    raw_reviews: Iterable[dict],
) -> tuple[str, ...]:
    """Extract distinct non-empty option_text values from raw review
    rows. Provides the seller-facing 'which option/SKU is mentioned'
    list without any per-option polarity inference."""
    seen: set[str] = set()
    out: list[str] = []
    for r in raw_reviews or []:
        option = (r.get("option_text") or "").strip()
        if not option:
            # raw_metadata.product_option_raw is the OY-side fallback
            meta = r.get("raw_metadata") or {}
            if isinstance(meta, dict):
                option = (meta.get("product_option_raw") or "").strip()
        if option and option not in seen:
            seen.add(option)
            out.append(option)
    return tuple(out[:50])  # cap; this is metadata, not analysis


def detect_segments(
    review_blocks: Iterable[dict],
    *,
    raw_reviews: Iterable[dict] | None = None,
) -> SegmentDetection:
    """Run all four keyword scans + option collection and return the
    aggregated SegmentDetection.

    `raw_reviews` is the connector's row-level dict list (carries
    option_text). Optional — when None, option_mentions is empty.
    """
    # Tone - flat keyword list. Sort by length descending so
    # longer/more-specific tokens (봄웜라이트) match before their
    # prefixes (봄웜). _find_keyword_in_span returns the first
    # match in iteration order.
    tone_keywords_sorted = sorted(
        TONE_KEYWORDS_KO, key=len, reverse=True,
    )
    tone_mentions = _scan_records_for_keywords(
        review_blocks, tone_keywords_sorted,
    )
    tone_buckets = _aggregate_into_buckets(tone_mentions)

    # Skin type — flat keyword list, longer phrases first.
    skin_keywords = sorted(
        SKIN_TYPE_KEYWORDS_KO, key=len, reverse=True,
    )
    skin_mentions = _scan_records_for_keywords(
        review_blocks, skin_keywords,
    )
    skin_buckets = _aggregate_into_buckets(skin_mentions)

    # Usage context — grouped scan
    usage_buckets = _scan_grouped_keywords(
        review_blocks, USAGE_CONTEXT_GROUPS_KO, USAGE_CONTEXT_LABELS_KO,
    )

    # Finish preference — grouped scan
    finish_buckets = _scan_grouped_keywords(
        review_blocks,
        FINISH_PREFERENCE_GROUPS_KO,
        FINISH_PREFERENCE_LABELS_KO,
    )

    # Buyer-fit cross-cut: pool ALL buckets, then split by polarity
    # majority. A bucket with n_positive >= 2x n_negative (and
    # n_total >= floor) joins buyer_fit_positive; n_negative >= 2x
    # n_positive joins buyer_fit_caution. The 2x ratio is a
    # conservative heuristic; revisit after operator feedback.
    all_buckets = (
        list(tone_buckets) + list(skin_buckets)
        + list(usage_buckets) + list(finish_buckets)
    )
    fit_positive: list[SegmentBucket] = []
    fit_caution: list[SegmentBucket] = []
    for b in all_buckets:
        if b.n_positive >= 2 * max(b.n_negative, 1) and b.n_positive >= 3:
            fit_positive.append(b)
        elif b.n_negative >= 2 * max(b.n_positive, 1) and b.n_negative >= 3:
            fit_caution.append(b)
    fit_positive.sort(key=lambda b: -b.n_positive)
    fit_caution.sort(key=lambda b: -b.n_negative)

    options = (
        _collect_option_mentions(raw_reviews)
        if raw_reviews is not None else ()
    )

    return SegmentDetection(
        tone_buckets=tone_buckets,
        skin_type_buckets=skin_buckets,
        usage_context_buckets=usage_buckets,
        finish_preference_buckets=finish_buckets,
        option_mentions=options,
        buyer_fit_positive=tuple(fit_positive[:5]),
        buyer_fit_caution=tuple(fit_caution[:5]),
    )


# ---------------------------------------------------------------------------
# PDF-shaped buyer signals
# ---------------------------------------------------------------------------


def build_pdf_buyer_signals(
    detection: SegmentDetection,
    *,
    n_reviews_total: int,
) -> tuple[BuyerSegmentSignal, ...]:
    """Produce up to 3 BuyerSegmentSignal records for the PDF
    section: best-fit, caution, seller-page. Each carries label,
    count, denominator, representative quote, and dual-use notes
    (seller note + buyer note).

    Empty tuple is a valid return — when no segment clears
    SEGMENT_MIN_MENTIONS, the section emits a graceful "관측되지
    않았습니다" placeholder.
    """
    out: list[BuyerSegmentSignal] = []
    denom_basis = (
        f"분석 리뷰 {n_reviews_total:,}건 기준" if n_reviews_total
        else "분석 리뷰 표본 기준"
    )

    # Card 1: best fit - strongest positive segment.
    # decision_hint_ko frames the segment as a soft recommendation;
    # confidence_level controls the strength variant.
    if detection.buyer_fit_positive:
        top = detection.buyer_fit_positive[0]
        conf = compute_segment_confidence(
            dominant_count=top.n_positive,
            total_mentions=top.n_total,
            n_reviews_total=n_reviews_total,
        )
        contrast_label = (
            detection.buyer_fit_caution[0].label_ko
            if detection.buyer_fit_caution else None
        )
        # Confidence-keyed hint phrase.
        hint_phrase = _POSITIVE_HINT_BY_CONFIDENCE[conf]
        decision_hint = f"{top.label_ko} 사용자에게 {hint_phrase}."
        if contrast_label:
            buyer_note = (
                f"리뷰상 {top.label_ko} 사용 시 {hint_phrase}. "
                f"다만 {contrast_label} 사용 환경에서는 의견이 "
                "갈리므로, 본인 상황과 비교 후 검토가 권장됩니다."
            )
        else:
            buyer_note = (
                f"리뷰상 {top.label_ko} 사용 시 {hint_phrase}. "
                "본인 사용 맥락과 비교 후 구매 검토가 권장됩니다."
            )
        out.append(BuyerSegmentSignal(
            label_ko=f"{top.label_ko} 관련 긍정 신호",
            n_count=top.n_positive,
            denominator=n_reviews_total,
            denominator_basis_ko=denom_basis,
            representative_quote=top.representative_quote,
            seller_note_ko=(
                f"{top.label_ko} 관련 만족 의견이 반복적으로 "
                "관찰됩니다. 상세페이지에서 해당 맥락의 사용 후기/"
                "이미지 보강 후보로 검토할 수 있습니다."
            ),
            buyer_note_ko=buyer_note,
            decision_hint_ko=decision_hint,
            confidence_level=conf,
        ))

    # Card 2: caution context - strongest negative segment.
    if detection.buyer_fit_caution:
        top = detection.buyer_fit_caution[0]
        conf = compute_segment_confidence(
            dominant_count=top.n_negative,
            total_mentions=top.n_total,
            n_reviews_total=n_reviews_total,
        )
        related_attr_ko = _related_attribute_for_caution(top.label_ko)
        caution_phrase = _CAUTION_HINT_BY_CONFIDENCE[conf]
        if related_attr_ko:
            decision_hint = (
                f"{top.label_ko} 환경에서는 {related_attr_ko} "
                f"{caution_phrase}. 본인 상황과 비교 후 확인이 "
                "권장됩니다."
            )
        else:
            decision_hint = (
                f"{top.label_ko} 사용 환경에서는 사용 맥락 "
                f"{caution_phrase}. 구매 전 함께 확인이 권장됩니다."
            )
        out.append(BuyerSegmentSignal(
            label_ko=f"{top.label_ko} 관련 주의 신호",
            n_count=top.n_negative,
            denominator=n_reviews_total,
            denominator_basis_ko=denom_basis,
            representative_quote=top.representative_quote,
            seller_note_ko=(
                f"{top.label_ko} 사용 맥락에서 의견 분포 차이가 "
                "관찰됩니다. CS 문의/교환 데이터와 교차 확인이 "
                "권장됩니다."
            ),
            buyer_note_ko=(
                f"리뷰상 {top.label_ko} 사용 환경에서는 의견이 "
                "갈리는 신호가 관찰됩니다. 구매 전 본인 사용 맥락 "
                "확인 포인트입니다."
            ),
            decision_hint_ko=decision_hint,
            confidence_level=conf,
        ))

    # Card 3: option/seller-page note - surfaces only when option
    # mentions exist. Confidence here is keyed off the option count
    # alone (no positive/negative split).
    if detection.option_mentions:
        n_options = len(detection.option_mentions)
        out.append(BuyerSegmentSignal(
            label_ko="옵션/호수별 의견 분포",
            n_count=n_options,
            denominator=n_reviews_total,
            denominator_basis_ko=denom_basis,
            representative_quote=None,
            seller_note_ko=(
                f"수집 표본에서 {n_options}개 옵션이 관측됩니다. "
                "옵션별 부정 의견 분포가 다른지 확인하면 상세페이지/"
                "옵션명 재정비에 활용할 수 있습니다."
            ),
            buyer_note_ko=(
                "옵션/호수에 따라 사용감이 다를 수 있어, 본인이 "
                "구매하는 옵션의 후기를 별도로 확인하는 것이 "
                "권장됩니다."
            ),
            decision_hint_ko=(
                "구매하려는 옵션/호수의 후기를 별도로 확인하는 것이 "
                "좋습니다."
            ),
            # Option-card confidence is bounded - we don't have
            # polarity dominance for the option list itself.
            confidence_level="moderate" if n_options >= 3 else "weak",
        ))

    return tuple(out[:3])


# Mapping: caution-segment label → the attribute concern most
# commonly associated with that context. Used to compose
# decision_hint_ko like "마스크 환경에서는 지속력 관련 확인..."
# Kept conservative; an unknown label falls back to a generic hint.
_CAUTION_RELATED_ATTRIBUTE_KO: dict[str, str] = {
    "마스크/외출 상황": "지속력",
    "여름/고온 환경":   "지속력",
    "겨울/건조 환경":   "건조감",
    "건성":             "건조감",
    "건성 피부":        "건조감",
    "지성":             "지속력",
    "지성 피부":        "지속력",
    "민감성":           "사용감",
    "민감성 피부":      "사용감",
    "민감한 피부":      "사용감",
    "강한 발색":        "발색",
    "내추럴 마무리":    "발색",
    "데일리 사용":      "지속력",
}


def _related_attribute_for_caution(label_ko: str) -> str | None:
    return _CAUTION_RELATED_ATTRIBUTE_KO.get(label_ko)


# ---------------------------------------------------------------------------
# Quick decision summary - the SNS card-1 core
# ---------------------------------------------------------------------------


def build_quick_decision_summary(
    detection: SegmentDetection,
    *,
    overall_level: str,
    n_reviews_total: int,
) -> QuickDecisionSummary:
    """Compose the 3-line buyer-decision summary with confidence-
    keyed phrasing.

    confidence_level reflects the LEAD signal (top buyer_fit_positive
    when present, else top buyer_fit_caution). All three lines vary
    in strength accordingly; weak corpora read as "일부 관찰됩니다",
    strong corpora read as "일관되게 나타납니다".
    """
    pos = detection.buyer_fit_positive[0] if detection.buyer_fit_positive else None
    cau = detection.buyer_fit_caution[0] if detection.buyer_fit_caution else None

    # Lead-signal confidence drives all line phrasing.
    if pos is not None:
        conf = compute_segment_confidence(
            dominant_count=pos.n_positive,
            total_mentions=pos.n_total,
            n_reviews_total=n_reviews_total,
        )
    elif cau is not None:
        conf = compute_segment_confidence(
            dominant_count=cau.n_negative,
            total_mentions=cau.n_total,
            n_reviews_total=n_reviews_total,
        )
    else:
        conf = "weak"

    pos_phrase = _POSITIVE_HINT_BY_CONFIDENCE[conf]
    cau_phrase = _CAUTION_HINT_BY_CONFIDENCE[conf]
    takeaway_phrase = _TAKEAWAY_LEAD_BY_CONFIDENCE[conf]

    # who_it_works_for
    if pos is not None:
        who_works = f"{pos.label_ko} 사용자에게 {pos_phrase}."
    elif overall_level == "LOW":
        who_works = (
            f"전반적으로 긍정 {takeaway_phrase}."
        )
    else:
        who_works = (
            "특정 사용자 그룹에 대한 명시적 신호는 강하게 관측되지 "
            "않았습니다."
        )

    # who_should_check_more
    if cau is not None:
        related = _related_attribute_for_caution(cau.label_ko)
        if related:
            who_check = (
                f"{cau.label_ko} 사용 환경이라면 {related} 관련 "
                "의견을 함께 확인하는 것이 좋습니다."
            )
        else:
            who_check = (
                f"{cau.label_ko} 사용 맥락에서는 의견이 갈리므로 "
                "구매 전 함께 확인하는 것이 좋습니다."
            )
    else:
        who_check = (
            "현재 표본에서는 별도로 강조할 주의 맥락이 관측되지 "
            "않았습니다."
        )

    # simple_takeaway - confidence-aware wrap-up
    if pos is not None and cau is not None:
        takeaway = (
            f"{pos.label_ko} 사용자에게 {pos_phrase}. 다만 "
            f"{cau.label_ko} 사용 환경에서는 추가 확인이 권장됩니다."
        )
    elif pos is not None:
        takeaway = (
            f"{pos.label_ko} 사용자에게 {pos_phrase}. 본인 사용 "
            "맥락과 비교 후 검토가 권장됩니다."
        )
    elif cau is not None:
        takeaway = (
            f"{cau.label_ko} 사용 환경에서 {cau_phrase}. 구매 전 "
            "사용 맥락 확인이 권장됩니다."
        )
    else:
        takeaway = (
            f"분석 리뷰 {n_reviews_total:,}건 기준, 명확한 사용자 "
            "그룹 분리 신호가 강하게 관측되지 않았습니다."
        )

    return QuickDecisionSummary(
        who_it_works_for=who_works,
        who_should_check_more=who_check,
        simple_takeaway=takeaway,
        confidence_level=conf,
    )


# ---------------------------------------------------------------------------
# Content-ready quote selection (SNS card-friendly)
# ---------------------------------------------------------------------------


# Emotional / strong-reaction markers - quotes containing one of these
# read as authentic reviewer voice rather than neutral filler.
_EMOTIONAL_MARKERS_KO: tuple[str, ...] = (
    "너무", "정말", "진짜", "완전", "짱", "최고",
    "ㅠㅠ", "ㅜㅜ", "ㅋㅋ", "!", "!!",
    "대박", "강추", "비추",
)

# Neutral filler markers - quotes with these read as forgettable
# and don't carry well as content.
_NEUTRAL_FILLER_KO: tuple[str, ...] = (
    "보통", "그냥", "적당", "무난",
)

QUOTE_MAX_CHARS_FOR_CONTENT: int = 60
QUOTE_MIN_CHARS_FOR_CONTENT: int = 8


def pick_content_quote(spans: Iterable[str]) -> str | None:
    """Pick the most content-ready quote from a sequence of evidence
    spans.

    Selection rules (priority order):
      1. Length within [QUOTE_MIN_CHARS, QUOTE_MAX_CHARS]
      2. Contains at least one emotional marker
      3. Does NOT consist primarily of neutral fillers
      4. Among ties, prefer the shorter one (more SNS-card friendly)

    Returns None when no span clears the rules - caller falls back
    to the existing representative_quote (any verbatim quote) so
    the PDF surface degrades gracefully.
    """
    candidates: list[tuple[int, int, str]] = []
    for s in spans or []:
        if not s:
            continue
        n_chars = len(s)
        if n_chars < QUOTE_MIN_CHARS_FOR_CONTENT:
            continue
        if n_chars > QUOTE_MAX_CHARS_FOR_CONTENT:
            continue
        # Reject if filler-dominated.
        if any(f in s for f in _NEUTRAL_FILLER_KO) and not any(
            m in s for m in _EMOTIONAL_MARKERS_KO
        ):
            continue
        emotional_score = sum(1 for m in _EMOTIONAL_MARKERS_KO if m in s)
        # Sort key: emotional_score desc, then length asc.
        candidates.append((-emotional_score, n_chars, s))
    if not candidates:
        return None
    candidates.sort()
    return candidates[0][2]


# ---------------------------------------------------------------------------
# Theme grouping (storytelling-ready)
# ---------------------------------------------------------------------------


# Pre-canned theme contrasts. Each pair = ("이름", positive_label,
# caution_label). The renderer surfaces a contrast sentence when
# both sides have signals above SEGMENT_MIN_MENTIONS in the
# detection output.
THEME_CONTRASTS_KO: tuple[tuple[str, str, str], ...] = (
    ("자연스러움 vs 발색력",   "내추럴 마무리", "강한 발색"),
    ("데일리 vs 포인트 메이크업", "데일리 사용", "포인트 메이크업"),
    ("실내 vs 야외/마스크",    "데일리 사용", "마스크/외출 상황"),
)


@dataclass(frozen=True)
class ThemeContrast:
    """One headline-level theme contrast used for storytelling.

    Surfaces only when BOTH sides have observed mentions; otherwise
    omitted (no fabricated contrast).
    """
    theme_label_ko: str
    a_label: str
    a_positive: int
    a_negative: int
    b_label: str
    b_positive: int
    b_negative: int
    contrast_sentence_ko: str   # ready-to-render sentence


def detect_theme_contrasts(
    detection: SegmentDetection,
) -> tuple[ThemeContrast, ...]:
    """Compute headline-level theme contrasts from per-bucket
    counts. Returns empty tuple when no theme has both sides
    observed.
    """
    # Build a unified label → bucket lookup across all bucket lists.
    label_to_bucket: dict[str, SegmentBucket] = {}
    for bucket_list in (
        detection.tone_buckets,
        detection.skin_type_buckets,
        detection.usage_context_buckets,
        detection.finish_preference_buckets,
    ):
        for b in bucket_list:
            label_to_bucket[b.label_ko] = b

    out: list[ThemeContrast] = []
    for theme_label, a_label, b_label in THEME_CONTRASTS_KO:
        a = label_to_bucket.get(a_label)
        b = label_to_bucket.get(b_label)
        if a is None or b is None:
            continue
        # Compose a contrast sentence reflecting the dominant
        # polarity on each side.
        a_dom = "긍정" if a.n_positive >= a.n_negative else "주의"
        b_dom = "긍정" if b.n_positive >= b.n_negative else "주의"
        if a_dom == "긍정" and b_dom == "주의":
            sentence = (
                f"{a_label}에는 무난하다는 의견이 많지만, "
                f"{b_label} 환경에서는 의견이 갈리는 신호도 함께 "
                "관찰됩니다."
            )
        elif a_dom == "주의" and b_dom == "긍정":
            sentence = (
                f"{b_label}에는 무난하다는 의견이 많지만, "
                f"{a_label} 환경에서는 의견이 갈리는 신호도 함께 "
                "관찰됩니다."
            )
        elif a_dom == "긍정" and b_dom == "긍정":
            sentence = (
                f"{a_label}와 {b_label} 모두에서 긍정 의견이 "
                "관찰됩니다."
            )
        else:
            sentence = (
                f"{a_label}와 {b_label} 모두에서 의견이 갈리는 "
                "신호가 관찰됩니다."
            )
        out.append(ThemeContrast(
            theme_label_ko=theme_label,
            a_label=a_label,
            a_positive=a.n_positive,
            a_negative=a.n_negative,
            b_label=b_label,
            b_positive=b.n_positive,
            b_negative=b.n_negative,
            contrast_sentence_ko=sentence,
        ))
    return tuple(out)


# ---------------------------------------------------------------------------
# Buyer-content summary export (structured for SNS/card-news reuse)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class BuyerContentSummary:
    """Structured content prepared for downstream SNS/card-news
    generation. NOT rendered to PDF directly - this is the export
    contract for a future card-news generator.

    Three layers compose into one export:
      Layer 1 (PDF cover use): one_line_summary
      Layer 2 (SNS card 1):     quick_decision + confidence_badge_ko
      Layer 2 (SNS card 2-N):   contrast_sentences + content_quotes
      Layer 2 (SNS hooks):      hook_lines (NOT for PDF; SNS only)

    `confidence_badge_ko` carries a short reliability signal for SNS
    cards ("리뷰 기반 판단 (표본 1,000+)" vs "초기 신호 (표본 적음)"
    so a buyer can read trust level at a glance.

    Wording is observation-based - every field uses hedged language
    that wouldn't read as medical/dermatological advice.
    """
    product_name: str
    one_line_summary: str
    quick_decision: QuickDecisionSummary
    best_fit_contexts: tuple[str, ...]
    check_before_buying: tuple[str, ...]
    contrast_sentences: tuple[str, ...]
    top_positive_quotes: tuple[str, ...]
    top_caution_quotes: tuple[str, ...]
    seller_notes: tuple[str, ...]
    hook_lines: tuple[str, ...]
    confidence_badge_ko: str = ""         # SNS-card reliability chip


def build_buyer_content_summary(
    *,
    product_name: str,
    detection: SegmentDetection,
    overall_level: str,
    n_reviews_total: int,
) -> BuyerContentSummary:
    """Compose the buyer-content export from segment detection +
    overall signal level. Phrases are hedged ("관찰됩니다", "확인
    포인트", "잘 맞았다는 의견") - never prescriptive.

    Pulls content quotes via `pick_content_quote` (short, emotional,
    SNS-friendly) with fallback to `representative_quote` when no
    span clears the filter - so the export stays populated on
    quieter corpora.
    """
    # one-line summary keyed by overall level
    if overall_level == "LOW":
        one_line = (
            f"{n_reviews_total:,}건 리뷰 기준 전반적으로 긍정 신호가 "
            "우세합니다. 일부 사용 맥락에서는 구매 전 확인 포인트가 "
            "관찰됩니다."
        )
    elif overall_level == "MEDIUM":
        one_line = (
            f"{n_reviews_total:,}건 리뷰 기준 일부 속성에서 관찰이 "
            "필요한 신호가 확인됩니다."
        )
    else:
        one_line = (
            f"{n_reviews_total:,}건 리뷰 기준 부정 신호가 다소 "
            "누적되어 있어 구매 전 확인 포인트가 다수 관찰됩니다."
        )

    quick = build_quick_decision_summary(
        detection,
        overall_level=overall_level,
        n_reviews_total=n_reviews_total,
    )

    best_fit = tuple(
        f"{b.label_ko} 사용 시 잘 맞았다는 의견이 반복됨 "
        f"(긍정 {b.n_positive}건)"
        for b in detection.buyer_fit_positive[:3]
    )
    caution = tuple(
        f"{b.label_ko} 사용 환경에서 의견이 갈리는 신호 "
        f"(부정 {b.n_negative}건)"
        for b in detection.buyer_fit_caution[:3]
    )

    # Theme-level contrasts (SNS storytelling)
    contrasts = detect_theme_contrasts(detection)
    contrast_sentences = tuple(
        c.contrast_sentence_ko for c in contrasts
    )

    # Content-ready quotes: prefer short, emotional spans. Fall back
    # to representative_quote if filter rejects everything.
    def _pick_or_fallback(buckets: tuple) -> tuple[str, ...]:
        out_quotes: list[str] = []
        for b in buckets[:3]:
            # Pull all evidence spans for this bucket back from
            # the bucket itself; we only have representative_quote
            # in SegmentBucket, so the candidate set is one item.
            cand = pick_content_quote([b.representative_quote] if b.representative_quote else [])
            if cand:
                out_quotes.append(cand)
            elif b.representative_quote:
                out_quotes.append(b.representative_quote)
        return tuple(out_quotes)

    pos_quotes = _pick_or_fallback(detection.buyer_fit_positive)
    caution_quotes = _pick_or_fallback(detection.buyer_fit_caution)

    seller_notes_list: list[str] = []
    if detection.option_mentions:
        seller_notes_list.append(
            f"옵션/호수 {len(detection.option_mentions)}종이 표본에 "
            "포함됨 - 옵션별 부정 의견 분포 확인 후보"
        )
    if detection.buyer_fit_positive:
        seller_notes_list.append(
            f"{detection.buyer_fit_positive[0].label_ko} 관련 만족 "
            "의견이 반복 - 상세페이지 보강 후보"
        )
    if detection.buyer_fit_caution:
        seller_notes_list.append(
            f"{detection.buyer_fit_caution[0].label_ko} 사용 맥락 "
            "관련 - CS 문의/교환 데이터 교차 확인 권장"
        )

    # SNS hook lines (max 3). Conditional - only emit when the
    # underlying signal supports the hook. Phrasing varies by the
    # quick decision's confidence so a weak corpus doesn't pretend
    # to have a strong pattern.
    quick_conf = quick.confidence_level
    hooks: list[str] = []
    if detection.buyer_fit_positive:
        if quick_conf == "strong":
            hooks.append(
                "이 제품, 이런 사용자에게 잘 맞았다는 의견이 일관되게 "
                "나타납니다"
            )
        elif quick_conf == "moderate":
            hooks.append(
                "이 제품, 이런 사용자에게 잘 맞았다는 의견이 반복적으로 "
                "관찰됩니다"
            )
        else:
            hooks.append(
                "이 제품, 일부 리뷰에서 잘 맞았다는 의견이 보입니다"
            )
    if detection.buyer_fit_caution:
        hooks.append("구매 전 확인하면 좋은 포인트도 함께 정리했습니다")
    # Review-count hook reflects sample size + confidence. Big corpus +
    # strong signal earns the "반복 패턴" framing; small corpus reads as
    # "초기 패턴".
    if n_reviews_total >= 1000 and quick_conf in ("moderate", "strong"):
        hooks.append(
            f"리뷰 {n_reviews_total:,}건 기준 반복 패턴입니다"
        )
    elif n_reviews_total >= 200 and quick_conf == "moderate":
        hooks.append(
            f"리뷰 {n_reviews_total:,}건에서 반복적으로 보이는 패턴입니다"
        )
    elif n_reviews_total < 200:
        hooks.append("일부 리뷰에서 보이는 초기 패턴입니다")

    # Confidence badge - one-line reliability chip for SNS cards.
    badge = _compute_confidence_badge(
        n_reviews_total=n_reviews_total,
        quick_confidence=quick_conf,
    )

    return BuyerContentSummary(
        product_name=product_name,
        one_line_summary=one_line,
        quick_decision=quick,
        best_fit_contexts=best_fit,
        check_before_buying=caution,
        contrast_sentences=contrast_sentences,
        top_positive_quotes=pos_quotes,
        top_caution_quotes=caution_quotes,
        seller_notes=tuple(seller_notes_list),
        hook_lines=tuple(hooks[:3]),
        confidence_badge_ko=badge,
    )


def _compute_confidence_badge(
    *,
    n_reviews_total: int,
    quick_confidence: ConfidenceLevel,
) -> str:
    """One-line reliability chip for the SNS card.

    Logic:
      - N >= 1000 AND confidence != weak → "리뷰 기반 판단 (표본 1,000+)"
      - N >= 500  AND confidence != weak → "리뷰 기반 판단 (표본 N건)"
      - N >= 200                         → "리뷰 기반 판단 (표본 N건)"
      - N < 200 OR confidence == weak    → "초기 신호 (표본 적음)"
    """
    if n_reviews_total >= 1000 and quick_confidence != "weak":
        return "리뷰 기반 판단 (표본 1,000+)"
    if n_reviews_total >= 500 and quick_confidence != "weak":
        return f"리뷰 기반 판단 (표본 {n_reviews_total:,}건)"
    if n_reviews_total >= 200 and quick_confidence != "weak":
        return f"리뷰 기반 판단 (표본 {n_reviews_total:,}건)"
    return "초기 신호 (표본 적음)"
