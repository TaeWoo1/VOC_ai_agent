"""Editorial planner — analysis_report → content_plan_ko (v2.1).

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
  driven by analysis numbers. NO large attribute-specific copy
  dictionaries; the fallbacks are short, neutral, structural. Output
  passes the same Pydantic + safety validation as LLM mode.
* **llm** — calls an injected `Callable[[str], str]` with the prompt
  built from `content/prompts/ko_cardnews_content_plan.md`. Strict
  JSON parse → ContentPlan validation → safety validation. Fail-closed
  by default; only falls through to mock when `allow_mock_fallback=True`.

v2.1 narrative (10–20 page expandable carousel)
-----------------------------------------------

Base required (always present, 9 pages):
    cover · one_liner · loved · divides · signature · fit · consider ·
    summary · cta

Optional, signal-driven sections (omit when no product-specific signal
supports them — NEVER padded with corpus-generic advice):
    why_divides            (0–1 page)
    checkpoints            (0–3 slides → 0–3 pages, one per slide)
    positive_spotlights    (0–3 pages, deep-dive on top loved attrs)
    caution_spotlights     (0–4 pages, deep-dive on top caution attrs)
    insight_spotlights     (0–3 cross-cut buyer-context pages)

Total page count: 9 (thin corpus) → 10–20 (typical → rich corpus).
Layout enforces a 20-page hard cap by trimming spotlights in priority
order (insight → positive → caution).
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
from dataclasses import dataclass
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


# v2.0 safe default disclosure — avoids medical/efficacy verbs that
# the planner-stage safety validator would (correctly) catch on a
# consumer-facing surface. The legacy `DEFAULT_DISCLOSURE_KO` from
# `cardnews_generator` still uses "효능을 보장하지 않습니다", which
# is appropriate for the operator PDF (protected surface per CLAUDE.md
# §6) but trips PLANNER_MEDICAL_BANNED_KO on the consumer cardnews.
# Wording is observational only — describes what the carousel IS, not
# what the product does.
_SAFE_DEFAULT_DISCLOSURE_KO = (
    "이 카드뉴스는 공개 리뷰 데이터를 기반으로 정리한 관찰 기록이에요. "
    "후기 패턴을 보여줄 뿐, 제품 사용 결과를 단정하지 않습니다."
)
import hashlib

from src.voc.content.schemas.content_plan import (
    ASIDE_MAX,
    AXIS_MAX,
    BULLET_MAX,
    CHIP_MAX,
    CLOSING_NOTE_MAX,
    CORPUS_FOOTER_MAX,
    COUNT_MAX,
    DISCLOSURE_MAX,
    HEADLINE_MAX,
    LABEL_MAX,
    LEAD_MAX,
    METRIC_VALUE_MAX,
    NOTE_MAX,
    ONE_LINER_MAX,
    SUBLINE_MAX,
    TAKEAWAY_MAX,
    TIP_MAX,
    TITLE_MAX,
    ContentPlan,
)


_LOG = logging.getLogger("voc.content.editorial_planner")

PROMPT_PATH = (
    Path(__file__).resolve().parents[3]
    / "content" / "prompts" / "ko_cardnews_content_plan.md"
)

# Threshold borrowed from layout — what counts as "enough" for a
# polarity to be a real signal rather than noise. Kept here so the
# planner stays free of a dep on layout.
SIGNAL_MIN_COUNT = 5

# v2.1 spotlight thresholds — higher than SIGNAL_MIN_COUNT so a
# spotlight only fires when the cluster is genuinely repeated, not
# borderline. Lower thresholds would surface weak signals as if they
# were major patterns, which contradicts the "no padding, no generic
# advice" contract.
POSITIVE_SPOTLIGHT_MIN = 20      # n_positive ≥ N → eligible for spotlight
CAUTION_SPOTLIGHT_MIN = 12       # n_negative ≥ N → eligible for spotlight
INSIGHT_SPOTLIGHT_MINORITY_MIN = 8  # min(pos, neg) ≥ N for divide insight

# Spotlight cardinality caps (per user spec).
POSITIVE_SPOTLIGHT_MAX = 3
CAUTION_SPOTLIGHT_MAX = 4
INSIGHT_SPOTLIGHT_MAX = 3

# Signature priority — higher = more product-distinctive. Mock picks
# the top one; LLM is seeded with the ranking and may override only
# with grounded reasons. Falls back to a neutral 2 for unknown keys.
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
# Mock composes these with the attribute label_ko (which comes from
# analysis_report) to produce product-aware copy.
_NEUTRAL = {
    # cover
    "cover_corpus_footer_template": "리뷰 {n}건 분석 · {confidence}",
    # one_liner
    "one_liner_dual": "{strength}{s_topic} 자주 반복됐지만, {divide}{d_topic} 갈렸어요",
    "one_liner_pos": "{strength}{s_topic} 가장 자주 칭찬받았어요",
    "one_liner_neg": "{caution}{c_topic} 사용감이 갈렸어요",
    "one_liner_thin": "표본이 작아 신호가 형성되는 단계예요",
    "one_liner_sub_template": "분석 리뷰 {n}건",
    "one_liner_sub_thin": "리뷰가 더 모이면 다시 정리할 후보",
    # v2.2 — one_liner framing-note (replaces v2.1.1 roadmap mini-nav).
    # Fills the slot beneath the metric pills with one short reason
    # the reader should read this product through its review pattern,
    # not its average rating.
    "one_liner_framing_dual": (
        "평균 별점보다 어떤 결에서 갈렸는지를 보면 더 정확해요"
    ),
    "one_liner_framing_pos": (
        "반복된 호평이 어디서 왔는지 함께 짚어볼게요"
    ),
    "one_liner_framing_neg": (
        "갈린 의견이 어떤 사용 맥락에서 나왔는지 정리했어요"
    ),
    "one_liner_framing_thin": (
        "표본이 더 쌓이면 다시 정리할 신호 단계예요"
    ),
    # loved
    "loved_headline": "가장 자주 칭찬받은 부분",
    "loved_note_template": "{label} 관련 만족 후기가 반복",
    # divides
    "divides_headline": "같은 항목, 다르게 본 사용자들",
    "divide_note_dual": "사용 환경·취향에 따라 갈리는 항목",
    "divide_note_neg": "단일 방향 우세이지만 다른 결도 존재",
    # why_divides
    "why_divides_headline_template": "{label}, 왜 갈렸을까",
    "why_axis_environment": "사용 환경에 따라 체감이 달라요",
    "why_axis_skin_type": "피부 타입별로 결이 달라져요",
    "why_axis_expectation": "기대 사용감 기준이 다르면 인상이 갈려요",
    "why_axis_routine": "루틴 위치에 따라 손이 가는 빈도가 달라요",
    "why_divides_note": "단일 평균보다 후기 분포로 봐야 정확",
    # v2.2 — per-axis "why" sub-line (rendered under each axis row).
    # Mock paraphrases the axis name; LLM mode is encouraged to ground
    # each line in the actual product use context.
    "why_axis_why_environment": (
        "매일 쓰는지 가끔 쓰는지에 따라 체감이 달라요"
    ),
    "why_axis_why_skin_type": (
        "피부 타입에 따라 같은 사용감도 다르게 남아요"
    ),
    "why_axis_why_expectation": (
        "산뜻함을 기대했는지 촉촉함을 기대했는지에 따라 평가가 갈려요"
    ),
    # signature
    "signature_headline_dual": "{label}에서 사용감이 갈렸어요",
    "signature_headline_pos": "{label}{topic} 가장 자주 언급된 결",
    "signature_headline_neg": "{label}{topic} 의견이 갈린 핵심 항목",
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
    "signature_who_dual": "{label} 관련 후기를 한 번 더 살펴보는 분",
    "signature_who_pos": "{label}{topic} 우선 가치로 두고 고르는 분",
    "signature_who_neg": "{label}{topic} 민감하게 보는 분",
    # checkpoints
    "checkpoint_tip_template": "{label} 관련 후기 먼저 확인",
    "checkpoint_why_dual": "사용 환경·취향에 따라 갈리는 신호",
    "checkpoint_why_neg": "단일 평균보다 후기 분포로 봐야 정확",
    "checkpoint_who_dual": "본인 사용 환경 후기를 비교하는 분",
    "checkpoint_who_neg": "{label} 관련 후기를 추가로 검색하는 분",
    # fit / consider
    "fit_headline": "잘 맞는 분",
    "fit_template": "{label} 강점이 매력적인 분",
    "fit_template_alt": "{label} 중심으로 제품을 고르는 분",
    "fit_template_alt2": "{label}{topic} 우선 가치로 두는 분",
    "consider_headline": "신중하게 볼 분",
    "consider_template": "{label}{topic} 민감하게 보는 분",
    "consider_template_alt": "{label} 호불호가 갈리는 환경에서 사용하는 분",
    # summary
    "summary_headline": "한 장 정리",
    "summary_takeaway_strength_template": "{label} 강점이 반복적으로 언급되었어요",
    "summary_takeaway_divide_template": "{label}{topic} 사용 환경에 따라 의견이 갈렸어요",
    "summary_takeaway_caution_template": "{label} 관련 호불호 의견이 함께 쌓여 있어요",
    "summary_closing_note": "구매 전 본인 사용 환경 한 가지로 좁혀 보세요",
    # cta — v2.3: locked "save → like → follow → comment" template.
    # The CTA is intentionally near-fixed: the LLM should not reword it
    # creatively per product. SAVE is the primary action, like+follow
    # are pure support actions, comment invites next-product requests.
    # The full headline ("살까 말까 고민될 때 다시 보려면 저장해두세요")
    # is the hero copy on top of the slide; `body` is the explicit save
    # action ("저장해서 구매 전 다시 확인하기").
    "cta_headline_default": "살까 말까 고민될 때 다시 보려면 저장해두세요",
    "cta_body_default": "저장해서 구매 전 다시 확인하기",
    "cta_action_like": "도움 됐다면 좋아요",
    "cta_action_follow": "다음 분석도 보고 싶다면 팔로우",
    "cta_action_comment": "궁금한 제품은 댓글로 남겨주세요",
    # v2.1 — positive spotlight (deep-dive on one loved attribute)
    "positive_spotlight_headline_template": "{label}{topic} 왜 만족 신호가 컸을까",
    "positive_spotlight_count_template": "만족 후기 {n}건",
    "positive_spotlight_what_template": "{label} 관련 만족 후기가 반복적으로 쌓였어요",
    "positive_spotlight_why_template": (
        "이 제품을 고른 사용자들이 가장 자주 짚은 결입니다"
    ),
    "positive_spotlight_who_template": "{label}{topic} 우선 가치로 두고 고르는 분",
    # v2.1 — caution spotlight (deep-dive on one caution attribute)
    "caution_spotlight_headline_template": "{label}{topic} 왜 갈렸을까",
    "caution_spotlight_split_template": "만족 {pos}건 · 호불호 {neg}건",
    "caution_spotlight_context_dual": (
        "사용 환경·기대 사용감에 따라 인상이 갈리는 항목"
    ),
    "caution_spotlight_context_neg": (
        "단일 평균보다 후기 분포로 봐야 정확한 항목"
    ),
    "caution_spotlight_check_template": "{label} 관련 후기를 옵션·환경별로 비교",
    "caution_spotlight_interpretation_dual": (
        "{label} 관련 후기는 만족과 갈림이 함께 쌓였어요. "
        "평균 평점 한 줄보다 본인 사용 환경과 가까운 후기 분포로 읽는 게 더 정확합니다."
    ),
    "caution_spotlight_interpretation_neg": (
        "{label} 관련 호불호 의견이 반복적으로 누적됐어요. "
        "옵션·사용 환경에 따라 인상이 갈릴 수 있는 항목입니다."
    ),
    # v2.1 — insight spotlight (cross-cut buyer-context interpretation)
    "insight_spotlight_headline_template": "{label}{topic} 어떤 결로 갈렸을까",
    "insight_spotlight_signal_template": "리뷰 {total}건에서 반복",
    "insight_spotlight_interpretation_template": (
        "{label} 관련 후기는 사용 환경·기대 사용감 차이에 따라 다르게 읽혔어요. "
        "평균 평점 한 줄보다 본인 사용 맥락과 가까운 후기를 함께 보는 게 정확합니다."
    ),
    "insight_spotlight_who_template": "{label}{topic} 본인 환경 기준으로 정리해 보고 싶은 분",
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
        "methodology_disclosure": (
            (analysis_report.get("methodology_notes") or {}).get("disclosure_ko")
            or _SAFE_DEFAULT_DISCLOSURE_KO
        ),
    }


# ---------------------------------------------------------------------------
# Slug + path helpers
# ---------------------------------------------------------------------------


_GOODS_NO_RE = re.compile(r"[?&]goodsNo=([A-Z0-9]+)")


def product_slug_from_briefing(briefing: dict) -> str:
    """Filesystem-safe slug for the output directory."""
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


def _confidence_label_short(level: str | None) -> str:
    """Map raw confidence_level to a short Korean label for the cover
    micro-text. Kept minimal — the cover footer is 40-char-budget."""
    cl = (level or "").lower()
    return {
        "high": "충분한 표본",
        "medium": "보통 신뢰",
        "low": "초기 신호 단계",
    }.get(cl, "보통 신뢰")


# ---------------------------------------------------------------------------
# v2.4 — Cover hook: controlled-variety composition
# ---------------------------------------------------------------------------
#
# The cover headline is composed from THREE pieces:
#   1) `hook_intent` — the editorial angle the cover takes. Picked from
#      briefing signal shape. 10 possible values.
#   2) `product_angle` — the product axis the headline leads with.
#      Inferred from the chosen attribute's label_ko. 14 possible values.
#   3) `wording_pattern` — one of >=5 patterns registered for the
#      chosen intent. Picked deterministically by hashing the briefing
#      so the same product always gets the same headline, but two
#      products with the same intent get different patterns.
#
# This replaces v2.3's fixed 5-template enum which made every cover
# look like the same post with different product names. The pool is
# closed (defined here) so the LLM never invents headlines — it picks
# (intent, angle, pattern_id) and the planner does the composition.
#
# Safety: every pattern in the pool below MUST be free of banned
# substrings ("사기", "숨긴", "충격", "절대", "진실", medical efficacy
# verbs, etc.). The validator runs after composition as a final guard,
# but patterns are designed to never trip it on their own; substitution
# slots only carry attribute labels (briefing-sourced, neutral by
# construction) and review counts.

# Each pattern is a Python format-string with a stable slot vocabulary:
#   {product}     — short product name (already truncated)
#   {n}           — total review count, comma-formatted
#   {n_pos}       — top positive count
#   {attribute}   — label_ko of the leading attribute
#   {a_topic}     — Korean topic particle for {attribute} (은/는)
#   {positive}    — label_ko of the top positive attribute
#   {p_topic}     — particle for {positive}
#   {caution}     — label_ko of the top caution attribute
#   {c_topic}     — particle for {caution}
#   {axis}        — short axis label (사용 환경 / 피부 타입 / etc.)
#
# Patterns may use a subset of the slots; missing slots aren't
# substituted (caller picks patterns that match the available slots).
_HOOK_WORDING_PATTERNS: dict[str, list[str]] = {
    "divergence": [
        "{product}, {positive}{p_topic} 좋았지만 {caution}{c_topic} 갈렸어요",
        "리뷰 {n}건에서 {attribute}{a_topic} 갈린 이유",
        "{attribute}, 만족과 아쉬움이 함께 쌓인 지점",
        "좋다는 리뷰가 많아도 {attribute}{a_topic} 확인이 필요했어요",
        "{product}의 호불호는 {attribute}에서 가장 자주 나왔어요",
        "{positive}{p_topic} 호평인데, {caution}에서 의견이 나뉘었어요",
    ],
    "expectation_check": [
        "구매 전, {attribute}{a_topic} 먼저 확인하세요",
        "{product} 고를 때 가장 먼저 볼 것은 {attribute}",
        "{attribute}, 구매 전에 점검할 기준이에요",
        "리뷰가 알려주는 {product}의 체크포인트",
        "{attribute}{a_topic} 본인 기준에 맞는지부터 확인",
        "{product}, {attribute} 기대치를 먼저 좁혀 보세요",
    ],
    "routine_fit": [
        "{product}, 어떤 사용 루틴에 잘 맞을까?",
        "매일 쓰는 분에게 {product}{p_topic} 어떻게 읽혔을까",
        "{attribute} 중심 루틴에 들어갈 만한 제품인가",
        "리뷰 {n}건이 보여준 {product}의 사용 루틴",
        "{product}, 본인 루틴에 맞는지 후기로 봤어요",
        "어떤 사용 빈도에서 {product}{p_topic} 자주 손이 가는지",
    ],
    "hidden_condition": [
        "{attribute} 만족도는 사용 환경에 따라 갈렸어요",
        "{product}의 인상은 {axis}에 따라 달라졌어요",
        "같은 {product}, 사용 조건에 따라 다른 평가",
        "{attribute}, 어떤 조건에서 만족도가 달라질까?",
        "{product}의 평가는 {axis}에 따라 다르게 읽혔어요",
        "후기를 읽어 보면 {attribute}{a_topic} 조건마다 다르게 남았어요",
    ],
    "strong_positive": [
        "{product}, 리뷰 {n}건이 짚은 가장 큰 강점은 {positive}",
        "{positive}{p_topic} 리뷰에서 가장 많이 반복됐어요",
        "리뷰가 가장 자주 칭찬한 {product}의 결",
        "{product}의 호평 흐름은 {positive}에서 시작돼요",
        "{positive} 만족 후기 {n_pos}건의 공통점",
        "리뷰 {n}건에서 가장 또렷한 신호, {positive}",
    ],
    "caution_signal": [
        "{product}, 리뷰가 자주 짚은 주의 신호는 {caution}",
        "{caution}{c_topic} 의견이 반복적으로 누적됐어요",
        "{product}의 호불호 신호, {caution}에서 가장 많아요",
        "{caution}{c_topic} 본인 기준에 어떻게 읽힐지 확인하세요",
        "리뷰 {n}건에서 반복된 {product}의 체크포인트",
        "{caution}, 호평과 함께 누적된 의견을 정리했어요",
    ],
    "user_question": [
        "{product}, 사용 전에 가장 많이 묻는 질문은?",
        "{attribute}, 본인 피부에서 어떻게 느껴질까?",
        "{product}는 누구에게 잘 맞는 제품일까?",
        "리뷰만 봐서는 헷갈리는 {product}, 어떻게 골라야 할까?",
        "{product}, 어떤 사용감을 기대해야 할까?",
        "{product} 후기를 보고도 헷갈리는 분을 위한 정리",
    ],
    "data_summary": [
        "리뷰 {n}건에서 반복된 {product}의 장점과 주의점",
        "{n}건의 후기가 보여준 {product}의 결",
        "리뷰 {n}건으로 정리한 {product}의 호평·호불호",
        "{product}, {n}건 후기로 본 사용감 정리",
        "리뷰 {n}건에서 가장 자주 언급된 {product}의 결",
        "{n}건 후기를 한 장으로 정리했어요",
    ],
    "comparison_frame": [
        "기대했던 {attribute}와 실제 사용감이 만난 지점",
        "{attribute}, 기대와 실제 후기 사이의 거리",
        "{product}, 기대 사용감 대비 실제 만족도는?",
        "기대한 {attribute}와 후기로 본 {attribute}는 어떻게 달랐을까",
        "리뷰가 알려주는 {product}의 기대-실제 차이",
        "{product}, 광고 기대와 후기 사이의 거리감",
    ],
    "segment_frame": [
        "{attribute}, 피부 타입에 따라 다르게 읽혔어요",
        "{product}의 만족도, 옵션·환경에 따라 달랐어요",
        "사용 환경에 따라 달라지는 {product}의 인상",
        "{product}, 피부·루틴 차이가 만족도를 갈랐어요",
        "{attribute} 평가, 사용자 조건에 따라 어떻게 달랐을까",
        "같은 {product}, 사용자 결에 따라 다르게 남는 인상",
    ],
}

# Sanity check: every intent in the Literal must have at least 5 patterns.
# Catches drift if someone deletes a pattern row by accident.
for _intent, _patterns in _HOOK_WORDING_PATTERNS.items():
    assert len(_patterns) >= 5, (
        f"intent {_intent!r} has {len(_patterns)} patterns, needs >=5"
    )

# Banned substrings checked against composed headlines. Extra to the
# safety_validator's banned list — these are wording-pattern-specific
# guards (e.g. `사기` would slip into "사기 전" naturally; the
# validator catches it but we want the planner to never produce it).
_HOOK_HEADLINE_BANNED: tuple[str, ...] = (
    "사기", "사지 마세요", "절대", "충격", "진실",
    "숨긴", "광고에 속지", "피부 망가짐", "독한", "독성",
    "효능", "효과를 극대화", "효과가 극대화", "치료", "완치",
)


# Heuristic: map a Korean attribute label to a product_angle slug.
# Used to record `cover.product_angle` for analytics + to inform which
# wording pattern slot is most natural to fill.
def _infer_product_angle(label_ko: str | None) -> str:
    s = (label_ko or "").lower()
    raw = label_ko or ""

    def _has(*tokens: str) -> bool:
        return any(t in raw for t in tokens)

    if _has("향", "냄새"):
        return "scent"
    if _has("자극", "트러블", "민감", "진정", "예민"):
        return "irritation_sensitivity"
    if _has("수분", "건조", "당김"):
        return "moisture"
    if _has("촉촉", "마무리", "발림", "도포", "텍스처", "끈적", "흡수"):
        return "texture_finish"
    if _has("발색", "컬러", "색", "호수", "옵션"):
        return "color_option"
    if _has("가성비", "가격", "값", "할인"):
        return "price_value"
    if _has("용량", "사이즈", "양", "크기", "장 수", "매수"):
        return "size_capacity"
    if _has("용기", "포장", "디자인", "캡", "뚜껑", "집게", "리필", "패키지"):
        return "packaging_container"
    if _has("밀착", "흡수", "스며", "올리브", "도포감"):
        return "adhesion_fit"
    if _has("피부타입", "건성", "지성", "복합성", "민감성", "수부지"):
        return "skin_type"
    if _has("계절", "여름", "겨울", "환경", "온도", "습도"):
        return "season_environment"
    if _has("재구매", "재 구매", "또 살", "리피트"):
        return "repurchase"
    if _has("장기", "오래", "꾸준", "지속 사용"):
        return "long_term_use"
    return "routine"  # safe fallback


# Stable, varied pick from a list. The seed string is hashed so two
# products with the same intent end up at different list indices most
# of the time, while the same product always picks the same index.
def _stable_pick(items: list, seed_str: str) -> object:
    if not items:
        raise ValueError("_stable_pick called with empty list")
    h = int(hashlib.sha256(seed_str.encode("utf-8")).hexdigest()[:12], 16)
    return items[h % len(items)]


def _stable_pick_index(n: int, seed_str: str) -> int:
    if n <= 0:
        return 0
    h = int(hashlib.sha256(seed_str.encode("utf-8")).hexdigest()[:12], 16)
    return h % n


def _select_hook_intent(
    *,
    n_reviews: int,
    strengths: list[dict],
    divides: list[dict],
    cautions: list[dict],
    seed_str: str,
) -> str:
    """Pick a hook_intent from briefing signal shape.

    Returns one of the 10 _HOOK_WORDING_PATTERNS keys. Within each
    signal-shape branch we pick stably from a *menu* of intents — so
    two products with similar shape can still get different intents.
    """
    has_strength = bool(strengths) and (
        strengths[0].get("n_positive", 0) >= SIGNAL_MIN_COUNT * 2
    )
    has_strong_caution = bool(cautions) and (
        cautions[0].get("n_negative", 0) >= SIGNAL_MIN_COUNT * 2
    )
    has_divide = bool(divides) and (
        min(divides[0].get("n_positive", 0), divides[0].get("n_negative", 0))
        >= SIGNAL_MIN_COUNT
    )
    has_caution = bool(cautions) and (
        cautions[0].get("n_negative", 0) >= SIGNAL_MIN_COUNT
    )

    # Each branch lists candidate intents in priority order; the stable
    # picker selects one of them so the same shape can yield different
    # intents across products.
    if has_strength and has_divide:
        menu = ["divergence", "comparison_frame", "hidden_condition"]
    elif has_strong_caution and not has_strength:
        menu = ["expectation_check", "caution_signal", "user_question"]
    elif has_strength and has_caution and not has_divide:
        menu = ["comparison_frame", "expectation_check", "divergence"]
    elif has_divide and not has_strength:
        menu = ["hidden_condition", "segment_frame", "divergence"]
    elif has_strength and not has_caution and not has_divide:
        menu = ["strong_positive", "routine_fit", "data_summary"]
    elif has_caution and not has_strength:
        menu = ["caution_signal", "expectation_check"]
    elif n_reviews >= 200:
        menu = ["data_summary", "user_question"]
    else:
        menu = ["user_question", "data_summary", "routine_fit"]

    return _stable_pick(menu, f"{seed_str}|intent")


def _is_pattern_safe(headline: str) -> bool:
    """Final guard before the safety_validator sees the composed headline.

    Catches the 5 wording-pattern-specific banned substrings so the
    planner can fall back to a different pattern instead of aborting
    the whole run."""
    for term in _HOOK_HEADLINE_BANNED:
        if term in headline:
            return False
    return True


def _compose_cover_headline(
    *,
    intent: str,
    briefing: dict,
    seed_str: str,
) -> tuple[str, int]:
    """Compose a cover headline by filling a wording pattern.

    Returns `(headline, wording_pattern_id)`. The pattern_id is the
    index into `_HOOK_WORDING_PATTERNS[intent]` used; recorded on the
    plan for audit + reproducibility. Falls back across patterns if
    the composed string trips a banned substring."""
    patterns = _HOOK_WORDING_PATTERNS.get(intent) or _HOOK_WORDING_PATTERNS["data_summary"]

    product = _short_product_name(
        (briefing.get("product") or {}).get("name_ko") or ""
    )
    n_reviews = int((briefing.get("corpus") or {}).get("n_reviews_total") or 0)
    n_str = _format_count(n_reviews)
    strengths = briefing.get("top_strengths") or []
    divides = briefing.get("top_divides") or []
    cautions = briefing.get("top_cautions") or []

    positive = strengths[0]["label_ko"] if strengths else ""
    p_topic = _ko_topic_particle(positive) if positive else "은"
    n_pos = strengths[0].get("n_positive", 0) if strengths else 0

    # Choose the leading attribute (the {attribute} slot). For
    # divergence/expectation_check/hidden_condition prefer the divide;
    # for caution_signal prefer the caution; for strong_positive prefer
    # the strength; otherwise prefer the most-discussed attribute.
    if intent in ("divergence", "hidden_condition", "comparison_frame", "segment_frame"):
        attr_pool = divides or cautions or strengths
    elif intent in ("expectation_check", "caution_signal"):
        attr_pool = cautions or divides or strengths
    elif intent == "strong_positive":
        attr_pool = strengths or divides or cautions
    else:
        attr_pool = strengths or divides or cautions
    attribute = attr_pool[0]["label_ko"] if attr_pool else (positive or "사용감")
    a_topic = _ko_topic_particle(attribute)

    caution = cautions[0]["label_ko"] if cautions else ""
    c_topic = _ko_topic_particle(caution) if caution else "은"

    axis_pool = ["사용 환경", "피부 타입", "사용 빈도", "기대 사용감"]
    axis = _stable_pick(axis_pool, f"{seed_str}|axis")

    slots = {
        "product": product,
        "n": n_str,
        "n_pos": n_pos,
        "attribute": attribute,
        "a_topic": a_topic,
        "positive": positive,
        "p_topic": p_topic,
        "caution": caution,
        "c_topic": c_topic,
        "axis": axis,
    }

    # Stable starting index, then walk the pool until we hit one that
    # composes safely AND fits the budget.
    start = _stable_pick_index(len(patterns), f"{seed_str}|pattern")
    for offset in range(len(patterns)):
        idx = (start + offset) % len(patterns)
        pat = patterns[idx]
        try:
            headline = pat.format(**slots)
        except KeyError:
            # Pattern referenced a slot we don't have; skip.
            continue
        # Reject if any required slot expanded to empty (e.g. {caution}
        # with no caution → "" produces awkward sentences).
        if "{" in headline or "}" in headline:
            continue
        if not _is_pattern_safe(headline):
            continue
        if len(headline) > HEADLINE_MAX:
            # Try truncation; if it still has banned, skip.
            cand = _truncate(headline, HEADLINE_MAX)
            if _is_pattern_safe(cand):
                return cand, idx
            continue
        return headline, idx

    # Pool exhausted — emit a maximally-safe fallback.
    fallback = (
        f"리뷰 {n_str}건에서 반복된 {product}의 결" if product
        else f"리뷰 {n_str}건에서 반복된 신호"
    )
    return _truncate(fallback, HEADLINE_MAX), 0


def _build_mock_cover(briefing: dict) -> dict:
    product = briefing["product"]
    short_name = _short_product_name(product.get("name_ko") or "")
    n = briefing["corpus"]["n_reviews_total"]
    confidence_short = _confidence_label_short(
        briefing["corpus"]["confidence_level"]
    )
    strengths = briefing.get("top_strengths") or []
    divides = briefing.get("top_divides") or []
    cautions = briefing.get("top_cautions") or []

    s_label = strengths[0]["label_ko"] if strengths else None

    # v2.4 — controlled-variety cover hook composition.
    # Build a stable seed from the product+corpus so the same product
    # always produces the same headline, but different products with
    # similar signal shape end up at different (intent, pattern) picks.
    seed_str = "|".join([
        product.get("slug") or "",
        product.get("name_ko") or "",
        str(n),
        s_label or "",
        (divides[0]["label_ko"] if divides else ""),
        (cautions[0]["label_ko"] if cautions else ""),
    ])

    hook_intent = _select_hook_intent(
        n_reviews=n,
        strengths=strengths,
        divides=divides,
        cautions=cautions,
        seed_str=seed_str,
    )

    headline, wording_pattern_id = _compose_cover_headline(
        intent=hook_intent,
        briefing=briefing,
        seed_str=seed_str,
    )

    # Pick the leading attribute label that drove the headline so we
    # can record its inferred product_angle.
    if hook_intent in ("expectation_check", "caution_signal"):
        leading_attr = (cautions[0]["label_ko"] if cautions else s_label) or ""
    elif hook_intent in ("divergence", "hidden_condition", "comparison_frame", "segment_frame"):
        leading_attr = (divides[0]["label_ko"] if divides else (cautions[0]["label_ko"] if cautions else s_label)) or ""
    else:
        leading_attr = s_label or (divides[0]["label_ko"] if divides else "")
    product_angle = _infer_product_angle(leading_attr)

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

    if n > 0:
        corpus_footer = _NEUTRAL["cover_corpus_footer_template"].format(
            n=_format_count(n), confidence=confidence_short,
        )
    else:
        corpus_footer = "리뷰 표본 형성 단계"
    corpus_footer = _truncate(corpus_footer, CORPUS_FOOTER_MAX)

    return {
        "headline": headline,
        "subline": subline,
        "chips": chips,
        "corpus_footer": corpus_footer,
        "hook_intent": hook_intent,
        "product_angle": product_angle,
        "wording_pattern_id": wording_pattern_id,
    }


def _build_mock_one_liner(briefing: dict) -> dict:
    """v2.0 — single rhythmic sentence. Replaces the v1.x hook page
    (metric pills + lead + bullets). Cover footer carries the corpus
    stats now; this slide is text-only."""
    n = briefing["corpus"]["n_reviews_total"]
    strengths = briefing.get("top_strengths") or []
    divides = briefing.get("top_divides") or []
    cautions = briefing.get("top_cautions") or []

    s_label = strengths[0]["label_ko"] if strengths else None
    d_label = None
    for d in divides:
        if d["label_ko"] != s_label:
            d_label = d["label_ko"]
            break
    if d_label is None and divides:
        d_label = divides[0]["label_ko"]

    if s_label and d_label:
        headline = _NEUTRAL["one_liner_dual"].format(
            strength=s_label, s_topic=_ko_topic_particle(s_label),
            divide=d_label, d_topic=_ko_topic_particle(d_label),
        )
        framing = _NEUTRAL["one_liner_framing_dual"]
    elif s_label:
        headline = _NEUTRAL["one_liner_pos"].format(
            strength=s_label, s_topic=_ko_topic_particle(s_label),
        )
        framing = _NEUTRAL["one_liner_framing_pos"]
    elif cautions:
        c_label = cautions[0]["label_ko"]
        headline = _NEUTRAL["one_liner_neg"].format(
            caution=c_label, c_topic=_ko_topic_particle(c_label),
        )
        framing = _NEUTRAL["one_liner_framing_neg"]
    else:
        headline = _NEUTRAL["one_liner_thin"]
        framing = _NEUTRAL["one_liner_framing_thin"]

    headline = _truncate(headline, ONE_LINER_MAX)

    if n > 0:
        sub = _NEUTRAL["one_liner_sub_template"].format(n=_format_count(n))
    else:
        sub = _NEUTRAL["one_liner_sub_thin"]
    sub = _truncate(sub, NOTE_MAX)

    # v2.2 — derive metric pills from the briefing. Mock builds a
    # 2–3 short anchor row; LLM-mode prompt offers the same pattern
    # but lets the model swap in product-specific metrics.
    pills: list[str] = []
    if n > 0:
        pills.append(_truncate(f"리뷰 {_format_count(n)}건", METRIC_VALUE_MAX))
    top_pos_n = max((int(s.get("n_positive") or 0) for s in strengths), default=0)
    if top_pos_n > 0:
        pills.append(_truncate(f"호평 {top_pos_n}건", METRIC_VALUE_MAX))
    top_caution_n = max((int(c.get("n_negative") or 0) for c in cautions), default=0)
    if top_caution_n > 0:
        pills.append(_truncate(f"갈림 {top_caution_n}건", METRIC_VALUE_MAX))
    pills = pills[:3]

    return {
        "headline": headline,
        "sub": sub,
        "metric_pills": pills or None,
        "framing_note": _truncate(framing, SUBLINE_MAX),
    }


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
        "headline": _truncate(_NEUTRAL["loved_headline"], HEADLINE_MAX),
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
        "headline": _truncate(_NEUTRAL["divides_headline"], HEADLINE_MAX),
        "items": items,
    }


def _build_mock_why_divides(briefing: dict) -> dict | None:
    """v2.0 — interpretation of why the top divide split.

    Returns None when no dual-polarity attribute exists. The user
    contract is "no empty/generic-advice slides" — when there's no
    actual divide to interpret, the section is dropped from the
    carousel entirely."""
    divides = briefing.get("top_divides") or []
    if not divides:
        return None
    top = divides[0]
    label = top["label_ko"]

    headline = _NEUTRAL["why_divides_headline_template"].format(label=label)
    headline = _truncate(headline, HEADLINE_MAX)

    # Three neutral axes; mock can't infer which actually applies, so
    # we ship all three and let the LLM (semantic pass) trim/specialize.
    axes = [
        _truncate(_NEUTRAL["why_axis_environment"], AXIS_MAX),
        _truncate(_NEUTRAL["why_axis_skin_type"], AXIS_MAX),
        _truncate(_NEUTRAL["why_axis_expectation"], AXIS_MAX),
    ]
    # v2.2 — paired one-line "why" per axis. Same length as `axes`.
    axis_whys = [
        _truncate(_NEUTRAL["why_axis_why_environment"], ASIDE_MAX),
        _truncate(_NEUTRAL["why_axis_why_skin_type"], ASIDE_MAX),
        _truncate(_NEUTRAL["why_axis_why_expectation"], ASIDE_MAX),
    ]

    return {
        "attribute_key": top["key"],
        "headline": headline,
        "axes": axes,
        "axis_whys": axis_whys,
        "note": _truncate(_NEUTRAL["why_divides_note"], NOTE_MAX),
    }


def _build_mock_signature(briefing: dict) -> dict:
    cands = briefing.get("signature_candidates") or []
    if not cands:
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
                "who_should_check": (
                    "추가 리뷰가 모인 뒤 다시 살펴보고 싶은 분"
                ),
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
                f"{label} 관련 후기를 추가로 찾아보는 분", ASIDE_MAX,
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
        headline = _NEUTRAL["signature_headline_pos"].format(
            label=label, topic=topic,
        )
        lead = _NEUTRAL["signature_lead_pos"].format(label=label)
        why = _NEUTRAL["signature_why_pos"]
        who = _NEUTRAL["signature_who_pos"].format(label=label, topic=topic)
    else:
        headline = _NEUTRAL["signature_headline_neg"].format(
            label=label, topic=topic,
        )
        lead = _NEUTRAL["signature_lead_neg"].format(label=label)
        why = _NEUTRAL["signature_why_neg"]
        who = _NEUTRAL["signature_who_neg"].format(label=label, topic=topic)

    return {
        "attribute_key": pick["key"],
        "title": _truncate(label, TITLE_MAX),
        "headline": _truncate(headline, HEADLINE_MAX),
        "lead": _truncate(lead, LEAD_MAX),
        "why_it_matters": _truncate(why, ASIDE_MAX),
        "who_should_check": _truncate_persona_label(
            who, ASIDE_MAX,
            fallback="본인 사용 환경 후기를 한 번 더 확인하는 분",
        ),
    }


def _build_mock_checkpoints(
    briefing: dict, *, skip_keys: frozenset[str],
) -> dict | None:
    """v2.0–v2.2 — emit 1..2 checkpoint slides driven by product-specific
    cautions. Returns None when no caution clears SIGNAL_MIN_COUNT;
    NEVER pads with corpus-generic advice (per user contract).
    v2.2 — cap dropped from 3 to 2 to lift information density per page.

    `skip_keys` covers any attribute_keys already consumed by signature
    or caution_spotlights so the carousel never deep-dives the same
    attribute twice (signature → quick checkpoint, or spotlight →
    quick checkpoint — both are noisy repetition).

    Layout consumes `slides` and emits ONE PAGE per slide (one focused
    message per page)."""
    cautions = briefing.get("top_cautions") or []
    attrs_by_key = {a["key"]: a for a in (briefing.get("attributes") or [])}

    slides: list[dict] = []
    for c in cautions:
        if c["key"] in skip_keys:
            continue
        if c["n_negative"] < SIGNAL_MIN_COUNT:
            continue
        a = attrs_by_key.get(c["key"]) or c
        n_pos = a.get("n_positive", 0)
        is_dual = n_pos >= SIGNAL_MIN_COUNT
        label = c["label_ko"]
        slides.append({
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
            "who_note": _truncate_persona_label(
                _NEUTRAL["checkpoint_who_dual"] if is_dual
                else _NEUTRAL["checkpoint_who_neg"].format(label=label),
                NOTE_MAX,
                fallback="본인 사용 환경 후기를 비교하는 분",
            ),
        })
        if len(slides) >= 2:
            break

    if not slides:
        return None
    return {"slides": slides}


def _build_mock_positive_spotlights(
    briefing: dict, *, max_items: int = POSITIVE_SPOTLIGHT_MAX,
) -> list[dict] | None:
    """0..3 deep-dive pages on top loved attributes.

    Threshold: n_positive ≥ POSITIVE_SPOTLIGHT_MIN. Returns None when
    nothing clears the threshold (NOT an empty list — `None` keeps the
    section absent from the rendered carousel)."""
    strengths = [
        s for s in (briefing.get("top_strengths") or [])
        if s["n_positive"] >= POSITIVE_SPOTLIGHT_MIN
    ]
    if not strengths:
        return None

    items: list[dict] = []
    for s in strengths[:max_items]:
        label = s["label_ko"]
        topic = _ko_topic_particle(label)
        items.append({
            "attribute_key": s["key"],
            "headline": _truncate(
                _NEUTRAL["positive_spotlight_headline_template"].format(
                    label=label, topic=topic,
                ),
                HEADLINE_MAX,
            ),
            "count": _truncate(
                _NEUTRAL["positive_spotlight_count_template"].format(
                    n=s["n_positive"],
                ),
                COUNT_MAX,
            ),
            "what_reviewers_liked": _truncate(
                _NEUTRAL["positive_spotlight_what_template"].format(
                    label=label,
                ),
                NOTE_MAX,
            ),
            "why_it_matters": _truncate(
                _NEUTRAL["positive_spotlight_why_template"], ASIDE_MAX,
            ),
            "who_benefits": _truncate(
                _NEUTRAL["positive_spotlight_who_template"].format(
                    label=label, topic=topic,
                ),
                ASIDE_MAX,
            ),
        })
    return items or None


def _build_mock_caution_spotlights(
    briefing: dict, *, skip_keys: frozenset[str], max_items: int = CAUTION_SPOTLIGHT_MAX,
) -> tuple[list[dict] | None, frozenset[str]]:
    """0..4 deep-dive pages on top caution attributes.

    Returns (items, used_keys). `used_keys` is the set of attribute_keys
    consumed so the layout / mock_checkpoints can avoid repeating them.
    Threshold: n_negative ≥ CAUTION_SPOTLIGHT_MIN."""
    cautions = [
        c for c in (briefing.get("top_cautions") or [])
        if c["key"] not in skip_keys
        and c["n_negative"] >= CAUTION_SPOTLIGHT_MIN
    ]
    if not cautions:
        return None, frozenset()

    attrs_by_key = {a["key"]: a for a in (briefing.get("attributes") or [])}
    items: list[dict] = []
    used: set[str] = set()
    for c in cautions[:max_items]:
        a = attrs_by_key.get(c["key"]) or c
        n_pos = int(a.get("n_positive") or 0)
        n_neg = int(c["n_negative"])
        is_dual = n_pos >= SIGNAL_MIN_COUNT
        label = c["label_ko"]
        topic = _ko_topic_particle(label)
        items.append({
            "attribute_key": c["key"],
            "headline": _truncate(
                _NEUTRAL["caution_spotlight_headline_template"].format(
                    label=label, topic=topic,
                ),
                HEADLINE_MAX,
            ),
            "split_signal": _truncate(
                _NEUTRAL["caution_spotlight_split_template"].format(
                    pos=n_pos, neg=n_neg,
                ),
                COUNT_MAX,
            ),
            "likely_context": _truncate(
                _NEUTRAL["caution_spotlight_context_dual"] if is_dual
                else _NEUTRAL["caution_spotlight_context_neg"],
                ASIDE_MAX,
            ),
            "check_before_buy": _truncate(
                _NEUTRAL["caution_spotlight_check_template"].format(
                    label=label,
                ),
                ASIDE_MAX,
            ),
            "interpretation": _truncate(
                (
                    _NEUTRAL["caution_spotlight_interpretation_dual"]
                    if is_dual
                    else _NEUTRAL["caution_spotlight_interpretation_neg"]
                ).format(label=label),
                LEAD_MAX,
            ),
        })
        used.add(c["key"])
    return (items or None), frozenset(used)


def _build_mock_insight_spotlights(
    briefing: dict, *, skip_keys: frozenset[str],
    max_items: int = INSIGHT_SPOTLIGHT_MAX,
) -> list[dict] | None:
    """0..3 cross-cut interpretation pages on dual-polarity attributes.

    Picked from `top_divides` (skipping any key already used by
    why_divides / caution_spotlights so the carousel doesn't repeat
    the same attribute under different labels). Threshold:
    min(n_pos, n_neg) ≥ INSIGHT_SPOTLIGHT_MINORITY_MIN."""
    divides = briefing.get("top_divides") or []
    eligible = [
        d for d in divides
        if d["key"] not in skip_keys
        and min(d["n_positive"], d["n_negative"]) >= INSIGHT_SPOTLIGHT_MINORITY_MIN
    ]
    if not eligible:
        return None

    items: list[dict] = []
    for d in eligible[:max_items]:
        label = d["label_ko"]
        topic = _ko_topic_particle(label)
        total = d["n_positive"] + d["n_negative"]
        items.append({
            "headline": _truncate(
                _NEUTRAL["insight_spotlight_headline_template"].format(
                    label=label, topic=topic,
                ),
                HEADLINE_MAX,
            ),
            "signal_count": _truncate(
                _NEUTRAL["insight_spotlight_signal_template"].format(
                    total=total,
                ),
                COUNT_MAX,
            ),
            "interpretation": _truncate(
                _NEUTRAL["insight_spotlight_interpretation_template"].format(
                    label=label,
                ),
                LEAD_MAX,
            ),
            "who_should_check": _truncate(
                _NEUTRAL["insight_spotlight_who_template"].format(
                    label=label, topic=topic,
                ),
                ASIDE_MAX,
            ),
        })
    return items or None


def _build_mock_fit(briefing: dict) -> dict:
    """잘 맞는 분 — buyer-profile sentences (≥2).

    v2.3 — each item now carries `signal_hint` (≤BULLET_MAX chars) so
    the rendered card shows `[상황/루틴] + [근거 signal]`. The label
    captures the routine/buying-trigger and signal_hint surfaces *why*
    that profile was identified (the loved attribute that supports it)."""
    strengths = briefing.get("top_strengths") or []

    # Pad to schema-required minimum (2). These fallbacks are about
    # the carousel posture ("추가 후기를 비교해 결정하는 분"), not
    # invented product claims, and end in 분 by construction.
    _FIT_FALLBACK = [
        {"label": "리뷰 패턴을 먼저 살펴보고 싶은 분",
         "note": "표본 누적 후 재정리 권장",
         "signal_hint": "전체 리뷰 흐름을 먼저 보는 게 정확"},
        {"label": "다른 후기와 비교해 결정하는 분",
         "note": "추가 후기 확인 권장",
         "signal_hint": "옵션·사용 환경별 후기 비교 추천"},
    ]

    items: list[dict] = []
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
        fallback = _FIT_FALLBACK[i % len(_FIT_FALLBACK)]["label"]
        items.append({
            "label": _truncate_persona_label(
                primary, LABEL_MAX, fallback=fallback,
            ),
            "note": _truncate(f"만족 후기 {s['n_positive']}건", COUNT_MAX),
            "signal_hint": _truncate(
                f"{label} 관련 만족 후기가 반복", BULLET_MAX,
            ),
        })

    fb = 0
    while len(items) < 2 and fb < len(_FIT_FALLBACK):
        items.append(dict(_FIT_FALLBACK[fb]))
        fb += 1

    return {
        "headline": _truncate(_NEUTRAL["fit_headline"], HEADLINE_MAX),
        "items": items,
    }


def _truncate_persona_label(
    primary: str, max_chars: int, *, fallback: str,
) -> str:
    """Truncate a buyer-profile label that MUST end in '분'.

    `_truncate` (cardnews_generator) cuts at `max_chars - 1` and
    appends '…', which strips the trailing '분' and breaks
    schema validators (`_ends_with_bun`). For these labels we
    prefer dropping leading tokens (the per-attribute prefix) so
    the persona suffix survives. If even the suffix-only form
    won't fit, we fall back to the curated string.
    """
    s = (primary or "").strip()
    if len(s) <= max_chars and s.endswith("분"):
        return s
    if not s.endswith("분"):
        return fallback.strip()
    tokens = s.split(" ")
    while len(tokens) > 2:
        tokens = tokens[1:]
        candidate = " ".join(tokens)
        if len(candidate) <= max_chars and candidate.endswith("분"):
            return candidate
    return fallback.strip()


def _build_mock_consider(briefing: dict) -> dict:
    """신중하게 볼 분 — concrete buyer-profile sentences (≥2).

    v2.3 — each item now carries `signal_hint` (≤BULLET_MAX chars) so
    the rendered card shows `[민감한 기준] + [확인할 리뷰 키워드]`.
    The label captures the discomfort the buyer wants to avoid; the
    signal_hint names the review keywords / search terms they should
    check before buying."""
    cautions = briefing.get("top_cautions") or []

    _CONSIDER_FALLBACK = [
        {"label": "옵션·환경별 후기 차이가 큰 카테고리에 민감한 분",
         "note": "후기 환경 비교 권장",
         "signal_hint": "후기에서 옵션·환경별 차이 키워드 확인"},
        {"label": "초기 신호 단계 제품을 신중하게 보는 분",
         "note": "표본 누적 후 재검토",
         "signal_hint": "리뷰 표본이 더 쌓인 뒤 다시 확인 권장"},
    ]

    items: list[dict] = []
    for i, c in enumerate(cautions[:3]):
        label = c["label_ko"]
        topic = _ko_topic_particle(label)
        tpl = (
            _NEUTRAL["consider_template"] if i == 0
            else _NEUTRAL["consider_template_alt"]
        )
        primary = tpl.format(label=label, topic=topic)
        keyword_pool = [tok.strip() for tok in label.split("/") if tok.strip()]
        keyword_pool = [k for k in keyword_pool if k][:2]
        if keyword_pool:
            keyword_str = " · ".join(f"'{k}'" for k in keyword_pool)
            hint = f"후기에서 {keyword_str} 키워드 확인"
        else:
            hint = f"후기에서 '{label}' 키워드 확인"
        fallback = _CONSIDER_FALLBACK[i % len(_CONSIDER_FALLBACK)]["label"]
        items.append({
            "label": _truncate_persona_label(
                primary, LABEL_MAX, fallback=fallback,
            ),
            "note": _truncate(f"호불호 {c['n_negative']}건", COUNT_MAX),
            "signal_hint": _truncate(hint, BULLET_MAX),
        })

    fb = 0
    while len(items) < 2 and fb < len(_CONSIDER_FALLBACK):
        items.append(dict(_CONSIDER_FALLBACK[fb]))
        fb += 1

    return {
        "headline": _truncate(_NEUTRAL["consider_headline"], HEADLINE_MAX),
        "items": items,
    }


def _build_mock_summary(briefing: dict) -> dict:
    """v2.3 — 한 장 정리 as judgment frame.

    Three slots, in order:
      * `one_liner_conclusion` (NEW) — single-sentence final read of
        the corpus, synthesizing the strongest combined signal.
      * `takeaways` (REPURPOSED) — 2..3 "구매 전 볼 것" pre-purchase
        check questions. NOT a restatement of prior pages.
      * `closing_note` (REPURPOSED) — judgment-prompting sentence,
        not a verdict (e.g. "본인 사용 환경 한 가지로 좁혀 보세요").

    Mock builds each slot from the briefing's signal shape so the
    summary reads as a final-decision frame regardless of product."""
    strengths = briefing.get("top_strengths") or []
    divides = briefing.get("top_divides") or []
    cautions = briefing.get("top_cautions") or []

    # ---- one_liner_conclusion (한 줄 결론) -----------------------------
    s_label = strengths[0]["label_ko"] if strengths else None

    def _pick_distinct(pool: list[dict], skip: str | None) -> str | None:
        for entry in pool:
            label = entry.get("label_ko")
            if label and label != skip:
                return label
        return pool[0].get("label_ko") if pool else None

    if strengths and (divides or cautions):
        rhs = _pick_distinct(divides, s_label) or _pick_distinct(
            cautions, s_label,
        )
        if rhs is None:
            rhs = (divides[0] if divides else cautions[0])["label_ko"]
        rhs_topic = _ko_topic_particle(rhs)
        conclusion = (
            f"{s_label}{_ko_topic_particle(s_label)} 분명한 장점이지만, "
            f"{rhs}{rhs_topic} 사용 환경에 따라 확인이 필요해요"
        )
    elif strengths:
        s_label = strengths[0]["label_ko"]
        conclusion = (
            f"{s_label}{_ko_topic_particle(s_label)} "
            "리뷰에서 가장 자주 반복된 장점이에요"
        )
    elif cautions:
        c_label = cautions[0]["label_ko"]
        conclusion = (
            f"{c_label}{_ko_topic_particle(c_label)} "
            "구매 전 가장 먼저 확인할 부분이에요"
        )
    else:
        conclusion = "리뷰가 더 쌓이면 신호가 또렷해질 단계예요"
    conclusion = _truncate(conclusion, TAKEAWAY_MAX)

    # ---- takeaways = 구매 전 볼 것 3가지 (pre-purchase check questions) ----
    # Each line is a question framed as "X인지" so the reader can
    # apply it directly. Built from briefing signals so the questions
    # tie back to real corpus signals (not generic advice).
    checks: list[str] = []
    used_labels: set[str] = set()
    if strengths:
        s_label = strengths[0]["label_ko"]
        checks.append(_truncate(
            f"{s_label}{_ko_topic_particle(s_label)} 본인에게 중요한지",
            TAKEAWAY_MAX,
        ))
        used_labels.add(s_label)

    # Pass `s_label` so the divide-line surfaces a *different* attribute
    # than the strength check (otherwise we'd repeat the same label
    # across rows when top_strengths[0] == top_divides[0]).
    divide_label = _pick_distinct(divides, s_label)
    if divide_label and divide_label not in used_labels:
        checks.append(_truncate(
            f"{divide_label} 기준이 본인과 맞는지",
            TAKEAWAY_MAX,
        ))
        used_labels.add(divide_label)
    elif cautions:
        c_label = _pick_distinct(cautions, None)
        if c_label and c_label not in used_labels:
            checks.append(_truncate(
                f"{c_label} 관련 후기를 받아들일 수 있는지",
                TAKEAWAY_MAX,
            ))
            used_labels.add(c_label)

    if cautions and len(checks) < 3:
        # Try to surface a *second* caution label not already used.
        for entry in cautions:
            label = entry.get("label_ko")
            if label and label not in used_labels:
                checks.append(_truncate(
                    f"{label} 호불호를 감수할 의향이 있는지",
                    TAKEAWAY_MAX,
                ))
                used_labels.add(label)
                break
    # Always include the routine-fit question — it's the most
    # universal pre-purchase check question.
    while len(checks) < 3:
        if len(checks) == 0:
            checks.append(_truncate(
                "본인 사용 루틴에 들어맞는 제품인지", TAKEAWAY_MAX,
            ))
        elif len(checks) == 1:
            checks.append(_truncate(
                "한 번 사면 끝까지 쓸 수 있을지", TAKEAWAY_MAX,
            ))
        else:
            checks.append(_truncate(
                "추가 후기를 더 비교할 필요가 있는지", TAKEAWAY_MAX,
            ))

    return {
        "headline": _truncate(_NEUTRAL["summary_headline"], HEADLINE_MAX),
        "one_liner_conclusion": conclusion,
        "takeaways": checks[:3],
        "closing_note": _truncate(
            _NEUTRAL["summary_closing_note"], CLOSING_NOTE_MAX,
        ),
    }


def _build_mock_cta(briefing: dict) -> dict:
    """v2.3 — locked save-primary CTA + 3 supporting actions.

    The CTA is near-fixed across products: the LLM should not reword
    it creatively. SAVE is the primary action; the support row is
    a fixed "좋아요 / 팔로우 / 댓글" triplet so the call-to-action
    pattern stays consistent across the cardnews series.

    `disclosure` is the only slot that may legitimately vary per
    product (methodology disclaimer absorbed from the analysis_report
    or a safe default)."""
    disclosure = (
        briefing.get("methodology_disclosure")
        or _SAFE_DEFAULT_DISCLOSURE_KO
    )
    return {
        "type": "save_for_later",
        "headline": _truncate(
            _NEUTRAL["cta_headline_default"], HEADLINE_MAX,
        ),
        "body": _truncate(
            _NEUTRAL["cta_body_default"], BULLET_MAX + 20,
        ),
        # v2.3 — 3-row support strip (like / follow / comment).
        "actions": [
            _truncate(_NEUTRAL["cta_action_like"], ASIDE_MAX),
            _truncate(_NEUTRAL["cta_action_follow"], ASIDE_MAX),
            _truncate(_NEUTRAL["cta_action_comment"], ASIDE_MAX),
        ],
        "disclosure": _truncate(disclosure, DISCLOSURE_MAX),
    }


def build_mock_plan(briefing: dict) -> dict:
    """Deterministic mock content_plan_ko (v2.1).

    Output shape matches `ContentPlan`. Varies structurally across
    products based on:
      * n_reviews
      * number of attributes that clear SIGNAL_MIN_COUNT
      * signature winner's polarity shape (dual / positive / negative)
      * presence/absence of cautions (drives checkpoints + caution
        spotlights presence)
      * presence/absence of divides (drives why_divides + insight
        spotlights presence)
      * strength of top loved attrs (drives positive spotlights)
    """
    sig = _build_mock_signature(briefing)
    sig_key = sig["attribute_key"]
    why_divides = _build_mock_why_divides(briefing)
    why_divides_key = (why_divides or {}).get("attribute_key") or ""

    positive_spotlights = _build_mock_positive_spotlights(briefing)

    # Caution spotlights skip the signature attribute (so the same
    # caution doesn't get deep-dived twice when signature is negative).
    caution_spotlights, caution_spot_keys = _build_mock_caution_spotlights(
        briefing, skip_keys=frozenset({sig_key}),
    )

    # Insight spotlights skip the why_divides attribute and any
    # caution_spotlight attributes (avoid talking about the same
    # cluster from a third angle).
    insight_skip = frozenset({why_divides_key}) | caution_spot_keys
    insight_spotlights = _build_mock_insight_spotlights(
        briefing, skip_keys=insight_skip,
    )

    # Checkpoints get the cautions NOT already covered by spotlight,
    # plus the signature attribute is excluded too.
    checkpoint_skip = frozenset({sig_key}) | caution_spot_keys

    plan: dict[str, Any] = {
        "schema_version": "2.2",
        "language": "ko",
        "cover": _build_mock_cover(briefing),
        "one_liner": _build_mock_one_liner(briefing),
        "loved": _build_mock_loved(briefing),
        "positive_spotlights": positive_spotlights,
        "divides": _build_mock_divides(briefing),
        "why_divides": why_divides,
        "caution_spotlights": caution_spotlights,
        "insight_spotlights": insight_spotlights,
        "signature": sig,
        "checkpoints": _build_mock_checkpoints(
            briefing, skip_keys=checkpoint_skip,
        ),
        "fit": _build_mock_fit(briefing),
        "consider": _build_mock_consider(briefing),
        "summary": _build_mock_summary(briefing),
        "cta": _build_mock_cta(briefing),
    }
    return plan


# ---------------------------------------------------------------------------
# Post-processing — lock CTA + summary to canonical templates (v2.3)
# ---------------------------------------------------------------------------


def _lock_cta_to_canonical(plan: dict, briefing: dict) -> dict:
    """Force CTA to the locked template regardless of source.

    The CTA is a brand-contract surface — `저장 → 좋아요 → 팔로우 →
    댓글` is the same on every cardnews so the call-to-action pattern
    stays consistent across the series. The LLM should never reword
    these creatively per product. Disclosure is the only field that
    legitimately varies (per analysis_report methodology).

    This runs before validation so both mock-mode (already canonical,
    no-op) and LLM-mode plans converge on the same locked CTA."""
    cta = plan.get("cta")
    if not isinstance(cta, dict):
        return plan
    disclosure = (
        cta.get("disclosure")
        or briefing.get("methodology_disclosure")
        or _SAFE_DEFAULT_DISCLOSURE_KO
    )
    plan["cta"] = {
        "type": "save_for_later",
        "headline": _truncate(_NEUTRAL["cta_headline_default"], HEADLINE_MAX),
        "body": _truncate(_NEUTRAL["cta_body_default"], BULLET_MAX + 20),
        "actions": [
            _truncate(_NEUTRAL["cta_action_like"], ASIDE_MAX),
            _truncate(_NEUTRAL["cta_action_follow"], ASIDE_MAX),
            _truncate(_NEUTRAL["cta_action_comment"], ASIDE_MAX),
        ],
        "disclosure": _truncate(disclosure, DISCLOSURE_MAX),
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
    """Produce a validated content_plan_ko dict (v2.0).

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
        When the produced plan trips the safety contract.
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
        # Lazy import — sanitizer is LLM-only; mock-mode never needs it.
        from src.voc.content.safety_sanitizer import (
            sanitize_content_plan,
            write_sanitize_artifacts,
        )
        raw_plan: dict | None = None
        sanitized_plan: dict | None = None
        sanitize_report = None
        try:
            raw_plan = _build_llm_plan(
                briefing,
                llm_client=llm_client,
                raw_dump_dir=raw_dump_dir,
            )
            # v2.2.2 — pre-validation sanitizer pass. Swaps the five
            # high-leak hype tokens (`미쳤어요` / `인생템` / `무조건`
            # / `최악` / `독한`) for safe paraphrases. Medical/efficacy
            # tokens are FLAGGED but not replaced — the safety
            # validator below still aborts on those. The sanitizer is
            # a retry-rate optimization, not a safety bypass.
            # v2.3 — lock CTA to canonical template before sanitize/validate.
            # The CTA is a brand-contract surface; the LLM should not
            # reword it per product.
            raw_plan = _lock_cta_to_canonical(raw_plan, briefing)
            sanitized_plan, sanitize_report = sanitize_content_plan(raw_plan)
            if sanitize_report.has_changes() and raw_dump_dir is not None:
                write_sanitize_artifacts(
                    raw_plan=raw_plan,
                    sanitized_plan=sanitized_plan,
                    report=sanitize_report,
                    out_dir=raw_dump_dir,
                )
                _LOG.info(
                    "sanitize_content_plan: %d hype-token replacements, "
                    "%d medical/efficacy flags — artifacts in %s",
                    sanitize_report.total_replacements(),
                    len(sanitize_report.flagged_unsafe),
                    raw_dump_dir,
                )
            validated = ContentPlan.model_validate(sanitized_plan)
            plan_dict = validated.model_dump(mode="json")
            validate_content_plan_safety(plan_dict)
            return plan_dict
        except (CardnewsPlannerError, ValidationError, CardnewsSafetyError) as e:
            # On validation/safety failure, persist the sanitizer
            # artifacts (if we got that far) so the operator can diff
            # raw vs sanitized vs the field that tripped the contract.
            if (
                raw_dump_dir is not None
                and raw_plan is not None
                and sanitized_plan is not None
                and sanitize_report is not None
            ):
                write_sanitize_artifacts(
                    raw_plan=raw_plan,
                    sanitized_plan=sanitized_plan,
                    report=sanitize_report,
                    out_dir=raw_dump_dir,
                )
            if not allow_mock_fallback:
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

    raw_plan = build_mock_plan(briefing)
    # v2.3 — same lock for mock-mode (no-op since mock already produces
    # canonical CTA, but keeping the call here means future mock changes
    # can't drift the CTA away from the locked template).
    raw_plan = _lock_cta_to_canonical(raw_plan, briefing)
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

    Note: the cardnews v1 end-to-end skill prefers the canonical
    run-package path derived by `default_plan_path_for_report` below
    when the report sits under `outputs/content_packages/<run>/shared/`.
    This function is the legacy fallback for off-pattern reports."""
    if base is None:
        base = Path.cwd() / "outputs" / "content"
    if "signature_candidates" in briefing_or_report:
        briefing = briefing_or_report
    else:
        briefing = build_briefing(briefing_or_report)
    return Path(base) / product_slug_from_briefing(briefing) / "ko"


def default_plan_path_for_report(
    report_path: Path, *, lang: str = "ko",
) -> Path | None:
    """Derive `outputs/content_packages/<run>/cardnews/<lang>/content_plan.json`
    from a canonical run-package report path. Returns None when the
    report is not in the canonical layout — caller then must pass `--out`
    explicitly. Mirrors `cardnews.render._default_out_dir_for_report`
    so the planner and the renderer agree on where artifacts live."""
    p = Path(report_path).resolve()
    parts = p.parts
    try:
        i = parts.index("content_packages")
    except ValueError:
        return None
    if len(parts) < i + 4:
        return None
    if parts[i + 2] != "shared" or parts[i + 3] != "analysis_report.json":
        return None
    run_root = Path(*parts[: i + 2])
    return run_root / "cardnews" / lang / "content_plan.json"


def _build_default_llm_client(
    *, provider: str, model: str | None,
) -> Callable[[str], str]:
    """Build a `Callable[[str], str]` LLM client for the planner CLI.

    Two providers are supported by the cardnews v1 skill:
      * `openai` (default) — uses `gpt-4o` unless overridden, JSON mode on.
      * `anthropic` — uses `claude-sonnet-4-5` unless overridden.

    Both bootstrap from environment-provided API keys (`OPENAI_API_KEY`
    or `ANTHROPIC_API_KEY`). Missing key → ValueError so the planner
    fails closed rather than degrading silently."""
    if provider == "openai":
        from openai import OpenAI
        chosen_model = model or "gpt-4o"
        client = OpenAI()

        def _call(prompt: str) -> str:
            resp = client.chat.completions.create(
                model=chosen_model,
                temperature=0.3,
                messages=[
                    {"role": "system", "content":
                     "You produce strictly valid JSON only. No prose, no markdown fences."},
                    {"role": "user", "content": prompt},
                ],
                response_format={"type": "json_object"},
            )
            return resp.choices[0].message.content
        return _call

    if provider == "anthropic":
        from src.voc.content.llm.client import AnthropicLLMClient
        chosen_model = model or "claude-sonnet-4-5"
        client = AnthropicLLMClient(model=chosen_model, temperature=0.3, max_tokens=8000)

        def _call(prompt: str) -> str:
            return client.complete(
                system="You produce strictly valid JSON only. No prose, no markdown fences.",
                user=prompt,
            )
        return _call

    raise ValueError(f"unknown llm provider: {provider!r}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    parser = argparse.ArgumentParser(
        description=(
            "Build a content_plan.json from an analysis_report.json. "
            "Default --out is "
            "outputs/content_packages/<run>/cardnews/<lang>/content_plan.json "
            "when the report sits in the canonical run-package layout. "
            "LLM mode bootstraps an OpenAI client by default — fail-closed "
            "on any LLM error unless --allow-mock-fallback is set."
        )
    )
    parser.add_argument("--analysis-report", required=True, type=Path)
    parser.add_argument(
        "--out", type=Path, default=None,
        help="Output JSON path. Defaults to "
             "outputs/content_packages/<run>/cardnews/<lang>/content_plan.json "
             "when the report path matches the canonical layout; otherwise "
             "outputs/content/{slug}/ko/content_plan_ko.json (legacy fallback).",
    )
    parser.add_argument("--lang", type=str, default="ko",
                        help="Language subdir (default: ko).")
    parser.add_argument("--mode", choices=("mock", "llm"), default=None,
                        help="mock = template-driven (deterministic), "
                             "llm = bootstraps the configured provider.")
    parser.add_argument("--llm-provider", choices=("openai", "anthropic"),
                        default="openai",
                        help="Only used when --mode=llm. Default: openai.")
    parser.add_argument("--llm-model", type=str, default=None,
                        help="Override the provider's default model.")
    parser.add_argument("--allow-mock-fallback", action="store_true",
                        help="Permit silent fallback to mock when LLM fails. "
                             "Off by default — the skill prefers fail-closed.")
    parser.add_argument(
        "--raw-dump-dir", type=Path, default=None,
        help="When set, the LLM raw response is written to "
             "<dir>/_planner_raw.txt on parse / validation / safety failure. "
             "Default: <out_parent>/_debug/ when --out resolves under outputs/, "
             "else not written.",
    )
    args = parser.parse_args(argv)

    report = json.loads(args.analysis_report.read_text(encoding="utf-8"))

    if args.out is None:
        derived = default_plan_path_for_report(args.analysis_report, lang=args.lang)
        if derived is not None:
            out_path = derived
        else:
            out_dir = default_output_dir(report)
            out_path = out_dir / "content_plan_ko.json"
    else:
        out_path = args.out
    out_path = Path(out_path).expanduser().resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    raw_dump_dir = args.raw_dump_dir
    if raw_dump_dir is None:
        # Default: a _debug sibling under the canonical out dir, only
        # populated on LLM failure (no clutter on green runs).
        raw_dump_dir = out_path.parent / "_debug"

    mode = args.mode or os.environ.get("CARDNEWS_PLANNER_MODE", "mock").lower()
    llm_client = None
    if mode == "llm":
        llm_client = _build_default_llm_client(
            provider=args.llm_provider, model=args.llm_model,
        )

    plan = build_content_plan(
        report,
        mode=args.mode,
        llm_client=llm_client,
        allow_mock_fallback=(True if args.allow_mock_fallback else None),
        raw_dump_dir=raw_dump_dir,
    )

    out_path.write_text(
        json.dumps(plan, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    extras = []
    if mode == "llm":
        extras.append(f"provider={args.llm_provider}")
        if args.llm_model:
            extras.append(f"model={args.llm_model}")
    suffix = (" " + " ".join(extras)) if extras else ""
    print(f"wrote {out_path} (mode={mode}){suffix}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
