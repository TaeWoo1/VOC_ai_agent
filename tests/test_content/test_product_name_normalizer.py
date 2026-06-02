"""Tests for the product-name normalizer.

The OliveYoung-style merch headline carries promo brackets, ranking
badges, gift bundles, and SKU-shape tokens stacked around the actual
brand + product name. The normalizer splits these into four
report-friendly fields so the seller PDF cover doesn't read as a
merch-shelf title and republishing isn't broken by expired promo
terms.
"""
from __future__ import annotations

import pytest

from src.voc.content.product_name_normalizer import (
    NormalizedProductName,
    normalize_product_name,
)


# ---------------------------------------------------------------------------
# 1. Spec-locked cases (the user-supplied examples from pass-15)
# ---------------------------------------------------------------------------


class TestSpecLockedExamples:
    def test_medihelpad_run003_headline(self):
        out = normalize_product_name(
            "[1위 패드] 메디힐 더마 패드 200매 대용량 기획 세트 7종 골라담기"
        )
        assert out["display_product_name"] == "메디힐 더마 패드"
        assert "200매 대용량 기획 세트" in out["offer_context"]
        assert "7종 골라담기" in out["offer_context"]
        # Pass-19I: bracket characters are stripped from the prose
        # context fields so the operator surface reads as a clean
        # bullet list (e.g. "1위 패드 · 단독 · 기획"). The bracket
        # captured the source span; the stripped form is what the
        # PDF / cardnews surfaces consume.
        assert "1위 패드" in out["promo_context"]
        assert out["report_title"] == "메디힐 더마 패드 리뷰 인사이트 리포트"

    def test_gift_bundle_lands_in_offer_not_promo(self):
        out = normalize_product_name("메디힐 더마 패드 2개 사면 1개 증정")
        assert out["display_product_name"] == "메디힐 더마 패드"
        assert "2개 사면 1개 증정" in out["offer_context"]
        # Pure marketing badges still go to promo_context; gift
        # bundles are SKU-shape info per the spec.
        assert out["promo_context"] == ""

    def test_multiple_promo_brackets(self):
        out = normalize_product_name(
            "[단독] [기획] 라네즈 워터뱅크 블루 ★1+1 한정★"
        )
        assert out["display_product_name"] == "라네즈 워터뱅크 블루"
        # Pass-19I: brackets stripped on the operator surface.
        assert "단독" in out["promo_context"]
        assert "기획" in out["promo_context"]
        # ★1+1 한정★ is decorated promo, lands in promo_context.
        assert "1+1" in out["promo_context"] or "★" in out["promo_context"]

    def test_size_only_lands_in_offer(self):
        out = normalize_product_name(
            "에스트라 아토배리어 365 인텐시브 크림 80ml 대용량"
        )
        assert out["display_product_name"] == "에스트라 아토배리어 365 인텐시브 크림"
        assert "80ml 대용량" in out["offer_context"]
        assert out["promo_context"] == ""


# ---------------------------------------------------------------------------
# 2. Audit invariants
# ---------------------------------------------------------------------------


class TestAuditInvariants:
    def test_raw_product_name_preserved_verbatim(self):
        raw = "[1위 패드] 메디힐 더마 패드 200매 대용량 기획 세트 7종 골라담기"
        out = normalize_product_name(raw)
        assert out["raw_product_name"] == raw  # never paraphrased

    def test_empty_input_returns_empty_display_with_safe_title(self):
        out = normalize_product_name("")
        assert out["display_product_name"] == ""
        assert out["report_title"] == "리뷰 인사이트 리포트"

    def test_none_input_treated_as_empty(self):
        out = normalize_product_name(None)
        assert out["raw_product_name"] == ""
        assert out["display_product_name"] == ""

    def test_whitespace_only_input_is_safe(self):
        out = normalize_product_name("   ")
        assert out["display_product_name"] == ""

    def test_clean_name_passes_through_unchanged(self):
        out = normalize_product_name("메디힐 더마 패드")
        assert out["display_product_name"] == "메디힐 더마 패드"
        assert out["offer_context"] == ""
        assert out["promo_context"] == ""

    def test_normalizer_does_not_paraphrase_brand_tokens(self):
        """Every output token should be a substring of the input —
        no synthesized words. (Trailing decorative chars stripped is
        OK; we just don't fabricate brand names.)"""
        raw = "[1위] 라네즈 워터뱅크 블루 1+1"
        out = normalize_product_name(raw)
        # The display_name's tokens (split on space) should each
        # appear in the input.
        for tok in out["display_product_name"].split():
            assert tok in raw, f"normalizer fabricated token: {tok!r}"


# ---------------------------------------------------------------------------
# 3. Report title shape
# ---------------------------------------------------------------------------


class TestReportTitle:
    def test_report_title_appends_canonical_suffix(self):
        out = normalize_product_name("메디힐 더마 패드")
        assert out["report_title"] == "메디힐 더마 패드 리뷰 인사이트 리포트"

    def test_report_title_uses_display_not_raw(self):
        out = normalize_product_name("[1위] 메디힐 더마 패드")
        # Title built from display, not raw — no "[1위]" in it.
        assert "[1위]" not in out["report_title"]
        assert out["report_title"] == "메디힐 더마 패드 리뷰 인사이트 리포트"


# ---------------------------------------------------------------------------
# 4. Type contract
# ---------------------------------------------------------------------------


def test_returns_typed_dict_with_all_keys():
    out = normalize_product_name("메디힐 더마 패드")
    expected_keys = {
        "raw_product_name",
        "display_product_name",
        "offer_context",
        "promo_context",
        "report_title",
    }
    assert set(out.keys()) == expected_keys
    # Every value is a str (no None).
    for v in out.values():
        assert isinstance(v, str)
