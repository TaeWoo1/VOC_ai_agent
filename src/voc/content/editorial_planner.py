"""Editorial planner — analysis_report → content_plan_ko.

Architecture (3 layers)
-----------------------

    analysis_report.json   →   editorial_planner   →   layout   →   render
       (analysis owns)        (THIS module)         (long_layout)   (cardnews)

The planner is the only layer responsible for product-specific
Korean editorial copy. The layout layer maps `content_plan_ko` fields
into page records and never invents copy. The render layer arranges
already-prepared content into templates.

Two modes
---------

* **mock** (default) — deterministic, structurally varying templates
  driven by analysis numbers (`n_reviews`, attribute counts, signature
  winner). NO large attribute-specific Korean copy dictionaries; the
  fallbacks are short, neutral, structural. Output passes the same
  Pydantic + safety validation as LLM mode.
* **llm** — calls an injected `Callable[[str], str]` with the prompt
  built from `content/prompts/ko_cardnews_content_plan.md`. Strict
  JSON parse → ContentPlan validation → safety validation. Fail-closed
  by default; only falls through to mock when `allow_mock_fallback=True`
  (or env `CARDNEWS_PLANNER_ALLOW_FALLBACK=1`).

Briefing object
---------------
The LLM is sent a compact, sanitized briefing — counts, labels, and a
pre-computed signature candidate ranking. Verbatim review text and
review_id are stripped at the briefing boundary so they cannot leak
into the model context.

Why a callable, not a tightly-coupled OpenAI client
---------------------------------------------------
The planner stays pure. Tests inject a deterministic stub. Production
swaps in an OpenAI-backed factory. No circular imports through the
FastAPI dependencies layer.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Literal

from pydantic import ValidationError

from cardnews.safety_validator import (
    CardnewsSafetyError,
    validate_content_plan_safety,
)
from src.voc.content._confidence import resolve_overall_confidence
from src.voc.content.cardnews_generator import (
    _attribute_counts,
    _ko_topic_particle,
    _truncate,
)
from src.voc.content.schemas.content_plan import (
    BULLET_MAX,
    CHIP_MAX,
    COUNT_MAX,
    HEADLINE_MAX,
    LABEL_MAX,
    LEAD_MAX,
    METRIC_LABEL_MAX,
    METRIC_VALUE_MAX,
    NOTE_MAX,
    SUBLINE_MAX,
    TIP_MAX,
    TITLE_MAX,
    ASIDE_MAX,
    ContentPlan,
)


_LOG = logging.getLogger("voc.content.editorial_planner")

PROMPT_PATH = (
    Path(__file__).resolve().parents[3]
    / "content" / "prompts" / "ko_cardnews_content_plan.md"
)

# Threshold borrowed from layout — what counts as "enough" for a
# polarity to be a real signal rather than noise. Kept here (not
# imported from layout) so the planner stays free of a dep on layout.
SIGNAL_MIN_COUNT = 5

# Signature priority — higher = more product-distinctive. The mock
# planner uses this to pick a winner; the LLM planner is seeded with
# the ranking and may override only with grounded reasons. NOT a
# hardcoded copy table — only a numeric weighting on canonical
# attribute keys. Falls back to a neutral 2 for any unknown key.
_SIGNATURE_PRIORITY: dict[str, int] = {
    "adhesion_base_interaction": 5,
    "applicator_tool": 5,
    "transfer_resistance": 5,
    "application_blending": 4,
    "finish_texture": 4,
    "dryness_skin_texture": 4,
    "persistence": 4,
    "pigmentation": 3,
    "color_tone_matching": 3,
    "multi_use_lip_cheek_compatibility": 3,
    "packaging_container": 2,
    "value_price": 1,
}

# Tiny, neutral structural fallback templates. NOT attribute-specific.
# The mock planner composes these with the attribute label_ko (which
# comes from analysis_report) to produce product-aware copy. Compare
# to the deleted v1.2 _SIGNATURE_KO / _CHECKPOINT_WHY_KO / _CHECKPOINT_WHO_KO
# tables — those encoded 12 hand-written paragraphs per attribute and
# wouldn't generalize.
_NEUTRAL = {
    "fit_template": "{label} 강점이 매력적인 분",
    "fit_template_alt": "{label} 중심으로 제품을 고르는 분",
    "fit_template_alt2": "{label}{topic} 우선 가치로 두는 분",
    "consider_template": "{label}{topic} 민감하신 분",
    "consider_template_alt": "{label} 호불호가 갈리는 환경의 분",
    "checkpoint_tip_template": "{label} 관련 후기 먼저 확인",
    "checkpoint_why_dual": "사용 환경·취향에 따라 갈리는 신호",
    "checkpoint_why_neg": "단일 평균보다 후기 분포로 봐야 정확",
    "checkpoint_who_dual": "본인 사용 환경 후기 비교 권장",
    "checkpoint_who_neg": "{label} 키워드로 후기 추가 검색",
    "loved_note_template": "{label} 관련 만족 후기가 반복",
    "divide_note_dual": "사용 환경·취향에 따라 갈리는 항목",
    "divide_note_neg": "단일 방향 우세이지만 다른 결도 존재",
    "signature_headline_dual": "{label}, 후기 따라 다르게 읽혔어요",
    "signature_headline_pos": "{label}, 반복되는 만족 신호의 중심",
    "signature_headline_neg": "{label}, 의견이 갈린 핵심 항목",
    "signature_lead_dual": (
        "{label} 관련 호평과 갈림이 함께 쌓여 있어요. "
        "단일 평균보다 후기 패턴 분포로 읽는 게 더 정확합니다."
    ),
    "signature_lead_pos": (
        "{label} 관련 만족 후기가 반복적으로 쌓였어요. "
        "이 제품을 고르는 사용자들이 가장 자주 언급하는 결입니다."
    ),
    "signature_lead_neg": (
        "{label} 관련 호불호가 갈린 의견이 반복돼요. "
        "구매 전 본인 사용 환경 후기를 함께 확인하는 게 안전합니다."
    ),
    "signature_why_dual": "단일 평균이 아닌 후기 분포로 봐야 정확한 항목",
    "signature_why_pos": "이 제품을 고르는 사용자들의 공통 결",
    "signature_why_neg": "사용 환경·기대감에 따라 체감 차이가 큰 항목",
    "signature_who_dual": "{label} 관련 키워드로 후기를 한 번 더 검색",
    "signature_who_pos": "{label}{topic} 우선 가치로 두는 분께 권장",
    "signature_who_neg": "{label}{topic} 민감하게 보는 분께 추천",
    "method_note": "리뷰 신호이며 제품 결함을 단정하지 않습니다",
    "cta_headline_default": "다음에 보고 싶은 제품, 댓글로 알려주세요",
    "cta_body_default": (
        "옵션·궁금한 포인트까지 함께 적어 주시면 더 도움이 됩니다"
    ),
}


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class CardnewsPlannerError(RuntimeError):
    """Raised when the planner cannot produce a valid content_plan and
    fallback is not allowed. Carries the underlying cause + the path
    to the saved raw response (when available)."""

    def __init__(self, message: str, *, raw_response_path: Path | None = None,
                 cause: Exception | None = None) -> None:
        super().__init__(message)
        self.raw_response_path = raw_response_path
        self.cause = cause


# ---------------------------------------------------------------------------
# Briefing builder — sanitized, compact, no review quotes / IDs
# ---------------------------------------------------------------------------


def _format_count(n: int) -> str:
    return f"{int(n):,}"


def _attr_summary(counts: dict[str, dict]) -> list[dict]:
    out: list[dict] = []
    for key, c in counts.items():
        out.append({
            "key": key,
            "label_ko": c.get("label_ko") or key,
            "n_positive": int(c.get("n_positive") or 0),
            "n_negative": int(c.get("n_negative") or 0),
        })
    out.sort(key=lambda d: -(d["n_positive"] + d["n_negative"]))
    return out


def _rank_signature_candidates(
    counts: dict[str, dict],
) -> list[dict]:
    """Pre-compute signature candidate ranking. Used by both mock mode
    (picks the top one) and LLM mode (seeds the prompt). Each entry
    carries a `rationale` string indicating why it ranked where it
    did — the LLM may use this to override, but the rationale itself
    must NEVER appear in any visible string of the final plan."""
    ranked: list[tuple[float, dict]] = []
    for key, c in counts.items():
        n_pos = int(c.get("n_positive") or 0)
        n_neg = int(c.get("n_negative") or 0)
        if n_pos < SIGNAL_MIN_COUNT and n_neg < SIGNAL_MIN_COUNT:
            continue
        priority = _SIGNATURE_PRIORITY.get(key, 2)
        is_dual = n_pos >= SIGNAL_MIN_COUNT and n_neg >= SIGNAL_MIN_COUNT
        bonus = 1.0 if is_dual else 0.0
        minority = min(n_pos, n_neg) if is_dual else n_neg
        score = priority * 10 + bonus + minority / 1000
        polarity_shape = (
            "dual" if is_dual
            else ("positive" if n_pos > n_neg else "negative")
        )
        if is_dual:
            rationale = "dual_polarity_split"
        elif polarity_shape == "negative":
            rationale = "caution_dominant"
        else:
            rationale = "strength_dominant"
        ranked.append((score, {
            "key": key,
            "label_ko": c.get("label_ko") or key,
            "n_positive": n_pos,
            "n_negative": n_neg,
            "score": round(score, 4),
            "rationale": rationale,
            "polarity_shape": polarity_shape,
        }))
    ranked.sort(key=lambda x: -x[0])
    return [d for _, d in ranked]


def build_briefing(analysis_report: dict) -> dict:
    """Compact, sanitized briefing for the planner (mock + LLM both
    consume this).

    Strips:
      * verbatim review quotes (top_quotes, representative_quote.text)
      * review_id values
      * any audit-only metadata

    Keeps:
      * product name + category + external id slug
      * corpus counts + confidence
      * per-attribute counts and labels
      * pre-ranked signature candidates with internal rationale
    """
    if not isinstance(analysis_report, dict):
        raise CardnewsPlannerError(
            "analysis_report must be a dict for briefing"
        )

    product = analysis_report.get("product") or {}
    corpus = analysis_report.get("corpus") or {}

    counts = _attribute_counts(analysis_report)
    attrs = _attr_summary(counts)
    sig_candidates = _rank_signature_candidates(counts)

    top_strengths = sorted(
        [a for a in attrs
         if a["n_positive"] > a["n_negative"]
         and a["n_positive"] >= SIGNAL_MIN_COUNT],
        key=lambda a: -a["n_positive"],
    )
    top_cautions = sorted(
        [a for a in attrs if a["n_negative"] >= SIGNAL_MIN_COUNT],
        key=lambda a: -a["n_negative"],
    )
    top_divides = sorted(
        [a for a in attrs
         if a["n_positive"] >= SIGNAL_MIN_COUNT
         and a["n_negative"] >= SIGNAL_MIN_COUNT],
        key=lambda a: -(a["n_positive"] + a["n_negative"]),
    )

    return {
        "product": {
            "name_ko": product.get("name_ko") or "",
            "category": product.get("category") or "",
            "slug": product.get("slug") or "",
            "source_url": product.get("source_url") or "",
        },
        "corpus": {
            "n_reviews_total": int(corpus.get("n_reviews_total") or 0),
            "primary_sort": corpus.get("primary_sort") or "",
            "confidence_level": corpus.get("confidence_level") or "low",
            "sampling_strategy": corpus.get("sampling_strategy") or "",
        },
        "confidence_resolved": resolve_overall_confidence(analysis_report),
        "attributes": attrs,
        "top_strengths": top_strengths[:5],
        "top_divides": top_divides[:5],
        "top_cautions": top_cautions[:5],
        "signature_candidates": sig_candidates[:5],
    }


# ---------------------------------------------------------------------------
# Slug + path helpers
# ---------------------------------------------------------------------------


_GOODS_NO_RE = re.compile(r"[?&]goodsNo=([A-Z0-9]+)")


def product_slug_from_briefing(briefing: dict) -> str:
    """Filesystem-safe slug for the output directory.

    Order: existing `product.slug` from the analysis report (already
    slugified by `src/voc/content/paths.py:slugify`) → external id
    (goodsNo) → first 24 chars of the product name with non-alnum
    collapsed to `_`. Falls back to `unknown` when nothing usable is
    available.
    """
    p = briefing.get("product") or {}
    if isinstance(p.get("slug"), str) and p["slug"]:
        return p["slug"]
    url = p.get("source_url") or ""
    m = _GOODS_NO_RE.search(url)
    if m:
        return m.group(1).lower()
    name = (p.get("name_ko") or "").strip()
    if name:
        cleaned = re.sub(r"[^0-9A-Za-z가-힣]+", "_", name)
        return cleaned.strip("_")[:24] or "unknown"
    return "unknown"


# ---------------------------------------------------------------------------
# Mock planner — structurally varying, neutral templates
# ---------------------------------------------------------------------------


# Consumer-facing title cleaning. Mirrors cardnews_long_layout._clean_consumer_title
# so {product} placeholders in cover headline templates stay free of seller
# promo noise like "[말끔모공]", "더블 기획", "리필기획", "5g", "100+100매".
# Cleans display only — never mutates analysis_report.product fields.
_LEADING_BRACKET_RE = re.compile(r"^\s*\[[^\]]*\]\s*")
_TRAILING_PROMO_PATTERNS_EP: tuple[str, ...] = (
    r"\s*\([^()]*\)\s*$",
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
    r"\s*\d+\s*Colors?\s*$",
    r"\s*\d+\s*종\s*$",
    r"\s*\d+(?:\.\d+)?\s*(?:ml|mL|g|G|kg|mg)\s*(?:X\s*\d+)?\s*$",
    r"\s*\d+\s*매(?:\s*\+\s*\d+\s*매)?\s*$",
    r"\s*\d+\s*대용량\s*기획\s*$",
    r"\s*대용량\s*기획\s*$",
)
_TRAILING_PROMO_RES_EP: tuple[re.Pattern[str], ...] = tuple(
    re.compile(p) for p in _TRAILING_PROMO_PATTERNS_EP
)


def _clean_consumer_title(name: str | None) -> str:
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
        for pat in _TRAILING_PROMO_RES_EP:
            nxt = pat.sub("", s).strip()
            if nxt and nxt != s:
                s = nxt
                changed = True
                break
    return s.strip() or name.strip()


def _short_product_name(name_ko: str) -> str:
    name = name_ko.strip()
    if not name:
        return "리뷰 정리 노트"
    cleaned = _clean_consumer_title(name)
    tail_re = re.compile(r"\s+\d+(?:매|개|ml|g|호|종|회|kg|mg|입|병|장|cm|mm)")
    parts = tail_re.split(cleaned, maxsplit=1)
    short = parts[0].strip() if parts else cleaned
    return _truncate(short, 22)


def _build_mock_cover(briefing: dict) -> dict:
    product = briefing["product"]
    short_name = _short_product_name(product.get("name_ko") or "")
    n = briefing["corpus"]["n_reviews_total"]
    strengths = briefing.get("top_strengths") or []
    divides = briefing.get("top_divides") or []
    cautions = briefing.get("top_cautions") or []

    s_label = strengths[0]["label_ko"] if strengths else None
    s_topic = _ko_topic_particle(s_label) if s_label else "은"

    rhs_label = None
    for src in (divides, cautions):
        for a in src:
            if a["label_ko"] != s_label:
                rhs_label = a["label_ko"]
                break
        if rhs_label:
            break
    if rhs_label is None and divides:
        rhs_label = divides[0]["label_ko"]
    if rhs_label is None and cautions:
        rhs_label = cautions[0]["label_ko"]

    if s_label and rhs_label:
        rhs_topic = _ko_topic_particle(rhs_label)
        headline = (
            f"{s_label}{s_topic} 호평이 분명한데, "
            f"{rhs_label}{rhs_topic} 갈렸어요"
        )
    elif s_label:
        headline = f"{s_label}{s_topic} 가장 자주 반복된 신호예요"
    elif cautions:
        c_label = cautions[0]["label_ko"]
        c_topic = _ko_topic_particle(c_label)
        headline = f"{c_label}{c_topic} 갈린 지점을 정리했어요"
    else:
        headline = "리뷰 신호가 한 곳에서 갈리는 지점"

    headline = _truncate(headline, HEADLINE_MAX)

    if n > 0:
        subline = f"{short_name} · 리뷰 {_format_count(n)}건"
    else:
        subline = short_name
    subline = _truncate(subline, SUBLINE_MAX)

    seen: set[str] = set()
    chips: list[str] = []
    for src in (strengths[:1], divides[:1], cautions[:1],
                strengths[1:2], cautions[1:2]):
        for a in src:
            label = (a["label_ko"] or "").split("/")[0].strip()[:CHIP_MAX]
            if label and label not in seen:
                seen.add(label)
                chips.append(label)
        if len(chips) >= 3:
            break
    if not chips:
        chips = ["리뷰"]
    chips = chips[:3]

    return {"headline": headline, "subline": subline, "chips": chips}


def _build_mock_hook(briefing: dict) -> dict:
    n_total = briefing["corpus"]["n_reviews_total"]
    confidence = briefing["confidence_resolved"]
    strengths = briefing.get("top_strengths") or []
    divides = briefing.get("top_divides") or []
    cautions = briefing.get("top_cautions") or []
    attrs = briefing.get("attributes") or []

    headline_by_conf = {
        "weak": "표본 내에서 자주 본 두 신호",
        "moderate": "표본에서 반복된 두 신호",
        "strong": "표본에서 일관되게 나타난 두 신호",
    }
    headline = headline_by_conf.get(confidence, headline_by_conf["weak"])
    headline = _truncate(headline, HEADLINE_MAX)

    bullets: list[str] = []
    s_key = None
    if strengths:
        s = strengths[0]
        s_key = s["key"]
        bullets.append(_truncate(
            f"{s['label_ko']} — 반복되는 호평 {s['n_positive']}건",
            BULLET_MAX,
        ))
    chosen = None
    for d in divides:
        if d["key"] != s_key:
            chosen = d
            break
    if chosen is None and divides:
        chosen = divides[0]
    if chosen is None:
        for c in cautions:
            if c["key"] != s_key:
                chosen = c
                break
        if chosen is None and cautions:
            chosen = cautions[0]
    if chosen is not None:
        bullets.append(_truncate(
            f"{chosen['label_ko']} — 만족 {chosen['n_positive']} / 갈림 {chosen['n_negative']}",
            BULLET_MAX,
        ))
    if not bullets:
        bullets = ["표본이 작아 일관된 신호가 보이지 않아요"]

    n_pos_total = sum(a["n_positive"] for a in attrs)
    n_split = sum(
        1 for a in attrs
        if a["n_positive"] >= SIGNAL_MIN_COUNT
        and a["n_negative"] >= SIGNAL_MIN_COUNT
    )
    metrics = [
        {"label": "분석 리뷰", "value": _format_count(n_total)},
        {"label": "호평", "value": _format_count(n_pos_total)},
        {"label": "갈리는 항목", "value": str(n_split)},
    ]
    return {"headline": headline, "metrics": metrics, "bullets": bullets}


def _build_mock_loved(briefing: dict) -> dict:
    strengths = briefing.get("top_strengths") or []
    items: list[dict] = []
    for s in strengths[:3]:
        label = _truncate(s["label_ko"], TITLE_MAX)
        items.append({
            "label": label,
            "count": _truncate(f"만족 후기 {s['n_positive']}건", COUNT_MAX),
            "note": _truncate(
                _NEUTRAL["loved_note_template"].format(label=s["label_ko"]),
                NOTE_MAX,
            ),
        })
    if not items:
        items = [{
            "label": "표본 부족",
            "count": "신호 형성 중",
            "note": "리뷰가 더 모이면 다시 정리할 후보",
        }]
    return {
        "headline": _truncate("가장 자주 칭찬받은 부분", HEADLINE_MAX),
        "items": items,
    }


def _build_mock_divides(briefing: dict) -> dict:
    divides = briefing.get("top_divides") or []
    cautions = briefing.get("top_cautions") or []
    items: list[dict] = []
    for d in divides[:3]:
        items.append({
            "label": _truncate(d["label_ko"], TITLE_MAX),
            "satisfied": d["n_positive"],
            "split": d["n_negative"],
            "note": _truncate(_NEUTRAL["divide_note_dual"], NOTE_MAX),
        })
    if not items:
        for c in cautions[:3]:
            items.append({
                "label": _truncate(c["label_ko"], TITLE_MAX),
                "satisfied": c["n_positive"],
                "split": c["n_negative"],
                "note": _truncate(_NEUTRAL["divide_note_neg"], NOTE_MAX),
            })
    if not items:
        items = [{
            "label": "—",
            "satisfied": 0,
            "split": 0,
            "note": "뚜렷하게 갈린 지점이 충분히 보이지 않아요",
        }]
    return {
        "headline": _truncate("같은 항목, 다르게 본 사용자들", HEADLINE_MAX),
        "items": items,
    }


def _build_mock_signature(briefing: dict) -> dict:
    cands = briefing.get("signature_candidates") or []
    if not cands:
        # Graceful degradation — use the first attribute by total volume
        # so the schema field is still populated; the lead acknowledges
        # the data thinness.
        attrs = briefing.get("attributes") or []
        if not attrs:
            return {
                "attribute_key": "unknown",
                "title": "신호 형성 중",
                "headline": "표본이 작아 단정이 어려운 단계예요",
                "lead": (
                    "리뷰가 더 쌓이면 이 제품만의 신호가 또렷해질 거예요. "
                    "지금까지의 패턴은 다른 페이지를 참고해 주세요."
                ),
                "why_it_matters": "표본 누적 후 재분석이 필요한 단계",
                "who_should_check": "추가 리뷰가 모이면 다시 정리할 후보",
            }
        a = attrs[0]
        label = a["label_ko"]
        return {
            "attribute_key": a["key"],
            "title": _truncate(label, TITLE_MAX),
            "headline": _truncate(
                f"{label}, 후기 패턴이 형성되는 단계예요", HEADLINE_MAX,
            ),
            "lead": _truncate(
                f"{label} 관련 신호가 막 쌓이기 시작한 단계입니다. "
                "추가 리뷰가 누적된 뒤에 다시 살펴보면 더 정확합니다.",
                LEAD_MAX,
            ),
            "why_it_matters": _truncate(
                "초기 신호 단계 — 단정보다 관찰 권장", ASIDE_MAX,
            ),
            "who_should_check": _truncate(
                f"{label} 키워드로 후기 추가 검색 권장", ASIDE_MAX,
            ),
        }

    pick = cands[0]
    label = pick["label_ko"]
    topic = _ko_topic_particle(label)
    shape = pick["polarity_shape"]
    if shape == "dual":
        headline = _NEUTRAL["signature_headline_dual"].format(label=label)
        lead = _NEUTRAL["signature_lead_dual"].format(label=label)
        why = _NEUTRAL["signature_why_dual"]
        who = _NEUTRAL["signature_who_dual"].format(label=label)
    elif shape == "positive":
        headline = _NEUTRAL["signature_headline_pos"].format(label=label)
        lead = _NEUTRAL["signature_lead_pos"].format(label=label)
        why = _NEUTRAL["signature_why_pos"]
        who = _NEUTRAL["signature_who_pos"].format(label=label, topic=topic)
    else:
        headline = _NEUTRAL["signature_headline_neg"].format(label=label)
        lead = _NEUTRAL["signature_lead_neg"].format(label=label)
        why = _NEUTRAL["signature_why_neg"]
        who = _NEUTRAL["signature_who_neg"].format(label=label, topic=topic)

    return {
        "attribute_key": pick["key"],
        "title": _truncate(label, TITLE_MAX),
        "headline": _truncate(headline, HEADLINE_MAX),
        "lead": _truncate(lead, LEAD_MAX),
        "why_it_matters": _truncate(why, ASIDE_MAX),
        "who_should_check": _truncate(who, ASIDE_MAX),
    }


def _build_mock_checkpoints(briefing: dict, *, skip_key: str | None) -> dict:
    cautions = briefing.get("top_cautions") or []
    attrs_by_key = {a["key"]: a for a in (briefing.get("attributes") or [])}
    items: list[dict] = []
    for c in cautions:
        if c["key"] == skip_key:
            continue
        if c["n_negative"] < SIGNAL_MIN_COUNT:
            continue
        a = attrs_by_key.get(c["key"]) or c
        n_pos = a.get("n_positive", 0)
        is_dual = n_pos >= SIGNAL_MIN_COUNT
        label = c["label_ko"]
        items.append({
            "label": _truncate(label, TITLE_MAX),
            "count": _truncate(f"호불호 {c['n_negative']}건", COUNT_MAX),
            "tip": _truncate(
                _NEUTRAL["checkpoint_tip_template"].format(label=label),
                TIP_MAX,
            ),
            "why_note": _truncate(
                _NEUTRAL["checkpoint_why_dual"] if is_dual
                else _NEUTRAL["checkpoint_why_neg"],
                NOTE_MAX,
            ),
            "who_note": _truncate(
                _NEUTRAL["checkpoint_who_dual"] if is_dual
                else _NEUTRAL["checkpoint_who_neg"].format(label=label),
                NOTE_MAX,
            ),
        })
        if len(items) >= 2:
            break
    if not items:
        items = [{
            "label": "표본 부족",
            "count": "신호 형성 중",
            "tip": "리뷰가 더 모이면 다시 정리할 후보",
            "why_note": "현재 표본으로는 단정 어려움",
            "who_note": "추가 리뷰 모이면 재검토",
        }]
    return {
        "headline": _truncate("구매 전에 한 번 더 짚을 포인트", HEADLINE_MAX),
        "items": items,
    }


def _build_mock_audience(briefing: dict) -> dict:
    strengths = briefing.get("top_strengths") or []
    cautions = briefing.get("top_cautions") or []

    fit_items: list[dict] = []
    fit_templates = [
        _NEUTRAL["fit_template"],
        _NEUTRAL["fit_template_alt"],
        _NEUTRAL["fit_template_alt2"],
    ]
    for i, s in enumerate(strengths[:3]):
        label = s["label_ko"]
        topic = _ko_topic_particle(label)
        primary = fit_templates[i % len(fit_templates)].format(
            label=label, topic=topic,
        )
        fit_items.append({
            "label": _truncate(primary, LABEL_MAX),
            "note": _truncate(f"만족 후기 {s['n_positive']}건", COUNT_MAX),
        })
    if not fit_items:
        fit_items = [{
            "label": "표본이 작아 잘 맞는 분을 단정하기 어려워요",
            "note": "리뷰가 더 모이면 재정리",
        }]

    consider_items: list[dict] = []
    for i, c in enumerate(cautions[:3]):
        label = c["label_ko"]
        topic = _ko_topic_particle(label)
        tpl = (
            _NEUTRAL["consider_template"] if i == 0
            else _NEUTRAL["consider_template_alt"]
        )
        primary = tpl.format(label=label, topic=topic)
        consider_items.append({
            "label": _truncate(primary, LABEL_MAX),
            "note": _truncate(f"호불호 {c['n_negative']}건", COUNT_MAX),
        })
    if not consider_items:
        consider_items = [{
            "label": "표본 내에서 두드러진 신호 없음",
            "note": "옵션·환경별 후기 추가 확인",
        }]

    return {"fit_items": fit_items, "consider_items": consider_items}


def _build_mock_method(briefing: dict) -> dict:
    n_total = briefing["corpus"]["n_reviews_total"]
    cl = (briefing["corpus"]["confidence_level"] or "").lower()
    confidence_label = {
        "high": "충분", "medium": "보통", "low": "초기 신호",
    }.get(cl, "보통")
    sampling = briefing["corpus"]["sampling_strategy"]
    sampling_label = (
        "다중 정렬 합집합" if sampling == "observable_multi_sort_corpus"
        else "최신순 우선"
    )
    items = [
        {"label": "분석 리뷰", "value": _truncate(
            f"{_format_count(n_total)}건", METRIC_VALUE_MAX,
        )},
        {"label": "표본 규모", "value": _truncate(
            confidence_label, METRIC_VALUE_MAX,
        )},
        {"label": "수집 방식", "value": _truncate(
            sampling_label, METRIC_VALUE_MAX,
        )},
    ]
    return {
        "items": items,
        "note": _truncate(_NEUTRAL["method_note"], NOTE_MAX),
    }


def _build_mock_cta(briefing: dict) -> dict:
    return {
        "type": "comment_next_product",
        "headline": _truncate(
            _NEUTRAL["cta_headline_default"], HEADLINE_MAX,
        ),
        "body": _truncate(
            _NEUTRAL["cta_body_default"], BULLET_MAX + 20,
        ),
    }


def build_mock_plan(briefing: dict) -> dict:
    """Deterministic mock content_plan.

    Output shape matches `ContentPlan`. Varies structurally across
    products based on:
      * n_reviews
      * number of attributes that clear SIGNAL_MIN_COUNT
      * signature winner's polarity shape (dual / positive / negative)
    """
    sig = _build_mock_signature(briefing)
    plan = {
        "schema_version": "1.0",
        "language": "ko",
        "cover": _build_mock_cover(briefing),
        "hook": _build_mock_hook(briefing),
        "loved": _build_mock_loved(briefing),
        "divides": _build_mock_divides(briefing),
        "signature": sig,
        "checkpoints": _build_mock_checkpoints(
            briefing, skip_key=sig["attribute_key"],
        ),
        "audience": _build_mock_audience(briefing),
        "method": _build_mock_method(briefing),
        "cta": _build_mock_cta(briefing),
    }
    return plan


# ---------------------------------------------------------------------------
# LLM mode
# ---------------------------------------------------------------------------


def _read_prompt_template() -> str:
    return PROMPT_PATH.read_text(encoding="utf-8")


def _build_llm_prompt(briefing: dict) -> str:
    template = _read_prompt_template()
    briefing_block = json.dumps(briefing, ensure_ascii=False, indent=2)
    return (
        template
        + "\n\n---\n\n## Briefing\n\n```json\n"
        + briefing_block
        + "\n```\n"
    )


def _save_raw_response(raw: str, *, out_dir: Path | None) -> Path | None:
    if out_dir is None:
        return None
    out_dir.mkdir(parents=True, exist_ok=True)
    p = out_dir / "_planner_raw.txt"
    p.write_text(raw, encoding="utf-8")
    return p


def _parse_json_strict(raw: str) -> dict:
    """Parse strict JSON, tolerating ``` fences if the LLM ignored
    instructions but still produced usable JSON inside."""
    text = raw.strip()
    if text.startswith("```"):
        # Drop opening fence (with optional language tag) and closing fence.
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return json.loads(text)


def _build_llm_plan(
    briefing: dict,
    *,
    llm_client: Callable[[str], str],
    raw_dump_dir: Path | None,
) -> dict:
    prompt = _build_llm_prompt(briefing)
    raw = llm_client(prompt)
    raw_str = raw if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False)
    try:
        return _parse_json_strict(raw_str)
    except Exception as e:
        path = _save_raw_response(raw_str, out_dir=raw_dump_dir)
        raise CardnewsPlannerError(
            f"LLM response is not valid JSON: {e}",
            raw_response_path=path,
            cause=e,
        )


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


@dataclass
class PlannerOutcome:
    plan: dict
    mode: Literal["mock", "llm", "llm_fallback_mock"]
    briefing: dict


def build_content_plan(
    analysis_report: dict,
    *,
    mode: Literal["mock", "llm"] | None = None,
    llm_client: Callable[[str], str] | None = None,
    allow_mock_fallback: bool | None = None,
    raw_dump_dir: Path | None = None,
) -> dict:
    """Produce a validated content_plan_ko dict.

    Parameters
    ----------
    analysis_report
        v3.0 analysis_report dict.
    mode
        "mock" (default) or "llm". When None, reads the env var
        `CARDNEWS_PLANNER_MODE` (defaults to "mock").
    llm_client
        Required when mode="llm". Signature: `Callable[[str], str]`.
        The planner sends the full prompt + briefing JSON and expects
        a JSON-only string back. No tight coupling to any provider.
    allow_mock_fallback
        When mode="llm" and the LLM call / parse / schema / safety
        validation fails, fall back to mock instead of raising. Default
        False (fail-closed). When None, reads env var
        `CARDNEWS_PLANNER_ALLOW_FALLBACK` (1/true/yes → True).
    raw_dump_dir
        Where to save the raw LLM response when parsing fails. Useful
        for debugging unexpected formats. Optional.

    Returns
    -------
    A validated `content_plan_ko` dict (round-tripped through
    ContentPlan and `validate_content_plan_safety`).

    Raises
    ------
    CardnewsPlannerError
        On LLM failure when fallback isn't allowed, on missing client,
        or on a malformed `analysis_report`.
    CardnewsSafetyError
        When the produced plan trips the safety contract (banned
        framings, medical/efficacy, attack/exposé clusters).
    """
    if mode is None:
        mode = os.environ.get("CARDNEWS_PLANNER_MODE", "mock").lower()
    if mode not in ("mock", "llm"):
        raise CardnewsPlannerError(f"unknown planner mode: {mode!r}")
    if allow_mock_fallback is None:
        env_val = os.environ.get("CARDNEWS_PLANNER_ALLOW_FALLBACK", "")
        allow_mock_fallback = env_val.strip().lower() in ("1", "true", "yes")

    briefing = build_briefing(analysis_report)

    if mode == "llm":
        if llm_client is None:
            raise CardnewsPlannerError(
                "mode='llm' requires an llm_client (Callable[[str], str])"
            )
        try:
            raw_plan = _build_llm_plan(
                briefing,
                llm_client=llm_client,
                raw_dump_dir=raw_dump_dir,
            )
            validated = ContentPlan.model_validate(raw_plan)
            plan_dict = validated.model_dump(mode="json")
            validate_content_plan_safety(plan_dict)
            return plan_dict
        except (CardnewsPlannerError, ValidationError, CardnewsSafetyError) as e:
            if not allow_mock_fallback:
                # Re-raise as planner error if it isn't already.
                if isinstance(e, CardnewsPlannerError):
                    raise
                if isinstance(e, ValidationError):
                    raise CardnewsPlannerError(
                        f"LLM plan failed Pydantic validation: {e}",
                        cause=e,
                    )
                raise CardnewsPlannerError(
                    f"LLM plan failed safety validation: {e}",
                    cause=e,
                )
            _LOG.warning(
                "LLM planner failed (%s); falling back to mock per "
                "allow_mock_fallback=True", e,
            )
            # Continue into mock branch below.

    # Mock branch (default, or explicit fallback).
    raw_plan = build_mock_plan(briefing)
    validated = ContentPlan.model_validate(raw_plan)
    plan_dict = validated.model_dump(mode="json")
    validate_content_plan_safety(plan_dict)
    return plan_dict


def write_content_plan(
    plan: dict,
    *,
    out_dir: Path,
    filename: str = "content_plan_ko.json",
) -> Path:
    """Write a content_plan dict to `out_dir/filename`. Creates parents."""
    out_dir = Path(out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / filename
    path.write_text(
        json.dumps(plan, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return path


def default_output_dir(briefing_or_report: dict, *, base: Path | None = None) -> Path:
    """Default artifact path: `outputs/content/{slug}/ko/`.

    `briefing_or_report` may be either a briefing dict (with
    `product.slug` already populated) or a raw analysis_report (we
    derive the slug). Keeps both callers ergonomic.
    """
    if base is None:
        base = Path.cwd() / "outputs" / "content"
    if "signature_candidates" in briefing_or_report:
        briefing = briefing_or_report  # already a briefing
    else:
        briefing = build_briefing(briefing_or_report)
    return Path(base) / product_slug_from_briefing(briefing) / "ko"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    parser = argparse.ArgumentParser(
        description="Build a content_plan_ko.json from an analysis_report.json"
    )
    parser.add_argument("--analysis-report", required=True, type=Path)
    parser.add_argument("--out", type=Path, default=None,
                        help="Output JSON path. Defaults to "
                             "outputs/content/{slug}/ko/content_plan_ko.json")
    parser.add_argument("--mode", choices=("mock", "llm"), default=None,
                        help="Defaults to CARDNEWS_PLANNER_MODE env var, "
                             "or 'mock' if unset.")
    parser.add_argument("--allow-mock-fallback", action="store_true",
                        help="If LLM mode fails, fall back to mock instead "
                             "of failing closed.")
    args = parser.parse_args(argv)

    report = json.loads(args.analysis_report.read_text(encoding="utf-8"))

    plan = build_content_plan(
        report,
        mode=args.mode,
        allow_mock_fallback=(True if args.allow_mock_fallback else None),
    )

    if args.out is None:
        out_dir = default_output_dir(report)
        out_path = out_dir / "content_plan_ko.json"
    else:
        out_path = args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(plan, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(
        f"wrote {out_path} (mode={args.mode or os.environ.get('CARDNEWS_PLANNER_MODE', 'mock')})",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
