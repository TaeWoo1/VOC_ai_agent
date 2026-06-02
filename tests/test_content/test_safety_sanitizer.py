"""Tests for the planner-side hype-token sanitizer.

The sanitizer is a deterministic post-process between LLM JSON parse
and Pydantic / safety validation. Its job is to swap the five
high-leak hype tokens for safe paraphrases so an otherwise-clean run
doesn't abort on retry-rate, while leaving medical/efficacy tokens in
place so the safety validator still has the final say.

These tests assert:
  * each hype token in HYPE_REPLACEMENTS round-trips through the walker
  * nested dict/list/dict-in-list shapes are all traversed
  * the input is never mutated (deep-copy semantics)
  * field paths in the report match the safety validator's encoding
  * medical/efficacy tokens are FLAGGED, not replaced
  * sanitized output passes the safety validator (when only hype was
    present)
  * sanitized output STILL fails the safety validator when medical
    tokens were left in place (intentional, the boundary is preserved)
"""
from __future__ import annotations

import copy
import json

import pytest

from cardnews.safety_validator import (
    CardnewsSafetyError,
    validate_cardnews_safety,
    validate_content_plan_safety,
)
from src.voc.content.safety_sanitizer import (
    HYPE_REPLACEMENTS,
    MEDICAL_FLAGGED_TOKENS,
    SanitizeReport,
    sanitize_content_plan,
    write_sanitize_artifacts,
)


# ---------------------------------------------------------------------------
# Replacement coverage — every entry in HYPE_REPLACEMENTS round-trips
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("token,replacement", list(HYPE_REPLACEMENTS.items()))
def test_each_hype_token_is_replaced(token: str, replacement: str) -> None:
    plan = {"summary": {"takeaways": [f"이 제품은 진짜 {token} 정말요"]}}
    out, report = sanitize_content_plan(plan)
    assert token not in out["summary"]["takeaways"][0], (
        f"token {token!r} should have been replaced"
    )
    assert replacement in out["summary"]["takeaways"][0]
    assert report.total_replacements() >= 1
    assert report.replaced[0].original == token
    assert report.replaced[0].replacement == replacement


# ---------------------------------------------------------------------------
# Recursive traversal — nested shapes
# ---------------------------------------------------------------------------


def test_sanitizer_walks_nested_dict() -> None:
    plan = {
        "cover": {
            "headline": "이건 미쳤어요",
            "subline": "정상 텍스트",
        },
    }
    out, report = sanitize_content_plan(plan)
    assert "미쳤어요" not in out["cover"]["headline"]
    assert "인상적이에요" in out["cover"]["headline"]
    assert out["cover"]["subline"] == "정상 텍스트"
    assert report.replaced[0].field_path == "cover.headline"


def test_sanitizer_walks_list_of_strings() -> None:
    plan = {"summary": {"takeaways": ["clean", "이건 인생템", "또 깨끗"]}}
    out, report = sanitize_content_plan(plan)
    assert "인생템" not in out["summary"]["takeaways"][1]
    assert report.replaced[0].field_path == "summary.takeaways[1]"


def test_sanitizer_walks_list_of_dicts() -> None:
    plan = {
        "positive_spotlights": [
            {"what_reviewers_liked": "최악이라는 의견은 별로"},
            {"what_reviewers_liked": "정상"},
        ],
    }
    out, report = sanitize_content_plan(plan)
    assert "최악" not in out["positive_spotlights"][0]["what_reviewers_liked"]
    assert (
        report.replaced[0].field_path
        == "positive_spotlights[0].what_reviewers_liked"
    )


def test_sanitizer_walks_deeply_nested() -> None:
    plan = {
        "a": {"b": {"c": [{"d": ["clean", "독한 표현이 있어요"]}]}},
    }
    out, report = sanitize_content_plan(plan)
    assert "독한" not in out["a"]["b"]["c"][0]["d"][1]
    assert report.replaced[0].field_path == "a.b.c[0].d[1]"


def test_sanitizer_handles_multiple_occurrences_in_one_string() -> None:
    plan = {"summary": {"closing_note": "미쳤어요 진짜 미쳤어요 또 미쳤어요"}}
    out, report = sanitize_content_plan(plan)
    assert "미쳤어요" not in out["summary"]["closing_note"]
    assert out["summary"]["closing_note"].count("인상적이에요") == 3
    rep = next(r for r in report.replaced if r.original == "미쳤어요")
    assert rep.count == 3


def test_sanitizer_handles_multiple_distinct_tokens_in_one_string() -> None:
    plan = {"x": {"y": "최악과 인생템이 같이"}}
    out, report = sanitize_content_plan(plan)
    assert "최악" not in out["x"]["y"]
    assert "인생템" not in out["x"]["y"]
    originals = {r.original for r in report.replaced}
    assert {"최악", "인생템"}.issubset(originals)


def test_sanitizer_does_not_replace_clean_strings() -> None:
    plan = {
        "cover": {"headline": "촉촉함은 갈렸어요", "subline": "리뷰 1,000건"},
        "summary": {"takeaways": ["만족 후기 반복", "사용감이 갈렸어요"]},
    }
    out, report = sanitize_content_plan(plan)
    assert out == plan
    assert report.total_replacements() == 0
    assert not report.flagged_unsafe


# ---------------------------------------------------------------------------
# Purity — input is never mutated
# ---------------------------------------------------------------------------


def test_sanitizer_does_not_mutate_input() -> None:
    plan = {"x": {"y": ["미쳤어요"]}}
    snapshot = copy.deepcopy(plan)
    out, _ = sanitize_content_plan(plan)
    assert plan == snapshot, (
        "sanitize_content_plan must not mutate the input dict"
    )
    assert out is not plan
    assert out["x"]["y"][0] != plan["x"]["y"][0]


# ---------------------------------------------------------------------------
# Medical / efficacy — FLAGGED, never replaced
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("token", list(MEDICAL_FLAGGED_TOKENS))
def test_medical_tokens_are_flagged_not_replaced(token: str) -> None:
    plan = {"signature": {"lead": f"이 제품은 {token} 같은 표현"}}
    out, report = sanitize_content_plan(plan)
    # Token must still be present (NOT auto-rewritten).
    assert token in out["signature"]["lead"], (
        f"medical token {token!r} must NOT be auto-replaced"
    )
    flagged_tokens = {f.token for f in report.flagged_unsafe}
    assert token in flagged_tokens
    flag = next(f for f in report.flagged_unsafe if f.token == token)
    assert flag.field_path == "signature.lead"
    assert token in flag.snippet


def test_medical_flag_carries_context_snippet() -> None:
    plan = {"signature": {"lead": "앞부분 텍스트가 길게 이어지다가 효능이라는 단어가 등장하고 뒤로 또 길게"}}
    _, report = sanitize_content_plan(plan)
    flag = next(f for f in report.flagged_unsafe if f.token == "효능")
    assert "효능" in flag.snippet
    # Snippet should be a window, not the full string.
    assert len(flag.snippet) < len(plan["signature"]["lead"]) + 4


# ---------------------------------------------------------------------------
# Integration with the safety validator
# ---------------------------------------------------------------------------


def _wrap_as_layout(string_field_value: str) -> dict:
    """Build a minimal layout dict that the safety validator will walk.
    The validator only inspects fields it considers public; we put the
    payload in `headline` (a registered public text field)."""
    return {
        "schema_version": "2.2",
        "language": "ko",
        "channel": "instagram",
        "format": "cardnews_long",
        "page_count": 1,
        "pages": [
            {
                "index": 1,
                "type": "cover",
                "language": "ko",
                "headline": string_field_value,
                "audit": {},
            }
        ],
    }


def test_sanitized_hype_passes_safety_validator() -> None:
    """Hype-only input → sanitizer produces clean text → safety validator passes."""
    raw = _wrap_as_layout("이건 진짜 미쳤어요 인생템 무조건 사야 함")
    sanitized, report = sanitize_content_plan(raw)
    assert report.total_replacements() >= 3
    # No hype tokens remain
    headline = sanitized["pages"][0]["headline"]
    for t in ("미쳤어요", "인생템", "무조건"):
        assert t not in headline
    # And the validator now passes
    validate_cardnews_safety(sanitized)


def test_medical_token_still_aborts_after_sanitize() -> None:
    """Medical tokens are flagged but not removed; the planner-stage
    safety validator (which has the medical ban list) must still abort
    the run. The sanitizer is a retry-rate optimization, NOT a safety
    bypass.

    NOTE: the layout-stage `validate_cardnews_safety` only catches the
    consumer-clickbait cluster (`BANNED_FRAMINGS_KO`). Medical /
    efficacy tokens are caught at the *planner* stage by
    `validate_content_plan_safety` — so this test asserts the boundary
    that actually carries the medical contract."""
    raw_plan = {
        "schema_version": "2.2",
        "language": "ko",
        "signature": {
            "lead": "이 제품은 효능이 좋아져요",
        },
    }
    sanitized, report = sanitize_content_plan(raw_plan)
    assert any(f.token == "효능이 좋아져요" for f in report.flagged_unsafe)
    with pytest.raises(CardnewsSafetyError):
        validate_content_plan_safety(sanitized)


# ---------------------------------------------------------------------------
# Report shape
# ---------------------------------------------------------------------------


def test_report_to_dict_serializable_to_json() -> None:
    plan = {
        "x": "미쳤어요",
        "y": "효능 좋아요",
    }
    _, report = sanitize_content_plan(plan)
    serialized = json.dumps(report.to_dict(), ensure_ascii=False)
    parsed = json.loads(serialized)
    assert parsed["total_replacements"] >= 1
    assert parsed["total_flagged_unsafe"] >= 1
    assert "field_path" in parsed["replaced"][0]
    assert "field_path" in parsed["flagged_unsafe"][0]


def test_report_field_path_uses_dot_and_bracket_encoding() -> None:
    plan = {"a": [{"b": "미쳤어요"}]}
    _, report = sanitize_content_plan(plan)
    assert report.replaced[0].field_path == "a[0].b"


# ---------------------------------------------------------------------------
# write_sanitize_artifacts — three-file persistence
# ---------------------------------------------------------------------------


def test_write_sanitize_artifacts_emits_three_files(tmp_path) -> None:
    raw = {"x": "미쳤어요"}
    sanitized, report = sanitize_content_plan(raw)
    raw_p, san_p, rep_p = write_sanitize_artifacts(
        raw_plan=raw,
        sanitized_plan=sanitized,
        report=report,
        out_dir=tmp_path,
    )
    assert raw_p.name == "_planner_raw.json"
    assert san_p.name == "_planner_sanitized.json"
    assert rep_p.name == "_planner_sanitize_report.json"
    assert raw_p.exists() and san_p.exists() and rep_p.exists()
    # Round-trip every file.
    assert json.loads(raw_p.read_text(encoding="utf-8")) == raw
    assert json.loads(san_p.read_text(encoding="utf-8")) == sanitized
    rep = json.loads(rep_p.read_text(encoding="utf-8"))
    assert rep["total_replacements"] == 1
