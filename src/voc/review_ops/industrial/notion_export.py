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
from datetime import date
from pathlib import Path

# --- caps (keep total blocks < 100; surfaced, never silent) -----------------

MAX_ISSUES = 5
MAX_EVIDENCE_PER_ISSUE = 2
MAX_PRIORITY_REVIEWS = 5
MAX_NEEDS_REPLY = 5
MAX_DETAIL_CANDIDATES = 6
MAX_ACTION_ITEMS = 6
MAX_CEO_ISSUES = 3  # key issues named in the CEO summary / action list
QUOTE_MAXLEN = 160  # quotes are kept short in this layout
PRODUCT_LABEL_MAXLEN = 22  # Notion-only short product label
_RICH_TEXT_MAXLEN = 1900  # Notion hard limit is 2000 per rich_text content

NO_NEEDS_REPLY_TEXT = "이번 범위에서는 명확한 답글 필요 리뷰가 많지 않습니다."

# Section headings, in order. Tests assert these all appear. Lead with the
# CEO summary + action list ("what to do next"), push raw evidence lower.
SECTION_TITLES = [
    "대표님 요약",
    "이번에 먼저 볼 것",
    "반복 이슈",
    "우선 확인 리뷰",
    "답글 필요 리뷰",
    "상세페이지/안내 보완 후보",
    "운영 적용 가능성",
    "다음 업로드 때 비교할 것",
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
    """대표님 요약 — 3~5 humble bullets leading with scope + what to look at."""
    rs = result.get("rating_summary") or {}
    avg = rs.get("average")
    avg_text = f"평균 평점 {avg}점" if avg is not None else "평균 평점 미상"
    issues = result.get("issue_items") or []
    key_titles = [i.get("issue_title") or "" for i in issues[:MAX_CEO_ISSUES]]
    key_titles = [t for t in key_titles if t]

    blocks = [_heading_2("대표님 요약")]
    blocks.append(_bullet(f"분석 범위: {_scope_label(result)} · 리뷰 {_count_text(result)}"))
    blocks.append(_bullet(f"{_rating_context_phrase(result)} ({avg_text})."))
    if key_titles:
        blocks.append(_bullet("반복 확인 신호: " + " / ".join(key_titles)))
        first = key_titles[0]
        blocks.append(
            _bullet(
                f"이번에 먼저 볼 것: {_scope_label(result)}에서 '{first}' 관련 "
                "확인 신호부터 점검하는 것을 권장합니다."
            )
        )
    else:
        blocks.append(_bullet("반복 확인 신호: 이번 범위에서는 뚜렷한 반복 이슈가 적습니다."))
        blocks.append(
            _bullet("이번에 먼저 볼 것: 우선 확인 리뷰부터 가볍게 점검하는 것을 권장합니다.")
        )
    return blocks


def _section_action_list(result: dict) -> list[dict]:
    """이번에 먼저 볼 것 — compact action digest, no long quotes.

    Combines repeated-issue actions (severity-labelled) with the top worklist
    items (확인-labelled). This is the 'what to do next' lead-in; detail lives
    in the 반복 이슈 / 우선 확인 리뷰 sections below."""
    blocks = [_heading_2("이번에 먼저 볼 것")]
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
    blocks = [_heading_2("답글 필요 리뷰")]
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


def _section_detail_candidates(result: dict) -> list[dict]:
    """상세페이지/안내 보완 후보 — derived from repeated-issue recommended actions.

    Action-first and deduplicated by (issue title, action). Hypothesis-framed:
    each line is a humble page/guidance-update candidate, never directive,
    never a claimed cause.
    """
    blocks = [_heading_2("상세페이지/안내 보완 후보")]
    issues = result.get("issue_items") or []
    candidates: list[str] = []
    seen: set[str] = set()
    for item in issues:
        title = item.get("issue_title") or item.get("tag_label") or ""
        action = item.get("recommended_action") or ""
        key = f"{title}|{action}"
        if (not title and not action) or key in seen:
            continue
        seen.add(key)
        if action:
            candidates.append(f"{action} ({title} 관련 보완 후보)")
        else:
            candidates.append(f"{title} 관련 안내 보완 후보")
        if len(candidates) >= MAX_DETAIL_CANDIDATES:
            break
    if not candidates:
        blocks.append(_paragraph("이번 범위에서는 상세페이지/안내 보완 후보를 도출할 반복 이슈가 적습니다."))
        return blocks
    blocks.extend(_bullet(c) for c in candidates)
    return blocks


def _section_applicability() -> list[dict]:
    """운영 적용 가능성 — static three-category framing (verbatim items).

    Compact: each category is one heading plus a single paragraph joining its
    items, instead of a bullet per item. The caution against auto-posting /
    auto-editing / causal claims stays in the third category."""
    blocks = [_heading_2("운영 적용 가능성")]
    for category in APPLICABILITY_ORDER:
        blocks.append(_heading_3(category))
        blocks.append(_paragraph(" · ".join(APPLICABILITY[category])))
    return blocks


def _section_comparison(result: dict) -> list[dict]:
    # Renamed from "다음 주 운영 제안" — the value is what to compare on the next
    # upload, not a weekly schedule we can't enforce.
    blocks = [_heading_2("다음 업로드 때 비교할 것")]
    for line in (
        "신규 리뷰 수 변화",
        "반복 이슈 건수 변화",
        "저평점 리뷰 비율 변화",
        "접착력/절단 관련 표현이 새로 늘었는지",
    ):
        blocks.append(_bullet(line))
    blocks.append(_heading_3("대표님에게 물어볼 질문"))
    for line in (
        "어떤 이슈를 먼저 상세페이지/안내에 반영할지",
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


# --- thin Notion client (I2) -------------------------------------------------
#
# Single POST to the Notion pages endpoint via stdlib urllib (no dependency).
# Fully isolated IO: env resolution, the HTTP call, and a transport seam for
# tests. The API key never enters NotionExportResult, logs, or error strings.

NOTION_PAGES_URL = "https://api.notion.com/v1/pages"
NOTION_API_VERSION = "2022-06-28"

_NOTION_ENV_KEYS = ("NOTION_API_KEY", "NOTION_PARENT_PAGE_ID")
_notion_env_loaded = False


@dataclass
class NotionExportResult:
    """Outcome of an export attempt. Deliberately carries no API key."""

    ok: bool
    url: str | None = None
    error: str | None = None


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


def resolve_notion_config() -> tuple[str | None, str | None]:
    """(NOTION_API_KEY, NOTION_PARENT_PAGE_ID) from env, with a one-time .env
    fallback. Either value is None when absent — the caller decides what to do
    (the Streamlit button disables itself when either is missing)."""
    global _notion_env_loaded
    if not _notion_env_loaded:
        try:
            from dotenv import load_dotenv

            load_dotenv()
        except ImportError:  # pragma: no cover - dotenv is installed here
            _tiny_load_notion_env()
        _notion_env_loaded = True
    return os.getenv("NOTION_API_KEY") or None, os.getenv("NOTION_PARENT_PAGE_ID") or None


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
