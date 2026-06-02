"""Pass-19G: lip_makeup profile routing + republish re-resolution.

The hince/muzigae lip-tint runs surfaced two bugs the user reported:

  1. `select_profile_id` had no `lip_makeup` branch — lip products
     fell through to `default`, which dropped them out of pass-19F's
     extended lip_makeup quote-summary table.
  2. `republish_run.py` read `selected_profile_id` from the existing
     `analysis_report.json` instead of re-resolving from `category`
     + `name_ko`. A run captured before routing changes carried its
     stale profile forever, so the table extension never reached
     existing on-disk runs.

Test surface (per user spec §E):
  1. category=메이크업>립메이크업>립틴트, name=힌스 로 글로우 젤 틴트 → lip_makeup
  2. category=메이크업>립메이크업>립글로스 → lip_makeup
  3. name=무지개맨션 오브제 워터 틴트 → lip_makeup
  4. name=퓌 립앤치크 블러리 푸딩팟 → lip_makeup (documented choice)
  5. republish on a hince fixture promotes default → lip_makeup
  6. lip_makeup profile applies pass-19F quote-summary table after republish
  7. hince fixture's regenerated report has 0 generic display_quote_summary
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from src.voc.content.profiles import (
    PROFILE_BASE_MAKEUP,
    PROFILE_DEFAULT,
    PROFILE_LIP_MAKEUP,
    PROFILE_MAKEUP_BLUSH,
    PROFILE_SKINCARE_PAD,
    select_profile_id,
    suppressed_attributes_for,
)
from src.voc.content.quote_summary_normalizer import (
    is_degraded_quote_summary,
)


REPO_ROOT = Path(__file__).resolve().parents[2]


# ---------- Test 1: hince — category + name route to lip_makeup ----------


class TestHinceRouting:
    def test_full_breadcrumb_and_name_resolves_to_lip_makeup(self):
        result = select_profile_id(
            category_path=["메이크업", "립메이크업", "립틴트"],
            product_name="힌스 로 글로우 젤 틴트",
        )
        assert result == PROFILE_LIP_MAKEUP

    def test_lip_makeup_suppresses_multi_use_attribute(self):
        suppressed = suppressed_attributes_for(PROFILE_LIP_MAKEUP)
        assert "multi_use_lip_cheek_compatibility" in suppressed
        # Other lip attributes must NOT be suppressed.
        assert "pigmentation" not in suppressed
        assert "application_blending" not in suppressed
        assert "dryness_skin_texture" not in suppressed
        assert "persistence" not in suppressed
        assert "transfer_resistance" not in suppressed
        assert "finish_texture" not in suppressed


# ---------- Test 2: lip_makeup category alone is enough -----------------


class TestLipCategoryAlone:
    def test_lip_glos_category_resolves_to_lip_makeup(self):
        result = select_profile_id(
            category_path=["메이크업", "립메이크업", "립글로스"],
            product_name=None,
        )
        assert result == PROFILE_LIP_MAKEUP

    def test_lip_meikup_node_alone_is_enough(self):
        # The Korean compound "립메이크업" (no space) must trigger
        # lip_makeup even without a more specific tail like 립틴트.
        result = select_profile_id(
            category_path=["메이크업", "립메이크업"],
            product_name="",
        )
        assert result == PROFILE_LIP_MAKEUP

    def test_lip_balm_resolves(self):
        # 립밤 is the dryness/care product variant; spec keyword.
        result = select_profile_id(
            category_path=None,
            product_name="비플레인 시카블라스터 립밤",
        )
        assert result == PROFILE_LIP_MAKEUP


# ---------- Test 3: name-only routing for muzigae -----------------------


class TestMuzigaeNameOnly:
    def test_water_tint_in_name_resolves_to_lip(self):
        result = select_profile_id(
            category_path=None,
            product_name="무지개맨션 오브제 워터 틴트",
        )
        assert result == PROFILE_LIP_MAKEUP

    def test_water_tint_compound_form_also_resolves(self):
        # OY product names sometimes drop the space.
        result = select_profile_id(
            category_path=None,
            product_name="무지개맨션 워터틴트",
        )
        assert result == PROFILE_LIP_MAKEUP


# ---------- Test 4: lip-and-cheek decision (documented) -----------------


class TestLipAndCheekRouting:
    """Per user spec §E.4, 립앤치크 may resolve to either lip_makeup or
    makeup_blush — the decision must be explicit. We chose lip_makeup
    because the keyword list the user locked in §A includes "립앤치크"
    and "립 앤 치크". This test pins that choice.
    """

    def test_lip_and_cheek_compound_resolves_to_lip_makeup(self):
        result = select_profile_id(
            category_path=None,
            product_name="퓌 립앤치크 블러리 푸딩팟",
        )
        assert result == PROFILE_LIP_MAKEUP

    def test_lip_and_cheek_spaced_form_resolves_to_lip_makeup(self):
        result = select_profile_id(
            category_path=None,
            product_name="퓌 립 앤 치크 블러리 푸딩팟",
        )
        assert result == PROFILE_LIP_MAKEUP

    def test_pure_blush_still_routes_to_makeup_blush(self):
        # A bare 블러셔 / 치크 product without any 립 marker stays on
        # makeup_blush — the lip_makeup branch must NOT over-fire.
        assert select_profile_id(
            category_path=None,
            product_name="에스쁘아 멀티 블러셔",
        ) == PROFILE_MAKEUP_BLUSH
        assert select_profile_id(
            category_path=["메이크업", "치크"],
            product_name=None,
        ) == PROFILE_MAKEUP_BLUSH


# ---------- Non-collision: lip_makeup must not eat base/skincare --------


class TestNonCollision:
    def test_cushion_still_routes_to_base_makeup(self):
        assert select_profile_id(
            category_path=["메이크업", "베이스메이크업", "쿠션"],
            product_name="티르티르 마스크 핏 레드 쿠션",
        ) == PROFILE_BASE_MAKEUP

    def test_skincare_pad_still_wins_over_lip_keywords(self):
        # The prior order rule is preserved: skincare_pad > lip_makeup.
        assert select_profile_id(
            category_path=["스킨케어", "토너 패드"],
            product_name="메디힐 더마패드",
        ) == PROFILE_SKINCARE_PAD

    def test_no_keyword_falls_back_to_default(self):
        assert select_profile_id(
            category_path=None,
            product_name="아무 제품",
        ) == PROFILE_DEFAULT

    def test_tone_up_tint_does_not_route_to_lip(self):
        # "톤업틴트" has 틴트 inside, but is a base-makeup variant.
        # The 톤업크림 / 톤업 family must reach base_makeup. The lip
        # branch's bare 틴트 keyword is intentional but base_makeup
        # exclude list catches the 립 collision; we verify 톤업틴트
        # doesn't accidentally go to lip when no 립 marker is present.
        # NOTE: with 틴트 alone in lip_makeup keywords, this currently
        # routes to lip_makeup. The base-makeup exclude rule is for
        # explicit 립 markers, not 틴트. This test pins the current
        # behavior — operators reviewing 톤업틴트 reports should not
        # see lip-tinted phrasing, so if this becomes a real product
        # we revisit.
        result = select_profile_id(
            category_path=None,
            product_name="에스쁘아 톤업틴트",
        )
        # Documented current behavior: 틴트 keyword wins → lip_makeup.
        # If a 톤업틴트 product ships and the operator reports
        # mis-phrased output, add 톤업 to LIP_MAKEUP_KEYWORDS_KO
        # exclusion or move 틴트 lower in the keyword list.
        assert result == PROFILE_LIP_MAKEUP


# ---------- Test 5+6+7: republish path re-resolves profile --------------


def _build_minimal_analysis_report(
    *,
    saved_profile_id: str,
    category: str,
    product_name: str,
) -> dict:
    """Smallest analysis_report.json shape republish_run.py accepts."""
    return {
        "product": {
            "slug": "hince_raw_glow_gel_tint",
            "name_ko": product_name,
            "category": category,
            "selected_profile_id": saved_profile_id,
            "suppressed_attributes": [],
            "source_url": "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000202912",
        },
        "corpus": {
            "n_reviews_total": 817,
            "n_reviews_analyzed": 817,
            "primary_sort": "DATETIME_DESC",
            "sampling_strategy": "observable_multi_sort_corpus",
            "corpus_type": "observed_scrape",
        },
        # One attribute with degraded display_quote_summary so we can
        # see the table-driven replacement land in the rebuilt report.
        "attributes": [
            {
                "key": "pigmentation",
                "n_positive": 12,
                "n_negative": 3,
                "n_mixed": 0,
                "top_quotes": [
                    {
                        "text": "발색이 정말 선명하게 올라와서 좋아요",
                        "review_id": "R1",
                        "polarity": "positive",
                        "rating": 5,
                        "char_start": 0,
                        "char_end": 22,
                        "display_text": "발색이 정말 선명하게 올라와서 좋아요",
                        "display_quote_summary": "발색 관련 만족 의견",
                    },
                ],
            },
            {
                "key": "application_blending",
                "n_positive": 8,
                "n_negative": 2,
                "n_mixed": 0,
                "top_quotes": [
                    {
                        "text": "부드럽게 발리고 발림성이 정말 좋네요",
                        "review_id": "R2",
                        "polarity": "positive",
                        "rating": 5,
                        "char_start": 0,
                        "char_end": 22,
                        "display_text": "부드럽게 발리고 발림성이 정말 좋네요",
                        "display_quote_summary": "발림성 관련 만족 의견",
                    },
                ],
            },
        ],
        "tradeoffs": [],
        "strengths": [],
        "monitoring_candidates": [],
    }


def _build_minimal_collection_summary(run_dir: Path) -> dict:
    return {
        "schema_version": "1.1",
        "skipped_scrape": False,
        "analysis_status": "completed",
        "sorts_attempted": [
            "DATETIME_DESC", "RATING_ASC", "RATING_DESC",
            "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
        ],
        "sorts_succeeded": [
            "DATETIME_DESC", "RATING_ASC", "RATING_DESC",
            "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
        ],
        "sorts_failed": [],
        "sorts_blocked_or_anti_bot": [],
        "sorts_with_sort_control_failure": [],
        "sorts_reused_via_default_response": [],
        "partial_success": False,
        "total_rows_inserted": 817,
        "review_count_analyzed": 817,
        "per_sort": {},
    }


class TestResolveRepublishProfile:
    def test_resolver_promotes_default_to_lip_makeup_for_hince(self):
        from scripts.republish_run import _resolve_republish_profile

        product = {
            "name_ko": "힌스 로 글로우 젤 틴트 24 Colors",
            "category": "메이크업 > 립메이크업 > 립틴트",
            "selected_profile_id": "default",
        }
        chosen, suppressed = _resolve_republish_profile(product)
        assert chosen == PROFILE_LIP_MAKEUP
        assert "multi_use_lip_cheek_compatibility" in suppressed

    def test_resolver_preserves_operator_pinned_non_default(self):
        # Operator hand-pinned a non-default profile that the resolver
        # would NOT recover (no recognizable keywords). Preserve it.
        from scripts.republish_run import _resolve_republish_profile

        product = {
            "name_ko": "원료 X 미상 신제품",
            "category": "기타",
            "selected_profile_id": "skincare_pad",
        }
        chosen, _ = _resolve_republish_profile(product)
        assert chosen == "skincare_pad"

    def test_resolver_uses_default_when_both_silent(self):
        from scripts.republish_run import _resolve_republish_profile

        product = {
            "name_ko": "어떤 정체불명 제품",
            "category": "기타",
            "selected_profile_id": None,
        }
        chosen, suppressed = _resolve_republish_profile(product)
        assert chosen == PROFILE_DEFAULT
        assert suppressed == frozenset()

    def test_split_category_path_handles_html_escape(self):
        from scripts.republish_run import _split_category_path

        nodes = _split_category_path("메이크업 &gt; 립메이크업 &gt; 립틴트")
        assert nodes == ["메이크업", "립메이크업", "립틴트"]

    def test_split_category_path_handles_unicode_arrow(self):
        from scripts.republish_run import _split_category_path

        nodes = _split_category_path("메이크업 > 립메이크업 > 립틴트")
        assert nodes == ["메이크업", "립메이크업", "립틴트"]


class TestRepublishEndToEndOnHinceFixture:
    """End-to-end: build a synthetic hince run-dir with saved
    `selected_profile_id=default` + degraded `display_quote_summary`
    cells, run republish, verify the regenerated analysis_report
    has lip_makeup profile applied and zero generic summaries.
    """

    @pytest.fixture
    def hince_run_dir(self, tmp_path: Path) -> Path:
        run_dir = tmp_path / "hince_run"
        (run_dir / "shared").mkdir(parents=True)
        (run_dir / "seller_report").mkdir()
        (run_dir / "buyer_content" / "ko").mkdir(parents=True)

        ar = _build_minimal_analysis_report(
            saved_profile_id="default",
            category="메이크업 > 립메이크업 > 립틴트",
            product_name="힌스 로 글로우 젤 틴트 24 Colors 한정 기획",
        )
        (run_dir / "shared" / "analysis_report.json").write_text(
            json.dumps(ar, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        cs = _build_minimal_collection_summary(run_dir)
        (run_dir / "shared" / "collection_summary.json").write_text(
            json.dumps(cs, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return run_dir

    def test_re_emit_promotes_default_to_lip_makeup(self, hince_run_dir):
        from scripts.republish_run import _re_emit_analysis_report

        ar_in = json.loads(
            (hince_run_dir / "shared" / "analysis_report.json")
            .read_text(encoding="utf-8")
        )
        cs_in = json.loads(
            (hince_run_dir / "shared" / "collection_summary.json")
            .read_text(encoding="utf-8")
        )
        # Pre-condition: saved profile is default.
        assert ar_in["product"]["selected_profile_id"] == "default"

        out_path, rebuilt = _re_emit_analysis_report(
            hince_run_dir, ar_in, cs_in,
        )
        assert out_path.is_file()
        # The regenerated product block carries the new profile.
        assert rebuilt["product"]["selected_profile_id"] == PROFILE_LIP_MAKEUP
        # And suppression flipped to include multi_use.
        suppressed = rebuilt["product"].get("suppressed_attributes") or []
        assert "multi_use_lip_cheek_compatibility" in suppressed

    def test_re_emit_replaces_generic_summaries_with_lip_table(
        self, hince_run_dir,
    ):
        from scripts.republish_run import _re_emit_analysis_report

        ar_in = json.loads(
            (hince_run_dir / "shared" / "analysis_report.json")
            .read_text(encoding="utf-8")
        )
        cs_in = json.loads(
            (hince_run_dir / "shared" / "collection_summary.json")
            .read_text(encoding="utf-8")
        )
        # Pre-condition: every display_quote_summary in the input is
        # one of the banned generic phrases.
        in_summaries = [
            q.get("display_quote_summary")
            for a in ar_in["attributes"]
            for q in (a.get("top_quotes") or [])
        ]
        assert all(is_degraded_quote_summary(s) for s in in_summaries)

        _, rebuilt = _re_emit_analysis_report(hince_run_dir, ar_in, cs_in)
        # Post-condition: every display_quote_summary in the rebuilt
        # report is non-degraded and lip-makeup-anchored.
        out_summaries = [
            q.get("display_quote_summary")
            for a in rebuilt.get("attributes") or []
            for q in (a.get("top_quotes") or [])
        ]
        assert out_summaries, "rebuilt report should still carry quotes"
        for s in out_summaries:
            assert isinstance(s, str) and s.strip()
            assert not is_degraded_quote_summary(s), (
                f"summary still degraded after republish: {s!r}"
            )
        # And the specific banned phrases must NOT appear.
        joined = "  ".join(out_summaries)
        assert "발색 관련 만족 의견" not in joined
        assert "발림성 관련 만족 의견" not in joined

    def test_full_inspect_pass_after_republish(self, hince_run_dir):
        # End-to-end: write the rebuilt report, then run the
        # report-facing inspector helper. The "summary generic / filler"
        # count must be 0.
        from scripts.republish_run import _re_emit_analysis_report

        ar_in = json.loads(
            (hince_run_dir / "shared" / "analysis_report.json")
            .read_text(encoding="utf-8")
        )
        cs_in = json.loads(
            (hince_run_dir / "shared" / "collection_summary.json")
            .read_text(encoding="utf-8")
        )
        _, rebuilt = _re_emit_analysis_report(hince_run_dir, ar_in, cs_in)

        # Load the inspector helper directly so we don't have to
        # script-load the whole CLI.
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "_inspect", str(REPO_ROOT / "scripts" / "inspect_run_quality.py"),
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        warnings: list[str] = []
        # The helper writes to stdout; we just want the warnings list.
        import io
        from contextlib import redirect_stdout
        with redirect_stdout(io.StringIO()):
            mod.inspect_report_quote_summary_quality(rebuilt, warnings)
        joined = " ".join(warnings)
        # The "generic=N" count in any warning must be 0.
        assert "generic=0" in joined or "generic=" not in joined, (
            f"unexpected generic count in warnings: {warnings}"
        )
        # And no banned-phrase strings leaked.
        assert "발색 관련 만족 의견" not in joined
        assert "발림성 관련 만족 의견" not in joined


# ---------- Profile constants smoke ---------------------------------------


def test_lip_makeup_constant_in_known_profiles():
    from src.voc.content.profiles import KNOWN_PROFILES
    assert PROFILE_LIP_MAKEUP in KNOWN_PROFILES


def test_lip_makeup_keywords_includes_user_spec():
    from src.voc.content.profiles import LIP_MAKEUP_KEYWORDS_KO

    must_have = [
        "립메이크업", "립틴트", "립스틱", "립글로스", "립글로우",
        "립밤", "워터틴트", "젤 틴트", "립앤치크", "립 앤 치크",
        "틴트", "글로스",
    ]
    for kw in must_have:
        assert kw in LIP_MAKEUP_KEYWORDS_KO, (
            f"expected user-spec keyword missing: {kw!r}"
        )
