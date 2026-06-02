"""Pass-19H: lip_makeup adhesion_base_interaction wording +
manifest/analysis_report profile consistency.

Two leftover bugs from the pass-19G republish run:

  1. The lip_makeup quote-summary table didn't carry an entry for
     `adhesion_base_interaction`. Hince + muzigae fell through to
     the lip_makeup last-resort label ("밀착감 관련 만족 의견") which
     the inspector flags as filler.
  2. inspect_run_quality's Product section read the manifest's
     `selected_profile_id` but the manifest still showed `default`
     because `_hydrate_manifest_product_block` preserved
     non-empty values. The adapter wrote `lip_makeup` to the
     analysis_report; the manifest didn't get the update; the
     inspector showed `profile=default` while every downstream
     surface had moved on.

Test surface (per user spec §Tests):
  1. lip_makeup + adhesion_base_interaction + positive → spec wording
  2. lip_makeup + adhesion_base_interaction + negative → spec wording
  3. old phrase "밀착감 관련 만족 의견" still flagged generic/filler
  4. hince fixture → 0 generic display_quote_summary
  5. muzigae fixture → 0 generic display_quote_summary
  6. republish on hince fixture flips inspect-visible profile
     default → lip_makeup
  7. manifest.product.selected_profile_id and
     analysis_report.product.selected_profile_id are consistent
     after republish
"""
from __future__ import annotations

import importlib.util
import io
import json
import sys
from contextlib import redirect_stdout
from pathlib import Path

import pytest

from src.voc.content.profiles import PROFILE_LIP_MAKEUP
from src.voc.content.quote_summary_normalizer import (
    attribute_specific_summary,
    is_degraded_quote_summary,
    looks_too_generic,
)


REPO_ROOT = Path(__file__).resolve().parents[2]


# ---------- Test 1: adhesion_base_interaction positive --------------------


class TestAdhesionPositive:
    def test_positive_uses_spec_wording(self):
        out = attribute_specific_summary(
            profile_id="lip_makeup",
            attribute_key="adhesion_base_interaction",
            polarity="positive",
        )
        assert out == (
            "입술에 매끈하게 밀착되고 광택이 자연스럽게 유지된다는 의견"
        )
        assert not is_degraded_quote_summary(out)

    def test_positive_includes_lip_anchored_vocabulary(self):
        out = attribute_specific_summary(
            profile_id="lip_makeup",
            attribute_key="adhesion_base_interaction",
            polarity="positive",
        )
        # Spec demands lip-anchored wording (입술 / 광택).
        assert "입술" in out
        assert "광택" in out
        # And NOT the banned generic.
        assert out != "밀착감 관련 만족 의견"


# ---------- Test 2: adhesion_base_interaction negative -------------------


class TestAdhesionNegative:
    def test_negative_uses_spec_wording(self):
        out = attribute_specific_summary(
            profile_id="lip_makeup",
            attribute_key="adhesion_base_interaction",
            polarity="negative",
        )
        assert out == (
            "밀착이 약하거나 시간이 지나며 들뜸·밀림을 아쉬워하는 의견"
        )
        assert not is_degraded_quote_summary(out)

    def test_negative_weak_uses_distinct_wording(self):
        out = attribute_specific_summary(
            profile_id="lip_makeup",
            attribute_key="adhesion_base_interaction",
            polarity="negative_weak",
        )
        assert out == (
            "초반 밀착감은 괜찮지만 시간이 지나며 사용감이 아쉽다는 의견"
        )
        assert not is_degraded_quote_summary(out)
        # Time-context phrasing.
        assert "시간이 지나며" in out


# ---------- Test 3: old phrase remains generic ----------------------------


class TestOldAdhesionPhrasesStillFlagged:
    @pytest.mark.parametrize("text", [
        "밀착감 관련 만족 의견",
        "밀착감 관련 아쉬움 의견",
    ])
    def test_old_phrase_flagged(self, text):
        # The inspector must keep flagging the legacy fallback so it
        # never sneaks back if a future profile-routing regression
        # sends a lip product to default.
        assert is_degraded_quote_summary(text), (
            f"old generic phrase unexpectedly clean: {text!r}"
        )
        # The shorter check too — the user-locked banned list.
        assert looks_too_generic(text)


# ---------- Test 4 + 5: hince and muzigae fixtures, 0 generic ------------


_LIP_ATTRS = (
    "adhesion_base_interaction",
    "pigmentation",
    "application_blending",
    "dryness_skin_texture",
    "persistence",
    "transfer_resistance",
    "finish_texture",
    "scent_taste",
    "packaging_container",
    "value_price",
)


def _all_lip_summaries_clean() -> list[str]:
    """Return every lip_makeup (attr, polarity) summary that's
    degraded — empty list = pass."""
    bad: list[str] = []
    for attr in _LIP_ATTRS:
        for polarity in ("positive", "negative", "negative_weak"):
            out = attribute_specific_summary(
                profile_id="lip_makeup",
                attribute_key=attr,
                polarity=polarity,
            )
            if out is None:
                bad.append(f"({attr}, {polarity}) → None")
                continue
            if is_degraded_quote_summary(out):
                bad.append(f"({attr}, {polarity}) → {out!r}")
    return bad


class TestHinceFixtureZeroGeneric:
    """Pass-19F covered 9 attributes; pass-19H closed
    adhesion_base_interaction. The full lip_makeup table now must
    yield ZERO degraded summaries across every (attr, polarity)
    triple — that's the operator-visible guarantee for hince.
    """

    def test_no_degraded_summary_anywhere_in_lip_table(self):
        bad = _all_lip_summaries_clean()
        assert not bad, f"degraded lip_makeup summaries: {bad}"

    def test_adhesion_present_in_lip_table(self):
        # Direct sanity: the attribute key the user reported as missing
        # (pass-19G) is now resolved without falling to last-resort.
        for polarity in ("positive", "negative", "negative_weak"):
            out = attribute_specific_summary(
                profile_id="lip_makeup",
                attribute_key="adhesion_base_interaction",
                polarity=polarity,
            )
            assert isinstance(out, str) and out.strip()
            assert "관련 만족 의견" not in out
            assert "관련 아쉬움 의견" not in out


class TestMuzigaeFixtureZeroGeneric:
    """Same guarantee, repeated for muzigae's reported failures
    (`adhesion_base_interaction` was the dominant generic source on
    that product per the user's pass-19H report)."""

    def test_no_degraded_summary_anywhere_in_lip_table(self):
        bad = _all_lip_summaries_clean()
        assert not bad, f"degraded lip_makeup summaries: {bad}"


# ---------- Test 6 + 7: republish flips inspect-visible profile ----------


def _build_minimal_analysis_report(
    *,
    saved_profile_id: str,
    category: str,
    product_name: str,
) -> dict:
    """Synthetic AR mirroring the hince shape — degraded
    `display_quote_summary` cells across the 4 attributes the user
    reported, including adhesion_base_interaction."""
    quotes_for = lambda key, summary, polarity="positive": [{
        "text": "발색이 정말 선명하게 올라와서 좋아요",
        "review_id": f"R_{key}",
        "polarity": polarity,
        "rating": 5,
        "char_start": 0,
        "char_end": 22,
        "display_text": "발색이 정말 선명하게 올라와서 좋아요",
        "display_quote_summary": summary,
    }]
    return {
        "product": {
            "slug": "hince_raw_glow_gel_tint",
            "name_ko": product_name,
            "category": category,
            "selected_profile_id": saved_profile_id,
            "suppressed_attributes": [],
            "source_url": (
                "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do"
                "?goodsNo=A000000202912"
            ),
        },
        "corpus": {
            "n_reviews_total": 817,
            "n_reviews_analyzed": 817,
            "primary_sort": "DATETIME_DESC",
            "sampling_strategy": "observable_multi_sort_corpus",
            "corpus_type": "observed_scrape",
        },
        "attributes": [
            {
                "key": "adhesion_base_interaction",
                "n_positive": 9, "n_negative": 2, "n_mixed": 0,
                "top_quotes": quotes_for(
                    "adhesion_base_interaction",
                    "밀착감 관련 만족 의견",  # the pass-19H banned phrase
                ),
            },
            {
                "key": "pigmentation",
                "n_positive": 12, "n_negative": 3, "n_mixed": 0,
                "top_quotes": quotes_for("pigmentation", "발색 관련 만족 의견"),
            },
            {
                "key": "application_blending",
                "n_positive": 8, "n_negative": 2, "n_mixed": 0,
                "top_quotes": quotes_for(
                    "application_blending", "발림성 관련 만족 의견",
                ),
            },
        ],
        "tradeoffs": [],
        "strengths": [],
        "monitoring_candidates": [],
    }


def _build_minimal_collection_summary() -> dict:
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


def _load_inspect_module():
    spec = importlib.util.spec_from_file_location(
        "_inspect_19h", str(REPO_ROOT / "scripts" / "inspect_run_quality.py"),
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _load_republish_module():
    spec = importlib.util.spec_from_file_location(
        "_republish_19h", str(REPO_ROOT / "scripts" / "republish_run.py"),
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def hince_run_dir(tmp_path: Path) -> Path:
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
    cs = _build_minimal_collection_summary()
    (run_dir / "shared" / "collection_summary.json").write_text(
        json.dumps(cs, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    # Manifest with stale `default` profile — the user-reported state.
    manifest = {
        "schema_version": "1.3",
        "run_dir": run_dir.name,
        "product": {
            "slug": "hince_raw_glow_gel_tint",
            "name_ko": "힌스 로 글로우 젤 틴트 24 Colors 한정 기획",
            "category": "메이크업 > 립메이크업 > 립틴트",
            "selected_profile_id": "default",   # stale
            "suppressed_attributes": [],
        },
        "artifacts": {},
        "collection": {},
    }
    (run_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return run_dir


class TestInspectPrefersAnalysisReport:
    """Pass-19H: even without a re-run of republish, the inspector
    must show the FRESH profile from analysis_report rather than the
    stale value from manifest. Operators can spot drift via the
    explicit warning."""

    def test_inspect_shows_analysis_report_profile_over_stale_manifest(self):
        inspect = _load_inspect_module()

        manifest = {"product": {
            "selected_profile_id": "default",
            "name_ko": "힌스",
            "category": "메이크업 > 립메이크업 > 립틴트",
        }}
        analysis_report = {"product": {
            "selected_profile_id": "lip_makeup",
            "name_ko": "힌스",
            "category": "메이크업 > 립메이크업 > 립틴트",
        }}
        warnings: list[str] = []
        buf = io.StringIO()
        with redirect_stdout(buf):
            inspect.inspect_product_block(
                manifest, None, warnings, analysis_report,
            )
        out = buf.getvalue()
        assert "profile" in out and "lip_makeup" in out
        # And the drift warning fires.
        joined = " ".join(warnings)
        assert "differs from analysis_report" in joined
        assert "default" in joined and "lip_makeup" in joined

    def test_inspect_no_drift_warning_when_consistent(self):
        inspect = _load_inspect_module()
        manifest = {"product": {"selected_profile_id": "lip_makeup"}}
        analysis_report = {"product": {"selected_profile_id": "lip_makeup"}}
        warnings: list[str] = []
        with redirect_stdout(io.StringIO()):
            inspect.inspect_product_block(
                manifest, None, warnings, analysis_report,
            )
        joined = " ".join(warnings)
        assert "differs from" not in joined

    def test_inspect_falls_back_to_manifest_when_ar_missing(self):
        inspect = _load_inspect_module()
        manifest = {"product": {"selected_profile_id": "skincare_pad"}}
        warnings: list[str] = []
        buf = io.StringIO()
        with redirect_stdout(buf):
            inspect.inspect_product_block(manifest, None, warnings, None)
        assert "skincare_pad" in buf.getvalue()


class TestRepublishOverwritesManifestProfile:
    """Pass-19H: republish must overwrite the manifest's stale
    profile + suppressed_attributes — preserve-non-empty was the
    bug that left manifest=default while analysis_report=lip_makeup."""

    def test_hydrate_overwrites_authoritative_keys(self, hince_run_dir):
        republish = _load_republish_module()

        manifest = {"product": {
            "name_ko": "OPERATOR_PINNED_NAME",  # operator pinning
            "selected_profile_id": "default",   # stale — must overwrite
            "suppressed_attributes": [],         # stale — must overwrite
        }}
        analysis_report = {"product": {
            "name_ko": "fresh_name",  # MUST NOT overwrite operator pin
            "selected_profile_id": "lip_makeup",
            "suppressed_attributes": ["multi_use_lip_cheek_compatibility"],
            "category": "메이크업 > 립메이크업",
        }}
        republish._hydrate_manifest_product_block(manifest, analysis_report)

        # Authoritative keys overwritten.
        assert manifest["product"]["selected_profile_id"] == "lip_makeup"
        assert manifest["product"]["suppressed_attributes"] == [
            "multi_use_lip_cheek_compatibility"
        ]
        # Operator-pinned name preserved.
        assert manifest["product"]["name_ko"] == "OPERATOR_PINNED_NAME"
        # Empty slot filled normally.
        assert manifest["product"]["category"] == "메이크업 > 립메이크업"

    def test_full_republish_path_writes_lip_makeup_to_both_files(
        self, hince_run_dir,
    ):
        # Run _re_emit_analysis_report + _patch_manifest end-to-end and
        # assert manifest + analysis_report agree on lip_makeup.
        republish = _load_republish_module()

        ar_in = json.loads(
            (hince_run_dir / "shared" / "analysis_report.json")
            .read_text(encoding="utf-8")
        )
        cs_in = json.loads(
            (hince_run_dir / "shared" / "collection_summary.json")
            .read_text(encoding="utf-8")
        )

        # Re-emit AR — this fixes the AR side.
        new_ar_path, rebuilt = republish._re_emit_analysis_report(
            hince_run_dir, ar_in, cs_in,
        )
        assert rebuilt["product"]["selected_profile_id"] == PROFILE_LIP_MAKEUP

        # Patch manifest — this should now also flip the manifest.
        # We pass dummy paths for cardnews / pdf since this fixture
        # doesn't actually have those files; the patcher tolerates
        # missing artifacts.
        republish._patch_manifest(
            hince_run_dir,
            cardnews_path=hince_run_dir / "buyer_content" / "ko" / "buyer_journey_cardnews.json",
            pdf_path=hince_run_dir / "seller_report" / "seller_report_ko.pdf",
            analysis_report_path=new_ar_path,
            collection_summary=cs_in,
            analysis_report=rebuilt,
        )
        manifest_after = json.loads(
            (hince_run_dir / "manifest.json").read_text(encoding="utf-8")
        )
        assert manifest_after["product"]["selected_profile_id"] == PROFILE_LIP_MAKEUP
        assert "multi_use_lip_cheek_compatibility" in (
            manifest_after["product"].get("suppressed_attributes") or []
        )

        # Final: AR ↔ manifest profile consistency.
        assert (
            manifest_after["product"]["selected_profile_id"]
            == rebuilt["product"]["selected_profile_id"]
        )

    def test_inspect_after_republish_shows_lip_makeup_no_drift(
        self, hince_run_dir,
    ):
        # User-visible end-to-end: republish, then run inspect's
        # Product section. Profile is lip_makeup AND no drift warning.
        republish = _load_republish_module()
        inspect = _load_inspect_module()

        ar_in = json.loads(
            (hince_run_dir / "shared" / "analysis_report.json")
            .read_text(encoding="utf-8")
        )
        cs_in = json.loads(
            (hince_run_dir / "shared" / "collection_summary.json")
            .read_text(encoding="utf-8")
        )
        new_ar_path, rebuilt = republish._re_emit_analysis_report(
            hince_run_dir, ar_in, cs_in,
        )
        republish._patch_manifest(
            hince_run_dir,
            cardnews_path=hince_run_dir / "buyer_content" / "ko" / "buyer_journey_cardnews.json",
            pdf_path=hince_run_dir / "seller_report" / "seller_report_ko.pdf",
            analysis_report_path=new_ar_path,
            collection_summary=cs_in,
            analysis_report=rebuilt,
        )

        manifest = json.loads(
            (hince_run_dir / "manifest.json").read_text(encoding="utf-8")
        )
        warnings: list[str] = []
        buf = io.StringIO()
        with redirect_stdout(buf):
            inspect.inspect_product_block(manifest, cs_in, warnings, rebuilt)
        out = buf.getvalue()
        assert "lip_makeup" in out
        assert "default" not in out.split("profile")[1].split("\n", 1)[0]
        # No drift warning post-republish.
        joined = " ".join(warnings)
        assert "differs from analysis_report" not in joined
