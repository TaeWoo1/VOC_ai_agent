"""Tests for Google Business Profile connector."""

from __future__ import annotations

import json
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest

from src.voc.connectors.base import CollectParams
from src.voc.connectors.google_business import GoogleBusinessConnector, _STAR_RATING_MAP


@pytest.fixture
def connector():
    return GoogleBusinessConnector()


def _make_config(**overrides):
    base = {
        "account_id": "accounts/123",
        "location_id": "locations/456",
        "access_token": "ya29.test-token",
    }
    base.update(overrides)
    return base


def _make_params(config=None, max_results=100):
    config = config or _make_config()
    return CollectParams(max_results=max_results, language_filter=json.dumps(config))


def _make_gbp_review(review_id="rev-1", comment="Great place!", star_rating="FIVE", **overrides):
    review = {
        "reviewId": review_id,
        "comment": comment,
        "starRating": star_rating,
        "reviewer": {"displayName": "Test User"},
        "createTime": "2026-01-15T10:30:00Z",
    }
    review.update(overrides)
    return review


# --- Config parsing ---


class TestConfigParsing:
    @pytest.mark.asyncio
    async def test_no_config_returns_empty(self, connector):
        reviews = await connector.collect("test-keyword")
        assert reviews == []

    @pytest.mark.asyncio
    async def test_missing_access_token_returns_empty(self, connector):
        config = _make_config(access_token="")
        params = CollectParams(language_filter=json.dumps(config))
        reviews = await connector.collect("test", params)
        assert reviews == []

    @pytest.mark.asyncio
    async def test_missing_account_id_returns_empty(self, connector):
        config = _make_config(account_id="")
        params = CollectParams(language_filter=json.dumps(config))
        reviews = await connector.collect("test", params)
        assert reviews == []

    @pytest.mark.asyncio
    async def test_invalid_json_returns_empty(self, connector):
        params = CollectParams(language_filter="not-json")
        reviews = await connector.collect("test", params)
        assert reviews == []


# --- Review mapping ---


class TestReviewMapping:
    def test_map_review_basic(self):
        review = _make_gbp_review()
        now = datetime.now()
        result = GoogleBusinessConnector._map_review(review, "키워드", now)
        assert result is not None
        assert result.source_channel == "google_business"
        assert result.raw_text == "Great place!"
        assert result.raw_rating == 5
        assert result.raw_author == "Test User"
        assert result.raw_date == "2026-01-15T10:30:00Z"
        assert result.source_id == "rev-1"
        assert result.keyword_used == "키워드"

    def test_map_review_no_comment_skipped(self):
        review = _make_gbp_review(comment="")
        result = GoogleBusinessConnector._map_review(review, "kw", datetime.now())
        assert result is None

    def test_map_review_all_ratings(self):
        for star_str, expected_int in _STAR_RATING_MAP.items():
            review = _make_gbp_review(star_rating=star_str)
            result = GoogleBusinessConnector._map_review(review, "kw", datetime.now())
            assert result.raw_rating == expected_int

    def test_map_review_preserves_reply(self):
        review = _make_gbp_review()
        review["reviewReply"] = {"comment": "Thank you!", "updateTime": "2026-01-16T00:00:00Z"}
        result = GoogleBusinessConnector._map_review(review, "kw", datetime.now())
        assert result.raw_metadata["reply"]["comment"] == "Thank you!"

    def test_map_review_preserves_update_time(self):
        review = _make_gbp_review()
        review["updateTime"] = "2026-02-01T00:00:00Z"
        result = GoogleBusinessConnector._map_review(review, "kw", datetime.now())
        assert result.raw_metadata["update_time"] == "2026-02-01T00:00:00Z"

    def test_map_review_unknown_rating(self):
        review = _make_gbp_review(star_rating="UNKNOWN")
        result = GoogleBusinessConnector._map_review(review, "kw", datetime.now())
        assert result.raw_rating is None


# --- API fetch (mocked) ---


class TestFetchReviews:
    @pytest.mark.asyncio
    async def test_fetch_single_page(self, connector):
        mock_response = AsyncMock()
        mock_response.status_code = 200
        mock_response.json = lambda: {
            "reviews": [
                _make_gbp_review("r1", "Good"),
                _make_gbp_review("r2", "Bad", "ONE"),
            ],
        }
        mock_response.raise_for_status = lambda: None

        with patch("src.voc.connectors.google_business.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            params = _make_params()
            reviews = await connector.collect("my-store", params)

        assert len(reviews) == 2
        assert reviews[0].source_id == "r1"
        assert reviews[0].raw_rating == 5
        assert reviews[1].raw_rating == 1

    @pytest.mark.asyncio
    async def test_fetch_pagination(self, connector):
        page1_response = AsyncMock()
        page1_response.status_code = 200
        page1_response.json = lambda: {
            "reviews": [_make_gbp_review("r1", "Review 1")],
            "nextPageToken": "page2",
        }
        page1_response.raise_for_status = lambda: None

        page2_response = AsyncMock()
        page2_response.status_code = 200
        page2_response.json = lambda: {
            "reviews": [_make_gbp_review("r2", "Review 2")],
        }
        page2_response.raise_for_status = lambda: None

        with patch("src.voc.connectors.google_business.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get.side_effect = [page1_response, page2_response]
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            params = _make_params()
            reviews = await connector.collect("store", params)

        assert len(reviews) == 2
        assert mock_client.get.call_count == 2

    @pytest.mark.asyncio
    async def test_fetch_respects_max_results(self, connector):
        mock_response = AsyncMock()
        mock_response.status_code = 200
        mock_response.json = lambda: {
            "reviews": [
                _make_gbp_review(f"r{i}", f"Review {i}")
                for i in range(10)
            ],
        }
        mock_response.raise_for_status = lambda: None

        with patch("src.voc.connectors.google_business.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            params = _make_params(max_results=3)
            reviews = await connector.collect("store", params)

        assert len(reviews) == 3

    @pytest.mark.asyncio
    async def test_401_raises_descriptive_error(self, connector):
        mock_response = AsyncMock()
        mock_response.status_code = 401

        with patch("src.voc.connectors.google_business.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_response
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client_cls.return_value = mock_client

            params = _make_params()
            with pytest.raises(ValueError, match="401 Unauthorized"):
                await connector.collect("store", params)


# --- Channel name ---


def test_channel_name(connector):
    assert connector.channel_name == "google_business"
