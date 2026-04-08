"""Normalizer — transforms RawReview into CanonicalReview.

Pipeline order:
  validate → clean text → assign language → parse date → normalize rating
  → derive domain → fingerprint → review_id → assemble
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from datetime import date, datetime
from urllib.parse import urlparse

from src.voc.schemas.raw import RawReview
from src.voc.schemas.canonical import CanonicalReview


CHANNEL_DOMAIN_MAP: dict[str, str] = {
    "mock": "mock.local",
    "naver": "shopping.naver.com",
    "csv": "csv.local",
}

CHANNEL_RATING_SCALES: dict[str, tuple[int, int]] = {
    "mock": (1, 5),
    "naver": (1, 5),
    "csv": (1, 5),
}

VALID_LANGUAGES: set[str] = {"ko", "en"}


def normalize(raw: RawReview) -> CanonicalReview:
    """Transform a RawReview into a CanonicalReview.

    Raises ValueError if raw_text is empty or whitespace-only.
    All other failures are soft (fields degrade to None).
    """
    if not raw.raw_text or not raw.raw_text.strip():
        raise ValueError("raw_text is empty or whitespace-only")

    text = _clean_text(raw.raw_text)
    language = _assign_language(raw.raw_language, text)
    review_date = _parse_date(raw.raw_date)
    rating = _normalize_rating(raw.raw_rating, raw.source_channel)
    domain = _derive_source_domain(raw.source_url, raw.source_channel)
    fingerprint = _compute_content_fingerprint(text)
    review_id = _generate_review_id(raw.source_channel, raw.source_id, fingerprint)

    return CanonicalReview(
        review_id=review_id,
        tenant_id=raw.tenant_id,
        source_channel=raw.source_channel,
        source_domain=domain,
        source_id=raw.source_id,
        source_url=raw.source_url,
        text=text,
        rating_normalized=rating,
        author=raw.raw_author,
        review_date=review_date,
        language=language,
        content_fingerprint=fingerprint,
        product_keyword=raw.keyword_used,
        collected_at=raw.collected_at,
        ingested_at=datetime.now(),
        metadata=raw.raw_metadata,
    )


def _clean_text(raw_text: str) -> str:
    """NFC normalize, collapse whitespace, strip. Preserve casing."""
    text = unicodedata.normalize("NFC", raw_text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


_HANGUL_RE = re.compile(r"[\uac00-\ud7a3]")
_LATIN_RE = re.compile(r"[a-zA-Z]")


def _assign_language(raw_language: str | None, text: str) -> str:
    """Valid raw_language > Hangul heuristic > Latin heuristic > 'unknown'."""
    if raw_language in VALID_LANGUAGES:
        return raw_language
    if _HANGUL_RE.search(text):
        return "ko"
    if _LATIN_RE.search(text):
        return "en"
    return "unknown"


_DATE_PATTERNS: list[tuple[re.Pattern, bool]] = [
    # (pattern, is_short_year)
    (re.compile(r"(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일"), False),
    (re.compile(r"(\d{4})-(\d{1,2})-(\d{1,2})"), False),
    (re.compile(r"(\d{4})/(\d{1,2})/(\d{1,2})"), False),
    (re.compile(r"(\d{2})\.(\d{2})\.(\d{2})"), True),  # YY.MM.DD
]


def _parse_date(raw_date: str | None) -> date | None:
    """Regex patterns in priority order. Return None on failure, never raise."""
    if not raw_date:
        return None
    for pattern, is_short_year in _DATE_PATTERNS:
        m = pattern.search(raw_date)
        if m:
            try:
                y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
                if is_short_year:
                    y += 2000
                return date(y, mo, d)
            except ValueError:
                continue
    return None


def _normalize_rating(raw_rating: float | int | None, source_channel: str) -> float | None:
    """Map to 0.0-1.0 using CHANNEL_RATING_SCALES. None if missing or unknown scale."""
    if raw_rating is None:
        return None
    scale = CHANNEL_RATING_SCALES.get(source_channel)
    if scale is None:
        return None
    lo, hi = scale
    if hi == lo:
        return 0.5
    normalized = (raw_rating - lo) / (hi - lo)
    return max(0.0, min(1.0, normalized))


def _derive_source_domain(source_url: str | None, source_channel: str) -> str:
    """urlparse(source_url).netloc with CHANNEL_DOMAIN_MAP fallback."""
    if source_url:
        netloc = urlparse(source_url).netloc
        if netloc:
            return netloc
    return CHANNEL_DOMAIN_MAP.get(source_channel, "unknown.local")


def _compute_content_fingerprint(cleaned_text: str) -> str:
    """NFC + lower + strip + collapse ws → sha256 hex."""
    normalized = unicodedata.normalize("NFC", cleaned_text)
    normalized = re.sub(r"\s+", " ", normalized.lower().strip())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _generate_review_id(
    source_channel: str, source_id: str | None, content_fingerprint: str
) -> str:
    """sha256(channel + source_id)[:16] or sha256(channel + fingerprint)[:16]."""
    if source_id is not None:
        key = f"{source_channel}::{source_id}"
    else:
        key = f"{source_channel}::{content_fingerprint}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
