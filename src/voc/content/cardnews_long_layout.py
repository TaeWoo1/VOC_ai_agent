"""Long-form Instagram cardnews layout (9–12 pages).

Consumes the v3.0 `analysis_report.json` produced by
`src/voc/content/adapters/from_phase2e.py` and emits a layout dict
suitable for `cardnews/render.py` (Playwright HTML/CSS rendering at
1080×1350).

Page narrative (locked, see plan §"Page order"):

    1.  cover                 — short product name + count + takeaway + chips
    2.  hook                  — editorial summary with mini-metric pills
    3.  method                — 분석 기준 (light, inline mini-cards)
    4.  loved                 — 반복되는 호평 (ranked top-3)
    5.  divides               — 갈리는 의견 (proportion bars)
    6.  checkpoints           — 구매 전 체크포인트 (numbered tiles)
    7..N.  caution_attr       — 1 page per top-3 caution attributes (n_neg ≥ 5)
    N+1..M. positive_attr     — 1 page per top-2 positive attributes (n_pos ≥ 5)
                                 — DEDUPED: skipped when key already in caution
    M+1.   audience           — combined fit + consider_carefully (2-col)
    M+2.   cta                — Instagram-native action cards (no raw URL)

Compared to v1 of this layout: 헌 14 pages → 11 (mediheal). Removed
templates: `fit_for`, `consider_carefully` (merged into `audience`).
Added page types: every type now has its own template — no shared
content.html.j2 — for visual variety.

Tone contract — see `cardnews/safety_validator.py`. Every public
string in the output MUST clear the banned-framings check; every
audit field stays under `audit.*` and never bleeds into a rendered
template.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src.voc.content._confidence import resolve_overall_confidence
from src.voc.content.cardnews_generator import (
    CardnewsGenerationError,
    DEFAULT_DISCLOSURE_KO,
    _METHOD_CORPUS_NOTE_BY_CONFIDENCE,
    _attribute_counts,
    _attribute_label_map,
    _ko_topic_particle,
    _truncate,
    _yyyy_mm,
)
from src.voc.content.validators import (
    BULLET_MAX_CHARS_KO,
    SLIDE_TITLE_MAX_CHARS_KO,
)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCHEMA_VERSION = "1.1"
LANGUAGE_DEFAULT = "ko"
CHANNEL = "instagram"
FORMAT = "cardnews_long"

# Per-attribute fan-out caps. The user-facing rule: surface up to 3
# caution attributes and up to 2 positive attributes, only when the
# count clears the operator-facing threshold of 5. Positive_attr is
# additionally suppressed when the same attribute already appears as
# a caution_attr — that overlap is already covered by the divides
# page and shouldn't earn two spotlight pages.
CAUTION_ATTR_MAX = 3
POSITIVE_ATTR_MAX = 2
FANOUT_MIN_COUNT = 5

# Body-paragraph budget for the sanitized evidence phrase card. The
# bullet budget (40 KO chars from validators) is too tight for a
# noun-phrase card — give the phrase room to breathe.
PHRASE_MAX_CHARS_KO = 60
TIP_MAX_CHARS_KO = 40
NOTE_MAX_CHARS_KO = 32
TAKEAWAY_MAX_CHARS_KO = 50


# Banned tokens we MUST NOT emit ourselves in any built-in template.
# Defense-in-depth — the safety validator catches drift, but no static
# template should generate anything that needs catching.
_SELF_FORBIDDEN_TOKENS: tuple[str, ...] = (
    "최악", "독", "부작용", "무조건", "인생템", "미쳤어요",
    "절대 사지 마세요", "광고에 속지", "브랜드가 숨긴",
    "당신이 모르는 진실", "충격적인 반전", "팩트 폭로",
    "소비자들은 속고 있다", "진짜 실체",
)


# Sanitized evidence phrases. Built once as a noun-phrase summary of
# the cluster — never quotes a specific reviewer, never names a brand.
EVIDENCE_PHRASE_KO: dict[tuple[str, str], str] = {
    ("pigmentation", "caution"): "발색이 사진과 다르다는 의견이 반복",
    ("pigmentation", "positive"): "발색이 사진과 가깝다는 후기 반복",
    ("persistence", "caution"): "시간이 지나면서 지속력이 아쉽다는 의견",
    ("persistence", "positive"): "장시간 지속력에 만족한다는 후기",
    ("application_blending", "caution"): "발림성·블렌딩이 까다롭다는 의견",
    ("application_blending", "positive"): "발림성이 부드럽다는 후기 반복",
    ("adhesion_base_interaction", "caution"): "베이스 메이크업과 겉돈다는 의견",
    ("adhesion_base_interaction", "positive"): "베이스와 잘 어우러진다는 후기",
    ("finish_texture", "caution"): "마무리감·촉촉함이 아쉽다는 의견",
    ("finish_texture", "positive"): "마무리감이 자연스럽다는 후기",
    ("dryness_skin_texture", "caution"): "건조함·당김이 느껴진다는 의견",
    ("dryness_skin_texture", "positive"): "촉촉하게 마무리된다는 후기",
    ("color_tone_matching", "caution"): "퍼스널 컬러·호수가 까다롭다는 의견",
    ("color_tone_matching", "positive"): "톤 매칭이 잘 맞는다는 후기",
    ("packaging_container", "caution"): "패키지·용기 사용성이 아쉽다는 의견",
    ("packaging_container", "positive"): "패키지가 만족스럽다는 후기",
    ("applicator_tool", "caution"): "도구·집게·뚜껑 사용감이 아쉽다는 의견",
    ("applicator_tool", "positive"): "도구·집게 사용 편의가 좋다는 후기",
    ("value_price", "caution"): "가격 대비 아쉬운 점이 있다는 의견",
    ("value_price", "positive"): "가성비·구성에 만족한다는 후기",
    ("multi_use_lip_cheek_compatibility", "caution"): "립·치크 겸용 활용이 어렵다는 의견",
    ("multi_use_lip_cheek_compatibility", "positive"): "립·치크 겸용이 편리하다는 후기",
    ("transfer_resistance", "caution"): "묻어남·번짐이 있다는 의견",
    ("transfer_resistance", "positive"): "묻어남 없이 잘 고정된다는 후기",
}

EVIDENCE_TIP_KO: dict[str, str] = {
    "pigmentation": "옵션·호수별 발색 후기 먼저 확인",
    "persistence": "사용 환경·시간대별 지속력 후기 확인",
    "application_blending": "본인 피부 타입의 블렌딩 후기 확인",
    "adhesion_base_interaction": "본인 베이스 조합과 비교한 후기 확인",
    "finish_texture": "마무리감 키워드로 후기 먼저 확인",
    "dryness_skin_texture": "건성·복합성 후기 비교 확인",
    "color_tone_matching": "퍼스널 컬러 키워드로 후기 검색",
    "packaging_container": "사용 1개월차 패키지 후기 확인",
    "applicator_tool": "도구 사용감 키워드 후기 확인",
    "value_price": "용량·구성 비교 후기 확인",
    "multi_use_lip_cheek_compatibility": "겸용 사용법 후기 확인",
    "transfer_resistance": "마스크·옷 묻어남 후기 확인",
}

# Secondary supporting note for the caution / positive spotlight page
# bottom block. Never directive — just a "what else to look for"
# expectation-setting line.
SECONDARY_NOTE_KO: dict[tuple[str, str], str] = {
    ("pigmentation", "caution"): "조명·디바이스에 따라 체감이 달라질 수 있어요",
    ("pigmentation", "positive"): "조명·옵션별 체감 차이는 후기에서 살펴볼 것",
    ("persistence", "caution"): "사용 환경(땀·기온)에 따라 갈리는 의견",
    ("persistence", "positive"): "환경별 차이는 후기에서 한 번 더 확인",
    ("application_blending", "caution"): "피부 타입·도구에 따라 다른 결과",
    ("application_blending", "positive"): "기존 사용 도구와 잘 맞는지 확인",
    ("adhesion_base_interaction", "caution"): "베이스 조합에 따라 체감이 달라요",
    ("adhesion_base_interaction", "positive"): "본인 베이스 조합 후기 추가 확인",
    ("finish_texture", "caution"): "기대하는 마무리감과 비교해 보세요",
    ("finish_texture", "positive"): "취향에 맞는 마무리감인지 확인",
    ("dryness_skin_texture", "caution"): "피부 타입별로 체감 차이가 큰 항목",
    ("dryness_skin_texture", "positive"): "본인 피부 타입 후기 비교 추천",
    ("color_tone_matching", "caution"): "퍼스널 컬러에 따라 호불호가 갈려요",
    ("color_tone_matching", "positive"): "본인 톤·계절 후기 비교 확인",
    ("packaging_container", "caution"): "사용 후 변화는 1개월 후기에서",
    ("packaging_container", "positive"): "장기 사용 후기까지 살펴보면 도움",
    ("applicator_tool", "caution"): "기존에 익숙한 도구와 비교해 보세요",
    ("applicator_tool", "positive"): "사용감 후기를 더 살펴보면 좋아요",
    ("value_price", "caution"): "옵션·사은품 구성 변경에 주의",
    ("value_price", "positive"): "구성·용량 비교는 옵션별로 한 번 더",
    ("multi_use_lip_cheek_compatibility", "caution"): "겸용 시나리오마다 체감 다름",
    ("multi_use_lip_cheek_compatibility", "positive"): "사용 시나리오별 후기 비교 추천",
    ("transfer_resistance", "caution"): "옷·마스크 종류별로 다를 수 있어요",
    ("transfer_resistance", "positive"): "환경별 묻어남 후기 추가 확인",
}


# Confidence-gated cover subtitle leads.
_COVER_SUBTITLE_BY_CONFIDENCE: dict[str, str] = {
    "weak": "리뷰 {n}건에서 자주 본 인상을 정리했어요",
    "moderate": "리뷰 {n}건에서 반복된 인상을 정리했어요",
    "strong": "리뷰 {n}건에서 일관된 인상을 정리했어요",
}

_HOOK_LEAD_BY_CONFIDENCE: dict[str, str] = {
    "weak": "표본 내에서 자주 본 두 신호",
    "moderate": "표본에서 반복된 두 신호",
    "strong": "표본에서 일관되게 나타난 두 신호",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _assert_self_forbidden(text: str, location: str) -> None:
    for term in _SELF_FORBIDDEN_TOKENS:
        if term in text:
            raise CardnewsGenerationError(
                f"internal: layout produced banned framing {term!r} at "
                f"{location} — fix the template, do not relax the validator"
            )


_GOODS_NO_RE = re.compile(r"[?&]goodsNo=([A-Z0-9]+)")
# Match a quantity marker that signals the start of spec-detail tail
# in a Korean product name (e.g. "메디힐 더마 패드 200매 대용량 …").
# Used to derive a short cover title.
_QUANTITY_TAIL_RE = re.compile(r"\s+\d+(?:매|개|ml|g|호|종|회|kg|mg|입|병|장|cm|mm)")


def _extract_external_id(source_url: str | None) -> str | None:
    if not source_url:
        return None
    m = _GOODS_NO_RE.search(source_url)
    return m.group(1) if m else None


def _short_product_name(name_ko: str | None) -> str:
    """Cover-friendly product name. Strips the spec-detail tail
    (`200매 대용량 …`) and caps to ~22 KO chars. Brand/category
    bracket prefix is preserved when present — that's the kind of
    framing buyers recognize at-a-glance."""
    if not name_ko:
        return "리뷰 정리 노트"
    parts = _QUANTITY_TAIL_RE.split(name_ko, maxsplit=1)
    short = parts[0].strip() if parts else name_ko.strip()
    return _truncate(short, 22)


def _format_count(n: int) -> str:
    """Comma-grouped count for editorial copy: 2029 → '2,029'."""
    return f"{int(n):,}"


def _evidence_phrase(attribute: str, polarity: str, label_ko: str) -> str:
    phrase = EVIDENCE_PHRASE_KO.get((attribute, polarity))
    if phrase:
        return phrase
    if polarity == "caution":
        return f"{label_ko} 관련 호불호가 갈린 의견"
    return f"{label_ko} 관련 만족 후기 반복"


def _evidence_tip(attribute: str, label_ko: str) -> str:
    tip = EVIDENCE_TIP_KO.get(attribute)
    if tip:
        return tip
    return f"{label_ko} 관련 후기 먼저 확인"


def _secondary_note(attribute: str, polarity: str) -> str:
    return SECONDARY_NOTE_KO.get(
        (attribute, polarity),
        "본인 사용 환경 후기 한 번 더 확인",
    )


def _audit_from_quotes(
    quotes: list[dict],
    polarity_filter: tuple[str, ...] | None = None,
) -> dict:
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


def _format_yyyy_mm_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _top_strengths(counts: dict[str, dict]) -> list[tuple[str, dict]]:
    return sorted(
        [(k, c) for k, c in counts.items()
         if c["n_positive"] > c["n_negative"]
         and c["n_positive"] >= FANOUT_MIN_COUNT],
        key=lambda kv: -kv[1]["n_positive"],
    )


def _top_cautions(counts: dict[str, dict]) -> list[tuple[str, dict]]:
    return sorted(
        [(k, c) for k, c in counts.items() if c["n_negative"] >= FANOUT_MIN_COUNT],
        key=lambda kv: -kv[1]["n_negative"],
    )


def _top_divides(counts: dict[str, dict]) -> list[tuple[str, dict]]:
    return sorted(
        [(k, c) for k, c in counts.items()
         if c["n_positive"] >= FANOUT_MIN_COUNT
         and c["n_negative"] >= FANOUT_MIN_COUNT],
        key=lambda kv: -(kv[1]["n_positive"] + kv[1]["n_negative"]),
    )


# ---------------------------------------------------------------------------
# Page builders
# ---------------------------------------------------------------------------


def _build_cover(
    report: dict,
    confidence: str,
    counts: dict[str, dict],
    product_image: dict,
) -> dict:
    """Cover redesign: short_name + count + takeaway + chip_strip.
    Hierarchy: bracket-tag (top), big short product name (mid),
    chip_strip + takeaway box (bottom). Image slot lives behind."""
    product = report.get("product") or {}
    full_name = (product.get("name_ko") or "").strip()
    short_name = _short_product_name(full_name)
    n = int((report.get("corpus") or {}).get("n_reviews_total") or 0)

    # Editorial subhead — frames the "why read this" angle.
    if n > 0:
        subtitle = f"리뷰 {_format_count(n)}건에서 갈린 포인트"
    else:
        subtitle = "리뷰 데이터에서 갈린 포인트"

    # Takeaway: one-line summary built from top strength + top divides.
    strengths = _top_strengths(counts)
    cautions = _top_cautions(counts)
    divides = _top_divides(counts)

    if strengths and (divides or cautions):
        s_key = strengths[0][0]
        s_label = strengths[0][1]["label_ko"]
        # Prefer a divide attribute (both polarities high) for the right
        # half — that's the more interesting tension. Skip the top
        # strength so the takeaway names two different attributes.
        rhs_label = None
        for k, c in divides:
            if k != s_key:
                rhs_label = c["label_ko"]
                break
        if rhs_label is None:
            for k, c in cautions:
                if k != s_key:
                    rhs_label = c["label_ko"]
                    break
        if rhs_label is None and divides:
            rhs_label = divides[0][1]["label_ko"]
        if rhs_label is None and cautions:
            rhs_label = cautions[0][1]["label_ko"]
        s_topic = _ko_topic_particle(s_label)
        r_topic = _ko_topic_particle(rhs_label or "")
        takeaway = f"{s_label}{s_topic} 호평, {rhs_label}{r_topic} 호불호"
    elif strengths:
        s_label = strengths[0][1]["label_ko"]
        takeaway = f"{s_label} 만족 후기가 자주 반복"
    elif cautions:
        c_label = cautions[0][1]["label_ko"]
        takeaway = f"{c_label} 호불호가 갈린 지점"
    else:
        takeaway = "표본이 적어 신호 형성 중"
    takeaway = _truncate(takeaway, TAKEAWAY_MAX_CHARS_KO)

    # Chip strip — three keywords. Top strength + top divides + (top
    # caution OR second strength), de-duplicated.
    chip_seen: set[str] = set()
    chip_strip: list[str] = []
    for source in (
        strengths[:1],
        divides[:1],
        cautions[:1],
        strengths[1:2],
        cautions[1:2],
    ):
        for _key, c in source:
            label = c["label_ko"]
            if label and label not in chip_seen:
                chip_seen.add(label)
                # Cover chips are short — split on `/` and take the
                # first half so "대용량/가성비" → "대용량".
                chip_strip.append(label.split("/")[0].strip()[:8])
        if len(chip_strip) >= 3:
            break
    chip_strip = chip_strip[:3]
    if not chip_strip:
        chip_strip = ["리뷰 정리"]

    # Bracket tag — "[리뷰 저널 · YYYY-MM]" replaces the verbose
    # "REVIEW JOURNAL · 2026-05" so the cover reads ko-native.
    bracket_tag = f"리뷰 저널 · {_format_yyyy_mm_now()}"

    _assert_self_forbidden(short_name, "cover.title")
    _assert_self_forbidden(subtitle, "cover.subtitle")
    _assert_self_forbidden(takeaway, "cover.takeaway_ko")
    for c in chip_strip:
        _assert_self_forbidden(c, "cover.chip_strip[]")

    return {
        "index": 1,
        "type": "cover",
        "language": LANGUAGE_DEFAULT,
        "chip": bracket_tag,
        "title": short_name,
        "subtitle": subtitle,
        "takeaway_ko": takeaway,
        "chip_strip": chip_strip,
        "product_image": product_image,
        "audit": {},
    }


def _build_hook(report: dict, confidence: str, counts: dict[str, dict]) -> dict:
    """Hook redesign: editorial lead-line + 3 mini metric pills +
    2 supporting lines. Replaces the previous mostly-empty subtitle-only
    page."""
    n_total = int((report.get("corpus") or {}).get("n_reviews_total") or 0)
    strengths = _top_strengths(counts)
    cautions = _top_cautions(counts)
    divides = _top_divides(counts)

    lead_line = _HOOK_LEAD_BY_CONFIDENCE.get(
        confidence, _HOOK_LEAD_BY_CONFIDENCE["weak"]
    )

    supporting_lines: list[str] = []
    s_key: str | None = None
    if strengths:
        s_key = strengths[0][0]
        s_label = strengths[0][1]["label_ko"]
        n = strengths[0][1]["n_positive"]
        supporting_lines.append(f"{s_label} — 반복되는 호평 {n}건")
    # Pick a divide entry that is NOT the top strength so the two
    # supporting lines describe two different attributes.
    chosen_divide = None
    for k, c in divides:
        if k != s_key:
            chosen_divide = c
            break
    if chosen_divide is None and divides:
        chosen_divide = divides[0][1]
    chosen_caution = None
    if chosen_divide is None:
        for k, c in cautions:
            if k != s_key:
                chosen_caution = c
                break
        if chosen_caution is None and cautions:
            chosen_caution = cautions[0][1]
    if chosen_divide is not None:
        supporting_lines.append(
            f"{chosen_divide['label_ko']} — 만족 {chosen_divide['n_positive']} / 의견 갈림 {chosen_divide['n_negative']}"
        )
    elif chosen_caution is not None:
        supporting_lines.append(
            f"{chosen_caution['label_ko']} — 호불호가 갈린 의견 {chosen_caution['n_negative']}건"
        )

    if not supporting_lines:
        supporting_lines = ["표본이 작아 일관된 신호가 보이지 않아요"]

    # Mini metric pills — 3 concise data chips.
    n_pos_total = sum((c["n_positive"] or 0) for c in counts.values())
    n_neg_total = sum((c["n_negative"] or 0) for c in counts.values())
    n_split = sum(
        1 for c in counts.values()
        if c["n_positive"] >= FANOUT_MIN_COUNT and c["n_negative"] >= FANOUT_MIN_COUNT
    )
    mini_metrics = [
        {"label": "분석 리뷰", "value": _format_count(n_total)},
        {"label": "호평", "value": _format_count(n_pos_total)},
        {"label": "갈리는 항목", "value": str(n_split)},
    ]

    closer = "자세한 포인트는 다음 장에서"

    for s in supporting_lines:
        _assert_self_forbidden(s, "hook.supporting_lines[]")
    _assert_self_forbidden(lead_line, "hook.lead_line")
    _assert_self_forbidden(closer, "hook.note")

    return {
        "index": 2,
        "type": "hook",
        "language": LANGUAGE_DEFAULT,
        "chip": "한 줄 인상",
        "title": "한 줄 인상",
        "lead_line": lead_line,
        "supporting_lines": supporting_lines,
        "mini_metrics": mini_metrics,
        "note": closer,
        "audit": {},
    }


def _build_method(report: dict, confidence: str) -> dict:
    """Method redesign: 3 inline mini-cards in a horizontal strip
    instead of stacked white boxes. Lighter feel — reads as a
    sidebar/byline, not a report appendix."""
    corpus = report.get("corpus") or {}
    methodology = report.get("methodology_notes") or {}

    n_total = int(corpus.get("n_reviews_total") or 0)
    cl = (corpus.get("confidence_level") or "").lower()
    confidence_label = {
        "high": "충분", "medium": "보통", "low": "초기 신호",
    }.get(cl, "보통")
    sampling = (corpus.get("sampling_strategy") or "").strip()
    sampling_label = (
        "다중 정렬 합집합" if sampling == "observable_multi_sort_corpus"
        else "최신순 우선"
    )

    mini_cards = [
        {"label": "분석 리뷰", "value": f"{_format_count(n_total)}건"},
        {"label": "표본 규모", "value": confidence_label},
        {"label": "수집 방식", "value": sampling_label},
    ]

    note = "리뷰 신호이며 제품 결함을 단정하지 않습니다"
    disclosure = (methodology.get("disclosure_ko") or "").strip() or DEFAULT_DISCLOSURE_KO

    _assert_self_forbidden(note, "method.note")

    return {
        "index": 3,
        "type": "method",
        "language": LANGUAGE_DEFAULT,
        "chip": "분석 기준",
        "title": "분석 기준",
        "subtitle": "리뷰를 어떻게 모았고, 무엇을 보지 않는가",
        "mini_cards": mini_cards,
        "note": note,
        "disclosure": _truncate(disclosure, 220),
        "audit": {},
    }


def _build_loved(
    counts: dict[str, dict],
    strengths_in: list[dict],
    index: int,
) -> dict:
    """Loved redesign: ranked items (#1, #2, #3) instead of stacked
    bullet cards. Each item gets a label + count + short narrative
    line so the page actually fills space."""
    sorted_str = sorted(
        strengths_in, key=lambda s: -(s.get("supporting_count") or 0),
    )
    items: list[dict] = []
    for i, s in enumerate(sorted_str[:3]):
        key = s.get("attribute_key")
        if not key:
            continue
        c = counts.get(key) or {}
        label = c.get("label_ko") or key
        n = int(s.get("supporting_count") or 0)
        # Short note pulled from the positive evidence phrase table.
        note = _evidence_phrase(key, "positive", label)
        items.append({
            "rank": str(i + 1).zfill(2),
            "label": _truncate(label, 18),
            "count": f"만족 후기 {n}건",
            "note": _truncate(note, NOTE_MAX_CHARS_KO),
        })

    if not items:
        for key, c in sorted(counts.items(), key=lambda kv: -kv[1]["n_positive"]):
            if c["n_positive"] >= FANOUT_MIN_COUNT and c["n_positive"] > c["n_negative"]:
                items.append({
                    "rank": str(len(items) + 1).zfill(2),
                    "label": _truncate(c["label_ko"], 18),
                    "count": f"만족 후기 {c['n_positive']}건",
                    "note": _truncate(
                        _evidence_phrase(key, "positive", c["label_ko"]),
                        NOTE_MAX_CHARS_KO,
                    ),
                })
            if len(items) >= 3:
                break

    if not items:
        items = [{
            "rank": "—",
            "label": "표본 부족",
            "count": "추가 리뷰 필요",
            "note": "신호가 더 모이면 다시 정리할 후보",
        }]

    for it in items:
        _assert_self_forbidden(it["label"], "loved.ranked_items[].label")
        _assert_self_forbidden(it["note"], "loved.ranked_items[].note")

    return {
        "index": index,
        "type": "loved",
        "language": LANGUAGE_DEFAULT,
        "chip": "반복되는 호평",
        "title": "가장 자주 칭찬받은 부분",
        "subtitle": "리뷰에서 반복된 만족 신호 상위 3",
        "ranked_items": items,
        "audit": {},
    }


def _build_divides(counts: dict[str, dict], index: int) -> dict:
    """Divides redesign: comparison_items with proportion data so the
    template can render side-by-side bars instead of bullet text."""
    divides = _top_divides(counts)
    items: list[dict] = []
    for _, c in divides[:3]:
        pos = int(c["n_positive"])
        neg = int(c["n_negative"])
        total = pos + neg or 1
        items.append({
            "label": _truncate(c["label_ko"], 18),
            "satisfied": pos,
            "split": neg,
            "satisfied_pct": round(100 * pos / total),
            "split_pct": round(100 * neg / total),
            "note": "사용 환경·취향에 따라 갈리는 항목",
        })

    # Soft fallback when there are no genuine 2-sided divides.
    if not items:
        for key, c in sorted(counts.items(), key=lambda kv: -kv[1]["n_negative"]):
            if c["n_negative"] >= FANOUT_MIN_COUNT:
                pos = int(c["n_positive"])
                neg = int(c["n_negative"])
                total = pos + neg or 1
                items.append({
                    "label": _truncate(c["label_ko"], 18),
                    "satisfied": pos,
                    "split": neg,
                    "satisfied_pct": round(100 * pos / total),
                    "split_pct": round(100 * neg / total),
                    "note": "단일 방향 의견이 우세하지만 다른 결도 존재",
                })
            if len(items) >= 3:
                break

    if not items:
        items = [{
            "label": "—",
            "satisfied": 0,
            "split": 0,
            "satisfied_pct": 50,
            "split_pct": 50,
            "note": "뚜렷하게 갈린 지점이 충분히 보이지 않아요",
        }]

    for it in items:
        _assert_self_forbidden(it["label"], "divides.comparison_items[].label")
        _assert_self_forbidden(it["note"], "divides.comparison_items[].note")

    return {
        "index": index,
        "type": "divides",
        "language": LANGUAGE_DEFAULT,
        "chip": "갈리는 의견",
        "title": "같은 항목, 다르게 본 사용자들",
        "subtitle": "만족과 갈림이 함께 쌓인 지점",
        "comparison_items": items,
        "audit": {},
    }


def _build_checkpoints(
    monitoring_in: list[dict],
    counts: dict[str, dict],
    index: int,
) -> dict:
    """Checkpoints redesign: numbered tiles (01, 02, 03) with label +
    count + a brief 'why check' note. Replaces the bullet-card stack."""
    sorted_mon = sorted(
        monitoring_in, key=lambda m: -(m.get("n_negative") or 0),
    )
    items: list[dict] = []
    for i, m in enumerate(sorted_mon[:3]):
        key = m.get("attribute_key") or ""
        n = int(m.get("n_negative") or 0)
        if not key or n < FANOUT_MIN_COUNT:
            continue
        c = counts.get(key) or {}
        label = m.get("concern_label_ko") or c.get("label_ko") or key
        items.append({
            "number": str(i + 1).zfill(2),
            "label": _truncate(label, 18),
            "count": f"호불호 {n}건",
            "note": _truncate(_evidence_tip(key, label), NOTE_MAX_CHARS_KO),
        })

    if not items:
        items = [{
            "number": "—",
            "label": "표본 부족",
            "count": "신호 형성 중",
            "note": "리뷰가 더 모이면 다시 정리할 후보",
        }]

    for it in items:
        _assert_self_forbidden(it["label"], "checkpoints.numbered_items[].label")
        _assert_self_forbidden(it["note"], "checkpoints.numbered_items[].note")

    return {
        "index": index,
        "type": "checkpoints",
        "language": LANGUAGE_DEFAULT,
        "chip": "구매 전 체크포인트",
        "title": "사기 전에 한 번 더 짚을 포인트",
        "subtitle": "리뷰에서 반복된 의견을 기준으로 정리",
        "numbered_items": items,
        "audit": {},
    }


def _build_caution_attr(
    monitoring_entry: dict,
    counts: dict[str, dict],
    index: int,
) -> dict | None:
    key = monitoring_entry.get("attribute_key") or ""
    n_neg = int(monitoring_entry.get("n_negative") or 0)
    if not key or n_neg < FANOUT_MIN_COUNT:
        return None
    c = counts.get(key) or {}
    label = monitoring_entry.get("concern_label_ko") or c.get("label_ko") or key
    n_pos = int(c.get("n_positive") or 0)

    phrase = _evidence_phrase(key, "caution", label)
    tip = _evidence_tip(key, label)
    secondary = _secondary_note(key, "caution")

    audit = _audit_from_quotes(
        list(monitoring_entry.get("top_negative_quotes") or []),
        polarity_filter=("negative_strong", "negative_weak", "negative"),
    )

    _assert_self_forbidden(phrase, f"caution_attr[{key}].evidence_phrase_ko")
    _assert_self_forbidden(tip, f"caution_attr[{key}].tip_ko")
    _assert_self_forbidden(secondary, f"caution_attr[{key}].secondary_note")

    return {
        "index": index,
        "type": "caution_attr",
        "language": LANGUAGE_DEFAULT,
        "attribute_key": key,
        "label_ko": _truncate(label, SLIDE_TITLE_MAX_CHARS_KO),
        "title": _truncate(label, SLIDE_TITLE_MAX_CHARS_KO),
        "chip": "주의 시그널",
        "ratio_strip": {"satisfied": n_pos, "split": n_neg},
        "evidence_phrase_ko": _truncate(phrase, PHRASE_MAX_CHARS_KO),
        "tip_ko": _truncate(tip, TIP_MAX_CHARS_KO),
        "secondary_note": _truncate(secondary, NOTE_MAX_CHARS_KO),
        "audit": audit,
    }


def _build_positive_attr(
    strength_entry: dict,
    counts: dict[str, dict],
    index: int,
) -> dict | None:
    key = strength_entry.get("attribute_key") or ""
    n_pos = int(strength_entry.get("supporting_count") or 0)
    if not key or n_pos < FANOUT_MIN_COUNT:
        return None
    c = counts.get(key) or {}
    label = c.get("label_ko") or key
    n_neg = int(c.get("n_negative") or 0)

    phrase = _evidence_phrase(key, "positive", label)
    tip = _evidence_tip(key, label)
    secondary = _secondary_note(key, "positive")

    rep = strength_entry.get("representative_quote")
    audit = _audit_from_quotes(
        [rep] if isinstance(rep, dict) else [],
        polarity_filter=("positive",),
    )

    _assert_self_forbidden(phrase, f"positive_attr[{key}].evidence_phrase_ko")
    _assert_self_forbidden(secondary, f"positive_attr[{key}].secondary_note")

    return {
        "index": index,
        "type": "positive_attr",
        "language": LANGUAGE_DEFAULT,
        "attribute_key": key,
        "label_ko": _truncate(label, SLIDE_TITLE_MAX_CHARS_KO),
        "title": _truncate(label, SLIDE_TITLE_MAX_CHARS_KO),
        "chip": "반복되는 호평",
        "ratio_strip": {"satisfied": n_pos, "split": n_neg},
        "evidence_phrase_ko": _truncate(phrase, PHRASE_MAX_CHARS_KO),
        "tip_ko": _truncate(tip, TIP_MAX_CHARS_KO),
        "secondary_note": _truncate(secondary, NOTE_MAX_CHARS_KO),
        "audit": audit,
    }


def _build_audience(
    strengths_in: list[dict],
    monitoring_in: list[dict],
    counts: dict[str, dict],
    index: int,
) -> dict:
    """Replaces the v1 fit_for + consider_carefully pages with a
    single 2-column page. Left = sage (잘 맞는 분), right = amber
    (신중하게 볼 분). Each side carries 2-3 grouped audience blocks
    with a primary line + a short qualifier."""
    fit_templates = (
        "{label} 강점이 매력적인 분",
        "{label}을(를) 우선 가치로 두는 분",
        "{label} 중심으로 제품을 고르는 분",
    )

    fit_items: list[dict] = []
    sorted_str = sorted(strengths_in, key=lambda s: -(s.get("supporting_count") or 0))
    for i, s in enumerate(sorted_str[:3]):
        key = s.get("attribute_key") or ""
        if not key:
            continue
        c = counts.get(key) or {}
        label = c.get("label_ko") or key
        n = int(s.get("supporting_count") or 0)
        if n < FANOUT_MIN_COUNT:
            continue
        last = label.strip()[-1] if label else ""
        obj = "를"
        if last:
            code = ord(last)
            if 0xAC00 <= code <= 0xD7A3:
                obj = "를" if (code - 0xAC00) % 28 == 0 else "을"
        primary = fit_templates[i % len(fit_templates)].format(label=label).replace(
            "을(를)", obj,
        )
        fit_items.append({
            "label": _truncate(primary, 28),
            "note": f"만족 후기 {n}건",
        })

    if not fit_items:
        fit_items = [{
            "label": "표본이 작아 잘 맞는 분을 단정하기 어려워요",
            "note": "리뷰가 더 모이면 다시 정리할 후보",
        }]

    consider_items: list[dict] = []
    sorted_mon = sorted(monitoring_in, key=lambda m: -(m.get("n_negative") or 0))
    for m in sorted_mon[:3]:
        key = m.get("attribute_key") or ""
        n = int(m.get("n_negative") or 0)
        if not key or n < FANOUT_MIN_COUNT:
            continue
        c = counts.get(key) or {}
        label = m.get("concern_label_ko") or c.get("label_ko") or key
        consider_items.append({
            "label": _truncate(f"{label}에 민감하신 분", 28),
            "note": f"호불호 {n}건",
        })

    if not consider_items:
        consider_items = [{
            "label": "표본 내에서 두드러진 신호 없음",
            "note": "옵션·환경별 후기를 한 번 더 확인",
        }]

    for it in fit_items:
        _assert_self_forbidden(it["label"], "audience.fit_items[].label")
        _assert_self_forbidden(it["note"], "audience.fit_items[].note")
    for it in consider_items:
        _assert_self_forbidden(it["label"], "audience.consider_items[].label")
        _assert_self_forbidden(it["note"], "audience.consider_items[].note")

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


def _build_cta(report: dict, index: int) -> dict:
    """CTA redesign: Instagram-native action cards instead of a raw
    URL. Source URL is preserved in audit metadata for the manifest
    but never rendered to the public surface."""
    product = report.get("product") or {}
    source_url = product.get("source_url") or ""
    methodology = report.get("methodology_notes") or {}
    disclosure = (methodology.get("disclosure_ko") or "").strip() or DEFAULT_DISCLOSURE_KO

    actions = [
        {
            "title": "저장하기",
            "body": "비슷한 제품 비교할 때 다시 꺼내 보세요",
        },
        {
            "title": "댓글로 알려주세요",
            "body": "다음에 보고 싶은 제품을 남겨주시면 정리할게요",
        },
        {
            "title": "리포트 받기",
            "body": "댓글에 '리포트' 남기면 상세 정리 포인트를 보내드려요",
        },
    ]

    title = "다음에도 다시 보고 싶다면"
    lead = "필요할 때 다시 꺼내볼 수 있게 정리해 두었어요"

    _assert_self_forbidden(title, "cta.title")
    _assert_self_forbidden(lead, "cta.lead")
    for a in actions:
        _assert_self_forbidden(a["title"], "cta.actions[].title")
        _assert_self_forbidden(a["body"], "cta.actions[].body")

    return {
        "index": index,
        "type": "cta",
        "language": LANGUAGE_DEFAULT,
        "chip": "SAVE & SHARE",
        "title": title,
        "lead": lead,
        "actions": actions,
        "disclosure": _truncate(disclosure, 220),
        # source URL kept for the manifest's audit chain — not rendered.
        "audit": {"source_url": source_url} if source_url else {},
    }


# ---------------------------------------------------------------------------
# Hash + manifest helpers
# ---------------------------------------------------------------------------


def _analysis_report_sha256(report: dict) -> str:
    blob = json.dumps(report, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def build_long_cardnews_layout(
    analysis_report: dict,
    *,
    product_image: dict | None = None,
) -> dict:
    """Build the long-form Instagram cardnews layout (v1.1)."""
    if not isinstance(analysis_report, dict):
        raise CardnewsGenerationError("analysis_report must be a dict")

    confidence = resolve_overall_confidence(analysis_report)
    counts = _attribute_counts(analysis_report)
    label_map = _attribute_label_map(analysis_report)

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
    pages.append(_build_cover(analysis_report, confidence, counts, image_descriptor))
    pages.append(_build_hook(analysis_report, confidence, counts))
    pages.append(_build_method(analysis_report, confidence))

    strengths_in = list(analysis_report.get("strengths") or [])
    monitoring_in = list(analysis_report.get("monitoring_candidates") or [])

    pages.append(_build_loved(counts, strengths_in, index=4))
    pages.append(_build_divides(counts, index=5))
    pages.append(_build_checkpoints(monitoring_in, counts, index=6))

    next_index = 7
    # Caution fan-out (top-3)
    caution_keys: set[str] = set()
    for entry in monitoring_in[:CAUTION_ATTR_MAX]:
        page = _build_caution_attr(entry, counts, next_index)
        if page is not None:
            pages.append(page)
            caution_keys.add(page["attribute_key"])
            next_index += 1

    # Positive fan-out (top-2) — DEDUPED against the caution set so the
    # carousel doesn't carry two spotlight pages for the same attribute.
    # When an attribute appears in both top strengths and top cautions,
    # the divides page already covers the contradiction.
    pos_added = 0
    for entry in strengths_in:
        if pos_added >= POSITIVE_ATTR_MAX:
            break
        if (entry.get("attribute_key") or "") in caution_keys:
            continue
        page = _build_positive_attr(entry, counts, next_index)
        if page is not None:
            pages.append(page)
            next_index += 1
            pos_added += 1

    pages.append(_build_audience(strengths_in, monitoring_in, counts, index=next_index))
    next_index += 1
    pages.append(_build_cta(analysis_report, index=next_index))

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
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    return layout


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build a long-form Instagram cardnews layout from a v3.0 analysis_report.json"
    )
    parser.add_argument("--analysis-report", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)

    report = json.loads(args.analysis_report.read_text(encoding="utf-8"))
    layout = build_long_cardnews_layout(report)
    args.out.write_text(
        json.dumps(layout, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"wrote {args.out} ({layout['page_count']} pages)")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
