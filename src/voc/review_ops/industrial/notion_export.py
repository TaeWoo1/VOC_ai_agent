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

import json
import os
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from src.voc.review_ops.industrial.issue_sanitize import sanitize_issue_text

# --- caps (keep total blocks < 100; surfaced, never silent) -----------------

MAX_ISSUES = 5
MAX_EVIDENCE_PER_ISSUE = 2
MAX_PRIORITY_REVIEWS = 5
MAX_NEEDS_REPLY = 5
MAX_DETAIL_CANDIDATES = 6
MAX_ACTION_ITEMS = 6
MAX_CEO_ISSUES = 3  # key issues named in the CEO summary / action list
MAX_DB_KEY_ISSUES = 5  # issue titles named in the DB row's 주요 이슈 column
MAX_COMPACT_NEEDS_REPLY = 3  # compact DB body lists at most this many 답글 검토 리뷰
MAX_COMPACT_ACTION_ITEMS = 4  # compact 우선 점검 항목: keep to 3–4 scannable lines
COMPACT_POSITIVE_RATING_FLOOR = 4.0  # rating ≥ this is "obviously positive" → skipped
QUOTE_MAXLEN = 160  # quotes are kept short in this layout
PRODUCT_LABEL_MAXLEN = 22  # Notion-only short product label
_RICH_TEXT_MAXLEN = 1900  # Notion hard limit is 2000 per rich_text content

NO_NEEDS_REPLY_TEXT = "이번 범위에서는 명확한 답글 필요 리뷰가 많지 않습니다."

# Section headings, in order. Tests assert these all appear. Lead with the
# operations summary + priority list ("what to do next"), push raw evidence
# lower. Professional dashboard tone — no direct address.
SECTION_TITLES = [
    "운영 요약",
    "우선 점검 항목",
    "반복 이슈",
    "우선 확인 리뷰",
    "답글 검토 리뷰",
    "상세페이지/안내 점검 후보",
    "적용 범위",
    "다음 업로드 비교 항목",
]

# Static "운영 적용 가능성" content — three fixed categories. Verbatim copy; do
# not derive or rephrase. Humble + operational, no causality/automation claims.
APPLICABILITY = {
    "현재 적용 가능": [
        "CSV/엑셀 리뷰 업로드 기반 상품군별 리뷰 점검",
        "신규 리뷰 구분",
        "반복 이슈 확인",
        "저평점/답글 검토 리뷰 분리",
        "상세페이지 보완 후보 정리",
        "원문 근거 기반 질의",
    ],
    "추가 데이터 필요": [
        "쿠팡/스마트스토어/자사몰 리뷰 통합",
        "주간 신규 리뷰 변화 추적",
        "상품별 이슈 변화 추적",
        "상위 노출 리뷰와 전체 리뷰 차이 비교",
        "상세페이지 문구/이미지와 실제 리뷰 불일치 확인",
        "FAQ/상세페이지 문구 후보 생성",
    ],
    "보류 권장": [
        "답글 자동 게시",
        "상세페이지 자동 수정",
        "원인/매출 영향 단정",
        "무검수 자동수집 운영",
        "고객 응대 완전 자동화",
    ],
}
# Order matters: tests assert all three appear and the export reads top-to-bottom.
APPLICABILITY_ORDER = [
    "현재 적용 가능",
    "추가 데이터 필요",
    "보류 권장",
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


def _callout(text: str, emoji: str = "📌") -> dict:
    """A single callout block (icon + rich text). Newlines in ``text`` render as
    line breaks, so a 2–3 line executive summary fits one block."""
    return {"object": "block", "type": "callout",
            "callout": {"rich_text": _rich_text(text),
                        "icon": {"type": "emoji", "emoji": emoji}}}


def _toggle(title: str, children: list[dict]) -> dict:
    """A collapsible toggle whose ``children`` are nested (one level) inside it.
    Children do not count toward the top-level block budget, so folding detail
    into toggles both shortens the page and keeps the detail one click away."""
    return {"object": "block", "type": "toggle",
            "toggle": {"rich_text": _rich_text(title), "children": children}}


def _todo(text: str, checked: bool = False) -> dict:
    """An unchecked to-do (checkbox) block. Used for the human-owned 운영 판단
    checklist — the operator ticks these, nothing is acted on automatically."""
    return {"object": "block", "type": "to_do",
            "to_do": {"rich_text": _rich_text(text), "checked": checked}}


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


def _short_product_label(name: str | None, limit: int = PRODUCT_LABEL_MAXLEN) -> str:
    """Notion-only short product label. Trims merchandising boilerplate
    (leading bracket/paren promo tags) then ellipsizes. Does NOT touch the
    product grouping rules or the canonical product name — display only."""
    text = (name or "").strip()
    if not text:
        return "-"
    # drop a single leading [..] / (..) promo/bulk tag if more text follows
    for opener, closer in (("[", "]"), ("(", ")")):
        if text.startswith(opener) and closer in text:
            tail = text[text.index(closer) + 1 :].strip()
            if tail:
                text = tail
            break
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _issue_context_label(item: dict) -> str:
    """Short product context for an issue card, e.g. '대표 상품: 선바로 전선몰딩 외 2개'.

    Derived from the issue's own representative reviews (verbatim product names
    already in the result), shortened for Notion. The product-group label is an
    app-level concept not carried in ``result``, so we name a representative
    product instead of a group — no grouping-rule dependency."""
    seen: list[str] = []
    for rep in item.get("reps") or []:
        name = (rep.get("상품명") or "").strip()
        if name and name != "-" and name not in seen:
            seen.append(name)
    if not seen:
        return ""
    lead = _short_product_label(seen[0])
    if len(seen) == 1:
        return f"대표 상품: {lead}"
    return f"대표 상품: {lead} 외 {len(seen) - 1}개"


def _rating_context_phrase(result: dict) -> str:
    """One humble sentence on the overall rating picture. No causal claim."""
    rs = result.get("rating_summary") or {}
    share = rs.get("low_share") or 0.0
    if share >= 0.3:
        return "저평점 리뷰 비중이 다소 높은 편입니다"
    return "전체적으로는 고평점 리뷰가 많습니다"


# --- section builders --------------------------------------------------------


def notion_page_title(result: dict, today: date) -> str:
    """리뷰 운영 점검 · {scope_label} · {date}."""
    return f"리뷰 운영 점검 · {_scope_label(result)} · {today.isoformat()}"


def _count_text(result: dict) -> str:
    full = result.get("full_active_count")
    scoped = result.get("scoped_active_count")
    if full is not None and scoped is not None and scoped != full:
        return f"선택 {scoped:,}건 / 전체 {full:,}건"
    return f"{result.get('total', scoped or 0):,}건"


def _section_ceo_summary(result: dict) -> list[dict]:
    """운영 요약 — 3~5 humble bullets leading with scope + what to look at.

    Professional dashboard tone: no direct address."""
    rs = result.get("rating_summary") or {}
    avg = rs.get("average")
    avg_text = f"평균 평점 {avg}점" if avg is not None else "평균 평점 미상"
    issues = result.get("issue_items") or []
    key_titles = [i.get("issue_title") or "" for i in issues[:MAX_CEO_ISSUES]]
    key_titles = [t for t in key_titles if t]

    blocks = [_heading_2("운영 요약")]
    blocks.append(_bullet(f"분석 범위: {_scope_label(result)} · 리뷰 {_count_text(result)}"))
    blocks.append(_bullet(f"{_rating_context_phrase(result)} ({avg_text})."))
    if key_titles:
        blocks.append(_bullet("반복 확인 신호: " + " / ".join(key_titles)))
        first = key_titles[0]
        blocks.append(
            _bullet(
                f"우선 점검 항목: {_scope_label(result)}에서 '{first}' 관련 "
                "확인 신호부터 점검하는 것을 권장합니다."
            )
        )
    else:
        blocks.append(_bullet("반복 확인 신호: 이번 범위에서는 뚜렷한 반복 이슈가 적습니다."))
        blocks.append(
            _bullet("우선 점검 항목: 우선 확인 리뷰부터 가볍게 점검하는 것을 권장합니다.")
        )
    return blocks


def _section_action_list(result: dict) -> list[dict]:
    """우선 점검 항목 — compact action digest, no long quotes.

    Combines repeated-issue actions (severity-labelled) with the top worklist
    items (확인-labelled). This is the 'what to do next' lead-in; detail lives
    in the 반복 이슈 / 우선 확인 리뷰 sections below."""
    blocks = [_heading_2("우선 점검 항목")]
    items: list[str] = []
    for issue in (result.get("issue_items") or [])[:MAX_CEO_ISSUES]:
        action = issue.get("recommended_action") or issue.get("issue_title") or ""
        if not action:
            continue
        label = issue.get("severity_label") or "확인"
        count = issue.get("review_count", 0)
        ctx = _issue_context_label(issue)
        line = f"[{label}] {action} · 관련 리뷰 {count}건"
        if ctx:
            line += f" · {ctx}"
        items.append(line)
    remaining = MAX_ACTION_ITEMS - len(items)
    for it in (result.get("worklist_items") or [])[:max(0, remaining)]:
        action = it.get("suggested_action") or it.get("reason") or "내용 확인"
        product = _short_product_label(it.get("상품명"))
        items.append(f"[확인] {action} · {product} · {it.get('작성일', '미상')}")
    if not items:
        blocks.append(_paragraph("이번 범위에서는 먼저 처리할 항목이 많지 않습니다."))
        return blocks
    blocks.extend(_bullet(line) for line in items[:MAX_ACTION_ITEMS])
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
        # heading stays short: title + count only (no long product names)
        blocks.append(_heading_3(f"{title} · 관련 리뷰 {count}건"))
        ctx = _issue_context_label(item)
        if ctx:
            blocks.append(_paragraph(ctx))
        body = []
        if item.get("summary"):
            body.append(f"요약: {item['summary']}")
        if item.get("recommended_action"):
            body.append(f"추천 조치: {item['recommended_action']}")
        if body:
            blocks.append(_paragraph("\n".join(body)))
        reps = item.get("reps") or []
        shown = min(MAX_EVIDENCE_PER_ISSUE, len(reps))
        if shown:
            blocks.append(_paragraph(f"원문 근거: 관련 {count}건 중 {shown}건 표시"))
            for rep in reps[:shown]:
                meta = f"{rep.get('작성일', '미상')} · {rep.get('평점', '-')}점"
                blocks.append(_quote(f"{meta} — {_quote_text(rep.get('리뷰', ''))}"))
    return blocks


def _section_priority_reviews(result: dict) -> list[dict]:
    # Renamed from "오늘/이번 주 확인할 리뷰": review dates can be old, so a
    # day/week framing misleads. "우선 확인 리뷰" reads correctly regardless.
    blocks = [_heading_2("우선 확인 리뷰")]
    items = result.get("worklist_items") or []
    if not items:
        blocks.append(_paragraph("이번 범위에서 우선 확인할 리뷰가 많지 않습니다."))
        return blocks
    for it in items[:MAX_PRIORITY_REVIEWS]:
        product = _short_product_label(it.get("상품명"))
        meta = f"{it.get('작성일', '미상')} · {product} · {it.get('평점', '-')}점"
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
    blocks = [_heading_2("답글 검토 리뷰")]
    reviews = _needs_reply_reviews(result)
    if not reviews:
        blocks.append(_paragraph(NO_NEEDS_REPLY_TEXT))
        return blocks
    for r in reviews[:MAX_NEEDS_REPLY]:
        review_date = getattr(r, "review_date", None)
        d = review_date.isoformat() if review_date else "미상"
        product = _short_product_label(getattr(r, "product_name", None))
        meta = f"{d} · {product} · {_fmt_rating(getattr(r, 'rating', None))}"
        blocks.append(_paragraph(meta))
        blocks.append(_quote(_quote_text(getattr(r, "text", "") or "")))
    return blocks


def _non_positive_needs_reply(result: dict) -> list:
    """needs_reply reviews that are NOT obviously positive (rating below the
    floor, or rating unknown). Used to gate the compact body's 답글 검토 리뷰
    section: high-rating reviews don't need an operator reply nudge."""
    out = []
    for r in _needs_reply_reviews(result):
        rating = getattr(r, "rating", None)
        try:
            if rating is not None and float(rating) >= COMPACT_POSITIVE_RATING_FLOOR:
                continue
        except (TypeError, ValueError):
            pass  # unparseable rating → keep (can't prove it's positive)
        out.append(r)
    return out


def _section_needs_reply_compact(reviews: list) -> list[dict]:
    """Compact 답글 검토 리뷰: pre-filtered reviews only, capped tighter than the
    full body. Same meta + verbatim quote formatting as _section_needs_reply."""
    blocks = [_heading_2("답글 검토 리뷰")]
    for r in reviews[:MAX_COMPACT_NEEDS_REPLY]:
        review_date = getattr(r, "review_date", None)
        d = review_date.isoformat() if review_date else "미상"
        product = _short_product_label(getattr(r, "product_name", None))
        meta = f"{d} · {product} · {_fmt_rating(getattr(r, 'rating', None))}"
        blocks.append(_paragraph(meta))
        blocks.append(_quote(_quote_text(getattr(r, "text", "") or "")))
    return blocks


# Honest framing for the detail-page section. We only ever see reviews, never
# the live detail page, so we must not imply the page is missing the guidance.
# Every line is a "check whether it's already there, and only then consider
# adding" candidate, prefaced by a caption stating we have no page snapshot.
DETAIL_REVIEW_ONLY_CAUTION = "현재는 상세페이지 스냅샷이 없어 리뷰 기반 점검 후보로 표시합니다."
DETAIL_CHECK_SUFFIX = "상세페이지에 이미 안내되어 있는지 확인하고, 없다면 보강할 후보입니다."

# S2x.5a — when the result dict carries optional detail-guidance gap results
# (built upstream from the consumer-visible detail-image extraction draft), the
# section renders them instead of the review-only fallback. Same honest framing,
# one level stronger basis: findings are "추출 결과 기준" — never a claim about
# what the original detail page does or does not contain.
DETAIL_GAP_CAUTION = (
    "상세페이지 이미지 추출 결과를 함께 참고한 점검 후보입니다. "
    "추출 결과 기준이며 운영자 확인이 필요합니다."
)
DETAIL_GAP_FOUND_PREFIX = "확인된 안내"
DETAIL_GAP_NOT_FOUND_PREFIX = "추출 결과에서 찾지 못한 안내"
# Block budget: the full page export at section caps sits ~94 top-level blocks,
# and Notion rejects create requests over 100 — so this section gets at most
# 3 gap items × 3 blocks (+ heading + caution = 11). Three covers the current
# mapped issues (접착력 / 절단 / 구성품); the caller curates beyond that.
MAX_DETAIL_GAP_ITEMS = 3


def _detail_gap_item_blocks(gap: dict) -> list[dict]:
    """Blocks for one detail-guidance gap result (3 max, to respect the Notion
    block budget shared with the other sections): issue title as a heading, one
    bullet joining the 확인된 안내 / 추출 결과에서 찾지 못한 안내 segments (each
    omitted when empty), then the gap helper's operator_check sentence. All
    operator-facing text passes through the sanitizer as a defensive layer —
    the gap helper's wording is already cautious by contract ("추출 결과 기준",
    "점검 후보")."""
    blocks = [_heading_3(sanitize_issue_text(gap.get("issue_title") or "(제목 없음)"))]
    found = [sanitize_issue_text(g) for g in (gap.get("found_guidance") or []) if g]
    not_found = [sanitize_issue_text(g) for g in (gap.get("not_found_guidance") or []) if g]
    segments = []
    if found:
        segments.append(f"{DETAIL_GAP_FOUND_PREFIX}: {', '.join(found)}")
    if not_found:
        segments.append(f"{DETAIL_GAP_NOT_FOUND_PREFIX}: {', '.join(not_found)}")
    if segments:
        blocks.append(_bullet(" / ".join(segments)))
    check = sanitize_issue_text(gap.get("operator_check") or "")
    if check:
        blocks.append(_paragraph(check))
    return blocks


def _section_detail_candidates(result: dict) -> list[dict]:
    """상세페이지/안내 점검 후보 — gap-based when detail_guidance_gaps is present,
    otherwise derived from repeated-issue recommended actions (review-only).

    Gap path (S2x.5a): renders ``result["detail_guidance_gaps"]`` items under a
    caution stating the findings are extraction-based and need operator review.
    Used by both the compact DB body and the full page export (this is the one
    shared section builder), so the two surfaces stay consistent.

    Review-only fallback: action-first and deduplicated by (issue title,
    action). Honest-framed: we have no detail-page snapshot, so each line asks
    the operator to first check whether the guidance is already present and
    only then consider adding it — never a directive, never a claim that the
    page lacks it.
    """
    blocks = [_heading_2("상세페이지/안내 점검 후보")]
    gaps = result.get("detail_guidance_gaps") or []
    if gaps:
        blocks.append(_paragraph(DETAIL_GAP_CAUTION))
        for gap in gaps[:MAX_DETAIL_GAP_ITEMS]:
            if isinstance(gap, dict):
                blocks.extend(_detail_gap_item_blocks(gap))
        return blocks
    issues = result.get("issue_items") or []
    candidates: list[str] = []
    seen: set[str] = set()
    for item in issues:
        title = sanitize_issue_text(item.get("issue_title") or item.get("tag_label") or "")
        action = sanitize_issue_text(item.get("recommended_action") or "")
        key = f"{title}|{action}"
        if (not title and not action) or key in seen:
            continue
        seen.add(key)
        if action:
            candidates.append(f"{action} — {DETAIL_CHECK_SUFFIX}")
        else:
            candidates.append(f"{title}: {DETAIL_CHECK_SUFFIX}")
        if len(candidates) >= MAX_DETAIL_CANDIDATES:
            break
    if not candidates:
        blocks.append(_paragraph("이번 범위에서는 상세페이지/안내 점검 후보를 도출할 반복 이슈가 적습니다."))
        return blocks
    blocks.append(_paragraph(DETAIL_REVIEW_ONLY_CAUTION))
    blocks.extend(_bullet(c) for c in candidates)
    return blocks


def _section_applicability() -> list[dict]:
    """운영 적용 가능성 — static three-category framing (verbatim items).

    Compact: each category is one heading plus a single paragraph joining its
    items, instead of a bullet per item. The caution against auto-posting /
    auto-editing / causal claims stays in the third category (보류 권장)."""
    blocks = [_heading_2("적용 범위")]
    for category in APPLICABILITY_ORDER:
        blocks.append(_heading_3(category))
        blocks.append(_paragraph(" · ".join(APPLICABILITY[category])))
    return blocks


def _section_comparison(result: dict) -> list[dict]:
    # The value is what to compare on the next upload, not a weekly schedule we
    # can't enforce. Professional dashboard tone — no direct address.
    blocks = [_heading_2("다음 업로드 비교 항목")]
    for line in (
        "신규 리뷰 수 변화",
        "반복 이슈 건수 변화",
        "저평점 리뷰 비율 변화",
        "접착력/절단 관련 표현이 새로 늘었는지",
    ):
        blocks.append(_bullet(line))
    blocks.append(_heading_3("확인할 의사결정"))
    for line in (
        "어떤 이슈를 먼저 상세페이지/안내에 반영할지",
        "다음에 집중 점검할 상품군은 어디인지",
    ):
        blocks.append(_bullet(line))
    return blocks


# --- top-level builders ------------------------------------------------------


# --- compact-body section builders (Notion-native layout) -------------------
#
# These power the DB-row body only. They reuse the same data the full sections
# read but lay it out with callout/toggle blocks so the row reads like a
# dashboard, not a long document. The full page export keeps its flat layout.


def _section_ceo_summary_compact(result: dict) -> list[dict]:
    """운영 요약 as a labelled callout: 2–3 short executive lines in one block."""
    rs = result.get("rating_summary") or {}
    avg = rs.get("average")
    avg_text = f"평균 평점 {avg}점" if avg is not None else "평균 평점 미상"
    issues = result.get("issue_items") or []
    key_titles = [sanitize_issue_text(i.get("issue_title") or "") for i in issues[:MAX_CEO_ISSUES]]
    key_titles = [t for t in key_titles if t]
    lines = [
        f"분석 범위: {_scope_label(result)} · 리뷰 {_count_text(result)}",
        f"{_rating_context_phrase(result)} ({avg_text}).",
    ]
    if key_titles:
        lines.append("우선 점검: " + " / ".join(key_titles))
    else:
        lines.append("우선 점검: 이번 범위에서는 뚜렷한 반복 이슈가 적습니다.")
    return [_heading_2("운영 요약"), _callout("\n".join(lines))]


# Decision-level grouping for the compact 우선 점검 항목. The display severity
# label maps to a scannable, decision-oriented bucket; worklist items fall under
# 모니터링. Order is fixed (red → yellow → white); only non-empty groups render.
DECISION_GROUP_RED = "🔴 이번 주 반영 검토"
DECISION_GROUP_YELLOW = "🟡 내부 확인"
DECISION_GROUP_WHITE = "⚪ 모니터링"
DECISION_GROUP_ORDER = (DECISION_GROUP_RED, DECISION_GROUP_YELLOW, DECISION_GROUP_WHITE)


def _decision_group(severity_label: str) -> str:
    """Map a display severity label to a compact decision bucket.

    우선 확인 → 🔴 이번 주 반영 검토; 확인 필요 → 🟡 내부 확인; everything else
    (참고 / worklist 확인 / unknown) → ⚪ 모니터링."""
    if severity_label == "우선 확인":
        return DECISION_GROUP_RED
    if severity_label == "확인 필요":
        return DECISION_GROUP_YELLOW
    return DECISION_GROUP_WHITE


def _section_action_list_compact(result: dict) -> list[dict]:
    """우선 점검 항목 — grouped by decision level (🔴/🟡/⚪), 3–4 scannable lines.

    Issue actions group by severity; worklist items fall under ⚪ 모니터링. All
    action/reason text is run through the S1a sanitizer (worklist action/reason
    never passed through it upstream); evidence quotes are not touched. Lines are
    deduped by action so a repeated issue does not fill the list, and the total
    is capped at MAX_COMPACT_ACTION_ITEMS."""
    blocks = [_heading_2("우선 점검 항목")]
    grouped: dict[str, list[str]] = {g: [] for g in DECISION_GROUP_ORDER}
    seen: set[str] = set()
    total = 0

    def _add(group: str, raw_action: str, suffix: str) -> None:
        nonlocal total
        action = sanitize_issue_text(raw_action or "").strip()
        if not action or action in seen or total >= MAX_COMPACT_ACTION_ITEMS:
            return
        seen.add(action)
        grouped[group].append(f"{action} · {suffix}")
        total += 1

    for issue in (result.get("issue_items") or [])[:MAX_CEO_ISSUES]:
        raw = issue.get("recommended_action") or issue.get("issue_title") or ""
        group = _decision_group(issue.get("severity_label") or "확인")
        _add(group, raw, f"관련 리뷰 {issue.get('review_count', 0)}건")
    for it in result.get("worklist_items") or []:
        if total >= MAX_COMPACT_ACTION_ITEMS:
            break
        raw = it.get("suggested_action") or it.get("reason") or "내용 확인"
        _add(DECISION_GROUP_WHITE, raw, it.get("작성일", "미상"))

    if total == 0:
        blocks.append(_paragraph("이번 범위에서는 먼저 처리할 항목이 많지 않습니다."))
        return blocks
    for group in DECISION_GROUP_ORDER:
        if not grouped[group]:
            continue
        blocks.append(_paragraph(group))
        blocks.extend(_bullet(line) for line in grouped[group])
    return blocks


def _section_issues_compact(result: dict) -> list[dict]:
    """반복 이슈 — one toggle per issue. Title is '{이슈} · 관련 리뷰 N건'; the
    summary / action / verbatim evidence (capped at 2) live as toggle children."""
    blocks = [_heading_2("반복 이슈")]
    issues = result.get("issue_items") or []
    if not issues:
        blocks.append(_paragraph("이번 범위에서 묶인 반복 이슈가 없습니다."))
        return blocks
    for item in issues[:MAX_ISSUES]:
        title = sanitize_issue_text(item.get("issue_title") or "(제목 없음)")
        count = item.get("review_count", 0)
        children: list[dict] = []
        if item.get("summary"):
            children.append(_paragraph(f"요약: {sanitize_issue_text(item['summary'])}"))
        if item.get("recommended_action"):
            children.append(
                _paragraph(f"추천 조치: {sanitize_issue_text(item['recommended_action'])}")
            )
        reps = item.get("reps") or []
        shown = min(MAX_EVIDENCE_PER_ISSUE, len(reps))
        if shown:
            children.append(_paragraph(f"원문 근거: 관련 {count}건 중 {shown}건 표시"))
            for rep in reps[:shown]:
                meta = f"{rep.get('작성일', '미상')} · {rep.get('평점', '-')}점"
                children.append(_quote(f"{meta} — {_quote_text(rep.get('리뷰', ''))}"))
        blocks.append(_toggle(f"{title} · 관련 리뷰 {count}건", children))
    return blocks


OPERATOR_DECISION_INTRO = "처리할 항목만 체크하고, 필요하면 아래에 메모를 남기세요."


def _decision_todo_text(item: dict) -> str:
    """One cautious decision line per issue: '{이슈} — {조치 후보}'. Uses the
    issue's recommended action (already hedged, ends in 검토/확인/…); falls back
    to a 확인/보류 검토 prompt when no action is available."""
    title = sanitize_issue_text(item.get("issue_title") or item.get("tag_label") or "(제목 없음)")
    action = sanitize_issue_text(item.get("recommended_action") or "")
    if action:
        return f"{title} — {action}"
    return f"{title} — 확인 또는 보류 검토"


def _section_operator_decision(result: dict) -> list[dict]:
    """운영 판단 — a human decision workspace: one to-do (checkbox) per repeated
    issue, then a plain 메모 line for free notes. The operator ticks what to act
    on; nothing happens automatically. Wording stays cautious (검토/확인/보류)."""
    blocks = [_heading_2("운영 판단"), _paragraph(OPERATOR_DECISION_INTRO)]
    issues = result.get("issue_items") or []
    if not issues:
        blocks.append(_paragraph("이번 범위에서는 판단할 반복 이슈가 적습니다."))
        return blocks
    for item in issues[:MAX_ISSUES]:
        blocks.append(_todo(_decision_todo_text(item)))
    blocks.append(_paragraph("메모:"))  # plain note line, never a checkbox
    return blocks


def _section_applicability_compact() -> list[dict]:
    """적용 범위 folded into a single '적용 범위 보기' toggle. The three categories
    (incl. the 보류 권장 cautions) live as toggle children, verbatim."""
    children: list[dict] = []
    for category in APPLICABILITY_ORDER:
        children.append(_heading_3(category))
        children.append(_paragraph(" · ".join(APPLICABILITY[category])))
    return [_toggle("적용 범위 보기", children)]


def _compact_db_sections(result: dict) -> list[list[dict]]:
    """Compact body for the DB row, where the row's properties already carry the
    headline metrics. Notion-native layout: 운영 요약 as a callout, 반복 이슈 as
    per-issue toggles, 운영 판단 as a per-issue decision checklist, 적용 범위
    folded into a toggle. Keeps 우선 점검 항목 and 상세페이지·안내 점검 후보
    visible; drops the long list sections (우선 확인 리뷰, 다음 업로드 비교 항목).
    답글 검토 리뷰 is included only when there are non-positive reviews actually
    worth a reply."""
    sections = [
        _section_ceo_summary_compact(result),
        _section_action_list_compact(result),
        _section_issues_compact(result),
        _section_operator_decision(result),
    ]
    non_positive = _non_positive_needs_reply(result)
    if non_positive:
        sections.append(_section_needs_reply_compact(non_positive))
    sections.append(_section_detail_candidates(result))
    sections.append(_section_applicability_compact())
    return sections


def build_notion_blocks(result: dict, *, compact: bool = False) -> list[dict]:
    """All sections as a flat list of Notion block objects (dividers between).

    ``compact=True`` builds the shorter DB-row body (see _compact_db_sections);
    the default full body follows SECTION_TITLES. Both stay under Notion's
    100-children-per-create limit via the per-section caps above.
    """
    if compact:
        sections = _compact_db_sections(result)
    else:
        sections = [
            _section_ceo_summary(result),
            _section_action_list(result),
            _section_issues(result),
            _section_priority_reviews(result),
            _section_needs_reply(result),
            _section_detail_candidates(result),
            _section_applicability(),
            _section_comparison(result),
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


# --- database row payload builder (J1) --------------------------------------
#
# A DB-row export is the same POST /v1/pages call as the page export, but the
# parent is a database and the page carries comparison/sort metrics as Notion
# properties. The body (children) is the SAME build_notion_blocks(result), so
# both surfaces stay in sync. Pure assembly only — no client, no env, no time
# source: the caller injects ``now`` so the builder is deterministic/testable.


def _scope_short(result: dict) -> str:
    """Compact scope token for the DB row title: 전체 / 선택 N개."""
    n = len(result.get("scope_products") or [])
    if n == 0:
        return "전체"
    return f"선택 {n}개"


def _scope_kind(result: dict) -> str:
    """Range type for the 범위 유형 Select. Derived from product count only —
    the result does not carry preset-group identity, so a 2+ pick is reported
    as 선택 상품, never claimed as a named 상품군."""
    n = len(result.get("scope_products") or [])
    if n == 0:
        return "전체 상품"
    if n == 1:
        return "개별 상품"
    return "선택 상품"


def _compute_priority(result: dict) -> str:
    """Deterministic 우선도 for the row's Select. No causal claim — purely a
    triage label off counts the operator can see elsewhere in the report."""
    issue_count = result.get("issue_count") or 0
    low = (result.get("rating_summary") or {}).get("low_count") or 0
    priority = len(result.get("worklist_review_ids") or [])
    if issue_count >= 2 or low >= 10 or priority >= 10:
        return "높음"
    if issue_count >= 1 or priority >= 1:
        return "보통"
    return "낮음"


def _top_issue_titles(result: dict, limit: int = MAX_DB_KEY_ISSUES) -> str:
    """Top issue titles joined by ' · ' for the 주요 이슈 rich-text column.
    Titles are kept verbatim (comma-bearing titles survive)."""
    titles = [
        (i.get("issue_title") or "").strip()
        for i in (result.get("issue_items") or [])[:limit]
    ]
    return " · ".join(t for t in titles if t)


def notion_database_row_title(result: dict, now: datetime) -> str:
    """리뷰 점검 · MM/DD HH:mm · {scope_short} · 이슈 {issue_count}건.

    Includes HH:mm so repeated same-day exports are distinguishable in the
    Notion sidebar/list."""
    issue_count = result.get("issue_count") or 0
    return (
        f"리뷰 점검 · {now.strftime('%m/%d %H:%M')} · "
        f"{_scope_short(result)} · 이슈 {issue_count}건"
    )


def _aware_iso(now: datetime) -> str:
    """ISO 8601 with a timezone offset. A naive datetime is presumed to be local
    time and gets the system offset attached, so Notion's Date property is not
    misread as UTC and shifted forward; an already-aware datetime is preserved
    as-is (no conversion, so its wall clock keeps matching the row title)."""
    if now.tzinfo is None:
        now = now.astimezone()
    return now.isoformat()


def build_database_properties(result: dict, now: datetime) -> dict:
    """Notion property-values for one analysis-run row.

    Title (이름) is always present. Numbers/selects are always present.
    Optional metrics are OMITTED (not sent as null) when their source is
    missing: 신규 리뷰 수 when there is no store summary, 평균 평점 when no
    reviews are rated. 상태 is never set — it is a human-owned workflow column
    left at the database default. 주요 이슈 is rich text (not multi-select) so
    comma-bearing titles are not lost and no stray options are auto-created."""
    rs = result.get("rating_summary") or {}
    props: dict = {
        "이름": {"title": _rich_text(notion_database_row_title(result, now))},
        "분석일시": {"date": {"start": _aware_iso(now)}},
        "분석 범위": {"rich_text": _rich_text(result.get("scope_label") or "전체 상품")},
        "범위 유형": {"select": {"name": _scope_kind(result)}},
        "리뷰 수": {"number": result.get("scoped_active_count") or 0},
        "전체 리뷰 수": {"number": result.get("full_active_count") or 0},
        "저평점 수": {"number": rs.get("low_count") or 0},
        "우선 확인 수": {"number": len(result.get("worklist_review_ids") or [])},
        "반복 이슈 수": {"number": result.get("issue_count") or 0},
        "주요 이슈": {"rich_text": _rich_text(_top_issue_titles(result))},
        "우선도": {"select": {"name": _compute_priority(result)}},
    }
    new_summary = result.get("new_summary") or {}
    new_count = new_summary.get("new_count")
    if new_count is not None:
        props["신규 리뷰 수"] = {"number": new_count}
    avg = rs.get("average")
    if avg is not None:
        props["평균 평점"] = {"number": avg}
    return props


def build_notion_database_payload(result: dict, database_id: str, now: datetime) -> dict:
    """A Notion ``POST /v1/pages`` payload parented to a database.

    Same endpoint as the page export; the parent is a database, the row carries
    metrics as ``properties``, and the body uses the **compact** block set since
    those metrics already live in the row's columns. Pure assembly — the HTTP
    call lands in J2.
    """
    return {
        "parent": {"type": "database_id", "database_id": database_id},
        "properties": build_database_properties(result, now),
        "children": build_notion_blocks(result, compact=True),
    }


# --- thin Notion client (I2) -------------------------------------------------
#
# Single POST to the Notion pages endpoint via stdlib urllib (no dependency).
# Fully isolated IO: env resolution, the HTTP call, and a transport seam for
# tests. The API key never enters NotionExportResult, logs, or error strings.

NOTION_PAGES_URL = "https://api.notion.com/v1/pages"
NOTION_API_VERSION = "2022-06-28"

_NOTION_ENV_KEYS = ("NOTION_API_KEY", "NOTION_PARENT_PAGE_ID", "NOTION_DATABASE_ID")
_notion_env_loaded = False

# Shown when the full DB-row create is rejected (most likely a property
# name/type mismatch against the operator-created database) but the title-only
# retry succeeds, so the run is recorded with body intact but metrics dropped.
NOTION_DB_SCHEMA_MISMATCH_NOTE = (
    "DB 속성 일부가 일치하지 않아 제목/본문만 기록했습니다. "
    "속성 이름·유형 확인이 필요합니다."
)


@dataclass
class NotionExportResult:
    """Outcome of an export attempt. Deliberately carries no API key."""

    ok: bool
    url: str | None = None
    error: str | None = None
    note: str | None = None


def _notion_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Notion-Version": NOTION_API_VERSION,
    }


def _tiny_load_notion_env(path: str = ".env") -> None:
    """Minimal .env loader for the two NOTION keys only. Isolated from rag's
    OpenAI allow-list; never overrides an already-set environment value."""
    p = Path(path)
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key in _NOTION_ENV_KEYS and not os.getenv(key):
            os.environ[key] = value


def _ensure_notion_env_loaded() -> None:
    """One-time .env load for the NOTION_* keys (dotenv if available, else the
    isolated tiny loader). Idempotent; never overrides already-set env."""
    global _notion_env_loaded
    if _notion_env_loaded:
        return
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except ImportError:  # pragma: no cover - dotenv is installed here
        _tiny_load_notion_env()
    _notion_env_loaded = True


def resolve_notion_config() -> tuple[str | None, str | None]:
    """(NOTION_API_KEY, NOTION_PARENT_PAGE_ID) from env, with a one-time .env
    fallback. Either value is None when absent — the caller decides what to do
    (the Streamlit button disables itself when either is missing)."""
    _ensure_notion_env_loaded()
    return os.getenv("NOTION_API_KEY") or None, os.getenv("NOTION_PARENT_PAGE_ID") or None


def resolve_notion_database_config() -> tuple[str | None, str | None]:
    """(NOTION_API_KEY, NOTION_DATABASE_ID) from env, with the same one-time
    .env fallback. Either value is None when absent — the DB-export button
    disables itself when either is missing."""
    _ensure_notion_env_loaded()
    return os.getenv("NOTION_API_KEY") or None, os.getenv("NOTION_DATABASE_ID") or None


def resolve_notion_export_mode() -> tuple[str, str | None, str | None]:
    """Pick the single export button's target. Returns ``(mode, api_key, id)``:

    - ``("database", key, database_id)`` when the API key + a database id are set
      — the DB row is the default surface (richer for iterative comparison);
    - ``("page", key, parent_page_id)`` when no database id but a parent page is;
    - ``("none", None, None)`` when the API key or both targets are missing.

    Backend owns the routing so the Streamlit button stays a thin shell."""
    _ensure_notion_env_loaded()
    api_key = os.getenv("NOTION_API_KEY") or None
    database_id = os.getenv("NOTION_DATABASE_ID") or None
    parent_page_id = os.getenv("NOTION_PARENT_PAGE_ID") or None
    if api_key and database_id:
        return "database", api_key, database_id
    if api_key and parent_page_id:
        return "page", api_key, parent_page_id
    return "none", None, None


def _default_transport(url: str, payload: dict, headers: dict[str, str]) -> dict:
    """Real POST via urllib. Returns the parsed JSON response body."""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 (https only)
        body = resp.read().decode("utf-8")
    return json.loads(body) if body else {}


def export_to_notion(
    payload: dict, *, api_key: str, transport=None
) -> NotionExportResult:
    """POST a page-create ``payload`` to Notion. ``transport`` is an injectable
    ``(url, payload, headers) -> dict`` seam so tests never touch the network.

    Any failure is caught and returned as ``ok=False`` with the error string —
    the caller (Streamlit) shows a warning and keeps working. The API key is
    never placed in the result or the error message."""
    send = transport or _default_transport
    try:
        response = send(NOTION_PAGES_URL, payload, _notion_headers(api_key))
    except Exception as exc:  # network / HTTP / decode — all fail-soft
        return NotionExportResult(ok=False, url=None, error=str(exc))
    url = response.get("url") if isinstance(response, dict) else None
    return NotionExportResult(ok=True, url=url, error=None)


def _title_only_properties(properties: dict) -> dict:
    """Keep only the title property (the one carrying a ``title`` value), so a
    create can still succeed when the other columns don't match the DB schema.
    Title-key-agnostic: works regardless of the title property's name."""
    return {
        k: v
        for k, v in (properties or {}).items()
        if isinstance(v, dict) and "title" in v
    }


def export_to_notion_database(
    payload: dict, *, api_key: str, transport=None
) -> NotionExportResult:
    """POST a database-row create ``payload`` to Notion (same endpoint as the
    page export). ``transport`` is the same injectable seam used by tests.

    On any failure of the full create — most commonly a property name/type
    mismatch against the operator-created database — retry **once** with the
    title property + body blocks only, so the run is still recorded. A
    successful retry returns ``ok=True`` with ``note`` set so the operator
    knows the metric columns were dropped and should check their DB schema.
    The API key never enters the result or any error string."""
    send = transport or _default_transport
    headers = _notion_headers(api_key)
    try:
        response = send(NOTION_PAGES_URL, payload, headers)
    except Exception:  # full create failed — fall back to title + body only
        retry_payload = {
            **payload,
            "properties": _title_only_properties(payload.get("properties") or {}),
        }
        try:
            response = send(NOTION_PAGES_URL, retry_payload, headers)
        except Exception as exc:  # retry also failed — fail-soft, no key leak
            return NotionExportResult(ok=False, url=None, error=str(exc))
        url = response.get("url") if isinstance(response, dict) else None
        return NotionExportResult(
            ok=True, url=url, error=None, note=NOTION_DB_SCHEMA_MISMATCH_NOTE
        )
    url = response.get("url") if isinstance(response, dict) else None
    return NotionExportResult(ok=True, url=url, error=None)
