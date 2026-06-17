"""Build the worklist-first report model from classified reviews.

The primary artifact is the operator worklist — "이번 주 운영자가 볼 리뷰". Header
stats are intentionally short; the per-category breakdown is deferred to a later
slice.
"""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime

from src.voc.review_ops.industrial.classify import classify
from src.voc.review_ops.industrial.schema import (
    HeaderStats,
    IndustrialReport,
    IndustrialReview,
    WorklistRow,
)
from src.voc.review_ops.industrial.taxonomy import (
    CATEGORY_BY_ID,
    SEVERITY,
    WORKLIST_FORCING_KINDS,
)

DEFAULT_TITLE = "산업자재 리뷰 운영 점검 (샘플)"
DEFAULT_SUBTITLE = "여러 채널 리뷰를 한곳에 모아, 이번 주 운영자가 먼저 확인할 리뷰를 정리한 샘플입니다."
DEFAULT_CAVEAT = "키워드 기반으로 우선 분류한 결과입니다. 실제 운영 데이터와 다를 수 있어 확인용으로 봐주세요."
SAMPLE_DENSITY_NOTE = (
    "이 샘플은 점검 흐름을 보여주기 위해 문제 리뷰를 일부러 많이 담았습니다. "
    "실제 데이터에서는 비율이 달라질 수 있습니다."
)

RECENT_DAYS = 7
LOW_RATING_THRESHOLD = 3.0  # rating <= this counts as low (worklist inclusion)
TODAY_RATING_THRESHOLD = 2.0  # rating <= this lands in the "오늘 먼저 볼 리뷰" tier

# Tags that push a review into the same-day tier regardless of rating.
TODAY_TIER_TAGS: frozenset[str] = frozenset(
    {
        "needs_reply",
        "delivery_packaging_damage",
        "missing_or_wrong_components",
        "cs_exchange_return_issue",
    }
)


def _rating_bucket(rating: float | None) -> str:
    if rating is None:
        return "미상"
    return str(int(round(rating)))


def _header_stats(reviews: list[IndustrialReview]) -> HeaderStats:
    by_channel = Counter(r.channel for r in reviews)
    dist = Counter(_rating_bucket(r.rating) for r in reviews)
    # stable ordering: channels by count desc; ratings 5..1 then 미상
    ordered_channels = dict(by_channel.most_common())
    ordered_dist = {b: dist[b] for b in ("5", "4", "3", "2", "1", "미상") if b in dist}
    return HeaderStats(
        total_reviews=len(reviews),
        by_channel=ordered_channels,
        rating_distribution=ordered_dist,
        date_unknown_count=sum(1 for r in reviews if r.review_date is None),
        rating_unknown_count=sum(1 for r in reviews if r.rating is None),
    )


def _is_recent(review_date: date | None, today: date, recent_days: int = RECENT_DAYS) -> bool:
    # Unknown dates are NOT treated as recent: a review whose date could not be
    # parsed must not be presented as this-week work just because it carries a
    # risk/operational tag. It stays in the appendix and is counted in the
    # date_unknown diagnostic instead.
    if review_date is None:
        return False
    return 0 <= (today - review_date).days <= recent_days


def _is_low_rating(rating: float | None) -> bool:
    return rating is not None and rating <= LOW_RATING_THRESHOLD


def _tier_for(rating: float | None, tags: list[str]) -> str:
    """Same-day vs this-week. Deterministic, no scoring model."""
    if rating is not None and rating <= TODAY_RATING_THRESHOLD:
        return "today"
    if any(t in TODAY_TIER_TAGS for t in tags):
        return "today"
    return "week"


def _context_prefix(rating: float | None, tags: list[str], primary: str | None) -> str:
    """Light, grammar-safe context shown before the reason (e.g. '(1점 · 미답변) ')."""
    bits: list[str] = []
    if rating is not None and rating <= TODAY_RATING_THRESHOLD:
        bits.append(f"{rating:g}점")
    # 'needs_reply' is only tagged when unanswered (classify drops it otherwise).
    if "needs_reply" in tags and primary != "needs_reply":
        bits.append("미답변")
    return f"({' · '.join(bits)}) " if bits else ""


def _build_row(review: IndustrialReview, tags: list[str]) -> WorklistRow:
    forcing = [t for t in tags if CATEGORY_BY_ID[t].kind in WORKLIST_FORCING_KINDS]
    primary: str | None = None
    if forcing:
        primary = max(forcing, key=lambda t: SEVERITY[CATEGORY_BY_ID[t].kind])
        cat = CATEGORY_BY_ID[primary]
        base_reason, action, severity = cat.reason, cat.suggested_action, SEVERITY[cat.kind]
    elif _is_low_rating(review.rating):
        base_reason = "평점이 낮아 내용 확인이 필요한 리뷰입니다."
        action = "리뷰 내용을 확인하고, 필요하면 답글로 안내하세요."
        severity = SEVERITY["operational"]
    else:  # included for some other reason; surface generically
        base_reason = "확인이 필요한 리뷰입니다."
        action = "리뷰 내용을 확인하세요."
        severity = SEVERITY["signal"]

    reason = _context_prefix(review.rating, tags, primary) + base_reason

    return WorklistRow(
        review_id=review.review_id,
        review_date=review.review_date,
        channel=review.channel,
        product_name=review.product_name,
        option_name=review.option_name,
        rating=review.rating,
        text=review.text,
        tags=tags,
        tag_labels=[CATEGORY_BY_ID[t].label_ko for t in tags],
        reason=reason,
        suggested_action=action,
        tier=_tier_for(review.rating, tags),
        _severity=severity,
    )


def build_report(
    reviews: list[IndustrialReview],
    *,
    today: date | None = None,
    recent_days: int = RECENT_DAYS,
    title: str = DEFAULT_TITLE,
    subtitle: str = DEFAULT_SUBTITLE,
    caveat: str = DEFAULT_CAVEAT,
    density_note: str | None = None,
    generated_at: datetime | None = None,
) -> IndustrialReport:
    """Assemble the worklist-first report from normalized, deduped reviews.

    Duplicates (``is_duplicate``) are excluded from stats, worklist, and
    appendix. ``today`` defaults to the latest review date in the corpus so a
    sample renders a stable worklist regardless of the wall-clock run date.
    ``recent_days`` controls the worklist recency window (default ``RECENT_DAYS``
    keeps existing behavior); a larger value surfaces older reviews as work.
    """
    active = [r for r in reviews if not r.is_duplicate]

    if today is None:
        known_dates = [r.review_date for r in active if r.review_date is not None]
        today = max(known_dates) if known_dates else date.today()

    worklist: list[WorklistRow] = []
    for review in active:
        tags = classify(review)
        forced = any(CATEGORY_BY_ID[t].kind in WORKLIST_FORCING_KINDS for t in tags)
        if _is_recent(review.review_date, today, recent_days) and (
            forced or _is_low_rating(review.rating)
        ):
            worklist.append(_build_row(review, tags))

    # Rank: severity desc, then lower rating first, then most recent first.
    worklist.sort(
        key=lambda row: (
            -row._severity,
            row.rating if row.rating is not None else 99,
            -(row.review_date.toordinal() if row.review_date else 0),
        )
    )

    appendix = sorted(
        active,
        key=lambda r: (r.review_date or date.min),
        reverse=True,
    )

    return IndustrialReport(
        title=title,
        subtitle=subtitle,
        caveat=caveat,
        density_note=density_note,
        generated_at=generated_at or datetime.now(),
        header=_header_stats(active),
        worklist=worklist,
        appendix=appendix,
    )
