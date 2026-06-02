"""Run-003 QA pass-5 acceptance tests.

Targets the four pass-5 contracts:
  1. Sort failure robustness — auth-wall classifier + deferred-retry
     queue + recovery_actions log.
  2. Polarity guardrail — `생각보다 + positive` no longer suspect;
     `생각보다 + 덜/별로/부족` still flagged.
  3. Quote surface policy — display_quote_summary single-suffix lock.
  4. Attribute-fit warning enforcement at PDF + cardnews
     representative slots.

Plus the legacy-cardnews / particle / wording polish locks.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]


# ---------------------------------------------------------------------------
# 1. Sort failure robustness
# ---------------------------------------------------------------------------


class TestAuthWallClassifier:
    def test_anonymous_auth_wall_status_recognised(self):
        sys.path.insert(0, str(REPO / "scripts"))
        spec = importlib.util.spec_from_file_location(
            "_pipeline_for_pass5",
            REPO / "scripts" / "run_phase2e_pipeline.py",
        )
        mod = importlib.util.module_from_spec(spec)
        sys.modules["_pipeline_for_pass5"] = mod
        # Loading the full pipeline pulls heavy deps. Rather than
        # exec_module (which the dataclass quirk in py3.14 trips on),
        # parse for the helper signature only via importlib.machinery.
        spec.loader.exec_module(mod)
        assert mod._is_auth_wall_failure(
            {"status": "anonymous_auth_wall"}
        ) is True
        assert mod._is_auth_wall_failure(
            {"status": "scraper_subprocess_failed",
             "error": "anonymous_auth_wall — re-establish login"}
        ) is True
        assert mod._is_auth_wall_failure({"status": "ok"}) is False
        assert mod._is_auth_wall_failure({"status": "anti_bot"}) is False

    def test_deferred_retry_status_set_includes_auth_wall(self):
        sys.path.insert(0, str(REPO / "scripts"))
        spec = importlib.util.spec_from_file_location(
            "_pipeline_for_pass5_b",
            REPO / "scripts" / "run_phase2e_pipeline.py",
        )
        mod = importlib.util.module_from_spec(spec)
        sys.modules["_pipeline_for_pass5_b"] = mod
        spec.loader.exec_module(mod)
        assert "anonymous_auth_wall" in mod._MULTI_SORT_DEFERRED_RETRY_STATUSES


class TestRecoveryActionsLog:
    def test_collection_summary_carries_recovery_actions_field(self):
        from src.voc.app.collection_summary import build_collection_summary
        sidecar = build_collection_summary(
            product_url="x", goods_no="g1", product_name="p",
            corpus_mode="observable_multi_sort",
            primary_sort="DATETIME_DESC",
            per_sort_summaries=[{
                "sort_type": "RATING_ASC",
                "status": "ok",
                "rows_inserted": 50,
                "raw_records_seen": 50,
                "attempts": 2,
                "recovery_actions": [
                    "wait_after_auth_wall",
                    "retry_after_other_sorts",
                ],
            }],
        )
        per_sort = sidecar["per_sort"]["RATING_ASC"]
        assert per_sort["recovery_actions"] == [
            "wait_after_auth_wall",
            "retry_after_other_sorts",
        ]


# ---------------------------------------------------------------------------
# 2. Polarity guardrail
# ---------------------------------------------------------------------------


class TestGuardrailExpectationPositive:
    def test_saenggakboda_satisfied_not_suspect(self):
        from src.voc.reporting.phase2e.polarity_guardrail import (
            check_polarity,
        )
        r = check_polarity("생각보다 만족스러웠어요", "positive")
        assert r.is_suspect is False, (
            f"'생각보다 만족' false-positive returned. reasons={r.reasons}"
        )

    def test_saenggakboda_with_negative_co_cue_is_suspect_or_low(self):
        from src.voc.reporting.phase2e.polarity_guardrail import (
            check_polarity,
        )
        r = check_polarity("생각보다 덜 촉촉했어요", "positive")
        # Acceptance: either flagged suspect OR confidence low.
        assert r.is_suspect or r.confidence == "low"

    def test_saenggakboda_byeollo_is_suspect_under_positive_claim(self):
        from src.voc.reporting.phase2e.polarity_guardrail import (
            check_polarity,
        )
        r = check_polarity("생각보다 별로였어요", "positive")
        assert r.is_suspect is True

    def test_dul_chokchok_aswiwoom_not_suspect_under_negative(self):
        from src.voc.reporting.phase2e.polarity_guardrail import (
            check_polarity,
        )
        r = check_polarity(
            "덜 촉촉하다고 해야하나 그건 좀 아쉬웠음", "negative_weak",
        )
        assert r.is_suspect is False

    def test_kidaeboda_satisfied_not_suspect(self):
        from src.voc.reporting.phase2e.polarity_guardrail import (
            check_polarity,
        )
        r = check_polarity("기대보다 촉촉했어요", "positive")
        assert r.is_suspect is False

    def test_kidaeboda_with_negative_co_cue_flagged(self):
        from src.voc.reporting.phase2e.polarity_guardrail import (
            check_polarity,
        )
        r = check_polarity("기대보다 부족했어요", "positive")
        assert r.is_suspect is True


# ---------------------------------------------------------------------------
# 3. Quote surface policy — display_quote_summary single-suffix lock
# ---------------------------------------------------------------------------


class TestQuoteSurfacePolicy:
    @pytest.mark.parametrize("raw, polarity", [
        ("밀착력은 아쉽고", "negative_weak"),
        ("밀착이 아쉽다는", "negative_weak"),
        ("아쉬움이 있다는", "negative_weak"),
        ("향이 별로", "negative_weak"),
        ("비추입", "negative_weak"),
    ])
    def test_pdf_summary_no_dup_aswiwoom(self, raw, polarity):
        from src.voc.reporting.phase2e.quote_display import (
            synthesize_quote_summary_for_report,
        )
        out = synthesize_quote_summary_for_report(raw, polarity=polarity)
        assert out.count("아쉬움") < 2, (
            f"display_quote_summary contains "
            f"'...아쉬움 의견...아쉬움' duplication: {out!r}"
        )

    @pytest.mark.parametrize("raw, polarity", [
        ("밀착력은 아쉽고", "negative_weak"),
        ("아쉬움이 있다는", "negative_weak"),
        ("향이 별로", "negative_weak"),
        ("비추입", "negative_weak"),
    ])
    def test_cardnews_synth_no_dup_aswiwoom(self, raw, polarity):
        """The cardnews synthesizer (display_text) was previously
        emitting "...아쉬움 의견...아쉬움 의견" duplications. Pass-5
        suppresses the polarity suffix when the anchor phrase already
        carries polarity."""
        from src.voc.reporting.phase2e.quote_display import (
            synthesize_phrase_display,
        )
        out = synthesize_phrase_display(raw, polarity=polarity)
        assert out.count("아쉬움") < 2, (
            f"display_text contains duplication: {out!r}"
        )

    @pytest.mark.parametrize("raw, polarity", [
        ("향이 좋아요", "positive"),
        ("향이 좋다는 의견", "positive"),
    ])
    def test_pdf_summary_no_dup_manjok(self, raw, polarity):
        from src.voc.reporting.phase2e.quote_display import (
            synthesize_quote_summary_for_report,
        )
        out = synthesize_quote_summary_for_report(raw, polarity=polarity)
        assert out.count("만족") < 2, (
            f"display_quote_summary contains '...만족 의견...만족' "
            f"duplication: {out!r}"
        )


# ---------------------------------------------------------------------------
# 4. Attribute-fit warning enforcement
# ---------------------------------------------------------------------------


class TestAttributeFitEnforcement:
    def test_attribute_fit_warning_quote_excluded_from_strengths(self):
        from collections import Counter
        from src.voc.content.adapters.from_phase2e import (
            productreportdata_to_analysis_report,
        )
        from src.voc.reporting.phase2e.report import (
            AttributeSummary, ProductReportData,
        )

        # dryness_skin_texture with only ONE positive sample, and that
        # sample is off-topic ("모공" cue without dryness anchor).
        s = AttributeSummary(attribute="dryness_skin_texture")
        s.n_positive = 6
        s.n_negative = 0
        s.sample_evidences_pos = [{
            "text": "모공이 정돈되는 느낌",
            "review_id": "r_off",
        }]
        prd = ProductReportData(
            product_id="A", product_name="P",
            n_reviews=200, n_records=200,
            n_mixed_reviews=0, n_with_tradeoff=0,
            tradeoff_pairs=Counter(), mixed_attribute_pairs=[],
            delivery_condition_records_total=0,
            attribute_summaries={"dryness_skin_texture": s},
        )
        out = productreportdata_to_analysis_report(prd)
        # Strength entry should NOT carry the off-topic representative.
        for st in out.get("strengths") or []:
            if st.get("attribute_key") == "dryness_skin_texture":
                rep = st.get("representative_quote") or {}
                # Either no representative was selected (clean fallback)
                # or it's a quote without the off-topic warning.
                assert not rep.get("attribute_fit_warning"), (
                    f"off-topic quote leaked into strengths.representative"
                )

    def test_attribute_fit_warning_excluded_from_buyer_journey(self):
        """Cardnews loved_point evidence_quote must not carry an
        off-topic quote when the strength's representative was the
        only off-topic candidate."""
        from src.voc.content.cardnews_buyer_journey import (
            build_buyer_journey_cardnews,
        )
        # Build an analysis_report fixture where the strength's
        # representative_quote IS flagged as attribute_fit_warning.
        report = {
            "schema_version": "3.0",
            "product": {"slug": "p", "name_ko": "Test"},
            "corpus": {
                "n_reviews_total": 100, "n_reviews_analyzed": 100,
                "primary_sort": "DATETIME_DESC",
                "confidence_level": "high", "signal_stability": "high",
            },
            "attributes": [{
                "key": "dryness_skin_texture",
                "label_ko": "건조감/당김",
                "n_positive": 10, "n_negative": 0, "n_mixed": 0,
                "evidence_score": 2.0,
                "polarity_share": {"positive": 1.0, "negative": 0.0, "mixed": 0.0},
                "tier": None,
                "top_quotes": [
                    {"text": "건조함이 줄어든 느낌이에요",
                     "display_text": "건조함이 줄어든 느낌이에요",
                     "display_quote_summary": "건조함이 줄었다는 의견",
                     "review_id": "r_clean", "polarity": "positive"},
                    {"text": "모공 효과는 못 봤어요",
                     "display_text": "모공 효과는 못 봤어요",
                     "display_quote_summary": "모공 관련 의견",
                     "review_id": "r_off", "polarity": "positive",
                     "attribute_fit_warning": "off_topic_pore_efficacy"},
                ],
            }],
            "strengths": [{
                "attribute_key": "dryness_skin_texture",
                "supporting_count": 10,
                "representative_quote": {
                    "text": "모공 효과는 못 봤어요",
                    "display_text": "모공 효과는 못 봤어요",
                    "display_quote_summary": "모공 관련 의견",
                    "review_id": "r_off", "polarity": "positive",
                    "attribute_fit_warning": "off_topic_pore_efficacy",
                },
            }],
            "monitoring_candidates": [],
            "tradeoffs": [],
            "usage_patterns": [],
            "buyer_segments": [],
            "quick_decision": {
                "verdict_ko": "v", "who_for_ko": [], "who_not_for_ko": [],
                "watch_outs_ko": [], "confidence_level": "strong",
            },
            "methodology_notes": {"disclosure_ko": "x"},
            "polarity_audit": {"n_total_quotes": 0, "n_total_suspect": 0,
                               "n_total_suspect_share": 0.0, "by_attribute": {},
                               "samples": []},
        }
        cn = build_buyer_journey_cardnews(report)
        # Find loved_point slide for dryness_skin_texture
        for s in cn["slides"]:
            if s.get("type") == "loved_point" and s.get("attribute_key") == "dryness_skin_texture":
                ev = s.get("evidence_quote") or {}
                # Must have fallen back to the clean quote, not the off-topic.
                assert ev.get("review_id") == "r_clean", (
                    f"buyer_journey leaked off-topic quote into "
                    f"loved_point evidence: {ev!r}"
                )
                return
        pytest.fail("loved_point slide not produced")


# ---------------------------------------------------------------------------
# 5. Cardnews wording polish — no awkward "X와 관련해 만족 의견"
# ---------------------------------------------------------------------------


def test_cardnews_loved_point_uses_per_attribute_phrase():
    """Run-003 QA pass-5: "건조감/당김과 관련해 만족 의견" was
    semantically odd because the attribute label is itself a complaint
    noun. The rewrite uses per-attribute phrasing
    ("당김이 적었다는 / 건조함이 줄었다는 의견이 많았어요")."""
    from src.voc.content.cardnews_buyer_journey import (
        build_buyer_journey_cardnews,
    )
    report = {
        "schema_version": "3.0",
        "product": {"slug": "p", "name_ko": "Test"},
        "corpus": {
            "n_reviews_total": 100, "n_reviews_analyzed": 100,
            "primary_sort": "DATETIME_DESC",
            "confidence_level": "high", "signal_stability": "high",
        },
        "attributes": [{
            "key": "dryness_skin_texture",
            "label_ko": "건조감/당김",
            "n_positive": 100, "n_negative": 0, "n_mixed": 0,
            "evidence_score": 2.0,
            "polarity_share": {"positive": 1.0, "negative": 0.0, "mixed": 0.0},
            "tier": None,
            "top_quotes": [],
        }],
        "strengths": [{
            "attribute_key": "dryness_skin_texture",
            "supporting_count": 100,
            "representative_quote": {
                "text": "건조함이 줄어든 느낌",
                "display_text": "건조함이 줄어든 느낌",
                "display_quote_summary": "건조함이 줄었다는 의견",
                "review_id": "r1", "polarity": "positive",
            },
        }],
        "monitoring_candidates": [],
        "tradeoffs": [], "usage_patterns": [], "buyer_segments": [],
        "quick_decision": {"verdict_ko": "v", "who_for_ko": [],
                           "who_not_for_ko": [], "watch_outs_ko": [],
                           "confidence_level": "strong"},
        "methodology_notes": {"disclosure_ko": "x"},
        "polarity_audit": {"n_total_quotes": 0, "n_total_suspect": 0,
                           "n_total_suspect_share": 0.0,
                           "by_attribute": {}, "samples": []},
    }
    cn = build_buyer_journey_cardnews(report)
    for s in cn["slides"]:
        if s.get("type") == "loved_point" and s.get("attribute_key") == "dryness_skin_texture":
            body = " ".join(s.get("body_lines") or [])
            # The awkward "와 관련해 만족 의견" pattern must be gone.
            assert "관련해 만족 의견" not in body
            # Per-attribute phrasing landed.
            assert ("당김이 적었다" in body) or ("건조함이 줄었다" in body)
            return
    pytest.fail("loved_point slide not produced")


# ---------------------------------------------------------------------------
# 6. Legacy cardnews / manifest selection
# ---------------------------------------------------------------------------


class TestManifestCardnewsPolicy:
    def test_buyer_journey_wins_over_editorial_when_both_ok(self):
        from src.voc.content.manifest import select_shipping_cardnews
        manifest = {
            "artifacts": {
                "buyer_content": {
                    "ko": {
                        "buyer_journey_cardnews_json": {
                            "status": "ok",
                            "path": "buyer_content/ko/buyer_journey_cardnews.json",
                        },
                        "editorial_cardnews_json": {
                            "status": "ok",
                            "path": "buyer_content/ko/editorial_cardnews.json",
                        },
                        "skeleton_cardnews_json": {
                            "status": "ok",
                            "path": "buyer_content/ko/instagram_cardnews.json",
                        },
                    },
                },
            },
        }
        ship = select_shipping_cardnews(manifest, "ko")
        assert ship == "buyer_content/ko/buyer_journey_cardnews.json"

    def test_falls_back_to_editorial_when_buyer_journey_missing(self):
        from src.voc.content.manifest import select_shipping_cardnews
        manifest = {
            "artifacts": {
                "buyer_content": {
                    "ko": {
                        "editorial_cardnews_json": {
                            "status": "ok",
                            "path": "buyer_content/ko/editorial_cardnews.json",
                        },
                    },
                },
            },
        }
        ship = select_shipping_cardnews(manifest, "ko")
        assert ship == "buyer_content/ko/editorial_cardnews.json"

    def test_presentation_summary_carries_legacy_fallbacks(self):
        from src.voc.content.manifest import cardnews_presentation_summary
        manifest = {
            "artifacts": {
                "buyer_content": {
                    "ko": {
                        "buyer_journey_cardnews_json": {
                            "status": "ok",
                            "path": "buyer_content/ko/buyer_journey_cardnews.json",
                        },
                        "editorial_cardnews_json": {
                            "status": "ok",
                            "path": "buyer_content/ko/editorial_cardnews.json",
                        },
                    },
                },
            },
        }
        s = cardnews_presentation_summary(manifest, "ko")
        assert s["primary_kind"] == "buyer_journey_cardnews_json"
        kinds = [x["kind"] for x in s["legacy_fallbacks_present"]]
        assert "editorial_cardnews_json" in kinds
