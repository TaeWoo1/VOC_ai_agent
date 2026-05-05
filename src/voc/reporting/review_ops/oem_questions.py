from __future__ import annotations

from typing import Optional

OEM_QUESTIONS_CAP = 5
EVIDENCE_ID_CAP = 5

_OEM_TEMPLATES: dict[str, tuple[str, str]] = {
    # cluster_id → (category, question)
    "packaging_pump_leak": (
        "용기/포장",
        "최근 3개월간 해당 옵션의 용기 부자재 또는 펌프 사양 변경 이력이 있었는지 확인 가능할까요?",
    ),
    "skin_reaction": (
        "제형/원료",
        "최근 로트에서 자극 가능 성분 농도 변화나 원료 공급사 변경이 있었는지 확인 가능할까요?",
    ),
    "scent_change": (
        "향료",
        "해당 시즌·로트에서 향료 조합 또는 농도 변화가 있었는지 확인 가능할까요?",
    ),
    "color_mismatch": (
        "색상/디스플레이",
        "옵션별 실측 색상과 상세페이지 표기 색상 사이에 차이가 있는지 확인 가능할까요?",
    ),
    "refill_size_request": (
        "기획/옵션",
        "리필·대용량·여행용 옵션 확장 검토 가능성이 있는지 확인 가능할까요?",
    ),
    "texture_separation": (
        "제형 안정성",
        "최근 보관 환경 또는 제형 안정성 테스트에서 분리·뭉침 이력이 있었는지 확인 가능할까요?",
    ),
}

# Profile-specific OEM packaging overrides. The generic "펌프 사양" question
# is meaningless (and operator-confusing) for products that have no pump:
#   - skincare_pad  → 용기/뚜껑/집게/포장
#   - lip_makeup    → 튜브/캡/도포구/밀봉
#   - base_makeup   → 케이스/퍼프/리필 용기/포장 (cushion, foundation, etc.)
_PROFILE_OVERRIDES: dict[tuple[str, str], tuple[str, str]] = {
    ("skincare_pad", "packaging_pump_leak"): (
        "용기/포장",
        "최근 3개월간 해당 제품의 용기, 뚜껑, 집게 또는 포장 방식 변경 이력이 있었는지 확인 가능할까요?",
    ),
    ("lip_makeup", "packaging_pump_leak"): (
        "용기/포장",
        "최근 3개월간 해당 제품의 튜브, 캡, 도포구 또는 밀봉 방식 변경 이력이 있었는지 확인 가능할까요?",
    ),
    ("base_makeup", "packaging_pump_leak"): (
        "용기/포장",
        "최근 3개월간 해당 제품의 케이스, 퍼프, 리필 용기 또는 포장 방식 변경 이력이 있었는지 확인 가능할까요?",
    ),
}

# When the profile is generic/missing, sniff the display name for category
# cues so packaging questions still pick the right vocab. Only used for
# packaging_pump_leak — other clusters keep their profile-agnostic text.
_FALLBACK_PROFILES: frozenset[Optional[str]] = frozenset(
    {None, "", "default", "fallback_generic"}
)
_LIP_NAME_KEYWORDS: tuple[str, ...] = ("틴트", "립", "글로스")
_BASE_NAME_KEYWORDS: tuple[str, ...] = ("쿠션", "파운데이션", "베이스")


def _infer_packaging_profile(
    profile_id: Optional[str],
    product_name: Optional[str],
) -> Optional[str]:
    """For packaging_pump_leak only: infer a packaging profile from product
    name when the explicit profile is generic/missing. Returns the original
    profile_id when no inference is possible."""
    if profile_id not in _FALLBACK_PROFILES:
        return profile_id
    if not product_name:
        return profile_id
    if any(k in product_name for k in _LIP_NAME_KEYWORDS):
        return "lip_makeup"
    if any(k in product_name for k in _BASE_NAME_KEYWORDS):
        return "base_makeup"
    return profile_id


def _resolve_template(
    cluster_id: str,
    profile_id: Optional[str],
    *,
    product_name: Optional[str] = None,
) -> Optional[tuple[str, str]]:
    effective = profile_id
    if cluster_id == "packaging_pump_leak":
        effective = _infer_packaging_profile(profile_id, product_name)
    if effective:
        override = _PROFILE_OVERRIDES.get((effective, cluster_id))
        if override is not None:
            return override
    return _OEM_TEMPLATES.get(cluster_id)


def _from_cluster(
    cluster: dict,
    *,
    profile_id: Optional[str],
    product_name: Optional[str] = None,
) -> Optional[dict]:
    spec = _resolve_template(
        cluster.get("cluster_id"), profile_id, product_name=product_name
    )
    if spec is None:
        return None
    category, question = spec
    ev_ids = list(cluster.get("evidence_review_ids") or [])[:EVIDENCE_ID_CAP]
    return {
        "category": category,
        "question": question,
        "evidence_review_ids": ev_ids,
        "source_cluster_id": cluster.get("cluster_id"),
        "linked_attribute": cluster.get("linked_attribute"),
        "rationale": (
            f"신호 클러스터 {cluster.get('cluster_id')} "
            f"(반복 {cluster.get('evidence_count', 0)}건) 기반"
        ),
    }


def generate(
    *,
    emergent_clusters: list[dict],
    profile_id: Optional[str] = None,
    product_name: Optional[str] = None,
) -> list[dict]:
    """Produce up to OEM_QUESTIONS_CAP confirmation questions.

    Profile + product-name resolution applies only to packaging_pump_leak
    (the cluster whose generic template would say "펌프"). Other clusters
    use profile-agnostic templates regardless of product type.
    """
    out: list[dict] = []
    for cluster in emergent_clusters:
        if len(out) >= OEM_QUESTIONS_CAP:
            break
        item = _from_cluster(cluster, profile_id=profile_id, product_name=product_name)
        if item is not None:
            out.append(item)
    return out
