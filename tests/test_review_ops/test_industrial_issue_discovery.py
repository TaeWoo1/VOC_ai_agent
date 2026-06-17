"""LLM issue discovery: pure parse/validate/map + engine orchestration.

No network — ``discover_issues_llm`` is monkeypatched; the OpenAI client is never
constructed.
"""

from __future__ import annotations

import json
from datetime import date, datetime

from src.voc.review_ops.industrial import cluster, issue_discovery
from src.voc.review_ops.industrial.issue_discovery import (
    DiscoveredIssue,
    build_discovery_messages,
    discover_issues,
    map_issues_to_clusters,
    parse_discovery,
)
from src.voc.review_ops.industrial.schema import (
    HeaderStats,
    IndustrialReport,
    IndustrialReview,
)


def _cand(rid, text="접착력이 약해요", primary_tag="delivery_packaging_damage",
          rating=2.0, d=date(2026, 1, 20)) -> cluster.ClusterCandidate:
    rv = IndustrialReview(
        review_id=rid, channel="네이버", text=text, content_fingerprint="x" * 64,
        rating=rating, review_date=d, product_name="전선몰딩 1P", option_name="2m",
    )
    tags = [primary_tag] if primary_tag != cluster.LOW_RATING_BUCKET else []
    return cluster.ClusterCandidate(review=rv, tags=tags, primary_tag=primary_tag)


def _report() -> IndustrialReport:
    return IndustrialReport(
        title="t", subtitle="s", caveat="c",
        generated_at=datetime(2026, 1, 21, 12, 0),
        header=HeaderStats(total_reviews=0), worklist=[], appendix=[],
    )


def _issue_json(**kw) -> dict:
    base = {
        "issue_title": "접착력 부족",
        "issue_type": "product",
        "priority": "high",
        "summary": "접착력이 약하다는 의견이 반복됩니다.",
        "recommended_action": "양면테이프 보강 안내를 추가할 후보입니다.",
        "evidence_review_ids": ["a", "b"],
        "excluded_review_ids": [],
        "why_excluded": "",
    }
    base.update(kw)
    return base


# --- parse ------------------------------------------------------------------


def test_parse_valid_json_to_issues():
    content = json.dumps({"issues": [_issue_json()]})
    out = parse_discovery(content, ["a", "b", "c"])
    assert out is not None and len(out) == 1
    assert out[0].issue_title == "접착력 부족"
    assert out[0].evidence_review_ids == ["a", "b"]


def test_parse_invalid_json_returns_none():
    assert parse_discovery("not json {", ["a", "b"]) is None


def test_parse_non_object_returns_none():
    assert parse_discovery("[]", ["a", "b"]) is None  # top-level list, not object


def test_parse_issues_not_a_list_returns_none():
    assert parse_discovery(json.dumps({"issues": "x"}), ["a", "b"]) is None


def test_parse_empty_issues_is_valid():
    out = parse_discovery(json.dumps({"issues": []}), ["a", "b"])
    assert out == []  # valid zero-issue answer, NOT a hard failure


def test_parse_drops_issue_with_under_two_evidence():
    content = json.dumps({"issues": [_issue_json(evidence_review_ids=["a"])]})
    assert parse_discovery(content, ["a", "b"]) == []


def test_parse_strips_evidence_outside_candidate_set():
    content = json.dumps({"issues": [_issue_json(evidence_review_ids=["a", "b", "zzz"])]})
    out = parse_discovery(content, ["a", "b"])
    assert out[0].evidence_review_ids == ["a", "b"]  # zzz stripped


def test_parse_dedupes_evidence_ids_preserving_order():
    content = json.dumps({"issues": [_issue_json(evidence_review_ids=["b", "b", "a"])]})
    out = parse_discovery(content, ["a", "b"])
    assert out[0].evidence_review_ids == ["b", "a"]


def test_parse_drops_ignore_issue_type():
    content = json.dumps({"issues": [_issue_json(issue_type="ignore")]})
    assert parse_discovery(content, ["a", "b"]) == []


def test_parse_drops_invalid_item_but_keeps_others():
    good = _issue_json()
    bad = _issue_json(priority="urgent")  # invalid priority
    content = json.dumps({"issues": [bad, good]})
    out = parse_discovery(content, ["a", "b"])
    assert len(out) == 1 and out[0].issue_title == "접착력 부족"


def test_parse_keeps_unrelated_issues_separate():
    i1 = _issue_json(issue_title="접착력 부족", evidence_review_ids=["a", "b"])
    i2 = _issue_json(issue_title="절단 시 깨짐", issue_type="product",
                     evidence_review_ids=["c", "d"])
    out = parse_discovery(json.dumps({"issues": [i1, i2]}), ["a", "b", "c", "d"])
    assert [i.issue_title for i in out] == ["접착력 부족", "절단 시 깨짐"]


# --- map --------------------------------------------------------------------


def test_map_caps_displayed_evidence_by_max_evidence():
    cand_by_id = {r: _cand(r) for r in ["a", "b", "c", "d"]}
    issue = DiscoveredIssue("접착력 부족", "product", "high", "요약", "조치",
                            ["a", "b", "c", "d"])
    clusters = map_issues_to_clusters([issue], cand_by_id, max_evidence=2)
    c = clusters[0]
    assert len(c.representatives) == 2                      # display capped
    assert c.review_ids == ["a", "b", "c", "d"]             # supported evidence kept
    assert c.review_count == 4


def test_map_review_count_equals_supported_evidence():
    cand_by_id = {r: _cand(r) for r in ["a", "b", "c"]}
    issue = DiscoveredIssue("접착력 부족", "product", "medium", "요약", "조치", ["a", "b", "c"])
    c = map_issues_to_clusters([issue], cand_by_id)[0]
    assert c.review_count == 3
    assert c.severity == "medium"          # priority -> severity
    assert c.judged is True


def test_map_two_issues_two_clusters():
    cand_by_id = {r: _cand(r) for r in ["a", "b", "c", "d"]}
    issues = [
        DiscoveredIssue("접착력 부족", "product", "high", "요약", "조치", ["a", "b"]),
        DiscoveredIssue("절단 시 깨짐", "product", "high", "요약", "조치", ["c", "d"]),
    ]
    clusters = map_issues_to_clusters(issues, cand_by_id)
    assert len(clusters) == 2
    assert {c.issue_title for c in clusters} == {"접착력 부족", "절단 시 깨짐"}


# --- prompt -----------------------------------------------------------------


def test_prompt_contains_required_instructions():
    user = build_discovery_messages([_cand("a"), _cand("b")])[-1]["content"]
    assert "하나의 문제만" in user        # single-topic
    assert "직접 뒷받침" in user          # evidence-fit
    assert "2건 미만" in user             # min-2
    assert "issues" in user and "[]" in user  # zero-issues allowed
    assert "후보입니다" in user           # concrete action exemplar
    assert "점검하고 개선 방안을 검토" in user  # named as the vague phrase to avoid


# --- discover_issues orchestration (monkeypatched LLM) ----------------------


def _reviews(n, *, recent=True):
    d = date(2026, 1, 20) if recent else date(2025, 1, 1)
    return [
        IndustrialReview(
            review_id=f"r{i}", channel="네이버", text=f"접착력이 약해요 {i}",
            content_fingerprint="x" * 64, rating=1.0, review_date=d,
        )
        for i in range(n)
    ]


def test_discover_hard_failure_signals_fallback(monkeypatch):
    monkeypatch.setattr(issue_discovery, "discover_issues_llm", lambda *a, **k: None)
    report, summary = discover_issues(_report(), _reviews(5), api_key="x",
                                      today=date(2026, 1, 21), recent_days=90)
    assert summary["status"] == "hard_failure"
    assert report.issue_clusters == []


def test_discover_zero_issues_is_ok_no_fallback(monkeypatch):
    monkeypatch.setattr(issue_discovery, "discover_issues_llm", lambda *a, **k: [])
    report, summary = discover_issues(_report(), _reviews(5), api_key="x",
                                      today=date(2026, 1, 21), recent_days=90)
    assert summary["status"] == "ok"
    assert summary["issues"] == 0
    assert report.issue_clusters == []


def test_discover_maps_issues(monkeypatch):
    def fake_llm(cands, **k):
        ids = [c.review.review_id for c in cands][:2]
        return [DiscoveredIssue("접착력 부족", "product", "high", "요약", "조치", ids)]
    monkeypatch.setattr(issue_discovery, "discover_issues_llm", fake_llm)
    # verifier confirms all proposed evidence
    monkeypatch.setattr(issue_discovery, "verify_issue_evidence_llm",
                        lambda issue, cands, **k: {c.review.review_id for c in cands})
    report, summary = discover_issues(_report(), _reviews(5), api_key="x",
                                      today=date(2026, 1, 21), recent_days=90)
    assert summary["status"] == "ok" and summary["issues"] == 1
    assert summary["verifier_used"] is True
    assert report.issue_clusters[0].issue_title == "접착력 부족"


def test_discover_no_key_status(monkeypatch):
    # no explicit key AND no resolvable env key -> no_key (don't touch the LLM).
    monkeypatch.setattr(issue_discovery, "resolve_api_key", lambda: None)
    report, summary = discover_issues(_report(), _reviews(5), api_key=None,
                                      today=date(2026, 1, 21), recent_days=90)
    assert summary["status"] == "no_key"
    assert report.issue_clusters == []


def test_discover_caps_candidates_at_60(monkeypatch):
    seen = {}

    def fake_llm(cands, **k):
        seen["n"] = len(cands)
        return []
    monkeypatch.setattr(issue_discovery, "discover_issues_llm", fake_llm)
    discover_issues(_report(), _reviews(70), api_key="x",
                    today=date(2026, 1, 21), recent_days=90)
    assert seen["n"] == issue_discovery.MAX_CANDIDATES == 60


# --- Stage 2: evidence-fit verifier -----------------------------------------


def _verify_json(*checks) -> str:
    return json.dumps({"evidence_checks": list(checks)})


def test_parse_verifier_valid():
    content = _verify_json(
        {"review_id": "a", "supports_issue": True, "reason": "r", "better_issue_type": "shipping"},
        {"review_id": "b", "supports_issue": False, "reason": "다른 문제", "better_issue_type": "product"},
    )
    out = issue_discovery.parse_verifier(content, ["a", "b"])
    assert out is not None and len(out) == 2
    assert out[0].supports_issue is True and out[1].supports_issue is False


def test_parse_verifier_invalid_json_returns_none():
    assert issue_discovery.parse_verifier("nope {", ["a"]) is None


def test_parse_verifier_checks_not_list_returns_none():
    assert issue_discovery.parse_verifier(json.dumps({"evidence_checks": {}}), ["a"]) is None


def test_parse_verifier_skips_unknown_ids_and_bad_bool():
    content = _verify_json(
        {"review_id": "zzz", "supports_issue": True},          # unknown id -> skip
        {"review_id": "a", "supports_issue": "yes"},           # bad bool -> skip
        {"review_id": "b", "supports_issue": True, "better_issue_type": "weird"},  # coerced unknown
    )
    out = issue_discovery.parse_verifier(content, ["a", "b"])
    assert [c.review_id for c in out] == ["b"]
    assert out[0].better_issue_type == "unknown"


def _shipping_reviews():
    # p1/p2 are genuine packaging; cut is product cutting/breakage during use.
    return [
        IndustrialReview(review_id="p1", channel="네이버", text="박스가 다 뚫려서 왔어요",
                         content_fingerprint="x" * 64, rating=2.0, review_date=date(2026, 1, 20)),
        IndustrialReview(review_id="p2", channel="네이버", text="상자가 찌그러져 왔습니다",
                         content_fingerprint="x" * 64, rating=2.0, review_date=date(2026, 1, 20)),
        IndustrialReview(review_id="cut", channel="네이버", text="자르니까 깨져요",
                         content_fingerprint="x" * 64, rating=2.0, review_date=date(2026, 1, 20)),
    ]


def _patch_discovery_shipping(monkeypatch, evidence=("p1", "p2", "cut")):
    monkeypatch.setattr(
        issue_discovery, "discover_issues_llm",
        lambda cands, **k: [DiscoveredIssue("배송 포장 손상", "shipping", "medium",
                                            "포장 손상", "포장 점검하세요", list(evidence))],
    )


def test_verifier_rejects_offtopic_evidence(monkeypatch):
    _patch_discovery_shipping(monkeypatch)
    monkeypatch.setattr(issue_discovery, "verify_issue_evidence_llm",
                        lambda issue, cands, **k: {"p1", "p2"})  # cut rejected
    report, summary = discover_issues(_report(), _shipping_reviews(), api_key="x",
                                      today=date(2026, 1, 21), recent_days=90)
    assert len(report.issue_clusters) == 1
    ids = report.issue_clusters[0].review_ids
    assert set(ids) == {"p1", "p2"} and "cut" not in ids
    assert summary["evidence_rejected"] == 1
    assert summary["verifier_used"] is True


def test_verifier_drops_issue_when_under_two_supported(monkeypatch):
    _patch_discovery_shipping(monkeypatch)
    monkeypatch.setattr(issue_discovery, "verify_issue_evidence_llm",
                        lambda issue, cands, **k: {"p1"})  # only 1 supported
    report, summary = discover_issues(_report(), _shipping_reviews(), api_key="x",
                                      today=date(2026, 1, 21), recent_days=90)
    assert report.issue_clusters == []
    assert summary["status"] == "ok"  # valid zero issues, NOT a fallback


def test_verifier_rejects_all_yields_zero_issues(monkeypatch):
    _patch_discovery_shipping(monkeypatch)
    monkeypatch.setattr(issue_discovery, "verify_issue_evidence_llm",
                        lambda issue, cands, **k: set())
    report, summary = discover_issues(_report(), _shipping_reviews(), api_key="x",
                                      today=date(2026, 1, 21), recent_days=90)
    assert report.issue_clusters == [] and summary["status"] == "ok"


def test_verifier_hard_failure_drops_only_that_issue(monkeypatch):
    a = DiscoveredIssue("A", "product", "high", "s", "조치", ["p1", "p2"])
    b = DiscoveredIssue("B", "product", "high", "s", "조치", ["cut", "p1"])
    monkeypatch.setattr(issue_discovery, "discover_issues_llm", lambda cands, **k: [a, b])

    def fake_ver(issue, cands, **k):
        return None if issue.issue_title == "A" else {c.review.review_id for c in cands}
    monkeypatch.setattr(issue_discovery, "verify_issue_evidence_llm", fake_ver)
    report, summary = discover_issues(_report(), _shipping_reviews(), api_key="x",
                                      today=date(2026, 1, 21), recent_days=90)
    titles = [c.issue_title for c in report.issue_clusters]
    assert titles == ["B"]  # A dropped (verifier hard fail), B kept; engine not aborted


def test_verifier_ignores_evidence_outside_candidates(monkeypatch):
    monkeypatch.setattr(
        issue_discovery, "discover_issues_llm",
        lambda cands, **k: [DiscoveredIssue("배송 포장 손상", "shipping", "medium",
                                            "s", "조치", ["p1", "p2", "zzz"])],
    )
    captured = {}

    def fake_ver(issue, cands, **k):
        captured["ids"] = [c.review.review_id for c in cands]
        return {c.review.review_id for c in cands}
    monkeypatch.setattr(issue_discovery, "verify_issue_evidence_llm", fake_ver)
    report, _ = discover_issues(_report(), _shipping_reviews(), api_key="x",
                                today=date(2026, 1, 21), recent_days=90)
    assert "zzz" not in captured["ids"]  # unknown id filtered before verification
    assert set(report.issue_clusters[0].review_ids) == {"p1", "p2"}


def test_verifier_model_defaults_to_gpt4o(monkeypatch):
    monkeypatch.delenv("OPENAI_ISSUE_VERIFIER_MODEL", raising=False)
    assert issue_discovery.verifier_model() == "gpt-4o"
    monkeypatch.setenv("OPENAI_ISSUE_VERIFIER_MODEL", "gpt-4o-custom")
    assert issue_discovery.verifier_model() == "gpt-4o-custom"
