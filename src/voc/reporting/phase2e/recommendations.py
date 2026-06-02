"""Per-attribute recommendation generation (Phase 2E).

Pairs each negative `AttributeInsight` with a concrete, deterministic
Korean recommendation phrase - a 1-sentence action the manufacturer can
take. The mapping is rule-based (no LLM); each canonical attribute key
has exactly one recommendation phrase locked in `RECOMMENDATIONS_KO`.

Inputs (read-only)
------------------
- list[AttributeInsight] - typically the `"negative"` slice from
  `synthesize_attribute_insights`. Positive insights are skipped: a
  strength is not, by itself, an action item.

Outputs
-------
`generate_recommendations(insights)` returns a list of `Recommendation`
records, one per negative insight whose `attribute` is in the mapping.
Insights with an unmapped attribute are silently skipped (no fabricated
generic stub) so a future attribute addition surfaces as a missing
recommendation rather than a misleading suggestion.

Out of scope
------------
- Recommendations for positive insights - strengths are not action
  items; this module focuses on improvement targets only.
- Priority-based phrasing variation - the priority_label is forwarded
  as a separate field on `Recommendation`, so the renderer styles
  urgency separately from phrasing.
- LLM-generated text - strictly deterministic for reproducibility.
"""

from __future__ import annotations

from dataclasses import dataclass

from src.voc.reporting.phase2e.insights import AttributeInsight


# Canonical recommendation phrases per attribute key.
#
# Phrasing rules (2026-04-28 business-grade redesign):
#   - VERIFICATION-oriented, not prescriptive. Phrases describe what
#     the brand can investigate INTERNALLY using product page data,
#     option/SKU breakdowns, or CS records - NOT manufacturing
#     changes the report has no visibility into.
#   - Banned: 포뮬러 / 안료 농도 / 베이스 점도 / 첨가제 조정 /
#     픽서/필름 형성제 / 베이스 변경 / 제조 변경 / 개선 필요 /
#     해야 합니다. The report has no insight into manufacturing
#     internals and must not pretend to.
#   - Allowed framings: 옵션/호수별 분포 확인 / 사용 환경별 분포
#     확인 / 상세페이지 기대치 확인 / CS 문의 교차 확인 / 내부
#     QA·R&D 컨텍스트 검토.
#   - Every phrase ends in 확인 후보 / 검토 후보 (hedged candidate
#     form per .claude/skills/pdf_report_wording_safety.md).
#
# Updates to this dict ARE breaking - downstream reports cite these
# phrases verbatim. Pair phrase changes with a stakeholder review
# and the locked tests in tests/test_reporting/test_phase2e/.
RECOMMENDATIONS_KO: dict[str, str] = {
    "pigmentation":
        "상세페이지 발색 이미지 및 옵션/호수별 의견 분포 확인 후보",
    "persistence":
        "옵션/호수별 지속력 의견 분포 및 사용 환경 교차 확인 후보",
    "application_blending":
        "사용 패턴/도구 사용 조건별 발림성 의견 분포 확인 후보",
    "adhesion_base_interaction":
        "베이스 메이크업 조합별 의견 분포 확인 후보",
    "finish_texture":
        "사용 환경/조명 조건별 마무리감 의견 분포 확인 후보",
    "dryness_skin_texture":
        "피부 타입별 건조감 의견 분포 확인 후보",
    "color_tone_matching":
        "호수/톤 라인업 분포 및 상세페이지 기대치 확인 후보",
    "packaging_container":
        "사용 단계별 용기 의견 분포 및 CS 문의 교차 확인 후보",
    "applicator_tool":
        "도구 사용 패턴 및 옵션별 의견 분포 확인 후보",
    "value_price":
        "프로모션 시점/옵션별 가격 의견 분포 확인 후보",
    "multi_use_lip_cheek_compatibility":
        "사용 방식별 호환성 의견 분포 확인 후보",
    "transfer_resistance":
        "옵션/사용 환경별 묻어남 의견 분포 및 CS 문의 교차 확인 후보",
}


# Execution-horizon category per recommended action. Three buckets
# the user pinned for the Recommended Actions section so a brand
# operator can route work without reading the action phrase first:
#
#   "즉시 실행"  - deployable in days/weeks without R&D changes
#                 (pricing/promo, component swap, content tweaks)
#   "중기 개선"  - formula tweaks, batch retests, new SKU lines,
#                 packaging redesigns - typical 1-3 month cycle
#   "실험/검증" - hypothesis-driven A/B or sample testing required
#                 BEFORE committing to a fix
#
# Distribution at the time of writing: 2 / 7 / 3 across the 12
# canonical attributes - a deliberately uneven split that reflects
# how cosmetics-product issues actually map onto operator workflows
# (most issues require formula iteration, not just a quick toggle).
ACTION_CATEGORY_IMMEDIATE: str = "즉시 실행"
ACTION_CATEGORY_MID_TERM: str = "중기 개선"
ACTION_CATEGORY_EXPERIMENT: str = "실험/검증"

ACTION_CATEGORIES_KO: frozenset[str] = frozenset({
    ACTION_CATEGORY_IMMEDIATE,
    ACTION_CATEGORY_MID_TERM,
    ACTION_CATEGORY_EXPERIMENT,
})

ACTION_CATEGORY_KO: dict[str, str] = {
    # 즉시 실행 - pricing/promo OR component swap, no formulation R&D
    "value_price":                        ACTION_CATEGORY_IMMEDIATE,
    "applicator_tool":                    ACTION_CATEGORY_IMMEDIATE,
    # 중기 개선 - formula / SKU / packaging redesign
    "transfer_resistance":                ACTION_CATEGORY_MID_TERM,
    "persistence":                        ACTION_CATEGORY_MID_TERM,
    "application_blending":               ACTION_CATEGORY_MID_TERM,
    "finish_texture":                     ACTION_CATEGORY_MID_TERM,
    "dryness_skin_texture":               ACTION_CATEGORY_MID_TERM,
    "color_tone_matching":                ACTION_CATEGORY_MID_TERM,
    "packaging_container":                ACTION_CATEGORY_MID_TERM,
    # 실험/검증 - hypothesis test BEFORE committing to a fix
    "pigmentation":                       ACTION_CATEGORY_EXPERIMENT,
    "adhesion_base_interaction":          ACTION_CATEGORY_EXPERIMENT,
    "multi_use_lip_cheek_compatibility":  ACTION_CATEGORY_EXPERIMENT,
}


@dataclass(frozen=True)
class Recommendation:
    """One actionable recommendation derived from a negative insight."""
    attribute: str         # canonical key, e.g. "transfer_resistance"
    ko_action: str         # the 1-sentence Korean recommendation
    priority_label: str    # forwarded from the source insight
                            # (High/Medium/Low) - renderer styles urgency.


def recommendation_for(attribute: str) -> str | None:
    """Look up the canonical recommendation phrase for an attribute key.

    Returns None when the attribute is not in `RECOMMENDATIONS_KO`. The
    caller decides whether to skip silently (default) or surface the
    gap. Returning None instead of fabricating a generic stub means a
    future attribute addition surfaces as a visible omission, not as
    misleading boilerplate.
    """
    return RECOMMENDATIONS_KO.get(attribute)


def action_category_for(attribute: str) -> str | None:
    """Return the execution-horizon category for an attribute's action.

    One of `ACTION_CATEGORIES_KO` (즉시 실행 / 중기 개선 / 실험/검증)
    or None when the attribute is unmapped. Renderers prefix the
    matching action phrase with this category as a colored chip so
    operators can route work without reading the phrase first.
    """
    return ACTION_CATEGORY_KO.get(attribute)


def generate_recommendations(
    insights: list[AttributeInsight],
) -> list[Recommendation]:
    """Map each negative insight to its canonical recommendation.

    Positive insights are skipped (a strength is not an action item).
    Unmapped attributes are skipped silently. The output preserves
    the input order so renderers can keep insight ↔ recommendation
    pairs aligned visually.

    Idempotent: same input list → same output list. The mapping has
    no side effects.
    """
    out: list[Recommendation] = []
    for ins in insights:
        if ins.kind != "negative":
            continue
        action = recommendation_for(ins.attribute)
        if action is None:
            continue
        out.append(Recommendation(
            attribute=ins.attribute,
            ko_action=action,
            priority_label=ins.priority_label,
        ))
    return out
