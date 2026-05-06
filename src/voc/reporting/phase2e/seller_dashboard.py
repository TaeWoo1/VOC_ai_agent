"""Seller-facing business dashboard data builders.

Pass-19I restructure: the seller PDF previously read like a review
compilation — Executive Summary that re-stated counts, a 3×3
Satisfaction × Friction Matrix dense with attribute names, a
"Buyer Content Translation" section with copy-suggestion phrasing
that didn't belong in an outbound report. Operators couldn't see at
a glance what's working / what needs work / what to do first.

This module produces the *data* that drives the new sections.
Section helpers in `scripts/generate_phase2e_pdf_v2.py` consume the
data here and render flowables. Splitting data out keeps the new
section logic pure-Python (no ReportLab) and unit-testable.

New sections (order = render order):

  1. Executive Summary   — verdict + top 2 strengths + top 2 frictions
                           + top 3 actions + caveat
  2. Signal Dashboard    — KEEP / FIX / CLARIFY / MONITOR buckets +
                           Priority Map (the demoted Matrix)
  3. What's Working      — strengths with 3-line structure
                           (loved / why-it-helps / preserve-cautions)
  4. What Needs Attention — frictions with 3-line structure
                           (concern / business-impact / questions)
  5. Seller Action Plan  — 5-column table (priority, owner, action,
                           evidence, expected outcome). REPLACES
                           Buyer Content Translation entirely.
  6. Methodology & Limitations (unchanged from prior renderer)
  7. Appendix (unchanged)

Hard rules
----------
- No ReportLab imports here. Pure data.
- Profile-aware: lip_makeup vs base_makeup vs skincare_pad pull
  different action templates / friction angles. Default profile
  uses fallback_generic phrasing.
- Banned-phrase quality gate (`scan_for_banned_phrases`) is the
  test contract: sections 1–5 must produce zero matches.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable


# Bucket labels (KEEP / FIX / CLARIFY / MONITOR) shown on the Signal
# Dashboard. Each bucket has a Korean operator-facing label; the
# constant string is also the test-stable identifier.
BUCKET_KEEP: str = "KEEP"
BUCKET_FIX: str = "FIX"
BUCKET_CLARIFY: str = "CLARIFY"
BUCKET_MONITOR: str = "MONITOR"

BUCKET_LABEL_KO: dict[str, str] = {
    BUCKET_KEEP: "유지할 강점 (KEEP)",
    BUCKET_FIX: "개선 검토 (FIX)",
    BUCKET_CLARIFY: "상세페이지·옵션 보완 (CLARIFY)",
    BUCKET_MONITOR: "추적 관찰 (MONITOR)",
}

# Per-bucket short interpretation phrase (one-liner the dashboard
# row prints under the bucket name).
BUCKET_INTERPRETATION_KO: dict[str, str] = {
    BUCKET_KEEP: "구매 동기로 작동 중. 콘텐츠/리스팅에서 계속 부각.",
    BUCKET_FIX: "재구매·만족 저하와 직결. 우선 개선 검토 필요.",
    BUCKET_CLARIFY: "기대치 차이가 핵심. 상세페이지·옵션 설명 보완.",
    BUCKET_MONITOR: "신호량 적음. 누적 추이 관찰.",
}

# Quality-gate constants. The bucket-classifier uses these to decide
# KEEP vs FIX vs CLARIFY vs MONITOR. Tuned conservative — operators
# would rather see a CLARIFY than a hard FIX call when the signal is
# polarized.
_MIN_TOTAL_FOR_NON_MONITOR: int = 5
_KEEP_NEG_CEILING: int = 2
_FIX_NEG_FLOOR: int = 5


def classify_signal_bucket(
    *,
    n_positive: int,
    n_negative: int,
    n_mixed: int = 0,
) -> str:
    """Classify a single attribute's signal into KEEP / FIX /
    CLARIFY / MONITOR.

    Rules (top wins):
      * total < 5 → MONITOR (not enough signal)
      * pos ≥ 5 AND neg ≤ 2 → KEEP
      * neg ≥ 5 AND neg ≥ pos → FIX
      * pos ≥ 3 AND neg ≥ 3 → CLARIFY (polarized — expectation gap)
      * neg > pos → FIX
      * pos > neg → KEEP
      * else → MONITOR
    """
    pos = max(int(n_positive or 0), 0)
    neg = max(int(n_negative or 0), 0)
    mixed = max(int(n_mixed or 0), 0)
    total = pos + neg + mixed
    if total < _MIN_TOTAL_FOR_NON_MONITOR:
        return BUCKET_MONITOR
    if pos >= _MIN_TOTAL_FOR_NON_MONITOR and neg <= _KEEP_NEG_CEILING:
        return BUCKET_KEEP
    if neg >= _FIX_NEG_FLOOR and neg >= pos:
        return BUCKET_FIX
    if pos >= 3 and neg >= 3:
        return BUCKET_CLARIFY
    if neg > pos:
        return BUCKET_FIX
    if pos > neg:
        return BUCKET_KEEP
    return BUCKET_MONITOR


# Owner area routing per (attribute_key, profile_id). Maps to one of:
#   상세페이지 / 옵션·컬러 / CS·FAQ / 제품기획 / 패키지 / R&D /
#   옵션·마케팅
# Operators can re-assign at delivery; this is the default suggestion.
_OWNER_BY_ATTR_LIP: dict[str, str] = {
    "pigmentation": "상세페이지",
    "color_tone_matching": "옵션·컬러",
    "application_blending": "제품기획",
    "finish_texture": "제품기획",
    "dryness_skin_texture": "CS·FAQ",
    "persistence": "CS·FAQ",
    "transfer_resistance": "CS·FAQ",
    "adhesion_base_interaction": "제품기획",
    "scent_taste": "CS·FAQ",
    "packaging_container": "패키지",
    "value_price": "옵션·마케팅",
    "applicator_tool": "제품기획",
    "multi_use_lip_cheek_compatibility": "상세페이지",
}

_OWNER_BY_ATTR_BASE: dict[str, str] = {
    "pigmentation": "상세페이지",
    "color_tone_matching": "옵션·컬러",
    "application_blending": "제품기획",
    "finish_texture": "제품기획",
    "dryness_skin_texture": "제품기획",
    "persistence": "제품기획",
    "transfer_resistance": "CS·FAQ",
    "adhesion_base_interaction": "제품기획",
    "applicator_tool": "패키지",
    "packaging_container": "패키지",
    "value_price": "옵션·마케팅",
}

_OWNER_BY_ATTR_FALLBACK: dict[str, str] = {
    # Conservative default — anything we don't map specifically goes
    # to "상세페이지" because that's the cheapest, lowest-risk lever.
}


def select_owner(attribute_key: str, *, profile_id: str | None) -> str:
    """Suggest an action owner for an attribute. Profile-aware so a
    lip product's pigmentation routes to 상세페이지 (color expectation
    management) but a base-makeup product's pigmentation routes to
    상세페이지 too — the difference matters most for adhesion /
    persistence (lip → CS·FAQ; base → 제품기획).
    """
    pid = (profile_id or "").strip() or "default"
    if pid == "lip_makeup":
        m = _OWNER_BY_ATTR_LIP
    elif pid == "base_makeup":
        m = _OWNER_BY_ATTR_BASE
    else:
        m = {}
    return (
        m.get(attribute_key)
        or _OWNER_BY_ATTR_FALLBACK.get(attribute_key)
        or "상세페이지"
    )


# ---------- Profile-aware text fragments --------------------------------
#
# Strength angles ("What's Working") and friction angles
# ("What Needs Attention") encode the *interpretation* the operator
# reads — NOT raw quote text and NOT generic last-resort filler.
#
# lip_makeup uses lip-anchored vocabulary (광택 / 끈적임 / 입술톤 /
# 식사 후 색 유지) per the user-locked spec. base_makeup uses
# 피부 표현 / 다크닝 / 무너짐. Default profile gets a generic
# attribute-named fragment.

_LIP_STRENGTH_ANGLE: dict[str, dict[str, str]] = {
    "pigmentation": {
        "loved": "선명한 발색이 구매 만족 신호로 작동",
        "business_value": "구매 후 첫 인상에서 색 만족이 재구매 의향과 연결",
        "preserve_caution": "레이어링 횟수에 따른 발색 강도 차이는 콘텐츠로 안내",
    },
    "color_tone_matching": {
        "loved": "특정 톤(쿨/웜)에서 만족 신호가 강함",
        "business_value": "톤별 만족 패턴이 컬러 추가/리뉴얼 의사결정에 활용 가능",
        "preserve_caution": "본래 입술톤에 따라 체감 차이가 있어 톤별 컷 보강 필요",
    },
    "finish_texture": {
        "loved": "광택감과 끈적임 적은 마무리감이 사용 만족을 만든다",
        "business_value": "마무리 만족이 데일리 사용 빈도/재구매로 이어짐",
        "preserve_caution": "끈적임 민감 고객은 별도 안내 컷이 도움",
    },
    "adhesion_base_interaction": {
        "loved": "입술에 매끈하게 밀착되고 광택이 자연스럽게 유지",
        "business_value": "밀착감/광택 유지가 구매 후 첫 사용 만족도에 결정적",
        "preserve_caution": "장시간 사용 시 들뜸 사례는 사용 환경 안내로 보완",
    },
    "application_blending": {
        "loved": "부드럽게 발리고 입술에 편하게 밀착",
        "business_value": "도포 안정성이 데일리 사용 진입 장벽을 낮춤",
        "preserve_caution": "두껍게 덧바를 때 뭉침/경계 사례는 사전 안내",
    },
    "transfer_resistance": {
        "loved": "컵·마스크 묻어남이 적다는 의견",
        "business_value": "묻어남 적음이 외출/식사 사용 만족과 직결",
        "preserve_caution": "오랜 사용 후 묻어남 사례는 사용 시점 안내",
    },
    "persistence": {
        "loved": "색이 오래 남고 착색 유지력이 좋다는 의견",
        "business_value": "지속력 만족이 재구매 의향 핵심 동인",
        "preserve_caution": "식사·음료 후 사례는 별도 기준 안내",
    },
    "scent_taste": {
        "loved": "향·맛이 부담스럽지 않다는 의견",
        "business_value": "향 민감 고객 재구매 진입 가능성 확대",
        "preserve_caution": "강한 향 선호 고객은 다른 SKU로 분기",
    },
    "packaging_container": {
        "loved": "패키지 디자인과 휴대성 만족",
        "business_value": "선물·휴대 사용 시나리오 추가 마케팅 가능",
        "preserve_caution": "용기 누수/오염 사례는 사용 안내로 보완",
    },
    "value_price": {
        "loved": "가격 대비 컬러와 사용감 만족도가 높다는 의견",
        "business_value": "가성비 만족이 첫 구매 진입 장벽을 낮춤",
        "preserve_caution": "용량 기대 차이는 가격대 비교 콘텐츠로 보완",
    },
}

_LIP_FRICTION_ANGLE: dict[str, dict[str, str]] = {
    "pigmentation": {
        "concern": "기대 색상과 실제 입술 발색 차이",
        "business_impact": "구매 직후 실망 → 재구매율 저하 / 환불 요청",
        "questions": "레이어링 컷·본래 입술톤별 발색 컷이 상세페이지에 충분한가?",
    },
    "color_tone_matching": {
        "concern": "본래 입술톤에 따른 색 차이 / 컬러칩 간극",
        "business_impact": "컬러 선택 실패 → 옵션 변경/환불",
        "questions": "쿨/웜톤별 모델 컷, 컬러칩과 실제 발색 비교 컷 있는가?",
    },
    "finish_texture": {
        "concern": "끈적임·답답함·무거운 사용감 아쉬움",
        "business_impact": "데일리 사용 빈도 저하 → 재구매 약화",
        "questions": "끈적임 민감 고객용 안내 / 라이트 핏 옵션 있는가?",
    },
    "adhesion_base_interaction": {
        "concern": "밀착이 약하거나 시간이 지나며 들뜸·밀림",
        "business_impact": "사용 중 수정 빈도 증가 → 만족도 저하",
        "questions": "밀착 유지 시간·사용 환경별 사례를 안내했는가?",
    },
    "application_blending": {
        "concern": "뭉침·얼룩짐·경계 남음",
        "business_impact": "첫 도포 실패 → 부정 후기/CS 증가",
        "questions": "도포 팁(레이어 횟수·블렌딩 도구) 안내가 있는가?",
    },
    "transfer_resistance": {
        "concern": "컵·마스크·치아 묻어남",
        "business_impact": "외출/식사 사용 만족 저하 → 재구매율 저하",
        "questions": "묻어남 기준(시간·사용 환경) 안내가 있는가?",
    },
    "persistence": {
        "concern": "식사·음료 후 색 유지 기대 차이 / 수정 필요성",
        "business_impact": "지속력 기대 불일치 → 재구매율 저하",
        "questions": "식사 전후 사진/시간 단위 지속 기준 안내가 있는가?",
    },
    "dryness_skin_texture": {
        "concern": "시간 경과 후 각질·입술 주름 부각",
        "business_impact": "건성/각질 고객 부정 후기 누적 → 신뢰도 하락",
        "questions": "건조 민감 고객용 컨디셔닝 가이드가 있는가?",
    },
    "scent_taste": {
        "concern": "향·맛 강도가 부담",
        "business_impact": "향 민감 고객 첫 사용 단계에서 이탈",
        "questions": "향 강도 표기/저향 옵션 안내가 있는가?",
    },
    "packaging_container": {
        "concern": "용기 사용감/누수/포장 상태",
        "business_impact": "포장 클레임 → CS 부담 증가",
        "questions": "출고 검수 기준·휴대 시 누수 방지 안내가 있는가?",
    },
    "value_price": {
        "concern": "가격 대비 용량/지속력 기대 미충족",
        "business_impact": "가격 저항 → 구매 전환율 하락",
        "questions": "가격대 비교/용량 단가 콘텐츠가 있는가?",
    },
}

_BASE_FRICTION_ANGLE: dict[str, dict[str, str]] = {
    "persistence": {
        "concern": "무너짐·다크닝·수정화장 빈도",
        "business_impact": "외출 시간·수정 부담 → 재구매율 저하",
        "questions": "외출 시간별 수정 빈도 안내가 있는가?",
    },
    "color_tone_matching": {
        "concern": "구매 전 기대 색상과 실제 피부톤 차이",
        "business_impact": "호수 선택 실패 → 환불·교환",
        "questions": "쿨/웜톤별 모델 컷이 있는가?",
    },
    # Base profile already has good friction phrases through the
    # `_TRADEOFF_BLOCKS_BASE_MAKEUP` table elsewhere; this is just the
    # subset the seller_dashboard surfaces.
}

_DEFAULT_FRICTION_ANGLE_FALLBACK = {
    "concern": "{label} 관련 반복 신호",
    "business_impact": "구매·재구매에 영향 가능",
    "questions": "사용 환경/시점별 차이를 다시 한 번 확인하세요",
}


def friction_angle_for(
    attribute_key: str,
    *,
    profile_id: str | None,
    label_ko: str,
) -> dict[str, str]:
    """Return concern / business_impact / questions for the
    "What Needs Attention" item. Profile-aware fallback chain:
    profile_dict → fallback_generic.
    """
    pid = (profile_id or "").strip() or "default"
    if pid == "lip_makeup":
        per = _LIP_FRICTION_ANGLE.get(attribute_key)
        if per:
            return per
    if pid == "base_makeup":
        per = _BASE_FRICTION_ANGLE.get(attribute_key)
        if per:
            return per
    # Generic fallback — the user-locked banned-phrase scanner picks
    # up "사용 환경/시점별 차이를 다시 한 번 확인" so this fragment is
    # not used for lip_makeup. For default it's acceptable.
    return {
        "concern": f"{label_ko} 관련 반복 신호",
        "business_impact": "구매·재구매에 영향 가능",
        "questions": f"{label_ko} 신호 패턴을 추가 분석하세요",
    }


def strength_angle_for(
    attribute_key: str,
    *,
    profile_id: str | None,
    label_ko: str,
) -> dict[str, str]:
    """Return loved / business_value / preserve_caution for the
    "What's Working" item.
    """
    pid = (profile_id or "").strip() or "default"
    if pid == "lip_makeup":
        per = _LIP_STRENGTH_ANGLE.get(attribute_key)
        if per:
            return per
    return {
        "loved": f"{label_ko} 관련 만족 신호 누적",
        "business_value": "구매 만족 / 재구매 의향에 긍정 작용",
        "preserve_caution": f"{label_ko} 만족 사례를 콘텐츠로 보강",
    }


# Action templates per (profile_id, attribute_key, bucket).
# These produce the text columns of the Seller Action Plan table.
# Bucket controls phrasing: FIX → "개선 검토" wording; CLARIFY →
# "안내 보강"; KEEP → "콘텐츠 부각".

@dataclass
class ActionTemplate:
    action_text: str
    expected_outcome: str


_LIP_FIX_ACTIONS: dict[str, ActionTemplate] = {
    "pigmentation": ActionTemplate(
        action_text="입술톤별 발색컷 / 레이어링 컷 보강",
        expected_outcome="구매 전 기대 색상 오차 감소",
    ),
    "color_tone_matching": ActionTemplate(
        action_text="컬러별 톤 설명 재정리 (쿨/웜 라벨링)",
        expected_outcome="호수·컬러 선택 실패 감소",
    ),
    "persistence": ActionTemplate(
        action_text="식사 후 지속·착색 기준 안내",
        expected_outcome="지속력 기대치 조정 / 환불 감소",
    ),
    "dryness_skin_texture": ActionTemplate(
        action_text="각질 부각 가능 조건 안내 (시간·컨디션)",
        expected_outcome="건성·각질 고객 불만 예방",
    ),
    "application_blending": ActionTemplate(
        action_text="도포 팁 (레이어 횟수·블렌딩) 콘텐츠 추가",
        expected_outcome="첫 도포 실패율 감소",
    ),
    "transfer_resistance": ActionTemplate(
        action_text="묻어남 사용 환경 안내 (마스크·식사)",
        expected_outcome="묻어남 기대치 사전 정렬",
    ),
    "finish_texture": ActionTemplate(
        action_text="끈적임·답답함 분기 분석",
        expected_outcome="마무리감 컴플레인 감소",
    ),
    "adhesion_base_interaction": ActionTemplate(
        action_text="광택 유지 시간·들뜸 사례 분석",
        expected_outcome="밀착감 유지력 개선 후보 도출",
    ),
    "scent_taste": ActionTemplate(
        action_text="향 강도 표기 / 저향 옵션 안내",
        expected_outcome="향 민감 고객 만족도 개선",
    ),
    "packaging_container": ActionTemplate(
        action_text="용기 누수·포장 상태 검수 기준 점검",
        expected_outcome="포장 클레임 감소",
    ),
    "value_price": ActionTemplate(
        action_text="가격 대비 용량·지속력 비교 콘텐츠",
        expected_outcome="가격 저항 완화",
    ),
}

_LIP_CLARIFY_ACTIONS: dict[str, ActionTemplate] = {
    "pigmentation": ActionTemplate(
        action_text="기대 색상과 실제 발색 차이를 안내하는 컷 보강",
        expected_outcome="컬러 기대치 정렬",
    ),
    "color_tone_matching": ActionTemplate(
        action_text="입술톤별 컬러 매칭 가이드 추가",
        expected_outcome="구매 결정 신뢰 향상",
    ),
    "persistence": ActionTemplate(
        action_text="지속·수정 빈도 기준 안내",
        expected_outcome="기대치 차이 해소",
    ),
}

_LIP_KEEP_ACTIONS: dict[str, ActionTemplate] = {
    "finish_texture": ActionTemplate(
        action_text="광택감·촉촉함 만족 후기 콘텐츠로 부각",
        expected_outcome="구매 동기 강화",
    ),
    "adhesion_base_interaction": ActionTemplate(
        action_text="입술 밀착감/광택 유지 컷 강조",
        expected_outcome="첫 인상 만족 강조",
    ),
    "pigmentation": ActionTemplate(
        action_text="선명 발색 강점을 키 컬러 콘텐츠로 활용",
        expected_outcome="구매 의향 상승",
    ),
}


def action_template_for(
    attribute_key: str,
    bucket: str,
    *,
    profile_id: str | None,
    label_ko: str,
) -> ActionTemplate:
    """Return the action / expected_outcome strings for an action
    plan row. Profile-aware with sensible fallback so a missing
    template never produces empty cells.
    """
    pid = (profile_id or "").strip() or "default"
    table = None
    if pid == "lip_makeup":
        if bucket == BUCKET_FIX:
            table = _LIP_FIX_ACTIONS
        elif bucket == BUCKET_CLARIFY:
            table = _LIP_CLARIFY_ACTIONS
        elif bucket == BUCKET_KEEP:
            table = _LIP_KEEP_ACTIONS
    if table:
        tpl = table.get(attribute_key)
        if tpl:
            return tpl
    # Fallbacks — keep the wording attribute-anchored so the table
    # never shows a generic "관련 만족 의견" stub.
    if bucket == BUCKET_FIX:
        return ActionTemplate(
            action_text=f"{label_ko} 아쉬움 패턴 분석 후 개선 후보 도출",
            expected_outcome="해당 이슈 재발률 감소",
        )
    if bucket == BUCKET_CLARIFY:
        return ActionTemplate(
            action_text=f"{label_ko} 기대치 정렬 콘텐츠 보강",
            expected_outcome="기대-실제 차이 해소",
        )
    if bucket == BUCKET_KEEP:
        return ActionTemplate(
            action_text=f"{label_ko} 강점을 콘텐츠로 부각",
            expected_outcome="구매 동기 강화",
        )
    return ActionTemplate(
        action_text=f"{label_ko} 신호 추적",
        expected_outcome="누적 추이 관찰",
    )


# ---------- Section data dataclasses -------------------------------------


@dataclass
class SignalRow:
    """One row of the Signal Dashboard (KEEP/FIX/CLARIFY/MONITOR)."""
    attribute_key: str
    label_ko: str
    bucket: str
    n_positive: int
    n_negative: int
    n_mixed: int
    seller_interpretation: str
    owner: str


@dataclass
class StrengthItem:
    """One row of "What's Working"."""
    attribute_key: str
    label_ko: str
    n_positive: int
    loved: str
    business_value: str
    preserve_caution: str


@dataclass
class FrictionItem:
    """One row of "What Needs Attention"."""
    attribute_key: str
    label_ko: str
    n_negative: int
    concern: str
    business_impact: str
    questions: str


@dataclass
class ActionItem:
    """One row of the Seller Action Plan table."""
    priority: str             # P1 / P2 / P3
    owner: str
    action_text: str
    evidence: str
    expected_outcome: str
    attribute_key: str        # for traceability — not rendered


@dataclass
class ExecutiveSummary:
    """The Executive Summary header card content."""
    verdict: str
    top_strengths: list[str] = field(default_factory=list)
    top_frictions: list[str] = field(default_factory=list)
    top_actions: list[str] = field(default_factory=list)
    caveat: str = ""


# ---------- Public builders ---------------------------------------------


def _label_for(attr: dict, fallback_label_ko_map: dict | None = None) -> str:
    lbl = attr.get("label_ko")
    if isinstance(lbl, str) and lbl.strip():
        return lbl.strip()
    if fallback_label_ko_map:
        m = fallback_label_ko_map.get(attr.get("key"))
        if isinstance(m, str) and m.strip():
            return m
    return attr.get("key") or "항목"


def build_signal_dashboard_rows(
    analysis_report: dict,
    *,
    fallback_label_ko_map: dict | None = None,
) -> list[SignalRow]:
    """Walk every attribute in the analysis_report and produce a
    SignalRow per attribute, sorted by bucket priority then evidence
    count.

    Bucket sort order: FIX → CLARIFY → KEEP → MONITOR. Within each
    bucket, higher (pos+neg) total comes first.
    """
    profile_id = (
        ((analysis_report or {}).get("product") or {})
        .get("selected_profile_id")
    )
    rows: list[SignalRow] = []
    for attr in (analysis_report or {}).get("attributes") or []:
        if not isinstance(attr, dict):
            continue
        key = attr.get("key")
        if not key:
            continue
        n_pos = int(attr.get("n_positive") or 0)
        n_neg = int(attr.get("n_negative") or 0)
        n_mix = int(attr.get("n_mixed") or 0)
        bucket = classify_signal_bucket(
            n_positive=n_pos, n_negative=n_neg, n_mixed=n_mix,
        )
        label_ko = _label_for(attr, fallback_label_ko_map)
        rows.append(SignalRow(
            attribute_key=key,
            label_ko=label_ko,
            bucket=bucket,
            n_positive=n_pos,
            n_negative=n_neg,
            n_mixed=n_mix,
            seller_interpretation=BUCKET_INTERPRETATION_KO[bucket],
            owner=select_owner(key, profile_id=profile_id),
        ))

    bucket_order = {BUCKET_FIX: 0, BUCKET_CLARIFY: 1, BUCKET_KEEP: 2, BUCKET_MONITOR: 3}
    rows.sort(key=lambda r: (
        bucket_order.get(r.bucket, 99),
        -(r.n_positive + r.n_negative),
    ))
    return rows


def build_whats_working_items(
    analysis_report: dict,
    *,
    limit: int = 4,
    fallback_label_ko_map: dict | None = None,
) -> list[StrengthItem]:
    """Top KEEP-bucket attributes by positive count."""
    profile_id = (
        ((analysis_report or {}).get("product") or {})
        .get("selected_profile_id")
    )
    candidates: list[StrengthItem] = []
    for attr in (analysis_report or {}).get("attributes") or []:
        if not isinstance(attr, dict):
            continue
        key = attr.get("key")
        if not key:
            continue
        n_pos = int(attr.get("n_positive") or 0)
        n_neg = int(attr.get("n_negative") or 0)
        n_mix = int(attr.get("n_mixed") or 0)
        bucket = classify_signal_bucket(
            n_positive=n_pos, n_negative=n_neg, n_mixed=n_mix,
        )
        if bucket != BUCKET_KEEP:
            continue
        label_ko = _label_for(attr, fallback_label_ko_map)
        angle = strength_angle_for(
            key, profile_id=profile_id, label_ko=label_ko,
        )
        candidates.append(StrengthItem(
            attribute_key=key,
            label_ko=label_ko,
            n_positive=n_pos,
            loved=angle["loved"],
            business_value=angle["business_value"],
            preserve_caution=angle["preserve_caution"],
        ))
    candidates.sort(key=lambda s: -s.n_positive)
    return candidates[:limit]


def build_what_needs_attention_items(
    analysis_report: dict,
    *,
    limit: int = 4,
    fallback_label_ko_map: dict | None = None,
) -> list[FrictionItem]:
    """Top FIX/CLARIFY-bucket attributes by negative count."""
    profile_id = (
        ((analysis_report or {}).get("product") or {})
        .get("selected_profile_id")
    )
    candidates: list[FrictionItem] = []
    for attr in (analysis_report or {}).get("attributes") or []:
        if not isinstance(attr, dict):
            continue
        key = attr.get("key")
        if not key:
            continue
        n_pos = int(attr.get("n_positive") or 0)
        n_neg = int(attr.get("n_negative") or 0)
        n_mix = int(attr.get("n_mixed") or 0)
        bucket = classify_signal_bucket(
            n_positive=n_pos, n_negative=n_neg, n_mixed=n_mix,
        )
        if bucket not in (BUCKET_FIX, BUCKET_CLARIFY):
            continue
        label_ko = _label_for(attr, fallback_label_ko_map)
        angle = friction_angle_for(
            key, profile_id=profile_id, label_ko=label_ko,
        )
        candidates.append(FrictionItem(
            attribute_key=key,
            label_ko=label_ko,
            n_negative=n_neg,
            concern=angle["concern"],
            business_impact=angle["business_impact"],
            questions=angle["questions"],
        ))
    candidates.sort(key=lambda f: -f.n_negative)
    return candidates[:limit]


def build_seller_action_plan(
    analysis_report: dict,
    *,
    limit: int = 6,
    fallback_label_ko_map: dict | None = None,
) -> list[ActionItem]:
    """Generate the prioritized seller action plan.

    Priority assignment:
      P1 — FIX bucket OR CLARIFY with neg ≥ 5
      P2 — CLARIFY (lower)
      P3 — KEEP / MONITOR (informational; usually skipped)

    The table is capped at `limit` rows so the report stays
    actionable. KEEP/MONITOR bucket items are NOT included by
    default — operators read those in §3 What's Working / §2.4
    Priority Map.
    """
    profile_id = (
        ((analysis_report or {}).get("product") or {})
        .get("selected_profile_id")
    )
    rows: list[ActionItem] = []
    for attr in (analysis_report or {}).get("attributes") or []:
        if not isinstance(attr, dict):
            continue
        key = attr.get("key")
        if not key:
            continue
        n_pos = int(attr.get("n_positive") or 0)
        n_neg = int(attr.get("n_negative") or 0)
        n_mix = int(attr.get("n_mixed") or 0)
        bucket = classify_signal_bucket(
            n_positive=n_pos, n_negative=n_neg, n_mixed=n_mix,
        )
        if bucket not in (BUCKET_FIX, BUCKET_CLARIFY):
            continue
        if bucket == BUCKET_FIX:
            priority = "P1"
        elif bucket == BUCKET_CLARIFY and n_neg >= 5:
            priority = "P1"
        else:
            priority = "P2"
        label_ko = _label_for(attr, fallback_label_ko_map)
        tpl = action_template_for(
            key, bucket, profile_id=profile_id, label_ko=label_ko,
        )
        evidence = f"{label_ko} 아쉬움 {n_neg}건"
        if n_pos and bucket == BUCKET_CLARIFY:
            evidence = f"{label_ko} 만족 {n_pos}건 / 아쉬움 {n_neg}건"
        rows.append(ActionItem(
            priority=priority,
            owner=select_owner(key, profile_id=profile_id),
            action_text=tpl.action_text,
            evidence=evidence,
            expected_outcome=tpl.expected_outcome,
            attribute_key=key,
        ))

    # Sort: P1 first, then by negative count descending.
    priority_order = {"P1": 0, "P2": 1, "P3": 2}
    rows.sort(key=lambda r: (priority_order.get(r.priority, 99),
                              -_neg_count_for(r, analysis_report)))
    return rows[:limit]


def _neg_count_for(row: ActionItem, report: dict) -> int:
    for a in (report or {}).get("attributes") or []:
        if isinstance(a, dict) and a.get("key") == row.attribute_key:
            return int(a.get("n_negative") or 0)
    return 0


def build_executive_summary(
    analysis_report: dict,
    *,
    fallback_label_ko_map: dict | None = None,
) -> ExecutiveSummary:
    """Verdict + Top 2 strengths + Top 2 frictions + Top 3 actions
    + caveat. Sized to fit on the first page above the fold.
    """
    rows = build_signal_dashboard_rows(
        analysis_report, fallback_label_ko_map=fallback_label_ko_map,
    )
    fix_count = sum(1 for r in rows if r.bucket == BUCKET_FIX)
    keep_count = sum(1 for r in rows if r.bucket == BUCKET_KEEP)
    clarify_count = sum(1 for r in rows if r.bucket == BUCKET_CLARIFY)

    # Verdict — non-numeric, decision-oriented.
    if fix_count == 0 and keep_count >= 2:
        verdict = (
            "판매 유지 가능 — 만족 동인이 명확하고 즉시 개선 우선순위는 낮습니다."
        )
    elif fix_count >= 3:
        verdict = (
            "구매 동기 약화 신호 누적 — 우선 개선 검토가 필요합니다."
        )
    elif fix_count >= 1 and keep_count >= 1:
        # The most common case for healthy products.
        top_fix = next(
            (r.label_ko for r in rows if r.bucket == BUCKET_FIX),
            None,
        )
        verdict = (
            f"판매 유지 가능 · 단, {top_fix or '일부 항목'} 기대치 관리 필요"
            if top_fix else "판매 유지 가능 · 단, 일부 항목 기대치 관리 필요"
        )
    elif clarify_count >= 1:
        verdict = (
            "기대치 차이가 핵심 — 상세페이지·옵션 설명 보완을 우선 검토하세요."
        )
    else:
        verdict = "신호량이 제한적 — 누적 추이 관찰을 권장합니다."

    top_strengths_data = build_whats_working_items(
        analysis_report, limit=2, fallback_label_ko_map=fallback_label_ko_map,
    )
    top_strengths = [
        f"{s.label_ko}: {s.loved}" for s in top_strengths_data
    ]

    top_frictions_data = build_what_needs_attention_items(
        analysis_report, limit=2, fallback_label_ko_map=fallback_label_ko_map,
    )
    top_frictions = [
        f"{f.label_ko}: {f.concern}" for f in top_frictions_data
    ]

    actions = build_seller_action_plan(
        analysis_report, limit=3, fallback_label_ko_map=fallback_label_ko_map,
    )
    top_actions = [
        f"{a.priority} · {a.owner} · {a.action_text}" for a in actions
    ]

    caveat = (
        "본 리포트는 리뷰 기반 가설을 제시하며, 실제 원인/제조 변경은 "
        "내부 검토를 거쳐야 합니다."
    )

    return ExecutiveSummary(
        verdict=verdict,
        top_strengths=top_strengths,
        top_frictions=top_frictions,
        top_actions=top_actions,
        caveat=caveat,
    )


# ---------- Banned-phrase quality gate -----------------------------------
#
# The user-locked list. Any of these strings appearing in the rendered
# body sections (1–5) is a quality-gate failure. Sections 6
# (Methodology) and 7 (Appendix) are exempt — they may legitimately
# describe what was scrubbed or contain raw evidence.

BANNED_PHRASES_SECTIONS_1_5: tuple[str, ...] = (
    # Pass-19I — buyer-content-translation copywriter phrasing
    "콘텐츠 문구 예시",
    # Skincare/sunscreen domain leaking into lip body
    "보습 보강 단계",
    "수분 보강",
    "백탁",
    "흡수 시간",
    "보습 효과 기대치",
    # Generic / filler that cardnews + body must never carry
    "사용 환경/시점별 차이를 다시 한 번 확인",
    "컬러 매칭 관련 만족 의견",
    "톤 매칭 관련 만족 의견",
    "발림성 관련 아쉬움 의견",
    "밀착감 관련 만족 의견",
    "밀착감 관련 아쉬움 의견",
    "관련 만족 의견",
    "관련 아쉬움 의견",
)


def scan_for_banned_phrases(
    text: str | Iterable[str],
    *,
    profile_id: str | None = None,
) -> list[str]:
    """Return the subset of banned phrases that appear in `text`.

    Profile-aware: skincare-pad-flavored bans (백탁 / 흡수 시간 /
    보습 보강 단계 / 수분 보강) are always checked even on lip
    products because they should NEVER appear on lip surfaces.
    Default profile gets the full list too — generic filler is
    bad for everyone.
    """
    if isinstance(text, str):
        haystacks = [text]
    else:
        haystacks = [str(t) for t in text or [] if t]
    big = "\n".join(haystacks)
    return [p for p in BANNED_PHRASES_SECTIONS_1_5 if p in big]


__all__ = [
    "BUCKET_KEEP",
    "BUCKET_FIX",
    "BUCKET_CLARIFY",
    "BUCKET_MONITOR",
    "BUCKET_LABEL_KO",
    "BUCKET_INTERPRETATION_KO",
    "BANNED_PHRASES_SECTIONS_1_5",
    "ActionTemplate",
    "ActionItem",
    "ExecutiveSummary",
    "FrictionItem",
    "SignalRow",
    "StrengthItem",
    "action_template_for",
    "build_executive_summary",
    "build_seller_action_plan",
    "build_signal_dashboard_rows",
    "build_what_needs_attention_items",
    "build_whats_working_items",
    "classify_signal_bucket",
    "friction_angle_for",
    "scan_for_banned_phrases",
    "select_owner",
    "strength_angle_for",
]
