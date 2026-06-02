from __future__ import annotations

from typing import Iterable, Optional

from .schema import AssetItem

LANDING_COPY_CAP = 5
SOURCE_REVIEW_ID_CAP = 3

# cluster_id → (topic, section_hint, copy)
# Copy is intentionally paste-ready: a short concrete sentence that an
# operator could put on a detail page or FAQ. Hedged tone, no defect
# claims, no medical efficacy claims, no directives.
_CLUSTER_TEMPLATES: dict[str, tuple[str, str, str]] = {
    "packaging_pump_leak": (
        "용기·펌프 사용감",
        "FAQ",
        "사용감은 사용 환경에 따라 다르게 느껴질 수 있어, "
        "첫 사용 시 펌프 적정 압력을 확인 후 사용해보시길 권장드립니다.",
    ),
    "skin_reaction": (
        "민감 피부 안내",
        "상세페이지",
        "피부 컨디션에 따라 사용감은 다르게 느껴질 수 있어요. "
        "민감하게 반응하는 피부라면 처음 사용 전 국소 부위 테스트를 권장드립니다.",
    ),
    "scent_change": (
        "향 호불호 안내",
        "상세페이지",
        "향에 대한 체감은 개인차가 있을 수 있어, "
        "향에 민감한 고객은 사용 전 리뷰와 전성분 정보를 함께 확인해보시길 권장드립니다.",
    ),
    "color_mismatch": (
        "색상·톤 안내",
        "옵션 안내",
        "화면과 실제 발색은 조명·디스플레이에 따라 다르게 보일 수 있어, "
        "실제 사용 후 체감을 함께 확인해보시길 권장드립니다.",
    ),
    "refill_size_request": (
        "리필·대용량 옵션",
        "기획전",
        "용량·옵션 확장에 대한 의견을 모니터링 중이며, "
        "향후 옵션 안내는 채널 공지를 통해 확인해보실 수 있습니다.",
    ),
    "texture_separation": (
        "보관·제형 안내",
        "FAQ",
        "사용 시 피부 상태에 따라 마찰감이 다르게 느껴질 수 있어, "
        "민감한 부위에는 가볍게 눌러 사용하는 방식을 권장드립니다.",
    ),
}

# Profile-specific overrides. The generic "펌프" packaging copy is
# operator-confusing for products without a pump — replace per format:
#   skincare_pad → 뚜껑·집게  ·  lip_makeup → 캡·도포구·튜브  ·  base_makeup → 케이스·퍼프·리필
_PROFILE_OVERRIDES: dict[tuple[str, str], tuple[str, str, str]] = {
    ("skincare_pad", "packaging_pump_leak"): (
        "용기·포장 사용감",
        "FAQ",
        "사용 후에는 뚜껑을 끝까지 닫아 보관하고, "
        "내장 집게를 사용해 패드를 꺼내는 방식을 권장드립니다.",
    ),
    ("skincare_pad", "texture_separation"): (
        "보관·사용 안내",
        "FAQ",
        "패드 사용 시 피부 상태에 따라 마찰감이 다르게 느껴질 수 있어, "
        "민감한 부위에는 가볍게 눌러 사용하는 방식을 권장드립니다.",
    ),
    ("lip_makeup", "packaging_pump_leak"): (
        "용기·캡·도포구 사용감",
        "FAQ",
        "사용 후에는 캡을 끝까지 닫아 보관하고, 튜브 입구와 도포구가 "
        "깨끗한 상태인지 사용 전 한 번 확인해보시길 권장드립니다. "
        "장기 보관 시 밀봉 상태도 함께 점검해주시면 좋습니다.",
    ),
    ("base_makeup", "packaging_pump_leak"): (
        "케이스·퍼프·리필 사용감",
        "FAQ",
        "사용 후에는 케이스와 포장 상태를 함께 확인하고, 퍼프는 주기적으로 "
        "세척 또는 교체하는 방식을 권장드립니다. 리필 교체 시 본체 잔류물도 "
        "함께 점검해보시면 좋습니다.",
    ),
}

_STALE_TOPIC = "과거 리뷰 시점 안내"
_STALE_SECTION = "FAQ"
_STALE_COPY = (
    "작성 시점 이후 사양·옵션이 변경되었을 가능성이 있어, "
    "현재 제품 사양은 상세페이지 최신 정보를 함께 확인해주시길 권장드립니다."
)


def _resolve_template(
    cluster_id: str,
    profile_id: Optional[str],
) -> Optional[tuple[str, str, str]]:
    if profile_id:
        override = _PROFILE_OVERRIDES.get((profile_id, cluster_id))
        if override is not None:
            return override
    return _CLUSTER_TEMPLATES.get(cluster_id)


def _from_cluster(
    cluster: dict,
    *,
    profile_id: Optional[str],
) -> Optional[dict]:
    spec = _resolve_template(cluster.get("cluster_id"), profile_id)
    if spec is None:
        return None
    topic, section_hint, copy = spec
    ev_ids = list(cluster.get("evidence_review_ids") or [])[:SOURCE_REVIEW_ID_CAP]
    return {
        "topic": topic,
        "section_hint": section_hint,
        "copy": copy,
        "rationale": (
            f"신호 클러스터 {cluster.get('cluster_id')} "
            f"(반복 {cluster.get('evidence_count', 0)}건) 기반"
        ),
        "source_cluster_id": cluster.get("cluster_id"),
        "source_review_ids": ev_ids,
    }


def _from_stale_assets(stale_items: Iterable[AssetItem]) -> Optional[dict]:
    ev_ids = [item.review_id for item in stale_items][:SOURCE_REVIEW_ID_CAP]
    if not ev_ids:
        return None
    return {
        "topic": _STALE_TOPIC,
        "section_hint": _STALE_SECTION,
        "copy": _STALE_COPY,
        "rationale": "갱신 필요 후보 리뷰 기반",
        "source_cluster_id": None,
        "source_review_ids": ev_ids,
    }


def generate(
    *,
    emergent_clusters: list[dict],
    stale_assets: list[AssetItem],
    profile_id: Optional[str] = None,
) -> list[dict]:
    """Produce up to LANDING_COPY_CAP operator-facing copy drafts.

    Cluster-driven items come first (deterministic by cluster order),
    then a single rolled-up stale-assets item if room remains.
    Profile-specific overrides (e.g. skincare_pad) replace the generic
    template when present so vocab matches the actual SKU.
    """
    # Sort clusters by evidence_count descending so the dominant signal
    # for this product appears first (e.g. lip → color over packaging,
    # pad → refill/skin over packaging). Stable on cluster_id for ties.
    sorted_clusters = sorted(
        emergent_clusters,
        key=lambda c: (-int(c.get("evidence_count", 0)), str(c.get("cluster_id", ""))),
    )
    out: list[dict] = []
    for cluster in sorted_clusters:
        if len(out) >= LANDING_COPY_CAP:
            break
        item = _from_cluster(cluster, profile_id=profile_id)
        if item is not None:
            out.append(item)
    if len(out) < LANDING_COPY_CAP:
        item = _from_stale_assets(stale_assets)
        if item is not None:
            out.append(item)
    return out[:LANDING_COPY_CAP]
