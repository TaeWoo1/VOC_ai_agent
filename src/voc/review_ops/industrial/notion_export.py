"""Notion export — pure payload builder (I1).

Turns an analysis ``result`` dict (the output of the Streamlit app's
``generate()``) into a Notion *page-create* payload: a title plus a list of
Notion block objects, one section per operator-facing area.

This module is **pure**: no Notion API client, no network, no env handling, no
Streamlit. Those land in I2. Everything here is deterministic given the same
``result`` + ``today``, so it is fully unit-testable offline.

Design constraints baked in:
- Total block count stays well under Notion's 100-children-per-create limit via
  per-section caps (issues / evidence / worklist / needs-reply). The caps are
  explicit module constants, not silent truncation.
- Wording stays humble and operational. The static "운영 적용 가능성" section
  states what is possible now, what needs more data, and what should NOT be
  automated yet — it never claims causality or automation we don't have.
- Evidence quotes are the reviewer's own words, ellipsized (boundary-preserved)
  only when longer than ``QUOTE_MAXLEN``.
"""

from __future__ import annotations

from datetime import date

# --- caps (keep total blocks < 100; surfaced, never silent) -----------------

MAX_ISSUES = 5
MAX_EVIDENCE_PER_ISSUE = 2
MAX_WORKLIST = 6
MAX_NEEDS_REPLY = 5
MAX_DETAIL_CANDIDATES = 6
QUOTE_MAXLEN = 280
_RICH_TEXT_MAXLEN = 1900  # Notion hard limit is 2000 per rich_text content

NO_NEEDS_REPLY_TEXT = "이번 범위에서는 명확한 답글 필요 리뷰가 많지 않습니다."

# Section headings, in order. Tests assert these all appear.
SECTION_TITLES = [
    "분석 요약",
    "반복 이슈",
    "오늘/이번 주 확인할 리뷰",
    "답글 필요 리뷰",
    "상세페이지 보완 후보",
    "운영 적용 가능성",
    "다음 주 운영 제안",
]

# Static "운영 적용 가능성" content — three fixed categories. Verbatim copy; do
# not derive or rephrase. Humble + operational, no causality/automation claims.
APPLICABILITY = {
    "지금 바로 가능한 것": [
        "CSV/엑셀 리뷰 업로드 기반 상품군별 리뷰 점검",
        "신규 리뷰 구분",
        "반복 이슈 확인",
        "저평점/답글 필요 리뷰 분리",
        "상세페이지 보완 후보 정리",
        "원문 근거 기반 질의",
    ],
    "추가 데이터가 있으면 가능한 것": [
        "쿠팡/스마트스토어/자사몰 리뷰 통합",
        "주간 신규 리뷰 변화 추적",
        "상품별 이슈 변화 추적",
        "상위 노출 리뷰와 전체 리뷰 차이 비교",
        "상세페이지 문구/이미지와 실제 리뷰 불일치 확인",
        "FAQ/상세페이지 문구 후보 생성",
    ],
    "아직 자동화하지 않는 게 좋은 것": [
        "답글 자동 게시",
        "상세페이지 자동 수정",
        "원인/매출 영향 단정",
        "무검수 자동수집 운영",
        "고객 응대 완전 자동화",
    ],
}
# Order matters: tests assert all three appear and the export reads top-to-bottom.
APPLICABILITY_ORDER = [
    "지금 바로 가능한 것",
    "추가 데이터가 있으면 가능한 것",
    "아직 자동화하지 않는 게 좋은 것",
]


# --- low-level block helpers ------------------------------------------------


def _clip(text: str, limit: int = _RICH_TEXT_MAXLEN) -> str:
    text = text or ""
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


def _rich_text(content: str) -> list[dict]:
    return [{"type": "text", "text": {"content": _clip(content)}}]


def _heading_2(text: str) -> dict:
    return {"object": "block", "type": "heading_2",
            "heading_2": {"rich_text": _rich_text(text)}}


def _heading_3(text: str) -> dict:
    return {"object": "block", "type": "heading_3",
            "heading_3": {"rich_text": _rich_text(text)}}


def _paragraph(text: str) -> dict:
    return {"object": "block", "type": "paragraph",
            "paragraph": {"rich_text": _rich_text(text)}}


def _bullet(text: str) -> dict:
    return {"object": "block", "type": "bulleted_list_item",
            "bulleted_list_item": {"rich_text": _rich_text(text)}}


def _quote(text: str) -> dict:
    return {"object": "block", "type": "quote",
            "quote": {"rich_text": _rich_text(text)}}


def _divider() -> dict:
    return {"object": "block", "type": "divider", "divider": {}}


# --- formatting helpers ------------------------------------------------------


def _quote_text(text: str) -> str:
    """Reviewer's words, ellipsized (boundary-preserved) past QUOTE_MAXLEN."""
    t = (text or "").strip()
    if len(t) <= QUOTE_MAXLEN:
        return t
    return t[:QUOTE_MAXLEN] + "…"


def _scope_label(result: dict) -> str:
    return result.get("scope_label") or "전체 상품"


def _fmt_rating(rating) -> str:
    if rating is None:
        return "평점 미상"
    try:
        return f"{int(round(float(rating)))}점"
    except (TypeError, ValueError):
        return "평점 미상"


def _needs_reply_reviews(result: dict) -> list:
    """Active reviews tagged needs_reply, in the result's tagged order.

    ``tagged`` is a list of ``(review, tag_ids)``; we read ``needs_reply`` by id
    (robust to label wording). Returns the review objects (capped by caller).
    """
    out = []
    for entry in result.get("tagged") or []:
        try:
            review, tags = entry
        except (TypeError, ValueError):
            continue
        if "needs_reply" in (tags or []):
            out.append(review)
    return out


# --- section builders --------------------------------------------------------


def notion_page_title(result: dict, today: date) -> str:
    """리뷰 운영 점검 · {scope_label} · {date}."""
    return f"리뷰 운영 점검 · {_scope_label(result)} · {today.isoformat()}"


def _section_summary(result: dict) -> list[dict]:
    rs = result.get("rating_summary") or {}
    avg = rs.get("average")
    avg_text = f"{avg}점" if avg is not None else "-"
    full = result.get("full_active_count")
    scoped = result.get("scoped_active_count")
    if full is not None and scoped is not None and scoped != full:
        count_text = f"선택 {scoped:,}건 / 전체 {full:,}건"
    else:
        count_text = f"{result.get('total', scoped or 0):,}건"
    worklist_total = (result.get("today_count", 0) or 0) + (result.get("week_count", 0) or 0)
    blocks = [_heading_2("분석 요약")]
    blocks.append(_bullet(f"분석 범위: {_scope_label(result)}"))
    blocks.append(_bullet(f"분석 대상 리뷰: {count_text}"))
    blocks.append(_bullet(f"평균 평점: {avg_text}"))
    blocks.append(_bullet(f"저평점 리뷰: {rs.get('low_count', 0):,}건"))
    blocks.append(_bullet(f"우선 확인 리뷰: {worklist_total:,}건"))
    blocks.append(_bullet(f"반복 이슈: {result.get('issue_count', 0):,}건"))
    return blocks


def _section_issues(result: dict) -> list[dict]:
    blocks = [_heading_2("반복 이슈")]
    issues = result.get("issue_items") or []
    if not issues:
        blocks.append(_paragraph("이번 범위에서 묶인 반복 이슈가 없습니다."))
        return blocks
    for item in issues[:MAX_ISSUES]:
        title = item.get("issue_title") or "(제목 없음)"
        count = item.get("review_count", 0)
        ctx = item.get("product_summary") or ""
        head = f"{title} · 관련 리뷰 {count}건"
        if ctx:
            head += f" · {ctx}"
        blocks.append(_heading_3(head))
        if item.get("summary"):
            blocks.append(_paragraph(f"요약: {item['summary']}"))
        if item.get("recommended_action"):
            blocks.append(_bullet(f"추천 조치: {item['recommended_action']}"))
        for rep in (item.get("reps") or [])[:MAX_EVIDENCE_PER_ISSUE]:
            meta = f"{rep.get('작성일', '미상')} · {rep.get('평점', '-')}점"
            blocks.append(_quote(f"{meta} — {_quote_text(rep.get('리뷰', ''))}"))
    return blocks


def _section_worklist(result: dict) -> list[dict]:
    blocks = [_heading_2("오늘/이번 주 확인할 리뷰")]
    items = result.get("worklist_items") or []
    if not items:
        blocks.append(_paragraph("이번 범위에서 우선 확인할 리뷰가 많지 않습니다."))
        return blocks
    for it in items[:MAX_WORKLIST]:
        meta = f"{it.get('작성일', '미상')} · {it.get('상품명', '-')} · {it.get('평점', '-')}점"
        reason = it.get("reason") or ""
        action = it.get("suggested_action") or ""
        line = meta
        if reason:
            line += f"\n확인 이유: {reason}"
        if action:
            line += f"\n다음 조치: {action}"
        blocks.append(_paragraph(line))
        if it.get("리뷰"):
            blocks.append(_quote(_quote_text(it["리뷰"])))
    return blocks


def _section_needs_reply(result: dict) -> list[dict]:
    blocks = [_heading_2("답글 필요 리뷰")]
    reviews = _needs_reply_reviews(result)
    if not reviews:
        blocks.append(_paragraph(NO_NEEDS_REPLY_TEXT))
        return blocks
    for r in reviews[:MAX_NEEDS_REPLY]:
        review_date = getattr(r, "review_date", None)
        d = review_date.isoformat() if review_date else "미상"
        product = getattr(r, "product_name", None) or "-"
        meta = f"{d} · {product} · {_fmt_rating(getattr(r, 'rating', None))}"
        blocks.append(_paragraph(meta))
        blocks.append(_quote(_quote_text(getattr(r, "text", "") or "")))
    return blocks


def _section_detail_candidates(result: dict) -> list[dict]:
    """상세페이지 보완 후보 — derived from repeated-issue recommended actions.

    Hypothesis-framed: each line ties an observed issue to a humble page-update
    candidate. Never directive, never a claimed cause.
    """
    blocks = [_heading_2("상세페이지 보완 후보")]
    issues = result.get("issue_items") or []
    candidates: list[str] = []
    for item in issues[:MAX_DETAIL_CANDIDATES]:
        title = item.get("issue_title") or item.get("tag_label") or ""
        action = item.get("recommended_action") or ""
        if not title and not action:
            continue
        if action:
            candidates.append(f"{title} → 상세페이지 안내 보완 검토: {action}")
        else:
            candidates.append(f"{title} 관련 상세페이지 안내 보완 후보")
    if not candidates:
        blocks.append(_paragraph("이번 범위에서는 상세페이지 보완 후보를 도출할 반복 이슈가 적습니다."))
        return blocks
    blocks.extend(_bullet(c) for c in candidates)
    return blocks


def _section_applicability() -> list[dict]:
    """운영 적용 가능성 — static three-category framing (verbatim)."""
    blocks = [_heading_2("운영 적용 가능성")]
    for category in APPLICABILITY_ORDER:
        blocks.append(_heading_3(category))
        blocks.extend(_bullet(item) for item in APPLICABILITY[category])
    return blocks


def _section_next_week(result: dict) -> list[dict]:
    blocks = [_heading_2("다음 주 운영 제안")]
    issues = result.get("issue_items") or []
    blocks.append(_heading_3("이번 주 확인할 것"))
    if issues:
        for item in issues[:3]:
            blocks.append(_bullet(item.get("issue_title") or "(제목 없음)"))
    else:
        blocks.append(_bullet("우선 확인 리뷰부터 점검"))
    blocks.append(_heading_3("다음 업로드 때 비교할 것"))
    for line in (
        "신규 리뷰 수 변화",
        "반복 이슈 건수 변화",
        "저평점 리뷰 비율 변화",
    ):
        blocks.append(_bullet(line))
    blocks.append(_heading_3("대표님에게 물어볼 의사결정 질문"))
    for line in (
        "어떤 이슈를 먼저 상세페이지에 반영할지",
        "다음에 집중 점검할 상품군은 어디인지",
    ):
        blocks.append(_bullet(line))
    return blocks


# --- top-level builders ------------------------------------------------------


def build_notion_blocks(result: dict) -> list[dict]:
    """All sections as a flat list of Notion block objects (dividers between).

    Order follows SECTION_TITLES. Total stays under 100 via the per-section
    caps above.
    """
    sections = [
        _section_summary(result),
        _section_issues(result),
        _section_worklist(result),
        _section_needs_reply(result),
        _section_detail_candidates(result),
        _section_applicability(),
        _section_next_week(result),
    ]
    blocks: list[dict] = []
    for i, section in enumerate(sections):
        if i:
            blocks.append(_divider())
        blocks.extend(section)
    return blocks


def build_notion_payload(result: dict, parent_page_id: str, today: date) -> dict:
    """A Notion ``POST /v1/pages`` payload: parent + title + children blocks.

    Pure assembly only — the actual HTTP call lives in the I2 client.
    """
    title = notion_page_title(result, today)
    return {
        "parent": {"type": "page_id", "page_id": parent_page_id},
        "properties": {"title": {"title": _rich_text(title)}},
        "children": build_notion_blocks(result),
    }
