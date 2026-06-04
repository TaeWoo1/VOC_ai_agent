"""Local SQLite store: bootstrap, new-review detection, status carry-over."""

from __future__ import annotations

from src.voc.review_ops.industrial.dedup import dedup
from src.voc.review_ops.industrial.normalize import normalize_rows
from src.voc.review_ops.industrial.store import (
    create_upload,
    get_cached_issues,
    get_review_status,
    init_db,
    list_recent_uploads,
    open_store,
    put_cached_issues,
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
        "issue_cache",
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


# --- issue_cache (S1c) ------------------------------------------------------


def _cache_meta() -> dict:
    return {
        "scope_key": "전선몰딩|선바로",
        "corpus_hash": "abc123",
        "recent_days": 180,
        "discovery_model": "gpt-4o-mini",
        "verifier_model": "gpt-4o",
        "discovery_version": "v1",
        "verifier_version": "v1",
        "created_at": "2026-01-21T20:33:46",
    }


def test_issue_cache_init_idempotent(tmp_path):
    # Opening twice (init_db runs each time) must not error or drop data.
    db = str(tmp_path / "s.db")
    conn = open_store(db)
    put_cached_issues(conn, "k1", _cache_meta(), '[{"issue_title": "접착력"}]')
    conn.close()

    conn2 = open_store(db)  # init_db runs again on the existing file
    init_db(conn2)  # explicit extra call — still idempotent
    row = get_cached_issues(conn2, "k1")
    assert row is not None
    assert row["payload_json"] == '[{"issue_title": "접착력"}]'


def test_get_cached_issues_miss_returns_none(tmp_path):
    conn = open_store(str(tmp_path / "s.db"))
    assert get_cached_issues(conn, "nope") is None


def test_put_then_get_roundtrip(tmp_path):
    conn = open_store(str(tmp_path / "s.db"))
    payload = '[{"issue_title": "접착력", "evidence_review_ids": ["r1"]}]'
    put_cached_issues(conn, "k1", _cache_meta(), payload)

    row = get_cached_issues(conn, "k1")
    assert row is not None
    assert row["cache_key"] == "k1"
    assert row["scope_key"] == "전선몰딩|선바로"
    assert row["corpus_hash"] == "abc123"
    assert row["recent_days"] == 180
    assert row["discovery_model"] == "gpt-4o-mini"
    assert row["verifier_model"] == "gpt-4o"
    assert row["discovery_version"] == "v1"
    assert row["verifier_version"] == "v1"
    assert row["payload_json"] == payload
    assert row["created_at"] == "2026-01-21T20:33:46"


def test_put_replaces_existing_row(tmp_path):
    conn = open_store(str(tmp_path / "s.db"))
    put_cached_issues(conn, "k1", _cache_meta(), '[{"v": 1}]')
    meta2 = {**_cache_meta(), "corpus_hash": "def456", "created_at": "2026-02-01T00:00:00"}
    put_cached_issues(conn, "k1", meta2, '[{"v": 2}]')

    row = get_cached_issues(conn, "k1")
    assert row["payload_json"] == '[{"v": 2}]'
    assert row["corpus_hash"] == "def456"
    assert row["created_at"] == "2026-02-01T00:00:00"
    # still a single row for this key
    count = conn.execute(
        "SELECT COUNT(*) FROM issue_cache WHERE cache_key = ?", ("k1",)
    ).fetchone()[0]
    assert count == 1


def test_put_created_at_defaults_when_absent(tmp_path):
    conn = open_store(str(tmp_path / "s.db"))
    meta = {k: v for k, v in _cache_meta().items() if k != "created_at"}
    put_cached_issues(conn, "k1", meta, "[]")
    row = get_cached_issues(conn, "k1")
    assert row["created_at"]  # auto-filled, non-empty
    assert row["scope_key"] == "전선몰딩|선바로"
