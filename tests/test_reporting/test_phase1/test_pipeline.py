"""Tests for the PR5C pipeline orchestrator.

The golden test drives the full rows→report chain on the 20-row OY fixture
using the curated lexicons on disk. Edge-case tests use synthetic inputs and
in-memory Lexicons so they don't depend on the lexicon files.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from src.voc.reporting.phase1.pipeline import build_report
from src.voc.reporting.phase1.schema import Phase1Report, ReportQuery
from src.voc.reporting.phase1.signals import Lexicons, load_lexicons


FIXTURE = (
    Path(__file__).parents[2]
    / "fixtures"
    / "phase1_reports"
    / "oy_browser_20rows.json"
)
LEXICON_DIR = Path("data/phase1_lexicons")


@pytest.fixture(scope="module")
def rows() -> list[dict]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def lexicons() -> Lexicons:
    return load_lexicons(
        LEXICON_DIR / "positive.json",
        LEXICON_DIR / "cautionary.json",
    )


@pytest.fixture(scope="module")
def report(rows, lexicons) -> Phase1Report:
    return build_report(
        rows,
        ReportQuery(
            channel_filter=["oliveyoung"],
            product_ids=["A000000238828", "A000000205145"],
            window_start=date(2026, 3, 1),
            window_end=date(2026, 4, 30),
        ),
        lexicons=lexicons,
        generated_at=datetime(2026, 4, 22, 12, 0, tzinfo=timezone.utc),
        report_id="phase1_report_TESTFIXED",
    )


# ---------------------------------------------------------------------------
# Pipeline wiring and report shape
# ---------------------------------------------------------------------------


class TestReportShape:
    def test_deterministic_report_id_and_timestamp(self, report: Phase1Report) -> None:
        assert report.report_id == "phase1_report_TESTFIXED"
        assert report.generated_at.tzinfo is not None
        assert report.schema_version == "1.0"

    def test_query_echoed(self, report: Phase1Report) -> None:
        assert report.query.channel_filter == ["oliveyoung"]
        assert report.query.product_ids == ["A000000238828", "A000000205145"]
        assert report.query.window_start == date(2026, 3, 1)

    def test_scope_matches_fixture(self, report: Phase1Report) -> None:
        assert report.scope.channels == ["oliveyoung"]
        assert report.scope.total_reviews == 20
        assert [(p.product_id, p.n_reviews) for p in report.scope.products] == [
            ("A000000238828", 18),
            ("A000000205145", 2),
        ]
        # display_label defaults to None when no product_labels map is passed.
        assert all(p.display_label is None for p in report.scope.products)

    def test_metrics_are_populated(self, report: Phase1Report) -> None:
        m = report.deterministic_metrics
        assert m.total_reviews == 20
        assert m.rating.avg_raw == 4.85
        assert m.dominant_product is not None
        assert m.dominant_product.product_id == "A000000238828"

    def test_signals_populated_from_lexicons(self, report: Phase1Report) -> None:
        names = {s.name for s in report.signals.positive}
        assert names == {
            "moist_finish",
            "no_base_crumbling",
            "gift_item_positive",
            "good_applicability",
        }
        assert len(report.signals.cautionary) == 2
        assert len(report.signals.gaps) == 1
        assert report.signals.gaps[0].name == "api_repurchase_vs_text_mention"

    def test_narrative_is_template_and_has_all_sections(
        self, report: Phase1Report,
    ) -> None:
        n = report.narrative
        assert n is not None
        assert n.source == "template"
        assert n.summary_md
        assert set(n.sections_md) == {
            "executive", "sample", "coverage", "positives", "cautionary",
            "segment_findings", "shade_findings", "rating_divergences",
            "operational",
        }
        # Derived-analysis + coverage sections can legitimately be empty
        # when restraint thresholds aren't cleared on small fixtures, or
        # (for coverage) when the fixture lacks the coverage field.
        # render_markdown suppresses empty sections automatically.
        optional_empty = {
            "coverage",
            "segment_findings", "shade_findings", "rating_divergences",
        }
        for key, body in n.sections_md.items():
            if key in optional_empty:
                continue
            assert body.strip(), f"section {key!r} empty"

    def test_provenance(self, report: Phase1Report) -> None:
        prov = report.provenance
        assert prov.phase1_run_ids == ["run_20260422_014058_f27ba5"]
        assert len(prov.sample_review_ids) == 20
        assert prov.sample_review_ids == sorted(prov.sample_review_ids)
        assert prov.lexicon_version == "positive=1.1;cautionary=1.13"
        assert prov.llm_model is None

    def test_caveats_flag_small_sample_and_skew(self, report: Phase1Report) -> None:
        caveats = report.narrative.caveats  # type: ignore[union-attr]
        # n=20 < 50 → small-sample warning
        assert any("표본 크기" in c for c in caveats)
        # dominant pct = 0.9 >= 0.8 → skew warning
        assert any("대표 제품 비중" in c for c in caveats)

    def test_report_roundtrips_to_json(self, report: Phase1Report) -> None:
        payload = report.model_dump(mode="json")
        restored = Phase1Report.model_validate(payload)
        assert restored == report


# ---------------------------------------------------------------------------
# Edge cases — small synthetic inputs
# ---------------------------------------------------------------------------


class TestEdgeCases:
    def test_empty_rows_produces_valid_report(self) -> None:
        report = build_report(
            [],
            ReportQuery(),
            lexicons=Lexicons(version="t"),
            generated_at=datetime(2026, 4, 22, tzinfo=timezone.utc),
            report_id="empty",
        )
        assert report.scope.total_reviews == 0
        assert report.scope.products == []
        assert report.deterministic_metrics.total_reviews == 0
        assert report.narrative is not None
        assert report.narrative.source == "template"
        assert any(
            "리뷰가 없어" in c for c in report.narrative.caveats
        )

    def test_no_signals_leaves_empty_bundle_but_valid_narrative(self) -> None:
        rows = [
            {"review_id": "r1", "source_channel": "coupang",
             "product_external_id": "p1",
             "text": "그냥 평범한 제품이에요", "rating_raw": 4,
             "review_date": "2026-04-10"},
        ]
        report = build_report(
            rows,
            ReportQuery(),
            lexicons=Lexicons(version="t"),  # no entries at all
            generated_at=datetime(2026, 4, 22, tzinfo=timezone.utc),
            report_id="no-signals",
        )
        assert report.signals.positive == []
        assert report.signals.cautionary == []
        assert report.signals.gaps == []
        # Narrative still renders. At this n (=1) PR5C.2 collapses the two
        # empty "해당 신호 없음" sections into one low-sample note under
        # 'positives', and leaves 'cautionary' empty for the markdown
        # renderer to skip.
        assert report.narrative is not None
        assert "표본이 작아(n=1)" in report.narrative.sections_md["positives"]
        assert report.narrative.sections_md["cautionary"] == ""

    def test_auto_generated_report_id_shape(self) -> None:
        report = build_report(
            [],
            ReportQuery(),
            lexicons=Lexicons(version="t"),
        )
        # report_id = "phase1_report_YYYYMMDD_HHMMSS_xxxxxx"
        assert report.report_id.startswith("phase1_report_")
        # "_".join parts ≥ 4 and last part is a 6-char hex suffix.
        parts = report.report_id.split("_")
        assert len(parts) >= 4
        assert len(parts[-1]) == 6


# ---------------------------------------------------------------------------
# Product display-label wiring (PR5C.1)
# ---------------------------------------------------------------------------


class TestProductLabels:
    def test_labels_populated_when_mapping_provided(self, rows, lexicons) -> None:
        report = build_report(
            rows,
            ReportQuery(),
            lexicons=lexicons,
            product_labels={
                "A000000238828": "페탈 드롭 리퀴드 블러쉬",
                "A000000205145": "디어달리아 리퀴드 블러쉬",
            },
        )
        labels = {p.product_id: p.display_label for p in report.scope.products}
        assert labels == {
            "A000000238828": "페탈 드롭 리퀴드 블러쉬",
            "A000000205145": "디어달리아 리퀴드 블러쉬",
        }
        # Narrative picks up the label in the title and sample section.
        from src.voc.reporting.phase1.narrative import render_markdown
        md = render_markdown(report)
        assert "페탈 드롭 리퀴드 블러쉬" in md
        assert "디어달리아 리퀴드 블러쉬" in md
        # Report title ends with the dominant product's display_label.
        assert "# Phase 1 VOC 모니터링 리포트 — 페탈 드롭 리퀴드 블러쉬" in md

    def test_partial_mapping_falls_back_per_product(self, rows, lexicons) -> None:
        """One product has a label, the other does not. Each renders accordingly."""
        report = build_report(
            rows,
            ReportQuery(),
            lexicons=lexicons,
            product_labels={"A000000238828": "페탈 드롭 리퀴드 블러쉬"},
        )
        labels = {p.product_id: p.display_label for p in report.scope.products}
        assert labels == {
            "A000000238828": "페탈 드롭 리퀴드 블러쉬",
            "A000000205145": None,
        }
        from src.voc.reporting.phase1.narrative import render_markdown
        md = render_markdown(report)
        assert "페탈 드롭 리퀴드 블러쉬" in md
        # Minority product still renders with its id.
        assert "A000000205145" in md

    def test_no_mapping_keeps_all_labels_none(self, rows, lexicons) -> None:
        report = build_report(rows, ReportQuery(), lexicons=lexicons)
        assert all(p.display_label is None for p in report.scope.products)
        from src.voc.reporting.phase1.narrative import render_markdown
        md = render_markdown(report)
        # Title falls back to the id.
        assert "# Phase 1 VOC 모니터링 리포트 — A000000238828" in md


class TestLoadProductLabels:
    def test_loads_from_bundled_file(self, tmp_path) -> None:
        from src.voc.reporting.phase1.pipeline import load_product_labels
        labels = load_product_labels(Path("data/phase1_product_labels.json"))
        assert labels["A000000238828"] == "페탈 드롭 리퀴드 블러쉬"
        assert labels["A000000205145"] == "디어달리아 리퀴드 블러쉬"

    def test_missing_file_returns_empty(self, tmp_path) -> None:
        from src.voc.reporting.phase1.pipeline import load_product_labels
        assert load_product_labels(tmp_path / "nope.json") == {}
        assert load_product_labels(None) == {}

    def test_rejects_null_values(self, tmp_path) -> None:
        """A null label is treated as missing — forces curator to commit to
        an actual string rather than letting empty values mask as 'labelled'."""
        p = tmp_path / "labels.json"
        p.write_text(
            '{"version": "1.0", "labels": {"P1": "ok", "P2": null, "P3": ""}}',
            encoding="utf-8",
        )
        from src.voc.reporting.phase1.pipeline import load_product_labels
        assert load_product_labels(p) == {"P1": "ok"}
