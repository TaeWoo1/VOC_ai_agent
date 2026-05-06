"""Buyer-journey cardnews layout (10-15 slides, content-only contract).

Per run-003 reviewer feedback the existing 7-slide cardnews collapses
the buyer journey into one card per category — the seller PDF tells
a richer story than the cardnews. This module produces a JSON that
follows a 10-15 slide buyer journey narrative:

  1. Ask           — "다들 좋다는데, 내 피부에도 맞을까?"
  2. Scope         — "실사용 리뷰 N건을 봤어요"
  3. Verdict       — 한 줄 결론
  4-6. Loved point — 좋았던 점 (per attribute)
  7. Divides       — 의견이 갈린 부분
  8-10. Checkpoint — 확인 포인트 (per attribute)
  11. Fit          — 이런 분께 잘 맞을 수 있어요
  12. Consider     — 이런 분은 한 번 더 확인하세요
  13. Checklist    — 구매 전 체크리스트
  14. Method       — 분석 방법과 한계

This is a CONTENT contract — the JSON is consumed by a downstream
design skill (Figma / Claude / etc.). No visual rendering happens here.
The schema is intentionally rich (per-slide `type`, `attribute_key`,
`evidence_quotes`, `tone` block) so the design skill can lay out the
slides without re-reading analysis_report.

Pure: no I/O, no LLM, no Stage 1/2 mutation. The function reads
analysis_report.json + the consumer_insight_brief output (when given)
and returns a dict.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from src.voc.content.confidence_axes import compute_confidence_axes
from src.voc.content.reader_friendly_wording import (
    label_for_polarity,
    replace_internal_terms,
    to_seller_friendly,
)


SCHEMA_VERSION: str = "1.0"
FORMAT: str = "cardnews_buyer_journey"
LANG_DEFAULT: str = "ko"
CHANNEL_DEFAULT: str = "instagram"

# Soft slide-count band the layout aims for. The design skill can
# accept 10-15 slides; if we have fewer attributes the layout shrinks
# gracefully (loved_point and checkpoint slides drop out individually).
MIN_SLIDE_COUNT: int = 10
MAX_SLIDE_COUNT: int = 15

# Per-attribute slide caps so a corpus with many attributes doesn't
# blow past 15 slides.
MAX_LOVED_POINT_SLIDES: int = 3
MAX_CHECKPOINT_SLIDES: int = 3

# Tone block — what the design skill should target verbatim.
DEFAULT_TONE: dict[str, Any] = {
    "voice": "calm_review_based",
    "audience": "korean_beauty_buyer",
    "register": "polite",
    "avoid": [
        "효능 보장 표현",
        "결함 확정 표현",
        "과장된 광고 표현",
        "의학적 단정",
        "내부 분석 용어 (관찰 신호 / 모니터링 후보 / 신뢰도 낮음)",
    ],
    "encourage": [
        "리뷰 기반",
        "참고 수준 단서",
        "구매 전 확인 포인트",
        "사용 시나리오별 차이",
    ],
}


# ---------------------------------------------------------------------------
# Slide builders
# ---------------------------------------------------------------------------


def _ask_slide(index: int) -> dict:
    """Slide 1 — empathy hook addressed to the buyer journey question."""
    return {
        "index": index,
        "type": "ask",
        "title": "다들 좋다는데,\n내 피부에도 맞을까?",
        "body_lines": [
            "리뷰는 많은데 결국 내 피부에도 잘 맞을지 궁금하셨다면,",
            "실사용 리뷰를 정리해 드려요.",
        ],
    }


def _scope_slide(index: int, n_reviews: int) -> dict:
    """Slide 2 — corpus scope ("리뷰 N건을 봤어요")."""
    return {
        "index": index,
        "type": "scope",
        "title": f"실사용 리뷰 {n_reviews:,}건을 봤어요",
        "body_lines": [
            "여러 정렬(최신순·평점순·도움순)에서 모은 리뷰를 합쳐서",
            "반복되는 만족 / 아쉬움 의견을 정리했습니다.",
        ],
        "n_reviews": int(n_reviews),
    }


def _verdict_slide(index: int, analysis_report: dict) -> dict:
    """Slide 3 — one-liner verdict pulled from quick_decision."""
    qd = analysis_report.get("quick_decision") or {}
    raw_verdict = qd.get("verdict_ko") or "리뷰에서 반복되는 만족 의견과 함께, 일부 항목은 구매 전 확인을 권장합니다."
    body = to_seller_friendly(raw_verdict)
    return {
        "index": index,
        "type": "verdict",
        "title": "한 줄 결론",
        "body_lines": [body],
    }


# Distinct closing lines so consecutive loved-point slides don't read
# as a copy-paste loop (Run-003 QA pass-4 callout).
_LOVED_POINT_CLOSINGS_KO: tuple[str, ...] = (
    "이 부분은 만족도가 높았어요.",
    "내 사용 루틴과 맞는지 떠올려 봐도 좋아요.",
    "비슷한 후기가 여러 차례 반복돼요.",
)
_CHECKPOINT_CLOSINGS_KO: tuple[str, ...] = (
    "이 부분은 한 번 더 확인해보세요.",
    "내 피부 타입 / 사용 루틴과 맞는지 보는 게 좋아요.",
    "사용 환경에 따라 체감이 갈리는 부분이에요.",
)


# Per-attribute Korean phrasing for the "loved point" headline.
# Run-003 QA pass-5: "건조감/당김과 관련해 만족 의견이 누적" reads
# semantically odd because the attribute label is already a complaint
# noun. The replacement reframes the positive-side label as the
# experience the reviewer reported.
_LOVED_POINT_HEADLINE_KO: dict[str, str] = {
    "finish_texture": "촉촉하게 마무리된다는 의견이 많았어요",
    "value_price": "대용량 가성비가 좋다는 의견이 많았어요",
    "dryness_skin_texture": "당김이 적었다는 / 건조함이 줄었다는 의견이 많았어요",
    "adhesion_base_interaction": "피부에 잘 밀착된다는 의견이 많았어요",
    "persistence": "보습이 오래 간다는 의견이 많았어요",
    "packaging_container": "패키지 / 휴대성이 편하다는 의견이 많았어요",
    "applicator_tool": "도구 사용이 편하다는 의견이 많았어요",
    "color_tone_matching": "색감이 잘 맞는다는 의견이 많았어요",
    "pigmentation": "발색이 좋다는 의견이 많았어요",
    "transfer_resistance": "묻어남이 적다는 의견이 많았어요",
    "application_blending": "발림이 좋다는 의견이 많았어요",
    "multi_use_lip_cheek_compatibility": "립앤치크 활용이 좋다는 의견이 많았어요",
}

# Per-attribute Korean phrasing for the "checkpoint" headline. Same
# reframing — the negative-side label reads as a buyer-friendly check
# question instead of a clinical "X 관련 아쉬움 의견" string.
_CHECKPOINT_HEADLINE_KO: dict[str, str] = {
    "finish_texture": "촉촉함/마무리감에서 갈린 의견이 있었어요",
    "value_price": "체감 가성비가 갈렸다는 의견이 있었어요",
    "dryness_skin_texture": "건성/민감 피부에서 당김을 느꼈다는 의견이 있었어요",
    "adhesion_base_interaction": "사용 환경에 따라 밀착이 아쉬웠다는 의견이 있었어요",
    "persistence": "보습 지속이 짧게 느껴졌다는 의견이 있었어요",
    "packaging_container": "용기 / 집게 사용이 불편했다는 의견이 있었어요",
    "applicator_tool": "도구 사용이 불편했다는 의견이 있었어요",
    "color_tone_matching": "색감이 기대와 달랐다는 의견이 있었어요",
    "pigmentation": "발색이 기대와 달랐다는 의견이 있었어요",
    "transfer_resistance": "마스크 / 외출 시 묻어남이 있었다는 의견이 있었어요",
    "application_blending": "발림이 아쉬웠다는 의견이 있었어요",
    "multi_use_lip_cheek_compatibility": "립앤치크 활용이 아쉬웠다는 의견이 있었어요",
}


def _loved_point_headline_for(attr_key: str, label: str, n: int) -> str:
    template = _LOVED_POINT_HEADLINE_KO.get(attr_key)
    if template:
        return f"{template} (만족 의견 {n:,}건)"
    # Generic fallback that doesn't use awkward "X 관련" phrasing.
    return f"{label}에서 만족 의견이 {n:,}건 누적되었어요"


def _checkpoint_headline_for(attr_key: str, label: str, n: int) -> str:
    template = _CHECKPOINT_HEADLINE_KO.get(attr_key)
    if template:
        return f"{template} (아쉬움 의견 {n:,}건)"
    return f"{label}에서 아쉬움 의견이 {n:,}건 누적되었어요"


def _loved_point_slides(
    start_index: int, analysis_report: dict,
) -> list[dict]:
    """Slides 4-6 — top satisfaction points, one slide per top strength."""
    strengths = analysis_report.get("strengths") or []
    out: list[dict] = []
    for s in strengths[:MAX_LOVED_POINT_SLIDES]:
        attr_key = s.get("attribute_key") or ""
        # Resolve label_ko from the attributes block (so the cardnews
        # uses the same Korean label as the rest of the report).
        label = _label_for_attribute(analysis_report, attr_key)
        n = int(s.get("supporting_count") or 0)
        rep = s.get("representative_quote") or {}
        # Skip representative when the polarity guardrail flagged it
        # OR the attribute-fit guardrail flagged it as off-topic.
        # Fall back to a clean positive quote from top_quotes.
        if rep.get("polarity_suspect") or rep.get("attribute_fit_warning"):
            rep = {}
            for a in (analysis_report.get("attributes") or []):
                if a.get("key") != attr_key:
                    continue
                for q in a.get("top_quotes") or []:
                    if (
                        (q.get("polarity") or "").lower() == "positive"
                        and not q.get("polarity_suspect")
                        and not q.get("attribute_fit_warning")
                    ):
                        rep = q
                        break
                break
        quote = (
            rep.get("display_quote_summary")
            or rep.get("display_text")
            or rep.get("text")
            or ""
        )
        quote = to_seller_friendly(quote)
        out.append({
            "index": start_index + len(out),
            "type": "loved_point",
            "title": f"좋았던 점: {label}",
            "attribute_key": attr_key,
            "support_count": n,
            "headline": f"리뷰 {n}건에서 만족 의견이 반복적으로 누적",
            "evidence_quote": {
                "display_text": quote,
                "review_id": rep.get("review_id"),
            },
            "body_lines": [
                _loved_point_headline_for(attr_key, label, n) + ".",
                _LOVED_POINT_CLOSINGS_KO[
                    len(out) % len(_LOVED_POINT_CLOSINGS_KO)
                ],
            ],
        })
    return out


def _divides_slide(index: int, analysis_report: dict) -> dict:
    """Single slide flagging that opinions split on at least one
    attribute. Pulls from `usage_patterns[kind=contradiction]`."""
    patterns = analysis_report.get("usage_patterns") or []
    contradictions = [p for p in patterns if p.get("kind") == "contradiction"]
    bullets: list[str] = []
    for c in contradictions[:3]:
        sentence = to_seller_friendly(c.get("sentence_ko") or "")
        if sentence:
            bullets.append(sentence)
    if not bullets:
        bullets = [
            "한 항목에서는 대부분 만족하지만, 다른 항목에서는 사용자별 체감이 갈렸습니다.",
        ]
    return {
        "index": index,
        "type": "divides",
        "title": "그런데 의견이 갈린 부분",
        "body_lines": bullets,
    }


def _checkpoint_slides(
    start_index: int, analysis_report: dict,
) -> list[dict]:
    """Slides per monitoring candidate ("확인 포인트")."""
    monitoring = analysis_report.get("monitoring_candidates") or []
    out: list[dict] = []
    for m in monitoring[:MAX_CHECKPOINT_SLIDES]:
        attr_key = m.get("attribute_key") or ""
        label = m.get("concern_label_ko") or _label_for_attribute(
            analysis_report, attr_key,
        )
        n_neg = int(m.get("n_negative") or 0)
        quotes = m.get("top_negative_quotes") or []
        # Pick up to 2 readable quotes for the design surface.
        # `display_quote_summary` carries the de-duplicated PDF-style
        # phrase (no "...아쉬움 의견" tail). Fall back to display_text
        # / raw text. Polarity-suspect quotes are skipped.
        evidence: list[dict] = []
        for q in quotes[:6]:
            if q.get("polarity_suspect") or q.get("attribute_fit_warning"):
                continue
            disp = (
                q.get("display_quote_summary")
                or q.get("display_text")
                or q.get("text")
                or ""
            )
            evidence.append({
                "display_text": to_seller_friendly(disp),
                "review_id": q.get("review_id"),
            })
            if len(evidence) >= 2:
                break
        out.append({
            "index": start_index + len(out),
            "type": "checkpoint",
            "title": f"확인 포인트: {label}",
            "attribute_key": attr_key,
            "concern_label_ko": label,
            "support_count": n_neg,
            "headline": f"리뷰 {n_neg}건에서 아쉬움 의견이 반복",
            "evidence_quotes": evidence,
            "body_lines": [
                _checkpoint_headline_for(attr_key, label, n_neg) + ".",
                _CHECKPOINT_CLOSINGS_KO[
                    len(out) % len(_CHECKPOINT_CLOSINGS_KO)
                ],
            ],
        })
    return out


def _fit_slide(index: int, analysis_report: dict) -> dict:
    qd = analysis_report.get("quick_decision") or {}
    who_for = [to_seller_friendly(s) for s in (qd.get("who_for_ko") or [])][:3]
    if not who_for:
        who_for = [
            "리뷰에서 만족 의견이 누적된 항목이 매력적인 분",
        ]
    return {
        "index": index,
        "type": "fit",
        "title": "이런 분께 잘 맞을 수 있어요",
        "body_lines": who_for,
    }


def _consider_slide(index: int, analysis_report: dict) -> dict:
    qd = analysis_report.get("quick_decision") or {}
    who_not = [to_seller_friendly(s) for s in (qd.get("who_not_for_ko") or [])][:3]
    if not who_not:
        who_not = [
            "민감한 항목이 있으신 분은 구매 전 한 번 더 확인해 주세요.",
        ]
    return {
        "index": index,
        "type": "consider",
        "title": "이런 분은 한 번 더 확인하세요",
        "body_lines": who_not,
    }


def _checklist_slide(index: int, analysis_report: dict) -> dict:
    """Roll up the watch_outs into a 3-item buyer checklist."""
    qd = analysis_report.get("quick_decision") or {}
    watch_outs = qd.get("watch_outs_ko") or []
    bullets: list[str] = []
    for w in watch_outs[:3]:
        bullets.append(f"{w} 관련 후기 흐름이 내 사용 상황과 맞는지 확인")
    if not bullets:
        bullets = [
            "후기에서 갈리는 항목이 내 사용 환경에 영향을 주는지 확인",
        ]
    bullets.append("리뷰는 참고용 단서이며, 효능을 보장하지는 않습니다.")
    return {
        "index": index,
        "type": "checklist",
        "title": "구매 전 체크리스트",
        "body_lines": bullets,
    }


def _method_slide(
    index: int,
    analysis_report: dict,
    confidence_axes: dict,
) -> dict:
    """Final slide — analysis method + caveats. Surfaces the four-axis
    breakdown so the design skill can show "참고 수준" / "표본 충분"
    chips matching the seller PDF."""
    n_reviews = int(
        (analysis_report.get("corpus") or {}).get("n_reviews_analyzed") or 0
    )
    methodology = analysis_report.get("methodology_notes") or {}
    bullets = [
        f"실사용 리뷰 {n_reviews:,}건을 정리한 결과예요.",
        to_seller_friendly(
            confidence_axes["sample_size_confidence"]["note_ko"]
        ),
        to_seller_friendly(
            confidence_axes["negative_signal_coverage"]["note_ko"]
        ),
        "리뷰 기반의 참고 자료이며, 제품 효능을 보장하지 않습니다.",
    ]
    return {
        "index": index,
        "type": "method",
        "title": "분석 방법과 한계",
        "body_lines": bullets,
        "disclosure": to_seller_friendly(
            methodology.get("disclosure_ko") or ""
        ),
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _korean_object_particle(label: str) -> str:
    """Pick the right object particle (을/를) for `label`'s last syllable.

    Korean object marker depends on the final consonant (받침):
      - has 받침 → "을"
      - no 받침 → "를"
    Falls back to "를" for non-Hangul tails (numbers, English, …).
    """
    if not label:
        return "를"
    last = label.strip()[-1]
    code = ord(last)
    if 0xAC00 <= code <= 0xD7A3:
        return "을" if (code - 0xAC00) % 28 != 0 else "를"
    return "를"


def _korean_topic_particle(label: str) -> str:
    """Pick 은/는 by 받침. Used for "{label}는 ~" sentences."""
    if not label:
        return "는"
    last = label.strip()[-1]
    code = ord(last)
    if 0xAC00 <= code <= 0xD7A3:
        return "은" if (code - 0xAC00) % 28 != 0 else "는"
    return "는"


def _korean_with_particle(label: str) -> str:
    """Pick 과/와 by 받침. Used for "{label}와 ~" sentences. Emits the
    GRAMMAR-CORRECT particle, never "와(과)" / "은(는)" / "을(를)" —
    those literal fallback forms read as machine-generated."""
    if not label:
        return "와"
    last = label.strip()[-1]
    code = ord(last)
    if 0xAC00 <= code <= 0xD7A3:
        return "과" if (code - 0xAC00) % 28 != 0 else "와"
    return "와"


def _label_for_attribute(analysis_report: dict, attr_key: str) -> str:
    """Look up the Korean label for an attribute from the report's
    attributes block. Falls back to the raw key when missing."""
    if not attr_key:
        return ""
    for a in analysis_report.get("attributes") or []:
        if a.get("key") == attr_key:
            label = a.get("label_ko")
            if isinstance(label, str) and label.strip():
                return label.strip()
    return attr_key


def _analysis_report_sha256(report: dict) -> str:
    return hashlib.sha256(
        json.dumps(report, ensure_ascii=False, sort_keys=True).encode("utf-8"),
    ).hexdigest()


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def build_buyer_journey_cardnews(
    analysis_report: dict,
    *,
    sorts_succeeded: list[str] | None = None,
    sorts_failed: list[str] | None = None,
    sorts_attempted: list[str] | None = None,
    partial_success: bool | None = None,
    lang: str = LANG_DEFAULT,
    channel: str = CHANNEL_DEFAULT,
) -> dict:
    """Build the 10-15 slide buyer-journey cardnews JSON.

    The function pulls strengths / monitoring_candidates /
    quick_decision / methodology_notes from `analysis_report` and lays
    them out as a buyer journey. Per-attribute "loved_point" and
    "checkpoint" slides expand based on the corpus signal — corpora
    with fewer than 3 strengths or fewer than 3 monitoring candidates
    produce a shorter cardnews (down to ~10 slides) rather than padding
    with corpus-generic copy.

    `sorts_*` / `partial_success` are optional overrides — when not
    passed, the function reads `analysis_report.corpus.confidence_axes`
    if present, else falls back to a re-derive from the report shape.
    Slide 14 surfaces the negative-signal coverage caveat
    (RATING_ASC failure → "아쉬움 신호 과소 관측 우려") so the design
    skill can render it on the methodology card.
    """
    if not isinstance(analysis_report, dict):
        raise ValueError("analysis_report must be a dict")

    corpus = analysis_report.get("corpus") or {}
    n_reviews = int(corpus.get("n_reviews_analyzed") or 0)
    polarity_audit = analysis_report.get("polarity_audit")

    # Resolve confidence axes — prefer pre-computed (analysis_report
    # 3.x writes it) so the cardnews and the seller PDF stay in sync.
    confidence_axes = corpus.get("confidence_axes")
    if not isinstance(confidence_axes, dict):
        confidence_axes = compute_confidence_axes(
            n_reviews=n_reviews,
            polarity_audit=polarity_audit,
            sorts_attempted=sorts_attempted,
            sorts_succeeded=sorts_succeeded,
            sorts_failed=sorts_failed,
            partial_success=partial_success,
        )

    slides: list[dict] = []
    next_index = 1

    slides.append(_ask_slide(next_index)); next_index += 1
    slides.append(_scope_slide(next_index, n_reviews)); next_index += 1
    slides.append(_verdict_slide(next_index, analysis_report)); next_index += 1

    loved = _loved_point_slides(next_index, analysis_report)
    slides.extend(loved); next_index += len(loved)

    slides.append(_divides_slide(next_index, analysis_report)); next_index += 1

    checkpoints = _checkpoint_slides(next_index, analysis_report)
    slides.extend(checkpoints); next_index += len(checkpoints)

    slides.append(_fit_slide(next_index, analysis_report)); next_index += 1
    slides.append(_consider_slide(next_index, analysis_report)); next_index += 1
    slides.append(_checklist_slide(next_index, analysis_report)); next_index += 1
    slides.append(_method_slide(
        next_index, analysis_report, confidence_axes,
    )); next_index += 1

    # Reindex contiguously (defensive).
    for i, p in enumerate(slides, start=1):
        p["index"] = i

    product = analysis_report.get("product") or {}
    # Pass-15: cardnews surfaces use the cleaned headline only. The
    # raw merch name with promo brackets / gift bundles never appears
    # on a slide title — sellers' content teams distribute these
    # cardnews directly. `name_ko` is preserved for backward compat
    # with downstream consumers but populated from the cleaned form.
    cardnews_display_name = (
        product.get("display_product_name")
        or product.get("name_ko")
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "format": FORMAT,
        "lang": lang,
        "channel": channel,
        "product": {
            "slug": product.get("slug"),
            # Legacy field — now populated from the cleaned name so
            # any consumer that reads `name_ko` gets the cover-safe
            # form. The raw_product_name is preserved on the analysis_
            # report block for audit; cardnews is a presentation surface.
            "name_ko": cardnews_display_name,
            "display_product_name": product.get("display_product_name"),
            "raw_product_name": product.get("raw_product_name"),
            "offer_context": product.get("offer_context"),
            "category": product.get("category"),
            "source_url": product.get("source_url"),
            "image_url": product.get("image_url"),
        },
        "tone": dict(DEFAULT_TONE),
        "confidence_axes": confidence_axes,
        "slide_count": len(slides),
        "slides": slides,
        "analysis_report_sha256": _analysis_report_sha256(analysis_report),
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


__all__ = [
    "SCHEMA_VERSION",
    "FORMAT",
    "MIN_SLIDE_COUNT",
    "MAX_SLIDE_COUNT",
    "DEFAULT_TONE",
    "build_buyer_journey_cardnews",
]
