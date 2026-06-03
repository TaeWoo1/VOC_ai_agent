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


# --- Step A: evidence_review_ids control displayed representatives -----------


def test_apply_evidence_ids_select_and_order_representatives():
    raw = [_raw("A", "delivery_packaging_damage",
                [_cand("a1", text="박스 터짐"), _cand("a2", text="포장 손상"),
                 _cand("a3", text="다목적 가위로 자르니 일부 깨지는 부분이 있어요")])]
    # judge cites only a2 then a1, NOT the off-topic cutting/breakage review a3.
    judgements = {
        "A": cluster.IssueJudgement("A", True, "포장 파손 반복", "shipping", "high",
                                    "요약", "포장 점검", ["a2", "a1"]),
    }
    out = cluster.apply_issue_clusters(_report(), raw, judgements)
    reps = out.issue_clusters[0].representatives
    assert [r.review_id for r in reps] == ["a2", "a1"]   # evidence order honored
    assert "a3" not in {r.review_id for r in reps}       # off-topic rep dropped
    # related count stays full cluster membership
    assert out.issue_clusters[0].review_ids == ["a1", "a2", "a3"]
    assert out.issue_clusters[0].review_count == 3


def test_apply_empty_evidence_falls_back_to_all_reps():
    raw = [_raw("A", "delivery_packaging_damage", [_cand("a1"), _cand("a2")])]
    judgements = {
        "A": cluster.IssueJudgement("A", True, "포장 파손", "shipping", "high",
                                    "요약", "점검", []),  # no evidence ids
    }
    out = cluster.apply_issue_clusters(_report(), raw, judgements)
    assert [r.review_id for r in out.issue_clusters[0].representatives] == ["a1", "a2"]


# --- Step B: conservative near-duplicate merge ------------------------------


def _issue(cid, *, issue_type, severity, title, review_ids, reps=None,
           summary="요약", action="조치", tag="durability_failure") -> IssueCluster:
    return IssueCluster(
        cluster_id=cid, tag=tag, tag_label=cluster._tag_label(tag),
        issue_title=title, issue_type=issue_type, severity=severity,
        summary=summary, recommended_action=action,
        review_ids=list(review_ids),
        representatives=reps or [], judged=True,
    )


def _rep(review_id) -> WorklistRow:
    return WorklistRow(
        review_id=review_id, review_date=date(2026, 1, 20), channel="네이버",
        product_name=None, option_name=None, rating=2.0, text=f"리뷰 {review_id}",
    )


def test_merge_same_type_shared_keyword_merges():
    clusters = [
        _issue("A", issue_type="product", severity="high", title="접착력 부족",
               review_ids=["a1", "a2"]),
        _issue("B", issue_type="product", severity="medium", title="접착력 문제",
               review_ids=["b1"]),
    ]
    out = cluster.merge_issue_clusters(clusters)
    assert len(out) == 1
    assert set(out[0].review_ids) == {"a1", "a2", "b1"}


def test_merge_different_type_does_not_merge_even_if_keyword_overlaps():
    clusters = [
        _issue("A", issue_type="product", severity="high", title="포장 파손",
               review_ids=["a1"]),
        _issue("B", issue_type="shipping", severity="medium", title="포장 파손",
               review_ids=["b1"]),
    ]
    out = cluster.merge_issue_clusters(clusters)
    assert len(out) == 2


def test_merge_no_shared_allowlist_keyword_does_not_merge():
    clusters = [
        _issue("A", issue_type="product", severity="high", title="색상이 달라요",
               review_ids=["a1"]),
        _issue("B", issue_type="product", severity="medium", title="냄새가 나요",
               review_ids=["b1"]),
    ]
    out = cluster.merge_issue_clusters(clusters)
    assert len(out) == 2


def test_merge_dedupes_review_ids_and_representatives():
    clusters = [
        _issue("A", issue_type="product", severity="medium", title="접착력 부족",
               review_ids=["x", "y"], reps=[_rep("x"), _rep("y")]),
        _issue("B", issue_type="product", severity="medium", title="접착 약함",
               review_ids=["y", "z"], reps=[_rep("y"), _rep("z")]),
    ]
    out = cluster.merge_issue_clusters(clusters)
    assert len(out) == 1
    assert out[0].review_ids == ["x", "y", "z"]                 # union, order-preserving, deduped
    assert [r.review_id for r in out[0].representatives] == ["x", "y", "z"]  # reps deduped


def test_merge_preserves_higher_severity_and_clearer_text():
    clusters = [
        _issue("A", issue_type="product", severity="medium", title="접착", summary="짧음",
               review_ids=["a1"]),
        _issue("B", issue_type="product", severity="high", title="접착력이 약합니다",
               summary="여러 건에서 접착력이 약하다는 의견이 반복됩니다", review_ids=["b1"]),
    ]
    out = cluster.merge_issue_clusters(clusters)
    assert len(out) == 1
    assert out[0].severity == "high"                       # higher severity kept
    assert out[0].issue_title == "접착력이 약합니다"        # longer/clearer title kept
    assert "반복됩니다" in out[0].summary                   # longer/clearer summary kept


def test_merge_empty_list():
    assert cluster.merge_issue_clusters([]) == []


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
    assert "우선 확인" in html          # operator severity label (high)
    assert "심각도 높음" not in html    # engine wording removed
    assert "배송/포장" in html          # issue-type label
    assert "원문 근거" in html          # representative-reviews label
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
