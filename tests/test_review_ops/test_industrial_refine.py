"""LLM worklist refinement: prompt build, strict JSON parse, apply, fallback.

No network. ``refine_one`` / ``refine_worklist`` are exercised only via the pure
helpers (``parse_refinement`` / ``apply_refinements``) and the no-key path; the
OpenAI client is never constructed.
"""

from __future__ import annotations

from datetime import date, datetime

from src.voc.review_ops.industrial import refine
from src.voc.review_ops.industrial.schema import (
    HeaderStats,
    IndustrialReport,
    WorklistRow,
)


def _row(review_id: str, **kw) -> WorklistRow:
    base = dict(
        review_id=review_id,
        review_date=date(2026, 1, 21),
        channel="네이버",
        product_name="전선몰딩 1P",
        option_name="2m",
        rating=3.0,
        text="상자가 다 뚫려서 왔지만 다행히 파손 및 분실된 건 없었어요",
        tags=["delivery_packaging_damage"],
        tag_labels=["배송/포장 파손"],
        reason="배송 중 파손·포장 손상을 언급한 리뷰입니다.",
        suggested_action="주문·배송 상태를 확인하고, 답글로 교환 절차를 안내하세요.",
        tier="today",
    )
    base.update(kw)
    return WorklistRow(**base)


def _report(rows: list[WorklistRow]) -> IndustrialReport:
    return IndustrialReport(
        title="t",
        subtitle="s",
        caveat="c",
        generated_at=datetime(2026, 1, 21, 12, 0),
        header=HeaderStats(total_reviews=len(rows)),
        worklist=rows,
        appendix=[],
    )


# --- prompt -----------------------------------------------------------------


def test_build_messages_includes_review_and_current_fields():
    msgs = refine.build_messages(_row("r1"))
    assert msgs[0]["role"] == "system"
    user = msgs[1]["content"]
    assert "상자가 다 뚫려서" in user            # review text
    assert "배송 중 파손" in user                # current reason
    assert "교환 절차를 안내" in user            # current action
    assert "include_in_worklist" in user        # JSON schema hint
    assert "포장 상태 점검" in user              # packaging rule present


# --- parse_refinement -------------------------------------------------------


def test_parse_refinement_valid():
    content = (
        '{"include_in_worklist": true, "urgency": "period", '
        '"reason": "포장 손상 언급, 제품 자체 손상은 없음.", '
        '"suggested_action": "포장 상태를 점검하세요.", '
        '"tag_notes": "교환 태그는 과함", "confidence": "medium"}'
    )
    ref = refine.parse_refinement("r1", content)
    assert ref is not None
    assert ref.review_id == "r1"
    assert ref.include_in_worklist is True
    assert ref.urgency == "period"
    assert ref.confidence == "medium"
    assert "포장 상태" in ref.suggested_action


def test_parse_refinement_strips_code_fence():
    content = '```json\n{"include_in_worklist": false, "urgency": "exclude", ' \
              '"reason": "", "suggested_action": "", "confidence": "high"}\n```'
    ref = refine.parse_refinement("r1", content)
    assert ref is not None
    assert ref.include_in_worklist is False
    assert ref.urgency == "exclude"


def test_parse_refinement_exclude_normalizes_include_false():
    # urgency=exclude must force include_in_worklist=False even if model said true.
    content = (
        '{"include_in_worklist": true, "urgency": "exclude", '
        '"reason": "", "suggested_action": "", "confidence": "low"}'
    )
    ref = refine.parse_refinement("r1", content)
    assert ref is not None
    assert ref.include_in_worklist is False
    assert ref.urgency == "exclude"


def test_parse_refinement_invalid_returns_none():
    assert refine.parse_refinement("r1", "not json at all") is None
    # bad enum
    assert refine.parse_refinement(
        "r1", '{"include_in_worklist": true, "urgency": "soon", '
              '"reason": "", "suggested_action": "", "confidence": "high"}'
    ) is None
    # missing confidence
    assert refine.parse_refinement(
        "r1", '{"include_in_worklist": true, "urgency": "today", '
              '"reason": "", "suggested_action": ""}'
    ) is None
    # include not a bool
    assert refine.parse_refinement(
        "r1", '{"include_in_worklist": "yes", "urgency": "today", '
              '"reason": "", "suggested_action": "", "confidence": "high"}'
    ) is None


# --- apply_refinements ------------------------------------------------------


def test_apply_refinements_excludes_row():
    report = _report([_row("r1"), _row("r2")])
    refs = {
        "r1": refine.Refinement(
            review_id="r1", include_in_worklist=False, urgency="exclude",
            reason="", suggested_action="", confidence="high",
        )
    }
    out = refine.apply_refinements(report, refs)
    ids = [w.review_id for w in out.worklist]
    assert ids == ["r2"]  # r1 dropped, r2 (unrefined) preserved


def test_apply_refinements_updates_reason_action_tier_confidence():
    report = _report([_row("r1", tier="today")])
    refs = {
        "r1": refine.Refinement(
            review_id="r1", include_in_worklist=True, urgency="period",
            reason="포장만 손상, 제품은 정상.",
            suggested_action="포장 상태를 점검하세요.",
            confidence="medium",
        )
    }
    out = refine.apply_refinements(report, refs)
    row = out.worklist[0]
    assert row.refined is True
    assert row.confidence == "medium"
    assert row.tier == "week"  # period -> week tier
    assert row.reason == "포장만 손상, 제품은 정상."
    assert row.suggested_action == "포장 상태를 점검하세요."
    # original review text preserved verbatim
    assert "상자가 다 뚫려서" in row.text


def test_apply_refinements_leaves_unrefined_rows_unchanged():
    original = _row("r2")
    report = _report([_row("r1"), original])
    refs = {
        "r1": refine.Refinement(
            review_id="r1", include_in_worklist=True, urgency="today",
            reason="x", suggested_action="y", confidence="high",
        )
    }
    out = refine.apply_refinements(report, refs)
    untouched = next(w for w in out.worklist if w.review_id == "r2")
    assert untouched.refined is False
    assert untouched.confidence == ""
    assert untouched.reason == original.reason
    assert untouched.suggested_action == original.suggested_action


def test_apply_refinements_orders_today_before_period():
    # r1 refined to period, r2 refined to today -> today must come first.
    report = _report([_row("r1", tier="today"), _row("r2", tier="today")])
    refs = {
        "r1": refine.Refinement("r1", True, "period", "a", "b", confidence="low"),
        "r2": refine.Refinement("r2", True, "today", "c", "d", confidence="low"),
    }
    out = refine.apply_refinements(report, refs)
    assert [w.review_id for w in out.worklist] == ["r2", "r1"]


# --- refine_worklist fallback (no network) ----------------------------------


def test_refine_worklist_no_key_returns_unchanged(monkeypatch):
    # Force no key so the no-network fallback path is exercised even if a real
    # OPENAI_API_KEY is present in the local .env.
    monkeypatch.setattr(refine, "resolve_api_key", lambda: None)
    report = _report([_row("r1"), _row("r2")])
    out, summary = refine.refine_worklist(report, api_key=None, top_n=10)
    assert out is report  # unchanged object, no refinement
    assert summary["had_key"] is False
    assert summary["refined"] == 0
    assert summary["candidates"] == 2


def test_refine_worklist_empty_worklist_no_network():
    # No candidates -> returns unchanged without touching OpenAI, key or not.
    report = _report([])
    out, summary = refine.refine_worklist(report, top_n=10)
    assert out is report
    assert summary["candidates"] == 0
    assert summary["refined"] == 0
