"""Deterministic post-process / QA layer for ``product_guidance_draft.json`` (S2x.3c).

Pure, offline: reads an existing multimodal draft and re-derives a review-ready
artifact (``product_guidance_review.json``) without any model call. It does three
things, all by fixed string rules:

1. **Re-route** draft items into stable guidance buckets (the model's per-tile
   field routing is imperfect — e.g. cutting/fixation steps land under
   ``usage_installation``).
2. **Surface gap-analysis signals**: for known review concerns, report which
   detail-page guidance aspects are present vs. absent in the draft.
3. **Add operator-review warnings**: vision-misread candidates, near-duplicate /
   conflicting extractions, and over-optimistic confidence.

Discipline: NO network, NO OpenAI, NO OCR, NO ProductKnowledge, NO Notion /
Streamlit / store / review-analysis integration. This layer invents nothing —
``not_found`` means "not found in the extracted draft", NOT "absent from the
original detail page". Every output stays a cautious review/check candidate.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from src.voc.review_ops.industrial.detail_snapshot import guidance_schema as gs

POSTPROCESS_MODE = "deterministic_review"
SOURCE_DRAFT_FILENAME = "product_guidance_draft.json"
REVIEW_FILENAME = "product_guidance_review.json"

# value/verbatim substring -> confirmed_guidance bucket (an item may match many).
ROUTING_RULES: dict[str, tuple[str, ...]] = {
    "surface_preparation": ("먼지", "물기", "기름", "표면", "부착할 위치"),
    "fixation_guidance": ("피스", "나사", "실리콘", "점착 테이프", "단단하게 고정"),
    "cutting_guidance": ("재단", "가위", "자르", "절단"),
    "component_guidance": ("마감캡", "연결캡", "엘보", "외경캡", "내경캡", "T자캡"),
    "size_spec_guidance": ("1호", "1m", "길이", "폭", "규격", "외경", "외곽", "색상"),
}
CONFIRMED_BUCKETS: tuple[str, ...] = tuple(ROUTING_RULES.keys())

# topic -> keywords; if none appear in the draft the topic is reported not-found.
NOT_FOUND_CHECKS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("실크벽지", ("실크벽지", "실크 벽지")),
    ("추가 양면테이프", ("추가 양면", "양면테이프", "양면 테이프")),
    ("거친 벽면", ("거친 벽", "거친벽")),
    ("습기", ("습기", "습한")),
    ("페인트면", ("페인트",)),
    ("깨짐 방지", ("깨짐", "파손", "갈라짐")),
    ("권장 절단 도구", ("전용 커터", "전용 칼", "권장 도구", "권장 절단")),
)

# gap-analysis signals: each aspect is classified found / not-found against the draft.
GAP_SIGNALS: tuple[dict, ...] = (
    {
        "topic": "접착력 부족",
        "aspects": (
            ("부착 전 물기/먼지 제거", ("먼지", "물기")),
            ("피스/실리콘 고정", ("피스", "실리콘", "나사")),
            ("실크벽지 조건", ("실크벽지", "실크 벽지")),
            ("추가 양면테이프", ("추가 양면", "양면테이프", "양면 테이프")),
            ("거친 벽면/습기 조건", ("거친 벽", "습기", "습한")),
        ),
        "operator_note": "리뷰의 실크벽지/접착력 불만과 상세페이지 안내 사이의 gap 점검 후보",
    },
    {
        "topic": "절단 시 깨짐",
        "aspects": (
            ("재단 안내", ("재단", "자르", "절단")),
            ("다용도 가위 등 도구 언급", ("가위", "커터", "칼")),
            ("깨짐 방지 주의", ("깨짐", "파손", "갈라짐")),
            ("권장 절단 도구의 명확한 안내", ("전용 커터", "전용 칼", "권장 도구", "권장 절단")),
        ),
        "operator_note": "절단 방법 안내의 구체성 및 깨짐 방지 안내 gap 점검 후보",
    },
)

# curated quality-flag detectors (deterministic; no invention).
MISREAD_TOKENS: tuple[str, ...] = ("식품",)
CONFLICT_PAIRS: tuple[tuple[str, str], ...] = (("외경", "외곽"),)

_NOT_FOUND_REASON = "draft fields/verbatim에서 관련 표현을 찾지 못함"


def _norm(value: str) -> str:
    return (value or "").lower()


def _item_text(item: dict) -> str:
    return f"{item.get('value', '')} {item.get('verbatim', '')}"


def _iter_items(fields: dict):
    """Yield every item dict across product_identity + the list fields."""
    pi = fields.get("product_identity") or {}
    pn = pi.get("product_name")
    if isinstance(pn, dict):
        yield pn
    for it in pi.get("package_composition") or []:
        if isinstance(it, dict):
            yield it
    for key in gs.LIST_FIELD_KEYS:
        for it in fields.get(key) or []:
            if isinstance(it, dict):
                yield it


def _slim(item: dict) -> dict:
    """Audit-preserving copy of a draft item (value/verbatim/confidence/source_tiles)."""
    return {
        "value": item.get("value", ""),
        "verbatim": item.get("verbatim", ""),
        "confidence": item.get("confidence", "low"),
        "source_tiles": list(item.get("source_tiles") or []),
    }


def _haystack(fields: dict) -> str:
    return _norm(" ".join(_item_text(it) for it in _iter_items(fields)))


def _present(haystack: str, keywords: tuple[str, ...]) -> bool:
    return any(_norm(k) in haystack for k in keywords)


def _classify(fields: dict) -> tuple[dict, int]:
    """Route each item into every bucket whose keywords it matches.

    Returns ``(buckets, unclassified_count)``. Items are deduped per bucket by
    normalized value; an item matching no bucket increments the unclassified count.
    """
    buckets: dict[str, list] = {b: [] for b in CONFIRMED_BUCKETS}
    seen: dict[str, set] = {b: set() for b in CONFIRMED_BUCKETS}
    unclassified = 0
    for it in _iter_items(fields):
        text = _norm(_item_text(it))
        matched = False
        for bucket, keywords in ROUTING_RULES.items():
            if any(_norm(k) in text for k in keywords):
                matched = True
                key = gs.normalize_value(it.get("value", ""))
                if key and key not in seen[bucket]:
                    seen[bucket].add(key)
                    buckets[bucket].append(_slim(it))
        if not matched:
            unclassified += 1
    return buckets, unclassified


def _not_found_guidance(haystack: str) -> list[dict]:
    return [
        {"topic": topic, "reason": _NOT_FOUND_REASON}
        for topic, keywords in NOT_FOUND_CHECKS
        if not _present(haystack, keywords)
    ]


def _gap_signals(haystack: str) -> list[dict]:
    signals: list[dict] = []
    for sig in GAP_SIGNALS:
        found: list[str] = []
        not_found: list[str] = []
        for label, keywords in sig["aspects"]:
            (found if _present(haystack, keywords) else not_found).append(label)
        if not not_found:
            status = "guidance_present"
        elif not found:
            status = "not_found"
        else:
            status = "partial_guidance"
        signals.append(
            {
                "topic": sig["topic"],
                "detail_page_status": status,
                "found": found,
                "not_found": not_found,
                "operator_note": sig["operator_note"],
            }
        )
    return signals


def _quality_flags(fields: dict, haystack: str, unclassified: int) -> list[dict]:
    flags: list[dict] = []

    # 1) possible vision misread (curated tokens that read wrong in context)
    for it in _iter_items(fields):
        low = _norm(_item_text(it))
        if any(_norm(tok) in low for tok in MISREAD_TOKENS):
            flags.append(
                {
                    "type": "possible_vision_misread",
                    "text": it.get("value", "") or _item_text(it),
                    "reason": "절단 도구 문맥상 오독 가능성 (운영자 확인 후보)",
                }
            )

    # 2) near-duplicate / conflicting extractions across adjacent tiles
    for a, b in CONFLICT_PAIRS:
        if _norm(a) in haystack and _norm(b) in haystack:
            flags.append(
                {
                    "type": "near_duplicate_or_conflict",
                    "text": f"{a} / {b}",
                    "reason": "인접 tile에서 유사 표현이 다르게 추출됨 (운영자 확인 후보)",
                }
            )

    # 3) confidence review — all-high draft confidence may be over-optimistic
    confs = [it.get("confidence", "low") for it in _iter_items(fields)]
    if confs and all(c == "high" for c in confs):
        flags.append(
            {
                "type": "confidence_review",
                "text": "all items high confidence",
                "reason": "draft confidence가 지나치게 낙관적일 수 있어 운영자 확인 필요",
            }
        )

    # 4) routing left items uncategorized — surface, do not silently drop
    if unclassified:
        flags.append(
            {
                "type": "unclassified_items",
                "text": f"{unclassified}개 항목이 어떤 confirmed_guidance 범주에도 매칭되지 않음",
                "reason": "라우팅 규칙에 없는 표현. 정보 누락 여부 운영자 확인 후보",
            }
        )

    return flags


def build_review(draft: dict, *, generated_at: str | None = None) -> dict:
    """Build the ``product_guidance_review.json`` payload from a draft dict (pure)."""
    fields = (draft or {}).get("fields") or {}
    buckets, unclassified = _classify(fields)
    haystack = _haystack(fields)
    return {
        "source_draft": SOURCE_DRAFT_FILENAME,
        "postprocess_mode": POSTPROCESS_MODE,
        "needs_operator_review": True,
        "consumer_visible_only": True,
        "generated_at": generated_at or datetime.now().isoformat(timespec="seconds"),
        "source_confidence": (draft or {}).get("confidence", ""),
        "confirmed_guidance": buckets,
        "not_found_guidance": _not_found_guidance(haystack),
        "review_gap_ready_signals": _gap_signals(haystack),
        "quality_flags": _quality_flags(fields, haystack, unclassified),
    }


def _result(status: str, reason: str, snapshot_dir: Path, review_path: Path | None) -> dict:
    return {
        "status": status,
        "reason": reason,
        "snapshot_dir": str(snapshot_dir),
        "review_path": str(review_path) if review_path else None,
    }


def review_guidance_draft(snapshot_dir: str | Path, *, now: datetime | None = None) -> dict:
    """Read ``product_guidance_draft.json`` from ``snapshot_dir`` and write the review.

    Fail-soft: missing dir / missing draft / unparseable draft each return
    ``status="error"`` with a clear reason and write no artifact. No network,
    no OpenAI, no multimodal.
    """
    d = Path(snapshot_dir)
    if not d.exists() or not d.is_dir():
        return _result("error", "snapshot_dir를 찾을 수 없습니다.", d, None)

    draft_path = d / SOURCE_DRAFT_FILENAME
    if not draft_path.exists():
        return _result(
            "error",
            "product_guidance_draft.json이 없습니다. 먼저 --extract-guidance 로 초안을 생성하세요.",
            d,
            None,
        )
    try:
        draft = json.loads(draft_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return _result("error", f"product_guidance_draft.json 파싱 실패: {exc}", d, None)

    generated_at = now.isoformat(timespec="seconds") if now else None
    review = build_review(draft, generated_at=generated_at)
    review_path = d / REVIEW_FILENAME
    review_path.write_text(json.dumps(review, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "status": "ok",
        "reason": "",
        "snapshot_dir": str(d),
        "review_path": str(review_path),
        "not_found_count": len(review["not_found_guidance"]),
        "gap_signal_count": len(review["review_gap_ready_signals"]),
        "quality_flag_count": len(review["quality_flags"]),
    }
