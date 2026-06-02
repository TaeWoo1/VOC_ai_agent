"""Normalize an OliveYoung-style raw product name into a four-part
shape suitable for seller-facing surfaces.

Why this exists
---------------
OliveYoung product titles are merch-shelf strings — they pack
ranking badges, promo bundles, set composition, and gift terms into
the headline, then stack the brand name and product name at the
end. Examples seen in production:

    "[1위 패드] 메디힐 더마 패드 200매 대용량 기획 세트 7종 골라담기"
    "메디힐 더마 패드 2개 사면 1개 증정"
    "[단독] [기획] 라네즈 워터뱅크 블루 ★1+1 한정★"

When that string lands directly on the seller report cover or as a
cardnews headline, the report reads as merch — not as a brand-facing
review intelligence document. Sellers also can't republish the
report because the title is contaminated with promo terms that
expire.

The four-part shape this module produces:

    raw_product_name        — preserved verbatim (audit)
    display_product_name    — brand + core product (cover headline)
    offer_context           — bundle / set / size info (kept; just
                              moved off the headline)
    promo_context           — ranking / 단독 / 한정 / 무료배송 etc.
                              (suppressed from headline; surfaced only
                              in appendix)
    report_title            — "{display_product_name} 리뷰 인사이트
                              리포트"

The split is regex-driven, deterministic, and conservative. When in
doubt, the helper preserves more text on `display_product_name` —
i.e., a token that's ambiguous between "product info" and "merch
copy" stays on the display name. Tests lock the high-traffic cases.

Hard rules
----------
- Pure: no I/O. Single-call function returns a dict.
- Never raises: malformed / empty input → display_product_name
  falls back to the raw string.
- Never paraphrases: every output token is a substring of the
  raw input.
- The audit field `raw_product_name` is never modified — it is
  always the input verbatim.
"""
from __future__ import annotations

import re
from typing import TypedDict


class NormalizedProductName(TypedDict):
    raw_product_name: str
    display_product_name: str
    offer_context: str
    promo_context: str
    report_title: str


# Promo / ranking brackets that NEVER belong on a seller-report
# headline. They surface only in the appendix's promo_context line.
#
# Ordered list of regex patterns. Each pattern is fullmatch-anchored
# at the bracket boundary so partial brackets (e.g. inside a product
# name like "[리뉴얼]") won't catch unintentionally.
_PROMO_BRACKET_PATTERNS: tuple[str, ...] = (
    r"\[\s*\d+\s*위[^\]]*\]",      # "[1위]", "[1위 패드]"
    r"\[\s*단독\s*\]",
    r"\[\s*기획\s*\]",
    r"\[\s*한정\s*\]",
    r"\[\s*특가\s*\]",
    r"\[\s*올영픽\s*\]",
    r"\[\s*오늘드림\s*\]",
    r"\[\s*리뷰[^\]]*\]",            # "[리뷰추천]" etc.
    r"\[\s*뷰튜버[^\]]*\]",
    r"\[\s*EVENT\s*\]",
    r"\[\s*event\s*\]",
    # Pass-19I — gift / new-color brackets like
    #   "[뮤트스위치글로스 증정/신규컬러]"
    # carry promo + SKU info that must come off the headline.
    r"\[[^\]]*증정[^\]]*\]",
    r"\[[^\]]*신규\s*컬러[^\]]*\]",
)
_PROMO_BRACKET_RE = re.compile("|".join(_PROMO_BRACKET_PATTERNS))


# Collab / co-branding brackets like "[퓌X민스코]" or
# "[NewJeans X 메디힐]". Pass-19 added these as a separate pattern
# from the promo brackets so they can be moved off the headline
# without being confused with ranking badges. They share a sink
# (`promo_context`) so the existing 5-key TypedDict shape stays
# stable.
#
# Heuristic: brackets containing a single ASCII X / ×, with non-empty
# content on both sides. Catches the "[A X B]" / "[AxB]" / "[A×B]"
# templates OliveYoung listings use without false-matching brand
# names that happen to contain the letter X.
_COLLAB_BRACKET_RE = re.compile(
    r"\[\s*[^\]\s][^\]]*[Xx×][^\]]*[^\]\s]\s*\]",
)


# Promo / marketing phrases (no brackets). These are pure marketing
# badges — they expire, they distort the seller-report headline,
# and they should NOT appear on the cover. They surface only in
# the appendix's promo_context line.
_PROMO_PHRASE_PATTERNS: tuple[str, ...] = (
    r"무료\s*배송",
    r"추가\s*증정",
    r"쿠폰\s*증정",
    r"★\s*\d+\s*\+\s*\d+\s*[^★]*★",   # "★1+1 한정★"
)
_PROMO_PHRASE_RE = re.compile("|".join(_PROMO_PHRASE_PATTERNS))


# Offer / bundle / SKU-shape phrases. These describe HOW the
# product is sold — size, set composition, refill option, gift
# bundles. They get split off the headline but PRESERVED in
# offer_context because sellers / brand readers want to know the
# exact SKU shape. Gift bundles (예: "2개 사면 1개 증정", "1+1")
# also live here per spec — they're product-shape info, not pure
# marketing decoration.
_OFFER_PHRASE_PATTERNS: tuple[str, ...] = (
    r"\d+\s*매\s*대용량\s*기획\s*세트",
    r"대용량\s*기획\s*세트",
    r"\d+\s*매\s*대용량",
    r"\d+\s*매\s*기획\s*세트",
    r"\d+\s*매(?=\s|$)",                      # "200매"
    r"\d+\s*ml\s*대용량",
    r"\d+\s*ml(?:\s*x\s*\d+)?",                # "150ml", "150ml x 2"
    r"\d+\s*g(?:\s*x\s*\d+)?",
    # Refill / "본품+리필" can appear bare or wrapped in parens. We
    # accept either; when the surrounding parens become empty after
    # the inner phrase is plucked out, _strip_empty_brackets() below
    # cleans them up so the display name doesn't carry "( )".
    r"본품\s*\+\s*리필",
    r"리필\s*\+\s*본품",
    r"\d+\s*종\s*골라\s*담기",
    r"\d+\s*종\s*골라담기",
    r"\d+\s*종(?=\s|$)",                      # bare "5종" / "7종" — no
                                              # 골라담기 suffix.
    r"리필\s*기획",                           # "리필기획" / "리필 기획"
    r"한정\s*기획",                           # "한정 기획" — pass-19I
    r"기획\s*세트",
    r"\d+\s*개\s*세트",
    r"\d+\s*개\s*사면\s*\d+\s*개\s*증정",          # "2개 사면 1개 증정"
    r"\d+\s*개\s*구매\s*시\s*\d+\s*개\s*증정",      # "2개 구매 시 1개 증정"
    r"\d+\s*\+\s*\d+",                       # "1+1", "2+1"
    r"증정\s*$",                              # trailing "증정"
    # Pass-19I — color count "24 Colors" / "12color" / "8 색상" etc.
    # These are SKU-shape info (how many shades the product ships
    # in), not promo decoration. Land in offer_context.
    r"\d+\s*[Cc]olors?",
    r"\d+\s*색상",
    # Pass-19I — edition/special parens like "(오드스프링에디션)" /
    # "(스프링 에디션)". We extract the parenthesized content as a
    # single offer phrase. Limited to non-empty alphanumeric/Korean
    # content ending in "에디션" or containing "한정" so we don't
    # eat unrelated parens like the "(EWG-Green)" kind.
    r"\(\s*[^()]*에디션\s*\)",
    r"\(\s*[^()]*\s*한정\s*[^()]*\)",
)
_OFFER_PHRASE_RE = re.compile("|".join(_OFFER_PHRASE_PATTERNS))


# Bracket residue cleaner. After offer/promo extraction the display
# name often ends up with "( )" or "()" or "[ ]" stranded where the
# inner content used to live (e.g. "리필기획(본품+리필)" → both
# "리필기획" and "본품+리필" get plucked, leaving "( )"). Strip these.
_EMPTY_BRACKET_RE = re.compile(r"[\(\[\{]\s*[\)\]\}]")


def _collect_matches(pattern: re.Pattern, text: str) -> tuple[list[str], str]:
    """Return (matched_substrings, text_with_matches_removed).
    Strips collapsed whitespace after removal so the cleaned string
    doesn't carry double spaces / leading whitespace.
    """
    matches: list[str] = []
    spans: list[tuple[int, int]] = []
    for m in pattern.finditer(text):
        matches.append(m.group(0).strip())
        spans.append((m.start(), m.end()))
    if not spans:
        return [], text
    # Strip from right to left so earlier indices stay valid.
    cleaned = text
    for start, end in reversed(spans):
        cleaned = cleaned[:start] + " " + cleaned[end:]
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return matches, cleaned


def _normalize_phrase(phrase: str) -> str:
    """Collapse internal whitespace and strip surrounding quotes /
    decorative chars / stray brackets.

    Pass-19I: strip surrounding parentheses too so an extracted
    edition phrase like "(오드스프링에디션)" lands in offer_context
    as plain "오드스프링에디션", which reads cleaner alongside other
    bullets ("24 Colors · 한정 기획 · 오드스프링에디션").
    """
    s = re.sub(r"\s+", " ", phrase).strip()
    s = s.strip("·,/|·()[]{}")
    s = s.strip()
    return s


def normalize_product_name(raw: str | None) -> NormalizedProductName:
    """Split a raw OliveYoung-style product name into the four
    presentation-friendly fields.

    Best-effort: malformed input falls through to the raw string
    on `display_product_name` and an empty `offer_context` /
    `promo_context`. The `raw_product_name` field is always the
    input verbatim.
    """
    raw_str = raw if isinstance(raw, str) else ""

    if not raw_str.strip():
        return NormalizedProductName(
            raw_product_name=raw_str,
            display_product_name="",
            offer_context="",
            promo_context="",
            report_title="리뷰 인사이트 리포트",
        )

    text = raw_str

    # 1) Pull out promo brackets first (they're at the head of the
    #    string and contain nested content we don't want to scan).
    promo_brackets, text = _collect_matches(_PROMO_BRACKET_RE, text)

    # 1b) Collab / co-branding brackets — "[퓌X민스코]". These are
    #     not promo badges (no expiry), but they contaminate the
    #     headline and the report title in the same way, so they
    #     follow the same sink (promo_context) and are surfaced
    #     in the appendix collab/promo line.
    collab_brackets, text = _collect_matches(_COLLAB_BRACKET_RE, text)

    # 2) Pull out promo phrases (gift / bundle promo terms).
    promo_phrases, text = _collect_matches(_PROMO_PHRASE_RE, text)

    # 3) Pull out offer phrases (size / set / bundle composition).
    offer_phrases, text = _collect_matches(_OFFER_PHRASE_RE, text)

    # 3b) After offer extraction the display string may carry empty
    #     "( )" / "[ ]" residue (e.g. "리필기획(본품+리필)" →
    #     both inner tokens were plucked). Drop those so the cover
    #     doesn't read "리필기획( )".
    text = _EMPTY_BRACKET_RE.sub(" ", text)

    # Whatever survives is the display name. Trim trailing
    # punctuation / orphaned brackets.
    display = re.sub(r"\s+", " ", text).strip()
    display = display.strip(" ·,/|-")
    if not display:
        # Edge case: every token was promo / offer. Fall back to raw.
        display = raw_str.strip()

    promo_context = " · ".join(
        _normalize_phrase(p)
        for p in promo_brackets + collab_brackets + promo_phrases
        if _normalize_phrase(p)
    )
    offer_context = " · ".join(
        _normalize_phrase(p) for p in offer_phrases if _normalize_phrase(p)
    )

    report_title = f"{display} 리뷰 인사이트 리포트" if display else "리뷰 인사이트 리포트"

    return NormalizedProductName(
        raw_product_name=raw_str,
        display_product_name=display,
        offer_context=offer_context,
        promo_context=promo_context,
        report_title=report_title,
    )


__all__ = ["NormalizedProductName", "normalize_product_name"]
