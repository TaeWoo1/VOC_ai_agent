"""Tests for the Phase 2E multi-sort plan refactor (2026-04-28).

Coverage:
  1. MULTI_SORT_PLAN shape — exactly one primary (DATETIME_DESC, cap=all)
     followed by four signals (cap=50 each).
  2. PDF corpus-metadata table wording for the primary/signal split.
  3. Connector stamps `oy_sort_role` from the static role mapping.
  4. The corpus-basis invariant: signal-sort rows are excluded from
     `fetch_reviews(...)` when `primary_sort_type` is set, so distribution
     and time-series analysis cannot accidentally consume them.
"""

from __future__ import annotations

import importlib
import importlib.util
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]


# ---------------------------------------------------------------------------
# Module loaders (the scripts/ files are CLIs, not packages — load by path)
# ---------------------------------------------------------------------------

def _load_pipeline_module():
    """Load scripts/run_phase2e_pipeline.py as a module under a stable name.

    Cached on `sys.modules` so repeated calls share the same instance.
    """
    name = "run_phase2e_pipeline_under_test"
    if name in sys.modules:
        return sys.modules[name]
    path = REPO / "scripts" / "run_phase2e_pipeline.py"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _load_pdf_module():
    name = "generate_phase2e_pdf_v2_under_test"
    if name in sys.modules:
        return sys.modules[name]
    path = REPO / "scripts" / "generate_phase2e_pdf_v2.py"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# 1. Plan shape + caps
# ---------------------------------------------------------------------------

def test_plan_has_one_primary_corpus_sort():
    rp = _load_pipeline_module()
    primaries = [e for e in rp.MULTI_SORT_PLAN if e["role"] == "primary"]
    assert len(primaries) == 1
    assert primaries[0]["sort_type"] == "DATETIME_DESC"
    # Primary corpus is intentionally uncapped — full chronological pull.
    assert primaries[0]["cap"] == "all"
    # Module-level constant matches the plan entry.
    assert rp.PRIMARY_CORPUS_SORT_TYPE == "DATETIME_DESC"


def test_plan_has_four_signal_sorts_capped_at_50():
    rp = _load_pipeline_module()
    signals = [e for e in rp.MULTI_SORT_PLAN if e["role"] == "signal"]
    assert len(signals) == 4
    # Cap default is 50 for every signal sort.
    assert {e["cap"] for e in signals} == {50}
    # Sort-types match the documented evidence-pool set.
    assert {e["sort_type"] for e in signals} == {
        "RATING_ASC", "RATING_DESC",
        "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
    }
    # Module-level constants are consistent with the plan body.
    assert rp.SIGNAL_SORT_DEFAULT_CAP == 50
    assert set(rp.SIGNAL_SORT_TYPES) == {e["sort_type"] for e in signals}


def test_plan_primary_runs_before_signals():
    """Primary must execute first so the corpus is in place before
    any anti-bot escalation potentially blocks subsequent signal sorts.
    """
    rp = _load_pipeline_module()
    roles_in_order = [e["role"] for e in rp.MULTI_SORT_PLAN]
    assert roles_in_order[0] == "primary"
    assert all(r == "signal" for r in roles_in_order[1:])


def test_plan_total_signal_request_volume_is_bounded():
    """Sanity check: cutting the cap from 200/300 to 50 reduces the
    signal-sort request surface by at least 4x — that's the entire point
    of the redesign. If this regresses, anti-bot risk grows linearly.
    """
    rp = _load_pipeline_module()
    signal_total = sum(
        int(e["cap"]) for e in rp.MULTI_SORT_PLAN if e["role"] == "signal"
    )
    # 4 signals × 50 = 200; old plan was 4 × ~225 average = ~900.
    assert signal_total == 200


# ---------------------------------------------------------------------------
# 2. PDF metadata wording
# ---------------------------------------------------------------------------

def _multi_sort_meta() -> dict:
    """Synthetic corpus_metadata payload simulating a multi-sort run."""
    return {
        "scrape_skipped": False,
        "collection_started_at": "2026-04-28T12:00:00",
        "collection_completed_at": "2026-04-28T12:30:00",
        "collected_review_count": 825,
        "processed_review_count": 825,
        "polarity_record_count": 4200,
        "corpus_limited": False,
        "finite_limit_set": False,
        "max_reviews_arg": "all",
        "sort_mode": "multi",
        "sort_types_included": [
            "DATETIME_DESC", "RATING_ASC", "RATING_DESC",
            "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
        ],
        "primary_corpus_sort_type": "DATETIME_DESC",
        "signal_sort_types": [
            "RATING_ASC", "RATING_DESC",
            "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
        ],
        "signal_sort_cap": 50,
        "multi_sort_plan": [
            {"sort_type": "DATETIME_DESC", "role": "primary",
             "max_reviews_arg": "all"},
            {"sort_type": "RATING_ASC", "role": "signal",
             "max_reviews_arg": "50"},
        ],
        "model_name": "gpt-4o-mini",
    }


def _extract_rows(flowables) -> list[tuple[str, str]]:
    """Walk the pass-12 corpus-metadata flowables (a list of
    KeepTogether-wrapped sub-tables with Paragraph-wrapped cells)
    and return `[(label_text, value_text), ...]` pairs. Drops the
    table-header rows (where the value cell is the empty string).
    """
    from reportlab.platypus import KeepTogether, Paragraph, Table

    pairs: list[tuple[str, str]] = []
    for f in flowables:
        if isinstance(f, KeepTogether):
            for child in f._content:
                if isinstance(child, Table):
                    for row in child._cellvalues:
                        # Header row: SPAN'd, second cell is "".
                        if row[1] == "" or not isinstance(row[0], Paragraph):
                            continue
                        label = row[0].text
                        value = (
                            row[1].text if isinstance(row[1], Paragraph)
                            else str(row[1])
                        )
                        pairs.append((label, value))
    return pairs


def test_metadata_table_renders_primary_and_signal_rows():
    pdf_v2 = _load_pdf_module()
    rows = _extract_rows(
        pdf_v2._build_corpus_metadata_table(_multi_sort_meta()),
    )
    labels = [r[0] for r in rows]
    assert "주 코퍼스 정렬" in labels
    # Pass-12: legacy "신호 정렬 (증거 풀)" → seller-friendly form.
    assert "대표 리뷰 참고 정렬" in labels
    assert "최종 분석 리뷰 수 (주 코퍼스, 중복 제거 후)" in labels


def test_metadata_table_primary_row_names_datetime_desc():
    pdf_v2 = _load_pdf_module()
    rows = _extract_rows(
        pdf_v2._build_corpus_metadata_table(_multi_sort_meta()),
    )
    primary_row = next(r for r in rows if r[0] == "주 코퍼스 정렬")
    assert "DATETIME_DESC" in primary_row[1]
    assert "최신순" in primary_row[1]
    assert "분포" in primary_row[1] and "시계열" in primary_row[1]
    assert "cap=all" in primary_row[1]


def test_metadata_table_signal_row_names_all_four_signals_with_cap():
    pdf_v2 = _load_pdf_module()
    rows = _extract_rows(
        pdf_v2._build_corpus_metadata_table(_multi_sort_meta()),
    )
    signal_row = next(r for r in rows if r[0] == "대표 리뷰 참고 정렬")
    for st in ("RATING_ASC", "RATING_DESC",
               "USEFUL_SCORE_DESC", "RECOMMENDED_DESC"):
        assert st in signal_row[1]
    assert "top-50" in signal_row[1]
    assert "분포 산정에 미사용" in signal_row[1]


def test_metadata_table_final_count_is_processed_review_count():
    pdf_v2 = _load_pdf_module()
    rows = _extract_rows(
        pdf_v2._build_corpus_metadata_table(_multi_sort_meta()),
    )
    final_row = next(
        r for r in rows
        if r[0] == "최종 분석 리뷰 수 (주 코퍼스, 중복 제거 후)"
    )
    # The synthetic meta sets processed_review_count=825.
    assert "825" in final_row[1]


def test_metadata_table_falls_back_for_legacy_multi_payload():
    """A multi-sort payload missing primary_corpus_sort_type (i.e., from a
    pre-redesign run already on disk) must still render — using the
    legacy single-row 정렬 기준 form. Backward compatibility for any
    cached/serialized older payload.
    """
    pdf_v2 = _load_pdf_module()
    legacy = _multi_sort_meta()
    legacy.pop("primary_corpus_sort_type")
    legacy.pop("signal_sort_types")
    legacy.pop("signal_sort_cap")
    rows = _extract_rows(pdf_v2._build_corpus_metadata_table(legacy))
    labels = [r[0] for r in rows]
    assert "정렬 기준" in labels
    # And the new dual-row form must NOT appear.
    assert "주 코퍼스 정렬" not in labels


# ---------------------------------------------------------------------------
# 3. Connector stamps oy_sort_role from static mapping
# ---------------------------------------------------------------------------

def test_connector_stamps_oy_sort_role_primary_for_datetime_desc():
    from src.voc.connectors.oliveyoung_browser_api import (
        ProfileCodeMapper, _SORT_ROLE_BY_SORT_TYPE, parse_response_body,
    )
    body = {
        "data": {
            "goodsReviewList": [{
                "reviewId": 12345,
                "content": "테스트 리뷰입니다.",
                "createdDateTime": "2026-04-28T12:00:00",
                "reviewScore": 5,
                "goodsDto": {"goodsName": "Test", "goodsNumber": "A0001"},
                "profileDto": {"memberNickname": "user1"},
            }],
            "hasNext": False,
        },
    }
    raws = parse_response_body(
        body,
        code_mapper=ProfileCodeMapper(),
        keyword="t",
        collected_at=datetime.now(),
        sort_type="DATETIME_DESC",
    )
    assert len(raws) == 1
    assert raws[0].raw_metadata["oy_sort_type"] == "DATETIME_DESC"
    assert raws[0].raw_metadata["oy_sort_role"] == "primary"
    assert _SORT_ROLE_BY_SORT_TYPE["DATETIME_DESC"] == "primary"


@pytest.mark.parametrize("st", ["RATING_ASC", "RATING_DESC",
                                "USEFUL_SCORE_DESC", "RECOMMENDED_DESC"])
def test_connector_stamps_oy_sort_role_signal_for_non_chronological(st):
    from src.voc.connectors.oliveyoung_browser_api import (
        ProfileCodeMapper, parse_response_body,
    )
    body = {
        "data": {
            "goodsReviewList": [{
                "reviewId": 99,
                "content": "x",
                "createdDateTime": "2026-04-28T12:00:00",
                "reviewScore": 3,
                "goodsDto": {"goodsName": "Test", "goodsNumber": "A0001"},
                "profileDto": {"memberNickname": "u"},
            }],
            "hasNext": False,
        },
    }
    raws = parse_response_body(
        body,
        code_mapper=ProfileCodeMapper(),
        keyword="t",
        collected_at=datetime.now(),
        sort_type=st,
    )
    assert raws[0].raw_metadata["oy_sort_role"] == "signal"


def test_connector_omits_oy_sort_role_when_sort_type_unset():
    """Default-sort runs (sort_type=None) must NOT stamp oy_sort_role,
    matching the legacy oy_sort_type behavior. Otherwise old report
    consumers that look up the absence of these keys to detect
    legacy-mode rows would break.
    """
    from src.voc.connectors.oliveyoung_browser_api import (
        ProfileCodeMapper, parse_response_body,
    )
    body = {
        "data": {
            "goodsReviewList": [{
                "reviewId": 77,
                "content": "y",
                "createdDateTime": "2026-04-28T12:00:00",
                "reviewScore": 4,
                "goodsDto": {"goodsName": "Test", "goodsNumber": "A0001"},
                "profileDto": {"memberNickname": "u"},
            }],
            "hasNext": False,
        },
    }
    raws = parse_response_body(
        body,
        code_mapper=ProfileCodeMapper(),
        keyword="t",
        collected_at=datetime.now(),
        sort_type=None,
    )
    assert "oy_sort_role" not in raws[0].raw_metadata
    assert "oy_sort_type" not in raws[0].raw_metadata


# ---------------------------------------------------------------------------
# 4. Corpus-basis invariant — signal sorts are NOT corpus
# ---------------------------------------------------------------------------

def _make_temp_db(path: Path) -> None:
    """Create a minimal phase1_reviews schema with a few rows tagged across
    sort types. We only need the columns `fetch_reviews` reads.
    """
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
    rows = [
        # 3 primary-corpus rows
        ("r_dt_1", "primary 1", 5.0, "2026-04-01", "oliveyoung",
         json.dumps({"oy_sort_type": "DATETIME_DESC", "oy_sort_role": "primary"}),
         "A0001"),
        ("r_dt_2", "primary 2", 4.0, "2026-04-02", "oliveyoung",
         json.dumps({"oy_sort_type": "DATETIME_DESC", "oy_sort_role": "primary"}),
         "A0001"),
        ("r_dt_3", "primary 3", 5.0, "2026-04-03", "oliveyoung",
         json.dumps({"oy_sort_type": "DATETIME_DESC", "oy_sort_role": "primary"}),
         "A0001"),
        # 2 signal-only rows (signal sorts surfaced these but DATETIME_DESC didn't)
        ("r_ra_1", "signal evidence 1", 1.0, "2026-04-04", "oliveyoung",
         json.dumps({"oy_sort_type": "RATING_ASC", "oy_sort_role": "signal"}),
         "A0001"),
        ("r_us_1", "signal evidence 2", 2.0, "2026-04-05", "oliveyoung",
         json.dumps({"oy_sort_type": "USEFUL_SCORE_DESC", "oy_sort_role": "signal"}),
         "A0001"),
        # 1 row from a different product — must not leak across goodsNo.
        ("r_other", "other product", 5.0, "2026-04-06", "oliveyoung",
         json.dumps({"oy_sort_type": "DATETIME_DESC", "oy_sort_role": "primary"}),
         "B0002"),
    ]
    con.executemany(
        "INSERT INTO phase1_reviews VALUES (?, ?, ?, ?, ?, ?, ?)",
        rows,
    )
    con.commit()
    con.close()


def test_fetch_reviews_filters_to_primary_when_requested(tmp_path,
                                                         monkeypatch):
    """The corpus-basis invariant: when `primary_sort_type` is set, only
    rows whose oy_sort_type matches are returned. Signal-sort rows must
    NOT appear in the analysis-corpus list.
    """
    rp = _load_pipeline_module()
    db = tmp_path / "voc_data.db"
    _make_temp_db(db)
    monkeypatch.setattr(rp, "DB_PATH", db)

    primary_only = rp.fetch_reviews(
        "A0001", primary_sort_type="DATETIME_DESC",
    )
    assert {r["review_id"] for r in primary_only} == {
        "r_dt_1", "r_dt_2", "r_dt_3",
    }
    # And explicitly: no signal-sort row leaks into the analysis corpus.
    assert all(
        json.loads(r["raw_metadata_json"]).get("oy_sort_role") == "primary"
        for r in primary_only
    )


def test_fetch_reviews_unfiltered_includes_signal_rows(tmp_path, monkeypatch):
    """Without the filter (default / single-sort / skip-scrape mode), all
    rows for the product are returned. Documents the legacy behavior.
    """
    rp = _load_pipeline_module()
    db = tmp_path / "voc_data.db"
    _make_temp_db(db)
    monkeypatch.setattr(rp, "DB_PATH", db)

    everyone = rp.fetch_reviews("A0001")
    rids = {r["review_id"] for r in everyone}
    assert rids == {"r_dt_1", "r_dt_2", "r_dt_3", "r_ra_1", "r_us_1"}


def test_fetch_reviews_falls_back_when_no_primary_tagged_rows(
    tmp_path, monkeypatch, capsys,
):
    """Legacy DBs (rows pre-date oy_sort_type stamping) should not be
    silently filtered into emptiness. The filter falls back to the
    unfiltered query and logs a warning so the operator notices.
    """
    rp = _load_pipeline_module()
    db = tmp_path / "voc_data.db"
    con = sqlite3.connect(str(db))
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
    # Legacy row: no oy_sort_type tag at all.
    con.execute(
        "INSERT INTO phase1_reviews VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("legacy_1", "legacy", 5.0, "2025-01-01", "oliveyoung",
         json.dumps({}), "A0001"),
    )
    con.commit()
    con.close()
    monkeypatch.setattr(rp, "DB_PATH", db)

    rows = rp.fetch_reviews("A0001", primary_sort_type="DATETIME_DESC")
    assert {r["review_id"] for r in rows} == {"legacy_1"}
    out = capsys.readouterr().out
    assert "falling back to unfiltered fetch" in out
