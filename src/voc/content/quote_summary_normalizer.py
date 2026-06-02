"""Single source of truth for `display_quote_summary` quality.

Pass-17 promotes the quote-quality logic from the PDF renderer (where
it was a render-time fallback) up to the adapter layer (so the
analysis_report.json itself carries clean values).

Why one shared module
---------------------
- Adapter (`src/voc/content/adapters/from_phase2e.py`) — calls
  `normalize_display_quote_summary` on every quote block during
  analysis_report assembly. The output JSON's
  `attributes[].top_quotes[].display_quote_summary` is therefore
  always one of: a clean review-extracted summary, or a profile-and-
  attribute-aware fallback. Never truncated / dangling / generic.
- PDF renderer (`scripts/generate_phase2e_pdf_v2.py`) — uses the
  same predicates as a defense-in-depth fallback, but most reports
  produced by pass-17 will see no degraded summary by the time
  they hit the renderer.
- Inspector (`scripts/inspect_run_quality.py`) — uses the same
  predicates so its "degraded" verdict matches what the renderer
  would have rejected. No drift between modules.

Hard rules
----------
- Pure: no I/O.
- Never raises: malformed input → returns the raw or "(인용 요약 부재)"
  rather than crashing.
- Never paraphrases the audit `text` field. Only the
  `display_quote_summary` surface is rewritten.
- The fallback summaries are buyer-tone, hedged, never directive
  (matches CLAUDE.md §8 wording-safety contract).
"""
from __future__ import annotations

from typing import Final


# ---------------------------------------------------------------------------
# Predicates — identical contract to the pass-16 PDF-renderer helpers
# ---------------------------------------------------------------------------

# Truncation markers (literal "..." or "…") inside the summary string.
_TRUNCATION_MARKERS: Final[tuple[str, ...]] = ("...", "…", " ...", " …")


def looks_truncated(text: str) -> bool:
    """True when the summary contains a truncation marker. Operators
    read these as "the quote was cut off" — never acceptable in a
    seller-facing report."""
    if not isinstance(text, str):
        return False
    s = text.strip()
    if not s:
        return False
    return any(m in s for m in _TRUNCATION_MARKERS)


# Korean sentence-final markers — anything else at the tail looks
# mid-sentence to a reader.
_KO_SENTENCE_FINAL_CHARS: Final[frozenset[str]] = frozenset(
    "다요까네죠워에음임함됨봐아어니까"
)
_PUNCT_FINAL_CHARS: Final[frozenset[str]] = frozenset(".!?…」』」'\"")

# Multi-character nominal-phrase tails that are intentionally complete
# in a summary surface ("...라는 의견" / "...로 언급" / "...있는
# 느낌"). Pass-17 fallbacks deliberately end in these forms — without
# this allow-list the predicate flags every fallback as dangling.
_NOMINAL_TAIL_SUFFIXES: Final[tuple[str, ...]] = (
    "의견",
    "언급",
    "느낌",
    "표현",
    "차이",
    "포인트",
    "데이터",
    "경우",
    "정도",
    "수준",
    "경향",
)


def looks_dangling(text: str, *, min_len: int = 8) -> bool:
    """True when the text is too short OR ends in a non-final Korean
    syllable. Short summaries are evidence-less by definition.

    Pass-17: accepts well-formed nominal-phrase tails (ending in
    `의견 / 언급 / 느낌 / ...`) so the curated fallback summaries
    don't false-positive as dangling.
    """
    if not isinstance(text, str):
        return True
    s = text.strip()
    if not s:
        return True
    if len(s) < min_len:
        return True
    last = s[-1]
    if last in _PUNCT_FINAL_CHARS:
        return False
    if last in _KO_SENTENCE_FINAL_CHARS:
        return False
    # Nominal-phrase tail allow-list (multi-char suffixes).
    for suffix in _NOMINAL_TAIL_SUFFIXES:
        if s.endswith(suffix):
            return False
    return "가" <= last <= "힣"


# Filler / generic-tone phrases that surface in cosmetics reviews
# without carrying any attribute-specific information.
_GENERIC_PATTERNS_KO: Final[tuple[str, ...]] = (
    "생각보다 만족",
    "그냥 만족",
    "좋아요",
    "좋네요",
    "좋습니다",
    "괜찮아요",
    "괜찮네요",
    "별로예요",
    "별로네요",
    "잘 모르겠어요",
    "편하네요",
    "편해요",
    "편합니다",
    "은근히",
    "나쁘지 않",
    "나쁘진 않",
    "엄마가 진짜",
    # Pass-19H: structural shape of `_last_resort_summary` output.
    # When a profile/attr table miss, the resolver emits
    # "{label} 관련 만족 의견" / "{label} 관련 아쉬움 의견". These are
    # generic by construction; flag them so a regression that drops
    # an attribute from the profile table can't sneak through.
    "관련 만족 의견",
    "관련 아쉬움 의견",
)

_GENERIC_LENGTH_THRESHOLD: Final[int] = 14
_GENERIC_BARE_LIMIT: Final[int] = 12


def looks_too_generic(text: str) -> bool:
    """Combined short-and-filler check.

    - Anything ≤ 12 chars is generic by default (no real evidence
      survives in that span).
    - 13–14 chars: generic ONLY if a known filler pattern matches.
    - >14 chars: substantive enough that filler tokens inside don't
      disqualify it ("발색이 정말 좋아요. 색이 오래 갑니다.").
    """
    if not isinstance(text, str):
        return True
    s = text.strip()
    if not s:
        return True
    if len(s) <= _GENERIC_BARE_LIMIT:
        return True
    if len(s) > _GENERIC_LENGTH_THRESHOLD:
        return False
    return any(p in s for p in _GENERIC_PATTERNS_KO)


def is_degraded_quote_summary(text: str) -> bool:
    """Single-call predicate the renderer / inspector / adapter all
    use to decide whether a `display_quote_summary` value is unfit
    for the seller report."""
    if not isinstance(text, str) or not text.strip():
        return True
    return (
        looks_truncated(text)
        or looks_dangling(text)
        or looks_too_generic(text)
    )


# ---------------------------------------------------------------------------
# Profile + attribute + polarity → fallback summary
# ---------------------------------------------------------------------------
#
# When the quote-derived `display_quote_summary` is degraded (or
# missing entirely), the normalizer substitutes a profile-aware,
# attribute-specific fallback. The phrasing is the operator-friendly
# form the user locked in pass-17: "...라는 의견" suffix rather than
# the longer "...만족 포인트로 언급" form, so the appendix sample
# column stays compact.
#
# Attributes / polarities not in the map fall through to a generic
# attribute-name-based stub (`{label} 관련 의견`).

_POLARITY_KEY_MAP: Final[dict[str, str]] = {
    "positive": "positive",
    "negative": "negative",
    "negative_strong": "negative",
    "negative_weak": "negative_weak",
    "mixed": "negative",  # mixed surfaces on the negative side in 7.2
}

# When a profile/attr table doesn't carry an explicit `negative_weak`
# entry, the resolver falls back to `negative`. This keeps existing
# (negative-only) tables working without forcing every profile to
# duplicate strong/weak rows.
_POLARITY_KEY_FALLBACK: Final[dict[str, str]] = {
    "negative_weak": "negative",
}


# Per-(profile, attr_key, polarity_key) → summary text.
# polarity_key is "positive" | "negative".
_FALLBACK_SUMMARY_KO: Final[dict[str, dict[str, dict[str, str]]]] = {
    "skincare_pad": {
        "finish_texture": {
            "positive": "촉촉하고 편안한 마무리감을 만족 포인트로 언급",
            "negative": "마무리감이 답답하거나 빨리 마르는 느낌이 있다는 의견",
        },
        "dryness_skin_texture": {
            "positive": "건조함이 덜하고 당김이 적다는 의견",
            "negative": "금방 건조해지거나 당김이 있다는 의견",
        },
        "adhesion_base_interaction": {
            "positive": "시트가 얇고 피부에 잘 밀착된다는 의견",
            "negative": "밀착 체감이 약하거나 들뜸을 느꼈다는 의견",
        },
        "persistence": {
            "positive": "사용 후 보습 지속이 길게 느껴진다는 의견",
            "negative": "지속 시간이 짧게 느껴진다는 의견",
        },
        "value_price": {
            "positive": "용량 대비 가성비를 만족 포인트로 언급",
            "negative": "체감 가성비가 사용 빈도에 따라 갈린다는 의견",
        },
        "packaging_container": {
            "positive": "케이스 구성이 좋다는 의견",
            "negative": "용기나 집게 사용이 불편하다는 의견",
        },
        "applicator_tool": {
            "positive": "도구 사용이 편하다는 의견",
            "negative": "도구 사용감이나 위생 측면을 아쉬움으로 언급",
        },
    },
    "skincare_general": {
        "finish_texture": {
            "positive": "촉촉하고 편안한 마무리감을 만족 포인트로 언급",
            "negative": "마무리감이 끈적이거나 무겁다는 의견",
        },
        "dryness_skin_texture": {
            "positive": "건조함이 덜하고 당김이 적다는 의견",
            "negative": "금방 건조해지거나 당김이 있다는 의견",
        },
        "persistence": {
            "positive": "보습 지속이 길게 느껴진다는 의견",
            "negative": "보습 지속이 짧게 느껴진다는 의견",
        },
        "value_price": {
            "positive": "용량 대비 가성비를 만족 포인트로 언급",
            "negative": "체감 가성비가 갈린다는 의견",
        },
    },
    "base_makeup": {
        # Pass-19: cushion / foundation / BB / 톤업 / 컨실러 spec.
        # Wording is base-makeup-anchored — no skincare-pad leakage
        # like "패드 밀착력" or "보습 보강 단계".
        "finish_texture": {
            "positive": "얇고 편안한 피부 표현을 만족 포인트로 언급",
            "negative": "매트함, 답답함, 들뜸을 아쉬움으로 언급",
        },
        "dryness_skin_texture": {
            "positive": "건조함이나 각질 부각이 덜하다는 의견",
            "negative": "건조함, 당김, 각질·요철 부각을 아쉬움으로 언급",
        },
        "adhesion_base_interaction": {
            "positive": "얇게 밀착되고 피부 표현이 편하다는 의견",
            "negative": "들뜸, 끼임, 밀림을 아쉬움으로 언급",
        },
        "application_blending": {
            "positive": "얇고 부드럽게 발린다는 의견",
            "negative": "펴바르기 어렵거나 뭉침을 아쉬움으로 언급",
        },
        "color_tone_matching": {
            "positive": "피부톤과 자연스럽게 맞거나 화사하다는 의견",
            "negative": "밝기, 다크닝, 칙칙함을 아쉬움으로 언급",
        },
        "persistence": {
            "positive": "다크닝이나 무너짐이 적고 오래 유지된다는 의견",
            "negative": "시간이 지나며 무너짐, 다크닝, 수정화장을 아쉬움으로 언급",
        },
        "pigmentation": {
            "positive": "발색이 잘 받는다는 의견",
            "negative": "발색이 약하거나 의도와 다르게 나온다는 의견",
        },
        "transfer_resistance": {
            "positive": "묻어남이 적거나 픽싱이 잘 된다는 의견",
            "negative": "마스크·옷 묻어남을 아쉬움으로 언급",
        },
        "applicator_tool": {
            "positive": "퍼프 사용감과 양 조절이 편하다는 의견",
            "negative": "퍼프나 도구 사용감을 아쉬움으로 언급",
        },
        "packaging_container": {
            "positive": "패키지 디자인과 휴대성을 만족 포인트로 언급",
            "negative": "지문, 먼지, 배송·포장 상태를 아쉬움으로 언급",
        },
    },
    "lip_makeup": {
        # Pass-19F/H: operator-locked spec wording lives here so the
        # lip-makeup top3 (hince, muzigae) doesn't fall through to
        # the generic last-resort label ("발색 관련 만족 의견" /
        # "발림성 관련 만족 의견" / "밀착감 관련 만족 의견" etc.) which
        # the report-facing inspector flags as filler. Pass-19H added
        # adhesion_base_interaction (the last attribute that was still
        # falling back to last-resort on hince/muzigae republish).
        "adhesion_base_interaction": {
            "positive": (
                "입술에 매끈하게 밀착되고 광택이 자연스럽게 유지된다는 의견"
            ),
            "negative": (
                "밀착이 약하거나 시간이 지나며 들뜸·밀림을 아쉬워하는 의견"
            ),
            "negative_weak": (
                "초반 밀착감은 괜찮지만 시간이 지나며 사용감이 아쉽다는 의견"
            ),
        },
        "pigmentation": {
            "positive": "색이 선명하게 올라오고 얼굴빛을 살린다는 의견",
            "negative": "기대 색상과 다르거나 발색이 약하다는 의견",
            "negative_weak": (
                "처음 발색은 괜찮지만 시간이 지나며 색감 만족도가 낮아진다는 의견"
            ),
        },
        "application_blending": {
            "positive": "부드럽게 발리고 입술에 편하게 밀착된다는 의견",
            "negative": "뭉침, 얼룩짐, 경계 남음을 아쉬워하는 의견",
        },
        "dryness_skin_texture": {
            "positive": "건조함이나 각질 부각이 덜하다는 의견",
            "negative": "입술이 마르거나 각질·주름이 부각된다는 의견",
            "negative_weak": (
                "초반은 편하지만 시간이 지나며 건조함이 느껴진다는 의견"
            ),
        },
        "persistence": {
            "positive": "색이 오래 남고 착색 유지력이 좋다는 의견",
            "negative": "색이 금방 지워지거나 지속력이 기대보다 짧다는 의견",
            "negative_weak": "식사나 시간이 지난 뒤 색 유지가 아쉽다는 의견",
        },
        "transfer_resistance": {
            "positive": "컵이나 마스크 묻어남이 적다는 의견",
            "negative": "컵, 마스크, 치아에 묻어남을 아쉬워하는 의견",
        },
        "finish_texture": {
            "positive": "끈적임이 적고 마무리감이 편하다는 의견",
            "negative": "끈적임, 답답함, 무거운 사용감을 아쉬워하는 의견",
        },
        "scent_taste": {
            "positive": "향이나 맛이 부담스럽지 않다는 의견",
            "negative": "향이나 맛이 강하게 느껴진다는 의견",
        },
        "packaging_container": {
            "positive": "패키지 디자인과 휴대성을 만족 포인트로 언급",
            "negative": "용기 사용감이나 누수, 포장 상태를 아쉬워하는 의견",
        },
        "value_price": {
            "positive": "가격 대비 컬러와 사용감 만족도가 높다는 의견",
            "negative": "가격 대비 용량이나 지속력 기대에 못 미친다는 의견",
        },
    },
    "sunscreen": {
        "finish_texture": {
            "positive": "산뜻한 마무리와 편안한 사용감을 만족 포인트로 언급",
            "negative": "유분감 / 백탁 / 밀림 / 눈시림을 아쉬움으로 언급",
        },
        "transfer_resistance": {
            "positive": "땀·물에 잘 견딘다는 의견",
            "negative": "땀에 흘러내리거나 묻어남이 있다는 의견",
        },
        "value_price": {
            "positive": "용량 대비 가성비를 만족 포인트로 언급",
            "negative": "체감 가성비가 사용 빈도에 따라 갈린다는 의견",
        },
    },
    "cleansing": {
        "finish_texture": {
            "positive": "세안 후 촉촉함 / 편안함을 만족 포인트로 언급",
            "negative": "당김 / 빡빡함 / 잔여감을 아쉬움으로 언급",
        },
        "dryness_skin_texture": {
            "positive": "세안 후 건조함이 덜하다는 의견",
            "negative": "세안 후 당김 / 건조감을 아쉬움으로 언급",
        },
    },
    "fallback_generic": {
        "finish_texture": {
            "positive": "사용감 / 마무리를 만족 포인트로 언급",
            "negative": "사용감 / 마무리에 아쉬움을 언급",
        },
        "dryness_skin_texture": {
            "positive": "건조함이 덜하다는 의견",
            "negative": "건조감 / 당김을 아쉬움으로 언급",
        },
        "persistence": {
            "positive": "지속감을 만족 포인트로 언급",
            "negative": "지속감이 짧다는 의견",
        },
        "value_price": {
            "positive": "가성비를 만족 포인트로 언급",
            "negative": "체감 가성비가 갈린다는 의견",
        },
        "packaging_container": {
            "positive": "용기·구성을 만족 포인트로 언급",
            "negative": "용기·구성 사용이 불편하다는 의견",
        },
        "applicator_tool": {
            "positive": "도구 사용이 편하다는 의견",
            "negative": "도구 사용감을 아쉬움으로 언급",
        },
    },
}


# Last-resort label → "{label} 관련 만족/아쉬움 의견" stub. Used when
# the fallback map has no entry for the (profile, attr, polarity)
# triple — the renderer surface still gets a non-empty, attribute-
# scoped string rather than reverting to a degraded raw quote.
#
# Pass-19: profile-aware overlay. The default `_LAST_RESORT_LABEL_KO`
# carries skincare-pad-flavored labels (e.g. adhesion_base_interaction
# → "패드 밀착력"); when a base_makeup / lip_makeup / cleansing /
# sunscreen report falls all the way through to last-resort, those
# labels leaked into the wrong category. The overlay below is keyed
# (profile_id, attr_key) and consulted before the default.
_LAST_RESORT_LABEL_KO: Final[dict[str, str]] = {
    "finish_texture": "마무리감",
    "dryness_skin_texture": "건조감·당김 체감",
    "adhesion_base_interaction": "패드 밀착력",
    "persistence": "지속감",
    "value_price": "가성비",
    "packaging_container": "용기·구성",
    "applicator_tool": "도구",
    "pigmentation": "발색",
    "transfer_resistance": "묻어남 저항",
    "color_tone_matching": "톤 매칭",
    "application_blending": "발림성",
    "multi_use_lip_cheek_compatibility": "다용도 호환",
}

_LAST_RESORT_LABEL_BY_PROFILE_KO: Final[dict[str, dict[str, str]]] = {
    "base_makeup": {
        "adhesion_base_interaction": "밀착력·끼임",
        "finish_texture": "마무리감",
        "dryness_skin_texture": "건조감·각질 부각",
        "persistence": "지속력·무너짐",
        "transfer_resistance": "묻어남·픽싱",
        "applicator_tool": "퍼프·도구",
        "packaging_container": "패키지·용기",
        "application_blending": "발림성·블렌딩",
        "color_tone_matching": "색·톤 매칭",
    },
    "lip_makeup": {
        # Pass-19F: full lip-makeup label set. The `_FALLBACK_SUMMARY_KO`
        # table now carries 9 attributes for lip_makeup so this overlay
        # is mainly belt-and-suspenders, but it ensures any future
        # attribute key still gets a lip-anchored label rather than
        # the skincare-pad-flavored default ("패드 밀착력" etc.).
        "adhesion_base_interaction": "밀착감",
        "application_blending": "발림성·밀착감",
        "color_tone_matching": "컬러 매칭",
        "dryness_skin_texture": "건조감·각질 부각",
        "finish_texture": "마무리감",
        "packaging_container": "패키지·용기",
        "persistence": "지속력·착색",
        "pigmentation": "발색·컬러 표현",
        "scent_taste": "향·맛",
        "transfer_resistance": "묻어남",
        "value_price": "가격·구성",
    },
    "sunscreen": {
        "adhesion_base_interaction": "밀착감·산뜻함",
        "finish_texture": "산뜻한 마무리",
        "transfer_resistance": "땀·물 견딤",
    },
    "cleansing": {
        "adhesion_base_interaction": "세정 밀착감",
        "finish_texture": "세안 후 마무리감",
        "dryness_skin_texture": "세안 후 당김·건조",
    },
}


def attribute_specific_summary(
    *,
    profile_id: str | None,
    attribute_key: str,
    polarity: str,
) -> str | None:
    """Resolve a profile-aware fallback summary for the given
    attribute and polarity.

    Resolution order (per polarity_key):
      1. Profile-specific entry for (attr, polarity_key).
      2. Profile-specific entry for the fallback polarity_key
         (e.g. negative_weak → negative) when set 1 missed.
      3. fallback_generic profile's entry for either polarity_key.
      4. None — caller falls through to the last-resort label stub.

    Pass-19F: the polarity_key for `negative_weak` is now distinct
    from `negative`. Profiles can carry separate weak/strong wording
    (the user-locked lip_makeup spec uses this for pigmentation /
    dryness_skin_texture / persistence). When a profile only
    has the `negative` form, `negative_weak` requests fall back to
    it transparently.
    """
    if not attribute_key:
        return None
    polarity_key = _POLARITY_KEY_MAP.get((polarity or "").lower())
    if polarity_key is None:
        return None

    candidate_keys = [polarity_key]
    fallback_key = _POLARITY_KEY_FALLBACK.get(polarity_key)
    if fallback_key and fallback_key not in candidate_keys:
        candidate_keys.append(fallback_key)

    pid = (profile_id or "").strip() or "fallback_generic"
    profile_dict = _FALLBACK_SUMMARY_KO.get(pid)
    if profile_dict:
        per_attr = profile_dict.get(attribute_key)
        if per_attr:
            for k in candidate_keys:
                if k in per_attr:
                    return per_attr[k]
    # Profile-specific lookup missed; fall through to fallback_generic.
    if pid != "fallback_generic":
        generic = _FALLBACK_SUMMARY_KO["fallback_generic"].get(attribute_key)
        if generic:
            for k in candidate_keys:
                if k in generic:
                    return generic[k]
    return None


def _last_resort_summary(
    attribute_key: str,
    polarity: str,
    *,
    profile_id: str | None = None,
) -> str:
    """Final fallback when no attribute template carries the
    (attr, polarity) combination. Stays attribute-scoped so the
    summary cell never reverts to a misleading mid-sentence quote.

    Pass-19: profile-aware label resolution. A base_makeup report
    falling through to last-resort no longer surfaces "패드 밀착력".
    """
    label: str | None = None
    pid = (profile_id or "").strip()
    if pid:
        per_profile = _LAST_RESORT_LABEL_BY_PROFILE_KO.get(pid)
        if per_profile:
            label = per_profile.get(attribute_key)
    if not label:
        label = _LAST_RESORT_LABEL_KO.get(attribute_key) or attribute_key or "항목"
    polarity_key = _POLARITY_KEY_MAP.get((polarity or "").lower(), "negative")
    if polarity_key == "positive":
        return f"{label} 관련 만족 의견"
    return f"{label} 관련 아쉬움 의견"


def normalize_display_quote_summary(
    raw_summary: str | None,
    *,
    attribute_key: str,
    polarity: str,
    profile_id: str | None = None,
) -> str:
    """Return a clean `display_quote_summary` for the analysis_report.

    When `raw_summary` is degraded (truncated / dangling / generic /
    empty), the function substitutes a profile-aware, attribute-
    specific fallback so the JSON value is always seller-safe.

    `raw_summary` is whatever the upstream `_quote_pdf_summary`
    helper produced. The audit `text` field is NEVER passed here —
    it stays untouched on the quote dict for traceability.
    """
    if isinstance(raw_summary, str) and raw_summary.strip() and not is_degraded_quote_summary(raw_summary):
        return raw_summary.strip()
    fallback = attribute_specific_summary(
        profile_id=profile_id,
        attribute_key=attribute_key,
        polarity=polarity,
    )
    if fallback:
        return fallback
    return _last_resort_summary(
        attribute_key, polarity, profile_id=profile_id,
    )


__all__ = [
    "attribute_specific_summary",
    "is_degraded_quote_summary",
    "looks_dangling",
    "looks_too_generic",
    "looks_truncated",
    "normalize_display_quote_summary",
]
