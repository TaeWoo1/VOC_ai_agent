"""Tests for the pure issue-cache helpers (S1b).

No SQLite, no Streamlit, no Notion, no network. Covers cache-key determinism,
canonical-label identity, and sanitize-on-serialize + JSON roundtrip.
"""

from __future__ import annotations

import json
from datetime import date

import pytest

from src.voc.review_ops.industrial.issue_cache import (
    DISCOVERY_PROMPT_VERSION,
    VERIFIER_PROMPT_VERSION,
    canonical_label,
    compute_issue_cache_key,
    corpus_hash,
    deserialize_issues,
    scope_key,
    serialize_issues,
)
from src.voc.review_ops.industrial.issue_sanitize import has_banned_wording
from src.voc.review_ops.industrial.schema import (
    IndustrialReview,
    IssueCluster,
    WorklistRow,
)


# --- corpus_hash ------------------------------------------------------------


def test_corpus_hash_order_independent():
    assert corpus_hash(["a", "b", "c"]) == corpus_hash(["c", "b", "a"])


def test_corpus_hash_dedups():
    assert corpus_hash(["a", "a", "b"]) == corpus_hash(["a", "b"])


def test_corpus_hash_changes_on_add_and_remove():
    base = corpus_hash(["a", "b"])
    assert corpus_hash(["a", "b", "c"]) != base
    assert corpus_hash(["a"]) != base


def test_corpus_hash_is_hex_sha256():
    h = corpus_hash(["a"])
    assert len(h) == 64
    int(h, 16)  # raises if not hex


# --- scope_key --------------------------------------------------------------


def test_scope_key_all_for_none_and_empty():
    assert scope_key(None) == "__ALL__"
    assert scope_key([]) == "__ALL__"
    assert scope_key([""]) == "__ALL__"


def test_scope_key_order_independent():
    assert scope_key(["전선몰딩", "선바로"]) == scope_key(["선바로", "전선몰딩"])


def test_scope_key_differs_by_products():
    assert scope_key(["전선몰딩"]) != scope_key(["선바로"])
    assert scope_key(["전선몰딩"]) != scope_key(["전선몰딩", "선바로"])


# --- compute_issue_cache_key ------------------------------------------------


def _base_key_kwargs():
    return dict(
        corpus_hash="ch",
        scope_key="sk",
        recent_days=180,
        resolved_today=date(2026, 1, 21),
        discovery_model="gpt-4o-mini",
        verifier_model="gpt-4o",
        discovery_prompt_version="v1",
        verifier_prompt_version="v1",
        max_issues=5,
        max_evidence=2,
    )


def test_cache_key_same_inputs_same_key():
    assert compute_issue_cache_key(**_base_key_kwargs()) == compute_issue_cache_key(
        **_base_key_kwargs()
    )


@pytest.mark.parametrize(
    "override",
    [
        {"corpus_hash": "ch2"},
        {"scope_key": "sk2"},
        {"recent_days": 90},
        {"resolved_today": date(2026, 1, 22)},
        {"discovery_model": "gpt-4o"},
        {"verifier_model": "gpt-4o-mini"},
        {"discovery_prompt_version": "v2"},
        {"verifier_prompt_version": "v2"},
        {"max_issues": 6},
        {"max_evidence": 3},
    ],
)
def test_cache_key_changes_when_any_component_changes(override):
    base = compute_issue_cache_key(**_base_key_kwargs())
    changed = compute_issue_cache_key(**{**_base_key_kwargs(), **override})
    assert changed != base


def test_cache_key_default_versions_are_module_constants():
    kwargs = _base_key_kwargs()
    kwargs.pop("discovery_prompt_version")
    kwargs.pop("verifier_prompt_version")
    explicit = _base_key_kwargs()
    explicit["discovery_prompt_version"] = DISCOVERY_PROMPT_VERSION
    explicit["verifier_prompt_version"] = VERIFIER_PROMPT_VERSION
    assert compute_issue_cache_key(**kwargs) == compute_issue_cache_key(**explicit)


# --- canonical_label --------------------------------------------------------


def test_canonical_label_collapses_adhesion_variants():
    a = canonical_label("접착력 부족")
    assert a == canonical_label("접착력 문제")
    assert a == canonical_label("접착력 이슈")
    assert a == "접착력"


def test_canonical_label_collapses_cut_breakage_variants():
    assert canonical_label("절단 시 깨짐") == canonical_label("절단 깨짐 문제")
    assert canonical_label("절단 시 깨짐") == "절단 깨짐"


def test_canonical_label_falls_back_when_all_tokens_generic():
    # "문제" alone would be dropped; fall back to the stripped title.
    assert canonical_label("문제") == "문제"


# --- serialize_issues -------------------------------------------------------


def _cluster():
    reps = [
        WorklistRow(
            review_id="r1",
            review_date=date(2026, 1, 10),
            channel="네이버",
            product_name="전선몰딩",
            option_name="화이트",
            rating=2.0,
            text="접착력이 약해요",
        ),
        WorklistRow(
            review_id="r2",
            review_date=None,
            channel="쿠팡",
            product_name="전선몰딩",
            option_name=None,
            rating=1.0,
            text="떨어졌어요",
        ),
    ]
    return IssueCluster(
        cluster_id="c1",
        tag="adhesion",
        tag_label="접착력",
        issue_title="접착력 부족",
        issue_type="product",
        severity="high",
        summary="접착력에 대한 원인 분석 및 개선 방안이 필요합니다.",
        recommended_action="상세페이지에 즉시 반영 필요",
        review_ids=["r1", "r2"],
        representatives=reps,
        judged=True,
    )


def test_serialize_preserves_key_fields():
    payload = serialize_issues([_cluster()])
    assert len(payload) == 1
    issue = payload[0]
    assert issue["issue_title"] == "접착력 부족"
    assert issue["tag_label"] == "접착력"
    assert issue["issue_type"] == "product"
    assert issue["severity"] == "high"
    assert issue["evidence_review_ids"] == ["r1", "r2"]
    assert issue["review_count"] == 2
    assert issue["canonical_label"] == "접착력"
    assert len(issue["representatives"]) == 2
    assert issue["representatives"][0]["review_id"] == "r1"
    assert issue["representatives"][0]["text"] == "접착력이 약해요"
    assert issue["representatives"][0]["review_date"] == "2026-01-10"
    assert issue["representatives"][1]["review_date"] is None


def test_serialize_sanitizes_text_and_leaves_no_banned_wording():
    issue = serialize_issues([_cluster()])[0]
    assert has_banned_wording(issue["summary"]) is False
    assert has_banned_wording(issue["recommended_action"]) is False
    assert issue["recommended_action"] == "상세페이지에 반영 검토 필요"


def test_serialize_does_not_mutate_input_cluster():
    cluster = _cluster()
    serialize_issues([cluster])
    # original risky wording is untouched on the source object
    assert has_banned_wording(cluster.summary) is True
    assert cluster.recommended_action == "상세페이지에 즉시 반영 필요"


def test_serialize_accepts_plain_dicts():
    item = {
        "cluster_id": "d1",
        "tag": "shipping",
        "tag_label": "배송",
        "issue_title": "배송 문제",
        "issue_type": "shipping",
        "severity": "medium",
        "summary": "배송 관련 원인 분석 필요",
        "recommended_action": "확인",
        "evidence_review_ids": ["x1"],
        "representatives": [
            {"review_id": "x1", "review_date": "2026-02-01", "channel": "쿠팡", "text": "늦게 왔어요"}
        ],
    }
    issue = serialize_issues([item])[0]
    assert issue["evidence_review_ids"] == ["x1"]
    assert issue["review_count"] == 1
    assert has_banned_wording(issue["summary"]) is False


# --- deserialize_issues -----------------------------------------------------


def test_deserialize_roundtrip_preserves_fields():
    payload = serialize_issues([_cluster()])
    # full JSON roundtrip
    payload = json.loads(json.dumps(payload))
    clusters = deserialize_issues(payload)

    assert len(clusters) == 1
    c = clusters[0]
    assert isinstance(c, IssueCluster)
    assert c.issue_title == "접착력 부족"
    assert has_banned_wording(c.summary) is False
    assert c.recommended_action == "상세페이지에 반영 검토 필요"
    assert c.severity == "high"
    assert c.review_ids == ["r1", "r2"]
    assert c.review_count == 2  # property = len(review_ids)


def test_deserialize_preserves_representatives_snapshot():
    payload = json.loads(json.dumps(serialize_issues([_cluster()])))
    c = deserialize_issues(payload)[0]
    assert [r.review_id for r in c.representatives] == ["r1", "r2"]
    assert c.representatives[0].text == "접착력이 약해요"
    assert c.representatives[0].review_date == date(2026, 1, 10)
    assert c.representatives[1].review_date is None


def test_deserialize_uses_corpus_text_when_available():
    payload = json.loads(json.dumps(serialize_issues([_cluster()])))
    corpus = {
        "r1": IndustrialReview(
            review_id="r1",
            channel="네이버",
            text="원문 텍스트",
            content_fingerprint="fp1",
            product_name="전선몰딩",
            rating=2.0,
            review_date=date(2026, 1, 10),
        )
    }
    c = deserialize_issues(payload, corpus_by_id=corpus)[0]
    # r1 pulled fresh from corpus; r2 (absent) falls back to snapshot
    assert c.representatives[0].text == "원문 텍스트"
    assert c.representatives[1].text == "떨어졌어요"
