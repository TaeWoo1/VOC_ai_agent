"""Pass-19: cushion / base-makeup category pivot.

Run-004 reproducer (goodsNo=A000000253122, cushion):
  category = "메이크업 > 베이스메이크업 > 쿠션"
  raw_product_name = "[퓌X민스코] 퓌 올데이 커버 블랙 쿠션 리필기획(본품+리필) 5종"

Pre-pass-19 the report had three independent leaks:
  (a) `select_profile_id` only knew skincare_pad / makeup_blush; cushion
      categories silently routed to `default`, dropping out of the
      profile-aware narrative dispatch.
  (b) `_LAST_RESORT_LABEL_KO[adhesion_base_interaction]` = "패드 밀착력"
      surfaced in non-pad reports.
  (c) `_BR3_BUYER_TRANSLATIONS_KO` and the §6.2 `why_phrase` dict
      were profile-blind and hard-coded skincare-pad copy
      ("200매 대용량 가성비", "보습 보강 단계", "보습 효과 기대치").
  (d) product_name_normalizer left "리필기획( ) 5종" residue and
      dropped collab brackets ("[퓌X민스코]") onto the report cover.

Pass-19 fixes all four; the tests below lock the contract.
"""
from __future__ import annotations

import pytest

from src.voc.content.profiles import (
    PROFILE_BASE_MAKEUP,
    PROFILE_DEFAULT,
    PROFILE_MAKEUP_BLUSH,
    PROFILE_SKINCARE_PAD,
    select_profile_id,
)
from src.voc.content.product_name_normalizer import (
    normalize_product_name,
)
from src.voc.content.quote_summary_normalizer import (
    attribute_specific_summary,
    is_degraded_quote_summary,
    normalize_display_quote_summary,
)


# ---------------------------------------------------------------------------
# A. Profile mapping (category → base_makeup)
# ---------------------------------------------------------------------------


class TestBaseMakeupProfileMapping:
    def test_cushion_breadcrumb_maps_to_base_makeup(self):
        assert select_profile_id(
            category_path=["메이크업", "베이스메이크업", "쿠션"],
            product_name=(
                "[퓌X민스코] 퓌 올데이 커버 블랙 쿠션 리필기획(본품+리필) 5종"
            ),
        ) == PROFILE_BASE_MAKEUP

    @pytest.mark.parametrize("leaf", [
        "쿠션",
        "파운데이션",
        "컨실러",
        "BB크림",
        "CC크림",
        "톤업크림",
        "베이스메이크업",
    ])
    def test_each_base_keyword_routes_to_base_makeup(self, leaf):
        assert select_profile_id(
            category_path=["메이크업", "베이스메이크업", leaf],
            product_name="브랜드 제품",
        ) == PROFILE_BASE_MAKEUP

    @pytest.mark.parametrize("excl_keyword", [
        "립앤치크",
        "립스틱",
        "아이라이너",
        "마스카라",
        "블러셔",
    ])
    def test_lip_eye_blush_block_base_routing(self, excl_keyword):
        """A "립앤치크 쿠션" or "마스카라" carries 쿠션 / brush
        terminology but is not a base-makeup product."""
        result = select_profile_id(
            category_path=["메이크업", excl_keyword, "쿠션"],
            product_name="브랜드 쿠션 제품",
        )
        # Either falls through to blush or default — never base_makeup.
        assert result != PROFILE_BASE_MAKEUP

    def test_pad_still_wins_over_base_makeup(self):
        """Pre-existing skincare_pad routing must keep precedence.
        A "패드" keyword always wins regardless of other markers."""
        assert select_profile_id(
            category_path=["스킨케어", "토너패드"],
            product_name="더마 패드",
        ) == PROFILE_SKINCARE_PAD

    def test_blush_keyword_wins_over_base_keyword(self):
        """"블러셔 쿠션" routes to blush, not base."""
        assert select_profile_id(
            category_path=["메이크업", "블러셔"],
            product_name="브랜드 블러셔 쿠션",
        ) == PROFILE_MAKEUP_BLUSH

    def test_unrecognized_category_still_default(self):
        assert select_profile_id(
            category_path=["디퓨저"],
            product_name="모르는 카테고리 제품",
        ) == PROFILE_DEFAULT


# ---------------------------------------------------------------------------
# B. base_makeup quote-summary fallbacks
# ---------------------------------------------------------------------------


class TestBaseMakeupQuoteSummaries:
    @pytest.mark.parametrize("attr,polarity,expected_substr", [
        # User-spec wording, locked.
        ("finish_texture", "positive", "얇고 편안한 피부 표현"),
        ("finish_texture", "negative", "매트함, 답답함, 들뜸"),
        ("dryness_skin_texture", "positive", "건조함이나 각질 부각이 덜하다"),
        ("dryness_skin_texture", "negative", "건조함, 당김, 각질"),
        ("adhesion_base_interaction", "positive", "얇게 밀착되고 피부 표현"),
        ("adhesion_base_interaction", "negative", "들뜸, 끼임, 밀림"),
        ("application_blending", "positive", "얇고 부드럽게 발린다"),
        ("application_blending", "negative", "펴바르기 어렵거나 뭉침"),
        ("color_tone_matching", "positive", "피부톤과 자연스럽게"),
        ("color_tone_matching", "negative", "밝기, 다크닝, 칙칙함"),
        ("persistence", "positive", "다크닝이나 무너짐이 적고"),
        ("persistence", "negative", "시간이 지나며 무너짐, 다크닝, 수정화장"),
        ("transfer_resistance", "positive", "묻어남이 적거나 픽싱"),
        ("transfer_resistance", "negative", "마스크·옷 묻어남"),
        ("applicator_tool", "positive", "퍼프 사용감과 양 조절"),
        ("applicator_tool", "negative", "퍼프나 도구 사용감"),
        ("packaging_container", "positive", "패키지 디자인과 휴대성"),
        ("packaging_container", "negative", "지문, 먼지, 배송"),
    ])
    def test_base_makeup_summary_uses_spec_wording(
        self, attr, polarity, expected_substr,
    ):
        out = attribute_specific_summary(
            profile_id="base_makeup",
            attribute_key=attr,
            polarity=polarity,
        )
        assert out is not None, f"missing entry for {attr}/{polarity}"
        assert expected_substr in out, (
            f"expected {expected_substr!r} in {out!r}"
        )

    def test_base_makeup_adhesion_does_not_use_pad_wording(self):
        """The pre-pass-19 last-resort label was '패드 밀착력' —
        verify the base_makeup map produces base-makeup-anchored
        wording, not pad wording."""
        for polarity in ("positive", "negative", "negative_strong"):
            out = attribute_specific_summary(
                profile_id="base_makeup",
                attribute_key="adhesion_base_interaction",
                polarity=polarity,
            )
            assert out is not None
            assert "패드" not in out, f"pad wording leaked: {out!r}"

    def test_normalize_substitutes_base_makeup_fallback_for_degraded(self):
        out = normalize_display_quote_summary(
            "은근히 편하네요!",  # generic / degraded
            attribute_key="adhesion_base_interaction",
            polarity="positive",
            profile_id="base_makeup",
        )
        assert "패드" not in out
        assert "밀착" in out

    def test_last_resort_label_for_base_makeup_avoids_pad_term(self):
        """Even when both the profile map AND fallback_generic miss
        the (attr, polarity) combo, the last-resort label must not
        say '패드 밀착력' for base_makeup."""
        # `multi_use_lip_cheek_compatibility` has no entry in any
        # profile map → falls all the way to last-resort.
        out = normalize_display_quote_summary(
            "...",
            attribute_key="multi_use_lip_cheek_compatibility",
            polarity="positive",
            profile_id="base_makeup",
        )
        assert "패드" not in out


# ---------------------------------------------------------------------------
# C. Banned-phrase audit (analysis_report + PDF surface)
# ---------------------------------------------------------------------------


_BANNED_BASE_MAKEUP_PHRASES = (
    "패드 밀착력",
    "보습 보강 단계",
    "보습 보강",
    "수분 보강",
    "스킨케어 패드",
    "토너패드",
)


class TestBaseMakeupBannedPhrases:
    def test_base_makeup_summaries_have_no_banned_phrases(self):
        from src.voc.content.quote_summary_normalizer import (
            _FALLBACK_SUMMARY_KO,
        )
        bm = _FALLBACK_SUMMARY_KO["base_makeup"]
        for attr_key, by_polarity in bm.items():
            for polarity, text in by_polarity.items():
                for banned in _BANNED_BASE_MAKEUP_PHRASES:
                    assert banned not in text, (
                        f"banned phrase {banned!r} in base_makeup "
                        f"{attr_key}/{polarity}: {text!r}"
                    )

    def test_pdf_base_makeup_tradeoff_blocks_have_no_banned_phrases(self):
        """Source-string check on the PDF renderer's base_makeup
        trade-off dict. Locks the contract that the dict body never
        regrows skincare-pad copy."""
        import importlib.util
        from pathlib import Path
        repo = Path(__file__).resolve().parents[2]
        src = (repo / "scripts" / "generate_phase2e_pdf_v2.py").read_text(
            encoding="utf-8",
        )
        start = src.index("_TRADEOFF_BLOCKS_BASE_MAKEUP: dict")
        end = src.index("# ---------- Profile: lip_makeup", start)
        block = src[start:end]
        for banned in _BANNED_BASE_MAKEUP_PHRASES + ("사용 시간",):
            assert banned not in block, (
                f"banned phrase {banned!r} in BASE_MAKEUP trade-off block"
            )

    def test_pdf_base_makeup_buyer_translations_have_no_banned_phrases(self):
        """The pass-19 profile-aware buyer-translation dict for
        base_makeup must not carry skincare-pad copy."""
        import importlib.util
        import sys
        from pathlib import Path
        repo = Path(__file__).resolve().parents[2]
        spec = importlib.util.spec_from_file_location(
            "_pdf_v2_pass19_audit",
            repo / "scripts" / "generate_phase2e_pdf_v2.py",
        )
        mod = importlib.util.module_from_spec(spec)
        sys.modules["_pdf_v2_pass19_audit"] = mod
        spec.loader.exec_module(mod)
        bm = mod._BR3_BUYER_TRANSLATIONS_BY_PROFILE_KO["base_makeup"]
        for attr_key, sides in bm.items():
            for polarity, text in sides.items():
                for banned in _BANNED_BASE_MAKEUP_PHRASES:
                    assert banned not in text, (
                        f"banned phrase {banned!r} in buyer-translation "
                        f"base_makeup/{attr_key}/{polarity}: {text!r}"
                    )


# ---------------------------------------------------------------------------
# D. Product name normalization (collab + 리필기획 + N종 + empty parens)
# ---------------------------------------------------------------------------


class TestProductNameNormalizationPass19:
    def test_collab_bracket_run004_case(self):
        out = normalize_product_name(
            "[퓌X민스코] 퓌 올데이 커버 블랙 쿠션 리필기획(본품+리필) 5종"
        )
        assert out["display_product_name"] == (
            "퓌 올데이 커버 블랙 쿠션"
        )
        # Collab bracket is moved off the headline into promo_context.
        # Pass-19I: bracket chars stripped on the operator surface.
        assert "퓌X민스코" in out["promo_context"]
        # Offer composition retained — sellers / brands need this.
        assert "리필기획" in out["offer_context"]
        assert "본품+리필" in out["offer_context"]
        assert "5종" in out["offer_context"]
        # Display has no residual empty parens.
        assert "( )" not in out["display_product_name"]
        assert "()" not in out["display_product_name"]
        # Trailing 5종 / 리필기획 not in display.
        assert "리필기획" not in out["display_product_name"]
        assert "5종" not in out["display_product_name"]

    def test_report_title_no_residual_empty_parens(self):
        out = normalize_product_name(
            "[퓌X민스코] 퓌 올데이 커버 블랙 쿠션 리필기획(본품+리필) 5종"
        )
        assert "( )" not in out["report_title"]
        assert "()" not in out["report_title"]
        assert "리필기획" not in out["report_title"]
        # Title built from clean display_product_name.
        assert out["report_title"] == (
            "퓌 올데이 커버 블랙 쿠션 리뷰 인사이트 리포트"
        )

    def test_collab_bracket_other_separators(self):
        # ASCII X with spaces.
        out = normalize_product_name(
            "[NewJeans X 메디힐] 메디힐 더마 패드"
        )
        # The collab bracket lands in promo_context (sink is shared).
        assert "NewJeans" in out["promo_context"] or (
            "X" in out["promo_context"]
        )
        assert "[NewJeans" not in out["display_product_name"]

    def test_clean_name_still_passes_through(self):
        """Regression: a name with no collab / offer / promo tokens
        must be unchanged."""
        out = normalize_product_name("메디힐 더마 패드")
        assert out["display_product_name"] == "메디힐 더마 패드"
        assert out["promo_context"] == ""
        assert out["offer_context"] == ""

    def test_bare_n_jong_extracted_as_offer(self):
        """Pass-19 added bare \\dN종 to offer patterns."""
        out = normalize_product_name("브랜드 쿠션 5종")
        assert out["display_product_name"] == "브랜드 쿠션"
        assert "5종" in out["offer_context"]


# ---------------------------------------------------------------------------
# E. Adapter integration — base_makeup analysis_report stays clean
# ---------------------------------------------------------------------------


def test_adapter_writes_base_makeup_clean_summaries():
    """End-to-end: ProductReportData with degraded sample evidences
    routed through the adapter at profile_id=base_makeup must produce
    analysis_report top_quotes carrying base-makeup-anchored summaries
    (no '패드 밀착력', no '보습 보강')."""
    from src.voc.content.adapters.from_phase2e import (
        productreportdata_to_analysis_report,
    )
    from src.voc.reporting.phase2e.report import (
        AttributeSummary, ProductReportData,
    )

    evidences_pos = [
        {
            "review_id": "r_p1",
            "evidence_span": "은근히 편하네요!",
            "polarity": "positive",
        },
    ]
    evidences_neg = [
        {
            "review_id": "r_n1",
            "evidence_span": "...",
            "polarity": "negative_strong",
        },
    ]
    summaries = {
        "adhesion_base_interaction": AttributeSummary(
            attribute="adhesion_base_interaction",
            n_positive=22, n_negative=18, n_mixed=0,
            sample_evidences_pos=evidences_pos,
            sample_evidences_neg=evidences_neg,
        ),
        "finish_texture": AttributeSummary(
            attribute="finish_texture",
            n_positive=30, n_negative=12, n_mixed=0,
            sample_evidences_pos=evidences_pos,
            sample_evidences_neg=evidences_neg,
        ),
    }
    data = ProductReportData(
        product_id="A000000253122",
        product_name="[퓌X민스코] 퓌 올데이 커버 블랙 쿠션 리필기획(본품+리필) 5종",
        n_reviews=156,
        n_records=72,
        n_mixed_reviews=0,
        n_with_tradeoff=0,
        attribute_summaries=summaries,
        tradeoff_pairs={},
        mixed_attribute_pairs={},
        delivery_condition_records_total=0,
    )
    out = productreportdata_to_analysis_report(
        data,
        source_url="https://example.invalid/p?goodsNo=A000000253122",
        primary_sort="DATETIME_DESC",
        sampling_strategy="latest_only",
        selected_profile_id="base_makeup",
    )

    # 1. product block carries the active profile and clean display name.
    product = out.get("product") or {}
    assert product.get("selected_profile_id") == "base_makeup"
    assert product.get("display_product_name") == (
        "퓌 올데이 커버 블랙 쿠션"
    )
    assert "리필기획" not in product.get("report_title") or ""
    assert "( )" not in (product.get("report_title") or "")

    # 2. Every quote_summary is clean and free of banned phrases.
    attrs = out.get("attributes") or []
    for a in attrs:
        for q in a.get("top_quotes") or []:
            s = q.get("display_quote_summary") or ""
            assert not is_degraded_quote_summary(s), (
                f"degraded summary survived: {s!r}"
            )
            for banned in _BANNED_BASE_MAKEUP_PHRASES:
                assert banned not in s, (
                    f"banned phrase {banned!r} in base_makeup quote: {s!r}"
                )

    # 3. adhesion_base_interaction quote summaries do not use "패드".
    adh = next(
        (a for a in attrs if a.get("key") == "adhesion_base_interaction"),
        None,
    )
    assert adh is not None
    for q in adh.get("top_quotes") or []:
        s = q.get("display_quote_summary") or ""
        assert "패드" not in s
        # And the actual base-makeup anchor word should be there.
        assert "밀착" in s or "들뜸" in s or "끼임" in s
