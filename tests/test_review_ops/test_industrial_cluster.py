"""Cluster-based repeated-issue rollup: candidate selection, deterministic
clustering, strict JSON judge parse/apply, and HTML rendering.

No network. ``judge_cluster`` / ``cluster_issues`` are exercised only via the
pure helpers and the no-key path; the OpenAI client is never constructed.
"""

from __future__ import annotations

from datetime import date, datetime

from src.voc.review_ops.industrial import cluster
from src.voc.review_ops.industrial.render_html import render_report_html
from src.voc.review_ops.industrial.schema import (
    HeaderStats,
    IndustrialReport,
    IndustrialReview,
    IssueCluster,
    WorklistRow,
)

TODAY = date(2026, 1, 21)


def _review(review_id: str, text: str, *, rating=2.0, d=date(2026, 1, 20), channel="네이버") -> IndustrialReview:
    return IndustrialReview(
        review_id=review_id,
        channel=channel,
        text=text,
        content_fingerprint="x" * 64,
        rating=rating,
        review_date=d,
    )


def _cand(review_id: str, *, primary_tag="delivery_packaging_damage", rating=2.0, text="박스 파손", d=date(2026, 1, 20)) -> cluster.ClusterCandidate:
    tags = [primary_tag] if primary_tag != cluster.LOW_RATING_BUCKET else []
    return cluster.ClusterCandidate(
        review=_review(review_id, text, rating=rating, d=d),
        tags=tags,
        primary_tag=primary_tag,
    )


def _report(worklist=None) -> IndustrialReport:
    return IndustrialReport(
        title="t",
        subtitle="s",
        caveat="c",
        generated_at=datetime(2026, 1, 21, 12, 0),
        header=HeaderStats(total_reviews=0),
        worklist=worklist or [],
        appendix=[],
    )


# --- select_cluster_candidates ----------------------------------------------


def test_select_candidates_includes_risk_and_low_excludes_positive_and_old():
    reviews = [
        _review("a", "박스가 터져서 왔어요. 교환 가능한가요?", rating=1.0, d=date(2026, 1, 20)),
        _review("b", "튼튼하고 만족합니다. 재구매했어요", rating=5.0, d=date(2026, 1, 20)),
        _review("c", "가성비가 좋습니다", rating=3.0, d=date(2026, 1, 20)),
        _review("d", "박스가 터져서 왔어요", rating=1.0, d=date(2025, 1, 1)),  # old
    ]
    cands = cluster.select_cluster_candidates(reviews, today=TODAY, recent_days=30)
    ids = {c.review.review_id for c in cands}
    assert "a" in ids        # recent risk tag
    assert "c" in ids        # recent low rating (no forcing tag)
    assert "b" not in ids    # positive, high rating, no forcing tag
    assert "d" not in ids    # too old


def test_select_candidate_primary_tag_falls_back_to_low_rating_bucket():
    reviews = [_review("c", "가성비가 좋습니다", rating=3.0, d=date(2026, 1, 20))]
    cands = cluster.select_cluster_candidates(reviews, today=TODAY, recent_days=30)
    assert len(cands) == 1
    assert cands[0].primary_tag == cluster.LOW_RATING_BUCKET


# --- cluster_candidates -----------------------------------------------------


def test_cluster_candidates_groups_similar_and_drops_singletons():
    cands = [_cand("a"), _cand("b"), _cand("c")]
    embeddings = {"a": [1.0, 0.0], "b": [0.99, 0.1], "c": [0.0, 1.0]}
    raw = cluster.cluster_candidates(cands, embeddings, sim_threshold=0.5)
    assert len(raw) == 1                       # a+b cluster; c singleton dropped
    members = {m.review.review_id for m in raw[0].members}
    assert members == {"a", "b"}


def test_cluster_candidates_min_size_drops_all_when_dissimilar():
    cands = [_cand("a"), _cand("b")]
    embeddings = {"a": [1.0, 0.0], "b": [0.0, 1.0]}  # orthogonal -> two singletons
    raw = cluster.cluster_candidates(cands, embeddings, sim_threshold=0.5)
    assert raw == []


def test_cluster_candidates_respects_max_clusters():
    cands = [_cand(c) for c in ("p1a", "p1b", "p2a", "p2b", "p3a", "p3b")]
    embeddings = {
        "p1a": [1.0, 0.0, 0.0], "p1b": [1.0, 0.0, 0.0],
        "p2a": [0.0, 1.0, 0.0], "p2b": [0.0, 1.0, 0.0],
        "p3a": [0.0, 0.0, 1.0], "p3b": [0.0, 0.0, 1.0],
    }
    raw = cluster.cluster_candidates(cands, embeddings, sim_threshold=0.5, max_clusters=2)
    assert len(raw) == 2
    assert all(len(rc.members) == 2 for rc in raw)


def test_cluster_candidates_groups_by_tag_before_similarity():
    # identical embeddings but different primary tags must NOT cluster together.
    cands = [_cand("a", primary_tag="delivery_packaging_damage"),
             _cand("b", primary_tag="spec_size_confusion")]
    embeddings = {"a": [1.0, 0.0], "b": [1.0, 0.0]}
    raw = cluster.cluster_candidates(cands, embeddings, sim_threshold=0.5)
    assert raw == []  # each tag group has a single member -> dropped


# --- pick_representatives ----------------------------------------------------


def test_pick_representatives_caps_and_orders_worst_first():
    cands = [_cand(f"r{i}", rating=float(i)) for i in (5, 4, 3, 2, 1, 5)]
    reps = cluster.pick_representatives(cands, max_representatives=5)
    assert len(reps) == 5
    assert reps[0].review.rating == 1.0  # lowest rating first (worst-first)


# --- parse_issue_judgement --------------------------------------------------


def test_parse_issue_judgement_valid():
    content = (
        '{"is_real_issue": true, "issue_title": "포장 파손 반복", '
        '"issue_type": "shipping", "severity": "high", '
        '"summary": "여러 건에서 박스 파손이 반복됩니다.", '
        '"recommended_action": "포장 상태를 점검할 후보로 봐주세요.", '
        '"evidence_review_ids": ["a", "b"]}'
    )
    j = cluster.parse_issue_judgement("cid", content, ["a", "b"])
    assert j is not None
    assert j.is_real_issue is True
    assert j.issue_type == "shipping"
    assert j.severity == "high"
    assert j.evidence_review_ids == ["a", "b"]


def test_parse_issue_judgement_strips_code_fence():
    content = (
        '```json\n{"is_real_issue": false, "issue_title": "", '
        '"issue_type": "ignore", "severity": "low", "summary": "", '
        '"recommended_action": "", "evidence_review_ids": []}\n```'
    )
    j = cluster.parse_issue_judgement("cid", content, [])
    assert j is not None
    assert j.is_real_issue is False
    assert j.issue_type == "ignore"


def test_parse_issue_judgement_invalid_returns_none():
    assert cluster.parse_issue_judgement("cid", "not json", ["a"]) is None
    # bad issue_type
    assert cluster.parse_issue_judgement(
        "cid", '{"is_real_issue": true, "issue_title": "t", "issue_type": "bug", '
        '"severity": "high", "summary": "s", "recommended_action": "a", '
        '"evidence_review_ids": []}', ["a"]
    ) is None
    # bad severity
    assert cluster.parse_issue_judgement(
        "cid", '{"is_real_issue": true, "issue_title": "t", "issue_type": "product", '
        '"severity": "urgent", "summary": "s", "recommended_action": "a", '
        '"evidence_review_ids": []}', ["a"]
    ) is None
    # is_real_issue not a bool
    assert cluster.parse_issue_judgement(
        "cid", '{"is_real_issue": "yes", "issue_title": "t", "issue_type": "product", '
        '"severity": "high", "summary": "s", "recommended_action": "a", '
        '"evidence_review_ids": []}', ["a"]
    ) is None
    # real issue but empty title -> None
    assert cluster.parse_issue_judgement(
        "cid", '{"is_real_issue": true, "issue_title": "", "issue_type": "product", '
        '"severity": "high", "summary": "s", "recommended_action": "a", '
        '"evidence_review_ids": []}', ["a"]
    ) is None


def test_parse_issue_judgement_evidence_subset_enforced():
    content = (
        '{"is_real_issue": true, "issue_title": "t", "issue_type": "product", '
        '"severity": "medium", "summary": "s", "recommended_action": "a", '
        '"evidence_review_ids": ["a", "x", "b", "a"]}'
    )
    j = cluster.parse_issue_judgement("cid", content, ["a", "b"])
    assert j is not None
    assert j.evidence_review_ids == ["a", "b"]  # "x" dropped, dedup preserved


# --- apply_issue_clusters ---------------------------------------------------


def _raw(cluster_id: str, tag: str, cands: list[cluster.ClusterCandidate]) -> cluster.RawCluster:
    return cluster.RawCluster(
        cluster_id=cluster_id,
        tag=tag,
        tag_label=cluster._tag_label(tag),
        members=cands,
        representatives=cands[:5],
    )


def test_apply_issue_clusters_keeps_only_real_non_ignore():
    raw = [
        _raw("A", "delivery_packaging_damage", [_cand("a1"), _cand("a2")]),
        _raw("B", "spec_size_confusion", [_cand("b1", primary_tag="spec_size_confusion"),
                                          _cand("b2", primary_tag="spec_size_confusion")]),
        _raw("C", "cs_exchange_return_issue", [_cand("c1", primary_tag="cs_exchange_return_issue"),
                                               _cand("c2", primary_tag="cs_exchange_return_issue")]),
        _raw("D", "installation_difficulty", [_cand("d1", primary_tag="installation_difficulty"),
                                              _cand("d2", primary_tag="installation_difficulty")]),
    ]
    judgements = {
        "A": cluster.IssueJudgement("A", True, "포장 파손 반복", "shipping", "high",
                                    "요약", "포장 점검", ["a1"]),
        "B": cluster.IssueJudgement("B", False, "", "ignore", "low", "", "", []),
        "C": cluster.IssueJudgement("C", True, "교환 문의 반복", "cs", "medium",
                                    "요약", "답글 안내", ["c1"]),
        # D: no judgement -> dropped (no fabricated fallback)
    }
    out = cluster.apply_issue_clusters(_report(), raw, judgements)
    ids = [c.cluster_id for c in out.issue_clusters]
    assert ids == ["A", "C"]  # B dropped (false/ignore), D dropped (no judgement)
    # high severity first
    assert out.issue_clusters[0].severity == "high"
    a = out.issue_clusters[0]
    assert a.judged is True
    assert a.review_ids == ["a1", "a2"]
    assert a.review_count == 2
    assert all(isinstance(r, WorklistRow) for r in a.representatives)


def test_apply_issue_clusters_empty_leaves_report_unchanged():
    out = cluster.apply_issue_clusters(_report(), [], {})
    assert out.issue_clusters == []


# --- render_html ------------------------------------------------------------


def test_render_html_with_issue_clusters():
    rep = WorklistRow(
        review_id="a1", review_date=date(2026, 1, 20), channel="네이버",
        product_name="전선몰딩 1P", option_name="2m", rating=1.0,
        text="박스가 터져서 왔어요",
        tags=["delivery_packaging_damage"], tag_labels=["배송/포장 파손"],
    )
    issue = IssueCluster(
        cluster_id="A", tag="delivery_packaging_damage", tag_label="배송/포장 파손",
        issue_title="포장 파손이 반복됩니다", issue_type="shipping", severity="high",
        summary="여러 건에서 박스 파손이 확인됩니다.",
        recommended_action="포장 상태를 점검할 후보로 봐주세요.",
        review_ids=["a1", "a2"], representatives=[rep], judged=True,
    )
    report = _report()
    report.issue_clusters = [issue]
    html = render_report_html(report, recent_days=30)
    assert "반복 이슈" in html
    assert "포장 파손이 반복됩니다" in html
    assert "관련 리뷰 2건" in html
    assert "심각도 높음" in html       # severity label
    assert "배송/포장" in html          # issue-type label
    assert "여러 건에서 박스 파손" in html  # summary
    assert "포장 상태를 점검할 후보" in html  # action
    assert "박스가 터져서 왔어요" in html      # representative original text
    # issue section appears above the worklist
    assert html.index("반복 이슈") < html.index("오늘 먼저 볼 리뷰")


def test_render_html_no_clusters_omits_section():
    html = render_report_html(_report(), recent_days=30)
    assert "반복 이슈" not in html
    # worklist headings still present (old behavior intact)
    assert "오늘 먼저 볼 리뷰" in html
    assert "최근 30일 내 확인할 리뷰" in html


# --- cluster_issues fallback (no network) -----------------------------------


def test_cluster_issues_no_key_returns_unchanged(monkeypatch):
    monkeypatch.setattr(cluster, "resolve_api_key", lambda: None)
    reviews = [_review("a", "박스가 터져서 왔어요", rating=1.0, d=date(2026, 1, 20))]
    report = _report()
    out, summary = cluster.cluster_issues(report, reviews, api_key=None, today=TODAY, recent_days=30)
    assert out is report
    assert summary["had_key"] is False
    assert summary["issues"] == 0
    assert summary["candidates"] == 1


def test_cluster_issues_no_candidates_no_network():
    out, summary = cluster.cluster_issues(_report(), [], today=TODAY, recent_days=30)
    assert out.issue_clusters == []
    assert summary["candidates"] == 0
    assert summary["issues"] == 0
