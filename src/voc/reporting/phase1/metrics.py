"""Deterministic metrics layer for the Phase 1 mini-report.

Pure function: ``list[Phase1ReviewRow] → DeterministicMetrics``. No DB access,
no network, no model calls. Every field reported here must be derivable from
the rows alone so the numbers are reproducible from a frozen fixture.

Row shape expected: the dicts produced by
``Phase1ReviewRepository.query(...)`` — the JSON columns ``channel_meta``,
``derived`` and ``raw_metadata`` are already deserialized. Keys accessed:

    review_id, source_channel, product_external_id, language,
    rating_raw, review_date,
    channel_meta.photo_attached                  (coupang)
    raw_metadata.oy_has_photo                    (oliveyoung)
    raw_metadata.oy_review_type                  (oliveyoung)
    raw_metadata.oy_is_repurchase                (oliveyoung)
    derived.normalized_skin_type.bucket
    derived.normalized_age_group.bucket
    derived.normalized_product_option.shade

Any missing key is treated as ``None`` — rows are heterogeneous across
channels and across ingest eras, so we never KeyError.
"""

from __future__ import annotations

from collections import Counter
from datetime import date
from typing import Any, Iterable

from src.voc.reporting.phase1.schema import (
    ChannelSignals,
    DeterministicMetrics,
    DominantProduct,
    ProductMetrics,
    RatingMetrics,
    SegmentMetrics,
    ShadeCount,
    TimeWindow,
    TriStateCount,
)

Row = dict[str, Any]


# Rounding policy: 4 decimals for ratios and averages. Enough precision for
# operator reports; stable enough for golden-fixture assertions.
_PRECISION = 4


def compute_metrics(rows: Iterable[Row]) -> DeterministicMetrics:
    rows = list(rows)
    total = len(rows)

    channels = _count_by(rows, lambda r: r.get("source_channel"))
    languages = _count_by(rows, lambda r: r.get("language"))
    rating = _rating_metrics(rows)
    window = _time_window(rows)
    per_product = _per_product(rows, total)
    dominant = _dominant_product(per_product, total)
    segments = _segments(rows)
    channel_sig = _channel_signals(rows)

    return DeterministicMetrics(
        total_reviews=total,
        n_products=len(per_product),
        channels=channels,
        languages=languages,
        rating=rating,
        time_window=window,
        per_product=per_product,
        dominant_product=dominant,
        segments=segments,
        channel_signals=channel_sig,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _count_by(rows: list[Row], key) -> dict[str, int]:
    c: Counter[str] = Counter()
    for r in rows:
        v = key(r)
        if v is not None:
            c[str(v)] += 1
    return dict(sorted(c.items()))


def _rating_metrics(rows: list[Row]) -> RatingMetrics:
    raws = [r["rating_raw"] for r in rows if r.get("rating_raw") is not None]
    n = len(raws)
    missing = len(rows) - n
    if n == 0:
        return RatingMetrics(n=0, missing=missing, avg_raw=None, distribution_raw={})
    avg = round(sum(raws) / n, _PRECISION)
    dist = dict(sorted(Counter(int(round(x)) for x in raws).items()))
    return RatingMetrics(n=n, missing=missing, avg_raw=avg, distribution_raw=dist)


def _time_window(rows: list[Row]) -> TimeWindow:
    dates: list[date] = []
    missing = 0
    for r in rows:
        s = r.get("review_date")
        if not s:
            missing += 1
            continue
        try:
            dates.append(date.fromisoformat(s))
        except ValueError:
            missing += 1
    if not dates:
        return TimeWindow(start_date=None, end_date=None, days_span=None, missing_dates=missing)
    start, end = min(dates), max(dates)
    return TimeWindow(
        start_date=start,
        end_date=end,
        days_span=(end - start).days + 1,
        missing_dates=missing,
    )


def _per_product(rows: list[Row], total: int) -> list[ProductMetrics]:
    """One ``ProductMetrics`` per (product_external_id, channel) pair.

    Rows without a ``product_external_id`` are dropped from per-product
    breakdown (they still count toward ``total_reviews``). Ordering: n_reviews
    desc, then product_id asc for determinism.
    """
    groups: dict[tuple[str, str], list[Row]] = {}
    for r in rows:
        pid = r.get("product_external_id")
        if not pid:
            continue
        key = (str(pid), str(r.get("source_channel") or ""))
        groups.setdefault(key, []).append(r)

    out: list[ProductMetrics] = []
    for (pid, channel), grp in groups.items():
        n = len(grp)
        pct = round(n / total, _PRECISION) if total else 0.0
        out.append(
            ProductMetrics(
                product_id=pid,
                channel=channel,
                display_label=None,
                n_reviews=n,
                pct_of_total=pct,
                rating=_rating_metrics(grp),
                shades=_shade_counts(grp),
            )
        )
    out.sort(key=lambda p: (-p.n_reviews, p.product_id))
    return out


def _shade_counts(rows: list[Row]) -> list[ShadeCount]:
    c: Counter[str] = Counter()
    for r in rows:
        shade = _dig(r, "derived", "normalized_product_option", "shade")
        if shade:
            c[str(shade)] += 1
    pairs = sorted(c.items(), key=lambda kv: (-kv[1], kv[0]))
    return [ShadeCount(shade=s, n=n) for s, n in pairs]


def _dominant_product(per_product: list[ProductMetrics], total: int) -> DominantProduct | None:
    if not per_product:
        return None
    top = per_product[0]  # already sorted: n desc, product_id asc
    return DominantProduct(
        product_id=top.product_id,
        channel=top.channel,
        n_reviews=top.n_reviews,
        pct_of_total=round(top.n_reviews / total, _PRECISION) if total else 0.0,
    )


def _segments(rows: list[Row]) -> SegmentMetrics:
    skin: Counter[str] = Counter()
    age: Counter[str] = Counter()
    for r in rows:
        b = _dig(r, "derived", "normalized_skin_type", "bucket")
        if b:
            skin[str(b)] += 1
        b = _dig(r, "derived", "normalized_age_group", "bucket")
        if b:
            age[str(b)] += 1
    return SegmentMetrics(
        normalized_skin_type=dict(sorted(skin.items())),
        normalized_age_group=dict(sorted(age.items())),
    )


def _channel_signals(rows: list[Row]) -> ChannelSignals:
    photo_cp = _tristate(rows, lambda r: _dig(r, "channel_meta", "photo_attached"),
                         channel="coupang")
    photo_oy = _tristate(rows, lambda r: _dig(r, "raw_metadata", "oy_has_photo"),
                         channel="oliveyoung")
    is_rep = _tristate(rows, lambda r: _dig(r, "raw_metadata", "oy_is_repurchase"),
                       channel="oliveyoung")
    rt_counts: Counter[str] = Counter()
    for r in rows:
        if r.get("source_channel") != "oliveyoung":
            continue
        v = _dig(r, "raw_metadata", "oy_review_type")
        if v:
            rt_counts[str(v)] += 1
    return ChannelSignals(
        photo_attached=photo_cp,
        oy_has_photo=photo_oy,
        oy_review_type=dict(sorted(rt_counts.items())) if rt_counts else None,
        oy_is_repurchase=is_rep,
    )


def _tristate(rows: list[Row], key, *, channel: str) -> TriStateCount | None:
    """Count True/False/missing for a per-channel boolean.

    Returns ``None`` when no row of the target channel is present, so the
    resulting ``ChannelSignals`` field stays ``None`` instead of reporting
    0/0/0 for a channel that simply wasn't in the run.
    """
    scoped = [r for r in rows if r.get("source_channel") == channel]
    if not scoped:
        return None
    t = f = m = 0
    for r in scoped:
        v = key(r)
        if v is True:
            t += 1
        elif v is False:
            f += 1
        else:
            m += 1
    return TriStateCount(true=t, false=f, missing=m)


def _dig(d: Any, *path: str) -> Any:
    cur = d
    for p in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(p)
    return cur
