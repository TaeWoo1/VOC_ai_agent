"""Pass-19I: tests for the Business Review Dashboard restructure.

The hince/muzigae lip-makeup PDF review surfaced that the report
read like a review compilation, not a seller-facing decision tool.
Pass-19I replaces sections 2-5 (Key Findings → Matrix → Decisions →
Buyer Content Translation) with decision-oriented sections:

  1. Executive Summary (verdict + Top 2/2/3)
  2. Signal Dashboard (KEEP / FIX / CLARIFY / MONITOR + Priority Map)
  3. What's Working
  4. What Needs Attention
  5. Seller Action Plan  (REPLACES Buyer Content Translation)
  6. Methodology & Limitations
  7. Appendix

Test surface (per user spec §L):
  1. lip_makeup report carries the new section names
  2. Buyer Content Translation does NOT appear
  3. "콘텐츠 문구 예시" does NOT appear
  4. Sections 1-5 do not contain banned skincare/base terms
  5. hince report title normalized to "힌스 로 글로우 젤 틴트 리뷰
     인사이트 리포트"
  6. Seller Action Plan contains ≥3 actions with owner fields
  7. Top summary contains KEEP/FIX/CLARIFY-equivalent decision labels
  8. No "관련 만족 의견" / "관련 아쉬움 의견" stub in sections 1-5
  9. Sections 1-5 are business-facing (no raw quote dumps)
 10. hince republish produces 0 generic/filler in report-facing sections
"""
from __future__ import annotations

import io
import json
from contextlib import redirect_stdout
from pathlib import Path

import pytest

from src.voc.content.product_name_normalizer import normalize_product_name
from src.voc.reporting.phase2e.seller_dashboard import (
    BANNED_PHRASES_SECTIONS_1_5,
    BUCKET_CLARIFY,
    BUCKET_FIX,
    BUCKET_KEEP,
    BUCKET_MONITOR,
    ActionItem,
    build_executive_summary,
    build_seller_action_plan,
    build_signal_dashboard_rows,
    build_what_needs_attention_items,
    build_whats_working_items,
    classify_signal_bucket,
    scan_for_banned_phrases,
    select_owner,
)


# ---------- Test 1: classify_signal_bucket ------------------------------


class TestClassifyBucket:
    def test_high_pos_low_neg_is_keep(self):
        assert classify_signal_bucket(
            n_positive=10, n_negative=1, n_mixed=0,
        ) == BUCKET_KEEP

    def test_high_neg_high_pos_is_clarify(self):
        # Polarized — both sides ≥3 → expectation gap.
        assert classify_signal_bucket(
            n_positive=8, n_negative=6, n_mixed=0,
        ) == BUCKET_CLARIFY

    def test_high_neg_low_pos_is_fix(self):
        assert classify_signal_bucket(
            n_positive=2, n_negative=10, n_mixed=0,
        ) == BUCKET_FIX

    def test_low_total_is_monitor(self):
        assert classify_signal_bucket(
            n_positive=2, n_negative=1, n_mixed=0,
        ) == BUCKET_MONITOR

    def test_zero_signal_is_monitor(self):
        assert classify_signal_bucket(
            n_positive=0, n_negative=0, n_mixed=0,
        ) == BUCKET_MONITOR


# ---------- Test 2: select_owner per profile ----------------------------


class TestOwnerRouting:
    def test_lip_pigmentation_routes_to_detail_page(self):
        assert select_owner("pigmentation", profile_id="lip_makeup") == "상세페이지"

    def test_lip_persistence_routes_to_cs_faq(self):
        # Lip persistence is an expectation/CS topic, not R&D.
        assert select_owner("persistence", profile_id="lip_makeup") == "CS·FAQ"

    def test_unknown_attribute_falls_back_to_detail_page(self):
        # Cheapest, lowest-risk lever.
        assert select_owner("unknown_attr", profile_id="lip_makeup") == "상세페이지"


# ---------- Test 3-4: section data builders ------------------------------


def _hince_fixture_report() -> dict:
    """A condensed analysis_report mirroring the hince corpus shape:
    KEEP-bucket finish_texture / adhesion, CLARIFY-bucket
    pigmentation, FIX-bucket persistence + dryness."""
    return {
        "product": {
            "selected_profile_id": "lip_makeup",
            "name_ko": "힌스 로 글로우 젤 틴트",
            "category": "메이크업 > 립메이크업 > 립틴트",
            "report_title": "힌스 로 글로우 젤 틴트 리뷰 인사이트 리포트",
        },
        "corpus": {"n_reviews_analyzed": 817},
        "attributes": [
            {
                "key": "finish_texture",
                "label_ko": "마무리감",
                "n_positive": 22, "n_negative": 1, "n_mixed": 0,
                "top_quotes": [],
            },
            {
                "key": "adhesion_base_interaction",
                "label_ko": "밀착감·광택 유지",
                "n_positive": 18, "n_negative": 2, "n_mixed": 0,
                "top_quotes": [],
            },
            {
                "key": "pigmentation",
                "label_ko": "발색·컬러 표현",
                "n_positive": 12, "n_negative": 8, "n_mixed": 1,
                "top_quotes": [],
            },
            {
                "key": "persistence",
                "label_ko": "지속력·착색",
                "n_positive": 4, "n_negative": 9, "n_mixed": 0,
                "top_quotes": [],
            },
            {
                "key": "dryness_skin_texture",
                "label_ko": "건조감·각질 부각",
                "n_positive": 1, "n_negative": 7, "n_mixed": 0,
                "top_quotes": [],
            },
            {
                "key": "color_tone_matching",
                "label_ko": "컬러 매칭",
                "n_positive": 5, "n_negative": 5, "n_mixed": 0,
                "top_quotes": [],
            },
        ],
        "strengths": [],
        "monitoring_candidates": [],
        "tradeoffs": [],
    }


class TestSignalDashboardRows:
    def test_buckets_match_expected_distribution(self):
        rows = build_signal_dashboard_rows(_hince_fixture_report())
        by_bucket: dict[str, list[str]] = {}
        for r in rows:
            by_bucket.setdefault(r.bucket, []).append(r.attribute_key)
        # finish_texture / adhesion → KEEP
        assert "finish_texture" in by_bucket.get(BUCKET_KEEP, [])
        assert "adhesion_base_interaction" in by_bucket.get(BUCKET_KEEP, [])
        # pigmentation polarized → CLARIFY
        assert "pigmentation" in by_bucket.get(BUCKET_CLARIFY, [])
        # persistence / dryness → FIX
        assert "persistence" in by_bucket.get(BUCKET_FIX, [])
        assert "dryness_skin_texture" in by_bucket.get(BUCKET_FIX, [])

    def test_owner_field_populated(self):
        rows = build_signal_dashboard_rows(_hince_fixture_report())
        for r in rows:
            assert r.owner, f"missing owner on row: {r.attribute_key}"

    def test_seller_interpretation_populated(self):
        rows = build_signal_dashboard_rows(_hince_fixture_report())
        for r in rows:
            assert r.seller_interpretation
            # Must NOT carry banned generic-construct phrases.
            for phrase in ("관련 만족 의견", "관련 아쉬움 의견"):
                assert phrase not in r.seller_interpretation


class TestWhatsWorking:
    def test_lip_strengths_use_lip_anchored_vocab(self):
        items = build_whats_working_items(_hince_fixture_report())
        joined = " ".join(
            f"{s.loved} {s.business_value} {s.preserve_caution}"
            for s in items
        )
        # At least one of these lip-anchored words appears.
        assert any(w in joined for w in ("광택", "끈적임", "입술", "밀착", "착색"))
        # And NO banned skincare/base context.
        for banned in ("백탁", "흡수 시간", "보습 보강 단계", "수분 보강"):
            assert banned not in joined


class TestWhatNeedsAttention:
    def test_lip_frictions_use_lip_anchored_vocab(self):
        items = build_what_needs_attention_items(_hince_fixture_report())
        assert items, "expected at least one friction item from fixture"
        joined = " ".join(
            f"{f.concern} {f.business_impact} {f.questions}" for f in items
        )
        assert any(w in joined for w in (
            "입술", "발색", "각질", "주름", "식사", "착색",
        ))
        # No banned phrases.
        for banned in ("백탁", "보습 효과 기대치", "사용 환경/시점별 차이"):
            assert banned not in joined

    def test_pigmentation_friction_uses_color_expectation_phrasing(self):
        items = build_what_needs_attention_items(_hince_fixture_report())
        pig = next(
            (f for f in items if f.attribute_key == "pigmentation"), None,
        )
        assert pig is not None
        # Spec wording.
        assert "기대 색상" in pig.concern or "발색 차이" in pig.concern


# ---------- Test 5: hince report title -----------------------------------


class TestHinceReportTitle:
    def test_full_raw_normalizes_to_spec(self):
        out = normalize_product_name(
            "[뮤트스위치글로스 증정/신규컬러] 힌스 로 글로우 젤 틴트 24 Colors 한정 기획 (오드스프링에디션)"
        )
        assert out["display_product_name"] == "힌스 로 글로우 젤 틴트"
        assert out["report_title"] == (
            "힌스 로 글로우 젤 틴트 리뷰 인사이트 리포트"
        )
        # Offer context — Colors / 한정 기획 / 오드스프링에디션 lifted.
        assert "24 Colors" in out["offer_context"]
        assert "한정 기획" in out["offer_context"]
        assert "오드스프링에디션" in out["offer_context"]
        # Promo context — gift bracket lifted off the headline.
        assert "뮤트스위치글로스 증정" in out["promo_context"] or \
               "신규컬러" in out["promo_context"]

    def test_muzigae_unchanged(self):
        out = normalize_product_name("무지개맨션 오브제 워터 틴트")
        assert out["display_product_name"] == "무지개맨션 오브제 워터 틴트"
        assert out["offer_context"] == ""
        assert out["promo_context"] == ""


# ---------- Test 6: seller action plan ≥ 3 actions with owner ----------


class TestSellerActionPlan:
    def test_at_least_three_actions_for_hince_fixture(self):
        actions = build_seller_action_plan(_hince_fixture_report())
        assert len(actions) >= 3, (
            f"expected ≥3 actions, got {len(actions)}: {actions}"
        )

    def test_every_action_has_owner_and_priority(self):
        actions = build_seller_action_plan(_hince_fixture_report())
        for a in actions:
            assert a.priority in ("P1", "P2", "P3")
            assert a.owner
            assert a.action_text
            assert a.evidence
            assert a.expected_outcome

    def test_p1_actions_appear_first(self):
        actions = build_seller_action_plan(_hince_fixture_report())
        priorities = [a.priority for a in actions]
        # P1 entries (if any) lead the list.
        for i, p in enumerate(priorities):
            if p == "P2":
                assert "P1" not in priorities[i:]

    def test_actions_do_not_use_banned_copywriter_phrases(self):
        actions = build_seller_action_plan(_hince_fixture_report())
        joined = " ".join(
            f"{a.action_text} {a.evidence} {a.expected_outcome}"
            for a in actions
        )
        for banned in (
            "콘텐츠 문구 예시",
            "보습 보강 단계", "수분 보강", "백탁", "흡수 시간",
            "보습 효과 기대치",
            "사용 환경/시점별 차이를 다시 한 번 확인",
            "관련 만족 의견", "관련 아쉬움 의견",
        ):
            assert banned not in joined, (
                f"action plan leaked banned phrase: {banned!r}"
            )


# ---------- Test 7: top summary has decision labels ---------------------


class TestExecutiveSummaryVerdict:
    def test_verdict_is_decision_oriented(self):
        summary = build_executive_summary(_hince_fixture_report())
        # Must NOT just re-state counts.
        assert "건이 보이지만" not in summary.verdict
        assert "건도 함께 누적됩니다" not in summary.verdict
        # Decision-language present.
        assert any(token in summary.verdict for token in (
            "판매 유지", "개선 검토", "기대치", "추적", "구매 동기",
        ))

    def test_top_strengths_and_frictions_populated(self):
        summary = build_executive_summary(_hince_fixture_report())
        assert len(summary.top_strengths) >= 1
        assert len(summary.top_frictions) >= 1
        assert len(summary.top_actions) >= 1

    def test_caveat_is_hypothesis_framing(self):
        summary = build_executive_summary(_hince_fixture_report())
        assert "가설" in summary.caveat
        assert "내부 검토" in summary.caveat


# ---------- Test 8: no generic stub in any section data -----------------


class TestNoGenericStubsInSections:
    def test_signal_dashboard_rows_no_generic_stub(self):
        rows = build_signal_dashboard_rows(_hince_fixture_report())
        for r in rows:
            for stub in ("관련 만족 의견", "관련 아쉬움 의견"):
                assert stub not in r.seller_interpretation
                # Owner / interpretation / label cells none-of-them
                # carry the structural generic stub.

    def test_action_plan_no_generic_stub(self):
        rows = build_seller_action_plan(_hince_fixture_report())
        for r in rows:
            for stub in ("관련 만족 의견", "관련 아쉬움 의견"):
                assert stub not in r.action_text
                assert stub not in r.evidence
                assert stub not in r.expected_outcome


# ---------- Test 9: end-to-end on rendered PDF --------------------------


@pytest.fixture(scope="module")
def rendered_lip_pdf(tmp_path_factory):
    """Render the v3 PDF for a lip-makeup fixture and return the
    extracted text per page."""
    from scripts.generate_phase2e_pdf_v2 import (
        render_seller_business_report_v3,
    )
    out_dir = tmp_path_factory.mktemp("pass19i_pdf")
    out_path = out_dir / "seller_report_ko.pdf"
    report = _hince_fixture_report()
    cs = {
        "schema_version": "1.1",
        "skipped_scrape": False,
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
        "review_count_analyzed": 817,
        "per_sort": {},
    }
    render_seller_business_report_v3(
        analysis_report=report,
        collection_summary=cs,
        out_path=out_path,
    )
    pdf_bytes = out_path.read_bytes()
    return pdf_bytes


def _extract_pdf_text(pdf_bytes: bytes) -> str:
    """Extract concatenated text from a PDF using pypdf (the
    extractor the legacy v3 tests use)."""
    from io import BytesIO
    from pypdf import PdfReader
    r = PdfReader(BytesIO(pdf_bytes))
    return "\n".join((p.extract_text() or "") for p in r.pages)


class TestRenderedLipPdf:
    def test_section_headers_match_pass19i(self, rendered_lip_pdf):
        text = _extract_pdf_text(rendered_lip_pdf)
        for header in (
            "1. Executive Summary",
            "2. Signal Dashboard",
            "3. What's Working",
            "4. What Needs Attention",
            "5. Seller Action Plan",
            "6. Methodology",
            "7. Appendix",
        ):
            assert header in text, (
                f"missing pass-19I section header: {header!r}"
            )

    def test_buyer_content_translation_section_removed(self, rendered_lip_pdf):
        text = _extract_pdf_text(rendered_lip_pdf)
        assert "Buyer Content Translation" not in text
        assert "5. Buyer Content" not in text

    def test_keuyt_phrase_not_present(self, rendered_lip_pdf):
        # Spec §K: "콘텐츠 문구 예시" must not appear in body.
        text = _extract_pdf_text(rendered_lip_pdf)
        assert "콘텐츠 문구 예시" not in text

    def test_decision_labels_present(self, rendered_lip_pdf):
        text = _extract_pdf_text(rendered_lip_pdf)
        # KEEP / FIX / CLARIFY / MONITOR labels appear via the bucket
        # headers (with Korean operator glosses).
        assert "KEEP" in text or "유지할 강점" in text
        assert "FIX" in text or "개선 검토" in text
        assert "CLARIFY" in text or "설명 보완" in text

    def test_priority_map_subsection_present(self, rendered_lip_pdf):
        text = _extract_pdf_text(rendered_lip_pdf)
        assert "Priority Map" in text

    def test_action_plan_columns_present(self, rendered_lip_pdf):
        text = _extract_pdf_text(rendered_lip_pdf)
        for col in ("우선순위", "액션 영역", "해야 할 일",
                     "근거 신호", "기대 효과"):
            assert col in text, f"missing action-plan column: {col!r}"


# ---------- Test 10: banned-phrase scanner --------------------------------


class TestBannedPhraseScanner:
    def test_scanner_flags_legacy_buyer_phrasing(self):
        text = "여기서 콘텐츠 문구 예시는 보습 보강 단계로 활용 가능합니다"
        hits = scan_for_banned_phrases(text)
        assert "콘텐츠 문구 예시" in hits
        assert "보습 보강 단계" in hits

    def test_scanner_flags_generic_stubs(self):
        text = "발색 관련 만족 의견과 발림성 관련 아쉬움 의견이 누적"
        hits = scan_for_banned_phrases(text)
        assert "관련 만족 의견" in hits
        assert "관련 아쉬움 의견" in hits

    def test_scanner_clean_lip_text_returns_empty(self):
        text = (
            "색이 선명하게 올라오고 얼굴빛을 살린다는 의견이 누적되며, "
            "식사나 시간이 지난 뒤 색 유지가 아쉽다는 의견도 함께 관찰됨."
        )
        hits = scan_for_banned_phrases(text)
        assert hits == []

    def test_full_banned_list_complete(self):
        # User-locked list from spec §K.
        for phrase in (
            "콘텐츠 문구 예시",
            "보습 보강 단계",
            "수분 보강",
            "백탁",
            "흡수 시간",
            "보습 효과 기대치",
            "사용 환경/시점별 차이를 다시 한 번 확인",
            "컬러 매칭 관련 만족 의견",
            "톤 매칭 관련 만족 의견",
            "발림성 관련 아쉬움 의견",
            "밀착감 관련 만족 의견",
            "관련 만족 의견",
            "관련 아쉬움 의견",
        ):
            assert phrase in BANNED_PHRASES_SECTIONS_1_5, (
                f"banned-phrase list missing: {phrase!r}"
            )

    def test_rendered_pdf_pre_appendix_has_no_banned_phrases(
        self, rendered_lip_pdf,
    ):
        # End-to-end check: render the PDF, extract pre-appendix text,
        # scan for banned phrases. Sections 1-5 (and 6) must be clean.
        text = _extract_pdf_text(rendered_lip_pdf)
        # Split off appendix — anything from "7." onwards is exempt.
        idx = text.find("7. Appendix")
        body = text[:idx] if idx > 0 else text
        hits = scan_for_banned_phrases(body)
        assert hits == [], (
            f"banned phrases leaked into report body: {hits}"
        )
