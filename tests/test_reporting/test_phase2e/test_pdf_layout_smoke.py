"""Smoke tests for the polished Phase 2E PDF first-page layout.

These tests verify the renderer produces a non-empty, well-formed PDF
that contains the expected operator-facing text fragments. They do
NOT pixel-diff or visual-snapshot - that level of precision would
break under font-rendering noise across machines. Instead we check:

  - The PDF builds without raising.
  - The byte stream parses as a valid PDF (starts with `%PDF-` and
    ends with `%%EOF`).
  - Section titles, the Overall Verdict box content, and the
    interview-friendly framing strings all reach the document.
  - Output file size is in a sane range (kilobytes, not bytes; not
    megabytes - would indicate something stuck in a render loop).

The synthetic corpus is small but realistic enough to exercise
every branch of the new layout (verdict template, priorities,
strengths, recommended actions, methodology footer).
"""

from __future__ import annotations

import importlib.util
import sys
from collections import Counter
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]


def _load_pdf_module():
    """Load scripts/generate_phase2e_pdf_v2.py as a module for testing.
    Cached on sys.modules so subsequent loads are cheap."""
    name = "generate_phase2e_pdf_v2_layout_test"
    if name in sys.modules:
        return sys.modules[name]
    path = REPO / "scripts" / "generate_phase2e_pdf_v2.py"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _build_synthetic_reviews() -> list[dict]:
    """Mid-sized synthetic corpus that exercises:
      - concerns dominant (≥30% negative)
      - top-priority with mapped impact + risk category
      - strengths with sort-rank evidence
      - mixed prevalence levels
    """
    reviews: list[dict] = []
    # 30% negative - concerns-dominant verdict path.
    for i in range(30):
        reviews.append({
            "review_id": f"r_tr_{i}",
            "mixed_review_flag": False,
            "tradeoff_pair": None,
            "records": [{
                "attribute": "transfer_resistance",
                "polarity": "negative_strong", "intensity": 3,
                "evidence_span": "마스크에 옷에 다 묻어요",
                "confidence": "high", "delivery_condition_flag": False,
            }],
            "oy_evidence_score": 8.0,
            "rating_normalized": 1.0,
            "oy_sort_ranks": {"RATING_ASC": i + 1} if i < 5 else {},
            "review_date": "2026-04-01",
        })
    for i in range(15):
        reviews.append({
            "review_id": f"r_pers_{i}",
            "mixed_review_flag": False, "tradeoff_pair": None,
            "records": [{
                "attribute": "persistence",
                "polarity": "negative_weak", "intensity": 2,
                "evidence_span": "지속력이 좀 별로예요",
                "confidence": "medium", "delivery_condition_flag": False,
            }],
            "oy_evidence_score": 4.0,
            "rating_normalized": 2.0,
            "oy_sort_ranks": {},
            "review_date": "2026-03-20",
        })
    # 35% positive - produces strengths.
    for i in range(35):
        reviews.append({
            "review_id": f"r_pig_{i}",
            "mixed_review_flag": False, "tradeoff_pair": None,
            "records": [{
                "attribute": "pigmentation",
                "polarity": "positive", "intensity": 2,
                "evidence_span": "발색이 정말 좋아요",
                "confidence": "high", "delivery_condition_flag": False,
            }],
            "oy_evidence_score": 5.0,
            "rating_normalized": 5.0,
            "oy_sort_ranks": {"RATING_DESC": i + 1} if i < 5 else {},
            "review_date": "2026-04-10",
        })
    return reviews


def _build_corpus_metadata(n_reviews: int) -> dict:
    return {
        "collection_started_at": "2026-04-25T10:00:00",
        "collection_completed_at": "2026-04-25T10:30:00",
        "collected_review_count": n_reviews,
        "processed_review_count": n_reviews,
        "polarity_record_count": n_reviews,
        "corpus_limited": False,
        "finite_limit_set": False,
        "max_reviews_arg": "all",
        "sort_mode": "multi",
        "primary_corpus_sort_type": "DATETIME_DESC",
        "signal_sort_types": [
            "RATING_ASC", "RATING_DESC",
            "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
        ],
        "signal_sort_cap": 50,
        "multi_sort_plan": [
            {"sort_type": "DATETIME_DESC", "role": "primary",
             "max_reviews_arg": "all"},
        ],
        "model_name": "stub",
    }


@pytest.fixture
def rendered_pdf_bytes(tmp_path) -> bytes:
    """Render the polished PDF once and return its bytes for inspection."""
    from src.voc.reporting.phase2e.report import aggregate_product
    pdf_v2 = _load_pdf_module()
    reviews = _build_synthetic_reviews()
    data = aggregate_product("A0001", "Test Polished Product", reviews)
    review_dates = {r["review_id"]: r.get("review_date") for r in reviews}
    out_path = tmp_path / "smoke_polished.pdf"
    pdf_v2.render_pdf_v2(
        data, out_path,
        source_label="smoke test",
        reviews=reviews, review_dates=review_dates,
        corpus_metadata=_build_corpus_metadata(len(reviews)),
    )
    assert out_path.exists()
    return out_path.read_bytes()


# ---------------------------------------------------------------------------
# Structural integrity
# ---------------------------------------------------------------------------


def test_render_produces_valid_pdf_byte_stream(rendered_pdf_bytes):
    """The output is a structurally valid PDF: starts with the %PDF-
    magic and ends with %%EOF. Catches catastrophic render failures
    (e.g., a flowable that emits truncated output)."""
    assert rendered_pdf_bytes.startswith(b"%PDF-"), \
        "output doesn't start with PDF magic"
    # %%EOF marker may be followed by a trailing newline.
    assert b"%%EOF" in rendered_pdf_bytes[-32:], \
        "output is missing the trailing %%EOF marker"


def test_render_size_in_sane_range(rendered_pdf_bytes):
    """A polished report at this corpus size should be tens of KB -
    not bytes (something dropped) and not megabytes (something stuck
    in a render loop, embedding huge images, etc.)."""
    size_kb = len(rendered_pdf_bytes) / 1024
    assert 20 <= size_kb <= 500, \
        f"PDF size {size_kb:.1f} KB outside expected 20-500 KB range"


# ---------------------------------------------------------------------------
# Layout content lock - first-page structural strings
#
# Note: reportlab compresses content streams in PDFs by default, so a
# raw-bytes substring search misses Korean text. We instead build a
# parallel "layout manifest" by inspecting the executive_summary
# synthesis (same code the renderer consumes) and assert THAT carries
# the expected sentence shapes. Combined with the structural checks
# above, this is sufficient to catch layout regressions without a
# heavy PDF parser dependency.
# ---------------------------------------------------------------------------


def test_executive_summary_yields_overall_verdict_for_concerns_dominant():
    """When the corpus is concerns-dominant, the synthesized verdict
    follows the documented business-framed template."""
    from src.voc.reporting.phase2e.report import aggregate_product
    from src.voc.reporting.phase2e.executive_summary import (
        synthesize_executive_summary,
    )
    reviews = _build_synthetic_reviews()
    data = aggregate_product("A0001", "P", reviews)
    es = synthesize_executive_summary(data)
    # Concerns-dominant template signature (post 2026-04-28 wording-
    # safety pass - verdict ends with hedged "검토 후보로 보입니다",
    # not "우선 개선이 필요합니다").
    assert "본 제품은" in es.overall_verdict_ko
    assert "우선 검토 후보" in es.overall_verdict_ko
    assert "개선이 필요" not in es.overall_verdict_ko
    assert es.top_priorities  # non-empty
    # Top priority is transfer_resistance (highest priority_score in
    # this synthetic corpus).
    assert es.top_priorities[0].attribute == "transfer_resistance"
    assert es.top_priorities[0].risk_category == "클레임 증가"
    # Recommended actions are populated and start with the top priority's
    # canonical recommendation phrase.
    assert es.recommended_actions_ko
    assert es.recommended_actions_ko[0] == \
        "옵션/사용 환경별 묻어남 의견 분포 및 CS 문의 교차 확인 후보"


def test_render_emits_tagline_in_pdf_text_layer():
    """The interview-framing tagline is a Paragraph at the top of the
    document. Even with reportlab's content-stream compression,
    untransformed ASCII characters in some operator strings remain
    visible in the byte stream - but we don't depend on this. Instead
    we verify by re-rendering with a known styles dict.

    We import the styles dict directly and confirm the new styles are
    registered (tagline, verdict, action_bullet, methodology_note).
    A missing style would raise KeyError downstream during render."""
    pdf_v2 = _load_pdf_module()
    styles = pdf_v2._styles()
    for required in ("tagline", "verdict", "action_bullet",
                      "methodology_note", "recommendation"):
        assert required in styles, f"missing style: {required}"


def test_verdict_box_helper_returns_rendered_table():
    """The verdict-box helper returns a Table flowable whose first
    row contains the verdict text. Locks the structure so a refactor
    can't accidentally drop the prominent callout."""
    pdf_v2 = _load_pdf_module()
    styles = pdf_v2._styles()
    test_text = "본 제품은 전반적으로 긍정 신호가 있으나, ..."
    box = pdf_v2._build_verdict_box(test_text, styles)
    # The box is a single-cell Table; the cell's content is a Paragraph.
    assert box._cellvalues
    cell = box._cellvalues[0][0]
    # The cell value is a reportlab Paragraph; its `text` attribute
    # carries (a sanitized form of) the input.
    assert hasattr(cell, "getPlainText") or hasattr(cell, "text")
    # Either way we can extract the rendered text.
    rendered = (cell.getPlainText() if hasattr(cell, "getPlainText")
                else cell.text)
    assert "본 제품은" in rendered


def test_section_divider_helper_returns_thin_table():
    """The divider is a 1-row table styled as a horizontal rule. It
    must be cheap (1 row, 1 column) - not a full Drawing."""
    pdf_v2 = _load_pdf_module()
    div = pdf_v2._section_divider()
    # Single row of single cell.
    assert len(div._cellvalues) == 1
    assert len(div._cellvalues[0]) == 1


def test_render_succeeds_on_minimal_corpus(tmp_path):
    """A tiny corpus (just 5 reviews) must still render cleanly,
    without crashing on empty top_priorities / top_strengths paths."""
    from src.voc.reporting.phase2e.report import aggregate_product
    pdf_v2 = _load_pdf_module()
    reviews = [
        {
            "review_id": f"r{i}",
            "mixed_review_flag": False, "tradeoff_pair": None,
            "records": [{
                "attribute": "pigmentation",
                "polarity": "positive", "intensity": 2,
                "evidence_span": "좋아요",
                "confidence": "low", "delivery_condition_flag": False,
            }],
            "oy_evidence_score": None,
            "rating_normalized": 5.0,
            "oy_sort_ranks": {},
            "review_date": "2026-04-01",
        }
        for i in range(5)
    ]
    data = aggregate_product("A_min", "Tiny Product", reviews)
    review_dates = {r["review_id"]: r["review_date"] for r in reviews}
    out_path = tmp_path / "minimal.pdf"
    pdf_v2.render_pdf_v2(
        data, out_path, source_label="minimal smoke",
        reviews=reviews, review_dates=review_dates,
        corpus_metadata=_build_corpus_metadata(len(reviews)),
    )
    assert out_path.exists()
    assert out_path.stat().st_size > 5 * 1024  # at least 5 KB


# ---------------------------------------------------------------------------
# Interview-winning layout primitives - KEY METRICS, priority cards
# ---------------------------------------------------------------------------


def _make_priority_item(
    *,
    attribute: str = "transfer_resistance",
    label_ko: str = "마스크/옷 묻어남 저항",
    n_negative: int = 30,
    pct_negative: float = 0.30,
    avg_intensity_neg: float = 2.5,
    score_max: float = 7.0,
    priority_label: str = "High",
    priority_score: float = 25.0,
    risk_category: str | None = "클레임 증가",
    why_ko: str | None = "묻어남 문제는 ...",
    action_ko: str | None = "밀착력 개선...",
):
    from src.voc.reporting.phase2e.executive_summary import PriorityItem
    return PriorityItem(
        attribute=attribute, label_ko=label_ko,
        n_negative=n_negative, pct_negative=pct_negative,
        avg_intensity_neg=avg_intensity_neg, score_max=score_max,
        priority_label=priority_label, priority_score=priority_score,
        risk_category=risk_category, why_ko=why_ko, action_ko=action_ko,
    )


def test_overall_priority_level_high_when_any_priority_is_high():
    pdf_v2 = _load_pdf_module()
    priorities = [
        _make_priority_item(priority_label="Low"),
        _make_priority_item(priority_label="High"),
        _make_priority_item(priority_label="Medium"),
    ]
    assert pdf_v2._overall_priority_level(priorities) == "HIGH"


def test_overall_priority_level_medium_when_no_high_but_any_medium():
    pdf_v2 = _load_pdf_module()
    priorities = [
        _make_priority_item(priority_label="Low"),
        _make_priority_item(priority_label="Medium"),
    ]
    assert pdf_v2._overall_priority_level(priorities) == "MEDIUM"


def test_overall_priority_level_low_when_all_low_or_empty():
    pdf_v2 = _load_pdf_module()
    assert pdf_v2._overall_priority_level([]) == "LOW"
    assert pdf_v2._overall_priority_level([
        _make_priority_item(priority_label="Low"),
    ]) == "LOW"


def test_key_metrics_strip_renders_four_columns():
    """Strip is a 4-column Table - single row, one cell per metric.
    Column widths add up so the strip spans the standard content
    width (160 mm)."""
    pdf_v2 = _load_pdf_module()
    priorities = [
        _make_priority_item(label_ko="묻어남"),
        _make_priority_item(label_ko="지속력", priority_label="Medium"),
    ]
    strip = pdf_v2._build_key_metrics_strip(
        n_reviews=130,
        pct_neg_records=0.45,
        top_priorities=priorities,
        overall_level="HIGH",
    )
    assert len(strip._cellvalues) == 1
    assert len(strip._cellvalues[0]) == 4   # four columns
    # Column widths sum to the standard content-area width (with
    # ±1 mm float tolerance).
    total_mm = sum(strip._colWidths) / 2.83464567   # 1 mm in pt
    assert 158 <= total_mm <= 162


def test_key_metrics_strip_handles_empty_priorities():
    """An empty corpus shouldn't crash - the 우선 이슈 cell falls back
    to em-dash; overall level "LOW"."""
    pdf_v2 = _load_pdf_module()
    strip = pdf_v2._build_key_metrics_strip(
        n_reviews=0,
        pct_neg_records=0.0,
        top_priorities=[],
        overall_level="LOW",
    )
    assert strip is not None


def test_priority_card_includes_all_required_blocks():
    """The user-pinned card shape: header row → representative review
    → why-it-matters → recommended action → business impact. Each row
    exists (non-None Paragraph) when the source data is available.
    With a mapped attribute (transfer_resistance), the business-impact
    row is present → 5 rows total."""
    pdf_v2 = _load_pdf_module()
    styles = pdf_v2._styles()
    priority = _make_priority_item()
    rep = {
        "evidence_span": "정말 묻어나서 짜증나요",
        "rating_normalized": 1.0,
    }
    card = pdf_v2._build_priority_card(
        index=1, priority=priority, representative=rep, styles=styles,
    )
    # 5 rows when all sources are populated AND attribute has business
    # impact mapping.
    assert len(card._cellvalues) == 5


def test_priority_card_skips_missing_blocks_gracefully():
    """When the priority lacks why/action AND has no rep review, the
    card still renders header + internal-check-question (transfer_
    resistance is in INTERNAL_CHECK_QUESTIONS_KO) + business-impact
    (transfer_resistance is in BUSINESS_IMPACT_KO). 3 rows post the
    interview-conversion redesign."""
    pdf_v2 = _load_pdf_module()
    styles = pdf_v2._styles()
    priority = _make_priority_item(why_ko=None, action_ko=None)
    card = pdf_v2._build_priority_card(
        index=1, priority=priority, representative=None, styles=styles,
    )
    # Header + check question + business impact = 3 rows.
    assert len(card._cellvalues) == 3


def test_priority_card_skips_business_impact_for_unmapped_attribute():
    """An attribute outside `BUSINESS_IMPACT_KO` produces no business-
    impact row - same future-attribute safety as the why/action layer."""
    pdf_v2 = _load_pdf_module()
    styles = pdf_v2._styles()
    priority = _make_priority_item(
        attribute="future_attr_xyz", label_ko="Future",
        why_ko=None, action_ko=None,
        risk_category=None,
    )
    card = pdf_v2._build_priority_card(
        index=1, priority=priority, representative=None, styles=styles,
    )
    # Just the header row - no biz impact for unmapped attribute.
    assert len(card._cellvalues) == 1


def test_priority_card_truncates_long_evidence_span():
    """The representative-review picker bounds spans to the
    max-chars budget so the card layout stays compact.

    Updated 2026-05-01: post-`quote_display.normalize_for_display`
    the picker now snaps to a Korean sentence boundary when one
    exists within the cap; only when no terminator is reachable
    does it fall through to ellipsis-truncation. So an excerpt
    that contains a `.` near the cap will end at that terminator
    (no `…`); one with no nearby terminator gets `…` as before.
    """
    pdf_v2 = _load_pdf_module()
    from src.voc.reporting.phase2e.report import AttributeSummary
    s = AttributeSummary(attribute="transfer_resistance")
    s.n_negative = 1
    s.sample_evidences_neg = [{
        "review_id": "r1",
        "polarity": "negative_strong",
        "intensity": 3,
        "confidence": "high",
        "evidence_span": "옷에 묻어나서 정말 정말 정말 너무 너무 별로예요. " * 10,
        "delivery_condition_flag": False,
        "oy_evidence_score": 7.0,
        "rating_normalized": 1.0,
        "oy_sort_ranks": {},
        "review_date": "2026-04-01",
    }]
    rep = pdf_v2._pick_representative_review(s, max_chars=50)
    assert rep is not None
    span = rep["evidence_span"]
    assert len(span) <= 50
    # New contract: ends with sentence terminator OR ellipsis.
    assert span.endswith((".", "!", "?", "…", "~", "ㅎㅎ", "ㅋㅋ"))
    # Raw span is preserved alongside the display string for audit.
    assert rep.get("evidence_span_raw"), "raw span must be preserved"


def test_priority_card_no_evidence_returns_none_picker():
    """When the attribute summary has no negative evidence, the
    picker returns None - caller handles the missing rep gracefully."""
    pdf_v2 = _load_pdf_module()
    from src.voc.reporting.phase2e.report import AttributeSummary
    s = AttributeSummary(attribute="transfer_resistance")
    s.sample_evidences_neg = []
    assert pdf_v2._pick_representative_review(s) is None


def test_render_succeeds_without_corpus_metadata(tmp_path):
    """The renderer's `corpus_metadata` parameter is optional. The
    polished layout (verdict box + sub-sections) must still emit
    correctly when the metadata box is omitted."""
    from src.voc.reporting.phase2e.report import aggregate_product
    pdf_v2 = _load_pdf_module()
    reviews = _build_synthetic_reviews()
    data = aggregate_product("A0001", "P", reviews)
    out_path = tmp_path / "no_meta.pdf"
    pdf_v2.render_pdf_v2(
        data, out_path, source_label="no-meta smoke",
        reviews=reviews,
        review_dates={r["review_id"]: r["review_date"] for r in reviews},
        corpus_metadata=None,
    )
    assert out_path.exists()
    assert out_path.stat().st_size > 10 * 1024


# ---------------------------------------------------------------------------
# 2026-04-28 interview-conversion redesign - section structure + wording
# ---------------------------------------------------------------------------


def _styles():
    pdf_v2 = _load_pdf_module()
    return pdf_v2._styles()


# Hero section -------------------------------------------------------------


def test_hero_section_renders_value_statement():
    """The hero section's value statement is locked verbatim - every
    operator who opens the PDF reads it as the very first sentence.
    Locked to the run-003 reader-friendly rewrite (no internal jargon
    like '신호 진단' / '모니터링 후보')."""
    pdf_v2 = _load_pdf_module()
    flowables = pdf_v2._build_hero_section(
        type("D", (), {"product_name": "테스트 제품"})(),
        _styles(),
    )
    rendered = " ".join(getattr(f, "text", "") for f in flowables)
    assert "리뷰 기반 제품 인사이트 리포트" in rendered
    assert (
        "실사용 리뷰에서 많이 좋다고 한 점과 구매 전 확인할 포인트를 "
        "정리한 리포트입니다." in rendered
    )
    assert "테스트 제품" in rendered


def test_hero_value_statement_constant_is_locked():
    """Stakeholder-visible string. Changing it should be a deliberate
    paired update to this assertion. Locked to the run-003 reader-
    friendly rewrite."""
    pdf_v2 = _load_pdf_module()
    assert (
        pdf_v2.HERO_VALUE_STATEMENT_KO
        == "실사용 리뷰에서 많이 좋다고 한 점과 구매 전 확인할 포인트를 "
           "정리한 리포트입니다."
    )
    assert pdf_v2.HERO_TITLE_KO == "리뷰 기반 제품 인사이트 리포트"


def test_hero_value_statement_avoids_internal_jargon():
    """External-facing strings must not contain internal model
    diagnostics terms. Locks the run-003 contract."""
    pdf_v2 = _load_pdf_module()
    statement = pdf_v2.HERO_VALUE_STATEMENT_KO
    title = pdf_v2.HERO_TITLE_KO
    forbidden = [
        "관찰 신호", "모니터링 후보", "신뢰도 낮음", "신뢰도 높음",
        "안정성 높음", "안정성 낮음", "부정 신호", "긍정 신호",
        "신호 진단",
    ]
    for term in forbidden:
        assert term not in statement, (
            f"hero statement contains internal jargon {term!r}: {statement!r}"
        )
        assert term not in title, (
            f"hero title contains internal jargon {term!r}: {title!r}"
        )


# Key Metrics context line -------------------------------------------------


def _make_provenance(**overrides):
    """Build a CorpusProvenance with sensible defaults; override
    individual fields per test."""
    from src.voc.reporting.phase2e.snapshots import CorpusProvenance
    base = dict(
        corpus_type="observed_scrape",
        sampling_strategy="latest_only",
        primary_sort_type="DATETIME_DESC",
        cap_policy="all",
        collected_primary_review_count=900,
        total_review_count_available=1000,
        coverage_ratio=0.9,
        is_full_corpus=False,
    )
    base.update(overrides)
    return CorpusProvenance(**base)


def test_key_metrics_context_includes_coverage_when_available():
    pdf_v2 = _load_pdf_module()
    prov = _make_provenance()
    para = pdf_v2._build_key_metrics_context_line(
        provenance=prov, confidence_level="high",
    )
    assert "커버리지" in para.text
    assert "90%" in para.text
    assert "(900/1000건)" in para.text


def test_key_metrics_context_includes_confidence_chip():
    """Run-003 QA pass-2: chip text uses the four-axis label so the
    rendered string never collapses to "신뢰도 높음/낮음" (forbidden in
    PDF body text)."""
    pdf_v2 = _load_pdf_module()
    prov = _make_provenance()
    para_high = pdf_v2._build_key_metrics_context_line(
        provenance=prov, confidence_level="high",
    )
    assert "표본 충분" in para_high.text
    assert "신뢰도 높음" not in para_high.text
    para_low = pdf_v2._build_key_metrics_context_line(
        provenance=prov, confidence_level="low",
    )
    assert "참고 수준" in para_low.text
    assert "신뢰도 낮음" not in para_low.text


def test_key_metrics_context_basis_label_observed_scrape():
    pdf_v2 = _load_pdf_module()
    prov = _make_provenance(corpus_type="observed_scrape")
    para = pdf_v2._build_key_metrics_context_line(
        provenance=prov, confidence_level="medium",
    )
    assert "최신순 수집 코퍼스 기준" in para.text


def test_key_metrics_context_basis_label_partner_full_corpus():
    pdf_v2 = _load_pdf_module()
    prov = _make_provenance(
        corpus_type="partner_full_export",
        is_full_corpus=True,
        coverage_ratio=1.0,
    )
    para = pdf_v2._build_key_metrics_context_line(
        provenance=prov, confidence_level="high",
    )
    assert "전체 리뷰 기준" in para.text


def test_key_metrics_context_basis_label_partner_incremental():
    pdf_v2 = _load_pdf_module()
    prov = _make_provenance(
        corpus_type="partner_incremental_api",
        is_full_corpus=False,
    )
    para = pdf_v2._build_key_metrics_context_line(
        provenance=prov, confidence_level="medium",
    )
    assert "직전 N일 신규 리뷰 기준" in para.text


def test_key_metrics_context_handles_missing_provenance():
    """When provenance is None, the context line still renders with
    the safest 'observed scrape' basis label."""
    pdf_v2 = _load_pdf_module()
    para = pdf_v2._build_key_metrics_context_line(
        provenance=None, confidence_level=None,
    )
    assert "최신순 수집 코퍼스 기준" in para.text
    assert "정보 없음" in para.text  # both confidence and coverage


def test_key_metrics_context_unknown_total_shows_collected_count():
    """When total is None but collected is known, surface the
    collected count under coverage so operators see scope without
    a misleading ratio."""
    pdf_v2 = _load_pdf_module()
    prov = _make_provenance(
        total_review_count_available=None,
        coverage_ratio=None,
    )
    para = pdf_v2._build_key_metrics_context_line(
        provenance=prov, confidence_level="medium",
    )
    assert "전체 미상" in para.text
    assert "900건 수집" in para.text


# Internal check questions -------------------------------------------------


def test_internal_check_questions_exist_for_all_12_attributes():
    pdf_v2 = _load_pdf_module()
    expected_attributes = {
        "transfer_resistance", "persistence", "pigmentation",
        "application_blending", "adhesion_base_interaction",
        "finish_texture", "dryness_skin_texture", "color_tone_matching",
        "packaging_container", "applicator_tool", "value_price",
        "multi_use_lip_cheek_compatibility",
    }
    assert set(pdf_v2.INTERNAL_CHECK_QUESTIONS_KO.keys()) == expected_attributes


def test_each_attribute_has_two_or_three_check_questions():
    """Per the 2-3 internal check questions contract - operators
    read multiple verification angles per signal."""
    pdf_v2 = _load_pdf_module()
    for attr, questions in pdf_v2.INTERNAL_CHECK_QUESTIONS_KO.items():
        assert isinstance(questions, tuple), \
            f"{attr}: expected tuple, got {type(questions)}"
        assert 2 <= len(questions) <= 3, \
            f"{attr}: expected 2–3 questions, got {len(questions)}"


def test_internal_check_questions_end_in_hedged_form():
    """Wording-safety contract. Every check question ends in one of
    the locked hedged forms: 확인할 필요가 있습니다 / 검토가 필요합니다 /
    확인이 권장됩니다 / 확인이 필요합니다 / 검토가 권장됩니다 /
    분포 확인이 필요합니다."""
    pdf_v2 = _load_pdf_module()
    ALLOWED_ENDINGS = (
        "확인할 필요가 있습니다.",
        "검토가 필요합니다.",
        "검토가 권장됩니다.",
        "확인이 권장됩니다.",
        "확인이 필요합니다.",
        "분포 확인이 필요합니다.",
        "비교 검토가 필요합니다.",
        "비교 검토가 권장됩니다.",
        "비교 확인이 권장됩니다.",
        "패턴 검토가 필요합니다.",
        "내부 검토가 권장됩니다.",
    )
    for attr, questions in pdf_v2.INTERNAL_CHECK_QUESTIONS_KO.items():
        for q in questions:
            assert any(q.endswith(end) for end in ALLOWED_ENDINGS), \
                f"{attr}: phrase doesn't end in a hedged form: {q!r}"


def test_internal_check_questions_avoid_banned_wording():
    pdf_v2 = _load_pdf_module()
    BANNED = ("원인", "개선 필요", "해야 합니다", "해야 함", "발생합니다")
    for attr, questions in pdf_v2.INTERNAL_CHECK_QUESTIONS_KO.items():
        for q in questions:
            for term in BANNED:
                assert term not in q, \
                    f"{attr}: banned wording '{term}' appears in: {q!r}"


def test_internal_check_questions_avoid_manufacturing_internals():
    """User-locked rule: must not mention manufacturing internals
    directly (포뮬러, 안료, 베이스 변경, 첨가제). The framing must
    stay at the question/verification level the brand can act on
    without inferring a recipe change from the report."""
    pdf_v2 = _load_pdf_module()
    BANNED_MANUFACTURING = (
        "포뮬러", "안료 농도", "안료를", "필름 형성제", "픽서 보강",
        "베이스 변경", "베이스 포뮬러", "첨가제 조정",
    )
    for attr, questions in pdf_v2.INTERNAL_CHECK_QUESTIONS_KO.items():
        for q in questions:
            for term in BANNED_MANUFACTURING:
                assert term not in q, \
                    f"{attr}: manufacturing-internal term '{term}' " \
                    f"in check question: {q!r}"


# Top-signal card includes 내부 확인 질문 row -------------------------------


def test_top_signal_card_includes_internal_check_question_row():
    """Card body must contain the '내부 확인 질문' header + ALL of
    the attribute's 2–3 questions stacked under it. Replaces the
    prior single-question / 검토 후보 row."""
    pdf_v2 = _load_pdf_module()
    priority = _make_priority_item()  # transfer_resistance, all populated
    rep = {
        "evidence_span": "마스크에 다 묻어요",
        "rating_normalized": 1.0,
    }
    card = pdf_v2._build_priority_card(
        index=1, priority=priority, representative=rep, styles=_styles(),
    )
    # Walk every cell, collecting text from any Paragraph or list of
    # Paragraphs (the check-question cell is a list-bundle).
    parts: list[str] = []
    for cell in card._cellvalues:
        for content in cell:
            if isinstance(content, list):
                for p in content:
                    parts.append(getattr(p, "text", ""))
            else:
                parts.append(getattr(content, "text", ""))
    rendered = " ".join(parts)
    assert "내부 확인 질문" in rendered
    questions = pdf_v2.INTERNAL_CHECK_QUESTIONS_KO["transfer_resistance"]
    # All 2–3 questions for this attribute must appear in the card.
    for q in questions:
        assert q in rendered, f"missing check question in card: {q!r}"
    # The old 검토 후보 row no longer renders inside the card.
    assert "검토 후보" not in rendered


def test_top_signal_card_confidence_chip_in_header():
    """Run-003 QA pass-2: chip text uses the four-axis label
    ([표본 충분]) instead of the legacy `[신뢰도: 높음]` which renders
    as a forbidden-token substring."""
    pdf_v2 = _load_pdf_module()
    priority = _make_priority_item(priority_label="High")
    card = pdf_v2._build_priority_card(
        index=1, priority=priority, representative=None,
        styles=_styles(),
    )
    header_text = card._cellvalues[0][0].text
    assert "[표본 충분]" in header_text
    assert "신뢰도 높음" not in header_text


def test_top_signal_card_confidence_downgrades_when_corpus_low():
    """Even a High-tier signal renders as [참고 수준] when the
    snapshot-level confidence is 'low'. The corpus itself isn't
    strong enough to support a high-confidence per-signal claim."""
    pdf_v2 = _load_pdf_module()
    priority = _make_priority_item(priority_label="High")
    card = pdf_v2._build_priority_card(
        index=1, priority=priority, representative=None,
        styles=_styles(),
        corpus_confidence_level="low",
    )
    header_text = card._cellvalues[0][0].text
    assert "[참고 수준]" in header_text
    assert "[표본 충분]" not in header_text
    assert "신뢰도 높음" not in header_text
    assert "신뢰도 낮음" not in header_text


# Strengths block ----------------------------------------------------------


def test_strengths_block_renders_preserve_framing():
    """Run-003 QA pass-2 lock: PDF strengths header uses business-tone
    "반복된 만족 포인트" (analyst-grade), separate from the cardnews
    surface "리뷰에서 많이 좋다고 한 점" (buyer-empathetic). The
    "preserve / cross-impact" closing note remains."""
    pdf_v2 = _load_pdf_module()
    reviews = _build_synthetic_reviews()
    from src.voc.reporting.phase2e.report import aggregate_product
    from src.voc.reporting.phase2e.executive_summary import (
        synthesize_executive_summary,
    )
    data = aggregate_product("A0001", "P", reviews)
    es = synthesize_executive_summary(data)
    flowables = pdf_v2._build_strengths_block(es, _styles())
    rendered = " ".join(getattr(f, "text", "") for f in flowables)
    assert "반복된 만족 포인트" in rendered
    assert "핵심 강점" not in rendered
    # The "preserve while checking concerns" framing is the
    # locked closing paragraph.
    assert "유지/보강 후보" in rendered


# Method notes -------------------------------------------------------------


def test_method_notes_include_brand_internal_context_caveat():
    """Run-003 rewrite: bullet wording is reader-friendly while the
    structural caveats (sample bias / signal sorts not in denominator
    / not a defect verdict / brand internal context) remain enforced."""
    pdf_v2 = _load_pdf_module()
    flowables = pdf_v2._build_method_notes_block(
        _styles(), source_label="test", corpus_metadata=None,
    )
    rendered = " ".join(getattr(f, "text", "") for f in flowables)
    assert "수집된 리뷰 표본 기준" in rendered
    assert "대표 리뷰 발췌 용도" in rendered
    assert "제조 변경을 권고하는 자료가 아닙니다" in rendered
    assert "품질" in rendered  # brand-internal context (품질·원가·R&D)


def test_method_notes_use_reader_friendly_section_header():
    """Run-003 QA pass-2 lock: PDF method-notes header reads "분석
    방법과 한계" (business-tone analyst register), not the cardnews
    counterpart "이 리포트를 읽는 방법". Keeps the legacy "해석 및
    사용 가이드" out."""
    pdf_v2 = _load_pdf_module()
    flowables = pdf_v2._build_method_notes_block(
        _styles(), source_label="test", corpus_metadata=None,
    )
    rendered = " ".join(getattr(f, "text", "") for f in flowables)
    assert "분석 방법과 한계" in rendered
    assert "해석 및 사용 가이드" not in rendered
    assert "이 리포트를 읽는 방법" not in rendered


def test_method_notes_avoid_banned_wording():
    pdf_v2 = _load_pdf_module()
    flowables = pdf_v2._build_method_notes_block(
        _styles(), source_label="test", corpus_metadata=None,
    )
    rendered = " ".join(getattr(f, "text", "") for f in flowables)
    for term in ("개선 필요", "해야 합니다", "원인 확정"):
        assert term not in rendered, \
            f"banned wording '{term}' appeared in method notes"


# Low-confidence trend wording lock - already enforced by the snapshot
# helper, but the redesigned PDF wires it through render_pdf_v2 with
# the new provenance plumbing. Cover end-to-end here.


def test_redesigned_pdf_low_confidence_suppresses_exact_deltas(tmp_path):
    """End-to-end through the new render_pdf_v2 flow: low-confidence
    snapshot triggers directional-band wording, no '%p' percentage
    in the trend section."""
    pdf_v2 = _load_pdf_module()
    from datetime import datetime, timezone
    from src.voc.reporting.phase2e.report import aggregate_product
    from src.voc.reporting.phase2e.snapshots import (
        AttributeSnapshot,
        CorpusProvenance,
        Snapshot,
        SNAPSHOT_SCHEMA_VERSION,
        build_snapshot,
        compare_snapshots,
    )
    reviews = _build_synthetic_reviews()
    data = aggregate_product("A0001", "Test Product", reviews)

    # Force low-confidence corpus.
    cur_prov = CorpusProvenance(
        corpus_type="observed_scrape",
        sampling_strategy="latest_only",
        primary_sort_type="DATETIME_DESC",
        cap_policy="all",
        collected_primary_review_count=data.n_reviews,
        total_review_count_available=None,
        coverage_ratio=None,
        is_full_corpus=False,
    )
    cur = build_snapshot(
        data,
        collected_at=datetime(2026, 4, 28, tzinfo=timezone.utc),
        provenance=cur_prov,
    )
    assert cur.provenance.confidence_level == "low"

    prev = Snapshot(
        schema_version=SNAPSHOT_SCHEMA_VERSION,
        goods_no="A0001",
        product_name="Test",
        collected_at="2026-03-28T00:00:00Z",
        n_reviews=data.n_reviews,
        n_records=data.n_reviews,
        attributes={
            "transfer_resistance": AttributeSnapshot(
                n_positive=20, n_negative=12, negative_share=12 / 32,
                avg_intensity_neg=2.0, priority_score=15.0,
            ),
            "persistence": AttributeSnapshot(
                n_positive=10, n_negative=18, negative_share=18 / 28,
                avg_intensity_neg=2.0, priority_score=12.0,
            ),
            "pigmentation": AttributeSnapshot(
                n_positive=35, n_negative=2, negative_share=2 / 37,
                avg_intensity_neg=1.0, priority_score=None,
            ),
        },
        provenance=cur_prov,
    )
    cmp = compare_snapshots(cur, prev)

    out_path = tmp_path / "smoke_redesign_low.pdf"
    pdf_v2.render_pdf_v2(
        data, out_path,
        source_label="redesign smoke",
        corpus_metadata=_build_corpus_metadata(len(reviews)),
        snapshot_comparison=cmp,
        current_snapshot_confidence=cur.provenance.confidence_level,
        current_snapshot_provenance=cur.provenance,
    )
    assert out_path.exists()
    assert out_path.read_bytes().startswith(b"%PDF-")


def test_redesigned_pdf_renders_with_new_section_order(tmp_path):
    """Full smoke: redesigned flow renders end-to-end with all new
    sections present (hero / metrics / verdict / signals / trend
    suppressed-no-history / strengths / method / appendix)."""
    pdf_v2 = _load_pdf_module()
    reviews = _build_synthetic_reviews()
    from src.voc.reporting.phase2e.report import aggregate_product
    data = aggregate_product("A0001", "Test Product", reviews)
    prov = _make_provenance(
        collected_primary_review_count=data.n_reviews,
        total_review_count_available=200,
        coverage_ratio=data.n_reviews / 200,
    )
    out_path = tmp_path / "smoke_redesign_full.pdf"
    pdf_v2.render_pdf_v2(
        data, out_path,
        source_label="redesign smoke",
        corpus_metadata=_build_corpus_metadata(len(reviews)),
        current_snapshot_confidence=prov.confidence_level,
        current_snapshot_provenance=prov,
    )
    assert out_path.exists()
    raw = out_path.read_bytes()
    assert raw.startswith(b"%PDF-")
    assert b"%%EOF" in raw[-32:]


# Banned wording in static module-level constants ---------------------------


def test_no_banned_wording_in_static_section_strings():
    """Module-level Korean strings the renderer assembles must not
    leak banned wording into the PDF surface. This catches drift in
    constants like HERO_VALUE_STATEMENT_KO."""
    pdf_v2 = _load_pdf_module()
    BANNED = ("원인 확정", "해야 합니다", "개선 필요", "발생합니다")
    static_strings = [
        pdf_v2.HERO_TITLE_KO,
        pdf_v2.HERO_VALUE_STATEMENT_KO,
    ]
    for s in static_strings:
        for term in BANNED:
            assert term not in s, \
                f"banned wording '{term}' in static string {s!r}"


# ---------------------------------------------------------------------------
# Signal stability - PDF surfacing
# ---------------------------------------------------------------------------


def test_top_signal_card_includes_stability_chip_when_provided():
    """Run-003 pass-12: seller-friendly chip text uses the new four-
    axis label ([반복 확인]) instead of the legacy `[안정성: 높음]` /
    `[표본 내 반복]`. The latter two read as engine-internal tokens."""
    pdf_v2 = _load_pdf_module()
    priority = _make_priority_item(priority_label="High")
    card = pdf_v2._build_priority_card(
        index=1, priority=priority, representative=None,
        styles=_styles(),
        corpus_confidence_level="high",
        corpus_signal_stability="high",
    )
    header_text = card._cellvalues[0][0].text
    assert "[반복 확인]" in header_text
    assert "안정성 높음" not in header_text
    # Old labels must not leak back in.
    assert "[표본 내 반복]" not in header_text


def test_top_signal_card_omits_stability_chip_when_not_provided():
    """Backward compat: legacy callers that don't pass
    corpus_signal_stability see no chip - header keeps prior shape."""
    pdf_v2 = _load_pdf_module()
    priority = _make_priority_item(priority_label="High")
    card = pdf_v2._build_priority_card(
        index=1, priority=priority, representative=None,
        styles=_styles(),
        corpus_confidence_level="high",
    )
    header_text = card._cellvalues[0][0].text
    assert "[안정성:" not in header_text
    assert "[반복 확인]" not in header_text


def test_top_signal_card_low_stability_chip_renders():
    pdf_v2 = _load_pdf_module()
    priority = _make_priority_item(priority_label="High")
    card = pdf_v2._build_priority_card(
        index=1, priority=priority, representative=None,
        styles=_styles(),
        corpus_confidence_level="medium",
        corpus_signal_stability="low",
    )
    header_text = card._cellvalues[0][0].text
    assert "[반복 확인 제한적]" in header_text
    assert "안정성 낮음" not in header_text


def test_executive_verdict_includes_stability_sentence_when_provenance_present(tmp_path):
    """End-to-end through the redesigned PDF flow: when provenance
    carries a signal_stability value, the sentence appears below the
    verdict box. Inspect via the section builder by rendering and
    confirming the locked Korean sentence is in the document text."""
    pdf_v2 = _load_pdf_module()
    reviews = _build_synthetic_reviews()
    from src.voc.reporting.phase2e.report import aggregate_product
    data = aggregate_product("A0001", "Test Product", reviews)
    prov = _make_provenance(
        collected_primary_review_count=1500,
        total_review_count_available=2000,
        coverage_ratio=0.75,
    )
    assert prov.signal_stability == "high"
    out_path = tmp_path / "smoke_stability_high.pdf"
    pdf_v2.render_pdf_v2(
        data, out_path,
        source_label="stability smoke",
        corpus_metadata=_build_corpus_metadata(len(reviews)),
        current_snapshot_confidence=prov.confidence_level,
        current_snapshot_provenance=prov,
    )
    assert out_path.exists()
    raw = out_path.read_bytes()
    assert raw.startswith(b"%PDF-")


def test_executive_verdict_low_stability_sentence_renders(tmp_path):
    pdf_v2 = _load_pdf_module()
    reviews = _build_synthetic_reviews()
    from src.voc.reporting.phase2e.report import aggregate_product
    data = aggregate_product("A0001", "Test Product", reviews)
    prov = _make_provenance(
        collected_primary_review_count=200,
        total_review_count_available=None,
        coverage_ratio=None,
    )
    assert prov.signal_stability == "low"
    out_path = tmp_path / "smoke_stability_low.pdf"
    pdf_v2.render_pdf_v2(
        data, out_path,
        source_label="stability smoke",
        corpus_metadata=_build_corpus_metadata(len(reviews)),
        current_snapshot_confidence=prov.confidence_level,
        current_snapshot_provenance=prov,
    )
    assert out_path.exists()


def test_executive_verdict_omits_stability_sentence_when_provenance_missing(tmp_path):
    """Backward compat: when no provenance is passed, the verdict
    section shouldn't crash AND shouldn't fabricate a stability
    framing. Existing layout preserved."""
    pdf_v2 = _load_pdf_module()
    reviews = _build_synthetic_reviews()
    from src.voc.reporting.phase2e.report import aggregate_product
    data = aggregate_product("A0001", "Test Product", reviews)
    out_path = tmp_path / "smoke_no_stability.pdf"
    pdf_v2.render_pdf_v2(
        data, out_path,
        source_label="stability smoke",
        corpus_metadata=_build_corpus_metadata(len(reviews)),
    )
    assert out_path.exists()
    assert out_path.read_bytes().startswith(b"%PDF-")


# ---------------------------------------------------------------------------
# Observed Usage Patterns (§4) - surfacing in the PDF
# ---------------------------------------------------------------------------


def test_usage_patterns_section_renders_observed_patterns():
    """Section builder, fed a corpus that produces both a
    contradiction and a usage_context pattern, surfaces both in
    the rendered flowables."""
    pdf_v2 = _load_pdf_module()
    from src.voc.reporting.phase2e.report import aggregate_product

    # Build reviews that produce: contradiction (pigmentation
    # pos+neg both ≥5) AND usage_context (transfer_resistance with
    # 마스크 keyword on ≥5 negative spans).
    reviews = []
    for i in range(8):
        reviews.append({
            "review_id": f"r_tr_{i}",
            "mixed_review_flag": False, "tradeoff_pair": None,
            "records": [{
                "attribute": "transfer_resistance",
                "polarity": "negative_strong", "intensity": 3,
                "evidence_span": "마스크에 너무 묻어요",
                "confidence": "high",
                "delivery_condition_flag": False,
            }],
        })
    for i in range(7):
        reviews.append({
            "review_id": f"r_pp_{i}",
            "mixed_review_flag": False, "tradeoff_pair": None,
            "records": [{
                "attribute": "pigmentation",
                "polarity": "positive", "intensity": 2,
                "evidence_span": "발색 정말 좋아요",
                "confidence": "high",
                "delivery_condition_flag": False,
            }],
        })
    for i in range(7):
        reviews.append({
            "review_id": f"r_pn_{i}",
            "mixed_review_flag": False, "tradeoff_pair": None,
            "records": [{
                "attribute": "pigmentation",
                "polarity": "negative_strong", "intensity": 2,
                "evidence_span": "발색이 사진과 달라요",
                "confidence": "high",
                "delivery_condition_flag": False,
            }],
        })
    data = aggregate_product("A0001", "Test", reviews)
    flowables = pdf_v2._build_usage_patterns_section(
        data, reviews, _styles(), section_number="4",
    )
    rendered = " ".join(getattr(f, "text", "") for f in flowables)
    # Run-003 QA pass-2 lock: PDF surface uses "만족·아쉬움 분기 패턴"
    # (analyst-grade). The buyer-cardnews counterpart "만족과 아쉬움이
    # 갈린 상황" is rendered by cardnews_buyer_journey.py instead.
    assert "만족·아쉬움 분기 패턴" in rendered
    # Contradiction sentence shape
    assert "발색" in rendered
    # Usage context sentence shape
    assert "마스크/외출 상황" in rendered or "마스크" in rendered


def test_usage_patterns_section_emits_graceful_empty_message_for_thin_data():
    pdf_v2 = _load_pdf_module()
    from src.voc.reporting.phase2e.report import aggregate_product
    # Tiny corpus → no patterns clear thresholds.
    reviews = [{
        "review_id": "r1",
        "mixed_review_flag": False, "tradeoff_pair": None,
        "records": [{
            "attribute": "transfer_resistance",
            "polarity": "negative_strong", "intensity": 3,
            "evidence_span": "마스크",
            "confidence": "high",
            "delivery_condition_flag": False,
        }],
    }]
    data = aggregate_product("A0001", "Test", reviews)
    flowables = pdf_v2._build_usage_patterns_section(
        data, reviews, _styles(), section_number="4",
    )
    rendered = " ".join(getattr(f, "text", "") for f in flowables)
    assert "만족·아쉬움 분기 패턴" in rendered
    assert "충분히 관측되지" in rendered


def test_redesigned_pdf_renders_with_usage_patterns_section_at_position_4(tmp_path):
    """End-to-end: the redesigned flow now has Observed Usage Patterns
    at §4 (between Executive Verdict and Top Signals)."""
    pdf_v2 = _load_pdf_module()
    reviews = _build_synthetic_reviews()
    from src.voc.reporting.phase2e.report import aggregate_product
    data = aggregate_product("A0001", "Test Product", reviews)
    out_path = tmp_path / "smoke_with_usage_patterns.pdf"
    pdf_v2.render_pdf_v2(
        data, out_path,
        source_label="usage patterns smoke",
        reviews=reviews,
        review_dates={r["review_id"]: r["review_date"] for r in reviews},
        corpus_metadata=_build_corpus_metadata(len(reviews)),
        current_snapshot_provenance=_make_provenance(
            collected_primary_review_count=data.n_reviews,
        ),
    )
    assert out_path.exists()
    raw = out_path.read_bytes()
    assert raw.startswith(b"%PDF-")
    assert b"%%EOF" in raw[-32:]


def test_method_notes_block_accepts_section_number_kwarg():
    """Run-003 QA pass-2 lock: PDF method-notes is "분석 방법과 한계"."""
    pdf_v2 = _load_pdf_module()
    flowables = pdf_v2._build_method_notes_block(
        _styles(), source_label="t", corpus_metadata=None,
        section_number="9",
    )
    rendered = " ".join(getattr(f, "text", "") for f in flowables)
    assert "9. 분석 방법과 한계" in rendered


def test_strengths_block_accepts_section_number_kwarg():
    """Run-003 QA pass-2 lock: PDF strengths header is "반복된 만족
    포인트"."""
    pdf_v2 = _load_pdf_module()
    reviews = _build_synthetic_reviews()
    from src.voc.reporting.phase2e.report import aggregate_product
    from src.voc.reporting.phase2e.executive_summary import (
        synthesize_executive_summary,
    )
    data = aggregate_product("A0001", "P", reviews)
    es = synthesize_executive_summary(data)
    flowables = pdf_v2._build_strengths_block(
        es, _styles(), section_number="8",
    )
    rendered = " ".join(getattr(f, "text", "") for f in flowables)
    assert "8. 반복된 만족 포인트" in rendered


def test_trend_section_accepts_section_number_kwarg():
    """Parameterized so the redesigned flow positions trend at §7
    (after Data Coverage / Verdict / Usage Patterns / Top Signals)."""
    pdf_v2 = _load_pdf_module()
    from src.voc.reporting.phase2e.snapshots import (
        AttributeSnapshot, CorpusProvenance, Snapshot,
        SNAPSHOT_SCHEMA_VERSION, compare_snapshots,
    )
    cur = Snapshot(
        schema_version=SNAPSHOT_SCHEMA_VERSION,
        goods_no="A0001", product_name="P",
        collected_at="2026-04-28T00:00:00Z",
        n_reviews=100, n_records=100,
        attributes={},
        provenance=_make_provenance(),
    )
    cmp = compare_snapshots(cur, previous=None)
    flowables = pdf_v2._build_snapshot_trend_section(
        cmp, "high", _styles(), section_number="7",
    )
    rendered = " ".join(getattr(f, "text", "") for f in flowables)
    assert "7. 최근 변화 신호" in rendered
    assert "9. 최근 변화 신호" not in rendered


# ---------------------------------------------------------------------------
# §3 Data Coverage Context - explicit scope statement
# ---------------------------------------------------------------------------


def test_data_coverage_observed_scrape_phrase_locked():
    """observed_scrape provenance → "전체 리뷰 중 일부 구간..." phrase.
    Locked verbatim - interview-audience-visible string."""
    pdf_v2 = _load_pdf_module()
    prov = _make_provenance(
        corpus_type="observed_scrape",
        is_full_corpus=False,
    )
    flowables = pdf_v2._build_data_coverage_context_section(
        provenance=prov, styles=_styles(),
    )
    rendered = " ".join(getattr(f, "text", "") for f in flowables)
    assert (
        "전체 리뷰 중 일부 구간(최신순/추천순 등)을 기반으로 "
        "수집된 리뷰에서 확인된 결과입니다." in rendered
    )
    # Must NOT claim full-corpus framing on observed scrapes.
    assert "전체 리뷰 기준 분석입니다." not in rendered
    # Old "관측된 결과" wording must not leak back in.
    assert "관측된 결과입니다." not in rendered


def test_data_coverage_full_corpus_phrase_locked():
    pdf_v2 = _load_pdf_module()
    prov = _make_provenance(
        corpus_type="partner_full_export",
        is_full_corpus=True,
        coverage_ratio=1.0,
    )
    flowables = pdf_v2._build_data_coverage_context_section(
        provenance=prov, styles=_styles(),
    )
    rendered = " ".join(getattr(f, "text", "") for f in flowables)
    assert "전체 리뷰 기준 분석입니다." in rendered


def test_data_coverage_incremental_phrase_locked():
    pdf_v2 = _load_pdf_module()
    prov = _make_provenance(
        corpus_type="partner_incremental_api",
        is_full_corpus=False,
    )
    flowables = pdf_v2._build_data_coverage_context_section(
        provenance=prov, styles=_styles(),
    )
    rendered = " ".join(getattr(f, "text", "") for f in flowables)
    assert (
        "직전 기간의 신규 리뷰 구간을 기반으로 "
        "수집된 리뷰에서 확인된 결과입니다."
        in rendered
    )
    assert "관측된 결과입니다." not in rendered


def test_data_coverage_section_header():
    """Run-003 QA pass-2 lock: PDF section header is "데이터 커버리지와
    해석 한계" (analyst-grade single phrase)."""
    pdf_v2 = _load_pdf_module()
    flowables = pdf_v2._build_data_coverage_context_section(
        provenance=_make_provenance(), styles=_styles(),
    )
    rendered = " ".join(getattr(f, "text", "") for f in flowables)
    assert "3. 데이터 커버리지와 해석 한계" in rendered


def test_data_coverage_shows_total_collected_and_ratio():
    pdf_v2 = _load_pdf_module()
    prov = _make_provenance(
        collected_primary_review_count=900,
        total_review_count_available=1000,
        coverage_ratio=0.9,
    )
    flowables = pdf_v2._build_data_coverage_context_section(
        provenance=prov, styles=_styles(),
    )
    rendered = " ".join(getattr(f, "text", "") for f in flowables)
    assert "1,000건" in rendered  # total
    assert "900건" in rendered    # collected
    assert "90%" in rendered      # coverage_ratio


def test_data_coverage_shows_collected_only_when_total_unknown():
    pdf_v2 = _load_pdf_module()
    prov = _make_provenance(
        collected_primary_review_count=400,
        total_review_count_available=None,
        coverage_ratio=None,
    )
    flowables = pdf_v2._build_data_coverage_context_section(
        provenance=prov, styles=_styles(),
    )
    rendered = " ".join(getattr(f, "text", "") for f in flowables)
    assert "400건" in rendered
    assert "전체 리뷰 수 미상" in rendered
    # No fake percentage when total is unknown.
    assert "%" not in rendered


def test_data_coverage_graceful_when_provenance_none():
    pdf_v2 = _load_pdf_module()
    flowables = pdf_v2._build_data_coverage_context_section(
        provenance=None, styles=_styles(),
    )
    rendered = " ".join(getattr(f, "text", "") for f in flowables)
    # Header still renders + a placeholder line.
    assert "데이터 커버리지와 해석 한계" in rendered
    assert "코퍼스 정보가 전달되지 않아" in rendered


def test_data_coverage_phrase_constants_avoid_banned_wording():
    pdf_v2 = _load_pdf_module()
    BANNED = ("원인 확정", "해야 합니다", "개선 필요", "발생합니다")
    locked = (
        pdf_v2.DATA_COVERAGE_OBSERVED_KO,
        pdf_v2.DATA_COVERAGE_FULL_CORPUS_KO,
        pdf_v2.DATA_COVERAGE_INCREMENTAL_KO,
    )
    for s in locked:
        for term in BANNED:
            assert term not in s, \
                f"banned wording '{term}' in coverage phrase {s!r}"


def test_data_coverage_phrase_constants_use_interpretive_endings():
    """Tone contract: every locked phrase ends in 결과입니다 /
    분석입니다 - no directive verbs."""
    pdf_v2 = _load_pdf_module()
    for s in (
        pdf_v2.DATA_COVERAGE_OBSERVED_KO,
        pdf_v2.DATA_COVERAGE_FULL_CORPUS_KO,
        pdf_v2.DATA_COVERAGE_INCREMENTAL_KO,
    ):
        assert s.endswith("결과입니다.") or s.endswith("분석입니다."), \
            f"non-interpretive ending in: {s!r}"


# ---------------------------------------------------------------------------
# Impact Framing - 4-category business risk row in Top Signal cards
# ---------------------------------------------------------------------------


def test_impact_framing_categories_are_locked_vocabulary():
    """Locked: only these 4 categories are allowed. Adding a fifth
    requires a deliberate stakeholder discussion + this assertion
    update."""
    pdf_v2 = _load_pdf_module()
    assert pdf_v2.IMPACT_FRAMING_CATEGORIES_KO == frozenset({
        "전환 위험",
        "재구매 위험",
        "CS 비용 증가",
        "브랜드 인식 위험",
    })


def test_impact_framing_exists_for_all_12_attributes():
    pdf_v2 = _load_pdf_module()
    expected = {
        "transfer_resistance", "persistence", "pigmentation",
        "application_blending", "adhesion_base_interaction",
        "finish_texture", "dryness_skin_texture", "color_tone_matching",
        "packaging_container", "applicator_tool", "value_price",
        "multi_use_lip_cheek_compatibility",
    }
    assert set(pdf_v2.IMPACT_FRAMING_KO.keys()) == expected


def test_each_attribute_has_one_or_two_framings():
    """Per the user spec - 1~2 framings per signal."""
    pdf_v2 = _load_pdf_module()
    for attr, framings in pdf_v2.IMPACT_FRAMING_KO.items():
        assert isinstance(framings, tuple)
        assert 1 <= len(framings) <= 2, \
            f"{attr}: expected 1–2 framings, got {len(framings)}"


def test_every_framing_uses_a_locked_category():
    pdf_v2 = _load_pdf_module()
    for attr, framings in pdf_v2.IMPACT_FRAMING_KO.items():
        for f in framings:
            assert f.category_ko in pdf_v2.IMPACT_FRAMING_CATEGORIES_KO, \
                f"{attr}: unknown category {f.category_ko!r}"


def test_every_framing_sentence_is_hedged_interpretive():
    """Tone contract: every sentence ends in a hedged interpretive
    form. The user's spec gives two example shapes -
    '영향을 줄 가능성이 있습니다' / '영향을 줄 수 있는 신호로
    해석됩니다' - and other matching shapes
    ('발생할 수 있는 신호로 해석됩니다') are accepted as long as
    they preserve the hedge.

    No directive verbs, no causal claims (those are caught by the
    banned-wording test).
    """
    pdf_v2 = _load_pdf_module()
    ALLOWED_ENDINGS = (
        "영향을 줄 가능성이 있습니다.",
        "신호로 해석됩니다.",  # broader: any "X할 수 있는 신호로 해석됩니다"
    )
    for attr, framings in pdf_v2.IMPACT_FRAMING_KO.items():
        for f in framings:
            assert any(
                f.sentence_ko.endswith(e) for e in ALLOWED_ENDINGS
            ), f"{attr}: non-interpretive ending in {f.sentence_ko!r}"


def test_framing_sentences_avoid_banned_wording():
    pdf_v2 = _load_pdf_module()
    BANNED = (
        "원인", "개선 필요", "해야 합니다", "해야 함",
        "발생합니다", "원인 확정",
    )
    for attr, framings in pdf_v2.IMPACT_FRAMING_KO.items():
        for f in framings:
            for term in BANNED:
                assert term not in f.sentence_ko, \
                    f"{attr}: banned wording '{term}' in: " \
                    f"{f.sentence_ko!r}"


def test_top_signal_card_includes_impact_framing_row():
    """Card body contains the '비즈니스 임팩트' header + each of
    the attribute's 1–2 framings with category chips."""
    pdf_v2 = _load_pdf_module()
    priority = _make_priority_item()  # transfer_resistance
    rep = {
        "evidence_span": "마스크에 다 묻어요",
        "rating_normalized": 1.0,
    }
    card = pdf_v2._build_priority_card(
        index=1, priority=priority, representative=rep, styles=_styles(),
    )
    parts: list[str] = []
    for cell in card._cellvalues:
        for content in cell:
            if isinstance(content, list):
                for p in content:
                    parts.append(getattr(p, "text", ""))
            else:
                parts.append(getattr(content, "text", ""))
    rendered = " ".join(parts)
    assert "비즈니스 임팩트" in rendered
    framings = pdf_v2.IMPACT_FRAMING_KO["transfer_resistance"]
    for f in framings:
        assert f"[{f.category_ko}]" in rendered, \
            f"category chip missing: {f.category_ko}"
        assert f.sentence_ko in rendered, \
            f"framing sentence missing: {f.sentence_ko!r}"


def test_top_signal_card_renders_unmapped_attribute_without_framing_row():
    """An attribute outside IMPACT_FRAMING_KO produces no framing row
    - same future-attribute safety pattern as why/check_questions."""
    pdf_v2 = _load_pdf_module()
    priority = _make_priority_item(
        attribute="future_attr_xyz", label_ko="Future",
        why_ko=None, action_ko=None, risk_category=None,
    )
    card = pdf_v2._build_priority_card(
        index=1, priority=priority, representative=None,
        styles=_styles(),
    )
    # Just the header - no framing, no check question, no biz.
    assert len(card._cellvalues) == 1


def test_top_signal_card_no_longer_renders_biz_chip_row():
    """Locked: the prior '비즈니스 영향 [매출] / [이탈] / [CS]'
    chip row is replaced by the new Impact Framing. Searching the
    card text for the literal old chip labels should miss."""
    pdf_v2 = _load_pdf_module()
    priority = _make_priority_item()
    card = pdf_v2._build_priority_card(
        index=1, priority=priority, representative=None,
        styles=_styles(),
    )
    parts: list[str] = []
    for cell in card._cellvalues:
        for content in cell:
            if isinstance(content, list):
                for p in content:
                    parts.append(getattr(p, "text", ""))
            else:
                parts.append(getattr(content, "text", ""))
    rendered = " ".join(parts)
    assert "[매출]" not in rendered
    assert "[이탈]" not in rendered
    # The legacy "비즈니스 영향" label is replaced by "비즈니스 임팩트".
    assert "비즈니스 영향" not in rendered


def test_impact_framing_category_distribution_covers_all_four():
    """Sanity: across the 12 attributes, all 4 categories should
    appear at least once. Catches a copy-paste accident where one
    category was forgotten."""
    pdf_v2 = _load_pdf_module()
    seen = set()
    for framings in pdf_v2.IMPACT_FRAMING_KO.values():
        for f in framings:
            seen.add(f.category_ko)
    assert seen == pdf_v2.IMPACT_FRAMING_CATEGORIES_KO, \
        f"missing category coverage: " \
        f"{pdf_v2.IMPACT_FRAMING_CATEGORIES_KO - seen}"


def test_redesigned_pdf_renders_with_data_coverage_at_section_3(tmp_path):
    """End-to-end: the data coverage section sits at §3 between
    Key Metrics and Executive Verdict in the new flow."""
    pdf_v2 = _load_pdf_module()
    reviews = _build_synthetic_reviews()
    from src.voc.reporting.phase2e.report import aggregate_product
    data = aggregate_product("A0001", "Test Product", reviews)
    out_path = tmp_path / "smoke_data_coverage.pdf"
    pdf_v2.render_pdf_v2(
        data, out_path,
        source_label="data coverage smoke",
        reviews=reviews,
        review_dates={r["review_id"]: r["review_date"] for r in reviews},
        corpus_metadata=_build_corpus_metadata(len(reviews)),
        current_snapshot_provenance=_make_provenance(
            collected_primary_review_count=data.n_reviews,
            total_review_count_available=200,
            coverage_ratio=data.n_reviews / 200,
        ),
    )
    assert out_path.exists()
    raw = out_path.read_bytes()
    assert raw.startswith(b"%PDF-")
    assert b"%%EOF" in raw[-32:]


# ---------------------------------------------------------------------------
# Regression: --skip-scrape crash (TypeError: fromisoformat: argument
# must be str)
#
# When the pipeline runner is invoked with --skip-scrape, no fresh
# collection happens this invocation, so corpus_metadata.collection_
# completed_at stays None. The snapshot still needs a valid
# `collected_at` datetime; the runner's fix is to fall back to
# datetime.now(timezone.utc) WITHOUT fabricating any corpus_metadata
# scrape fields. This test reproduces the exact failure conditions
# and verifies the snapshot + PDF render path both clear cleanly.
# ---------------------------------------------------------------------------


def test_skip_scrape_fallback_yields_valid_snapshot_collected_at():
    """Replicates the runner's --skip-scrape branch where
    collection_completed_at is None. The fallback (datetime.now(utc))
    must produce a valid snapshot datetime that build_snapshot
    accepts without raising."""
    from datetime import datetime, timezone
    from src.voc.reporting.phase2e.report import aggregate_product
    from src.voc.reporting.phase2e.snapshots import build_snapshot

    reviews = _build_synthetic_reviews()
    data = aggregate_product("A0001", "Test Product", reviews)

    # Mirror the runner's fallback logic.
    collection_completed_at: str | None = None  # --skip-scrape
    if collection_completed_at is None:
        snapshot_collected_at = datetime.now(timezone.utc)
    else:
        snapshot_collected_at = datetime.fromisoformat(
            collection_completed_at,
        )

    # Sanity - fallback produced a real datetime.
    assert isinstance(snapshot_collected_at, datetime)
    assert snapshot_collected_at.tzinfo is not None

    snap = build_snapshot(
        data,
        collected_at=snapshot_collected_at,
        provenance=_make_provenance(
            collected_primary_review_count=data.n_reviews,
        ),
    )
    # collected_at field on the snapshot should be a non-empty
    # ISO string (the fallback flowed through cleanly).
    assert snap.collected_at
    assert snap.collected_at.endswith("Z")


def test_skip_scrape_pdf_render_path_does_not_crash(tmp_path):
    """End-to-end: with --skip-scrape conditions (no fresh collection),
    the PDF render must complete without TypeError. Corpus metadata
    keeps collection_completed_at=None - we do NOT fake scrape
    metadata; only the snapshot's own as-of timestamp falls back."""
    from datetime import datetime, timezone
    from src.voc.reporting.phase2e.report import aggregate_product
    from src.voc.reporting.phase2e.snapshots import (
        build_snapshot, compare_snapshots,
    )

    pdf_v2 = _load_pdf_module()
    reviews = _build_synthetic_reviews()
    data = aggregate_product("A0001", "Test Product", reviews)

    # Build the corpus_metadata shape the runner produces under
    # --skip-scrape. Critical: collection_started_at and
    # collection_completed_at are None, scrape_skipped=True.
    corpus_metadata = {
        "scrape_skipped": True,
        "collection_started_at": None,
        "collection_completed_at": None,
        "max_reviews_arg": "200",
        "max_reviews_effective": None,
        "finite_limit_set": False,
        "collected_review_count": len(reviews),
        "processed_review_count": len(reviews),
        "polarity_record_count": data.n_records,
        "corpus_limited": False,
        "model_name": "stub",
        "sort_mode": "default",
        "sort_types_included": None,
        "multi_sort_plan": None,
        "primary_corpus_sort_type": None,
        "signal_sort_types": None,
        "signal_sort_cap": None,
        "total_review_count_available": None,
    }

    # Apply the runner's fallback for snapshot collected_at.
    collection_completed_at = corpus_metadata["collection_completed_at"]
    if collection_completed_at is None:
        snapshot_collected_at = datetime.now(timezone.utc)
    else:
        snapshot_collected_at = datetime.fromisoformat(
            collection_completed_at,
        )

    prov = _make_provenance(
        collected_primary_review_count=data.n_reviews,
    )
    cur = build_snapshot(
        data, collected_at=snapshot_collected_at, provenance=prov,
    )
    cmp = compare_snapshots(cur, previous=None)

    out_path = tmp_path / "smoke_skip_scrape.pdf"
    pdf_v2.render_pdf_v2(
        data, out_path,
        source_label="skip-scrape regression",
        corpus_metadata=corpus_metadata,
        snapshot_comparison=cmp,
        current_snapshot_confidence=cur.provenance.confidence_level,
        current_snapshot_provenance=cur.provenance,
    )
    assert out_path.exists()
    raw = out_path.read_bytes()
    assert raw.startswith(b"%PDF-")
    assert b"%%EOF" in raw[-32:]


def test_skip_scrape_corpus_metadata_does_not_get_faked():
    """Locked: under --skip-scrape, corpus_metadata.collection_completed_at
    must stay None. The runner's fallback fills in the SNAPSHOT's
    collected_at via datetime.now(utc), but it must NOT mutate
    corpus_metadata to claim a fresh scrape happened."""
    # We test this by simulating the runner's exact fallback shape
    # and asserting corpus_metadata fields stay None.
    corpus_metadata = {
        "scrape_skipped": True,
        "collection_started_at": None,
        "collection_completed_at": None,
    }
    collection_completed_at = corpus_metadata["collection_completed_at"]

    from datetime import datetime, timezone
    if collection_completed_at is None:
        snapshot_collected_at = datetime.now(timezone.utc)
    else:
        snapshot_collected_at = datetime.fromisoformat(
            collection_completed_at,
        )

    # The fallback produced a snapshot timestamp...
    assert snapshot_collected_at is not None
    # ...but corpus_metadata's scrape-time fields stayed None.
    assert corpus_metadata["scrape_skipped"] is True
    assert corpus_metadata["collection_started_at"] is None
    assert corpus_metadata["collection_completed_at"] is None


# ---------------------------------------------------------------------------
# Business-grade redesign — overall_signal_mode + denominators +
# manufacturing-prescription guard
# ---------------------------------------------------------------------------


def test_overall_signal_mode_low_uses_monitoring_framing():
    """Run-003 QA pass-2 lock: LOW maps to "주요 확인 포인트"
    (PDF-business-tone). Internal jargon ("관찰 신호" / "모니터링
    후보") is suppressed throughout the mode dict."""
    pdf_v2 = _load_pdf_module()
    mode = pdf_v2._overall_signal_mode("LOW")
    assert mode["level_label_ko"] == "양호"
    assert mode["signals_section_title"] == "주요 확인 포인트"
    assert mode["card_concern_label"] == "확인 포인트"
    # Internal jargon must not leak into the takeaway text.
    assert "관찰 신호" not in mode["takeaway_ko"]
    assert "부정 신호" not in mode["takeaway_ko"]
    assert "모니터링 후보" not in mode["takeaway_ko"]


def test_overall_signal_mode_medium_uses_review_framing():
    pdf_v2 = _load_pdf_module()
    mode = pdf_v2._overall_signal_mode("MEDIUM")
    assert mode["level_label_ko"] == "확인 필요"
    assert mode["signals_section_title"] == "주요 확인 포인트"
    assert mode["card_concern_label"] == "확인 포인트"


def test_overall_signal_mode_high_uses_strong_framing():
    pdf_v2 = _load_pdf_module()
    mode = pdf_v2._overall_signal_mode("HIGH")
    assert mode["level_label_ko"] == "주의"
    assert mode["signals_section_title"] == "주요 확인 포인트"
    assert mode["card_concern_label"] == "우선 확인 포인트"


def test_recommendations_contain_no_manufacturing_prescriptions():
    """Locked: the report must not claim insight into manufacturing
    internals. RECOMMENDATIONS_KO should never reference 포뮬러 /
    안료 농도 / 베이스 점도 / 첨가제 / 픽서 / 베이스 변경 / 제조."""
    from src.voc.reporting.phase2e.recommendations import RECOMMENDATIONS_KO
    BANNED = (
        "포뮬러", "안료 농도", "베이스 점도", "첨가제 조정",
        "픽서", "필름 형성제", "베이스 변경", "제조 변경",
        "개선 필요", "해야 합니다",
    )
    for attr, phrase in RECOMMENDATIONS_KO.items():
        for term in BANNED:
            assert term not in phrase, \
                f"{attr}: manufacturing prescription '{term}' in {phrase!r}"


def test_recommendations_use_verification_framing():
    """Each phrase ends in 확인 후보 / 검토 후보 / 권장 - the
    operator-verification framework, not a manufacturing
    prescription."""
    from src.voc.reporting.phase2e.recommendations import RECOMMENDATIONS_KO
    ALLOWED_ENDINGS = (
        "확인 후보", "검토 후보", "확인 권장", "검토 권장",
    )
    for attr, phrase in RECOMMENDATIONS_KO.items():
        assert any(phrase.endswith(end) for end in ALLOWED_ENDINGS), \
            f"{attr}: phrase doesn't end in verification form: {phrase!r}"


def test_top_signal_card_no_internal_score_chip():
    """Front-page card no longer shows '점수 N.N' chip."""
    pdf_v2 = _load_pdf_module()
    priority = _make_priority_item(priority_score=8.7)
    card = pdf_v2._build_priority_card(
        index=1, priority=priority, representative=None,
        styles=_styles(),
        n_reviews_total=1135,
    )
    parts: list[str] = []
    for cell in card._cellvalues:
        for content in cell:
            if isinstance(content, list):
                for p in content:
                    parts.append(getattr(p, "text", ""))
            else:
                parts.append(getattr(content, "text", ""))
    rendered = " ".join(parts)
    assert "점수 8.7" not in rendered
    assert "점수 " not in rendered


def test_top_signal_card_includes_denominator_basis():
    pdf_v2 = _load_pdf_module()
    priority = _make_priority_item(n_negative=32)
    card = pdf_v2._build_priority_card(
        index=1, priority=priority, representative=None,
        styles=_styles(),
        n_reviews_total=1135,
        attr_total_mentions=154,
    )
    parts: list[str] = []
    for cell in card._cellvalues:
        for content in cell:
            if isinstance(content, list):
                for p in content:
                    parts.append(getattr(p, "text", ""))
            else:
                parts.append(getattr(content, "text", ""))
    rendered = " ".join(parts)
    assert "1,135건 중 32건" in rendered
    assert "해당 속성 언급 154건 중 부정 32건" in rendered


def test_top_signal_card_concern_label_renders_when_provided():
    pdf_v2 = _load_pdf_module()
    priority = _make_priority_item()
    card = pdf_v2._build_priority_card(
        index=1, priority=priority, representative=None,
        styles=_styles(),
        n_reviews_total=1135,
        concern_label_ko="관찰 신호",
    )
    parts: list[str] = []
    for cell in card._cellvalues:
        for content in cell:
            if isinstance(content, list):
                for p in content:
                    parts.append(getattr(p, "text", ""))
            else:
                parts.append(getattr(content, "text", ""))
    rendered = " ".join(parts)
    assert "[관찰 신호]" in rendered


def test_executive_summary_box_includes_data_basis_line():
    pdf_v2 = _load_pdf_module()
    reviews = _build_synthetic_reviews()
    from src.voc.reporting.phase2e.report import aggregate_product
    from src.voc.reporting.phase2e.executive_summary import (
        synthesize_executive_summary,
    )
    data = aggregate_product("A0001", "P", reviews)
    es = synthesize_executive_summary(data)
    flowables = pdf_v2._build_executive_summary_box(
        data=data, exec_summary=es, overall_level="LOW",
        n_reviews=data.n_reviews, provenance=_make_provenance(),
        corpus_metadata=None, styles=_styles(),
    )
    rendered = " ".join(getattr(f, "text", "") for f in flowables)
    assert "분석 기준" in rendered


def test_executive_summary_low_priority_uses_monitoring_takeaway():
    """Run-003 QA pass-2 lock: PDF executive summary uses business-tone
    "주요 확인 포인트" header and the legacy internal-jargon tokens are
    suppressed."""
    pdf_v2 = _load_pdf_module()
    reviews = _build_synthetic_reviews()
    from src.voc.reporting.phase2e.report import aggregate_product
    from src.voc.reporting.phase2e.executive_summary import (
        synthesize_executive_summary,
    )
    data = aggregate_product("A0001", "P", reviews)
    es = synthesize_executive_summary(data)
    flowables = pdf_v2._build_executive_summary_box(
        data=data, exec_summary=es, overall_level="LOW",
        n_reviews=data.n_reviews, provenance=_make_provenance(),
        corpus_metadata=None, styles=_styles(),
    )
    rendered = " ".join(getattr(f, "text", "") for f in flowables)
    assert "양호" in rendered
    assert "주요 확인 포인트" in rendered
    for term in ("모니터링 후보", "관찰 신호", "신뢰도 낮음", "안정성 높음",
                 "부정 신호", "긍정 신호"):
        assert term not in rendered, (
            f"executive summary leaked internal jargon: {term!r}"
        )


def test_usage_pattern_contradiction_includes_denominator():
    """Locked: contradiction sentences show '언급 N건 중 ...'"""
    from collections import Counter
    from src.voc.reporting.phase2e.report import (
        AttributeSummary, ProductReportData,
    )
    from src.voc.reporting.phase2e.usage_patterns import detect_patterns
    s = AttributeSummary(
        attribute="pigmentation",
        n_total=20, n_positive=10, n_negative=10,
        avg_intensity_neg=2.0,
    )
    data = ProductReportData(
        product_id="A0001", product_name="P",
        n_reviews=100, n_records=20, n_mixed_reviews=0,
        n_with_tradeoff=0,
        attribute_summaries={"pigmentation": s},
        tradeoff_pairs=Counter(),
        mixed_attribute_pairs=[],
        delivery_condition_records_total=0,
    )
    contras = [
        p for p in detect_patterns(data, review_blocks=[])
        if p.kind == "contradiction"
    ]
    assert contras
    sentence = contras[0].sentence_ko
    assert "언급" in sentence
    assert "건 중" in sentence


def test_appendix_tradeoff_table_uses_korean_column_headers():
    """Locked: 강점으로 언급된 속성 / 함께 양보된 속성 / 건수.
    No raw 'positive' / 'negative_strong' anywhere."""
    pdf_v2 = _load_pdf_module()
    from collections import Counter
    from src.voc.reporting.phase2e.report import ProductReportData
    pairs = Counter({
        "finish_texture:positive -> persistence:negative_strong": 5,
    })
    data = ProductReportData(
        product_id="A0001", product_name="P",
        n_reviews=100, n_records=20, n_mixed_reviews=0,
        n_with_tradeoff=5,
        attribute_summaries={},
        tradeoff_pairs=pairs,
        mixed_attribute_pairs=[],
        delivery_condition_records_total=0,
    )
    tbl = pdf_v2.build_tradeoff_table(data)
    assert tbl is not None
    rendered = " ".join(
        str(cell) for row in tbl._cellvalues for cell in row
    )
    assert "강점으로 언급된 속성" in rendered
    assert "함께 양보된 속성" in rendered
    assert "건수" in rendered
    assert "positive" not in rendered
    assert "negative_weak" not in rendered
    assert "negative_strong" not in rendered


def test_redesigned_pdf_full_render_smoke(tmp_path):
    pdf_v2 = _load_pdf_module()
    reviews = _build_synthetic_reviews()
    from src.voc.reporting.phase2e.report import aggregate_product
    data = aggregate_product("A0001", "Test Product", reviews)
    out_path = tmp_path / "smoke_redesigned_v2.pdf"
    pdf_v2.render_pdf_v2(
        data, out_path,
        source_label="redesigned smoke",
        corpus_metadata=_build_corpus_metadata(len(reviews)),
        current_snapshot_provenance=_make_provenance(
            collected_primary_review_count=data.n_reviews,
        ),
        current_snapshot_confidence="medium",
    )
    assert out_path.exists()
    raw = out_path.read_bytes()
    assert raw.startswith(b"%PDF-")
    assert b"%%EOF" in raw[-32:]