"""App-level status/memo loading + carry-over across re-upload.

Uses a temp sqlite store (no OpenAI, no Streamlit E2E). Exercises the
``load_review_statuses`` helper together with the store write path.
"""

from __future__ import annotations

from app_industrial_review_ops import load_review_statuses
from src.voc.review_ops.industrial.dedup import dedup
from src.voc.review_ops.industrial.normalize import normalize_rows
from src.voc.review_ops.industrial.store import (
    create_upload,
    open_store,
    set_review_status,
    upsert_reviews,
)


def _rows(*texts: str) -> list[dict[str, str]]:
    return [
        {"channel": "네이버", "rating": "2", "date": "2026-05-28", "text": t}
        for t in texts
    ]


def _upload(conn, filename: str, rows: list[dict[str, str]]) -> list:
    reviews = [r for r in dedup(normalize_rows(rows)) if not r.is_duplicate]
    upload_id = create_upload(conn, filename, len(reviews))
    upsert_reviews(conn, upload_id, reviews)
    return reviews


def test_load_review_statuses_returns_only_set_ids(tmp_path):
    conn = open_store(str(tmp_path / "s.db"))
    reviews = _upload(conn, "u1.csv", _rows("사이즈 안맞아요", "접착력 약해요"))
    rid0, rid1 = reviews[0].review_id, reviews[1].review_id

    set_review_status(conn, rid0, "답글 필요", "교환 문의 들어옴")

    loaded = load_review_statuses(conn, [rid0, rid1])
    assert set(loaded.keys()) == {rid0}  # only the one with a saved status
    assert loaded[rid0]["status"] == "답글 필요"
    assert loaded[rid0]["memo"] == "교환 문의 들어옴"


def test_status_memo_survives_reupload(tmp_path):
    conn = open_store(str(tmp_path / "s.db"))
    rows = _rows("사이즈 안맞아요")
    reviews = _upload(conn, "u1.csv", rows)
    rid = reviews[0].review_id

    set_review_status(conn, rid, "답글 필요", "메모1")

    # Re-upload the same file: review is "seen", status/memo must persist.
    reviews2 = _upload(conn, "u2.csv", rows)
    assert reviews2[0].review_id == rid

    loaded = load_review_statuses(conn, [rid])
    assert loaded[rid]["status"] == "답글 필요"
    assert loaded[rid]["memo"] == "메모1"


def test_load_review_statuses_empty_when_none_set(tmp_path):
    conn = open_store(str(tmp_path / "s.db"))
    reviews = _upload(conn, "u1.csv", _rows("리뷰 하나"))
    assert load_review_statuses(conn, [reviews[0].review_id]) == {}
