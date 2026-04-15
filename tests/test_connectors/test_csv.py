"""Tests for the CSV source import connector."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from src.voc.connectors.base import CollectParams
from src.voc.connectors.csv import CSVConnector


@pytest.fixture
def connector():
    return CSVConnector()


@pytest.fixture
def csv_file():
    """Create a temporary CSV file and return its path."""
    def _make(content: str, filename: str = "test.csv") -> Path:
        d = Path(tempfile.mkdtemp())
        p = d / filename
        p.write_text(content, encoding="utf-8")
        return p
    return _make


@pytest.mark.asyncio
async def test_collect_basic(connector, csv_file):
    path = csv_file("text,rating,author\n좋은 제품입니다,5,user1\n별로예요,2,user2\n")
    params = CollectParams(language_filter=str(path))
    reviews = await connector.collect("에어팟", params)
    assert len(reviews) == 2
    assert reviews[0].raw_text == "좋은 제품입니다"
    assert reviews[0].source_channel == "csv"
    assert reviews[0].keyword_used == "에어팟"
    assert reviews[1].raw_rating == 2.0


@pytest.mark.asyncio
async def test_collect_text_only(connector, csv_file):
    path = csv_file("text\nreview one\nreview two\nreview three\n")
    params = CollectParams(language_filter=str(path))
    reviews = await connector.collect("product", params)
    assert len(reviews) == 3
    assert all(r.raw_rating is None for r in reviews)


@pytest.mark.asyncio
async def test_missing_text_column(connector, csv_file):
    path = csv_file("rating,author\n5,user1\n")
    params = CollectParams(language_filter=str(path))
    with pytest.raises(ValueError, match="missing required 'text' column"):
        await connector.collect("product", params)


@pytest.mark.asyncio
async def test_empty_text_rows_skipped(connector, csv_file):
    path = csv_file("text\ngood product\n\n  \nanother review\n")
    params = CollectParams(language_filter=str(path))
    reviews = await connector.collect("product", params)
    assert len(reviews) == 2


@pytest.mark.asyncio
async def test_max_results(connector, csv_file):
    rows = "text\n" + "\n".join(f"review {i}" for i in range(20)) + "\n"
    path = csv_file(rows)
    params = CollectParams(max_results=5, language_filter=str(path))
    reviews = await connector.collect("product", params)
    assert len(reviews) == 5


@pytest.mark.asyncio
async def test_optional_columns(connector, csv_file):
    path = csv_file("text,rating,author,date,language,source_id\n테스트,4.5,작성자,2026-01-01,ko,src-001\n")
    params = CollectParams(language_filter=str(path))
    reviews = await connector.collect("product", params)
    assert len(reviews) == 1
    r = reviews[0]
    assert r.raw_rating == 4.5
    assert r.raw_author == "작성자"
    assert r.raw_date == "2026-01-01"
    assert r.raw_language == "ko"
    assert r.source_id == "src-001"


@pytest.mark.asyncio
async def test_no_file_returns_empty(connector):
    params = CollectParams(language_filter="/nonexistent/path.csv")
    reviews = await connector.collect("product", params)
    assert reviews == []


@pytest.mark.asyncio
async def test_channel_name(connector):
    assert connector.channel_name == "csv"
