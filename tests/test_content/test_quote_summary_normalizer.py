"""Tests for the shared quote-summary normalizer.

Pass-17 promotes the quote-quality logic from the PDF renderer up
to the adapter layer so `analysis_report.json` itself is clean.
This module is the single source of truth used by:
  - `src/voc/content/adapters/from_phase2e.py`  (writes the JSON)
  - `scripts/generate_phase2e_pdf_v2.py`        (renders the PDF)
  - `scripts/inspect_run_quality.py`            (audit verdict)
"""
from __future__ import annotations

import pytest

from src.voc.content.quote_summary_normalizer import (
    attribute_specific_summary,
    is_degraded_quote_summary,
    looks_dangling,
    looks_too_generic,
    looks_truncated,
    normalize_display_quote_summary,
)


# ---------------------------------------------------------------------------
# 1. Predicates
# ---------------------------------------------------------------------------


class TestPredicates:
    @pytest.mark.parametrize("s", [
        "시트가 얇고 피부에 잘 밀착돼서 ...",
        "부드럽게 밀착되면서 ...",
        "촉촉하고 좋아도 …",
        "엄마가 진짜…",
    ])
    def test_truncated_detected(self, s):
        assert looks_truncated(s)

    def test_clean_summary_not_truncated(self):
        assert not looks_truncated(
            "촉촉하고 편안한 마무리감을 만족 포인트로 언급"
        )

    @pytest.mark.parametrize("s", [
        "은근히 편하네요!",      # 9 chars
        "좋아요",                  # 3 chars
        "비추입",                  # 3 chars
        "그냥 만족",
        "생각보다 만족",
        "엄마가 진짜",            # bare 12 chars
    ])
    def test_too_generic_detected(self, s):
        assert looks_too_generic(s)

    def test_long_substantive_quote_passes(self):
        s = "발색이 정말 잘 받고 마무리도 좋아요. 색이 오래 가는 편입니다."
        assert not looks_too_generic(s)

    @pytest.mark.parametrize("s", [
        "건조하다는 의",   # ends mid-syllable
        "촉촉",             # too short
        "촉촉하고 좋",       # ends in non-final Hangul
    ])
    def test_dangling_detected(self, s):
        assert looks_dangling(s)

    def test_proper_sentence_passes_dangling(self):
        assert not looks_dangling("건조함이 덜하고 당김이 적다는 의견")


class TestIsDegraded:
    def test_clean_summary_passes(self):
        assert not is_degraded_quote_summary(
            "촉촉하고 편안한 마무리감을 만족 포인트로 언급"
        )

    @pytest.mark.parametrize("s", [
        "",
        "...",
        "은근히 편하네요!",
        "엄마가 진짜…",
        "시트가 얇고 피부에 잘 밀착돼서 ...",
    ])
    def test_degraded_summaries_caught(self, s):
        assert is_degraded_quote_summary(s)


# ---------------------------------------------------------------------------
# 2. Profile-aware fallback resolution
# ---------------------------------------------------------------------------


class TestAttributeSpecificFallback:
    def test_skincare_pad_adhesion_positive(self):
        out = attribute_specific_summary(
            profile_id="skincare_pad",
            attribute_key="adhesion_base_interaction",
            polarity="positive",
        )
        assert out == "시트가 얇고 피부에 잘 밀착된다는 의견"

    def test_skincare_pad_adhesion_negative_strong(self):
        out = attribute_specific_summary(
            profile_id="skincare_pad",
            attribute_key="adhesion_base_interaction",
            polarity="negative_strong",
        )
        # negative_strong / negative_weak / negative all map to negative.
        assert out == "밀착 체감이 약하거나 들뜸을 느꼈다는 의견"

    def test_skincare_pad_dryness_positive(self):
        assert attribute_specific_summary(
            profile_id="skincare_pad",
            attribute_key="dryness_skin_texture",
            polarity="positive",
        ) == "건조함이 덜하고 당김이 적다는 의견"

    def test_skincare_pad_finish_negative(self):
        assert attribute_specific_summary(
            profile_id="skincare_pad",
            attribute_key="finish_texture",
            polarity="negative_weak",
        ) == "마무리감이 답답하거나 빨리 마르는 느낌이 있다는 의견"

    def test_unknown_profile_falls_to_generic(self):
        out = attribute_specific_summary(
            profile_id="nonexistent_xyz",
            attribute_key="finish_texture",
            polarity="positive",
        )
        assert out is not None
        assert "사용감" in out or "마무리" in out

    def test_returns_none_for_unknown_attribute(self):
        out = attribute_specific_summary(
            profile_id="skincare_pad",
            attribute_key="never_heard_of_it",
            polarity="positive",
        )
        assert out is None


# ---------------------------------------------------------------------------
# 3. normalize_display_quote_summary — the integration entry point
# ---------------------------------------------------------------------------


class TestNormalize:
    def test_clean_summary_passes_through(self):
        clean = "발색이 정말 잘 받고 마무리도 좋아요. 색이 오래 갑니다."
        out = normalize_display_quote_summary(
            clean,
            attribute_key="pigmentation",
            polarity="positive",
            profile_id="base_makeup",
        )
        assert out == clean

    def test_truncated_substituted_by_attribute_summary(self):
        out = normalize_display_quote_summary(
            "시트가 얇고 피부에 잘 밀착돼서 ...",
            attribute_key="adhesion_base_interaction",
            polarity="positive",
            profile_id="skincare_pad",
        )
        assert out == "시트가 얇고 피부에 잘 밀착된다는 의견"

    def test_generic_filler_substituted(self):
        out = normalize_display_quote_summary(
            "은근히 편하네요!",
            attribute_key="adhesion_base_interaction",
            polarity="positive",
            profile_id="skincare_pad",
        )
        assert out == "시트가 얇고 피부에 잘 밀착된다는 의견"

    def test_attribute_mismatch_resolved_via_attribute_key(self):
        """The exact run-003 mismatch: a quote labeled
        adhesion_base_interaction surfaces "건조하다는 의견" — this
        wording belongs to dryness_skin_texture. The normalizer must
        prefer the attribute-aware fallback (adhesion) over keeping
        the mis-attributed surface text."""
        out = normalize_display_quote_summary(
            "건조하다는 의견",
            attribute_key="adhesion_base_interaction",
            polarity="negative",
            profile_id="skincare_pad",
        )
        assert out == "밀착 체감이 약하거나 들뜸을 느꼈다는 의견"
        assert "건조" not in out

    def test_empty_input_falls_back_to_attribute_summary(self):
        out = normalize_display_quote_summary(
            None,
            attribute_key="finish_texture",
            polarity="positive",
            profile_id="skincare_pad",
        )
        assert out == "촉촉하고 편안한 마무리감을 만족 포인트로 언급"

    def test_unknown_attribute_uses_last_resort_label(self):
        out = normalize_display_quote_summary(
            "은근히 편하네요!",  # degraded
            attribute_key="multi_use_lip_cheek_compatibility",
            polarity="positive",
            profile_id="skincare_pad",  # profile has no entry for this attr
        )
        # Falls all the way to last-resort label stub.
        assert "다용도 호환" in out or "관련" in out

    def test_dryness_negative_renders_skincare_pad_specific(self):
        out = normalize_display_quote_summary(
            "...",
            attribute_key="dryness_skin_texture",
            polarity="negative_strong",
            profile_id="skincare_pad",
        )
        assert out == "금방 건조해지거나 당김이 있다는 의견"


# ---------------------------------------------------------------------------
# 4. Polarity normalization (negative_strong / negative_weak / negative)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("polarity", ["negative", "negative_weak", "negative_strong"])
def test_all_negative_variants_resolve_to_negative_summary(polarity):
    out = attribute_specific_summary(
        profile_id="skincare_pad",
        attribute_key="finish_texture",
        polarity=polarity,
    )
    assert out is not None
    # All three resolve to the same negative-side template.
    assert out == "마무리감이 답답하거나 빨리 마르는 느낌이 있다는 의견"


# ---------------------------------------------------------------------------
# 5. Integration with from_phase2e adapter
# ---------------------------------------------------------------------------


def test_adapter_writes_clean_display_quote_summary_to_analysis_report():
    """End-to-end: feed ProductReportData with degraded sample
    evidences through the adapter; the resulting analysis_report
    must carry CLEAN display_quote_summary on every top_quote."""
    from src.voc.content.adapters.from_phase2e import (
        productreportdata_to_analysis_report,
    )
    from src.voc.reporting.phase2e.report import (
        AttributeSummary, ProductReportData,
    )

    # Sample evidence dicts with degraded text — what would have
    # produced "은근히 편하네요!" or "..." summaries pre-pass-17.
    evidences_pos = [
        {
            "review_id": "r1",
            "evidence_span": "은근히 편하네요!",  # short / generic
            "polarity": "positive",
        },
    ]
    evidences_neg = [
        {
            "review_id": "r2",
            "evidence_span": "건조하다는 의견",  # mismatch on adhesion
            "polarity": "negative_strong",
        },
    ]
    summaries = {
        "adhesion_base_interaction": AttributeSummary(
            attribute="adhesion_base_interaction",
            n_positive=15, n_negative=20, n_mixed=0,
            sample_evidences_pos=evidences_pos,
            sample_evidences_neg=evidences_neg,
        ),
    }
    data = ProductReportData(
        product_id="A1",
        product_name="메디힐 더마 패드",
        n_reviews=100,
        n_records=35,
        n_mixed_reviews=0,
        n_with_tradeoff=0,
        attribute_summaries=summaries,
        tradeoff_pairs={},
        mixed_attribute_pairs={},
        delivery_condition_records_total=0,
    )
    out = productreportdata_to_analysis_report(
        data, source_url="https://example.invalid/p?goodsNo=A1",
        primary_sort="DATETIME_DESC",
        sampling_strategy="latest_only",
        selected_profile_id="skincare_pad",
    )
    attrs = out.get("attributes") or []
    adhesion = next(
        (a for a in attrs if a.get("key") == "adhesion_base_interaction"),
        None,
    )
    assert adhesion is not None
    quotes = adhesion.get("top_quotes") or []
    assert len(quotes) >= 2
    for q in quotes:
        s = q.get("display_quote_summary") or ""
        assert not is_degraded_quote_summary(s), (
            f"degraded summary survived: {s!r}"
        )
        # Mismatch case: the negative quote must NOT carry the
        # mis-attributed "건조" wording.
        if q.get("polarity") in ("negative", "negative_strong", "negative_weak"):
            assert "건조" not in s, (
                f"attribute mismatch survived: {s!r}"
            )
            assert "밀착" in s
