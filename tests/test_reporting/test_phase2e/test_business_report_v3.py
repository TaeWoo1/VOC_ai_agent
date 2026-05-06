"""End-to-end tests for the Business Report v3 PDF layout.

Run-003 QA pass-3 found that the prior PDF read like a personal-review
note rather than a publishable analyst report. The v3 layout follows
a 9-section business-report structure (Cover → Executive Summary →
Coverage → Findings → Matrix → Decisions → Buyer Translation →
Methodology → Appendix) and uses tables / KPI cards / badges instead
of long paragraphs.

Tests:
  - render_seller_business_report_v3 produces a valid PDF.
  - All 9 required sections are present in the rendered text.
  - Section numbers are contiguous (1, 2, …, 9).
  - Forbidden symbols (∫, ∬, ∭, ∮, ∯, ∰, √, ∑, ∏, ∂, ∞) absent.
  - Forbidden internal jargon ("관찰 신호", "신뢰도 낮음", …) absent.
  - "와(과)" never appears (use grammatically correct 과 / 와 directly).
  - At least 4 Table flowables are constructed.
  - polarity_suspect quotes are skipped from the strengths /
    monitoring representative slots.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]


def _load_pdf_module():
    name = "generate_phase2e_pdf_v2_for_v3_tests"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(
        name, REPO / "scripts" / "generate_phase2e_pdf_v2.py",
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _sample_analysis_report() -> dict:
    return {
        "schema_version": "3.0",
        "generated_at": "2026-05-02T10:13:17Z",
        "product": {
            "slug": "product-test",
            "name_ko": "Test Pad — 200매 대용량",
            "category": "패드",
            "source_url": (
                "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
                "?goodsNo=A000000123456"
            ),
        },
        "corpus": {
            "n_reviews_total": 2115,
            "n_reviews_analyzed": 2115,
            "primary_sort": "DATETIME_DESC",
            "sampling_strategy": "observable_multi_sort_corpus",
            "corpus_type": "observed_scrape",
            "confidence_level": "high",
            "signal_stability": "high",
            "observation_window": {"start": None, "end": None},
            "confidence_axes": {
                "sample_size_confidence": {
                    "level": "high", "label_ko": "표본 충분",
                    "note_ko": "리뷰 표본이 충분히 커서 반복되는 패턴을 안정적으로 관찰할 수 있습니다.",
                },
                "collection_completeness": {
                    "level": "partial", "label_ko": "일부 수집 실패",
                    "note_ko": "일부 정렬에서 수집이 실패하여, 그 정렬의 리뷰는 분석에 포함되지 않았습니다.",
                },
                "negative_signal_coverage": {
                    "level": "degraded", "label_ko": "아쉬움 신호 과소 관측 우려",
                    "note_ko": "평점 낮은순(RATING_ASC) 수집 실패로 아쉬움 의견 신호가 과소 관측되었을 수 있습니다.",
                },
                "evidence_reliability": {
                    "level": "medium", "label_ko": "근거 신뢰 보통",
                    "note_ko": "일부 인용에서 감성 자동 점검 의심 신호가 관측되어 인용 확인을 권장합니다.",
                },
                "headline_caution": (
                    "평점 낮은순(RATING_ASC) 수집 실패로 아쉬움 의견 신호가 "
                    "과소 관측되었을 수 있습니다."
                ),
            },
        },
        "attributes": [
            {
                "key": "finish_texture", "label_ko": "촉촉함/마무리감",
                "n_positive": 356, "n_negative": 33, "n_mixed": 15,
                "evidence_score": 6.0,
                "polarity_share": {"positive": 0.88, "negative": 0.08, "mixed": 0.04},
                "tier": None,
                "top_quotes": [
                    {"text": "잘 밀착돼서 촉촉함이 계속 느껴졌어요",
                     "display_text": "잘 밀착돼서 촉촉함이 계속 느껴졌어요",
                     "display_quote_summary": "잘 밀착돼서 촉촉함이 계속 느껴졌어요",
                     "review_id": "r1", "polarity": "positive"},
                ],
            },
            {
                "key": "value_price", "label_ko": "대용량/가성비",
                "n_positive": 331, "n_negative": 19, "n_mixed": 1,
                "evidence_score": 6.0,
                "polarity_share": {"positive": 0.94, "negative": 0.05, "mixed": 0.01},
                "tier": None,
                "top_quotes": [
                    {"text": "용량이 커서 양이 많이 들어 있습니다",
                     "display_text": "용량이 커서 양이 많이 들어 있습니다",
                     "display_quote_summary": "용량이 커서 양이 많이 들어 있습니다",
                     "review_id": "r2", "polarity": "positive"},
                ],
            },
            {
                "key": "dryness_skin_texture", "label_ko": "건조감/당김",
                "n_positive": 143, "n_negative": 37, "n_mixed": 5,
                "evidence_score": 5.0,
                "polarity_share": {"positive": 0.77, "negative": 0.20, "mixed": 0.03},
                "tier": None,
                "top_quotes": [
                    {"text": "건조함도 없고 매끄럽네요",
                     "display_text": "건조함이 줄었다는 만족 의견",
                     "display_quote_summary": "건조함이 줄었다는 의견",
                     "review_id": "r3", "polarity": "positive"},
                    # Polarity-suspect quote that must be excluded from
                    # representative slots.
                    {"text": "생각보다 만족스러웠어요",
                     "display_text": "생각보다 만족스러웠어요",
                     "display_quote_summary": "만족스러웠다는 의견",
                     "review_id": "r_suspect", "polarity": "positive",
                     "polarity_suspect": True,
                     "polarity_check": {"is_suspect": True, "reasons": []}},
                ],
            },
        ],
        "strengths": [
            {"attribute_key": "finish_texture", "supporting_count": 356,
             "theme_keywords_ko": [],
             "representative_quote": {
                 "text": "잘 밀착돼서 촉촉함이 계속 느껴졌어요",
                 "display_text": "잘 밀착돼서 촉촉함이 계속 느껴졌어요",
                 "display_quote_summary": "잘 밀착돼서 촉촉함이 계속 느껴졌어요",
                 "review_id": "r1", "polarity": "positive"}},
            {"attribute_key": "value_price", "supporting_count": 331,
             "theme_keywords_ko": [],
             "representative_quote": {
                 "text": "용량이 커서 양이 많이 들어 있습니다",
                 "display_text": "용량이 커서 양이 많이 들어 있습니다",
                 "display_quote_summary": "용량이 커서 양이 많이 들어 있습니다",
                 "review_id": "r2", "polarity": "positive"}},
            {"attribute_key": "dryness_skin_texture", "supporting_count": 143,
             "theme_keywords_ko": [],
             # Suspect representative — must be skipped, fall back to a
             # clean quote from top_quotes.
             "representative_quote": {
                 "text": "생각보다 만족스러웠어요",
                 "display_text": "생각보다 만족스러웠어요",
                 "display_quote_summary": "만족스러웠다는 의견",
                 "review_id": "r_suspect", "polarity": "positive",
                 "polarity_suspect": True}},
        ],
        "monitoring_candidates": [
            {"attribute_key": "dryness_skin_texture",
             "concern_label_ko": "건조감/당김", "n_negative": 37,
             "interview_hook_ko": (
                 "도포 직후 건조함 - 보습 라인 병용 / 흡수 시간 / 마무리 텍스처"
             )},
            {"attribute_key": "finish_texture",
             "concern_label_ko": "촉촉함/마무리감", "n_negative": 33,
             "interview_hook_ko": (
                 "마무리 텍스처 - 흡수 후 끈적임 / 답답함 / 백탁"
             )},
        ],
        "tradeoffs": [],
        "usage_patterns": [],
        "buyer_segments": [],
        "quick_decision": {
            "verdict_ko":
                "촉촉함/마무리감 만족 후기 356건이 보이지만, "
                "건조감/당김 불만 후기도 37건 함께 누적됩니다.",
            "who_for_ko": [],
            "who_not_for_ko": [],
            "watch_outs_ko": ["건조감/당김"],
            "confidence_level": "strong",
        },
        "methodology_notes": {
            "disclosure_ko": "리뷰 정리 자료입니다.",
            "sample_caveats_ko": [],
            "sampling_strategy": "observable_multi_sort_corpus",
        },
        "polarity_audit": {
            "n_total_quotes": 4,
            "n_total_suspect": 1,
            "n_total_suspect_share": 0.25,
            "by_attribute": {},
            "samples": [],
        },
    }


def _sample_collection_summary() -> dict:
    return {
        "schema_version": "1.1",
        "sorts_attempted": [
            "DATETIME_DESC", "RATING_ASC", "RATING_DESC",
            "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
        ],
        "sorts_succeeded": [
            "DATETIME_DESC", "RATING_DESC", "USEFUL_SCORE_DESC",
        ],
        "sorts_failed": ["RATING_ASC", "RECOMMENDED_DESC"],
        "sorts_blocked_or_anti_bot": [],
        "partial_success": True,
        "primary_sort": "DATETIME_DESC",
        "review_count_analyzed": 2115,
        "collection_started_at": "2026-05-02T15:52:36",
        "collection_completed_at": "2026-05-02T16:00:59",
    }


# ---------------------------------------------------------------------------
# End-to-end PDF render
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def rendered_v3_pdf(tmp_path_factory) -> bytes:
    pdf_v2 = _load_pdf_module()
    out_dir = tmp_path_factory.mktemp("br3")
    out_path = out_dir / "v3.pdf"
    pdf_v2.render_seller_business_report_v3(
        analysis_report=_sample_analysis_report(),
        collection_summary=_sample_collection_summary(),
        out_path=out_path,
        run_id="2026-05-02_test_run",
        generated_at="2026-05-02T10:00:00Z",
    )
    assert out_path.exists()
    return out_path.read_bytes()


def _extract_pdf_text(pdf_bytes: bytes) -> str:
    from pypdf import PdfReader
    import io
    r = PdfReader(io.BytesIO(pdf_bytes))
    return "\n".join((p.extract_text() or "") for p in r.pages)


# ---------------------------------------------------------------------------
# 1. Structural integrity
# ---------------------------------------------------------------------------


def test_v3_pdf_has_pdf_header(rendered_v3_pdf):
    assert rendered_v3_pdf.startswith(b"%PDF-")
    assert b"%%EOF" in rendered_v3_pdf[-32:]


def test_v3_pdf_size_in_sane_range(rendered_v3_pdf):
    n = len(rendered_v3_pdf)
    assert 5_000 < n < 1_000_000


# ---------------------------------------------------------------------------
# 2. Section presence + ordering
# ---------------------------------------------------------------------------


def test_v3_pdf_contains_all_seven_sections(rendered_v3_pdf):
    """Pass-19I: section restructure for the seller-facing report.

    Previous flow:
      1.Executive → 2.Findings → 3.Matrix → 4.Decisions →
      5.Buyer Content Translation → 6.Methodology → 7.Appendix.
    The "Buyer Content Translation" section read as a copy-suggestion
    sheet — out of scope for an outbound seller report. Pass-19I
    replaces sections 2-5 with decision-oriented bucketing:
      1.Executive Summary (verdict-first)
      2.Signal Dashboard (KEEP/FIX/CLARIFY/MONITOR + Priority Map)
      3.What's Working
      4.What Needs Attention
      5.Seller Action Plan  (REPLACES Buyer Content Translation)
      6.Methodology
      7.Appendix
    """
    text = _extract_pdf_text(rendered_v3_pdf)
    for header in (
        "1. Executive Summary",
        "2. Signal Dashboard",
        "3. What's Working",
        "4. What Needs Attention",
        "5. Seller Action Plan",
        "6. Methodology",
        "7. Appendix",
    ):
        assert header in text, f"missing required section header: {header!r}"
    # And the legacy section names must NOT appear.
    for legacy in (
        "Buyer Content Translation",
        "콘텐츠 문구 예시",
    ):
        assert legacy not in text, f"legacy section leaked into v3 PDF: {legacy!r}"


def test_v3_pdf_section_numbers_are_contiguous(rendered_v3_pdf):
    """Sections 1-7 appear in order. The cover header has no number."""
    text = _extract_pdf_text(rendered_v3_pdf)
    positions: list[int] = []
    for n in range(1, 8):
        idx = text.find(f"{n}. ")
        assert idx >= 0, f"section {n} header not found"
        positions.append(idx)
    assert positions == sorted(positions), (
        f"section headers out of order: {positions}"
    )


# ---------------------------------------------------------------------------
# 3. Forbidden glyph + wording scans
# ---------------------------------------------------------------------------


def test_v3_pdf_has_no_forbidden_math_symbols(rendered_v3_pdf):
    from src.voc.content.reader_friendly_wording import FORBIDDEN_SYMBOLS
    text = _extract_pdf_text(rendered_v3_pdf)
    hits = [s for s in FORBIDDEN_SYMBOLS if s in text]
    assert hits == [], f"forbidden math symbols in PDF body: {hits}"


def test_v3_pdf_has_no_internal_jargon(rendered_v3_pdf):
    text = _extract_pdf_text(rendered_v3_pdf)
    # Pass-19I: "우선 검토" was a hedge-language verdict tail (e.g.
    # "우선 검토 후보로 보입니다"). The new Signal Dashboard uses
    # "우선 개선 검토 필요" — that's seller action phrasing, NOT
    # analyst jargon, so the substring filter is tightened to the
    # specific hedge-tail form the legacy verdict produced.
    forbidden = (
        "관찰 신호", "주요 신호", "우선 검토 후보",
        "부정 신호", "긍정 신호", "모니터링 후보",
        "신뢰도 낮음", "신뢰도 높음", "신뢰도 보통",
        "안정성 높음", "안정성 보통", "안정성 낮음",
        "관측된 반복 신호", "모니터링 가치",
        "코퍼스 정보가 전달되지 않아",
    )
    hits = [t for t in forbidden if t in text]
    assert hits == [], f"forbidden internal jargon: {hits}"


def test_v3_pdf_has_no_wagwa_literal(rendered_v3_pdf):
    text = _extract_pdf_text(rendered_v3_pdf)
    assert "와(과)" not in text


# ---------------------------------------------------------------------------
# 4. Quote handling — polarity suspect skip + display_quote_summary
# ---------------------------------------------------------------------------


def test_v3_pdf_does_not_surface_polarity_suspect_quote_as_strength(
    rendered_v3_pdf,
):
    """The fixture's strengths[2] (dryness_skin_texture) carries a
    polarity-suspect representative ("생각보다 만족스러웠어요"). The
    v3 builder must skip it; the cleaner top_quote ("건조함도 없고...")
    should land in the strengths table instead."""
    text = _extract_pdf_text(rendered_v3_pdf)
    assert "생각보다 만족스러웠어요" not in text


def test_v3_pdf_uses_quote_summary_field_not_paraphrased_cardnews_form(
    rendered_v3_pdf,
):
    """display_quote_summary is the PDF-only field — short clean quote
    summaries with no "...만족 의견" duplication. Checks that the
    cardnews-style "...만족 의견" / "...아쉬움 의견" duplication is
    NOT in the rendered PDF."""
    text = _extract_pdf_text(rendered_v3_pdf)
    # No "X 만족 의견" + "X 아쉬움 의견" duplications.
    assert "아쉬움이 있다는 아쉬움 의견" not in text
    assert "만족이라는 만족 의견" not in text
    # Specifically: the synth wrapping pattern that drove run-003 QA
    # rejection ("X라는 만족 의견" stacked with another 의견 word).
    # We allow "만족 의견" alone (legitimate column header) but not
    # the duplication.


# ---------------------------------------------------------------------------
# 5. Table component count
# ---------------------------------------------------------------------------


def test_v3_pdf_constructs_at_least_four_tables():
    """The business-report layout must surface at least 4 Table
    flowables (KPI strip, coverage, strengths/watch-outs, matrix,
    decision implications, etc.). We count by hooking into the
    Table constructor and rendering once."""
    pdf_v2 = _load_pdf_module()
    from reportlab.platypus import Table as _RealTable

    constructed: list = []
    original_init = _RealTable.__init__

    def counting_init(self, *args, **kwargs):
        constructed.append(self)
        return original_init(self, *args, **kwargs)

    _RealTable.__init__ = counting_init
    try:
        import io
        from reportlab.platypus import SimpleDocTemplate
        out = io.BytesIO()
        # Re-run the section builders in isolation so the count is a
        # property of the structural code, not of the SimpleDocTemplate.
        styles = pdf_v2._br3_styles()
        ar = _sample_analysis_report()
        cs = _sample_collection_summary()
        sections = []
        sections.extend(pdf_v2._br3_section_cover(
            analysis_report=ar, run_id="r", generated_at="t",
            styles=styles,
        ))
        sections.extend(pdf_v2._br3_section_executive_summary(
            analysis_report=ar, styles=styles,
        ))
        sections.extend(pdf_v2._br3_section_coverage(
            analysis_report=ar, collection_summary=cs, styles=styles,
        ))
        sections.extend(pdf_v2._br3_section_findings(
            analysis_report=ar, styles=styles,
        ))
        sections.extend(pdf_v2._br3_section_matrix(
            analysis_report=ar, styles=styles,
        ))
        sections.extend(pdf_v2._br3_section_decisions(
            analysis_report=ar, styles=styles,
        ))
        sections.extend(pdf_v2._br3_section_buyer_translation(
            analysis_report=ar, styles=styles,
        ))
        sections.extend(pdf_v2._br3_section_appendix(
            analysis_report=ar, collection_summary=cs, styles=styles,
        ))
    finally:
        _RealTable.__init__ = original_init

    assert len(constructed) >= 4, (
        f"v3 layout produced only {len(constructed)} Table flowables; "
        f"the spec requires at least 4 (KPI / coverage / strengths / "
        f"watch-outs / matrix / decisions / appendix)."
    )


# ---------------------------------------------------------------------------
# 6. Caution badge surfaces RATING_ASC failure
# ---------------------------------------------------------------------------


def test_v3_pdf_surfaces_rating_asc_failure_in_caution_badge(rendered_v3_pdf):
    """Run-003 QA pass-4: caveat now uses seller-friendly phrasing —
    "참고: 평점 낮은순 일부 수집이 실패했습니다. 그래서 아쉬움 의견은
    실제보다 적게 반영됐을 수 있습니다." (no "[해석 주의]" prefix, no
    "과소 관측" jargon)."""
    text = _extract_pdf_text(rendered_v3_pdf)
    assert "참고:" in text
    assert "평점 낮은순" in text
    assert "적게 반영" in text


# ---------------------------------------------------------------------------
# 7. Symbol scrubber unit tests
# ---------------------------------------------------------------------------


class TestSymbolScrubber:
    def test_strips_math_symbols(self):
        from src.voc.content.reader_friendly_wording import scrub_for_report
        out = scrub_for_report("E = mc² ≈ ∞ but ∑x ≤ ∫f")
        for sym in ("≈", "∞", "∑", "≤", "∫"):
            assert sym not in out

    def test_replaces_arrow_with_korean(self):
        from src.voc.content.reader_friendly_wording import scrub_for_report
        out = scrub_for_report("A → B")
        assert "→" not in out
        assert "에서" in out

    def test_passthrough_for_clean_text(self):
        from src.voc.content.reader_friendly_wording import scrub_for_report
        s = "촉촉함이 좋다는 의견이 많습니다."
        assert scrub_for_report(s) == s

    def test_scan_returns_hits(self):
        from src.voc.content.reader_friendly_wording import scan_forbidden_symbols
        assert scan_forbidden_symbols("∫dx") == ["∫"]
        assert scan_forbidden_symbols("clean text") == []


# ---------------------------------------------------------------------------
# 8. Display quote-summary unit tests
# ---------------------------------------------------------------------------


class TestQuoteSummaryForReport:
    def test_no_duplicated_polarity_word(self):
        from src.voc.reporting.phase2e.quote_display import (
            synthesize_quote_summary_for_report,
        )
        out = synthesize_quote_summary_for_report(
            "밀착력은 아쉽고", polarity="negative_weak",
        )
        # PDF summary: single "의견", no "아쉬움 의견" duplication.
        assert out.endswith("의견")
        assert "아쉬움 의견" not in out

    def test_clean_phrase_passes_through(self):
        from src.voc.reporting.phase2e.quote_display import (
            synthesize_quote_summary_for_report,
        )
        s = "재구매 할 정도로 좋아요. 정말 만족합니다."
        assert synthesize_quote_summary_for_report(s, polarity="positive") == s

    def test_idempotent_on_summarized_input(self):
        from src.voc.reporting.phase2e.quote_display import (
            synthesize_quote_summary_for_report,
        )
        once = "밀착이 아쉽다는 의견"
        twice = synthesize_quote_summary_for_report(once, polarity="negative_weak")
        assert twice == once


# ---------------------------------------------------------------------------
# 9. Cardnews 와/과 particle agreement
# ---------------------------------------------------------------------------


def test_buyer_journey_cardnews_does_not_emit_wagwa_literal():
    """Run-003 QA pass-3: cardnews body must use the grammar-correct
    과 / 와 directly, never the literal "와(과)" fallback."""
    from src.voc.content.cardnews_buyer_journey import (
        build_buyer_journey_cardnews,
    )
    cn = build_buyer_journey_cardnews(_sample_analysis_report())
    blob = json.dumps(cn, ensure_ascii=False)
    # tone.avoid carries forbidden-jargon literals — out of scope.
    # We scan slide bodies only.
    for slide in cn.get("slides") or []:
        title = slide.get("title", "")
        bodies = " ".join(slide.get("body_lines") or [])
        for q in slide.get("evidence_quotes") or []:
            bodies += " " + (q.get("display_text") or "")
        if "evidence_quote" in slide:
            bodies += " " + (
                (slide["evidence_quote"] or {}).get("display_text") or ""
            )
        assert "와(과)" not in title, (
            f"slide #{slide.get('index')} title leaks 와(과): {title!r}"
        )
        assert "와(과)" not in bodies, (
            f"slide #{slide.get('index')} body leaks 와(과): {bodies!r}"
        )
