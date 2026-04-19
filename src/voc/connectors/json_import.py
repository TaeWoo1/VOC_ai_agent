"""JSON file import connector.

Loads reviews from a JSON file containing an array of review objects.
This is the recommended import format for browser-captured review data
because it preserves metadata better than CSV.

Like CSVConnector, this is an entity-scoped import: the operator produces
a JSON file (manually, via Playwright MCP, or any other capture tool) and
uploads it. The keyword parameter is used as product_keyword metadata for
ChromaDB scoping.

# Data contract

The JSON file must contain an array of objects. Each object supports:

    Required:
        - text (str): review body

    Optional:
        - rating (float|int|null): numeric rating
        - author (str|null): reviewer name
        - date (str|null): review date string (any format — normalizer parses)
        - language (str|null): "ko" or "en"
        - source_id (str|null): unique review ID from source platform
        - source_url (str|null): permalink to original review
        - source_channel (str|null): platform identifier, e.g. "naver", "google_business"
            If omitted, defaults to "csv" (generic import channel).
        - metadata (dict|null): arbitrary source-specific fields preserved verbatim

# Source channel handling

The source_channel field in each review object specifies what platform the
review came from, NOT how it was ingested. An operator capturing Naver reviews
via browser should set source_channel="naver" so that downstream normalization
(domain mapping, rating scale) works correctly.

If source_channel is omitted, it defaults to "csv" — the generic import channel.
The ingestion mechanism (json_import) vs. review origin (source_channel) are
intentionally kept separate.

# Provenance tracking

How the JSON file was produced (browser capture, API export, manual copy) is
NOT recorded in the review data. That information belongs in the source_connection
config (capture_method, platform_hint) — not in individual review objects.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from src.voc.connectors.base import CollectParams
from src.voc.schemas.raw import RawReview

UPLOADS_DIR = Path(__file__).resolve().parents[3] / "uploads"

logger = logging.getLogger(__name__)

# Channels accepted by RawReview.source_channel (Literal type).
# If a review specifies an unrecognized channel, it falls back to "csv".
_VALID_CHANNELS = {"naver", "csv", "mock", "google_business"}

# Default channel for reviews that don't specify source_channel.
_DEFAULT_CHANNEL = "csv"


class JsonImportConnector:
    """Loads reviews from an uploaded JSON file.

    Expected format: a JSON array of objects, each with at least a "text" field.
    See module docstring for the full data contract.
    """

    @property
    def channel_name(self) -> str:
        return "json_import"

    async def collect(
        self, keyword: str, params: CollectParams | None = None
    ) -> list[RawReview]:
        params = params or CollectParams()

        file_path = self._resolve_file(keyword, params)
        if file_path is None:
            logger.warning("No JSON file found for keyword '%s'", keyword)
            return []

        raw_data = self._load_json(file_path)
        if raw_data is None:
            return []

        if not isinstance(raw_data, list):
            logger.error("JSON file '%s' must contain an array at top level", file_path)
            return []

        reviews: list[RawReview] = []
        now = datetime.now()

        for i, entry in enumerate(raw_data):
            if i >= params.max_results:
                break

            if not isinstance(entry, dict):
                logger.warning("Skipping non-object entry at index %d", i)
                continue

            text = _str_or_none(entry.get("text"))
            if not text:
                continue

            # Resolve source_channel: use what the review says if it's a known
            # channel (accepted by the RawReview Literal type), otherwise default.
            declared_channel = _str_or_none(entry.get("source_channel"))
            if declared_channel and declared_channel in _VALID_CHANNELS:
                channel = declared_channel
            else:
                if declared_channel:
                    logger.debug(
                        "Unknown source_channel '%s' at index %d, using '%s'",
                        declared_channel, i, _DEFAULT_CHANNEL,
                    )
                channel = _DEFAULT_CHANNEL

            reviews.append(
                RawReview(
                    source_channel=channel,
                    raw_text=text,
                    raw_rating=entry.get("rating"),
                    raw_author=_str_or_none(entry.get("author")),
                    raw_date=_str_or_none(entry.get("date")),
                    raw_language=_str_or_none(entry.get("language")),
                    raw_metadata=entry.get("metadata") or {},
                    source_id=_str_or_none(entry.get("source_id")),
                    source_url=_str_or_none(entry.get("source_url")),
                    collected_at=now,
                    keyword_used=keyword,
                )
            )

        logger.info("JSON import collected %d reviews from %s", len(reviews), file_path)
        return reviews

    @staticmethod
    def _resolve_file(keyword: str, params: CollectParams) -> Path | None:
        """Find the JSON file to read.

        Priority:
        1. params.language_filter as explicit file path (if it points to a file)
        2. uploads/{keyword}/ directory — most recent .json file
        3. uploads/{keyword}.json
        """
        if params.language_filter and Path(params.language_filter).is_file():
            return Path(params.language_filter)

        keyword_dir = UPLOADS_DIR / keyword
        if keyword_dir.is_dir():
            json_files = sorted(
                keyword_dir.glob("*.json"),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
            if json_files:
                return json_files[0]

        fallback = UPLOADS_DIR / f"{keyword}.json"
        if fallback.is_file():
            return fallback

        return None

    @staticmethod
    def _load_json(file_path: Path) -> Any:
        """Load and parse a JSON file, returning None on failure."""
        try:
            with open(file_path, encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            logger.error("Failed to parse JSON file '%s': %s", file_path, e)
            return None


def _str_or_none(value: Any) -> str | None:
    """Coerce a value to a stripped string, returning None if empty."""
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None
