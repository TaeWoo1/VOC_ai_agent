"""Tests for angle_selection.

Pure function — no I/O, no LLM. Determinism is the contract.
"""
from __future__ import annotations

import pytest

from src.voc.content.angle_selection import (
    ANGLE_MODES,
    AngleSelectionError,
    SelectedAngle,
    select_angle,
)


def _candidates() -> list[dict]:
    """Mirrors the live brief shape from Phase C."""
    return [
        {"angle_id": "h1", "type": "tradeoff", "priority_score": 1.00, "evidence_n": 252, "ko": "의견이 갈린 발색"},
        {"angle_id": "h2", "type": "strength", "priority_score": 0.68, "evidence_n": 181, "ko": "리뷰에서 반복된 발색 호평"},
        {"angle_id": "h3", "type": "tradeoff", "priority_score": 0.23, "evidence_n": 59,  "ko": "의견이 갈린 지속력"},
        {"angle_id": "h6", "type": "risk",     "priority_score": 0.14, "evidence_n": 38,  "ko": "구매 전 확인할 묻어남"},
        {"angle_id": "h8", "type": "segment",  "priority_score": 0.11, "evidence_n": 32,  "ko": "건성 피부에서 반복된 사용감"},
    ]


class TestAutoMode:
    def test_picks_first_suggestion(self):
        sel = select_angle(_candidates(), suggestions=["h2", "h6"], mode="auto")
        assert sel.angle_id == "h2"
        assert sel.selection_mode == "auto"
        assert "channel suggestions[0]" in sel.selection_reason
        assert sel.fallback_chain == ()

    def test_skips_unresolvable_suggestion(self):
        sel = select_angle(_candidates(), suggestions=["h_missing", "h6"], mode="auto")
        assert sel.angle_id == "h6"

    def test_falls_back_to_top_priority_when_no_suggestions_resolve(self):
        sel = select_angle(_candidates(), suggestions=["h_missing"], mode="auto")
        assert sel.angle_id == "h1"  # priority 1.00
        assert "top priority_score" in sel.selection_reason

    def test_no_suggestions_picks_top_priority(self):
        sel = select_angle(_candidates(), suggestions=None, mode="auto")
        assert sel.angle_id == "h1"


class TestTypeFirstModes:
    def test_strength_first(self):
        sel = select_angle(_candidates(), suggestions=["h1"], mode="strength_first")
        assert sel.angle_id == "h2"
        assert sel.selection_mode == "strength_first"
        assert sel.fallback_chain == ()
        assert "top strength" in sel.selection_reason

    def test_tradeoff_first(self):
        sel = select_angle(_candidates(), mode="tradeoff_first")
        assert sel.angle_id == "h1"
        assert sel.angle["type"] == "tradeoff"

    def test_risk_first(self):
        sel = select_angle(_candidates(), mode="risk_first")
        assert sel.angle_id == "h6"
        assert sel.angle["type"] == "risk"

    def test_segment_first(self):
        sel = select_angle(_candidates(), mode="segment_first")
        assert sel.angle_id == "h8"

    def test_falls_back_to_auto_when_type_absent(self):
        # Strip all risk-type candidates; risk_first → auto.
        cands = [c for c in _candidates() if c["type"] != "risk"]
        sel = select_angle(cands, suggestions=["h2"], mode="risk_first")
        assert sel.angle_id == "h2"  # via auto via suggestions[0]
        assert sel.selection_mode == "auto"
        assert sel.fallback_chain == ("risk_first",)
        assert "fallback to auto after risk_first" in sel.selection_reason


class TestErrorPaths:
    def test_empty_candidates_raises(self):
        with pytest.raises(AngleSelectionError):
            select_angle([], suggestions=["h1"], mode="auto")

    def test_unknown_mode_raises(self):
        with pytest.raises(ValueError, match="unknown angle mode"):
            select_angle(_candidates(), mode="weighted_random")  # type: ignore[arg-type]


class TestDeterminism:
    def test_same_inputs_same_output(self):
        a = select_angle(_candidates(), suggestions=["h2"], mode="auto")
        b = select_angle(_candidates(), suggestions=["h2"], mode="auto")
        assert a == b


class TestSerialization:
    def test_to_dict_contains_audit_trail(self):
        sel = select_angle(_candidates(), suggestions=["h2"], mode="auto")
        d = sel.to_dict()
        assert d["angle_id"] == "h2"
        assert d["type"] == "strength"
        assert d["selection_mode"] == "auto"
        assert d["fallback_chain"] == []
        assert "channel suggestions[0]" in d["selection_reason"]


class TestModesConstant:
    def test_modes_tuple_has_five(self):
        assert set(ANGLE_MODES) == {
            "auto", "strength_first", "tradeoff_first", "risk_first", "segment_first"
        }
