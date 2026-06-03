"""Local SQLite store: bootstrap, new-review detection, status carry-over."""

from __future__ import annotations

from src.voc.review_ops.industrial.dedup import dedup
from src.voc.review_ops.industrial.normalize import normalize_rows
from src.voc.review_ops.industrial.store import (
    create_upload,
    get_review_status,
    list_recent_uploads,
    open_store,
    set_review_status,
    upsert_reviews,
)


def _rows(*texts: str) -> list[dict[str, str]]:
    """Build canonical-keyed rows; review_id is content-addressed per channel."""
    return [
        {"channel": "네이버", "rating": "2", "date": "2026-05-28", "text": t}
        for t in texts
    ]


def _persist(conn, filename: str, rows: list[dict[str, str]]) -> dict:
    reviews = [r for r in dedup(normalize_rows(rows)) if not r.is_duplicate]
    upload_id = create_upload(conn, filename, len(reviews))
    summary = upsert_reviews(conn, upload_id, reviews)
    return {"upload_id": upload_id, **summary}


def test_init_creates_tables(tmp_path):
    conn = open_store(str(tmp_path / "s.db"))
    names = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        ).fetchall()
    }
    assert {
        "uploads",
        "reviews",
        "review_status",
        "issue_status",
        "chat_messages",
    } <= names


def test_first_upload_marks_all_new(tmp_path):
    conn = open_store(str(tmp_path / "s.db"))
    res = _persist(conn, "u1.csv", _rows("사이즈가 안맞아요", "접착력이 약해요", "포장이 파손됐어요"))
    assert res["new_count"] == 3
    assert res["seen_count"] == 0
    assert get_upload_summary_count(conn, res["upload_id"]) == 3


def test_reupload_same_reviews_marks_zero_new(tmp_path):
    conn = open_store(str(tmp_path / "s.db"))
    rows = _rows("사이즈가 안맞아요", "접착력이 약해요")
    _persist(conn, "u1.csv", rows)
    res2 = _persist(conn, "u2.csv", rows)
    assert res2["new_count"] == 0
    assert res2["seen_count"] == 2


def test_overlapping_upload_marks_only_genuinely_new(tmp_path):
    conn = open_store(str(tmp_path / "s.db"))
    _persist(conn, "u1.csv", _rows("사이즈가 안맞아요", "접착력이 약해요"))
    res2 = _persist(
        conn, "u2.csv", _rows("접착력이 약해요", "새로 들어온 불만이에요", "또 다른 새 리뷰")
    )
    assert res2["new_count"] == 2  # only the two genuinely new texts
    assert res2["seen_count"] == 1  # the overlapping one


def test_duplicate_review_id_within_batch_counted_once(tmp_path):
    conn = open_store(str(tmp_path / "s.db"))
    # Same channel + same text -> same content-addressed review_id.
    res = _persist(conn, "u1.csv", _rows("똑같은 리뷰", "똑같은 리뷰"))
    assert res["new_count"] == 1


def test_review_status_persists_across_reupload(tmp_path):
    conn = open_store(str(tmp_path / "s.db"))
    rows = _rows("사이즈가 안맞아요")
    res1 = _persist(conn, "u1.csv", rows)
    review_id = res1["new_review_ids"][0]

    set_review_status(conn, review_id, "처리 중", "교환 안내함")
    res2 = _persist(conn, "u2.csv", rows)  # same review re-uploaded

    assert res2["new_count"] == 0
    saved = get_review_status(conn, review_id)
    assert saved is not None
    assert saved["status"] == "처리 중"
    assert saved["memo"] == "교환 안내함"


def test_set_review_status_updates_existing(tmp_path):
    conn = open_store(str(tmp_path / "s.db"))
    review_id = _persist(conn, "u1.csv", _rows("사이즈가 안맞아요"))["new_review_ids"][0]
    set_review_status(conn, review_id, "확인함", "")
    set_review_status(conn, review_id, "완료", "처리 끝")
    saved = get_review_status(conn, review_id)
    assert saved["status"] == "완료"
    assert saved["memo"] == "처리 끝"


def test_get_review_status_none_when_unset(tmp_path):
    conn = open_store(str(tmp_path / "s.db"))
    assert get_review_status(conn, "deadbeef") is None


def test_list_recent_uploads_newest_first(tmp_path):
    conn = open_store(str(tmp_path / "s.db"))
    _persist(conn, "u1.csv", _rows("리뷰 하나"))
    _persist(conn, "u2.csv", _rows("리뷰 둘"))
    recent = list_recent_uploads(conn, limit=10)
    assert [u["filename"] for u in recent] == ["u2.csv", "u1.csv"]
    assert recent[0]["new_count"] == 1


# --- local helper that exercises get_upload_summary -------------------------
def get_upload_summary_count(conn, upload_id: int) -> int:
    from src.voc.review_ops.industrial.store import get_upload_summary

    summary = get_upload_summary(conn, upload_id)
    assert summary is not None
    assert summary["upload_id"] == upload_id
    return summary["new_count"]
