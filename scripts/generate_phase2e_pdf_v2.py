"""Phase 2E v2 - manufacturer-grade PDF generator.

Builds professional PDFs from cached pipeline output:
  - Cover header with product name + Korean title
  - Korean executive summary (3-4 actionable bullets)
  - Top concerns table with priority labels (proper grid)
  - Bar chart: top-5 negative attributes (% of reviews)
  - Stacked bar chart: polarity distribution per attribute
  - Evidence section: max 2-3 per attribute, severity stars + confidence chip
  - Concise Korean methodology paragraph

Korean fonts:
  - Body text via reportlab CIDFont `HYSMyeongJo-Medium` (built-in)
  - Chart labels via matplotlib's `NanumGothic` (system font on macOS)

NO pipeline operations, NO LLM calls. Pure formatting + chart rendering.

Usage:
  PYTHONPATH=. python3 scripts/generate_phase2e_pdf_v2.py
"""
from __future__ import annotations
import json
import sys
import tempfile
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import matplotlib
matplotlib.use("Agg")  # headless
import matplotlib.pyplot as plt
from matplotlib import font_manager

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import (
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from src.voc.reporting.phase2e.report import (  # noqa: E402
    aggregate_product,
    chart_data_polarity_distribution,
    chart_data_top_negative,
    compute_priority,
    format_sort_signal_labels_ko,
    select_evidence,
    build_actionable_summary_ko,
    ATTRIBUTE_LABELS_KO,
    _ko_short_label,
)
from src.voc.reporting.phase2e.insights import (  # noqa: E402
    synthesize_attribute_insights,
)
from src.voc.reporting.phase2e.recommendations import (  # noqa: E402
    ACTION_CATEGORY_EXPERIMENT,
    ACTION_CATEGORY_IMMEDIATE,
    ACTION_CATEGORY_MID_TERM,
    action_category_for,
    recommendation_for,
)
from src.voc.reporting.phase2e.impact import (  # noqa: E402
    business_impact_for,
    impact_for,
)
from src.voc.reporting.phase2e.executive_summary import (  # noqa: E402
    PriorityItem,
    StrengthItem,
    synthesize_executive_summary,
)
from src.voc.reporting.phase2e import timeseries as ts  # noqa: E402
from src.voc.reporting.phase2e.snapshots import (  # noqa: E402
    LOW_CONFIDENCE_ACTION_CHIP_KO,
    LOW_CONFIDENCE_DIRECTIONAL_IMPROVING_KO,
    LOW_CONFIDENCE_DIRECTIONAL_RISING_KO,
    STABILITY_VERDICT_HIGH_KO,
    STABILITY_VERDICT_LOW_KO,
    STABILITY_VERDICT_MEDIUM_KO,
    AttributeDelta,
    SnapshotComparison,
)
from src.voc.reporting.phase2e.usage_patterns import (  # noqa: E402
    ObservedPattern,
    detect_patterns,
)
from src.voc.reporting.phase2e.segment_patterns import (  # noqa: E402
    BuyerSegmentSignal,
    QuickDecisionSummary,
    SegmentDetection,
    build_pdf_buyer_signals,
    build_quick_decision_summary,
    detect_segments,
    detect_theme_contrasts,
)
# P0 reliability — display_text normalization + polarity guardrail.
# Evidence quotes shown to a business reader must not end mid-word
# or carry a polarity-suspect label. Both modules are pure; no
# Stage 1 / Stage 2 / aggregation behavior is touched.
from src.voc.reporting.phase2e.quote_display import (  # noqa: E402
    normalize_for_display as _quote_display_text,
)
from src.voc.reporting.phase2e.polarity_guardrail import (  # noqa: E402
    check_polarity as _check_polarity,
)

PIPELINE_OUT = Path("/tmp/phase2e_e2e_eval_results.json")
OUT_DIR = REPO / "docs"

PRODUCT_FILENAME_MAP = {
    "A000000152396": "phase2e_report_3CE_pipeline_v2.pdf",
    "A000000213429": "phase2e_report_alternative_stereo_pipeline_v2.pdf",
    "A000000131581": "phase2e_report_holika_holika_pipeline_v2.pdf",
}

# Register Korean font for reportlab text. The font manager scans the
# local system for Noto Sans KR / Noto Sans CJK KR / Apple SD Gothic
# Neo / Nanum Gothic in priority order and registers a font family
# (regular + bold) so `<b>...</b>` HTML tags render as actual bold.
# Falls back gracefully to the legacy CID font on systems without any
# Korean TTF/OTF — PDF generation never crashes from a missing font.
from src.voc.reporting.phase2e.korean_fonts import (  # noqa: E402
    discover_korean_font_family,
)

_KOREAN_FONT_FAMILY = discover_korean_font_family()
KOREAN_FONT = _KOREAN_FONT_FAMILY["name"]
KOREAN_FONT_BOLD = _KOREAN_FONT_FAMILY["bold_name"] or KOREAN_FONT
KOREAN_FONT_FAMILY_NAME = (
    _KOREAN_FONT_FAMILY["source"]
    if _KOREAN_FONT_FAMILY["family_registered"]
    else KOREAN_FONT
)

# Configure matplotlib Korean font. When no Korean font is available,
# `KOREAN_MPL_FONT` stays None and chart functions fall back to
# English/ASCII labels - broken-glyph rendering (boxes /
# integral-like substitutions) on systems without Korean fonts is
# the most common visual bug, so we trade label clarity for
# guaranteed legibility.
KOREAN_MPL_FONT = None
for candidate in (
    "NanumGothic", "AppleGothic", "NanumSquareRound",
    "Malgun Gothic",          # Windows
    "Noto Sans CJK KR", "Noto Sans KR",
):
    if any(f.name == candidate for f in font_manager.fontManager.ttflist):
        KOREAN_MPL_FONT = candidate
        break
if KOREAN_MPL_FONT:
    plt.rcParams["font.family"] = KOREAN_MPL_FONT
    plt.rcParams["axes.unicode_minus"] = False


def _chart_label(korean: str, english: str) -> str:
    """Pick the chart-axis label to render based on Korean font
    availability. When no Korean font is registered with matplotlib,
    fall back to the English label rather than render boxes /
    substitution glyphs."""
    return korean if KOREAN_MPL_FONT else english


# ---------------------------------------------------------------------------
# Pipeline-output loader
# ---------------------------------------------------------------------------


def load_pipeline_output() -> dict:
    """Load cached eval output. The eval_results store sample IDs (e.g.
    `3CE-S01`, not real review_ids), so we cannot trivially join to
    `phase1_reviews.review_date`. We fall back to the seed JSON which
    carries `review_id` + `review_date` pairs that we map back to sample_id.
    """
    if not PIPELINE_OUT.exists():
        raise FileNotFoundError(f"{PIPELINE_OUT} not found. Run scripts/eval_phase2e_e2e.py first.")
    eval_data = json.load(open(PIPELINE_OUT))

    # Build sample_id → (review_id, review_date) from the seed
    # so timeseries can use the real review_date.
    seed_path = REPO / "eval_data/phase2e/seed_v0.2.json"
    sample_to_date: dict[str, str] = {}
    if seed_path.exists():
        seed = json.load(open(seed_path))
        seen = set()
        for r in seed.get("records", []):
            sid = r.get("sample_key") or r.get("calib_id")
            if sid in seen:
                continue
            seen.add(sid)
            sample_to_date[sid] = r.get("review_date") or ""

    by_product: dict[str, dict] = {}
    for rev in eval_data["review_results"]:
        if "Holika" in rev["product_name"]:
            pid = "A000000131581"
        elif "3CE" in rev["product_name"]:
            pid = "A000000152396"
        elif "Alternative" in rev["product_name"]:
            pid = "A000000213429"
        else:
            continue
        if pid not in by_product:
            by_product[pid] = {
                "product_id": pid,
                "product_name": rev["product_name"],
                "reviews": [],
                "review_dates": {},
            }
        records = []
        for det in rev.get("per_record_detail", []):
            if det.get("stage2_drop") or det.get("stage2_polarity") is None:
                continue
            records.append({
                "attribute": det["attribute"],
                "polarity": det["stage2_polarity"],
                "intensity": det.get("stage2_intensity"),
                "evidence_span": det.get("clause", "")[:80],
                "confidence": det.get("stage2_confidence", "medium"),
                "delivery_condition_flag": False,
            })
        sample_id = rev["sample_id"]
        by_product[pid]["reviews"].append({
            "review_id": sample_id,
            "sample_id": sample_id,
            "mixed_review_flag": rev.get("pred_mixed_flag", False),
            "tradeoff_pair": rev.get("pred_tradeoff_pair"),
            "records": records,
        })
        # Attach date by sample_id (since the eval cache uses sample_id as
        # the review_id key for this loader)
        by_product[pid]["review_dates"][sample_id] = sample_to_date.get(sample_id, "")
    return by_product


# ---------------------------------------------------------------------------
# Charts (matplotlib → PNG)
# ---------------------------------------------------------------------------


PRIORITY_COLOR = {"High": "#d9534f", "Medium": "#f0ad4e", "Low": "#5bc0de"}


def render_top_negative_bar_chart(data, out_path: Path) -> None:
    labels, percents, priorities = chart_data_top_negative(data, top_n=5)
    if not labels:
        return
    fig, ax = plt.subplots(figsize=(6.0, 3.0), dpi=150)
    colors_for_bars = [PRIORITY_COLOR.get(p, "#7f7f7f") for p in priorities]
    y_pos = list(range(len(labels)))
    ax.barh(y_pos, percents, color=colors_for_bars, edgecolor="white")
    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels, fontsize=9)
    ax.invert_yaxis()
    ax.set_xlabel(
        _chart_label("부정 리뷰 비율 (%)", "Negative Review Share (%)"),
        fontsize=9,
    )
    ax.set_title(
        _chart_label("주요 부정 의견 Top 5", "Top 5 Negative Concerns"),
        fontsize=11, fontweight="bold",
    )
    for i, (pct, pr) in enumerate(zip(percents, priorities)):
        ax.text(pct + 1, i, f"{pct:.0f}% [{pr}]", va="center", fontsize=8)
    ax.set_xlim(0, max(percents) * 1.25 if percents else 100)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    plt.tight_layout()
    plt.savefig(out_path, bbox_inches="tight", facecolor="white")
    plt.close(fig)


def render_polarity_distribution_chart(data, out_path: Path) -> None:
    pdist = chart_data_polarity_distribution(data, top_n=6)
    if not pdist["labels"]:
        return
    labels = pdist["labels"]
    pos = pdist["positive"]
    neg_w = pdist["negative_weak"]
    neg_s = pdist["negative_strong"]
    mixed = pdist["mixed"]
    x = list(range(len(labels)))
    fig, ax = plt.subplots(figsize=(6.0, 3.2), dpi=150)
    ax.bar(x, pos, label=_chart_label("긍정", "Positive"), color="#5cb85c")
    bottom = list(pos)
    ax.bar(x, mixed, bottom=bottom,
           label=_chart_label("혼합", "Mixed"), color="#9b59b6")
    bottom = [a + b for a, b in zip(bottom, mixed)]
    ax.bar(x, neg_w, bottom=bottom,
           label=_chart_label("약한 부정", "Mild Negative"), color="#f0ad4e")
    bottom = [a + b for a, b in zip(bottom, neg_w)]
    ax.bar(x, neg_s, bottom=bottom,
           label=_chart_label("강한 부정", "Strong Negative"), color="#d9534f")
    ax.set_xticks(x)
    # Slightly larger rotation reduces label collisions on dense
    # corpora (page 5 visual issue). When the Korean matplotlib font
    # is unavailable the labels remain Korean glyphs that may not
    # render cleanly - acceptable trade-off vs lossy transliteration.
    ax.set_xticklabels(labels, rotation=25, ha="right", fontsize=8)
    ax.set_ylabel(
        _chart_label("리뷰 건수", "Review Count"), fontsize=9,
    )
    ax.set_title(
        _chart_label("속성별 평가 분포", "Polarity Distribution by Attribute"),
        fontsize=11, fontweight="bold",
    )
    ax.legend(loc="upper right", fontsize=8, frameon=False)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    plt.tight_layout()
    plt.savefig(out_path, bbox_inches="tight", facecolor="white")
    plt.close(fig)


# ---------------------------------------------------------------------------
# PDF flowables
# ---------------------------------------------------------------------------


def _styles() -> dict:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("Title2", parent=base["Title"],
                                 fontName=KOREAN_FONT, fontSize=22, leading=28,
                                 spaceAfter=4, alignment=0),
        "subtitle": ParagraphStyle("Subtitle2", parent=base["Heading2"],
                                    fontName=KOREAN_FONT, fontSize=13, leading=18,
                                    spaceAfter=10, textColor=colors.HexColor("#555555")),
        "h2": ParagraphStyle("H22", parent=base["Heading2"],
                              fontName=KOREAN_FONT, fontSize=14, leading=20,
                              spaceBefore=14, spaceAfter=8,
                              textColor=colors.HexColor("#222222")),
        "h3": ParagraphStyle("H32", parent=base["Heading3"],
                              fontName=KOREAN_FONT, fontSize=11, leading=16,
                              spaceBefore=8, spaceAfter=4,
                              textColor=colors.HexColor("#444444")),
        "body": ParagraphStyle("Body2", parent=base["BodyText"],
                                fontName=KOREAN_FONT, fontSize=10, leading=15,
                                spaceAfter=4),
        "bullet_high": ParagraphStyle("BulletHigh", parent=base["BodyText"],
                                       fontName=KOREAN_FONT, fontSize=10, leading=15,
                                       leftIndent=12, spaceAfter=6,
                                       textColor=colors.HexColor("#222222")),
        "evidence": ParagraphStyle("Ev", parent=base["BodyText"],
                                    fontName=KOREAN_FONT, fontSize=9, leading=13,
                                    leftIndent=14, textColor=colors.HexColor("#333333"),
                                    spaceAfter=2),
        "evidence_meta": ParagraphStyle("EvMeta", parent=base["BodyText"],
                                         fontName=KOREAN_FONT, fontSize=8, leading=11,
                                         leftIndent=14, textColor=colors.HexColor("#777777"),
                                         spaceAfter=8),
        # Sub-bullet under each negative insight: indented + slightly
        # subdued so the recommendation reads as a paired action item,
        # not a competing top-level claim.
        "recommendation": ParagraphStyle("Recommendation", parent=base["BodyText"],
                                          fontName=KOREAN_FONT, fontSize=10,
                                          leading=14, leftIndent=20,
                                          textColor=colors.HexColor("#444444"),
                                          spaceAfter=8),
        # Tagline - interview-framing intro line below the cover subtitle.
        # Italic-feeling weight + muted color so it reads as positioning,
        # not a heading.
        "tagline": ParagraphStyle("Tagline", parent=base["BodyText"],
                                    fontName=KOREAN_FONT, fontSize=10,
                                    leading=14,
                                    textColor=colors.HexColor("#5a6a7a"),
                                    spaceBefore=2, spaceAfter=14),
        # Verdict box body - larger, more breathable than the standard
        # body style. Used inside the overall-verdict 1-cell table.
        "verdict": ParagraphStyle("Verdict", parent=base["BodyText"],
                                    fontName=KOREAN_FONT, fontSize=11.5,
                                    leading=18,
                                    textColor=colors.HexColor("#222222"),
                                    leftIndent=4, rightIndent=4,
                                    spaceBefore=2, spaceAfter=2),
        # Recommended-actions list bullets - slightly larger than the
        # default body line so the action items read as deliberate
        # next steps, not afterthoughts.
        "action_bullet": ParagraphStyle("ActionBullet", parent=base["BodyText"],
                                          fontName=KOREAN_FONT, fontSize=10.5,
                                          leading=15, leftIndent=14,
                                          spaceAfter=4),
        # Methodology footer note - small, muted. Sits under the
        # methodology section as the interview-friendly "how to read"
        # disclosure.
        "methodology_note": ParagraphStyle("MethodNote", parent=base["BodyText"],
                                             fontName=KOREAN_FONT, fontSize=9,
                                             leading=13,
                                             textColor=colors.HexColor("#666666"),
                                             leftIndent=4, rightIndent=4,
                                             spaceBefore=4, spaceAfter=2),
        "metadata": ParagraphStyle("Meta", parent=base["BodyText"],
                                    fontName=KOREAN_FONT, fontSize=9, leading=13,
                                    textColor=colors.HexColor("#555555"),
                                    spaceAfter=10),
        "methodology": ParagraphStyle("Method", parent=base["BodyText"],
                                       fontName=KOREAN_FONT, fontSize=9, leading=13,
                                       textColor=colors.HexColor("#444444"),
                                       spaceAfter=6, alignment=4),  # justify
        # Pass-12: appendix body — slightly smaller + lighter than the
        # main report body so a glance at the appendix reads
        # immediately as "supporting detail, not the headline." Used
        # for the appendix intro caption and methodology paragraphs.
        "appendix_body": ParagraphStyle(
            "AppendixBody", parent=base["BodyText"],
            fontName=KOREAN_FONT, fontSize=9, leading=13,
            textColor=colors.HexColor("#555555"), spaceAfter=4,
        ),
        "appendix_caption": ParagraphStyle(
            "AppendixCaption", parent=base["BodyText"],
            fontName=KOREAN_FONT, fontSize=9, leading=13,
            textColor=colors.HexColor("#777777"),
            spaceBefore=2, spaceAfter=8, alignment=0,
        ),
    }


def _bullet_paragraph(text: str, style) -> Paragraph:
    """Bullet text with markdown bold rendered as <b>."""
    import re
    s = (text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
    s = re.sub(r"\*\*([^*]+?)\*\*", r"<b>\1</b>", s)
    return Paragraph("• " + s, style)


def build_top_concerns_table(data) -> Table:
    """Proper-grid concerns table with priority color column."""
    header = ["#", "속성", "부정 비율", "심각도", "우선순위"]
    rows = [header]
    neg_ranked = sorted(
        [s for s in data.attribute_summaries.values() if s.n_negative > 0],
        key=lambda s: -s.n_negative,
    )[:8]
    if not neg_ranked:
        return None
    for i, s in enumerate(neg_ranked, 1):
        label = _ko_short_label(s.attribute)
        pct = (s.n_negative / data.n_reviews * 100) if data.n_reviews else 0
        priority = compute_priority(s, data.n_reviews)
        rows.append([
            str(i),
            label,
            f"{pct:.0f}% ({s.n_negative}/{data.n_reviews})",
            f"{s.avg_intensity_neg:.1f} / 3",
            priority,
        ])
    col_widths = [12 * mm, 50 * mm, 35 * mm, 30 * mm, 25 * mm]
    t = Table(rows, colWidths=col_widths, repeatRows=1)

    # Color priority cells
    style_cmds = [
        ("FONTNAME", (0, 0), (-1, -1), KOREAN_FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#222222")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), KOREAN_FONT),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("ALIGN", (2, 0), (-1, -1), "CENTER"),
        ("ALIGN", (1, 0), (1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cccccc")),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#888888")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
         [colors.white, colors.HexColor("#f8f8f8")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    # Color priority badges
    for r_idx in range(1, len(rows)):
        priority = rows[r_idx][4]
        bg = colors.HexColor(PRIORITY_COLOR.get(priority, "#999999"))
        style_cmds.append(("BACKGROUND", (4, r_idx), (4, r_idx), bg))
        style_cmds.append(("TEXTCOLOR", (4, r_idx), (4, r_idx), colors.white))
        style_cmds.append(("FONTNAME", (4, r_idx), (4, r_idx), KOREAN_FONT))
    t.setStyle(TableStyle(style_cmds))
    return t


def build_polarity_distribution_table(data) -> Table:
    """Polarity distribution per top-N attribute. Header columns
    use full Korean labels (긍정 / 약한 부정 / 강한 부정 / 혼합 /
    합계) so an operator can read them without context. Slightly
    larger font + extra row padding addresses page-5 readability.
    """
    pdist = chart_data_polarity_distribution(data, top_n=6)
    if not pdist["labels"]:
        return None
    rows: list[list] = [
        ["속성", "긍정", "약한 부정", "강한 부정", "혼합", "합계"],
    ]
    for i, label in enumerate(pdist["labels"]):
        total = (pdist["positive"][i] + pdist["negative_weak"][i] +
                 pdist["negative_strong"][i] + pdist["mixed"][i])
        rows.append([
            label,
            str(pdist["positive"][i]),
            str(pdist["negative_weak"][i]),
            str(pdist["negative_strong"][i]),
            str(pdist["mixed"][i]),
            str(total),
        ])
    # Slightly wider attribute column to absorb long Korean labels
    # without truncation; tighter numeric columns balance the page.
    col_widths = [48 * mm, 16 * mm, 22 * mm, 22 * mm, 16 * mm, 16 * mm]
    t = Table(rows, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), KOREAN_FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#222222")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#dddddd")),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#888888")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
         [colors.white, colors.HexColor("#f8f8f8")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def build_tradeoff_table(data) -> Table:
    """Trade-off appendix table. Uses ASCII '->' instead of the
    Unicode rightwards arrow because the latter renders as a
    substitution glyph in some viewers when the Korean CID font
    lacks a U+2192 mapping."""
    if not data.tradeoff_pairs:
        return None
    rows: list[list] = [
        ["강점으로 언급된 속성", "함께 양보된 속성", "건수"],
    ]
    for pair, n in data.tradeoff_pairs.most_common(6):
        # Pair format: "attr_a:polarity_a -> attr_b:polarity_b"
        # Split into the two sides and strip the polarity tag for
        # readability — the side itself (긍정 vs 양보) is conveyed
        # by the column header.
        if "->" in pair:
            left, right = pair.split("->", 1)
            a_attr = left.strip().split(":")[0]
            b_attr = right.strip().split(":")[0]
            a_label = ATTRIBUTE_LABELS_KO.get(a_attr, a_attr).split("(")[0].strip()
            b_label = ATTRIBUTE_LABELS_KO.get(b_attr, b_attr).split("(")[0].strip()
        else:
            a_label = pair
            b_label = ""
        rows.append([a_label, b_label, str(n)])
    col_widths = [62 * mm, 62 * mm, 20 * mm]
    t = Table(rows, colWidths=col_widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), KOREAN_FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#222222")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ALIGN", (2, 0), (2, -1), "CENTER"),
        ("ALIGN", (0, 0), (1, 0), "CENTER"),  # header centered
        ("ALIGN", (0, 1), (1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cccccc")),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#888888")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
         [colors.white, colors.HexColor("#f8f8f8")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


# ---------------------------------------------------------------------------
# PDF builder (per product)
# ---------------------------------------------------------------------------


# Korean labels for the five OliveYoung review-sort buttons. Used in the
# corpus metadata box to give the reader a human-readable sort name.
_SORT_TYPE_LABELS_KO: dict[str, str] = {
    "USEFUL_SCORE_DESC": "유용한 순",
    "RECOMMENDED_DESC":  "도움순",
    "DATETIME_DESC":     "최신순",
    "RATING_DESC":       "평점 높은순",
    "RATING_ASC":        "평점 낮은순",
}


def _format_sort_label(sort_type: str) -> str:
    ko = _SORT_TYPE_LABELS_KO.get(sort_type)
    return f"{sort_type} ({ko})" if ko else sort_type


# Run-003 pass-12 corpus-metadata table styling. Wider value column +
# Paragraph-wrapped cells so long Korean phrases like "최종 분석 리뷰 수
# (주 코퍼스, 중복 제거 후)" don't break mid-syllable inside the cell.
_CM_LABEL_PARA = ParagraphStyle(
    "_CMLabel", fontName=KOREAN_FONT, fontSize=9, leading=12,
    textColor=colors.HexColor("#444444"), wordWrap="CJK",
)
_CM_VALUE_PARA = ParagraphStyle(
    "_CMValue", fontName=KOREAN_FONT, fontSize=9, leading=12,
    textColor=colors.HexColor("#222222"), wordWrap="CJK",
)
_CM_HEADER_PARA = ParagraphStyle(
    "_CMHeader", fontName=KOREAN_FONT, fontSize=10, leading=14,
    textColor=colors.white, wordWrap="CJK",
)


def _cm_paragraph(text: str, *, header: bool = False, value: bool = False) -> Paragraph:
    style = _CM_HEADER_PARA if header else (_CM_VALUE_PARA if value else _CM_LABEL_PARA)
    # Escape `<` / `>` that appear in user-facing breadcrumbs / labels
    # so reportlab's mini-XML parser doesn't choke on them.
    safe = (
        text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
    )
    return Paragraph(safe, style)


def _cm_subtable(title: str, rows: list[tuple[str, str]]) -> Table:
    """Build one corpus-metadata sub-table: a colored header row spanning
    the two columns, then key/value rows with Paragraph-wrapped cells.
    """
    label_w = 50 * mm
    value_w = 108 * mm
    body: list[list] = [[_cm_paragraph(title, header=True), ""]]
    for k, v in rows:
        body.append([_cm_paragraph(k), _cm_paragraph(v, value=True)])
    t = Table(body, colWidths=[label_w, value_w], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#3a6ea5")),
        ("SPAN", (0, 0), (-1, 0)),
        ("ALIGN", (0, 0), (-1, 0), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 1), (0, -1), colors.HexColor("#f0f0f0")),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cccccc")),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#888888")),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        # Body row padding bumped from 4 → 6 for legibility per
        # pass-12 polish brief.
        ("TOPPADDING", (0, 1), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, 0), 5),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 5),
    ]))
    return t


def _build_corpus_metadata_table(meta: dict) -> list:
    """Return the 분석 범위 disclosure as a list of flowables.

    The legacy form was a single 2-column Table with raw strings —
    long Korean phrases like "최종 분석 리뷰 수 (주 코퍼스, 중복 제거
    후)" broke mid-syllable inside the narrow label column. The new
    form splits into three KeepTogether sub-tables (대상 / 정렬 /
    모델·처리 정보) each ≤ 6 rows, with every cell wrapped in a
    Paragraph so reportlab's CJK word-wrap engages correctly.

    Returns an empty list when `meta` is empty / None.
    """
    if not meta:
        return []

    # Bucket 1 — 분석 대상 (4-6 rows).
    target_rows: list[tuple[str, str]] = []
    if meta.get("scrape_skipped"):
        target_rows.append(
            ("수집 시점", "기존 DB 누적 데이터 (이번 실행에서 신규 수집 없음)"),
        )
    else:
        started = meta.get("collection_started_at") or "-"
        completed = meta.get("collection_completed_at") or "-"
        if started != "-" and completed != "-":
            target_rows.append(("수집 시점", f"{started} → {completed}"))
        else:
            target_rows.append(("수집 시점", "기록 없음"))

    if meta.get("collected_review_count") is not None:
        target_rows.append(
            ("수집 리뷰 수", f"{meta['collected_review_count']}건"),
        )
    if meta.get("processed_review_count") is not None:
        target_rows.append(
            ("처리 리뷰 수", f"{meta['processed_review_count']}건"),
        )

    # Sort-aware "최종 분석 리뷰 수" row — long label, deliberately
    # placed in 분석 대상 because it answers "how many reviews are in
    # this analysis?" rather than "which sort produced them?".
    sort_mode = meta.get("sort_mode")
    primary_corpus_sort = meta.get("primary_corpus_sort_type")
    if sort_mode == "multi" and primary_corpus_sort:
        merged = meta.get("processed_review_count")
        if merged is not None:
            target_rows.append((
                "최종 분석 리뷰 수 (주 코퍼스, 중복 제거 후)",
                f"{merged}건",
            ))

    # Bucket 2 — 수집 정렬 (4-6 rows).
    sort_rows: list[tuple[str, str]] = []
    if sort_mode == "multi" and primary_corpus_sort:
        primary_label = _format_sort_label(primary_corpus_sort)
        sort_rows.append((
            "주 코퍼스 정렬",
            f"{primary_label} - 분포/시계열 산정 기준 (cap=all)",
        ))
        signal_sorts = meta.get("signal_sort_types") or []
        signal_cap = meta.get("signal_sort_cap")
        if signal_sorts:
            signal_labels = " / ".join(
                _format_sort_label(s) for s in signal_sorts
            )
            cap_suffix = f"각 top-{signal_cap}" if signal_cap else "top-N"
            sort_rows.append((
                "대표 리뷰 참고 정렬",
                f"{signal_labels} ({cap_suffix}) - "
                f"분포 산정에 미사용, 대표 리뷰 발췌용",
            ))
    elif sort_mode == "multi":
        included = meta.get("sort_types_included") or []
        plan = meta.get("multi_sort_plan") or []
        parts = (
            " + ".join(p.get("sort_type", "?") for p in plan)
            if plan else " + ".join(included)
        )
        merged = meta.get("processed_review_count")
        merged_suffix = f"; 머지 후 {merged}건" if merged is not None else ""
        sort_rows.append(("정렬 기준", f"다중 정렬 머지 ({parts}{merged_suffix})"))
    elif sort_mode == "single" and meta.get("sort_types_included"):
        st = meta["sort_types_included"][0]
        sort_rows.append(("정렬 기준", _format_sort_label(st)))
    elif sort_mode == "default":
        sort_rows.append((
            "정렬 기준",
            "기본 (USEFUL_SCORE_DESC / 유용한 순) - 시간순/평점순 별도 미수집",
        ))

    # Per-sort outcome — partial_success contract; up to 4 rows.
    sorts_attempted = meta.get("sorts_attempted") or []
    sorts_succeeded = meta.get("sorts_succeeded") or []
    sorts_failed = meta.get("sorts_failed") or []
    sorts_blocked = meta.get("sorts_blocked_or_anti_bot") or []
    partial_success = bool(meta.get("partial_success"))
    if sorts_attempted or sorts_succeeded or sorts_failed:
        attempted_lbls = " / ".join(
            _format_sort_label(s) for s in sorts_attempted
        )
        succeeded_lbls = (
            " / ".join(_format_sort_label(s) for s in sorts_succeeded)
            if sorts_succeeded else "없음"
        )
        failed_lbls = (
            " / ".join(_format_sort_label(s) for s in sorts_failed)
            if sorts_failed else "없음"
        )
        if attempted_lbls:
            sort_rows.append(("수집 시도 정렬", attempted_lbls))
        sort_rows.append(("수집 성공 정렬 (증거 기여)", succeeded_lbls))
        sort_rows.append(("수집 실패 정렬 (증거 미기여)", failed_lbls))
        if sorts_blocked:
            sort_rows.append((
                "차단/봇 의심",
                " / ".join(_format_sort_label(s) for s in sorts_blocked),
            ))

    # Bucket 3 — 모델·처리 정보 (3-5 rows).
    process_rows: list[tuple[str, str]] = []
    if meta.get("polarity_record_count") is not None:
        process_rows.append((
            "속성 의견 분류 수", f"{meta['polarity_record_count']}건",
        ))

    if meta.get("scrape_skipped"):
        process_rows.append(
            ("리뷰 수 제한", "해당 없음 (이번 실행에서 신규 수집 없음)"),
        )
    elif meta.get("corpus_limited"):
        cap = meta.get("max_reviews_effective", "?")
        process_rows.append((
            "리뷰 수 제한",
            f"[주의] 적용 (max_reviews = {cap}건; 더 많은 리뷰가 있을 수 있음)",
        ))
    elif meta.get("finite_limit_set"):
        cap = meta.get("max_reviews_effective", "?")
        process_rows.append((
            "리뷰 수 제한",
            f"적용 안 됨 (max_reviews = {cap} 이하 수집됨)",
        ))
    else:
        process_rows.append(("리뷰 수 제한", "적용 안 됨 (max_reviews = all)"))

    if meta.get("max_reviews_arg") is not None:
        process_rows.append(("max_reviews 파라미터", str(meta["max_reviews_arg"])))
    if meta.get("model_name"):
        process_rows.append(("분석 모델 (Stage 2)", str(meta["model_name"])))
    if partial_success:
        process_rows.append((
            "[주의] 부분 성공",
            "일부 정렬 수집 실패 — 실패 정렬 리뷰는 분석에 포함되지 않았습니다.",
        ))
        if "RATING_ASC" in sorts_failed:
            process_rows.append((
                "[주의] 평점 낮은순 실패",
                "낮은 평점순(RATING_ASC) 수집 실패로 부정 리뷰 신호가 "
                "과소 관측될 수 있습니다.",
            ))

    flowables: list = []
    if target_rows:
        flowables.append(KeepTogether([
            _cm_subtable("분석 대상", target_rows), Spacer(1, 6),
        ]))
    if sort_rows:
        flowables.append(KeepTogether([
            _cm_subtable("수집 정렬", sort_rows), Spacer(1, 6),
        ]))
    if process_rows:
        flowables.append(KeepTogether([
            _cm_subtable("모델·처리 정보", process_rows), Spacer(1, 6),
        ]))
    return flowables


# Risk-category color palette (chip backgrounds inside the priority
# table). Six categories from `RISK_CATEGORIES_KO` get distinct hues
# so the operator can scan by risk type without reading the text.
_RISK_CATEGORY_COLOR: dict[str, str] = {
    "재구매율 저하":  "#c0392b",   # warm red - direct revenue loss
    "클레임 증가":    "#d35400",   # burnt orange - escalation risk
    "경쟁사 이탈":    "#8e44ad",   # purple - switching loss
    "부정 리뷰 누적": "#e67e22",   # amber - reputation decay
    "가격 저항":      "#2c3e50",   # slate - pricing pressure
    "신뢰도 하락":    "#7f8c8d",   # gray - trust erosion
}


# Action-category chip palette for the Recommended Actions list.
# Each category gets a distinct hue so an operator can scan the list
# and route work without reading the action phrase:
#   - 즉시 실행 → green  (deployable in days/weeks; no R&D)
#   - 중기 개선 → blue   (formula / SKU / packaging - 1-3 month cycle)
#   - 실험/검증 → orange (test before committing to a fix)
_ACTION_CATEGORY_COLOR: dict[str, str] = {
    ACTION_CATEGORY_IMMEDIATE:  "#2e7d32",   # green
    ACTION_CATEGORY_MID_TERM:   "#3a6ea5",   # blue
    ACTION_CATEGORY_EXPERIMENT: "#d97706",   # orange
}


def _overall_priority_level(priorities: list) -> str:
    """Derive a HIGH/MEDIUM/LOW headline label from the top-N priorities.

    Presentation-only; doesn't change any scoring. Used by the
    KEY METRICS strip so the operator sees a single-glance verdict
    on whether *any* of the top priorities warrants escalation.

      - "HIGH"   : any priority has priority_label == "High"
      - "MEDIUM" : no High but any Medium
      - "LOW"    : everything is Low (or empty)
    """
    labels = {p.priority_label for p in priorities}
    if "High" in labels:
        return "HIGH"
    if "Medium" in labels:
        return "MEDIUM"
    return "LOW"


# Color palette for the overall-priority chip in KEY METRICS, shared
# with the per-priority impact chip. Bold, saturated colors so the
# top-of-page strip reads as the report's headline verdict.
_OVERALL_PRIORITY_COLOR: dict[str, str] = {
    "HIGH":   "#c0392b",   # warm red - calls for action
    "MEDIUM": "#d35400",   # burnt orange - needs attention
    "LOW":    "#5cb85c",   # green - generally healthy
}


# Conditional framing dict driven by overall_level. The redesigned
# report adapts wording to the product's actual health: a LOW-priority
# product gets observational language ("모니터링 후보", "관찰 신호")
# while a HIGH-priority product gets stronger "우선 검토" framing.
# Internal score is hidden from front-page cards regardless of level
# - business operators don't need to see priority_score: 8.0 chips.
def _overall_signal_mode(overall_level: str) -> dict:
    """Return a wording dict for conditional sections of the report.

    Keys:
      level_label_ko       - 양호 / 관찰 필요 / 주의 (chip text)
      level_color          - hex color for the level chip
      signals_section_title - "모니터링 후보 신호" or "우선 검토 신호"
      signals_intro_ko     - one-line intro under the section header
      card_concern_label   - "[관찰 신호]" / "[주요 신호]" / "[우선 검토]"
      takeaway_ko          - main takeaway sentence template
    """
    if overall_level == "HIGH":
        return {
            "level_label_ko": "주의",
            "level_color": "#c0392b",
            "signals_section_title": "주요 확인 포인트",
            "signals_intro_ko": (
                "리뷰에서 아쉬움 의견 비중이 높게 누적된 항목들로, "
                "구매 전 / 운영 시 우선 확인을 권장합니다."
            ),
            "card_concern_label": "우선 확인 포인트",
            "takeaway_ko": (
                "이 제품은 아쉬움 의견 비중이 다소 높게 나타나며, "
                "아래 항목은 구매 전 / 운영 시 우선 확인 포인트로 정리되었습니다."
            ),
        }
    if overall_level == "MEDIUM":
        return {
            "level_label_ko": "확인 필요",
            "level_color": "#d35400",
            "signals_section_title": "주요 확인 포인트",
            "signals_intro_ko": (
                "일부 항목에 아쉬움 의견이 반복적으로 누적되어 있어 "
                "구매 전 함께 살펴볼 포인트로 정리했습니다."
            ),
            "card_concern_label": "확인 포인트",
            "takeaway_ko": (
                "이 제품은 일부 항목에서 함께 살펴볼 포인트가 보이며, "
                "구매 전 아래 내용을 함께 확인하시는 것을 권장합니다."
            ),
        }
    # LOW (default for healthy products)
    return {
        "level_label_ko": "양호",
        "level_color": "#3a7a3a",
        "signals_section_title": "주요 확인 포인트",
        "signals_intro_ko": (
            "전반적으로 만족 의견이 많고 아쉬움 의견은 제한적입니다. "
            "다음 항목은 가볍게 확인할 만한 포인트로 정리했습니다."
        ),
        "card_concern_label": "확인 포인트",
        "takeaway_ko": (
            "이 제품은 전반적으로 만족 의견이 우세하며, "
            "아래 항목은 가볍게 확인할 만한 포인트로 정리되었습니다."
        ),
    }


def _build_key_metrics_strip(
    *,
    n_reviews: int,
    pct_neg_records: float,
    top_priorities: list,
    overall_level: str,
) -> Table:
    """4-card horizontal stat strip rendered at the top of section 1.

    Cards (left to right):
      - 분석 리뷰      → n_reviews ("100건")
      - 부정 비율      → pct_neg_records as a percentage ("32%")
      - 우선 이슈      → top 1-2 problem attribute labels
      - 종합 우선순위 → HIGH / MEDIUM / LOW chip

    The strip is the report's 30-second headline: an operator should
    grasp scale, sentiment skew, what's wrong, and how urgent it is
    without reading a single sentence. Card backgrounds are uniform
    (white) with a subtle top border + thin vertical separators
    between cards - keeps the visual weight on the numbers, not the
    chrome.
    """
    label_style = ParagraphStyle(
        "_KMLabel", fontName=KOREAN_FONT, fontSize=8.5,
        textColor=colors.HexColor("#666666"), leading=11,
        alignment=1,  # centered
    )
    big_style = ParagraphStyle(
        "_KMBig", fontName=KOREAN_FONT, fontSize=20,
        textColor=colors.HexColor("#1a1a1a"), leading=24,
        alignment=1,
        spaceBefore=2, spaceAfter=2,
    )
    sub_style = ParagraphStyle(
        "_KMSub", fontName=KOREAN_FONT, fontSize=9,
        textColor=colors.HexColor("#555555"), leading=12,
        alignment=1,
    )

    pct_str = f"{pct_neg_records * 100:.0f}%"

    # Top-2 problem attribute labels stacked. Empty corpus ⇒ em-dash.
    if top_priorities:
        names = [p.label_ko for p in top_priorities[:2]]
        problem_text = "<br/>".join(names)
    else:
        problem_text = "-"

    # Overall priority chip - colored background per level.
    overall_color = _OVERALL_PRIORITY_COLOR.get(overall_level, "#7f8c8d")
    overall_chip_style = ParagraphStyle(
        "_KMChip", fontName=KOREAN_FONT, fontSize=18,
        textColor=colors.white, leading=22,
        alignment=1,
        backColor=colors.HexColor(overall_color),
        borderPadding=(4, 8, 4, 8),
        spaceBefore=2, spaceAfter=2,
    )

    cell_reviews = [
        Paragraph("분석 리뷰", label_style),
        Paragraph(f"{n_reviews}건", big_style),
        Paragraph(" ", sub_style),
    ]
    cell_neg = [
        Paragraph("부정 비율", label_style),
        Paragraph(pct_str, big_style),
        Paragraph("(전체 속성 레코드 중)", sub_style),
    ]
    cell_problem = [
        Paragraph("우선 이슈", label_style),
        # Use sub_style here - the labels can be longer than the
        # other cards' single-number stats, so we don't want the
        # 20-pt big_style truncating or wrapping awkwardly.
        Paragraph(problem_text, ParagraphStyle(
            "_KMProblem", fontName=KOREAN_FONT, fontSize=11,
            textColor=colors.HexColor("#1a1a1a"), leading=14,
            alignment=1, spaceBefore=4, spaceAfter=4,
        )),
        Paragraph("Top 2 priority attributes", sub_style),
    ]
    cell_overall = [
        Paragraph("종합 우선순위", label_style),
        Paragraph(f"<b>{overall_level}</b>", overall_chip_style),
        Paragraph("Overall priority level", sub_style),
    ]

    rows = [[cell_reviews, cell_neg, cell_problem, cell_overall]]
    col_widths = [40 * mm, 40 * mm, 40 * mm, 40 * mm]
    t = Table(rows, colWidths=col_widths)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEABOVE", (0, 0), (-1, 0), 1.5, colors.HexColor("#222222")),
        ("LINEBELOW", (0, -1), (-1, -1), 0.6, colors.HexColor("#888888")),
        # Thin vertical dividers between cards.
        ("LINEAFTER", (0, 0), (-2, -1), 0.3, colors.HexColor("#dddddd")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
    ]))
    return t


def _build_verdict_box(text_ko: str, styles: dict) -> Table:
    """Single-cell colored box that prominently surfaces the
    overall_verdict_ko sentence at the top of the report.

    The box has a subtle warm-neutral background (#FFF8EE) and a
    thin accent border on the left edge so it reads as an editorial
    summary callout rather than another data table.
    """
    para = Paragraph(text_ko, styles["verdict"])
    t = Table([[para]], colWidths=[160 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FFF8EE")),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#cccccc")),
        ("LINEBEFORE", (0, 0), (0, -1), 3, colors.HexColor("#3a6ea5")),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    return t


def _section_divider(thickness: float = 0.4,
                     color_hex: str = "#dddddd") -> Table:
    """Thin horizontal rule used to separate first-page sub-sections
    visually. Implemented as a 1-cell table with only a top border -
    cheaper than HRFlowable and styles consistently with the report's
    other tables."""
    t = Table([[" "]], colWidths=[160 * mm], rowHeights=[1])
    t.setStyle(TableStyle([
        ("LINEABOVE", (0, 0), (-1, 0), thickness, colors.HexColor(color_hex)),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return t


def _pick_representative_review(
    summary, *, max_chars: int = 80,
) -> dict | None:
    """Return one representative negative-evidence dict for the
    summary, or None when nothing usable exists.

    Picked via the existing `select_evidence` heuristic (highest
    score, polarity strength, span length, recency) - same logic the
    full evidence section uses, so the rep review here matches
    section 5's top-listed excerpt for the same attribute.

    P0 reliability:
      - skip candidates the polarity guardrail flags as suspect on
        the negative side (a quote labeled `negative_*` whose text
        carries decisive positive cues should NOT appear in a
        seller-facing watch-out card),
      - apply `quote_display.normalize_for_display` so the rendered
        excerpt snaps to a sentence boundary instead of ending
        mid-word ("…뚜껑이 대충눌러서는 완벽하게 닫"). The raw
        verbatim span is preserved on the dict for audit.
    """
    evidences = select_evidence(summary, n=5, prefer_diverse=False, kind="negative")
    if not evidences:
        return None
    chosen = None
    for cand in evidences:
        span = (cand.get("evidence_span") or "").strip()
        if not span:
            continue
        polarity = cand.get("polarity") or "negative_strong"
        check = _check_polarity(span, polarity)
        if check.is_suspect:
            continue
        chosen = cand
        break
    if chosen is None:
        # Every candidate was suspect — defer to Stage 2's first call
        # but mark the entry so caller can degrade gracefully.
        chosen = evidences[0]
    ev = dict(chosen)  # shallow copy so caller mutations don't bleed back
    raw_span = (ev.get("evidence_span") or "").strip()
    ev["evidence_span_raw"] = raw_span
    # Respect caller's max_chars budget exactly. The display
    # normalizer will fall through to ellipsis truncation when
    # max_chars is smaller than its sentence-snap threshold; the
    # output is guaranteed `len <= max_chars`.
    display = _quote_display_text(raw_span, max_len=max_chars)
    ev["evidence_span"] = display
    return ev


def _build_priority_card(
    *,
    index: int,
    priority: PriorityItem,
    representative: dict | None,
    styles: dict,
    corpus_confidence_level: str | None = None,
    corpus_signal_stability: str | None = None,
    concern_label_ko: str | None = None,
    n_reviews_total: int = 0,
    attr_total_mentions: int = 0,
    interview_hook_ko: str | None = None,
) -> Table:
    """Render one Top-Signal / Monitoring-Candidate card.

    Layout (top to bottom inside the card):
      Row 1 - index + label, conditional concern chip
              (관찰 신호 / 주요 신호 / 우선 검토), confidence chip,
              denominator-aware frequency. Internal score is HIDDEN
              from the card surface - business operators don't need
              priority_score: 8.0 chips on the front page.
      Row 2 - representative review (quoted) + rating
      Row 3 - "왜 중요한가" line (impact_ko)
      Row 4 - "내부 확인 질문" line (2-3 questions stacked)
      Row 5 - "비즈니스 임팩트" framing line

    `concern_label_ko` is from `_overall_signal_mode(...)` and adapts
    the card's color tone:
      "관찰 신호" → muted yellow/amber
      "주요 신호" → orange
      "우선 검토" → red
    `n_reviews_total` and `attr_total_mentions` provide the
    denominators that replace the old percentage-only chip.
    """
    impact_color = PRIORITY_COLOR.get(priority.priority_label, "#777777")
    risk_color = (
        _RISK_CATEGORY_COLOR.get(priority.risk_category, "#666666")
        if priority.risk_category else "#888888"
    )

    # ------- Row 1: header strip with chips -------
    # Denominator-aware frequency: "분석 리뷰 N건 중 X건". When
    # attr_total_mentions is also known, append the per-attribute
    # denominator so the operator sees both bases.
    if n_reviews_total > 0:
        freq_str = f"분석 리뷰 {n_reviews_total:,}건 중 {priority.n_negative}건"
    else:
        freq_str = f"부정 {priority.n_negative}건"
    if attr_total_mentions and attr_total_mentions > 0:
        freq_str += (
            f" (해당 속성 언급 {attr_total_mentions}건 중 부정 "
            f"{priority.n_negative}건)"
        )
    risk_str = priority.risk_category or "-"

    # Per-card signal confidence chip. Run-003 QA pass-2: chip text
    # is locked to the four-axis labels so it never collapses to
    # forbidden tokens (`신뢰도 높음`, `신뢰도 낮음`).
    tier_to_chip = {
        "High": "표본 충분",
        "Medium": "표본 보통",
        "Low": "참고 수준",
    }
    signal_conf = tier_to_chip.get(priority.priority_label, "표본 보통")
    if corpus_confidence_level == "low":
        signal_conf = "참고 수준"
    confidence_chip_color = {
        "표본 충분": "#3a7a3a",
        "표본 보통": "#b07000",
        "참고 수준": "#a04040",
    }.get(signal_conf, "#666666")

    # Conditional concern chip - drives the card's color emphasis
    # based on overall signal level. Defaults to neutral framing
    # when no concern_label_ko is provided.
    concern_chip_segment = ""
    if concern_label_ko:
        concern_color = {
            "확인 포인트": "#b07000",
            "주요 확인 포인트": "#d35400",
            "우선 확인 포인트": "#c0392b",
            # legacy color keys retained for back-compat with any
            # tests that pass the old internal labels through.
            "확인할 포인트": "#b07000",
            "우선 확인할 포인트": "#c0392b",
            "관찰 신호": "#b07000",
            "주요 신호": "#d35400",
            "우선 검토": "#c0392b",
        }.get(concern_label_ko, "#b07000")
        concern_chip_segment = (
            f"<font color=\"{concern_color}\">"
            f"<b>[{concern_label_ko}]</b></font> "
        )

    # Stability chip kept minimal — operator-friendly label that
    # never collapses to "안정성 높음/낮음" (forbidden in PDF body).
    stability_chip_segment = ""
    if corpus_signal_stability in ("high", "medium", "low"):
        stability_to_ko = {
            "high": "반복 확인",
            "medium": "반복 확인",
            "low": "반복 확인 제한적",
        }[corpus_signal_stability]
        stability_color = {
            "high": "#3a7a3a",
            "medium": "#b07000",
            "low": "#a04040",
        }[corpus_signal_stability]
        stability_chip_segment = (
            f"  |  <font color=\"{stability_color}\">"
            f"<b>[{stability_to_ko}]</b></font>"
        )

    header_html = (
        f"<b>{index}. {priority.label_ko}</b>    "
        f"{concern_chip_segment}"
        f"<font color=\"{confidence_chip_color}\">"
        f"<b>[{signal_conf}]</b></font>"
        f"{stability_chip_segment}"
        f"<br/>"
        f"<font color=\"#444444\">{freq_str}</font>"
    )
    header_para = Paragraph(header_html, ParagraphStyle(
        "_PrioCardHeader", fontName=KOREAN_FONT, fontSize=11,
        leading=15, textColor=colors.HexColor("#1a1a1a"),
        spaceAfter=4,
    ))

    # ------- Row 2: representative review -------
    rep_paras: list = []
    if representative is not None:
        span = representative.get("evidence_span", "").strip()
        rating = representative.get("rating_normalized")
        if span:
            ev_safe = (
                span.replace("&", "&amp;")
                    .replace("<", "&lt;")
                    .replace(">", "&gt;")
            )
            rating_str = ""
            if isinstance(rating, (int, float)) and not isinstance(rating, bool):
                rating_str = (
                    f"   <font color=\"#888888\">"
                    f"★ {float(rating):.0f}점 / 5점</font>"
                )
            rep_html = (
                f"<font color=\"#3a3a3a\">&ldquo;{ev_safe}&rdquo;</font>"
                f"{rating_str}"
            )
            rep_paras.append(Paragraph(rep_html, ParagraphStyle(
                "_PrioCardRep", fontName=KOREAN_FONT, fontSize=10,
                leading=14, leftIndent=4,
                textColor=colors.HexColor("#3a3a3a"),
                spaceAfter=4,
            )))

    # ------- Row 3: why it matters -------
    why_paras: list = []
    if priority.why_ko:
        why_html = (
            f"<font color=\"#a04040\"><b>왜 중요한가</b></font>   "
            f"{priority.why_ko}"
        )
        why_paras.append(Paragraph(why_html, ParagraphStyle(
            "_PrioCardWhy", fontName=KOREAN_FONT, fontSize=10,
            leading=14, leftIndent=4,
            textColor=colors.HexColor("#3a3a3a"),
            spaceAfter=2,
        )))

    # ------- Row 4: internal check questions (2–3 per attribute) -------
    # The card's primary "what to do next" framing. Replaces the
    # earlier "권장 액션 / 검토 후보" line - operators read these as
    # conversation starters with internal teams (R&D / QA /
    # merchandising) rather than prescriptive recommendations.
    # Every phrase ends in 확인할 필요가 있습니다 / 검토가 필요합니다 /
    # 확인이 권장됩니다 per the wording-safety contract.
    # Skipped entirely when the attribute has no questions in
    # `INTERNAL_CHECK_QUESTIONS_KO` so a missing mapping surfaces
    # as a visible omission, not as a generic stub.
    check_paras: list = []
    # SCAMPER P (PUT TO ANOTHER USE): when an analysis_report-supplied
    # interview hook is available for this attribute, surface it AS
    # the "내부 확인 질문" content. The hook is already a complete
    # phrase ("도포 직후 건조함 — 보습 라인 병용 / 흡수 시간 / 마무리
    # 텍스처") so we don't need to combine it with the legacy
    # `_internal_check_questions_for` output. Profile-aware language
    # wins over the generic per-attribute table.
    if interview_hook_ko and isinstance(interview_hook_ko, str) and interview_hook_ko.strip():
        check_questions: tuple[str, ...] = (interview_hook_ko.strip(),)
    else:
        check_questions = _internal_check_questions_for(priority.attribute)
    if check_questions:
        # Header label + first question on the same line; remaining
        # questions as small bullets under the label so the row
        # reads as a coherent block but stays scannable. When the
        # hook path is used the label reads "리서치 인터뷰 후보" so
        # operators see the SCAMPER framing on the surface.
        section_label = (
            "리서치 인터뷰 후보"
            if interview_hook_ko else "내부 확인 질문"
        )
        first_html = (
            f"<font color=\"#3a6ea5\"><b>{section_label}</b></font>   "
            f"{check_questions[0]}"
        )
        check_paras.append(Paragraph(first_html, ParagraphStyle(
            "_PrioCardCheckHead", fontName=KOREAN_FONT, fontSize=10,
            leading=14, leftIndent=4,
            textColor=colors.HexColor("#1a3a5a"),
            spaceAfter=2,
        )))
        for q in check_questions[1:]:
            check_paras.append(Paragraph(
                f"<font color=\"#3a6ea5\">/</font>    {q}",
                ParagraphStyle(
                    "_PrioCardCheckBullet", fontName=KOREAN_FONT,
                    fontSize=10, leading=14, leftIndent=18,
                    textColor=colors.HexColor("#1a3a5a"),
                    spaceAfter=2,
                ),
            ))

    # ------- Row 5: impact framing (4-category business risk) -------
    # Replaces the prior "비즈니스 영향" chip row. Each framing is a
    # category-tagged hedged sentence - operators read 1–2 plausible
    # business interpretations of the signal (not a forecast). The
    # underlying BUSINESS_IMPACT_KO triple stays in the data layer
    # for partner-API exports; only the on-card surface changes.
    framing_paras: list = []
    framings = _impact_framings_for(priority.attribute)
    if framings:
        # Header label + first framing on the same line, additional
        # framings (max 1 more per the 1–2 contract) as a continuation
        # bullet underneath. Bundles into a single cell so the row
        # count stays stable.
        category_color = {
            "전환 위험":      "#a04040",
            "재구매 위험":    "#b07000",
            "CS 비용 증가":   "#3a6ea5",
            "브랜드 인식 위험": "#6a3a8a",
        }
        first = framings[0]
        first_color = category_color.get(first.category_ko, "#666666")
        first_html = (
            f"<font color=\"#a04040\"><b>비즈니스 임팩트</b></font>   "
            f"<font color=\"{first_color}\"><b>[{first.category_ko}]</b></font> "
            f" {first.sentence_ko}"
        )
        framing_paras.append(Paragraph(first_html, ParagraphStyle(
            "_PrioCardFramingHead", fontName=KOREAN_FONT, fontSize=10,
            leading=14, leftIndent=4,
            textColor=colors.HexColor("#3a3a3a"),
            spaceAfter=2,
        )))
        for f in framings[1:]:
            color = category_color.get(f.category_ko, "#666666")
            framing_paras.append(Paragraph(
                f"<font color=\"{color}\"><b>[{f.category_ko}]</b></font> "
                f" {f.sentence_ko}",
                ParagraphStyle(
                    "_PrioCardFramingBullet", fontName=KOREAN_FONT,
                    fontSize=10, leading=14, leftIndent=18,
                    textColor=colors.HexColor("#3a3a3a"),
                    spaceAfter=0,
                ),
            ))

    # Stack the rows in a 1-column outer Table so we can apply the
    # left-accent border + breathable padding consistently.
    # check_paras / framing_paras may contain multiple Paragraphs
    # (1 head + N bullets); bundle each into a single cell so the
    # row count contract stays stable (header / rep / why / check /
    # framing = 5 rows max) regardless of how many questions or
    # framings a given attribute has.
    inner_rows: list[list] = [[header_para]]
    if rep_paras:
        inner_rows.append([rep_paras[0]])
    if why_paras:
        inner_rows.append([why_paras[0]])
    if check_paras:
        inner_rows.append([check_paras])
    if framing_paras:
        inner_rows.append([framing_paras])

    card = Table(inner_rows, colWidths=[160 * mm])
    card.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#dddddd")),
        # Left accent border keyed to the impact tier - visible at-a-glance
        # cue without yet another colored chip.
        ("LINEBEFORE", (0, 0), (0, -1), 3, colors.HexColor(impact_color)),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        # Hairline separators between rows inside the card so the
        # header / quote / why / action visually layer.
        ("LINEBELOW", (0, 0), (-1, -2), 0.3, colors.HexColor("#eeeeee")),
    ]))
    return card


def _build_priority_kpi_table(items: list[PriorityItem]) -> Table | None:
    """Build the Top-N priorities KPI table for the executive summary.

    Columns: # | 이슈 | 빈도 | 우선순위 | 점수 | 비즈니스 리스크.
    Each row pairs a priority with its risk-category chip; the why /
    action phrases render as separate paragraphs underneath the table
    so column widths stay readable.
    """
    if not items:
        return None
    header = ["#", "이슈", "빈도", "우선순위", "점수", "비즈니스 리스크"]
    rows: list[list] = [header]
    for i, p in enumerate(items, 1):
        pct = f"{p.pct_negative * 100:.0f}% ({p.n_negative})"
        risk = p.risk_category or "-"
        rows.append([
            str(i), p.label_ko, pct,
            p.priority_label, f"{p.priority_score:.1f}", risk,
        ])
    col_widths = [10 * mm, 42 * mm, 28 * mm, 22 * mm, 16 * mm, 40 * mm]
    t = Table(rows, colWidths=col_widths, repeatRows=1)
    style_cmds = [
        ("FONTNAME", (0, 0), (-1, -1), KOREAN_FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#222222")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("ALIGN", (2, 0), (2, -1), "CENTER"),
        ("ALIGN", (3, 0), (4, -1), "CENTER"),
        ("ALIGN", (1, 0), (1, -1), "LEFT"),
        ("ALIGN", (5, 0), (5, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cccccc")),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#888888")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
         [colors.white, colors.HexColor("#f8f8f8")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    # Color the priority + risk-category cells per item.
    for r_idx, p in enumerate(items, start=1):
        # Priority chip (col 3)
        prio_bg = colors.HexColor(
            PRIORITY_COLOR.get(p.priority_label, "#999999"),
        )
        style_cmds.append(("BACKGROUND", (3, r_idx), (3, r_idx), prio_bg))
        style_cmds.append(("TEXTCOLOR", (3, r_idx), (3, r_idx), colors.white))
        style_cmds.append(("FONTNAME", (3, r_idx), (3, r_idx), KOREAN_FONT))
        # Risk-category chip (col 5) - only color when category is mapped.
        if p.risk_category and p.risk_category in _RISK_CATEGORY_COLOR:
            risk_bg = colors.HexColor(_RISK_CATEGORY_COLOR[p.risk_category])
            style_cmds.append(("BACKGROUND", (5, r_idx), (5, r_idx), risk_bg))
            style_cmds.append(("TEXTCOLOR", (5, r_idx), (5, r_idx), colors.white))
            style_cmds.append(("FONTNAME", (5, r_idx), (5, r_idx), KOREAN_FONT))
    t.setStyle(TableStyle(style_cmds))
    return t


def _build_strengths_table(items: list[StrengthItem]) -> Table | None:
    """Compact Top-N strengths table - column-light counterpart to the
    priority KPI table. No risk category (strengths aren't risks); no
    why/action phrases (strengths surface verbatim, not action items).
    """
    if not items:
        return None
    header = ["#", "강점", "빈도", "강도", "점수"]
    rows: list[list] = [header]
    for i, s in enumerate(items, 1):
        pct = f"{s.pct_positive * 100:.0f}% ({s.n_positive})"
        rows.append([
            str(i), s.label_ko, pct, s.priority_label,
            f"{s.strength_score:.1f}",
        ])
    col_widths = [10 * mm, 50 * mm, 30 * mm, 24 * mm, 18 * mm]
    t = Table(rows, colWidths=col_widths, repeatRows=1)
    style_cmds = [
        ("FONTNAME", (0, 0), (-1, -1), KOREAN_FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#222222")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ALIGN", (0, 0), (0, -1), "CENTER"),
        ("ALIGN", (2, 0), (-1, -1), "CENTER"),
        ("ALIGN", (1, 0), (1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cccccc")),
        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#888888")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
         [colors.white, colors.HexColor("#f8f8f8")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    # Strength tier color (col 3) - separate green palette from the
    # negative escalation colors so operators don't confuse the two.
    strength_color = {
        "Strong":   "#2e7d32",
        "Moderate": "#5cb85c",
        "Mild":     "#7faa7f",
    }
    for r_idx, s in enumerate(items, start=1):
        bg = colors.HexColor(
            strength_color.get(s.priority_label, "#999999"),
        )
        style_cmds.append(("BACKGROUND", (3, r_idx), (3, r_idx), bg))
        style_cmds.append(("TEXTCOLOR", (3, r_idx), (3, r_idx), colors.white))
        style_cmds.append(("FONTNAME", (3, r_idx), (3, r_idx), KOREAN_FONT))
    t.setStyle(TableStyle(style_cmds))
    return t


# ---------------------------------------------------------------------------
# Snapshot trend section (cross-run comparison)
#
# Wording contract (locked - see .claude/skills/pdf_report_wording_safety.md):
#   - Use 증가 신호 / 감소 신호 / 안정 / 검토 필요
#   - Avoid 악화 / 문제 발생 / 원인 / 개선 필요
#   - Numbers shown as "+8.2%p (87건 → 119건)" so a small percentage shift
#     on a small base remains visible to the reader
#   - Disclaimer text is verbatim and must remain on every render
# ---------------------------------------------------------------------------


_TREND_DISCLAIMER_KO: str = (
    "시계열 신호는 수집 시점과 리뷰 표본 차이에 영향을 받을 수 있으며, "
    "원인 해석은 내부 캠페인/리뉴얼/시즌 정보를 함께 검토해야 합니다."
)


# Hero / value statement - locked stakeholder-visible string.
HERO_TITLE_KO: str = "리뷰 기반 제품 인사이트 리포트"
HERO_VALUE_STATEMENT_KO: str = (
    "실사용 리뷰에서 많이 좋다고 한 점과 구매 전 확인할 포인트를 "
    "정리한 리포트입니다."
)


# Internal-check-question phrases per attribute. 2–3 questions per
# attribute give the operator multiple verification angles
# (option/SKU, environment, customer segment, comparison) instead
# of a single recommendation. The operator reads these as
# conversation starters with internal teams, NOT as prescriptions.
#
# Phrasing rules (locked):
#   - Every phrase ends in 확인할 필요가 있습니다 / 검토가 필요합니다 /
#     확인이 권장됩니다 / 분포 확인이 필요합니다 - composes with the
#     wording-safety contract (hedged candidate form).
#   - Frame as questions the brand can verify internally; never
#     prescribe solutions or mention manufacturing internals
#     (포뮬러, 안료, 베이스 변경, etc.).
#   - Non-judgmental - observational verbs only. No 원인 / 해야
#     합니다 / 개선 필요.
#
# When a future attribute is added, add 2–3 entries here BEFORE
# wiring it into the card; the renderer skips the section silently
# if the entry is missing, so a missed addition surfaces as a
# visible omission rather than a misleading default phrase.
INTERNAL_CHECK_QUESTIONS_KO: dict[str, tuple[str, ...]] = {
    "transfer_resistance": (
        "해당 묻어남 불만이 특정 베이스/마스크 사용 환경에 "
        "집중되는지 확인할 필요가 있습니다.",
        "특정 옵션/호수에서 묻어남 빈도가 더 높게 관측되는지 "
        "내부 검토가 권장됩니다.",
        "묻어남 언급이 사용 시점(외출/식사 후 등)별로 "
        "패턴화되어 있는지 확인이 필요합니다.",
    ),
    "persistence": (
        "지속력 부족 의견이 특정 옵션/색상 또는 계절/환경 조건에 "
        "집중되는지 확인할 필요가 있습니다.",
        "동일 옵션 내에서 지속력 만족 의견이 함께 관측되는지 "
        "비교 검토가 필요합니다.",
        "지속력 언급이 사용 후 시간대별로 분포가 있는지 "
        "확인이 권장됩니다.",
    ),
    "pigmentation": (
        "발색 불만이 특정 옵션/호수/배치에 집중되는지 "
        "확인할 필요가 있습니다.",
        "동일 옵션 내에서 발색 만족 의견과 불만 의견의 분포 "
        "차이가 있는지 검토가 권장됩니다.",
        "발색 언급이 자연광/실내광 사용 환경에 따라 달라지는지 "
        "확인이 필요합니다.",
    ),
    "application_blending": (
        "발림성 불만이 특정 베이스 메이크업/도구 사용 패턴에 "
        "집중되는지 확인할 필요가 있습니다.",
        "발림성 언급이 사용 횟수(첫 사용 vs 반복 사용)에 따라 "
        "달라지는지 분포 확인이 필요합니다.",
    ),
    "adhesion_base_interaction": (
        "베이스 호환성 이슈가 특정 메이크업 제품 조합에 "
        "집중되는지 확인할 필요가 있습니다.",
        "동일 옵션 내에서 베이스 호환 만족 의견이 함께 "
        "관측되는지 비교 검토가 권장됩니다.",
    ),
    "finish_texture": (
        "마무리감 불일치가 특정 옵션/조명/촬영 환경에 "
        "집중되는지 확인할 필요가 있습니다.",
        "마무리감 만족 의견과 불만 의견이 동일 옵션 내에서 "
        "공존하는지 분포 확인이 권장됩니다.",
    ),
    "dryness_skin_texture": (
        "건조감 호소가 특정 피부 타입(건성/민감)에 집중되는지 "
        "확인할 필요가 있습니다.",
        "건조감 언급이 계절/환경 조건과 함께 등장하는지 "
        "패턴 검토가 필요합니다.",
        "동일 옵션 내에서 건조감 만족 의견의 분포가 다른지 "
        "비교 확인이 권장됩니다.",
    ),
    "color_tone_matching": (
        "톤 매칭 불만이 특정 호수/피부 톤 라인업에 "
        "집중되는지 확인할 필요가 있습니다.",
        "톤 매칭 언급이 라인업 내 일부 호수에만 집중되는지 "
        "분포 확인이 필요합니다.",
    ),
    "packaging_container": (
        "용기 불만이 특정 배치/배송 조건/사용 단계에 "
        "집중되는지 확인할 필요가 있습니다.",
        "용기 언급이 첫 사용 시점에 집중되는지 후기 기간별 "
        "분포 확인이 권장됩니다.",
    ),
    "applicator_tool": (
        "도구 품질 불만이 특정 옵션/사용 패턴에 집중되는지 "
        "확인할 필요가 있습니다.",
        "도구 언급이 사용 횟수 또는 청결 관리 패턴에 따라 "
        "달라지는지 검토가 필요합니다.",
    ),
    "value_price": (
        "가격 불만이 특정 옵션/프로모션 시점/경쟁 제품 대비 "
        "비교에서 집중되는지 확인할 필요가 있습니다.",
        "가격 언급이 정가 구매 vs 할인 구매 시점에 따라 "
        "달라지는지 분포 확인이 권장됩니다.",
    ),
    "multi_use_lip_cheek_compatibility": (
        "립앤치크 호환성 이슈가 특정 사용 방식에 집중되는지 "
        "확인할 필요가 있습니다.",
        "립 단독/치크 단독/동시 사용 시점별로 의견이 "
        "달라지는지 분포 확인이 필요합니다.",
    ),
}


def _internal_check_questions_for(attribute: str) -> tuple[str, ...]:
    """Return the canonical internal check questions for an attribute.

    Empty tuple when the attribute is not in
    `INTERNAL_CHECK_QUESTIONS_KO` - callers skip the row silently
    rather than emitting a default phrase, so a missing mapping is
    visible to maintainers.
    """
    return INTERNAL_CHECK_QUESTIONS_KO.get(attribute, ())


# Impact Framing - 4-category business risk mapping, 1–2 framings
# per attribute. Replaces the prior "비즈니스 영향" chip row in the
# Top Signal card with an interpretive sentence keyed by category.
#
# Allowed categories (locked vocabulary):
#   - "전환 위험"          conversion risk
#   - "재구매 위험"        churn / repurchase risk
#   - "CS 비용 증가"       CS cost increase
#   - "브랜드 인식 위험"   brand perception risk
#
# Tone contract (per the user's spec):
#   - Interpretive, NOT definitive - phrases hedge with
#     "영향을 줄 가능성이 있습니다" or "영향을 줄 수 있는 신호로
#     해석됩니다."
#   - No directive verbs (해야 / 개선 필요) and no causal claims
#     (원인 / 발생합니다).
#   - Brand operator reads each framing as ONE plausible business
#     interpretation, not as a forecast.

IMPACT_FRAMING_CATEGORIES_KO: frozenset[str] = frozenset({
    "전환 위험",
    "재구매 위험",
    "CS 비용 증가",
    "브랜드 인식 위험",
})


@dataclass(frozen=True)
class ImpactFraming:
    """One category-tagged business interpretation of a signal."""
    category_ko: str   # must be one of IMPACT_FRAMING_CATEGORIES_KO
    sentence_ko: str   # hedged interpretive sentence


IMPACT_FRAMING_KO: dict[str, tuple[ImpactFraming, ...]] = {
    "transfer_resistance": (
        ImpactFraming(
            "브랜드 인식 위험",
            "묻어남 경험이 사용 불쾌감으로 이어져 브랜드 인식에 "
            "영향을 줄 가능성이 있습니다.",
        ),
        ImpactFraming(
            "CS 비용 증가",
            "묻어남 관련 환불/교환 문의가 발생할 수 있는 "
            "신호로 해석됩니다.",
        ),
    ),
    "persistence": (
        ImpactFraming(
            "재구매 위험",
            "지속력 부족 의견이 재구매에 영향을 줄 가능성이 "
            "있습니다.",
        ),
        ImpactFraming(
            "전환 위험",
            "경쟁 제품 대비 평가에 영향을 줄 수 있는 신호로 "
            "해석됩니다.",
        ),
    ),
    "pigmentation": (
        ImpactFraming(
            "전환 위험",
            "발색 불만이 첫 구매 후 만족도와 재구매 전환에 "
            "영향을 줄 가능성이 있습니다.",
        ),
        ImpactFraming(
            "브랜드 인식 위험",
            "광고/이미지 대비 실제 발색 신뢰도에 영향을 줄 수 있는 "
            "신호로 해석됩니다.",
        ),
    ),
    "application_blending": (
        ImpactFraming(
            "재구매 위험",
            "발림성 불만이 사용 만족도와 재구매에 영향을 줄 "
            "가능성이 있습니다.",
        ),
    ),
    "adhesion_base_interaction": (
        ImpactFraming(
            "재구매 위험",
            "베이스 호환성 이슈가 동일 브랜드 내 다른 제품 사용 "
            "의사에 영향을 줄 수 있는 신호로 해석됩니다.",
        ),
    ),
    "finish_texture": (
        ImpactFraming(
            "브랜드 인식 위험",
            "마무리감 불일치가 제품 콘셉트 신뢰도에 영향을 줄 "
            "가능성이 있습니다.",
        ),
        ImpactFraming(
            "재구매 위험",
            "첫 사용 만족도가 재구매에 영향을 줄 수 있는 "
            "신호로 해석됩니다.",
        ),
    ),
    "dryness_skin_texture": (
        ImpactFraming(
            "재구매 위험",
            "건조감 호소가 민감/건성 피부 고객층의 재구매에 "
            "영향을 줄 가능성이 있습니다.",
        ),
        ImpactFraming(
            "브랜드 인식 위험",
            "특정 피부 타입에서의 사용 경험이 브랜드 인식에 "
            "영향을 줄 수 있는 신호로 해석됩니다.",
        ),
    ),
    "color_tone_matching": (
        ImpactFraming(
            "전환 위험",
            "톤 매칭 불만이 첫 구매 시 호수 선택에 영향을 줄 "
            "가능성이 있습니다.",
        ),
        ImpactFraming(
            "CS 비용 증가",
            "톤 매칭 관련 환불/교환 문의가 발생할 수 있는 "
            "신호로 해석됩니다.",
        ),
    ),
    "packaging_container": (
        ImpactFraming(
            "브랜드 인식 위험",
            "용기 불만이 첫인상과 선물용 구매 의사에 영향을 줄 "
            "가능성이 있습니다.",
        ),
    ),
    "applicator_tool": (
        ImpactFraming(
            "브랜드 인식 위험",
            "도구 품질이 제품 전반에 대한 인상에 영향을 줄 "
            "가능성이 있습니다.",
        ),
        ImpactFraming(
            "재구매 위험",
            "도구 사용 경험이 재구매에 영향을 줄 수 있는 "
            "신호로 해석됩니다.",
        ),
    ),
    "value_price": (
        ImpactFraming(
            "전환 위험",
            "가격 불만이 첫 구매 결정과 경쟁 제품 대비 선택에 "
            "영향을 줄 가능성이 있습니다.",
        ),
        ImpactFraming(
            "재구매 위험",
            "가격 인식이 재구매 의사에 영향을 줄 수 있는 "
            "신호로 해석됩니다.",
        ),
    ),
    "multi_use_lip_cheek_compatibility": (
        ImpactFraming(
            "전환 위험",
            "립앤치크 호환성 불만이 멀티유즈 소비자의 첫 구매 "
            "만족도에 영향을 줄 가능성이 있습니다.",
        ),
    ),
}


def _impact_framings_for(attribute: str) -> tuple[ImpactFraming, ...]:
    """Return canonical impact framings for an attribute.

    Empty tuple when the attribute is not in `IMPACT_FRAMING_KO` -
    callers skip the row silently rather than emitting a default
    phrase, so a missing mapping is visible to maintainers.
    """
    return IMPACT_FRAMING_KO.get(attribute, ())


# Report-basis label - reads the corpus_type / is_full_corpus from
# CorpusProvenance and returns the operator-facing phrase that the
# Key Metrics strip prints. Three known cases per the data contract;
# unknown corpus types fall through to a conservative default.
def _report_basis_label_ko(provenance) -> str:
    """Return the operator-visible phrase describing the report's
    denominator basis.

    Three canonical phrases per the data contract:
      - "전체 리뷰 기준"          when is_full_corpus=True
      - "직전 N일 신규 리뷰 기준"  when corpus_type=partner_incremental_api
      - "최신순 수집 코퍼스 기준"   for observed_scrape (default)

    `provenance` is the optional `CorpusProvenance` carried alongside
    the snapshot. None → fall through to the safest "최신순 수집
    코퍼스 기준" wording so the operator never reads a partial
    scrape as whole-corpus.
    """
    if provenance is None:
        return "최신순 수집 코퍼스 기준"
    if getattr(provenance, "is_full_corpus", False):
        return "전체 리뷰 기준"
    corpus_type = getattr(provenance, "corpus_type", None)
    if corpus_type == "partner_incremental_api":
        return "직전 N일 신규 리뷰 기준"
    return "최신순 수집 코퍼스 기준"


def _short_attr_label(attribute: str) -> str:
    """Shortened Korean label (drops the English gloss in parens)."""
    label = ATTRIBUTE_LABELS_KO.get(attribute, attribute)
    return label.split("(")[0].strip()


def _format_yyyy_mm_dd(iso: str) -> str:
    """Render an ISO timestamp as YYYY-MM-DD for trend headers."""
    return iso.split("T")[0]


def _format_share_delta_line(d: AttributeDelta) -> str:
    """Single-line numeric framing for a delta card.

    Format: "+8.2%p (12건 → 25건)" - percentage-point delta paired
    with absolute counts so a small share shift on a small base
    stays readable.
    """
    assert d.negative_share_delta is not None
    assert d.n_negative_current is not None
    assert d.n_negative_previous is not None
    pp = d.negative_share_delta * 100.0
    sign = "+" if pp >= 0 else ""
    return (
        f"{sign}{pp:.1f}%p ({d.n_negative_previous}건 → "
        f"{d.n_negative_current}건)"
    )


def _confidence_chip_html(level: str) -> str:
    """Inline-HTML chip for the corpus confidence level. Always
    rendered near the section header. Run-003 QA pass-2: chip text
    uses the operator-friendly four-axis labels (`표본 충분`,
    `표본 보통`, `참고 수준`) so the rendered string never collapses
    to forbidden tokens like "신뢰도 높음"."""
    if level == "high":
        return (
            '<b><font color="#3a7a3a">[표본 충분]</font></b>'
        )
    if level == "medium":
        return (
            '<b><font color="#b07000">[표본 보통]</font></b>'
        )
    return (
        '<b><font color="#a04040">[참고 수준 — 방향성만 해석]</font></b>'
    )


def _build_snapshot_trend_section(
    comparison: SnapshotComparison,
    confidence_level: str,
    styles: dict,
    *,
    section_number: str = "9",
) -> list:
    """Build the "최근 변화 신호" section flowables.

    Layout paths (driven by `comparison.comparability_status`):
      - "no_previous"               - first run, graceful placeholder
      - "non_primary_sort"          - corpus is biased; refuse to compare
      - "incomparable_sort"         - sort_type mismatch
      - "incomparable_cap"          - cap_policy mismatch
      - "incomparable_corpus_type"  - observed vs partner mismatch
      - "incomparable_strategy"     - sampling_strategy mismatch
      - "incomparable_sample_size"  - >30% relative N mismatch
      - "ok"                        - full delta surface

    Confidence-level handling (always applied):
      - The `[신뢰도: …]` chip renders on every path, immediately
        after the section header.
      - When `confidence_level == "low"`, the wording lock kicks in
        on the "ok" path: directional bands instead of percentages,
        "추가 관찰 후보" instead of "검토 필요", `top_improving`
        suppressed entirely, new-attributes shown as names only.
      - Coverage warning + locked disclaimer on every path.
    """
    out: list = []
    out.append(Paragraph(
        f"{section_number}. 최근 변화 신호 (Snapshot Trend)",
        styles["h2"],
    ))
    out.append(Spacer(1, 2))

    # Confidence chip - always rendered, regardless of status. The
    # chip is the operator's first visual cue for how to read the
    # trend numbers (or whether there are any to read at all).
    out.append(Paragraph(_confidence_chip_html(confidence_level), styles["body"]))
    out.append(Spacer(1, 4))

    # Basis label - applied at the section level so every ratio
    # below inherits it. Locked by tests; see
    # .claude/skills/pdf_report_wording_safety.md for the rule.
    out.append(Paragraph(
        "<b>분석 기준</b>: 최신순 수집 코퍼스 기준 "
        "(시간순 정렬에서 수집된 리뷰만; 평점순/추천순 등 대표 리뷰 참고 정렬은 "
        "근거 강도 메타데이터로만 사용되며 분모에 포함되지 않습니다).",
        styles["methodology_note"],
    ))
    out.append(Spacer(1, 4))

    status = comparison.comparability_status
    is_low = (confidence_level == "low")

    # Comparability-failure paths: emit the reason, skip delta UI.
    if status == "no_previous":
        out.append(Paragraph(
            "이전 수집 기록이 없어 비교 신호를 제공할 수 없습니다. "
            "다음 수집 시 비교가 활성화됩니다.",
            styles["body"],
        ))
        return _close_trend_section(out, comparison, styles)
    if status in (
        "non_primary_sort",
        "incomparable_sort",
        "incomparable_cap",
        "incomparable_corpus_type",
        "incomparable_strategy",
        "incomparable_sample_size",
    ):
        reason = comparison.comparability_reason or ""
        out.append(Paragraph(
            f"<i>{reason}</i>",
            styles["body"],
        ))
        return _close_trend_section(out, comparison, styles)

    # status == "ok" - compared-period header + delta lines.
    cur_d = _format_yyyy_mm_dd(comparison.current_collected_at)
    prev_d = _format_yyyy_mm_dd(comparison.previous_collected_at or "")
    days = comparison.days_between
    days_phrase = f", {days}일 전" if days is not None else ""
    out.append(Paragraph(
        f"이번 수집 (<b>{cur_d}</b>) vs 직전 수집 "
        f"(<b>{prev_d}</b>{days_phrase})",
        styles["body"],
    ))
    out.append(Spacer(1, 6))

    # Top rising line - wording diverges by confidence_level.
    if comparison.top_rising is not None:
        d = comparison.top_rising
        label = _short_attr_label(d.attribute)
        if is_low:
            # Suppress exact deltas; replace "검토 필요" with
            # "추가 관찰 후보" - the signal is too weak to ground
            # an action call.
            line = (
                f"<b><font color=\"#a04040\">[증가 신호]</font></b> "
                f"  <b>{label}</b> - {LOW_CONFIDENCE_ACTION_CHIP_KO} "
                f"  <font color=\"#777777\">"
                f"{LOW_CONFIDENCE_DIRECTIONAL_RISING_KO}</font>"
            )
        else:
            line = (
                f"<b><font color=\"#a04040\">[증가 신호]</font></b> "
                f"  <b>{label}</b> - 검토 필요   "
                f"<font color=\"#777777\">"
                f"{_format_share_delta_line(d)}</font>"
            )
        out.append(Paragraph(line, styles["body"]))
    else:
        out.append(Paragraph(
            "<i>유의미한 증가 신호 없음.</i>",
            styles["body"],
        ))

    # Top improving line - fully suppressed under low confidence.
    # Claiming an improvement on noisy data risks crediting noise
    # for changes that aren't real.
    if not is_low:
        out.append(Spacer(1, 4))
        if comparison.top_improving is not None:
            d = comparison.top_improving
            label = _short_attr_label(d.attribute)
            line = (
                f"<b><font color=\"#3a7a3a\">[감소 신호]</font></b> "
                f"  <b>{label}</b>   "
                f"<font color=\"#777777\">"
                f"{_format_share_delta_line(d)}</font>"
            )
            out.append(Paragraph(line, styles["body"]))
        else:
            out.append(Paragraph(
                "<i>유의미한 감소 신호 없음.</i>",
                styles["body"],
            ))

    # New attributes - names only on every path; under low confidence
    # the names list is the entirety of the new-attribute surface
    # (no counts, no thresholds).
    if comparison.new_attributes:
        labels = ", ".join(
            _short_attr_label(d.attribute) for d in comparison.new_attributes
        )
        out.append(Spacer(1, 4))
        out.append(Paragraph(
            "<i>이번 수집에서 처음 부정 의견이 관측된 속성: "
            f"{labels}.</i>",
            styles["body"],
        ))

    return _close_trend_section(out, comparison, styles)


def _close_trend_section(
    out: list, comparison: SnapshotComparison, styles: dict,
) -> list:
    """Append coverage warning (if any) and the locked disclaimer.

    Centralized so every layout path emits the same closing block.
    """
    if comparison.coverage_warning:
        out.append(Spacer(1, 6))
        out.append(Paragraph(
            f"<b><font color=\"#b07000\">[표본 커버리지 안내]</font></b> "
            f"{comparison.coverage_warning}",
            styles["body"],
        ))
    out.append(Spacer(1, 6))
    out.append(Paragraph(
        f"<i>{_TREND_DISCLAIMER_KO}</i>",
        styles["methodology_note"],
    ))
    return out


# ---------------------------------------------------------------------------
# New (2026-04-28) PDF section helpers - interview-conversion redesign.
# Each helper returns a list[Flowable] so the main render flow stays a
# straightforward append/extend chain.
# ---------------------------------------------------------------------------


def _build_hero_section(data, styles: dict) -> list:
    """1. Hero - product name + report title + 1-line value statement.

    Reads as a magazine cover: the operator opening the PDF should see
    WHAT product and WHAT report within one breath. The Executive
    Summary block (built separately) carries the actual headline.
    """
    out: list = []
    out.append(Paragraph(data.product_name, styles["title"]))
    out.append(Paragraph(HERO_TITLE_KO, styles["subtitle"]))
    out.append(Paragraph(HERO_VALUE_STATEMENT_KO, styles["tagline"]))
    return out


def _build_executive_summary_box(
    *,
    data,
    exec_summary,
    overall_level: str,
    n_reviews: int,
    provenance,
    corpus_metadata: dict | None,
    styles: dict,
) -> list:
    """Executive Summary block - sits at the top of the report under
    the hero. Carries the operator-facing 30-second answer:

      - Overall signal level chip (양호 / 관찰 필요 / 주의)
      - Main takeaway sentence (mode-conditional)
      - Top 2 monitoring candidates (label + denominator basis)
      - Data basis line ("기존 DB 누적 N건 / 기본 정렬 표본 기준")
      - For LOW products: "Why this still matters" framing note
        below the takeaway.

    No internal score chips, no mixed-language subtitles, no
    English clutter. Korean business-report tone throughout.
    """
    out: list = []
    mode = _overall_signal_mode(overall_level)

    out.append(Paragraph(
        "1. 핵심 요약 (Executive Summary)", styles["h2"],
    ))
    out.append(Spacer(1, 4))

    # Overall signal level chip + takeaway sentence in a verdict-style
    # box. One color-keyed chip at the top, then prose.
    chip_html = (
        f"<font color=\"{mode['level_color']}\"><b>"
        f"[종합 평가: {mode['level_label_ko']}]</b></font>"
    )
    out.append(Paragraph(chip_html, styles["body"]))
    out.append(Spacer(1, 2))
    out.append(Paragraph(mode["takeaway_ko"], styles["verdict"]))
    out.append(Spacer(1, 6))

    # Top 2 monitoring candidates - just label + denominator basis,
    # no chips/scores. "Look at these two areas" is enough.
    if exec_summary.top_priorities:
        out.append(Paragraph(
            "<b>주요 확인 포인트</b>",
            styles["body"],
        ))
        for i, p in enumerate(exec_summary.top_priorities[:2], 1):
            attr_summary = data.attribute_summaries.get(p.attribute)
            attr_mentions = (
                attr_summary.n_total if attr_summary is not None else 0
            )
            denom_phrase = (
                f"분석 리뷰 {n_reviews:,}건 중 {p.n_negative}건"
                if n_reviews else f"부정 {p.n_negative}건"
            )
            if attr_mentions and attr_mentions > 0:
                denom_phrase += (
                    f" (해당 속성 언급 {attr_mentions}건 중 부정 "
                    f"{p.n_negative}건)"
                )
            out.append(Paragraph(
                f" {i}. <b>{p.label_ko}</b> - {denom_phrase}",
                styles["body"],
            ))
            out.append(Spacer(1, 1))

    # Data basis line - single sentence describing what the report
    # is based on. Honest about scrape skipped vs fresh collection.
    out.append(Spacer(1, 4))
    basis_line = _format_data_basis_line(
        n_reviews=n_reviews,
        provenance=provenance,
        corpus_metadata=corpus_metadata,
    )
    out.append(Paragraph(
        f"<b>분석 기준</b>: {basis_line}",
        styles["methodology_note"],
    ))

    # "Why this still matters" note for LOW products - keeps the
    # report useful even when the headline is "양호." Surfaces only
    # when the top monitoring candidate has a known business framing.
    if overall_level == "LOW" and exec_summary.top_priorities:
        top = exec_summary.top_priorities[0]
        why_note = _why_this_still_matters_note(top)
        if why_note:
            out.append(Spacer(1, 4))
            out.append(Paragraph(
                f"<i><font color=\"#666666\">{why_note}</font></i>",
                styles["methodology_note"],
            ))

    return out


def _format_data_basis_line(
    *, n_reviews: int, provenance, corpus_metadata: dict | None,
) -> str:
    """Single Korean sentence describing the analysis basis. Combines
    review count + corpus-type framing without manufacturing claims."""
    basis_label = _report_basis_label_ko(provenance)
    if corpus_metadata and corpus_metadata.get("scrape_skipped"):
        return (
            f"기존 DB 누적 {n_reviews:,}건 / {basis_label}"
        )
    return f"분석 리뷰 {n_reviews:,}건 / {basis_label}"


def _why_this_still_matters_note(top_priority) -> str | None:
    """Generic "why this still matters" framing keyed by attribute.
    Returns None when no template applies. Phrasing is intentionally
    soft - the report stays useful for healthy products by surfacing
    where the operator might find latent value, not by manufacturing
    urgency."""
    label = top_priority.label_ko
    attr = top_priority.attribute
    if attr in ("color_tone_matching", "pigmentation"):
        return (
            f"현재 아쉬움 의견은 낮은 수준이지만, {label} 관련 의견은 "
            "구매 전 기대치와 직접 연결되므로 상세페이지/옵션명/"
            "발색 이미지와 함께 확인할 가치가 있습니다."
        )
    if attr in ("transfer_resistance", "persistence"):
        return (
            f"현재 아쉬움 의견은 낮은 수준이지만, {label} 관련 의견은 "
            "사용 환경/시간대에 따라 분포가 달라질 수 있어 옵션·계절 "
            "신호와 함께 모니터링 가치가 있습니다."
        )
    if attr in ("packaging_container", "applicator_tool"):
        return (
            f"현재 아쉬움 의견은 낮은 수준이지만, {label} 관련 의견은 "
            "선물/재구매 의사와 연결될 수 있어 사용 단계별 분포 "
            "확인 가치가 있습니다."
        )
    return None


def _build_key_metrics_context_line(
    *,
    provenance,
    confidence_level: str | None,
) -> Paragraph:
    """Sub-line under the Key Metrics strip - coverage / confidence /
    basis chips on a single line.

    Mirrors the wording-safety contract: every label maps to a
    locked Korean phrase, basis label derives from
    `_report_basis_label_ko`, and `coverage_ratio` is shown only
    when provenance carries a real number (None → label "정보 없음").
    """
    basis_ko = _report_basis_label_ko(provenance)

    # Run-003 QA pass-2: separate the chip label from the legacy
    # "높음/보통/낮음" verdict so the rendered text reads as the
    # operator-friendly four-axis label, not "신뢰도 높음" (forbidden
    # in PDF body text).
    confidence_ko = "정보 없음"
    confidence_color = "#666666"
    if confidence_level == "high":
        confidence_ko = "표본 충분"
        confidence_color = "#3a7a3a"
    elif confidence_level == "medium":
        confidence_ko = "표본 보통"
        confidence_color = "#b07000"
    elif confidence_level == "low":
        confidence_ko = "참고 수준"
        confidence_color = "#a04040"

    coverage_phrase = "정보 없음"
    if provenance is not None:
        coverage = getattr(provenance, "coverage_ratio", None)
        total = getattr(provenance, "total_review_count_available", None)
        collected = getattr(
            provenance, "collected_primary_review_count", None,
        )
        if isinstance(coverage, (int, float)):
            coverage_phrase = f"{coverage * 100:.0f}%"
            if isinstance(total, int) and isinstance(collected, int):
                coverage_phrase += f" ({collected}/{total}건)"
        elif isinstance(collected, int):
            coverage_phrase = f"전체 미상 ({collected}건 수집)"

    line_html = (
        f"<b>분석 기준</b>  {basis_ko}   |  "
        f"<b>리뷰 수 기준</b>  <font color=\"{confidence_color}\">"
        f"<b>{confidence_ko}</b></font>   |  "
        f"<b>커버리지</b>  {coverage_phrase}"
    )
    return Paragraph(line_html, ParagraphStyle(
        "_KMContext", fontName=KOREAN_FONT, fontSize=9.5,
        leading=13, textColor=colors.HexColor("#444444"),
        alignment=1,  # centered
        spaceBefore=4, spaceAfter=4,
    ))


def _build_strengths_block(
    exec_summary, styles: dict, *, section_number: str = "6",
) -> list:
    """Strengths - short, with a "preserve while checking concerns"
    framing. Card-shaped, not a dense table.

    `section_number` parameterizes the section header so the caller
    controls numbering. Default kept at "6" for backward compatibility
    with existing callers / tests.
    """
    out: list = []
    out.append(Paragraph(
        f"{section_number}. 반복된 만족 포인트", styles["h2"],
    ))
    out.append(Spacer(1, 4))
    if not exec_summary.top_strengths:
        out.append(Paragraph(
            "<i>핵심 강점으로 식별된 항목이 없습니다.</i>",
            styles["body"],
        ))
        return out

    # Compact one-line-per-strength rendering - a dense table here
    # adds visual weight without adding signal. Two strengths max
    # is enough for the cover-narrative role this section plays.
    for s in exec_summary.top_strengths[:2]:
        line_html = (
            f"<b>{s.label_ko}</b>    "
            f"<font color=\"#3a7a3a\"><b>[{s.priority_label}]</b></font> "
            f" |  <font color=\"#444444\">"
            f"긍정 비중 {s.pct_positive * 100:.0f}% "
            f"({s.n_positive}건)</font>"
        )
        out.append(Paragraph(line_html, styles["body"]))
        out.append(Spacer(1, 2))

    out.append(Spacer(1, 4))
    out.append(Paragraph(
        "<i>강점 신호는 우려 검토와 별개로 유지/보강 후보로 다룰 수 "
        "있습니다. 우려 검토 시 강점 영역까지 영향이 가지 않도록 함께 "
        "확인하는 것이 권장됩니다.</i>",
        styles["methodology_note"],
    ))
    return out


# Locked Korean phrases for the Data Coverage Context section.
# Stakeholder-visible; pair changes with the locked tests in
# tests/test_reporting/test_phase2e/test_pdf_layout_smoke.py.
DATA_COVERAGE_OBSERVED_KO: str = (
    "전체 리뷰 중 일부 구간(최신순/추천순 등)을 기반으로 "
    "수집된 리뷰에서 확인된 결과입니다."
)
DATA_COVERAGE_FULL_CORPUS_KO: str = "전체 리뷰 기준 분석입니다."
DATA_COVERAGE_INCREMENTAL_KO: str = (
    "직전 기간의 신규 리뷰 구간을 기반으로 "
    "수집된 리뷰에서 확인된 결과입니다."
)


def _build_data_coverage_context_section(
    *,
    provenance,
    styles: dict,
    section_number: str = "3",
) -> list:
    """Data Coverage Context - explicit scope statement.

    Sits between Key Metrics (§2) and Executive Verdict (§4). Surfaces
    three coverage figures (total / collected / ratio) plus a locked
    corpus-type sentence that tells the operator what scope the
    downstream conclusions sit within. Tone is non-definitive and
    interpretive - phrases end in 결과입니다 / 분석입니다, no
    directive verbs.

    Three corpus-type cases (locked phrases - see DATA_COVERAGE_*_KO):
      - observed_scrape       → "전체 리뷰 중 일부 구간(최신순/추천순
                                 등)을 기반으로 수집된 리뷰에서
                                 확인된 결과입니다."
      - partner_full_export   → "전체 리뷰 기준 분석입니다."
      - partner_incremental_api → "직전 기간의 신규 리뷰 구간을
                                   기반으로 수집된 리뷰에서
                                   확인된 결과입니다."

    Coverage figures rendering rules:
      - When total_review_count_available is known and > 0:
        show "전체 N건 중 M건 분석 (커버리지 X%)".
      - When total is unknown but collected is known:
        show "분석 대상 N건 (전체 리뷰 수 미상)".
      - When provenance is None entirely:
        the section emits a graceful "정보 없음" placeholder so
        legacy callers don't crash.
    """
    out: list = []
    out.append(Paragraph(
        f"{section_number}. 데이터 커버리지와 해석 한계",
        styles["h2"],
    ))
    out.append(Spacer(1, 4))

    if provenance is None:
        out.append(Paragraph(
            "<i>코퍼스 정보가 전달되지 않아 커버리지 안내를 "
            "제공할 수 없습니다.</i>",
            styles["body"],
        ))
        return out

    corpus_type = getattr(provenance, "corpus_type", None)
    is_full = bool(getattr(provenance, "is_full_corpus", False))
    total = getattr(provenance, "total_review_count_available", None)
    collected = getattr(provenance, "collected_primary_review_count", None)
    coverage = getattr(provenance, "coverage_ratio", None)

    # Coverage line - three rendering paths (known total / unknown
    # total / nothing). Numbers are factual; the corpus-type
    # sentence below carries the interpretive tone.
    if (
        isinstance(total, int) and total > 0
        and isinstance(collected, int) and collected >= 0
    ):
        ratio_str = ""
        if isinstance(coverage, (int, float)):
            ratio_str = f"  |  커버리지 <b>{coverage * 100:.0f}%</b>"
        out.append(Paragraph(
            f"전체 리뷰 <b>{total:,}건</b> 중 분석 대상 "
            f"<b>{collected:,}건</b>{ratio_str}",
            styles["body"],
        ))
    elif isinstance(collected, int) and collected >= 0:
        out.append(Paragraph(
            f"분석 대상 <b>{collected:,}건</b> (전체 리뷰 수 미상)",
            styles["body"],
        ))
    else:
        out.append(Paragraph(
            "<i>리뷰 수 정보가 누락되었습니다.</i>",
            styles["body"],
        ))
    out.append(Spacer(1, 4))

    # Locked corpus-type sentence - drives operator interpretation
    # of every downstream ratio.
    if is_full and corpus_type == "partner_full_export":
        sentence = DATA_COVERAGE_FULL_CORPUS_KO
        sentence_color = "#3a7a3a"
    elif corpus_type == "partner_incremental_api":
        sentence = DATA_COVERAGE_INCREMENTAL_KO
        sentence_color = "#3a6ea5"
    else:
        # observed_scrape, PAGE_DEFAULT, signal-sort runs all fall
        # through to the conservative "일부 구간" framing - never
        # claim full-corpus coverage without is_full_corpus=True.
        sentence = DATA_COVERAGE_OBSERVED_KO
        sentence_color = "#b07000"
    out.append(Paragraph(
        f"<font color=\"{sentence_color}\"><b>{sentence}</b></font>",
        styles["body"],
    ))

    # Explicit "out-of-scope" disclosure — required for business-report
    # honesty per the methodology contract. The current pipeline does
    # NOT compute category averages, competitor benchmarks, or rolling
    # time-series; surfacing that absence prevents the reader from
    # silently assuming an unsupported comparison.
    out.append(Spacer(1, 6))
    out.append(Paragraph(
        "<i><font color=\"#666666\">"
        "본 리포트는 단일 제품의 리뷰 단면을 정리한 자료이며, "
        "카테고리 평균 / 경쟁 제품 / 시계열 추세는 현재 데이터 범위 밖입니다."
        "</font></i>",
        styles["methodology_note"],
    ))

    return out


def _build_buyer_segment_section(
    detection: SegmentDetection,
    *,
    n_reviews_total: int,
    overall_level: str,
    styles: dict,
    section_number: str = "4",
) -> list:
    """구매자 관점 세그먼트 신호 - dual-use decision-support section.

    Top of section: QuickDecisionSummary box answering "should I
    buy this in my situation?" in 3 lines (who-it-works-for /
    who-should-check-more / simple-takeaway).

    Below: 0-3 segment cards (best-fit / caution / option) each
    carrying a decision_hint_ko line, denominator-aware count, a
    content-friendly quote, plus seller and buyer notes.

    Theme contrasts (자연스러움 vs 발색력 / 데일리 vs 포인트 /
    실내 vs 야외) surface as a closing observational paragraph
    when both sides of a theme have signals.
    """
    out: list = []
    out.append(Paragraph(
        f"{section_number}. 구매자 관점 세그먼트 신호",
        styles["h2"],
    ))
    out.append(Spacer(1, 4))
    out.append(Paragraph(
        "<i>리뷰 본문에서 직접 언급된 톤/피부 타입/사용 맥락/마무리 "
        "선호만 집계한 결과입니다. 추론은 포함하지 않습니다.</i>",
        styles["methodology_note"],
    ))
    out.append(Spacer(1, 8))

    # Top: Quick Decision Summary - the SNS card-1 core, also
    # rendered prominently here as the section's headline answer.
    quick = build_quick_decision_summary(
        detection,
        overall_level=overall_level,
        n_reviews_total=n_reviews_total,
    )
    qds_rows: list[list] = []
    qds_rows.append([Paragraph(
        f"<b>잘 맞을 가능성</b>: {quick.who_it_works_for}",
        ParagraphStyle(
            "_QDSWho", fontName=KOREAN_FONT, fontSize=10.5,
            leading=15, textColor=colors.HexColor("#1a1a1a"),
            spaceAfter=2,
        ),
    )])
    qds_rows.append([Paragraph(
        f"<b>구매 전 확인</b>: {quick.who_should_check_more}",
        ParagraphStyle(
            "_QDSCheck", fontName=KOREAN_FONT, fontSize=10.5,
            leading=15, textColor=colors.HexColor("#1a1a1a"),
            spaceAfter=2,
        ),
    )])
    qds_rows.append([Paragraph(
        f"<i><font color=\"#444444\">{quick.simple_takeaway}</font></i>",
        ParagraphStyle(
            "_QDSTake", fontName=KOREAN_FONT, fontSize=10,
            leading=14, textColor=colors.HexColor("#3a3a3a"),
            spaceAfter=0,
        ),
    )])
    qds_box = Table(qds_rows, colWidths=[160 * mm])
    qds_box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f5f8fa")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#ccd6dc")),
        ("LINEBEFORE", (0, 0), (0, -1), 3, colors.HexColor("#3a6ea5")),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    out.append(KeepTogether([qds_box, Spacer(1, 10)]))

    signals = build_pdf_buyer_signals(
        detection, n_reviews_total=n_reviews_total,
    )
    if not signals:
        out.append(Paragraph(
            "<i>구매자 세그먼트 분류에 충분한 명시적 언급이 "
            "관측되지 않았습니다. 추후 표본 누적 시 재집계 "
            "후보입니다.</i>",
            styles["body"],
        ))
        return out

    # Card titles per slot in build_pdf_buyer_signals output order:
    # 0=best-fit, 1=caution, 2=option/seller-page
    slot_titles = (
        "어떤 구매자에게 만족 의견이 누적되었는가",
        "구매 전 확인이 필요한 맥락",
        "상세페이지/옵션 정보로 보강할 수 있는 포인트",
    )
    slot_accent_colors = ("#3a7a3a", "#b07000", "#3a6ea5")

    for i, sig in enumerate(signals):
        slot_title = (
            slot_titles[i] if i < len(slot_titles)
            else "추가 세그먼트 신호"
        )
        accent = (
            slot_accent_colors[i] if i < len(slot_accent_colors)
            else "#666666"
        )
        rows: list[list] = []

        header_html = (
            f"<b>{i+1}. {slot_title}</b>    "
            f"<font color=\"{accent}\"><b>[{sig.label_ko}]</b></font>"
        )
        rows.append([Paragraph(header_html, ParagraphStyle(
            "_BSHead", fontName=KOREAN_FONT, fontSize=11,
            leading=15, textColor=colors.HexColor("#1a1a1a"),
            spaceAfter=4,
        ))])

        # Count + denominator
        if sig.denominator > 0:
            count_html = (
                f"<font color=\"#444444\">관측 {sig.n_count}건  "
                f"({sig.denominator_basis_ko})</font>"
            )
        else:
            count_html = (
                f"<font color=\"#444444\">관측 {sig.n_count}건  "
                f"({sig.denominator_basis_ko})</font>"
            )
        rows.append([Paragraph(count_html, ParagraphStyle(
            "_BSCount", fontName=KOREAN_FONT, fontSize=10,
            leading=14, leftIndent=4,
            textColor=colors.HexColor("#3a3a3a"),
            spaceAfter=2,
        ))])

        # Decision hint - the soft-recommendation line that
        # answers "should I buy this in my situation?"
        if sig.decision_hint_ko:
            rows.append([Paragraph(
                f"<font color=\"{accent}\"><b>판단 도움</b></font>  "
                f"<b>{sig.decision_hint_ko}</b>",
                ParagraphStyle(
                    "_BSHint", fontName=KOREAN_FONT, fontSize=10.5,
                    leading=14, leftIndent=4,
                    textColor=colors.HexColor("#1a1a1a"),
                    spaceAfter=4,
                ),
            )])

        # Representative quote (verbatim from review)
        if sig.representative_quote:
            quote_safe = (
                sig.representative_quote
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
            )
            rows.append([Paragraph(
                f"<font color=\"#3a3a3a\">&ldquo;{quote_safe}&rdquo;</font>",
                ParagraphStyle(
                    "_BSQuote", fontName=KOREAN_FONT, fontSize=10,
                    leading=14, leftIndent=4,
                    textColor=colors.HexColor("#3a3a3a"),
                    spaceAfter=4,
                ),
            )])

        # Seller use note
        rows.append([Paragraph(
            f"<font color=\"#666666\"><b>판매자 활용</b></font>  "
            f"{sig.seller_note_ko}",
            ParagraphStyle(
                "_BSSeller", fontName=KOREAN_FONT, fontSize=10,
                leading=14, leftIndent=4,
                textColor=colors.HexColor("#3a3a3a"),
                spaceAfter=2,
            ),
        )])
        # Buyer use note
        rows.append([Paragraph(
            f"<font color=\"#666666\"><b>구매자 참고</b></font>  "
            f"{sig.buyer_note_ko}",
            ParagraphStyle(
                "_BSBuyer", fontName=KOREAN_FONT, fontSize=10,
                leading=14, leftIndent=4,
                textColor=colors.HexColor("#3a3a3a"),
                spaceAfter=0,
            ),
        )])

        card = Table(rows, colWidths=[160 * mm])
        card.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.white),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BOX", (0, 0), (-1, -1), 0.4, colors.HexColor("#dddddd")),
            ("LINEBEFORE", (0, 0), (0, -1), 3, colors.HexColor(accent)),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]))
        out.append(KeepTogether([card, Spacer(1, 8)]))

    # Theme-level contrasts as a closing observational paragraph.
    # Surfaces only when both sides of a theme have signals.
    contrasts = detect_theme_contrasts(detection)
    if contrasts:
        out.append(Spacer(1, 4))
        out.append(Paragraph(
            "<b>관찰된 대비 신호</b>",
            ParagraphStyle(
                "_BSThemeHead", fontName=KOREAN_FONT, fontSize=10.5,
                leading=14, textColor=colors.HexColor("#1a1a1a"),
                spaceAfter=2,
            ),
        ))
        for c in contrasts:
            out.append(Paragraph(
                f"- <i>{c.theme_label_ko}</i>: {c.contrast_sentence_ko}",
                ParagraphStyle(
                    "_BSTheme", fontName=KOREAN_FONT, fontSize=10,
                    leading=14, leftIndent=12,
                    textColor=colors.HexColor("#3a3a3a"),
                    spaceAfter=2,
                ),
            ))

    return out


# Locked compact-note phrases for the trend-downgrade path.
TREND_NOT_COMPARABLE_NOTE_KO: tuple[str, str] = (
    "현재 데이터는 동일 조건의 시계열 비교 코퍼스가 아니므로, "
    "변화 추세는 산출하지 않았습니다.",
    "향후 동일 수집 조건으로 2회 이상 누적 시 변화 신호를 "
    "제공할 수 있습니다.",
)


def _build_trend_compact_note(styles: dict) -> list:
    """Compact two-line trend-not-comparable note.

    Sits in §2 Data Basis instead of rendering as a full main
    section when comparability_status != "ok". Saves the operator
    from a half-empty trend section that just says "not
    comparable."
    """
    out: list = []
    out.append(Paragraph(
        f"<b>변화 추세</b>: {TREND_NOT_COMPARABLE_NOTE_KO[0]}",
        styles["methodology_note"],
    ))
    out.append(Paragraph(
        f"<i>{TREND_NOT_COMPARABLE_NOTE_KO[1]}</i>",
        styles["methodology_note"],
    ))
    return out


def _build_usage_patterns_section(
    data,
    review_blocks: list[dict] | None,
    styles: dict,
    *,
    section_number: str = "4",
) -> list:
    """Observed Usage Patterns - patterns ACROSS reviews.

    Sits between Executive Verdict (§3) and Top Signals (§5). Reads
    pre-aggregated `ProductReportData` + Stage 2 `review_blocks` and
    surfaces 2–6 short observational sentences:
      - usage contexts (mask, season, skin type) tied to specific
        attributes
      - contradictions (same attribute liked AND disliked)
      - cross-attribute trade-offs

    Tone is observational - every sentence ends in 등장합니다 /
    언급됩니다 / 관측됩니다 - not directive. Empty corpus or weak
    signal: section emits a graceful no-pattern message.
    """
    out: list = []
    out.append(Paragraph(
        f"{section_number}. 만족·아쉬움 분기 패턴",
        styles["h2"],
    ))
    out.append(Spacer(1, 4))

    patterns = detect_patterns(data, review_blocks=review_blocks)
    if not patterns:
        out.append(Paragraph(
            "<i>현재 표본에서 반복되는 사용 패턴이 충분히 관측되지 "
            "않았습니다. 추가 수집 시 패턴이 드러날 수 있습니다.</i>",
            styles["body"],
        ))
        return out

    out.append(Paragraph(
        "<i>아래 패턴은 리뷰 본문 발췌에서 관측된 반복 신호입니다. "
        "원인 추론이 아니라 동일 신호의 반복을 그대로 기록합니다.</i>",
        styles["methodology_note"],
    ))
    out.append(Spacer(1, 4))

    # Each pattern gets a small bullet line. Color-keyed bullet
    # marker so contradictions / contexts / tradeoffs are scannable
    # without reading every sentence.
    bullet_color = {
        "usage_context": "#3a6ea5",
        "contradiction": "#b07000",
        "tradeoff": "#666666",
    }
    for p in patterns:
        color = bullet_color.get(p.kind, "#666666")
        # ASCII bullet - round-bullet glyphs (●) render unreliably in
        # the Adobe-Korea-1 CID font on some viewers; "-" is universal.
        out.append(Paragraph(
            f"<font color=\"{color}\"><b>-</b></font>  {p.sentence_ko}",
            styles["body"],
        ))
        out.append(Spacer(1, 2))

    return out


def _build_method_notes_block(
    styles: dict,
    *,
    source_label: str,
    corpus_metadata: dict | None,
    section_number: str = "7",
) -> list:
    """Method / Interpretation Notes - concise, post-trend.

    Replaces the dense methodology paragraph with a tight 4-bullet
    interpretation guide. Full methodology + corpus disclosure box
    moves into the Appendix.

    `section_number` parameterizes the section header so the caller
    controls numbering. Default kept at "7" for backward compatibility.
    """
    out: list = []
    out.append(Paragraph(
        f"{section_number}. 분석 방법과 한계", styles["h2"],
    ))
    out.append(Spacer(1, 4))
    bullets = [
        "이 리포트의 비율과 건수는 <b>실제 수집된 리뷰 표본 기준</b>이며, "
        "쇼핑몰 전체 리뷰를 그대로 대표하지는 않습니다.",
        "평점순 / 도움순 등 일부 정렬은 <b>대표 리뷰 발췌 용도</b>로만 "
        "사용되며, 만족 / 아쉬움 비율 산정에는 포함되지 않습니다.",
        "이 리포트는 <b>제품 결함을 단정하거나 제조 변경을 권고하는 자료가 "
        "아닙니다</b> — 실사용 후기에서 반복된 포인트를 정리한 자료입니다.",
        "실제 의사 결정은 브랜드 / 셀러 내부의 품질·원가·R&D 컨텍스트와 "
        "함께 검토하시는 것을 권장합니다.",
    ]
    for b in bullets:
        out.append(Paragraph(f"• {b}", styles["body"]))
        out.append(Spacer(1, 2))
    return out


def render_pdf_v2(
    data,
    out_path: Path,
    source_label: str,
    *,
    review_dates: dict[str, str] | None = None,
    reviews: list[dict] | None = None,
    corpus_metadata: dict | None = None,
    snapshot_comparison: SnapshotComparison | None = None,
    current_snapshot_confidence: str | None = None,
    current_snapshot_provenance=None,
    current_snapshot_signal_stability: str | None = None,
    interview_hooks: dict[str, str] | None = None,
) -> None:
    """Render the v2 PDF.

    `review_dates` and `reviews` are optional. When both are provided, a
    new section §7 (Time-series trend) is appended. When omitted, the PDF
    is identical to the prior v2 layout (no §7).

    `corpus_metadata` is optional. When provided, a "분석 범위" disclosure
    box appears near the top of the report and the §6 methodology text
    adjusts to reflect whether the corpus was limited by `max_reviews`.
    """
    styles = _styles()
    flowables: list = []

    # Synthesize executive summary upfront - feeds the Hero/Cover,
    # Strengths, and Monitoring Signals sections. Single call so all
    # sections cite the same priority/strength rankings.
    exec_summary = synthesize_executive_summary(
        data, top_n_priorities=3, top_n_strengths=2,
    )
    overall_level = _overall_priority_level(exec_summary.top_priorities)
    mode = _overall_signal_mode(overall_level)
    # Stability resolution order (analysis_report contract):
    #   1. Explicit override from caller (analysis_report.corpus.signal_stability)
    #   2. Fall back to provenance-derived value (snapshots.compute_signal_stability)
    # The override exists because the adapter's size-based rubric and the
    # snapshot module's coverage-aware rubric can disagree, and the
    # adapter's verdict (analysis_report.json) is the contract surface.
    stability_value: str | None = None
    if current_snapshot_signal_stability in ("high", "medium", "low"):
        stability_value = current_snapshot_signal_stability
    elif current_snapshot_provenance is not None:
        stability_value = getattr(
            current_snapshot_provenance, "signal_stability", None,
        )

    # ───────── 1. Cover / Executive Summary ─────────
    # Combined hero header + executive summary block. Reads as a
    # business-report cover: product, title, headline takeaway,
    # top monitoring candidates with denominators, data basis line.
    flowables.extend(_build_hero_section(data, styles))
    flowables.append(Spacer(1, 4))
    flowables.extend(_build_executive_summary_box(
        data=data,
        exec_summary=exec_summary,
        overall_level=overall_level,
        n_reviews=data.n_reviews,
        provenance=current_snapshot_provenance,
        corpus_metadata=corpus_metadata,
        styles=styles,
    ))
    flowables.append(Spacer(1, 14))

    # ───────── 2. Data Basis & Confidence ─────────
    # Explicit scope statement combined with confidence/coverage
    # context. Replaces the old separate Key Metrics + Data Coverage
    # split with one concise section.
    flowables.extend(_build_data_coverage_context_section(
        provenance=current_snapshot_provenance,
        styles=styles,
        section_number="2",
    ))
    flowables.append(Spacer(1, 4))
    # Confidence/stability context line under the basis statement.
    flowables.append(_build_key_metrics_context_line(
        provenance=current_snapshot_provenance,
        confidence_level=current_snapshot_confidence,
    ))
    if stability_value in ("high", "medium", "low"):
        stability_sentence = {
            "high": STABILITY_VERDICT_HIGH_KO,
            "medium": STABILITY_VERDICT_MEDIUM_KO,
            "low": STABILITY_VERDICT_LOW_KO,
        }[stability_value]
        stability_color = {
            "high": "#3a7a3a",
            "medium": "#b07000",
            "low": "#a04040",
        }[stability_value]
        flowables.append(Spacer(1, 4))
        flowables.append(Paragraph(
            f"<i><font color=\"{stability_color}\">{stability_sentence}"
            f"</font></i>",
            styles["methodology_note"],
        ))
    # Trend compact note - rendered HERE (in §2 Data Basis) when
    # the corpus isn't a comparable time-series, so the operator
    # sees the "no trend yet" status as part of data context
    # rather than as a half-empty main section.
    trend_is_comparable_for_note = (
        snapshot_comparison is not None
        and snapshot_comparison.comparability_status == "ok"
    )
    if not trend_is_comparable_for_note:
        flowables.append(Spacer(1, 6))
        flowables.extend(_build_trend_compact_note(styles))
    flowables.append(Spacer(1, 14))

    # ───────── 3. Key Strengths ─────────
    # Strengths come BEFORE concerns - business-report convention,
    # and especially important for healthy products where the
    # report would otherwise read as if it's hunting for problems.
    flowables.extend(_build_strengths_block(
        exec_summary, styles, section_number="3",
    ))

    # ───────── 4. Buyer-Segment Signals (NEW) ─────────
    # Dual-use section: explicit-mention-only buyer segment
    # extraction (tone / skin type / usage context / finish /
    # option). Drives both seller-facing monitoring candidates and
    # buyer-facing card-news content.
    flowables.append(Spacer(1, 14))
    segments = detect_segments(reviews or [], raw_reviews=reviews)
    flowables.extend(_build_buyer_segment_section(
        segments,
        n_reviews_total=data.n_reviews,
        overall_level=overall_level,
        styles=styles,
        section_number="4",
    ))

    # ───────── 5. Monitoring Candidate Signals ─────────
    # Section title and per-card wording adapt to overall_level via
    # the signal-mode dict: LOW products see "모니터링 후보 신호";
    # MEDIUM/HIGH see "우선 검토 신호". Internal score chips are
    # hidden from the front-page card across all levels.
    flowables.append(Spacer(1, 14))
    flowables.append(Paragraph(
        f"5. {mode['signals_section_title']}", styles["h2"],
    ))
    flowables.append(Spacer(1, 4))
    flowables.append(Paragraph(
        f"<i>{mode['signals_intro_ko']}</i>",
        styles["methodology_note"],
    ))
    flowables.append(Spacer(1, 6))
    if not exec_summary.top_priorities:
        flowables.append(Paragraph(
            "<i>이번 표본에서 별도로 정리할 확인 포인트는 "
            "관측되지 않았습니다.</i>",
            styles["body"],
        ))
    else:
        # Cap at 2 cards for LOW (interview-grade brevity); 3 for
        # MEDIUM/HIGH where more concerns warrant surfacing.
        max_cards = 2 if overall_level == "LOW" else 3
        for i, p in enumerate(exec_summary.top_priorities[:max_cards], 1):
            attr_summary = data.attribute_summaries.get(p.attribute)
            rep = (
                _pick_representative_review(attr_summary)
                if attr_summary is not None else None
            )
            card = _build_priority_card(
                index=i, priority=p, representative=rep, styles=styles,
                corpus_confidence_level=current_snapshot_confidence,
                corpus_signal_stability=stability_value,
                concern_label_ko=mode["card_concern_label"],
                n_reviews_total=data.n_reviews,
                attr_total_mentions=(
                    attr_summary.n_total if attr_summary is not None
                    else 0
                ),
                interview_hook_ko=(
                    (interview_hooks or {}).get(p.attribute)
                ),
            )
            flowables.append(KeepTogether([card, Spacer(1, 10)]))

    # ───────── 6. Observed Usage Patterns ─────────
    flowables.extend(_build_usage_patterns_section(
        data, reviews, styles, section_number="6",
    ))

    flowables.append(Spacer(1, 14))

    # ───────── 7. Trend Signal (conditional) ─────────
    # Only renders as a full section when the snapshot is genuinely
    # comparable (comparability_status == "ok"). Otherwise the
    # compact note already lives in §2 Data Basis - we don't need
    # a half-empty "변화 추세 없음" main section that the user
    # called out as visual clutter on the previous PDF.
    trend_is_comparable = (
        snapshot_comparison is not None
        and snapshot_comparison.comparability_status == "ok"
    )
    if trend_is_comparable:
        flowables.append(Spacer(1, 12))
        flowables.extend(_build_snapshot_trend_section(
            snapshot_comparison,
            current_snapshot_confidence or "low",
            styles,
            section_number="7",
        ))

    # ───────── 8. Method / Interpretation Notes ─────────
    flowables.append(Spacer(1, 14))
    flowables.extend(_build_method_notes_block(
        styles,
        source_label=source_label,
        corpus_metadata=corpus_metadata,
        section_number="8",
    ))

    # ───────── 10. Appendix ─────────
    # Hard page break before the Appendix - the §1-9 cover narrative
    # is the operator-facing report; the Appendix is supporting
    # detail and reads better starting on its own page.
    #
    # Pass-12: visual divider — a thin slate-blue rule + small caption
    # block tells the reader at a glance that everything below is
    # supporting evidence, not headline conclusion. Body paragraphs
    # in the appendix use the smaller / lighter `appendix_body` style.
    flowables.append(PageBreak())
    _appendix_rule = Table(
        [[""]], colWidths=[158 * mm], rowHeights=[1.2],
    )
    _appendix_rule.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#3a6ea5")),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    flowables.append(_appendix_rule)
    flowables.append(Spacer(1, 6))
    flowables.append(Paragraph("9. 부록 (Appendix)", styles["h2"]))
    flowables.append(Paragraph(
        "이하 자료는 검증용 상세 데이터입니다. "
        "30초 요약은 1~8장에 모두 담겨 있으며, 부록은 본문 결론의 "
        "근거를 검증하거나 심층 분석이 필요할 때 참고하는 보조 "
        "자료입니다.",
        styles["appendix_caption"],
    ))

    # 8.1 Corpus disclosure — three KeepTogether sub-tables (분석 대상
    # / 수집 정렬 / 모델·처리 정보) so long Korean phrases don't break
    # mid-syllable and so each table avoids mid-page splits.
    if corpus_metadata:
        cm_flowables = _build_corpus_metadata_table(corpus_metadata)
        if cm_flowables:
            flowables.append(Paragraph("9.1 분석 범위 상세", styles["h3"]))
            flowables.extend(cm_flowables)
            flowables.append(Spacer(1, 8))

    # 8.2 Top concerns table (was §2)
    flowables.append(Paragraph("9.2 주요 아쉬움 의견 (테이블)", styles["h3"]))
    concerns_table = build_top_concerns_table(data)
    if concerns_table:
        flowables.append(concerns_table)
    else:
        flowables.append(Paragraph("부정 의견 없음.", styles["body"]))

    # 8.3 Visualizations + dense detail blocks (was §3–§6, §8)
    flowables.append(Spacer(1, 8))
    flowables.append(Paragraph("9.3 시각 분석", styles["h3"]))

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_p = Path(tmpdir)
        bar_png = tmpdir_p / "top_negative.png"
        pol_png = tmpdir_p / "polarity.png"
        render_top_negative_bar_chart(data, bar_png)
        render_polarity_distribution_chart(data, pol_png)

        if bar_png.exists():
            flowables.append(Image(str(bar_png), width=160 * mm, height=70 * mm, kind="proportional"))
            # Pass-12: extra breathing room between chart and the
            # next chart/table so the appendix doesn't read as a
            # solid wall of figures.
            flowables.append(Spacer(1, 10))
        if pol_png.exists():
            flowables.append(Image(str(pol_png), width=160 * mm, height=80 * mm, kind="proportional"))
            flowables.append(Spacer(1, 10))

        # Polarity table (paired with the chart). KeepTogether so the
        # h3 + table never straddle a page boundary.
        pol_table = build_polarity_distribution_table(data)
        if pol_table:
            flowables.append(KeepTogether([
                Paragraph("9.3.1 평가 분포 (수치)", styles["h3"]),
                pol_table,
            ]))
        else:
            flowables.append(Paragraph("9.3.1 평가 분포 (수치)", styles["h3"]))

        # 4. Trade-offs - compact bullet cards (replaces wide sparse table)
        flowables.append(Spacer(1, 8))
        flowables.append(Paragraph("9.4 트레이드오프", styles["h3"]))
        if data.tradeoff_pairs:
            flowables.append(Paragraph(
                f"총 <b>{data.n_with_tradeoff}건</b>의 명시적 트레이드오프 - "
                f"<i>강점으로 언급된 속성과 함께 양보된 속성의 짝.</i>",
                styles["body"]))
            flowables.append(Spacer(1, 4))
            # Use the structured 3-column table builder (긍정 속성 /
            # 양보 속성 / 건수) instead of bullet lines that leaked
            # raw polarity strings (positive / negative_strong) into
            # the appendix.
            tradeoff_tbl = build_tradeoff_table(data)
            if tradeoff_tbl is not None:
                flowables.append(tradeoff_tbl)
        else:
            flowables.append(Paragraph("명시적 트레이드오프 없음.", styles["body"]))

        # 5. Evidence - max 2-3 per attribute, top 3 attributes
        flowables.append(Spacer(1, 8))
        flowables.append(Paragraph("9.5 대표 리뷰 발췌", styles["h3"]))
        flowables.append(Paragraph(
            "<i>각 아쉬움 의견당 최대 2-3건의 대표 평가를 발췌했습니다.</i>", styles["body"]))
        flowables.append(Spacer(1, 4))

        neg_ranked = sorted(
            [s for s in data.attribute_summaries.values() if s.n_negative > 0],
            key=lambda s: -s.n_negative,
        )[:3]

        for s in neg_ranked:
            label = _ko_short_label(s.attribute)
            priority = compute_priority(s, data.n_reviews)
            badge = f"<font color=\"{PRIORITY_COLOR.get(priority, '#777777')}\"><b>[{priority}]</b></font>"
            flowables.append(Paragraph(f"<b>{label}</b>   {badge}", styles["h3"]))
            evidence = select_evidence(s, n=3, prefer_diverse=True, kind="negative")
            for ex in evidence:
                ev = ex["evidence_span"]
                ev_safe = (ev.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
                stars = "★" * (ex.get("intensity") or 1)
                conf = ex.get("confidence", "?")
                conf_color = {"high": "#2e7d32", "medium": "#f57c00", "low": "#777777"}.get(conf, "#777777")
                delivery_chip = " 📦" if ex.get("delivery_condition_flag") else ""
                flowables.append(Paragraph(f"&ldquo;{ev_safe}&rdquo;", styles["evidence"]))

                # Operator-friendly metadata line. Hides raw JSON keys -
                # 중요도 점수 surfaces oy_evidence_score; rating shows
                # the reviewer's star rating; signal labels come from
                # `format_sort_signal_labels_ko` (e.g., "평점 낮은순 TOP 5").
                # Each chip is omitted when its source field is missing,
                # so legacy/unscored rows show only severity + confidence.
                chips: list[str] = [
                    f"심각도 <b>{stars}</b>",
                    f"신뢰도: <font color=\"{conf_color}\"><b>{conf}</b></font>",
                ]
                ev_score = ex.get("oy_evidence_score")
                if isinstance(ev_score, (int, float)) and not isinstance(ev_score, bool):
                    chips.append(f"중요도 <b>{ev_score:.1f}</b>")
                rating = ex.get("rating_normalized")
                if isinstance(rating, (int, float)) and not isinstance(rating, bool):
                    chips.append(f"별점 <b>{rating:.0f}점</b>")
                meta = "  |  ".join(chips) + delivery_chip
                flowables.append(Paragraph(meta, styles["evidence_meta"]))

                signal_labels = format_sort_signal_labels_ko(
                    ex.get("oy_sort_ranks") or {},
                )
                if signal_labels:
                    sig_line = " / ".join(
                        f"<font color=\"#3a6ea5\">{lbl}</font>"
                        for lbl in signal_labels
                    )
                    flowables.append(Paragraph(
                        f"근거 강도: {sig_line}", styles["evidence_meta"],
                    ))

        # 6. Per-attribute insights (operator-actionable Korean synthesis)
        # Renders a one-or-two-sentence insight per top negative
        # attribute and per top positive attribute. Sentences are built
        # by `synthesize_attribute_insights` from sort signals, polarity
        # distribution, and frequency - no LLM. Renderer surfaces the
        # priority chip alongside each sentence so operators can scan
        # by escalation level.
        insights = synthesize_attribute_insights(
            data, top_n_negative=5, top_n_positive=3,
        )
        flowables.append(Spacer(1, 12))
        flowables.append(Paragraph("9.6 속성별 핵심 인사이트", styles["h3"]))
        if not insights["negative"] and not insights["positive"]:
            flowables.append(Paragraph(
                "<i>인사이트로 합성할 수 있는 속성이 없습니다.</i>",
                styles["body"],
            ))
        else:
            if insights["negative"]:
                flowables.append(Paragraph(
                    "9.6.1 우려 인사이트", styles["h3"],
                ))
                for ins in insights["negative"]:
                    badge_color = PRIORITY_COLOR.get(
                        ins.priority_label, "#777777",
                    )
                    badge = (
                        f"<font color=\"{badge_color}\">"
                        f"<b>[{ins.priority_label}]</b></font>"
                    )
                    flowables.append(Paragraph(
                        f"{badge}   {ins.ko_summary}",
                        styles["body"],
                    ))
                    # Inline impact + recommendation: paired with the
                    # insight so the operator reads "what's happening"
                    # → "why it matters" → "what to do" in narrative
                    # order. Both lines are skipped silently when the
                    # attribute has no rule (future-attribute safety).
                    impact_text = impact_for(ins.attribute)
                    if impact_text:
                        flowables.append(Paragraph(
                            f"<font color=\"#a04040\">↳ 영향:</font> "
                            f"{impact_text}",
                            styles["recommendation"],
                        ))
                    rec_action = recommendation_for(ins.attribute)
                    if rec_action:
                        flowables.append(Paragraph(
                            f"<font color=\"#3a6ea5\">↳ 권장:</font> "
                            f"{rec_action}",
                            styles["recommendation"],
                        ))
            if insights["positive"]:
                flowables.append(Spacer(1, 4))
                flowables.append(Paragraph(
                    "9.6.2 강점 인사이트", styles["h3"],
                ))
                for ins in insights["positive"]:
                    # Positive priority labels (Strong/Moderate/Mild)
                    # use a green palette to differentiate from the
                    # negative escalation colors.
                    pos_color = {
                        "Strong": "#2e7d32",
                        "Moderate": "#5cb85c",
                        "Mild": "#7faa7f",
                    }.get(ins.priority_label, "#777777")
                    badge = (
                        f"<font color=\"{pos_color}\">"
                        f"<b>[{ins.priority_label}]</b></font>"
                    )
                    flowables.append(Paragraph(
                        f"{badge}   {ins.ko_summary}",
                        styles["body"],
                    ))

        # 7. Methodology
        flowables.append(Spacer(1, 12))
        flowables.append(Paragraph("9.7 상세 방법론", styles["h3"]))

        # Lead sentence - explicit disclosure about corpus scope
        if corpus_metadata is not None:
            if corpus_metadata.get("scrape_skipped"):
                lead = (
                    f"본 리포트는 기존에 수집된 리뷰 "
                    f"<b>{corpus_metadata.get('processed_review_count', data.n_reviews)}건</b>을 "
                    f"기준으로 분석했습니다."
                )
            elif corpus_metadata.get("corpus_limited"):
                cap = corpus_metadata.get("max_reviews_effective", "?")
                lead = (
                    f"본 리포트는 전체 리뷰가 아니라 수집 가능한 리뷰 중 "
                    f"<b>최대 {cap}건</b>을 기준으로 분석했습니다. "
                    f"이 제품에는 더 많은 리뷰가 존재할 수 있으며, 비율 수치는 분석 대상 "
                    f"표본 내에서의 비율입니다."
                )
            else:
                lead = (
                    f"본 리포트는 수집 시점 기준 확인 가능한 리뷰 "
                    f"<b>{corpus_metadata.get('processed_review_count', data.n_reviews)}건</b>을 "
                    f"기준으로 분석했습니다."
                )
        else:
            lead = (
                f"본 리포트는 OliveYoung에서 수집한 <b>{data.n_reviews}건</b>의 리뷰를 "
                f"분석한 결과입니다."
            )

        # Append sort-mode disclosure so the reader knows which review pool
        # the corpus came from. See docs/oliveyoung_sort_crawl_probe.md §6.
        if corpus_metadata is not None:
            sort_mode = corpus_metadata.get("sort_mode")
            primary_for_lead = corpus_metadata.get("primary_corpus_sort_type")
            signal_for_lead = corpus_metadata.get("signal_sort_types") or []
            signal_cap_for_lead = corpus_metadata.get("signal_sort_cap")
            if sort_mode == "multi" and primary_for_lead:
                # Primary/signal disclosure. Make the invariant explicit:
                # signal sorts are ONLY an evidence pool - they are NOT
                # used to compute distribution percentages or time-series
                # trends. This matches the orchestrator's fetch-time
                # filter (oy_sort_type == primary).
                #
                # Partial-success contract: when the orchestrator records
                # which signal sorts actually returned data, narrow the
                # signal-sort enumeration to the SUCCEEDED set so the
                # methodology paragraph never claims a failed sort
                # (zero rows seen) acted as an evidence pool.
                primary_lbl = _format_sort_label(primary_for_lead)
                sorts_succeeded_in_meta = (
                    corpus_metadata.get("sorts_succeeded") or []
                )
                sorts_failed_in_meta = (
                    corpus_metadata.get("sorts_failed") or []
                )
                if sorts_succeeded_in_meta:
                    signal_succeeded_for_lead = [
                        s for s in signal_for_lead
                        if s in sorts_succeeded_in_meta
                    ]
                    signal_failed_for_lead = [
                        s for s in signal_for_lead
                        if s in sorts_failed_in_meta
                    ]
                else:
                    # No outcome data → optimistic legacy behavior.
                    signal_succeeded_for_lead = list(signal_for_lead)
                    signal_failed_for_lead = []
                signal_lbls = ", ".join(
                    _format_sort_label(s) for s in signal_succeeded_for_lead
                ) or "없음"
                cap_phrase = (
                    f"각 상위 {signal_cap_for_lead}건"
                    if signal_cap_for_lead else "상위 N건"
                )
                lead += (
                    f" 본 리포트의 분포 수치 및 시계열 추세는 OliveYoung "
                    f"<i>{primary_lbl}</i> 정렬에서 수집한 주 코퍼스만을 "
                    f"기준으로 산정되었습니다. 대표 리뷰 참고 정렬 "
                    f"({signal_lbls})은 각 정렬의 {cap_phrase}만 별도로 "
                    f"수집한 대표 리뷰 발췌용 데이터로, 대표 리뷰 발췌 "
                    f"용도로만 사용되며 분포 비율 산정에는 포함되지 "
                    f"않습니다."
                )
                if signal_failed_for_lead:
                    failed_lbls = ", ".join(
                        _format_sort_label(s) for s in signal_failed_for_lead
                    )
                    lead += (
                        f" <b>[주의]</b> 다음 정렬은 이번 수집에서 "
                        f"실패하여 대표 리뷰 발췌용 데이터에 기여하지 "
                        f"않았습니다: {failed_lbls}."
                    )
                    if "RATING_ASC" in signal_failed_for_lead:
                        lead += (
                            " 낮은 평점순(RATING_ASC) 수집 실패로 부정 "
                            "리뷰 신호가 과소 관측될 수 있습니다."
                        )
            elif sort_mode == "multi":
                # Legacy: no primary split → keep prior wording.
                included = corpus_metadata.get("sort_types_included") or []
                lead += (
                    " 리뷰는 OliveYoung의 5개 정렬 (시간순, 평점 낮은순, 평점 높은순, "
                    "유용한 순, 도움순)에서 순차적으로 수집한 후 review_id 기준 병합했습니다."
                ) if len(included) >= 5 else (
                    f" 리뷰는 OliveYoung의 다중 정렬 ({', '.join(included)})에서 "
                    f"순차적으로 수집한 후 review_id 기준 병합했습니다."
                )
            elif sort_mode == "single" and corpus_metadata.get("sort_types_included"):
                st = corpus_metadata["sort_types_included"][0]
                lead += (
                    f" 리뷰는 OliveYoung 리뷰 페이지의 <i>{_format_sort_label(st)}</i> "
                    f"정렬에서만 수집되었으며, 다른 정렬에서 노출되는 리뷰는 별도 "
                    f"수집 대상입니다."
                )
            elif sort_mode == "default":
                lead += (
                    " 리뷰는 OliveYoung 리뷰 페이지의 기본 정렬 (<i>유용한 순</i>)에서 "
                    "수집되었으며, 시간순/평점순 정렬에서 노출되는 리뷰는 별도 "
                    "수집 대상입니다. 비율 수치는 유용한 순 표본 내에서의 비율입니다."
                )

        method_text = (
            f"{lead} 각 리뷰에서 12개 속성 (발색, 지속력, 발림성, 베이스 상호작용, 마무리감, "
            f"건조감, 색/톤 매칭, 외부 용기, 도구, 가격, 립앤치크 호환성, 마스크/옷 묻어남 저항)을 "
            f"추출하고 긍정/부정/혼합 의견을 분류했습니다. "
            f"리뷰 단위 통찰 정확도는 약 <b>87.5%</b> 수준으로 검증되었으며, 개별 평가 세부 분류 "
            f"정확도는 약 <b>71%</b>입니다. 본 리포트의 결론은 <i>방향성</i>으로 해석해 주시고, "
            f"절대 수치보다 패턴에 집중해 주십시오. 분석 데이터: {source_label}."
        )
        flowables.append(Paragraph(method_text, styles["methodology"]))

        # Interview-friendly framing - explains in plain Korean how
        # the priority ranking decides "what matters first." Operators
        # can read this without prior context to interpret the report.
        flowables.append(Spacer(1, 6))
        flowables.append(Paragraph(
            "<b>우선순위 산정 방식</b>: 단순 빈도가 아닌 다음 신호를 "
            "조합해 실행 우선순위를 산정합니다 - "
            "<font color=\"#3a6ea5\">정렬 신호</font>(평점 낮은순/유용한 순/추천순 "
            "상위 노출 여부), "
            "<font color=\"#3a6ea5\">리뷰 중요도 점수</font>(평점/심각도/신뢰도 결합), "
            "<font color=\"#3a6ea5\">비즈니스 영향 가중치</font>(클레임/재구매율/경쟁사 이탈 등 "
            "리스크 카테고리). 이를 통해 표본 편향과 소수 의견 과대평가를 줄이고, "
            "제조/상품 검토 후보를 도출합니다.",
            styles["methodology_note"],
        ))

        # Brand-side disclaimer. Anchors the report's role explicitly:
        # this is a VOC-signal-driven hypothesis layer - the brand
        # owns the manufacturing / QA / cost decision based on its
        # own internal context. Locked verbatim because customer-
        # interview audiences will read it.
        flowables.append(Spacer(1, 4))
        flowables.append(Paragraph(
            "<b>해석 안내</b>: 본 리포트는 고객 리뷰 기반의 VOC 신호를 "
            "바탕으로 개선 후보를 제안하는 자료이며, 실제 원인 및 "
            "제조 변경 여부는 브랜드 내부 생산/품질/원가 조건 검토 후 "
            "판단해야 합니다.",
            styles["methodology_note"],
        ))

        # 7. Time-series trend (optional - appended only if review_dates + reviews provided)
        if reviews is not None and review_dates is not None:
            ts_analysis = ts.analyze(reviews, review_dates)
            flowables.append(Spacer(1, 12))
            flowables.append(Paragraph("9.8 시간 흐름 분석", styles["h3"]))

            if not ts_analysis.has_sufficient_data:
                flowables.append(Paragraph(
                    f"<i>월별 분석을 위한 데이터가 부족합니다 (n_months = "
                    f"{ts_analysis.n_months}). 3개월 이상의 데이터가 누적된 시점에 "
                    f"시계열 분석이 가능합니다.</i>",
                    styles["body"]))
            else:
                flowables.append(Paragraph(
                    f"분석 기간: <b>{ts_analysis.earliest_month}</b> → "
                    f"<b>{ts_analysis.latest_month}</b> "
                    f"(<b>{ts_analysis.n_months}개월</b>)",
                    styles["body"]))
                # Confidence guard: when n_months < 6 OR sparse coverage,
                # explicitly disclaim "초기 관찰" so the reader does not
                # treat trend lines as definitive.
                if ts_analysis.is_early_observation:
                    flowables.append(Paragraph(
                        f"<b><font color=\"#b07000\">[초기 관찰]</font></b> "
                        f"{ts_analysis.early_observation_reason}. "
                        f"아래 추세는 <i>방향성 참고</i> 수준으로만 해석해 주십시오. "
                        f"확정적 추세 판단은 데이터가 더 누적된 시점에 가능합니다.",
                        styles["body"]))
                flowables.append(Spacer(1, 4))

                # Volume chart
                vol_png = tmpdir_p / "monthly_volume.png"
                if ts.render_monthly_volume_chart(ts_analysis, vol_png):
                    flowables.append(Image(str(vol_png),
                                            width=160 * mm, height=60 * mm,
                                            kind="proportional"))
                    flowables.append(Spacer(1, 4))

                # Trend chart (top-N attributes)
                trend_png = tmpdir_p / "attribute_trends.png"
                if ts.render_attribute_trend_chart(
                    ts_analysis, trend_png, top_n=4,
                    attribute_labeler=_ko_short_label,
                ):
                    flowables.append(Image(str(trend_png),
                                            width=160 * mm, height=72 * mm,
                                            kind="proportional"))
                    flowables.append(Spacer(1, 4))

                # Trend summary table (top 5 by absolute change)
                significant_trends = [
                    t for t in ts_analysis.trends
                    if t.direction in ("increasing", "decreasing")
                ][:5]
                if significant_trends:
                    section_title = (
                        "9.8.1 관찰된 변화 (초기 관찰)"
                        if ts_analysis.is_early_observation
                        else "9.8.1 주요 추세 변화"
                    )
                    flowables.append(Paragraph(section_title, styles["h3"]))
                    rows = [["속성", "초반 부정 비율", "최근 부정 비율", "변화 (pp)", "방향"]]
                    direction_label = {
                        "increasing": "📈 증가", "decreasing": "📉 감소",
                        "stable": "안정", "insufficient_data": "데이터 부족",
                    }
                    for t in significant_trends:
                        rows.append([
                            _ko_short_label(t.attribute),
                            f"{t.first_period_rate * 100:.0f}%",
                            f"{t.last_period_rate * 100:.0f}%",
                            f"{t.delta_pp:+.0f}",
                            direction_label.get(t.direction, t.direction),
                        ])
                    col_widths = [42 * mm, 26 * mm, 26 * mm, 22 * mm, 28 * mm]
                    trend_tbl = Table(rows, colWidths=col_widths, repeatRows=1)
                    trend_tbl.setStyle(TableStyle([
                        ("FONTNAME", (0, 0), (-1, -1), KOREAN_FONT),
                        ("FONTSIZE", (0, 0), (-1, -1), 9),
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#222222")),
                        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
                        ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cccccc")),
                        ("BOX", (0, 0), (-1, -1), 0.6, colors.HexColor("#888888")),
                        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
                         [colors.white, colors.HexColor("#f8f8f8")]),
                        ("LEFTPADDING", (0, 0), (-1, -1), 5),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                        ("TOPPADDING", (0, 0), (-1, -1), 4),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                    ]))
                    flowables.append(trend_tbl)
                    flowables.append(Spacer(1, 6))

                # Spike alerts (de-emphasized in early-observation mode)
                if ts_analysis.spikes:
                    spike_title = (
                        "9.8.2 급증 의심 사례 (초기 관찰)"
                        if ts_analysis.is_early_observation
                        else "9.8.2 급증 경보"
                    )
                    spike_lead = (
                        "관찰 기간이 짧아 통계적 확정은 어려우나, 다음 사례는 "
                        "이전 3개월 평균 대비 부정 비율이 +15pp 이상 상승했습니다:"
                        if ts_analysis.is_early_observation
                        else "이전 3개월 평균 대비 부정 비율이 +15pp 이상 급증한 사례:"
                    )
                    flowables.append(Paragraph(spike_title, styles["h3"]))
                    flowables.append(Paragraph(spike_lead, styles["body"]))
                    for sp in ts_analysis.spikes[:5]:
                        flowables.append(Paragraph(
                            f"[주의] <b>{_ko_short_label(sp.attribute)}</b>: "
                            f"{sp.month} 월에 부정 비율 "
                            f"{sp.current_rate * 100:.0f}% "
                            f"(직전 평균 {sp.baseline_rate * 100:.0f}%, "
                            f"<b>+{sp.relative_jump_pp:.0f}pp</b>)",
                            styles["body"]))

        # NOTE: Snapshot trend (cross-run) is rendered in §5 of the
        # main flow (above the Appendix), not here - the redesign
        # promotes the trend signal to a primary surface alongside
        # Top Signals so operators see momentum during the 30-second
        # skim, not buried at the end. Removing the duplicate render
        # call here keeps the flow non-redundant.

        # Build PDF
        doc = SimpleDocTemplate(
            str(out_path),
            pagesize=A4,
            leftMargin=18 * mm, rightMargin=18 * mm,
            topMargin=20 * mm, bottomMargin=18 * mm,
            title=f"{data.product_name} - VOC 리포트",
            author="Phase 2E 파이프라인",
        )
        doc.build(flowables)


# ---------------------------------------------------------------------------
# Business Report v3 — analyst-grade layout
# ---------------------------------------------------------------------------
#
# Run-003 QA pass-3 finding: the prior layout reads as a personal-
# review note rather than a B2B Review Intelligence Report. The v3
# layout follows a publishable analyst-report structure:
#
#   1. Cover / Report Metadata
#   2. Executive Summary — 3 KPI cards + verdict + caution badge
#   3. Data Coverage & Reliability — coverage table + 4-axis breakdown
#   4. Key Findings — strengths table + watch-outs table
#   5. Satisfaction vs Friction Matrix — 2x2 table
#   6. Decision Implications — action implication table
#   7. Buyer Content Translation — analysis → buyer copy table
#   8. Methodology & Limitations — short bullets
#   9. Appendix — detailed attribute table + sample reviews + log
#
# Design tone:
#   primary  navy/charcoal #1f2a44
#   accent   muted teal    #2d6e7a
#   caution  muted amber   #b07000
#   neutral  light gray    #f0f2f5
#
# Forbidden symbols (∫∬∭∮∯∰√∑∏∂∞≈≠≤≥) are scrubbed at every paragraph
# boundary via `scrub_for_report` so a regression in upstream code
# can't ship a math glyph in the PDF.

_BR3_PRIMARY = colors.HexColor("#1f2a44")
_BR3_ACCENT = colors.HexColor("#2d6e7a")
_BR3_CAUTION = colors.HexColor("#b07000")
_BR3_NEUTRAL = colors.HexColor("#f0f2f5")
_BR3_BORDER = colors.HexColor("#c7ccd6")
_BR3_TEXT_BODY = colors.HexColor("#2a2f3a")
_BR3_TEXT_MUTED = colors.HexColor("#6a6f7a")


def _br3_styles() -> dict:
    """ParagraphStyle bundle for v3 — analyst-grade typography.

    Title / section / KPI / table-header styles use `KOREAN_FONT_BOLD`
    (the discovered Bold variant) so the visual hierarchy is clear
    even if the upstream HTML lacks `<b>...</b>` tags. Body / muted /
    quote styles use the regular variant.
    """
    base = getSampleStyleSheet()
    bold_font = KOREAN_FONT_BOLD or KOREAN_FONT
    return {
        "report_title": ParagraphStyle(
            "BR3Title", parent=base["Title"], fontName=bold_font,
            fontSize=22, leading=28, spaceAfter=2, alignment=0,
            textColor=_BR3_PRIMARY,
        ),
        "report_subtitle": ParagraphStyle(
            "BR3Subtitle", parent=base["Heading2"], fontName=KOREAN_FONT,
            fontSize=11, leading=16, spaceAfter=2,
            textColor=_BR3_TEXT_MUTED,
        ),
        "report_lead": ParagraphStyle(
            "BR3Lead", parent=base["BodyText"], fontName=KOREAN_FONT,
            fontSize=10, leading=14, spaceAfter=12,
            textColor=_BR3_TEXT_MUTED,
        ),
        "section_h1": ParagraphStyle(
            "BR3SectionH1", parent=base["Heading2"], fontName=bold_font,
            fontSize=14, leading=20, spaceBefore=18, spaceAfter=10,
            textColor=_BR3_PRIMARY,
        ),
        "section_h2": ParagraphStyle(
            "BR3SectionH2", parent=base["Heading3"], fontName=bold_font,
            fontSize=11, leading=16, spaceBefore=8, spaceAfter=4,
            textColor=_BR3_TEXT_BODY,
        ),
        "body": ParagraphStyle(
            "BR3Body", parent=base["BodyText"], fontName=KOREAN_FONT,
            fontSize=10, leading=15, spaceAfter=4,
            textColor=_BR3_TEXT_BODY,
        ),
        "muted": ParagraphStyle(
            "BR3Muted", parent=base["BodyText"], fontName=KOREAN_FONT,
            fontSize=9, leading=13, spaceAfter=4,
            textColor=_BR3_TEXT_MUTED,
        ),
        "kpi_label": ParagraphStyle(
            "BR3KPILabel", fontName=KOREAN_FONT, fontSize=8.5, leading=11,
            alignment=1, textColor=_BR3_TEXT_MUTED,
        ),
        "kpi_value": ParagraphStyle(
            "BR3KPIValue", fontName=bold_font, fontSize=20, leading=24,
            alignment=1, textColor=_BR3_PRIMARY, spaceBefore=2, spaceAfter=2,
        ),
        "kpi_unit": ParagraphStyle(
            "BR3KPIUnit", fontName=KOREAN_FONT, fontSize=8, leading=11,
            alignment=1, textColor=_BR3_TEXT_MUTED,
        ),
        "badge": ParagraphStyle(
            "BR3Badge", fontName=KOREAN_FONT, fontSize=9, leading=13,
            textColor=_BR3_CAUTION, leftIndent=2,
        ),
        "verdict": ParagraphStyle(
            "BR3Verdict", parent=base["BodyText"], fontName=KOREAN_FONT,
            fontSize=11, leading=17, leftIndent=6, rightIndent=6,
            spaceBefore=4, spaceAfter=4, textColor=_BR3_TEXT_BODY,
        ),
        "insight_label": ParagraphStyle(
            "BR3InsightLabel", fontName=bold_font, fontSize=9.5, leading=13,
            textColor=_BR3_ACCENT, spaceAfter=1,
        ),
        "insight_body": ParagraphStyle(
            "BR3InsightBody", fontName=KOREAN_FONT, fontSize=10,
            leading=14, textColor=_BR3_TEXT_BODY, spaceAfter=8,
        ),
        "evidence_quote": ParagraphStyle(
            "BR3Quote", parent=base["BodyText"], fontName=KOREAN_FONT,
            fontSize=9, leading=13, leftIndent=8, rightIndent=4,
            textColor=_BR3_TEXT_BODY, spaceAfter=2,
        ),
    }


def _br3_para(text: str, style) -> Paragraph:
    """Paragraph helper that scrubs forbidden symbols + arrow tokens
    just before rendering. Defense-in-depth at every paragraph
    boundary so a regression upstream cannot ship math glyphs."""
    from src.voc.content.reader_friendly_wording import scrub_for_report
    return Paragraph(scrub_for_report(text or ""), style)


# Ordered ATTRIBUTE_KEY → KO label fallback. The adapter normally
# threads a profile-aware label_ko on every attribute; this dict is
# only consulted when the upstream label is missing or empty.
_BR3_FALLBACK_LABEL_KO: dict[str, str] = {
    "finish_texture": "촉촉함/마무리감",
    "value_price": "대용량/가성비",
    "dryness_skin_texture": "건조감/당김",
    "adhesion_base_interaction": "패드 밀착력",
    "persistence": "수분 지속감",
    "packaging_container": "용기/집게",
    "applicator_tool": "도구",
    "color_tone_matching": "색감 매칭",
    "pigmentation": "발색",
    "transfer_resistance": "묻어남 저항",
    "application_blending": "발림성",
    "multi_use_lip_cheek_compatibility": "립앤치크 호환성",
}


def _br3_label_for(attr_key: str, attribute_block: dict | None = None) -> str:
    if isinstance(attribute_block, dict):
        lbl = attribute_block.get("label_ko")
        if isinstance(lbl, str) and lbl.strip():
            return lbl.strip()
    return _BR3_FALLBACK_LABEL_KO.get(attr_key, attr_key or "")


def _br3_filter_quotes_skip_suspect(quotes: list[dict]) -> list[dict]:
    """Drop quotes the polarity guardrail flagged as suspect AND
    quotes the attribute-fit guardrail flagged as off-topic.

    Run-003 QA pass-5 lock: a positive-polarity-but-suspect quote
    OR an off-topic quote (e.g. "모공 효과" surfaced under
    dryness_skin_texture) must never reach a seller-facing
    representative slot. Raw evidence remains in the audit-only
    `attributes[].top_quotes` pool for QA verification.
    """
    return [
        q for q in (quotes or [])
        if not q.get("polarity_suspect")
        and not q.get("attribute_fit_warning")
    ]


def _br3_quote_summary_for_pdf(quote: dict) -> str:
    """Pick the report-friendly summary from a quote dict.

    Resolution order:
      1. `display_quote_summary` (PDF-only field, no duplication).
      2. `display_text` (cardnews field, may carry "...만족 의견").
      3. `text` (raw audit invariant; never paraphrased).
    """
    if not isinstance(quote, dict):
        return ""
    for k in ("display_quote_summary", "display_text", "text"):
        v = quote.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


# Pass-13: dangling-fragment guard. The Stage-2 raw `text` field is
# faithful to the original review (audit contract) but can be too
# short or end mid-sentence. Examples surfaced in run-003:
#   - "비추입"                     → mid-word ("비추천입니다" truncated)
#   - "...편하게 사용할 수 있"     → ends in modifier "있", no 다/요
#   - "촉촉하고 좋아도 ... 너무 만족" → trails on "만족" stem
# When the raw is too short or ends without a proper sentence-final
# marker, we promote the cleaner `display_quote_summary` /
# `display_text` even though the raw exists.

# Korean sentence-final markers acceptable as a "complete-looking" tail.
_KO_SENTENCE_FINAL_CHARS: frozenset[str] = frozenset(
    "다요까네죠워에음임함됨봐아어니까"
)
_PUNCT_FINAL_CHARS: frozenset[str] = frozenset(".!?…」』」'\"")
_DANGLING_RAW_MIN_LEN: int = 8


def _looks_dangling(text: str) -> bool:
    """Pass-17: delegate to the shared module so renderer / adapter /
    inspector all use the same predicate."""
    return _shared_looks_dangling(text, min_len=_DANGLING_RAW_MIN_LEN)


# Pass-17: quote-quality predicates moved to a shared normalizer
# module so the renderer, the inspector, and the analysis_report
# adapter all read the same definition of "degraded summary." Local
# names below proxy to the shared functions for backward compat with
# pass-14/15/16 import paths.
from src.voc.content.quote_summary_normalizer import (  # noqa: E402
    looks_dangling as _shared_looks_dangling,
    looks_too_generic as _shared_looks_too_generic,
    looks_truncated as _shared_looks_truncated,
)


# Pass-14 / Pass-16 / Pass-17: appendix quotes that survive the
# dangling-fragment guard can still be too generic to count as
# evidence — phrases like "생각보다 만족스러웠어요" / "은근히
# 편하네요" don't tell the operator WHY this attribute scored.
# Filter these and prefer an attribute-specific replacement.
_GENERIC_QUOTE_PATTERNS_KO: tuple[str, ...] = (
    "생각보다 만족",
    "그냥 만족",
    "좋아요",
    "좋네요",
    "좋습니다",
    "괜찮아요",
    "괜찮네요",
    "별로예요",
    "별로네요",
    "잘 모르겠어요",
    # Pass-16: extra generic-tone phrases that surfaced in run-003.
    "편하네요",
    "편해요",
    "편합니다",
    "은근히",
    "나쁘지 않",
    "나쁘진 않",
)


# Pass-16: explicit truncation-tail check. Some review extracts arrive
# with a literal "..." or "…" inside or at the end (the upstream
# extractor sometimes truncates mid-sentence). These must never reach
# the appendix sample column verbatim — operators read them as a
# "quote was cut off, can I trust this?" signal.
_TRUNCATION_MARKERS: tuple[str, ...] = ("...", "…", " ...", " …")


def _looks_truncated(text: str) -> bool:
    """Pass-17: delegate to shared module."""
    return _shared_looks_truncated(text)


# Pass-16: lowered the generic-length threshold from 20 → 14 chars so
# short filler like "은근히 편하네요!" (9 chars) is caught. Long
# review sentences with a "좋아요" inside still pass through.
_GENERIC_LENGTH_THRESHOLD: int = 14


def _looks_too_generic(text: str) -> bool:
    """Pass-17: delegate to shared module."""
    return _shared_looks_too_generic(text)


def _attribute_specific_summary_for(
    attr_key: str, polarity: str,
    *, profile_id: str | None = None,
) -> str | None:
    """Pull a per-attribute side summary from the trade-off block when
    no usable quote-level summary survived the generic / dangling
    filters. Profile-aware: skincare_pad's "촉촉한 마무리감" template
    won't be applied to a sunscreen product.

    Returns None when neither the profile-specific template nor the
    fallback_generic template carries the requested polarity — caller
    falls through to whatever raw text is available."""
    template = _resolve_tradeoff_template(profile_id, attr_key)
    if not template:
        return None
    if polarity == "positive":
        return template.get("positive_side_summary")
    if polarity == "negative":
        return template.get("negative_side_summary")
    return None


def _br3_appendix_quote_text(
    quote: dict, *,
    max_chars: int = 120,
    attribute_key: str | None = None,
    polarity: str | None = None,
    profile_id: str | None = None,
) -> str:
    """Resolve the appendix sample-review cell's quote text.

    Resolution order (pass-14):
      1. `display_quote_summary` when present AND not too generic.
      2. `display_text` when present AND not dangling AND not too
         generic.
      3. `text` (raw) when not dangling AND ≥ 8 chars.
      4. Attribute-specific summary from the trade-off template
         (the pass-14 escape hatch for when every quote-level field
         is generic / dangling).
      5. Whichever quote-level field was non-empty, even if generic.
      6. A "(인용 요약 부재)" placeholder so the cell isn't empty.
    """
    if not isinstance(quote, dict):
        return ""

    summary = quote.get("display_quote_summary")
    display = quote.get("display_text")
    raw = quote.get("text")

    def _ok(s: object) -> bool:
        """Cell-quality predicate: pass-16 layered filter."""
        if not isinstance(s, str) or not s.strip():
            return False
        return (
            not _looks_dangling(s)
            and not _looks_too_generic(s)
            and not _looks_truncated(s)
        )

    text: str | None = None
    if _ok(summary):
        text = summary.strip()
    elif _ok(display):
        text = display.strip()
    elif _ok(raw):
        text = raw.strip()

    if text is None and attribute_key:
        # Pass-16: switch order. The attribute-specific summary is
        # the preferred fallback when every quote-level field is
        # filler / truncated — it carries actual semantic content
        # ("시트가 얇고 피부에 잘 밀착된다는 의견") without taking
        # any verbatim cell from a low-quality quote.
        attr_summary = _attribute_specific_summary_for(
            attribute_key, polarity or "",
            profile_id=profile_id,
        )
        if attr_summary:
            text = attr_summary

    if text is None:
        # Last-resort fallback — surface whichever non-empty field
        # exists rather than leave the cell blank. Truncated and
        # generic forms are LAST resort, never first choice.
        for v in (summary, display, raw):
            if isinstance(v, str) and v.strip():
                text = v.strip()
                break

    if text is None:
        text = "(인용 요약 부재)"

    if len(text) > max_chars:
        text = text[: max_chars - 1].rstrip() + "…"
    return text


# ---------- Section 1: Cover / Header ----------


def _br3_section_cover(
    *, analysis_report: dict, run_id: str | None,
    generated_at: str | None, styles: dict,
) -> list:
    """Compact seller-facing header.

    Run-003 QA pass-4: the cover NO LONGER carries internal metadata
    (Run ID, goodsNo, OliveYoung review corpus, generated_at) — those
    move to the Appendix.

    Pass-15: cover uses `display_product_name` + `report_title`
    instead of the raw OliveYoung merch headline. Promo brackets
    (`[1위]`, `[기획]`) and gift-bundle phrases ("2개 사면 1개 증정")
    are pulled out by the product-name normalizer. `offer_context`
    (size / set composition) appears as a small disclosure line
    below the title; raw_product_name is appendix-only.
    """
    out: list = []
    product = analysis_report.get("product") or {}
    # Prefer pass-15 split fields; fall back to legacy `name_ko`
    # so a pre-pass-15 analysis_report on disk still renders.
    display_name = product.get("display_product_name") or product.get("name_ko") or "(제품명 미상)"
    report_title = product.get("report_title")
    if not isinstance(report_title, str) or not report_title.strip():
        report_title = f"{display_name} 리뷰 인사이트 리포트"
    offer_context = product.get("offer_context") or ""
    n_reviews = int(
        (analysis_report.get("corpus") or {}).get("n_reviews_analyzed") or 0
    )

    out.append(_br3_para(
        "Review Intelligence Report", styles["report_subtitle"],
    ))
    out.append(_br3_para(f"<b>{report_title}</b>", styles["report_title"]))
    out.append(_br3_para(f"<b>{display_name}</b>", styles["report_subtitle"]))
    if offer_context.strip():
        out.append(_br3_para(
            f"<i>판매 옵션: {offer_context.strip()}</i>",
            styles["muted"],
        ))
    out.append(_br3_para(
        f"실사용 리뷰 {n_reviews:,}건 기반 · 리뷰 정리 자료",
        styles["report_lead"],
    ))
    return out


# ---------- Section 2: Executive Summary ----------


def _br3_kpi_card(label: str, value: str, unit: str, *, styles: dict) -> Table:
    inner = [
        [_br3_para(label, styles["kpi_label"])],
        [_br3_para(value, styles["kpi_value"])],
        [_br3_para(unit, styles["kpi_unit"])],
    ]
    t = Table(inner, colWidths=[52 * mm], rowHeights=[10, 26, 10])
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, _BR3_BORDER),
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    return t


def _br3_section_executive_summary(
    *, analysis_report: dict, styles: dict,
) -> list:
    out: list = []
    out.append(_br3_para("1. Executive Summary (요약)", styles["section_h1"]))

    corpus = analysis_report.get("corpus") or {}
    n_reviews = int(corpus.get("n_reviews_analyzed") or 0)
    attributes = analysis_report.get("attributes") or []
    strengths = analysis_report.get("strengths") or []
    monitoring = analysis_report.get("monitoring_candidates") or []

    # Top satisfaction attribute = strength with the highest support_count.
    if strengths:
        top_strength = max(
            strengths, key=lambda s: int(s.get("supporting_count") or 0),
        )
    else:
        top_strength = {}
    ts_label = _br3_label_for(
        top_strength.get("attribute_key") or "",
        next(
            (a for a in attributes
             if a.get("key") == top_strength.get("attribute_key")),
            None,
        ),
    )
    ts_count = int(top_strength.get("supporting_count") or 0)

    if monitoring:
        top_monitor = max(
            monitoring, key=lambda m: int(m.get("n_negative") or 0),
        )
    else:
        top_monitor = {}
    tm_label = _br3_label_for(
        top_monitor.get("attribute_key") or "",
        next(
            (a for a in attributes
             if a.get("key") == top_monitor.get("attribute_key")),
            None,
        ),
    )
    tm_count = int(top_monitor.get("n_negative") or 0)

    kpi_row = Table(
        [[
            _br3_kpi_card(
                "분석 리뷰 수",
                f"{n_reviews:,}",
                "건",
                styles=styles,
            ),
            _br3_kpi_card(
                "만족 의견 최다 항목",
                ts_label or "—",
                f"{ts_count:,}건" if ts_count else "—",
                styles=styles,
            ),
            _br3_kpi_card(
                "주요 확인 항목",
                tm_label or "—",
                f"{tm_count:,}건" if tm_count else "—",
                styles=styles,
            ),
        ]],
        colWidths=[55 * mm, 55 * mm, 55 * mm],
    )
    kpi_row.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    out.append(kpi_row)
    out.append(Spacer(1, 8))

    # One-line verdict from quick_decision (sanitized + arrow-scrubbed).
    qd = analysis_report.get("quick_decision") or {}
    verdict = qd.get("verdict_ko") or ""
    if verdict:
        out.append(_br3_para(
            f"<b>한 줄 결론.</b> {verdict}", styles["verdict"],
        ))
        out.append(Spacer(1, 4))

    # Top 3 Insight — three labelled lines that work even when the
    # corpus has only a few attributes. Pulls from strengths /
    # contradictions / monitoring so the reader sees a snapshot of
    # "what's strong / what splits / what to check first" without
    # paging through to §2.
    top3 = _br3_top3_insight_lines(analysis_report)
    if top3:
        out.append(Spacer(1, 4))
        out.append(_br3_para(
            "<b>주요 인사이트</b>", styles["insight_label"],
        ))
        for label, body in top3:
            out.append(_br3_para(
                f"<b>{label}.</b> {body}", styles["insight_body"],
            ))

    # Compact caveat — soft amber inline note. Replaces the old caution
    # badge style so it doesn't dominate the executive summary visually.
    # Wording is rephrased into seller-friendly Korean per Run-003 QA
    # pass-4 ("아쉬움 의견이 실제보다 적게 반영됐을 수 있음").
    caveat = _br3_seller_friendly_caveat(analysis_report)
    if caveat:
        cav = Table(
            [[_br3_para(caveat, styles["badge"])]],
            colWidths=[166 * mm],
        )
        cav.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#fdf6ea")),
            ("LINEBELOW", (0, 0), (-1, -1), 0.5, _BR3_CAUTION),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        out.append(Spacer(1, 6))
        out.append(cav)
    return out


def _br3_top3_insight_lines(analysis_report: dict) -> list[tuple[str, str]]:
    """Build a Top 3 Insight bullet list:
        1. 가장 강한 만족 포인트
        2. 가장 많이 갈린 포인트
        3. 가장 먼저 확인할 주의 포인트
    """
    out: list[tuple[str, str]] = []
    attributes = analysis_report.get("attributes") or []
    attr_index = {a.get("key"): a for a in attributes if a.get("key")}

    strengths = sorted(
        analysis_report.get("strengths") or [],
        key=lambda s: -int(s.get("supporting_count") or 0),
    )
    if strengths:
        s0 = strengths[0]
        label = _br3_label_for(
            s0.get("attribute_key") or "",
            attr_index.get(s0.get("attribute_key")),
        )
        n = int(s0.get("supporting_count") or 0)
        out.append((
            "가장 강한 만족 포인트",
            f"<b>{label}</b> · 만족 의견 {n:,}건",
        ))

    # Most-split: attribute with both high positive AND non-trivial
    # negative — pick the largest combined volume from usage_patterns
    # contradictions, fall back to attributes table.
    splits = []
    for a in attributes:
        n_pos = int(a.get("n_positive") or 0)
        n_neg = int(a.get("n_negative") or 0)
        if n_pos >= 30 and n_neg >= 5:
            splits.append((a, n_pos, n_neg))
    splits.sort(key=lambda t: -(t[1] + t[2]))
    if splits:
        a0, n_pos0, n_neg0 = splits[0]
        out.append((
            "가장 많이 갈린 포인트",
            f"<b>{_br3_label_for(a0.get('key') or '', a0)}</b> · "
            f"만족 {n_pos0:,}건 · 아쉬움 {n_neg0:,}건",
        ))

    monitoring = sorted(
        analysis_report.get("monitoring_candidates") or [],
        key=lambda m: -int(m.get("n_negative") or 0),
    )
    if monitoring:
        m0 = monitoring[0]
        label = m0.get("concern_label_ko") or _br3_label_for(
            m0.get("attribute_key") or "",
            attr_index.get(m0.get("attribute_key")),
        )
        n_neg = int(m0.get("n_negative") or 0)
        out.append((
            "가장 먼저 확인할 주의 포인트",
            f"<b>{label}</b> · 아쉬움 의견 {n_neg:,}건",
        ))
    return out


def _br3_seller_friendly_caveat(analysis_report: dict) -> str | None:
    """Convert the raw `headline_caution` into seller-friendly copy.

    Run-003 QA pass-4: the original sentence ("RATING_ASC ... 신호가
    과소 관측되었을 수 있습니다") reads as internal-tool jargon. The
    seller version says the same thing in business Korean.
    """
    axes = (analysis_report.get("corpus") or {}).get("confidence_axes") or {}
    raw = axes.get("headline_caution") or ""
    if not raw:
        return None
    if "RATING_ASC" in raw or "평점 낮은순" in raw or "과소 관측" in raw:
        return (
            "참고: 평점 낮은순 일부 수집이 실패했습니다. "
            "그래서 아쉬움 의견은 실제보다 적게 반영됐을 수 있습니다."
        )
    # Generic fallback — strip the most obvious internal tokens.
    return f"참고: {raw}"


# ---------- Coverage table builder (used in Appendix in v3) ----------


_BR3_AXIS_LABEL_KO: dict[str, str] = {
    "sample_size_confidence": "리뷰 표본 규모",
    "collection_completeness": "수집 완료 정도",
    "negative_signal_coverage": "아쉬움 의견 반영 정도",
    "evidence_reliability": "인용 검증 정도",
}


def _br3_section_coverage(
    *, analysis_report: dict, collection_summary: dict, styles: dict,
    section_label: str = "데이터 범위와 해석 시 유의점",
) -> list:
    out: list = []
    out.append(_br3_para(section_label, styles["section_h1"]))

    n_reviews = int(
        (analysis_report.get("corpus") or {}).get("n_reviews_analyzed") or 0
    )
    succeeded = collection_summary.get("sorts_succeeded") or []
    failed = collection_summary.get("sorts_failed") or []

    # Coverage table.
    rows = [
        [_br3_para("<b>항목</b>", styles["body"]),
         _br3_para("<b>상태</b>", styles["body"]),
         _br3_para("<b>해석</b>", styles["body"])],
        [_br3_para("분석 표본", styles["body"]),
         _br3_para(f"{n_reviews:,}건", styles["body"]),
         _br3_para("반복 패턴 확인 가능", styles["body"])],
        [_br3_para("주 리뷰 표본", styles["body"]),
         _br3_para("DATETIME_DESC (최신순)", styles["body"]),
         _br3_para("분포 산정 기준", styles["body"])],
        [_br3_para("성공 정렬", styles["body"]),
         _br3_para(", ".join(succeeded) or "—", styles["body"]),
         _br3_para("대표 리뷰 보강", styles["body"])],
        [_br3_para("실패 정렬", styles["body"]),
         _br3_para(", ".join(failed) or "없음", styles["body"]),
         _br3_para(
             "아쉬움 의견 과소 반영 가능"
             if "RATING_ASC" in failed else "—",
             styles["body"],
         )],
    ]
    cov_tbl = Table(rows, colWidths=[36 * mm, 60 * mm, 70 * mm])
    cov_tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), KOREAN_FONT),
        ("BACKGROUND", (0, 0), (-1, 0), _BR3_NEUTRAL),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, _BR3_BORDER),
        ("BOX", (0, 0), (-1, -1), 0.5, _BR3_BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    out.append(cov_tbl)
    out.append(Spacer(1, 10))

    # Confidence axes table.
    axes = (analysis_report.get("corpus") or {}).get("confidence_axes") or {}
    if axes:
        out.append(_br3_para(
            "수집 상태 요약", styles["section_h2"],
        ))
        rows2 = [[
            _br3_para("<b>축</b>", styles["body"]),
            _br3_para("<b>판정</b>", styles["body"]),
            _br3_para("<b>해석</b>", styles["body"]),
        ]]
        for k in (
            "sample_size_confidence",
            "collection_completeness",
            "negative_signal_coverage",
            "evidence_reliability",
        ):
            ax = axes.get(k) or {}
            rows2.append([
                _br3_para(_BR3_AXIS_LABEL_KO[k], styles["body"]),
                _br3_para(ax.get("label_ko") or "—", styles["body"]),
                _br3_para(ax.get("note_ko") or "", styles["muted"]),
            ])
        ax_tbl = Table(rows2, colWidths=[40 * mm, 40 * mm, 86 * mm])
        ax_tbl.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), KOREAN_FONT),
            ("BACKGROUND", (0, 0), (-1, 0), _BR3_NEUTRAL),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, _BR3_BORDER),
            ("BOX", (0, 0), (-1, -1), 0.5, _BR3_BORDER),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        out.append(ax_tbl)
    return out


# ---------- Section 4: Key Findings ----------


def _br3_section_findings(
    *, analysis_report: dict, styles: dict,
) -> list:
    out: list = []
    out.append(_br3_para("2. Key Findings (주요 결과)", styles["section_h1"]))

    attributes = analysis_report.get("attributes") or []
    attr_index = {a.get("key"): a for a in attributes if a.get("key")}

    # Top strengths: rank by supporting_count, exclude polarity-suspect
    # representative quotes.
    out.append(_br3_para("2.1 반복된 만족 포인트", styles["section_h2"]))
    strengths = sorted(
        analysis_report.get("strengths") or [],
        key=lambda s: -int(s.get("supporting_count") or 0),
    )[:5]
    if not strengths:
        out.append(_br3_para("표본 내에서 반복적인 만족 포인트가 충분히 누적되지 않았습니다.",
                             styles["muted"]))
    else:
        rows = [[
            _br3_para("<b>순위</b>", styles["body"]),
            _br3_para("<b>항목</b>", styles["body"]),
            _br3_para("<b>만족 의견</b>", styles["body"]),
            _br3_para("<b>비중</b>", styles["body"]),
            _br3_para("<b>대표 리뷰 요약</b>", styles["body"]),
        ]]
        n_total = int(
            (analysis_report.get("corpus") or {}).get("n_reviews_analyzed") or 0
        )
        for i, s in enumerate(strengths, 1):
            attr_key = s.get("attribute_key") or ""
            label = _br3_label_for(attr_key, attr_index.get(attr_key))
            n = int(s.get("supporting_count") or 0)
            pct = f"{(n / n_total * 100):.1f}%" if n_total else "—"
            rep = s.get("representative_quote")
            # Skip representative when the polarity guardrail flagged
            # it as suspect OR the attribute-fit guardrail marked it
            # off-topic. Fall back to the cleanest positive quote in
            # the attribute's top_quotes pool.
            if isinstance(rep, dict) and (
                rep.get("polarity_suspect") or rep.get("attribute_fit_warning")
            ):
                rep = None
                attr_block = attr_index.get(attr_key) or {}
                clean = _br3_filter_quotes_skip_suspect(
                    [q for q in (attr_block.get("top_quotes") or [])
                     if (q.get("polarity") or "").lower() == "positive"]
                )
                if clean:
                    rep = clean[0]
            quote_summary = _br3_quote_summary_for_pdf(rep) if rep else ""
            rows.append([
                _br3_para(str(i), styles["body"]),
                _br3_para(f"<b>{label}</b>", styles["body"]),
                _br3_para(f"{n:,}건", styles["body"]),
                _br3_para(pct, styles["body"]),
                _br3_para(f"&ldquo;{quote_summary}&rdquo;" if quote_summary else "—",
                          styles["evidence_quote"]),
            ])
        s_tbl = Table(
            rows, colWidths=[12 * mm, 36 * mm, 22 * mm, 18 * mm, 78 * mm],
        )
        s_tbl.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), KOREAN_FONT),
            ("BACKGROUND", (0, 0), (-1, 0), _BR3_NEUTRAL),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, _BR3_BORDER),
            ("BOX", (0, 0), (-1, -1), 0.5, _BR3_BORDER),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ALIGN", (0, 0), (0, -1), "CENTER"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        out.append(s_tbl)

    out.append(Spacer(1, 12))

    # Top watch-outs
    out.append(_br3_para("2.2 주요 확인 포인트", styles["section_h2"]))
    monitoring = sorted(
        analysis_report.get("monitoring_candidates") or [],
        key=lambda m: -int(m.get("n_negative") or 0),
    )[:5]
    if not monitoring:
        out.append(_br3_para("표본 내에서 반복적인 아쉬움 의견이 임계치 이상 누적되지 않았습니다.",
                             styles["muted"]))
    else:
        rows = [[
            _br3_para("<b>순위</b>", styles["body"]),
            _br3_para("<b>항목</b>", styles["body"]),
            _br3_para("<b>아쉬움 의견</b>", styles["body"]),
            _br3_para("<b>비중</b>", styles["body"]),
            _br3_para("<b>구매 전 확인 질문</b>", styles["body"]),
        ]]
        n_total = int(
            (analysis_report.get("corpus") or {}).get("n_reviews_analyzed") or 0
        )
        for i, m in enumerate(monitoring, 1):
            attr_key = m.get("attribute_key") or ""
            label = m.get("concern_label_ko") or _br3_label_for(
                attr_key, attr_index.get(attr_key),
            )
            n_neg = int(m.get("n_negative") or 0)
            pct = f"{(n_neg / n_total * 100):.1f}%" if n_total else "—"
            hook = m.get("interview_hook_ko") or "사용 환경/시점별 차이를 다시 한 번 확인"
            rows.append([
                _br3_para(str(i), styles["body"]),
                _br3_para(f"<b>{label}</b>", styles["body"]),
                _br3_para(f"{n_neg:,}건", styles["body"]),
                _br3_para(pct, styles["body"]),
                _br3_para(hook, styles["body"]),
            ])
        m_tbl = Table(
            rows, colWidths=[12 * mm, 36 * mm, 24 * mm, 18 * mm, 76 * mm],
        )
        m_tbl.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), KOREAN_FONT),
            ("BACKGROUND", (0, 0), (-1, 0), _BR3_NEUTRAL),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, _BR3_BORDER),
            ("BOX", (0, 0), (-1, -1), 0.5, _BR3_BORDER),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("ALIGN", (0, 0), (0, -1), "CENTER"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        out.append(m_tbl)
    return out


# ---------- Section 5: Satisfaction vs Friction Matrix ----------


def _br3_matrix_bucket(n_pos: int, n_neg: int) -> tuple[str, str]:
    """Map (positive count, negative count) to a (sat_bin, fric_bin) cell.
    Bins: 'high' (≥100), 'medium' (≥30), 'low' (else)."""
    def bin_of(n: int) -> str:
        if n >= 100:
            return "high"
        if n >= 30:
            return "medium"
        return "low"
    return bin_of(n_pos), bin_of(n_neg)


def _br3_section_matrix(
    *, analysis_report: dict, styles: dict,
) -> list:
    out: list = []
    out.append(_br3_para(
        "3. Satisfaction × Friction Matrix (만족·아쉬움 매트릭스)",
        styles["section_h1"],
    ))
    attributes = analysis_report.get("attributes") or []
    if not attributes:
        out.append(_br3_para("매트릭스로 분류할 속성이 없습니다.", styles["muted"]))
        return out

    # Group by (sat_bin, fric_bin). Render as a 3x3 cell table.
    matrix: dict[tuple[str, str], list[str]] = {}
    for a in attributes:
        n_pos = int(a.get("n_positive") or 0)
        n_neg = int(a.get("n_negative") or 0)
        if n_pos + n_neg == 0:
            continue
        sat, fric = _br3_matrix_bucket(n_pos, n_neg)
        label = _tradeoff_label_for(a.get("key") or "", a)
        matrix.setdefault((sat, fric), []).append(
            f"{label} <font color=\"#888888\">"
            f"(만족 {n_pos:,}건 · 아쉬움 {n_neg:,}건)</font>"
        )

    bins_sat = ("high", "medium", "low")
    bins_fric = ("low", "medium", "high")
    sat_label = {"high": "만족 大", "medium": "만족 中", "low": "만족 小"}
    fric_label = {"low": "아쉬움 小", "medium": "아쉬움 中", "high": "아쉬움 大"}

    rows: list[list] = [[
        _br3_para("", styles["body"]),
    ] + [
        _br3_para(f"<b>{fric_label[f]}</b>", styles["body"]) for f in bins_fric
    ]]
    for s in bins_sat:
        row = [_br3_para(f"<b>{sat_label[s]}</b>", styles["body"])]
        for f in bins_fric:
            cell_attrs = matrix.get((s, f), [])
            cell_text = "<br/>".join(cell_attrs) if cell_attrs else "&nbsp;"
            row.append(_br3_para(cell_text, styles["body"]))
        rows.append(row)

    matrix_tbl = Table(
        rows, colWidths=[22 * mm, 48 * mm, 48 * mm, 48 * mm],
    )
    style_cmds: list = [
        ("FONTNAME", (0, 0), (-1, -1), KOREAN_FONT),
        ("BACKGROUND", (0, 0), (-1, 0), _BR3_NEUTRAL),
        ("BACKGROUND", (0, 0), (0, -1), _BR3_NEUTRAL),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, _BR3_BORDER),
        ("BOX", (0, 0), (-1, -1), 0.5, _BR3_BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (-1, 0), "CENTER"),
        ("ALIGN", (0, 1), (0, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    # Tint cells by zone — top-left soft green (high sat / low fric =
    # safest), bottom-right soft amber (low sat / high fric = priority).
    style_cmds.append(("BACKGROUND", (1, 1), (1, 1), colors.HexColor("#eaf3ec")))
    style_cmds.append(("BACKGROUND", (3, 3), (3, 3), colors.HexColor("#fdf3e3")))
    matrix_tbl.setStyle(TableStyle(style_cmds))
    out.append(matrix_tbl)
    out.append(Spacer(1, 4))
    out.append(_br3_para(
        "<i>가로축: 아쉬움 의견 누적 규모 · 세로축: 만족 의견 누적 규모. "
        "오른쪽 하단으로 갈수록 구매 전 확인 우선순위가 높은 항목입니다.</i>",
        styles["muted"],
    ))

    # 3.1 의견 분기 해석 — surfaced when at least one attribute split
    # the buyer base. Frames the matrix's mid-cells as a usable
    # operating signal rather than a contradiction to be resolved.
    tradeoff_blocks = compute_tradeoff_blocks(analysis_report)
    if tradeoff_blocks:
        out.append(Spacer(1, 8))
        out.append(_br3_para(
            "의견이 갈린 항목은 어떻게 봐야 할까요?",
            styles["section_h2"],
        ))
        # Pick the top-3 split items by volume for the explainer
        # bullet — keeps the section short and operator-readable.
        top_split_labels = [
            b["label_ko"] for b in tradeoff_blocks[:3]
        ]
        split_phrase = (
            ", ".join(top_split_labels)
            if top_split_labels else "일부 항목"
        )
        # Topic particle by batchim of the last syllable so the
        # sentence reads naturally (촉촉함/마무리감 → 은,
        # 건조감·당김 체감 → 은). Falls back to 은 when uncertain.
        topic_particle = "은"
        if split_phrase:
            last = split_phrase.strip()[-1]
            code = ord(last)
            if 0xAC00 <= code <= 0xD7A3:
                topic_particle = "는" if (code - 0xAC00) % 28 == 0 else "은"
        bullets = [
            "만족과 아쉬움이 함께 나온 항목은 결함 확정이 아니라 "
            "사용 조건별 체감 차이일 수 있습니다.",
            f"특히 <b>{split_phrase}</b>{topic_particle} 사용자 기대치 / "
            "사용 환경에 따라 반응이 갈립니다.",
            "상세페이지 / CS / 콘텐츠에서는 “누구에게 잘 맞는지”와 "
            "“누가 한 번 더 확인해야 하는지”를 함께 안내하는 것이 "
            "도움이 됩니다.",
        ]
        for b in bullets:
            out.append(_br3_para(f"• {b}", styles["body"]))

    return out


# ---------- Section 6: Decision Implications ----------


def _br3_section_decisions(
    *, analysis_report: dict, styles: dict,
) -> list:
    out: list = []
    out.append(_br3_para(
        "4. Decision Implications (의사결정 시사점)",
        styles["section_h1"],
    ))
    monitoring = sorted(
        analysis_report.get("monitoring_candidates") or [],
        key=lambda m: -int(m.get("n_negative") or 0),
    )[:5]
    if not monitoring:
        out.append(_br3_para("이번 표본에서는 별도 의사결정 시사점이 도출되지 않았습니다.",
                             styles["muted"]))
        return out

    attributes = analysis_report.get("attributes") or []
    attr_index = {a.get("key"): a for a in attributes if a.get("key")}
    # Predefined "왜 중요한가" framing per attribute key — operator-
    # friendly (no 신호/모니터링 jargon).
    #
    # Pass-19: profile-aware overlay. The default dict is skincare-pad-
    # leaning ("persistence" = "보습 효과 기대치와 직접 연결"); for
    # base_makeup that wording is wrong (cushion persistence is about
    # 무너짐 / 다크닝 / 수정화장, not moisture). The overlay below is
    # consulted before the default for the active profile.
    product_block = analysis_report.get("product") or {}
    active_profile_id = product_block.get("selected_profile_id")
    why_phrase_default: dict[str, str] = {
        "finish_texture": "구매 후 첫 사용 인상에 직접 영향",
        "value_price": "재구매·번들 결정에 직결",
        "dryness_skin_texture": "피부 타입별 만족도 분기 가능성",
        "adhesion_base_interaction": "사용 시간/시나리오별 체감 차이",
        "packaging_container": "선물 / 휴대 시나리오 평가에 영향",
        "applicator_tool": "위생/사용 편의 인식과 연결",
        "persistence": "보습 효과 기대치와 직접 연결",
        "color_tone_matching": "구매 전 기대 색감과 연결",
        "pigmentation": "상세페이지 발색 표현 검증 필요",
        "transfer_resistance": "마스크 / 외출 시나리오에 영향",
    }
    why_phrase_overlay_by_profile: dict[str, dict[str, str]] = {
        "base_makeup": {
            "dryness_skin_texture": "피부 타입별 만족도 분기 가능성",
            "persistence": "무너짐 · 다크닝 · 수정화장 빈도와 연결",
            "color_tone_matching": "구매 전 기대 색상과 실제 피부톤 차이",
            "adhesion_base_interaction": "들뜸 · 끼임 · 밀림 체감과 연결",
            "applicator_tool": "퍼프 사용감과 양 조절 편의에 영향",
            "packaging_container": "휴대 / 외출 시나리오 평가에 영향",
            "transfer_resistance": "마스크 / 의류 마찰 시나리오에 영향",
        },
    }
    rec_question_overlay_by_profile: dict[str, dict[str, str]] = {
        "base_makeup": {
            "dryness_skin_texture":
                "건성 피부 / 각질 부각 / 기초 보습 후 사용 여부 확인",
            "persistence":
                "마스크 묻어남 / 유분·땀 / 장시간 외출 상황 확인",
            "color_tone_matching":
                "호수 선택 / 밝기 / 다크닝 / 홍조 커버 확인",
            "adhesion_base_interaction":
                "사용량 / 기초 단계 / 사용 도구별 체감 확인",
        },
    }
    profile_overlay = (
        why_phrase_overlay_by_profile.get(active_profile_id or "")
        if active_profile_id else None
    ) or {}
    rec_overlay = (
        rec_question_overlay_by_profile.get(active_profile_id or "")
        if active_profile_id else None
    ) or {}

    def _resolve_why(attr_key: str) -> str:
        if attr_key in profile_overlay:
            return profile_overlay[attr_key]
        return why_phrase_default.get(
            attr_key, "구매 결정 맥락과 연결될 수 있는 항목",
        )
    priority_rank: dict[int, str] = {0: "P1", 1: "P2", 2: "P3"}

    rows = [[
        _br3_para("<b>이슈</b>", styles["body"]),
        _br3_para("<b>왜 중요한가</b>", styles["body"]),
        _br3_para("<b>권장 확인</b>", styles["body"]),
        _br3_para("<b>우선순위</b>", styles["body"]),
    ]]
    for i, m in enumerate(monitoring):
        attr_key = m.get("attribute_key") or ""
        label = m.get("concern_label_ko") or _br3_label_for(
            attr_key, attr_index.get(attr_key),
        )
        why = _resolve_why(attr_key)
        rec = m.get("interview_hook_ko") or rec_overlay.get(attr_key) or (
            "리뷰에서 반복된 사용 맥락과 본인 환경을 비교 후 검토 권장"
        )
        prio = priority_rank.get(i, "P3")
        rows.append([
            _br3_para(f"<b>{label}</b>", styles["body"]),
            _br3_para(why, styles["body"]),
            _br3_para(rec, styles["body"]),
            _br3_para(prio, styles["body"]),
        ])
    tbl = Table(rows, colWidths=[40 * mm, 56 * mm, 56 * mm, 14 * mm])
    tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), KOREAN_FONT),
        ("BACKGROUND", (0, 0), (-1, 0), _BR3_NEUTRAL),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, _BR3_BORDER),
        ("BOX", (0, 0), (-1, -1), 0.5, _BR3_BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (3, 0), (3, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    out.append(tbl)
    out.append(Spacer(1, 4))
    out.append(_br3_para(
        "<i>본 표는 운영/CS 의사결정 후보 목록이며 결함 확정 자료가 아닙니다.</i>",
        styles["muted"],
    ))
    return out


# ---------- Section 7: Buyer Content Translation ----------


# Pass-14: trade-off (의견 분기) framework.
#
# Cosmetics reviews routinely show the same attribute being praised by
# some buyers and criticized by others — not because the product is
# defective but because skin type, expectation, dosage, season, or
# co-applied products differ. The narrative layer treats this as
# `의견 분기 / 체감 차이`, never as 모순 / 상반 / conflict.
#
# Display-label override for ambivalence-prone attributes. The
# canonical `ATTRIBUTE_LABELS_KO` carries "건조감/당김" which reads
# awkwardly on the positive side ("건조감/당김 만족 의견"). The
# v3 PDF substitutes a neutral-tone label so positive and negative
# summaries both read naturally.
_TRADEOFF_LABEL_OVERRIDE_KO: dict[str, str] = {
    "dryness_skin_texture": "건조감·당김 체감",
}


def _tradeoff_label_for(attr_key: str, attribute_block: dict | None = None) -> str:
    """Resolve the v3 display label, preferring the ambivalence-aware
    override when one exists. Falls through to the standard
    `_br3_label_for` resolution for everything else."""
    if attr_key in _TRADEOFF_LABEL_OVERRIDE_KO:
        return _TRADEOFF_LABEL_OVERRIDE_KO[attr_key]
    return _br3_label_for(attr_key, attribute_block)


# Per-attribute trade-off narrative templates, keyed by profile_id.
# Pass-15: profile-aware split. Each per-attribute entry mirrors the
# pass-14 spec fields: positive_side_summary / negative_side_summary
# / likely_split_drivers / buyer_fit_implication / seller_action /
# content_phrase_example / buyer_fit_when / buyer_check_when.
#
# Resolution: profile_id → attr_key. Falls through to
# fallback_generic when the profile has no entry for that attribute,
# then to a minimal generic block when even fallback_generic is
# missing (only happens for attribute keys we haven't templated).
#
# Phrasing rules (apply across every profile):
#   - No 모순 / 상반 / conflict / contradiction terminology.
#   - Both sides framed as buyer-experience differences, never as
#     product-defect attributions.
#   - Driver lists are skin-type / use-condition oriented, not
#     judgment-based.
#   - seller_action is operational (상세페이지 / CS / 콘텐츠), never
#     R&D / 제조 directive — matches the protected hedged-candidate
#     contract from CLAUDE.md §8.
_TRADEOFF_BLOCKS_SKINCARE_PAD: dict[str, dict[str, str]] = {
    "finish_texture": {
        "positive_side_summary":
            "촉촉하고 편안한 마무리감을 만족 포인트로 언급",
        "negative_side_summary":
            "일부는 끈적임/답답함/흡수 후 마무리감을 아쉬움으로 언급",
        "likely_split_drivers":
            "피부 타입, 사용량, 계절, 선호 마무리감, 병용 제품",
        "buyer_fit_implication":
            "촉촉한 마무리를 기대하면 적합하지만, "
            "산뜻한 마무리를 선호하면 사용량과 사용 시간을 확인할 필요",
        "seller_action":
            "상세페이지에 마무리감 기대치를 명확히 쓰고, "
            "사용량/사용 시간 안내 추가",
        "content_phrase_example":
            "촉촉한 마무리를 선호하는 분께 적합해요. "
            "산뜻한 사용감을 원한다면 사용량을 조절해 보세요.",
        "buyer_fit_when":
            "촉촉한 마무리와 수분감을 기대하는 경우",
        "buyer_check_when":
            "산뜻함, 빠른 흡수, 끈적임 적은 사용감을 선호하는 경우",
    },
    "dryness_skin_texture": {
        "positive_side_summary":
            "건조함이 덜하고 당김이 적다는 의견",
        "negative_side_summary":
            "금방 건조해지거나 당김이 있다는 의견",
        "likely_split_drivers":
            "피부 타입(건성·민감), 계절·실내 습도, 사용 시간, 보습 단계 유무",
        "buyer_fit_implication":
            "보습 단계 사이에 사용하면 건조감을 줄일 수 있고, "
            "건성·민감 피부는 사용 시간과 보습 단계를 함께 확인할 필요",
        "seller_action":
            "상세페이지에 권장 사용 시간 / 보습 단계 / 권장 피부 타입 안내, "
            "FAQ에 건조감 호소 시 단계별 사용법 정리",
        "content_phrase_example":
            "보습 보강 단계로 활용하기 좋아요. "
            "건성·민감 피부라면 권장 사용 시간을 함께 확인해 보세요.",
        "buyer_fit_when":
            "보습 보강 단계로 사용하거나 수분 보강을 기대하는 경우",
        "buyer_check_when":
            "건성·민감 피부이거나 사용 시간/보습 단계 유무가 중요한 경우",
    },
    "adhesion_base_interaction": {
        "positive_side_summary":
            "시트가 얇고 피부에 잘 밀착된다는 의견",
        "negative_side_summary":
            "밀착 체감이 약하거나 들뜸을 느꼈다는 아쉬움으로 언급",
        "likely_split_drivers":
            "사용 시나리오, 베이스 / 메이크업 병용, 사용 시간",
        "buyer_fit_implication":
            "가벼운 데일리 사용에는 적합하지만, "
            "장시간·베이스 위 사용은 본인 환경 비교 후 결정 필요",
        "seller_action":
            "상세페이지에 권장 사용 시나리오 / 시간 / 병용 가능 단계 명시",
        "content_phrase_example":
            "가벼운 데일리 사용에 적합해요. "
            "장시간 사용이나 메이크업 위 사용이라면 사용 후기를 한 번 더 확인해 보세요.",
        "buyer_fit_when":
            "가벼운 데일리 사용 / 짧은 사용 시간을 가정하는 경우",
        "buyer_check_when":
            "장시간 사용 / 베이스 위 사용 시나리오가 주된 사용 환경인 경우",
    },
    "persistence": {
        "positive_side_summary":
            "사용 후 보습 지속이 길게 느껴진다는 만족 포인트로 언급",
        "negative_side_summary":
            "지속 시간이 짧게 느껴진다는 아쉬움으로 언급",
        "likely_split_drivers":
            "피부 타입, 사용 시간대(오전/저녁), 실내 환경, 병용 보습 단계",
        "buyer_fit_implication":
            "단기 보습 보강을 기대하면 적합하지만, "
            "장시간 지속을 기대하면 보습 단계 추가가 필요할 수 있음",
        "seller_action":
            "상세페이지에 기대 가능한 사용 시간대와 보습 단계 안내 추가",
        "content_phrase_example":
            "단기 수분 보강에 좋아요. "
            "오래 지속되는 보습을 원하시면 마무리 보습 단계를 함께 사용해 보세요.",
        "buyer_fit_when":
            "단기 수분 보강 / 시간대 한정 사용을 가정하는 경우",
        "buyer_check_when":
            "장시간 지속 보습을 기대하거나 건조한 환경에서 사용하는 경우",
    },
    "value_price": {
        "positive_side_summary":
            "대용량/할인 구성 기준 가성비를 만족 포인트로 언급",
        "negative_side_summary":
            "체감 가성비가 사용 빈도에 따라 갈린다는 아쉬움으로 언급",
        "likely_split_drivers":
            "사용 빈도, 1회 사용량, 동시 보유 제품, 가격 비교 기준",
        "buyer_fit_implication":
            "자주 사용하는 분께 가성비가 유리하지만, "
            "가끔 사용하는 분은 보관 / 유효기간을 함께 점검 필요",
        "seller_action":
            "상세페이지에 권장 사용 빈도 / 유효기간 / 보관 안내 추가",
        "content_phrase_example":
            "꾸준히 자주 쓰시는 분께 가성비가 좋아요. "
            "사용 빈도가 낮다면 보관과 유효기간을 함께 확인해 보세요.",
        "buyer_fit_when":
            "꾸준히 자주 사용하거나 대용량 구성을 활용하는 경우",
        "buyer_check_when":
            "사용 빈도가 낮거나 보관·유효기간이 중요한 경우",
    },
    "packaging_container": {
        "positive_side_summary":
            "휴대 / 선물 용도로 패키지 만족 포인트로 언급",
        "negative_side_summary":
            "용기 / 집게 / 뚜껑 사용감 아쉬움으로 언급",
        "likely_split_drivers":
            "사용 시나리오(가정/외출), 보관 위치, 손에 묻는지 여부",
        "buyer_fit_implication":
            "가정 보관에는 적합하지만, "
            "휴대 시나리오는 후기를 한 번 더 확인 권장",
        "seller_action":
            "용기 / 집게 사용 안내, 휴대 시 권장 사용 방식 콘텐츠 추가",
        "content_phrase_example":
            "집에서 사용하시기에 편해요. 휴대용으로 자주 가지고 다니실 분은 "
            "용기 후기를 함께 확인해 보세요.",
        "buyer_fit_when":
            "주로 가정에서 사용하거나 선물 용도로 고려하는 경우",
        "buyer_check_when":
            "외출·휴대 시나리오가 잦거나 손에 묻는 사용감이 신경 쓰이는 경우",
    },
    "applicator_tool": {
        "positive_side_summary":
            "도구 사용이 편하다는 의견",
        "negative_side_summary":
            "도구 사용감 / 위생을 아쉬움으로 언급",
        "likely_split_drivers":
            "사용 방식(맨손/도구), 위생 선호, 보관 환경",
        "buyer_fit_implication":
            "도구 사용에 익숙하면 편하지만, "
            "맨손 선호 / 위생을 중시하는 경우 사용 방식 비교 권장",
        "seller_action":
            "도구 사용·세척·보관 가이드를 콘텐츠로 추가",
        "content_phrase_example":
            "도구 사용이 편한 분께 적합해요. "
            "위생 / 맨손 사용을 선호하시면 사용 방식을 한 번 더 확인해 보세요.",
        "buyer_fit_when":
            "도구 사용 / 위생 도구 활용에 익숙한 경우",
        "buyer_check_when":
            "맨손 사용을 선호하거나 도구 위생을 중시하는 경우",
    },
}


# ---------- Profile: skincare_general (toner / lotion / cream / serum) ----------
_TRADEOFF_BLOCKS_SKINCARE_GENERAL: dict[str, dict[str, str]] = {
    "finish_texture": {
        "positive_side_summary":
            "촉촉하고 편안한 마무리감을 만족 포인트로 언급",
        "negative_side_summary":
            "일부는 끈적임 / 답답함 / 무거운 마무리감을 아쉬움으로 언급",
        "likely_split_drivers":
            "피부 타입, 사용량, 계절, 기초 단계, 병용 제품",
        "buyer_fit_implication":
            "촉촉한 마무리를 기대하면 적합하지만, "
            "산뜻한 사용감을 선호하면 사용량과 기초 단계를 확인할 필요",
        "seller_action":
            "상세페이지에 권장 사용량 / 기초 단계별 사용 팁 추가",
        "content_phrase_example":
            "촉촉한 마무리를 선호하는 분께 적합해요. "
            "산뜻한 사용감을 원하시면 사용량을 조절해 보세요.",
        "buyer_fit_when":
            "촉촉한 마무리와 수분감을 기대하는 경우",
        "buyer_check_when":
            "산뜻한 사용감 / 빠른 흡수를 선호하는 경우",
    },
    "dryness_skin_texture": {
        "positive_side_summary":
            "건조함이 덜하고 당김이 적다는 의견",
        "negative_side_summary":
            "금방 건조해지거나 당김이 있다는 의견",
        "likely_split_drivers":
            "피부 타입(건성·민감), 계절·실내 습도, 기초 단계, 사용량",
        "buyer_fit_implication":
            "보습 단계로 활용하면 건조감을 줄일 수 있고, "
            "건성·민감 피부는 사용량과 보습 단계를 함께 확인할 필요",
        "seller_action":
            "권장 사용량 / 기초 단계 / 권장 피부 타입 안내, "
            "FAQ에 단계별 사용법 정리",
        "content_phrase_example":
            "보습 보강 단계로 활용하기 좋아요. "
            "건성·민감 피부라면 권장 사용량을 함께 확인해 보세요.",
        "buyer_fit_when":
            "보습 보강 / 수분 보강을 기대하는 경우",
        "buyer_check_when":
            "건성·민감 피부이거나 사용량 / 보습 단계가 중요한 경우",
    },
    "persistence": {
        "positive_side_summary":
            "사용 후 보습 지속이 길게 느껴진다는 만족 포인트로 언급",
        "negative_side_summary":
            "지속 시간이 짧게 느껴진다는 아쉬움으로 언급",
        "likely_split_drivers":
            "피부 타입, 사용 시간대, 실내 환경, 병용 보습 단계",
        "buyer_fit_implication":
            "단기 보습 보강을 기대하면 적합하지만, "
            "장시간 지속을 기대하면 마무리 보습 단계 추가가 필요할 수 있음",
        "seller_action":
            "상세페이지에 기대 가능한 사용 시간대와 보습 단계 안내",
        "content_phrase_example":
            "단기 수분 보강에 좋아요. "
            "오래 지속되는 보습을 원하시면 마무리 보습 단계를 함께 사용해 보세요.",
        "buyer_fit_when":
            "단기 수분 보강을 가정하는 경우",
        "buyer_check_when":
            "장시간 지속 보습을 기대하거나 건조한 환경에서 사용하는 경우",
    },
    "value_price": {
        "positive_side_summary":
            "용량/가성비를 만족 포인트로 언급",
        "negative_side_summary":
            "체감 가성비가 사용 빈도에 따라 갈린다는 아쉬움으로 언급",
        "likely_split_drivers":
            "사용 빈도, 1회 사용량, 보유 제품, 가격 비교 기준",
        "buyer_fit_implication":
            "꾸준히 사용하는 분께 가성비가 유리하지만, "
            "가끔 사용하는 분은 보관 / 유효기간을 함께 점검 필요",
        "seller_action":
            "권장 사용 빈도 / 유효기간 / 보관 안내",
        "content_phrase_example":
            "꾸준히 자주 쓰시는 분께 가성비가 좋아요. "
            "사용 빈도가 낮다면 보관과 유효기간을 함께 확인해 보세요.",
        "buyer_fit_when":
            "꾸준히 자주 사용하는 경우",
        "buyer_check_when":
            "사용 빈도가 낮거나 보관·유효기간이 중요한 경우",
    },
    "packaging_container": _TRADEOFF_BLOCKS_SKINCARE_PAD["packaging_container"],
}


# ---------- Profile: base_makeup (foundation / cushion / BB / 톤업크림) ----------
_TRADEOFF_BLOCKS_BASE_MAKEUP: dict[str, dict[str, str]] = {
    "finish_texture": {
        "positive_side_summary":
            "피부 표현과 밀착감을 만족 포인트로 언급",
        "negative_side_summary":
            "일부는 두꺼움 / 끼임 / 무너짐을 아쉬움으로 언급",
        "likely_split_drivers":
            "피부 타입, 기초 단계, 사용 도구, 마스크 착용, 수정 화장 빈도",
        "buyer_fit_implication":
            "밀착 표현을 기대하면 적합하지만, "
            "얇고 가벼운 표현을 선호하면 사용량과 기초 단계를 확인할 필요",
        "seller_action":
            "피부 타입별 사용 팁과 도구별 발림 차이를 안내",
        "content_phrase_example":
            "밀착되는 표현을 선호하는 분께 적합해요. "
            "얇고 가벼운 표현을 원하시면 사용량과 기초 단계를 함께 확인해 보세요.",
        "buyer_fit_when":
            "밀착되는 피부 표현 / 커버를 기대하는 경우",
        "buyer_check_when":
            "얇고 가벼운 표현 / 빠른 마무리를 선호하는 경우",
    },
    "pigmentation": {
        "positive_side_summary":
            "발색 / 커버 정도를 만족 포인트로 언급",
        "negative_side_summary":
            "일부는 커버 부족 / 색상 표현이 다르다는 아쉬움으로 언급",
        "likely_split_drivers":
            "피부 톤, 사용량, 사용 도구, 기대 커버 강도",
        "buyer_fit_implication":
            "원하는 커버 강도를 명확히 비교 후 결정 필요",
        "seller_action":
            "톤별 발색 비교 콘텐츠 / 사용량별 커버 차이 안내",
        "content_phrase_example":
            "기대 커버에 따라 사용량을 조절해 보세요. "
            "색상 후기는 톤이 비슷한 분의 후기를 함께 확인하는 것이 도움이 됩니다.",
        "buyer_fit_when":
            "원하는 커버 강도와 후기 톤이 일치하는 경우",
        "buyer_check_when":
            "기대 커버 강도가 다르거나 색상 매칭이 중요한 경우",
    },
    "transfer_resistance": {
        "positive_side_summary":
            "묻어남이 적거나 픽싱이 잘 된다는 만족 포인트로 언급",
        "negative_side_summary":
            "일부는 마스크 / 옷 묻어남을 아쉬움으로 언급",
        "likely_split_drivers":
            "사용량, 세팅 방식, 마스크 / 의류 마찰, 외출 시간",
        "buyer_fit_implication":
            "사용량 / 세팅 방식에 따라 묻어남이 다를 수 있어 후기 환경 비교 필요",
        "seller_action":
            "세팅 / 수정 화장 / 마스크 착용 시 사용 팁 콘텐츠 추가",
        "content_phrase_example":
            "세팅 방식과 사용량에 따라 묻어남이 달라질 수 있어요. "
            "본인 사용 환경과 비슷한 후기를 함께 확인해 보세요.",
        "buyer_fit_when":
            "본인 사용량 / 세팅 방식이 후기 다수와 비슷한 경우",
        "buyer_check_when":
            "마스크 / 외출 시간이 길거나 의류 마찰이 잦은 경우",
    },
    "color_tone_matching": {
        "positive_side_summary":
            "피부톤과 자연스럽게 맞거나 화사하다는 만족 포인트로 언급",
        "negative_side_summary":
            "일부는 밝기 / 다크닝 / 칙칙함을 아쉬움으로 언급",
        "likely_split_drivers":
            "피부 톤, 사용량, 조명 환경, 화면 색감 차이",
        "buyer_fit_implication":
            "톤 매칭은 개인 차가 큰 항목이므로 톤이 비슷한 후기를 비교 후 결정 필요",
        "seller_action":
            "톤별 매칭 후기 / 매장 테스트 / 자연광 발색 사진 추가",
        "content_phrase_example":
            "톤이 비슷한 분의 후기를 한 번 더 확인해 보세요. "
            "매장에서 발색을 직접 보시는 것도 도움이 됩니다.",
        "buyer_fit_when":
            "호수가 본인 톤과 잘 맞는 후기 다수가 있는 경우",
        "buyer_check_when":
            "호수 선택 / 다크닝 / 홍조 커버가 중요한 경우",
    },
    "dryness_skin_texture": {
        "positive_side_summary":
            "건조함이나 각질 부각이 덜하다는 만족 포인트로 언급",
        "negative_side_summary":
            "일부는 건조함 / 당김 / 각질·요철 부각을 아쉬움으로 언급",
        "likely_split_drivers":
            "피부 타입(건성·민감), 기초 케어 단계, 각질 정리 빈도, 사용량",
        "buyer_fit_implication":
            "기초 보습 후 매끈한 베이스 표현을 원하면 적합하지만, "
            "건성·민감 피부 / 각질 부각이 쉬운 피부는 기초 단계와 사용량 확인 필요",
        "seller_action":
            "권장 기초 단계 / 사용량 / 피부 타입별 사용 팁 안내",
        "content_phrase_example":
            "기초 보습 후 매끈한 베이스 표현을 원하시는 분께 적합해요. "
            "건성·민감 피부라면 사용량과 기초 단계를 함께 확인해 보세요.",
        "buyer_fit_when":
            "기초 보습 후 매끈한 베이스 표현을 원하는 경우",
        "buyer_check_when":
            "건성·민감 피부, 각질 부각이 쉬운 피부",
    },
    "adhesion_base_interaction": {
        "positive_side_summary":
            "얇게 밀착되고 피부 표현이 편하다는 만족 포인트로 언급",
        "negative_side_summary":
            "일부는 들뜸 / 끼임 / 밀림을 아쉬움으로 언급",
        "likely_split_drivers":
            "피부 타입, 기초 보습 단계, 사용량, 사용 도구, 마스크 마찰",
        "buyer_fit_implication":
            "얇게 밀착되는 표현을 기대하면 적합하지만, "
            "들뜸·끼임 체감이 신경 쓰이면 사용량과 기초 단계 확인 필요",
        "seller_action":
            "도구별 발림 / 사용량별 두께 차이 / 기초 단계 가이드 안내",
        "content_phrase_example":
            "얇게 밀착되는 베이스 표현을 선호하는 분께 적합해요. "
            "들뜸·끼임이 신경 쓰이면 사용량과 기초 단계를 함께 확인해 보세요.",
        "buyer_fit_when":
            "얇은 밀착 / 가벼운 베이스 표현을 선호하는 경우",
        "buyer_check_when":
            "들뜸 / 끼임 / 밀림 체감이 중요한 경우",
    },
    "application_blending": {
        "positive_side_summary":
            "얇고 부드럽게 발린다는 만족 포인트로 언급",
        "negative_side_summary":
            "일부는 펴바르기 어렵거나 뭉침을 아쉬움으로 언급",
        "likely_split_drivers":
            "사용 도구(퍼프·브러시·손), 사용량, 피부 결, 베이스 단계",
        "buyer_fit_implication":
            "본인 사용 도구 / 사용량과 후기 환경이 비슷한지 비교 후 결정 필요",
        "seller_action":
            "도구별 / 사용량별 발림 비교 콘텐츠 추가",
        "content_phrase_example":
            "도구와 사용량에 따라 발림이 달라질 수 있어요. "
            "본인 사용 환경과 비슷한 후기를 함께 확인해 보세요.",
        "buyer_fit_when":
            "본인 사용 도구 / 사용량이 후기 다수와 비슷한 경우",
        "buyer_check_when":
            "도구·사용량이 다르거나 뭉침 체감이 중요한 경우",
    },
    "persistence": {
        "positive_side_summary":
            "다크닝이나 무너짐이 적고 오래 유지된다는 만족 포인트로 언급",
        "negative_side_summary":
            "일부는 시간이 지나며 무너짐 / 다크닝 / 수정화장을 아쉬움으로 언급",
        "likely_split_drivers":
            "피부 타입, 유분·땀 정도, 사용량, 마스크 착용, 외출 시간",
        "buyer_fit_implication":
            "장시간 유지력을 기대하면 사용 환경(유분·땀·마스크)과 후기 환경 비교 필요",
        "seller_action":
            "유분·땀 환경별 무너짐 후기 / 수정화장 가이드 / 픽서 사용 팁 안내",
        "content_phrase_example":
            "장시간 외출이나 마스크 착용 시 무너짐 후기를 함께 확인해 보세요. "
            "픽서·세팅 단계를 병행하면 지속력이 달라질 수 있어요.",
        "buyer_fit_when":
            "유분·땀이 적거나 짧은 외출 시간이 가정인 경우",
        "buyer_check_when":
            "마스크·외출 시간이 길거나 유분·땀이 많은 경우",
    },
    "applicator_tool": {
        "positive_side_summary":
            "퍼프 사용감과 양 조절이 편하다는 만족 포인트로 언급",
        "negative_side_summary":
            "일부는 퍼프나 도구 사용감을 아쉬움으로 언급",
        "likely_split_drivers":
            "퍼프 종류, 세척 빈도, 사용 방식, 손 사용 병행 여부",
        "buyer_fit_implication":
            "퍼프 사용 빈도 / 세척 환경이 후기 다수와 비슷한지 비교 권장",
        "seller_action":
            "퍼프 세척 가이드 / 도구별 발림 차이 / 리필 안내",
        "content_phrase_example":
            "퍼프 세척 빈도와 사용 방식에 따라 사용감이 달라질 수 있어요. "
            "본인 사용 환경과 비슷한 후기를 함께 확인해 보세요.",
        "buyer_fit_when":
            "퍼프 사용 / 세척 환경이 후기 다수와 비슷한 경우",
        "buyer_check_when":
            "퍼프 세척이 어렵거나 손 사용을 선호하는 경우",
    },
    "packaging_container": {
        "positive_side_summary":
            "패키지 디자인과 휴대성을 만족 포인트로 언급",
        "negative_side_summary":
            "일부는 지문 / 먼지 / 배송·포장 상태를 아쉬움으로 언급",
        "likely_split_drivers":
            "휴대 빈도, 외부 보관 환경, 배송 / 검수 상태",
        "buyer_fit_implication":
            "휴대 시나리오를 자주 가정하면 적합하지만, "
            "지문·먼지·검수 상태가 중요하면 후기를 한 번 더 확인 권장",
        "seller_action":
            "배송 / 포장 검수 안내 / 휴대 사용 팁 / 케이스 청소 가이드",
        "content_phrase_example":
            "휴대용으로 자주 사용하시는 분께 적합해요. "
            "패키지 검수 상태가 중요하시면 배송 / 포장 후기를 함께 확인해 보세요.",
        "buyer_fit_when":
            "외출 / 휴대 시나리오가 잦은 경우",
        "buyer_check_when":
            "지문·먼지·검수 상태가 중요한 경우",
    },
}


# ---------- Profile: lip_makeup (lipstick / lip tint / lip gloss) ----------
_TRADEOFF_BLOCKS_LIP_MAKEUP: dict[str, dict[str, str]] = {
    "finish_texture": {
        "positive_side_summary":
            "마무리감 / 발림성을 만족 포인트로 언급",
        "negative_side_summary":
            "일부는 끈적임 / 건조함 / 갈라짐을 아쉬움으로 언급",
        "likely_split_drivers":
            "입술 상태, 사용량, 베이스 케어, 음식 / 음료 빈도",
        "buyer_fit_implication":
            "기대하는 마무리감(글로시 / 매트)을 후기 다수와 비교 후 결정 필요",
        "seller_action":
            "마무리감 카테고리 / 베이스 케어 팁 / 사용 시 주의 사항 안내",
        "content_phrase_example":
            "기대 마무리감을 후기 다수와 비교해 보시고, "
            "입술 케어 단계를 병행하면 사용감이 좋아질 수 있어요.",
        "buyer_fit_when":
            "원하는 마무리감(글로시·매트)이 후기 다수와 일치하는 경우",
        "buyer_check_when":
            "입술이 건조하거나 다른 마무리감을 선호하는 경우",
    },
    "pigmentation": {
        "positive_side_summary":
            "발색이 선명하다는 만족 포인트로 언급",
        "negative_side_summary":
            "일부는 발색이 약하다 / 의도와 다르게 나온다는 아쉬움으로 언급",
        "likely_split_drivers":
            "입술 본연의 톤, 사용량, 레이어링 횟수, 도구 / 직접 사용",
        "buyer_fit_implication":
            "기대 발색 강도와 후기 다수의 발색을 비교 후 결정 필요",
        "seller_action":
            "톤별 / 레이어링별 발색 비교 콘텐츠 추가",
        "content_phrase_example":
            "기대 발색에 따라 레이어링 횟수를 조절해 보세요. "
            "톤이 비슷한 분의 후기를 함께 보시면 도움이 됩니다.",
        "buyer_fit_when":
            "원하는 발색 강도가 후기 다수와 비슷한 경우",
        "buyer_check_when":
            "기대 발색이 다르거나 본연 입술 톤이 짙은 경우",
    },
    "persistence": {
        "positive_side_summary":
            "발색·색 지속이 오래 간다는 만족 포인트로 언급",
        "negative_side_summary":
            "일부는 지속이 짧다 / 음식 후 빨리 지워진다는 아쉬움으로 언급",
        "likely_split_drivers":
            "음식·음료 빈도, 마스크 착용, 보습 / 케어 단계",
        "buyer_fit_implication":
            "사용 환경(음식·마스크)에 따라 체감이 갈리므로 본인 환경 비교 후 결정 필요",
        "seller_action":
            "지속 향상 사용 팁 / 수정 화장 가이드 콘텐츠 추가",
        "content_phrase_example":
            "음식·음료 후에는 가볍게 수정해 주시면 좋아요. "
            "본인 사용 환경과 비슷한 후기를 함께 확인해 보세요.",
        "buyer_fit_when":
            "사용 환경 / 음식 빈도가 후기 다수와 비슷한 경우",
        "buyer_check_when":
            "음식·음료가 잦거나 마스크 착용이 길어 지속이 중요한 경우",
    },
    "transfer_resistance": {
        "positive_side_summary":
            "마스크 / 컵 묻어남이 적다는 만족 포인트로 언급",
        "negative_side_summary":
            "일부는 묻어남 / 번짐이 있다는 아쉬움으로 언급",
        "likely_split_drivers":
            "사용량, 마무리감(글로시·매트), 마스크 착용 시간",
        "buyer_fit_implication":
            "묻어남 체감은 사용량 / 마무리감에 따라 갈리므로 후기 환경 비교 필요",
        "seller_action":
            "사용량 / 마스크 착용 시 사용 팁 콘텐츠 추가",
        "content_phrase_example":
            "마스크 착용이 잦으시면 사용량을 조절해 보세요. "
            "묻어남 후기는 사용 환경이 비슷한 분의 후기를 함께 확인해 주세요.",
        "buyer_fit_when":
            "사용량 / 마무리감 선호가 후기 다수와 비슷한 경우",
        "buyer_check_when":
            "마스크 착용이 길거나 묻어남이 신경 쓰이는 경우",
    },
}


# ---------- Profile: sunscreen ----------
_TRADEOFF_BLOCKS_SUNSCREEN: dict[str, dict[str, str]] = {
    "finish_texture": {
        "positive_side_summary":
            "산뜻한 마무리와 편안한 사용감을 만족 포인트로 언급",
        "negative_side_summary":
            "일부는 유분감 / 백탁 / 밀림 / 눈시림을 아쉬움으로 언급",
        "likely_split_drivers":
            "피부 타입, 사용량, 기초 단계, 야외 활동, 메이크업 병용",
        "buyer_fit_implication":
            "산뜻한 선케어를 원하면 적합하지만, "
            "눈시림 / 백탁에 민감하면 사용 부위와 양을 확인할 필요",
        "seller_action":
            "백탁 / 눈시림 / 메이크업 전 사용 팁을 상세페이지 FAQ로 보강",
        "content_phrase_example":
            "산뜻한 선케어를 원하시면 적합해요. "
            "눈시림이 신경 쓰이면 눈가 사용 부위와 양을 함께 확인해 보세요.",
        "buyer_fit_when":
            "산뜻한 사용감 / 데일리 선케어를 기대하는 경우",
        "buyer_check_when":
            "눈시림 / 백탁 / 유분감에 민감한 경우",
    },
    "transfer_resistance": {
        "positive_side_summary":
            "땀·물에 잘 견딘다는 만족 포인트로 언급",
        "negative_side_summary":
            "일부는 땀에 흘러내림 / 묻어남이 있다는 아쉬움으로 언급",
        "likely_split_drivers":
            "야외 활동 강도, 사용량, 도포 빈도, 메이크업 병용",
        "buyer_fit_implication":
            "야외 활동이 잦으면 사용량과 덧바름 빈도를 함께 확인 필요",
        "seller_action":
            "야외 / 운동 / 수영 시 권장 덧바름 안내 추가",
        "content_phrase_example":
            "야외 활동이 잦으시면 사용량과 덧바름 시간을 함께 확인해 보세요.",
        "buyer_fit_when":
            "데일리 / 가벼운 야외 사용을 가정하는 경우",
        "buyer_check_when":
            "장시간 야외 / 운동 / 수영 시나리오가 잦은 경우",
    },
    "value_price": _TRADEOFF_BLOCKS_SKINCARE_GENERAL["value_price"],
}


# ---------- Profile: cleansing (foam / oil / water / balm) ----------
_TRADEOFF_BLOCKS_CLEANSING: dict[str, dict[str, str]] = {
    "finish_texture": {
        "positive_side_summary":
            "세안 후 촉촉함 / 편안함을 만족 포인트로 언급",
        "negative_side_summary":
            "일부는 당김 / 빡빡함 / 잔여감을 아쉬움으로 언급",
        "likely_split_drivers":
            "피부 타입, 사용량, 사용 시간, 메이크업 강도, 물 온도",
        "buyer_fit_implication":
            "세정력과 보습감의 균형을 후기 다수와 비교 후 결정 필요",
        "seller_action":
            "권장 사용량 / 사용 시간 / 더블 클렌징 가이드 추가",
        "content_phrase_example":
            "세안 후 당김이 신경 쓰이면 사용 시간과 물 온도를 함께 확인해 보세요. "
            "보습 후속 단계를 병행하면 사용감이 더 좋아질 수 있어요.",
        "buyer_fit_when":
            "사용량 / 메이크업 강도가 후기 다수와 비슷한 경우",
        "buyer_check_when":
            "당김 / 잔여감에 민감한 경우",
    },
    "dryness_skin_texture": {
        "positive_side_summary":
            "세안 후 건조함이 덜하다는 만족 포인트로 언급",
        "negative_side_summary":
            "일부는 세안 후 당김 / 건조감을 아쉬움으로 언급",
        "likely_split_drivers":
            "피부 타입, 사용 시간, 물 온도, 후속 보습 단계",
        "buyer_fit_implication":
            "건성·민감 피부는 사용 시간 / 후속 보습 단계를 함께 확인 필요",
        "seller_action":
            "건성·민감 피부 권장 사용법 콘텐츠 추가",
        "content_phrase_example":
            "건성·민감 피부라면 사용 시간을 줄이고 후속 보습 단계를 함께 진행해 보세요.",
        "buyer_fit_when":
            "지성·복합성 피부이거나 잔여감 없는 세정을 기대하는 경우",
        "buyer_check_when":
            "건성·민감 피부이거나 세안 후 당김에 민감한 경우",
    },
    "value_price": _TRADEOFF_BLOCKS_SKINCARE_GENERAL["value_price"],
}


# ---------- Profile: fallback_generic ----------
# When the profile is unknown OR the profile-specific dict has no
# entry for the attribute, the dispatcher falls through here.
_TRADEOFF_BLOCKS_FALLBACK_GENERIC: dict[str, dict[str, str]] = {
    "finish_texture": {
        "positive_side_summary":
            "사용감 / 마무리를 만족 포인트로 언급",
        "negative_side_summary":
            "일부는 사용감 / 마무리에 아쉬움을 언급",
        "likely_split_drivers":
            "피부 타입, 사용량, 사용 환경, 기대치, 병용 제품",
        "buyer_fit_implication":
            "사용 환경과 기대치를 후기 다수와 비교 후 결정 필요",
        "seller_action":
            "상세페이지 / 콘텐츠에서 사용 조건과 기대치를 함께 안내",
        "content_phrase_example":
            "사용 환경에 따라 체감이 갈릴 수 있어요. 후기 사용 조건을 함께 살펴보세요.",
        "buyer_fit_when":
            "후기 다수의 사용 조건과 본인 환경이 일치하는 경우",
        "buyer_check_when":
            "사용 환경 / 기대치가 후기와 다른 경우",
    },
    "dryness_skin_texture": _TRADEOFF_BLOCKS_SKINCARE_GENERAL["dryness_skin_texture"],
    "persistence": _TRADEOFF_BLOCKS_SKINCARE_GENERAL["persistence"],
    "value_price": _TRADEOFF_BLOCKS_SKINCARE_GENERAL["value_price"],
    "packaging_container": _TRADEOFF_BLOCKS_SKINCARE_PAD["packaging_container"],
    "applicator_tool": _TRADEOFF_BLOCKS_SKINCARE_PAD["applicator_tool"],
}


# Profile-id keyed registry. The dispatcher reads
# `analysis_report.product.selected_profile_id` (or accepts an
# explicit `profile_id` override) and looks up the profile-specific
# templates here. fallback_generic is the last-resort entry.
_TRADEOFF_BLOCKS_BY_PROFILE: dict[str, dict[str, dict[str, str]]] = {
    "skincare_pad": _TRADEOFF_BLOCKS_SKINCARE_PAD,
    "skincare_general": _TRADEOFF_BLOCKS_SKINCARE_GENERAL,
    "base_makeup": _TRADEOFF_BLOCKS_BASE_MAKEUP,
    "lip_makeup": _TRADEOFF_BLOCKS_LIP_MAKEUP,
    "sunscreen": _TRADEOFF_BLOCKS_SUNSCREEN,
    "cleansing": _TRADEOFF_BLOCKS_CLEANSING,
    "fallback_generic": _TRADEOFF_BLOCKS_FALLBACK_GENERIC,
}


# Backward-compat alias — pass-14 callers that imported
# `_TRADEOFF_BLOCKS_KO` still see the skincare_pad templates (the
# original content). The dispatcher is the new public entry.
_TRADEOFF_BLOCKS_KO: dict[str, dict[str, str]] = _TRADEOFF_BLOCKS_SKINCARE_PAD


def _resolve_tradeoff_template(
    profile_id: str | None, attr_key: str,
) -> dict[str, str] | None:
    """Profile-aware trade-off template resolver.

    Resolution order:
      1. Profile-specific template for this attribute.
      2. fallback_generic profile's template for this attribute.
      3. None (caller emits a minimal generic block).
    """
    profile_dict = _TRADEOFF_BLOCKS_BY_PROFILE.get(
        profile_id or "", _TRADEOFF_BLOCKS_FALLBACK_GENERIC,
    )
    template = profile_dict.get(attr_key)
    if template is not None:
        return template
    # Profile didn't carry this attribute — fall through to generic.
    if profile_id and profile_id != "fallback_generic":
        return _TRADEOFF_BLOCKS_FALLBACK_GENERIC.get(attr_key)
    return None


def compute_tradeoff_blocks(
    analysis_report: dict,
    *,
    profile_id: str | None = None,
    threshold_pos: int = 5,
    threshold_neg: int = 5,
    min_split_intensity: float = 0.15,
) -> list[dict]:
    """Walk `analysis_report.attributes` and emit a 의견 분기 block for
    every attribute where positive_count AND negative_count both
    clear the threshold AND the minority-side share crosses
    `min_split_intensity` (so a 100/3 split doesn't register as
    "체감 분기").

    Pure: no I/O, no aggregation logic — only reads counts the
    aggregator already produced. Returns an empty list when no
    attribute qualifies.

    Each block carries:
      attribute_key, label_ko, positive_count, negative_count,
      mixed_count, split_intensity, positive_side_summary,
      negative_side_summary, likely_split_drivers,
      buyer_fit_implication, seller_action, content_phrase_example,
      buyer_fit_when, buyer_check_when.
    """
    # Pass-15: profile_id is read from the analysis_report when not
    # explicitly passed. This keeps the public signature a single
    # positional arg (analysis_report) while still letting tests
    # override per-call.
    if profile_id is None:
        product = analysis_report.get("product") or {}
        cand = product.get("selected_profile_id")
        if isinstance(cand, str) and cand.strip():
            profile_id = cand.strip()

    out: list[dict] = []
    for a in analysis_report.get("attributes") or []:
        key = a.get("key") or ""
        n_pos = int(a.get("n_positive") or 0)
        n_neg = int(a.get("n_negative") or 0)
        n_mix = int(a.get("n_mixed") or 0)
        if n_pos < threshold_pos or n_neg < threshold_neg:
            continue
        denom = n_pos + n_neg
        if denom == 0:
            continue
        split_intensity = min(n_pos, n_neg) / denom
        if split_intensity < min_split_intensity:
            continue
        template = _resolve_tradeoff_template(profile_id, key)
        if not template:
            # No narrative template anywhere — emit a minimal block
            # so downstream surfaces at least see the count split.
            template = {
                "positive_side_summary":
                    "일부 사용자는 만족 포인트로 언급",
                "negative_side_summary":
                    "일부 사용자는 아쉬움으로 언급",
                "likely_split_drivers":
                    "피부 타입, 사용 환경, 기대치, 사용 조건",
                "buyer_fit_implication":
                    "본인 사용 환경 / 기대치를 후기와 비교 후 결정 필요",
                "seller_action":
                    "상세페이지 / 콘텐츠에서 사용 조건과 기대치를 함께 안내",
                "content_phrase_example":
                    "사용 환경에 따라 체감이 갈릴 수 있는 항목입니다. "
                    "후기 사용 조건을 함께 살펴 보시는 것을 권장합니다.",
                "buyer_fit_when":
                    "후기 다수의 사용 조건과 본인 환경이 일치하는 경우",
                "buyer_check_when":
                    "사용 환경 / 기대치가 후기와 다른 경우",
            }
        out.append({
            "attribute_key": key,
            "label_ko": _tradeoff_label_for(key, a),
            "profile_id": profile_id or "fallback_generic",
            "positive_count": n_pos,
            "negative_count": n_neg,
            "mixed_count": n_mix,
            "split_intensity": round(split_intensity, 3),
            **template,
        })
    # Sort by total volume so the most-mentioned 분기 항목 surfaces first.
    out.sort(
        key=lambda b: -(b["positive_count"] + b["negative_count"]),
    )
    return out


# Pass-19: profile-aware 2-column buyer-translation fallback.
# Used only when `compute_tradeoff_blocks` produces no rows (single-
# sided findings). The pre-pass-19 dict was profile-blind and carried
# skincare-pad copy ("200매 대용량 가성비", "보습 보강 단계") that
# leaked into base_makeup / lip / sunscreen reports.
_BR3_BUYER_TRANSLATIONS_BY_PROFILE_KO: dict[str, dict[str, dict[str, str]]] = {
    "skincare_pad": {
        "finish_texture": {
            "positive": "촉촉한 마무리를 기대하는 분께 적합",
            "negative": "민감 / 끈적함에 민감한 분은 사용 시간 확인",
        },
        "value_price": {
            "positive": "200매 대용량 가성비를 자주 활용하는 분께 적합",
            "negative": "체감 가성비가 갈리는 부분이라 자주 쓰는지 점검 권장",
        },
        "dryness_skin_texture": {
            "positive": "건조감 보강 단계로 활용 가능",
            "negative": "건성 / 민감 피부는 사용 시간과 보습 단계 확인 권장",
        },
        "adhesion_base_interaction": {
            "positive": "베이스 / 메이크업 위에 가볍게 사용 가능",
            "negative": "밀착 체감이 갈리므로 본인 사용 환경 비교 권장",
        },
        "persistence": {
            "positive": "보습 지속을 기대하는 분께 적합",
            "negative": "지속 시간 체감 차이가 있어 사용 후 시간대 확인 권장",
        },
        "packaging_container": {
            "positive": "휴대 / 선물용 패키지 활용 가능",
            "negative": "용기 / 집게 사용감 후기를 한 번 더 확인 권장",
        },
        "applicator_tool": {
            "positive": "도구 사용 편의를 중시하는 분께 적합",
            "negative": "도구 사용감이 갈리므로 사용 방식 비교 권장",
        },
    },
    "base_makeup": {
        "finish_texture": {
            "positive": "보송하거나 세미매트한 마무리를 선호하는 분께 적합",
            "negative": "건성·촉촉한 광채 마무리를 선호하면 확인 필요",
        },
        "dryness_skin_texture": {
            "positive": "기초 보습 후 매끈한 베이스 표현을 원하는 분께 적합",
            "negative": "건성·민감 피부 / 각질 부각이 쉬운 피부는 확인 필요",
        },
        "adhesion_base_interaction": {
            "positive": "얇은 밀착 / 가벼운 베이스 표현을 선호하는 분께 적합",
            "negative": "들뜸·끼임이 신경 쓰이면 사용량·기초 단계 확인 권장",
        },
        "application_blending": {
            "positive": "부드러운 발림을 중시하는 분께 적합",
            "negative": "도구·사용량에 따라 갈리므로 본인 사용 환경 비교 권장",
        },
        "color_tone_matching": {
            "positive": "호수가 본인 톤과 맞는 후기를 참고하기 좋음",
            "negative": "호수 선택 / 다크닝 / 홍조 커버가 중요하면 확인 권장",
        },
        "persistence": {
            "positive": "장시간 유지력을 기대하는 분께 적합",
            "negative": "마스크·외출 시간이 길거나 유분·땀이 많으면 확인 권장",
        },
        "transfer_resistance": {
            "positive": "마스크 / 옷 묻어남이 적은 사용감을 선호하는 분께 적합",
            "negative": "묻어남 체감이 갈리므로 사용 환경 비교 권장",
        },
        "applicator_tool": {
            "positive": "퍼프 사용 / 양 조절 편의를 중시하는 분께 적합",
            "negative": "퍼프 세척이 부담이거나 손 사용을 선호하면 확인 권장",
        },
        "packaging_container": {
            "positive": "휴대 / 외출용으로 자주 쓰시는 분께 적합",
            "negative": "지문·먼지·검수 상태가 중요하면 후기 확인 권장",
        },
        "pigmentation": {
            "positive": "원하는 커버 강도와 후기 톤이 맞는 분께 적합",
            "negative": "기대 커버 강도가 다르거나 색상 매칭이 중요하면 확인 권장",
        },
    },
}


def _br3_buyer_translation_for(
    profile_id: str | None, attr_key: str,
) -> dict[str, str] | None:
    """Profile-aware lookup for the 2-column buyer-translation
    fallback. Falls back to skincare_pad if no profile-specific
    entry exists for `attr_key` (preserving prior behavior for
    profile=None / unknown profiles)."""
    if profile_id:
        per_profile = _BR3_BUYER_TRANSLATIONS_BY_PROFILE_KO.get(profile_id)
        if per_profile:
            entry = per_profile.get(attr_key)
            if entry:
                return entry
    return _BR3_BUYER_TRANSLATIONS_BY_PROFILE_KO["skincare_pad"].get(attr_key)


# Backwards-compatibility alias. Existing tests / callers that read
# `_BR3_BUYER_TRANSLATIONS_KO` continue to see the skincare_pad
# entries (the pre-pass-19 contents).
_BR3_BUYER_TRANSLATIONS_KO: dict[str, dict[str, str]] = (
    _BR3_BUYER_TRANSLATIONS_BY_PROFILE_KO["skincare_pad"]
)


def _br3_section_buyer_translation(
    *, analysis_report: dict, styles: dict,
) -> list:
    """Pass-14 4-column shape:

      | 항목 | 잘 맞을 가능성 | 한 번 더 확인할 경우 | 콘텐츠 문구 예시 |

    Sourced from `compute_tradeoff_blocks`. The legacy 2-column
    "분석 결과 → 구매자용 표현" form is retained as a fallback for
    attributes without a populated trade-off block (single-sided
    findings).
    """
    out: list = []
    out.append(_br3_para(
        "5. Buyer Content Translation (운영 / 콘텐츠 활용)",
        styles["section_h1"],
    ))

    tradeoff_blocks = compute_tradeoff_blocks(analysis_report)
    rows: list[list] = []
    if tradeoff_blocks:
        rows.append([
            _br3_para("<b>항목</b>", styles["body"]),
            _br3_para("<b>잘 맞을 가능성</b>", styles["body"]),
            _br3_para("<b>한 번 더 확인할 경우</b>", styles["body"]),
            _br3_para("<b>콘텐츠 문구 예시</b>", styles["body"]),
        ])
        for b in tradeoff_blocks[:6]:
            rows.append([
                _br3_para(
                    f"{b['label_ko']}<br/>"
                    f"<font color=\"#888888\">"
                    f"만족 {b['positive_count']:,} · "
                    f"아쉬움 {b['negative_count']:,}</font>",
                    styles["body"],
                ),
                _br3_para(b["buyer_fit_when"], styles["body"]),
                _br3_para(b["buyer_check_when"], styles["body"]),
                _br3_para(b["content_phrase_example"], styles["body"]),
            ])
        tbl = Table(
            rows,
            colWidths=[28 * mm, 44 * mm, 44 * mm, 50 * mm],
        )
        tbl.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), KOREAN_FONT),
            ("BACKGROUND", (0, 0), (-1, 0), _BR3_NEUTRAL),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, _BR3_BORDER),
            ("BOX", (0, 0), (-1, -1), 0.5, _BR3_BORDER),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        out.append(tbl)
        return out

    # Fallback: no trade-off blocks (every attribute is one-sided).
    # Use the legacy 2-column buyer-translation form so the section
    # still produces operational guidance. Profile-aware (pass-19) so
    # base_makeup reports don't carry skincare_pad copy.
    rows = [[
        _br3_para("<b>분석 결과</b>", styles["body"]),
        _br3_para("<b>구매자용 표현</b>", styles["body"]),
    ]]
    product_block = analysis_report.get("product") or {}
    active_profile_id = product_block.get("selected_profile_id")
    attributes = analysis_report.get("attributes") or []
    appended = 0
    for a in sorted(
        attributes,
        key=lambda x: -(
            int(x.get("n_positive") or 0) + int(x.get("n_negative") or 0)
        ),
    ):
        key = a.get("key") or ""
        label = _tradeoff_label_for(key, a)
        n_pos = int(a.get("n_positive") or 0)
        n_neg = int(a.get("n_negative") or 0)
        translations = _br3_buyer_translation_for(active_profile_id, key)
        if not translations:
            continue
        if n_pos >= 30:
            rows.append([
                _br3_para(f"{label} 만족 의견 다수 ({n_pos:,}건)", styles["body"]),
                _br3_para(translations["positive"], styles["body"]),
            ])
            appended += 1
        if n_neg >= 5:
            rows.append([
                _br3_para(f"{label} 아쉬움 의견 일부 ({n_neg:,}건)", styles["body"]),
                _br3_para(translations["negative"], styles["body"]),
            ])
            appended += 1
        if appended >= 6:
            break

    if appended == 0:
        out.append(_br3_para(
            "구매자 콘텐츠 변환 후보가 임계치를 충족하지 않았습니다.",
            styles["muted"],
        ))
        return out

    tbl = Table(rows, colWidths=[80 * mm, 86 * mm])
    tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), KOREAN_FONT),
        ("BACKGROUND", (0, 0), (-1, 0), _BR3_NEUTRAL),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, _BR3_BORDER),
        ("BOX", (0, 0), (-1, -1), 0.5, _BR3_BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    out.append(tbl)
    return out


# ---------- Section 8: Methodology & Limitations ----------


def _br3_section_methodology(
    *, analysis_report: dict, collection_summary: dict, styles: dict,
) -> list:
    out: list = []
    out.append(_br3_para(
        "6. Methodology & Limitations (분석 방법과 한계)",
        styles["section_h1"],
    ))

    # Pass-16: collection-state-conditional caveat. The legacy bullet
    # ("RATING_ASC 등 일부 정렬 수집이 실패한 경우 ...") read as a
    # standing caveat even when the run actually collected all 5
    # sorts. Now we surface the affirmative form on success and
    # the legacy caveat only when partial_success / sorts_failed
    # are present.
    sorts_failed = list(collection_summary.get("sorts_failed") or [])
    sorts_succeeded = list(collection_summary.get("sorts_succeeded") or [])
    partial_success = bool(collection_summary.get("partial_success"))

    if not partial_success and not sorts_failed:
        # Affirmative success state.
        n_ok = len(sorts_succeeded) or 5
        collection_state_bullet = (
            f"이번 실행에서는 평점 낮은순을 포함한 {n_ok}개 정렬 수집이 "
            "완료되어, 만족 의견과 아쉬움 의견을 함께 검토했습니다."
        )
    else:
        # Caveat — some sorts failed; aggregate may under-represent.
        collection_state_bullet = (
            "RATING_ASC 등 일부 정렬 수집이 실패한 경우, "
            "아쉬움 의견은 실제보다 적게 반영되었을 수 있습니다."
        )

    bullets = [
        "이 리포트는 제품 결함을 확정하지 않으며, "
        "수집된 리뷰에서 반복된 표현을 정리한 자료입니다.",
        "여러 정렬에서 수집한 리뷰를 review_id 기준으로 합집합 후 중복 제거했고, "
        "분포 비율은 최신순 리뷰 표본을 기준으로 산정했습니다.",
        collection_state_bullet,
        "동일 조건의 반복 수집 전까지 시계열 변화는 판단하지 않습니다.",
        "운영 / 의사결정은 브랜드 내부의 품질·원가·R&amp;D 컨텍스트와 함께 "
        "검토하시는 것을 권장합니다.",
    ]
    for b in bullets:
        out.append(_br3_para(f"• {b}", styles["body"]))
    return out


# ---------- Section 9: Appendix ----------


def _br3_section_appendix(
    *, analysis_report: dict, collection_summary: dict, styles: dict,
    run_id: str | None = None, generated_at: str | None = None,
) -> list:
    out: list = []
    out.append(PageBreak())
    out.append(_br3_para("7. Appendix (부록)", styles["section_h1"]))
    out.append(_br3_para(
        "이하는 본 리포트의 근거 데이터입니다. "
        "1-6장 요약은 그대로 유지하며, 부록은 검증 / 심층 검토용 자료입니다.",
        styles["muted"],
    ))
    out.append(Spacer(1, 6))

    # 7.0 Run / product metadata — Run-003 QA pass-4 moved Run ID,
    # goodsNo, source URL, and generated_at off the cover page into
    # the appendix so the seller-facing first page stays clean.
    product = analysis_report.get("product") or {}
    source_url = product.get("source_url") or ""
    # Pass-15: profile_id resolved here so the per-attribute quote
    # selector can reach the right profile-specific summary template.
    profile_id = product.get("selected_profile_id") or None
    goods_no: str | None = None
    if source_url and "goodsNo=" in source_url:
        goods_no = source_url.split("goodsNo=", 1)[1].split("&", 1)[0]
    meta_rows = [[
        _br3_para("<b>항목</b>", styles["body"]),
        _br3_para("<b>값</b>", styles["body"]),
    ]]
    if generated_at:
        meta_rows.append([
            _br3_para("발행일", styles["body"]),
            _br3_para(generated_at, styles["body"]),
        ])
    if run_id:
        meta_rows.append([
            _br3_para("Run ID", styles["body"]),
            _br3_para(run_id, styles["body"]),
        ])
    # Pass-15: surface every part of the product-name split so an
    # operator auditing the report can trace what the cover headline
    # was derived from. The raw merch name lives in the appendix
    # only — never on the cover.
    raw_name = product.get("raw_product_name") or product.get("name_ko")
    display_name_meta = product.get("display_product_name")
    offer_meta = product.get("offer_context")
    promo_meta = product.get("promo_context")
    if raw_name:
        meta_rows.append([
            _br3_para("raw_product_name", styles["body"]),
            _br3_para(raw_name, styles["body"]),
        ])
    if display_name_meta:
        meta_rows.append([
            _br3_para("display_product_name", styles["body"]),
            _br3_para(display_name_meta, styles["body"]),
        ])
    if offer_meta:
        meta_rows.append([
            _br3_para("offer_context", styles["body"]),
            _br3_para(offer_meta, styles["body"]),
        ])
    if promo_meta:
        meta_rows.append([
            _br3_para("promo_context", styles["body"]),
            _br3_para(promo_meta, styles["body"]),
        ])
    if goods_no:
        meta_rows.append([
            _br3_para("goodsNo", styles["body"]),
            _br3_para(goods_no, styles["body"]),
        ])
    if source_url:
        meta_rows.append([
            _br3_para("product_url", styles["body"]),
            _br3_para(source_url, styles["body"]),
        ])
    if len(meta_rows) > 1:
        out.append(_br3_para("7.0 발행 / 제품 메타데이터", styles["section_h2"]))
        meta_tbl = Table(meta_rows, colWidths=[42 * mm, 124 * mm])
        meta_tbl.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), KOREAN_FONT),
            ("BACKGROUND", (0, 0), (-1, 0), _BR3_NEUTRAL),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, _BR3_BORDER),
            ("BOX", (0, 0), (-1, -1), 0.5, _BR3_BORDER),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        out.append(meta_tbl)
        out.append(Spacer(1, 8))

    # 7.0b Coverage / collection state moved here from the prior
    # section 3. This is internal-tool detail that operators / QA
    # need but a brand reader does not on page 1.
    out.append(_br3_para(
        "7.0a 리뷰 표본 범위와 수집 상태", styles["section_h2"],
    ))
    coverage_block = _br3_section_coverage(
        analysis_report=analysis_report,
        collection_summary=collection_summary,
        styles=styles,
        section_label="",
    )
    # Drop the empty header paragraph the helper adds when called
    # without a section label.
    coverage_block = [
        f for f in coverage_block
        if not (
            isinstance(f, Paragraph) and getattr(f, "text", "").strip() == ""
        )
    ]
    out.extend(coverage_block)
    out.append(Spacer(1, 8))

    # 7.1 Detailed attribute table
    out.append(_br3_para("7.1 속성별 누적 의견", styles["section_h2"]))
    rows = [[
        _br3_para("<b>속성</b>", styles["body"]),
        _br3_para("<b>만족</b>", styles["body"]),
        _br3_para("<b>아쉬움</b>", styles["body"]),
        _br3_para("<b>혼합</b>", styles["body"]),
        _br3_para("<b>전체 언급</b>", styles["body"]),
    ]]
    for a in sorted(
        analysis_report.get("attributes") or [],
        key=lambda x: -(int(x.get("n_positive") or 0) + int(x.get("n_negative") or 0)),
    ):
        n_pos = int(a.get("n_positive") or 0)
        n_neg = int(a.get("n_negative") or 0)
        n_mix = int(a.get("n_mixed") or 0)
        # Pass-16: 7.1 attribute table also uses the ambivalence-
        # aware label override so "건조감/당김" reads as
        # "건조감·당김 체감" — matches the matrix and 7.2 forms.
        rows.append([
            _br3_para(_tradeoff_label_for(a.get("key") or "", a), styles["body"]),
            _br3_para(f"{n_pos:,}", styles["body"]),
            _br3_para(f"{n_neg:,}", styles["body"]),
            _br3_para(f"{n_mix:,}", styles["body"]),
            _br3_para(f"{n_pos + n_neg + n_mix:,}", styles["body"]),
        ])
    tbl = Table(rows, colWidths=[60 * mm, 22 * mm, 24 * mm, 22 * mm, 28 * mm])
    tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), KOREAN_FONT),
        ("BACKGROUND", (0, 0), (-1, 0), _BR3_NEUTRAL),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, _BR3_BORDER),
        ("BOX", (0, 0), (-1, -1), 0.5, _BR3_BORDER),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    out.append(tbl)
    out.append(Spacer(1, 8))

    # 9.2 Sample reviews — top 1 per attribute, suspect skipped.
    out.append(_br3_para("7.2 대표 리뷰 인용", styles["section_h2"]))
    sample_rows = [[
        _br3_para("<b>속성</b>", styles["body"]),
        _br3_para("<b>유형</b>", styles["body"]),
        _br3_para("<b>리뷰 인용</b>", styles["body"]),
    ]]
    samples_added = 0
    for a in analysis_report.get("attributes") or []:
        if samples_added >= 8:
            break
        attr_label = _tradeoff_label_for(a.get("key") or "", a)
        clean_pos = _br3_filter_quotes_skip_suspect(
            [q for q in (a.get("top_quotes") or [])
             if (q.get("polarity") or "").lower() == "positive"]
        )
        clean_neg = _br3_filter_quotes_skip_suspect(
            [q for q in (a.get("top_quotes") or [])
             if "negative" in (q.get("polarity") or "").lower()]
        )
        if clean_pos:
            q = clean_pos[0]
            sample_rows.append([
                _br3_para(attr_label, styles["body"]),
                _br3_para("만족", styles["body"]),
                _br3_para(
                    "&ldquo;"
                    + _br3_appendix_quote_text(
                        q,
                        attribute_key=a.get("key") or None,
                        polarity="positive",
                        profile_id=profile_id,
                    )
                    + "&rdquo;",
                    styles["evidence_quote"],
                ),
            ])
            samples_added += 1
        if clean_neg:
            q = clean_neg[0]
            sample_rows.append([
                _br3_para(attr_label, styles["body"]),
                _br3_para("아쉬움", styles["body"]),
                _br3_para(
                    "&ldquo;"
                    + _br3_appendix_quote_text(
                        q,
                        attribute_key=a.get("key") or None,
                        polarity="negative",
                        profile_id=profile_id,
                    )
                    + "&rdquo;",
                    styles["evidence_quote"],
                ),
            ])
            samples_added += 1
    if len(sample_rows) > 1:
        sample_tbl = Table(
            sample_rows, colWidths=[36 * mm, 18 * mm, 112 * mm],
        )
        sample_tbl.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, -1), KOREAN_FONT),
            ("BACKGROUND", (0, 0), (-1, 0), _BR3_NEUTRAL),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, _BR3_BORDER),
            ("BOX", (0, 0), (-1, -1), 0.5, _BR3_BORDER),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        out.append(sample_tbl)
    out.append(Spacer(1, 8))

    # 9.3 Collection log
    out.append(_br3_para("7.3 수집 로그 요약", styles["section_h2"]))
    log_rows = [[
        _br3_para("<b>항목</b>", styles["body"]),
        _br3_para("<b>값</b>", styles["body"]),
    ]]
    for k, v in (
        ("수집 시작", collection_summary.get("collection_started_at")),
        ("수집 종료", collection_summary.get("collection_completed_at")),
        ("시도 정렬",
         ", ".join(collection_summary.get("sorts_attempted") or []) or "—"),
        ("성공 정렬",
         ", ".join(collection_summary.get("sorts_succeeded") or []) or "—"),
        ("실패 정렬",
         ", ".join(collection_summary.get("sorts_failed") or []) or "없음"),
        (
            "부분 성공",
            "예" if collection_summary.get("partial_success") else "아니오",
        ),
        ("처리 리뷰 수",
         f"{int(collection_summary.get('review_count_analyzed') or 0):,}건"),
    ):
        log_rows.append([
            _br3_para(k, styles["body"]),
            _br3_para(str(v) if v is not None else "—", styles["body"]),
        ])
    log_tbl = Table(log_rows, colWidths=[42 * mm, 124 * mm])
    log_tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), KOREAN_FONT),
        ("BACKGROUND", (0, 0), (-1, 0), _BR3_NEUTRAL),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, _BR3_BORDER),
        ("BOX", (0, 0), (-1, -1), 0.5, _BR3_BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    out.append(log_tbl)
    return out


# ---------- Pass-19I sections: Signal Dashboard / What's Working / ---------
# ---------- What Needs Attention / Seller Action Plan         ---------
#
# Pass-19I restructure: report previously read like a review compilation
# (Executive Summary that re-stated counts, dense 3×3 matrix, "Buyer
# Content Translation" copywriter section). Operators couldn't see at
# a glance what to KEEP / FIX / CLARIFY / MONITOR or what action to
# take first. The new sections below are decision-oriented; data is
# computed in `src/voc/reporting/phase2e/seller_dashboard.py` (pure
# Python, unit-tested), and these helpers turn the data into flowables.

from src.voc.reporting.phase2e.seller_dashboard import (  # noqa: E402
    BUCKET_CLARIFY,
    BUCKET_FIX,
    BUCKET_KEEP,
    BUCKET_MONITOR,
    BUCKET_LABEL_KO as _BR3_BUCKET_LABEL_KO,
    build_executive_summary as _br3_build_executive_summary_data,
    build_seller_action_plan as _br3_build_seller_action_plan,
    build_signal_dashboard_rows as _br3_build_signal_dashboard_rows,
    build_what_needs_attention_items as _br3_build_what_needs_attention_items,
    build_whats_working_items as _br3_build_whats_working_items,
)


def _br3_section_executive_summary_v2(
    *, analysis_report: dict, styles: dict,
) -> list:
    """Verdict-first Executive Summary (Pass-19I).

    Replaces the count-restatement format ("한 줄 결론. A 만족 N건이
    보이지만 B 불만 N건이 누적됩니다.") with a decision card:
    verdict + Top 2 strengths + Top 2 frictions + Top 3 actions +
    operator caveat. Numbers stay on the dashboard a few lines below;
    this section answers "should I keep selling, and what do I do?".
    """
    out: list = []
    out.append(_br3_para(
        "1. Executive Summary (요약)", styles["section_h1"],
    ))

    summary = _br3_build_executive_summary_data(
        analysis_report,
        fallback_label_ko_map=_BR3_FALLBACK_LABEL_KO,
    )

    # Verdict — large, decision-oriented.
    out.append(_br3_para(
        f"<b>종합 판정.</b> {summary.verdict}", styles["verdict"],
    ))
    out.append(Spacer(1, 6))

    if summary.top_strengths:
        out.append(_br3_para(
            "<b>잘되고 있는 점 (TOP 2)</b>", styles["insight_label"],
        ))
        for s in summary.top_strengths:
            out.append(_br3_para(f"• {s}", styles["insight_body"]))
    if summary.top_frictions:
        out.append(_br3_para(
            "<b>부족한 점 (TOP 2)</b>", styles["insight_label"],
        ))
        for f in summary.top_frictions:
            out.append(_br3_para(f"• {f}", styles["insight_body"]))
    if summary.top_actions:
        out.append(_br3_para(
            "<b>우선 액션 (TOP 3)</b>", styles["insight_label"],
        ))
        for a in summary.top_actions:
            out.append(_br3_para(f"• {a}", styles["insight_body"]))

    # Pass-19I: surface the data-coverage caveat (e.g. RATING_ASC
    # collection failed → "아쉬움 의견이 실제보다 적게 반영됐을 수 있다")
    # alongside the operator-facing caveat. Both pieces are part of
    # the verdict context the operator needs when reading the page.
    sort_caveat = _br3_seller_friendly_caveat(analysis_report)
    if sort_caveat:
        out.append(Spacer(1, 2))
        out.append(_br3_para(sort_caveat, styles["badge"]))

    if summary.caveat:
        out.append(Spacer(1, 4))
        out.append(_br3_para(
            f"<i>{summary.caveat}</i>", styles["muted"],
        ))
    out.append(Spacer(1, 8))
    return out


_BR3_BUCKET_HEADER_BG = colors.HexColor("#e8edf2")


def _br3_section_signal_dashboard(
    *, analysis_report: dict, styles: dict,
) -> list:
    """Signal Dashboard: KEEP / FIX / CLARIFY / MONITOR buckets +
    Priority Map (the demoted matrix as a sub-block).
    """
    out: list = []
    out.append(_br3_para(
        "2. Signal Dashboard (시그널 대시보드)", styles["section_h1"],
    ))
    out.append(_br3_para(
        "각 항목을 KEEP(유지) · FIX(개선) · CLARIFY(설명 보완) · "
        "MONITOR(추적) 4개 버킷으로 분류해 의사결정 우선순위를 정리했습니다.",
        styles["body"],
    ))
    out.append(Spacer(1, 4))

    rows = _br3_build_signal_dashboard_rows(
        analysis_report,
        fallback_label_ko_map=_BR3_FALLBACK_LABEL_KO,
    )
    if not rows:
        out.append(_br3_para("(데이터 없음)", styles["muted"]))
        return out

    # Render one block per non-empty bucket.
    bucket_order = (BUCKET_FIX, BUCKET_CLARIFY, BUCKET_KEEP, BUCKET_MONITOR)
    header = ["항목", "긍정", "아쉬움", "해석", "담당 영역"]
    for bucket in bucket_order:
        bucket_rows = [r for r in rows if r.bucket == bucket]
        if not bucket_rows:
            continue
        out.append(Spacer(1, 6))
        out.append(_br3_para(
            f"<b>{_BR3_BUCKET_LABEL_KO[bucket]}</b>",
            styles["section_h2"],
        ))
        body = [header]
        for r in bucket_rows:
            body.append([
                _br3_para(r.label_ko, styles["body"]),
                _br3_para(str(r.n_positive), styles["body"]),
                _br3_para(str(r.n_negative), styles["body"]),
                _br3_para(r.seller_interpretation, styles["body"]),
                _br3_para(r.owner, styles["body"]),
            ])
        tbl = Table(
            body,
            colWidths=[34 * mm, 14 * mm, 16 * mm, 70 * mm, 26 * mm],
        )
        tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), _BR3_BUCKET_HEADER_BG),
            ("FONTNAME", (0, 0), (-1, 0), KOREAN_FONT_BOLD or KOREAN_FONT),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("ALIGN", (1, 0), (2, -1), "CENTER"),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("GRID", (0, 0), (-1, -1), 0.4, _BR3_BORDER),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        out.append(tbl)

    # Priority Map subsection (demoted matrix). Rendered for context;
    # not the primary signal anymore.
    out.append(Spacer(1, 8))
    out.append(_br3_para(
        "Priority Map: 유지할 것과 손볼 것", styles["section_h2"],
    ))
    out.append(_br3_para(
        "각 항목의 만족·아쉬움 신호를 4개 영역으로 펼쳐, 어디에 자원을 "
        "투입할지 직관적으로 보여주는 보조 지도입니다.",
        styles["muted"],
    ))
    fix_count = sum(1 for r in rows if r.bucket == BUCKET_FIX)
    keep_count = sum(1 for r in rows if r.bucket == BUCKET_KEEP)
    clarify_count = sum(1 for r in rows if r.bucket == BUCKET_CLARIFY)
    monitor_count = sum(1 for r in rows if r.bucket == BUCKET_MONITOR)
    map_rows = [
        ["", "만족 높음", "만족 낮음"],
        [
            "아쉬움 낮음",
            f"Strong Asset · {keep_count}",
            f"Low Priority · {monitor_count}",
        ],
        [
            "아쉬움 높음",
            f"Polarized Driver · {clarify_count}",
            f"Friction Risk · {fix_count}",
        ],
    ]
    map_tbl = Table(map_rows, colWidths=[26 * mm, 60 * mm, 60 * mm])
    map_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), _BR3_BUCKET_HEADER_BG),
        ("BACKGROUND", (0, 0), (0, -1), _BR3_BUCKET_HEADER_BG),
        ("FONTNAME", (0, 0), (-1, -1), KOREAN_FONT_BOLD or KOREAN_FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 9.5),
        ("ALIGN", (1, 1), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.4, _BR3_BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    out.append(map_tbl)
    out.append(Spacer(1, 4))
    return out


def _br3_section_whats_working(
    *, analysis_report: dict, styles: dict,
) -> list:
    """What's Working: top KEEP-bucket strengths with 3-line
    structure (loved / business value / preserve caution).
    """
    out: list = []
    out.append(_br3_para(
        "3. What's Working (잘 작동하는 점)", styles["section_h1"],
    ))
    items = _br3_build_whats_working_items(
        analysis_report,
        limit=4,
        fallback_label_ko_map=_BR3_FALLBACK_LABEL_KO,
    )
    if not items:
        out.append(_br3_para(
            "현재 KEEP 버킷에 해당하는 강한 만족 신호는 관찰되지 않았습니다.",
            styles["muted"],
        ))
        return out
    for s in items:
        out.append(_br3_para(
            f"<b>{s.label_ko}</b>  ·  만족 {s.n_positive}건",
            styles["section_h2"],
        ))
        out.append(_br3_para(
            f"고객이 좋아하는 점 — {s.loved}", styles["insight_body"],
        ))
        out.append(_br3_para(
            f"판매에 도움이 되는 이유 — {s.business_value}",
            styles["insight_body"],
        ))
        out.append(_br3_para(
            f"유지할 때 주의할 점 — {s.preserve_caution}",
            styles["insight_body"],
        ))
        out.append(Spacer(1, 4))
    return out


def _br3_section_what_needs_attention(
    *, analysis_report: dict, styles: dict,
) -> list:
    """What Needs Attention: top FIX/CLARIFY-bucket frictions with
    3-line structure (concern / business impact / questions to ask).
    """
    out: list = []
    out.append(_br3_para(
        "4. What Needs Attention (확인이 필요한 점)", styles["section_h1"],
    ))
    items = _br3_build_what_needs_attention_items(
        analysis_report,
        limit=4,
        fallback_label_ko_map=_BR3_FALLBACK_LABEL_KO,
    )
    if not items:
        out.append(_br3_para(
            "현재 FIX/CLARIFY 버킷에 해당하는 반복 아쉬움 신호는 약합니다.",
            styles["muted"],
        ))
        return out
    for f in items:
        out.append(_br3_para(
            f"<b>{f.label_ko}</b>  ·  아쉬움 {f.n_negative}건",
            styles["section_h2"],
        ))
        out.append(_br3_para(
            f"반복되는 아쉬움 — {f.concern}", styles["insight_body"],
        ))
        out.append(_br3_para(
            f"구매·재구매에 미치는 영향 — {f.business_impact}",
            styles["insight_body"],
        ))
        out.append(_br3_para(
            f"확인할 세부 질문 — {f.questions}", styles["insight_body"],
        ))
        out.append(Spacer(1, 4))
    return out


def _br3_section_seller_action_plan(
    *, analysis_report: dict, styles: dict,
) -> list:
    """5-column action plan table that REPLACES Buyer Content
    Translation. Columns: 우선순위 / 액션 영역 / 해야 할 일 /
    근거 신호 / 기대 효과.
    """
    out: list = []
    out.append(_br3_para(
        "5. Seller Action Plan (판매자 액션 플랜)", styles["section_h1"],
    ))
    out.append(_br3_para(
        "FIX·CLARIFY 버킷에서 도출한 우선순위 액션을 정리했습니다. "
        "담당 영역과 기대 효과는 운영 컨텍스트에 맞게 재배정 가능합니다.",
        styles["body"],
    ))
    rows = _br3_build_seller_action_plan(
        analysis_report,
        limit=6,
        fallback_label_ko_map=_BR3_FALLBACK_LABEL_KO,
    )
    if not rows:
        out.append(_br3_para(
            "현재 우선 액션이 도출되는 신호는 약합니다. 다음 운영 사이클에 "
            "추적 데이터를 추가로 누적하세요.",
            styles["muted"],
        ))
        return out

    header = ["우선순위", "액션 영역", "해야 할 일", "근거 신호", "기대 효과"]
    body = [header]
    for r in rows:
        body.append([
            _br3_para(r.priority, styles["body"]),
            _br3_para(r.owner, styles["body"]),
            _br3_para(r.action_text, styles["body"]),
            _br3_para(r.evidence, styles["body"]),
            _br3_para(r.expected_outcome, styles["body"]),
        ])
    tbl = Table(
        body,
        colWidths=[16 * mm, 22 * mm, 60 * mm, 36 * mm, 36 * mm],
    )
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), _BR3_BUCKET_HEADER_BG),
        ("FONTNAME", (0, 0), (-1, 0), KOREAN_FONT_BOLD or KOREAN_FONT),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (1, -1), "CENTER"),
        ("GRID", (0, 0), (-1, -1), 0.4, _BR3_BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    out.append(tbl)
    return out


# ---------- v3 entry point ----------


def render_seller_business_report_v3(
    *,
    analysis_report: dict,
    collection_summary: dict,
    out_path: Path,
    run_id: str | None = None,
    generated_at: str | None = None,
) -> Path:
    """Render the v3 business report PDF straight from analysis_report
    + collection_summary.

    Pass-19I section order:
      1. Executive Summary (verdict + Top 2/2/3)
      2. Signal Dashboard (KEEP/FIX/CLARIFY/MONITOR + Priority Map)
      3. What's Working (strengths with 3-line structure)
      4. What Needs Attention (frictions with 3-line structure)
      5. Seller Action Plan (replaces Buyer Content Translation)
      6. Methodology & Limitations
      7. Appendix
    """
    styles = _br3_styles()
    flowables: list = []

    flowables.extend(_br3_section_cover(
        analysis_report=analysis_report,
        run_id=run_id, generated_at=generated_at,
        styles=styles,
    ))

    # 1. Executive Summary (verdict-first)
    flowables.extend(_br3_section_executive_summary_v2(
        analysis_report=analysis_report, styles=styles,
    ))

    # 2. Signal Dashboard (KEEP/FIX/CLARIFY/MONITOR + Priority Map)
    flowables.extend(_br3_section_signal_dashboard(
        analysis_report=analysis_report, styles=styles,
    ))

    # 3. What's Working
    flowables.extend(_br3_section_whats_working(
        analysis_report=analysis_report, styles=styles,
    ))

    # 4. What Needs Attention
    flowables.extend(_br3_section_what_needs_attention(
        analysis_report=analysis_report, styles=styles,
    ))

    # 5. Seller Action Plan — REPLACES Buyer Content Translation.
    # The legacy `_br3_section_buyer_translation` helper is preserved
    # in this file but no longer called by the v3 entry point.
    flowables.extend(_br3_section_seller_action_plan(
        analysis_report=analysis_report, styles=styles,
    ))

    # 6. Methodology & Limitations
    flowables.extend(_br3_section_methodology(
        analysis_report=analysis_report,
        collection_summary=collection_summary, styles=styles,
    ))

    # 7. Appendix — Data Coverage detail + run metadata + raw tables
    flowables.extend(_br3_section_appendix(
        analysis_report=analysis_report,
        collection_summary=collection_summary, styles=styles,
        run_id=run_id, generated_at=generated_at,
    ))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(out_path),
        pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=18 * mm, bottomMargin=18 * mm,
        title="Review Intelligence Report",
        author="Phase 2E business report v3",
    )
    doc.build(flowables)
    return out_path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    by_product = load_pipeline_output()
    print(f"Phase 2E v2 PDF generator - {len(by_product)} products")
    OUT_DIR.mkdir(exist_ok=True)
    source_label = "Phase 2E pipeline E2E output"
    for pid, info in sorted(by_product.items()):
        data = aggregate_product(
            product_id=info["product_id"],
            product_name=info["product_name"],
            reviews=info["reviews"],
        )
        out_filename = PRODUCT_FILENAME_MAP.get(pid, f"phase2e_report_{pid}_pipeline_v2.pdf")
        out_path = OUT_DIR / out_filename
        # Pass reviews + dates so §7 (time-series) is rendered
        render_pdf_v2(
            data, out_path, source_label=source_label,
            reviews=info["reviews"],
            review_dates=info.get("review_dates", {}),
        )
        size_kb = out_path.stat().st_size / 1024
        print(f"  ✓ {info['product_name']} → {out_filename} ({size_kb:.1f} KB, "
              f"{data.n_reviews} reviews, {data.n_records} records)")


if __name__ == "__main__":
    main()
