from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .loaders import ReviewRow

CLUSTER_METHOD = "keyword_v1"
MIN_EVIDENCE = 3
EVIDENCE_ID_CAP = 10

# Distance (chars) on either side of a matched keyword to scan for
# complaint markers when applying the polarity gate.
MARKER_WINDOW = 20

# Clusters that count by keyword presence alone:
#   - skin_reaction: 트러블/따가움/발진/가려움/붉어짐 are inherently cautionary
#   - refill_size_request: a demand signal, not a defect claim
_ALWAYS_COUNT: frozenset[str] = frozenset(
    {"skin_reaction", "refill_size_request"}
)

# Clusters whose seeds are too broad on their own. A row only counts as
# evidence when (rating_raw <= 3) OR a complaint marker appears within
# MARKER_WINDOW chars of the matched keyword.
_POLARITY_GATED: frozenset[str] = frozenset(
    {"scent_change", "color_mismatch", "texture_separation", "packaging_pump_leak"}
)

COMPLAINT_MARKERS: tuple[str, ...] = (
    "별로", "아쉬", "불편", "안 맞", "안나", "안 나",
    "새", "샜", "누수", "따가", "트러블", "발진",
    "가려", "역해", "이상", "다르", "칙칙",
    "밀림", "뭉침", "분리", "거칠", "건조",
)

# skincare_pad gating: a tub of pads has no pump. Even with a polarity
# match, only count packaging evidence when the text references pad/tub
# packaging vocabulary — not pump vocabulary.
_PAD_CONTAINER_TERMS: tuple[str, ...] = (
    "용기", "집게", "뚜껑", "캡", "마개", "케이스", "새요", "샜어요", "누수",
)

# skincare_pad gating: color_mismatch easily false-positives on
# "색감이 좋아요". Require both a rating-confirmed complaint AND a
# narrow color-specific marker.
_COLOR_COMPLAINT_MARKERS: tuple[str, ...] = (
    "다크닝", "칙칙", "다르", "이상", "별로", "아쉬", "안 맞",
)

# Profile-aware label/summary overrides (cluster_id stays the same so
# downstream consumers + tests keep working). Method label unchanged.
_LABEL_OVERRIDES: dict[tuple[str, str], tuple[str, str]] = {
    ("skincare_pad", "packaging_pump_leak"): (
        "용기·뚜껑·집게 사용감",
        "용기·뚜껑·집게 사용감 의견이 반복 관찰됨 — 운영 점검 후보",
    ),
    ("lip_makeup", "packaging_pump_leak"): (
        "용기·캡·도포구 사용감",
        "용기·캡·도포구 사용감 의견이 반복 관찰됨 — 운영 점검 후보",
    ),
    ("base_makeup", "packaging_pump_leak"): (
        "케이스·퍼프·리필 용기 사용감",
        "케이스·퍼프·리필 용기 사용감 의견이 반복 관찰됨 — 운영 점검 후보",
    ),
}


@dataclass(frozen=True)
class ClusterRule:
    cluster_id: str
    label: str
    keyword_seeds: tuple[str, ...]
    linked_attribute: Optional[str]
    summary: str


CLUSTER_RULES: tuple[ClusterRule, ...] = (
    ClusterRule(
        cluster_id="packaging_pump_leak",
        label="펌프·용기 누수",
        keyword_seeds=("펌프", "뚜껑", "누수", "샜어요", "새요", "용기"),
        linked_attribute="packaging_container",
        summary="용기·펌프 사용감 의견이 반복 관찰됨 — 운영 점검 후보",
    ),
    ClusterRule(
        cluster_id="skin_reaction",
        label="민감 피부 반응",
        keyword_seeds=("트러블", "따가움", "발진", "가려움", "붉어짐"),
        linked_attribute="dryness_skin_texture",
        summary="민감 피부 반응 의견이 반복 관찰됨 — 옵션·사용 환경 확인 후보",
    ),
    ClusterRule(
        cluster_id="scent_change",
        label="향 변화·향 호불호",
        keyword_seeds=("냄새", "향", "향이", "역해", "인공적"),
        linked_attribute=None,
        summary="향 관련 의견이 반복 관찰됨 — 로트·시즌 변동 확인 후보",
    ),
    ClusterRule(
        cluster_id="color_mismatch",
        label="색상·톤 기대치 차이",
        keyword_seeds=("색", "발색", "톤", "다크닝", "칙칙"),
        linked_attribute="color_tone_matching",
        summary="색상·톤 기대치 차이 의견이 반복 관찰됨 — 옵션·디스플레이 표현 점검 후보",
    ),
    ClusterRule(
        cluster_id="refill_size_request",
        label="리필·대용량·여행용 요청",
        keyword_seeds=("리필", "대용량", "여행용", "옵션 추가"),
        linked_attribute=None,
        summary="리필·대용량·여행용 옵션 요청 의견이 반복 관찰됨 — 기획 검토 후보",
    ),
    ClusterRule(
        cluster_id="texture_separation",
        label="제형 분리·뭉침",
        keyword_seeds=("분리", "제형", "뭉침", "밀림"),
        linked_attribute="application_blending",
        summary="제형 분리·뭉침 의견이 반복 관찰됨 — 보관 환경·제형 안정성 확인 후보",
    ),
)


def _matches(text: str, keywords: tuple[str, ...]) -> bool:
    return any(k in text for k in keywords)


def _earliest_match(text: str, keywords: tuple[str, ...]) -> int:
    best = -1
    for k in keywords:
        i = text.find(k)
        if i != -1 and (best == -1 or i < best):
            best = i
    return best


def _has_complaint_marker_near(text: str, pos: int) -> bool:
    if pos < 0:
        return False
    start = max(0, pos - MARKER_WINDOW)
    end = pos + MARKER_WINDOW
    chunk = text[start:end]
    return any(m in chunk for m in COMPLAINT_MARKERS)


def _passes_polarity_gate(row: ReviewRow, rule: ClusterRule) -> bool:
    if row.rating_raw is not None and row.rating_raw <= 3:
        return True
    text = row.text or ""
    pos = _earliest_match(text, rule.keyword_seeds)
    return _has_complaint_marker_near(text, pos)


def _passes_profile_gate(
    row: ReviewRow,
    rule: ClusterRule,
    profile_id: Optional[str],
) -> bool:
    """Profile-aware tightening. Returns True for non-pad profiles or
    clusters not covered by a profile-specific rule.
    """
    if profile_id != "skincare_pad":
        return True
    text = row.text or ""
    if rule.cluster_id == "packaging_pump_leak":
        # The pad SKU has no pump — require pad/container vocabulary.
        return any(t in text for t in _PAD_CONTAINER_TERMS)
    if rule.cluster_id == "color_mismatch":
        # Color complaints are rare on a single-color pad; require both
        # rating evidence AND a narrow color complaint marker.
        if row.rating_raw is None or row.rating_raw > 3:
            return False
        return any(m in text for m in _COLOR_COMPLAINT_MARKERS)
    return True


def group_risks(
    reviews: list[ReviewRow],
    *,
    profile_id: Optional[str] = None,
) -> list[dict]:
    """Build keyword-driven emergent clusters with polarity + profile gating.

    method is always "keyword_v1" — never "dbscan". The returned dict
    schema is unchanged: cluster_id / label / method / keyword_seeds /
    evidence_count / evidence_review_ids / linked_attribute / summary.
    """
    out: list[dict] = []
    for rule in CLUSTER_RULES:
        ids: set[str] = set()
        for row in reviews:
            text = row.text or ""
            if not _matches(text, rule.keyword_seeds):
                continue
            if rule.cluster_id in _POLARITY_GATED and not _passes_polarity_gate(row, rule):
                continue
            if not _passes_profile_gate(row, rule, profile_id):
                continue
            ids.add(row.review_id)
        ordered = sorted(ids)
        if len(ordered) < MIN_EVIDENCE:
            continue
        label, summary = rule.label, rule.summary
        if profile_id:
            override = _LABEL_OVERRIDES.get((profile_id, rule.cluster_id))
            if override is not None:
                label, summary = override
        out.append(
            {
                "cluster_id": rule.cluster_id,
                "label": label,
                "method": CLUSTER_METHOD,
                "keyword_seeds": list(rule.keyword_seeds),
                "evidence_count": len(ordered),
                "evidence_review_ids": ordered[:EVIDENCE_ID_CAP],
                "linked_attribute": rule.linked_attribute,
                "summary": summary,
            }
        )
    return out
