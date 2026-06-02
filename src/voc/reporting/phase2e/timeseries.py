"""Phase 2E Stage 4 — time-series VOC analysis (deterministic).

Operates on the per-review pipeline output (Stage 1 + Stage 2 + Stage 3) plus
the review_date from `phase1_reviews`. Computes:

  - Monthly aggregation: review count + per-attribute polarity counts
  - Attribute trends: increasing / decreasing / stable based on
    first-half vs last-half negative-mention rate
  - Spike detection: months where an attribute's negative rate jumps
    significantly above its trailing baseline

Charts (matplotlib):
  - Monthly review-volume line chart
  - Top-N attribute negative-rate trend lines

This module is OUTSIDE the v1.13 chain. No detector changes, no DB writes,
no LLM. Pure aggregation + chart rendering.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from collections import defaultdict
from pathlib import Path
from typing import Iterable

import matplotlib
matplotlib.use("Agg")  # headless
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib import font_manager
from datetime import datetime


# Configure matplotlib Korean font (idempotent)
def _ensure_korean_font() -> str | None:
    for candidate in ("NanumGothic", "AppleGothic", "NanumSquareRound"):
        if any(f.name == candidate for f in font_manager.fontManager.ttflist):
            plt.rcParams["font.family"] = candidate
            plt.rcParams["axes.unicode_minus"] = False
            return candidate
    return None


_KOREAN_FONT = _ensure_korean_font()


NEGATIVE_LIKE = ("negative_weak", "negative_strong", "mixed")
POSITIVE_LIKE = ("positive", "mixed")


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class MonthlyBucket:
    month: str  # "YYYY-MM"
    n_reviews: int
    n_records: int
    # per-attribute counts: attr -> dict with keys n_total, n_pos, n_neg
    per_attribute: dict[str, dict] = field(default_factory=dict)

    def neg_rate(self, attribute: str) -> float:
        a = self.per_attribute.get(attribute)
        if not a or self.n_reviews == 0:
            return 0.0
        return a["n_neg"] / self.n_reviews


@dataclass(frozen=True)
class AttributeTrend:
    attribute: str
    direction: str  # 'increasing', 'decreasing', 'stable', 'insufficient_data'
    first_period_rate: float  # negative rate in first half of months
    last_period_rate: float
    delta_pp: float  # last - first, in percentage points
    total_negative: int  # total negative records over all months


@dataclass(frozen=True)
class Spike:
    attribute: str
    month: str
    current_rate: float
    baseline_rate: float  # trailing 3-month avg (excluding current)
    relative_jump_pp: float  # current_rate - baseline_rate, in percentage points


@dataclass
class TimeseriesAnalysis:
    n_months: int
    monthly_buckets: list[MonthlyBucket]
    trends: list[AttributeTrend]
    spikes: list[Spike]
    has_sufficient_data: bool   # True iff n_months >= 3
    earliest_month: str | None
    latest_month: str | None
    # Confidence guard: True if data is too thin to make definitive trend
    # claims. Triggered when n_months < 6 OR any month has < 3 reviews
    # OR the median monthly review count is < 5. The renderer uses this
    # to soften trend wording (label as "초기 관찰" rather than "주요 추세").
    is_early_observation: bool = False
    early_observation_reason: str = ""


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------


def _parse_month(date_str: str | None) -> str | None:
    """Convert 'YYYY-MM-DD' (or similar) → 'YYYY-MM'. Returns None on parse failure."""
    if not date_str:
        return None
    try:
        d = datetime.fromisoformat(date_str[:10])
        return d.strftime("%Y-%m")
    except (ValueError, TypeError):
        return None


def aggregate_monthly(
    reviews: list[dict],
    review_dates: dict[str, str | None],
) -> list[MonthlyBucket]:
    """Build monthly buckets from per-review records.

    `reviews`: list of {review_id, records: [...]} (matches report.py input)
    `review_dates`: {review_id: 'YYYY-MM-DD'} (typically fetched from DB)

    Reviews without a parseable date are skipped (no silent insertion into a
    fake bucket).

    Returns buckets sorted by month ascending.
    """
    buckets: dict[str, MonthlyBucket] = {}
    for review in reviews:
        rid = review.get("review_id")
        date_str = review_dates.get(rid)
        month = _parse_month(date_str)
        if not month:
            continue
        if month not in buckets:
            buckets[month] = MonthlyBucket(month=month, n_reviews=0, n_records=0)
        b = buckets[month]
        b.n_reviews += 1
        for rec in review.get("records", []):
            b.n_records += 1
            attr = rec["attribute"]
            polarity = rec.get("polarity")
            if attr not in b.per_attribute:
                b.per_attribute[attr] = {"n_total": 0, "n_pos": 0, "n_neg": 0}
            slot = b.per_attribute[attr]
            slot["n_total"] += 1
            if polarity in POSITIVE_LIKE:
                slot["n_pos"] += 1
            if polarity in NEGATIVE_LIKE:
                slot["n_neg"] += 1
    return sorted(buckets.values(), key=lambda b: b.month)


# ---------------------------------------------------------------------------
# Trend detection
# ---------------------------------------------------------------------------


def detect_trends(buckets: list[MonthlyBucket], min_neg_total: int = 3) -> list[AttributeTrend]:
    """Per-attribute trend analysis: first-half vs last-half negative-rate.

    Direction:
      - 'increasing' if delta_pp >= +5 pp
      - 'decreasing' if delta_pp <= -5 pp
      - 'stable' if -5 < delta_pp < +5
      - 'insufficient_data' if total_negative < min_neg_total or n_months < 3

    Returns trends sorted by absolute delta (largest changes first).
    """
    if len(buckets) < 3:
        # Insufficient data — return placeholder per attribute
        out = []
        all_attrs = {a for b in buckets for a in b.per_attribute}
        for attr in sorted(all_attrs):
            total_neg = sum(b.per_attribute.get(attr, {}).get("n_neg", 0) for b in buckets)
            out.append(AttributeTrend(
                attribute=attr, direction="insufficient_data",
                first_period_rate=0.0, last_period_rate=0.0,
                delta_pp=0.0, total_negative=total_neg,
            ))
        return out

    n = len(buckets)
    first_half = buckets[: n // 2]
    last_half = buckets[n - n // 2 :]
    all_attrs = {a for b in buckets for a in b.per_attribute}

    trends: list[AttributeTrend] = []
    for attr in sorted(all_attrs):
        first_neg_total = sum(b.per_attribute.get(attr, {}).get("n_neg", 0) for b in first_half)
        last_neg_total = sum(b.per_attribute.get(attr, {}).get("n_neg", 0) for b in last_half)
        first_n_reviews = sum(b.n_reviews for b in first_half) or 1
        last_n_reviews = sum(b.n_reviews for b in last_half) or 1
        first_rate = first_neg_total / first_n_reviews
        last_rate = last_neg_total / last_n_reviews
        delta_pp = (last_rate - first_rate) * 100
        total_neg = first_neg_total + last_neg_total

        if total_neg < min_neg_total:
            direction = "insufficient_data"
        elif delta_pp >= 5:
            direction = "increasing"
        elif delta_pp <= -5:
            direction = "decreasing"
        else:
            direction = "stable"

        trends.append(AttributeTrend(
            attribute=attr, direction=direction,
            first_period_rate=first_rate, last_period_rate=last_rate,
            delta_pp=delta_pp, total_negative=total_neg,
        ))

    # Sort by absolute delta (most-changed first), excluding insufficient_data
    trends.sort(key=lambda t: (t.direction == "insufficient_data", -abs(t.delta_pp)))
    return trends


# ---------------------------------------------------------------------------
# Spike detection
# ---------------------------------------------------------------------------


def detect_spikes(
    buckets: list[MonthlyBucket],
    min_baseline_months: int = 3,
    min_baseline_reviews: int = 3,
    min_current_reviews: int = 3,
    abs_jump_pp: float = 15.0,
    min_current_rate: float = 0.30,
) -> list[Spike]:
    """Detect months where an attribute's negative rate jumps above its
    trailing 3-month baseline.

    Tunables:
      - `abs_jump_pp`: minimum percentage-point jump above trailing baseline
      - `min_current_rate`: current month's negative rate must be ≥ this
      - `min_baseline_months`: trailing window size (excluding current)
      - `min_baseline_reviews`: trailing window must contain ≥ this many reviews
      - `min_current_reviews`: current month must have ≥ this many reviews

    Returns spikes sorted by `relative_jump_pp` descending.
    """
    spikes: list[Spike] = []
    if len(buckets) < min_baseline_months + 1:
        return spikes
    all_attrs = {a for b in buckets for a in b.per_attribute}
    for attr in sorted(all_attrs):
        for i in range(min_baseline_months, len(buckets)):
            current = buckets[i]
            if current.n_reviews < min_current_reviews:
                continue
            current_rate = current.neg_rate(attr)
            if current_rate < min_current_rate:
                continue
            window = buckets[max(0, i - min_baseline_months) : i]
            baseline_neg = sum(b.per_attribute.get(attr, {}).get("n_neg", 0) for b in window)
            baseline_n = sum(b.n_reviews for b in window)
            if baseline_n < min_baseline_reviews:
                continue
            baseline_rate = baseline_neg / baseline_n
            jump = (current_rate - baseline_rate) * 100
            if jump >= abs_jump_pp:
                spikes.append(Spike(
                    attribute=attr, month=current.month,
                    current_rate=current_rate, baseline_rate=baseline_rate,
                    relative_jump_pp=jump,
                ))
    spikes.sort(key=lambda s: -s.relative_jump_pp)
    return spikes


# ---------------------------------------------------------------------------
# Top-level analysis
# ---------------------------------------------------------------------------


def _classify_observation_confidence(buckets: list[MonthlyBucket]) -> tuple[bool, str]:
    """Return (is_early_observation, reason).

    'Early observation' triggers when:
      - n_months < 6, OR
      - any month has fewer than 3 reviews (sparse coverage), OR
      - median monthly volume < 5
    """
    if not buckets:
        return True, "데이터 없음"
    n = len(buckets)
    if n < 6:
        return True, f"관찰 기간이 짧음 ({n}개월; 6개월 미만)"
    counts = sorted(b.n_reviews for b in buckets)
    if counts[0] < 3:
        return True, f"일부 월의 리뷰 수가 매우 적음 (최소 {counts[0]}건)"
    median = counts[n // 2]
    if median < 5:
        return True, f"월별 리뷰 수의 중앙값이 작음 (median {median}건)"
    return False, ""


def analyze(
    reviews: list[dict],
    review_dates: dict[str, str | None],
) -> TimeseriesAnalysis:
    """One-call entry point. Returns a TimeseriesAnalysis."""
    buckets = aggregate_monthly(reviews, review_dates)
    trends = detect_trends(buckets)
    spikes = detect_spikes(buckets)
    is_early, reason = _classify_observation_confidence(buckets)
    return TimeseriesAnalysis(
        n_months=len(buckets),
        monthly_buckets=buckets,
        trends=trends,
        spikes=spikes,
        has_sufficient_data=len(buckets) >= 3,
        earliest_month=buckets[0].month if buckets else None,
        latest_month=buckets[-1].month if buckets else None,
        is_early_observation=is_early,
        early_observation_reason=reason,
    )


# ---------------------------------------------------------------------------
# Charts
# ---------------------------------------------------------------------------


def render_monthly_volume_chart(analysis: TimeseriesAnalysis, out_path: Path) -> bool:
    """Line chart of monthly review volume. Returns True if rendered."""
    if not analysis.monthly_buckets:
        return False
    months = [b.month for b in analysis.monthly_buckets]
    counts = [b.n_reviews for b in analysis.monthly_buckets]
    dates = [datetime.strptime(m, "%Y-%m") for m in months]

    fig, ax = plt.subplots(figsize=(7.0, 2.6), dpi=150)
    ax.plot(dates, counts, marker="o", color="#3a6ea5", linewidth=1.6, markersize=4)
    ax.fill_between(dates, counts, alpha=0.15, color="#3a6ea5")
    ax.set_title("월별 리뷰 수", fontsize=11, fontweight="bold")
    ax.set_ylabel("리뷰 건수", fontsize=9)
    ax.grid(True, axis="y", linestyle="--", alpha=0.4)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    # X-axis date formatting
    if len(dates) <= 18:
        ax.xaxis.set_major_locator(mdates.MonthLocator(interval=max(1, len(dates) // 8)))
    else:
        ax.xaxis.set_major_locator(mdates.MonthLocator(interval=6))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    plt.setp(ax.get_xticklabels(), rotation=30, ha="right", fontsize=8)
    plt.tight_layout()
    plt.savefig(out_path, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return True


_TREND_COLORS = ["#d9534f", "#f0ad4e", "#3a6ea5", "#5cb85c", "#9b59b6"]


def render_attribute_trend_chart(
    analysis: TimeseriesAnalysis, out_path: Path, top_n: int = 4,
    attribute_labeler=None,
) -> bool:
    """Multi-line chart: top-N attributes by total negative count, plotted
    as monthly negative rate over time. Returns True if rendered.
    """
    if not analysis.monthly_buckets:
        return False
    # Pick top-N attributes by total negative count across all months
    attr_totals: dict[str, int] = defaultdict(int)
    for b in analysis.monthly_buckets:
        for a, v in b.per_attribute.items():
            attr_totals[a] += v.get("n_neg", 0)
    top_attrs = [a for a, n in sorted(attr_totals.items(), key=lambda x: -x[1]) if n > 0][:top_n]
    if not top_attrs:
        return False

    months = [b.month for b in analysis.monthly_buckets]
    dates = [datetime.strptime(m, "%Y-%m") for m in months]

    fig, ax = plt.subplots(figsize=(7.0, 3.0), dpi=150)
    for i, attr in enumerate(top_attrs):
        rates = [b.neg_rate(attr) * 100 for b in analysis.monthly_buckets]
        label = attribute_labeler(attr) if attribute_labeler else attr
        ax.plot(dates, rates, marker="o", linewidth=1.4, markersize=3.5,
                color=_TREND_COLORS[i % len(_TREND_COLORS)], label=label)
    ax.set_title("주요 속성 부정 의견 비율 (월별)", fontsize=11, fontweight="bold")
    ax.set_ylabel("부정 비율 (%)", fontsize=9)
    ax.legend(loc="upper left", fontsize=8, frameon=False, ncol=2)
    ax.grid(True, axis="y", linestyle="--", alpha=0.4)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    if len(dates) <= 18:
        ax.xaxis.set_major_locator(mdates.MonthLocator(interval=max(1, len(dates) // 8)))
    else:
        ax.xaxis.set_major_locator(mdates.MonthLocator(interval=6))
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%Y-%m"))
    plt.setp(ax.get_xticklabels(), rotation=30, ha="right", fontsize=8)
    plt.tight_layout()
    plt.savefig(out_path, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return True
