from __future__ import annotations

from datetime import date
from typing import Optional

from .loaders import ReviewOpsInputs, ReviewRow

# Class labels (also used as JSON keys downstream).
USABLE = "usable"
STALE = "stale"
RISK = "risk"
INSIGHT = "insight"

USABLE_KEYWORDS: tuple[str, ...] = (
    "재구매",
    "인생템",
    "만족",
    "흡수",
    "발림",
    "지속력",
    "향이 좋",
    "발색",
    "촉촉",
)

# Inherently cautionary terms — count as risk by keyword presence,
# UNLESS a negation marker sits within ±MARKER_WINDOW of the keyword
# (e.g. "트러블 안 났어요" must not be counted as risk).
INHERENTLY_CAUTIONARY_KEYWORDS: tuple[str, ...] = (
    "트러블", "따가움", "발진", "가려움", "붉어짐",
    "누수", "샜어요", "새요",
)

# Broad terms — too easily false-positived by "향이 좋아요" / "색이 예뻐요".
# Require either rating_raw <= 3 OR a complaint marker within ±window.
BROAD_RISK_KEYWORDS: tuple[str, ...] = (
    "펌프", "뚜껑", "냄새", "향", "색", "발색", "톤",
    "분리", "제형", "밀림", "뭉침", "거칠", "건조",
)

INSIGHT_KEYWORDS: tuple[str, ...] = (
    "있으면 좋",
    "아쉬워요",
    "다른 색",
    "대용량",
    "여행용",
    "리필",
    "옵션 추가",
    "기획전",
    "재발매",
)

# Markers that signal a complaint context — used to gate broad keywords.
COMPLAINT_MARKERS: tuple[str, ...] = (
    "별로", "아쉬", "불편", "안 맞", "안나", "안 나",
    "새", "샜", "누수", "따가", "트러블", "발진",
    "가려", "역해", "이상", "다르", "칙칙",
    "밀림", "뭉침", "분리", "거칠", "건조",
)

# Markers that flip an inherently cautionary keyword from risk to safe.
NEGATION_MARKERS: tuple[str, ...] = (
    "안 났", "안났", "안 생", "안생", "없었", "없어",
)

MARKER_WINDOW = 20

USABLE_MIN_RATING = 4.0
USABLE_MIN_TEXT_LEN = 20

RISK_MAX_RATING = 2.0
UNREPLIED_RISK_MAX_RATING = 3.0
BROAD_RISK_RATING_GATE = 3.0

STALE_MIN_AGE_DAYS = 180
STALE_MAX_RATING = 3.0


def _has_any(text: str, keywords: tuple[str, ...]) -> bool:
    return any(k in text for k in keywords)


def _has_marker_near(text: str, pos: int, markers: tuple[str, ...]) -> bool:
    if pos < 0:
        return False
    chunk = text[max(0, pos - MARKER_WINDOW): pos + MARKER_WINDOW]
    return any(m in chunk for m in markers)


def _any_keyword_position_has_marker(
    text: str,
    keywords: tuple[str, ...],
    markers: tuple[str, ...],
) -> bool:
    """True if ANY occurrence of ANY keyword has a marker within ±window."""
    for k in keywords:
        pos = text.find(k)
        while pos != -1:
            if _has_marker_near(text, pos, markers):
                return True
            pos = text.find(k, pos + 1)
    return False


def _has_unnegated_keyword(
    text: str,
    keywords: tuple[str, ...],
    negation_markers: tuple[str, ...],
) -> bool:
    """True if any occurrence of any keyword is NOT negated by a nearby marker."""
    for k in keywords:
        pos = text.find(k)
        while pos != -1:
            if not _has_marker_near(text, pos, negation_markers):
                return True
            pos = text.find(k, pos + 1)
    return False


def _is_usable(row: ReviewRow) -> bool:
    if row.rating_raw is None or row.rating_raw < USABLE_MIN_RATING:
        return False
    if len(row.text) < USABLE_MIN_TEXT_LEN:
        return False
    return _has_any(row.text, USABLE_KEYWORDS)


def _is_stale(row: ReviewRow, today: date) -> bool:
    if row.review_date is None:
        return False
    if row.rating_raw is None or row.rating_raw > STALE_MAX_RATING:
        return False
    return (today - row.review_date).days >= STALE_MIN_AGE_DAYS


def _is_risk(row: ReviewRow) -> bool:
    text = row.text or ""

    # Hard rule: very low rating is always risk.
    if row.rating_raw is not None and row.rating_raw <= RISK_MAX_RATING:
        return True

    # Inherently cautionary keywords count if ANY occurrence is unnegated.
    if _has_unnegated_keyword(text, INHERENTLY_CAUTIONARY_KEYWORDS, NEGATION_MARKERS):
        return True

    # Broad keywords need polarity evidence:
    #   rating_raw <= 3 OR ANY broad-keyword position has a complaint marker
    #   within ±window. Multi-position scan handles texts where one positive
    #   broad mention sits before a separate negative broad mention.
    if _has_any(text, BROAD_RISK_KEYWORDS):
        if row.rating_raw is not None and row.rating_raw <= BROAD_RISK_RATING_GATE:
            return True
        if _any_keyword_position_has_marker(
            text, BROAD_RISK_KEYWORDS, COMPLAINT_MARKERS
        ):
            return True

    # Unreplied low-rating without keywords is still operationally risk-worthy.
    if (
        row.rating_raw is not None
        and row.rating_raw <= UNREPLIED_RISK_MAX_RATING
        and not row.has_brand_reply
    ):
        return True

    return False


def _is_insight(row: ReviewRow) -> bool:
    return _has_any(row.text, INSIGHT_KEYWORDS)


def classify_row(row: ReviewRow, *, today: Optional[date] = None) -> list[str]:
    today = today or date.today()
    classes: list[str] = []
    if _is_usable(row):
        classes.append(USABLE)
    if _is_stale(row, today):
        classes.append(STALE)
    if _is_risk(row):
        classes.append(RISK)
    if _is_insight(row):
        classes.append(INSIGHT)
    return classes


def classify_all(
    inputs: ReviewOpsInputs,
    *,
    today: Optional[date] = None,
) -> dict[str, list[str]]:
    today = today or date.today()
    out: dict[str, list[str]] = {}
    for row in inputs.reviews:
        classes = classify_row(row, today=today)
        if classes:
            out[row.review_id] = classes
    return out
