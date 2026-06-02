"""Phase 2E manufacturer-facing report renderer.

Consumes pipeline output (Stage 1 + Stage 2 + Stage 3) and produces a
markdown report intended for manufacturer / brand outreach. Operator
language, not engine internals.

Input shape (one product's worth):
  - product_id, product_name
  - reviews: list of {review_id, mixed_review_flag, tradeoff_pair,
                       records: [{attribute, polarity, intensity,
                                  evidence_span, confidence,
                                  delivery_condition_flag, ...}]}

Output: markdown string. No file I/O in this module.

This module performs NO pipeline operations, NO DB access, NO LLM calls.
It is pure aggregation + rendering on already-produced pipeline output.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# Operator-facing labels (no schema-internal IDs)
# ---------------------------------------------------------------------------

ATTRIBUTE_LABELS_KO = {
    "pigmentation": "발색 (color intensity)",
    "persistence": "지속력 (longevity)",
    "application_blending": "발림성/블렌딩 (application & blending)",
    "adhesion_base_interaction": "베이스 상호작용 (base interaction)",
    "finish_texture": "마무리감 (finish texture)",
    "dryness_skin_texture": "건조감 (dryness)",
    "color_tone_matching": "색/톤 매칭 (shade fit)",
    "packaging_container": "외부 용기 (packaging)",
    "applicator_tool": "도구 (퍼프/브러시) (applicator tool)",
    "value_price": "가격/가성비 (value & price)",
    "multi_use_lip_cheek_compatibility": "립앤치크 호환성 (multi-use)",
    "transfer_resistance": "마스크/옷 묻어남 저항 (transfer resistance)",
}

POLARITY_LABELS = {
    "positive": "Positive",
    "negative_weak": "Mild concern",
    "negative_strong": "Strong concern",
    "mixed": "Mixed (same-attribute self-contradiction)",
    "neutral": "Neutral",
    "ambiguous": "Ambiguous",
}

NEGATIVE_LIKE = ("negative_weak", "negative_strong", "mixed")
POSITIVE_LIKE = ("positive", "mixed")


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------


@dataclass
class AttributeSummary:
    attribute: str
    n_total: int = 0          # records on this attribute
    n_negative: int = 0       # negative_weak + negative_strong + mixed
    n_positive: int = 0
    n_mixed: int = 0
    n_neg_weak: int = 0       # v2: split for polarity distribution chart
    n_neg_strong: int = 0     # v2: split for polarity distribution chart
    avg_intensity_neg: float = 0.0
    confidence_dist: Counter = field(default_factory=Counter)
    delivery_condition_count: int = 0
    sample_evidences_neg: list[dict] = field(default_factory=list)  # negative examples
    sample_evidences_pos: list[dict] = field(default_factory=list)  # positive examples


@dataclass
class ProductReportData:
    product_id: str
    product_name: str
    n_reviews: int
    n_records: int
    n_mixed_reviews: int
    n_with_tradeoff: int
    attribute_summaries: dict[str, AttributeSummary]
    tradeoff_pairs: Counter         # tradeoff_pair string -> count
    mixed_attribute_pairs: list[tuple[str, str, int]]  # (attr_a, attr_b, n_reviews)
    delivery_condition_records_total: int
    # v2.4 product image fields. The adapter
    # (`src/voc/content/adapters/from_phase2e.py`) reads these via
    # `getattr(data, "product_image_*", None)` — None-safe defaults
    # mean older callers that don't populate them keep working.
    #
    # `product_image_url`        — original URL, captured at collection
    #                              time (OY: og:image / JSON-LD on the
    #                              detail page; Coupang: image_url /
    #                              thumbnail_url CSV column).
    # `product_image_local_path` — run-relative path under
    #                              `<run>/assets/`, populated either by
    #                              the collection-stage fetcher or by
    #                              the operator backfill CLI. The
    #                              cardnews renderer prefers this over
    #                              live URL fetches.
    # `product_image_source`     — channel label
    #                              (oliveyoung | coupang | manual |
    #                              og_image | json_ld | None).
    product_image_url: str | None = None
    product_image_local_path: str | None = None
    product_image_source: str | None = None


def aggregate_product(
    product_id: str,
    product_name: str,
    reviews: list[dict],
) -> ProductReportData:
    """Aggregate pipeline output for one product.

    `reviews` is a list of {review_id, mixed_review_flag, tradeoff_pair,
    records: [...]} dicts.
    """
    attr_summaries: dict[str, AttributeSummary] = defaultdict(lambda: AttributeSummary(attribute=""))

    n_mixed_reviews = sum(1 for r in reviews if r.get("mixed_review_flag"))
    n_with_tradeoff = sum(1 for r in reviews if r.get("tradeoff_pair"))
    tradeoff_pairs = Counter(r.get("tradeoff_pair") for r in reviews if r.get("tradeoff_pair"))

    # Pairs of attributes that co-occur with opposing polarities within a review
    mixed_attr_pair_counter: Counter = Counter()
    delivery_total = 0

    n_records = 0
    intensity_acc: dict[str, list[int]] = defaultdict(list)

    for review in reviews:
        recs = review.get("records", [])
        # Identify positive and negative attributes within this review
        pos_attrs = sorted({r["attribute"] for r in recs if r.get("polarity") in POSITIVE_LIKE})
        neg_attrs = sorted({r["attribute"] for r in recs if r.get("polarity") in NEGATIVE_LIKE})
        for pa in pos_attrs:
            for na in neg_attrs:
                if pa == na:
                    continue
                pair = tuple(sorted([pa, na]))
                mixed_attr_pair_counter[pair] += 1

        for r in recs:
            n_records += 1
            attr = r["attribute"]
            s = attr_summaries[attr]
            s.attribute = attr
            s.n_total += 1
            polarity = r.get("polarity")
            confidence = r.get("confidence", "medium")
            s.confidence_dist[confidence] += 1
            if r.get("delivery_condition_flag"):
                s.delivery_condition_count += 1
                delivery_total += 1
            # Phase 2E evidence-scoring fields surface at the review
            # level (not the per-record level): the score is per-review,
            # so all records emitted from the same review share it.
            # Pulled from the review dict so caller controls how it's
            # plumbed (DB row → review block); aggregator never reads
            # raw_metadata_json directly.
            ev_score = review.get("oy_evidence_score")
            ev_rating = review.get("rating_normalized")
            ev_sort_ranks = review.get("oy_sort_ranks") or {}
            ev_date = review.get("review_date")

            if polarity == "positive":
                s.n_positive += 1
                if len(s.sample_evidences_pos) < 5:
                    s.sample_evidences_pos.append({
                        "review_id": review.get("review_id", "")[:12],
                        "polarity": polarity,
                        "intensity": r.get("intensity"),
                        "confidence": confidence,
                        "evidence_span": r.get("evidence_span", ""),
                        "delivery_condition_flag": r.get("delivery_condition_flag", False),
                        # Evidence-scoring inputs (additive - preserved
                        # as None when the upstream review block didn't
                        # carry them, e.g. legacy code paths).
                        "oy_evidence_score": ev_score,
                        "rating_normalized": ev_rating,
                        "oy_sort_ranks": dict(ev_sort_ranks) if ev_sort_ranks else {},
                        "review_date": ev_date,
                    })
            elif polarity in ("negative_weak", "negative_strong", "mixed"):
                s.n_negative += 1
                if polarity == "mixed":
                    s.n_mixed += 1
                elif polarity == "negative_weak":
                    s.n_neg_weak += 1
                elif polarity == "negative_strong":
                    s.n_neg_strong += 1
                intensity = r.get("intensity") or 0
                intensity_acc[attr].append(intensity)
                if len(s.sample_evidences_neg) < 5:
                    s.sample_evidences_neg.append({
                        "review_id": review.get("review_id", "")[:12],
                        "polarity": polarity,
                        "intensity": intensity,
                        "confidence": confidence,
                        "evidence_span": r.get("evidence_span", ""),
                        "delivery_condition_flag": r.get("delivery_condition_flag", False),
                        "oy_evidence_score": ev_score,
                        "rating_normalized": ev_rating,
                        "oy_sort_ranks": dict(ev_sort_ranks) if ev_sort_ranks else {},
                        "review_date": ev_date,
                    })

    # Compute average intensity for negative records per attribute
    for attr, s in attr_summaries.items():
        intensities = intensity_acc.get(attr, [])
        if intensities:
            s.avg_intensity_neg = sum(intensities) / len(intensities)

    # Mixed pairs sorted by frequency
    mixed_pairs_sorted = [
        (a, b, n) for (a, b), n in mixed_attr_pair_counter.most_common()
    ]

    return ProductReportData(
        product_id=product_id,
        product_name=product_name,
        n_reviews=len(reviews),
        n_records=n_records,
        n_mixed_reviews=n_mixed_reviews,
        n_with_tradeoff=n_with_tradeoff,
        attribute_summaries=dict(attr_summaries),
        tradeoff_pairs=tradeoff_pairs,
        mixed_attribute_pairs=mixed_pairs_sorted,
        delivery_condition_records_total=delivery_total,
    )


# ---------------------------------------------------------------------------
# Confidence rating: per-finding label
# ---------------------------------------------------------------------------


def _confidence_label(s: AttributeSummary) -> str:
    """Operator-facing confidence rating for an attribute finding.

    Combines:
      - sample size (more records = higher confidence)
      - confidence distribution (more high-confidence records = higher)
    """
    if s.n_total < 2:
        return "low (insufficient evidence)"
    high_pct = s.confidence_dist.get("high", 0) / s.n_total
    if s.n_total >= 5 and high_pct >= 0.6:
        return "high"
    if s.n_total >= 3 and high_pct >= 0.4:
        return "medium"
    return "low"


# ---------------------------------------------------------------------------
# v2 helpers - priority, chart data, action-bullet builder, evidence selection
# ---------------------------------------------------------------------------

def compute_priority(summary: AttributeSummary, n_reviews: int) -> str:
    """Return 'High' / 'Medium' / 'Low' priority label for a finding.

    Priority combines mention frequency (% of reviews flagging the attribute)
    and severity (avg intensity of negative records). Tuned for the
    manufacturer-outreach use case where 30%+ flagging or 20%+ flagging at
    avg severity ≥ 2.5/3 warrants top-tier escalation.
    """
    if n_reviews <= 0 or summary.n_negative == 0:
        return "Low"
    pct = summary.n_negative / n_reviews
    sev = summary.avg_intensity_neg
    if pct >= 0.30 or (pct >= 0.20 and sev >= 2.5):
        return "High"
    if pct >= 0.15 or (pct >= 0.10 and sev >= 2.5):
        return "Medium"
    return "Low"


def _ko_short_label(attribute: str) -> str:
    """Korean-only short label without the parenthetical English gloss."""
    full = ATTRIBUTE_LABELS_KO.get(attribute, attribute)
    return full.split("(")[0].strip()


def chart_data_top_negative(
    data: ProductReportData, top_n: int = 5
) -> tuple[list[str], list[float], list[str]]:
    """Return (labels, percent_of_reviews, priority_labels) for top-N negative
    attributes. Used by the bar-chart renderer in the PDF.
    """
    sorted_attrs = sorted(
        [s for s in data.attribute_summaries.values() if s.n_negative > 0],
        key=lambda s: -s.n_negative,
    )[:top_n]
    labels = [_ko_short_label(s.attribute) for s in sorted_attrs]
    percents = [(s.n_negative / data.n_reviews * 100) if data.n_reviews else 0 for s in sorted_attrs]
    priorities = [compute_priority(s, data.n_reviews) for s in sorted_attrs]
    return labels, percents, priorities


def chart_data_polarity_distribution(
    data: ProductReportData, top_n: int = 6
) -> dict:
    """Return polarity-distribution data for the top-N most-mentioned attributes.

    Output: {
      'labels': [attr_label, ...],
      'positive': [counts],
      'negative_weak': [counts],
      'negative_strong': [counts],
      'mixed': [counts],
    }
    """
    sorted_attrs = sorted(
        [s for s in data.attribute_summaries.values() if s.n_total > 0],
        key=lambda s: -s.n_total,
    )[:top_n]
    labels = [_ko_short_label(s.attribute) for s in sorted_attrs]
    return {
        "labels": labels,
        "positive": [s.n_positive for s in sorted_attrs],
        "negative_weak": [s.n_neg_weak for s in sorted_attrs],
        "negative_strong": [s.n_neg_strong for s in sorted_attrs],
        "mixed": [s.n_mixed for s in sorted_attrs],
    }


# Per-attribute core stem set used for evidence-relevance filtering.
# Evidence whose text contains NONE of an attribute's core stems is
# considered cross-attribute leakage (e.g., a price comment mistakenly
# routed to packaging_container). The filter is permissive - if it would
# leave an attribute with zero evidence, we fall back to the unfiltered
# pool rather than emit nothing.
ATTRIBUTE_CORE_STEMS: dict[str, set[str]] = {
    "pigmentation": {"발색", "색감", "진하", "진해", "진한", "연하", "연해", "옅", "약하", "채도", "톤다운"},
    "persistence": {"지속력", "유지력", "오래", "금방", "반나절", "종일"},
    "application_blending": {"양조절", "양 조절", "발림", "잘 발", "잘 펴", "펴바르", "블렌딩",
                               "뭉침", "뭉쳐", "얼룩", "다루기", "쉽게", "똥손", "톡톡"},
    "adhesion_base_interaction": {"베이스", "파데", "쿠션", "밀착", "벗겨", "들뜨", "들떠", "겉돌",
                                    "안 쌓이", "밀려", "밀렸"},
    "finish_texture": {"촉촉", "윤광", "광이", "광택", "보송", "블러", "끈적", "찐득", "매트", "유분",
                         "머리카락"},
    "dryness_skin_texture": {"건조", "퍼석", "텁텁", "각질", "모공", "요철"},
    "color_tone_matching": {"톤", "쿨", "웜", "찰떡", "흰끼", "다크닝", "칙칙", "홍조", "붉어",
                              "안 맞", "안맞", "어울"},
    "packaging_container": {"케이스", "캐이스", "용기", "뚜껑"},
    "applicator_tool": {"퍼프", "브러쉬", "브러시", "솔", "팁", "어플리케이터"},
    "value_price": {"가격", "가성비", "비싸", "비싼", "저렴", "세일", "할인", "용량", "양이"},
    "multi_use_lip_cheek_compatibility": {"입술", "립", "립앤치크", "치크", "겸용", "다용도"},
    "transfer_resistance": {"마스크", "옷에", "옷이", "옷도", "묻어", "옮겨", "베어", "지워짐"},
}


def _is_evidence_relevant(text: str, attribute: str) -> bool:
    """True if the evidence text contains at least one core stem for the
    attribute. Used to filter cross-attribute leakage at the report layer.
    """
    stems = ATTRIBUTE_CORE_STEMS.get(attribute)
    if not stems:
        return True  # unknown attribute → don't filter
    return any(s in (text or "") for s in stems)


def _evidence_sort_key(
    ex: dict,
    *,
    kind: str,
) -> tuple:
    """Build the multi-key sort tuple for one evidence dict.

    Sort order (smaller = better, all keys negated for descending fields):

      1. -oy_evidence_score (highest score first; missing → treated as 0)
      2. kind-specific direction tie-breaker:
           - kind="negative": prefer stronger negative polarity
             (negative_strong=0, negative_weak=1, mixed=2, other=3)
           - kind="positive": prefer higher rating_normalized (missing → 0)
      3. shorter, cleaner evidence_span (len ascending, then alphabetical
         on the stripped text - stable for ties)
      4. newer review_date (ISO date string descending)
      5. legacy confidence/intensity preserved as final tie-breaker so
         behavior on rows lacking score/rating still trends to the
         pre-PR ranking instead of arbitrary order

    Missing values degrade to neutral: `None` score → 0.0; `None` rating
    → 0.0; missing date → empty string (sorts last under descending).
    Never raises on missing fields.
    """
    score = ex.get("oy_evidence_score")
    score_key = -float(score) if isinstance(score, (int, float)) and not isinstance(score, bool) else 0.0

    polarity = ex.get("polarity") or ""
    if kind == "negative":
        # Lower number = stronger preferred.
        polarity_rank = {
            "negative_strong": 0, "negative_weak": 1,
            "mixed": 2,
        }.get(polarity, 3)
        direction_key: float = float(polarity_rank)
    else:
        rating = ex.get("rating_normalized")
        rating_val = float(rating) if isinstance(rating, (int, float)) and not isinstance(rating, bool) else 0.0
        # Higher rating preferred → negate so smaller is better.
        direction_key = -rating_val

    ev_text = (ex.get("evidence_span") or "").strip()
    span_len_key = len(ev_text)

    # Date descending: invert ISO string ordering by negating via
    # placeholder. Python tuples can't negate strings directly, so we
    # encode "newer first" by sorting a (sentinel, date_str) pair where
    # we convert the date to its negated lexicographic ordinal. The
    # simplest robust trick: prepend "z" - first_char to flip order.
    # In practice ISO dates compare lexicographically, so we just
    # negate by using the string itself as a descending key via tuple
    # negation - Python doesn't support that, so we put dates into a
    # tuple where missing < present and present compared in reverse.
    review_date = ex.get("review_date") or ""
    # `(0, "")` for missing pushes them after present dates. Present
    # dates stored as `(1, -lexicographic_rank)` is hard without
    # numeric encoding; use a wrapper class to invert order.
    date_key = _DescStr(review_date) if review_date else _DescStr("")

    # Final legacy tie-breaker (confidence + intensity) - pre-PR sort.
    conf_rank = {"high": 0, "medium": 1, "low": 2}.get(
        ex.get("confidence", "low"), 2,
    )
    intensity_neg = -(ex.get("intensity") or 0)

    return (
        score_key,
        direction_key,
        span_len_key,
        date_key,
        conf_rank,
        intensity_neg,
        ev_text,  # final stable tie-break
    )


class _DescStr:
    """Wrapper that reverses string comparison so newer ISO dates sort
    earlier in an ascending tuple. Cheaper and more readable than
    encoding the string into a numeric inverse.
    """
    __slots__ = ("s",)

    def __init__(self, s: str):
        self.s = s

    def __lt__(self, other: "_DescStr") -> bool:
        return self.s > other.s

    def __eq__(self, other: object) -> bool:
        return isinstance(other, _DescStr) and self.s == other.s

    def __hash__(self) -> int:
        return hash(("_DescStr", self.s))


def select_evidence(
    summary: AttributeSummary,
    n: int = 3,
    prefer_diverse: bool = True,
    *,
    kind: str = "negative",
) -> list[dict]:
    """Select up to `n` representative evidence excerpts for a finding.

    `kind`:
      - "negative" (default, used for concern / 우려사항 sections) -
        draws from `sample_evidences_neg` and tie-breaks by polarity
        strength so negative_strong is preferred over negative_weak.
      - "positive" (used for strength / 강점 sections) - draws from
        `sample_evidences_pos` and tie-breaks by higher rating.

    Heuristic (v3 - score-based, additive on top of v2 rules):
      1. Multi-key sort by `_evidence_sort_key(ex, kind=kind)`. Primary
         key is -oy_evidence_score (higher score first). When score is
         missing on every row in the pool (e.g., legacy/skipped scoring
         pass), the secondary keys still produce a deterministic
         ordering close to the pre-PR ranking.
      2. Filter out cross-attribute leakage: evidence text must contain
         at least one core stem for this attribute.
      3. Deduplicate on the evidence_span text (stripped + lowercased).
      4. If `prefer_diverse`, no two excerpts from the same review_id.
      5. If filter+dedup empties the pool, fall back to unfiltered top-N
         (better weak evidence than none).

    Score-based ordering is intentionally a *preference*, not a hard
    filter - a missing score (e.g., a row that pre-dates the scoring
    pass) gets a neutral 0.0 contribution and falls behind anything
    with a real score, but doesn't get excluded.
    """
    if kind == "positive":
        pool = list(summary.sample_evidences_pos)
    else:
        pool = list(summary.sample_evidences_neg)
    if not pool:
        return []

    pool.sort(key=lambda e: _evidence_sort_key(e, kind=kind))

    seen_text: set[str] = set()
    seen_review: set[str] = set()
    picked: list[dict] = []
    for ex in pool:
        ev_text = (ex.get("evidence_span") or "").strip()
        if not ev_text:
            continue
        # Cross-attribute leakage filter
        if not _is_evidence_relevant(ev_text, summary.attribute):
            continue
        # Deduplicate on text content
        key = ev_text.lower()
        if key in seen_text:
            continue
        seen_text.add(key)
        # Diversity on review_id
        rid = ex.get("review_id")
        if prefer_diverse and rid and rid in seen_review:
            continue
        if rid:
            seen_review.add(rid)
        picked.append(ex)
        if len(picked) >= n:
            break

    # Fallback: if cross-attribute filter left us empty, relax it.
    if not picked:
        seen_text.clear()
        seen_review.clear()
        for ex in pool:
            ev_text = (ex.get("evidence_span") or "").strip()
            if not ev_text:
                continue
            key = ev_text.lower()
            if key in seen_text:
                continue
            seen_text.add(key)
            rid = ex.get("review_id")
            if prefer_diverse and rid and rid in seen_review:
                continue
            if rid:
                seen_review.add(rid)
            picked.append(ex)
            if len(picked) >= n:
                break
    return picked


# Korean labels for the five OliveYoung review-sort buttons. Used by the
# operator-facing `format_sort_signal_labels_ko` so the PDF can surface
# "평점 낮은순 TOP 5" instead of "RATING_ASC=5". DATETIME_DESC is
# omitted: every review is in the chronological backbone, so labeling
# it adds no signal (matches the SORT_TYPE_MULTIPLIER=0.0 in the
# scoring module).
_SIGNAL_SORT_LABELS_KO: dict[str, str] = {
    "RATING_ASC":        "평점 낮은순",
    "USEFUL_SCORE_DESC": "유용한 순",
    "RECOMMENDED_DESC":  "추천순",
    "RATING_DESC":       "평점 높은순",
}

# Rank threshold for "TOP n" labels. Aligned with the scoring module's
# top tier (rank 1–10 = high weight). A signal label appears only when
# the review's rank in that sort is ≤ this threshold; outside this
# range the rank carries little visibility value and labeling clutters
# the report.
_SIGNAL_RANK_LABEL_THRESHOLD: int = 10


def format_sort_signal_labels_ko(
    sort_ranks: dict[str, int | None] | None,
    *,
    threshold: int = _SIGNAL_RANK_LABEL_THRESHOLD,
) -> list[str]:
    """Format sort-rank metadata as operator-facing Korean labels.

    Input shape matches `raw_metadata.oy_sort_ranks`: a mapping of
    sort_type → 1-based rank (or None when unknown). Returns a list of
    strings like ["평점 낮은순 TOP 5", "유용한 순 TOP 8"], one per sort
    where the review ranks within `threshold` (default top-10).

    Order is fixed by signal strength (RATING_ASC → USEFUL_SCORE_DESC →
    RECOMMENDED_DESC → RATING_DESC), so reports render the most
    important signal first. Sorts not in `_SIGNAL_SORT_LABELS_KO` (e.g.,
    DATETIME_DESC) and ranks outside the threshold are skipped.

    No raw JSON keys appear in the output; consumers can paste the
    strings directly into the report.
    """
    if not sort_ranks:
        return []
    labels: list[str] = []
    # Iterate in the documented signal-strength order so the strongest
    # signal label appears first.
    for sort_type in (
        "RATING_ASC", "USEFUL_SCORE_DESC",
        "RECOMMENDED_DESC", "RATING_DESC",
    ):
        rank = sort_ranks.get(sort_type)
        if not isinstance(rank, int) or isinstance(rank, bool):
            continue
        if rank < 1 or rank > threshold:
            continue
        ko = _SIGNAL_SORT_LABELS_KO.get(sort_type)
        if ko is None:
            continue
        labels.append(f"{ko} TOP {rank}")
    return labels


PRIORITY_RECOMMENDATION_KO = {
    "High": "개선 우선 검토",
    "Medium": "개선 후보",
    "Low": "모니터링 권장",
}


def build_actionable_summary_ko(data: ProductReportData) -> list[str]:
    """Return 3-4 actionable Korean bullets for the executive summary.

    Each bullet is direct and operator-actionable, not descriptive. Includes
    a priority tag and a calibrated recommendation phrase keyed off the
    priority (so weak signals don't overstate as "improvement required").
    """
    bullets: list[str] = []

    neg_ranked = sorted(
        [s for s in data.attribute_summaries.values() if s.n_negative > 0],
        key=lambda s: -s.n_negative,
    )

    # Bullet 1: Top concern with priority tag + calibrated recommendation
    if neg_ranked:
        top = neg_ranked[0]
        priority = compute_priority(top, data.n_reviews)
        label = _ko_short_label(top.attribute)
        pct = top.n_negative / data.n_reviews * 100 if data.n_reviews else 0
        recommendation = PRIORITY_RECOMMENDATION_KO.get(priority, "모니터링 권장")
        bullets.append(
            f"**[우선순위: {priority}]** **{label}** 관련 부정 의견이 "
            f"{top.n_negative}건 ({pct:.0f}%)으로 가장 많습니다. 평균 심각도 "
            f"{top.avg_intensity_neg:.1f}/3 - {recommendation}."
        )

    # Bullet 2: Second concern (if exists and meaningfully different)
    if len(neg_ranked) >= 2:
        second = neg_ranked[1]
        priority = compute_priority(second, data.n_reviews)
        label = _ko_short_label(second.attribute)
        pct = second.n_negative / data.n_reviews * 100 if data.n_reviews else 0
        if pct >= 15:
            recommendation = PRIORITY_RECOMMENDATION_KO.get(priority, "모니터링 권장")
            bullets.append(
                f"**[우선순위: {priority}]** **{label}** 부정 의견 "
                f"{second.n_negative}건 ({pct:.0f}%) - {recommendation}."
            )

    # Bullet 3: Mixed-feedback ratio + interpretation
    mixed_pct = data.n_mixed_reviews / data.n_reviews * 100 if data.n_reviews else 0
    if data.n_reviews >= 5 and mixed_pct >= 40:
        bullets.append(
            f"**혼합 평가** {data.n_mixed_reviews}건 ({mixed_pct:.0f}%) - "
            f"긍정/부정이 공존하는 리뷰가 다수입니다. 재구매 가능성이 있는 "
            f"고객층이며, 부정 요소만 해결되면 강한 옹호자로 전환 가능."
        )
    elif data.n_reviews >= 5 and mixed_pct >= 20:
        bullets.append(
            f"**혼합 평가** {data.n_mixed_reviews}건 ({mixed_pct:.0f}%) - "
            f"전반적으로 긍정 우세이나 일부 우려사항 동반."
        )

    # Bullet 4: Trade-off insight
    if data.n_with_tradeoff >= 3:
        bullets.append(
            f"**트레이드오프** {data.n_with_tradeoff}건 - 한 속성을 개선하면 "
            f"다른 속성에 영향을 줄 수 있는 명시적 트레이드오프가 다수 발견됨. "
            f"§4 참조."
        )

    # Delivery / QC alert
    if data.delivery_condition_records_total >= 2:
        bullets.append(
            f"**유통/QC 점검 필요** {data.delivery_condition_records_total}건 - "
            f"제품 자체 결함이 아닌 배송/검수 단계 이슈로 분류됨. 별도 점검 권장."
        )

    return bullets[:4]


def render_markdown_v2(data: ProductReportData, *, source_label: str = "pipeline") -> str:
    """v2 markdown renderer - concise, Korean-first, manufacturer-facing.

    Sections:
      1. 핵심 요약 (Executive summary, actionable bullets)
      2. 주요 우려사항 (Top concerns table with priority)
      3. 평가 분포 (Polarity distribution overview)
      4. 트레이드오프 (Trade-offs)
      5. 대표 평가 (Evidence - max 2-3 per attribute)
      6. 분석 방법 (Methodology - 1 paragraph)
    """
    lines: list[str] = []
    p = lines.append

    p(f"# {data.product_name}")
    p(f"### VOC 분석 리포트")
    p("")
    p(f"**제품 ID**: {data.product_id}  |  **분석 리뷰 수**: {data.n_reviews}건  |  **속성 레코드 수**: {data.n_records}")
    p("")
    p("---")
    p("")

    # 1. Executive summary - actionable bullets
    p("## 1. 핵심 요약")
    p("")
    bullets = build_actionable_summary_ko(data)
    if bullets:
        for b in bullets:
            p(f"- {b}")
    else:
        p("- _긍정 우세, 우선 검토 필요 사항 없음._")
    p("")

    # 2. Top concerns table with priority
    p("## 2. 주요 우려사항 (Top 우선 검토)")
    p("")
    neg_ranked = sorted(
        [s for s in data.attribute_summaries.values() if s.n_negative > 0],
        key=lambda s: -s.n_negative,
    )
    if not neg_ranked:
        p("_부정 의견 없음._")
    else:
        p("| # | 속성 | 부정 리뷰 % | 심각도 (1-3) | 우선순위 |")
        p("|---:|---|---:|---:|:-:|")
        for i, s in enumerate(neg_ranked[:8], 1):
            label = _ko_short_label(s.attribute)
            pct = s.n_negative / data.n_reviews * 100 if data.n_reviews else 0
            priority = compute_priority(s, data.n_reviews)
            p(f"| {i} | {label} | {pct:.0f}% ({s.n_negative}/{data.n_reviews}) | {s.avg_intensity_neg:.1f} | **{priority}** |")
    p("")

    # 3. Polarity distribution
    p("## 3. 속성별 평가 분포")
    p("")
    p("주요 속성에 대한 긍정/부정/혼합 의견 분포:")
    p("")
    pdist = chart_data_polarity_distribution(data, top_n=6)
    if pdist["labels"]:
        p("| 속성 | 긍정 | 약한 부정 | 강한 부정 | 혼합 |")
        p("|---|---:|---:|---:|---:|")
        for i, lbl in enumerate(pdist["labels"]):
            p(f"| {lbl} | {pdist['positive'][i]} | {pdist['negative_weak'][i]} | {pdist['negative_strong'][i]} | {pdist['mixed'][i]} |")
    p("")
    p("> 차트 시각화는 PDF 버전 §3 참조.")
    p("")

    # 4. Trade-offs
    p("## 4. 트레이드오프")
    p("")
    if data.tradeoff_pairs:
        p(f"**총 {data.n_with_tradeoff}건**의 명시적 트레이드오프가 발견되었습니다.")
        p("")
        p("| 트레이드오프 (긍정 → 양보된 속성) | 건수 |")
        p("|---|---:|")
        for pair, n in data.tradeoff_pairs.most_common(6):
            pretty = pair
            for raw, label in ATTRIBUTE_LABELS_KO.items():
                short = label.split("(")[0].strip()
                pretty = pretty.replace(raw + ":", short + ":")
            pretty = pretty.replace("->", "→")
            p(f"| {pretty} | {n} |")
        p("")
        p("> *해석*: A → B 형태는 \"A 속성을 칭찬하면서 B 속성에서는 양보한다\"는 의미입니다. 한 쪽을 개선하려는 노력이 다른 쪽에 영향을 줄 수 있습니다.")
    else:
        p("_명시적 트레이드오프 없음._")
    p("")

    # 5. Evidence - max 2-3 per attribute
    p("## 5. 대표 리뷰 발췌")
    p("")
    p("_각 우려사항당 최대 2-3건의 대표 평가를 발췌했습니다._")
    p("")
    for s in neg_ranked[:4]:
        if s.n_negative == 0:
            continue
        label = _ko_short_label(s.attribute)
        priority = compute_priority(s, data.n_reviews)
        p(f"### {label} - 우선순위 {priority}")
        p("")
        evidence = select_evidence(s, n=3, prefer_diverse=True)
        if not evidence:
            p("_evidence 없음._")
        for ex in evidence:
            ev = ex["evidence_span"]
            severity_marker = "★" * (ex.get("intensity") or 1)
            conf = ex.get("confidence", "?")
            delivery = " 📦" if ex.get("delivery_condition_flag") else ""
            p(f"- > {ev}")
            p(f"  ↳ 심각도 {severity_marker} | 신뢰도: {conf}{delivery}")
        p("")

    # 6. Methodology - concise paragraph
    p("## 6. 분석 방법")
    p("")
    p(
        f"본 리포트는 OliveYoung에서 수집한 **{data.n_reviews}건**의 리뷰를 "
        f"AI 파이프라인으로 분석한 결과입니다. 각 리뷰에서 12개 속성 "
        f"(발색, 지속력, 발림성, 베이스 상호작용, 마무리감, 건조감, 색/톤 매칭, "
        f"외부 용기, 도구, 가격, 립앤치크 호환성, 마스크/옷 묻어남 저항)을 "
        f"추출하고 긍정/부정/혼합 의견을 분류했습니다. "
        f"리뷰 단위 통찰 정확도는 약 87.5% 수준으로 검증되었으며, 개별 평가의 "
        f"세부 분류 정확도는 약 71%입니다. 본 리포트의 결론은 **방향성**으로 "
        f"해석해 주시고, 절대 수치보다 패턴에 집중해 주십시오. "
        f"분석 데이터: **{source_label}**."
    )
    p("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Markdown rendering
# ---------------------------------------------------------------------------


def render_markdown(data: ProductReportData, *, source_label: str = "pipeline") -> str:
    """Render a manufacturer-facing markdown report from `data`.

    `source_label` is included in the methodology footer for transparency
    (e.g., "human-annotated seed v0.2", "Phase 2E pipeline E2E output").
    """
    lines: list[str] = []
    p = lines.append

    p(f"# VOC Insight Report - {data.product_name}")
    p("")
    p(f"**Product ID**: `{data.product_id}`  |  **Reviews analyzed**: {data.n_reviews}  |  **Attribute records**: {data.n_records}")
    p("")
    p("---")
    p("")

    # 1. Executive summary
    p("## 1. Executive summary")
    p("")
    neg_attrs_ranked = sorted(
        data.attribute_summaries.values(),
        key=lambda s: (-s.n_negative, -s.avg_intensity_neg),
    )
    top_neg = [s for s in neg_attrs_ranked if s.n_negative > 0][:3]
    if top_neg:
        p("**Top reviewer concerns** (most-mentioned negative attributes):")
        p("")
        for s in top_neg:
            label = ATTRIBUTE_LABELS_KO.get(s.attribute, s.attribute)
            p(f"- **{label}** - {s.n_negative} of {data.n_reviews} reviews ({s.n_negative / data.n_reviews * 100:.0f}%) raised concerns. Avg severity: {s.avg_intensity_neg:.1f}/3. Confidence: **{_confidence_label(s)}**.")
        p("")

    p(f"**Mixed-feedback reviews**: {data.n_mixed_reviews} of {data.n_reviews} ({data.n_mixed_reviews / data.n_reviews * 100:.0f}%) include both praise and concern. These reviewers are likely repeat customers worth engaging.")
    p("")
    if data.n_with_tradeoff:
        p(f"**Trade-off patterns detected**: {data.n_with_tradeoff} reviews show explicit trade-offs (positive on one attribute, conceded negative on another).")
        p("")
    if data.delivery_condition_records_total:
        p(f"**Delivery / QC alerts**: {data.delivery_condition_records_total} records flagged as specimen-condition complaints (not product-design defects). These warrant a separate logistics review.")
        p("")

    p("---")
    p("")

    # 2. Top negative attributes (ranked detail)
    p("## 2. Top reviewer concerns (ranked)")
    p("")
    if not top_neg:
        p("_No negative-attribute records detected on this product._")
    else:
        p("| rank | attribute | negative records | % of reviews | avg severity (1-3) | confidence |")
        p("|---:|---|---:|---:|---:|---|")
        for i, s in enumerate(neg_attrs_ranked[:10], 1):
            if s.n_negative == 0:
                continue
            label = ATTRIBUTE_LABELS_KO.get(s.attribute, s.attribute)
            p(f"| {i} | {label} | {s.n_negative} | {s.n_negative / data.n_reviews * 100:.0f}% | {s.avg_intensity_neg:.1f} | {_confidence_label(s)} |")
    p("")

    # 3. Mixed-review patterns
    p("## 3. Mixed-review patterns")
    p("")
    p(f"**{data.n_mixed_reviews} of {data.n_reviews} reviews** carry both positive and negative attribute mentions ({data.n_mixed_reviews / data.n_reviews * 100:.0f}% of reviews).")
    p("")
    if data.mixed_attribute_pairs:
        p("**Most-common attribute pairs** appearing on opposite polarities within the same review:")
        p("")
        p("| positive ↔ negative attribute pair | reviews |")
        p("|---|---:|")
        for a, b, n in data.mixed_attribute_pairs[:8]:
            la = ATTRIBUTE_LABELS_KO.get(a, a).split("(")[0].strip()
            lb = ATTRIBUTE_LABELS_KO.get(b, b).split("(")[0].strip()
            p(f"| {la} ↔ {lb} | {n} |")
        p("")
    else:
        p("_No mixed-attribute review patterns detected on this corpus._")
        p("")

    # 4. Trade-off insights
    p("## 4. Trade-off insights")
    p("")
    if data.tradeoff_pairs:
        p("Reviewers explicitly trade one attribute for another. The pipeline identified these explicit trade-off statements:")
        p("")
        p("| trade-off (positive → conceded) | count |")
        p("|---|---:|")
        for pair, n in data.tradeoff_pairs.most_common(8):
            # Pretty-format pair
            pretty = pair.replace("->", "→")
            for raw, label in ATTRIBUTE_LABELS_KO.items():
                short = label.split("(")[0].strip()
                pretty = pretty.replace(raw + ":", short + ":")
            p(f"| `{pretty}` | {n} |")
        p("")
        p("> *How to read*: \"finish_texture:positive → transfer_resistance:negative_weak\" means reviewers praise the finish (e.g., glow / 촉촉) but accept some transfer to mask/clothing as a cost.")
        p("")
    else:
        p("_No explicit trade-off statements detected on this corpus._")
        p("")

    # 5. Example evidence (verbatim review excerpts)
    p("## 5. Example evidence")
    p("")
    p("Verbatim Korean excerpts from real reviews. Each is annotated with its attribute polarity and the pipeline's confidence rating.")
    p("")

    p("### 5.1 Top reviewer concerns (negative excerpts)")
    p("")
    for s in top_neg:
        if not s.sample_evidences_neg:
            continue
        label = ATTRIBUTE_LABELS_KO.get(s.attribute, s.attribute)
        p(f"**{label}** - {s.n_negative} reviews")
        p("")
        for ex in s.sample_evidences_neg[:5]:
            ev = ex["evidence_span"]
            pol_label = POLARITY_LABELS.get(ex["polarity"], ex["polarity"])
            intensity = ex.get("intensity", "?")
            conf = ex.get("confidence", "?")
            delivery = " 📦 (delivery condition)" if ex.get("delivery_condition_flag") else ""
            p(f"- > `{ev}` - *{pol_label}*, severity {intensity}/3, confidence: {conf}{delivery}")
        p("")

    # Top positive (1-2 attributes for balance)
    pos_attrs_ranked = sorted(
        data.attribute_summaries.values(),
        key=lambda s: -s.n_positive,
    )
    top_pos = [s for s in pos_attrs_ranked if s.n_positive > 0][:3]
    if top_pos:
        p("### 5.2 Praised attributes (positive excerpts)")
        p("")
        for s in top_pos:
            if not s.sample_evidences_pos:
                continue
            label = ATTRIBUTE_LABELS_KO.get(s.attribute, s.attribute)
            p(f"**{label}** - {s.n_positive} reviews")
            p("")
            for ex in s.sample_evidences_pos[:3]:
                ev = ex["evidence_span"]
                pol_label = POLARITY_LABELS.get(ex["polarity"], ex["polarity"])
                conf = ex.get("confidence", "?")
                p(f"- > `{ev}` - *{pol_label}*, confidence: {conf}")
            p("")

    # 6. Confidence overview
    p("## 6. Confidence overview")
    p("")
    p("Per-attribute confidence distribution from the pipeline's polarity classifier:")
    p("")
    p("| attribute | high | medium | low | total | aggregate confidence |")
    p("|---|---:|---:|---:|---:|---|")
    sig_attrs = sorted(
        [s for s in data.attribute_summaries.values() if s.n_total > 0],
        key=lambda s: -s.n_total,
    )
    for s in sig_attrs:
        h = s.confidence_dist.get("high", 0)
        m = s.confidence_dist.get("medium", 0)
        l_ = s.confidence_dist.get("low", 0)
        label = ATTRIBUTE_LABELS_KO.get(s.attribute, s.attribute)
        p(f"| {label} | {h} | {m} | {l_} | {s.n_total} | {_confidence_label(s)} |")
    p("")

    # 7. Methodology
    p("## 7. Methodology")
    p("")
    p(f"- **Source**: {source_label}")
    p("- **Pipeline**: Phase 2E end-to-end")
    p("  - Stage 1 (deterministic): Korean morphology-aware attribute candidate extraction")
    p("  - Stage 2 (LLM polarity classification): GPT-4o-mini scoped to single-attribute polarity decisions")
    p("  - Stage 3 (deterministic): review-level aggregation (mixed-review flag, cross-attribute trade-off detection)")
    p("- **Schema**: 12 attribute taxonomy with 6 polarity values + 3 intensity levels (see `docs/phase2e_attribute_polarity_schema_plan.md` v0.2)")
    p("- **Confidence**: per-record confidence emitted by the polarity classifier; aggregate confidence per attribute combines sample size + confidence distribution")
    p("- **Evidence excerpts**: verbatim Korean text from the reviewer; review IDs truncated to 12 chars")
    p("")
    p("**Limitations**:")
    p("- Polarity classification is LLM-based; per-record polarity accuracy on a held-out test set is ~71-77% (full pipeline).")
    p("- Review-level insight accuracy (does the system correctly identify negative content presence?) is **87.5%** - significantly higher than per-record accuracy because Stage 3 aggregation absorbs noise.")
    p("- Sample size on this corpus is small; statistical claims should be treated as directional, not definitive.")
    p("- The pipeline does NOT distinguish design defects from delivery-condition complaints unless the `delivery_condition_flag` is set per-record. Logistics-side issues are flagged separately in §1.")
    p("")

    return "\n".join(lines)
