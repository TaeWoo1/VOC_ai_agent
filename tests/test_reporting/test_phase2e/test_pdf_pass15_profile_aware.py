"""Pass-15 tests: profile-aware trade-off narratives + raw-vs-display
product name surfacing.

Scope:
  1. Trade-off blocks resolve per profile_id (skincare_pad,
     base_makeup, sunscreen, fallback_generic).
  2. Block carries `profile_id` field.
  3. PDF cover uses display_product_name + report_title; raw merch
     name does NOT appear on the cover.
  4. Appendix metadata table surfaces raw + display + offer + promo.
  5. Cardnews surfaces use display_product_name in `name_ko`.
  6. Banned wording ("상반", "모순", "contradiction") absent across
     every profile's templates.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]


def _load_pdf():
    name = "generate_phase2e_pdf_v2_pass15_test"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(
        name, REPO / "scripts" / "generate_phase2e_pdf_v2.py",
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _ar_with_split_for_profile(profile_id: str) -> dict:
    """Synthetic analysis_report whose product carries the given
    profile_id, with a split finish_texture attribute."""
    return {
        "corpus": {"n_reviews_analyzed": 200},
        "product": {
            "slug": "test",
            "selected_profile_id": profile_id,
            "name_ko": "[1위] 테스트 제품 200ml 대용량",
            "raw_product_name": "[1위] 테스트 제품 200ml 대용량",
            "display_product_name": "테스트 제품",
            "offer_context": "200ml 대용량",
            "promo_context": "[1위]",
            "report_title": "테스트 제품 리뷰 인사이트 리포트",
            "category": "스킨케어 > 패드",
            "source_url": "https://example.invalid/p?goodsNo=A1",
            "image_url": None,
        },
        "attributes": [
            {
                "key": "finish_texture", "label_ko": "촉촉함/마무리감",
                "n_positive": 70, "n_negative": 30, "n_mixed": 5,
                "top_quotes": [],
            },
        ],
        "monitoring_candidates": [],
    }


# ---------------------------------------------------------------------------
# 1. Profile-aware template resolution
# ---------------------------------------------------------------------------


class TestProfileAwareTradeoff:
    def test_skincare_pad_uses_skincare_pad_wording(self):
        pdf = _load_pdf()
        block = pdf.compute_tradeoff_blocks(
            _ar_with_split_for_profile("skincare_pad")
        )[0]
        assert block["profile_id"] == "skincare_pad"
        # skincare_pad finish_texture: "촉촉하고 편안한 마무리감"
        assert "촉촉" in block["positive_side_summary"]

    def test_base_makeup_uses_base_makeup_wording(self):
        pdf = _load_pdf()
        block = pdf.compute_tradeoff_blocks(
            _ar_with_split_for_profile("base_makeup")
        )[0]
        assert block["profile_id"] == "base_makeup"
        # base_makeup finish_texture: "피부 표현과 밀착감"
        assert "밀착" in block["positive_side_summary"]
        assert "두꺼움" in block["negative_side_summary"] or \
               "끼임" in block["negative_side_summary"] or \
               "무너짐" in block["negative_side_summary"]

    def test_sunscreen_uses_sunscreen_wording(self):
        pdf = _load_pdf()
        block = pdf.compute_tradeoff_blocks(
            _ar_with_split_for_profile("sunscreen")
        )[0]
        assert block["profile_id"] == "sunscreen"
        # sunscreen finish_texture: 산뜻함 + 백탁/눈시림
        assert "산뜻" in block["positive_side_summary"]
        assert ("백탁" in block["negative_side_summary"]
                or "눈시림" in block["negative_side_summary"])

    def test_lip_makeup_uses_lip_wording(self):
        pdf = _load_pdf()
        block = pdf.compute_tradeoff_blocks(
            _ar_with_split_for_profile("lip_makeup")
        )[0]
        assert block["profile_id"] == "lip_makeup"
        # lip_makeup finish_texture mentions 갈라짐 / 끈적임 / 건조함.
        body = (
            block["negative_side_summary"]
            + " " + block["likely_split_drivers"]
        )
        assert "입술" in body or "갈라짐" in block["negative_side_summary"]

    def test_unknown_profile_falls_back_to_generic(self):
        pdf = _load_pdf()
        block = pdf.compute_tradeoff_blocks(
            _ar_with_split_for_profile("nonexistent_profile_xyz")
        )[0]
        # Falls through to fallback_generic → which has "사용감 / 마무리"
        # in its finish_texture template.
        assert "사용감" in block["positive_side_summary"] \
            or "마무리" in block["positive_side_summary"]

    def test_no_profile_id_falls_back_to_generic(self):
        pdf = _load_pdf()
        ar = _ar_with_split_for_profile("skincare_pad")
        # Strip profile_id so the resolver has nothing.
        ar["product"].pop("selected_profile_id", None)
        block = pdf.compute_tradeoff_blocks(ar)[0]
        # Must still produce a block, with profile_id falling to
        # fallback_generic.
        assert block["profile_id"] == "fallback_generic"


# ---------------------------------------------------------------------------
# 2. Banned-wording lock across every profile
# ---------------------------------------------------------------------------


def test_no_profile_template_uses_banned_tokens():
    pdf = _load_pdf()
    BANNED = ("모순", "상반", "contradiction", "conflict")
    for profile_id, attr_dict in pdf._TRADEOFF_BLOCKS_BY_PROFILE.items():
        for attr_key, template in attr_dict.items():
            for field, value in template.items():
                if not isinstance(value, str):
                    continue
                for term in BANNED:
                    assert term not in value, (
                        f"banned wording {term!r} in "
                        f"{profile_id}/{attr_key}/{field}: {value!r}"
                    )


def test_every_profile_has_finish_texture_template():
    """finish_texture is the universal split attribute — every
    profile's dict must carry it so the dispatcher always lands a
    profile-specific template (rather than fallback_generic) for
    the most common case."""
    pdf = _load_pdf()
    for profile_id in (
        "skincare_pad", "skincare_general", "base_makeup",
        "lip_makeup", "sunscreen", "cleansing", "fallback_generic",
    ):
        attr_dict = pdf._TRADEOFF_BLOCKS_BY_PROFILE[profile_id]
        assert "finish_texture" in attr_dict, (
            f"profile {profile_id} missing finish_texture template"
        )


# ---------------------------------------------------------------------------
# 3. PDF cover uses display_product_name + report_title
# ---------------------------------------------------------------------------


def _flatten_text(flowables) -> str:
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


class TestCoverUsesDisplayName:
    def test_cover_renders_report_title(self):
        pdf = _load_pdf()
        ar = _ar_with_split_for_profile("skincare_pad")
        flowables = pdf._br3_section_cover(
            analysis_report=ar, run_id="r1",
            generated_at="2026-05-02T00:00:00Z",
            styles=pdf._br3_styles(),
        )
        text = _flatten_text(flowables)
        assert "테스트 제품 리뷰 인사이트 리포트" in text
        assert "테스트 제품" in text  # display name as a section

    def test_cover_does_not_show_raw_promo_brackets(self):
        pdf = _load_pdf()
        ar = _ar_with_split_for_profile("skincare_pad")
        flowables = pdf._br3_section_cover(
            analysis_report=ar, run_id="r1",
            generated_at="2026-05-02T00:00:00Z",
            styles=pdf._br3_styles(),
        )
        text = _flatten_text(flowables)
        assert "[1위]" not in text
        # Offer context surfaces in the muted disclosure line.
        assert "200ml 대용량" in text

    def test_cover_falls_back_to_legacy_name_ko_when_split_missing(self):
        """Pre-pass-15 analysis_report on disk doesn't carry the
        new fields — cover must still render rather than crash."""
        pdf = _load_pdf()
        ar = {
            "corpus": {"n_reviews_analyzed": 100},
            "product": {"name_ko": "Legacy Product", "slug": "legacy"},
        }
        flowables = pdf._br3_section_cover(
            analysis_report=ar, run_id=None, generated_at=None,
            styles=pdf._br3_styles(),
        )
        text = _flatten_text(flowables)
        assert "Legacy Product" in text


# ---------------------------------------------------------------------------
# 4. Appendix surfaces every part of the product-name split
# ---------------------------------------------------------------------------


def test_appendix_metadata_carries_all_product_name_fields():
    pdf = _load_pdf()
    ar = _ar_with_split_for_profile("skincare_pad")
    cs = {
        "sorts_attempted": ["DATETIME_DESC"],
        "sorts_succeeded": ["DATETIME_DESC"],
        "sorts_failed": [],
        "partial_success": False,
        "review_count_analyzed": 200,
    }
    flowables = pdf._br3_section_appendix(
        analysis_report=ar, collection_summary=cs,
        styles=pdf._br3_styles(),
        run_id="run-test", generated_at="2026-05-02T00:00:00Z",
    )
    text = _flatten_text(flowables)
    # All four name fields surfaced in the appendix metadata table.
    assert "raw_product_name" in text
    assert "display_product_name" in text
    assert "offer_context" in text
    assert "promo_context" in text
    # The values are present too.
    assert "[1위] 테스트 제품 200ml 대용량" in text
    assert "테스트 제품" in text


# ---------------------------------------------------------------------------
# 5. Cardnews uses display_product_name (no raw merch headline)
# ---------------------------------------------------------------------------


def test_cardnews_product_block_uses_cleaned_name():
    from src.voc.content.cardnews_buyer_journey import (
        build_buyer_journey_cardnews,
    )
    ar = _ar_with_split_for_profile("skincare_pad")
    cn = build_buyer_journey_cardnews(
        ar,
        sorts_attempted=["DATETIME_DESC"],
        sorts_succeeded=["DATETIME_DESC"],
        sorts_failed=[],
        partial_success=False,
    )
    cn_product = cn["product"]
    # Legacy field reads as the cleaned name now.
    assert cn_product["name_ko"] == "테스트 제품"
    # New explicit fields surface for downstream consumers.
    assert cn_product["display_product_name"] == "테스트 제품"
    assert cn_product["raw_product_name"] == "[1위] 테스트 제품 200ml 대용량"
    assert cn_product["offer_context"] == "200ml 대용량"


def test_cardnews_falls_back_to_name_ko_when_split_missing():
    from src.voc.content.cardnews_buyer_journey import (
        build_buyer_journey_cardnews,
    )
    ar = _ar_with_split_for_profile("skincare_pad")
    # Strip the new fields → legacy code path.
    for k in (
        "display_product_name", "raw_product_name",
        "offer_context", "promo_context", "report_title",
    ):
        ar["product"].pop(k, None)
    cn = build_buyer_journey_cardnews(
        ar,
        sorts_attempted=["DATETIME_DESC"],
        sorts_succeeded=["DATETIME_DESC"],
        sorts_failed=[],
        partial_success=False,
    )
    # Falls back to legacy name_ko verbatim.
    assert cn["product"]["name_ko"] == "[1위] 테스트 제품 200ml 대용량"


# ---------------------------------------------------------------------------
# 6. Adapter integration — the analysis_report adapter populates the
#    pass-15 fields on the product block
# ---------------------------------------------------------------------------


def test_adapter_populates_product_name_split_fields():
    """When the analysis_report adapter (productreportdata_to_analysis_report)
    runs against ProductReportData, the resulting `product` block
    must carry raw_product_name / display_product_name / offer_context
    / promo_context / report_title."""
    from src.voc.content.adapters.from_phase2e import (
        productreportdata_to_analysis_report,
    )
    from src.voc.reporting.phase2e.report import ProductReportData

    data = ProductReportData(
        product_id="A0001",
        product_name="[1위 패드] 메디힐 더마 패드 200매 대용량 기획 세트 7종 골라담기",
        n_reviews=100,
        n_records=0,
        n_mixed_reviews=0,
        n_with_tradeoff=0,
        attribute_summaries={},
        tradeoff_pairs={},
        mixed_attribute_pairs={},
        delivery_condition_records_total=0,
    )
    out = productreportdata_to_analysis_report(
        data, source_url="https://example.invalid/p?goodsNo=A1",
        primary_sort="DATETIME_DESC",
        sampling_strategy="latest_only",
    )
    product = out["product"]
    assert product["raw_product_name"] == \
        "[1위 패드] 메디힐 더마 패드 200매 대용량 기획 세트 7종 골라담기"
    assert product["display_product_name"] == "메디힐 더마 패드"
    assert "200매 대용량 기획 세트" in product["offer_context"]
    # Pass-19I: bracket chars stripped on the operator surface.
    assert "1위 패드" in product["promo_context"]
    assert product["report_title"] == "메디힐 더마 패드 리뷰 인사이트 리포트"
