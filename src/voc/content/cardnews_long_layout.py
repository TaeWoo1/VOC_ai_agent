"""Long-form Instagram cardnews layout (v2.4 — story-arc-driven carousel).

Architecture (3 layers)
-----------------------

    analysis_report.json   →   editorial_planner   →   THIS module    →   render
                                (Korean copy)        (page records,      (HTML/PNG)
                                                      audit, image)

Page narrative (v2.4 — fixed skeleton, evidence-ranked middle)
--------------------------------------------------------------

The skeleton is fixed; the middle order flexes by story arc so two
products with different signal shapes don't ship visually-identical
carousels.

  Fixed skeleton:
    page 1            — cover
    page 2            — one_liner
    page N-1          — summary
    page N            — cta

  Middle modules (story-arc-ordered, evidence-ranked within each family):
    loved · positive_spotlight × 0..3 · divides · why_divides? ·
    caution_spotlight × 0..4 · insight_spotlight × 0..3 · signature ·
    checkpoint × 0..2 · fit · consider

  Story arcs:
    `positive_lead`   strong positive without strong caution
    `caution_lead`    strong caution without strong positive
    `balanced`        both present, or thin (canonical v2.1 order)

Spotlights within each family are sorted by evidence strength so the
strongest attribute leads. Optional sections (why_divides, all
spotlights, checkpoints) are emitted ONLY when product-specific
signal supports them — NEVER padded with corpus-generic advice.

Total page count: 9 required + 0..14 optional. Hard cap 20, soft cap
TARGET_PAGES_MAX=18; soft cap trims the weakest insight_spotlight first
to keep rich corpora from sprawling.

What was removed in v2.0 (still gone in v2.1)
---------------------------------------------

* `hook` page → replaced by `one_liner` (text-only, no metric pills).
* `audience` page → split into `fit` + `consider` (one message per slide).
* `method` page → standalone slide deleted; analysis basis absorbed
  into `cover.corpus_footer` (micro-text) + `cta.disclosure` (footer).
* Raw-quote per-attribute fan-out (`caution_attr` / `positive_attr`).
  Spotlights in v2.1 are LLM-interpreted pages; they do NOT show
  verbatim review quotes (audit slots keep one quote per page for
  internal traceability, never rendered).

Layout owns *layout decisions only*: page indices, page-type routing,
audit metadata attachment, image-slot wiring, structural labels (chips,
byline tags, page-index footer), the 20-page cap. It does NOT write
product-specific Korean copy. Every consumer-facing string is supplied
by the editorial planner via `content_plan_ko`.
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

SCHEMA_VERSION = "2.2"
LANGUAGE_DEFAULT = "ko"
CHANNEL = "instagram"
FORMAT = "cardnews_long"

# v2.1 — hard caps on the rendered carousel. Floor is whatever the
# 9-page required base + product-specific signal supports; we DO NOT
# pad with generic-advice pages to enforce a higher floor. Cap is
# Instagram-friendly (20 is the carousel ceiling).
PAGE_CAP_MAX = 20

# v2.4 — target band (narrower than the v2.1 9..20 band). Operators want
# the carousel to feel substantive (≥10) but not exhausting (≤18). The
# layout still tolerates 9..20 for thin/rich edge cases; assembly tries
# to land in 10..18 by trimming or expanding spotlights toward this band.
TARGET_PAGES_MIN = 10
TARGET_PAGES_MAX = 18

# v2.4 — story-arc options for middle-module reordering. The fixed
# skeleton is cover[0] + one_liner[1] + summary[-2] + cta[-1]; the
# arc decides what comes between. Three arcs cover the realistic
# signal shapes:
#
#   * `positive_lead` — strong loved attrs lead. Order:
#     loved → positive_spotlights → divides? → why_divides? → caution_spotlights →
#     insight_spotlights → signature → checkpoints → fit → consider
#   * `caution_lead` — caution-dominant. Order:
#     divides? → why_divides? → caution_spotlights → signature → checkpoints →
#     loved → positive_spotlights → insight_spotlights → fit → consider
#   * `balanced` — both strong (or unclear). Order:
#     loved → positive_spotlights → divides? → why_divides? → caution_spotlights →
#     insight_spotlights → signature → checkpoints → fit → consider
#
# The arc is selected from briefing signal shape so two products with
# different shapes get different middle orders. Two products with the
# same shape get the same arc — that's the desired stability.
StoryArc = str  # "positive_lead" | "caution_lead" | "balanced"

# v2.1 publish-gate threshold (NOT enforced here — see TODO below).
# A carousel with fewer than this many pages is an analysis artifact,
# not a publish-ready Instagram cardnews. Layout still emits the
# pages so operators can inspect the result; a downstream publish
# pipeline must apply this gate.
PUBLISH_GATE_MIN_PAGES = 10

# TODO(operations): wire PUBLISH_GATE_MIN_PAGES into the publish
# pipeline. Policy:
#   * page_count >= 10  → publish candidate (Instagram carousel ready)
#   * page_count <  10  → analysis artifact only; SKIP publishing
#   * NEVER pad thin corpora with corpus-generic advice to hit 10
# Layout intentionally returns sub-10 page layouts so operators can
# see the genuine signal density. Padding with generic copy would
# make the gate meaningless.

# Body-paragraph budget references — kept here for any caller that
# constructs page records by hand. Actual budget enforcement lives in
# `src.voc.content.schemas.content_plan`.
PHRASE_MAX_CHARS_KO = 60
TIP_MAX_CHARS_KO = 40
NOTE_MAX_CHARS_KO = 32
TAKEAWAY_MAX_CHARS_KO = 50
CONTEXT_MAX_CHARS_KO = 180
HEADLINE_MAX_CHARS_KO = 36

# Legacy exports — historical tests expect these names. v2.0 doesn't
# emit per-attribute spotlight pages, but the names remain so cross-
# version test files don't import-fail.
EVIDENCE_PHRASE_KO: dict[tuple[str, str], str] = {}
EVIDENCE_TIP_KO: dict[str, str] = {}


# v2.3 — layout density policy.
#
# Some pages can read sparse on Instagram even when the content_plan
# obeys its schema-required minimums (e.g. a single-slide checkpoint
# page, or a 2-item fit/consider page). The density policy attaches
# an `aux_block` (small "왜 중요한가 / 다음 장 예고 / 구매 전 질문 /
# 리뷰 수 근거" tile) to those pages so the carousel never ships a
# visually-empty slide.
#
# The aux_block content is grounded in briefing-derivable facts
# (review count, attribute label) when possible; otherwise it falls
# back to a generic-but-useful consumer-checkpoint phrasing. We never
# fabricate product claims — the aux_block is a neutral framing line,
# not a new corpus signal.
#
# Threshold: a page is "sparse" when it carries < SPARSE_BLOCK_FLOOR
# information cards / blocks. Below that floor, attach an aux_block.
SPARSE_BLOCK_FLOOR = 3   # minimum visible info blocks per content page


# Banned tokens we MUST NOT emit ourselves in any built-in template.
# Defense-in-depth — the safety validator catches drift, but no static
# template should generate anything that needs catching.
_SELF_FORBIDDEN_TOKENS: tuple[str, ...] = (
    "최악", "독한", "독성", "부작용", "무조건", "인생템", "미쳤어요",
    "절대 사지 마세요", "광고에 속지", "브랜드가 숨긴",
    "당신이 모르는 진실", "충격적인 반전", "팩트 폭로",
    "소비자들은 속고 있다", "진짜 실체", "갈리는 제품 추천",
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


_GOODS_NO_RE = re.compile(r"[?&]goodsNo=([A-Z0-9]+)")
_QUANTITY_TAIL_RE = re.compile(
    r"\s+\d+(?:매|개|ml|g|호|종|회|kg|mg|입|병|장|cm|mm)"
)

# Consumer-facing product title cleaner — strips seller promo noise from
# raw OliveYoung names so cardnews covers/headlines never expose strings
# like "[말끔모공]", "더블 기획", "리필기획", "5g", "100+100매" to consumers.
# Cleans display only — never mutates analysis_report.product fields.
_LEADING_BRACKET_RE = re.compile(r"^\s*\[[^\]]*\]\s*")
_TRAILING_PROMO_PATTERNS: tuple[str, ...] = (
    r"\s*\([^()]*\)\s*$",                          # any trailing (…)
    r"\s*골라담기\s*$",
    r"\s*세트\s*$",
    r"\s*증정기획\s*$",
    r"\s*리필기획\s*$",
    r"\s*더블\s*기획\s*$",
    r"\s*한정\s*기획\s*$",
    r"\s*신규컬러\s*$",
    r"\s*증정\s*$",
    r"\s*단품\s*/\s*기획\s*$",
    r"\s*기획\s*/\s*단품\s*$",
    r"\s*\d+\s*Colors?\s*$",                        # 24 Colors
    r"\s*\d+\s*종\s*$",                             # 5종, 7종
    r"\s*\d+(?:\.\d+)?\s*(?:ml|mL|g|G|kg|mg)\s*(?:X\s*\d+)?\s*$",  # 50ml, 200mlX2
    r"\s*\d+\s*매(?:\s*\+\s*\d+\s*매)?\s*$",       # 100매, 100+100매
    r"\s*\d+\s*대용량\s*기획\s*$",                  # 200매 대용량 기획
    r"\s*대용량\s*기획\s*$",
)
_TRAILING_PROMO_RES: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p) for p in _TRAILING_PROMO_PATTERNS
)


def _clean_consumer_title(name: str | None) -> str:
    """Strip leading "[promo]" brackets and trailing promo/option/capacity
    fragments from a raw merch headline, producing a consumer-safe title.
    Falls back to the trimmed input when cleaning leaves an empty string."""
    if not name:
        return name or ""
    s = name.strip()
    while True:
        nxt = _LEADING_BRACKET_RE.sub("", s).strip()
        if nxt == s:
            break
        s = nxt
    changed = True
    while changed:
        changed = False
        for pat in _TRAILING_PROMO_RES:
            nxt = pat.sub("", s).strip()
            if nxt and nxt != s:
                s = nxt
                changed = True
                break
    return s.strip() or name.strip()


def _assert_self_forbidden(text: str, location: str) -> None:
    if not isinstance(text, str):
        return
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
    if not name_ko:
        return "리뷰 정리 노트"
    cleaned = _clean_consumer_title(name_ko)
    parts = _QUANTITY_TAIL_RE.split(cleaned, maxsplit=1)
    short = parts[0].strip() if parts else cleaned.strip()
    return _truncate(short, 22)


def _format_yyyy_mm_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _audit_from_quotes(
    quotes: list[dict],
    polarity_filter: tuple[str, ...] | None = None,
) -> dict:
    """Pick the highest-priority quote for the audit slot. Output
    goes into `audit.*` and is NEVER rendered."""
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


def _select_story_arc(analysis_report: dict) -> StoryArc:
    """Pick a story arc from briefing-equivalent signal shape.

    The arc decides the middle-module order so two products with
    different signal shapes don't ship visually-identical carousels.
    Selection mirrors the cover hook intent's logic:

      * caution-dominant (no strong positive) → `caution_lead`
      * strong positive + low caution → `positive_lead`
      * both present (or thin) → `balanced`
    """
    counts = _attribute_counts(analysis_report)
    n_top_pos = max(
        (int(c.get("n_positive") or 0) for c in counts.values()), default=0,
    )
    n_top_neg = max(
        (int(c.get("n_negative") or 0) for c in counts.values()), default=0,
    )
    has_strong_pos = n_top_pos >= 30
    has_strong_neg = n_top_neg >= 15
    if has_strong_neg and not has_strong_pos:
        return "caution_lead"
    if has_strong_pos and not has_strong_neg:
        return "positive_lead"
    # Both strong, or thin — keep the balanced narrative arc.
    return "balanced"


def _evidence_score(page: dict, counts: dict[str, dict]) -> float:
    """Rough evidence-strength score for a spotlight page.

    Used to sort spotlights within their family so the strongest
    attribute leads. Falls back to 0 when no attribute is attached
    (e.g. insight_spotlight without an attribute_key)."""
    key = page.get("attribute_key") or ""
    c = counts.get(key) or {}
    n_pos = int(c.get("n_positive") or 0)
    n_neg = int(c.get("n_negative") or 0)
    return float(n_pos + n_neg)


def _aux_block_for_checkpoint(slide_label: str) -> dict:
    """Density-policy aux block for a single-slide checkpoint page.

    Single-slide checkpoint pages carry one tip + one why_note + one
    who_note. Visually that reads sparse on a 1080×1350 frame; the
    aux block fills the bottom with a "구매 전 질문" prompt grounded
    in the slide's attribute label."""
    return {
        "title": "구매 전 질문",
        "text": _truncate(
            f"본인 루틴에서 {slide_label} 사용감이 누적되면 신경 쓸지 미리 질문해 보세요.",
            120,
        ),
    }


def _aux_block_for_fit(n_reviews_total: int) -> dict:
    """Density-policy aux block for a 2-item fit page.

    Generic-but-useful: ties the buyer-profile sample back to the
    actual review base so the page reads as evidence-grounded even
    with only 2 buyer profiles."""
    if n_reviews_total > 0:
        text = (
            f"리뷰 {n_reviews_total:,}건에서 반복적으로 확인된 "
            f"사용 패턴이에요. 본인의 평소 루틴과 겹치는지 살펴보세요."
        )
    else:
        text = (
            "본인의 평소 사용 루틴·구매 트리거와 가까운 분이라면, "
            "이 제품의 만족 신호를 더 자주 체감할 가능성이 있어요."
        )
    return {"title": "리뷰 수 근거", "text": _truncate(text, 120)}


def _aux_block_for_consider() -> dict:
    """Density-policy aux block for a 2-item consider page.

    Names the universal pre-purchase-check rule of thumb without
    inventing product claims: 'check the review keywords for your
    sensitive criteria before buying'."""
    return {
        "title": "왜 확인해야 할까",
        "text": _truncate(
            "사용 환경·기대 사용감 차이가 생각보다 자주 평가를 바꿔요. "
            "본인이 민감한 기준을 정해 후기를 한 번 더 비교해 보세요.",
            120,
        ),
    }


def _audit_for_attribute(
    analysis_report: dict, attribute_key: str, *, want_polarity: str,
) -> dict:
    """Build an audit dict for a per-attribute spotlight page.

    `want_polarity` is "negative" (caution / divide) or "positive"
    (loved / signature when polarity_shape == positive). Walks the
    same data the operator PDF reads."""
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
    for a in analysis_report.get("attributes") or []:
        if a.get("key") == attribute_key:
            return _audit_from_quotes(list(a.get("top_quotes") or []))
    return {}


# ---------------------------------------------------------------------------
# Page builders — each consumes content_plan + analysis_report and
# emits a page record matching its template's field names.
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
    corpus_footer = cover_plan.get("corpus_footer") or ""

    _assert_self_forbidden(headline, "cover.headline")
    _assert_self_forbidden(subline, "cover.subtitle")
    _assert_self_forbidden(corpus_footer, "cover.corpus_footer")
    for c in chips:
        _assert_self_forbidden(c, "cover.chip_strip[]")

    # v2.4 — surface hook_intent + product_angle + wording_pattern_id
    # so the cover template can apply intent-specific styling (e.g. a
    # small body class for visual variation across the 10 hook intents)
    # and so the rendered output is auditable back to a wording pattern.
    hook_intent = cover_plan.get("hook_intent") or "data_summary"
    product_angle = cover_plan.get("product_angle") or "routine"
    wording_pattern_id = cover_plan.get("wording_pattern_id")
    if not isinstance(wording_pattern_id, int):
        wording_pattern_id = 0

    return {
        "index": 1,
        "type": "cover",
        "language": LANGUAGE_DEFAULT,
        "chip": bracket_tag,
        "title": short_name,
        "headline": headline,
        "subtitle": subline,
        "chip_strip": chips,
        "corpus_footer": corpus_footer,
        "hook_intent": hook_intent,
        "product_angle": product_angle,
        "wording_pattern_id": wording_pattern_id,
        "product_image": product_image,
        "audit": {},
    }


def _build_one_liner_page(
    *, one_liner_plan: dict, briefing_metrics: dict, index: int,
) -> dict:
    """v2.2 — 한 줄 요약 with metric anchors and a framing note.

    Replaces the v2.1.1 roadmap mini-nav (which read like a slide-deck
    agenda) with a denser layout: headline + 2–3 metric pills derived
    from the briefing + a short framing note that explains *why* this
    product is read this way. Both pills and framing note are optional
    so older v2.1 plans still render.
    """
    headline = one_liner_plan["headline"]
    sub = one_liner_plan.get("sub") or ""
    framing_note = one_liner_plan.get("framing_note") or ""
    pills = list(one_liner_plan.get("metric_pills") or [])

    # Layout-side fallback: when the planner doesn't supply pills,
    # derive 2–3 short anchors from the briefing so the slide always
    # carries numbers. Keeps v2.1 plans renderable without padding
    # text. Each pill ≤ 16 chars (METRIC_VALUE_MAX equivalent).
    if not pills:
        n_total = briefing_metrics.get("n_reviews_total") or 0
        n_pos = briefing_metrics.get("n_top_positive") or 0
        n_neg = briefing_metrics.get("n_top_caution") or 0
        derived: list[str] = []
        if n_total:
            derived.append(f"리뷰 {n_total:,}건")
        if n_pos:
            derived.append(f"호평 {n_pos}건")
        if n_neg:
            derived.append(f"갈림 {n_neg}건")
        pills = derived[:3]

    _assert_self_forbidden(headline, "one_liner.headline")
    _assert_self_forbidden(sub, "one_liner.sub")
    _assert_self_forbidden(framing_note, "one_liner.framing_note")
    for p in pills:
        _assert_self_forbidden(p, "one_liner.metric_pills[]")

    return {
        "index": index,
        "type": "one_liner",
        "language": LANGUAGE_DEFAULT,
        "chip": "한 줄 요약",
        "title": "한 줄 요약",
        "headline": headline,
        "sub": sub,
        "metric_pills": pills,
        "framing_note": framing_note,
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


def _build_why_divides_page(
    *,
    why_plan: dict,
    analysis_report: dict,
    index: int,
) -> dict:
    """v2.0 — interpretation slide for the top divide.

    Names 1–3 axes the split runs on (사용 환경 / 피부 타입 / 기대 사용감).
    Audit attaches negative quote so operators can trace the reasoning."""
    attribute_key = why_plan.get("attribute_key") or ""
    headline = why_plan["headline"]
    axes = list(why_plan.get("axes") or [])
    axis_whys = list(why_plan.get("axis_whys") or [])
    note = why_plan.get("note") or ""

    _assert_self_forbidden(headline, "why_divides.headline")
    _assert_self_forbidden(note, "why_divides.note")
    for a in axes:
        _assert_self_forbidden(a, "why_divides.axes[]")
    for w in axis_whys:
        _assert_self_forbidden(w, "why_divides.axis_whys[]")

    # v2.2 — pair every axis with a one-line explanation. When the
    # planner omits `axis_whys` (older plans), fall back to the
    # neutral `note` once so the layout never renders bare bullets.
    pairs: list[dict[str, str]] = []
    for i, axis in enumerate(axes):
        why_line = ""
        if i < len(axis_whys):
            why_line = axis_whys[i]
        elif note and i == 0:
            why_line = note
        pairs.append({"axis": axis, "why": why_line})

    audit = (
        _audit_for_attribute(
            analysis_report, attribute_key, want_polarity="negative",
        )
        if attribute_key else {}
    )

    return {
        "index": index,
        "type": "why_divides",
        "language": LANGUAGE_DEFAULT,
        "attribute_key": attribute_key,
        "chip": "왜 갈렸을까",
        "title": "왜 갈렸을까",
        "headline": headline,
        "axes": axes,
        # v2.2 — paired axis + one-line why explanation. Templates
        # render `axis_pairs` so each numbered row gets a sub-line.
        "axis_pairs": pairs,
        "note": note,
        "audit": audit,
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

    counts = _attribute_counts(analysis_report)
    c = counts.get(attribute_key) or {}
    n_pos = int(c.get("n_positive") or 0)
    n_neg = int(c.get("n_negative") or 0)
    if n_pos >= 5 and n_neg >= 5:
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


def _build_checkpoint_slide_pages(
    *,
    checkpoints_plan: dict | None,
    analysis_report: dict,
    start_index: int,
) -> list[dict]:
    """v2.0 — emit ONE PAGE per checkpoint slide (not a single multi-card
    page). The user contract is "한 장에 한 메시지", so each slide gets
    its own carousel page. Returns 0..3 page records.

    When `checkpoints_plan` is None or empty, returns []. NEVER pads
    with corpus-generic advice."""
    if not checkpoints_plan:
        return []
    slides = list(checkpoints_plan.get("slides") or [])
    if not slides:
        return []

    counts = _attribute_counts(analysis_report)
    pages: list[dict] = []
    # v2.3 density policy — when there's only ONE checkpoint slide,
    # the page reads sparse on Instagram. Attach an aux_block for the
    # solo slide so the bottom of the slide carries a follow-up prompt.
    is_solo = len(slides) == 1
    for i, slide in enumerate(slides):
        idx = start_index + i
        label = slide["label"]
        count = slide["count"]
        tip = slide["tip"]
        why_note = slide["why_note"]
        who_note = slide["who_note"]

        _assert_self_forbidden(label, f"checkpoint[{i}].label")
        _assert_self_forbidden(tip, f"checkpoint[{i}].tip")
        _assert_self_forbidden(why_note, f"checkpoint[{i}].why_note")
        _assert_self_forbidden(who_note, f"checkpoint[{i}].who_note")

        # Best-effort attribute-key resolution: match the slide's label
        # against analysis_report attribute labels. Used only for audit
        # attachment; missing match is fine (audit just stays empty).
        matched_key = None
        for k, c in counts.items():
            if (c.get("label_ko") or "") == label:
                matched_key = k
                break
        audit = (
            _audit_for_attribute(
                analysis_report, matched_key, want_polarity="negative",
            )
            if matched_key else {}
        )

        page_record = {
            "index": idx,
            "type": "checkpoint",
            "language": LANGUAGE_DEFAULT,
            "attribute_key": matched_key or "",
            "chip": "구매 전 체크포인트",
            "title": "구매 전 체크포인트",
            "number": str(i + 1).zfill(2),
            "label": label,
            "count": count,
            "tip": tip,
            "why_note": why_note,
            "who_note": who_note,
            "audit": audit,
        }
        if is_solo:
            aux = _aux_block_for_checkpoint(label)
            _assert_self_forbidden(aux["text"], f"checkpoint[{i}].aux_block.text")
            page_record["aux_block"] = aux
        pages.append(page_record)
    return pages


def _build_positive_spotlight_page(
    *,
    spotlight_plan: dict,
    analysis_report: dict,
    index: int,
) -> dict:
    """v2.1 — one-attribute deep-dive on a top loved cluster.

    NOT a quote fan-out. Editorial framing of why the cluster
    materialized + who benefits. Audit attaches the strongest positive
    quote so operators can trace the reasoning."""
    attribute_key = spotlight_plan["attribute_key"]
    headline = spotlight_plan["headline"]
    count = spotlight_plan["count"]
    what = spotlight_plan["what_reviewers_liked"]
    why = spotlight_plan["why_it_matters"]
    who = spotlight_plan["who_benefits"]

    _assert_self_forbidden(headline, "positive_spotlight.headline")
    _assert_self_forbidden(what, "positive_spotlight.what_reviewers_liked")
    _assert_self_forbidden(why, "positive_spotlight.why_it_matters")
    _assert_self_forbidden(who, "positive_spotlight.who_benefits")

    audit = (
        _audit_for_attribute(
            analysis_report, attribute_key, want_polarity="positive",
        )
        if attribute_key else {}
    )

    return {
        "index": index,
        "type": "positive_spotlight",
        "language": LANGUAGE_DEFAULT,
        "attribute_key": attribute_key,
        "chip": "반복되는 호평 · 자세히",
        "title": "반복되는 호평",
        "headline": headline,
        "count": count,
        "what_reviewers_liked": what,
        "why_it_matters": why,
        "who_benefits": who,
        "audit": audit,
    }


def _build_caution_spotlight_page(
    *,
    spotlight_plan: dict,
    analysis_report: dict,
    index: int,
) -> dict:
    """v2.1 — one-attribute deep-dive on a top caution cluster.

    Distinct from `checkpoint` (one short tip): a caution_spotlight
    names the likely buyer/use context that explains the split + a
    behavioral check-before-buy. Heavier interpretation."""
    attribute_key = spotlight_plan["attribute_key"]
    headline = spotlight_plan["headline"]
    split_signal = spotlight_plan["split_signal"]
    likely_context = spotlight_plan["likely_context"]
    check_before_buy = spotlight_plan["check_before_buy"]
    interpretation = spotlight_plan.get("interpretation") or (
        # v2.1.1 — fallback when an older content_plan (or LLM output)
        # omits the optional interpretation slot. Keep neutral / non-
        # accusatory and grounded in the existing likely_context phrase
        # so the page never reads as exposé.
        f"{likely_context}. 단일 평균보다 후기 분포로 읽는 게 더 정확합니다."
    )

    _assert_self_forbidden(headline, "caution_spotlight.headline")
    _assert_self_forbidden(likely_context, "caution_spotlight.likely_context")
    _assert_self_forbidden(check_before_buy, "caution_spotlight.check_before_buy")
    _assert_self_forbidden(interpretation, "caution_spotlight.interpretation")

    audit = (
        _audit_for_attribute(
            analysis_report, attribute_key, want_polarity="negative",
        )
        if attribute_key else {}
    )

    return {
        "index": index,
        "type": "caution_spotlight",
        "language": LANGUAGE_DEFAULT,
        "attribute_key": attribute_key,
        "chip": "주의 시그널 · 자세히",
        "title": "주의 시그널",
        "headline": headline,
        "split_signal": split_signal,
        "interpretation": interpretation,
        "likely_context": likely_context,
        "check_before_buy": check_before_buy,
        "audit": audit,
    }


def _build_insight_spotlight_page(
    *,
    spotlight_plan: dict,
    index: int,
) -> dict:
    """v2.1 — cross-cut buyer-context interpretation page.

    Where `why_divides` lists 1–3 axes briefly, an insight_spotlight
    zooms into ONE buyer-context dimension and gives a fuller
    paragraph + buyer-profile recommendation."""
    headline = spotlight_plan["headline"]
    signal_count = spotlight_plan["signal_count"]
    interpretation = spotlight_plan["interpretation"]
    who_should_check = spotlight_plan["who_should_check"]

    _assert_self_forbidden(headline, "insight_spotlight.headline")
    _assert_self_forbidden(interpretation, "insight_spotlight.interpretation")
    _assert_self_forbidden(who_should_check, "insight_spotlight.who_should_check")

    return {
        "index": index,
        "type": "insight_spotlight",
        "language": LANGUAGE_DEFAULT,
        "chip": "판단에 도움이 될 정보",
        "title": "판단에 도움이 될 정보",
        "headline": headline,
        "signal_count": signal_count,
        "interpretation": interpretation,
        "who_should_check": who_should_check,
        "audit": {},
    }


def _build_fit_page(
    *, fit_plan: dict, analysis_report: dict, index: int,
) -> dict:
    items = []
    for it in fit_plan.get("items") or []:
        record = {"label": it["label"], "note": it["note"]}
        sh = it.get("signal_hint")
        if isinstance(sh, str) and sh.strip():
            _assert_self_forbidden(sh, "fit.items[].signal_hint")
            record["signal_hint"] = sh
        items.append(record)
        _assert_self_forbidden(it["label"], "fit.items[].label")
        _assert_self_forbidden(it["note"], "fit.items[].note")
    page = {
        "index": index,
        "type": "fit",
        "language": LANGUAGE_DEFAULT,
        "chip": "잘 맞는 분",
        "title": "잘 맞는 분",
        "subtitle": fit_plan.get("headline") or "리뷰 패턴으로 본 잘 맞는 분",
        "items": items,
        "audit": {},
    }
    # v2.3 density policy — 2-item fit pages get an aux_block so the
    # bottom of the slide carries an evidence-grounded framing line.
    if len(items) < SPARSE_BLOCK_FLOOR:
        n_total = int(
            (analysis_report.get("corpus") or {}).get("n_reviews_total") or 0
        )
        aux = _aux_block_for_fit(n_total)
        _assert_self_forbidden(aux["text"], "fit.aux_block.text")
        page["aux_block"] = aux
    return page


def _build_consider_page(
    *, consider_plan: dict, analysis_report: dict, index: int,
) -> dict:
    items = []
    for it in consider_plan.get("items") or []:
        record = {"label": it["label"], "note": it["note"]}
        sh = it.get("signal_hint")
        if isinstance(sh, str) and sh.strip():
            _assert_self_forbidden(sh, "consider.items[].signal_hint")
            record["signal_hint"] = sh
        items.append(record)
        _assert_self_forbidden(it["label"], "consider.items[].label")
        _assert_self_forbidden(it["note"], "consider.items[].note")
    page = {
        "index": index,
        "type": "consider",
        "language": LANGUAGE_DEFAULT,
        "chip": "신중하게 볼 분",
        "title": "신중하게 볼 분",
        "subtitle": consider_plan.get("headline") or "리뷰 패턴으로 본 신중하게 볼 분",
        "items": items,
        "audit": {},
    }
    # v2.3 density policy — 2-item consider pages get an aux_block.
    if len(items) < SPARSE_BLOCK_FLOOR:
        aux = _aux_block_for_consider()
        _assert_self_forbidden(aux["text"], "consider.aux_block.text")
        page["aux_block"] = aux
    return page


def _build_summary_page(*, summary_plan: dict, index: int) -> dict:
    headline = summary_plan["headline"]
    one_liner_conclusion = summary_plan.get("one_liner_conclusion") or ""
    takeaways = list(summary_plan.get("takeaways") or [])
    closing_note = summary_plan.get("closing_note") or ""

    _assert_self_forbidden(headline, "summary.headline")
    _assert_self_forbidden(closing_note, "summary.closing_note")
    if one_liner_conclusion:
        _assert_self_forbidden(
            one_liner_conclusion, "summary.one_liner_conclusion",
        )
    for t in takeaways:
        _assert_self_forbidden(t, "summary.takeaways[]")

    # v2.3 — judgment-frame summary. The chip text now reads
    # "최종 판단" so the operator/reader sees this slide as the
    # decision frame, not a recap. Keep the structural label backward
    # compatible by leaving `title` as "한 장 정리".
    return {
        "index": index,
        "type": "summary",
        "language": LANGUAGE_DEFAULT,
        "chip": "최종 판단 프레임",
        "title": "한 장 정리",
        "headline": headline,
        "one_liner_conclusion": one_liner_conclusion,
        "takeaways": takeaways,
        "closing_note": closing_note,
        "audit": {},
    }


def _build_cta_page(*, cta_plan: dict, analysis_report: dict, index: int) -> dict:
    product = analysis_report.get("product") or {}
    source_url = product.get("source_url") or ""

    headline = cta_plan["headline"]
    body = cta_plan["body"]
    # v2.0: disclosure absorbed into the cta plan section. Falls back
    # to the analysis_report's methodology disclosure, then to the
    # canonical default — preserves the methodology-disclaimer
    # invariant even when an LLM omits the field.
    methodology = analysis_report.get("methodology_notes") or {}
    disclosure = (
        cta_plan.get("disclosure")
        or (methodology.get("disclosure_ko") or "").strip()
        or DEFAULT_DISCLOSURE_KO
    )

    # v2.3 — locked supporting actions. The planner's `_lock_cta_to_canonical`
    # post-process forces this list to the fixed 3-row "좋아요 / 팔로우 /
    # 댓글" template. We still tolerate a planner that omits the field
    # (older plans / hand-written ones) by filling in the canonical
    # default here too.
    plan_actions = list(cta_plan.get("actions") or [])
    if not plan_actions:
        plan_actions = [
            "도움 됐다면 좋아요",
            "다음 분석도 보고 싶다면 팔로우",
            "궁금한 제품은 댓글로 남겨주세요",
        ]
    for a in plan_actions:
        _assert_self_forbidden(a, "cta.actions[]")

    _assert_self_forbidden(headline, "cta.title")
    _assert_self_forbidden(body, "cta.actions[0].body")
    _assert_self_forbidden(disclosure, "cta.disclosure")

    # v2.3 — primary hero card is the SAVE action. Title is a short
    # imperative verb ("저장하기"), body carries the full save call
    # ("저장해서 구매 전 다시 확인하기"). The hero pattern is locked
    # by the planner's `_lock_cta_to_canonical` so this branch is the
    # only one that ever fires; the legacy "comment_next_product"
    # branch is kept as a safety fallback for off-path plans.
    cta_type = cta_plan.get("type") or "save_for_later"
    if cta_type == "save_for_later":
        primary_title = "저장하기"
    else:
        primary_title = "댓글로 제품 남기기"
    structured_actions: list[dict] = [
        {"title": primary_title, "body": body},
    ]

    return {
        "index": index,
        "type": "cta",
        "language": LANGUAGE_DEFAULT,
        "chip": "다음 분석 요청",
        "title": headline,
        "lead": (
            "구매 전 다시 펼쳐 볼 수 있도록 저장해두세요."
            if cta_type == "save_for_later"
            else "댓글로 다음 제품을 남겨주시면 같은 방식으로 정리합니다."
        ),
        "actions": structured_actions,
        # v2.2 — flat string list of support actions; rendered as the
        # save / like / comment row beneath the primary CTA.
        "support_actions": plan_actions,
        "disclosure": _truncate(disclosure, 240),
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
    """Build the long-form Instagram cardnews layout (v2.1).

    Page count: 9 required + 0..14 optional, capped at 20.
      * 9 required: cover, one_liner, loved, divides, signature, fit,
        consider, summary, cta.
      * +0..3 from `positive_spotlights` (top-loved deep-dive pages).
      * +0..1 from `why_divides` (interpretation page).
      * +0..4 from `caution_spotlights` (top-caution deep-dive pages).
      * +0..3 from `insight_spotlights` (cross-cut buyer-context pages).
      * +0..3 from `checkpoints` (one quick-tip page per slide).

    Layout NEVER pads with corpus-generic advice. Hard cap of 20 pages
    is enforced by trimming spotlights in priority order: insight
    first, then positive, then caution. Required base + checkpoints +
    why_divides are never trimmed.
    """
    if not isinstance(analysis_report, dict):
        raise CardnewsGenerationError("analysis_report must be a dict")

    if content_plan is None:
        from src.voc.content.editorial_planner import build_content_plan
        content_plan = build_content_plan(analysis_report, mode="mock")

    # v2.4 — image policy. Three sources, in priority order:
    #
    # 1. Caller-supplied `product_image` dict (lets a renderer or test
    #    override). Highest priority.
    # 2. `analysis_report.product.image_local_path` — the canonical
    #    on-disk path populated by collection-stage pre-fetch (or by
    #    the operator backfill CLI). Read absolute or `<run>/assets/…`
    #    relative; resolved against the report's run dir at render
    #    time.
    # 3. `analysis_report.product.image_url` — last-resort URL. The
    #    renderer will warn and fall through to the gradient if the
    #    local path is missing AND the URL fetch fails. Live fetches
    #    at render time are STRONGLY discouraged — the operator should
    #    pre-fetch via the backfill CLI before publishing.
    if product_image is not None:
        image_descriptor = product_image
    else:
        report_product = analysis_report.get("product") or {}
        report_image_url = report_product.get("image_url")
        report_local_path = report_product.get("image_local_path")
        report_image_source = report_product.get("image_source")
        # `cover_cutout` is the new v2.4 usage: a floating product
        # image in the cover's bottom-right corner. Falls back to
        # `cover_full_bleed` (the v1 usage) when the renderer's
        # CLI path / URL chain fires instead. Plain `fallback_gradient`
        # remains the no-image case.
        if report_local_path:
            usage = "cover_cutout"
            source_label = report_image_source or "analysis_report"
        elif report_image_url:
            usage = "cover_cutout"
            source_label = "fallback_gradient"  # actual source set at fetch time
        else:
            usage = "cover_full_bleed"
            source_label = "fallback_gradient"
        image_descriptor = {
            "source": source_label,
            "url": report_image_url,
            "local_path": report_local_path,
            "usage": usage,
        }

    # ---------------------------------------------------------------
    # Build all candidate page records first, then trim to PAGE_CAP_MAX.
    # Indices are assigned at the end after trimming so the rendered
    # carousel is contiguous (1..N).
    # ---------------------------------------------------------------

    # Required base — cover, one_liner, loved
    cover_page = _build_cover_page(
        cover_plan=content_plan["cover"],
        analysis_report=analysis_report,
        product_image=image_descriptor,
    )
    # v2.2 — derive 2–3 numeric anchors (n_total, top positive, top
    # caution) from the analysis report so the one_liner page always
    # has a metric strip even when the planner omits `metric_pills`.
    corpus = analysis_report.get("corpus") or {}
    attrs = analysis_report.get("attributes") or []
    n_top_pos = max(
        (int(a.get("n_positive") or 0) for a in attrs), default=0,
    )
    n_top_neg = max(
        (int(a.get("n_negative") or 0) for a in attrs), default=0,
    )
    one_liner_metrics = {
        "n_reviews_total": corpus.get("n_reviews_total") or 0,
        "n_top_positive": n_top_pos,
        "n_top_caution": n_top_neg,
    }
    one_liner_page = _build_one_liner_page(
        one_liner_plan=content_plan["one_liner"],
        briefing_metrics=one_liner_metrics,
        index=0,
    )
    loved_page = _build_loved_page(
        loved_plan=content_plan["loved"], index=0,
    )

    # Optional positive spotlights (between loved and divides)
    positive_spotlight_pages: list[dict] = []
    for sp in (content_plan.get("positive_spotlights") or []):
        positive_spotlight_pages.append(_build_positive_spotlight_page(
            spotlight_plan=sp,
            analysis_report=analysis_report,
            index=0,
        ))

    # Required — divides
    divides_page = _build_divides_page(
        divides_plan=content_plan["divides"], index=0,
    )

    # Optional why_divides (after divides)
    why_plan = content_plan.get("why_divides")
    why_page = (
        _build_why_divides_page(
            why_plan=why_plan,
            analysis_report=analysis_report,
            index=0,
        )
        if why_plan else None
    )

    # Optional caution_spotlights
    caution_spotlight_pages: list[dict] = []
    for sp in (content_plan.get("caution_spotlights") or []):
        caution_spotlight_pages.append(_build_caution_spotlight_page(
            spotlight_plan=sp,
            analysis_report=analysis_report,
            index=0,
        ))

    # Optional insight_spotlights
    insight_spotlight_pages: list[dict] = []
    for sp in (content_plan.get("insight_spotlights") or []):
        insight_spotlight_pages.append(_build_insight_spotlight_page(
            spotlight_plan=sp,
            index=0,
        ))

    # Required — signature
    sig_page, _sig_key = _build_signature_page(
        signature_plan=content_plan["signature"],
        analysis_report=analysis_report,
        index=0,
    )

    # Optional checkpoints — one page per slide
    checkpoint_pages = _build_checkpoint_slide_pages(
        checkpoints_plan=content_plan.get("checkpoints"),
        analysis_report=analysis_report,
        start_index=0,
    )

    # Required tail — fit, consider, summary, cta
    fit_page = _build_fit_page(
        fit_plan=content_plan["fit"],
        analysis_report=analysis_report,
        index=0,
    )
    consider_page = _build_consider_page(
        consider_plan=content_plan["consider"],
        analysis_report=analysis_report,
        index=0,
    )
    summary_page = _build_summary_page(
        summary_plan=content_plan["summary"], index=0,
    )
    cta_page = _build_cta_page(
        cta_plan=content_plan["cta"],
        analysis_report=analysis_report,
        index=0,
    )

    # ---------------------------------------------------------------
    # v2.4 — sort spotlights within each family by evidence strength
    # so the strongest attribute leads each spotlight section. This
    # produces additional cross-product variation: which attribute
    # leads `caution_spotlights` differs by product.
    # ---------------------------------------------------------------
    counts = _attribute_counts(analysis_report)
    positive_spotlight_pages.sort(
        key=lambda p: -_evidence_score(p, counts),
    )
    caution_spotlight_pages.sort(
        key=lambda p: -_evidence_score(p, counts),
    )
    insight_spotlight_pages.sort(
        key=lambda p: -_evidence_score(p, counts),
    )

    # ---------------------------------------------------------------
    # Trim to PAGE_CAP_MAX. Drop priority (least → most important):
    #   insight_spotlights → positive_spotlights → caution_spotlights
    # Required base + why_divides + checkpoints are never trimmed
    # (checkpoints already cap at 3 per the planner schema).
    # ---------------------------------------------------------------
    required_count = 9 + (1 if why_page else 0) + len(checkpoint_pages)

    def _total_with(pos: list[dict], cau: list[dict], ins: list[dict]) -> int:
        return required_count + len(pos) + len(cau) + len(ins)

    while _total_with(
        positive_spotlight_pages,
        caution_spotlight_pages,
        insight_spotlight_pages,
    ) > PAGE_CAP_MAX:
        if insight_spotlight_pages:
            insight_spotlight_pages.pop()
        elif positive_spotlight_pages:
            positive_spotlight_pages.pop()
        elif caution_spotlight_pages:
            caution_spotlight_pages.pop()
        else:
            break  # checkpoints + why_divides + 9 base already > 20 — accept

    # v2.4 — soft upper bound: trim the weakest insight_spotlight first
    # to keep typical runs in the 10..18 band. Only kicks in when the
    # carousel exceeds TARGET_PAGES_MAX after the hard PAGE_CAP_MAX
    # check above.
    while _total_with(
        positive_spotlight_pages,
        caution_spotlight_pages,
        insight_spotlight_pages,
    ) > TARGET_PAGES_MAX:
        if insight_spotlight_pages:
            insight_spotlight_pages.pop()
        elif len(positive_spotlight_pages) > 1:
            positive_spotlight_pages.pop()
        elif len(caution_spotlight_pages) > 2:
            caution_spotlight_pages.pop()
        else:
            break

    # ---------------------------------------------------------------
    # v2.4 — assemble in story-arc order. Skeleton is fixed
    # (cover, one_liner first; summary, cta last); the middle order
    # flexes by arc so two products with different signal shapes
    # don't ship visually-identical carousels.
    # ---------------------------------------------------------------
    story_arc = _select_story_arc(analysis_report)

    pages: list[dict] = [cover_page, one_liner_page]

    if story_arc == "caution_lead":
        # Lead with the divide/caution narrative; loved comes after
        # so the caution-dominant story is read first.
        pages.append(divides_page)
        if why_page:
            pages.append(why_page)
        pages.extend(caution_spotlight_pages)
        pages.append(sig_page)
        pages.extend(checkpoint_pages)
        pages.append(loved_page)
        pages.extend(positive_spotlight_pages)
        pages.extend(insight_spotlight_pages)
    elif story_arc == "positive_lead":
        # Lead with loved + positive_spotlights; divide/caution comes
        # later so the strong-positive story is read first.
        pages.append(loved_page)
        pages.extend(positive_spotlight_pages)
        pages.append(sig_page)
        pages.append(divides_page)
        if why_page:
            pages.append(why_page)
        pages.extend(caution_spotlight_pages)
        pages.extend(insight_spotlight_pages)
        pages.extend(checkpoint_pages)
    else:  # "balanced" — canonical v2.1 narrative order
        pages.append(loved_page)
        pages.extend(positive_spotlight_pages)
        pages.append(divides_page)
        if why_page:
            pages.append(why_page)
        pages.extend(caution_spotlight_pages)
        pages.extend(insight_spotlight_pages)
        pages.append(sig_page)
        pages.extend(checkpoint_pages)

    # Required tail — fit, consider always sit just before summary so
    # the "잘 맞는 분 / 신중하게 볼 분" pair always reads adjacent to
    # the judgment-frame summary, regardless of arc.
    pages.append(fit_page)
    pages.append(consider_page)
    pages.append(summary_page)
    pages.append(cta_page)

    # Reindex contiguously.
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
        "story_arc": story_arc,
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
