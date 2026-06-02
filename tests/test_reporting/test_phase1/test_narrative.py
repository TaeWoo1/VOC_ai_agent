"""Tests for the template narrative renderer.

These tests target narrative-specific behavior (section heading handling,
caveat thresholds, empty sections) rather than re-asserting metrics/signals
content — those are owned by their respective test modules. The full
fixture-based markdown golden is in ``test_pipeline.py``.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from src.voc.reporting.phase1.narrative import render_markdown, render_template
from src.voc.reporting.phase1.pipeline import build_report
from src.voc.reporting.phase1.schema import ReportQuery
from src.voc.reporting.phase1.signals import Lexicons


@pytest.fixture()
def tiny_report():
    """Small report with some signals and a clean n=1 sample."""
    rows = [
        {"review_id": "r1", "source_channel": "oliveyoung",
         "product_external_id": "P1",
         "text": "촉촉하고 증정품도 좋아요",
         "rating_raw": 5,
         "review_date": "2026-04-01",
         "raw_metadata": {"oy_is_repurchase": False}},
        {"review_id": "r2", "source_channel": "oliveyoung",
         "product_external_id": "P1",
         "text": "촉촉한 마무리, 증정품 만족",
         "rating_raw": 5,
         "review_date": "2026-04-02",
         "raw_metadata": {"oy_is_repurchase": False}},
    ]
    lex = Lexicons(
        version="test",
        positive=[
            # Using the shipping ids/labels so downstream formatting is realistic.
            __lex_entry("moist_finish", "촉촉한 마무리감", ["촉촉"]),
            __lex_entry("gift_item_positive", "증정품·사은품 만족", ["증정"]),
        ],
    )
    return build_report(
        rows,
        ReportQuery(),
        lexicons=lex,
        generated_at=datetime(2026, 4, 22, tzinfo=timezone.utc),
        report_id="phase1_report_tiny",
    )


def __lex_entry(id_: str, label: str, patterns: list[str]):
    from src.voc.reporting.phase1.signals import LexiconEntry
    return LexiconEntry(
        id=id_, display_label=label, patterns=patterns, min_doc_freq=2,
    )


class TestCaveats:
    def test_small_sample_and_short_window_caveats_fire(self, tiny_report) -> None:
        caveats = tiny_report.narrative.caveats
        assert any("표본 크기" in c for c in caveats)
        assert any("기간이 짧습니다" in c for c in caveats)  # days_span=2

    def test_no_caveat_at_boundary_n50(self) -> None:
        rows = [
            {"review_id": f"r{i}", "source_channel": "oliveyoung",
             "product_external_id": "P1",
             "text": "괜찮아요", "rating_raw": 5,
             "review_date": "2026-01-01"}
            for i in range(50)
        ]
        report = build_report(rows, ReportQuery(), lexicons=Lexicons(version="t"))
        assert not any("표본 크기" in c for c in report.narrative.caveats)


class TestMarkdownRendering:
    def test_markdown_contains_all_section_headings(self, tiny_report) -> None:
        md = render_markdown(tiny_report)
        for h in ("# ", "## 샘플 구성", "## 긍정 신호", "## 주의 신호", "## 운영 관찰"):
            assert h in md
        assert "## 주의사항" in md  # caveats present on a 2-row report

    def test_markdown_signal_bullets_render_with_percentage(
        self, tiny_report,
    ) -> None:
        md = render_markdown(tiny_report)
        # Both signals fired on 2/2 rows → 100%.
        assert "촉촉한 마무리감" in md
        assert "100%" in md

    def test_markdown_empty_report_degrades_gracefully(self) -> None:
        report = build_report([], ReportQuery(), lexicons=Lexicons(version="t"))
        md = render_markdown(report)
        assert md.startswith("# Phase 1 VOC 모니터링 리포트")
        assert "리뷰가 없어" in md
        # No 샘플 구성 heading when sample section is just "(리뷰 없음)" —
        # actually we DO render it with the placeholder body. Check both paths:
        assert ("## 샘플 구성" in md) or ("이 쿼리에 해당하는 리뷰가 없습니다" in md)

    def test_markdown_ends_with_newline(self, tiny_report) -> None:
        md = render_markdown(tiny_report)
        assert md.endswith("\n")


class TestRenderTemplateIdempotent:
    def test_calling_render_template_twice_yields_equal_blocks(
        self, tiny_report,
    ) -> None:
        a = render_template(tiny_report)
        b = render_template(tiny_report)
        assert a == b
        assert a.source == "template"


# ---------------------------------------------------------------------------
# PR5C.2 polish
# ---------------------------------------------------------------------------


class TestPolish:
    def _mk_report(self, *, n_rows: int, n_products: int, rating: float):
        """Build a tiny synthetic report for polish-specific assertions.
        Signals stay empty so the low-sample collapse path is exercised on
        small n, and the skew-caveat path is exercised on n_products=1.
        """
        from src.voc.reporting.phase1.pipeline import build_report
        from src.voc.reporting.phase1.schema import ReportQuery
        from src.voc.reporting.phase1.signals import Lexicons
        rows = []
        # Spread rows across the requested product count, putting the
        # majority on P1 so dominant_product resolves deterministically.
        for i in range(n_rows):
            pid = "P1" if (i < n_rows - (n_products - 1) or n_products == 1) else f"P{i+2}"
            rows.append({
                "review_id": f"r{i:03d}",
                "source_channel": "oliveyoung",
                "product_external_id": pid,
                "text": "간단 리뷰",
                "rating_raw": rating,
                "review_date": f"2026-04-{(i % 28) + 1:02d}",
            })
        return build_report(
            rows,
            ReportQuery(),
            lexicons=Lexicons(version="t"),
            generated_at=datetime(2026, 4, 22, tzinfo=timezone.utc),
            report_id=f"polish_{n_rows}_{n_products}",
        )

    # --- 1) 2-decimal rating ------------------------------------------------

    def test_summary_rating_rendered_with_two_decimals(self) -> None:
        # rating_raw=4.83333 averages to 4.83333; 2-decimal display → 4.83.
        report = self._mk_report(n_rows=3, n_products=1, rating=4.83333)
        md = render_markdown(report)
        assert "평균 평점 4.83 / 5" in md
        assert "4.8333" not in md      # the internal 4-decimal value must not leak
        assert "4.83333" not in md

    def test_integer_like_rating_still_shows_one_decimal(self) -> None:
        """round(5.0, 2) → 5.0; should render '5.0', not '5' or '5.00'."""
        report = self._mk_report(n_rows=3, n_products=1, rating=5.0)
        md = render_markdown(report)
        assert "평균 평점 5.0 / 5" in md

    # --- 2) Skew caveat conditional on n_products > 1 -----------------------

    def test_skew_caveat_suppressed_on_single_product(self) -> None:
        report = self._mk_report(n_rows=20, n_products=1, rating=5.0)
        caveats = report.narrative.caveats
        assert report.deterministic_metrics.n_products == 1
        assert report.deterministic_metrics.dominant_product.pct_of_total == 1.0
        assert not any("대표 제품 비중" in c for c in caveats), (
            "skew caveat should be suppressed when n_products <= 1"
        )

    def test_skew_caveat_still_fires_on_multi_product_skew(self) -> None:
        # 19 rows on P1, 1 row on P2 → pct_of_total = 0.95, skew caveat fires.
        report = self._mk_report(n_rows=20, n_products=2, rating=5.0)
        caveats = report.narrative.caveats
        assert report.deterministic_metrics.n_products == 2
        assert any("대표 제품 비중" in c for c in caveats)

    # --- 3) Korean skin_type bucket labels ----------------------------------

    def test_skin_type_buckets_rendered_in_korean(self) -> None:
        """A row with a derived skin_type bucket should display as Korean."""
        from src.voc.reporting.phase1.pipeline import build_report
        from src.voc.reporting.phase1.schema import ReportQuery
        from src.voc.reporting.phase1.signals import Lexicons
        rows = [
            {"review_id": "r1", "source_channel": "oliveyoung",
             "product_external_id": "P1", "text": "...", "rating_raw": 5,
             "review_date": "2026-04-10",
             "derived": {"normalized_skin_type": {"bucket": "combination"}}},
            {"review_id": "r2", "source_channel": "oliveyoung",
             "product_external_id": "P1", "text": "...", "rating_raw": 5,
             "review_date": "2026-04-11",
             "derived": {"normalized_skin_type": {"bucket": "dry"}}},
            {"review_id": "r3", "source_channel": "oliveyoung",
             "product_external_id": "P1", "text": "...", "rating_raw": 5,
             "review_date": "2026-04-12",
             "derived": {"normalized_skin_type": {"bucket": "unknown"}}},
        ]
        report = build_report(rows, ReportQuery(), lexicons=Lexicons(version="t"))
        md = render_markdown(report)
        # Korean labels present; English enum values not present.
        assert "복합성" in md
        assert "건성" in md
        assert "미확인" in md
        assert "combination" not in md
        assert "dry " not in md           # avoid matching 'dry' inside Korean words
        assert "unknown" not in md

    # --- 4) Collapsed signal section on low-sample empty bundle ------------

    def test_low_sample_empty_signals_collapses_to_single_section(self) -> None:
        report = self._mk_report(n_rows=2, n_products=1, rating=5.0)
        # Precondition: no signals fired.
        assert not report.signals.positive
        assert not report.signals.cautionary
        md = render_markdown(report)
        # Only one '신호' heading, and it's the collapsed label.
        assert md.count("## 긍정 신호") == 0
        assert md.count("## 주의 신호") == 0
        assert md.count("## 신호 분석") == 1
        assert "표본이 작아(n=2)" in md
        # "해당 신호 없음" must not appear twice.
        assert md.count("해당 신호 없음") == 0

    def test_signal_sections_preserved_when_not_both_empty(self) -> None:
        """If at least one signal fires, keep the normal two-heading layout."""
        from src.voc.reporting.phase1.pipeline import build_report
        from src.voc.reporting.phase1.schema import ReportQuery
        from src.voc.reporting.phase1.signals import Lexicons, LexiconEntry
        rows = [
            {"review_id": "r1", "source_channel": "oliveyoung",
             "product_external_id": "P1",
             "text": "촉촉해요", "rating_raw": 5,
             "review_date": "2026-04-10"},
            {"review_id": "r2", "source_channel": "oliveyoung",
             "product_external_id": "P1",
             "text": "촉촉하고 좋아요", "rating_raw": 5,
             "review_date": "2026-04-11"},
        ]
        lex = Lexicons(
            version="t",
            positive=[LexiconEntry(
                id="m", display_label="촉촉", patterns=["촉촉"], min_doc_freq=2,
            )],
        )
        report = build_report(rows, ReportQuery(), lexicons=lex)
        md = render_markdown(report)
        assert "## 긍정 신호" in md
        # Cautionary section still shows its no-signal message because
        # positive is non-empty → not a collapse case.
        assert "## 주의 신호" in md
        assert "해당 신호 없음" in md
        assert "## 신호 분석" not in md

    def test_low_sample_threshold_boundary_n10_does_not_collapse(self) -> None:
        """n=10 is the boundary; at exactly 10 the collapse must NOT trigger."""
        report = self._mk_report(n_rows=10, n_products=1, rating=5.0)
        assert not report.signals.positive
        md = render_markdown(report)
        assert "## 긍정 신호" in md
        assert "## 신호 분석" not in md
        assert "해당 신호 없음" in md


class TestConcentrationBands:
    """Band classifier maps raw lift multipliers to Korean labels.
    Thresholds match derived.py's 2.0 surfacing floor."""

    def test_band_at_boundaries(self) -> None:
        from src.voc.reporting.phase1.narrative import _concentration_band
        assert _concentration_band(2.0) == "중간 집중"
        assert _concentration_band(2.99) == "중간 집중"
        assert _concentration_band(3.0) == "뚜렷한 집중"
        assert _concentration_band(4.99) == "뚜렷한 집중"
        assert _concentration_band(5.0) == "매우 뚜렷한 집중"
        assert _concentration_band(10.0) == "매우 뚜렷한 집중"

    def test_band_below_surface_threshold_fallback(self) -> None:
        from src.voc.reporting.phase1.narrative import _concentration_band
        assert _concentration_band(1.5) == "약한 집중"


class TestThinEvidenceMarker:
    def test_marker_appears_below_threshold(self) -> None:
        from src.voc.reporting.phase1.narrative import _thin_evidence_marker
        assert _thin_evidence_marker(2) == " · 표본 적음"
        assert _thin_evidence_marker(4) == " · 표본 적음"

    def test_marker_absent_at_threshold(self) -> None:
        from src.voc.reporting.phase1.narrative import _thin_evidence_marker
        assert _thin_evidence_marker(5) == ""
        assert _thin_evidence_marker(10) == ""


class TestMethodologyLine:
    """The methodology line is appended to caveats ONLY when the report
    has at least one derived finding (segment or shade)."""

    def _report_with_findings(self, tiny_report):
        from src.voc.reporting.phase1.schema import (
            DerivedFindings, SegmentSignalFinding,
        )
        tiny_report.derived = DerivedFindings(
            segment_signal_findings=[SegmentSignalFinding(
                segment_variable="normalized_skin_type",
                bucket="sensitive",
                signal_name="moist_finish",
                signal_display_label="촉촉한 마무리감",
                signal_category="positive",
                n_segment=15, n_signal_in_segment=5,
                within_segment_rate=0.3333,
                overall_rate=0.1,
                lift=3.33,
                sample_review_ids=[],
                segment_share_of_known=0.5,
                segment_avg_rating=4.5,
            )]
        )
        # Force re-render so the narrative reflects the mutated derived field.
        # render_markdown reuses report.narrative when set; fixture pre-renders.
        tiny_report.narrative = None
        return tiny_report

    def test_methodology_line_present_when_findings_exist(self, tiny_report) -> None:
        report = self._report_with_findings(tiny_report)
        md = render_markdown(report)
        assert "집중도 배수" in md
        assert "2× 중간" in md
        assert "5×+ 매우 뚜렷" in md

    def test_methodology_line_absent_when_no_findings(self, tiny_report) -> None:
        md = render_markdown(tiny_report)
        # Check for a phrase unique to the methodology sentence (the
        # framing paragraph introduced in the final-pass cleanup also
        # contains "집중도 배수" as a forward-reference).
        assert "2× 중간·3× 뚜렷" not in md

    def test_segment_rendering_includes_band_and_thin_marker(self, tiny_report) -> None:
        report = self._report_with_findings(tiny_report)
        md = render_markdown(report)
        # lift=3.33 → 뚜렷한 집중
        assert "뚜렷한 집중" in md
        # n_signal_in_segment=5 is AT threshold → no thin marker
        assert "표본 적음" not in md
        # New phrasing structure
        assert "대비 집중도" in md
        assert "(뚜렷한 집중)" in md
