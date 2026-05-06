"""OliveYoung CSV-replay connector — Phase 1 ingestion path.

Decision 3 (live scrape transport: Playwright vs requests vs Apify) is NOT
locked at the time PR4 ships, so the OY connector here is implemented as a
**CSV-replay** mirroring the Coupang pattern. Manual capture into a small CSV
file (or programmatic capture by a future scraper) feeds the same downstream
pipeline (normalize → enrich → persist).

When Decision 3 lands, a live `OliveYoungScrapeConnector` can be added under
the same `ChannelConnector` Protocol; nothing downstream changes. Tests for
the live `blocked` / `auth_error` paths are covered today by
`tests/test_app/test_phase1_pipeline.py` (FakeConnector with arbitrary summary).

CSV columns expected (header row required):
  product_id, product_name, product_url,
  review_id, review_url, review_author,
  review_date (ISO YYYY-MM-DD), review_rating (1-5 int), review_content,
  skin_type, age_group, product_option_raw

Required for a row to parse: product_id, review_id, review_content, review_rating.

raw_metadata population:
  - skin_type, age_group, product_option_raw  (promoted to OliveYoungMeta)
  - product_external_id                       (promoted to phase1_reviews row column)
  - product_name, product_url, review_url     (stay in raw_metadata)

last_run_summary: PR1-minimum counters. CSV cannot be blocked or auth-rejected,
so quality_status is OK barring catastrophic file errors.
"""

from __future__ import annotations

import csv
import logging
import uuid
from datetime import datetime
from pathlib import Path

from src.voc.app.connector_run_summary import ConnectorRunSummary
from src.voc.connectors.base import CollectParams
from src.voc.schemas.raw import RawReview

logger = logging.getLogger(__name__)

OLIVEYOUNG_PROMOTED_KEYS: set[str] = {
    "skin_type",
    "age_group",
    "product_option_raw",
}

_REQUIRED_COLUMNS: set[str] = {
    "product_id",
    "review_id",
    "review_content",
    "review_rating",
}


class OliveYoungCSVConnector:
    """Replays a manually-captured OliveYoung reviews CSV (Phase 1 transport)."""

    def __init__(self, csv_path: str | Path | None = None):
        self._csv_path = Path(csv_path) if csv_path else None
        self.last_run_summary: ConnectorRunSummary | None = None

    @property
    def channel_name(self) -> str:
        return "oliveyoung"

    async def collect(
        self, keyword: str, params: CollectParams | None = None
    ) -> list[RawReview]:
        params = params or CollectParams()
        path = self._resolve_path(params)
        run_id = f"oliveyoung_csv_{uuid.uuid4().hex[:12]}"
        started = datetime.now()

        if path is None or not path.is_file():
            logger.warning("OliveYoung CSV not found (path=%s)", path)
            self.last_run_summary = ConnectorRunSummary(
                run_id=run_id,
                channel="oliveyoung",
                requested_target=str(path or ""),
                started_at=started,
                finished_at=datetime.now(),
            )
            return []

        raw_seen = 0
        parsed: list[RawReview] = []
        dropped_short_text = 0
        parse_warnings = 0
        sample_dropped: list[str] = []

        with open(path, encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            missing = _REQUIRED_COLUMNS - set(reader.fieldnames or [])
            if missing:
                raise ValueError(
                    f"OliveYoung CSV missing required columns: {sorted(missing)}"
                )

            for raw_row in reader:
                if len(parsed) >= params.max_results:
                    break
                raw_seen += 1

                content = (raw_row.get("review_content") or "").strip()
                if not content:
                    dropped_short_text += 1
                    if len(sample_dropped) < 5:
                        sample_dropped.append("empty review_content")
                    continue

                product_id = (raw_row.get("product_id") or "").strip() or None
                review_id = (raw_row.get("review_id") or "").strip() or None
                if product_id is None or review_id is None:
                    dropped_short_text += 1
                    if len(sample_dropped) < 5:
                        sample_dropped.append("missing product_id or review_id")
                    continue

                stars = _parse_int(raw_row.get("review_rating"))
                if stars is None:
                    parse_warnings += 1
                    if len(sample_dropped) < 5:
                        sample_dropped.append(
                            f"unparseable review_rating: {raw_row.get('review_rating')!r}"
                        )

                date_iso = _parse_iso_date(raw_row.get("review_date"))
                if date_iso is None and (raw_row.get("review_date") or "").strip():
                    parse_warnings += 1
                    if len(sample_dropped) < 5:
                        sample_dropped.append(
                            f"unparseable review_date: {raw_row.get('review_date')!r}"
                        )

                raw_metadata = {
                    "skin_type": (raw_row.get("skin_type") or "").strip() or None,
                    "age_group": (raw_row.get("age_group") or "").strip() or None,
                    "product_option_raw":
                        (raw_row.get("product_option_raw") or "").strip() or None,
                    "product_external_id": product_id,
                    "product_name": (raw_row.get("product_name") or "").strip() or None,
                    "product_url": (raw_row.get("product_url") or "").strip() or None,
                    "review_url": (raw_row.get("review_url") or "").strip() or None,
                }

                parsed.append(
                    RawReview(
                        source_channel="oliveyoung",
                        source_id=review_id,
                        source_url=raw_metadata["review_url"] or raw_metadata["product_url"],
                        raw_text=content,
                        raw_rating=stars,
                        raw_author=(raw_row.get("review_author") or "").strip() or None,
                        raw_date=date_iso,
                        raw_language="ko",
                        raw_metadata=raw_metadata,
                        collected_at=started,
                        keyword_used=keyword,
                    )
                )

        finished = datetime.now()
        self.last_run_summary = ConnectorRunSummary(
            run_id=run_id,
            channel="oliveyoung",
            requested_target=str(path),
            started_at=started,
            finished_at=finished,
            raw_records_seen=raw_seen,
            records_parsed=len(parsed),
            records_dropped_short_text=dropped_short_text,
            records_dropped_unparseable_date=0,
            parse_warnings=parse_warnings,
            sample_dropped_reasons=sample_dropped,
        )
        logger.info(
            "OliveYoung CSV: parsed %d / seen %d (dropped_short=%d, parse_warn=%d) path=%s",
            len(parsed), raw_seen, dropped_short_text, parse_warnings, path,
        )
        return parsed

    def _resolve_path(self, params: CollectParams) -> Path | None:
        if params.language_filter and Path(params.language_filter).is_file():
            return Path(params.language_filter)
        return self._csv_path


def _parse_int(s: str | None) -> int | None:
    if not s:
        return None
    try:
        return int(s.strip())
    except ValueError:
        return None


def _parse_iso_date(raw: str | None) -> str | None:
    """Validate `'YYYY-MM-DD'` and return the same string, else None.

    Pass-through for the normalizer's existing YYYY-MM-DD pattern; rejects
    obvious malformed values up-front so the connector's parse_warnings counter
    stays accurate.
    """
    if not raw:
        return None
    raw = raw.strip()
    parts = raw.split("-")
    if len(parts) != 3:
        return None
    try:
        y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
    except ValueError:
        return None
    if y < 1900 or y > 2100 or not (1 <= m <= 12) or not (1 <= d <= 31):
        return None
    return f"{y:04d}-{m:02d}-{d:02d}"
