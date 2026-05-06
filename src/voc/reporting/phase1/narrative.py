"""Template narrative renderer for the Phase 1 mini-report.

Given a ``Phase1Report`` whose ``deterministic_metrics`` and ``signals`` are
already populated, produce a ``NarrativeBlock`` with Korean markdown
sections. No LLM — every line is a deterministic template fill from the
report's structured data.

Contract for later layers:
  - ``source`` is always ``"template"`` here. PR5D's LLM path will produce
    the same ``NarrativeBlock`` shape with ``source="llm"``, letting callers
    transparently substitute.
  - ``caveats`` are computed from thresholds on the metrics, NOT from text
    analysis. That keeps "주의사항" honest — it can't be gamed by pretty
    writing.
  - Empty-report case (``total_reviews == 0``) still produces a valid
    narrative so the pipeline never returns a None narrative.
"""

from __future__ import annotations

from src.voc.reporting.phase1.schema import (
    DeterministicMetrics,
    NarrativeBlock,
    Phase1Report,
    RatingContentDivergence,
    SegmentSignalFinding,
    ShadeSignalFinding,
    SignalCandidate,
    SignalCoverage,
    SignalsBundle,
)

# Caveat thresholds. Centralised so adjustments don't drift across callsites.
_SMALL_SAMPLE_N = 50
_SHORT_WINDOW_DAYS = 7
_DOMINANT_SKEW_PCT = 0.8
# Below this row count, a fully-empty signal bundle is expected (lexicon
# entries default to min_doc_freq=2, which fails fast on tiny samples). We
# collapse the two "해당 신호 없음" sections into a single low-sample note
# so the operator isn't told the same thing twice.
_LOW_SAMPLE_SIGNALS_N = 10

# Korean display labels for the internal ``NormalizedSkinType`` bucket enum.
# Kept in the renderer (not the schema) because the enum values are
# load-bearing for code paths (downstream filtering, stats), while the
# Korean labels are a pure display concern.
_SKIN_TYPE_KO = {
    "dry": "건성",
    "normal": "중성",
    "combination": "복합성",
    "oily": "지성",
    "sensitive": "민감성",
    "unknown": "미확인",
}


def render_template(
    report: Phase1Report,
    *,
    review_text_by_id: dict[str, str] | None = None,
) -> NarrativeBlock:
    """Render the template narrative. When ``review_text_by_id`` is provided,
    each signal bullet is followed by 2–3 quoted excerpts from its
    ``sample_review_ids``. When omitted, the original counts-only format is
    preserved (backward-compatible with existing tests and callers)."""
    m = report.deterministic_metrics
    s = report.signals

    if _should_collapse_signals(m, s):
        # Low-sample with empty positive + cautionary: fold into a single
        # note under the positive key, leave cautionary empty so
        # render_markdown's empty-body check suppresses its heading.
        low_sample_msg = (
            f"표본이 작아(n={m.total_reviews}) 반복 신호가 도출되지 않았습니다."
        )
        positives_body = low_sample_msg
        cautionary_body = ""
    else:
        positives_body = _render_signal_section(
            s.positive, empty_msg="해당 신호 없음.",
            review_text_by_id=review_text_by_id,
        )
        cautionary_body = _render_signal_section(
            s.cautionary, empty_msg="해당 신호 없음.",
            review_text_by_id=review_text_by_id,
        )

    sections = {
        "executive": _render_executive_summary(report),
        "sample": _render_sample(report, m),
        "coverage": _render_coverage(report.coverage),
        "positives": positives_body,
        "cautionary": cautionary_body,
        "segment_findings": _render_segment_findings(
            report.derived.segment_signal_findings,
            review_text_by_id=review_text_by_id,
        ),
        "shade_findings": _render_shade_findings(
            report.derived.shade_signal_findings,
            review_text_by_id=review_text_by_id,
        ),
        "rating_divergences": _render_rating_divergences(
            report.derived.rating_content_divergences,
        ),
        "operational": _render_operational(m, s, review_text_by_id=review_text_by_id),
    }
    summary = _render_summary(report, m)
    caveats = _compute_caveats(m)
    # Append a one-line methodology note when derived findings exist —
    # calibrates the reader for the 집중도 × numbers and the band vocabulary.
    if (report.derived.segment_signal_findings
            or report.derived.shade_signal_findings):
        caveats.append(
            "집중도 배수는 세그먼트/셰이드 언급률을 전체·제품 기준과 비교한 "
            "값으로, 2× 중간·3× 뚜렷·5×+ 매우 뚜렷으로 분류합니다."
        )

    return NarrativeBlock(
        summary_md=summary,
        sections_md=sections,
        caveats=caveats,
        source="template",
    )


def _should_collapse_signals(
    m: DeterministicMetrics, s: SignalsBundle,
) -> bool:
    """Detect the low-sample / no-signals case. Deliberately requires
    total > 0 so the n=0 path (handled by the empty-report summary) doesn't
    also trigger this collapse."""
    return (
        m.total_reviews > 0
        and m.total_reviews < _LOW_SAMPLE_SIGNALS_N
        and not s.positive
        and not s.cautionary
    )


def render_markdown(
    report: Phase1Report,
    chart_paths: dict[str, str] | None = None,
) -> str:
    """Convenience: join the narrative block's sections into one markdown doc.

    Callers that want only the ``NarrativeBlock`` (e.g. to embed in the
    report JSON) don't need this. The CLI uses it to write the .md file.

    ``chart_paths`` — optional ``{chart_key: relative_image_path}`` map.
    When provided, the renderer embeds a Markdown image reference below
    the matching section. Keys understood in v1:
      - ``"rating_distribution"`` → embedded right below 샘플 구성.
    Unknown keys are ignored so callers can pass extra entries without
    breaking rendering.
    """
    n = report.narrative or render_template(report)
    title = _title(report)
    parts: list[str] = [f"# {title}", ""]
    if n.summary_md:
        parts.append(n.summary_md)
        parts.append("")
    # Detect the collapsed-signals case so we can swap the "긍정 신호"
    # heading for a more accurate "신호 분석" label. Detection is on the
    # source data, not a string match against the body, so a JSON report
    # round-tripped from disk still renders correctly.
    collapsed = _should_collapse_signals(
        report.deterministic_metrics, report.signals,
    )
    for heading_ko, key in (
        ("핵심 발견", "executive"),
        ("샘플 구성", "sample"),
        ("신호 커버리지", "coverage"),
        ("긍정 신호", "positives"),
        ("주의 신호", "cautionary"),
        ("세그먼트별 집중도", "segment_findings"),
        ("셰이드별 집중도", "shade_findings"),
        ("평점과 본문 해석 차이", "rating_divergences"),
        ("운영 관찰", "operational"),
    ):
        body = n.sections_md.get(key, "").strip()
        if not body:
            continue
        label = "신호 분석" if collapsed and key == "positives" else heading_ko
        parts.append(f"## {label}")
        parts.append(body)
        # Optional chart embed: rating distribution sits under 샘플 구성.
        # Kept outside render_template (which produces the text-only block)
        # so a caller without charts enabled generates byte-identical MD
        # except for the absent image reference.
        if (key == "sample" and chart_paths
                and chart_paths.get("rating_distribution")):
            parts.append("")
            parts.append(
                f"![평점 분포]({chart_paths['rating_distribution']})"
            )
        if (key == "coverage" and chart_paths
                and chart_paths.get("coverage_composition")):
            parts.append("")
            parts.append(
                f"![신호 커버리지 구성]({chart_paths['coverage_composition']})"
            )
        if (key == "segment_findings" and chart_paths
                and chart_paths.get("segment_signal_heatmap")):
            # Heatmap is the scan-view; the prose portraits below give
            # evidence + quotes. Visual first, text second.
            # Insert the image BEFORE the text body instead of after.
            parts.pop()  # remove body
            parts.append(
                f"![세그먼트 × 신호 히트맵]({chart_paths['segment_signal_heatmap']})"
            )
            parts.append("")
            parts.append(body)
        parts.append("")
    if n.caveats:
        parts.append("## 주의사항")
        for c in n.caveats:
            parts.append(f"- {c}")
        parts.append("")
    return "\n".join(parts).rstrip() + "\n"


# ---------------------------------------------------------------------------
# Section renderers
# ---------------------------------------------------------------------------


def _title(report: Phase1Report) -> str:
    dp = report.deterministic_metrics.dominant_product
    if dp is None:
        return "Phase 1 VOC 모니터링 리포트"
    # Prefer a product in scope with a display_label (set by PR5C+ lookups).
    label = next(
        (p.display_label for p in report.scope.products
         if p.product_id == dp.product_id and p.display_label),
        None,
    )
    subject = label or dp.product_id
    return f"Phase 1 VOC 모니터링 리포트 — {subject}"


def _render_summary(report: Phase1Report, m: DeterministicMetrics) -> str:
    if m.total_reviews == 0:
        return "이 쿼리에 해당하는 리뷰가 없습니다."
    channels = "·".join(sorted(m.channels))
    window = m.time_window
    window_str = ""
    if window.start_date and window.end_date:
        window_str = (
            f" · 기간 {window.start_date.isoformat()} ~ "
            f"{window.end_date.isoformat()} ({window.days_span}일)"
        )
    line = (
        f"대상 리뷰 {m.total_reviews}건 · {m.n_products}개 제품 · "
        f"채널 {channels}{window_str}"
    )
    if m.rating.avg_raw is not None:
        line += f" · 평균 평점 {_fmt_rating(m.rating.avg_raw)} / 5"

    # Framing paragraph — anchors first-time readers with what the artifact
    # IS (rule-based pipeline analysis, not hand-curated), what data it
    # covers (already stated in the summary line but reinforced in prose
    # form), and where methodology lives. Parameterized so every regenerated
    # report carries the right product name + review count.
    product_label = _title_subject(report)
    framing = (
        f"\n\n본 리포트는 {product_label}의 {channels} 공개 리뷰 "
        f"{m.total_reviews}건을 정규화·중복제거 후 규칙 기반 신호 추출 "
        f"파이프라인으로 분석한 결과입니다. 수치는 재현 가능한 감지 규칙 기반이며, "
        f"인용문은 대표 사례입니다. 집중도 배수·방법론은 뒤이은 섹션과 "
        f"주의사항을 참조하세요."
    )
    return line + framing


def _title_subject(report: Phase1Report) -> str:
    """Resolve the subject label for prose references. Mirrors the title
    logic in _title() but without the prefix."""
    dp = report.deterministic_metrics.dominant_product
    if dp is not None:
        label = next(
            (p.display_label for p in report.scope.products
             if p.product_id == dp.product_id and p.display_label),
            None,
        )
        return label or dp.product_id
    if report.scope.products:
        first = report.scope.products[0]
        return first.display_label or first.product_id
    return "대상 제품"


# Gap-rule classification for the executive summary. These are the
# connector-emitted operational signals that warrant surfacing at the top
# of a report regardless of count, because even a single occurrence is
# worth a brand team's attention.
_HIGH_SEVERITY_GAP_NAMES = frozenset({
    "coupang_authenticity_concern",
    "skin_irritation_concern",
})
# Suppress top-positive bullet when its evidence count is barely above the
# min_doc_freq floor — avoids listing "2건" findings as headline material.
_MIN_EVIDENCE_FOR_HEADLINE_POSITIVE = 5
_MIN_EVIDENCE_FOR_HEADLINE_CAUTIONARY = 3
_HEADLINE_MAX_BULLETS = 4


def _render_executive_summary(report: Phase1Report) -> str:
    """Scan-readable top-of-report section with 2-4 bullet findings.

    Priority order (truncated at _HEADLINE_MAX_BULLETS):
      1. Sample + rating posture (always included when any reviews).
      2. High-severity gap rules (authenticity, skin_irritation) when any fire.
      3. Top cautionary signal by evidence count, if ≥ min threshold.
      4. Top positive signal when evidence count ≥ min threshold (fills
         remaining room).

    Data-quality-style findings (e.g. ``api_repurchase_vs_text_mention``)
    are intentionally NOT surfaced here — they live in the 운영 관찰
    section and in the derived cross-cuts (segment / shade), where the
    interpretation is more grounded. The exec summary privileges
    product-attribute findings that a brand team can directly act on.

    Returns empty string on zero-review reports so ``render_markdown`` can
    suppress the heading.
    """
    m = report.deterministic_metrics
    s = report.signals

    if m.total_reviews == 0:
        return ""

    bullets: list[str] = []

    # 1. Sample + rating posture.
    parts = [f"전체 {m.total_reviews}건 리뷰"]
    if m.rating.avg_raw is not None:
        parts.append(f"평균 {_fmt_rating(m.rating.avg_raw)}/5")
        dist = m.rating.distribution_raw
        rated = sum(dist.values())
        five_count = dist.get(5, 0)
        if rated > 0:
            five_pct = round(100 * five_count / rated, 1)
            parts.append(f"5★ 비중 {five_pct:g}%")
    bullets.append(f"- {' · '.join(parts)}")

    # 2. High-severity gaps, OR top cautionary.
    high_sev = [g for g in s.gaps if g.name in _HIGH_SEVERITY_GAP_NAMES]
    if high_sev:
        labels = [f"{g.display_label} {g.evidence_count}건" for g in high_sev]
        bullets.append(f"- 고위험 신호: {' · '.join(labels)}")
    elif s.cautionary:
        top_c = max(s.cautionary, key=lambda x: x.evidence_count)
        if top_c.evidence_count >= _MIN_EVIDENCE_FOR_HEADLINE_CAUTIONARY:
            bullets.append(
                f"- 주요 주의 신호: {top_c.display_label} — "
                f"{top_c.evidence_count}건 ({_pct(top_c.coverage_ratio)})"
            )

    # 3. Top positive, only if room and evidence is meaningful.
    if len(bullets) < _HEADLINE_MAX_BULLETS and s.positive:
        top_p = max(s.positive, key=lambda x: x.evidence_count)
        if top_p.evidence_count >= _MIN_EVIDENCE_FOR_HEADLINE_POSITIVE:
            bullets.append(
                f"- 주요 긍정 신호: {top_p.display_label} — "
                f"{top_p.evidence_count}건 ({_pct(top_p.coverage_ratio)})"
            )

    return "\n".join(bullets[:_HEADLINE_MAX_BULLETS])


def _render_sample(report: Phase1Report, m: DeterministicMetrics) -> str:
    if m.total_reviews == 0:
        return "(리뷰 없음)"
    lines: list[str] = []
    dp = m.dominant_product
    if dp is not None:
        dp_label = _label_for(report, dp.product_id) or dp.product_id
        dp_pct = _pct(dp.pct_of_total)
        lines.append(f"- 대표 제품: {dp_label} — {dp.n_reviews}건 ({dp_pct})")
        for p in m.per_product[1:]:
            p_label = _label_for(report, p.product_id) or p.product_id
            lines.append(f"- 부가 제품: {p_label} — {p.n_reviews}건 ({_pct(p.pct_of_total)})")
    if m.rating.avg_raw is not None:
        dist = ", ".join(
            f"{star}★ {m.rating.distribution_raw[star]}건"
            for star in sorted(m.rating.distribution_raw, reverse=True)
        )
        lines.append(f"- 평점: 평균 {_fmt_rating(m.rating.avg_raw)} · {dist}")
    # Segment rollup — only show skin_type for now (age_group is usually unknown for OY).
    skin = m.segments.normalized_skin_type
    if skin and set(skin) - {"unknown"}:
        parts = [
            f"{_SKIN_TYPE_KO.get(b, b)} {n}건"
            for b, n in skin.items() if b != "unknown"
        ]
        unk = skin.get("unknown", 0)
        if unk:
            parts.append(f"{_SKIN_TYPE_KO['unknown']} {unk}건")
        lines.append("- 피부 타입 분포: " + ", ".join(parts))
    return "\n".join(lines)


def _render_signal_section(
    signals: list[SignalCandidate],
    *,
    empty_msg: str,
    review_text_by_id: dict[str, str] | None = None,
) -> str:
    if not signals:
        return empty_msg
    lines = []
    for s in signals:
        lines.append(
            f"- **{s.display_label}** — {_pct(s.coverage_ratio)} "
            f"({s.evidence_count}건)"
        )
        lines.extend(_render_quotes(s.sample_review_ids, review_text_by_id))
    return "\n".join(lines)


def _render_shade_findings(
    findings: list[ShadeSignalFinding],
    *,
    review_text_by_id: dict[str, str] | None = None,
) -> str:
    """Render the shade×signal cross-cut as compact portraits.

    Shades with multiple findings render as a single header
    ("퓨리티 셰이드 (19건 · 제품의 6.9% · 평균 4.84/5)") followed by nested
    sub-bullets — one per finding, each carrying a representative quote
    when ``review_text_by_id`` is provided. Shades with a single finding
    render as a single-line bullet with the same context inline.

    Empty list → empty string → render_markdown suppresses the heading.
    """
    if not findings:
        return ""
    # Preserve first-seen shade order (matches lift-desc sort from derived).
    shade_order: list[str] = []
    by_shade: dict[str, list[ShadeSignalFinding]] = {}
    for f in findings:
        if f.shade not in by_shade:
            by_shade[f.shade] = []
            shade_order.append(f.shade)
        by_shade[f.shade].append(f)

    lines: list[str] = []
    for shade in shade_order:
        group = by_shade[shade]
        first = group[0]
        ctx = _shade_context_line(first)
        if len(group) == 1:
            lines.append(
                f"- **{shade} 셰이드** ({ctx}) — "
                f"{_shade_finding_fragment(first)}"
            )
            for qline in _render_quotes(
                first.sample_review_ids, review_text_by_id,
            ):
                lines.append(qline)
        else:
            lines.append(f"- **{shade} 셰이드** ({ctx})")
            for f in group:
                lines.append(f"  - {_shade_finding_fragment(f)}")
                # Quote lines nest one level deeper than segment single-bullet
                # case; _render_quotes already indents with two spaces, so
                # re-indent to match the parent sub-bullet.
                for qline in _render_quotes(
                    f.sample_review_ids, review_text_by_id,
                ):
                    lines.append("  " + qline)
    return "\n".join(lines)


def _shade_context_line(f: ShadeSignalFinding) -> str:
    parts = [f"{f.n_shade}건", f"제품의 {_pct(f.shade_share_of_product)}"]
    if f.shade_avg_rating is not None:
        parts.append(f"평균 {f.shade_avg_rating:.2f}/5")
    return " · ".join(parts)


def _shade_finding_fragment(f: ShadeSignalFinding) -> str:
    band = _concentration_band(f.lift)
    thin = _thin_evidence_marker(f.n_signal_in_shade)
    return (
        f"{f.signal_display_label} "
        f"언급률 {_pct(f.within_shade_rate)} "
        f"({f.n_signal_in_shade}/{f.n_shade}건) · "
        f"제품 평균 {_pct(f.overall_rate)} 대비 집중도 {f.lift:g}× ({band})"
        f"{thin}"
    )


def _render_rating_divergences(findings: list[RatingContentDivergence]) -> str:
    """Render the rating×content divergence cells as a small bullet list.

    Empty list → empty string → section heading suppressed by
    ``render_markdown``. Each cell rendered on one line with conservative
    framing: counts first, rate second, interpretation third. No causal
    language; reader draws their own conclusions.
    """
    if not findings:
        return ""
    lines: list[str] = []
    for f in findings:
        pct = _pct(f.within_rate)
        rating_display = f"{f.rating_bound}★ 이상" if f.rating_condition == ">=" else f"{f.rating_bound}★ 이하"
        if f.kind == "high_rated_with_concerns":
            interpretation = "높은 평점이지만 본문에 구체적 피드백 포함"
        else:  # low_rated_without_concerns
            interpretation = "낮은 평점이지만 규칙 기반 주의 신호 미탐지 — 어휘 커버리지 확장 가능성"
        lines.append(
            f"- **{rating_display}** — "
            f"{f.cell_count}건 / {f.population_size}건 ({pct}) · {interpretation}"
        )
    return "\n".join(lines)


def _render_coverage(coverage: SignalCoverage | None) -> str:
    """Render the signal-coverage summary as three compact lines.

    Surfaces explicitly what fraction of the corpus the rule-based layer
    actually engaged with, how the engaged rows break down across
    signal-type combinations, and how the silent rows distribute across
    rating buckets (silent-but-low-rated flags coverage gaps; silent-
    high-rated is expected attribute-vague praise).

    Suppressed when coverage is None or total_reviews is zero.
    """
    if coverage is None or coverage.total_reviews == 0:
        return ""
    t = coverage.total_reviews
    lines: list[str] = [
        f"- 전체 {t}건 중 {coverage.rows_with_any_signal}건 "
        f"({_pct(coverage.rows_with_any_signal / t)})에서 신호 매칭, "
        f"나머지 {coverage.rows_with_no_signal}건 "
        f"({_pct(coverage.rows_with_no_signal / t)})은 구체적 속성 언급 미감지"
    ]
    # Composition of signal-bearing rows — show non-zero buckets only.
    parts: list[str] = []
    if coverage.positive_only > 0:
        parts.append(
            f"긍정만 {coverage.positive_only}건 "
            f"({_pct(coverage.positive_only / t)})"
        )
    if coverage.mixed > 0:
        parts.append(
            f"긍정+주의 혼합 {coverage.mixed}건 "
            f"({_pct(coverage.mixed / t)})"
        )
    if coverage.cautionary_only > 0:
        parts.append(
            f"주의만 {coverage.cautionary_only}건 "
            f"({_pct(coverage.cautionary_only / t)})"
        )
    if coverage.gap_only > 0:
        parts.append(
            f"운영 신호만 {coverage.gap_only}건 "
            f"({_pct(coverage.gap_only / t)})"
        )
    if parts:
        lines.append(f"- 신호 구성: {' · '.join(parts)}")
    if coverage.no_signal_by_rating:
        silent_parts = [
            f"{k}★ {v}건"
            for k, v in sorted(coverage.no_signal_by_rating.items(), reverse=True)
        ]
        lines.append(f"- 신호 없음 구성 (평점별): {' · '.join(silent_parts)}")
    return "\n".join(lines)


def _render_segment_findings(
    findings: list[SegmentSignalFinding],
    *,
    review_text_by_id: dict[str, str] | None = None,
) -> str:
    """Render the derived segment×signal cross-cut as compact portraits.

    Segments with multiple findings group under a single header carrying
    absolute context (size, share of known-segment responders, avg rating).
    Each finding is a sub-bullet, optionally followed by a representative
    quote when ``review_text_by_id`` is provided. Single-finding segments
    use an inline format to save vertical space.

    Empty list → empty string → render_markdown suppresses the heading.
    """
    if not findings:
        return ""
    bucket_order: list[str] = []
    by_bucket: dict[str, list[SegmentSignalFinding]] = {}
    for f in findings:
        if f.bucket not in by_bucket:
            by_bucket[f.bucket] = []
            bucket_order.append(f.bucket)
        by_bucket[f.bucket].append(f)

    lines: list[str] = []
    for bucket in bucket_order:
        group = by_bucket[bucket]
        first = group[0]
        bucket_ko = _SKIN_TYPE_KO.get(bucket, bucket)
        ctx = _segment_context_line(first)
        if len(group) == 1:
            lines.append(
                f"- **{bucket_ko} 이용자** ({ctx}) — "
                f"{_segment_finding_fragment(first)}"
            )
            for qline in _render_quotes(
                first.sample_review_ids, review_text_by_id,
            ):
                lines.append(qline)
        else:
            lines.append(f"- **{bucket_ko} 이용자** ({ctx})")
            for f in group:
                lines.append(f"  - {_segment_finding_fragment(f)}")
                for qline in _render_quotes(
                    f.sample_review_ids, review_text_by_id,
                ):
                    lines.append("  " + qline)
    return "\n".join(lines)


def _segment_context_line(f: SegmentSignalFinding) -> str:
    parts = [
        f"{f.n_segment}건",
        f"응답자 중 {_pct(f.segment_share_of_known)}",
    ]
    if f.segment_avg_rating is not None:
        parts.append(f"평균 {f.segment_avg_rating:.2f}/5")
    return " · ".join(parts)


def _segment_finding_fragment(f: SegmentSignalFinding) -> str:
    band = _concentration_band(f.lift)
    thin = _thin_evidence_marker(f.n_signal_in_segment)
    return (
        f"{f.signal_display_label} "
        f"언급률 {_pct(f.within_segment_rate)} "
        f"({f.n_signal_in_segment}/{f.n_segment}건) · "
        f"전체 평균 {_pct(f.overall_rate)} 대비 집중도 {f.lift:g}× ({band})"
        f"{thin}"
    )


def _render_operational(
    m: DeterministicMetrics,
    s: SignalsBundle,
    *,
    review_text_by_id: dict[str, str] | None = None,
) -> str:
    lines: list[str] = []
    for g in s.gaps:
        lines.append(
            f"- {g.display_label} — {_pct(g.coverage_ratio)} ({g.evidence_count}건)"
        )
        lines.extend(_render_quotes(g.sample_review_ids, review_text_by_id))
    # Dominant-product shade distribution, if any.
    dp = m.dominant_product
    if dp is not None and m.per_product:
        dom = next((p for p in m.per_product if p.product_id == dp.product_id), None)
        if dom and dom.shades:
            shade_str = ", ".join(f"{sc.shade} {sc.n}건" for sc in dom.shades)
            lines.append(f"- 대표 제품 셰이드 분포: {shade_str}")
    # OY-specific rollups, if present.
    cs = m.channel_signals
    if cs.oy_review_type:
        rt_str = ", ".join(f"{k} {v}건" for k, v in cs.oy_review_type.items())
        lines.append(f"- 올리브영 리뷰 타입: {rt_str}")
    if cs.oy_has_photo is not None and (cs.oy_has_photo.true + cs.oy_has_photo.false):
        total = cs.oy_has_photo.true + cs.oy_has_photo.false
        lines.append(f"- 사진 포함 리뷰: {cs.oy_has_photo.true}/{total}")
    if not lines:
        return "(운영 관찰 신호 없음)"
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Caveats — deterministic, threshold-based
# ---------------------------------------------------------------------------


# Concentration-band thresholds for lift values surfaced in the derived
# analysis. Matches the 2× floor set in derived.py — findings below 2×
# are filtered at the detector. Bands map raw multipliers to reader-
# friendly Korean phrases so a scan-reader doesn't have to calibrate
# what "6.17×" vs "2.1×" mean.
_CONCENTRATION_BANDS: tuple[tuple[float, str], ...] = (
    (5.0, "매우 뚜렷한 집중"),
    (3.0, "뚜렷한 집중"),
    (2.0, "중간 집중"),
)

# Evidence-count floor below which a finding is flagged as thin. The
# detector's MIN_EVIDENCE_IN_SEGMENT / MIN_EVIDENCE_IN_SHADE is 2, so
# evidence counts of 2-4 are the narrow band where a finding clears the
# surfacing floor but is close to it. 5 is the boundary above which
# findings feel substantive enough not to flag.
_THIN_EVIDENCE_THRESHOLD = 5


def _concentration_band(lift: float) -> str:
    """Map a lift multiplier to a Korean band label. Findings below 2.0×
    don't reach the renderer (filtered at detector), but we return a
    safe fallback for defensive callers."""
    for threshold, label in _CONCENTRATION_BANDS:
        if lift >= threshold:
            return label
    return "약한 집중"


def _thin_evidence_marker(n_signal_in_slice: int) -> str:
    """Return ` · 표본 적음` for findings at the evidence-count floor,
    empty string otherwise. Appended to the finding fragment so the
    reader sees evidence-thinness alongside the concentration band."""
    if n_signal_in_slice < _THIN_EVIDENCE_THRESHOLD:
        return " · 표본 적음"
    return ""


def _compute_caveats(m: DeterministicMetrics) -> list[str]:
    out: list[str] = []
    if m.total_reviews == 0:
        out.append("대상 리뷰가 없어 신호 분석이 비어 있습니다.")
        return out
    if m.total_reviews < _SMALL_SAMPLE_N:
        out.append(f"표본 크기가 작습니다 (n={m.total_reviews}).")
    dp = m.dominant_product
    if (dp is not None
            and dp.pct_of_total >= _DOMINANT_SKEW_PCT
            and m.n_products > 1):
        # Only meaningful when there IS a minority product whose signals
        # might be unstable. Single-product queries don't need this warning.
        out.append(
            f"대표 제품 비중이 {_pct(dp.pct_of_total)}로 편중되어 있어 "
            "부가 제품 신호는 안정적이지 않을 수 있습니다."
        )
    tw = m.time_window
    if tw.days_span is not None and tw.days_span < _SHORT_WINDOW_DAYS:
        out.append(f"관찰 기간이 짧습니다 ({tw.days_span}일).")
    if m.rating.missing > 0:
        out.append(f"평점 누락 리뷰 {m.rating.missing}건은 평균 계산에서 제외되었습니다.")
    return out


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------


_QUOTE_MAX_CHARS = 160


def _render_quotes(
    sample_review_ids: list[str],
    review_text_by_id: dict[str, str] | None,
) -> list[str]:
    """Produce indented quoted-excerpt bullets for a signal's sample_review_ids.

    Returns empty list when the lookup map is None (backward-compat: no
    quotes when caller didn't supply text), when the signal has no samples,
    or when none of the samples resolve to non-empty text.
    """
    if not review_text_by_id or not sample_review_ids:
        return []
    out: list[str] = []
    for rid in sample_review_ids:
        text = review_text_by_id.get(rid)
        if not text:
            continue
        snippet = _clean_excerpt(text)
        if not snippet:
            continue
        out.append(f"  - _\"{snippet}\"_")
    return out


def _clean_excerpt(text: str) -> str:
    """Collapse whitespace, strip, truncate to _QUOTE_MAX_CHARS with an
    ellipsis if cut. Keeps square-bracket title prefixes (e.g. ``[뜯어보자마자
    분해됨]``) since those are often the most surgical evidence."""
    collapsed = " ".join(text.split())
    if len(collapsed) <= _QUOTE_MAX_CHARS:
        return collapsed
    return collapsed[:_QUOTE_MAX_CHARS].rstrip() + "…"


def _pct(x: float) -> str:
    """Format a [0,1] ratio as a percentage with one decimal."""
    return f"{round(x * 100, 1):g}%"


def _fmt_rating(x: float) -> str:
    """Format a raw 1–5 rating average for operator display.

    The metrics contract stores 4 decimals; operators read 2 (e.g.
    ``4.8333`` → ``4.83``, ``4.85`` → ``4.85``, ``5.0`` → ``5.0``).
    """
    return f"{round(x, 2)}"


def _label_for(report: Phase1Report, product_id: str) -> str | None:
    for p in report.scope.products:
        if p.product_id == product_id:
            return p.display_label
    return None
