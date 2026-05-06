"""Minimal category profile selector.

Maps a captured breadcrumb / product name to a small closed set of
profile ids. The Phase 2E Stage 1 detector still scans every
canonical attribute regardless of category — the profile only
controls *downstream* presentation: the content adapter suppresses
attributes that are categorically irrelevant for the product type so
analysis_report.json doesn't show e.g. `pigmentation` (a makeup
attribute) for a toner pad.

Recognized profiles (order = priority of resolution):
  1. `skincare_pad`   — toner pad / 더마 패드 / 마스크팩 패드
  2. `lip_makeup`     — 립메이크업 / 립틴트 / 립스틱 / 립글로스 /
                        립글로우 / 립밤 / 워터틴트 / 젤 틴트 / 립앤치크
                        (Pass-19G addition; previously fell to default
                        because base_makeup excludes lip-marker keywords
                        but no positive lip route existed.)
  3. `makeup_blush`   — 블러셔 / 치크
                        (still wins over lip_makeup ONLY when the
                        haystack lacks any lip keyword; bare 치크쿠션
                        / 블러셔 stays here.)
  4. `base_makeup`    — 쿠션 / 파운데이션 / 컨실러 / BB / CC /
                        톤업크림 / 베이스메이크업
                        (excluded if 립 / 아이 / 블러셔 / 치크 markers)
  5. `default`        — no suppression, generic narrative

The lip_makeup branch is the pass-19G addition: hince / muzigae lip
tints were silently routed to `default`, which dropped them out of
profile-aware narrative dispatch and left fallback_generic-flavored
phrases ("발색 관련 만족 의견", "발림성 관련 만족 의견", "지속감이 짧다는 의견")
in the seller PDF / cardnews. The lip_makeup quote-summary table in
`quote_summary_normalizer.py` was already in place from pass-19F but
was unreachable without this routing fix.

This is *not* the place for full category taxonomy work — it's a
calibration band-aid that unblocks high-traffic categories without
touching detectors, lexicons, or eval data.
"""
from __future__ import annotations

from typing import Iterable


PROFILE_DEFAULT: str = "default"
PROFILE_SKINCARE_PAD: str = "skincare_pad"
PROFILE_BASE_MAKEUP: str = "base_makeup"
PROFILE_MAKEUP_BLUSH: str = "makeup_blush"
PROFILE_LIP_MAKEUP: str = "lip_makeup"

KNOWN_PROFILES: tuple[str, ...] = (
    PROFILE_DEFAULT,
    PROFILE_SKINCARE_PAD,
    PROFILE_BASE_MAKEUP,
    PROFILE_MAKEUP_BLUSH,
    PROFILE_LIP_MAKEUP,
)

# Korean keywords for skincare pads. Match against breadcrumb path
# nodes AND the product name. Order doesn't matter — first hit wins
# but profiles are mutually exclusive in practice.
SKINCARE_PAD_KEYWORDS_KO: tuple[str, ...] = (
    "토너패드",
    "더마패드",
    "패드",
)
# Base-makeup keywords (cushion / foundation / concealer / BB / CC /
# 톤업크림). The exclusion set below blocks lip / eye / blush mis-routing
# (a "립앤치크 쿠션" wouldn't be base_makeup even though "쿠션" appears).
BASE_MAKEUP_KEYWORDS_KO: tuple[str, ...] = (
    "쿠션",
    "파운데이션",
    "컨실러",
    "BB크림",
    "BB 크림",
    "CC크림",
    "CC 크림",
    "톤업크림",
    "톤업 크림",
    "베이스메이크업",
    "베이스 메이크업",
)
BASE_MAKEUP_EXCLUDE_KEYWORDS_KO: tuple[str, ...] = (
    "립앤",
    "립 앤",
    "립스틱",
    "립글로스",
    "립밤",
    "립틴트",
    "아이섀도",
    "아이라이너",
    "아이브로우",
    "마스카라",
    "블러셔",
    "치크",
)
MAKEUP_BLUSH_KEYWORDS_KO: tuple[str, ...] = (
    "블러셔",
    "치크",
)

# Pass-19G: lip_makeup keywords. Both Korean compound forms (no
# space) and the spaced-out variants OliveYoung occasionally uses
# in breadcrumbs. The bare "틴트" / "글로스" entries are intentional
# — OliveYoung product names sometimes elide "립" (e.g. "젤 틴트",
# "워터 틴트"); the makeup_blush check above protects 치크/블러셔
# variants. The 립앤치크 entry is in this list per the user-locked
# pass-19G keyword spec; if a future product ships as a multi-use
# lip-AND-cheek SKU and the operator wants makeup_blush dispatch
# instead, drop it here. See lip-and-cheek note on
# SUPPRESSED_ATTRIBUTES_BY_PROFILE below.
LIP_MAKEUP_KEYWORDS_KO: tuple[str, ...] = (
    "립메이크업",
    "립 메이크업",
    "립틴트",
    "립 틴트",
    "립스틱",
    "립글로스",
    "립 글로스",
    "립글로우",
    "립 글로우",
    "립밤",
    "립 밤",
    "워터틴트",
    "워터 틴트",
    "젤틴트",
    "젤 틴트",
    "립앤치크",
    "립 앤 치크",
    "립앤",
    "립 앤",
    # Bare-form keywords. These are matched LAST in the haystack
    # because they're broader; the explicit lip-prefixed forms above
    # avoid mis-matching e.g. "톤업틴트" (which is base_makeup).
    "틴트",
    "글로스",
)

# Attribute keys to suppress per profile. Pulled out as constants so
# tests and the adapter share one source of truth. Suppression
# applies to: analysis_report.attributes[], strengths[],
# monitoring_candidates[], tradeoffs[] (any pair touching a suppressed
# key), usage_patterns[], and quick_decision derivations.
SUPPRESSED_ATTRIBUTES_BY_PROFILE: dict[str, frozenset[str]] = {
    PROFILE_DEFAULT: frozenset(),
    PROFILE_SKINCARE_PAD: frozenset({
        "pigmentation",
        "color_tone_matching",
        "application_blending",
        "transfer_resistance",
        "multi_use_lip_cheek_compatibility",
    }),
    PROFILE_BASE_MAKEUP: frozenset({
        "multi_use_lip_cheek_compatibility",
    }),
    PROFILE_MAKEUP_BLUSH: frozenset(),
    # Pass-19G: lip_makeup suppresses multi_use_lip_cheek_compatibility
    # for plain lip tints / lipsticks where it is operationally
    # noise (the user's hince / muzigae case). Lip-AND-cheek SKUs
    # (which match "립앤치크") still route here today and will see
    # the suppression too — operator note: if a future 립앤치크
    # report needs the multi-use attribute back, the cleanest fix
    # is a context-aware overlay rather than weakening the default.
    PROFILE_LIP_MAKEUP: frozenset({
        "multi_use_lip_cheek_compatibility",
    }),
}


def _haystack(
    *,
    category_path: Iterable[str] | None,
    product_name: str | None,
) -> str:
    """Single concatenated lower-stripped string the keyword scan
    walks over. Joining is space-separated so a substring like
    "패드" inside one node can't accidentally match across two
    unrelated nodes."""
    parts: list[str] = []
    if category_path:
        for node in category_path:
            if isinstance(node, str) and node.strip():
                parts.append(node.strip())
    if isinstance(product_name, str) and product_name.strip():
        parts.append(product_name.strip())
    return " ".join(parts)


def select_profile_id(
    *,
    category_path: Iterable[str] | None = None,
    product_name: str | None = None,
) -> str:
    """Return the best-fit profile id for a product.

    Resolution order:
      1. `skincare_pad`  if any skincare-pad keyword appears.
      2. `lip_makeup`    if any lip keyword appears (Pass-19G; runs
         before makeup_blush so "립앤치크" / "립 앤 치크" route to
         lip_makeup as the user-locked default. Pure 치크 / 블러셔
         products still route to makeup_blush below because they
         lack any 립 marker.)
      3. `makeup_blush`  if any blush keyword appears (checked
         before `base_makeup` so a "치크 쿠션" routes to blush,
         not base_makeup).
      4. `base_makeup`   if any base-makeup keyword appears AND
         no exclusion keyword (립/아이/블러셔/치크) is present.
      5. `default`       otherwise.

    Pure: no I/O, no LLM. Same input → same output.
    """
    haystack = _haystack(
        category_path=category_path, product_name=product_name,
    )
    if not haystack:
        return PROFILE_DEFAULT
    for kw in SKINCARE_PAD_KEYWORDS_KO:
        if kw in haystack:
            return PROFILE_SKINCARE_PAD
    # Pass-19G: lip_makeup runs before makeup_blush so 립앤치크 /
    # 립 앤 치크 land here. Bare 치크 / 블러셔 products fall through
    # to the makeup_blush check below because they lack a lip
    # keyword in the haystack.
    for kw in LIP_MAKEUP_KEYWORDS_KO:
        if kw in haystack:
            return PROFILE_LIP_MAKEUP
    # Blush is checked before base_makeup because "치크 쿠션" carries
    # "쿠션" but should not be treated as base.
    for kw in MAKEUP_BLUSH_KEYWORDS_KO:
        if kw in haystack:
            return PROFILE_MAKEUP_BLUSH
    for kw in BASE_MAKEUP_KEYWORDS_KO:
        if kw in haystack:
            for excl in BASE_MAKEUP_EXCLUDE_KEYWORDS_KO:
                if excl in haystack:
                    return PROFILE_DEFAULT
            return PROFILE_BASE_MAKEUP
    return PROFILE_DEFAULT


def suppressed_attributes_for(profile_id: str) -> frozenset[str]:
    """Return the set of attribute keys to suppress in
    analysis_report.json for this profile. Unknown profile_id
    falls back to the default (empty) set."""
    return SUPPRESSED_ATTRIBUTES_BY_PROFILE.get(
        profile_id, SUPPRESSED_ATTRIBUTES_BY_PROFILE[PROFILE_DEFAULT],
    )
