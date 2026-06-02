"""Tests for src.voc.content.cardnews_generator.

Phase B contract: deterministic slot-fill from analysis_report.json
to a 7-slide KO Instagram cardnews JSON. Output must pass
`validate_instagram_cardnews_ko` (zero blocking flags).
"""
from __future__ import annotations

import copy

import pytest

from src.voc.content.cardnews_generator import (
    CARDNEWS_FORMAT,
    CARDNEWS_SCHEMA_VERSION,
    CardnewsGenerationError,
    SLIDE_TITLES_KO,
    generate_instagram_cardnews_ko,
)
from src.voc.content.validators import (
    BULLETS_MAX,
    BULLETS_MIN,
    EXPECTED_SLIDE_COUNT,
    EXPECTED_SLIDE_TYPES,
    validate_instagram_cardnews_ko,
)


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


def _rich_report() -> dict:
    """Analysis report rich enough for every slide to clear its
    minimums. Used by the happy-path tests."""
    return {
        "schema_version": "3.0",
        "product": {
            "slug": "demo-product",
            "name_ko": "데모 제품",
            "source_url": "https://example.com/p/123",
        },
        "corpus": {
            "n_reviews_total": 1135,
            "primary_sort": "DATETIME_DESC",
            "sampling_strategy": "latest_only",
            "corpus_type": "observed_scrape",
            "confidence_level": "high",
            "signal_stability": "high",
            "observation_window": {"start": "2025-04-01", "end": "2026-04-01"},
        },
        "attributes": [
            {"key": "pigmentation",   "label_ko": "발색",   "n_positive": 181, "n_negative": 71, "n_mixed": 12, "evidence_score": 4.2},
            {"key": "persistence",    "label_ko": "지속력", "n_positive": 47,  "n_negative": 12, "n_mixed": 4,  "evidence_score": 2.1},
            {"key": "transfer_resistance","label_ko":"묻어남","n_positive": 20, "n_negative": 38, "n_mixed": 6,  "evidence_score": 3.0},
            {"key": "application_blending","label_ko":"발림성","n_positive": 32, "n_negative": 8, "n_mixed": 2, "evidence_score": 1.8},
        ],
        "strengths": [
            {"attribute_key": "pigmentation", "supporting_count": 181, "theme_keywords_ko": ["선명", "진한"]},
            {"attribute_key": "persistence",  "supporting_count": 47,  "theme_keywords_ko": ["오래 가요"]},
            {"attribute_key": "application_blending", "supporting_count": 32},
        ],
        "monitoring_candidates": [
            {"attribute_key": "transfer_resistance", "concern_label_ko": "묻어남", "n_negative": 38},
            {"attribute_key": "pigmentation",        "concern_label_ko": "발색 변화", "n_negative": 12},
        ],
        "tradeoffs": [],
        "usage_patterns": [
            {"kind": "contradiction", "sentence_ko": "<b>발색</b> 호평/비판 양쪽 등장", "evidence_count": 252},
        ],
        "buyer_segments": [
            {"segment_kind": "skin_type", "label_ko": "건성 피부",
             "dominant_count": 32, "dominance_ratio": 0.78, "confidence_level": "strong"},
            {"segment_kind": "tone", "label_ko": "쿨톤",
             "dominant_count": 24, "dominance_ratio": 0.66, "confidence_level": "moderate"},
            {"segment_kind": "usage_context", "label_ko": "마스크 환경",
             "dominant_count": 5, "dominance_ratio": 0.51, "confidence_level": "weak"},
        ],
        "quick_decision": {
            "verdict_ko": "발색이 진하다는 평이 두드러집니다",
            "who_for_ko": ["건성 피부에서 잘 맞았다는 의견", "쿨톤 사용자에서 호평 반복"],
            "who_not_for_ko": ["마스크/외출 사용이 잦은 분"],
            "watch_outs_ko": ["묻어남"],
            "confidence_level": "strong",
        },
        "theme_contrasts": [
            {"pair_label_ko": "자연스러움 vs 발색력", "share_a": 0.41, "share_b": 0.59},
        ],
        "methodology_notes": {
            "disclosure_ko": "공개 리뷰 데이터를 정리한 정보입니다",
            "sample_caveats_ko": [],
        },
    }


def _sparse_report() -> dict:
    """Bare-minimum report — enough for slugify but not enough for
    cardnews generation. Used to exercise CardnewsGenerationError."""
    return {
        "schema_version": "3.0",
        "product": {"slug": "demo", "name_ko": "데모"},
        "corpus": {
            "n_reviews_total": 50,
            "primary_sort": "DATETIME_DESC",
            "confidence_level": "low",
            "signal_stability": "low",
        },
        "attributes": [],
    }


# ---------------------------------------------------------------------------
# happy path
# ---------------------------------------------------------------------------


class TestGenerateHappyPath:
    def test_returns_seven_slides(self):
        cn = generate_instagram_cardnews_ko(_rich_report())
        assert cn["slide_count"] == EXPECTED_SLIDE_COUNT
        assert len(cn["slides"]) == EXPECTED_SLIDE_COUNT

    def test_slides_are_in_canonical_order(self):
        cn = generate_instagram_cardnews_ko(_rich_report())
        for i, slide in enumerate(cn["slides"]):
            assert slide["index"] == i + 1
            assert slide["type"] == EXPECTED_SLIDE_TYPES[i]

    def test_envelope_fields(self):
        cn = generate_instagram_cardnews_ko(_rich_report())
        assert cn["schema_version"] == CARDNEWS_SCHEMA_VERSION
        assert cn["lang"] == "ko"
        assert cn["channel"] == "instagram"
        assert cn["format"] == CARDNEWS_FORMAT
        assert cn["product"]["slug"] == "demo-product"
        assert cn["confidence_level"] in ("weak", "moderate", "strong")
        assert isinstance(cn["analysis_report_sha256"], str)
        assert len(cn["analysis_report_sha256"]) == 64

    def test_passes_validator(self):
        cn = generate_instagram_cardnews_ko(_rich_report())
        result = validate_instagram_cardnews_ko(cn)
        assert result.ok, f"unexpected blocking flags: {result.blocking}"

    def test_slide_titles_are_locked(self):
        cn = generate_instagram_cardnews_ko(_rich_report())
        for slide in cn["slides"]:
            assert slide["title"] == SLIDE_TITLES_KO[slide["type"]]


# ---------------------------------------------------------------------------
# confidence gating
# ---------------------------------------------------------------------------


class TestConfidenceGating:
    @pytest.mark.parametrize(
        "qd_confidence",
        ["weak", "moderate", "strong"],
    )
    def test_hook_subtitle_buyer_facing_at_every_confidence(self, qd_confidence):
        # The new deterministic hook builds a contrast pair from
        # attribute counts and never uses the legacy "리뷰에서 …
        # 인상" lead. At every confidence band the subtitle must:
        #   - be non-empty
        #   - NOT start with the legacy internal-report lead
        #   - carry either the contrast-pair "강점/의견 갈림" frame
        #     or a count-paired single-line phrase.
        report = _rich_report()
        report["quick_decision"]["confidence_level"] = qd_confidence
        cn = generate_instagram_cardnews_ko(report)
        subtitle = cn["slides"][0]["subtitle"]
        assert subtitle and isinstance(subtitle, str)
        for legacy in (
            "리뷰에서 자주 보이는 인상",
            "리뷰에서 반복되는 인상",
            "리뷰에서 일관되게 나타나는 인상",
        ):
            assert not subtitle.startswith(legacy), subtitle
        # Buyer-decision frame: contrast pair OR count-paired phrase.
        assert (
            ("강점" in subtitle and "의견 갈림" in subtitle)
            or "만족 후기" in subtitle
            or "불만 후기" in subtitle
        ), subtitle

    def test_corpus_confidence_falls_back_when_quick_decision_missing(self):
        # Strip quick_decision; expect corpus.signal_stability=high → strong lead
        report = _rich_report()
        report.pop("quick_decision")
        # Provide a fallback verdict via top positive attribute
        cn = generate_instagram_cardnews_ko(report)
        assert cn["confidence_level"] == "strong"

    def test_low_corpus_confidence_yields_weak_framing(self):
        report = _rich_report()
        report["corpus"]["confidence_level"] = "low"
        report["corpus"]["signal_stability"] = "low"
        report["quick_decision"].pop("confidence_level", None)
        cn = generate_instagram_cardnews_ko(report)
        assert cn["confidence_level"] == "weak"


# ---------------------------------------------------------------------------
# slide content gating (segments by confidence)
# ---------------------------------------------------------------------------


class TestSlideFitConfidence:
    def test_excludes_weak_segments(self):
        cn = generate_instagram_cardnews_ko(_rich_report())
        slide_fit = cn["slides"][3]
        joined = " ".join(slide_fit["bullets"])
        # Weak segment "마스크 환경" should NOT appear on slide 4.
        assert "마스크 환경" not in joined

    def test_includes_moderate_and_strong_segments(self):
        cn = generate_instagram_cardnews_ko(_rich_report())
        slide_fit = cn["slides"][3]
        joined = " ".join(slide_fit["bullets"])
        assert "건성 피부" in joined
        assert "쿨톤" in joined


class TestSlideWatchOutsThreshold:
    def test_falls_back_to_attribute_negatives_when_monitoring_thin(self):
        """When monitoring_candidates carries n_negative below
        threshold, the slide builder falls back to the attribute
        table — which still has n_negative=38 on transfer_resistance
        in the rich fixture."""
        report = _rich_report()
        for c in report["monitoring_candidates"]:
            c["n_negative"] = 0  # below threshold
        cn = generate_instagram_cardnews_ko(report)
        slide_watch_outs = cn["slides"][4]
        joined = " ".join(slide_watch_outs["bullets"])
        # transfer_resistance label is "묻어남" — that should appear
        assert "묻어남" in joined

    def test_raises_when_no_negative_signal_anywhere(self):
        """Both monitoring_candidates and attribute negatives wiped:
        cardnews generation must fail. Failure may be raised from
        slide_divides or slide_watch_outs depending on which dries
        up first; both are valid surfaces and the test asserts
        that *some* slide builder raises CardnewsGenerationError."""
        report = _rich_report()
        for c in report["monitoring_candidates"]:
            c["n_negative"] = 0
        for a in report["attributes"]:
            a["n_negative"] = 0
        with pytest.raises(CardnewsGenerationError):
            generate_instagram_cardnews_ko(report)


# ---------------------------------------------------------------------------
# error / failure paths
# ---------------------------------------------------------------------------


class TestGenerationErrors:
    def test_sparse_report_raises(self):
        with pytest.raises(CardnewsGenerationError):
            generate_instagram_cardnews_ko(_sparse_report())

    def test_no_strengths_no_positive_attrs_raises_loved(self):
        report = _rich_report()
        report.pop("strengths", None)
        # Make every attribute negative-leaning
        for a in report["attributes"]:
            a["n_positive"] = 0
        with pytest.raises(CardnewsGenerationError, match="slide_loved"):
            generate_instagram_cardnews_ko(report)

    def test_no_segments_no_fallback_raises_fit(self):
        # New slide_fit path: derives bullets from segments first,
        # then from `report.strengths`. The error fires only when
        # both buckets are empty (no segments above moderate AND no
        # strengths). brief / who_for_ko are no longer consulted by
        # slide 4 because they carried the verbose tautological
        # template the operator critiqued.
        report = _rich_report()
        for s in report["buyer_segments"]:
            s["confidence_level"] = "weak"
        report["strengths"] = []
        with pytest.raises(CardnewsGenerationError, match="slide_fit"):
            generate_instagram_cardnews_ko(report)

    def test_non_dict_input_raises(self):
        with pytest.raises(CardnewsGenerationError):
            generate_instagram_cardnews_ko("not a dict")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# bullet count + length budgets (verified end-to-end via generator)
# ---------------------------------------------------------------------------


class TestBulletBudgets:
    def test_every_slide_within_bullet_budget(self):
        cn = generate_instagram_cardnews_ko(_rich_report())
        for slide in cn["slides"]:
            if slide["type"] == "hook":
                continue
            if slide["type"] == "best_for":
                bullets = slide["for_bullets"] + slide["not_for_bullets"]
            else:
                bullets = slide["bullets"]
            assert BULLETS_MIN <= len(bullets) <= BULLETS_MAX, (
                f"slide {slide['type']} has {len(bullets)} bullets"
            )


# ---------------------------------------------------------------------------
# best_for fallback derivation
# ---------------------------------------------------------------------------


class TestBestForFallback:
    """Slide 6 derives for/not_for from `report.strengths` /
    `monitoring_candidates` directly using profile-aware buyer
    phrases. The earlier path that surfaced
    `quick_decision.who_for_ko[0]` verbatim is intentionally
    removed — those strings carried the verbose tautological
    template the operator critiqued ("X 만족 후기 N건이 누적되는
    사용자: 잘 맞았다는 의견")."""

    def test_for_bullets_derived_from_strengths(self):
        cn = generate_instagram_cardnews_ko(_rich_report())
        slide_best_for = cn["slides"][5]
        assert slide_best_for["for_bullets"]
        joined = " ".join(slide_best_for["for_bullets"])
        # Top strength in the rich fixture is `pigmentation`
        # (n_pos=181). Without a profile_id it surfaces as the
        # canonical short label "발색" with a count.
        assert "발색" in joined or "만족 후기" in joined

    def test_for_bullets_no_tautological_누적되는_사용자(self):
        # The verbose audience template MUST NOT appear in the
        # deterministic skeleton.
        cn = generate_instagram_cardnews_ko(_rich_report())
        for b in cn["slides"][5]["for_bullets"]:
            assert "누적되는 사용자" not in b, b
            assert "잘 맞았다는 의견" not in b, b

    def test_not_for_bullets_carry_count(self):
        # Every not_for bullet must include a digit (the n_negative
        # count) so the editorial validator's evidence-pair check
        # passes downstream.
        cn = generate_instagram_cardnews_ko(_rich_report())
        for b in cn["slides"][5]["not_for_bullets"]:
            assert any(ch.isdigit() for ch in b), b


# ---------------------------------------------------------------------------
# method slide
# ---------------------------------------------------------------------------


class TestSlideMethod:
    def test_disclosure_present(self):
        cn = generate_instagram_cardnews_ko(_rich_report())
        slide_method = cn["slides"][6]
        assert slide_method["disclosure"]

    def test_disclosure_falls_back_when_missing(self):
        report = _rich_report()
        report.pop("methodology_notes")
        cn = generate_instagram_cardnews_ko(report)
        slide_method = cn["slides"][6]
        assert slide_method["disclosure"]

    def test_includes_corpus_size_bullet(self):
        cn = generate_instagram_cardnews_ko(_rich_report())
        slide_method = cn["slides"][6]
        joined = " ".join(slide_method["bullets"])
        assert "1135" in joined

    def test_observation_window_yyyy_mm(self):
        cn = generate_instagram_cardnews_ko(_rich_report())
        slide_method = cn["slides"][6]
        joined = " ".join(slide_method["bullets"])
        assert "2025-04" in joined
        assert "2026-04" in joined


# ---------------------------------------------------------------------------
# determinism + idempotence
# ---------------------------------------------------------------------------


class TestDeterminism:
    def test_same_report_same_slides(self):
        report = _rich_report()
        a = generate_instagram_cardnews_ko(report)
        b = generate_instagram_cardnews_ko(report)
        # generated_at differs, but slides should be byte-identical
        assert a["slides"] == b["slides"]
        assert a["analysis_report_sha256"] == b["analysis_report_sha256"]

    def test_does_not_mutate_input(self):
        report = _rich_report()
        before = copy.deepcopy(report)
        generate_instagram_cardnews_ko(report)
        assert report == before


# ---------------------------------------------------------------------------
# ban-list resilience (output never contains banned terms)
# ---------------------------------------------------------------------------


class TestSlideFitFallback:
    """When buyer_segments is empty (Phase 2E adapter case), slide 4
    derives bullets from `report.strengths` using profile-aware
    phrases (or count-paired display labels). It does NOT consume
    brief.best_for or quick_decision.who_for_ko — those carry the
    verbose tautological template the operator critiqued."""

    def test_falls_back_to_strengths_when_segments_empty(self):
        report = _rich_report()
        report["buyer_segments"] = []  # simulate Phase 2E adapter output
        cn = generate_instagram_cardnews_ko(report)
        slide_fit = cn["slides"][3]
        assert slide_fit["type"] == "fit"
        joined = " ".join(slide_fit["bullets"])
        # Top strength in fixture: `pigmentation` n_pos=181 →
        # canonical label "발색" with a count.
        assert "발색" in joined
        assert "만족" in joined

    def test_no_tautological_phrase_in_fit_bullets(self):
        report = _rich_report()
        report["buyer_segments"] = []
        cn = generate_instagram_cardnews_ko(report)
        slide_fit = cn["slides"][3]
        for b in slide_fit["bullets"]:
            assert "누적되는 사용자" not in b, b
            assert "잘 맞았다는 의견" not in b, b

    def test_still_raises_when_no_segments_and_no_strengths(self):
        report = _rich_report()
        report["buyer_segments"] = []
        report["strengths"] = []
        with pytest.raises(CardnewsGenerationError, match="slide_fit"):
            generate_instagram_cardnews_ko(report)


class TestBriefPrecedence:
    """Phase C: when a brief is supplied, the cardnews generator
    prefers brief.core_verdict.ko, brief.best_for/not_for, and
    brief.confidence_level over the analysis_report fields."""

    def _brief_for(self, report: dict, *, confidence: str = "moderate") -> dict:
        from src.voc.content.insight_brief import generate_consumer_insight_brief
        b = generate_consumer_insight_brief(report)
        b["confidence_level"] = confidence
        return b

    def test_hook_does_not_read_brief_verdict_in_skeleton(self):
        # The deterministic skeleton hook now builds a contrast pair
        # locally from attribute counts. The brief's `core_verdict.ko`
        # carries the long internal-report sentence the operator
        # critiqued — it must NOT land in the skeleton hook. (When
        # the LLM polish layer runs, it can choose to consume the
        # brief; that's a separate code path.)
        report = _rich_report()
        report["quick_decision"]["verdict_ko"] = "기본 보고서의 한 줄 인상"
        brief = self._brief_for(report)
        brief["core_verdict"]["ko"] = "브리프가 정한 한 줄 인상"

        cn = generate_instagram_cardnews_ko(report, brief=brief)
        subtitle = cn["slides"][0]["subtitle"]
        assert "브리프가 정한 한 줄 인상" not in subtitle, subtitle
        assert "기본 보고서의 한 줄 인상" not in subtitle, subtitle
        # Sanity: the contrast-pair OR count-paired hook still
        # surfaces a meaningful buyer cue.
        assert (
            ("강점" in subtitle and "의견 갈림" in subtitle)
            or "만족 후기" in subtitle
            or "불만 후기" in subtitle
        ), subtitle

    def test_best_for_does_not_read_brief_in_skeleton(self):
        # Same separation: the skeleton derives slide 6 from
        # report.strengths/monitoring directly, not from brief.
        report = _rich_report()
        report["quick_decision"]["who_for_ko"] = ["보고서 텍스트"]
        brief = self._brief_for(report)
        brief["best_for"] = [
            {"label_ko": "브리프 best_for 1", "evidence_n": 10,
             "confidence": "moderate"},
            {"label_ko": "브리프 best_for 2", "evidence_n": 5,
             "confidence": "moderate"},
        ]

        cn = generate_instagram_cardnews_ko(report, brief=brief)
        for_bullets = " ".join(cn["slides"][5]["for_bullets"])
        # Brief strings DO NOT land in the deterministic skeleton.
        assert "브리프 best_for 1" not in for_bullets, for_bullets
        # Neither does the verbose who_for_ko fixture entry.
        assert "보고서 텍스트" not in for_bullets, for_bullets

    def test_buyer_decision_register_run_005_quality_bar(self):
        """End-to-end check that a run-005-shaped report (skincare_pad
        profile, profile-aware labels written by the adapter) yields
        a publishable cardnews skeleton."""
        from collections import Counter
        from src.voc.content.adapters.from_phase2e import (
            productreportdata_to_analysis_report,
        )
        from src.voc.reporting.phase2e.report import (
            AttributeSummary, ProductReportData,
        )

        def _attr(a, *, n_pos=0, n_neg=0, pos=None):
            s = AttributeSummary(attribute=a)
            s.n_positive = n_pos
            s.n_negative = n_neg
            s.n_mixed = 0
            if pos:
                s.sample_evidences_pos = list(pos)
            return s

        prd = ProductReportData(
            product_id="A_PAD",
            product_name="메디힐 더마 패드 200매",
            n_reviews=2029, n_records=572,
            n_mixed_reviews=0, n_with_tradeoff=10,
            attribute_summaries={
                "value_price": _attr(
                    "value_price", n_pos=155, n_neg=23,
                    pos=[{"text": "200매라 가성비도 좋아요", "review_id": "r1"}],
                ),
                "finish_texture": _attr(
                    "finish_texture", n_pos=135, n_neg=34,
                    pos=[{"text": "촉촉하게 유지돼요", "review_id": "r2"}],
                ),
                "dryness_skin_texture": _attr(
                    "dryness_skin_texture", n_pos=52, n_neg=17,
                ),
                "adhesion_base_interaction": _attr(
                    "adhesion_base_interaction", n_pos=39, n_neg=13,
                ),
            },
            tradeoff_pairs=Counter({
                "value_price:positive -> finish_texture:negative_strong": 5,
            }),
            mixed_attribute_pairs=[], delivery_condition_records_total=0,
        )
        ar = productreportdata_to_analysis_report(
            prd,
            product_category="패드",
            selected_profile_id="skincare_pad",
            suppress_attributes=frozenset({
                "pigmentation", "color_tone_matching",
                "application_blending", "transfer_resistance",
                "multi_use_lip_cheek_compatibility",
            }),
        )
        cn = generate_instagram_cardnews_ko(ar)

        # ---- Slide-1 hook: contrast pair, no internal-report lead.
        h = cn["slides"][0]["subtitle"]
        assert "리뷰에서 일관되게 나타나는 인상" not in h, h
        assert "리뷰에서 반복되는 인상" not in h, h
        assert "리뷰에서 자주 보이는 인상" not in h, h
        assert "강점" in h and "의견 갈림" in h, h
        # Profile-aware noun phrase for the strongest signal.
        assert "200매 대용량 가성비" in h, h

        # ---- Slide-2 loved: profile-aware loved phrases.
        loved = cn["slides"][1]["bullets"]
        joined_loved = " ".join(loved)
        assert "200매 대용량 가성비" in joined_loved, joined_loved
        assert "한 장으로 촉촉함" in joined_loved, joined_loved
        # Old "호평 N건" template gone.
        for b in loved:
            assert "호평" not in b, b
            assert "만족 후기" in b, b

        # ---- Slide-3 divides: 만족/불만 wording.
        divides = cn["slides"][2]["bullets"]
        for b in divides:
            assert "호평" not in b and "비판" not in b, b
            assert "만족" in b and "불만" in b, b

        # ---- Slide-4 fit: profile-aware buyer descriptions.
        fit = cn["slides"][3]["bullets"]
        joined_fit = " ".join(fit)
        # No tautological audience template.
        for b in fit:
            assert "누적되는 사용자" not in b, b
            assert "잘 맞았다는 의견" not in b, b
        # Profile-aware fit_for phrase from the table.
        assert (
            "대용량 패드를 자주 쓰고 싶은 분" in joined_fit
            or "촉촉함이 우선인 데일리 사용자" in joined_fit
        ), joined_fit

        # ---- Slide-5 watch_outs: complaint-shape phrases.
        watch_outs = cn["slides"][4]["bullets"]
        joined_w = " ".join(watch_outs)
        for b in watch_outs:
            assert "비판 의견" not in b, b
            # Each watch_out bullet carries either the complaint
            # phrase from the profile table or a count-paired
            # fallback — never the bare label alone.
            assert any(ch.isdigit() for ch in b), b
        # At least one profile-table phrase surfaces.
        assert (
            "오래 붙이면 답답하다는 후기" in joined_w
            or "가격 대비 효과 의견 갈림" in joined_w
            or "사용 후 당김 호소" in joined_w
            or "밀착력 부족 후기" in joined_w
        ), joined_w

        # ---- Slide-6 best_for: no truncation, profile phrases.
        bf = cn["slides"][5]
        joined_bf = " ".join(bf["for_bullets"] + bf["not_for_bullets"])
        for b in bf["for_bullets"] + bf["not_for_bullets"]:
            # No mid-character truncation marker that loses count
            # (the operator's run-003 bug).
            assert not b.endswith("…"), b
            # Stays under the bullet budget.
            assert len(b) <= 40, (b, len(b))
        # All not_for bullets carry their negative-count digit.
        for b in bf["not_for_bullets"]:
            assert any(ch.isdigit() for ch in b), b

        # ---- Cross-slide ban scan: no banned generics in skeleton.
        from src.voc.content.editorial_rules import (
            find_unsupported_generic_phrases,
        )
        for s in cn["slides"]:
            for fld in ("subtitle", "disclosure"):
                hits = find_unsupported_generic_phrases(s.get(fld))
                blocking = [h for h in hits if h["severity"] == "block"]
                assert not blocking, (s.get("type"), fld, blocking)
            for b in (s.get("bullets") or []) + (
                s.get("for_bullets") or []
            ) + (s.get("not_for_bullets") or []):
                hits = find_unsupported_generic_phrases(b)
                blocking = [h for h in hits if h["severity"] == "block"]
                assert not blocking, (s.get("type"), b, blocking)

    def test_confidence_level_from_brief(self):
        report = _rich_report()
        report["quick_decision"]["confidence_level"] = "weak"
        brief = self._brief_for(report, confidence="strong")
        cn = generate_instagram_cardnews_ko(report, brief=brief)
        assert cn["confidence_level"] == "strong"

    def test_records_source_brief_sha(self):
        report = _rich_report()
        brief = self._brief_for(report)
        cn = generate_instagram_cardnews_ko(report, brief=brief)
        assert isinstance(cn["source_brief_sha256"], str)
        assert len(cn["source_brief_sha256"]) == 64

    def test_no_brief_keeps_phase_b_behavior(self):
        report = _rich_report()
        cn = generate_instagram_cardnews_ko(report)  # no brief kwarg
        assert cn["source_brief_sha256"] is None


class TestBanListResilience:
    def test_generated_output_passes_ban_list(self):
        cn = generate_instagram_cardnews_ko(_rich_report())
        result = validate_instagram_cardnews_ko(cn)
        ban_rules = {
            "ban_list_medical",
            "ban_list_directive",
            "ban_list_superlative",
            "ban_list_causal",
        }
        offenders = {f.rule for f in result.blocking} & ban_rules
        assert offenders == set(), f"ban-list violations: {result.blocking}"
