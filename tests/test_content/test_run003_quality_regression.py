"""Run-003 quality regression locks.

These tests anchor the four run-003 reviewer findings against future
regressions:

  1. Polarity guardrail does NOT flag "덜 촉촉하다고 해야하나 그건
     좀 아쉬웠음" as positive (the run-003 false-positive case).
  2. Display paraphrase produces a readable phrase for fragmented /
     colloquial spans, while leaving raw text intact.
  3. External-facing PDF section headers do NOT contain internal
     terms ("관찰 신호", "신뢰도 낮음", "안정성 높음", "모니터링 후보").
  4. Raw quote text invariant — adapter never mutates `text`.
"""
from __future__ import annotations

from collections import Counter

import pytest

from src.voc.reporting.phase2e.polarity_guardrail import check_polarity
from src.voc.reporting.phase2e.quote_display import (
    normalize_for_display,
    synthesize_phrase_display,
)


# ---------------------------------------------------------------------------
# Polarity guardrail — diminisher false-positive
# ---------------------------------------------------------------------------


class TestPolarityGuardrailDiminishers:
    """Under the run-003 fix, positive cues that are diminished
    ("덜 촉촉") or self-corrected ("...다고 해야하나") are pushed into
    `negated_positives` so a negative_weak claim is NOT flagged
    suspect when the negative cues are also present."""

    def test_run003_dul_chokchok_negative_claim_not_flagged(self):
        text = "덜 촉촉하다고 해야하나 그건 좀 아쉬웠음"
        result = check_polarity(text, "negative_weak")
        assert result.is_suspect is False, (
            f"run-003 false-positive regressed — {result.reasons}"
        )

    def test_byeollo_dampens_positive_cue(self):
        text = "별로 촉촉하지 않아요"
        result = check_polarity(text, "negative_weak")
        assert result.is_suspect is False

    def test_aswiwosseum_stem_detected_as_negative(self):
        text = "아쉬웠음"
        result = check_polarity(text, "negative_weak")
        assert result.is_suspect is False


# ---------------------------------------------------------------------------
# Display paraphrase synthesizer — fragmented spans become readable
# ---------------------------------------------------------------------------


class TestDisplayParaphrase:
    def test_short_fragment_with_anchor_keyword_wraps_to_uigyeon(self):
        # "비추입" — broken-off "비추입니다". Should wrap as "비추라는 ... 의견".
        out = synthesize_phrase_display("비추입", polarity="negative_weak")
        assert out.endswith("의견")
        assert "비추" in out

    def test_thickness_complaint_wraps_with_anchor_phrase(self):
        out = synthesize_phrase_display(
            "촉촉하지만 두께는 얇아서 두장 같이써야",
            polarity="positive",
        )
        assert "두 장 같이 써야" in out or "두장" in out
        assert out.endswith("의견")

    def test_colloquial_marker_triggers_paraphrase(self):
        # "디기" + "짱짱" — texting markers that signal fragmented input.
        out = synthesize_phrase_display(
            "디기촉촉하고 향도좋고 하루종일촉촉합니다짱짱",
            polarity="positive",
        )
        assert out.endswith("의견")
        # Anchor preserved.
        assert "촉촉" in out or "향" in out

    def test_clean_short_phrase_passes_through_unchanged(self):
        # "촉촉하고 좋아요" is already a clean phrase ending in 요 —
        # paraphrase must not over-trigger.
        out = synthesize_phrase_display("촉촉하고 좋아요", polarity="positive")
        assert out == "촉촉하고 좋아요"
        assert not out.endswith("의견")

    def test_clean_long_phrase_passes_through_unchanged(self):
        out = synthesize_phrase_display(
            "재구매 할 정도로 좋아요. 정말 만족합니다.",
            polarity="positive",
        )
        assert out == "재구매 할 정도로 좋아요. 정말 만족합니다."


# ---------------------------------------------------------------------------
# Adapter raw-text invariant + display_text uses paraphrase
# ---------------------------------------------------------------------------


class TestAdapterRawTextInvariant:
    """The adapter must NEVER mutate `text` — it's the audit-grade
    span used to anchor analysis_report.attributes[].top_quotes back
    to the source review. display_text is the only field that may
    differ from raw."""

    def _make_data(self, raw_text: str, polarity: str = "positive"):
        from src.voc.reporting.phase2e.report import (
            AttributeSummary, ProductReportData,
        )
        s = AttributeSummary(attribute="finish_texture")
        s.n_positive = 6 if polarity == "positive" else 0
        s.n_negative = 0 if polarity == "positive" else 6
        ev_field = "sample_evidences_pos" if polarity == "positive" \
            else "sample_evidences_neg"
        setattr(s, ev_field, [
            {"text": raw_text, "review_id": "r1"},
            {"text": raw_text + " (more text)", "review_id": "r2"},
            {"text": raw_text, "review_id": "r3"},
            {"text": raw_text, "review_id": "r4"},
            {"text": raw_text, "review_id": "r5"},
            {"text": raw_text, "review_id": "r6"},
        ])
        return ProductReportData(
            product_id="A0001",
            product_name="P",
            n_reviews=200,
            n_records=200,
            n_mixed_reviews=0,
            n_with_tradeoff=0,
            tradeoff_pairs=Counter(),
            mixed_attribute_pairs=[],
            delivery_condition_records_total=0,
            attribute_summaries={"finish_texture": s},
        )

    def test_raw_text_field_preserved_for_fragmented_input(self):
        from src.voc.content.adapters.from_phase2e import (
            productreportdata_to_analysis_report,
        )
        raw = "디기촉촉하고 향도좋고 하루종일촉촉합니다짱짱"
        data = self._make_data(raw, polarity="positive")
        out = productreportdata_to_analysis_report(data)
        attr = out["attributes"][0]
        for q in attr["top_quotes"]:
            assert q["text"] == raw or q["text"] == raw + " (more text)", (
                "adapter mutated raw text — span audit invariant broken"
            )
            # display_text MAY differ (paraphrased) — that's the contract.

    def test_display_text_uses_paraphrase_for_fragmented_input(self):
        from src.voc.content.adapters.from_phase2e import (
            productreportdata_to_analysis_report,
        )
        raw = "비추입"
        data = self._make_data(raw, polarity="negative_weak")
        out = productreportdata_to_analysis_report(data)
        attr = out["attributes"][0]
        # At least one quote's display_text is the paraphrased form.
        displays = [q["display_text"] for q in attr["top_quotes"]]
        assert any(d.endswith("의견") for d in displays), (
            f"no paraphrased display_text emitted for fragmented input; "
            f"got: {displays}"
        )


# ---------------------------------------------------------------------------
# PDF wording lock — main-section headers avoid internal jargon
# ---------------------------------------------------------------------------


class TestPDFExternalWordingLock:
    """The seller PDF's externally-visible section headers and the
    overall_signal_mode dict must NOT contain internal-feeling tokens.
    The reviewer-friendly rewrite is anchored here so future edits to
    those headers don't accidentally regress."""

    @pytest.fixture(scope="class")
    def pdf_v2(self):
        import importlib.util
        import sys
        from pathlib import Path
        name = "generate_phase2e_pdf_v2_run003"
        if name in sys.modules:
            return sys.modules[name]
        repo = Path(__file__).resolve().parents[2]
        spec = importlib.util.spec_from_file_location(
            name,
            repo / "scripts" / "generate_phase2e_pdf_v2.py",
        )
        mod = importlib.util.module_from_spec(spec)
        # Register in sys.modules BEFORE exec_module so dataclasses
        # inside the script can resolve `cls.__module__` via the
        # module-cache lookup.
        sys.modules[name] = mod
        spec.loader.exec_module(mod)
        return mod

    def _all_mode_text(self, mode: dict) -> str:
        return " ".join(
            v for v in mode.values() if isinstance(v, str)
        )

    def test_overall_signal_mode_low_uses_reader_friendly_wording(self, pdf_v2):
        mode = pdf_v2._overall_signal_mode("LOW")
        text = self._all_mode_text(mode)
        for forbidden in (
            "관찰 신호", "모니터링 후보", "신뢰도 낮음",
            "안정성 높음", "안정성 낮음", "부정 신호", "긍정 신호",
        ):
            assert forbidden not in text, (
                f"LOW mode leaked {forbidden!r}: {text!r}"
            )

    def test_overall_signal_mode_medium_uses_reader_friendly_wording(self, pdf_v2):
        mode = pdf_v2._overall_signal_mode("MEDIUM")
        text = self._all_mode_text(mode)
        for forbidden in (
            "관찰 신호", "모니터링 후보", "신뢰도 낮음",
            "안정성 높음", "안정성 낮음", "부정 신호", "긍정 신호",
        ):
            assert forbidden not in text

    def test_overall_signal_mode_high_uses_reader_friendly_wording(self, pdf_v2):
        mode = pdf_v2._overall_signal_mode("HIGH")
        text = self._all_mode_text(mode)
        for forbidden in (
            "관찰 신호", "모니터링 후보", "신뢰도 낮음",
            "안정성 높음", "안정성 낮음", "부정 신호", "긍정 신호",
        ):
            assert forbidden not in text

    def test_main_section_headers_use_reader_friendly_titles(self, pdf_v2):
        """Smoke check: rendering the strengths block and the method
        notes block emits the reader-friendly titles, not the legacy
        internal-feeling ones."""
        from src.voc.reporting.phase2e.report import aggregate_product
        from src.voc.reporting.phase2e.executive_summary import (
            synthesize_executive_summary,
        )
        styles = pdf_v2._styles()
        # Build a tiny corpus (not exercising the renderer's strength
        # threshold; the test is on the section header strings).
        reviews = [{
            "review_id": "r1",
            "mixed_review_flag": False, "tradeoff_pair": None,
            "records": [{
                "attribute": "value_price",
                "polarity": "positive", "intensity": 2,
                "evidence_span": "가성비 정말 좋아요",
                "confidence": "high", "delivery_condition_flag": False,
            }],
        }]
        data = aggregate_product("A0001", "P", reviews)
        es = synthesize_executive_summary(data)
        rendered_strengths = " ".join(
            getattr(f, "text", "") for f in
            pdf_v2._build_strengths_block(es, styles)
        )
        rendered_method = " ".join(
            getattr(f, "text", "") for f in
            pdf_v2._build_method_notes_block(
                styles, source_label="t", corpus_metadata=None,
            )
        )
        # Run-003 QA pass-2 lock: PDF (analyst surface) uses business-
        # tone headers. The cardnews counterparts ("리뷰에서 많이 좋다고
        # 한 점", "이 리포트를 읽는 방법") live in cardnews_buyer_journey.
        assert "반복된 만족 포인트" in rendered_strengths
        assert "분석 방법과 한계" in rendered_method
        # Legacy internal-leaning titles must be gone.
        assert "핵심 강점" not in rendered_strengths
        assert "해석 및 사용 가이드" not in rendered_method
        # Buyer-cardnews-only phrases must NOT leak into the PDF.
        assert "리뷰에서 많이 좋다고 한 점" not in rendered_strengths
        assert "이 리포트를 읽는 방법" not in rendered_method
