"""Mock connector — returns fixture data for development and testing."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from src.voc.connectors.base import CollectParams
from src.voc.schemas.raw import RawReview

FIXTURES_DIR = Path(__file__).resolve().parents[3] / "fixtures"


class MockConnector:
    """Loads reviews from local JSON fixture files.

    Fixture files should contain a JSON array of objects matching the
    RawReview schema (minus collected_at, which is set at collection time).
    """

    @property
    def channel_name(self) -> str:
        return "mock"

    async def collect(
        self, keyword: str, params: CollectParams | None = None
    ) -> list[RawReview]:
        params = params or CollectParams()
        reviews: list[RawReview] = []
        now = datetime.now()

        for fixture_path in FIXTURES_DIR.glob("*.json"):
            with open(fixture_path, encoding="utf-8") as f:
                raw_items = json.load(f)

            for item in raw_items[: params.max_results]:
                reviews.append(
                    RawReview(
                        source_channel="mock",
                        raw_text=item.get("text", ""),
                        raw_rating=item.get("rating"),
                        raw_author=item.get("author"),
                        raw_date=item.get("date"),
                        raw_language=item.get("language"),
                        raw_metadata=item.get("metadata", {}),
                        source_id=item.get("source_id"),
                        collected_at=now,
                        keyword_used=keyword,
                    )
                )

        return reviews[: params.max_results]
