"""Tests for the Phase 1 rule-based signal layer.

Golden fixture covers the happy path on the curated 20-row OY snapshot. Unit
tests with small synthetic rows cover deduplication, min_doc_freq gating,
sample-id sorting, the gap rule's False-vs-missing distinction, and graceful
handling of missing lexicon files.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.voc.reporting.phase1.signals import (
    LexiconEntry,
    Lexicons,
    detect_signals,
    load_lexicons,
)


FIXTURE = (
    Path(__file__).parents[2]
    / "fixtures"
    / "phase1_reports"
    / "oy_browser_20rows.json"
)
LEXICON_DIR = Path("data/phase1_lexicons")


@pytest.fixture(scope="module")
def rows() -> list[dict]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def lexicons() -> Lexicons:
    return load_lexicons(
        LEXICON_DIR / "positive.json",
        LEXICON_DIR / "cautionary.json",
    )


# ---------------------------------------------------------------------------
# Golden fixture
# ---------------------------------------------------------------------------


class TestGoldenFixture:
    def test_lexicon_file_versions(self, lexicons: Lexicons) -> None:
        assert lexicons.version == "positive=1.1;cautionary=1.13"
        assert [e.id for e in lexicons.positive] == [
            "moist_finish",
            "no_base_crumbling",
            "gift_item_positive",
            "good_applicability",
        ]
        assert [e.id for e in lexicons.cautionary] == [
            "persistence_reservation",
            "tone_mismatch",
            "pigment_complaint",
            "value_complaint",
            "application_issue",
            "packaging_complaint",
            "shade_mismatch",
            # eyeshadow extensions — same signal_ids (shade_mismatch,
            # tone_mismatch) appear again with category scoping; detector
            # groups them at match time.
            "eyeshadow_fallout",
            "shade_mismatch",
            "tone_mismatch",
        ]

    def test_positive_signals_reproduce_mini_report(self, rows, lexicons) -> None:
        bundle = detect_signals(rows, lexicons)
        seen = {s.name: s for s in bundle.positive}
        # All four seeded entries fire on the fixture.
        assert set(seen) == {
            "moist_finish",
            "no_base_crumbling",
            "gift_item_positive",
            "good_applicability",
        }
        assert seen["moist_finish"].evidence_count == 4
        assert seen["moist_finish"].display_label == "촉촉한 마무리감"
        assert seen["moist_finish"].coverage_ratio == 0.2

        # 1.11: tightened no_base_crumbling patterns (bug fix — old pattern
        # "벗겨지" over-matched active verb forms including cautionary
        # clauses). Count drops from 5→4; the dropped row relied on a
        # substring hit ("벗겨지는 느낌 없이") whose positive semantics
        # came from the "없이" suffix, not the 벗겨지 prefix — semantically
        # positive but matched for the wrong reason.
        assert seen["no_base_crumbling"].evidence_count == 4
        assert seen["no_base_crumbling"].coverage_ratio == 0.2

        assert seen["gift_item_positive"].evidence_count == 6
        assert seen["gift_item_positive"].coverage_ratio == 0.3

        # Exactly at threshold (min_doc_freq=2).
        assert seen["good_applicability"].evidence_count == 2

    def test_positive_output_preserves_lexicon_order(self, rows, lexicons) -> None:
        bundle = detect_signals(rows, lexicons)
        assert [s.name for s in bundle.positive] == [
            "moist_finish",
            "no_base_crumbling",
            "gift_item_positive",
            "good_applicability",
        ]

    def test_cautionary_signals(self, rows, lexicons) -> None:
        bundle = detect_signals(rows, lexicons)
        seen = {s.name: s for s in bundle.cautionary}
        assert set(seen) == {"persistence_reservation", "tone_mismatch"}
        # Both hit exactly min_doc_freq=2.
        assert seen["persistence_reservation"].evidence_count == 2
        assert seen["tone_mismatch"].evidence_count == 2

    def test_gap_rule_repurchase_flag_mismatch(self, rows, lexicons) -> None:
        bundle = detect_signals(rows, lexicons)
        assert len(bundle.gaps) == 1
        g = bundle.gaps[0]
        assert g.name == "api_repurchase_vs_text_mention"
        assert g.category == "gap"
        # Mini report reproduced: 3 OY rows with False flag but text-level
        # repurchase signal. Hit ids: 9b55…, a41c…, c65c….
        assert g.evidence_count == 3
        assert g.coverage_ratio == 0.15
        assert len(g.sample_review_ids) == 3
        assert g.sample_review_ids == sorted(g.sample_review_ids)

    def test_sample_ids_are_sorted_ascending(self, rows, lexicons) -> None:
        """Determinism: sample_review_ids is always the first 3 after sorting."""
        bundle = detect_signals(rows, lexicons)
        for group in (bundle.positive, bundle.cautionary, bundle.gaps):
            for s in group:
                assert len(s.sample_review_ids) <= 3
                assert s.sample_review_ids == sorted(s.sample_review_ids)


# ---------------------------------------------------------------------------
# Unit-level determinism and edge cases
# ---------------------------------------------------------------------------


class TestDetectionUnit:
    def test_multi_pattern_within_entry_dedups(self) -> None:
        """One review matching TWO patterns in the same entry = 1 evidence."""
        lex = Lexicons(
            version="t",
            positive=[LexiconEntry(
                id="x", display_label="X",
                patterns=["촉촉", "부드럽"], min_doc_freq=1,
            )],
        )
        rows = [
            {"review_id": "r1", "text": "촉촉하고 부드럽게 발려요"},  # both patterns
            {"review_id": "r2", "text": "그냥 평범"},                 # no match
        ]
        bundle = detect_signals(rows, lex)
        assert len(bundle.positive) == 1
        assert bundle.positive[0].evidence_count == 1
        assert bundle.positive[0].sample_review_ids == ["r1"]

    def test_min_doc_freq_drops_entry_entirely(self) -> None:
        lex = Lexicons(
            version="t",
            positive=[LexiconEntry(
                id="rare", display_label="Rare",
                patterns=["희귀"], min_doc_freq=3,
            )],
        )
        rows = [
            {"review_id": "r1", "text": "희귀한 색"},
            {"review_id": "r2", "text": "희귀합니다"},
        ]
        bundle = detect_signals(rows, lex)
        assert bundle.positive == []

    def test_min_doc_freq_exact_match_fires(self) -> None:
        lex = Lexicons(
            version="t",
            positive=[LexiconEntry(
                id="ok", display_label="OK",
                patterns=["희귀"], min_doc_freq=2,
            )],
        )
        rows = [
            {"review_id": "r1", "text": "희귀한 색"},
            {"review_id": "r2", "text": "희귀합니다"},
        ]
        bundle = detect_signals(rows, lex)
        assert len(bundle.positive) == 1
        assert bundle.positive[0].evidence_count == 2

    def test_sample_ids_cap_at_three(self) -> None:
        lex = Lexicons(
            version="t",
            positive=[LexiconEntry(
                id="pop", display_label="Pop",
                patterns=["좋아"], min_doc_freq=1,
            )],
        )
        rows = [
            {"review_id": f"r{i}", "text": "좋아요"} for i in (5, 2, 9, 1, 7)
        ]
        bundle = detect_signals(rows, lex)
        sig = bundle.positive[0]
        assert sig.evidence_count == 5
        # Sorted ascending, then first 3.
        assert sig.sample_review_ids == ["r1", "r2", "r5"]

    def test_gap_rule_ignores_true_flag_rows(self) -> None:
        rows = [
            {"review_id": "r1", "source_channel": "oliveyoung",
             "text": "재구매 했어요",
             "raw_metadata": {"oy_is_repurchase": True}},
            {"review_id": "r2", "source_channel": "oliveyoung",
             "text": "재구매 했어요",
             "raw_metadata": {"oy_is_repurchase": False}},
            {"review_id": "r3", "source_channel": "oliveyoung",
             "text": "계속 사게 되네요",
             "raw_metadata": {"oy_is_repurchase": False}},
        ]
        bundle = detect_signals(rows, Lexicons(version="t"))
        # Only r2 and r3 count — r1's flag=True means API and text agree.
        assert len(bundle.gaps) == 1
        assert bundle.gaps[0].evidence_count == 2
        assert bundle.gaps[0].sample_review_ids == ["r2", "r3"]

    def test_gap_rule_ignores_missing_flag_rows(self) -> None:
        """Missing flag != False-flag; we only flag API/text disagreement,
        not API/text absence."""
        rows = [
            {"review_id": "r1", "source_channel": "oliveyoung",
             "text": "재구매 했어요",
             "raw_metadata": {}},  # no oy_is_repurchase key
            {"review_id": "r2", "source_channel": "oliveyoung",
             "text": "재구매 했어요",
             "raw_metadata": {"oy_is_repurchase": False}},
        ]
        bundle = detect_signals(rows, Lexicons(version="t"))
        assert bundle.gaps == []  # only 1 genuine False-vs-text hit, below threshold of 2

    def test_gap_rule_scoped_to_oliveyoung(self) -> None:
        """Coupang rows don't have oy_is_repurchase; the rule must skip them."""
        rows = [
            {"review_id": "c1", "source_channel": "coupang",
             "text": "재구매 했어요", "raw_metadata": {}},
            {"review_id": "c2", "source_channel": "coupang",
             "text": "3개째 사용 중", "raw_metadata": {}},
        ]
        bundle = detect_signals(rows, Lexicons(version="t"))
        assert bundle.gaps == []

    def test_authenticity_rule_fires_on_single_coupang_hit(self) -> None:
        """Threshold=1: one credible counterfeit mention must surface,
        unlike the repurchase rule which requires ≥2 hits."""
        rows = [
            {"review_id": "c1", "source_channel": "coupang",
             "text": "[정품이 아닌거같아요] 색도 다르고 이상해요"},
            {"review_id": "c2", "source_channel": "coupang",
             "text": "좋아요 잘쓰고있어요"},
        ]
        bundle = detect_signals(rows, Lexicons(version="t"))
        assert len(bundle.gaps) == 1
        g = bundle.gaps[0]
        assert g.name == "coupang_authenticity_concern"
        assert g.category == "gap"
        assert g.evidence_count == 1
        assert g.sample_review_ids == ["c1"]

    def test_authenticity_rule_patterns_all_counted(self) -> None:
        """Multiple rows matching ANY of 가품/짝퉁/정품이 아닌 all count."""
        rows = [
            {"review_id": "c1", "source_channel": "coupang",
             "text": "이거 가품 같아요"},
            {"review_id": "c2", "source_channel": "coupang",
             "text": "짝퉁 의심 돼요"},
            {"review_id": "c3", "source_channel": "coupang",
             "text": "정품이 아닌 듯"},
            {"review_id": "c4", "source_channel": "coupang",
             "text": "저번에 산거랑 색도 다르고"},
        ]
        bundle = detect_signals(rows, Lexicons(version="t"))
        g = next(s for s in bundle.gaps if s.name == "coupang_authenticity_concern")
        assert g.evidence_count == 4

    def test_authenticity_rule_scoped_to_coupang(self) -> None:
        """OY rows with the same phrases must not fire this rule."""
        rows = [
            {"review_id": "o1", "source_channel": "oliveyoung",
             "text": "가품 같은 걱정은 없어요", "raw_metadata": {}},
            {"review_id": "o2", "source_channel": "oliveyoung",
             "text": "색도 다르지 않고 좋아요", "raw_metadata": {}},
        ]
        bundle = detect_signals(rows, Lexicons(version="t"))
        assert not any(g.name == "coupang_authenticity_concern"
                       for g in bundle.gaps)

    def test_authenticity_rule_silent_when_no_hit(self) -> None:
        rows = [
            {"review_id": "c1", "source_channel": "coupang",
             "text": "색상 예뻐요"},
        ]
        bundle = detect_signals(rows, Lexicons(version="t"))
        assert bundle.gaps == []

    def test_skin_irritation_rule_fires_on_single_hit_any_channel(self) -> None:
        """Safety-class rule, threshold=1, channel-agnostic."""
        rows = [
            {"review_id": "c1", "source_channel": "coupang",
             "text": "사용하고 나니 가렵고 따갑더라구요"},
            {"review_id": "o1", "source_channel": "oliveyoung",
             "text": "따갑고 가려워서 바로 지웠어요", "raw_metadata": {}},
            {"review_id": "c2", "source_channel": "coupang",
             "text": "색 좋아요 만족"},
        ]
        bundle = detect_signals(rows, Lexicons(version="t"))
        g = next(s for s in bundle.gaps if s.name == "skin_irritation_concern")
        assert g.evidence_count == 2
        assert g.category == "gap"
        assert g.sample_review_ids == ["c1", "o1"]

    def test_skin_irritation_rule_ignores_negation_framing(self) -> None:
        """Bare '가렵' / '따갑' / '알러지' / '피부 트러블' commonly appear
        in positive '없어요' negation constructs. The rule's conjunctive
        patterns (가렵+따갑) must NOT fire on those."""
        rows = [
            {"review_id": "p1", "source_channel": "coupang",
             "text": "알러지 반응 없음. 자극 없어요. 피부 트러블 없어요"},
            {"review_id": "p2", "source_channel": "coupang",
             "text": "자극적이지 않고 가벼워요"},
            {"review_id": "p3", "source_channel": "coupang",
             "text": "피부가 가렵지 않고 편안해요"},
        ]
        bundle = detect_signals(rows, Lexicons(version="t"))
        assert not any(g.name == "skin_irritation_concern"
                       for g in bundle.gaps)

    def test_skin_irritation_rule_silent_when_no_hit(self) -> None:
        rows = [
            {"review_id": "c1", "source_channel": "coupang",
             "text": "촉촉해요"},
        ]
        bundle = detect_signals(rows, Lexicons(version="t"))
        assert not any(g.name == "skin_irritation_concern"
                       for g in bundle.gaps)

    def test_skin_irritation_rule_pattern_variants(self) -> None:
        """Ensure all four conjunctive patterns independently produce hits."""
        for text in (
            "피부가 가렵고 따갑더라구요",   # declarative 가렵-
            "따갑고 가렵네요",             # reverse declarative
            "따갑고 가려워서 지웠어요",     # reverse conjugated 가려-
            "이상하게 가렵네요",           # contextual
        ):
            rows = [{"review_id": "c1", "source_channel": "coupang",
                     "text": text}]
            bundle = detect_signals(rows, Lexicons(version="t"))
            assert any(g.name == "skin_irritation_concern" for g in bundle.gaps), (
                f"expected fire on text: {text!r}"
            )

    def test_empty_inputs(self) -> None:
        bundle = detect_signals([], Lexicons(version="t"))
        assert bundle.positive == []
        assert bundle.cautionary == []
        assert bundle.gaps == []

    def test_missing_lexicon_files_return_empty_entries(self, tmp_path) -> None:
        lex = load_lexicons(tmp_path / "nope.json", tmp_path / "nope2.json")
        assert lex.positive == []
        assert lex.cautionary == []
        assert lex.version == "positive=0.0;cautionary=0.0"

    def test_roundtrips_through_pydantic(self, rows, lexicons) -> None:
        bundle = detect_signals(rows, lexicons)
        from src.voc.reporting.phase1.schema import SignalsBundle
        restored = SignalsBundle.model_validate(bundle.model_dump(mode="json"))
        assert restored == bundle


class TestCategoryScoping:
    """Base+extensions architecture: lexicon entries can be scoped to one
    or more product categories. Default ["*"] = universal, preserving
    pre-architecture behavior. See ``_row_in_entry_scope`` for semantics.
    """

    def test_universal_default_fires_on_all_rows(self) -> None:
        """Missing categories field → ["*"] default → matches any row
        regardless of product category. This is the backward-compat path."""
        lex = Lexicons(
            version="t",
            cautionary=[LexiconEntry(
                id="s", display_label="S",
                patterns=["문제"], min_doc_freq=1,
                # categories field not set → defaults to ["*"]
            )],
        )
        rows = [
            {"review_id": "r1", "product_external_id": "blush_sku",  "text": "문제 있음"},
            {"review_id": "r2", "product_external_id": "eye_sku",    "text": "문제 많음"},
            {"review_id": "r3", "product_external_id": "unknown_sku","text": "문제요"},
        ]
        product_categories = {"blush_sku": "blush", "eye_sku": "eyeshadow"}
        bundle = detect_signals(rows, lex, product_categories=product_categories)
        assert len(bundle.cautionary) == 1
        assert bundle.cautionary[0].evidence_count == 3

    def test_scoped_entry_fires_on_matching_category_only(self) -> None:
        """Entry with categories=["blush"] matches blush rows, silent on
        eyeshadow rows and on rows whose product has no known category."""
        lex = Lexicons(
            version="t",
            cautionary=[LexiconEntry(
                id="blush_only", display_label="Blush only",
                patterns=["문제"], min_doc_freq=1,
                categories=["blush"],
            )],
        )
        rows = [
            {"review_id": "b1", "product_external_id": "blush_sku",   "text": "문제 하나"},
            {"review_id": "b2", "product_external_id": "blush_sku",   "text": "문제 또"},
            {"review_id": "e1", "product_external_id": "eye_sku",     "text": "문제 있음"},
            {"review_id": "u1", "product_external_id": "unknown_sku", "text": "문제 또"},
        ]
        product_categories = {"blush_sku": "blush", "eye_sku": "eyeshadow"}
        bundle = detect_signals(rows, lex, product_categories=product_categories)
        assert len(bundle.cautionary) == 1
        c = bundle.cautionary[0]
        assert c.evidence_count == 2
        assert c.sample_review_ids == ["b1", "b2"]

    def test_no_product_categories_disables_scoping(self) -> None:
        """Even a scoped entry (categories=["blush"]) fires on every row
        when the caller passes no product_categories map. Preserves
        pre-architecture behavior for callers that don't know about
        categories."""
        lex = Lexicons(
            version="t",
            cautionary=[LexiconEntry(
                id="scoped_but_no_map", display_label="Scoped",
                patterns=["문제"], min_doc_freq=1,
                categories=["blush"],
            )],
        )
        rows = [
            {"review_id": "r1", "product_external_id": "blush_sku", "text": "문제"},
            {"review_id": "r2", "product_external_id": "eye_sku",   "text": "문제"},
        ]
        # product_categories=None (default) → scoping disabled → both rows match
        bundle = detect_signals(rows, lex)
        assert len(bundle.cautionary) == 1
        assert bundle.cautionary[0].evidence_count == 2

    def test_multi_category_entry_matches_any_listed(self) -> None:
        """An entry scoped to multiple categories matches rows from any of
        them (but still not unknown ones when product_categories is active)."""
        lex = Lexicons(
            version="t",
            cautionary=[LexiconEntry(
                id="two_cats", display_label="Two cats",
                patterns=["문제"], min_doc_freq=1,
                categories=["blush", "eyeshadow"],
            )],
        )
        rows = [
            {"review_id": "b", "product_external_id": "blush_sku", "text": "문제"},
            {"review_id": "e", "product_external_id": "eye_sku",   "text": "문제"},
            {"review_id": "l", "product_external_id": "lip_sku",   "text": "문제"},
        ]
        pc = {"blush_sku": "blush", "eye_sku": "eyeshadow", "lip_sku": "lip"}
        bundle = detect_signals(rows, lex, product_categories=pc)
        assert len(bundle.cautionary) == 1
        c = bundle.cautionary[0]
        assert c.evidence_count == 2
        assert set(c.sample_review_ids) == {"b", "e"}


class TestNegationFilter:
    """Opt-in negation filter for positive signals (moist_finish,
    good_applicability) and the api_repurchase_vs_text_mention gap rule.
    Suppresses pattern matches inside a small window around negation
    particles (안 / 않 / 못 / 아니 / 모르). See signals.py
    _NEGATION_FILTERED_SIGNALS and _NEGATION_PARTICLES."""

    def test_moist_finish_suppressed_on_negation_after_pattern(self) -> None:
        """'촉촉한 것도 아니고' — 아니 follows 촉촉 in 20-char post-window."""
        lex = Lexicons(
            version="t",
            positive=[LexiconEntry(
                id="moist_finish", display_label="촉촉",
                patterns=["촉촉"], min_doc_freq=1,
            )],
        )
        rows = [
            {"review_id": "neg1", "text": "막 촉촉한 것도 아니고 그냥 무난무난"},
            {"review_id": "neg2", "text": "촉촉하게 발린다는지 모르겠음"},
        ]
        bundle = detect_signals(rows, lex)
        assert bundle.positive == [], "both rows have negated 촉촉 mention"

    def test_moist_finish_fires_on_legit_positive(self) -> None:
        lex = Lexicons(
            version="t",
            positive=[LexiconEntry(
                id="moist_finish", display_label="촉촉",
                patterns=["촉촉"], min_doc_freq=1,
            )],
        )
        rows = [{"review_id": "p1", "text": "촉촉하고 발색도 이뻐요"}]
        bundle = detect_signals(rows, lex)
        assert len(bundle.positive) == 1
        assert bundle.positive[0].evidence_count == 1

    def test_moist_finish_fires_when_negated_and_non_negated_cooccur(self) -> None:
        """If a row has the pattern twice — one negated, one not — signal
        still fires. One non-negated occurrence is enough."""
        lex = Lexicons(
            version="t",
            positive=[LexiconEntry(
                id="moist_finish", display_label="촉촉",
                patterns=["촉촉"], min_doc_freq=1,
            )],
        )
        rows = [{"review_id": "mix",
                 "text": "막 촉촉한 것도 아니지만 실은 촉촉하고 예뻐요"}]
        bundle = detect_signals(rows, lex)
        assert len(bundle.positive) == 1, "second, non-negated 촉촉 should fire"

    def test_good_applicability_suppressed_on_negation(self) -> None:
        lex = Lexicons(
            version="t",
            positive=[LexiconEntry(
                id="good_applicability", display_label="발림성",
                patterns=["발림성"], min_doc_freq=1,
            )],
        )
        rows = [{"review_id": "neg",
                 "text": "발림성이 영 별로에요 못 쓰겠네요"}]
        bundle = detect_signals(rows, lex)
        # "못 " in post-window → suppressed
        assert bundle.positive == []

    def test_opt_out_signal_ignores_negation(self) -> None:
        """Signals NOT in _NEGATION_FILTERED_SIGNALS (e.g., no_base_crumbling,
        whose patterns are themselves negation constructs) must continue to
        fire even when a negation particle is in the window."""
        lex = Lexicons(
            version="t",
            positive=[LexiconEntry(
                id="no_base_crumbling", display_label="베이스 까짐 없음",
                patterns=["베이스 까짐없", "안 까지"], min_doc_freq=1,
            )],
        )
        rows = [
            {"review_id": "pos1", "text": "베이스 까짐없고 촉촉해요"},
            {"review_id": "pos2", "text": "베이스가 안 까지고 유지력도 좋아요"},
        ]
        bundle = detect_signals(rows, lex)
        assert len(bundle.positive) == 1
        assert bundle.positive[0].evidence_count == 2

    def test_opt_in_preserves_positive_compound_eopsda(self) -> None:
        """Regression: 'baseline까짐없고 촉촉' should still fire moist_finish
        because 없 was intentionally excluded from the particle list —
        compounds with 없 are often positive in cosmetics reviews."""
        lex = Lexicons(
            version="t",
            positive=[LexiconEntry(
                id="moist_finish", display_label="촉촉",
                patterns=["촉촉"], min_doc_freq=1,
            )],
        )
        rows = [{"review_id": "compound",
                 "text": "베이스까짐없고 촉촉하고 유지력좋은건 진짜인정"}]
        bundle = detect_signals(rows, lex)
        assert len(bundle.positive) == 1, (
            "없 as part of 까짐없고 is positive framing; filter must not "
            "false-suppress adjacent legit moist_finish fire"
        )

    def test_repurchase_gap_suppressed_on_negation(self) -> None:
        """The api_repurchase_vs_text_mention gap rule also applies the
        negation filter — 'NOT going to repurchase' must not fire."""
        rows = [
            {"review_id": "n1", "source_channel": "oliveyoung",
             "text": "재구매는 안 할 것 같은데 제품은 나쁘지 않아요",
             "raw_metadata": {"oy_is_repurchase": False}},
            {"review_id": "n2", "source_channel": "oliveyoung",
             "text": "정말 재구매 안 할 거에요",
             "raw_metadata": {"oy_is_repurchase": False}},
        ]
        bundle = detect_signals(rows, Lexicons(version="t"))
        gap_names = [g.name for g in bundle.gaps]
        assert "api_repurchase_vs_text_mention" not in gap_names
