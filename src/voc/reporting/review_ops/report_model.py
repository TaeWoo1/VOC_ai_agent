from __future__ import annotations

import hashlib
import json
import re
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Optional

from . import asset_classifier as ac
from . import consumer_projection as cp
from . import landing_copy as lc
from . import oem_questions as oq
from . import reply_drafts as rd
from . import risk_cluster as rc
from .loaders import ReviewOpsInputs, ReviewRow
from .schema import (
    AnalysisPeriod,
    AssetBuckets,
    AssetCounts,
    AssetItem,
    GeneratedActions,
    Generator,
    Metrics,
    ProductMeta,
    ReviewOpsAnalysis,
    RiskGroup,
)

_LEADING_BRACKET_RE = re.compile(r"^\s*\[[^\]]*\]\s*")
_TRAILING_PAREN_RE = re.compile(r"\s*\([^()]*\)\s*$")

RECENT_WINDOW_DAYS = 90
ASSETS_PER_CLASS_CAP = 5
QUOTE_MAX_CHARS = 200

STALE_COLD_THRESHOLD_DAYS = 720
STALE_ACTIONABLE_CAP = 3
STALE_COLD_CAP = 2
STALE_BAND_ACTIONABLE = "actionable"
STALE_BAND_COLD = "cold"

RISK_GROUPS_CAP = 5
RISK_ITEMS_PER_GROUP_CAP = 2
OTHER_RISKS_ID = "other_risks"
OTHER_RISKS_LABEL = "기타 리스크"

CLUSTER_ID_TO_LABEL: dict[str, str] = {
    "packaging_pump_leak": "용기·포장 사용감",
    "skin_reaction": "피부 반응",
    "scent_change": "향 체감",
    "color_mismatch": "색상 체감",
    "refill_size_request": "용량·옵션 요청",
    "texture_separation": "제형·밀림감",
}

# reply_drafts topic_key → cluster_id (only mappings that share a cluster).
_TOPIC_KEY_TO_CLUSTER_ID: dict[str, str] = {
    "packaging_container": "packaging_pump_leak",
    "skin_reaction": "skin_reaction",
    "scent_change": "scent_change",
    "color_mismatch": "color_mismatch",
    "texture_separation": "texture_separation",
    "refill_size_request": "refill_size_request",
}

REASON_KO = {
    ac.USABLE: "긍정 표현이 또렷한 활용 후보",
    ac.STALE: "수개월 전 부정 의견 — 현재 상태 확인 후보",
    ac.RISK: "리스크 키워드 또는 저평점 신호 — 운영 점검 후보",
    ac.INSIGHT: "고객 요청·기대 단서 — 콘텐츠/기획 검토 후보",
}

SUGGESTED_ACTION_KO = {
    ac.USABLE: "상세페이지·콘텐츠에 인용 가능한지 검토",
    ac.STALE: "현재 제품 상태와 일치 여부 확인 후 답글 갱신 검토",
    ac.RISK: "CS 답글 회수 및 OEM 확인 질문 검토",
    ac.INSIGHT: "신제품·옵션 추가·콘텐츠 소재 후보로 검토",
}

# Channel overrides: olive young does not surface public seller replies,
# so "답글 회수" reads as a misframing — swap to CS-response wording.
_OLIVEYOUNG_SUGGESTED_ACTION_OVERRIDES: dict[str, str] = {
    ac.RISK: "CS 응대 문구 및 OEM 확인 질문 검토",
}


def _resolve_suggested_action(class_name: str, channel: Optional[str]) -> str:
    if channel == "oliveyoung":
        override = _OLIVEYOUNG_SUGGESTED_ACTION_OVERRIDES.get(class_name)
        if override is not None:
            return override
    return SUGGESTED_ACTION_KO.get(class_name, "")


# Stale band overrides — only applied when stale_band == "cold".
STALE_COLD_REASON = "장기 과거 리뷰 — 현재 제품과 다를 가능성"
STALE_COLD_ACTION = "장기 과거 리뷰 — 우선순위 낮춤·아카이브 보관 검토"


def _safe_avg(values: list[float]) -> float:
    if not values:
        return 0.0
    return round(sum(values) / len(values), 3)


def _ratio(num: int, denom: int) -> float:
    if denom <= 0:
        return 0.0
    return round(num / denom, 3)


def _compute_metrics(reviews: list[ReviewRow]) -> Metrics:
    total = len(reviews)
    if total == 0:
        return Metrics()

    ratings = [r.rating_raw for r in reviews if r.rating_raw is not None]
    avg_rating = _safe_avg(ratings) if ratings else 0.0

    today = date.today()
    recent = sum(
        1
        for r in reviews
        if r.review_date is not None
        and (today - r.review_date).days <= RECENT_WINDOW_DAYS
    )

    neg_or_mixed = sum(
        1 for r in reviews if r.rating_raw is not None and r.rating_raw <= 3
    )

    unreplied_negative = sum(
        1
        for r in reviews
        if r.rating_raw is not None and r.rating_raw <= 3 and not r.has_brand_reply
    )

    stale_negative = sum(
        1
        for r in reviews
        if r.rating_raw is not None
        and r.rating_raw <= 3
        and r.review_date is not None
        and (today - r.review_date).days >= 180
    )

    return Metrics(
        total_reviews=total,
        average_rating=avg_rating,
        recent_review_ratio=_ratio(recent, total),
        negative_mixed_ratio=_ratio(neg_or_mixed, total),
        unreplied_negative_count=unreplied_negative,
        stale_negative_count=stale_negative,
    )


def _build_product_meta(inputs: ReviewOpsInputs) -> ProductMeta:
    product = inputs.analysis_report.get("product") or {}
    corpus = inputs.analysis_report.get("corpus") or {}
    window = corpus.get("observation_window") or {}

    # Brand inference: best-effort. Adapter doesn't emit brand_name today;
    # derive from the leading whitespace-separated token of the display
    # name when possible (e.g. "메디힐 더마 패드" → "메디힐"). Strip any
    # leading bracketed promo tokens first ("[NEW단독기획] 티르티르 …"
    # → "티르티르"). display_product_name itself is never mutated.
    # Single-token display names leave brand_name None.
    brand_name: Optional[str] = product.get("brand_name")
    display_name = product.get("display_product_name")
    if not brand_name and display_name:
        cleaned = _strip_leading_brackets(display_name).strip()
        if " " in cleaned:
            brand_name = cleaned.split()[0]

    src_start = _to_date(window.get("start"))
    src_end = _to_date(window.get("end"))
    if src_start is None and src_end is None:
        # Adapter left the window null — derive from loaded review dates.
        seen = [r.review_date for r in inputs.reviews if r.review_date is not None]
        if seen:
            src_start = min(seen)
            src_end = max(seen)
    period = AnalysisPeriod(start=src_start, end=src_end)

    display_name_value = product.get("display_product_name")
    return ProductMeta(
        brand_name=brand_name,
        display_product_name=display_name_value,
        header_title=_clean_display_title(display_name_value),
        raw_product_name=product.get("raw_product_name") or product.get("name_ko"),
        source_channel=_infer_channel(inputs),
        source_url=product.get("source_url"),
        selected_profile_id=product.get("selected_profile_id")
        or inputs.selected_profile_id,
        analysis_period=period,
    )


def _strip_leading_brackets(name: str) -> str:
    """Repeatedly strip leading "[...]" promo tokens from a display name.

    Handles single ("[NEW단독기획] 티르티르 …"), multiple ("[A][B] 브랜드 …"),
    and space-separated ("[A] [B] 브랜드 …") leading bracket tokens.
    Trailing-bracket annotations (e.g. "(+ 증정)") are left alone here.
    """
    while True:
        new = _LEADING_BRACKET_RE.sub("", name)
        if new == name:
            return name
        name = new


def _strip_trailing_parens(name: str) -> str:
    """Repeatedly strip trailing "(...)" offer/promo phrases from a name."""
    current = name
    while True:
        new = _TRAILING_PAREN_RE.sub("", current).rstrip()
        if new == current.rstrip() or not new:
            return current.rstrip() if new else current
        current = new


def _clean_display_title(name: Optional[str]) -> Optional[str]:
    """Build the operator-facing h1 title from `display_product_name`.

    Strips leading "[promo]" tokens AND trailing "(offer)" parentheses.
    Falls back to the original name when the cleaned form is empty.
    Never mutates the underlying display_product_name field.
    """
    if not name:
        return name
    cleaned = _strip_trailing_parens(_strip_leading_brackets(name)).strip()
    return cleaned or name.strip()


def _to_date(value) -> Optional[date]:
    if value in (None, ""):
        return None
    if isinstance(value, date):
        return value
    try:
        return datetime.fromisoformat(str(value)).date()
    except ValueError:
        try:
            return date.fromisoformat(str(value)[:10])
        except ValueError:
            return None


def _infer_channel(inputs: ReviewOpsInputs) -> Optional[str]:
    if inputs.reviews:
        return inputs.reviews[0].source_channel or None
    # Fall back to manifest hints.
    collection = (inputs.manifest.get("collection") or {})
    if collection.get("goodsNo") or "oliveyoung" in (collection.get("product_url") or ""):
        return "oliveyoung"
    return None


def _hash_analysis_report(path: Path) -> Optional[str]:
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


def _trim_quote(text: str, max_chars: int = QUOTE_MAX_CHARS) -> str:
    cleaned = " ".join((text or "").split())
    if len(cleaned) <= max_chars:
        return cleaned
    return cleaned[:max_chars].rstrip() + "…"


def _stale_band_for(age_days: Optional[int], is_stale: bool) -> Optional[str]:
    if not is_stale or age_days is None:
        return None
    return STALE_BAND_COLD if age_days > STALE_COLD_THRESHOLD_DAYS else STALE_BAND_ACTIONABLE


def _to_asset_item(
    row: ReviewRow,
    classes: list[str],
    primary_class: str,
    *,
    today: date,
    channel: Optional[str] = None,
) -> AssetItem:
    age_days = (today - row.review_date).days if row.review_date else None
    is_stale = ac.STALE in classes
    band = _stale_band_for(age_days, is_stale)

    if band == STALE_BAND_COLD:
        reason = STALE_COLD_REASON
        action = STALE_COLD_ACTION
    else:
        reason = REASON_KO.get(primary_class, "")
        action = _resolve_suggested_action(primary_class, channel)

    return AssetItem(
        review_id=row.review_id,
        quote=_trim_quote(row.text),
        rating=row.rating_raw,
        review_date=row.review_date,
        product_option=row.product_option,
        asset_classes=list(classes),
        topic_labels=[],
        reason=reason,
        suggested_action=action,
        has_brand_reply=row.has_brand_reply,
        is_stale_candidate=is_stale,
        age_days=age_days,
        stale_band=band,
    )


def _sort_key_for(class_name: str):
    """Per-class deterministic ordering, best candidate first."""
    if class_name == ac.USABLE:
        # Highest rating, longest text, then review_id for stability.
        return lambda r: (-(r.rating_raw or 0.0), -len(r.text), r.review_id)
    if class_name == ac.STALE:
        # Oldest review_date first; missing dates last.
        far_future = date.max
        return lambda r: (r.review_date or far_future, r.review_id)
    if class_name == ac.RISK:
        # Lowest rating first, unreplied before replied, then review_id.
        return lambda r: (
            r.rating_raw if r.rating_raw is not None else 99.0,
            0 if not r.has_brand_reply else 1,
            r.review_id,
        )
    # INSIGHT: stable by review_id.
    return lambda r: r.review_id


def _build_executive_summary(
    metrics: Metrics,
    stale_assets: list[AssetItem],
    emergent_clusters: list[dict],
) -> str:
    """One-line operator headline composed from existing report fields.

    No revenue/defect claims, no directives — pure counts + cluster labels.
    """
    parts: list[str] = [
        f"총 {metrics.total_reviews:,}건",
        f"평균 ★{metrics.average_rating:.2f}",
    ]
    actionable = sum(1 for it in stale_assets if it.stale_band == STALE_BAND_ACTIONABLE)
    if actionable > 0:
        parts.append(f"갱신 확인 후보 {actionable}건")
    if metrics.unreplied_negative_count > 0:
        parts.append(f"즉시 대응 필요 {metrics.unreplied_negative_count}건")
    if emergent_clusters:
        top2 = sorted(
            emergent_clusters,
            key=lambda c: -int(c.get("evidence_count", 0)),
        )[:2]
        signals = " / ".join(
            f"{CLUSTER_ID_TO_LABEL.get(c.get('cluster_id'), c.get('cluster_id'))} "
            f"{int(c.get('evidence_count', 0))}건"
            for c in top2
        )
        if signals:
            parts.append(f"주요 반복 신호: {signals}")
    return " · ".join(parts)


def _select_stale_rows(rows: list[ReviewRow], today: date) -> list[ReviewRow]:
    """Pick up to STALE_ACTIONABLE_CAP actionable + STALE_COLD_CAP cold,
    actionable first. Within each band: newest review_date first."""
    actionable, cold = [], []
    for r in rows:
        if r.review_date is None:
            continue
        age = (today - r.review_date).days
        (cold if age > STALE_COLD_THRESHOLD_DAYS else actionable).append(r)
    actionable.sort(key=lambda r: (-r.review_date.toordinal(), r.review_id))
    cold.sort(key=lambda r: (-r.review_date.toordinal(), r.review_id))
    return actionable[:STALE_ACTIONABLE_CAP] + cold[:STALE_COLD_CAP]


def _build_assets(
    inputs: ReviewOpsInputs,
    classifications: dict[str, list[str]],
    *,
    today: date,
    channel: Optional[str] = None,
) -> tuple[AssetBuckets, AssetCounts]:
    by_id = {r.review_id: r for r in inputs.reviews}
    buckets: dict[str, list[AssetItem]] = {
        ac.USABLE: [],
        ac.STALE: [],
        ac.RISK: [],
        ac.INSIGHT: [],
    }
    counts = {ac.USABLE: 0, ac.STALE: 0, ac.RISK: 0, ac.INSIGHT: 0}

    for class_name in buckets.keys():
        rows: list[ReviewRow] = []
        for rid, classes in classifications.items():
            if class_name not in classes:
                continue
            row = by_id.get(rid)
            if row is None:
                continue
            rows.append(row)
        counts[class_name] = len(rows)
        if class_name == ac.STALE:
            selected = _select_stale_rows(rows, today)
        elif class_name == ac.RISK:
            # Cold-stale items show up in section 4 (장기 과거 리뷰); excluding
            # them from section 5 (즉시 대응) prevents the action-text contradiction
            # ("장기 과거 리뷰 — 우선순위 낮춤" inside an immediate-action section).
            # asset_counts.risk stays at the full classifier total above.
            non_cold = [
                r for r in rows
                if not (
                    r.review_date is not None
                    and (today - r.review_date).days > STALE_COLD_THRESHOLD_DAYS
                    and ac.STALE in classifications.get(r.review_id, [])
                )
            ]
            non_cold.sort(key=_sort_key_for(class_name))
            selected = non_cold[:ASSETS_PER_CLASS_CAP]
        else:
            rows.sort(key=_sort_key_for(class_name))
            selected = rows[:ASSETS_PER_CLASS_CAP]
        for row in selected:
            buckets[class_name].append(
                _to_asset_item(
                    row,
                    classifications[row.review_id],
                    class_name,
                    today=today,
                    channel=channel,
                )
            )

    return (
        AssetBuckets(
            usable=buckets[ac.USABLE],
            stale=buckets[ac.STALE],
            risk=buckets[ac.RISK],
            insight=buckets[ac.INSIGHT],
        ),
        AssetCounts(
            usable=counts[ac.USABLE],
            stale=counts[ac.STALE],
            risk=counts[ac.RISK],
            insight=counts[ac.INSIGHT],
        ),
    )


def _build_risk_groups(
    risk_assets: list[AssetItem],
    emergent_clusters: list[dict],
) -> list[RiskGroup]:
    """Group flat risk assets into per-cluster sub-buckets.

    Mapping order, per asset:
      1) cluster.evidence_review_ids — exact match wins
      2) reply_drafts.topic_key_for_text(quote) — keyword fallback
      3) "other_risks" — catch-all
    """
    if not risk_assets:
        return []

    rid_to_cluster: dict[str, str] = {}
    cluster_counts: dict[str, int] = {}
    for cluster in emergent_clusters:
        cid = cluster.get("cluster_id")
        if not cid:
            continue
        cluster_counts[cid] = int(cluster.get("evidence_count", 0))
        for rid in cluster.get("evidence_review_ids") or []:
            rid_to_cluster.setdefault(rid, cid)

    grouped: dict[str, list[AssetItem]] = {}
    for item in risk_assets:
        cid = rid_to_cluster.get(item.review_id)
        if cid is None:
            tk = rd.topic_key_for_text(item.quote or "")
            cid = _TOPIC_KEY_TO_CLUSTER_ID.get(tk) if tk else None
        if cid is None:
            cid = OTHER_RISKS_ID
        grouped.setdefault(cid, []).append(item)

    # Order: emergent_clusters order first, then any extras (e.g. other_risks).
    ordered_ids: list[str] = []
    for cluster in emergent_clusters:
        cid = cluster.get("cluster_id")
        if cid in grouped and cid not in ordered_ids:
            ordered_ids.append(cid)
    for cid in grouped:
        if cid not in ordered_ids:
            ordered_ids.append(cid)

    groups: list[RiskGroup] = []
    for cid in ordered_ids[:RISK_GROUPS_CAP]:
        items = grouped[cid]
        label = (
            OTHER_RISKS_LABEL
            if cid == OTHER_RISKS_ID
            else CLUSTER_ID_TO_LABEL.get(cid, cid)
        )
        count = cluster_counts.get(cid) or len(items)
        groups.append(
            RiskGroup(
                cluster_id=cid,
                label=label,
                evidence_count=count,
                items=items[:RISK_ITEMS_PER_GROUP_CAP],
            )
        )
    return groups


def build(
    inputs: ReviewOpsInputs,
    *,
    today: Optional[date] = None,
) -> ReviewOpsAnalysis:
    """Build the v1 ReviewOpsAnalysis from loaded inputs.

    Wires asset_classifier output into asset_counts + per-class capped
    AssetItem lists. Action/cluster/safety layers land in later steps.
    """
    analysis_path = inputs.run_dir / "shared" / "analysis_report.json"
    today = today or date.today()
    channel = _infer_channel(inputs)
    classifications = ac.classify_all(inputs, today=today)
    assets, asset_counts = _build_assets(
        inputs, classifications, today=today, channel=channel
    )
    emergent_clusters = rc.group_risks(
        inputs.reviews, profile_id=inputs.selected_profile_id
    )
    risk_groups = _build_risk_groups(assets.risk, emergent_clusters)
    generated_actions = GeneratedActions(
        landing_page_copy=lc.generate(
            emergent_clusters=emergent_clusters,
            stale_assets=assets.stale,
            profile_id=inputs.selected_profile_id,
        ),
        reply_drafts=rd.generate(
            risk_assets=assets.risk,
            stale_assets=assets.stale,
            channel=channel,
        ),
        oem_questions=oq.generate(
            emergent_clusters=emergent_clusters,
            profile_id=inputs.selected_profile_id,
            product_name=(
                (inputs.analysis_report.get("product") or {}).get("display_product_name")
            ),
        ),
    )

    metrics = _compute_metrics(inputs.reviews)
    return ReviewOpsAnalysis(
        source_run_dir=str(inputs.run_dir),
        source_run_id=inputs.run_id,
        source_analysis_report_sha256=_hash_analysis_report(analysis_path),
        generated_at=datetime.now(timezone.utc),
        generator=Generator(mode="rule_based", rules_version="v1.0"),
        product=_build_product_meta(inputs),
        metrics=metrics,
        asset_counts=asset_counts,
        assets=assets,
        risk_groups=risk_groups,
        emergent_clusters=emergent_clusters,
        generated_actions=generated_actions,
        consumer_safe_signals=cp.derive(emergent_clusters=emergent_clusters),
        executive_summary=_build_executive_summary(
            metrics, assets.stale, emergent_clusters
        ),
    )


def dump_json(report: ReviewOpsAnalysis, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = report.model_dump(mode="json")
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return path
