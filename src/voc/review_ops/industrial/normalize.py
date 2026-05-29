"""Normalize raw CSV rows into IndustrialReview objects.

Reuses the canonical content-fingerprint function (CLAUDE.md §10, single
fingerprint path) via its public alias. Date/rating/review-id parsing is local
to keep this module isolated from the K-beauty channel ``Literal``.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from datetime import date

from src.voc.ingestion.normalizer import compute_content_fingerprint
from src.voc.review_ops.industrial.schema import IndustrialReview

_HANGUL_RE = re.compile(r"[가-힣]")
_LATIN_RE = re.compile(r"[a-zA-Z]")
_NUMBER_RE = re.compile(r"-?\d+(?:\.\d+)?")

_DATE_PATTERNS: list[re.Pattern] = [
    re.compile(r"(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일"),
    re.compile(r"(\d{4})-(\d{1,2})-(\d{1,2})"),
    re.compile(r"(\d{4})\.(\d{1,2})\.(\d{1,2})"),
    re.compile(r"(\d{4})/(\d{1,2})/(\d{1,2})"),
]

# Reply-column values that mean "no reply yet".
_NO_REPLY_TOKENS = {"", "없음", "n", "no", "false", "0", "미답변", "-"}


def _clean_text(raw_text: str) -> str:
    """NFC normalize, collapse whitespace, strip. Preserve casing."""
    text = unicodedata.normalize("NFC", raw_text)
    return re.sub(r"\s+", " ", text).strip()


def _parse_date(raw: str | None) -> date | None:
    if not raw:
        return None
    for pattern in _DATE_PATTERNS:
        m = pattern.search(raw)
        if m:
            try:
                return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            except ValueError:
                continue
    return None


def _parse_rating(raw: str | None) -> float | None:
    """Accept only an explicit 1–5 rating (decimals like 4.5 allowed).

    Anything outside that scale is returned as None rather than coerced — a
    100-point ``80`` or a percent ``85%`` is a scale mismatch, not a 5-star
    review. Silently clamping such values would hide low-rated reviews from the
    worklist and corrupt the rating distribution.
    """
    if not raw:
        return None
    if "%" in raw:  # percent-like values are not on the 1–5 scale
        return None
    m = _NUMBER_RE.search(raw)
    if not m:
        return None
    try:
        value = float(m.group())
    except ValueError:
        return None
    if 1.0 <= value <= 5.0:
        return value
    return None  # out of the expected 1–5 scale → unknown


def _assign_language(text: str) -> str:
    if _HANGUL_RE.search(text):
        return "ko"
    if _LATIN_RE.search(text):
        return "en"
    return "unknown"


def _parse_has_reply(raw: str | None) -> bool:
    if raw is None:
        return False
    return raw.strip().lower() not in _NO_REPLY_TOKENS


def _make_review_id(channel: str, source_id: str | None, fingerprint: str) -> str:
    key = f"{channel}::{source_id}" if source_id else f"{channel}::{fingerprint}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def to_review(row: dict[str, str]) -> IndustrialReview | None:
    """Convert one canonical-keyed CSV row to an IndustrialReview.

    Returns None if the row has no usable text (defensive — ingest already
    filters empties).
    """
    text = _clean_text(row.get("text", ""))
    if not text:
        return None

    channel = (row.get("channel") or "미상").strip() or "미상"
    fingerprint = compute_content_fingerprint(text)
    source_id = row.get("source_id") or None

    return IndustrialReview(
        review_id=_make_review_id(channel, source_id, fingerprint),
        channel=channel,
        text=text,
        content_fingerprint=fingerprint,
        product_name=row.get("product_name") or None,
        option_name=row.get("option_name") or None,
        rating=_parse_rating(row.get("rating")),
        author=row.get("author") or None,
        review_date=_parse_date(row.get("date")),
        language=_assign_language(text),
        has_reply=_parse_has_reply(row.get("reply")),
        source_id=source_id,
    )


def normalize_rows(rows: list[dict[str, str]]) -> list[IndustrialReview]:
    return [r for r in (to_review(row) for row in rows) if r is not None]
