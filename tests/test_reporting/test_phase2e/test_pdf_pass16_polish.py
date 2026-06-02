"""Pass-16 final-polish tests:

A. Appendix 7.2 quote selection rejects "은근히 편하네요!", "...",
   "촉촉하고 좋아도 ...", "생각보다 만족스러웠어요".
B. Appendix 7.1 / 7.2 use the ambivalence-aware label override
   ("건조감·당김 체감", not "건조감/당김").
C. Methodology bullet is conditional on partial_success / sorts_failed.
D. Inspector separates audit-only display_text dangling from
   report-facing display_quote_summary degradation.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]


def _load_pdf():
    name = "generate_phase2e_pdf_v2_pass16_test"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(
        name, REPO / "scripts" / "generate_phase2e_pdf_v2.py",
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _load_inspector():
    name = "inspect_run_quality_pass16_test"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(
        name, REPO / "scripts" / "inspect_run_quality.py",
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _flatten(flowables) -> str:
    from reportlab.platypus import KeepTogether, Paragraph, Table

    parts: list[str] = []

    def _walk(node):
        if isinstance(node, Paragraph):
            parts.append(node.text)
        elif isinstance(node, Table):
            for row in node._cellvalues:
                for cell in row:
                    _walk(cell)
        elif isinstance(node, KeepTogether):
            for child in node._content:
                _walk(child)
        elif isinstance(node, list):
            for item in node:
                _walk(item)

    for f in flowables:
        _walk(f)
    return " || ".join(parts)


# ---------------------------------------------------------------------------
# A. Appendix 7.2 quote polish
# ---------------------------------------------------------------------------


class TestQuoteFilters:
    """Direct unit tests on the renderer's quality predicates."""

    def test_truncated_with_ellipsis_detected(self):
        pdf = _load_pdf()
        for s in (
            "시트가 얇고 피부에 잘 밀착돼서 ...",
            "촉촉하고 좋아도 ...",
            "촉촉하고 좋아도 …",
        ):
            assert pdf._looks_truncated(s), f"not detected: {s!r}"

    def test_clean_quote_not_truncated(self):
        pdf = _load_pdf()
        s = "시트가 얇고 피부에 잘 밀착돼서 편하게 사용했어요."
        assert not pdf._looks_truncated(s)

    def test_short_filler_caught_by_generic_check(self):
        pdf = _load_pdf()
        for s in (
            "은근히 편하네요!",
            "비추입",
            "좋아요",
            "그냥 만족",
            "생각보다 만족",
        ):
            assert pdf._looks_too_generic(s), f"not caught: {s!r}"

    def test_long_substantive_quote_passes_generic_check(self):
        pdf = _load_pdf()
        s = "발색이 정말 잘 받고 마무리도 좋아요. 색이 오래 가는 편입니다."
        assert not pdf._looks_too_generic(s)


class TestAppendixQuoteResolution:
    def test_truncated_summary_falls_through_to_attribute_template(self):
        pdf = _load_pdf()
        out = pdf._br3_appendix_quote_text(
            {
                "display_quote_summary": "촉촉하고 좋아도 ...",   # truncated
                "display_text": "촉촉하고 좋아도 ...",
                "text": "촉촉하고 좋아도 ...",
            },
            attribute_key="finish_texture", polarity="positive",
            profile_id="skincare_pad",
        )
        # Falls through to skincare_pad finish_texture
        # positive_side_summary ("촉촉하고 편안한 마무리감 ...").
        assert "촉촉하고 좋아도 ..." not in out
        assert "..." not in out
        assert "촉촉" in out

    def test_short_filler_summary_falls_through(self):
        pdf = _load_pdf()
        out = pdf._br3_appendix_quote_text(
            {
                "display_quote_summary": "은근히 편하네요!",
                "text": "은근히 편하네요!",
            },
            attribute_key="adhesion_base_interaction", polarity="positive",
            profile_id="skincare_pad",
        )
        # Falls through to skincare_pad adhesion positive summary
        # ("시트가 얇고 피부에 잘 밀착된다는 의견").
        assert "은근히 편하네요" not in out
        assert "밀착" in out

    def test_생각보다_만족스러웠어요_falls_through(self):
        pdf = _load_pdf()
        out = pdf._br3_appendix_quote_text(
            {
                "display_quote_summary": "생각보다 만족스러웠어요",
                "text": "생각보다 만족스러웠어요",
            },
            attribute_key="finish_texture", polarity="positive",
            profile_id="skincare_pad",
        )
        assert "생각보다 만족" not in out


def test_appendix_71_table_uses_label_override():
    """Appendix 7.1 attribute table now applies _tradeoff_label_for so
    "건조감/당김" reads as "건조감·당김 체감"."""
    pdf = _load_pdf()
    ar = {
        "corpus": {"n_reviews_analyzed": 100},
        "product": {"selected_profile_id": "skincare_pad"},
        "attributes": [
            {
                "key": "dryness_skin_texture",
                "label_ko": "건조감/당김",
                "n_positive": 18, "n_negative": 22, "n_mixed": 0,
                "top_quotes": [],
            },
        ],
        "monitoring_candidates": [],
    }
    cs = {
        "sorts_attempted": ["DATETIME_DESC"],
        "sorts_succeeded": ["DATETIME_DESC"],
        "sorts_failed": [],
        "partial_success": False,
        "review_count_analyzed": 100,
    }
    flowables = pdf._br3_section_appendix(
        analysis_report=ar, collection_summary=cs,
        styles=pdf._br3_styles(),
        run_id="r", generated_at=None,
    )
    text = _flatten(flowables)
    assert "건조감·당김 체감" in text
    # The legacy "건조감/당김" form must not leak into the rendered
    # appendix tables.
    assert "건조감/당김" not in text


# ---------------------------------------------------------------------------
# B. Methodology caveat conditional rendering
# ---------------------------------------------------------------------------


def test_methodology_uses_affirmative_when_all_sorts_succeeded():
    pdf = _load_pdf()
    ar = {"corpus": {"n_reviews_analyzed": 2115}}
    cs = {
        "sorts_attempted": [
            "DATETIME_DESC", "RATING_ASC", "RATING_DESC",
            "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
        ],
        "sorts_succeeded": [
            "DATETIME_DESC", "RATING_ASC", "RATING_DESC",
            "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
        ],
        "sorts_failed": [],
        "partial_success": False,
    }
    flowables = pdf._br3_section_methodology(
        analysis_report=ar, collection_summary=cs,
        styles=pdf._br3_styles(),
    )
    text = _flatten(flowables)
    # Affirmative line surfaces.
    assert "5개 정렬 수집이 완료되어" in text
    # Legacy caution must NOT surface on the success path.
    assert "수집이 실패한 경우" not in text


def test_methodology_uses_caveat_when_partial_success():
    pdf = _load_pdf()
    ar = {"corpus": {"n_reviews_analyzed": 1500}}
    cs = {
        "sorts_attempted": [
            "DATETIME_DESC", "RATING_ASC", "RATING_DESC",
            "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
        ],
        "sorts_succeeded": [
            "DATETIME_DESC", "RATING_DESC", "USEFUL_SCORE_DESC",
        ],
        "sorts_failed": ["RATING_ASC", "RECOMMENDED_DESC"],
        "partial_success": True,
    }
    flowables = pdf._br3_section_methodology(
        analysis_report=ar, collection_summary=cs,
        styles=pdf._br3_styles(),
    )
    text = _flatten(flowables)
    assert "수집이 실패한 경우" in text
    # Affirmative line must NOT surface on the failure path.
    assert "5개 정렬 수집이 완료되어" not in text


def test_methodology_uses_caveat_when_sorts_failed_nonempty():
    """sorts_failed alone (without partial_success flag) still
    triggers the caveat — both signals are checked."""
    pdf = _load_pdf()
    ar = {"corpus": {"n_reviews_analyzed": 1500}}
    cs = {
        "sorts_attempted": ["DATETIME_DESC", "RATING_ASC"],
        "sorts_succeeded": ["DATETIME_DESC"],
        "sorts_failed": ["RATING_ASC"],
        "partial_success": False,  # quirky: failed but flag not set
    }
    flowables = pdf._br3_section_methodology(
        analysis_report=ar, collection_summary=cs,
        styles=pdf._br3_styles(),
    )
    text = _flatten(flowables)
    assert "수집이 실패한 경우" in text


# ---------------------------------------------------------------------------
# C. Inspector — separate audit dangling from report-facing degradation
# ---------------------------------------------------------------------------


def test_inspector_quote_summary_section_clean_when_summary_is_clean(capsys):
    insp = _load_inspector()
    ar = {
        "attributes": [
            {
                "key": "finish_texture",
                "top_quotes": [
                    {
                        "review_id": "r1",
                        "polarity": "positive",
                        "text": "촉촉하고 좋아도 ...",   # raw dangling
                        "display_text": "촉촉하고 좋아도",  # display dangling
                        "display_quote_summary":
                            "촉촉한 마무리를 만족 포인트로 언급합니다.",
                    },
                ],
            },
        ],
    }
    warnings: list[str] = []
    insp.inspect_report_quote_summary_quality(ar, warnings)
    # No warnings: summary is clean.
    assert warnings == []


def test_inspector_quote_summary_section_warns_on_truncated_summary():
    insp = _load_inspector()
    ar = {
        "attributes": [
            {
                "key": "finish_texture",
                "top_quotes": [
                    {
                        "review_id": "r1",
                        "polarity": "positive",
                        "display_quote_summary": "촉촉하고 좋아도 ...",
                    },
                ],
            },
        ],
    }
    warnings: list[str] = []
    insp.inspect_report_quote_summary_quality(ar, warnings)
    assert any("truncated" in w for w in warnings)


def test_inspector_audit_dangling_demoted_when_summary_clean():
    """Pass-16: display_text dangling alone is audit-info, not a
    blocking warning, when the same quote carries a clean summary."""
    insp = _load_inspector()
    ar = {
        "attributes": [
            {
                "key": "finish_texture",
                "top_quotes": [
                    {
                        "review_id": "r1",
                        "polarity": "positive",
                        "display_text": "촉촉하고 좋아도",  # dangling
                        "display_quote_summary":
                            "촉촉한 마무리를 만족 포인트로 언급합니다.",
                    },
                ],
            },
        ],
    }
    warnings: list[str] = []
    insp.inspect_display_text_coverage(ar, warnings)
    # Dangling display_text → no warning when summary is clean.
    assert warnings == []


def test_inspector_audit_dangling_blocks_when_summary_also_dangling():
    insp = _load_inspector()
    ar = {
        "attributes": [
            {
                "key": "finish_texture",
                "top_quotes": [
                    {
                        "review_id": "r1",
                        "polarity": "positive",
                        "display_text": "촉촉하고 좋아도",  # dangling
                        "display_quote_summary": "좋아도",  # also dangling
                    },
                ],
            },
        ],
    }
    warnings: list[str] = []
    insp.inspect_display_text_coverage(ar, warnings)
    # No clean summary → display_text dangling becomes a real warning.
    assert any("display_text dangling" in w for w in warnings)
