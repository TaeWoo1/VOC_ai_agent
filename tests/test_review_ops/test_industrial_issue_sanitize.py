"""Tests for the deterministic risky-wording sanitizer (S1a).

Pure module: no OpenAI, no Streamlit, no store, no network. These tests lock the
wording contract — rewrite phrasing changes must update both the source table
and the asserted mappings here in the same change.
"""

from __future__ import annotations

import pytest

from src.voc.review_ops.industrial.issue_sanitize import (
    BANNED_PHRASES,
    has_banned_wording,
    sanitize_issue_fields,
    sanitize_issue_text,
)

# --- exact rewrite mappings (wording contract) ------------------------------

_REWRITE_CASES = [
    ("원인 분석 및 개선 방안", "확인 및 보완 방향 검토"),
    ("원인 분석", "발생 여부 확인"),
    ("개선 방안", "보완 방향"),
    ("개선해야", "보완을 검토"),
    ("매출 영향", "재구매·신뢰 영향 가능성"),
    ("자동 처리", "수동 확인"),
    ("즉시 반영", "반영 검토"),
]


@pytest.mark.parametrize("raw,expected", _REWRITE_CASES)
def test_each_rewrite_maps_correctly(raw, expected):
    assert sanitize_issue_text(raw) == expected


def test_remove_bandeusi():
    # 반드시 is removed; surrounding spacing collapses cleanly.
    assert sanitize_issue_text("반드시 확인하세요") == "확인하세요"
    assert sanitize_issue_text("내용 반드시 확인") == "내용 확인"
    assert sanitize_issue_text("반드시") == ""


def test_longest_match_precedence_for_compound():
    # Must rewrite the whole compound, not 원인 분석 + 개선 방안 separately.
    out = sanitize_issue_text("원인 분석 및 개선 방안")
    assert out == "확인 및 보완 방향 검토"
    # If the constituents had fired separately we'd see 발생 여부 확인 (the
    # standalone 원인 분석 rewrite); the compound rule must win instead.
    assert "발생 여부 확인" not in out


@pytest.mark.parametrize("phrase", BANNED_PHRASES)
def test_no_banned_token_remains(phrase):
    assert has_banned_wording(phrase) is True
    assert has_banned_wording(sanitize_issue_text(phrase)) is False


@pytest.mark.parametrize("raw,_expected", _REWRITE_CASES)
def test_idempotent(raw, _expected):
    once = sanitize_issue_text(raw)
    assert sanitize_issue_text(once) == once


def test_safe_wording_unchanged():
    safe = [
        "접착력 관련 부정 의견 확인 및 보완 방향 검토",
        "절단 시 깨짐 검토",
        "배송 및 포장 관련 부정 의견 확인",
        "재구매·신뢰 영향 가능성 검토",
    ]
    for text in safe:
        assert has_banned_wording(text) is False
        assert sanitize_issue_text(text) == text


# --- real observed examples -------------------------------------------------


def test_real_examples_sanitized():
    examples = [
        "접착력 문제에 대한 원인 분석 및 개선 방안을 검토하세요.",
        "해당 문제에 대한 원인 분석 및 개선 방안을 검토하세요.",
        "상세페이지에 즉시 반영 필요",
        "답글 자동 처리 필요",
    ]
    for raw in examples:
        out = sanitize_issue_text(raw)
        assert has_banned_wording(out) is False
        # idempotent on real text too
        assert sanitize_issue_text(out) == out

    assert sanitize_issue_text("상세페이지에 즉시 반영 필요") == "상세페이지에 반영 검토 필요"
    assert sanitize_issue_text("답글 자동 처리 필요") == "답글 수동 확인 필요"


# --- natural-Korean wording polish ------------------------------------------


def test_worklist_action_phrase_reads_naturally():
    out = sanitize_issue_text("제품의 내구성 및 품질을 점검하고, 필요시 개선 방안을 마련하세요.")
    assert out == "제품의 내구성 및 품질을 점검하고, 필요하면 보완 여부를 검토하세요."
    assert "개선 방안" not in out
    assert "검토을" not in out


def test_improvement_plan_action_variants_natural():
    assert sanitize_issue_text("개선 방안을 마련하세요") == "보완 여부를 검토하세요"
    assert sanitize_issue_text("필요하면 개선 방안을 마련하세요") == "필요하면 보완 여부를 검토하세요"
    assert sanitize_issue_text("필요시 개선 방안을 마련하세요") == "필요하면 보완 여부를 검토하세요"


def test_compound_action_verb_clean():
    out = sanitize_issue_text("원인 분석 및 개선 방안을 검토하세요")
    assert "원인 분석" not in out
    assert "개선 방안" not in out
    assert "검토을" not in out
    assert out == "확인 및 보완 방향을 검토하세요"


def test_standalone_wonin_bunseok_natural():
    out = sanitize_issue_text("원인 분석")
    assert out == "발생 여부 확인"
    assert "원인 분석" not in out


def test_no_geomto_eul_artifact_anywhere():
    for raw in (
        "제품의 내구성 및 품질을 점검하고, 필요시 개선 방안을 마련하세요.",
        "원인 분석 및 개선 방안을 검토하세요",
        "개선 방안을 마련하세요",
        "원인 분석 및 개선 방안을 세우세요",  # arbitrary trailing verb
        "접착력에 대한 원인 분석 및 개선 방안이 필요합니다.",  # subject particle
    ):
        out = sanitize_issue_text(raw)
        assert "검토을" not in out, raw
        assert "검토이" not in out, raw
        assert has_banned_wording(out) is False, raw
        assert sanitize_issue_text(out) == out, raw  # idempotent


# --- sanitize_issue_fields --------------------------------------------------


def _issue():
    return {
        "issue_title": "접착력 문제",
        "summary": "접착력에 대한 원인 분석 및 개선 방안이 필요합니다.",
        "recommended_action": "상세페이지에 즉시 반영 필요",
        "severity": "high",
        "severity_label": "높음",
        "review_count": 7,
        "tag_label": "접착력",
        "evidence_review_ids": ["r1", "r2", "r3"],
    }


def test_sanitize_issue_fields_does_not_mutate_input():
    original = _issue()
    snapshot = dict(original)
    snapshot_ids = list(original["evidence_review_ids"])
    out = sanitize_issue_fields(original)

    assert original == snapshot
    assert original["evidence_review_ids"] == snapshot_ids
    assert out is not original


def test_sanitize_issue_fields_only_text_fields_change():
    out = sanitize_issue_fields(_issue())

    assert has_banned_wording(out["summary"]) is False
    assert out["recommended_action"] == "상세페이지에 반영 검토 필요"

    # non-text fields preserved exactly
    assert out["severity"] == "high"
    assert out["severity_label"] == "높음"
    assert out["review_count"] == 7
    assert out["tag_label"] == "접착력"
    assert out["evidence_review_ids"] == ["r1", "r2", "r3"]


def test_sanitize_issue_fields_handles_missing_and_nonstring_fields():
    issue = {"issue_title": "접착력 문제", "review_count": 3}
    out = sanitize_issue_fields(issue)
    assert out["issue_title"] == "접착력 문제"
    assert out["review_count"] == 3
    # missing summary / recommended_action are simply absent, not injected
    assert "summary" not in out
    assert "recommended_action" not in out
