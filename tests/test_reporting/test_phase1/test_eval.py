"""Tests for the Phase 1 signal-quality eval layer.

Three classes:

- ``TestScoringMath``: synthetic inputs. Asserts TP/FP/FN + precision/recall math
  and the coverage-gap / universe semantics. No DB dependency.
- ``TestSchemaStability``: EvalResult round-trips through Pydantic.
- ``TestGoldenIntegration``: runs against the real golden + signal_map files +
  current DB state. Thresholds deliberately loose for the first baseline — the
  goal is to detect regressions, not prescribe perfection. Skipped when the DB
  is missing or empty on the matched-pair scope.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from src.voc.reporting.phase1.eval import (
    EvalResult,
    score,
)
from src.voc.reporting.phase1.signals import (
    detect_signals_with_membership,
    load_lexicons,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
GOLDEN_PATH = REPO_ROOT / "eval_data" / "phase1" / "phase1_signals_golden.json"
SIGNAL_MAP_PATH = REPO_ROOT / "eval_data" / "phase1" / "phase1_signal_map.json"
LEXICON_POSITIVE = REPO_ROOT / "data" / "phase1_lexicons" / "positive.json"
LEXICON_CAUTIONARY = REPO_ROOT / "data" / "phase1_lexicons" / "cautionary.json"
DB_PATH = REPO_ROOT / "voc_data.db"


# ---------------------------------------------------------------------------
# Synthetic building blocks
# ---------------------------------------------------------------------------


def _golden(labels: dict) -> dict:
    return {"version": "test-1", "labels": labels}


def _map(tag_to_signals: dict) -> dict:
    return {"version": "test-1", "tag_to_expected_signals": tag_to_signals}


def _lab(channel="coupang", rating=2.0, concerns=None, status="reviewed"):
    return {
        "channel": channel,
        "rating": rating,
        "text_excerpt": "...",
        "concerns": concerns or [],
        "positive_signals": [],
        "curator_note": "",
        "status": status,
    }


# ---------------------------------------------------------------------------
# TestScoringMath
# ---------------------------------------------------------------------------


class TestScoringMath:
    def test_perfect_recall_and_precision(self) -> None:
        golden = _golden({
            "r1": _lab(concerns=["durability_concern"]),
            "r2": _lab(concerns=["durability_concern"]),
        })
        smap = _map({"durability_concern": ["persistence_reservation"]})
        result = score(
            membership={"persistence_reservation": {"r1", "r2"}},
            all_review_ids=["r1", "r2", "r3"],
            golden=golden,
            signal_map=smap,
        )
        s = result.per_signal["persistence_reservation"]
        assert s.tp == 2 and s.fp == 0 and s.fn == 0
        assert s.precision == 1.0 and s.recall == 1.0
        assert result.coverage_gaps == []

    def test_false_positive_on_unlabeled_review(self) -> None:
        """r1 labeled & matched; r2 unlabeled but signal fired → FP."""
        golden = _golden({"r1": _lab(concerns=["durability_concern"])})
        smap = _map({"durability_concern": ["persistence_reservation"]})
        result = score(
            membership={"persistence_reservation": {"r1", "r2"}},
            all_review_ids=["r1", "r2"],
            golden=golden,
            signal_map=smap,
        )
        s = result.per_signal["persistence_reservation"]
        assert s.tp == 1 and s.fp == 1 and s.fn == 0
        assert s.precision == 0.5 and s.recall == 1.0

    def test_false_negative_when_pipeline_misses(self) -> None:
        golden = _golden({
            "r1": _lab(concerns=["durability_concern"]),
            "r2": _lab(concerns=["durability_concern"]),
        })
        smap = _map({"durability_concern": ["persistence_reservation"]})
        result = score(
            membership={"persistence_reservation": {"r1"}},
            all_review_ids=["r1", "r2"],
            golden=golden,
            signal_map=smap,
        )
        s = result.per_signal["persistence_reservation"]
        assert s.tp == 1 and s.fp == 0 and s.fn == 1
        assert s.precision == 1.0 and s.recall == 0.5

    def test_coverage_gap_does_not_pollute_signal_math(self) -> None:
        """A review labeled ONLY with a coverage-gap tag must contribute
        zero to any signal's TP/FP/FN."""
        golden = _golden({
            "r1": _lab(concerns=["pigment_complaint"]),   # coverage gap
            "r2": _lab(concerns=["durability_concern"]),  # mapped
        })
        smap = _map({
            "durability_concern": ["persistence_reservation"],
            "pigment_complaint": [],   # explicit coverage gap
        })
        result = score(
            membership={"persistence_reservation": {"r2"}},
            all_review_ids=["r1", "r2"],
            golden=golden,
            signal_map=smap,
        )
        s = result.per_signal["persistence_reservation"]
        assert s.tp == 1 and s.fp == 0 and s.fn == 0
        assert s.precision == 1.0 and s.recall == 1.0
        # Coverage gap captured separately.
        assert len(result.coverage_gaps) == 1
        assert result.coverage_gaps[0].tag == "pigment_complaint"
        assert result.coverage_gaps[0].n_reviews == 1

    def test_unknown_tag_is_treated_as_coverage_gap(self) -> None:
        """A concern tag NOT declared in the signal map is reported as a
        coverage gap rather than silently dropped."""
        golden = _golden({"r1": _lab(concerns=["novel_unseen_concern"])})
        smap = _map({})  # no tags declared at all
        result = score(
            membership={},
            all_review_ids=["r1"],
            golden=golden,
            signal_map=smap,
        )
        assert any(g.tag == "novel_unseen_concern" for g in result.coverage_gaps)

    def test_positive_signal_firings_are_ignored(self) -> None:
        """Positive signals (moist_finish etc.) never appear as values in
        signal_map, so they must NOT be scored as FP."""
        golden = _golden({"r1": _lab(concerns=["durability_concern"])})
        smap = _map({"durability_concern": ["persistence_reservation"]})
        result = score(
            membership={
                "persistence_reservation": {"r1"},
                "moist_finish": {"r1", "r2"},  # positive signal — should be ignored
            },
            all_review_ids=["r1", "r2"],
            golden=golden,
            signal_map=smap,
        )
        assert "moist_finish" not in result.per_signal
        assert result.per_signal["persistence_reservation"].tp == 1
        assert result.per_signal["persistence_reservation"].fp == 0

    def test_status_filter_reviewed_only(self) -> None:
        golden = _golden({
            "r1": _lab(concerns=["durability_concern"], status="reviewed"),
            "r2": _lab(concerns=["durability_concern"], status="draft"),
        })
        smap = _map({"durability_concern": ["persistence_reservation"]})
        result = score(
            membership={"persistence_reservation": {"r1", "r2"}},
            all_review_ids=["r1", "r2"],
            golden=golden,
            signal_map=smap,
            include_statuses=["reviewed"],
        )
        s = result.per_signal["persistence_reservation"]
        # Only r1 is expected (draft r2 filtered out). Both fired.
        # r2 fire on a not-in-expected-but-in-universe review = FP.
        assert s.n_expected == 1
        assert s.tp == 1 and s.fp == 1 and s.fn == 0

    def test_status_filter_default_includes_draft_and_reviewed(self) -> None:
        golden = _golden({
            "r1": _lab(concerns=["durability_concern"], status="reviewed"),
            "r2": _lab(concerns=["durability_concern"], status="draft"),
            "r3": _lab(concerns=["durability_concern"], status="dismissed"),
        })
        smap = _map({"durability_concern": ["persistence_reservation"]})
        result = score(
            membership={"persistence_reservation": {"r1", "r2", "r3"}},
            all_review_ids=["r1", "r2", "r3"],
            golden=golden,
            signal_map=smap,
        )
        s = result.per_signal["persistence_reservation"]
        # r1+r2 expected; r3 dismissed → r3 fire is FP.
        assert s.n_expected == 2
        assert s.tp == 2 and s.fp == 1 and s.fn == 0

    def test_label_not_in_universe_is_skipped(self) -> None:
        """Labels referencing review_ids the pipeline never saw should be
        silently skipped — they're unscoreable, not errors."""
        golden = _golden({
            "r1": _lab(concerns=["durability_concern"]),
            "ghost": _lab(concerns=["durability_concern"]),  # never ingested
        })
        smap = _map({"durability_concern": ["persistence_reservation"]})
        result = score(
            membership={"persistence_reservation": {"r1"}},
            all_review_ids=["r1"],  # note: "ghost" absent
            golden=golden,
            signal_map=smap,
        )
        s = result.per_signal["persistence_reservation"]
        assert s.n_expected == 1  # only r1; ghost excluded
        assert s.tp == 1 and s.fp == 0 and s.fn == 0

    def test_none_precision_recall_when_nothing_fires_or_expected(self) -> None:
        smap = _map({"foo": ["sig_a"], "bar": ["sig_b"]})
        # sig_a: expected 0, fired 0 → both None
        # sig_b: expected 0, fired 2 → precision=0, recall=None
        result = score(
            membership={"sig_b": {"r1", "r2"}},
            all_review_ids=["r1", "r2"],
            golden=_golden({}),
            signal_map=smap,
        )
        a = result.per_signal["sig_a"]
        b = result.per_signal["sig_b"]
        assert a.precision is None and a.recall is None
        assert b.precision == 0.0
        assert b.recall is None

    def test_coverage_gaps_sorted_by_frequency_desc_then_tag_asc(self) -> None:
        golden = _golden({
            "r1": _lab(concerns=["tag_a", "tag_b"]),
            "r2": _lab(concerns=["tag_a"]),
            "r3": _lab(concerns=["tag_c"]),
        })
        smap = _map({"tag_a": [], "tag_b": [], "tag_c": []})
        result = score(
            membership={},
            all_review_ids=["r1", "r2", "r3"],
            golden=golden,
            signal_map=smap,
        )
        order = [g.tag for g in result.coverage_gaps]
        # tag_a (2) > tag_b (1) > tag_c (1). Tie between tag_b and tag_c
        # breaks by tag ascending.
        assert order == ["tag_a", "tag_b", "tag_c"]


# ---------------------------------------------------------------------------
# TestSchemaStability
# ---------------------------------------------------------------------------


class TestSchemaStability:
    def test_eval_result_roundtrips(self) -> None:
        golden = _golden({"r1": _lab(concerns=["durability_concern"])})
        smap = _map({"durability_concern": ["persistence_reservation"]})
        result = score(
            membership={"persistence_reservation": {"r1"}},
            all_review_ids=["r1"],
            golden=golden,
            signal_map=smap,
        )
        payload = result.model_dump(mode="json")
        # Round-trip through JSON string too.
        restored = EvalResult.model_validate_json(json.dumps(payload))
        assert restored == result


# ---------------------------------------------------------------------------
# TestGoldenIntegration — against real files + DB
# ---------------------------------------------------------------------------


def _db_has_matched_pair_rows() -> bool:
    if not DB_PATH.is_file():
        return False
    try:
        conn = sqlite3.connect(str(DB_PATH))
        try:
            row = conn.execute(
                "SELECT COUNT(*) FROM phase1_reviews "
                "WHERE product_external_id IN ('A000000238828', '7156638510')"
            ).fetchone()
            return bool(row and row[0] > 0)
        finally:
            conn.close()
    except Exception:
        return False


@pytest.mark.skipif(
    not _db_has_matched_pair_rows(),
    reason="Dev DB missing matched-pair rows; integration eval skipped.",
)
class TestGoldenIntegration:
    @pytest.fixture(scope="class")
    def scored_result(self) -> EvalResult:
        golden = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
        signal_map = json.loads(SIGNAL_MAP_PATH.read_text(encoding="utf-8"))
        lexicons = load_lexicons(LEXICON_POSITIVE, LEXICON_CAUTIONARY)

        from src.voc.persistence.migrations import init_db
        from src.voc.persistence.phase1_review_repository import (
            Phase1ReviewRepository,
        )
        db = init_db(str(DB_PATH))
        try:
            repo = Phase1ReviewRepository(db)
            rows = [
                r for r in repo.query()
                if r.get("product_external_id") in {"A000000238828", "7156638510"}
            ]
        finally:
            db.close()

        _bundle, membership = detect_signals_with_membership(rows, lexicons)
        return score(
            membership=membership,
            all_review_ids=[str(r["review_id"]) for r in rows if r.get("review_id")],
            golden=golden,
            signal_map=signal_map,
        )

    def test_scored_signal_set_covers_mapped_signals(self, scored_result) -> None:
        """Every signal appearing as a value in signal_map is present in per_signal."""
        for sig in {
            "persistence_reservation",
            "tone_mismatch",
            "pigment_complaint",
            "value_complaint",
            "application_issue",
            "coupang_authenticity_concern",
            "skin_irritation_concern",
        }:
            assert sig in scored_result.per_signal, (
                f"mapped signal {sig!r} missing from eval per-signal output"
            )

    def test_authenticity_signal_reaches_full_recall(self, scored_result) -> None:
        """The one labeled authenticity concern (f2e41a...) must be caught."""
        s = scored_result.per_signal["coupang_authenticity_concern"]
        if s.n_expected > 0:
            assert s.recall is not None and s.recall >= 0.99, (
                f"authenticity recall below expected baseline: {s.recall}"
            )

    def test_persistence_reservation_baseline_recall(self, scored_result) -> None:
        """Loose baseline: PR5B's durability signal should catch at least
        half the labeled durability_concern reviews. Tightens later."""
        s = scored_result.per_signal["persistence_reservation"]
        if s.n_expected > 0:
            assert s.recall is not None and s.recall >= 0.5, (
                f"persistence_reservation recall below loose baseline: {s.recall}"
            )

    def test_coverage_gap_count_meaningful(self, scored_result) -> None:
        """At least one coverage gap must be surfaced. If this ever fails
        with 0 gaps, either the labels shrank (curator removed tags) or
        every concern now has a mapped signal (big win — tighten this
        assertion up or delete it)."""
        assert len(scored_result.coverage_gaps) >= 1

    def test_no_signal_has_negative_counts(self, scored_result) -> None:
        for sig in scored_result.per_signal.values():
            assert sig.tp >= 0 and sig.fp >= 0 and sig.fn >= 0
            if sig.precision is not None:
                assert 0.0 <= sig.precision <= 1.0
            if sig.recall is not None:
                assert 0.0 <= sig.recall <= 1.0
