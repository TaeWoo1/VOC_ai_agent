"""Long-form Instagram cardnews layout (v2.0 — content_plan-driven).

Architecture (3 layers)
-----------------------

    analysis_report.json   →   editorial_planner   →   THIS module    →   render
                                (Korean copy)        (page records,      (HTML/PNG)
                                                      audit, image)

This module owns *layout decisions only*: page indices, page-type
routing, audit metadata attachment, image-slot wiring, structural
labels (chips, byline tags, page-index footer). It does NOT write
product-specific Korean copy. Every consumer-facing string is supplied
by the editorial planner via `content_plan_ko`.

When `build_long_cardnews_layout` is called without an explicit
`content_plan`, the layout calls
`src.voc.content.editorial_planner.build_content_plan` in mock mode so
older callers continue to work unchanged. The preferred flow is
nonetheless:

    plan = build_content_plan(analysis_report, mode=...)
    layout = build_long_cardnews_layout(analysis_report, content_plan=plan)

Page narrative (locked from v1.2)
---------------------------------

    1.  cover        — hook-first editorial headline + product subline
    2.  hook         — 한 줄 인상 (mini-metrics + supporting lines)
    3.  loved        — 반복되는 호평 (ranked top-3)
    4.  divides      — 갈리는 의견 (proportion bars)
    5.  signature    — 이 제품만의 포인트 (editorial pull-quote)
    6.  checkpoints  — 구매 전 체크포인트 (densified tiles, top-2)
    7.  audience     — fit + 신중하게 볼 분 (2-column)
    8.  method       — 분석 기준 (compact, moved late)
    9.  cta          — single primary action

What was removed in v2.0 (vs v1.2)
----------------------------------

* `_HOOK_STRENGTH_REASON_KO`         — moved to planner mock templates
* `_HOOK_DIVIDE_TAIL_KO`             — moved to planner mock templates
* `_SIGNATURE_KO`                    — moved to planner mock templates
* `_CHECKPOINT_WHY_KO`               — moved to planner mock templates
* `_CHECKPOINT_WHO_KO`               — moved to planner mock templates
* `EVIDENCE_PHRASE_KO`               — moved to planner (mock fallback only)
* `EVIDENCE_TIP_KO`                  — moved to planner (mock fallback only)
* `SECONDARY_NOTE_KO`                — moved to planner (mock fallback only)
* `_SIGNATURE_PRIORITY`              — moved to planner

The contract is: this module reads `content_plan` and `analysis_report`,
and writes structural page records. It never invents new Korean copy.
The only Korean strings it does emit are *structural labels* (chips,
byline tags, page-index footer copy) — these are not product-specific
and stay here.

Tone contract — see `cardnews/safety_validator.py`. Both
`validate_content_plan_safety(plan)` and `validate_cardnews_safety(layout)`
are run at their respective layer boundaries.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src.voc.content.cardnews_generator import (
    CardnewsGenerationError,
    DEFAULT_DISCLOSURE_KO,
    _attribute_counts,
    _truncate,
)
from src.voc.content.validators import (
    BULLET_MAX_CHARS_KO,
    SLIDE_TITLE_MAX_CHARS_KO,
)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCHEMA_VERSION = "2.0"
LANGUAGE_DEFAULT = "ko"
CHANNEL = "instagram"
FORMAT = "cardnews_long"

# Body-paragraph budget for the sanitized evidence phrase card (used by
# the legacy caution_attr / positive_attr templates that remain in
# the renderer's _TEMPLATE_BY_TYPE for backward compat). Kept here only
# as a reference for any caller that constructs page records by hand.
PHRASE_MAX_CHARS_KO = 60
TIP_MAX_CHARS_KO = 40
NOTE_MAX_CHARS_KO = 32
TAKEAWAY_MAX_CHARS_KO = 50
CONTEXT_MAX_CHARS_KO = 180
HEADLINE_MAX_CHARS_KO = 36

# Legacy export — historical tests expect this constant by name. Kept
# as a permissive numeric so tests that bound bullet length still pass.
# The actual budget enforcement now lives in
# `src.voc.content.schemas.content_plan` (BULLET_MAX = 40).
EVIDENCE_PHRASE_KO: dict[tuple[str, str], str] = {}
EVIDENCE_TIP_KO: dict[str, str] = {}


# Banned tokens we MUST NOT emit ourselves in any built-in template.
# Defense-in-depth — the safety validator catches drift, but no static
# template should generate anything that needs catching.
_SELF_FORBIDDEN_TOKENS: tuple[str, ...] = (
    "최악", "독", "부작용", "무조건", "인생템", "미쳤어요",
    "절대 사지 마세요", "광고에 속지", "브랜드가 숨긴",
    "당신이 모르는 진실", "충격적인 반전", "팩트 폭로",
    "소비자들은 속고 있다", "진짜 실체",
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


_GOODS_NO_RE = re.compile(r"[?&]goodsNo=([A-Z0-9]+)")
_QUANTITY_TAIL_RE = re.compile(
    r"\s+\d+(?:매|개|ml|g|호|종|회|kg|mg|입|병|장|cm|mm)"
)


def _assert_self_forbidden(text: str, location: str) -> None:
    for term in _SELF_FORBIDDEN_TOKENS:
        if term in text:
            raise CardnewsGenerationError(
                f"internal: layout produced banned framing {term!r} at "
                f"{location} — fix the template, do not relax the validator"
            )


def _extract_external_id(source_url: str | None) -> str | None:
    if not source_url:
        return None
    m = _GOODS_NO_RE.search(source_url)
    return m.group(1) if m else None


def _short_product_name(name_ko: str | None) -> str:
    """Cover-friendly product name. Strips the spec-detail tail
    (`200매 대용량 …`) and caps to ~22 KO chars. Layout-owned
    structural label — used for the cover page filename token and
    fallback when the plan subline is empty."""
    if not name_ko:
        return "리뷰 정리 노트"
    parts = _QUANTITY_TAIL_RE.split(name_ko, maxsplit=1)
    short = parts[0].strip() if parts else name_ko.strip()
    return _truncate(short, 22)


def _format_yyyy_mm_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _audit_from_quotes(
    quotes: list[dict],
    polarity_filter: tuple[str, ...] | None = None,
) -> dict:
    """Pick the highest-priority quote for the audit slot.

    Output goes into `audit.*` and is NEVER rendered. Used so the
    operator can trace any signal page back to a verbatim review row.
    """
    if not quotes:
        return {}
    chosen = None
    if polarity_filter:
        for q in quotes:
            if (q.get("polarity") or "") in polarity_filter:
                chosen = q
                break
    if chosen is None:
        chosen = quotes[0]
    out: dict = {}
    text = chosen.get("text")
    if isinstance(text, str) and text:
        out["evidence_span_raw"] = text
    rid = chosen.get("review_id")
    if isinstance(rid, str) and rid:
        out["evidence_review_id_truncated"] = rid[:12]
    pol = chosen.get("polarity")
    if isinstance(pol, str) and pol:
        out["evidence_polarity"] = pol
    return out


def _analysis_report_sha256(report: dict) -> str:
    blob = json.dumps(report, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Audit-metadata helpers (read raw quotes from analysis_report — the
# layout's only direct interaction with `top_quotes` / `top_negative_quotes`)
# ---------------------------------------------------------------------------


def _audit_for_attribute(
    analysis_report: dict, attribute_key: str, *, want_polarity: str,
) -> dict:
    """Build an audit dict for a per-attribute spotlight page.

    `want_polarity` is "negative" (caution / divide) or "positive"
    (loved / signature when polarity_shape == positive). Walks the
    same data the operator PDF reads — `monitoring_candidates` for
    negative, `strengths.representative_quote` for positive — so the
    audit chain stays consistent across artifact types.
    """
    if want_polarity == "negative":
        for entry in analysis_report.get("monitoring_candidates") or []:
            if entry.get("attribute_key") == attribute_key:
                return _audit_from_quotes(
                    list(entry.get("top_negative_quotes") or []),
                    polarity_filter=(
                        "negative_strong", "negative_weak", "negative",
                    ),
                )
    else:
        for entry in analysis_report.get("strengths") or []:
            if entry.get("attribute_key") == attribute_key:
                rep = entry.get("representative_quote")
                if isinstance(rep, dict):
                    return _audit_from_quotes(
                        [rep], polarity_filter=("positive",),
                    )
    # Fallback — try `attributes[*].top_quotes`.
    for a in analysis_report.get("attributes") or []:
        if a.get("key") == attribute_key:
            return _audit_from_quotes(list(a.get("top_quotes") or []))
    return {}


# ---------------------------------------------------------------------------
# Page builders — each consumes content_plan + analysis_report and
# emits a page record matching the existing template field names.
# ---------------------------------------------------------------------------


def _build_cover_page(
    *,
    cover_plan: dict,
    analysis_report: dict,
    product_image: dict,
) -> dict:
    product = analysis_report.get("product") or {}
    short_name = _short_product_name(product.get("name_ko") or "")
    bracket_tag = f"리뷰 저널 · {_format_yyyy_mm_now()}"

    headline = cover_plan["headline"]
    subline = cover_plan["subline"]
    chips = list(cover_plan.get("chips") or [])

    _assert_self_forbidden(headline, "cover.headline")
    _assert_self_forbidden(subline, "cover.subtitle")
    for c in chips:
        _assert_self_forbidden(c, "cover.chip_strip[]")

    return {
        "index": 1,
        "type": "cover",
        "language": LANGUAGE_DEFAULT,
        "chip": bracket_tag,
        # Title is layout-owned (used by the renderer for filename
        # generation and as a hidden label). Visible H1 is `headline`.
        "title": short_name,
        "headline": headline,
        "subtitle": subline,
        "chip_strip": chips,
        "product_image": product_image,
        "audit": {},
    }


def _build_hook_page(*, hook_plan: dict) -> dict:
    headline = hook_plan["headline"]
    metrics = list(hook_plan.get("metrics") or [])
    bullets = list(hook_plan.get("bullets") or [])

    _assert_self_forbidden(headline, "hook.lead_line")
    for b in bullets:
        _assert_self_forbidden(b, "hook.supporting_lines[]")

    return {
        "index": 2,
        "type": "hook",
        "language": LANGUAGE_DEFAULT,
        "chip": "한 줄 인상",
        "title": "한 줄 인상",
        "lead_line": headline,
        "mini_metrics": [
            {"label": m["label"], "value": m["value"]} for m in metrics
        ],
        "supporting_lines": bullets,
        "note": "자세한 포인트는 다음 장에서",
        "audit": {},
    }


def _build_loved_page(*, loved_plan: dict, index: int) -> dict:
    items = []
    for i, it in enumerate(loved_plan.get("items") or []):
        items.append({
            "rank": str(i + 1).zfill(2),
            "label": it["label"],
            "count": it["count"],
            "note": it["note"],
        })
        _assert_self_forbidden(it["label"], "loved.ranked_items[].label")
        _assert_self_forbidden(it["note"], "loved.ranked_items[].note")
    if not items:
        items = [{
            "rank": "—",
            "label": "표본 부족",
            "count": "신호 형성 중",
            "note": "리뷰가 더 모이면 다시 정리할 후보",
        }]
    return {
        "index": index,
        "type": "loved",
        "language": LANGUAGE_DEFAULT,
        "chip": "반복되는 호평",
        "title": "가장 자주 칭찬받은 부분",
        "subtitle": loved_plan.get("headline") or "리뷰에서 반복된 만족 신호",
        "ranked_items": items,
        "audit": {},
    }


def _build_divides_page(*, divides_plan: dict, index: int) -> dict:
    items = []
    for it in divides_plan.get("items") or []:
        pos = int(it.get("satisfied") or 0)
        neg = int(it.get("split") or 0)
        total = pos + neg or 1
        items.append({
            "label": it["label"],
            "satisfied": pos,
            "split": neg,
            "satisfied_pct": round(100 * pos / total),
            "split_pct": round(100 * neg / total),
            "note": it["note"],
        })
        _assert_self_forbidden(it["label"], "divides.comparison_items[].label")
        _assert_self_forbidden(it["note"], "divides.comparison_items[].note")
    if not items:
        items = [{
            "label": "—",
            "satisfied": 0, "split": 0,
            "satisfied_pct": 50, "split_pct": 50,
            "note": "뚜렷하게 갈린 지점이 충분히 보이지 않아요",
        }]
    return {
        "index": index,
        "type": "divides",
        "language": LANGUAGE_DEFAULT,
        "chip": "갈리는 의견",
        "title": "같은 항목, 다르게 본 사용자들",
        "subtitle": divides_plan.get("headline") or "만족과 갈림이 함께 쌓인 지점",
        "comparison_items": items,
        "audit": {},
    }


def _build_signature_page(
    *,
    signature_plan: dict,
    analysis_report: dict,
    index: int,
) -> tuple[dict, str | None]:
    attribute_key = signature_plan["attribute_key"]
    title = signature_plan["title"]
    headline = signature_plan["headline"]
    lead = signature_plan["lead"]
    why = signature_plan["why_it_matters"]
    who = signature_plan["who_should_check"]

    _assert_self_forbidden(headline, "signature.headline")
    _assert_self_forbidden(lead, "signature.lead")
    _assert_self_forbidden(why, "signature.aside_items[](why).note")
    _assert_self_forbidden(who, "signature.aside_items[](who).note")

    # Choose the audit polarity that matches the dominant signal for
    # this attribute. We don't always know which the planner picked
    # editorially, but we can read the analysis numbers.
    counts = _attribute_counts(analysis_report)
    c = counts.get(attribute_key) or {}
    n_pos = int(c.get("n_positive") or 0)
    n_neg = int(c.get("n_negative") or 0)
    if n_pos >= 5 and n_neg >= 5:
        # Dual — prefer negative for the "갈림" angle the page describes.
        audit = _audit_for_attribute(
            analysis_report, attribute_key, want_polarity="negative",
        )
        subtitle = f"만족 {n_pos}건 · 갈림 {n_neg}건"
    elif n_pos > n_neg:
        audit = _audit_for_attribute(
            analysis_report, attribute_key, want_polarity="positive",
        )
        subtitle = f"만족 후기 {n_pos}건"
    else:
        audit = _audit_for_attribute(
            analysis_report, attribute_key, want_polarity="negative",
        )
        subtitle = f"호불호 {n_neg}건"

    page = {
        "index": index,
        "type": "signature",
        "language": LANGUAGE_DEFAULT,
        "attribute_key": attribute_key,
        "chip": "이 제품만의 포인트",
        "title": title,
        "headline": headline,
        "subtitle": subtitle,
        "lead": lead,
        "aside_items": [
            {"label": "왜 중요한가", "note": why},
            {"label": "누가 체크할까", "note": who},
        ],
        "audit": audit,
    }
    return page, attribute_key


def _build_checkpoints_page(
    *,
    checkpoints_plan: dict,
    analysis_report: dict,
    index: int,
) -> dict:
    items = []
    for i, it in enumerate(checkpoints_plan.get("items") or []):
        items.append({
            "number": str(i + 1).zfill(2),
            "label": it["label"],
            "count": it["count"],
            "note": it["tip"],
            "why_note": it["why_note"],
            "who_note": it["who_note"],
        })
        _assert_self_forbidden(it["label"], "checkpoints.numbered_items[].label")
        _assert_self_forbidden(it["tip"], "checkpoints.numbered_items[].note")
        _assert_self_forbidden(it["why_note"], "checkpoints.numbered_items[].why_note")
        _assert_self_forbidden(it["who_note"], "checkpoints.numbered_items[].who_note")
    if not items:
        items = [{
            "number": "—",
            "label": "표본 부족",
            "count": "신호 형성 중",
            "note": "리뷰가 더 모이면 다시 정리할 후보",
            "why_note": "현재 표본으로는 단정 어려움",
            "who_note": "추가 리뷰 모이면 재검토",
        }]
    return {
        "index": index,
        "type": "checkpoints",
        "language": LANGUAGE_DEFAULT,
        "chip": "구매 전 체크포인트",
        "title": "사기 전에 한 번 더 짚을 포인트",
        "subtitle": checkpoints_plan.get("headline")
                    or "왜 짚어볼지, 누가 특히 봐야 할지까지 정리",
        "numbered_items": items,
        "audit": {},
    }


def _build_audience_page(*, audience_plan: dict, index: int) -> dict:
    fit_items = []
    for it in audience_plan.get("fit_items") or []:
        fit_items.append({"label": it["label"], "note": it["note"]})
        _assert_self_forbidden(it["label"], "audience.fit_items[].label")
        _assert_self_forbidden(it["note"], "audience.fit_items[].note")
    if not fit_items:
        fit_items = [{
            "label": "표본이 작아 잘 맞는 분을 단정하기 어려워요",
            "note": "리뷰가 더 모이면 재정리",
        }]

    consider_items = []
    for it in audience_plan.get("consider_items") or []:
        consider_items.append({"label": it["label"], "note": it["note"]})
        _assert_self_forbidden(it["label"], "audience.consider_items[].label")
        _assert_self_forbidden(it["note"], "audience.consider_items[].note")
    if not consider_items:
        consider_items = [{
            "label": "표본 내에서 두드러진 신호 없음",
            "note": "옵션·환경별 후기 추가 확인",
        }]

    return {
        "index": index,
        "type": "audience",
        "language": LANGUAGE_DEFAULT,
        "chip": "구매 전 체크",
        "title": "이 제품, 누구에게 어떤 의미일까",
        "subtitle": "리뷰 패턴으로 본 잘 맞는 분 / 신중하게 볼 분",
        "fit_items": fit_items,
        "consider_items": consider_items,
        "audit": {},
    }


def _build_method_page(*, method_plan: dict, analysis_report: dict, index: int) -> dict:
    methodology = analysis_report.get("methodology_notes") or {}
    disclosure = (methodology.get("disclosure_ko") or "").strip() or DEFAULT_DISCLOSURE_KO

    items = list(method_plan.get("items") or [])
    note = method_plan.get("note") or "리뷰 신호이며 제품 결함을 단정하지 않습니다"

    _assert_self_forbidden(note, "method.note")

    return {
        "index": index,
        "type": "method",
        "language": LANGUAGE_DEFAULT,
        "chip": "분석 기준",
        "title": "분석 기준",
        "subtitle": "리뷰를 어떻게 모았고, 무엇을 보지 않는가",
        "mini_cards": [
            {"label": m["label"], "value": m["value"]} for m in items
        ],
        "note": note,
        "disclosure": _truncate(disclosure, 220),
        "audit": {},
    }


def _build_cta_page(*, cta_plan: dict, analysis_report: dict, index: int) -> dict:
    product = analysis_report.get("product") or {}
    source_url = product.get("source_url") or ""
    methodology = analysis_report.get("methodology_notes") or {}
    disclosure = (methodology.get("disclosure_ko") or "").strip() or DEFAULT_DISCLOSURE_KO

    headline = cta_plan["headline"]
    body = cta_plan["body"]

    _assert_self_forbidden(headline, "cta.title")
    _assert_self_forbidden(body, "cta.actions[0].body")

    return {
        "index": index,
        "type": "cta",
        "language": LANGUAGE_DEFAULT,
        "chip": "다음 분석 요청",
        "title": headline,
        "lead": "이 제품처럼 호불호가 갈리는 후보가 있다면 댓글로 남겨주세요. 같은 방식으로 정리해 드릴게요.",
        "actions": [
            {"title": "댓글로 제품 남기기", "body": body},
        ],
        "disclosure": _truncate(disclosure, 220),
        "audit": {"source_url": source_url} if source_url else {},
    }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def build_long_cardnews_layout(
    analysis_report: dict,
    *,
    content_plan: dict | None = None,
    product_image: dict | None = None,
) -> dict:
    """Build the long-form Instagram cardnews layout (v2.0).

    Parameters
    ----------
    analysis_report
        v3.0 analysis_report dict.
    content_plan
        Pre-built content_plan_ko dict (validated against
        `src.voc.content.schemas.content_plan.ContentPlan`). When None,
        the layout calls
        `src.voc.content.editorial_planner.build_content_plan` in mock
        mode so legacy callers keep working without code changes.
    product_image
        Optional pre-resolved image descriptor. When None, a
        fallback-gradient descriptor is emitted and the renderer
        resolves the image at render time.
    """
    if not isinstance(analysis_report, dict):
        raise CardnewsGenerationError("analysis_report must be a dict")

    if content_plan is None:
        # Late import to avoid a circular at module-import time
        # (planner doesn't import layout, but a future refactor might).
        from src.voc.content.editorial_planner import build_content_plan
        content_plan = build_content_plan(analysis_report, mode="mock")

    if product_image is not None:
        image_descriptor = product_image
    else:
        report_image_url = (analysis_report.get("product") or {}).get("image_url")
        image_descriptor = {
            "source": "fallback_gradient",
            "url": report_image_url,
            "local_path": None,
            "usage": "cover_full_bleed",
        }

    pages: list[dict] = []

    pages.append(_build_cover_page(
        cover_plan=content_plan["cover"],
        analysis_report=analysis_report,
        product_image=image_descriptor,
    ))
    pages.append(_build_hook_page(hook_plan=content_plan["hook"]))
    pages.append(_build_loved_page(
        loved_plan=content_plan["loved"], index=3,
    ))
    pages.append(_build_divides_page(
        divides_plan=content_plan["divides"], index=4,
    ))
    sig_page, _sig_key = _build_signature_page(
        signature_plan=content_plan["signature"],
        analysis_report=analysis_report,
        index=5,
    )
    pages.append(sig_page)
    pages.append(_build_checkpoints_page(
        checkpoints_plan=content_plan["checkpoints"],
        analysis_report=analysis_report,
        index=6,
    ))
    pages.append(_build_audience_page(
        audience_plan=content_plan["audience"], index=7,
    ))
    pages.append(_build_method_page(
        method_plan=content_plan["method"],
        analysis_report=analysis_report,
        index=8,
    ))
    pages.append(_build_cta_page(
        cta_plan=content_plan["cta"],
        analysis_report=analysis_report,
        index=9,
    ))

    # Reindex contiguously (defensive).
    for i, p in enumerate(pages, start=1):
        p["index"] = i

    product = analysis_report.get("product") or {}
    layout = {
        "schema_version": SCHEMA_VERSION,
        "language": LANGUAGE_DEFAULT,
        "channel": CHANNEL,
        "format": FORMAT,
        "product": {
            "name_ko": product.get("name_ko"),
            "external_id": _extract_external_id(product.get("source_url")),
            "source_url": product.get("source_url"),
            "category": product.get("category"),
        },
        "product_image": image_descriptor,
        "corpus": dict(analysis_report.get("corpus") or {}),
        "page_count": len(pages),
        "pages": pages,
        "analysis_report_sha256": _analysis_report_sha256(analysis_report),
        "content_plan_sha256": hashlib.sha256(
            json.dumps(content_plan, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest(),
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    return layout


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build a long-form Instagram cardnews layout from "
                    "an analysis_report.json (+ optional content_plan)"
    )
    parser.add_argument("--analysis-report", required=True, type=Path)
    parser.add_argument("--content-plan", type=Path, default=None,
                        help="Pre-built content_plan_ko.json. Optional; "
                             "defaults to mock-mode planner.")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)

    report = json.loads(args.analysis_report.read_text(encoding="utf-8"))
    plan = None
    if args.content_plan:
        plan = json.loads(args.content_plan.read_text(encoding="utf-8"))

    layout = build_long_cardnews_layout(report, content_plan=plan)
    args.out.write_text(
        json.dumps(layout, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"wrote {args.out} ({layout['page_count']} pages)")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
