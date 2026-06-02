"""Static chart rendering for Phase 1 reports (optional, off by default).

v1 scope: a single rating-distribution bar chart. Renders a PNG that the
narrative layer can embed under the 샘플 구성 section when the caller
opts in via ``--include-charts``. The main report pipeline (JSON + MD
without charts) runs without matplotlib; only this module imports it.

Design constraints:
  - Deterministic output: fixed figure size, fixed colors, headless
    backend (``Agg``). Same metrics input → same image bytes modulo
    matplotlib-version drift.
  - Minimal Korean-glyph dependency: we only render ASCII + star glyph
    (``★``), which most fonts carry. No sentence-level Korean on the
    chart itself — axis labels are star counts (``1★``–``5★``), value
    annotations are integers. This sidesteps the Hangul-font-fallback
    problem that bites on Linux CI without a system Korean font.
  - No legend, no title — the surrounding Markdown text is the caption.

Add as a dependency via ``pip install -e '.[charts]'``.
"""

from __future__ import annotations

from pathlib import Path

from src.voc.reporting.phase1.schema import (
    DeterministicMetrics,
    SignalCoverage,
    SignalsBundle,
)

# Fixed styling. Adjusting here changes every chart deterministically.
_FIGURE_SIZE_INCHES = (6.0, 2.6)
_FIGURE_DPI = 110
_BAR_COLOR = "#4b77be"           # restrained accent blue
_BAR_COLOR_ZERO = "#c9d3e0"      # muted grey for zero-count bars
_TEXT_COLOR = "#333333"
_BAR_HEIGHT = 0.6

_RATINGS_TOP_TO_BOTTOM = (5, 4, 3, 2, 1)  # 5★ at top in horizontal bar


# Korean font fallback chain. matplotlib's default sans-serif on macOS /
# Linux doesn't carry Hangul glyphs — labels render as tofu boxes without
# explicit configuration. Try fonts in plausibility order per platform;
# the first one present on the system is used. If none are found, we
# fall back to default (tofu) rather than crash — the chart still
# communicates via numbers.
_KOREAN_FONT_CANDIDATES = (
    "AppleGothic",            # macOS (default Korean)
    "Apple SD Gothic Neo",    # macOS (modern)
    "Malgun Gothic",          # Windows
    "NanumGothic",            # Linux (common via `apt install fonts-nanum`)
    "Noto Sans CJK KR",       # Linux (noto-cjk package)
    "Noto Sans KR",           # webfont-style name
)


def _configure_korean_font() -> None:
    """Set matplotlib's rcParams so Korean axis labels render with actual
    glyphs instead of tofu boxes. Must be called inside a chart render
    function AFTER matplotlib is imported (can't rely on module-load
    ordering when matplotlib is an optional dependency)."""
    import matplotlib
    from matplotlib import font_manager

    available = {f.name for f in font_manager.fontManager.ttflist}
    for candidate in _KOREAN_FONT_CANDIDATES:
        if candidate in available:
            matplotlib.rcParams["font.family"] = candidate
            # Avoid minus-sign glyph being rendered as a Korean-block box
            # in certain fonts.
            matplotlib.rcParams["axes.unicode_minus"] = False
            return
    # No Korean font found; leave default (labels render as tofu).
    # Don't raise — the numeric annotations still communicate.


def render_rating_distribution_bar(
    metrics: DeterministicMetrics,
    output_path: Path,
) -> Path:
    """Write a horizontal bar chart of the rating distribution.

    Horizontal layout chosen because (a) 1★–5★ sits naturally along a
    vertical axis, (b) count labels at bar ends fit the wide aspect
    ratio, (c) it matches the text-form distribution line in the
    report ("5★ N, 4★ N…") so the reader's mental model is preserved.

    Returns the output path on success. Raises ``ImportError`` with an
    install hint when matplotlib is not available.
    """
    try:
        import matplotlib
        matplotlib.use("Agg")  # headless; no display required
        import matplotlib.pyplot as plt
    except ImportError as e:
        raise ImportError(
            "charts.render_rating_distribution_bar requires matplotlib. "
            "Install with: pip install -e '.[charts]'"
        ) from e
    _configure_korean_font()

    dist = metrics.rating.distribution_raw or {}
    labels = [f"{r}★" for r in _RATINGS_TOP_TO_BOTTOM]
    counts = [int(dist.get(r, 0)) for r in _RATINGS_TOP_TO_BOTTOM]
    colors = [_BAR_COLOR if c > 0 else _BAR_COLOR_ZERO for c in counts]

    fig, ax = plt.subplots(figsize=_FIGURE_SIZE_INCHES, dpi=_FIGURE_DPI)
    ax.barh(labels, counts, color=colors, height=_BAR_HEIGHT)

    # Value labels at the end of each bar. Offset slightly from the bar
    # end so the text doesn't overlap the bar cap.
    max_count = max(counts) if counts else 1
    for i, count in enumerate(counts):
        if count > 0:
            ax.text(
                count + max_count * 0.015, i, str(count),
                va="center", ha="left",
                fontsize=9, color=_TEXT_COLOR,
            )

    # Minimal chrome: no top/right borders, no y-axis ticks.
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_visible(False)
    ax.tick_params(axis="y", length=0, labelsize=10, colors=_TEXT_COLOR)
    ax.tick_params(axis="x", colors=_TEXT_COLOR, labelsize=9)
    # 5★ on top, 1★ on bottom — matches natural reading order of the
    # accompanying text distribution line ("5★ N, 4★ N…").
    ax.invert_yaxis()
    # Bit of headroom on the right so value labels don't clip.
    ax.set_xlim(0, max_count * 1.15 if max_count else 1)

    fig.tight_layout(pad=0.3)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(
        output_path, format="png", dpi=_FIGURE_DPI,
        bbox_inches="tight", facecolor="white",
    )
    plt.close(fig)
    return output_path


# ---------------------------------------------------------------------------
# Coverage composition horizontal stacked bar
# ---------------------------------------------------------------------------


# One horizontal bar partitioned into five colored segments. Palette is a
# deliberately desaturated set — the point is to let counts do the talking,
# not to dazzle.
_COVERAGE_SEGMENT_ORDER: tuple[tuple[str, str, str], ...] = (
    # (SignalCoverage attribute, label, hex color)
    ("rows_with_no_signal", "신호 없음",      "#c9d3e0"),  # muted grey-blue
    ("positive_only",       "긍정만",         "#4b77be"),  # accent blue
    ("mixed",               "긍정+주의 혼합", "#845ec2"),  # muted purple
    ("cautionary_only",     "주의만",         "#f5a623"),  # amber
    ("gap_only",            "운영 신호만",    "#e07856"),  # muted red-orange
)
_COVERAGE_FIGURE_SIZE_INCHES = (7.2, 1.9)
_COVERAGE_BAR_HEIGHT = 0.55


def render_coverage_composition_bar(
    coverage: SignalCoverage,
    output_path: Path,
) -> Path:
    """Render a single horizontal stacked bar showing the 5-bucket
    coverage composition. Width is percent-of-total; each non-zero
    segment is labeled with its count.

    Raises ``ValueError`` when ``coverage.total_reviews == 0`` — a
    zero-row report has no composition to chart. Callers should
    suppress the embed in that case.
    """
    if coverage.total_reviews == 0:
        raise ValueError(
            "coverage.total_reviews == 0; nothing to chart"
        )

    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError as e:
        raise ImportError(
            "charts.render_coverage_composition_bar requires matplotlib. "
            "Install with: pip install -e '.[charts]'"
        ) from e
    _configure_korean_font()

    total = coverage.total_reviews
    # Build ordered list of (label, count, color) — only non-zero segments
    # contribute drawn width, but zero segments are still iterated for
    # deterministic output (they simply draw nothing).
    segments: list[tuple[str, int, str]] = [
        (label, getattr(coverage, attr), color)
        for attr, label, color in _COVERAGE_SEGMENT_ORDER
    ]

    fig, ax = plt.subplots(figsize=_COVERAGE_FIGURE_SIZE_INCHES, dpi=_FIGURE_DPI)
    left = 0
    for label, count, color in segments:
        if count <= 0:
            continue
        width = (count / total) * 100
        ax.barh(
            [""], [width], left=[left], color=color,
            height=_COVERAGE_BAR_HEIGHT,
        )
        # Label inside the segment if it's wide enough; else outside above.
        pct = count * 100 / total
        inside_label = f"{label}\n{count}건 ({pct:.1f}%)"
        if width > 12:  # wide enough to hold two-line label inline
            ax.text(
                left + width / 2, 0, inside_label,
                va="center", ha="center",
                fontsize=9, color="white" if _is_dark(color) else _TEXT_COLOR,
            )
        elif width > 4:  # medium — single-line inline, just count
            ax.text(
                left + width / 2, 0, f"{count}",
                va="center", ha="center",
                fontsize=9, color="white" if _is_dark(color) else _TEXT_COLOR,
            )
        else:  # too narrow — skip inline label; segment color alone signals presence
            pass
        left += width

    ax.set_xlim(0, 100)
    ax.set_ylim(-0.5, 0.5)
    ax.set_xlabel("전체 대비 비중 (%)", fontsize=9, color=_TEXT_COLOR)
    # Remove y-axis entirely (single bar).
    ax.yaxis.set_visible(False)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_visible(False)
    ax.tick_params(axis="x", colors=_TEXT_COLOR, labelsize=8)

    # Legend for segments not labeled inline (small ones).
    legend_entries: list = []
    for label, count, color in segments:
        if count <= 0:
            continue
        pct = count * 100 / total
        width = (count / total) * 100
        if width <= 12:  # these didn't get a full inline label
            legend_entries.append((label, count, pct, color))
    if legend_entries:
        import matplotlib.patches as mpatches
        handles = [
            mpatches.Patch(color=color, label=f"{label}: {count}건 ({pct:.1f}%)")
            for label, count, pct, color in legend_entries
        ]
        ax.legend(
            handles=handles, loc="lower left", bbox_to_anchor=(0, -1.5),
            frameon=False, fontsize=8, ncol=min(3, len(legend_entries)),
        )

    fig.tight_layout(pad=0.4)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(
        output_path, format="png", dpi=_FIGURE_DPI,
        bbox_inches="tight", facecolor="white",
    )
    plt.close(fig)
    return output_path


def _is_dark(hex_color: str) -> bool:
    """Rough luminance check — decides whether a segment's label should be
    white (on dark bars) or near-black (on light bars). Good enough for a
    fixed palette of 5."""
    try:
        hx = hex_color.lstrip("#")
        r, g, b = int(hx[0:2], 16), int(hx[2:4], 16), int(hx[4:6], 16)
        # Rec. 709 luma approximation
        luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
        return luma < 140
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Segment × signal heatmap
# ---------------------------------------------------------------------------


# Lift-banded color scale — matches the Korean concentration bands used in
# narrative.py (중간 / 뚜렷 / 매우 뚜렷). Below-2× (below surfacing floor)
# and zero-fires have their own colors so the reader can distinguish
# "weak mention" from "no mention at all".
_HEATMAP_NO_FIRE = "#f5f5f5"
_HEATMAP_BANDS: tuple[tuple[float, float, str, str], ...] = (
    (0.0, 2.0,         "#d7e4f0", "약한 (<2×)"),
    (2.0, 3.0,         "#9bbedd", "중간 (2–3×)"),
    (3.0, 5.0,         "#4b77be", "뚜렷 (3–5×)"),
    (5.0, float("inf"),"#234e86", "매우 뚜렷 (5×+)"),
)
_HEATMAP_FIG_BASE_WIDTH = 2.0
_HEATMAP_FIG_WIDTH_PER_SIGNAL = 0.85
_HEATMAP_FIG_HEIGHT_BASE = 3.2   # extra vertical room for rotated signal
                                  # labels + legend strip beneath the grid
_HEATMAP_FIG_HEIGHT_PER_SEG = 0.55
_HEATMAP_MIN_SEGMENT_SIZE = 10
# Match derived.py's MIN_EVIDENCE_IN_SEGMENT: cells with fewer hits than
# this are colored neutral, not by lift. Keeps the heatmap's visual
# story consistent with what the text portraits surface — avoids one-hit
# cells appearing as "매우 뚜렷한 집중" purely because their tiny signal
# base inflates the lift multiplier.
_HEATMAP_MIN_EVIDENCE_FOR_BAND = 2

# Local duplicate of narrative._SKIN_TYPE_KO to avoid importing across
# layers (charts is a leaf module).
_HEATMAP_SKIN_TYPE_KO = {
    "dry": "건성",
    "normal": "중성",
    "combination": "복합성",
    "oily": "지성",
    "sensitive": "민감성",
}


def _lift_to_color(lift: float, has_fires: bool) -> str:
    if not has_fires:
        return _HEATMAP_NO_FIRE
    for lo, hi, color, _ in _HEATMAP_BANDS:
        if lo <= lift < hi:
            return color
    return _HEATMAP_BANDS[-1][2]


def render_segment_signal_heatmap(
    rows: list[dict],
    signals: SignalsBundle,
    membership: dict[str, set[str]],
    output_path: Path,
) -> Path:
    """Draw a segment × signal heatmap for the matched-pair report.

    - Rows: skin-type segment buckets with ≥ MIN_SEGMENT_SIZE rows.
      Unknown / missing buckets excluded.
    - Columns: all signals (positive / cautionary / gap) that have at
      least one hit on any eligible segment.
    - Cells: hit count (integer), colored by lift vs overall signal rate
      using the same band thresholds as narrative.py.
    - Cells with zero hits use a muted neutral color.
    - Small legend strip below the grid explains the bands.

    Raises ``ValueError`` when fewer than 2 segments meet the size
    threshold, or when no signals fire on any eligible segment — the
    caller should suppress the embed in those cases.
    """
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import matplotlib.patches as mpatches
    except ImportError as e:
        raise ImportError(
            "charts.render_segment_signal_heatmap requires matplotlib. "
            "Install with: pip install -e '.[charts]'"
        ) from e
    _configure_korean_font()

    # ---- Pass 1: segment assignment per row ----
    # Deferred import of the segment-extractor keeps charts.py leaf-node.
    from src.voc.reporting.phase1.derived import _extract_segment_bucket

    seg_by_rid: dict[str, str] = {}
    for r in rows:
        rid = r.get("review_id")
        if not rid:
            continue
        bucket = _extract_segment_bucket(r, "normalized_skin_type")
        if bucket and bucket != "unknown":
            seg_by_rid[str(rid)] = bucket

    segment_sizes: dict[str, int] = {}
    for b in seg_by_rid.values():
        segment_sizes[b] = segment_sizes.get(b, 0) + 1

    eligible_buckets = [
        b for b, n in segment_sizes.items() if n >= _HEATMAP_MIN_SEGMENT_SIZE
    ]
    if len(eligible_buckets) < 2:
        raise ValueError(
            f"heatmap needs ≥2 segments with ≥{_HEATMAP_MIN_SEGMENT_SIZE} rows; "
            f"found {len(eligible_buckets)}"
        )
    # Sort by size desc for consistent row order (largest at top).
    eligible_buckets.sort(key=lambda b: (-segment_sizes[b], b))

    # ---- Pass 2: compute per-(segment, signal) counts and lifts ----
    total_rows = len(rows)
    all_signals = list(signals.positive) + list(signals.cautionary) + list(signals.gaps)
    signals_present: list = []
    counts: dict[tuple[str, str], int] = {}
    lifts: dict[tuple[str, str], float] = {}

    for sig in all_signals:
        sig_rids = membership.get(sig.name, set())
        if not sig_rids:
            continue
        # Does this signal fire on any eligible segment?
        seg_hits_any = False
        for bucket in eligible_buckets:
            bucket_rids = {rid for rid, b in seg_by_rid.items() if b == bucket}
            hits = len(sig_rids & bucket_rids)
            counts[(bucket, sig.name)] = hits
            if hits > 0:
                seg_hits_any = True
            within_rate = hits / segment_sizes[bucket] if segment_sizes[bucket] else 0.0
            overall_rate = sig.evidence_count / total_rows if total_rows else 0.0
            lifts[(bucket, sig.name)] = (
                within_rate / overall_rate if overall_rate > 0 else 0.0
            )
        if seg_hits_any:
            signals_present.append(sig)

    if not signals_present:
        raise ValueError(
            "no signals fire on any eligible segment; nothing to chart"
        )

    # ---- Render ----
    n_seg = len(eligible_buckets)
    n_sig = len(signals_present)
    fig_w = _HEATMAP_FIG_BASE_WIDTH + n_sig * _HEATMAP_FIG_WIDTH_PER_SIGNAL
    fig_h = _HEATMAP_FIG_HEIGHT_BASE + n_seg * _HEATMAP_FIG_HEIGHT_PER_SEG
    fig, ax = plt.subplots(figsize=(fig_w, fig_h), dpi=_FIGURE_DPI)

    for i, bucket in enumerate(eligible_buckets):
        for j, sig in enumerate(signals_present):
            cnt = counts.get((bucket, sig.name), 0)
            lft = lifts.get((bucket, sig.name), 0.0)
            # Below MIN_EVIDENCE threshold → color as "no fire" regardless
            # of lift. The count annotation still shows; only the band is
            # suppressed. Keeps the heatmap aligned with the text
            # portraits' surfacing rule.
            band_eligible = cnt >= _HEATMAP_MIN_EVIDENCE_FOR_BAND
            color = _lift_to_color(lft, band_eligible)
            # Draw cell as a colored rectangle (1×1 at centered coords).
            rect = mpatches.Rectangle(
                (j - 0.48, i - 0.48), 0.96, 0.96,
                facecolor=color, edgecolor="white", linewidth=1,
            )
            ax.add_patch(rect)
            # Annotate count — white text on dark cells, dark text on light.
            if cnt > 0:
                txt_color = "white" if _is_dark(color) else _TEXT_COLOR
                ax.text(
                    j, i, str(cnt),
                    ha="center", va="center",
                    fontsize=10, color=txt_color,
                )

    # Axes: segments on Y (top to bottom by size), signals on X (rotated).
    seg_labels = [
        f"{_HEATMAP_SKIN_TYPE_KO.get(b, b)} ({segment_sizes[b]})"
        for b in eligible_buckets
    ]
    sig_labels = [sig.display_label for sig in signals_present]
    ax.set_xticks(range(n_sig))
    ax.set_yticks(range(n_seg))
    ax.set_xticklabels(sig_labels, rotation=35, ha="right", fontsize=9,
                       color=_TEXT_COLOR)
    ax.set_yticklabels(seg_labels, fontsize=10, color=_TEXT_COLOR)
    ax.set_xlim(-0.5, n_sig - 0.5)
    ax.set_ylim(-0.5, n_seg - 0.5)
    ax.invert_yaxis()
    # Let cells be rectangular (auto) rather than square (equal) — leaves
    # more usable area for axis labels and the legend strip below.
    ax.set_aspect("auto")
    ax.tick_params(length=0)
    for spine in ax.spines.values():
        spine.set_visible(False)

    # Legend strip below. Reserve space in the figure layout instead of
    # letting the legend bleed into the rotated x-axis labels.
    legend_handles = [
        mpatches.Patch(facecolor=_HEATMAP_NO_FIRE, label="미감지")
    ] + [
        mpatches.Patch(facecolor=color, label=label)
        for _, _, color, label in _HEATMAP_BANDS
    ]
    fig.legend(
        handles=legend_handles,
        loc="lower center", bbox_to_anchor=(0.5, 0.0),
        ncol=5, frameon=False, fontsize=8.5,
        handlelength=1.3, handleheight=1.3, columnspacing=1.2,
    )

    # Explicit bottom padding so rotated signal labels + legend both fit.
    fig.subplots_adjust(bottom=0.32, top=0.95, left=0.14, right=0.98)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    # Don't use bbox_inches="tight" here — it can undo the bottom padding
    # we just set and clip the legend. Save at the configured size.
    fig.savefig(output_path, format="png", dpi=_FIGURE_DPI, facecolor="white")
    plt.close(fig)
    return output_path
