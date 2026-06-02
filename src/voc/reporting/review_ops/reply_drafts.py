from __future__ import annotations

from typing import Iterable

from .schema import AssetItem

REPLY_DRAFTS_CAP = 3
FALLBACK_TOPIC = "사용 경험"

# Topic phrases injected into the draft template. Keep operator-facing
# Korean tone; never claim a defect.
_TOPIC_PHRASES_KO: dict[str, str] = {
    "packaging_container": "용기·포장 사용감",
    "packaging_pump_leak": "용기·포장 사용감",  # cluster_id alias
    "skin_reaction": "피부 반응",
    "pad_sheet_texture": "패드 시트 사용감",
    "essence_moisture": "에센스·보습감",
    "cleansing_wipe_feel": "닦토 사용감",
    "texture_separation": "제형·밀림감",
    "color_mismatch": "색상 체감",
    "scent_change": "향 체감",
    "refill_size_request": "용량·옵션 요청",
}

# Lightweight quote → topic_key detection. Order matters: first match wins.
# Priority follows the spec — packaging > skin > pad-specific (sheet,
# essence, cleansing) > generic texture > color > scent > refill > fallback.
# Skin reaction outranks pad_sheet_texture so a quote with both
# "트러블" and "거즈" routes to 피부 반응.
_TOPIC_DETECTORS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("packaging_container",  ("용기", "뚜껑", "집게", "캡", "마개", "케이스", "누수", "샜", "새요")),
    ("skin_reaction",        ("트러블", "따가", "발진", "가려", "붉어")),
    ("pad_sheet_texture",    ("시트", "패드", "거즈", "보풀", "마찰", "까슬", "거칠")),
    ("essence_moisture",     ("에센스", "촉촉", "보습", "건조", "흡수", "수분")),
    ("cleansing_wipe_feel",  ("닦토", "닦아", "닦을", "자극", "마무리감")),
    ("texture_separation",   ("분리", "뭉침", "밀림", "제형")),
    ("color_mismatch",       ("색", "발색", "톤", "다크닝", "칙칙")),
    ("scent_change",         ("향", "냄새", "역해", "인공적")),
    ("refill_size_request",  ("리필", "대용량", "여행용", "옵션 추가")),
)


def topic_key_for_text(text: str) -> str | None:
    """Return the first matching topic key for `text`, or None.

    Public helper so report_model can reuse the same detector for
    cluster-fallback inference on risk assets without duplicating the
    keyword sets.
    """
    if not text:
        return None
    for key, kws in _TOPIC_DETECTORS:
        if any(k in text for k in kws):
            return key
    return None


def _topic_phrase_for(item: AssetItem) -> str:
    # Prefer an explicit topic_label if one is present (forward-compat).
    for label in (item.topic_labels or []):
        if label in _TOPIC_PHRASES_KO:
            return _TOPIC_PHRASES_KO[label]
    text = item.quote or ""
    for key, kws in _TOPIC_DETECTORS:
        if any(k in text for k in kws):
            return _TOPIC_PHRASES_KO[key]
    return FALLBACK_TOPIC


def _risk_draft(topic: str) -> str:
    return (
        "리뷰 남겨주셔서 감사합니다. "
        f"말씀해주신 {topic} 관련 부분을 다시 확인해보겠습니다. "
        "사용 환경에 따라 체감이 다를 수 있어, 추가 문의가 있으시면 "
        "고객센터로 안내 부탁드립니다."
    )


def _stale_draft(topic: str) -> str:
    return (
        "리뷰 남겨주셔서 감사합니다. 작성 시점 이후 일부 사양이 변경되었을 "
        f"가능성이 있어, 말씀해주신 {topic} 관련 부분의 현재 상태를 다시 "
        "확인해보겠습니다. 추가 문의가 있으시면 고객센터로 안내 부탁드립니다."
    )


def _risk_rationale(channel: str | None) -> str:
    # Olive Young doesn't expose public seller replies → "답글 회수" misframes
    # the action. Use CS-response wording instead.
    if channel == "oliveyoung":
        return "리스크 후보 — CS 응대 문구 검토"
    return "리스크 후보 — CS 답글 회수 검토"


def _draft_for(item: AssetItem, *, source: str, channel: str | None = None) -> dict:
    is_stale = source == "stale"
    topic = _topic_phrase_for(item)
    return {
        "review_id": item.review_id,
        "rating": item.rating,
        "review_date": item.review_date.isoformat() if item.review_date else None,
        "topic": topic,
        "tone": "humble_stale" if is_stale else "humble",
        "draft": _stale_draft(topic) if is_stale else _risk_draft(topic),
        "rationale": (
            "오래된 부정 리뷰 — 현재 상태 확인 후보"
            if is_stale
            else _risk_rationale(channel)
        ),
        "source": source,
    }


def _select(
    risk_items: Iterable[AssetItem],
    stale_items: Iterable[AssetItem],
    *,
    channel: str | None = None,
) -> list[dict]:
    drafts: list[dict] = []
    seen_ids: set[str] = set()

    for item in risk_items:
        if len(drafts) >= REPLY_DRAFTS_CAP:
            break
        if item.review_id in seen_ids:
            continue
        drafts.append(_draft_for(item, source="risk", channel=channel))
        seen_ids.add(item.review_id)

    if len(drafts) < REPLY_DRAFTS_CAP:
        for item in stale_items:
            if len(drafts) >= REPLY_DRAFTS_CAP:
                break
            if item.review_id in seen_ids:
                continue
            drafts.append(_draft_for(item, source="stale", channel=channel))
            seen_ids.add(item.review_id)
    return drafts


def generate(
    *,
    risk_assets: list[AssetItem],
    stale_assets: list[AssetItem],
    channel: str | None = None,
) -> list[dict]:
    """Produce up to REPLY_DRAFTS_CAP topic-aware reply drafts.

    Risk assets are preferred; stale assets fill remaining slots. The
    topic phrase is derived from explicit topic_labels (forward-compat)
    or, falling back, from a deterministic keyword scan over the quote
    text. Pad/sheet/essence/cleansing-specific topics are routed before
    generic texture so skincare-pad complaints get a sharper draft.
    `channel` adjusts the rationale wording for channels (e.g. olive young)
    that don't surface public seller replies.
    """
    return _select(risk_assets, stale_assets, channel=channel)
