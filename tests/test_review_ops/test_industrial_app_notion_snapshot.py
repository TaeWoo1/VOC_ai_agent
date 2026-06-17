"""App-level Notion snapshot wiring (S2x.5b-2): prepare_result_for_notion,
plus the screen-preview formatter (S2x.6a): format_detail_gap_preview.

Offline, no Streamlit E2E, no OpenAI, no network. Exercises only the pure
helpers the Notion export area consumes; the gap analysis itself is covered
by the detail_snapshot tests.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

from app_industrial_review_ops import format_detail_gap_preview, prepare_result_for_notion
from src.voc.review_ops.industrial.notion_export import build_notion_blocks


def _result() -> dict:
    return {
        "scope_label": "선바로 선택 상품",
        "total": 1141,
        "issue_items": [
            {"issue_title": "접착력 부족", "review_count": 3,
             "recommended_action": "실크벽지/부착면 조건 안내 점검 후보"},
            {"issue_title": "절단 시 깨짐", "review_count": 2,
             "recommended_action": "절단 도구/깨짐 방지 안내 점검 후보"},
        ],
    }


def _guidance_review() -> dict:
    """Minimal product_guidance_review with precomputed gap-ready signals."""
    return {
        "review_gap_ready_signals": [
            {
                "topic": "접착력 부족",
                "detail_page_status": "partial_guidance",
                "found": ["부착 전 물기/먼지 제거", "피스/실리콘 고정"],
                "not_found": ["실크벽지 조건", "추가 양면테이프"],
            },
            {
                "topic": "절단 시 깨짐",
                "detail_page_status": "partial_guidance",
                "found": ["재단 안내"],
                "not_found": ["깨짐 방지 주의"],
            },
        ],
    }


def _snapshot(tmp_path) -> Path:
    snap = tmp_path / "snap"
    snap.mkdir()
    (snap / "product_guidance_review.json").write_text(
        json.dumps(_guidance_review(), ensure_ascii=False), encoding="utf-8"
    )
    return snap


def test_empty_path_returns_unchanged_copy():
    result = _result()
    for empty in (None, "", "   "):
        out = prepare_result_for_notion(result, empty)
        assert out == result
        assert out is not result
        assert "detail_guidance_gaps" not in out
        assert "detail_guidance_source" not in out


def test_valid_snapshot_attaches_gaps_without_mutating_input(tmp_path):
    snap = _snapshot(tmp_path)
    result = _result()
    before = copy.deepcopy(result)
    out = prepare_result_for_notion(result, str(snap))
    assert result == before  # session-state result untouched
    gaps = out["detail_guidance_gaps"]
    assert [g["issue_title"] for g in gaps] == ["접착력 부족", "절단 시 깨짐"]
    assert all(g["detail_page_status"] == "partial_guidance" for g in gaps)
    assert out["detail_guidance_source"]["needs_operator_review"] is True


def test_whitespace_around_path_is_stripped(tmp_path):
    snap = _snapshot(tmp_path)
    out = prepare_result_for_notion(_result(), f"  {snap}  ")
    assert "detail_guidance_gaps" in out


def test_invalid_snapshot_returns_unchanged_copy(tmp_path):
    result = _result()
    # nonexistent dir
    out = prepare_result_for_notion(result, str(tmp_path / "nope"))
    assert out == result
    # dir present, review file invalid
    snap = tmp_path / "bad"
    snap.mkdir()
    (snap / "product_guidance_review.json").write_text("{not json", encoding="utf-8")
    out = prepare_result_for_notion(result, str(snap))
    assert out == result
    assert "detail_guidance_gaps" not in out


def test_prepared_result_renders_gap_section_in_notion_body(tmp_path):
    snap = _snapshot(tmp_path)
    out = prepare_result_for_notion(_result(), str(snap))
    texts = []
    for b in build_notion_blocks(out, compact=True):
        rt = b.get(b["type"], {}).get("rich_text")
        if rt:
            texts.append(rt[0]["text"]["content"])
    body = "\n".join(texts)
    assert "상세페이지 이미지 추출 결과" in body
    assert "접착력 부족" in body
    assert "확인된 안내" in body
    assert "부착 전 물기/먼지 제거" in body
    assert "추출 결과에서 찾지 못한 안내" in body
    assert "실크벽지 조건" in body
    assert "현재는 상세페이지 스냅샷이 없어" not in body


def test_preview_contains_expected_gap_content(tmp_path):
    # S2x.6a: the screen preview mirrors what the Notion section will render.
    out = prepare_result_for_notion(_result(), str(_snapshot(tmp_path)))
    preview = format_detail_gap_preview(out)
    assert preview["title"] == "상세페이지/안내 점검 후보"
    assert "상세페이지 이미지 추출 결과" in preview["caution"]
    assert "운영자 확인이 필요합니다" in preview["caution"]
    text = "\n".join(
        [preview["caution"]]
        + [
            "\n".join([i["issue_title"], i["status_label"], i["operator_check"]]
                      + i["guidance_lines"])
            for i in preview["items"]
        ]
    )
    assert "접착력 부족" in text
    assert "확인된 안내" in text
    assert "부착 전 물기/먼지 제거" in text
    assert "추출 결과에서 찾지 못한 안내" in text
    assert "실크벽지 조건" in text
    assert "절단 시 깨짐" in text
    assert "재단 안내" in text
    assert "깨짐 방지 주의" in text
    # cautious-wording contract: candidates, not verdicts
    for banned in ("상세페이지에 없습니다", "반드시", "원인", "개선해야"):
        assert banned not in text
    # status shown as an operator label, not engine-speak
    assert all(i["status_label"] == "일부 안내 확인" for i in preview["items"])


def test_preview_is_none_without_gaps(tmp_path):
    # empty path → no gaps attached → no preview section
    assert format_detail_gap_preview(prepare_result_for_notion(_result(), "")) is None
    # invalid snapshot → unchanged copy → no preview section
    out = prepare_result_for_notion(_result(), str(tmp_path / "nope"))
    assert format_detail_gap_preview(out) is None
    assert format_detail_gap_preview({}) is None
    assert format_detail_gap_preview(None) is None


def test_preview_caps_items_and_skips_non_dicts(tmp_path):
    out = prepare_result_for_notion(_result(), str(_snapshot(tmp_path)))
    gaps = out["detail_guidance_gaps"]
    out["detail_guidance_gaps"] = ["junk"] + gaps * 3  # 7 entries, 1 non-dict
    preview = format_detail_gap_preview(out)
    # MAX_DETAIL_GAP_ITEMS (3) bounds the slice; the non-dict head is skipped
    assert len(preview["items"]) == 2
    assert preview["items"][0]["issue_title"] == "접착력 부족"


def test_unprepared_result_keeps_review_only_section():
    texts = []
    for b in build_notion_blocks(prepare_result_for_notion(_result(), ""), compact=True):
        rt = b.get(b["type"], {}).get("rich_text")
        if rt:
            texts.append(rt[0]["text"]["content"])
    body = "\n".join(texts)
    assert "현재는 상세페이지 스냅샷이 없어 리뷰 기반 점검 후보로 표시합니다." in body
    assert "상세페이지 이미지 추출 결과" not in body
