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

# (pattern, is_short_year). Four-digit-year patterns are tried first so
# "2026.05.29" matches them before the YY.MM.DD fallback ("26.05.29" -> 2026).
_DATE_PATTERNS: list[tuple[re.Pattern, bool]] = [
    (re.compile(r"(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일"), False),
    (re.compile(r"(\d{4})-(\d{1,2})-(\d{1,2})"), False),
    (re.compile(r"(\d{4})\.(\d{1,2})\.(\d{1,2})"), False),
    (re.compile(r"(\d{4})/(\d{1,2})/(\d{1,2})"), False),
    (re.compile(r"(\d{2})\.(\d{1,2})\.(\d{1,2})"), True),  # YY.MM.DD (Korean export)
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
    for pattern, is_short_year in _DATE_PATTERNS:
        m = pattern.search(raw)
        if m:
            try:
                year = int(m.group(1)) + (2000 if is_short_year else 0)
                return date(year, int(m.group(2)), int(m.group(3)))
            except ValueError:
                continue
    return None


_SLASH_RE = re.compile(r"(\d+(?:\.\d+)?)\s*/\s*(\d+(?:\.\d+)?)")
# "5점 만점에 4점", "5 만점에 4" — \w* absorbs the Korean particle after 만점.
_OUT_OF_KO_RE = re.compile(r"(\d+(?:\.\d+)?)\s*점?\s*만점\w*\s*(\d+(?:\.\d+)?)")
# "5 out of 5", "score 5 of 100"
_OUT_OF_EN_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:out\s+of|of)\s*(\d+(?:\.\d+)?)")
_ALL_NUMBERS_RE = re.compile(r"\d+(?:\.\d+)?")


def _in_scale(value: float) -> float | None:
    return value if 1.0 <= value <= 5.0 else None


def _parse_rating(raw: str | None) -> float | None:
    """Scale-aware 1–5 rating parse. Unknown (None) unless clearly on a 5-scale.

    Does NOT just take the first numeric token — a 100-point ``80`` or a
    compound ``5/100`` must not be coerced into a 5-star review. Coercing
    out-of-scale values would hide low-rated reviews and corrupt the
    distribution.

    Accepts: ``5``, ``4.5``, ``별점 4점``, ``평점 3``, denominator-5 forms
    (``4/5``, ``5점 만점에 4점``, ``4 out of 5``).
    Rejects: non-5 denominators (``5/10``, ``80/100``, ``10점 만점에 8점``,
    ``score 5 of 100``), percents (``85%``), and ambiguous multi-number strings.
    """
    if not raw:
        return None
    s = raw.strip()
    if not s or "%" in s:  # percents are not on the 1–5 scale
        return None

    # Explicit "value / scale" or "value out of scale" forms: only a scale of 5 is valid.
    m = _SLASH_RE.search(s)
    if m:
        return _in_scale(float(m.group(1))) if float(m.group(2)) == 5 else None
    m = _OUT_OF_KO_RE.search(s)
    if m:
        return _in_scale(float(m.group(2))) if float(m.group(1)) == 5 else None
    m = _OUT_OF_EN_RE.search(s)
    if m:
        return _in_scale(float(m.group(1))) if float(m.group(2)) == 5 else None

    # Plain rating: exactly one numeric token, on the 1–5 scale. Multiple tokens
    # (e.g. "score 5 of 100" minus the matched forms above) are ambiguous → None.
    nums = _ALL_NUMBERS_RE.findall(s)
    if len(nums) != 1:
        return None
    return _in_scale(float(nums[0]))


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
