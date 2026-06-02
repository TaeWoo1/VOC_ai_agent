"""Tests for the partial-success disclosure surface in the seller PDF.

Regression test for run-010, where:
  - RATING_ASC and RECOMMENDED_DESC failed during scrape
  - The PDF appendix listed all four signal sorts as evidence pools,
    implying failed sorts had contributed evidence
  - The methodology paragraph did not warn that the negative-review
    pool was under-observed

The fix threads `sorts_attempted / sorts_succeeded / sorts_failed /
partial_success` from the collection_summary sidecar into corpus_metadata
so the PDF can render attempted-vs-succeeded-vs-failed honestly.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]


def _load_pdf_module():
    name = "generate_phase2e_pdf_v2_partial_success_test"
    if name in sys.modules:
        return sys.modules[name]
    path = REPO / "scripts" / "generate_phase2e_pdf_v2.py"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def _corpus_meta_partial_success() -> dict:
    """Mirrors run-010 outcome shape: 3 succeeded, 2 failed."""
    return {
        "collection_started_at": "2026-05-02T00:44:00",
        "collection_completed_at": "2026-05-02T00:52:00",
        "collected_review_count": 200,
        "processed_review_count": 200,
        "polarity_record_count": 105,
        "corpus_limited": False,
        "finite_limit_set": False,
        "max_reviews_arg": "all",
        "sort_mode": "multi",
        "primary_corpus_sort_type": "DATETIME_DESC",
        "signal_sort_types": [
            "RATING_ASC", "RATING_DESC",
            "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
        ],
        "signal_sort_cap": 50,
        "multi_sort_plan": [
            {"sort_type": "DATETIME_DESC", "role": "primary",
             "max_reviews_arg": "all"},
        ],
        "model_name": "stub",
        # Partial-success fields — this is the new contract under test.
        "sorts_attempted": [
            "DATETIME_DESC", "RATING_ASC", "RATING_DESC",
            "USEFUL_SCORE_DESC", "RECOMMENDED_DESC",
        ],
        "sorts_succeeded": [
            "DATETIME_DESC", "RATING_DESC", "USEFUL_SCORE_DESC",
        ],
        "sorts_failed": ["RATING_ASC", "RECOMMENDED_DESC"],
        "sorts_blocked_or_anti_bot": [],
        "partial_success": True,
    }


def _all_table_text(flowables_or_table) -> str:
    """Concat every cell into a single string for substring assertions.

    Accepts the pass-12 list-of-flowables shape (a list of
    KeepTogether-wrapped sub-tables with Paragraph cells) AND the
    legacy single-Table shape (still used by other helpers).
    """
    from reportlab.platypus import KeepTogether, Paragraph, Table

    parts: list[str] = []

    def _walk(node):
        if isinstance(node, Paragraph):
            parts.append(node.text)
        elif isinstance(node, Table):
            for row in node._cellvalues:
                for cell in row:
                    _walk(cell)
        elif isinstance(node, KeepTogether):
            for child in node._content:
                _walk(child)
        elif isinstance(node, list):
            for item in node:
                _walk(item)
        elif isinstance(node, str):
            parts.append(node)
    _walk(flowables_or_table)
    return " ".join(parts)


def test_corpus_metadata_table_renders_attempted_succeeded_failed_rows():
    pdf_v2 = _load_pdf_module()
    meta = _corpus_meta_partial_success()
    tbl = pdf_v2._build_corpus_metadata_table(meta)
    # Pass-12: returns a list of flowables (3 KeepTogether sub-tables);
    # legacy shape was a single Table or None. Both must be non-empty.
    assert tbl  # truthy: non-empty list / non-None Table
    text = _all_table_text(tbl)
    assert "수집 시도 정렬" in text
    assert "수집 성공 정렬" in text
    assert "수집 실패 정렬" in text


def test_corpus_metadata_table_lists_actual_failed_sorts():
    pdf_v2 = _load_pdf_module()
    meta = _corpus_meta_partial_success()
    tbl = pdf_v2._build_corpus_metadata_table(meta)
    text = _all_table_text(tbl)
    # Both failed sort labels surface in the failed row.
    assert "RATING_ASC" in text
    assert "RECOMMENDED_DESC" in text


def test_corpus_metadata_table_warns_on_partial_success():
    pdf_v2 = _load_pdf_module()
    meta = _corpus_meta_partial_success()
    tbl = pdf_v2._build_corpus_metadata_table(meta)
    text = _all_table_text(tbl)
    assert "부분 성공" in text
    assert "실패 정렬 리뷰는 분석에 포함되지 않았습니다" in text


def test_corpus_metadata_table_warns_specifically_on_rating_asc_failure():
    pdf_v2 = _load_pdf_module()
    meta = _corpus_meta_partial_success()
    tbl = pdf_v2._build_corpus_metadata_table(meta)
    text = _all_table_text(tbl)
    # Required wording from the task brief.
    assert "낮은 평점순(RATING_ASC) 수집 실패로 부정 리뷰 신호가" in text
    assert "과소 관측될 수 있습니다" in text


def test_corpus_metadata_table_no_partial_warning_on_full_success():
    pdf_v2 = _load_pdf_module()
    meta = _corpus_meta_partial_success()
    meta["sorts_failed"] = []
    meta["sorts_succeeded"] = list(meta["sorts_attempted"])
    meta["partial_success"] = False
    tbl = pdf_v2._build_corpus_metadata_table(meta)
    text = _all_table_text(tbl)
    assert "부분 성공" not in text
    # The succeeded-sorts row still renders.
    assert "수집 성공 정렬" in text


def test_corpus_metadata_table_legacy_payload_without_outcomes_still_renders():
    """Legacy callers that don't populate sorts_attempted/_succeeded/_failed
    still get a table, just without the new disclosure rows. This keeps
    backward compatibility with old fixtures and pre-fix manifests."""
    pdf_v2 = _load_pdf_module()
    meta = _corpus_meta_partial_success()
    for k in (
        "sorts_attempted", "sorts_succeeded", "sorts_failed",
        "sorts_blocked_or_anti_bot", "partial_success",
    ):
        meta.pop(k, None)
    tbl = pdf_v2._build_corpus_metadata_table(meta)
    text = _all_table_text(tbl)
    assert "수집 성공 정렬" not in text
    assert "수집 실패 정렬" not in text
