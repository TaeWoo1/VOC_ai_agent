"""Tests for the JSON file import connector."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from src.voc.connectors.base import CollectParams
from src.voc.connectors.json_import import JsonImportConnector


@pytest.fixture
def connector():
    return JsonImportConnector()


@pytest.fixture
def json_file():
    """Create a temporary JSON file and return its path."""
    def _make(data, filename: str = "reviews.json") -> Path:
        d = Path(tempfile.mkdtemp())
        p = d / filename
        p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return p
    return _make


# --- Basic collection ---


@pytest.mark.asyncio
async def test_collect_basic(connector, json_file):
    data = [
        {"text": "좋은 제품입니다", "rating": 5, "author": "user1"},
        {"text": "별로예요", "rating": 2, "author": "user2"},
    ]
    path = json_file(data)
    params = CollectParams(language_filter=str(path))
    reviews = await connector.collect("에어팟", params)
    assert len(reviews) == 2
    assert reviews[0].raw_text == "좋은 제품입니다"
    assert reviews[0].raw_rating == 5
    assert reviews[0].keyword_used == "에어팟"
    assert reviews[1].raw_text == "별로예요"
    assert reviews[1].raw_rating == 2


@pytest.mark.asyncio
async def test_collect_text_only(connector, json_file):
    data = [{"text": "review one"}, {"text": "review two"}, {"text": "review three"}]
    path = json_file(data)
    params = CollectParams(language_filter=str(path))
    reviews = await connector.collect("product", params)
    assert len(reviews) == 3
    assert all(r.raw_rating is None for r in reviews)
    assert all(r.raw_author is None for r in reviews)


# --- Source channel handling ---


@pytest.mark.asyncio
async def test_default_source_channel(connector, json_file):
    """Reviews without source_channel default to 'csv'."""
    data = [{"text": "no channel specified"}]
    path = json_file(data)
    params = CollectParams(language_filter=str(path))
    reviews = await connector.collect("product", params)
    assert reviews[0].source_channel == "csv"


@pytest.mark.asyncio
async def test_known_source_channel_preserved(connector, json_file):
    """Reviews with a known source_channel keep it."""
    data = [
        {"text": "naver review", "source_channel": "naver"},
        {"text": "google review", "source_channel": "google_business"},
    ]
    path = json_file(data)
    params = CollectParams(language_filter=str(path))
    reviews = await connector.collect("product", params)
    assert reviews[0].source_channel == "naver"
    assert reviews[1].source_channel == "google_business"


@pytest.mark.asyncio
async def test_unknown_source_channel_falls_back(connector, json_file):
    """Reviews with an unknown source_channel fall back to 'csv'."""
    data = [{"text": "coupang review", "source_channel": "coupang"}]
    path = json_file(data)
    params = CollectParams(language_filter=str(path))
    reviews = await connector.collect("product", params)
    assert reviews[0].source_channel == "csv"


# --- Optional fields ---


@pytest.mark.asyncio
async def test_all_optional_fields(connector, json_file):
    data = [{
        "text": "테스트 리뷰",
        "rating": 4.5,
        "author": "작성자",
        "date": "2026-04-10",
        "language": "ko",
        "source_id": "nv-12345",
        "source_url": "https://example.com/review/12345",
        "source_channel": "naver",
        "metadata": {"helpful_count": 3, "purchase_verified": True},
    }]
    path = json_file(data)
    params = CollectParams(language_filter=str(path))
    reviews = await connector.collect("product", params)
    assert len(reviews) == 1
    r = reviews[0]
    assert r.raw_rating == 4.5
    assert r.raw_author == "작성자"
    assert r.raw_date == "2026-04-10"
    assert r.raw_language == "ko"
    assert r.source_id == "nv-12345"
    assert r.source_url == "https://example.com/review/12345"
    assert r.source_channel == "naver"
    assert r.raw_metadata == {"helpful_count": 3, "purchase_verified": True}


# --- Edge cases ---


@pytest.mark.asyncio
async def test_empty_text_skipped(connector, json_file):
    data = [
        {"text": "good"},
        {"text": ""},
        {"text": "   "},
        {"text": "also good"},
    ]
    path = json_file(data)
    params = CollectParams(language_filter=str(path))
    reviews = await connector.collect("product", params)
    assert len(reviews) == 2


@pytest.mark.asyncio
async def test_missing_text_skipped(connector, json_file):
    data = [
        {"text": "has text"},
        {"rating": 5, "author": "no text here"},
    ]
    path = json_file(data)
    params = CollectParams(language_filter=str(path))
    reviews = await connector.collect("product", params)
    assert len(reviews) == 1


@pytest.mark.asyncio
async def test_non_object_entries_skipped(connector, json_file):
    data = [
        {"text": "valid"},
        "just a string",
        42,
        {"text": "also valid"},
    ]
    path = json_file(data)
    params = CollectParams(language_filter=str(path))
    reviews = await connector.collect("product", params)
    assert len(reviews) == 2


@pytest.mark.asyncio
async def test_max_results(connector, json_file):
    data = [{"text": f"review {i}"} for i in range(20)]
    path = json_file(data)
    params = CollectParams(max_results=5, language_filter=str(path))
    reviews = await connector.collect("product", params)
    assert len(reviews) == 5


@pytest.mark.asyncio
async def test_no_file_returns_empty(connector):
    params = CollectParams(language_filter="/nonexistent/path.json")
    reviews = await connector.collect("product", params)
    assert reviews == []


@pytest.mark.asyncio
async def test_invalid_json_returns_empty(connector):
    d = Path(tempfile.mkdtemp())
    p = d / "bad.json"
    p.write_text("not valid json {{{", encoding="utf-8")
    params = CollectParams(language_filter=str(p))
    reviews = await connector.collect("product", params)
    assert reviews == []


@pytest.mark.asyncio
async def test_non_array_json_returns_empty(connector):
    d = Path(tempfile.mkdtemp())
    p = d / "object.json"
    p.write_text('{"reviews": []}', encoding="utf-8")
    params = CollectParams(language_filter=str(p))
    reviews = await connector.collect("product", params)
    assert reviews == []


@pytest.mark.asyncio
async def test_channel_name(connector):
    assert connector.channel_name == "json_import"
