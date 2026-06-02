"""Tests for the script-level breadcrumb helpers in
`scripts/run_phase2e_pipeline.py`. Loaded via importlib because the
script lives outside the package tree.

Covers:
  - `derive_breadcrumb` normalization on legacy raw_metadata rows
    that carry duplicates / newline contamination / pre-old shapes.
  - End-to-end behavior of `--category-mode {leaf, full_path}`
    against a synthetic reviews list.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


REPO = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def rpp():
    """Import scripts/run_phase2e_pipeline.py as a module."""
    sys.path.insert(0, str(REPO))
    spec = importlib.util.spec_from_file_location(
        "rpp", REPO / "scripts" / "run_phase2e_pipeline.py",
    )
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _row(md: dict) -> dict:
    return {"raw_metadata_json": json.dumps(md, ensure_ascii=False)}


# ---------------------------------------------------------------------------
# derive_breadcrumb
# ---------------------------------------------------------------------------


class TestDeriveBreadcrumb:
    def test_no_rows_returns_none(self, rpp):
        assert rpp.derive_breadcrumb([]) is None

    def test_rows_without_breadcrumb_returns_none(self, rpp):
        rows = [_row({"oy_review_id": "r1"})]
        assert rpp.derive_breadcrumb(rows) is None

    def test_clean_path_passes_through(self, rpp):
        rows = [_row({
            "oy_breadcrumb_ko": "뷰티 > 스킨케어 > 토너패드",
            "oy_category_path": ["뷰티", "스킨케어", "토너패드"],
            "oy_category_leaf_ko": "토너패드",
            "oy_breadcrumb_source": "dom:nav.breadcrumb",
        })]
        bc = rpp.derive_breadcrumb(rows)
        assert bc is not None
        assert bc["path"] == ["뷰티", "스킨케어", "토너패드"]
        assert bc["leaf_ko"] == "토너패드"
        assert bc["ko"] == "뷰티 > 스킨케어 > 토너패드"
        assert bc["source"] == "dom:nav.breadcrumb"

    def test_dedupes_legacy_duplicate_path(self, rpp):
        # Bug report shape: duplicate "패드" in path. The derivation
        # MUST clean it even if the legacy `oy_breadcrumb_ko` /
        # `oy_category_leaf_ko` fields were written with junk.
        rows = [_row({
            "oy_breadcrumb_ko": "마스크팩\n패드\n패드",
            "oy_category_path": ["마스크팩", "패드", "패드"],
            "oy_category_leaf_ko": "패드",
            "oy_breadcrumb_source": "dom:legacy",
        })]
        bc = rpp.derive_breadcrumb(rows)
        assert bc is not None
        assert bc["path"] == ["마스크팩", "패드"]
        assert bc["leaf_ko"] == "패드"
        assert bc["ko"] == "마스크팩 > 패드"
        # Re-derived `ko` strips newlines.
        assert "\n" not in bc["ko"]

    def test_falls_back_to_breadcrumb_ko_when_path_missing(self, rpp):
        # Very old rows wrote only `oy_breadcrumb_ko`. The script
        # must still recover a path via the parser.
        rows = [_row({
            "oy_breadcrumb_ko": "뷰티\n스킨케어\n패드",
        })]
        bc = rpp.derive_breadcrumb(rows)
        assert bc is not None
        assert bc["path"] == ["뷰티", "스킨케어", "패드"]
        assert bc["leaf_ko"] == "패드"
        assert bc["ko"] == "뷰티 > 스킨케어 > 패드"
        assert bc["source"] == "raw_metadata"

    def test_first_row_with_data_wins(self, rpp):
        rows = [
            _row({"oy_review_id": "noise"}),
            _row({
                "oy_category_path": ["뷰티", "스킨케어", "패드"],
            }),
        ]
        bc = rpp.derive_breadcrumb(rows)
        assert bc is not None
        assert bc["leaf_ko"] == "패드"

    def test_strips_whitespace_in_path_nodes(self, rpp):
        rows = [_row({
            "oy_category_path": ["  뷰티 ", "스킨케어", " 패드 "],
        })]
        bc = rpp.derive_breadcrumb(rows)
        assert bc is not None
        assert bc["path"] == ["뷰티", "스킨케어", "패드"]
        assert bc["ko"] == "뷰티 > 스킨케어 > 패드"

    def test_invalid_json_skipped_gracefully(self, rpp):
        rows = [
            {"raw_metadata_json": "{not valid"},
            _row({"oy_category_path": ["뷰티", "패드"]}),
        ]
        bc = rpp.derive_breadcrumb(rows)
        assert bc is not None
        assert bc["leaf_ko"] == "패드"

    def test_non_string_entries_in_path_dropped(self, rpp):
        rows = [_row({
            "oy_category_path": ["뷰티", 42, None, "패드"],  # legacy junk
        })]
        bc = rpp.derive_breadcrumb(rows)
        assert bc is not None
        assert bc["path"] == ["뷰티", "패드"]
