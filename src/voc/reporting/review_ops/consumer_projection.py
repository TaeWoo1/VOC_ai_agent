from __future__ import annotations

from typing import Optional

AUDIT_ID_CAP = 5
TRUNCATE_TO = 8  # safely below cardnews safety_validator's 12-hex review_id pattern

# cluster_id → (topic_label, tone, summary)
# All summaries are sanitized for buyer-facing surfaces:
#   - no defect claim, no brand attack, no clickbait
#   - hedged "의견이 일부 반복됐어요" / "체감이 나뉘는 의견이 있었어요" tone
#   - no raw quote, no review_id, no goods_no
_TOPIC_TEMPLATES: dict[str, tuple[str, str, str]] = {
    "packaging_pump_leak": (
        "packaging_container",
        "caution",
        "용기 사용감에 대한 의견이 일부 반복됐어요",
    ),
    "skin_reaction": (
        "dryness_skin_texture",
        "caution",
        "피부 반응에 대한 주의 의견이 일부 있었어요",
    ),
    "scent_change": (
        "scent",
        "mixed",
        "향에 대한 체감이 나뉘는 의견이 있었어요",
    ),
    "color_mismatch": (
        "color_tone_matching",
        "mixed",
        "색상 기대와 실제 체감이 나뉘는 의견이 있었어요",
    ),
    "refill_size_request": (
        "size_options",
        "positive",
        "용량·옵션 확장에 대한 요청이 일부 있었어요",
    ),
    "texture_separation": (
        "application_blending",
        "mixed",
        "제형과 밀림감에 대한 체감이 나뉘는 의견이 있었어요",
    ),
}


def _truncate(review_id: str) -> str:
    rid = (review_id or "").strip()
    if len(rid) <= TRUNCATE_TO:
        return rid
    return rid[:TRUNCATE_TO] + "…"


def _signal_from(cluster: dict) -> Optional[dict]:
    spec = _TOPIC_TEMPLATES.get(cluster.get("cluster_id"))
    if spec is None:
        return None
    topic_label, tone, summary = spec
    raw_ids = list(cluster.get("evidence_review_ids") or [])[:AUDIT_ID_CAP]
    return {
        "topic_label": topic_label,
        "tone": tone,
        "summary": summary,
        "evidence_count": int(cluster.get("evidence_count", 0)),
        "audit": {
            "evidence_review_id_truncated": [_truncate(r) for r in raw_ids],
        },
    }


def derive(*, emergent_clusters: list[dict]) -> list[dict]:
    """Project operator clusters into buyer-safe signals.

    Output is shaped for future cardnews planner consumption:
      - public fields (topic_label, tone, summary, evidence_count) carry
        no raw quote and no review_id
      - audit.evidence_review_id_truncated keeps short, non-recoverable
        prefixes (≤ 8 hex chars) so operators can still trace samples
        without breaking the cardnews public-field allowlist contract
    """
    out: list[dict] = []
    for cluster in emergent_clusters:
        signal = _signal_from(cluster)
        if signal is not None:
            out.append(signal)
    return out
