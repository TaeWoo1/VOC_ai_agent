"""Tests for src/voc/app/evidence_scoring.py.

Two layers:
  - `compute_evidence_score` is a pure function — exercised across
    rating tiers, sort-type weights, rank tiers, and the additivity
    contract.
  - `apply_evidence_scores_to_db` is an integration layer — exercised
    against a tmp_path SQLite DB to confirm the score lands in
    raw_metadata, idempotency holds, and no other column is touched.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from src.voc.app.evidence_scoring import (
    RATING_TIER_CONTRIB,
    SORT_TYPE_MULTIPLIER,
    ScoringStats,
    apply_evidence_scores_to_db,
    compute_evidence_score,
)


# ---------------------------------------------------------------------------
# 5-review documented examples — locked in as a regression suite
# ---------------------------------------------------------------------------
#
# Re-derive any time the weight constants change; if these values
# shift, the module docstring's table is wrong and must be updated in
# the same PR. Keep them in sync.

DOCUMENTED_EXAMPLES = [
    # (label, rating, sort_ranks, expected_score)
    ("strong complaint, top of RATING_ASC + USEFUL_SCORE_DESC",
     1, {"RATING_ASC": 2, "USEFUL_SCORE_DESC": 5}, 7.70),
    ("strong praise, top of RECOMMENDED_DESC",
     5, {"RECOMMENDED_DESC": 1}, 3.90),
    ("middling, only chronological backbone (no signal)",
     3, {"DATETIME_DESC": 50}, 0.50),
    ("complaint with mid-rank visibility on signal sorts",
     2, {"RATING_ASC": 45, "USEFUL_SCORE_DESC": 28}, 4.85),
    ("anonymous-rating with top RATING_DESC",
     None, {"RATING_DESC": 3}, 2.10),
]


@pytest.mark.parametrize(
    "label,rating,ranks,expected",
    [(lbl, r, ranks, exp) for (lbl, r, ranks, exp) in DOCUMENTED_EXAMPLES],
    ids=[lbl[:50] for (lbl, *_) in DOCUMENTED_EXAMPLES],
)
def test_documented_5_review_examples(label, rating, ranks, expected):
    """The exact 5 examples in the module docstring. If the weights are
    tuned in a future PR, these scores will shift — and so should the
    docstring table. This test makes the drift surface immediately."""
    assert compute_evidence_score(rating, ranks) == pytest.approx(expected)


# ---------------------------------------------------------------------------
# Pure-function: rating contribution
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("rating,expected", [
    (1, 2.0), (2, 2.0),    # complaints — strongest rating evidence
    (3, 0.5),              # mixed/mild — weakest
    (4, 1.0),
    (5, 1.5),              # strong praise
    (None, 0.0),           # missing → neutral
    (0, 0.0),              # out of range → neutral, not garbage
    (6, 0.0),              # ditto
    ("not a number", 0.0), # defensive
])
def test_rating_contribution_alone(rating, expected):
    """No sort_ranks → score is rating contribution only."""
    assert compute_evidence_score(rating, None) == pytest.approx(expected)


def test_rating_4_5_rounds_to_nearest_integer_tier():
    """Half-step ratings (rare in OY but possible from upstream
    half-scale conversions) must still produce a tier weight, not 0."""
    # 4.5 rounds to 4 (banker's rounding); contribution is RATING_TIER_CONTRIB[4]
    s = compute_evidence_score(4.5, None)
    assert s in (RATING_TIER_CONTRIB[4], RATING_TIER_CONTRIB[5])


# ---------------------------------------------------------------------------
# Pure-function: sort + rank contribution
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("rank,expected_tier", [
    (1, 3.0),
    (10, 3.0),     # boundary inclusive
    (11, 1.5),     # boundary
    (50, 1.5),     # boundary inclusive
    (51, 0.5),     # tail starts
    (5000, 0.5),
    (None, 0.0),
    (0, 0.0),      # invalid rank — neutral
    (-3, 0.0),
])
def test_rank_tier_boundaries(rank, expected_tier):
    """Rank-tier boundaries must be stable so rank-9 vs rank-11 reviews
    don't oscillate under re-scrape jitter."""
    # Rating=None so the rank contribution is the only thing in the score.
    score = compute_evidence_score(None, {"RATING_ASC": rank})
    assert score == pytest.approx(expected_tier * SORT_TYPE_MULTIPLIER["RATING_ASC"])


def test_datetime_desc_contributes_zero_regardless_of_rank():
    """Chronological backbone — every review is here. Membership in
    DATETIME_DESC carries no evidence value on its own."""
    for rank in (1, 5, 10, 50, 1000):
        s = compute_evidence_score(None, {"DATETIME_DESC": rank})
        assert s == 0.0


def test_unknown_sort_type_contributes_zero():
    """Defensive: a sort_type the orchestrator doesn't know about
    (future plan extension, typo in raw_metadata) gets 0 weight rather
    than an exception or a default-bucket misclassification."""
    s = compute_evidence_score(None, {"FUTURE_SORT_TYPE": 1})
    assert s == 0.0


@pytest.mark.parametrize("sort_type,expected_mult", [
    ("RATING_ASC",        1.0),
    ("USEFUL_SCORE_DESC", 0.9),
    ("RECOMMENDED_DESC",  0.8),
    ("RATING_DESC",       0.7),
    ("DATETIME_DESC",     0.0),
])
def test_sort_type_multiplier_relative_ordering(sort_type, expected_mult):
    """The constants embed a critical-vs-positive ordering: RATING_ASC
    (critical) > USEFUL > RECOMMENDED > RATING_DESC (positive) > DATETIME.
    Locking the relative order so a future tuning PR can't silently
    invert priorities."""
    assert SORT_TYPE_MULTIPLIER[sort_type] == pytest.approx(expected_mult)


def test_score_is_additive_across_multiple_sort_signals():
    """The same review in multiple signal sorts gets summed contributions.
    A review at rank 1 in RATING_ASC AND USEFUL_SCORE_DESC is much
    stronger evidence than the same rank in either alone."""
    only_rating_asc = compute_evidence_score(None, {"RATING_ASC": 1})
    only_useful = compute_evidence_score(None, {"USEFUL_SCORE_DESC": 1})
    both = compute_evidence_score(
        None, {"RATING_ASC": 1, "USEFUL_SCORE_DESC": 1},
    )
    assert both == pytest.approx(only_rating_asc + only_useful)


def test_missing_rank_contributes_zero_alongside_present_rank():
    """A null rank in one sort doesn't poison the score — the present
    rank still contributes its full weight."""
    s = compute_evidence_score(
        None, {"RATING_ASC": 1, "RATING_DESC": None},
    )
    assert s == pytest.approx(3.0 * 1.0)  # only RATING_ASC counts


def test_empty_sort_ranks_dict_yields_rating_only_score():
    s = compute_evidence_score(2, {})
    assert s == pytest.approx(2.0)


def test_none_sort_ranks_yields_rating_only_score():
    s = compute_evidence_score(2, None)
    assert s == pytest.approx(2.0)


def test_score_is_non_negative():
    """The score is unsigned by design — every contribution is ≥ 0.
    A review with everything missing scores exactly 0, not negative."""
    assert compute_evidence_score(None, None) == 0.0
    assert compute_evidence_score(None, {}) == 0.0


def test_max_possible_score_for_top_complaint():
    """Reference upper bound: rating ≤ 2 + rank-1 in all four signal
    sorts. Used as a regression anchor — if a future re-tuning shifts
    this above ~12.5, the score's dynamic range has changed and any
    downstream threshold tuning needs a look."""
    s = compute_evidence_score(1, {
        "RATING_ASC": 1,
        "USEFUL_SCORE_DESC": 1,
        "RECOMMENDED_DESC": 1,
        "RATING_DESC": 1,
    })
    # 2.0 (rating) + 3.0 * (1.0 + 0.9 + 0.8 + 0.7) = 2.0 + 10.2 = 12.2
    assert s == pytest.approx(12.2)


# ---------------------------------------------------------------------------
# DB apply
# ---------------------------------------------------------------------------


def _make_db(path: Path, rows: list[tuple]) -> None:
    """rows: list of (review_id, rating_normalized, raw_metadata_dict, goods_no)."""
    con = sqlite3.connect(str(path))
    con.execute("""
        CREATE TABLE phase1_reviews (
            review_id TEXT PRIMARY KEY,
            text TEXT,
            rating_normalized REAL,
            review_date TEXT,
            source_channel TEXT,
            raw_metadata_json TEXT,
            product_external_id TEXT
        )
    """)
    for rid, rating, meta, goods in rows:
        con.execute(
            "INSERT INTO phase1_reviews VALUES (?, ?, ?, ?, ?, ?, ?)",
            (rid, "text " + rid, rating, "2026-04-01", "oliveyoung",
             json.dumps(meta) if meta is not None else None, goods),
        )
    con.commit()
    con.close()


def _read_meta(db: Path, review_id: str) -> dict:
    con = sqlite3.connect(str(db))
    cur = con.execute(
        "SELECT raw_metadata_json FROM phase1_reviews WHERE review_id = ?",
        (review_id,),
    )
    row = cur.fetchone()
    con.close()
    return json.loads(row[0]) if row and row[0] else {}


def _read_full_row(db: Path, review_id: str) -> dict:
    con = sqlite3.connect(str(db))
    con.row_factory = sqlite3.Row
    out = dict(con.execute(
        "SELECT * FROM phase1_reviews WHERE review_id = ?",
        (review_id,),
    ).fetchone())
    con.close()
    return out


def test_apply_writes_score_to_raw_metadata(tmp_path):
    db = tmp_path / "voc.db"
    _make_db(db, [
        ("r1", 1.0,
         {"oy_sort_ranks": {"RATING_ASC": 2, "USEFUL_SCORE_DESC": 5}},
         "A0001"),
    ])
    stats = apply_evidence_scores_to_db(db, goods_no="A0001")
    assert stats.rows_updated == 1
    meta = _read_meta(db, "r1")
    assert meta["oy_evidence_score"] == pytest.approx(7.70)
    # Pre-existing fields preserved.
    assert meta["oy_sort_ranks"] == {"RATING_ASC": 2, "USEFUL_SCORE_DESC": 5}


def test_apply_preserves_existing_unrelated_metadata_fields(tmp_path):
    db = tmp_path / "voc.db"
    initial = {
        "oy_sort_type": "DATETIME_DESC",
        "oy_sort_role": "primary",
        "oy_observed_sort_types": ["DATETIME_DESC", "RATING_ASC"],
        "oy_signal_sort_types": ["RATING_ASC"],
        "oy_is_primary_corpus": True,
        "oy_sort_ranks": {"DATETIME_DESC": 12, "RATING_ASC": 4},
        "skin_type": "건성",
    }
    _make_db(db, [("r1", 2.0, initial, "A0001")])

    apply_evidence_scores_to_db(db, goods_no="A0001")
    meta = _read_meta(db, "r1")
    # Every prior key still there, byte-for-byte.
    for k, v in initial.items():
        assert meta[k] == v, f"field {k} changed"
    # New owned key present.
    assert "oy_evidence_score" in meta


def test_apply_does_not_touch_text_rating_or_date(tmp_path):
    """Contract: this pass writes ONLY raw_metadata_json. Other columns
    must be byte-identical before and after."""
    db = tmp_path / "voc.db"
    _make_db(db, [
        ("r1", 4.0, {"oy_sort_ranks": {"RECOMMENDED_DESC": 7}}, "A0001"),
    ])
    before = _read_full_row(db, "r1")
    apply_evidence_scores_to_db(db, goods_no="A0001")
    after = _read_full_row(db, "r1")
    for col in ("text", "rating_normalized", "review_date",
                "source_channel", "review_id", "product_external_id"):
        assert before[col] == after[col], f"column {col} mutated"


def test_apply_idempotent_rerun_yields_no_updates(tmp_path):
    """Re-running with unchanged inputs produces 0 updates and the
    score is preserved — required for cron-style re-runs."""
    db = tmp_path / "voc.db"
    _make_db(db, [
        ("r1", 1.0, {"oy_sort_ranks": {"RATING_ASC": 1}}, "A0001"),
    ])
    s1 = apply_evidence_scores_to_db(db, goods_no="A0001")
    s2 = apply_evidence_scores_to_db(db, goods_no="A0001")
    assert s1.rows_updated == 1
    assert s2.rows_updated == 0
    assert s2.rows_no_op == 1
    # Score unchanged.
    score_after = _read_meta(db, "r1")["oy_evidence_score"]
    assert score_after == pytest.approx(2.0 + 3.0 * 1.0)  # 5.0


def test_apply_overwrites_when_inputs_change(tmp_path):
    """If membership for a row has been re-run and the rank improved
    (via the min-rank rule in sort_membership), the score derived from
    the new rank must overwrite the prior score on the next pass."""
    db = tmp_path / "voc.db"
    _make_db(db, [
        ("r1", 1.0,
         {"oy_sort_ranks": {"RATING_ASC": 50}, "oy_evidence_score": 99.99},
         "A0001"),
    ])
    apply_evidence_scores_to_db(db, goods_no="A0001")
    # 2.0 (rating=1) + 1.5 (rank 50, MID tier) * 1.0 = 3.5
    assert _read_meta(db, "r1")["oy_evidence_score"] == pytest.approx(3.5)


def test_apply_skips_rows_with_invalid_metadata(tmp_path):
    """Rows whose raw_metadata_json is empty / not valid JSON / not a
    dict are counted but NOT scored — matches the conservative posture
    of the membership-pass (we don't synthesize sort_ranks from thin air)."""
    db = tmp_path / "voc.db"
    con = sqlite3.connect(str(db))
    con.execute("""
        CREATE TABLE phase1_reviews (
            review_id TEXT PRIMARY KEY, text TEXT,
            rating_normalized REAL, review_date TEXT,
            source_channel TEXT, raw_metadata_json TEXT,
            product_external_id TEXT
        )
    """)
    con.execute(
        "INSERT INTO phase1_reviews VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("r_empty", "x", 4.0, "2026-04-01", "oliveyoung", None, "A0001"),
    )
    con.execute(
        "INSERT INTO phase1_reviews VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("r_bad", "x", 4.0, "2026-04-01", "oliveyoung",
         "{not_json", "A0001"),
    )
    con.execute(
        "INSERT INTO phase1_reviews VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("r_ok", "x", 4.0, "2026-04-01", "oliveyoung",
         json.dumps({"oy_sort_ranks": {"RATING_ASC": 1}}), "A0001"),
    )
    con.commit()
    con.close()

    stats = apply_evidence_scores_to_db(db, goods_no="A0001")
    assert stats.rows_examined == 3
    assert stats.rows_updated == 1
    assert stats.rows_skipped_no_metadata == 2
    # Only the OK row got a score.
    assert "oy_evidence_score" in _read_meta(db, "r_ok")


def test_apply_handles_missing_oy_sort_ranks_gracefully(tmp_path):
    """A row with raw_metadata but no oy_sort_ranks (e.g., a single-sort
    or default-mode run pre-membership pass) gets a rating-only score —
    it doesn't blow up, and DATETIME_DESC sorting still leaves room for
    a meaningful rating signal."""
    db = tmp_path / "voc.db"
    _make_db(db, [
        ("r_no_ranks", 5.0, {"skin_type": "건성"}, "A0001"),
    ])
    apply_evidence_scores_to_db(db, goods_no="A0001")
    meta = _read_meta(db, "r_no_ranks")
    # rating=5 → 1.5; no rank contribution.
    assert meta["oy_evidence_score"] == pytest.approx(1.5)
    # Existing field preserved.
    assert meta["skin_type"] == "건성"


def test_apply_does_not_leak_across_goodsno(tmp_path):
    db = tmp_path / "voc.db"
    _make_db(db, [
        ("rA", 1.0, {"oy_sort_ranks": {"RATING_ASC": 1}}, "A0001"),
        ("rB", 5.0, {"oy_sort_ranks": {"RATING_DESC": 1}}, "B0002"),
    ])
    apply_evidence_scores_to_db(db, goods_no="A0001")
    # A row got scored; B row did not (different goodsNo).
    assert "oy_evidence_score" in _read_meta(db, "rA")
    assert "oy_evidence_score" not in _read_meta(db, "rB")


def test_apply_empty_db_reports_clean_stats(tmp_path):
    db = tmp_path / "voc.db"
    _make_db(db, [])
    stats = apply_evidence_scores_to_db(db, goods_no="A0001")
    assert stats == ScoringStats()
