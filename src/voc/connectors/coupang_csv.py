"""Coupang CSV replay connector — Phase 1 ingestion path.

Reads `/coupang/coupang_reviews.csv` (the static dataset bundled with the repo;
no live Coupang scraper exists in this codebase). Each CSV row becomes one
RawReview.

Title-content merge (Phase 1 plan, Decision 2 (A)): if `review_title` is present
and not already a substring of `review_content`, prepend `"[{title}] {content}"`
into `raw_text`. The title is also retained verbatim on `raw_metadata` under the
`review_title` key, which the pipeline promotes onto `CoupangMeta.review_title`.

Date normalization: Coupang publishes dates as `YYYY.MM.DD`, which the existing
normalizer's date patterns do NOT handle (the dotted pattern requires 2-digit
year). This connector pre-converts `"2024.03.19"` → `"2024-03-19"` so the
normalizer's `YYYY-MM-DD` pattern matches downstream. Unparseable dates increment
`parse_warnings` and emit the row with `review_date=NULL`.

The Coupang CSV does NOT expose `verified_purchase` / `photo_attached` /
`helpful_count`. Those fields stay absent from `raw_metadata`; CoupangMeta
defaults them to None during pipeline construction.

`last_run_summary` is populated with the PR1-minimum counters. CSV cannot be
blocked or auth-rejected, so `quality_status` is OK barring catastrophic file
errors (missing required columns → `ValueError` raised before the run completes).
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

# Fields the pipeline must promote out of raw_metadata into the typed CoupangMeta.
# verified_purchase / photo_attached / helpful_count are reserved for future
# Coupang feeds (e.g., OAuth API); the CSV path leaves them None.
COUPANG_PROMOTED_KEYS: set[str] = {
    "verified_purchase",
    "photo_attached",
    "helpful_count",
    "review_title",
}

_REQUIRED_COLUMNS: set[str] = {"review_content", "review_stars", "review_date"}

# Encodings to try for demo / seller-uploaded CSVs. UTF-8 (BOM-tolerant
# via utf-8-sig) is the common web/modern case; CP949 is the common
# legacy case for CSVs that were round-tripped through Korean Excel.
# Order matters: first successful decode wins.
_CSV_ENCODINGS: tuple[str, ...] = ("utf-8-sig", "cp949")


class CoupangCSVConnector:
    """Replays a Coupang reviews CSV bundled with the repo (or any CSV with the same shape)."""

    def __init__(self, csv_path: str | Path | None = None):
        self._csv_path = Path(csv_path) if csv_path else None
        self.last_run_summary: ConnectorRunSummary | None = None

    @property
    def channel_name(self) -> str:
        return "coupang"

    async def collect(
        self, keyword: str, params: CollectParams | None = None
    ) -> list[RawReview]:
        params = params or CollectParams()
        path = self._resolve_path(params)
        run_id = f"coupang_csv_{uuid.uuid4().hex[:12]}"
        started = datetime.now()

        if path is None or not path.is_file():
            logger.warning("Coupang CSV not found (path=%s)", path)
            self.last_run_summary = ConnectorRunSummary(
                run_id=run_id,
                channel="coupang",
                requested_target=str(path or ""),
                started_at=started,
                finished_at=datetime.now(),
            )
            return []

        raw_seen = 0
        parsed: list[RawReview] = []
        dropped_short_text = 0
        dropped_unparseable_date = 0
        parse_warnings = 0
        sample_dropped: list[str] = []

        encoding_used = _detect_encoding(path)
        with open(path, encoding=encoding_used, newline="") as f:
            try:
                reader = csv.DictReader(f)
                fieldnames = list(reader.fieldnames or [])
                missing = _REQUIRED_COLUMNS - set(fieldnames)
                if missing:
                    # Include the columns we actually found so the operator can
                    # diagnose malformed exports without re-opening the file.
                    found = sorted(fieldnames) if fieldnames else ["<none>"]
                    raise ValueError(
                        f"Coupang CSV missing required columns: "
                        f"{sorted(missing)}. Found: {found}. "
                        f"Required: {sorted(_REQUIRED_COLUMNS)}. "
                        f"See docs/csv_upload.md for the expected schema."
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

                    title = (raw_row.get("review_title") or "").strip() or None
                    merged = _merge_title_content(title, content)

                    date_iso = _normalize_coupang_date(raw_row.get("review_date"))
                    if date_iso is None and (raw_row.get("review_date") or "").strip():
                        parse_warnings += 1
                        if len(sample_dropped) < 5:
                            sample_dropped.append(
                                f"unparseable date: {raw_row.get('review_date')!r}"
                            )

                    stars_raw = (raw_row.get("review_stars") or "").strip()
                    stars = _parse_int(stars_raw) if stars_raw else None
                    if stars_raw and stars is None:
                        parse_warnings += 1
                        if len(sample_dropped) < 5:
                            sample_dropped.append(
                                f"unparseable stars: {stars_raw!r}"
                            )

                    product_index = (raw_row.get("product_index") or "").strip() or None
                    review_index = (raw_row.get("review_index") or "").strip() or None
                    source_id = (
                        f"{product_index}::{review_index}"
                        if product_index and review_index else None
                    )

                    raw_metadata = {
                        "review_title": title,
                        "product_external_id": product_index,
                        "product_url": (raw_row.get("product_url") or "").strip() or None,
                        "product_title": (raw_row.get("product_title") or "").strip() or None,
                        "product_price": (raw_row.get("product_price") or "").strip() or None,
                        "review_index": review_index,
                    }

                    parsed.append(
                        RawReview(
                            source_channel="coupang",
                            source_id=source_id,
                            source_url=raw_metadata["product_url"],
                            raw_text=merged,
                            raw_rating=stars,
                            raw_author=(raw_row.get("review_author") or "").strip() or None,
                            raw_date=date_iso,
                            raw_language="ko",
                            raw_metadata=raw_metadata,
                            collected_at=started,
                            keyword_used=keyword,
                        )
                    )
            except csv.Error as e:
                # Structural CSV errors (unterminated quote, ragged rows, etc.)
                # aren't recoverable mid-stream; surface with context rather
                # than letting the traceback escape uninterpretable.
                raise ValueError(
                    f"Coupang CSV is structurally malformed at {path} "
                    f"(encoding={encoding_used}): {e}"
                ) from e

        finished = datetime.now()
        self.last_run_summary = ConnectorRunSummary(
            run_id=run_id,
            channel="coupang",
            requested_target=str(path),
            started_at=started,
            finished_at=finished,
            raw_records_seen=raw_seen,
            records_parsed=len(parsed),
            records_dropped_short_text=dropped_short_text,
            records_dropped_unparseable_date=dropped_unparseable_date,
            parse_warnings=parse_warnings,
            sample_dropped_reasons=sample_dropped,
        )
        logger.info(
            "Coupang CSV: parsed %d / seen %d (dropped_short=%d, parse_warn=%d, "
            "encoding=%s) path=%s",
            len(parsed), raw_seen, dropped_short_text, parse_warnings,
            encoding_used, path,
        )
        if raw_seen == 0:
            # Headers-only CSV is a non-error state but is almost always a
            # user mistake (wrong file, failed export). Log clearly.
            logger.warning(
                "Coupang CSV contained headers but zero data rows: %s", path,
            )
        return parsed

    def _resolve_path(self, params: CollectParams) -> Path | None:
        if params.language_filter and Path(params.language_filter).is_file():
            return Path(params.language_filter)
        return self._csv_path


def _merge_title_content(title: str | None, content: str) -> str:
    """Prepend `[title] ` to `content` unless title is empty or already a substring.

    Decision 2 (A) from the Phase 1 plan: titles often hold the punchline; embedding
    and sentiment lose signal if the title is dropped. Prepending keeps it near the
    start where positional encoding still matters.
    """
    if title and title not in content:
        return f"[{title}] {content}"
    return content


def _normalize_coupang_date(raw: str | None) -> str | None:
    """Convert Coupang's `'YYYY.MM.DD'` to ISO `'YYYY-MM-DD'`.

    Returns None on any parse failure; the caller logs as parse_warning and
    persists the row with `review_date=NULL`.
    """
    if not raw:
        return None
    raw = raw.strip()
    parts = raw.split(".")
    if len(parts) != 3:
        return None
    try:
        y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
    except ValueError:
        return None
    if y < 1900 or y > 2100 or not (1 <= m <= 12) or not (1 <= d <= 31):
        return None
    return f"{y:04d}-{m:02d}-{d:02d}"


def _parse_int(s: str | None) -> int | None:
    if not s:
        return None
    try:
        return int(s.strip())
    except ValueError:
        return None


def _detect_encoding(path: Path) -> str:
    """Pick the first encoding from _CSV_ENCODINGS that decodes the file.

    Tries each encoding against the full file contents (Phase 1 CSV volume
    is small enough that this is cheap). Returns the first that succeeds.
    Raises ValueError with all encodings tried if none work — common causes
    are non-Korean CSVs or binary files mistaken for CSV.

    utf-8-sig handles both plain UTF-8 and UTF-8 with BOM; cp949 handles
    the Korean-Excel legacy case that still shows up in seller exports.
    """
    data = path.read_bytes()
    for enc in _CSV_ENCODINGS:
        try:
            data.decode(enc)
            return enc
        except UnicodeDecodeError:
            continue
    raise ValueError(
        f"Coupang CSV at {path} could not be decoded as any of "
        f"{list(_CSV_ENCODINGS)}. If the file was exported from a "
        f"different tool, re-export as UTF-8."
    )
