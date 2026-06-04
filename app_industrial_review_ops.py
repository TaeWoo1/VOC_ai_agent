#!/usr/bin/env python3
"""Local demo UI for the industrial review-ops pilot.

A non-technical operator uploads a CSV or XLSX review export and gets the same
worklist-first HTML report the pipeline already produces — downloadable, with a
lightweight keyword search tab. Run locally:

    streamlit run app_industrial_review_ops.py

This is a LOCAL demo, not a SaaS app. No auth, no billing, no database, no API
server, no persistent storage (uploads stay in memory). It reuses the existing
industrial review-ops pipeline unchanged and needs no OPENAI_API_KEY and no
backend — the pipeline is self-contained (pydantic + stdlib).

XLSX support is a small stdlib reader (zipfile + xml.etree); no openpyxl. Rows
are mapped through the SAME header aliases the CSV path uses
(``ingest.COLUMN_ALIASES`` / ``ingest._build_header_map``), so CSV and XLSX
produce identical canonical rows. ``src/.../ingest.py`` is not modified.
"""

from __future__ import annotations

import csv
import io
import zipfile
from datetime import date, datetime
from xml.etree import ElementTree as ET

import streamlit as st

from src.voc.review_ops.industrial import (
    cluster,
    issue_discovery,
    notion_export,
    rag,
    refine,
    store,
)
from src.voc.review_ops.industrial.classify import classify
from src.voc.review_ops.industrial.dedup import dedup
from src.voc.review_ops.industrial.ingest import _build_header_map
from src.voc.review_ops.industrial.normalize import normalize_rows
from src.voc.review_ops.industrial.render_html import render_report_html
from src.voc.review_ops.industrial.report_model import (
    LOW_RATING_THRESHOLD,
    RECENT_DAYS,
    build_report,
)
from src.voc.review_ops.industrial.schema import IndustrialReview
from src.voc.review_ops.industrial.taxonomy import CATEGORIES, CATEGORY_BY_ID

# ---------------------------------------------------------------------------
# File reading: CSV and (stdlib) XLSX -> canonical pipeline rows
# ---------------------------------------------------------------------------

_MAIN_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def _col_letters(ref: str) -> str:
    out = []
    for ch in ref:
        if ch.isalpha():
            out.append(ch)
        else:
            break
    return "".join(out)


def _col_index(letters: str) -> int:
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch.upper()) - 64)
    return n


def _first_sheet_path(z: zipfile.ZipFile) -> str:
    """Resolve the first worksheet's path via workbook.xml + its rels."""
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    sheet = wb.find(f"{_MAIN_NS}sheets/{_MAIN_NS}sheet")
    rid = sheet.get(f"{_REL_NS}id") if sheet is not None else None
    target = None
    if rid:
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        for rel in rels:
            if rel.get("Id") == rid:
                target = rel.get("Target")
                break
    if not target:
        target = "worksheets/sheet1.xml"
    if target.startswith("/"):
        return target.lstrip("/")
    return "xl/" + target


def read_xlsx(data: bytes) -> tuple[list[str], list[dict[str, str]]]:
    """Read the first sheet of an XLSX into (header names, raw-header rows).

    stdlib only. Handles shared strings, inline strings, and numeric/text cells.
    Dates stored as text (the common Korean commerce export form, e.g.
    ``2026.01.21. 19:58:59``) pass through verbatim; numeric-serial dates are not
    converted (rare for these exports).
    """
    z = zipfile.ZipFile(io.BytesIO(data))

    sst: list[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")):
            sst.append("".join(t.text or "" for t in si.iter(f"{_MAIN_NS}t")))

    def cell_value(c: ET.Element) -> str:
        t = c.get("t")
        if t == "s":
            v = c.find(f"{_MAIN_NS}v")
            if v is not None and v.text is not None:
                idx = int(v.text)
                return sst[idx] if 0 <= idx < len(sst) else ""
            return ""
        if t == "inlineStr":
            isn = c.find(f"{_MAIN_NS}is")
            return "".join(x.text or "" for x in isn.iter(f"{_MAIN_NS}t")) if isn is not None else ""
        v = c.find(f"{_MAIN_NS}v")
        return v.text if (v is not None and v.text is not None) else ""

    root = ET.fromstring(z.read(_first_sheet_path(z)))
    sheet_data = root.find(f"{_MAIN_NS}sheetData")
    rows_el = sheet_data.findall(f"{_MAIN_NS}row") if sheet_data is not None else []
    if not rows_el:
        return [], []

    header_cells: dict[str, str] = {}
    for c in rows_el[0].findall(f"{_MAIN_NS}c"):
        header_cells[_col_letters(c.get("r", ""))] = cell_value(c)
    ordered_cols = sorted((col for col in header_cells if col), key=_col_index)
    fieldnames = [header_cells[col] for col in ordered_cols]

    raw_rows: list[dict[str, str]] = []
    for r in rows_el[1:]:
        cells: dict[str, str] = {}
        for c in r.findall(f"{_MAIN_NS}c"):
            cells[_col_letters(c.get("r", ""))] = cell_value(c)
        raw_rows.append({header_cells[col]: cells.get(col, "") for col in ordered_cols})
    return fieldnames, raw_rows


def read_csv(data: bytes) -> tuple[list[str], list[dict[str, str]]]:
    text = data.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    fieldnames = list(reader.fieldnames or [])
    return fieldnames, list(reader)


def canonicalize(
    fieldnames: list[str], raw_rows: list[dict[str, str]]
) -> tuple[list[dict[str, str]], bool]:
    """Map raw rows to canonical pipeline rows. Mirrors ``ingest.load_csv``.

    Returns ``(rows, has_channel_column)``. Raises ``ValueError`` if no column
    maps to the required ``text`` field.
    """
    header_map = _build_header_map(fieldnames)
    canon_fields = set(header_map.values())
    if "text" not in canon_fields:
        raise ValueError(
            "리뷰 내용(text) 열을 찾을 수 없습니다. "
            "리뷰내용 / 리뷰 / 후기 / 내용 / review / text 중 하나가 필요합니다."
        )

    rows: list[dict[str, str]] = []
    for raw in raw_rows:
        canon: dict[str, str] = {}
        for raw_key, value in raw.items():
            field = header_map.get(raw_key)
            if field:
                canon[field] = (value or "").strip() if isinstance(value, str) else (
                    "" if value is None else str(value).strip()
                )
        if canon.get("text"):
            rows.append(canon)
    return rows, ("channel" in canon_fields)


def load_upload(
    filename: str, data: bytes, channel_override: str | None
) -> tuple[list[dict[str, str]], bool]:
    """Read an uploaded CSV/XLSX into canonical rows; apply a channel override.

    Returns ``(rows, had_channel_column)``.
    """
    if filename.lower().endswith(".xlsx"):
        fieldnames, raw_rows = read_xlsx(data)
    else:
        fieldnames, raw_rows = read_csv(data)
    rows, has_channel = canonicalize(fieldnames, raw_rows)

    override = (channel_override or "").strip()
    if override:
        for row in rows:
            if not row.get("channel"):
                row["channel"] = override
    return rows, has_channel


# ---------------------------------------------------------------------------
# Lightweight search: keyword shortcuts -> taxonomy categories
# ---------------------------------------------------------------------------

# Plain-Korean query shortcuts. Typing one of these also matches reviews carrying
# the mapped taxonomy tag (not just literal substring hits). NOT AI/RAG.
QUERY_SHORTCUTS: dict[str, str] = {
    "배송 파손": "delivery_packaging_damage",
    "파손": "delivery_packaging_damage",
    "답글": "needs_reply",
    "문의": "needs_reply",
    "사이즈": "spec_size_confusion",
    "규격": "spec_size_confusion",
    "설치": "installation_difficulty",
    "구성품": "missing_or_wrong_components",
    "누락": "missing_or_wrong_components",
    "교환": "cs_exchange_return_issue",
    "반품": "cs_exchange_return_issue",
    "cs": "cs_exchange_return_issue",
    "재구매": "reorder_bulk_purchase_signal",
    "대량": "reorder_bulk_purchase_signal",
    "상세페이지": "detail_page_faq_candidate",
    "faq": "detail_page_faq_candidate",
}

LABEL_TO_ID: dict[str, str] = {c.label_ko: c.id for c in CATEGORIES}


def _rating_bucket(rating: float | None) -> str:
    return "미상" if rating is None else str(int(round(rating)))


# ---------------------------------------------------------------------------
# New-review detection summary (pure; no Streamlit, no OpenAI, no DB)
# ---------------------------------------------------------------------------

# Operator status options. First entry is the default "untouched" state.
STATUS_OPTIONS: list[str] = [
    "확인 안 함",
    "확인함",
    "답글 필요",
    "답글 완료",
    "상세페이지 후보",
    "CS 확인 필요",
    "보류",
]


# Operator-friendly labels for the native repeated-issue cards. Severity wording
# matches render_html (우선 확인 / 확인 필요 / 참고). Display-only — these do not
# touch taxonomy, scoring, or cluster thresholds.
SEVERITY_LABELS: dict[str, str] = {"high": "우선 확인", "medium": "확인 필요", "low": "참고"}
ISSUE_TYPE_LABELS: dict[str, str] = {
    "product": "제품",
    "detail_page": "상세페이지",
    "cs": "CS/교환",
    "shipping": "배송/포장",
    "positive_signal": "긍정 신호",
    "ignore": "기타",
}


def severity_label(severity: str) -> str:
    """Map an engine severity (high/medium/low) to operator wording."""
    return SEVERITY_LABELS.get(severity, severity)


# Operator-facing repeated-issue display modes -> (max_issue_cards, max_evidence).
# Replaces raw cluster-count / evidence-count knobs so the operator never has to
# reason about cluster internals. 자동 추천 is the demo default.
ISSUE_DISPLAY_MODES: dict[str, tuple[int, int]] = {
    "자동 추천": (5, 3),
    "적게 보기": (3, 3),
    "많이 보기": (8, 5),
}
ISSUE_DISPLAY_MODE_DEFAULT = "자동 추천"


def issue_display_mode_params(mode: str) -> tuple[int, int]:
    """Map a display mode to (max_issue_cards, max_evidence); unknown -> 자동 추천."""
    return ISSUE_DISPLAY_MODES.get(mode, ISSUE_DISPLAY_MODES[ISSUE_DISPLAY_MODE_DEFAULT])


def issue_product_summary(
    issue_review_ids: list[str], product_by_id: dict[str, str]
) -> str:
    """Compact product-context line for a repeated-issue card. Pure.

    Maps the issue's evidence review_ids to product names (via ``product_by_id``)
    and summarizes which product(s) the evidence came from — important because an
    upload can mix products. Products are ordered by evidence count desc, then
    name. Returns "" when no evidence id resolves to a product.
    """
    counts: dict[str, int] = {}
    for rid in issue_review_ids:
        name = product_by_id.get(rid)
        if name:
            counts[name] = counts.get(name, 0) + 1
    if not counts:
        return ""
    ordered = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    if len(ordered) == 1:
        return f"상품: {ordered[0][0]}"
    if len(ordered) == 2:
        return f"주요 상품: {ordered[0][0]}, {ordered[1][0]}"
    return f"주요 상품: {ordered[0][0]} 외 {len(ordered) - 1}개"


def issue_display_item(
    cluster, max_reps: int = 5, *, product_by_id: dict[str, str] | None = None
) -> dict:
    """One repeated-issue cluster as a display dict for the native issue card.

    Pure: no Streamlit/OpenAI. ``reps`` are the verbatim representative reviews
    (원문 근거), capped at ``max_reps``. ``product_summary`` names the product(s)
    the evidence came from (blank if ``product_by_id`` is not provided).
    """
    reps = [
        {
            "작성일": r.review_date.isoformat() if r.review_date else "미상",
            "채널": r.channel,
            "평점": _rating_bucket(r.rating),
            "상품명": r.product_name or "-",
            "리뷰": r.text,
        }
        for r in cluster.representatives[:max_reps]
    ]
    return {
        "issue_title": cluster.issue_title,
        "severity": cluster.severity,
        "severity_label": severity_label(cluster.severity),
        "type_label": ISSUE_TYPE_LABELS.get(cluster.issue_type, cluster.issue_type),
        "tag_label": cluster.tag_label,
        "review_count": cluster.review_count,
        "summary": cluster.summary,
        "recommended_action": cluster.recommended_action,
        "product_summary": issue_product_summary(cluster.review_ids, product_by_id or {}),
        "reps": reps,
    }


def _display_item(review: IndustrialReview, tags: list[str]) -> dict:
    """One review as a compact display dict carrying its ``review_id``."""
    return {
        "review_id": review.review_id,
        "작성일": review.review_date.isoformat() if review.review_date else "미상",
        "채널": review.channel,
        "상품명": review.product_name or "-",
        "평점": _rating_bucket(review.rating),
        "태그": ", ".join(CATEGORY_BY_ID[t].label_ko for t in tags) or "-",
        "리뷰": review.text,
    }


def load_review_statuses(conn, review_ids: list[str]) -> dict[str, dict]:
    """Load saved status/memo for the given review_ids via the store.

    Thin wrapper over ``store.get_review_status`` (one read per id). Returns a
    ``{review_id: {status, memo, updated_at}}`` map containing only ids that
    have a saved status. Pure of Streamlit/OpenAI; testable with a tmp store.
    """
    out: dict[str, dict] = {}
    for rid in review_ids:
        saved = store.get_review_status(conn, rid)
        if saved:
            out[rid] = saved
    return out


def compute_new_review_summary(
    tagged: list[tuple[IndustrialReview, list[str]]],
    new_review_ids: set[str],
    worklist_review_ids: set[str],
    *,
    max_rows: int = 20,
) -> dict:
    """Summarize how this upload's active reviews compare to prior uploads.

    Pure data in, pure dict out — the Streamlit layer only renders this. Counts
    are computed against ``tagged`` (this upload's active, deduped reviews) so a
    review_id reported new by the store but absent from this batch never inflates
    a count. ``new_rows`` is capped at ``max_rows``, newest first.
    """
    new_set = set(new_review_ids)
    total_active = len(tagged)
    new_count = sum(1 for r, _ in tagged if r.review_id in new_set)
    seen_count = total_active - new_count
    first_upload = total_active > 0 and new_count == total_active
    priority_new_count = len(new_set & set(worklist_review_ids))
    needs_reply_new_count = sum(
        1 for r, tags in tagged if r.review_id in new_set and "needs_reply" in tags
    )

    new_tagged = [(r, tags) for r, tags in tagged if r.review_id in new_set]
    new_tagged.sort(key=lambda rt: (rt[0].review_date or date.min), reverse=True)
    new_items = [_display_item(r, tags) for r, tags in new_tagged[:max_rows]]
    return {
        "total_active": total_active,
        "new_count": new_count,
        "seen_count": seen_count,
        "first_upload": first_upload,
        "priority_new_count": priority_new_count,
        "needs_reply_new_count": needs_reply_new_count,
        "new_items": new_items,
    }


# ---------------------------------------------------------------------------
# Overall review context (전체 리뷰 상태) + review filters (pure; no Streamlit)
# ---------------------------------------------------------------------------

# Operator-facing quick filters for the 리뷰 확인 tab: (label, key). These are
# pure membership filters over the already-classified active reviews — no new
# classification, scoring, or thresholds. "우선 확인" reuses the worklist ids;
# "반복 이슈 관련 리뷰" reuses the verified repeated-issue evidence ids; "신규 리뷰"
# reuses the store's new-review ids. Counts/views degrade to 0 when a feature
# (store / repeated issues) did not run.
REVIEW_FILTERS: list[tuple[str, str]] = [
    ("전체", "all"),
    ("신규 리뷰", "new"),
    ("우선 확인", "priority"),
    ("1~3점", "low_rating"),
    ("답글 필요", "needs_reply"),
    ("상세페이지 후보", "detail_page"),
    ("반복 이슈 관련 리뷰", "repeated_issue"),
]

# Display-only interpretation threshold (NOT a scoring/cluster threshold): once
# the low-rating share among rated reviews reaches this, the summary nudges the
# operator toward the worklist first instead of the "mostly positive" framing.
LOW_RATING_SHARE_HIGH = 0.2
POSITIVE_INTERPRETATION = (
    "전체적으로는 고평점 리뷰가 많지만, 우선 확인 리뷰 안에서는 아래 이슈가 반복됩니다."
)
LOW_RATING_INTERPRETATION = (
    "저평점 리뷰 비중이 있어 우선 확인 리뷰를 먼저 보는 것이 좋습니다."
)


def compute_rating_summary(
    active_reviews: list[IndustrialReview],
    recent_days: int,
    today: date,
) -> dict:
    """Overall rating context for the 전체 리뷰 상태 section (pure; no Streamlit).

    Counts are over active (deduped) reviews. ``distribution`` covers 5..1;
    reviews with no rating are counted in ``unknown_rating`` only. ``low_count``
    is ratings <= ``LOW_RATING_THRESHOLD`` (1~3점). ``recent_count`` is reviews
    dated within ``recent_days`` of ``today`` (unknown dates excluded).
    ``interpretation`` is display copy selected by the low-rating share — it is
    NOT a scoring decision.
    """
    total = len(active_reviews)
    dist = {b: 0 for b in ("5", "4", "3", "2", "1")}
    rated = 0
    rating_sum = 0.0
    unknown_rating = 0
    low_count = 0
    recent_count = 0
    for r in active_reviews:
        if r.rating is None:
            unknown_rating += 1
        else:
            bucket = str(int(round(r.rating)))
            if bucket in dist:
                dist[bucket] += 1
            rated += 1
            rating_sum += r.rating
            if r.rating <= LOW_RATING_THRESHOLD:
                low_count += 1
        if r.review_date is not None and 0 <= (today - r.review_date).days <= recent_days:
            recent_count += 1

    average = round(rating_sum / rated, 1) if rated else None
    low_share = (low_count / rated) if rated else 0.0
    interpretation = (
        LOW_RATING_INTERPRETATION
        if low_share >= LOW_RATING_SHARE_HIGH
        else POSITIVE_INTERPRETATION
    )
    return {
        "total": total,
        "rated_count": rated,
        "average": average,
        "distribution": dist,
        "unknown_rating": unknown_rating,
        "low_count": low_count,
        "low_share": low_share,
        "recent_count": recent_count,
        "interpretation": interpretation,
    }


def rating_distribution_bars(rating_summary: dict) -> list[dict]:
    """Rating distribution as visual-bar rows (5..1) for 전체 리뷰 상태. Pure.

    Each row is ``{label, count, fraction}`` where ``fraction`` is the share of
    total active reviews (0..1), used to size a horizontal bar. The numbers stay
    visible alongside the bar.
    """
    dist = rating_summary.get("distribution") or {}
    total = rating_summary.get("total") or 0
    rows: list[dict] = []
    for b in ("5", "4", "3", "2", "1"):
        n = dist.get(b, 0)
        rows.append(
            {"label": f"{b}점", "count": n, "fraction": (n / total) if total else 0.0}
        )
    return rows


# Bucket label for reviews with no product name (none in the current sample, but
# the grouping must be total so scoping is well-defined). Selecting this label
# scopes to the blank-product reviews.
UNKNOWN_PRODUCT_LABEL = "상품명 미상"


def _product_key(review: IndustrialReview) -> str:
    """Group key for a review's product (blank/None -> 상품명 미상)."""
    return review.product_name or UNKNOWN_PRODUCT_LABEL


def compute_product_summaries(
    active_reviews: list[IndustrialReview],
    recent_days: int,
    today: date,
) -> list[dict]:
    """Per-product review context for the 분석 범위 selector (pure; no Streamlit).

    Groups active (deduped) reviews by product name and returns one dict per
    product (``product_name``, ``review_count``, ``average_rating``,
    ``low_rating_count``, ``recent_review_count``), sorted by ``review_count``
    desc then name. Reuses the same low-rating / recent-window definitions as
    ``compute_rating_summary``. ``today`` should be resolved once from the full
    corpus so the recent window is stable across scopes.
    """
    groups: dict[str, list[IndustrialReview]] = {}
    for r in active_reviews:
        groups.setdefault(_product_key(r), []).append(r)

    out: list[dict] = []
    for name, revs in groups.items():
        ratings = [r.rating for r in revs if r.rating is not None]
        average = round(sum(ratings) / len(ratings), 1) if ratings else None
        low = sum(1 for r in revs if r.rating is not None and r.rating <= LOW_RATING_THRESHOLD)
        recent = sum(
            1
            for r in revs
            if r.review_date is not None and 0 <= (today - r.review_date).days <= recent_days
        )
        out.append(
            {
                "product_name": name,
                "review_count": len(revs),
                "average_rating": average,
                "low_rating_count": low,
                "recent_review_count": recent,
            }
        )
    out.sort(key=lambda d: (-d["review_count"], d["product_name"]))
    return out


def truncate_product_label(name: str, width: int = 28) -> str:
    """Shorten a long product name for a compact selector label (display only).

    Short names pass through unchanged; long names are cut to ``width`` with a
    trailing ellipsis. The full name remains the selection value elsewhere.
    """
    name = name or ""
    if len(name) <= width:
        return name
    return name[: max(0, width - 1)].rstrip() + "…"


# ---------------------------------------------------------------------------
# Product-group scope presets (reviewable, conservative)
# ---------------------------------------------------------------------------
# Each raw product name maps to exactly ONE group via first-match-wins over this
# ordered rule list, so selecting two groups can never double-count a SKU.
# Unmatched names fall into 기타 — never force-merged into a real line. This is
# plain data, not a model: the keyword lists are meant to be read/edited in one
# screen, and the resolved membership is shown to the operator (그룹 구성 보기)
# before they trust a preset.
#
# Ordering matters. Hardware (dispensers/holders/collectors) is matched BEFORE
# the consumable cup so combo SKUs ("...생수컵 + 하향식 디스펜서") land in hardware,
# whose dispenser is the durable distinguishing item. Molding is first because
# 선바로/연결캡 are unambiguous.
PRODUCT_GROUP_OTHER_ID = "기타"
PRODUCT_GROUP_OTHER_LABEL = "기타"

PRODUCT_GROUP_RULES: list[tuple[str, str, list[str]]] = [
    (
        "wire_molding",
        "전선몰딩·선바로 계열",
        ["전선몰딩", "전선몰드", "선바로", "연결캡"],
    ),
    (
        "cup_hardware",
        "디스펜서·보관함·수거함 계열",
        [
            "디스펜서", "보관함", "수거함", "수거기", "홀더", "당겨바",
            "케이스", "배출기", "분리수거함", "돌리미",
        ],
    ),
    (
        "paper_cup",
        "세모금컵·생수컵 계열",
        ["세모금컵", "세모금생수컵", "생수컵", "종이컵", "꼬깔컵"],
    ),
]

PRODUCT_GROUP_LABELS: dict[str, str] = {
    gid: label for gid, label, _ in PRODUCT_GROUP_RULES
}
PRODUCT_GROUP_LABELS[PRODUCT_GROUP_OTHER_ID] = PRODUCT_GROUP_OTHER_LABEL


def assign_product_group(name: str | None) -> str:
    """Map one raw product name to exactly one group id (first-match-wins). Pure.

    Blank/None and any name matching no rule -> PRODUCT_GROUP_OTHER_ID.
    """
    text = name or ""
    for group_id, _label, keywords in PRODUCT_GROUP_RULES:
        if any(kw in text for kw in keywords):
            return group_id
    return PRODUCT_GROUP_OTHER_ID


def compute_product_groups(product_summaries: list[dict]) -> list[dict]:
    """Bucket the last result's product_summaries into reviewable groups. Pure.

    Returns one dict per non-empty group, in PRODUCT_GROUP_RULES order with 기타
    last: ``{group_id, label, products:[raw names present], review_count,
    low_rating_count, recent_review_count}``. Only SKUs actually present are
    included; empty groups (and 기타 when nothing is unmatched) are dropped.
    Members preserve the incoming summary order (review_count desc).
    """
    buckets: dict[str, dict] = {}
    for s in product_summaries:
        gid = assign_product_group(s["product_name"])
        b = buckets.setdefault(
            gid,
            {
                "group_id": gid,
                "label": PRODUCT_GROUP_LABELS.get(gid, gid),
                "products": [],
                "review_count": 0,
                "low_rating_count": 0,
                "recent_review_count": 0,
            },
        )
        b["products"].append(s["product_name"])
        b["review_count"] += s["review_count"]
        b["low_rating_count"] += s["low_rating_count"]
        b["recent_review_count"] += s["recent_review_count"]

    order = [gid for gid, _, _ in PRODUCT_GROUP_RULES] + [PRODUCT_GROUP_OTHER_ID]
    return [buckets[gid] for gid in order if gid in buckets]


def expand_group_selection(
    selected_group_ids: list[str] | set[str],
    selected_individual_names: list[str] | set[str],
    product_groups: list[dict],
) -> set[str]:
    """Resolve group + individual selections into a raw-product-name filter. Pure.

    Group ids expand to their member raw names, unioned with any individually
    selected names. Empty result -> empty set (caller treats as 전체 상품).
    """
    gids = set(selected_group_ids or [])
    names: set[str] = set(selected_individual_names or [])
    for g in product_groups:
        if g["group_id"] in gids:
            names.update(g["products"])
    return names


def _resolve_scope(
    product_filter: set[str] | None,
    product_summaries: list[dict],
) -> tuple[set[str] | None, list[str], str]:
    """Resolve the analysis scope against the products actually present.

    Returns ``(scope_set, scope_products, scope_label)``. ``scope_set`` is None
    for 전체 상품 (no filter, empty filter, or all selected names absent — the
    last case falls back to full corpus rather than silently returning 0).
    """
    if not product_filter:
        return None, [], "전체 상품"
    valid = {s["product_name"] for s in product_summaries}
    selected = sorted(name for name in product_filter if name in valid)
    if not selected:
        return None, [], "전체 상품"
    return set(selected), selected, f"선택 상품 {len(selected)}개"


def scope_caption_text(result: dict) -> str:
    """Operator-facing scope line for the summary / review tabs. Pure."""
    products = result.get("scope_products") or []
    if not products:
        return "전체 상품 기준"
    return f"선택 상품 기준: {len(products)}개 상품"


def scoped_product_status_summaries(
    product_summaries: list[dict], scope_products: list[str] | None
) -> list[dict]:
    """Subset of product_summaries limited to the selected scope, preserving the
    incoming (count-desc) order. Pure. Empty/absent scope -> [] (caller then
    falls back to the full-file table). product_summaries always span the full
    corpus; this only narrows what the summary tab surfaces first."""
    scope = set(scope_products or [])
    if not scope:
        return []
    return [s for s in product_summaries if s.get("product_name") in scope]


def product_status_rows(product_summaries: list[dict]) -> list[dict]:
    """Format product_summaries into 상품별 리뷰 상태 table rows. Pure."""
    return [
        {
            "상품명": s["product_name"],
            "리뷰 수": s["review_count"],
            "평균 평점": s["average_rating"] if s["average_rating"] is not None else "-",
            "저평점 수": s["low_rating_count"],
            "최근 리뷰 수": s["recent_review_count"],
        }
        for s in product_summaries
    ]


def _review_matches_filter(
    review: IndustrialReview,
    tags: list[str],
    filter_key: str,
    *,
    new_ids: set[str],
    worklist_ids: set[str],
    issue_ids: set[str],
) -> bool:
    """Whether one classified review matches a REVIEW_FILTERS key. Pure."""
    if filter_key == "new":
        return review.review_id in new_ids
    if filter_key == "priority":
        return review.review_id in worklist_ids
    if filter_key == "low_rating":
        return review.rating is not None and review.rating <= LOW_RATING_THRESHOLD
    if filter_key == "needs_reply":
        return "needs_reply" in tags
    if filter_key == "detail_page":
        return "detail_page_faq_candidate" in tags
    if filter_key == "repeated_issue":
        return review.review_id in issue_ids
    return True  # "all" / unknown key -> no filtering


def compute_filter_counts(
    tagged: list[tuple[IndustrialReview, list[str]]],
    *,
    new_ids: set[str],
    worklist_ids: set[str],
    issue_ids: set[str],
) -> dict[str, int]:
    """Count active reviews matching each REVIEW_FILTERS key (pure)."""
    counts: dict[str, int] = {}
    for _label, key in REVIEW_FILTERS:
        counts[key] = sum(
            1
            for review, tags in tagged
            if _review_matches_filter(
                review, tags, key,
                new_ids=new_ids, worklist_ids=worklist_ids, issue_ids=issue_ids,
            )
        )
    return counts


def filter_review_items(
    tagged: list[tuple[IndustrialReview, list[str]]],
    filter_key: str,
    *,
    new_ids: set[str],
    worklist_ids: set[str],
    issue_ids: set[str],
) -> list[dict]:
    """Active reviews matching ``filter_key`` as display dicts, newest first. Pure."""
    matched = [
        (review, tags)
        for review, tags in tagged
        if _review_matches_filter(
            review, tags, filter_key,
            new_ids=new_ids, worklist_ids=worklist_ids, issue_ids=issue_ids,
        )
    ]
    matched.sort(key=lambda rt: (rt[0].review_date or date.min), reverse=True)
    return [_display_item(r, tags) for r, tags in matched]


# ---------------------------------------------------------------------------
# Repeated-issue engine selection (discovery primary, legacy fallback)
# ---------------------------------------------------------------------------


def _run_repeated_issues(
    report,
    reviews,
    *,
    api_key: str,
    today,
    recent_days: int,
    max_issues: int,
    max_evidence: int,
    max_reps: int,
    reuse_embeddings: dict | None,
):
    """LLM issue discovery first; fall back to the legacy cluster engine only on
    a hard failure (call error / unparseable JSON / unexpected exception). A valid
    zero-issue discovery result is respected (no fallback)."""
    try:
        report2, dsum = issue_discovery.discover_issues(
            report, reviews, api_key=api_key, today=today, recent_days=recent_days,
            max_issues=max_issues, max_evidence=max_evidence,
        )
        if dsum.get("status") != "hard_failure":
            return report2, dsum
    except Exception:
        pass  # treat unexpected discovery errors as a hard failure -> fallback

    try:
        report3, csum = cluster.cluster_issues(
            report, reviews, api_key=api_key, embeddings=reuse_embeddings, today=today,
            recent_days=recent_days, max_clusters=max_issues,
            max_representatives=max_reps, max_evidence=max_evidence,
        )
        return report3, {"status": "ok", "engine": "fallback", **csum}
    except Exception as e:
        return report, {"status": "error", "engine": "fallback", "error": str(e)}


# ---------------------------------------------------------------------------
# Pipeline driver
# ---------------------------------------------------------------------------


def generate(
    rows: list[dict[str, str]],
    *,
    title: str,
    today: date | None,
    recent_days: int,
    filename: str = "upload",
    store_path: str | None = None,
    do_refine: bool = False,
    refine_top_n: int = refine.DEFAULT_TOP_N,
    do_cluster: bool = False,
    cluster_max_clusters: int = cluster.DEFAULT_MAX_CLUSTERS,
    cluster_max_reps: int = cluster.DEFAULT_MAX_REPRESENTATIVES,
    cluster_max_evidence: int = cluster.DEFAULT_MAX_REPRESENTATIVES,
    reuse_embeddings: dict | None = None,
    product_filter: set[str] | None = None,
) -> dict:
    reviews = dedup(normalize_rows(rows))
    full_active = [r for r in reviews if not r.is_duplicate]

    # Resolve "today" once from the FULL corpus so the recent window is stable
    # regardless of the selected product scope (matches build_report when None).
    resolved_today = today
    if resolved_today is None:
        known_dates = [r.review_date for r in full_active if r.review_date is not None]
        resolved_today = max(known_dates) if known_dates else date.today()

    # Per-product summary is always over the FULL corpus so the operator can
    # widen/narrow scope from any result. LLM-free.
    product_summaries = compute_product_summaries(full_active, recent_days, resolved_today)

    # Resolve the analysis scope. Empty/all-absent selections -> 전체 상품. The
    # scope is applied here, before build_report/discovery, so repeated-issue
    # discovery never mixes unrelated products' issues.
    scope_set, scope_products, scope_label = _resolve_scope(product_filter, product_summaries)
    reviews_in_scope = (
        reviews if scope_set is None
        else [r for r in reviews if _product_key(r) in scope_set]
    )
    active = [r for r in reviews_in_scope if not r.is_duplicate]

    report = build_report(
        reviews_in_scope, today=resolved_today, recent_days=recent_days,
        title=title, density_note=None,
    )

    # Optional LLM refinement of the top-N worklist candidates only. Any failure
    # (no key, bad JSON, network) falls back to the rule-based report.
    refine_summary: dict | None = None
    if do_refine:
        api_key = rag.resolve_api_key()
        if not api_key:
            refine_summary = {"status": "no_key"}
        else:
            try:
                report, summary = refine.refine_worklist(
                    report, api_key=api_key, top_n=refine_top_n
                )
                refine_summary = {"status": "ok", **summary}
            except Exception as e:  # whole-feature fallback
                refine_summary = {"status": "error", "error": str(e)}

    # Optional repeated issues (Slice G). LLM issue discovery is the primary
    # engine; the legacy tag-first cluster engine is the fallback on hard failure.
    # Either way only issue_clusters is added — worklist rows are never modified.
    cluster_summary: dict | None = None
    if do_cluster:
        api_key = rag.resolve_api_key()
        if not api_key:
            cluster_summary = {"status": "no_key"}
        else:
            report, cluster_summary = _run_repeated_issues(
                report,
                reviews_in_scope,
                api_key=api_key,
                today=today,
                recent_days=recent_days,
                max_issues=cluster_max_clusters,
                max_evidence=cluster_max_evidence,
                max_reps=cluster_max_reps,
                reuse_embeddings=reuse_embeddings,
            )

    html = render_report_html(report, recent_days=recent_days)
    tagged = [(r, classify(r)) for r in active]
    today_count = sum(1 for w in report.worklist if w.tier == "today")

    # Compact worklist rows for the inline status/memo editor (top 20 only — the
    # full worklist stays in the HTML preview/download for scanning & printing).
    worklist_items = [
        {
            "review_id": w.review_id,
            "작성일": w.review_date.isoformat() if w.review_date else "미상",
            "채널": w.channel,
            "상품명": w.product_name or "-",
            "평점": _rating_bucket(w.rating),
            "태그": ", ".join(w.tag_labels) or "-",
            "리뷰": w.text,
            # reason / suggested_action are already on the worklist entry
            # (report_model). Carried through for export surfaces (Notion); the
            # inline editor ignores them. Additive only — no scoring change.
            "reason": w.reason,
            "suggested_action": w.suggested_action,
        }
        for w in report.worklist[:20]
    ]

    # Review-id sets reused by the 전체 리뷰 상태 stats and the 리뷰 확인 filters.
    # Pure derivations from the report — computed before the (fail-soft) store
    # block so the filters work even if the store cannot be opened.
    worklist_review_ids = {w.review_id for w in report.worklist}
    issue_review_ids: set[str] = set()
    for c in report.issue_clusters:
        issue_review_ids.update(c.review_ids)

    # review_id -> product, for the per-card product-context line. Built from the
    # (scoped) active reviews; evidence ids are always drawn from this set.
    product_by_id = {r.review_id: _product_key(r) for r in active}

    # Rating context for the (scoped) 전체 리뷰 상태 section. resolved_today is
    # the full-corpus value so the recent window matches across scopes.
    rating_summary = compute_rating_summary(active, recent_days, resolved_today)

    # Persist this upload to the local store and detect which reviews are new
    # vs. previous uploads. This runs on the FULL corpus (new-review detection is
    # a corpus fact, independent of the selected scope); the surfaced new counts
    # still scope because compute_new_review_summary works over the scoped tagged
    # list. Fail-soft: any store error leaves the report intact.
    new_summary: dict | None = None
    store_status: dict | None = None
    new_ids: set[str] = set()
    try:
        conn = store.open_store(store_path)
        try:
            upload_id = store.create_upload(conn, filename, len(full_active))
            upsert = store.upsert_reviews(conn, upload_id, full_active)
        finally:
            conn.close()
        new_ids = set(upsert["new_review_ids"])
        new_summary = compute_new_review_summary(tagged, new_ids, worklist_review_ids)
        store_status = {"status": "ok"}
    except Exception as e:  # whole-feature fallback; report still renders
        store_status = {"status": "error", "error": str(e)}

    return {
        "html": html,
        "tagged": tagged,
        "total": report.header.total_reviews,
        "duplicates": len(reviews_in_scope) - len(active),
        "today_count": today_count,
        "week_count": len(report.worklist) - today_count,
        "date_unknown": report.header.date_unknown_count,
        "rating_unknown": report.header.rating_unknown_count,
        "channels": sorted({r.channel for r in active}),
        "recent_days": recent_days,
        "refine_summary": refine_summary,
        "cluster_summary": cluster_summary,
        "issue_count": len(report.issue_clusters),
        "issue_items": [
            issue_display_item(c, product_by_id=product_by_id)
            for c in report.issue_clusters
        ],
        "new_summary": new_summary,
        "store_status": store_status,
        "store_path": store_path,
        "worklist_items": worklist_items,
        "rating_summary": rating_summary,
        "worklist_review_ids": worklist_review_ids,
        "issue_review_ids": issue_review_ids,
        "new_review_ids": new_ids,
        "product_summaries": product_summaries,
        "scope_products": scope_products,
        "scope_label": scope_label,
        "scoped_active_count": len(active),
        "full_active_count": len(full_active),
    }


# ---------------------------------------------------------------------------
# UI
# ---------------------------------------------------------------------------


def _render_review_editors(items: list[dict], store_path: str | None, key_prefix: str) -> None:
    """Compact per-review status/memo editor: one collapsed expander per review.

    Opens the local store fail-soft. If it cannot open, the reviews still render
    read-only with a small caption. Saved status appears in each expander title
    so handled reviews are scannable without expanding.
    """
    conn = None
    try:
        conn = store.open_store(store_path)
    except Exception:
        st.caption("로컬 저장소를 열지 못해 상태 저장을 건너뛰었습니다. (리포트는 정상입니다.)")

    status_by_id = (
        load_review_statuses(conn, [it["review_id"] for it in items]) if conn else {}
    )

    try:
        for item in items:
            rid = item["review_id"]
            saved = status_by_id.get(rid, {})
            cur_status = saved.get("status") or STATUS_OPTIONS[0]
            cur_memo = saved.get("memo") or ""
            handled = "" if cur_status == STATUS_OPTIONS[0] else f"  ·  [{cur_status}]"
            title = f"{item['작성일']} · {item['채널']} · {item['평점']}점{handled}"
            with st.expander(title):
                st.write(item["리뷰"])
                if item["태그"] != "-":
                    st.caption(f"태그: {item['태그']}")
                idx = STATUS_OPTIONS.index(cur_status) if cur_status in STATUS_OPTIONS else 0
                new_status = st.selectbox(
                    "처리 상태", STATUS_OPTIONS, index=idx,
                    key=f"{key_prefix}_status_{rid}", disabled=conn is None,
                )
                new_memo = st.text_area(
                    "메모", value=cur_memo, key=f"{key_prefix}_memo_{rid}",
                    disabled=conn is None, height=80,
                )
                if st.button("저장", key=f"{key_prefix}_save_{rid}", disabled=conn is None):
                    try:
                        store.set_review_status(conn, rid, new_status, new_memo)
                        st.success("저장했습니다.")
                    except Exception as e:
                        st.error(f"저장하지 못했습니다: {e}")
    finally:
        if conn is not None:
            conn.close()


def _render_sidebar() -> None:
    """Upload + run + collapsed 고급 설정. Sets st.session_state['result']."""
    with st.sidebar:
        st.header("리뷰 파일 올리기")
        uploaded = st.file_uploader(
            "CSV 또는 XLSX 파일", type=["csv", "xlsx"], accept_multiple_files=False
        )
        channel_override = st.text_input(
            "채널 이름 (선택)", value="", placeholder="예: 네이버"
        )

        with st.expander("고급 설정", expanded=False):
            title = st.text_input("리포트 제목", value="산업자재 리뷰 운영 점검")
            auto_today = st.checkbox("기준 날짜 자동", value=True)
            today_input = st.date_input("기준 날짜", value=date.today(), disabled=auto_today)
            recent_days = st.number_input(
                "최근 며칠 이내를 우선 확인 기간으로 볼까요?",
                min_value=1, max_value=365, value=90, step=1,
            )
            do_refine = st.checkbox("문구 자동 정리", value=True)
            refine_top_n = st.number_input(
                "정리할 상위 건수", min_value=1, max_value=100, value=10, step=5,
                disabled=not do_refine,
            )
            do_cluster = st.checkbox("반복 이슈 묶기", value=True)
            issue_mode = st.selectbox(
                "반복 이슈 표시 방식",
                list(ISSUE_DISPLAY_MODES.keys()), index=0,
                disabled=not do_cluster,
            )
            max_issue_cards, max_evidence = issue_display_mode_params(issue_mode)

        # 분석 범위 (product scope) — available after the first analysis, sourced
        # from the last result's product_summaries. Empty = 전체 상품. Applied only
        # on the next 분석 시작 click (no auto-rerun -> no surprise LLM cost).
        prev_result = st.session_state.get("result")
        prev_summaries = (prev_result or {}).get("product_summaries") or []
        if prev_summaries:
            scope_options = [s["product_name"] for s in prev_summaries]
            product_groups = compute_product_groups(prev_summaries)

            # Group presets (primary, reviewable). Conservative first-match-wins
            # buckets; membership shown below so the operator audits before trust.
            if product_groups:
                group_ids = [g["group_id"] for g in product_groups]
                group_label_by_id = {
                    g["group_id"]: (
                        f"{g['label']} ({len(g['products'])}개 상품 · "
                        f"{g['review_count']:,}건)"
                    )
                    for g in product_groups
                }
                # Prune a retained group selection no longer present (new file).
                retained_g = st.session_state.get("scope_group_select")
                if retained_g:
                    pruned_g = [v for v in retained_g if v in group_ids]
                    if pruned_g != retained_g:
                        st.session_state["scope_group_select"] = pruned_g
                st.multiselect(
                    "분석 범위 · 상품 그룹 (비우면 전체 상품)",
                    options=group_ids,
                    format_func=lambda gid: group_label_by_id.get(gid, gid),
                    key="scope_group_select",
                )
                with st.expander("그룹 구성 보기", expanded=False):
                    for g in product_groups:
                        st.markdown(f"**{g['label']}** · {len(g['products'])}개 상품")
                        for product_name in g["products"]:
                            st.caption(f"· {product_name}")

            # Individual SKU selection (preserved). Unioned with any group pick.
            with st.expander("개별 상품 선택", expanded=False):
                # Drop any retained selection no longer present (e.g. after a new
                # file) so the multiselect never errors on a stale default.
                retained = st.session_state.get("scope_select")
                if retained:
                    pruned = [v for v in retained if v in scope_options]
                    if pruned != retained:
                        st.session_state["scope_select"] = pruned
                st.multiselect(
                    "개별 상품 (그룹과 함께 선택하면 합쳐집니다)",
                    options=scope_options,
                    format_func=truncate_product_label,
                    key="scope_select",
                )
            st.caption("상품/그룹을 고른 뒤 '분석 시작'을 다시 누르면 선택 범위만 분석합니다.")

        run = st.button("분석 시작", type="primary", disabled=uploaded is None)

        if run:
            try:
                rows, had_channel = load_upload(
                    uploaded.name, uploaded.getvalue(), channel_override
                )
            except ValueError as e:
                st.error(str(e))
                return
            except Exception as e:  # malformed file -> friendly message, no crash
                st.error(f"파일을 읽지 못했습니다: {e}")
                return
            if not rows:
                st.warning("리뷰 내용이 있는 행을 찾지 못했습니다.")
                return
            if not had_channel and not channel_override.strip():
                st.info("채널 열이 없어 '미상'으로 표시됩니다. 채널 이름을 입력할 수 있습니다.")

            reuse_emb = None
            if do_cluster and "rag_index" in st.session_state:
                reuse_emb = st.session_state["rag_index"].vectors_by_review_id()

            # Effective scope = selected groups (expanded to member SKUs) unioned
            # with individually selected SKUs. Empty (or none yet) -> 전체 상품;
            # generate() also guards absent names by falling back to full corpus.
            prev_summaries_now = (
                (st.session_state.get("result") or {}).get("product_summaries") or []
            )
            groups_for_expand = compute_product_groups(prev_summaries_now)
            scope_selected = expand_group_selection(
                st.session_state.get("scope_group_select") or [],
                st.session_state.get("scope_select") or [],
                groups_for_expand,
            )

            with st.spinner("분석 중..."):
                result = generate(
                    rows,
                    title=title.strip() or "산업자재 리뷰 운영 점검",
                    today=None if auto_today else today_input,
                    recent_days=int(recent_days),
                    filename=uploaded.name,
                    do_refine=do_refine,
                    refine_top_n=int(refine_top_n),
                    do_cluster=do_cluster,
                    cluster_max_clusters=int(max_issue_cards),
                    cluster_max_evidence=int(max_evidence),
                    reuse_embeddings=reuse_emb,
                    product_filter=scope_selected or None,
                )
            st.session_state["result"] = result
            st.session_state["report_title"] = title.strip() or "report"
            # New corpus -> drop any stale analysis index/chat from a previous file.
            for key in ("rag_index", "rag_messages", "rag_last_results"):
                st.session_state.pop(key, None)
            # Rerun once so the sidebar (rendered top-to-bottom, above this block)
            # sees the new result and shows the 분석 범위 selector immediately. This
            # fires only on a 분석 시작 click; the rerun has run=False so it cannot
            # loop. Scope selection still requires a manual 분석 시작 (no auto-LLM).
            st.rerun()

        # Result-dependent advanced controls (download + diagnostics) live with
        # the other settings, shown only once a result exists.
        result = st.session_state.get("result")
        if result:
            with st.expander("리포트 내보내기 · 진단", expanded=False):
                st.download_button(
                    "HTML 리포트 다운로드",
                    data=result["html"].encode("utf-8"),
                    file_name=f"{st.session_state.get('report_title', 'report')}.html",
                    mime="text/html",
                )
                _render_notion_export(result)
                st.caption(f"날짜 확인 필요: {result['date_unknown']}건")
                st.caption(f"평점 확인 필요: {result['rating_unknown']}건")
                st.caption(f"중복 제외: {result['duplicates']}건")
                _render_advanced_notes(result)


def _render_notion_export(result: dict) -> None:
    """Single 'Notion에 기록하기' button. Routes to a DB row when
    NOTION_DATABASE_ID is set (the default surface), else to a plain page under
    NOTION_PARENT_PAGE_ID. Backend (resolve_notion_export_mode) owns the routing.

    Fail-soft: disabled with a caption when settings are missing; on a failed
    export it warns and the app keeps working. The DB path retries once with
    title + body only on a schema mismatch and surfaces a note. No secret shown."""
    mode, api_key, target_id = notion_export.resolve_notion_export_mode()
    if mode == "none":
        st.button("Notion에 기록하기", disabled=True, key="notion_export_btn")
        st.caption(
            "Notion 설정(NOTION_API_KEY와 NOTION_DATABASE_ID 또는 "
            "NOTION_PARENT_PAGE_ID)이 없어 기록을 건너뜁니다."
        )
        return
    if st.button("Notion에 기록하기", key="notion_export_btn"):
        with st.spinner("Notion에 기록하는 중…"):
            if mode == "database":
                payload = notion_export.build_notion_database_payload(
                    result, target_id, datetime.now()
                )
                export = notion_export.export_to_notion_database(
                    payload, api_key=api_key
                )
            else:
                payload = notion_export.build_notion_payload(
                    result, target_id, date.today()
                )
                export = notion_export.export_to_notion(payload, api_key=api_key)
        if export.ok:
            if mode == "database":
                st.success("Notion DB에 기록했습니다.")
            else:
                st.success("Notion 페이지를 만들었습니다.")
            if export.note:
                st.info(export.note)
            if export.url:
                st.markdown(f"[Notion에서 열기]({export.url})")
        else:
            st.warning(f"Notion 기록에 실패했습니다: {export.error}")


def _render_advanced_notes(result: dict) -> None:
    """Muted processing notes (kept out of the main flow)."""
    summary = result.get("refine_summary") or {}
    if summary.get("status") == "ok":
        st.caption(
            f"문구 자동 정리: {summary['refined']}건 보정 · {summary['excluded']}건 제외"
        )
    elif summary.get("status") in ("no_key", "error"):
        st.caption("문구 자동 정리는 사용할 수 없어 기본 문구로 표시했습니다.")

    csum = result.get("cluster_summary") or {}
    if csum.get("status") == "ok":
        cand = csum.get("used_candidate_count", csum.get("candidates", 0))
        engine = {"discovery": "자동 발견", "fallback": "기존 방식"}.get(csum.get("engine"), "")
        line = f"반복 이슈: 후보 {cand}건 → 최종 {csum.get('issues', 0)}건"
        if engine:
            line += f" · {engine}"
        if csum.get("evidence_rejected"):
            line += f" · 근거 검증 제외 {csum['evidence_rejected']}건"
        st.caption(line)
    elif csum.get("status") in ("no_key", "error"):
        st.caption("반복 이슈 묶기는 사용할 수 없어 건너뛰었습니다.")


# ---------------------------------------------------------------------------
# Tab 1 — 운영 요약
# ---------------------------------------------------------------------------


def _render_issue_card(item: dict) -> None:
    """One native repeated-issue card (operator severity + 원문 근거)."""
    with st.container(border=True):
        st.markdown(f"**{item['issue_title']}**　·　관련 리뷰 {item['review_count']}건")
        st.caption(
            f"{item['severity_label']} · {item['type_label']} · {item['tag_label']}"
        )
        if item.get("product_summary"):
            st.caption(item["product_summary"])
        st.write(f"요약: {item['summary']}")
        st.write(f"추천 조치: {item['recommended_action']}")
        if item["reps"]:
            with st.expander(f"원문 근거 {len(item['reps'])}건", expanded=False):
                for rep in item["reps"]:
                    st.caption(f"{rep['작성일']} · {rep['채널']} · {rep['평점']}점")
                    st.write(rep["리뷰"])


def _render_overall_status(result: dict) -> None:
    """Compact 전체 리뷰 상태: corpus-level rating context, above repeated issues.

    Gives the full picture (how many reviews, average rating, how many are
    low-rating, how much is recent) so a repeated issue of N건 reads as a signal
    within the whole corpus rather than "the only problem".
    """
    rs = result.get("rating_summary")
    if not rs:
        return
    st.subheader("전체 리뷰 상태")
    st.caption(scope_caption_text(result))

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("분석 대상 리뷰", f"{rs['total']}건")
    c2.metric("평균 평점", f"{rs['average']:.1f}점" if rs["average"] is not None else "미상")
    c3.metric("저평점(1~3점)", f"{rs['low_count']}건")
    c4.metric(f"최근 {result.get('recent_days', RECENT_DAYS)}일", f"{rs['recent_count']}건")

    c5, c6 = st.columns(2)
    worklist_total = result.get("today_count", 0) + result.get("week_count", 0)
    c5.metric("우선 확인 리뷰", f"{worklist_total}건")
    c6.metric("반복 이슈", f"{result.get('issue_count', 0)}건")

    st.caption("평점 분포")
    for bar in rating_distribution_bars(rs):
        c_label, c_bar = st.columns([1, 5])
        c_label.write(f"{bar['label']} · {bar['count']}건")
        c_bar.progress(min(1.0, bar["fraction"]))
    if rs["unknown_rating"]:
        st.caption(f"평점 미상: {rs['unknown_rating']}건")
    st.caption(rs["interpretation"])


def _render_product_status(result: dict) -> None:
    """상품별 리뷰 상태 table (full corpus), so the operator can pick a product to
    narrow to via the sidebar 분석 범위. When a scope is selected, the selected-
    scope products are shown first and the full-file table is moved below,
    collapsed; with no scope, the full-file table stays as before."""
    summaries = result.get("product_summaries") or []
    if not summaries:
        return
    scoped = scoped_product_status_summaries(summaries, result.get("scope_products"))
    if scoped:
        st.caption(f"선택 범위 상품 상태 ({len(scoped)}개 상품)")
        st.dataframe(
            product_status_rows(scoped), use_container_width=True, hide_index=True
        )
        with st.expander(
            f"전체 파일 상품 상태 ({len(summaries)}개 상품)", expanded=False
        ):
            st.caption("상품을 좁혀 보려면 왼쪽 '분석 범위'에서 상품을 고르고 '분석 시작'을 다시 누르세요.")
            st.dataframe(
                product_status_rows(summaries), use_container_width=True, hide_index=True
            )
        return
    with st.expander(
        f"상품별 리뷰 상태 (전체 파일 기준 · {len(summaries)}개 상품)", expanded=False
    ):
        st.caption("상품을 좁혀 보려면 왼쪽 '분석 범위'에서 상품을 고르고 '분석 시작'을 다시 누르세요.")
        st.dataframe(
            product_status_rows(summaries), use_container_width=True, hide_index=True
        )


def _render_summary_tab() -> None:
    result = st.session_state.get("result")
    if not result:
        st.info("왼쪽에서 리뷰 파일을 올리고 '분석 시작'을 누르세요.")
        return

    ns = result.get("new_summary")

    st.subheader("이번 업로드 요약")
    st.caption(scope_caption_text(result))
    m1, m2, m3 = st.columns(3)
    m1.metric("전체 리뷰", f"{result['total']}건")
    if ns:
        m2.metric("신규 리뷰", f"{ns['new_count']}건")
        m3.metric("이미 등록된 리뷰", f"{ns['seen_count']}건")
        if ns["first_upload"]:
            st.info("첫 업로드라 전체 리뷰를 등록했습니다.")
        k1, k2 = st.columns(2)
        k1.metric("신규 중 우선 확인", f"{ns['priority_new_count']}건")
        k2.metric("신규 중 답글 필요", f"{ns['needs_reply_new_count']}건")
    else:
        m2.metric("중복", f"{result['duplicates']}건")
        m3.metric("채널 수", f"{len(result['channels'])}개")
        st.caption("저장소를 열지 못해 신규/기존 비교를 건너뛰었습니다. (분석은 정상입니다.)")

    st.divider()
    _render_overall_status(result)
    _render_product_status(result)

    st.divider()
    st.subheader("반복 이슈")
    st.caption("반복 이슈는 같은 문제가 2건 이상 확인된 묶음입니다.")
    st.caption("한 건짜리 이슈는 우선 확인 리뷰에서 확인할 수 있습니다.")
    issue_items = result.get("issue_items") or []
    if issue_items:
        for item in issue_items:
            _render_issue_card(item)
    else:
        csum = result.get("cluster_summary") or {}
        cstatus = csum.get("status")
        if cstatus == "ok":
            st.caption("이번 업로드에서 묶인 반복 이슈가 없습니다.")
        elif cstatus in ("no_key", "error"):
            st.caption("반복 이슈 묶기를 사용할 수 없어 건너뛰었습니다. (고급 설정에서 끌 수 있습니다.)")
        else:
            st.caption("반복 이슈 묶기가 꺼져 있습니다. (고급 설정에서 켤 수 있습니다.)")

    if ns and ns["new_items"]:
        st.divider()
        st.subheader("신규 리뷰 미리보기")
        preview = [
            {k: v for k, v in it.items() if k != "review_id"} for it in ns["new_items"][:5]
        ]
        st.dataframe(preview, use_container_width=True, hide_index=True)
        st.caption("처리 상태·메모는 '리뷰 확인' 탭에서 입력할 수 있습니다.")


# ---------------------------------------------------------------------------
# Tab 2 — 리뷰 확인
# ---------------------------------------------------------------------------


def _render_review_filter_views(result: dict) -> None:
    """Quick filtered views over active reviews (reuses tags/worklist/issue ids).

    The selectbox shows each filter's count so the operator sees, e.g., how many
    1~3점 or 반복 이슈 관련 reviews exist before drilling in. No new classification.
    """
    tagged = result["tagged"]
    new_ids = result.get("new_review_ids") or set()
    worklist_ids = result.get("worklist_review_ids") or set()
    issue_ids = result.get("issue_review_ids") or set()

    counts = compute_filter_counts(
        tagged, new_ids=new_ids, worklist_ids=worklist_ids, issue_ids=issue_ids
    )
    labels = [f"{label} ({counts[key]}건)" for label, key in REVIEW_FILTERS]
    choice = st.selectbox("리뷰 보기", labels, index=0)
    chosen_key = REVIEW_FILTERS[labels.index(choice)][1]

    items = filter_review_items(
        tagged, chosen_key, new_ids=new_ids, worklist_ids=worklist_ids, issue_ids=issue_ids
    )
    st.write(f"해당 리뷰: {len(items)}건")
    if items:
        preview = [{k: v for k, v in it.items() if k != "review_id"} for it in items]
        st.dataframe(preview, use_container_width=True, hide_index=True)


def _render_review_filter(result: dict) -> None:
    """Folded-in keyword/tag/channel/rating filter over original reviews."""
    tagged: list[tuple[IndustrialReview, list[str]]] = result["tagged"]

    selected_labels = st.multiselect("태그", options=list(LABEL_TO_ID.keys()))
    selected_tag_ids = {LABEL_TO_ID[label] for label in selected_labels}
    keyword = st.text_input("키워드", value="", placeholder="예: 파손, 교환, 설치 ...")
    col_a, col_b = st.columns(2)
    channel_filter = col_a.multiselect("채널", options=result["channels"])
    rating_filter = col_b.multiselect("평점", options=["5", "4", "3", "2", "1", "미상"])

    kw = keyword.strip().lower()
    shortcut_ids = {tag for term, tag in QUERY_SHORTCUTS.items() if term in kw} if kw else set()
    if shortcut_ids:
        labels = ", ".join(sorted(CATEGORY_BY_ID[t].label_ko for t in shortcut_ids))
        st.caption(f"'{keyword.strip()}' → 태그로도 찾기: {labels}")

    results: list[dict[str, str]] = []
    for review, tags in tagged:
        if selected_tag_ids and not (selected_tag_ids & set(tags)):
            continue
        if kw and kw not in review.text.lower() and not (shortcut_ids & set(tags)):
            continue
        if channel_filter and review.channel not in channel_filter:
            continue
        if rating_filter and _rating_bucket(review.rating) not in rating_filter:
            continue
        results.append(
            {
                "작성일": review.review_date.isoformat() if review.review_date else "미상",
                "채널": review.channel,
                "상품명": review.product_name or "-",
                "평점": _rating_bucket(review.rating),
                "태그": ", ".join(CATEGORY_BY_ID[t].label_ko for t in tags) or "-",
                "리뷰": review.text,
            }
        )

    st.write(f"찾은 리뷰: {len(results)}건")
    if results:
        st.dataframe(results, use_container_width=True, hide_index=True)


def _render_review_check_tab() -> None:
    result = st.session_state.get("result")
    if not result:
        st.info("왼쪽에서 리뷰 파일을 올리고 '분석 시작'을 누르세요.")
        return

    store_path = result.get("store_path")
    st.caption(scope_caption_text(result))

    st.subheader("신규 리뷰")
    ns = result.get("new_summary")
    if ns and ns["new_items"]:
        st.caption("리뷰를 펼쳐 처리 상태와 메모를 저장하세요. 저장한 내용은 다음 업로드에도 유지됩니다.")
        _render_review_editors(ns["new_items"], store_path, key_prefix="new")
        if ns["new_count"] > len(ns["new_items"]):
            st.caption(f"신규 리뷰 {ns['new_count']}건 중 {len(ns['new_items'])}건만 표시했습니다.")
    else:
        st.caption("이번 업로드에 신규 리뷰가 없습니다.")

    st.divider()
    st.subheader("우선 확인 리뷰")
    worklist_items = result.get("worklist_items") or []
    if worklist_items:
        st.caption("먼저 볼 리뷰입니다. 상태와 메모는 리뷰 단위로 저장됩니다.")
        _render_review_editors(worklist_items, store_path, key_prefix="wl")
    else:
        st.caption("우선 확인할 리뷰가 없습니다.")

    st.divider()
    st.subheader("리뷰 모아보기")
    _render_review_filter_views(result)

    st.divider()
    st.subheader("리뷰 찾기")
    _render_review_filter(result)


# ---------------------------------------------------------------------------
# Tab 3 — 리뷰에게 물어보기
# ---------------------------------------------------------------------------

ASK_EXAMPLES = [
    "배송 파손 리뷰 보여줘",
    "사이즈 관련 불만 있어?",
    "답글 필요한 리뷰 찾아줘",
    "재구매 언급 리뷰 보여줘",
    "상세페이지에 추가할 만한 내용 있어?",
]


def _ask_result_card(result: rag.SearchResult) -> None:
    m = result.doc.metadata
    rating = f"{m['rating']:g}점" if m.get("rating") is not None else "평점미상"
    bits = [m.get("date") or "날짜미상", str(m.get("channel") or "-"), rating]
    if m.get("product_name"):
        bits.append(str(m["product_name"]))
    if m.get("option_name"):
        bits.append(f"옵션: {m['option_name']}")
    st.markdown(f"**{' · '.join(bits)}**")
    if m.get("tag_labels"):
        st.caption("태그: " + ", ".join(m["tag_labels"]))
    st.write(m.get("text", ""))
    st.divider()


def _process_ask_query(query: str, index: rag.RagIndex, api_key: str | None) -> None:
    query = (query or "").strip()
    if not query:
        return
    try:
        query_emb = rag.embed_texts([query], api_key=api_key, model=rag.embedding_model())[0]
    except Exception as e:  # processing the question failed -> tell the user, no crash
        st.error(f"질문을 처리하지 못했습니다: {e}")
        return

    results = index.rank(query_emb, query_text=query, top_k=8, strict_tags=True)
    st.session_state["rag_last_results"] = results

    # Strict-tag note: query clearly maps to a tag, but no review carries it.
    tag_note = ""
    if rag.boosted_ids_for_query(query) and index.tag_match_count(query) == 0:
        tag_note = "해당 분류의 리뷰는 거의 없습니다. 의미상 가까운 리뷰를 대신 보여드립니다."

    answer = rag.generate_answer(query, results, api_key=api_key, model=rag.chat_model())
    if answer is None:
        answer = (
            f"관련 리뷰 {len(results)}건을 오른쪽 원문 근거에서 확인하세요. "
            "(요약을 사용할 수 없어 원문 근거만 표시합니다.)"
        )
    if tag_note:
        answer = f"{tag_note}\n\n{answer}"
    messages = st.session_state.setdefault("rag_messages", [])
    messages.append({"role": "user", "content": query})
    messages.append({"role": "assistant", "content": answer})


def _render_ask_tab() -> None:
    st.subheader("리뷰에게 물어보기")
    st.caption("이 로컬 데모에서는 업로드한 리뷰를 기준으로 답변하고, 원문 근거를 함께 표시합니다.")

    result = st.session_state.get("result")
    if not result:
        st.info("왼쪽에서 리뷰 파일을 올리고 '분석 시작'을 누르세요.")
        return

    api_key = rag.resolve_api_key()

    # --- Preparation gate: prepare the corpus once, on demand ---
    if "rag_index" not in st.session_state:
        st.write(f"리뷰 **{len(result['tagged'])}건**을 준비하면 질문할 수 있습니다.")
        if not api_key:
            st.caption("리뷰 분석 기능을 사용할 수 없습니다. (설정을 확인해주세요.)")
        if st.button("리뷰 분석 준비하기", type="primary", disabled=not api_key):
            with st.spinner("리뷰 분석 준비 중... (건수에 따라 시간이 걸릴 수 있습니다)"):
                try:
                    index = rag.build_index(
                        result["tagged"], api_key=api_key, model=rag.embedding_model()
                    )
                    st.session_state["rag_index"] = index
                    st.session_state.setdefault("rag_messages", [])
                    st.success(f"{len(index)}건 준비 완료")
                    st.rerun()
                except Exception as e:
                    st.error(f"준비하지 못했습니다: {e}")
        return

    index: rag.RagIndex = st.session_state["rag_index"]
    st.caption(f"분석 준비된 리뷰: {len(index)}건")

    left, right = st.columns(2)

    with left:
        st.markdown("#### 질문")
        st.write("예시 질문:")
        for i, example in enumerate(ASK_EXAMPLES):
            if st.button(example, key=f"ask_ex_{i}"):
                st.session_state["rag_pending"] = example
        with st.form("ask_form", clear_on_submit=True):
            typed = st.text_input("질문을 입력하세요", value="")
            submitted = st.form_submit_button("질문하기", type="primary")
        if submitted and typed.strip():
            st.session_state["rag_pending"] = typed

        pending = st.session_state.pop("rag_pending", None)
        if pending:
            with st.spinner("찾는 중..."):
                _process_ask_query(pending, index, api_key)

        st.markdown("#### 대화")
        for message in st.session_state.get("rag_messages", []):
            with st.chat_message(message["role"]):
                st.write(message["content"])

    with right:
        st.markdown("#### 원문 근거")
        results = st.session_state.get("rag_last_results", [])
        if not results:
            st.caption("질문하면 관련 원문 리뷰가 여기에 표시됩니다.")
        for res in results:
            _ask_result_card(res)


def main() -> None:
    st.set_page_config(page_title="산업자재 리뷰 운영 워크스페이스", layout="wide")
    _render_sidebar()
    st.title("산업자재 리뷰 운영 워크스페이스")
    st.caption("여러 채널 리뷰를 한곳에 모아, 먼저 확인할 리뷰와 반복 이슈를 정리합니다.")

    tab_summary, tab_check, tab_ask = st.tabs(
        ["운영 요약", "리뷰 확인", "리뷰에게 물어보기"]
    )
    with tab_summary:
        _render_summary_tab()
    with tab_check:
        _render_review_check_tab()
    with tab_ask:
        _render_ask_tab()


if __name__ == "__main__":
    main()
