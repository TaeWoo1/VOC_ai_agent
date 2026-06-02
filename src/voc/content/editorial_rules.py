"""SCAMPER editorial layer.

A small, opinionated set of constants + helpers that re-frame the
content engine's outputs from "review summary" to "pre-purchase
decision criteria". Applied at the *generation templates* — never
inside detection (Stage 1), polarity (Stage 2), aggregation, lexicons,
or schemas.

The seven SCAMPER moves implemented here:

S — SUBSTITUTE
    `DECISION_FRAME_HEADERS_KO`: rename the surfaces
    ("리뷰 요약" → "구매 전 검토 포인트").

C — COMBINE
    `combine_evidence_sources(report, brief, unique_insights)` returns
    a single dict consumed by the contrast-pair builders. Falls back
    cleanly when `unique_insights` is missing.

A — ADAPT
    `category_vocabulary_for(profile_id)` returns
    `{emphasis: [...], suppress: [...]}` so a skincare-pad product
    speaks in pad/essence/hygiene terms instead of pigment/blending.

M — MODIFY
    `build_contrast_verdict(strengths, monitoring)` — generic
    "호평이 반복" lines get rewritten to evidence-paired contrast
    ("촉촉하다는 평은 많지만, 오래 붙이면 건조하다는 의견도 …").

P — PUT TO ANOTHER USE
    `INTERVIEW_HOOK_TEMPLATES_KO` + `interview_hook_for(attribute_key)`
    turn repeated frictions into seller-facing interview hooks
    (container hygiene, essence amount, dry-down timing, …).

E — ELIMINATE
    `GENERIC_PHRASES_KO` ban list +
    `find_unsupported_generic_phrases(text)` validator — generic
    phrases are allowed only when paired with specific evidence
    (digit count, quoted excerpt) in the same sentence.

R — REVERSE
    `build_hesitation_lines(monitoring, profile_id)` —
    "이런 분은 한 번 더 검토하세요" surfaced as primary content,
    not buried under strengths.

This module is pure (no I/O, no LLM, no DB) and depends only on
project-internal constants. Tests cover every helper.
"""
from __future__ import annotations

import re
from typing import Iterable, Mapping, Sequence


# ---------------------------------------------------------------------------
# S — SUBSTITUTE: decision-frame headers
# ---------------------------------------------------------------------------

DECISION_FRAME_HEADERS_KO: dict[str, str] = {
    "verdict_label": "구매 전 검토 포인트",
    "strengths_label": "기대할 만한 포인트",
    "monitoring_label": "구매 전 확인 포인트",
    "hesitation_label": "이런 분은 한 번 더 검토하세요",
    "fit_label": "이런 사용 상황과 맞습니다",
    "interview_hook_label": "리서치 인터뷰 후보",
}


# ---------------------------------------------------------------------------
# E — ELIMINATE: ban list
# ---------------------------------------------------------------------------
# Generic phrases that should NEVER appear in generated text without
# specific evidence (a digit or quoted excerpt) in the same sentence.
# Phrases are matched as substrings after NFC normalization.
GENERIC_PHRASES_KO: tuple[str, ...] = (
    "호평이 반복됩니다",
    "호평이 반복되는",
    "호평이 두드러집니다",
    "호평이 관찰됩니다",
    "주의가 필요합니다",
    "주의가 필요한",
    "사용 패턴",
    "관련 호평",
    "관련 부정 의견",
    "반복적으로 관찰됩니다",
    "반복적으로 등장합니다",
    "일관되게 나타납니다",
    "일관되게 보입니다",
)
# Phrases that are weaker — ALLOWED with evidence, FLAGGED as advisory
# without. Used by the validator at advisory severity.
SOFT_GENERIC_PHRASES_KO: tuple[str, ...] = (
    "잘 맞았다는 의견",
)


# ---------------------------------------------------------------------------
# A — ADAPT: per-profile vocabulary emphasis / suppression
# ---------------------------------------------------------------------------

# SCAMPER A — profile-aware DISPLAY-label overrides. Canonical
# attribute keys (`pigmentation`, `dryness_skin_texture`, …) are
# never renamed — only the user-facing Korean label is replaced. A
# missing override falls back to whichever label the caller passes.
LABEL_OVERRIDES_BY_PROFILE: dict[str, dict[str, str]] = {
    "skincare_pad": {
        "adhesion_base_interaction":  "패드 밀착력",
        "finish_texture":             "촉촉함/마무리감",
        "dryness_skin_texture":       "건조감/당김",
        "packaging_container":        "용기/집게",
        "value_price":                "대용량/가성비",
        "persistence":                "수분 지속감",
    },
    "makeup_blush":  {},
    "default":       {},
}


def display_label_for(
    attribute_key: str,
    *,
    profile_id: str | None = None,
    fallback: str | None = None,
) -> str:
    """Resolve a profile-aware display label for a canonical attribute
    key. Override wins when present; otherwise returns `fallback`
    (the canonical short label the caller already computed). If
    fallback is None, returns the attribute key itself."""
    overrides = LABEL_OVERRIDES_BY_PROFILE.get(profile_id or "default", {})
    if attribute_key in overrides:
        return overrides[attribute_key]
    return fallback if fallback is not None else attribute_key


# SCAMPER C — quote-quality scoring. Picks the most decision-useful
# sample evidence rather than blindly choosing index 0. The scorer
# is a pure function over a list of dict-shaped evidence rows.
GENERIC_QUOTE_PENALTIES_KO: tuple[str, ...] = (
    "너무 만족",
    "정말 만족",
    "제품 진짜 좋아요",
    "정말 좋아요",
    "제품 좋아요",
    "생각보다 만족",
    "기대 이상",
    "최고예요",
    "최고에요",
    "굿굿",
    "좋네요",
    "추천합니다",
    "재구매 의사 있어요",
)
# Per-profile noun bonuses. Quotes mentioning these substrings are
# better signals because they carry decision-relevant context.
QUOTE_NOUN_BONUSES_KO: dict[str, tuple[str, ...]] = {
    "skincare_pad": (
        "대용량",
        "200매",
        "패드",
        "집게",
        "트위저",
        "케이스",
        "용기",
        "밀착",
        "촉촉",
        "건조",
        "마름",
        "당김",
        "각질",
        "토너",
        "에센스",
        "기획",
        "휴대용",
        "수분",
    ),
    "makeup_blush": (
        "발색",
        "지속",
        "묻어남",
        "브러시",
        "도구",
        "발림성",
    ),
    "default": (),
}


def score_quote_quality(
    quote: dict | str | None,
    *,
    profile_id: str | None = None,
) -> float:
    """Decimal score for one sample-evidence row.

    Higher is better. The scorer combines:
      - +1.0 per profile-relevant noun substring matched
      - -1.0 per generic-phrase substring matched
      - light length bonus (longer quotes carry more context, up to
        a point) — capped so a 200-char rant doesn't dominate
      - 0 for non-string / empty input

    Pure function. Tested in `test_editorial_rules.py`.
    """
    if quote is None:
        return 0.0
    text: str | None
    if isinstance(quote, str):
        text = quote
    elif isinstance(quote, dict):
        text = (
            quote.get("text")
            or quote.get("evidence_span")
            or quote.get("evidence_text")
        )
    else:
        return 0.0
    if not isinstance(text, str) or not text.strip():
        return 0.0
    nouns = QUOTE_NOUN_BONUSES_KO.get(
        profile_id or "default", QUOTE_NOUN_BONUSES_KO["default"],
    )
    score = 0.0
    for n in nouns:
        if n in text:
            score += 1.0
    for g in GENERIC_QUOTE_PENALTIES_KO:
        if g in text:
            score -= 1.0
    # Length bonus: 0 → 0, 30 → 0.3, 60+ → 0.6 (capped). Korean
    # reviews under ~15 chars are usually filler ("좋아요").
    length = len(text.strip())
    score += min(0.6, max(0.0, (length - 15.0) / 100.0))
    return round(score, 4)


# ---------------------------------------------------------------------------
# Slide-phrase table — profile- + attribute- + slide-role-aware
# ---------------------------------------------------------------------------
# Each profile maps `(attribute_key, slide_role)` → buyer-facing
# Korean phrase. Slide roles:
#
#   "loved"      — slide 2 prefix (combined: "{phrase} — 만족 후기 {n}건")
#   "fit_for"    — slide 4 audience description
#   "best_for"   — slide 6 for_bullets audience description
#   "watch_out"  — slide 5 complaint shape (combined: "{phrase} {n}건")
#   "not_for"    — slide 6 not_for_bullets sensitivity description
#                  (combined: "{phrase} ({n}건)")
#
# Missing entries fall through to a count-only fallback in the
# slide builder. Designed for skincare_pad first; other profiles
# can extend.
SLIDE_PHRASES_BY_PROFILE: dict[str, dict[str, dict[str, str]]] = {
    "skincare_pad": {
        "value_price": {
            "loved":     "200매 대용량 가성비",
            "fit_for":   "대용량 패드를 자주 쓰고 싶은 분",
            "best_for":  "200매 가성비를 자주 쓰고 싶은 분",
            # `효과` is on the medical-claim ban list; use `체감`
            # (feeling/sensation) — same buyer intent, no efficacy
            # implication.
            "watch_out": "가격 대비 체감 의견 갈림",
            "not_for":   "즉각 변화 기대가 큰 분",
        },
        "finish_texture": {
            "loved":     "한 장으로 촉촉함",
            "fit_for":   "촉촉함이 우선인 데일리 사용자",
            "best_for":  "한 장으로 촉촉 보강이 필요한 분",
            "watch_out": "오래 붙이면 답답하다는 후기",
            "not_for":   "오래 붙였을 때 답답함에 민감한 분",
        },
        "dryness_skin_texture": {
            "loved":     "당김 없는 마무리",
            "fit_for":   "평소 건조한 피부에 보습 보강용",
            "best_for":  "건조한 피부에 보습 보강이 필요한 분",
            "watch_out": "사용 후 당김 호소",
            "not_for":   "당김에 민감한 분",
        },
        "adhesion_base_interaction": {
            "loved":     "부드럽게 밀착되는 패드",
            "fit_for":   "결 정돈에 가벼운 패드를 원하는 분",
            "best_for":  "가벼운 결 정돈을 원하는 분",
            "watch_out": "밀착력 부족 후기",
            "not_for":   "강한 밀착감을 기대하는 분",
        },
        "packaging_container": {
            "loved":     "용기 구성",
            "fit_for":   "휴대하며 쓰고 싶은 분",
            "best_for":  "휴대용 케이스가 필요한 분",
            "watch_out": "용기/집게 사용 불편 후기",
            "not_for":   "용기·집게 위생이 중요한 분",
        },
        "persistence": {
            "loved":     "수분 지속감",
            "fit_for":   "긴 수분 유지를 원하는 분",
            "best_for":  "수분 유지가 중요한 분",
            "watch_out": "수분 지속감 의견 갈림",
            "not_for":   "수분 유지 시간이 긴 제품을 찾는 분",
        },
    },
    "makeup_blush": {},
    "default": {},
}


def slide_phrase_for(
    *,
    profile_id: str | None,
    attribute_key: str,
    slide_role: str,
    fallback: str | None = None,
) -> str | None:
    """Resolve the buyer-facing phrase for a (profile, attribute,
    slide-role) triple. Returns `fallback` (which may be None) when
    no override is configured. Pure function — easy to unit-test."""
    if not attribute_key or not slide_role:
        return fallback
    table = SLIDE_PHRASES_BY_PROFILE.get(profile_id or "default", {})
    entry = table.get(attribute_key) or {}
    phrase = entry.get(slide_role)
    if isinstance(phrase, str) and phrase.strip():
        return phrase.strip()
    return fallback


def select_best_quote(
    quotes: "list[dict] | tuple[dict, ...] | None",
    *,
    profile_id: str | None = None,
) -> dict | None:
    """Return the highest-scoring quote dict from a list, ties broken
    by original order. None when input is empty or every entry has a
    falsy text. Pure function."""
    if not quotes:
        return None
    scored: list[tuple[float, int, dict]] = []
    for i, q in enumerate(quotes):
        if not isinstance(q, dict):
            continue
        s = score_quote_quality(q, profile_id=profile_id)
        scored.append((s, -i, q))  # higher score first; tie → earlier index
    if not scored:
        return None
    scored.sort(reverse=True)
    return scored[0][2]


CATEGORY_VOCABULARY_KO: dict[str, dict[str, tuple[str, ...]]] = {
    "skincare_pad": {
        "emphasis": (
            "촉촉",
            "보습",
            "수분 유지",
            "패드 두께",
            "패드 재질",
            "밀착",
            "정착력",
            "에센스 양",
            "에센스 머금음",
            "용기 위생",
            "트위저",
            "꺼내기",
            "데일리",
            "한 통 사용감",
        ),
        # Phrases that read as makeup-coded; suppress in skincare-pad
        # output even if they appear elsewhere (label dictionary etc.).
        "suppress": (
            "발색",
            "색감",
            "컬러 매치",
            "웜톤",
            "쿨톤",
            "립크림",
            "립스틱",
            "마무리감",
        ),
    },
    "makeup_blush": {
        "emphasis": (
            "발색",
            "지속력",
            "묻어남",
            "도구",
            "브러시",
            "발림성",
            "건조감",
        ),
        "suppress": (),
    },
    "default": {
        "emphasis": (),
        "suppress": (),
    },
}


def category_vocabulary_for(
    profile_id: str | None,
) -> dict[str, tuple[str, ...]]:
    """Lookup the SCAMPER-A vocabulary for a profile id. Unknown
    profile falls back to the default (empty) vocabulary."""
    return CATEGORY_VOCABULARY_KO.get(
        profile_id or "default",
        CATEGORY_VOCABULARY_KO["default"],
    )


# ---------------------------------------------------------------------------
# P — PUT TO ANOTHER USE: friction → interview hook
# ---------------------------------------------------------------------------

INTERVIEW_HOOK_TEMPLATES_KO: dict[str, str] = {
    "packaging_container": "용기/트위저 사용 불편 — 위생 / 꺼내기 / 마지막까지 사용",
    "applicator_tool": "도구 사용 불편 — 도구 별도 구매 / 분실 / 위생",
    "dryness_skin_texture": "도포 직후 건조함 — 보습 라인 병용 / 흡수 시간 / 마무리 텍스처",
    "persistence": "지속력 후기 — 마스크 묻어남 / 재도포 빈도 / 수정 화장",
    "transfer_resistance": "묻어남 — 마스크 / 베개 / 손",
    "adhesion_base_interaction": "정착력 — 베이스/선크림 위 들뜸 / 밀착 차이",
    "finish_texture": "마무리 텍스처 — 흡수 후 끈적임 / 답답함 / 백탁",
    "value_price": "가격 대비 만족도 — 용량 / 사용 빈도 / 재구매 의향",
}


def interview_hook_for(attribute_key: str | None) -> str | None:
    """Return the interview-hook template for an attribute key.
    Unknown attributes return None (caller falls back to the
    generic concern label)."""
    if not attribute_key:
        return None
    return INTERVIEW_HOOK_TEMPLATES_KO.get(attribute_key)


# ---------------------------------------------------------------------------
# C — COMBINE: collapse multiple evidence sources
# ---------------------------------------------------------------------------


def combine_evidence_sources(
    *,
    analysis_report: Mapping | None,
    brief: Mapping | None = None,
    unique_insights: Mapping | None = None,
) -> dict:
    """Collapse the available editorial inputs into a single
    `{strengths, monitoring, tradeoffs, unique}` dict.

    Order of precedence inside each bucket:
      1. `unique_insights.insights[]` typed-by-bucket (when present
         and validated).
      2. `analysis_report.strengths` / `monitoring_candidates` /
         `tradeoffs`.
      3. Fallback to `analysis_report.attributes[].top_quotes` when
         strengths/monitoring blocks are empty.

    Pure: returns a fresh dict; never mutates inputs.
    """
    out: dict = {
        "strengths": [],
        "monitoring": [],
        "tradeoffs": [],
        "unique": [],
        "has_unique_insights": False,
    }
    ar = analysis_report or {}
    out["strengths"] = list(ar.get("strengths") or [])
    out["monitoring"] = list(ar.get("monitoring_candidates") or [])
    out["tradeoffs"] = list(ar.get("tradeoffs") or [])
    if not out["strengths"] and not out["monitoring"]:
        for attr in ar.get("attributes") or []:
            quotes = attr.get("top_quotes") or []
            if not quotes:
                continue
            n_pos = int(attr.get("n_positive") or 0)
            n_neg = int(attr.get("n_negative") or 0)
            if n_pos > n_neg and n_pos > 0:
                out["strengths"].append({
                    "attribute_key": attr.get("key"),
                    "supporting_count": n_pos,
                    "representative_quote": quotes[0] if quotes else None,
                })
            if n_neg > 0:
                neg_quotes = [
                    q for q in quotes
                    if (q.get("polarity") or "").startswith("negative")
                ]
                out["monitoring"].append({
                    "attribute_key": attr.get("key"),
                    "n_negative": n_neg,
                    "top_negative_quotes": neg_quotes[:3],
                })
    if unique_insights and isinstance(unique_insights, Mapping):
        ui = unique_insights.get("insights") or []
        if isinstance(ui, list) and ui:
            out["unique"] = list(ui)
            out["has_unique_insights"] = True
    if brief and isinstance(brief, Mapping):
        out["brief"] = dict(brief)
    return out


# ---------------------------------------------------------------------------
# M — MODIFY: contrast verdict
# ---------------------------------------------------------------------------


def _attribute_label(s: Mapping, fallback_key: str | None = None) -> str:
    """Pull a Korean label off a strength / monitoring entry. Falls
    back to the attribute key when no label is present."""
    label = s.get("concern_label_ko") or s.get("label_ko")
    if isinstance(label, str) and label.strip():
        return label.strip()
    return str(s.get("attribute_key") or fallback_key or "").strip()


def build_contrast_verdict(
    *,
    strengths: Sequence[Mapping],
    monitoring: Sequence[Mapping],
) -> str:
    """Produce a single-sentence verdict with concrete contrast.

    Examples (skincare pad case):
        strengths=[{persistence, n_positive=210, ...}],
        monitoring=[{dryness_skin_texture, n_negative=87, ...}]
        →   "지속력 만족 후기 210건이 보이지만, 건조함 불만 후기도
             87건 함께 누적됩니다."

    No strengths AND no monitoring → review-volume note. The
    function NEVER produces a banned generic phrase; downstream
    validator will assert this with a regression test.
    """
    s_list = list(strengths or [])
    m_list = list(monitoring or [])
    if s_list and m_list:
        s = s_list[0]
        m = m_list[0]
        s_label = _attribute_label(s)
        m_label = _attribute_label(m)
        s_count = int(s.get("supporting_count") or 0)
        m_count = int(m.get("n_negative") or 0)
        return (
            f"{s_label} 만족 후기 {s_count}건이 보이지만, "
            f"{m_label} 불만 후기도 {m_count}건 함께 누적됩니다."
        )
    if s_list:
        s = s_list[0]
        return (
            f"{_attribute_label(s)} 만족 후기가 "
            f"{int(s.get('supporting_count') or 0)}건 누적됩니다."
        )
    if m_list:
        m = m_list[0]
        return (
            f"{_attribute_label(m)} 불만 후기가 "
            f"{int(m.get('n_negative') or 0)}건 누적됩니다."
        )
    return "리뷰량이 부족해 일관된 신호가 보이지 않습니다."


# ---------------------------------------------------------------------------
# R — REVERSE: hesitation lines
# ---------------------------------------------------------------------------


def build_hesitation_lines(
    monitoring: Sequence[Mapping],
    *,
    profile_id: str | None = None,
    limit: int = 3,
) -> list[str]:
    """Return up to `limit` "이런 분은 한 번 더 검토하세요" lines
    keyed off monitoring concerns. Each line carries a specific
    count so the editorial validator's evidence-pair check passes.

    Profile-aware: when `profile_id` matches a known category, the
    line uses the category's preferred wording fragment.
    """
    lines: list[str] = []
    for m in monitoring or []:
        if len(lines) >= limit:
            break
        label = _attribute_label(m)
        n_neg = int(m.get("n_negative") or 0)
        if not label or n_neg <= 0:
            continue
        # Profile-aware nudge: skincare_pad emphasizes daily-use
        # sensitivity; default keeps the general phrasing.
        if profile_id == "skincare_pad":
            lines.append(
                f"{label}에 민감하신 분은 한 번 더 검토하세요 "
                f"(불만 후기 {n_neg}건)"
            )
        else:
            lines.append(
                f"{label}이(가) 중요하신 분은 한 번 더 검토하세요 "
                f"(불만 후기 {n_neg}건)"
            )
    return lines


# ---------------------------------------------------------------------------
# E — ELIMINATE: validator
# ---------------------------------------------------------------------------

# Sentence boundary regex. Korean text uses '.' '!' '?' plus newline
# breaks. Numbers `\d` and quoted excerpts `"..."` / `「…」` count as
# evidence inside the same sentence.
_SENTENCE_BOUNDARY_RE = re.compile(r"(?<=[\.\!\?。…])\s+|\n+")
_HAS_EVIDENCE_RE = re.compile(
    r"(\d|[\"“”「」『』])",
)


def _split_sentences(text: str) -> list[str]:
    if not text:
        return []
    parts = _SENTENCE_BOUNDARY_RE.split(text.strip())
    return [p.strip() for p in parts if p and p.strip()]


def find_unsupported_generic_phrases(
    text: str | None,
    *,
    extra_banned: Iterable[str] = (),
    treat_soft_as_blocking: bool = False,
) -> list[dict]:
    """Return one dict per occurrence of a generic phrase that is
    NOT paired with specific evidence in the same sentence.

    Each dict has:
        {"phrase": str, "sentence": str, "severity": "block"|"advisory"}

    Evidence inside a sentence:
      - any decimal digit (`\\d`), or
      - a Korean / ASCII quotation mark (`"…"`, `「…」`, `『…』`).

    When `treat_soft_as_blocking` is True, soft-generic phrases
    (`잘 맞았다는 의견` etc.) are returned with severity="block";
    otherwise they're returned with "advisory".

    Pure function. Caller decides what to do with the result.
    """
    if not text:
        return []
    banned: tuple[str, ...] = tuple(GENERIC_PHRASES_KO) + tuple(extra_banned)
    out: list[dict] = []
    for sent in _split_sentences(text):
        has_evidence = bool(_HAS_EVIDENCE_RE.search(sent))
        for phrase in banned:
            if phrase in sent and not has_evidence:
                out.append({
                    "phrase": phrase,
                    "sentence": sent,
                    "severity": "block",
                })
        for phrase in SOFT_GENERIC_PHRASES_KO:
            if phrase in sent and not has_evidence:
                out.append({
                    "phrase": phrase,
                    "sentence": sent,
                    "severity": "block" if treat_soft_as_blocking else "advisory",
                })
    return out


# ---------------------------------------------------------------------------
# Polish-prompt fragment
# ---------------------------------------------------------------------------

POLISH_PROMPT_FRAGMENT_KO: str = """
[SCAMPER 편집 제약]
- 본 콘텐츠는 "리뷰 요약"이 아니라 "구매 전 의사결정 자료"입니다.
- 다음 표현은 구체 수치(예: "32건")나 직접 인용(따옴표) 없이 사용 금지:
  호평이 반복됩니다 / 호평이 두드러집니다 / 관련 호평 / 관련 부정 의견 /
  주의가 필요합니다 / 사용 패턴 / 반복적으로 관찰됩니다 /
  반복적으로 등장합니다 / 일관되게 나타납니다.
- 구체 비교쌍을 우선합니다. 예:
  Bad : "마무리감 관련 호평이 반복됩니다"
  Good: "촉촉하다는 평은 많지만, 오래 붙이면 건조하다는 의견도
         반복됩니다."
- "이런 분은 한 번 더 검토하세요" / "이런 상황엔 맞지 않을 수 있어요"
  같은 망설임(reverse) 항목을 강점만큼 비중 있게 다루십시오.
"""
