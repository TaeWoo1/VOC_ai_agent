"""App-level repeated-issue cache wiring (S1d).

No network: ``issue_discovery.discover_issues`` (the only OpenAI path) is
replaced with a call-counting fake, and ``rag.resolve_api_key`` is monkeypatched.
A file-backed tmp store is used so the cache persists across ``generate()`` calls.
"""

from __future__ import annotations

from datetime import date

from app_industrial_review_ops import generate
from src.voc.review_ops.industrial import issue_discovery, rag
from src.voc.review_ops.industrial.issue_sanitize import has_banned_wording
from src.voc.review_ops.industrial.schema import IssueCluster, WorklistRow

_BANNED = ["원인 분석", "개선 방안", "개선해야", "반드시", "매출 영향", "자동 처리", "즉시 반영"]


def _rows(extra: bool = False):
    rows = [
        {"product_name": "전선몰딩", "text": "몰딩 접착력이 약해요", "rating": "2", "date": "2026-05-30"},
        {"product_name": "전선몰딩", "text": "벽에 설치하기 어려웠습니다", "rating": "3", "date": "2026-05-30"},
        {"product_name": "컵디스펜서", "text": "자석이 약해서 뚜껑이 헐거워요", "rating": "2", "date": "2026-05-30"},
        {"product_name": "컵디스펜서", "text": "잘 쓰고 있습니다", "rating": "5", "date": "2026-05-30"},
    ]
    if extra:
        rows.append(
            {"product_name": "전선몰딩", "text": "또 다른 새 불만이 생겼어요", "rating": "1", "date": "2026-05-30"}
        )
    return rows


def _fake_discovery(counter: dict):
    """Fake discovery: counts calls; emits one issue with risky wording so the
    sanitize-on-serialize path is exercised. Evidence ids come from the in-scope
    reviews actually passed in."""

    def fake(report, reviews, *, api_key, today, recent_days, max_issues, max_evidence):
        counter["n"] += 1
        rids = [r.review_id for r in reviews if not r.is_duplicate][:2]
        reps = [
            WorklistRow(
                review_id=rid,
                review_date=None,
                channel="네이버",
                product_name="전선몰딩",
                option_name=None,
                rating=2.0,
                text="접착력이 약해요",
            )
            for rid in rids
        ]
        c = IssueCluster(
            cluster_id="c1",
            tag="adhesion",
            tag_label="접착력",
            issue_title="접착력 부족",
            issue_type="product",
            severity="high",
            summary="접착력에 대한 원인 분석 및 개선 방안이 필요합니다.",
            recommended_action="상세페이지에 즉시 반영 필요",
            review_ids=rids,
            representatives=reps,
            judged=True,
        )
        report.issue_clusters = [c]
        return report, {
            "status": "ok",
            "engine": "discovery",
            "issues": 1,
            "used_candidate_count": len(rids),
        }

    return fake


def _gen(store_path, *, rows=None, scope="전선몰딩", today=date(2026, 5, 31)):
    return generate(
        rows if rows is not None else _rows(),
        title="t",
        today=today,
        recent_days=90,
        store_path=store_path,
        do_refine=False,
        do_cluster=True,
        product_filter={scope} if scope else None,
    )


def _titles(res):
    return [it["issue_title"] for it in (res.get("issue_items") or [])]


# --- cache hit / miss -------------------------------------------------------


def test_first_run_is_miss_then_identical_run_reuses(tmp_path, monkeypatch):
    counter = {"n": 0}
    monkeypatch.setattr(rag, "resolve_api_key", lambda: "k")
    monkeypatch.setattr(issue_discovery, "discover_issues", _fake_discovery(counter))
    db = str(tmp_path / "s.db")

    r1 = _gen(db)
    assert counter["n"] == 1  # discovery ran on the miss
    assert r1["cluster_summary"]["cache_hit"] is False

    r2 = _gen(db)
    assert counter["n"] == 1  # second identical run did NOT call discovery
    assert r2["cluster_summary"]["cache_hit"] is True
    assert r2["cluster_summary"]["cached_at"]

    # identical titles / counts / evidence
    assert _titles(r1) == _titles(r2)
    assert r1["issue_count"] == r2["issue_count"]
    assert r1["issue_review_ids"] == r2["issue_review_ids"]


def test_changing_corpus_recomputes(tmp_path, monkeypatch):
    counter = {"n": 0}
    monkeypatch.setattr(rag, "resolve_api_key", lambda: "k")
    monkeypatch.setattr(issue_discovery, "discover_issues", _fake_discovery(counter))
    db = str(tmp_path / "s.db")

    _gen(db)
    assert counter["n"] == 1
    # add a new in-scope review -> corpus_hash changes -> miss -> recompute
    r = _gen(db, rows=_rows(extra=True))
    assert counter["n"] == 2
    assert r["cluster_summary"]["cache_hit"] is False


def test_changing_scope_recomputes(tmp_path, monkeypatch):
    counter = {"n": 0}
    monkeypatch.setattr(rag, "resolve_api_key", lambda: "k")
    monkeypatch.setattr(issue_discovery, "discover_issues", _fake_discovery(counter))
    db = str(tmp_path / "s.db")

    _gen(db, scope="전선몰딩")
    assert counter["n"] == 1
    r = _gen(db, scope="컵디스펜서")  # different scope_key -> miss
    assert counter["n"] == 2
    assert r["cluster_summary"]["cache_hit"] is False


# --- API-key behavior -------------------------------------------------------


def test_cache_hit_works_without_api_key(tmp_path, monkeypatch):
    counter = {"n": 0}
    monkeypatch.setattr(issue_discovery, "discover_issues", _fake_discovery(counter))
    db = str(tmp_path / "s.db")

    # populate cache with a key
    monkeypatch.setattr(rag, "resolve_api_key", lambda: "k")
    _gen(db)
    assert counter["n"] == 1

    # now no key -> identical input must still reuse the cached result
    monkeypatch.setattr(rag, "resolve_api_key", lambda: "")
    r = _gen(db)
    assert counter["n"] == 1  # discovery NOT called
    assert r["cluster_summary"]["cache_hit"] is True
    assert r["issue_count"] == 1


def test_cache_miss_without_key_preserves_no_key_behavior(tmp_path, monkeypatch):
    counter = {"n": 0}
    monkeypatch.setattr(rag, "resolve_api_key", lambda: "")
    monkeypatch.setattr(issue_discovery, "discover_issues", _fake_discovery(counter))
    db = str(tmp_path / "s.db")

    r = _gen(db)  # empty cache + no key
    assert counter["n"] == 0  # discovery not attempted
    assert r["cluster_summary"]["status"] == "no_key"
    assert r["issue_count"] == 0  # no crash, no issues


# --- sanitization through the display / Notion-facing payload ---------------


def test_sanitized_wording_appears_on_miss_and_hit(tmp_path, monkeypatch):
    counter = {"n": 0}
    monkeypatch.setattr(rag, "resolve_api_key", lambda: "k")
    monkeypatch.setattr(issue_discovery, "discover_issues", _fake_discovery(counter))
    db = str(tmp_path / "s.db")

    for run in (_gen(db), _gen(db)):  # miss, then hit
        items = run["issue_items"]
        assert items, "expected at least one displayed issue"
        for it in items:
            for field in ("summary", "recommended_action", "issue_title"):
                text = it.get(field, "")
                assert has_banned_wording(text) is False, (field, text)
                for bad in _BANNED:
                    assert bad not in text
        # the recommended action was rewritten deterministically
        assert items[0]["recommended_action"] == "상세페이지에 반영 검토 필요"


def test_notion_facing_issue_items_are_sanitized(tmp_path, monkeypatch):
    counter = {"n": 0}
    monkeypatch.setattr(rag, "resolve_api_key", lambda: "k")
    monkeypatch.setattr(issue_discovery, "discover_issues", _fake_discovery(counter))
    db = str(tmp_path / "s.db")

    res = _gen(db)
    # result["issue_items"] is exactly what the Notion export consumes.
    blob = " ".join(
        f"{it.get('issue_title', '')} {it.get('summary', '')} {it.get('recommended_action', '')}"
        for it in res["issue_items"]
    )
    assert blob.strip()
    for bad in _BANNED:
        assert bad not in blob
