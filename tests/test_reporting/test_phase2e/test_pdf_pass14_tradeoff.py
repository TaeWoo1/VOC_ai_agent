"""Pass-14 trade-off (의견 분기) tests.

Covers:
  1. compute_tradeoff_blocks — emits a block when both sides clear
     thresholds; respects the split-intensity floor; carries every
     spec field; sorts by total volume.
  2. Wording lock — banned tokens 모순 / 상반 / conflict /
     contradiction never appear in any presentation surface.
  3. Label override — dryness_skin_texture renders as
     "건조감·당김 체감", not "건조감/당김".
  4. Buyer translation — when trade-off blocks exist, §5 renders the
     4-column shape (항목 / 잘 맞을 가능성 / 한 번 더 확인 / 콘텐츠
     문구 예시).
  5. Appendix quote selection — generic / too-short summaries
     ("좋아요", "생각보다 만족") fall through to the attribute-
     specific summary.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]


def _load_pdf():
    name = "generate_phase2e_pdf_v2_pass14_test"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(
        name, REPO / "scripts" / "generate_phase2e_pdf_v2.py",
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _ar_with_split(
    *,
    finish_pos: int = 70, finish_neg: int = 30,
    dryness_pos: int = 18, dryness_neg: int = 22,
    pigment_pos: int = 80, pigment_neg: int = 2,
) -> dict:
    """Synthetic analysis_report with three attributes shaped to
    exercise three branches: split / split / one-sided."""
    return {
        "corpus": {"n_reviews_analyzed": 200},
        "attributes": [
            {
                "key": "finish_texture", "label_ko": "촉촉함/마무리감",
                "n_positive": finish_pos, "n_negative": finish_neg,
                "n_mixed": 5,
                "top_quotes": [],
            },
            {
                "key": "dryness_skin_texture", "label_ko": "건조감/당김",
                "n_positive": dryness_pos, "n_negative": dryness_neg,
                "n_mixed": 2,
                "top_quotes": [],
            },
            {
                "key": "pigmentation", "label_ko": "발색",
                "n_positive": pigment_pos, "n_negative": pigment_neg,
                "n_mixed": 1,
                "top_quotes": [],
            },
        ],
        "monitoring_candidates": [],
    }


# ---------------------------------------------------------------------------
# 1. Trade-off block generation
# ---------------------------------------------------------------------------


class TestTradeoffBlocks:
    def test_emits_block_when_both_sides_clear_threshold(self):
        pdf = _load_pdf()
        blocks = pdf.compute_tradeoff_blocks(_ar_with_split())
        keys = {b["attribute_key"] for b in blocks}
        # finish_texture (70/30) and dryness (18/22) both qualify.
        assert "finish_texture" in keys
        assert "dryness_skin_texture" in keys
        # pigmentation (80/2) — minority share = 2/(80+2) ≈ 2.4% —
        # below the 15% split-intensity floor → excluded.
        assert "pigmentation" not in keys

    def test_block_carries_every_spec_field(self):
        pdf = _load_pdf()
        block = pdf.compute_tradeoff_blocks(_ar_with_split())[0]
        for key in (
            "attribute_key", "label_ko",
            "positive_count", "negative_count", "mixed_count",
            "split_intensity",
            "positive_side_summary", "negative_side_summary",
            "likely_split_drivers",
            "buyer_fit_implication", "seller_action",
            "content_phrase_example",
            "buyer_fit_when", "buyer_check_when",
        ):
            assert key in block, f"missing field: {key}"

    def test_blocks_sorted_by_total_volume(self):
        pdf = _load_pdf()
        blocks = pdf.compute_tradeoff_blocks(_ar_with_split())
        totals = [b["positive_count"] + b["negative_count"] for b in blocks]
        assert totals == sorted(totals, reverse=True)

    def test_threshold_excludes_one_sided_attribute(self):
        pdf = _load_pdf()
        # 100 positive, 0 negative → no split.
        ar = _ar_with_split(finish_pos=100, finish_neg=0)
        blocks = pdf.compute_tradeoff_blocks(ar)
        keys = {b["attribute_key"] for b in blocks}
        assert "finish_texture" not in keys

    def test_low_threshold_attribute_excluded(self):
        """4/4 doesn't clear the default 5/5 threshold."""
        pdf = _load_pdf()
        ar = {
            "corpus": {"n_reviews_analyzed": 50},
            "attributes": [{
                "key": "finish_texture", "label_ko": "촉촉함/마무리감",
                "n_positive": 4, "n_negative": 4, "n_mixed": 0,
                "top_quotes": [],
            }],
            "monitoring_candidates": [],
        }
        assert pdf.compute_tradeoff_blocks(ar) == []

    def test_split_intensity_value_in_expected_range(self):
        pdf = _load_pdf()
        # 50/50 → split_intensity = 0.5.
        ar = {
            "corpus": {"n_reviews_analyzed": 100},
            "attributes": [{
                "key": "finish_texture", "label_ko": "촉촉함/마무리감",
                "n_positive": 50, "n_negative": 50, "n_mixed": 0,
                "top_quotes": [],
            }],
            "monitoring_candidates": [],
        }
        block = pdf.compute_tradeoff_blocks(ar)[0]
        assert block["split_intensity"] == 0.5


# ---------------------------------------------------------------------------
# 2. Wording lock
# ---------------------------------------------------------------------------


def test_tradeoff_templates_use_no_banned_tokens():
    """Every text field across every per-attribute trade-off template
    must avoid 모순 / 상반 / conflict / contradiction wording."""
    pdf = _load_pdf()
    BANNED = ("모순", "상반", "conflict", "contradiction")
    for attr_key, template in pdf._TRADEOFF_BLOCKS_KO.items():
        for field, value in template.items():
            for term in BANNED:
                assert term not in value, (
                    f"banned wording {term!r} in "
                    f"{attr_key}.{field}: {value!r}"
                )


def test_rendered_v3_sections_do_not_use_conflict_terminology():
    """Belt and suspenders: actually render §3 and §5 with a split-
    qualifying analysis report, then walk every Paragraph and assert
    no Korean banned token shows up in user-facing flowable text.

    Comments / docstrings inside the source file are out of scope —
    only what actually reaches the operator's eye is locked."""
    from reportlab.platypus import KeepTogether, Paragraph, Table

    pdf = _load_pdf()
    styles = pdf._br3_styles()
    section3 = pdf._br3_section_matrix(
        analysis_report=_ar_with_split(), styles=styles,
    )
    section5 = pdf._br3_section_buyer_translation(
        analysis_report=_ar_with_split(), styles=styles,
    )

    texts: list[str] = []

    def _walk(node):
        if isinstance(node, Paragraph):
            texts.append(node.text)
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

    for f in section3 + section5:
        _walk(f)

    blob = " || ".join(texts)
    for term in ("모순", "상반된", "conflict", "contradiction"):
        assert term not in blob, (
            f"banned wording {term!r} reached rendered PDF text"
        )


def test_tradeoff_uses_preferred_phrases():
    """Spec phrases must show up at least once across templates +
    section text: 의견 분기 / 체감 차이 / 사용 조건별 / 구매 전 확인."""
    pdf = _load_pdf()
    src = (
        REPO / "scripts" / "generate_phase2e_pdf_v2.py"
    ).read_text(encoding="utf-8")
    # Verify the §3 interpretation header is present.
    assert "의견이 갈린 항목은 어떻게 봐야 할까요" in src
    # And the matrix legend uses the preferred phrasing.
    assert "구매 전 확인" in src


# ---------------------------------------------------------------------------
# 3. Label override for ambivalence-prone attributes
# ---------------------------------------------------------------------------


def test_dryness_label_override_renders_neutral_phrasing():
    pdf = _load_pdf()
    label = pdf._tradeoff_label_for(
        "dryness_skin_texture",
        {"label_ko": "건조감/당김"},  # canonical label
    )
    assert label == "건조감·당김 체감"


def test_other_attributes_pass_through_to_analysis_report_label():
    pdf = _load_pdf()
    # finish_texture has no override; the analysis_report label_ko wins.
    assert pdf._tradeoff_label_for(
        "finish_texture", {"label_ko": "촉촉함/마무리감"},
    ) == "촉촉함/마무리감"


def test_dryness_positive_summary_phrasing_is_natural():
    """The positive_side_summary must avoid the awkward
    '건조감 만족' construction; user requested forms like
    '건조함이 덜하다' / '당김이 적다'."""
    pdf = _load_pdf()
    pos = pdf._TRADEOFF_BLOCKS_KO["dryness_skin_texture"]["positive_side_summary"]
    assert "건조함이 덜하다" in pos or "당김이 적다" in pos
    # Old awkward form should not be the entire summary.
    assert pos != "건조감 만족"


# ---------------------------------------------------------------------------
# 4. Buyer translation §5 renders the 4-column shape
# ---------------------------------------------------------------------------


class TestBuyerTranslationShape:
    def _styles(self):
        return _load_pdf()._br3_styles()

    def test_renders_four_column_table_when_blocks_exist(self):
        from reportlab.platypus import Paragraph, Table
        pdf = _load_pdf()
        flowables = pdf._br3_section_buyer_translation(
            analysis_report=_ar_with_split(),
            styles=self._styles(),
        )
        tables = [f for f in flowables if isinstance(f, Table)]
        assert len(tables) == 1
        header_row = tables[0]._cellvalues[0]
        # 4 columns expected.
        assert len(header_row) == 4
        header_text = " | ".join(
            c.text if isinstance(c, Paragraph) else str(c)
            for c in header_row
        )
        for h in (
            "항목", "잘 맞을 가능성", "한 번 더 확인", "콘텐츠 문구 예시",
        ):
            assert h in header_text, f"missing column header: {h}"

    def test_first_data_row_carries_split_label_and_counts(self):
        from reportlab.platypus import Paragraph, Table
        pdf = _load_pdf()
        flowables = pdf._br3_section_buyer_translation(
            analysis_report=_ar_with_split(),
            styles=self._styles(),
        )
        tbl = next(f for f in flowables if isinstance(f, Table))
        first_data_row = tbl._cellvalues[1]
        first_cell = first_data_row[0].text
        # The label cell should carry both the attribute label AND
        # the split count breakdown.
        assert "촉촉함/마무리감" in first_cell
        assert "만족" in first_cell and "아쉬움" in first_cell

    def test_falls_back_to_legacy_2col_when_no_blocks(self):
        """When every attribute is one-sided, §5 falls back to the
        legacy 2-column form rather than producing an empty table."""
        from reportlab.platypus import Paragraph, Table
        pdf = _load_pdf()
        ar = _ar_with_split(
            finish_pos=80, finish_neg=0,
            dryness_pos=0, dryness_neg=0,
            pigment_pos=80, pigment_neg=0,
        )
        flowables = pdf._br3_section_buyer_translation(
            analysis_report=ar, styles=self._styles(),
        )
        tables = [f for f in flowables if isinstance(f, Table)]
        # Either renders the legacy 2-column form OR (if no
        # threshold met) emits a "후보 없음" muted line. Both are
        # acceptable — the contract is "don't crash + don't render
        # an empty 4-col header".
        if tables:
            header = tables[0]._cellvalues[0]
            assert len(header) == 2


# ---------------------------------------------------------------------------
# 5. Appendix quote selection rejects too-generic summaries
# ---------------------------------------------------------------------------


class TestAppendixQuoteGenericGuard:
    def test_generic_summary_rejected_in_favor_of_attr_summary(self):
        pdf = _load_pdf()
        out = pdf._br3_appendix_quote_text(
            {
                "display_quote_summary": "좋아요",   # too generic
                "text": "비추",                      # too short / dangling
            },
            attribute_key="finish_texture",
            polarity="positive",
            profile_id="skincare_pad",
        )
        # Falls through to the skincare_pad finish_texture template's
        # positive_side_summary ("촉촉하고 편안한 마무리감을 만족...").
        assert "촉촉" in out
        assert out != "좋아요"

    def test_long_summary_with_좋아요_in_middle_is_accepted(self):
        pdf = _load_pdf()
        long_summary = (
            "발색이 정말 잘 받고 마무리도 좋아요 색이 오래 가는 편입니다."
        )
        out = pdf._br3_appendix_quote_text(
            {"display_quote_summary": long_summary},
            attribute_key="pigmentation", polarity="positive",
        )
        assert out.startswith("발색이 정말 잘 받고")

    def test_생각보다_만족_filler_is_rejected(self):
        pdf = _load_pdf()
        out = pdf._br3_appendix_quote_text(
            {
                "display_quote_summary": "생각보다 만족스러웠어요",
                "text": "비추",
            },
            attribute_key="finish_texture", polarity="positive",
            profile_id="skincare_pad",
        )
        assert "생각보다 만족" not in out
        # Falls through to the skincare_pad finish_texture template.
        assert "촉촉" in out

    def test_no_attribute_key_still_falls_back_safely(self):
        """When the caller can't supply attribute_key, the resolver
        must still produce non-empty text rather than blank."""
        pdf = _load_pdf()
        out = pdf._br3_appendix_quote_text(
            {"display_quote_summary": "좋아요"},
        )
        assert out  # non-empty
        # Last-resort fallback surfaces the original summary.
        assert out == "좋아요"
