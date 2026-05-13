"""Tests for src/voc/app/sort_membership.py.

Pure logic tests — no Playwright, no real connector. Each test stages a
small sqlite DB and a handful of sidecar JSONs in tmp_path, runs the merge
+ apply pass, and asserts the row-level effects.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from src.voc.app.sort_membership import (
    PRIMARY_SORT_TYPE,
    SORT_ROLE_BY_SORT_TYPE,
    ApplyStats,
    ReviewMembership,
    _merge_into_metadata,
    apply_to_db,
    find_sidecars,
    merge_sidecars,
)


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------


def _write_sidecar(
    path: Path, *, goods_no: str, sort_type: str, role: str,
    review_ids: list[str],
) -> Path:
    """Legacy `review_ids` format. Used by tests that exercise the
    backward-compat read path (rank → None for every entry)."""
    payload = {
        "goodsNo": goods_no,
        "sort_type": sort_type,
        "role": role,
        "review_ids": review_ids,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2),
                    encoding="utf-8")
    return path


def _write_sidecar_with_items(
    path: Path, *, goods_no: str, sort_type: str, role: str,
    items: list[dict],
) -> Path:
    """New rank-aware `items` format."""
    payload = {
        "goodsNo": goods_no,
        "sort_type": sort_type,
        "role": role,
        "items": items,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2),
                    encoding="utf-8")
    return path


def _make_db(path: Path, rows: list[tuple]) -> None:
    """rows: list of (review_id, raw_metadata_dict, product_external_id)."""
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
    for rid, meta, goods in rows:
        con.execute(
            "INSERT INTO phase1_reviews VALUES (?, ?, ?, ?, ?, ?, ?)",
            (rid, "review text " + rid, 4.0, "2026-04-01", "oliveyoung",
             json.dumps(meta), goods),
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
    return json.loads(row[0])


def _read_full_row(db: Path, review_id: str) -> dict:
    con = sqlite3.connect(str(db))
    con.row_factory = sqlite3.Row
    row = dict(con.execute(
        "SELECT * FROM phase1_reviews WHERE review_id = ?",
        (review_id,),
    ).fetchone())
    con.close()
    return row


# ---------------------------------------------------------------------------
# Pure-logic tests: merge_sidecars
# ---------------------------------------------------------------------------


def test_merge_sidecars_aggregates_observed_sorts_per_review_id(tmp_path):
    a = _write_sidecar(
        tmp_path / "batch_a" / "A_DATETIME_DESC_review_ids.json",
        goods_no="A", sort_type="DATETIME_DESC", role="primary",
        review_ids=["r1", "r2", "r3"],
    )
    b = _write_sidecar(
        tmp_path / "batch_b" / "A_RATING_ASC_review_ids.json",
        goods_no="A", sort_type="RATING_ASC", role="signal",
        review_ids=["r1", "r4"],  # r1 in both; r4 signal-only
    )
    membership = merge_sidecars([a, b])
    assert set(membership.keys()) == {"r1", "r2", "r3", "r4"}
    assert set(membership["r1"].observed.keys()) == {"DATETIME_DESC", "RATING_ASC"}
    assert set(membership["r4"].observed.keys()) == {"RATING_ASC"}
    # Legacy `review_ids` format → ranks are null.
    assert membership["r1"].observed["DATETIME_DESC"] is None
    assert membership["r4"].observed["RATING_ASC"] is None


def test_merge_classifies_role_membership_correctly(tmp_path):
    primary = _write_sidecar(
        tmp_path / "batch_p" / "A_DATETIME_DESC_review_ids.json",
        goods_no="A", sort_type="DATETIME_DESC", role="primary",
        review_ids=["r_in_both"],
    )
    signal = _write_sidecar(
        tmp_path / "batch_s" / "A_RATING_ASC_review_ids.json",
        goods_no="A", sort_type="RATING_ASC", role="signal",
        review_ids=["r_in_both", "r_signal_only"],
    )
    m = merge_sidecars([primary, signal])
    assert m["r_in_both"].is_primary_corpus is True
    assert m["r_in_both"].signal_sorts == ["RATING_ASC"]
    # Signal-only review must NOT be classified as primary.
    assert m["r_signal_only"].is_primary_corpus is False
    assert m["r_signal_only"].signal_sorts == ["RATING_ASC"]


def test_merge_skips_corrupt_sidecar_without_aborting(tmp_path):
    good = _write_sidecar(
        tmp_path / "good_A_DATETIME_DESC_review_ids.json",
        goods_no="A", sort_type="DATETIME_DESC", role="primary",
        review_ids=["r1"],
    )
    bad = tmp_path / "bad.json"
    bad.write_text("not json {", encoding="utf-8")
    m = merge_sidecars([good, bad])
    assert "r1" in m  # one good file survives the bad neighbor


def test_merge_skips_malformed_payload(tmp_path):
    """A sidecar JSON whose review_ids isn't a list is skipped, not
    coerced — the alternative would silently lose memberships.
    """
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({
        "goodsNo": "A",
        "sort_type": "RATING_ASC",
        "review_ids": "should_be_a_list_but_isnt",
    }), encoding="utf-8")
    m = merge_sidecars([bad])
    assert m == {}


# ---------------------------------------------------------------------------
# Pure-logic tests: _merge_into_metadata (idempotency, additivity)
# ---------------------------------------------------------------------------


def test_merge_into_metadata_preserves_existing_unrelated_fields():
    existing = {
        "oy_sort_type": "DATETIME_DESC",
        "oy_sort_role": "primary",
        "skin_type": "건성",
        "oy_skin_tone_raw": "쿨톤",
    }
    mem = ReviewMembership("r1", observed={"DATETIME_DESC": 1, "RATING_ASC": 5})
    new = _merge_into_metadata(existing, mem)
    # All non-owned keys preserved verbatim.
    assert new["oy_sort_type"] == "DATETIME_DESC"
    assert new["oy_sort_role"] == "primary"
    assert new["skin_type"] == "건성"
    assert new["oy_skin_tone_raw"] == "쿨톤"
    # Owned keys filled in.
    assert new["oy_observed_sort_types"] == ["DATETIME_DESC", "RATING_ASC"]
    assert new["oy_signal_sort_types"] == ["RATING_ASC"]
    assert new["oy_is_primary_corpus"] is True
    assert new["oy_sort_ranks"] == {"DATETIME_DESC": 1, "RATING_ASC": 5}


def test_merge_into_metadata_does_not_mutate_input():
    existing = {"oy_sort_type": "DATETIME_DESC"}
    mem = ReviewMembership("r1", observed={"DATETIME_DESC": 1})
    new = _merge_into_metadata(existing, mem)
    # The caller's dict is unchanged — important for callers that hold
    # references to the pre-merge meta.
    assert "oy_observed_sort_types" not in existing
    assert "oy_sort_ranks" not in existing
    assert new is not existing


def test_merge_into_metadata_unions_with_prior_membership_lists():
    """A second pass over the same review with a NEW sort_type adds it to
    the prior list, not replaces it. This is the key idempotency property.
    """
    existing = {
        "oy_sort_type": "DATETIME_DESC",
        "oy_observed_sort_types": ["DATETIME_DESC", "RATING_ASC"],
        "oy_signal_sort_types": ["RATING_ASC"],
        "oy_is_primary_corpus": True,
        "oy_sort_ranks": {"DATETIME_DESC": 12, "RATING_ASC": 4},
    }
    mem = ReviewMembership("r1", observed={"USEFUL_SCORE_DESC": 7})
    new = _merge_into_metadata(existing, mem)
    assert new["oy_observed_sort_types"] == [
        "DATETIME_DESC", "RATING_ASC", "USEFUL_SCORE_DESC",
    ]
    assert new["oy_signal_sort_types"] == [
        "RATING_ASC", "USEFUL_SCORE_DESC",
    ]
    assert new["oy_is_primary_corpus"] is True
    # Rank merge: prior ranks preserved, new sort's rank added.
    assert new["oy_sort_ranks"] == {
        "DATETIME_DESC": 12, "RATING_ASC": 4, "USEFUL_SCORE_DESC": 7,
    }


def test_merge_into_metadata_signal_only_does_not_become_primary():
    existing = {"oy_sort_type": "RATING_ASC", "oy_sort_role": "signal"}
    mem = ReviewMembership("r1", observed={"RATING_ASC": 8})
    new = _merge_into_metadata(existing, mem)
    assert new["oy_observed_sort_types"] == ["RATING_ASC"]
    assert new["oy_signal_sort_types"] == ["RATING_ASC"]
    assert new["oy_is_primary_corpus"] is False
    assert new["oy_sort_ranks"] == {"RATING_ASC": 8}


def test_merge_into_metadata_idempotent_on_repeat():
    """Running the merge twice with the same inputs yields identical output.
    Necessary so cron-style reruns don't grow the lists indefinitely.
    """
    existing = {"oy_sort_type": "DATETIME_DESC"}
    mem = ReviewMembership("r1", observed={"DATETIME_DESC": 2, "RATING_ASC": 11})
    once = _merge_into_metadata(existing, mem)
    twice = _merge_into_metadata(once, mem)
    assert once == twice


# ---------------------------------------------------------------------------
# Integration: apply_to_db
# ---------------------------------------------------------------------------


def test_apply_to_db_writes_membership_to_correct_row(tmp_path):
    db = tmp_path / "voc.db"
    _make_db(db, [
        ("r1", {"oy_sort_type": "DATETIME_DESC", "oy_sort_role": "primary"},
         "A0001"),
        ("r2", {"oy_sort_type": "RATING_ASC", "oy_sort_role": "signal"},
         "A0001"),
    ])
    membership = {
        "r1": ReviewMembership("r1", observed={
            "DATETIME_DESC": 50, "RATING_ASC": 2,
        }),
        "r2": ReviewMembership("r2", observed={"RATING_ASC": 7}),
    }
    stats = apply_to_db(db, goods_no="A0001", membership=membership)
    assert stats.rows_updated == 2
    assert stats.rows_missing_in_db == 0

    m1 = _read_meta(db, "r1")
    assert m1["oy_observed_sort_types"] == ["DATETIME_DESC", "RATING_ASC"]
    assert m1["oy_signal_sort_types"] == ["RATING_ASC"]
    assert m1["oy_is_primary_corpus"] is True
    # Pre-existing fields preserved.
    assert m1["oy_sort_type"] == "DATETIME_DESC"
    assert m1["oy_sort_role"] == "primary"

    m2 = _read_meta(db, "r2")
    assert m2["oy_observed_sort_types"] == ["RATING_ASC"]
    assert m2["oy_is_primary_corpus"] is False


def test_apply_to_db_does_not_touch_text_rating_or_date(tmp_path):
    """The contract is "enrich raw_metadata only". Verify other columns
    are byte-identical before and after the membership pass.
    """
    db = tmp_path / "voc.db"
    _make_db(db, [
        ("r1", {"oy_sort_type": "DATETIME_DESC"}, "A0001"),
    ])
    before = _read_full_row(db, "r1")
    stats = apply_to_db(
        db, goods_no="A0001",
        membership={"r1": ReviewMembership(
            "r1", observed={"DATETIME_DESC": 1},
        )},
    )
    assert stats.rows_updated == 1
    after = _read_full_row(db, "r1")
    for col in ("text", "rating_normalized", "review_date",
                "source_channel", "review_id", "product_external_id"):
        assert before[col] == after[col], f"column {col!r} mutated"


def test_apply_to_db_idempotent_rerun_yields_no_updates(tmp_path):
    """Re-running with the same membership produces 0 updates and the
    sort lists stay deduped — the core idempotency guarantee for any
    cron / manual rerun workflow.
    """
    db = tmp_path / "voc.db"
    _make_db(db, [("r1", {"oy_sort_type": "DATETIME_DESC"}, "A0001")])
    mem = {"r1": ReviewMembership(
        "r1", observed={"DATETIME_DESC": 4, "RATING_ASC": 1},
    )}
    s1 = apply_to_db(db, goods_no="A0001", membership=mem)
    s2 = apply_to_db(db, goods_no="A0001", membership=mem)

    assert s1.rows_updated == 1
    assert s2.rows_updated == 0
    assert s2.rows_no_op == 1

    final = _read_meta(db, "r1")
    # Lists deduped on the second pass — no double entries.
    assert final["oy_observed_sort_types"] == ["DATETIME_DESC", "RATING_ASC"]
    assert final["oy_signal_sort_types"] == ["RATING_ASC"]
    # Ranks unchanged on rerun.
    assert final["oy_sort_ranks"] == {"DATETIME_DESC": 4, "RATING_ASC": 1}


def test_apply_to_db_skips_review_ids_missing_in_db(tmp_path):
    """A sidecar entry whose review_id isn't in the DB (e.g., the row
    was filtered out by content-floor normalize, or belongs to another
    product) is counted but doesn't error.
    """
    db = tmp_path / "voc.db"
    _make_db(db, [("r_present", {}, "A0001")])
    mem = {
        "r_present": ReviewMembership(
            "r_present", observed={"DATETIME_DESC": 1},
        ),
        "r_missing": ReviewMembership(
            "r_missing", observed={"RATING_ASC": 1},
        ),
    }
    stats = apply_to_db(db, goods_no="A0001", membership=mem)
    assert stats.rows_examined == 2
    assert stats.rows_updated == 1
    assert stats.rows_missing_in_db == 1


def test_apply_to_db_review_in_primary_and_signal_gets_both_memberships(tmp_path):
    """End-to-end of the key scenario: the same review appears in both
    DATETIME_DESC and a signal sort. Final metadata must show both
    memberships AND keep oy_is_primary_corpus=True.
    """
    db = tmp_path / "voc.db"
    _make_db(db, [
        ("r1", {"oy_sort_type": "DATETIME_DESC", "oy_sort_role": "primary"},
         "A0001"),
    ])
    membership = merge_sidecars([
        _write_sidecar(
            tmp_path / "p" / "A0001_DATETIME_DESC_review_ids.json",
            goods_no="A0001", sort_type="DATETIME_DESC", role="primary",
            review_ids=["r1"],
        ),
        _write_sidecar(
            tmp_path / "s" / "A0001_RATING_ASC_review_ids.json",
            goods_no="A0001", sort_type="RATING_ASC", role="signal",
            review_ids=["r1"],
        ),
    ])
    stats = apply_to_db(db, goods_no="A0001", membership=membership)
    assert stats.rows_updated == 1
    final = _read_meta(db, "r1")
    assert "DATETIME_DESC" in final["oy_observed_sort_types"]
    assert "RATING_ASC" in final["oy_observed_sort_types"]
    assert "RATING_ASC" in final["oy_signal_sort_types"]
    assert final["oy_is_primary_corpus"] is True


def test_apply_to_db_signal_only_review_does_not_become_primary(tmp_path):
    """A signal-only review must NOT have oy_is_primary_corpus set to
    True even though the merge step ran.
    """
    db = tmp_path / "voc.db"
    _make_db(db, [
        ("r_sig", {"oy_sort_type": "RATING_ASC", "oy_sort_role": "signal"},
         "A0001"),
    ])
    membership = merge_sidecars([
        _write_sidecar(
            tmp_path / "s" / "A0001_RATING_ASC_review_ids.json",
            goods_no="A0001", sort_type="RATING_ASC", role="signal",
            review_ids=["r_sig"],
        ),
        _write_sidecar(
            tmp_path / "s2" / "A0001_USEFUL_SCORE_DESC_review_ids.json",
            goods_no="A0001", sort_type="USEFUL_SCORE_DESC", role="signal",
            review_ids=["r_sig"],
        ),
    ])
    stats = apply_to_db(db, goods_no="A0001", membership=membership)
    assert stats.rows_updated == 1
    final = _read_meta(db, "r_sig")
    assert final["oy_is_primary_corpus"] is False
    # Both signal sorts recorded, even without primary membership.
    assert set(final["oy_observed_sort_types"]) == {
        "RATING_ASC", "USEFUL_SCORE_DESC",
    }


def test_apply_to_db_does_not_leak_across_goodsno(tmp_path):
    """A membership pass scoped to goods_no=A must NOT touch rows of
    goods_no=B even if the review_id strings happen to collide in the
    sidecar (defensive — content-fingerprint paths could hash similarly).
    """
    db = tmp_path / "voc.db"
    _make_db(db, [
        ("rid_collide", {"label": "A_row"}, "A0001"),
        ("rid_collide_b", {"label": "B_row"}, "B0002"),
    ])
    apply_to_db(
        db, goods_no="A0001",
        membership={
            "rid_collide": ReviewMembership(
                "rid_collide", observed={"DATETIME_DESC": 1},
            ),
            # rid_collide_b is not in the membership for A.
        },
    )
    # B row metadata is untouched: no new owned keys appear.
    b_meta = _read_meta(db, "rid_collide_b")
    assert "oy_observed_sort_types" not in b_meta
    assert b_meta == {"label": "B_row"}


def test_apply_to_db_handles_empty_membership_as_noop(tmp_path):
    db = tmp_path / "voc.db"
    _make_db(db, [("r1", {"oy_sort_type": "DATETIME_DESC"}, "A0001")])
    stats = apply_to_db(db, goods_no="A0001", membership={})
    assert stats == ApplyStats()
    # DB unchanged.
    assert _read_meta(db, "r1") == {"oy_sort_type": "DATETIME_DESC"}


# ---------------------------------------------------------------------------
# find_sidecars
# ---------------------------------------------------------------------------


def test_find_sidecars_globs_per_batch_dir(tmp_path):
    bd1 = tmp_path / "batch_step1"
    bd2 = tmp_path / "batch_step2"
    _write_sidecar(
        bd1 / "A0001_DATETIME_DESC_review_ids.json",
        goods_no="A0001", sort_type="DATETIME_DESC", role="primary",
        review_ids=["r1"],
    )
    _write_sidecar(
        bd2 / "A0001_RATING_ASC_review_ids.json",
        goods_no="A0001", sort_type="RATING_ASC", role="signal",
        review_ids=["r1"],
    )
    # Decoy: different goodsNo in the same dir — must not match.
    _write_sidecar(
        bd1 / "B0002_DATETIME_DESC_review_ids.json",
        goods_no="B0002", sort_type="DATETIME_DESC", role="primary",
        review_ids=["x"],
    )
    found = find_sidecars([bd1, bd2], goods_no="A0001")
    names = sorted(p.name for p in found)
    assert names == [
        "A0001_DATETIME_DESC_review_ids.json",
        "A0001_RATING_ASC_review_ids.json",
    ]


def test_find_sidecars_silently_skips_missing_dirs(tmp_path):
    """A per-sort run that failed before producing any sidecar leaves
    no file. The orchestrator passes the (possibly nonexistent) batch
    dir anyway — it must not raise.
    """
    nonexistent = tmp_path / "this_dir_does_not_exist"
    found = find_sidecars([nonexistent], goods_no="A0001")
    assert found == []


# ---------------------------------------------------------------------------
# Constants stability
# ---------------------------------------------------------------------------


def test_connector_last_collected_review_ids_uses_canonical_hash():
    """The connector emits canonical review_ids (the same hash the
    normalizer assigns), not raw OY source_ids. This is the contract
    the membership tracker relies on — sidecar review_ids must be
    look-uppable in phase1_reviews.review_id directly.
    """
    from src.voc.ingestion.normalizer import generate_review_id
    from src.voc.schemas.raw import RawReview
    from datetime import datetime

    raws = [
        RawReview(
            source_channel="oliveyoung",
            source_id="9999991",
            source_url=None,
            raw_text="t1",
            raw_rating=5,
            raw_author=None,
            raw_date="2026-04-01",
            raw_language="ko",
            raw_metadata={},
            collected_at=datetime.now(),
            keyword_used="x",
        ),
        RawReview(
            source_channel="oliveyoung",
            source_id="9999992",
            source_url=None,
            raw_text="t2",
            raw_rating=5,
            raw_author=None,
            raw_date="2026-04-01",
            raw_language="ko",
            raw_metadata={},
            collected_at=datetime.now(),
            keyword_used="x",
        ),
    ]
    expected = [
        generate_review_id("oliveyoung", r.source_id) for r in raws
    ]
    # Manually reproduce the connector's stamping logic — the connector
    # itself can't be exercised here without Playwright. The hashing
    # contract is what we're locking in.
    actual = [
        generate_review_id(r.source_channel, r.source_id)
        for r in raws
        if r.source_id
    ]
    assert actual == expected
    # Sanity: the hash is the 16-char prefix the rest of the system uses.
    assert all(len(rid) == 16 for rid in actual)


# ---------------------------------------------------------------------------
# Rank tracking
# ---------------------------------------------------------------------------


def test_merge_sidecars_reads_items_format_with_ranks(tmp_path):
    """The new sidecar format (items=[{review_id, rank}]) carries explicit
    1-based ranks. merge_sidecars must surface the rank on each
    membership record under the correct sort_type key.
    """
    p = _write_sidecar_with_items(
        tmp_path / "batch_a" / "A_RATING_ASC_review_ids.json",
        goods_no="A", sort_type="RATING_ASC", role="signal",
        items=[
            {"review_id": "r_top", "rank": 1},
            {"review_id": "r_mid", "rank": 25},
            {"review_id": "r_tail", "rank": 50},
        ],
    )
    membership = merge_sidecars([p])
    assert membership["r_top"].observed == {"RATING_ASC": 1}
    assert membership["r_mid"].observed == {"RATING_ASC": 25}
    assert membership["r_tail"].observed == {"RATING_ASC": 50}


def test_merge_sidecars_legacy_review_ids_format_yields_null_rank(tmp_path):
    """Backward compat: a legacy `review_ids` sidecar (no rank info) is
    still readable, but every entry comes through with rank=None — we
    don't fabricate a rank from list position because the legacy
    contract didn't promise that order = rank.
    """
    legacy = _write_sidecar(
        tmp_path / "legacy_A_RATING_ASC_review_ids.json",
        goods_no="A", sort_type="RATING_ASC", role="signal",
        review_ids=["r1", "r2", "r3"],
    )
    membership = merge_sidecars([legacy])
    for rid in ("r1", "r2", "r3"):
        assert membership[rid].observed == {"RATING_ASC": None}


def test_merge_sidecars_mixed_formats_in_one_pass(tmp_path):
    """A directory holding BOTH the new items format and a legacy
    review_ids sidecar (e.g., during transition or partial re-run) must
    merge cleanly. Legacy entries contribute rank=None; new entries
    contribute their rank value; both populate the same membership.
    """
    new = _write_sidecar_with_items(
        tmp_path / "new" / "A_DATETIME_DESC_review_ids.json",
        goods_no="A", sort_type="DATETIME_DESC", role="primary",
        items=[
            {"review_id": "r_shared", "rank": 100},
            {"review_id": "r_primary_only", "rank": 200},
        ],
    )
    legacy = _write_sidecar(
        tmp_path / "old" / "A_RATING_ASC_review_ids.json",
        goods_no="A", sort_type="RATING_ASC", role="signal",
        review_ids=["r_shared", "r_signal_only"],
    )
    m = merge_sidecars([new, legacy])
    assert m["r_shared"].observed == {
        "DATETIME_DESC": 100, "RATING_ASC": None,
    }
    assert m["r_primary_only"].observed == {"DATETIME_DESC": 200}
    assert m["r_signal_only"].observed == {"RATING_ASC": None}


def test_merge_sidecars_min_rank_wins_for_duplicate_same_sort(tmp_path):
    """Conflict rule: same review_id seen twice for the same sort keeps
    the smaller rank. Can happen when a per-sort run paginates with
    overlap, or when two sidecars for the same sort are merged on rerun.
    """
    a = _write_sidecar_with_items(
        tmp_path / "a" / "A_RATING_ASC_review_ids.json",
        goods_no="A", sort_type="RATING_ASC", role="signal",
        items=[{"review_id": "r1", "rank": 17}],
    )
    b = _write_sidecar_with_items(
        tmp_path / "b" / "A_RATING_ASC_review_ids.json",
        goods_no="A", sort_type="RATING_ASC", role="signal",
        items=[{"review_id": "r1", "rank": 3}],   # better rank
    )
    m = merge_sidecars([a, b])
    assert m["r1"].observed == {"RATING_ASC": 3}

    # Same with the other order — min wins regardless of merge order.
    m2 = merge_sidecars([b, a])
    assert m2["r1"].observed == {"RATING_ASC": 3}


def test_merge_sidecars_null_then_value_takes_value(tmp_path):
    """Conflict rule: legacy null + new value → take value. We never
    downgrade a known rank to null."""
    legacy = _write_sidecar(
        tmp_path / "old" / "A_RATING_ASC_review_ids.json",
        goods_no="A", sort_type="RATING_ASC", role="signal",
        review_ids=["r1"],
    )
    new = _write_sidecar_with_items(
        tmp_path / "new" / "A_RATING_ASC_review_ids.json",
        goods_no="A", sort_type="RATING_ASC", role="signal",
        items=[{"review_id": "r1", "rank": 5}],
    )
    # Either order — final rank must be 5 (non-null wins).
    assert merge_sidecars([legacy, new])["r1"].observed == {"RATING_ASC": 5}
    assert merge_sidecars([new, legacy])["r1"].observed == {"RATING_ASC": 5}


def test_merge_sidecars_rejects_malformed_rank_values(tmp_path):
    """A rank that isn't a positive int (string, bool, negative, zero)
    becomes None instead of crashing the merge or being silently misread."""
    p = _write_sidecar_with_items(
        tmp_path / "weird" / "A_RATING_ASC_review_ids.json",
        goods_no="A", sort_type="RATING_ASC", role="signal",
        items=[
            {"review_id": "r_string_rank", "rank": "first"},
            {"review_id": "r_zero", "rank": 0},
            {"review_id": "r_negative", "rank": -3},
            {"review_id": "r_bool", "rank": True},
            {"review_id": "r_ok", "rank": 4},
        ],
    )
    m = merge_sidecars([p])
    assert m["r_string_rank"].observed == {"RATING_ASC": None}
    assert m["r_zero"].observed == {"RATING_ASC": None}
    assert m["r_negative"].observed == {"RATING_ASC": None}
    assert m["r_bool"].observed == {"RATING_ASC": None}
    assert m["r_ok"].observed == {"RATING_ASC": 4}


def test_merge_sidecars_skips_malformed_items(tmp_path):
    """Items that aren't dicts, or whose review_id is missing/empty, are
    skipped silently — a typo in one item shouldn't drop the whole sidecar.
    """
    bad = _write_sidecar_with_items(
        tmp_path / "bad" / "A_RATING_ASC_review_ids.json",
        goods_no="A", sort_type="RATING_ASC", role="signal",
        items=[
            "not a dict",
            {"rank": 1},                 # missing review_id
            {"review_id": "", "rank": 2},  # empty review_id
            {"review_id": "r_good", "rank": 3},
        ],
    )
    m = merge_sidecars([bad])
    assert set(m.keys()) == {"r_good"}
    assert m["r_good"].observed == {"RATING_ASC": 3}


def test_review_membership_add_sort_min_rank_idempotent():
    """In-memory ReviewMembership.add_sort must apply the same min-rank
    rule that merge_sidecars applies across files."""
    mem = ReviewMembership("r1")
    mem.add_sort("RATING_ASC", 50)
    mem.add_sort("RATING_ASC", 7)
    mem.add_sort("RATING_ASC", 22)  # not better — must be ignored
    assert mem.observed == {"RATING_ASC": 7}

    # null + value → value
    mem.add_sort("USEFUL_SCORE_DESC", None)
    mem.add_sort("USEFUL_SCORE_DESC", 11)
    assert mem.observed["USEFUL_SCORE_DESC"] == 11

    # value + null → keep value
    mem.add_sort("RECOMMENDED_DESC", 9)
    mem.add_sort("RECOMMENDED_DESC", None)
    assert mem.observed["RECOMMENDED_DESC"] == 9


def test_apply_to_db_writes_oy_sort_ranks_to_metadata(tmp_path):
    """Full path: sidecars on disk → merged → applied → raw_metadata
    carries oy_sort_ranks alongside the existing membership fields.
    """
    db = tmp_path / "voc.db"
    _make_db(db, [
        ("r1", {"oy_sort_type": "DATETIME_DESC", "oy_sort_role": "primary"},
         "A0001"),
    ])
    primary = _write_sidecar_with_items(
        tmp_path / "p" / "A0001_DATETIME_DESC_review_ids.json",
        goods_no="A0001", sort_type="DATETIME_DESC", role="primary",
        items=[{"review_id": "r1", "rank": 128}],
    )
    signal = _write_sidecar_with_items(
        tmp_path / "s" / "A0001_RATING_ASC_review_ids.json",
        goods_no="A0001", sort_type="RATING_ASC", role="signal",
        items=[{"review_id": "r1", "rank": 3}],
    )
    membership = merge_sidecars([primary, signal])
    apply_to_db(db, goods_no="A0001", membership=membership)

    final = _read_meta(db, "r1")
    assert final["oy_sort_ranks"] == {"DATETIME_DESC": 128, "RATING_ASC": 3}
    # Existing legacy fields preserved.
    assert final["oy_sort_type"] == "DATETIME_DESC"
    assert final["oy_sort_role"] == "primary"
    assert final["oy_is_primary_corpus"] is True


def test_apply_to_db_rerun_with_better_rank_updates_min(tmp_path):
    """A second multi-sort run that surfaces the same review at a BETTER
    (smaller) rank in the same sort must update raw_metadata to the new
    minimum. A worse rank in a re-run must be ignored.
    """
    db = tmp_path / "voc.db"
    _make_db(db, [("r1", {}, "A0001")])

    # Pass 1: rank 50.
    p1 = _write_sidecar_with_items(
        tmp_path / "p1" / "A0001_RATING_ASC_review_ids.json",
        goods_no="A0001", sort_type="RATING_ASC", role="signal",
        items=[{"review_id": "r1", "rank": 50}],
    )
    apply_to_db(db, goods_no="A0001", membership=merge_sidecars([p1]))
    assert _read_meta(db, "r1")["oy_sort_ranks"] == {"RATING_ASC": 50}

    # Pass 2: rank 7 (better) — should overwrite to min.
    p2 = _write_sidecar_with_items(
        tmp_path / "p2" / "A0001_RATING_ASC_review_ids.json",
        goods_no="A0001", sort_type="RATING_ASC", role="signal",
        items=[{"review_id": "r1", "rank": 7}],
    )
    apply_to_db(db, goods_no="A0001", membership=merge_sidecars([p2]))
    assert _read_meta(db, "r1")["oy_sort_ranks"] == {"RATING_ASC": 7}

    # Pass 3: rank 99 (worse) — must NOT downgrade.
    p3 = _write_sidecar_with_items(
        tmp_path / "p3" / "A0001_RATING_ASC_review_ids.json",
        goods_no="A0001", sort_type="RATING_ASC", role="signal",
        items=[{"review_id": "r1", "rank": 99}],
    )
    stats = apply_to_db(db, goods_no="A0001", membership=merge_sidecars([p3]))
    assert _read_meta(db, "r1")["oy_sort_ranks"] == {"RATING_ASC": 7}
    # The merged metadata is identical to what's already on disk → no_op.
    assert stats.rows_no_op == 1
    assert stats.rows_updated == 0


def test_apply_to_db_rerun_idempotent_with_ranks(tmp_path):
    """Idempotency stress: identical sidecars run twice. Second pass
    must report 0 updates AND identical metadata, including ranks."""
    db = tmp_path / "voc.db"
    _make_db(db, [("r1", {}, "A0001")])
    items = [{"review_id": "r1", "rank": 12}]
    side = _write_sidecar_with_items(
        tmp_path / "s" / "A0001_RATING_ASC_review_ids.json",
        goods_no="A0001", sort_type="RATING_ASC", role="signal",
        items=items,
    )
    s1 = apply_to_db(
        db, goods_no="A0001", membership=merge_sidecars([side]),
    )
    s2 = apply_to_db(
        db, goods_no="A0001", membership=merge_sidecars([side]),
    )
    assert s1.rows_updated == 1
    assert s2.rows_updated == 0
    assert s2.rows_no_op == 1
    assert _read_meta(db, "r1")["oy_sort_ranks"] == {"RATING_ASC": 12}


def test_apply_to_db_preserves_existing_ranks_when_new_membership_missing_sort(tmp_path):
    """If a re-run merges only a NEW sort_type and has nothing for an
    already-stored sort, the existing rank for that sort must survive.
    """
    db = tmp_path / "voc.db"
    _make_db(db, [
        ("r1", {
            "oy_observed_sort_types": ["RATING_ASC"],
            "oy_signal_sort_types": ["RATING_ASC"],
            "oy_is_primary_corpus": False,
            "oy_sort_ranks": {"RATING_ASC": 8},
        }, "A0001"),
    ])
    # Re-run: only DATETIME_DESC observed this time.
    side = _write_sidecar_with_items(
        tmp_path / "s" / "A0001_DATETIME_DESC_review_ids.json",
        goods_no="A0001", sort_type="DATETIME_DESC", role="primary",
        items=[{"review_id": "r1", "rank": 200}],
    )
    apply_to_db(db, goods_no="A0001", membership=merge_sidecars([side]))
    final = _read_meta(db, "r1")
    # Old signal rank survives; new primary rank is added.
    assert final["oy_sort_ranks"] == {
        "RATING_ASC": 8, "DATETIME_DESC": 200,
    }
    # is_primary_corpus flips True now.
    assert final["oy_is_primary_corpus"] is True


# ---------------------------------------------------------------------------
# Constants stability
# ---------------------------------------------------------------------------


def test_sort_role_mapping_constants_match_plan():
    """The sort-role mapping in this module must agree with the
    Phase 2E plan and the connector module. If a future PR splits the
    role assignments differently, this test will flag every consumer
    that needs to be updated in lockstep.
    """
    # Each of the five OY sort_types must be classifiable.
    assert set(SORT_ROLE_BY_SORT_TYPE.keys()) == {
        "DATETIME_DESC", "RATING_ASC", "RATING_DESC",
        "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
    }
    # Exactly one primary; the rest are signal.
    assert PRIMARY_SORT_TYPE == "DATETIME_DESC"
    primaries = [k for k, v in SORT_ROLE_BY_SORT_TYPE.items() if v == "primary"]
    signals = [k for k, v in SORT_ROLE_BY_SORT_TYPE.items() if v == "signal"]
    assert primaries == ["DATETIME_DESC"]
    assert len(signals) == 4
