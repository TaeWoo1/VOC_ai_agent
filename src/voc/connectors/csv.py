"""CSV source import connector.

Unlike keyword-search connectors (mock, naver), CSV is an entity-scoped
source import: the operator uploads a file of reviews for a specific entity.
The keyword parameter maps to product_keyword metadata on the resulting
RawReview objects for ChromaDB scoping compatibility.

# TODO: Future entity-source connector evolution
# The current ChannelConnector protocol is keyword-first (collect(keyword, params)).
# CSV import is conceptually entity-first (import reviews for entity X).
# For Phase 1, we bridge this by using keyword as the product_keyword tag
# and passing the file path via CollectParams.language_filter (repurposed).
# A future ConnectorV2 protocol could accept entity context directly.
"""

from __future__ import annotations

import csv
import logging
from datetime import datetime
from pathlib import Path

from src.voc.connectors.base import CollectParams
from src.voc.schemas.raw import RawReview

UPLOADS_DIR = Path(__file__).resolve().parents[3] / "uploads"

logger = logging.getLogger(__name__)


class CSVConnector:
    """Loads reviews from an uploaded CSV file.

    Expected CSV columns:
        - text (required): review body
        - rating (optional): numeric rating
        - author (optional): reviewer name
        - date (optional): review date string
        - language (optional): "ko" or "en"
        - source_id (optional): unique review ID from source
    """

    @property
    def channel_name(self) -> str:
        return "csv"

    async def collect(
        self, keyword: str, params: CollectParams | None = None
    ) -> list[RawReview]:
        params = params or CollectParams()

        # Resolve file path: check language_filter (repurposed as file path hint),
        # then fall back to uploads/{keyword}.csv
        file_path = self._resolve_file(keyword, params)
        if file_path is None:
            logger.warning("No CSV file found for keyword '%s'", keyword)
            return []

        reviews: list[RawReview] = []
        now = datetime.now()

        with open(file_path, encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)

            if "text" not in (reader.fieldnames or []):
                raise ValueError(f"CSV file '{file_path}' missing required 'text' column")

            for i, row in enumerate(reader):
                if i >= params.max_results:
                    break

                text = row.get("text", "").strip()
                if not text:
                    continue

                reviews.append(
                    RawReview(
                        source_channel="csv",
                        raw_text=text,
                        raw_rating=row.get("rating") or None,
                        raw_author=row.get("author") or None,
                        raw_date=row.get("date") or None,
                        raw_language=row.get("language") or None,
                        raw_metadata={},
                        source_id=row.get("source_id") or None,
                        collected_at=now,
                        keyword_used=keyword,
                    )
                )

        logger.info("CSV collected %d reviews from %s", len(reviews), file_path)
        return reviews

    @staticmethod
    def _resolve_file(keyword: str, params: CollectParams) -> Path | None:
        """Find the CSV file to read.

        Priority:
        1. params.language_filter as explicit file path (if it points to a file)
        2. uploads/{keyword}/ directory — most recent .csv file
        3. uploads/{keyword}.csv
        """
        if params.language_filter and Path(params.language_filter).is_file():
            return Path(params.language_filter)

        keyword_dir = UPLOADS_DIR / keyword
        if keyword_dir.is_dir():
            csv_files = sorted(keyword_dir.glob("*.csv"), key=lambda p: p.stat().st_mtime, reverse=True)
            if csv_files:
                return csv_files[0]

        fallback = UPLOADS_DIR / f"{keyword}.csv"
        if fallback.is_file():
            return fallback

        return None
