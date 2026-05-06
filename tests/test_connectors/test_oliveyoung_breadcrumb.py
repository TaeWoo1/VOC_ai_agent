"""Tests for OliveYoung breadcrumb / category capture.

Two layers:
  1. `parse_breadcrumb_text` — pure function, just regex.
  2. Connector-level stamping — uses a FakeBrowserReviewSession
     subclass that exposes `get_observed_breadcrumb()` so we can
     verify the connector stamps every parsed RawReview's
     raw_metadata.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from src.voc.connectors.base import CollectParams
from src.voc.connectors.oliveyoung_browser_api import (
    OliveYoungBrowserAPIConnector,
    ProfileCodeMapper,
    normalize_breadcrumb_path,
    parse_breadcrumb_text,
)
from tests.test_connectors.test_oliveyoung_browser_api_runtime import (
    FakeBrowserReviewSession,
    PRODUCT_URL,
)


FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "oliveyoung_api"
PAGE1_PATH = FIXTURE_DIR / "goods_review_list_page1.json"
PAGE2_PATH = FIXTURE_DIR / "goods_review_list_page2.json"


@pytest.fixture
def page1_body() -> dict:
    return json.loads(PAGE1_PATH.read_text(encoding="utf-8"))


@pytest.fixture
def page2_body() -> dict:
    return json.loads(PAGE2_PATH.read_text(encoding="utf-8"))


@pytest.fixture
def page2_last(page2_body) -> dict:
    out = copy.deepcopy(page2_body)
    out["data"]["hasNext"] = False
    return out


# ---------------------------------------------------------------------------
# parse_breadcrumb_text — pure parser
# ---------------------------------------------------------------------------


class TestParseBreadcrumbText:
    def test_none_returns_empty_list(self):
        assert parse_breadcrumb_text(None) == []

    def test_empty_string_returns_empty_list(self):
        assert parse_breadcrumb_text("") == []

    def test_whitespace_only_returns_empty_list(self):
        assert parse_breadcrumb_text("   ") == []

    def test_simple_gt_separator(self):
        assert parse_breadcrumb_text("뷰티 > 스킨케어 > 토너패드") == [
            "뷰티", "스킨케어", "토너패드",
        ]

    def test_slash_separator(self):
        assert parse_breadcrumb_text("뷰티 / 스킨케어 / 토너패드") == [
            "뷰티", "스킨케어", "토너패드",
        ]

    def test_extra_whitespace_collapsed(self):
        assert parse_breadcrumb_text("  뷰티  >   스킨케어  >  토너패드  ") == [
            "뷰티", "스킨케어", "토너패드",
        ]

    def test_single_node_no_separator(self):
        assert parse_breadcrumb_text("토너패드") == ["토너패드"]

    def test_empty_nodes_dropped(self):
        # Trailing/leading separator should not produce empty tokens.
        assert parse_breadcrumb_text("> 뷰티 > 스킨케어 >") == ["뷰티", "스킨케어"]

    def test_newline_separator_split(self):
        # OY layouts that render breadcrumb anchors stacked vertically
        # produce inner_text joined by newlines.
        assert parse_breadcrumb_text("뷰티\n스킨케어\n토너패드") == [
            "뷰티", "스킨케어", "토너패드",
        ]

    def test_pipe_separator_split(self):
        assert parse_breadcrumb_text("뷰티 | 스킨케어 | 패드") == [
            "뷰티", "스킨케어", "패드",
        ]

    def test_mixed_newline_and_gt_split(self):
        assert parse_breadcrumb_text("뷰티 >\n스킨케어\n> 토너패드") == [
            "뷰티", "스킨케어", "토너패드",
        ]

    def test_dedupes_preserving_order(self):
        # Exact case from the bug report.
        assert parse_breadcrumb_text("마스크팩\n패드\n패드") == ["마스크팩", "패드"]

    def test_dedupes_with_separator_variety(self):
        assert parse_breadcrumb_text("뷰티 > 뷰티 / 스킨케어\n스킨케어") == [
            "뷰티", "스킨케어",
        ]

    def test_preserves_node_with_internal_space(self):
        # Hypothetical multi-word category name. Internal space stays.
        assert parse_breadcrumb_text("뷰티 > 색조 메이크업 > 블러셔") == [
            "뷰티", "색조 메이크업", "블러셔",
        ]


class TestNormalizeBreadcrumbPath:
    def test_none_returns_empty_list(self):
        assert normalize_breadcrumb_path(None) == []

    def test_empty_list_returns_empty_list(self):
        assert normalize_breadcrumb_path([]) == []

    def test_strips_each_node(self):
        assert normalize_breadcrumb_path(["  뷰티  ", "스킨케어 "]) == [
            "뷰티", "스킨케어",
        ]

    def test_drops_empty_and_whitespace_only(self):
        assert normalize_breadcrumb_path(["", "  ", "패드"]) == ["패드"]

    def test_dedupes_preserving_first_occurrence(self):
        assert normalize_breadcrumb_path(
            ["마스크팩", "패드", "패드"],
        ) == ["마스크팩", "패드"]

    def test_dedupes_after_strip(self):
        # Whitespace-different duplicates are still duplicates.
        assert normalize_breadcrumb_path(
            ["패드", " 패드 ", "패드"],
        ) == ["패드"]

    def test_ignores_non_string_entries(self):
        # Defensive: malformed legacy data shouldn't raise.
        assert normalize_breadcrumb_path(
            ["뷰티", 42, None, "패드"],  # type: ignore[list-item]
        ) == ["뷰티", "패드"]

    def test_tuple_input_accepted(self):
        assert normalize_breadcrumb_path(
            ("뷰티", "스킨케어", "패드"),
        ) == ["뷰티", "스킨케어", "패드"]


class TestExactBugReportCase:
    """The category output `"마스크팩\\n패드\\n패드"` must normalize
    cleanly through the full chain: parse → leaf=`패드`,
    full_path=`마스크팩 > 패드`."""

    def test_parser_produces_clean_path(self):
        path = parse_breadcrumb_text("마스크팩\n패드\n패드")
        assert path == ["마스크팩", "패드"]
        # Leaf: just the last node.
        assert path[-1] == "패드"
        # Full path: " > "-joined.
        assert " > ".join(path) == "마스크팩 > 패드"

    def test_list_with_internal_newlines_is_decomposed(self):
        # Run-003 live retry surfaced this exact form in DB rows:
        # `oy_category_path = ["마스크팩\n패드\n패드"]` — the
        # connector wrote the raw DOM string into a single-element
        # list. Per-element strip is not enough; the normalizer must
        # split internal separators.
        assert normalize_breadcrumb_path(["마스크팩\n패드\n패드"]) == [
            "마스크팩", "패드",
        ]

    def test_list_with_internal_separators_is_decomposed(self):
        # General case: a single element carrying internal "/"" or
        # ">" separators is still atomic-split.
        assert normalize_breadcrumb_path(["뷰티 > 스킨케어", "토너패드"]) == [
            "뷰티", "스킨케어", "토너패드",
        ]

    def test_full_path_render_dedupes_trailing_repeat(self):
        # category_mode=full_path output must collapse the ["X","Y","Y"]
        # into "X > Y" (no trailing duplicate).
        path = normalize_breadcrumb_path(["마스크팩\n패드\n패드"])
        assert " > ".join(path) == "마스크팩 > 패드"

    def test_leaf_render_returns_only_last_node(self):
        # category_mode=leaf output for the same DB form must be the
        # leaf only — never the duplicate, never the full path.
        path = normalize_breadcrumb_path(["마스크팩\n패드\n패드"])
        assert path[-1] == "패드"

    def test_full_path_preserves_non_duplicate_ordering(self):
        # A clean three-node breadcrumb passes through unchanged.
        path = normalize_breadcrumb_path(["스킨케어", "마스크팩", "패드"])
        assert path == ["스킨케어", "마스크팩", "패드"]
        assert " > ".join(path) == "스킨케어 > 마스크팩 > 패드"


# ---------------------------------------------------------------------------
# Connector-level: per-row raw_metadata stamping
# ---------------------------------------------------------------------------


class FakeBrowserReviewSessionWithBreadcrumb(FakeBrowserReviewSession):
    """Adds the `get_observed_breadcrumb` accessor that the real
    Playwright session implements. None means the DOM scan didn't
    match (legacy / blocked / different layout)."""

    def __init__(self, *args, breadcrumb: dict | None = None, **kwargs):
        super().__init__(*args, **kwargs)
        self._breadcrumb = breadcrumb

    def get_observed_breadcrumb(self) -> dict | None:
        return self._breadcrumb


def _build_connector(session, *, max_results: int = 100):
    return (
        OliveYoungBrowserAPIConnector(
            product_url=PRODUCT_URL,
            code_mapper=ProfileCodeMapper(),
            session_factory=lambda: session,
        ),
        CollectParams(max_results=max_results),
    )


@pytest.mark.asyncio
async def test_breadcrumb_stamped_onto_every_row(page1_body, page2_last):
    breadcrumb = {
        "ko": "뷰티 > 스킨케어 > 토너패드",
        "path": ["뷰티", "스킨케어", "토너패드"],
        "leaf_ko": "토너패드",
        "source": "dom:nav.breadcrumb",
    }
    session = FakeBrowserReviewSessionWithBreadcrumb(
        responses=[(200, page1_body), (200, page2_last)],
        breadcrumb=breadcrumb,
    )
    connector, params = _build_connector(session)
    raws = await connector.collect(keyword="x", params=params)

    assert len(raws) > 0, "expected ≥1 parsed review row"
    for r in raws:
        assert r.raw_metadata.get("oy_breadcrumb_ko") == breadcrumb["ko"]
        assert r.raw_metadata.get("oy_category_path") == breadcrumb["path"]
        assert r.raw_metadata.get("oy_category_leaf_ko") == breadcrumb["leaf_ko"]
        assert r.raw_metadata.get("oy_breadcrumb_source") == breadcrumb["source"]


@pytest.mark.asyncio
async def test_no_breadcrumb_means_no_stamp(page1_body, page2_last):
    """When the session reports no breadcrumb, raw_metadata MUST NOT
    carry empty placeholder fields — keys are simply absent."""
    session = FakeBrowserReviewSessionWithBreadcrumb(
        responses=[(200, page1_body), (200, page2_last)],
        breadcrumb=None,
    )
    connector, params = _build_connector(session)
    raws = await connector.collect(keyword="x", params=params)

    assert len(raws) > 0
    for r in raws:
        assert "oy_breadcrumb_ko" not in r.raw_metadata
        assert "oy_category_path" not in r.raw_metadata
        assert "oy_category_leaf_ko" not in r.raw_metadata
        assert "oy_breadcrumb_source" not in r.raw_metadata


@pytest.mark.asyncio
async def test_session_without_breadcrumb_accessor_is_safe(page1_body, page2_last):
    """Test fakes that pre-date this feature don't implement
    `get_observed_breadcrumb`. The connector must degrade silently
    rather than AttributeError."""
    session = FakeBrowserReviewSession(
        responses=[(200, page1_body), (200, page2_last)],
    )
    connector, params = _build_connector(session)
    raws = await connector.collect(keyword="x", params=params)

    assert len(raws) > 0
    # No crash. No breadcrumb fields.
    for r in raws:
        assert "oy_breadcrumb_ko" not in r.raw_metadata


@pytest.mark.asyncio
async def test_breadcrumb_with_empty_path_ignored(page1_body, page2_last):
    """A breadcrumb dict with empty path is treated like no
    breadcrumb (defensive — DOM might match the wrapper but find no
    nodes inside)."""
    session = FakeBrowserReviewSessionWithBreadcrumb(
        responses=[(200, page1_body), (200, page2_last)],
        breadcrumb={"ko": "", "path": [], "leaf_ko": None, "source": "dom:..."},
    )
    connector, params = _build_connector(session)
    raws = await connector.collect(keyword="x", params=params)
    assert len(raws) > 0
    for r in raws:
        assert "oy_breadcrumb_ko" not in r.raw_metadata
        assert "oy_category_path" not in r.raw_metadata
