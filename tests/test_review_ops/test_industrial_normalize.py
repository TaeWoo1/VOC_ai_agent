"""Ingest + normalize + dedup behavior."""

from __future__ import annotations

from datetime import date

from src.voc.review_ops.industrial.dedup import dedup
from src.voc.review_ops.industrial.ingest import load_csv
from src.voc.review_ops.industrial.normalize import (
    _parse_date,
    _parse_rating,
    normalize_rows,
    to_review,
)

CSV_TEXT = (
    "채널,상품명,옵션명,평점,작성일,작성자,리뷰내용,답글\n"
    "네이버,몰딩 1호,1m,2,2026-05-28,kim**,\"사이즈가 안맞아요\",\n"
    "쿠팡,몰딩 1호,2m,5,2026.05.27,park**,\"튼튼하고 좋아요 만족합니다\",\"감사합니다\"\n"
)


def test_load_csv_tolerant_korean_headers(tmp_path):
    p = tmp_path / "reviews.csv"
    p.write_text(CSV_TEXT, encoding="utf-8")
    rows = load_csv(p)
    assert len(rows) == 2
    assert rows[0]["channel"] == "네이버"
    assert rows[0]["text"] == "사이즈가 안맞아요"
    assert rows[0]["rating"] == "2"


def test_load_csv_missing_text_column_raises(tmp_path):
    p = tmp_path / "bad.csv"
    p.write_text("채널,평점\n네이버,5\n", encoding="utf-8")
    try:
        load_csv(p)
    except ValueError as e:
        assert "text" in str(e)
    else:
        raise AssertionError("expected ValueError for missing text column")


def test_parse_date_variants():
    assert _parse_date("2026-05-28") == date(2026, 5, 28)
    assert _parse_date("2026.05.27") == date(2026, 5, 27)
    assert _parse_date("2026/05/26") == date(2026, 5, 26)
    assert _parse_date("2026년 5월 25일") == date(2026, 5, 25)
    assert _parse_date("어제") is None
    assert _parse_date(None) is None


def test_parse_rating_clamps_and_extracts():
    assert _parse_rating("5") == 5.0
    assert _parse_rating("별점 4점") == 4.0
    assert _parse_rating("9") == 5.0  # clamped
    assert _parse_rating("없음") is None


def test_to_review_sets_language_and_reply():
    r = to_review({"channel": "쿠팡", "text": "교환 문의드려요", "reply": ""})
    assert r is not None
    assert r.language == "ko"
    assert r.has_reply is False
    r2 = to_review({"channel": "쿠팡", "text": "교환 문의드려요", "reply": "처리했습니다"})
    assert r2.has_reply is True


def test_dedup_first_seen_wins():
    rows = [
        {"channel": "네이버", "text": "튼튼하고 좋아요 만족합니다"},
        {"channel": "쿠팡", "text": "튼튼하고 좋아요 만족합니다"},  # same content, other channel
        {"channel": "11번가", "text": "사이즈가 안맞아요"},
    ]
    reviews = dedup(normalize_rows(rows))
    assert reviews[0].is_duplicate is False
    assert reviews[1].is_duplicate is True
    assert reviews[1].duplicate_of == reviews[0].review_id
    assert reviews[2].is_duplicate is False
