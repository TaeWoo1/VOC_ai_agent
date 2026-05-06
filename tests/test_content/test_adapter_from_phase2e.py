"""Tests for the Phase 2E → analysis_report.json adapter."""
from __future__ import annotations

from collections import Counter

import pytest

from src.voc.content.adapters.from_phase2e import (
    ANALYSIS_REPORT_SCHEMA_VERSION,
    productreportdata_to_analysis_report,
)
from src.voc.content.insight_brief import (
    generate_consumer_insight_brief,
    validate_consumer_insight_brief,
)
from src.voc.reporting.phase2e.report import AttributeSummary, ProductReportData


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


def _summary(
    attribute: str,
    *,
    n_positive: int = 0,
    n_negative: int = 0,
    n_mixed: int = 0,
    pos_examples: list[dict] | None = None,
    neg_examples: list[dict] | None = None,
) -> AttributeSummary:
    s = AttributeSummary(attribute=attribute)
    s.n_positive = n_positive
    s.n_negative = n_negative
    s.n_mixed = n_mixed
    if pos_examples:
        s.sample_evidences_pos = list(pos_examples)
    if neg_examples:
        s.sample_evidences_neg = list(neg_examples)
    return s


def _prd_rich() -> ProductReportData:
    return ProductReportData(
        product_id="A000000123456",
        product_name="롬앤 베러댄치크 03",
        n_reviews=1135,
        n_records=1842,
        n_mixed_reviews=120,
        n_with_tradeoff=58,
        attribute_summaries={
            "pigmentation": _summary(
                "pigmentation",
                n_positive=181, n_negative=71, n_mixed=12,
                pos_examples=[{"text": "발색이 진하고 예뻐요", "review_id": "r1"}],
                neg_examples=[{"text": "시간이 지나면 변색돼요", "review_id": "r2"}],
            ),
            "persistence": _summary("persistence", n_positive=47, n_negative=12, n_mixed=4),
            "transfer_resistance": _summary(
                "transfer_resistance", n_positive=20, n_negative=38, n_mixed=6,
                neg_examples=[{"text": "마스크에 묻어나요", "review_id": "r3"}],
            ),
            "application_blending": _summary("application_blending", n_positive=32, n_negative=8),
        },
        tradeoff_pairs=Counter({
            "pigmentation:positive -> transfer_resistance:negative_strong": 14,
            "persistence:positive -> dryness_skin_texture:negative_weak": 6,
        }),
        mixed_attribute_pairs=[("pigmentation", "transfer_resistance", 14)],
        delivery_condition_records_total=2,
    )


def _prd_thin() -> ProductReportData:
    return ProductReportData(
        product_id="A000000999999",
        product_name="Sparse Demo",
        n_reviews=42,
        n_records=42,
        n_mixed_reviews=0,
        n_with_tradeoff=0,
        attribute_summaries={
            "pigmentation": _summary("pigmentation", n_positive=2, n_negative=1),
        },
        tradeoff_pairs=Counter(),
        mixed_attribute_pairs=[],
        delivery_condition_records_total=0,
    )


# ---------------------------------------------------------------------------
# envelope
# ---------------------------------------------------------------------------


class TestEnvelope:
    def test_schema_version_pinned(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        assert out["schema_version"] == ANALYSIS_REPORT_SCHEMA_VERSION

    def test_product_slug_passes_through_when_supplied(self):
        out = productreportdata_to_analysis_report(
            _prd_rich(), product_slug="my-slug",
        )
        assert out["product"]["slug"] == "my-slug"
        assert out["product"]["name_ko"] == "롬앤 베러댄치크 03"

    def test_source_url_passes_through(self):
        out = productreportdata_to_analysis_report(
            _prd_rich(),
            source_url="https://example.com/p/12345",
        )
        assert out["product"]["source_url"] == "https://example.com/p/12345"


# ---------------------------------------------------------------------------
# corpus
# ---------------------------------------------------------------------------


class TestCorpus:
    def test_high_confidence_for_large_corpus(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        assert out["corpus"]["n_reviews_total"] == 1135
        assert out["corpus"]["confidence_level"] == "high"
        assert out["corpus"]["signal_stability"] == "high"

    def test_low_confidence_for_thin_corpus(self):
        out = productreportdata_to_analysis_report(_prd_thin())
        assert out["corpus"]["n_reviews_total"] == 42
        assert out["corpus"]["confidence_level"] == "low"

    def test_medium_confidence_threshold(self):
        prd = _prd_rich()
        prd.n_reviews = 500
        out = productreportdata_to_analysis_report(prd)
        assert out["corpus"]["confidence_level"] == "medium"

    def test_primary_sort_default(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        assert out["corpus"]["primary_sort"] == "DATETIME_DESC"

    def test_observation_window_passthrough(self):
        out = productreportdata_to_analysis_report(
            _prd_rich(),
            observation_window={"start": "2025-04-01", "end": "2026-04-01"},
        )
        assert out["corpus"]["observation_window"] == {"start": "2025-04-01", "end": "2026-04-01"}


# ---------------------------------------------------------------------------
# attributes
# ---------------------------------------------------------------------------


class TestAttributes:
    def test_all_attributes_emitted(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        keys = [a["key"] for a in out["attributes"]]
        assert set(keys) == {"pigmentation", "persistence", "transfer_resistance", "application_blending"}

    def test_label_strips_english_gloss(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        labels = {a["key"]: a["label_ko"] for a in out["attributes"]}
        assert labels["pigmentation"] == "발색"
        assert labels["transfer_resistance"] == "마스크/옷 묻어남 저항"
        # No English gloss like "(color intensity)" should leak
        for label in labels.values():
            assert "(" not in label

    def test_polarity_share_sums_to_one(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        for a in out["attributes"]:
            share = a["polarity_share"]
            total = share["positive"] + share["negative"] + share["mixed"]
            # rounding tolerance
            assert abs(total - 1.0) < 0.01 or total == 0.0

    def test_top_quotes_when_evidence_present(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        pig = next(a for a in out["attributes"] if a["key"] == "pigmentation")
        assert "top_quotes" in pig
        texts = [q["text"] for q in pig["top_quotes"]]
        assert "발색이 진하고 예뻐요" in texts


# ---------------------------------------------------------------------------
# strengths
# ---------------------------------------------------------------------------


class TestStrengths:
    def test_only_positive_dominant_attributes(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        keys = {s["attribute_key"] for s in out["strengths"]}
        # transfer_resistance has more negative than positive — excluded
        assert "transfer_resistance" not in keys
        assert "pigmentation" in keys

    def test_sorted_by_supporting_count_desc(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        counts = [s["supporting_count"] for s in out["strengths"]]
        assert counts == sorted(counts, reverse=True)

    def test_below_threshold_excluded(self):
        out = productreportdata_to_analysis_report(_prd_thin())
        assert out["strengths"] == []

    def test_representative_quote_attached(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        pig = next(s for s in out["strengths"] if s["attribute_key"] == "pigmentation")
        assert "representative_quote" in pig
        assert pig["representative_quote"]["text"] == "발색이 진하고 예뻐요"


# ---------------------------------------------------------------------------
# monitoring_candidates
# ---------------------------------------------------------------------------


class TestMonitoring:
    def test_only_above_threshold(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        keys = {m["attribute_key"] for m in out["monitoring_candidates"]}
        # All four attributes in the rich fixture clear ≥5 negative
        # (71, 12, 38, 8 all ≥5) — confirm the inclusion path.
        assert "transfer_resistance" in keys  # n_negative=38
        assert "pigmentation" in keys          # n_negative=71
        assert "persistence" in keys           # n_negative=12
        assert "application_blending" in keys  # n_negative=8

    def test_below_threshold_excluded(self):
        out = productreportdata_to_analysis_report(_prd_thin())
        # Sparse fixture: only attribute is pigmentation with
        # n_negative=1 (< 5) → no monitoring candidates.
        assert out["monitoring_candidates"] == []

    def test_concern_label_short(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        labels = {m["attribute_key"]: m["concern_label_ko"] for m in out["monitoring_candidates"]}
        assert labels["transfer_resistance"] == "마스크/옷 묻어남 저항"
        for label in labels.values():
            assert "(" not in label


# ---------------------------------------------------------------------------
# tradeoffs + usage_patterns
# ---------------------------------------------------------------------------


class TestTradeoffs:
    def test_tradeoffs_emitted_in_count_order(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        counts = [t["count"] for t in out["tradeoffs"]]
        assert counts == sorted(counts, reverse=True)

    def test_tradeoff_pair_format_preserved(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        first = out["tradeoffs"][0]
        assert " -> " in first["pair"]
        assert first["count"] == 14


class TestUsagePatterns:
    def test_contradictions_synthesized(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        kinds = {p["kind"] for p in out["usage_patterns"]}
        assert kinds == {"contradiction"}

    def test_only_attributes_with_both_polarities_above_floor(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        # All four attributes in fixture clear ≥5 on both sides
        # except application_blending (8 neg, 32 pos → both ≥5 → in)
        # and persistence (12 neg, 47 pos → both ≥5 → in)
        keys_in_patterns = []
        for p in out["usage_patterns"]:
            # extract attribute label from sentence_ko
            keys_in_patterns.append(p["sentence_ko"])
        assert any("발색" in s for s in keys_in_patterns)
        assert any("지속력" in s for s in keys_in_patterns)


# ---------------------------------------------------------------------------
# quick_decision
# ---------------------------------------------------------------------------


class TestQuickDecision:
    def test_verdict_mentions_top_strength(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        verdict = out["quick_decision"]["verdict_ko"]
        assert "발색" in verdict

    def test_who_for_derived_from_strengths(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        who_for = out["quick_decision"]["who_for_ko"]
        assert any("발색" in entry for entry in who_for)
        assert all(isinstance(e, str) for e in who_for)

    def test_who_not_for_derived_from_monitoring(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        who_not_for = out["quick_decision"]["who_not_for_ko"]
        assert any("묻어남" in entry for entry in who_not_for)

    def test_confidence_maps_to_brief_rubric(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        # large corpus → high → strong
        assert out["quick_decision"]["confidence_level"] == "strong"

    def test_thin_corpus_yields_weak(self):
        out = productreportdata_to_analysis_report(_prd_thin())
        assert out["quick_decision"]["confidence_level"] == "weak"


# ---------------------------------------------------------------------------
# buyer_segments + theme_contrasts (intentionally empty in v1 adapter)
# ---------------------------------------------------------------------------


class TestEmptyByDesign:
    def test_buyer_segments_empty(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        # Phase 2E doesn't have native segment detection; the adapter
        # does not invent data here.
        assert out["buyer_segments"] == []

    def test_theme_contrasts_empty(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        assert out["theme_contrasts"] == []

    def test_trend_null(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        assert out["trend"] is None


# ---------------------------------------------------------------------------
# methodology_notes
# ---------------------------------------------------------------------------


class TestMethodology:
    def test_disclosure_present(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        assert (out["methodology_notes"]["disclosure_ko"] or "").strip()

    def test_disclosure_does_not_overclaim(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        # Locked safety contract: disclosure must not promise efficacy
        # or confirm defects.
        d = out["methodology_notes"]["disclosure_ko"]
        assert "보장" not in d or "보장하지 않" in d


# ---------------------------------------------------------------------------
# Round-trip into the brief generator + validator
# ---------------------------------------------------------------------------


class TestRoundTripIntoBrief:
    def test_brief_succeeds_with_adapter_output(self):
        ar = productreportdata_to_analysis_report(
            _prd_rich(), product_slug="romand-better-than-cheek-03",
        )
        brief = generate_consumer_insight_brief(ar)
        result = validate_consumer_insight_brief(brief)
        assert result.ok, f"unexpected blocking flags: {result.blocking}"

    def test_brief_has_diverse_angle_types(self):
        ar = productreportdata_to_analysis_report(_prd_rich())
        brief = generate_consumer_insight_brief(ar)
        types = {a["type"] for a in brief["angle_candidates"]}
        # With no buyer_segments emitted by the adapter, segment-type
        # angles are absent — but strength/tradeoff/risk should all
        # be present.
        assert "strength" in types
        assert "tradeoff" in types
        assert "risk" in types

    def test_brief_evidence_boundaries_carry_locked_phrases(self):
        ar = productreportdata_to_analysis_report(_prd_rich())
        brief = generate_consumer_insight_brief(ar)
        cannot = brief["evidence_boundaries"]["what_we_cannot_say"]
        for required in ("제품 결함 확정", "효능 보장"):
            assert required in cannot

    def test_full_skeleton_succeeds_against_adapter_output(self):
        """The cardnews skeleton must build successfully off the
        adapter's analysis_report. Phase D2 fallback for slide 4
        (no buyer_segments) plus a disclosure that avoids the
        medical ban list together unblock end-to-end."""
        from src.voc.content.cardnews_generator import generate_instagram_cardnews_ko
        from src.voc.content.validators import validate_instagram_cardnews_ko

        ar = productreportdata_to_analysis_report(
            _prd_rich(), product_slug="romand-better-than-cheek-03",
        )
        brief = generate_consumer_insight_brief(ar)
        cn = generate_instagram_cardnews_ko(ar, brief=brief)
        result = validate_instagram_cardnews_ko(cn)
        assert result.ok, f"unexpected blocking flags: {result.blocking}"

    def test_default_disclosure_passes_ban_list(self):
        """The adapter's default disclosure must not contain any
        Phase B/C banned tokens — locked regression."""
        from src.voc.content.adapters.from_phase2e import _DEFAULT_DISCLOSURE_KO
        from src.voc.content.insight_brief import ANTI_CLICKBAIT_KO
        from src.voc.content.validators import (
            BAN_LIST_CAUSAL_KO,
            BAN_LIST_DIRECTIVE_KO,
            BAN_LIST_MEDICAL_KO,
            BAN_LIST_SUPERLATIVE_KO,
        )
        for term in (
            *BAN_LIST_MEDICAL_KO,
            *BAN_LIST_DIRECTIVE_KO,
            *BAN_LIST_SUPERLATIVE_KO,
            *BAN_LIST_CAUSAL_KO,
            *ANTI_CLICKBAIT_KO,
        ):
            assert term not in _DEFAULT_DISCLOSURE_KO, (
                f"adapter default disclosure contains banned token {term!r}"
            )

    def test_default_disclosure_carries_required_keyword(self):
        """The adapter's default disclosure must satisfy the cardnews
        `disclosure_keyword_preservation` rule — at least one of
        `리뷰` / `정리` / `효능 보장하지 않`."""
        from src.voc.content.adapters.from_phase2e import _DEFAULT_DISCLOSURE_KO
        assert any(
            kw in _DEFAULT_DISCLOSURE_KO
            for kw in ("리뷰", "정리", "효능 보장하지 않")
        )


# ---------------------------------------------------------------------------
# observable_multi_sort_corpus strategy
# ---------------------------------------------------------------------------


class TestObservableMultiSortStrategy:
    """Strategy-aware methodology + sample caveats. The mode is
    designed for issue/strength discovery, not unbiased distribution
    estimation; the disclosure must say so."""

    def test_passthrough_records_strategy(self):
        ar = productreportdata_to_analysis_report(
            _prd_rich(),
            sampling_strategy="observable_multi_sort_corpus",
        )
        assert ar["corpus"]["sampling_strategy"] == "observable_multi_sort_corpus"
        assert ar["methodology_notes"]["sampling_strategy"] == "observable_multi_sort_corpus"

    def test_observable_disclosure_explains_bias_profile(self):
        ar = productreportdata_to_analysis_report(
            _prd_rich(),
            sampling_strategy="observable_multi_sort_corpus",
        )
        d = ar["methodology_notes"]["disclosure_ko"]
        # Locked phrases for the observable-mode disclosure
        assert "여러 정렬" in d
        assert "무작위 표본" in d
        assert "수치 추정" in d
        assert "강점" in d and "단점" in d  # issue/strength framing

    def test_observable_caveats_carry_strategy_notes(self):
        ar = productreportdata_to_analysis_report(
            _prd_rich(),
            sampling_strategy="observable_multi_sort_corpus",
        )
        caveats = ar["methodology_notes"]["sample_caveats_ko"]
        joined = " ".join(caveats)
        # Default caveat preserved
        assert "자발적 작성자" in joined
        # New caveats present
        assert "review_id" in joined
        assert "수치 추정" in joined or "수치" in joined

    def test_observable_disclosure_passes_phase_b_validators(self):
        """Observable disclosure must NOT contain medical / directive /
        anti-clickbait tokens — locked regression."""
        from src.voc.content.adapters.from_phase2e import (
            _OBSERVABLE_MULTI_SORT_DISCLOSURE_KO,
            _OBSERVABLE_MULTI_SORT_SAMPLE_CAVEATS_KO,
        )
        from src.voc.content.insight_brief import ANTI_CLICKBAIT_KO
        from src.voc.content.validators import (
            BAN_LIST_CAUSAL_KO,
            BAN_LIST_DIRECTIVE_KO,
            BAN_LIST_MEDICAL_KO,
            BAN_LIST_SUPERLATIVE_KO,
        )
        text_corpus = " ".join(
            (
                _OBSERVABLE_MULTI_SORT_DISCLOSURE_KO,
                *_OBSERVABLE_MULTI_SORT_SAMPLE_CAVEATS_KO,
            )
        )
        for term in (
            *BAN_LIST_MEDICAL_KO,
            *BAN_LIST_DIRECTIVE_KO,
            *BAN_LIST_SUPERLATIVE_KO,
            *BAN_LIST_CAUSAL_KO,
            *ANTI_CLICKBAIT_KO,
        ):
            assert term not in text_corpus, (
                f"observable-mode disclosure contains banned token {term!r}"
            )

    def test_observable_disclosure_carries_required_keyword(self):
        from src.voc.content.adapters.from_phase2e import (
            _OBSERVABLE_MULTI_SORT_DISCLOSURE_KO,
        )
        assert any(
            kw in _OBSERVABLE_MULTI_SORT_DISCLOSURE_KO
            for kw in ("리뷰", "정리", "효능 보장하지 않")
        )

    def test_legacy_strategy_gets_legacy_disclosure(self):
        from src.voc.content.adapters.from_phase2e import _DEFAULT_DISCLOSURE_KO
        ar = productreportdata_to_analysis_report(
            _prd_rich(),
            sampling_strategy="latest_only",
        )
        assert ar["methodology_notes"]["disclosure_ko"] == _DEFAULT_DISCLOSURE_KO

    def test_observable_round_trip_into_brief(self):
        """End-to-end: adapter output (observable mode) feeds the
        brief generator + cardnews skeleton without validation
        failures."""
        from src.voc.content.cardnews_generator import generate_instagram_cardnews_ko
        from src.voc.content.insight_brief import (
            generate_consumer_insight_brief,
            validate_consumer_insight_brief,
        )
        from src.voc.content.validators import validate_instagram_cardnews_ko

        ar = productreportdata_to_analysis_report(
            _prd_rich(),
            product_slug="romand-better-than-cheek-03",
            sampling_strategy="observable_multi_sort_corpus",
        )
        brief = generate_consumer_insight_brief(ar)
        assert validate_consumer_insight_brief(brief).ok

        cn = generate_instagram_cardnews_ko(ar, brief=brief)
        assert validate_instagram_cardnews_ko(cn).ok


# ---------------------------------------------------------------------------
# SamplingStrategy literal extension (snapshot layer)
# ---------------------------------------------------------------------------


class TestSamplingStrategyLiteral:
    """The snapshot layer's SamplingStrategy enum gates which
    strategies are recognized by `compare_snapshots`. Ensure the
    new value is part of the public surface."""

    def test_observable_multi_sort_corpus_is_valid_strategy(self):
        # Importing the type hint via __args__ is the simplest way to
        # introspect a Literal at runtime.
        from src.voc.reporting.phase2e.snapshots import SamplingStrategy
        from typing import get_args

        values = set(get_args(SamplingStrategy))
        assert "observable_multi_sort_corpus" in values
        # Existing values still present
        assert "latest_only" in values
        assert "latest_plus_signal" in values


# ---------------------------------------------------------------------------
# top_quotes population (regression: empty bounded_review_excerpts bug)
# ---------------------------------------------------------------------------
#
# The Phase 2E aggregator stores per-attribute sample evidence under the
# field name `evidence_span` (not `text`). The adapter previously only
# looked for `text` / `evidence_text`, so every quote silently dropped.
# Phase E3 candidate_pool then produced empty bounded_review_excerpts,
# breaking the LLM extractor's substring-anchoring contract. These
# tests lock the field-name resolution + per-side quote count + length
# cap so the regression cannot recur.


def _prd_with_evidence_spans() -> ProductReportData:
    """Mirror what `aggregate_product` actually stores: each
    sample_evidence dict has key `evidence_span`, not `text`."""
    return ProductReportData(
        product_id="A000000123456",
        product_name="롬앤 베러댄치크 03",
        n_reviews=1135,
        n_records=1842,
        n_mixed_reviews=120,
        n_with_tradeoff=58,
        attribute_summaries={
            "pigmentation": _summary(
                "pigmentation",
                n_positive=181, n_negative=71, n_mixed=12,
                pos_examples=[
                    {"evidence_span": "발색이 정말 진하고 예뻐요", "review_id": "r482", "polarity": "positive"},
                    {"evidence_span": "색이 너무 잘 나와요 만족", "review_id": "r517", "polarity": "positive"},
                    {"evidence_span": "다른 제품보다 발색이 좋네요", "review_id": "r701", "polarity": "positive"},
                ],
                neg_examples=[
                    {"evidence_span": "시간 지나면 변색돼요", "review_id": "r223", "polarity": "negative_strong"},
                ],
            ),
            "transfer_resistance": _summary(
                "transfer_resistance",
                n_positive=20, n_negative=38, n_mixed=6,
                neg_examples=[
                    {"evidence_span": "마스크에 묻어나요 정말", "review_id": "r089", "polarity": "negative_strong"},
                    {"evidence_span": "옷에도 묻어나서 아쉬워요", "review_id": "r144", "polarity": "negative_strong"},
                ],
            ),
        },
        tradeoff_pairs=Counter(),
        mixed_attribute_pairs=[],
        delivery_condition_records_total=0,
    )


class TestTopQuotesPopulation:
    """Regression: top_quotes was silently empty because the adapter
    looked for `text` while the aggregator emits `evidence_span`."""

    def test_top_quotes_present_when_evidence_span_set(self):
        ar = productreportdata_to_analysis_report(_prd_with_evidence_spans())
        pig = next(a for a in ar["attributes"] if a["key"] == "pigmentation")
        assert "top_quotes" in pig
        assert len(pig["top_quotes"]) >= 3
        # Every quote carries verbatim text + review_id + polarity
        for q in pig["top_quotes"]:
            assert isinstance(q.get("text"), str) and q["text"]
            assert isinstance(q.get("review_id"), str) and q["review_id"]
            assert q.get("polarity") in (
                "positive", "negative_strong", "negative_weak", "mixed"
            )

    def test_quote_text_is_verbatim(self):
        ar = productreportdata_to_analysis_report(_prd_with_evidence_spans())
        pig = next(a for a in ar["attributes"] if a["key"] == "pigmentation")
        texts = {q["text"] for q in pig["top_quotes"]}
        # The aggregator's evidence_span values land verbatim in `text`.
        assert "발색이 정말 진하고 예뻐요" in texts
        assert "색이 너무 잘 나와요 만족" in texts

    def test_per_side_quote_count_up_to_5(self):
        ar = productreportdata_to_analysis_report(_prd_with_evidence_spans())
        pig = next(a for a in ar["attributes"] if a["key"] == "pigmentation")
        # 3 positive + 1 negative = 4 quotes (under cap)
        assert len(pig["top_quotes"]) == 4
        # Polarity split preserved
        pos = [q for q in pig["top_quotes"] if "positive" in q["polarity"]]
        neg = [q for q in pig["top_quotes"] if "negative" in q["polarity"]]
        assert len(pos) == 3
        assert len(neg) == 1

    def test_quote_text_truncated_at_cap(self):
        long = "발" * 300  # 300 chars
        prd = _prd_with_evidence_spans()
        prd.attribute_summaries["pigmentation"].sample_evidences_pos.append({
            "evidence_span": long, "review_id": "r999", "polarity": "positive",
        })
        ar = productreportdata_to_analysis_report(prd)
        pig = next(a for a in ar["attributes"] if a["key"] == "pigmentation")
        long_quote = next(q for q in pig["top_quotes"] if q["review_id"] == "r999")
        assert len(long_quote["text"]) <= 200

    def test_monitoring_top_negative_quotes_populated(self):
        prd = _prd_with_evidence_spans()
        ar = productreportdata_to_analysis_report(prd)
        tr = next(
            m for m in ar["monitoring_candidates"]
            if m["attribute_key"] == "transfer_resistance"
        )
        assert "top_negative_quotes" in tr
        assert len(tr["top_negative_quotes"]) >= 2
        for q in tr["top_negative_quotes"]:
            assert q.get("text")
            assert q.get("review_id")
            assert "negative" in (q.get("polarity") or "")

    def test_candidate_pool_bounded_excerpts_not_empty(self):
        """End-to-end: PRD → analysis_report → candidate_pool. The
        candidate_pool's bounded_review_excerpts must carry at least
        one entry per cited review_id so the LLM extractor's
        substring-anchoring check has anchors to compare against."""
        from src.voc.content.unique_insights.candidate_pool import (
            build_candidate_pool,
        )
        ar = productreportdata_to_analysis_report(_prd_with_evidence_spans())
        pool = build_candidate_pool(ar)
        excerpts = pool.excerpts_as_dict()
        assert excerpts, "bounded_review_excerpts is empty — top_quotes regression"
        # At least one strength bucket entry must carry evidence_review_ids.
        any_anchored = any(
            e.evidence_review_ids
            for e in pool.high_frequency_strengths
        )
        assert any_anchored, "no strength bucket carries evidence anchors"
        # Sanity: the verbatim excerpt for r482 is in the bounded map.
        assert "r482" in excerpts
        assert "발색이 정말 진하고 예뻐요" in excerpts["r482"]

    def test_legacy_text_field_still_supported(self):
        """The adapter accepts `text` (v3.0 schema name) AND
        `evidence_span` (aggregator field name) AND `evidence_text`
        (legacy). Test fixtures historically used `text`."""
        prd = ProductReportData(
            product_id="x", product_name="x", n_reviews=100, n_records=100,
            n_mixed_reviews=0, n_with_tradeoff=0,
            attribute_summaries={
                "pigmentation": _summary(
                    "pigmentation", n_positive=20, n_negative=2,
                    pos_examples=[
                        {"text": "예전부터 잘 쓰던 발색", "review_id": "r1"},
                    ],
                ),
            },
            tradeoff_pairs=Counter(),
            mixed_attribute_pairs=[],
            delivery_condition_records_total=0,
        )
        ar = productreportdata_to_analysis_report(prd)
        pig = next(a for a in ar["attributes"] if a["key"] == "pigmentation")
        assert pig["top_quotes"][0]["text"] == "예전부터 잘 쓰던 발색"


class TestCategoryAndProfileSuppression:
    """Adapter category propagation + profile-driven attribute
    suppression (skincare_pad case). The Stage 1 detector still
    runs against every attribute; suppression is a pure
    presentation-layer filter on the adapter output."""

    def _pad_prd(self) -> ProductReportData:
        """A toner-pad-shaped PRD that mistakenly carries makeup
        attribute hits — mirrors the Mediheal regression case."""
        return ProductReportData(
            product_id="A000000PAD",
            product_name="메디힐 데일리 토너패드",
            n_reviews=400, n_records=400, n_mixed_reviews=0, n_with_tradeoff=0,
            attribute_summaries={
                "pigmentation": _summary(
                    "pigmentation", n_positive=12, n_negative=3,
                    pos_examples=[{"text": "발색", "review_id": "r1"}],
                ),
                "color_tone_matching": _summary(
                    "color_tone_matching", n_positive=8, n_negative=2,
                ),
                "application_blending": _summary(
                    "application_blending", n_positive=10, n_negative=4,
                ),
                "transfer_resistance": _summary(
                    "transfer_resistance", n_positive=2, n_negative=15,
                    neg_examples=[{"text": "묻어남", "review_id": "r2"}],
                ),
                "multi_use_lip_cheek_compatibility": _summary(
                    "multi_use_lip_cheek_compatibility",
                    n_positive=4, n_negative=1,
                ),
                "persistence": _summary(
                    "persistence", n_positive=80, n_negative=10,
                    pos_examples=[{"text": "오래 가요", "review_id": "r3"}],
                ),
                "dryness_skin_texture": _summary(
                    "dryness_skin_texture", n_positive=5, n_negative=22,
                    neg_examples=[{"text": "건조함", "review_id": "r4"}],
                ),
                "packaging_container": _summary(
                    "packaging_container", n_positive=15, n_negative=4,
                ),
            },
            tradeoff_pairs=Counter({
                "pigmentation:positive -> dryness_skin_texture:negative_strong": 5,
                "persistence:positive -> dryness_skin_texture:negative_weak": 8,
            }),
            mixed_attribute_pairs=[],
            delivery_condition_records_total=0,
        )

    SUPPRESS_PAD = frozenset({
        "pigmentation",
        "color_tone_matching",
        "application_blending",
        "transfer_resistance",
        "multi_use_lip_cheek_compatibility",
    })

    def test_category_propagated_when_passed(self):
        out = productreportdata_to_analysis_report(
            _prd_rich(), product_category="블러셔",
        )
        assert out["product"]["category"] == "블러셔"

    def test_category_null_when_not_passed(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        assert out["product"]["category"] is None

    def test_profile_id_surfaces_when_passed(self):
        out = productreportdata_to_analysis_report(
            self._pad_prd(),
            selected_profile_id="skincare_pad",
            suppress_attributes=self.SUPPRESS_PAD,
        )
        assert out["product"]["selected_profile_id"] == "skincare_pad"
        assert out["product"]["suppressed_attributes"] == sorted(self.SUPPRESS_PAD)

    def test_profile_id_absent_by_default(self):
        out = productreportdata_to_analysis_report(_prd_rich())
        assert "selected_profile_id" not in out["product"]
        assert "suppressed_attributes" not in out["product"]

    def test_attributes_block_drops_suppressed_keys(self):
        out = productreportdata_to_analysis_report(
            self._pad_prd(),
            selected_profile_id="skincare_pad",
            suppress_attributes=self.SUPPRESS_PAD,
        )
        keys = {a["key"] for a in out["attributes"]}
        for k in self.SUPPRESS_PAD:
            assert k not in keys, f"{k!r} should be suppressed"
        # The skincare-relevant attributes survive.
        assert "persistence" in keys
        assert "dryness_skin_texture" in keys
        assert "packaging_container" in keys

    def test_strengths_block_drops_suppressed_keys(self):
        out = productreportdata_to_analysis_report(
            self._pad_prd(),
            selected_profile_id="skincare_pad",
            suppress_attributes=self.SUPPRESS_PAD,
        )
        keys = {s["attribute_key"] for s in out["strengths"]}
        assert "pigmentation" not in keys
        assert "application_blending" not in keys
        assert "persistence" in keys
        assert "packaging_container" in keys

    def test_monitoring_block_drops_suppressed_keys(self):
        out = productreportdata_to_analysis_report(
            self._pad_prd(),
            selected_profile_id="skincare_pad",
            suppress_attributes=self.SUPPRESS_PAD,
        )
        keys = {m["attribute_key"] for m in out["monitoring_candidates"]}
        # transfer_resistance had n_negative=15 — would normally be a
        # top monitoring candidate. Must be suppressed.
        assert "transfer_resistance" not in keys
        # dryness_skin_texture (n_negative=22) is the legitimate
        # complaint and must survive.
        assert "dryness_skin_texture" in keys

    def test_tradeoffs_drop_pairs_touching_suppressed(self):
        out = productreportdata_to_analysis_report(
            self._pad_prd(),
            selected_profile_id="skincare_pad",
            suppress_attributes=self.SUPPRESS_PAD,
        )
        pair_keys = {t["pair"] for t in out["tradeoffs"]}
        # The pair that touches `pigmentation` must be filtered.
        assert all("pigmentation" not in p for p in pair_keys), pair_keys
        # The pair that doesn't touch any suppressed key survives.
        assert (
            "persistence:positive -> dryness_skin_texture:negative_weak"
            in pair_keys
        )

    def test_quick_decision_does_not_reference_suppressed(self):
        out = productreportdata_to_analysis_report(
            self._pad_prd(),
            selected_profile_id="skincare_pad",
            suppress_attributes=self.SUPPRESS_PAD,
        )
        joined_text = (
            (out["quick_decision"]["verdict_ko"] or "")
            + " ".join(out["quick_decision"]["who_for_ko"])
            + " ".join(out["quick_decision"]["who_not_for_ko"])
            + " ".join(out["quick_decision"]["watch_outs_ko"])
        )
        # The suppressed attribute keys themselves shouldn't appear.
        for k in ("pigmentation", "color_tone_matching"):
            assert k not in joined_text, joined_text

    def test_suppression_off_when_arg_omitted(self):
        # Sanity: the suppression hook is opt-in. Without it, the
        # PRD's makeup attributes flow through unchanged.
        out = productreportdata_to_analysis_report(self._pad_prd())
        keys = {a["key"] for a in out["attributes"]}
        assert "pigmentation" in keys
        assert "transfer_resistance" in keys

    def test_empty_suppress_iterable_is_noop(self):
        out = productreportdata_to_analysis_report(
            self._pad_prd(), suppress_attributes=[],
        )
        keys = {a["key"] for a in out["attributes"]}
        assert "pigmentation" in keys

    def test_top_quotes_still_populated_after_suppression(self):
        # Regression guard: the v0 evidence-quote fix must continue
        # to work with the new filter. The surviving attributes
        # carry their `top_quotes` populated.
        out = productreportdata_to_analysis_report(
            self._pad_prd(),
            selected_profile_id="skincare_pad",
            suppress_attributes=self.SUPPRESS_PAD,
        )
        persistence = next(
            a for a in out["attributes"] if a["key"] == "persistence"
        )
        assert persistence.get("top_quotes")
        assert persistence["top_quotes"][0]["text"] == "오래 가요"
        dryness = next(
            a for a in out["attributes"] if a["key"] == "dryness_skin_texture"
        )
        assert dryness.get("top_quotes")
        assert dryness["top_quotes"][0]["text"] == "건조함"


class TestCategoryNormalizationDefensive:
    """Adapter must defensively normalize raw category strings even
    when callers pass legacy `\\n`-joined / duplicated breadcrumbs."""

    def test_newline_separated_yields_full_path(self):
        out = productreportdata_to_analysis_report(
            _prd_rich(),
            product_category="마스크팩\n패드\n패드",
        )
        # Newline → caller intended full path → output is " > "-joined,
        # deduped.
        assert out["product"]["category"] == "마스크팩 > 패드"

    def test_arrow_separated_yields_full_path(self):
        out = productreportdata_to_analysis_report(
            _prd_rich(),
            product_category="뷰티 > 스킨케어 > 토너패드",
        )
        assert out["product"]["category"] == "뷰티 > 스킨케어 > 토너패드"

    def test_bare_leaf_passes_through(self):
        out = productreportdata_to_analysis_report(
            _prd_rich(), product_category="패드",
        )
        assert out["product"]["category"] == "패드"

    def test_duplicates_in_arrow_path_deduped(self):
        out = productreportdata_to_analysis_report(
            _prd_rich(), product_category="패드 > 패드 > 패드",
        )
        assert out["product"]["category"] == "패드"

    def test_whitespace_only_yields_none(self):
        out = productreportdata_to_analysis_report(
            _prd_rich(), product_category="   \n  ",
        )
        assert out["product"]["category"] is None


class TestProfileLabelOverridesInAdapter:
    """skincare_pad profile must replace makeup-leaning labels in
    every block (attributes, strengths, monitoring, quick_decision)."""

    def _pad_prd(self):
        # Reuse the toner-pad PRD shape from the suppression test.
        return TestCategoryAndProfileSuppression()._pad_prd()

    def test_attributes_block_uses_skincare_pad_labels(self):
        out = productreportdata_to_analysis_report(
            self._pad_prd(),
            selected_profile_id="skincare_pad",
            suppress_attributes=TestCategoryAndProfileSuppression.SUPPRESS_PAD,
        )
        attrs = {a["key"]: a["label_ko"] for a in out["attributes"]}
        # The pad fixture only has these surviving keys; ensure they
        # display with skincare-pad overrides.
        if "persistence" in attrs:
            assert attrs["persistence"] == "수분 지속감"
        if "dryness_skin_texture" in attrs:
            assert attrs["dryness_skin_texture"] == "건조감/당김"
        if "packaging_container" in attrs:
            assert attrs["packaging_container"] == "용기/집게"

    def test_default_profile_uses_canonical_labels(self):
        out = productreportdata_to_analysis_report(self._pad_prd())
        attrs = {a["key"]: a["label_ko"] for a in out["attributes"]}
        # Canonical short label, no override.
        if "persistence" in attrs:
            assert attrs["persistence"] == "지속력"
        if "dryness_skin_texture" in attrs:
            assert attrs["dryness_skin_texture"] == "건조감"

    def test_quick_decision_uses_overridden_labels(self):
        out = productreportdata_to_analysis_report(
            self._pad_prd(),
            selected_profile_id="skincare_pad",
            suppress_attributes=TestCategoryAndProfileSuppression.SUPPRESS_PAD,
        )
        # Verdict mentions "수분 지속감" not "지속력"; "건조감/당김"
        # not "건조감"; "용기/집게" not "외부 용기".
        joined = (
            (out["quick_decision"]["verdict_ko"] or "")
            + " ".join(out["quick_decision"]["who_for_ko"])
            + " ".join(out["quick_decision"]["who_not_for_ko"])
        )
        # At least one override label must appear in the surfaces.
        assert any(
            override in joined
            for override in (
                "수분 지속감",
                "건조감/당김",
                "용기/집게",
            )
        ), joined

    def test_monitoring_concern_label_uses_override(self):
        out = productreportdata_to_analysis_report(
            self._pad_prd(),
            selected_profile_id="skincare_pad",
            suppress_attributes=TestCategoryAndProfileSuppression.SUPPRESS_PAD,
        )
        labels = {
            m["attribute_key"]: m["concern_label_ko"]
            for m in out["monitoring_candidates"]
        }
        if "dryness_skin_texture" in labels:
            assert labels["dryness_skin_texture"] == "건조감/당김"


class TestQuoteSelectionInAdapter:
    """Strengths block must pick the most decision-useful quote from
    available sample evidences, not blindly index 0."""

    def _make_prd(self, ev_list):
        from collections import Counter
        from src.voc.reporting.phase2e.report import (
            AttributeSummary, ProductReportData,
        )
        s = AttributeSummary(attribute="value_price")
        s.n_positive = 100
        s.n_negative = 5
        s.sample_evidences_pos = list(ev_list)
        return ProductReportData(
            product_id="X", product_name="Y",
            n_reviews=200, n_records=200,
            n_mixed_reviews=0, n_with_tradeoff=0,
            attribute_summaries={"value_price": s},
            tradeoff_pairs=Counter(),
            mixed_attribute_pairs=[],
            delivery_condition_records_total=0,
        )

    def test_specific_quote_wins_over_generic(self):
        # First quote is generic; second carries pad-specific nouns.
        prd = self._make_prd([
            {"text": "너무 만족해요", "review_id": "r1"},
            {"text": "200매 대용량이라 팍팍 쓰기 좋아요", "review_id": "r2"},
            {"text": "정말 좋아요", "review_id": "r3"},
        ])
        out = productreportdata_to_analysis_report(
            prd, selected_profile_id="skincare_pad",
        )
        strengths = {s["attribute_key"]: s for s in out["strengths"]}
        rep = strengths["value_price"].get("representative_quote")
        assert rep is not None
        assert rep["review_id"] == "r2"

    def test_default_profile_falls_back_to_first(self):
        # Without a profile, no nouns are bonused — but generics are
        # still penalized. So a non-generic first quote wins.
        prd = self._make_prd([
            {"text": "괜찮은 제품입니다", "review_id": "r1"},
            {"text": "정말 좋아요", "review_id": "r2"},  # generic-penalized
        ])
        out = productreportdata_to_analysis_report(prd)
        strengths = {s["attribute_key"]: s for s in out["strengths"]}
        rep = strengths["value_price"].get("representative_quote")
        assert rep["review_id"] == "r1"

