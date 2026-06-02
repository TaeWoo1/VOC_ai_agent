"""Surface-aware reader-friendly Korean wording.

Run-003 QA finding: the seller PDF and the buyer cardnews need
DIFFERENT wording even when the underlying signal is the same.
- The PDF is a B2B operator surface — keep a slightly more business
  register so a brand/seller reader recognises it as an analyst's
  report.
- The cardnews is a B2C buyer-journey surface — Instagram-friendly,
  empathetic copy.

This module exposes two parallel mapping tables (`PDF_*` / `CARDNEWS_*`)
plus accessors that take a `surface` argument so each renderer pulls
its column. The legacy `SECTION_HEADERS_KO` / `SIGNAL_LABEL_KO`
constants are kept as aliases for back-compat with adapter call sites.

Internal model identifiers (attribute keys, polarity strings) are
NEVER changed — only the strings that reach a human reader.

Pure: no I/O, no LLM, no global state.
"""
from __future__ import annotations

from typing import Literal

Surface = Literal["pdf", "cardnews"]
DEFAULT_SURFACE: Surface = "pdf"


# ---------------------------------------------------------------------------
# Section headers — split per surface
# ---------------------------------------------------------------------------
#
# PDF: business-grade analyst report register. Keeps Executive
# Summary bilingual cue + denser, more analytical phrasing.
# Cardnews: Instagram buyer-journey copy. Empathetic, single-line,
# question-friendly hooks.

PDF_SECTION_HEADERS_KO: dict[str, str] = {
    "executive_summary": "핵심 요약 (Executive Summary)",
    "data_coverage": "데이터 커버리지와 해석 한계",
    "strengths": "반복된 만족 포인트",
    "monitoring": "주요 확인 포인트",
    "usage_patterns": "만족·아쉬움 분기 패턴",
    "method_notes": "분석 방법과 한계",
    # Legacy / internal → PDF replacement (used by reverse lookup
    # `label_for_section_header(..., surface="pdf")`).
    "핵심 강점": "반복된 만족 포인트",
    "핵심 요약 (Executive Summary)": "핵심 요약 (Executive Summary)",
    "모니터링 후보 신호": "주요 확인 포인트",
    "주요 모니터링 후보": "주요 확인 포인트",
    "관찰된 사용 패턴": "만족·아쉬움 분기 패턴",
    "관찰된 사용 패턴 (Observed Usage Patterns)": "만족·아쉬움 분기 패턴",
    "해석 및 사용 가이드": "분석 방법과 한계",
}

CARDNEWS_SECTION_HEADERS_KO: dict[str, str] = {
    "executive_summary": "한 줄 인상",
    "data_coverage": "리뷰 N건을 봤어요",
    "strengths": "리뷰에서 많이 좋다고 한 점",
    "monitoring": "그런데 의견이 갈린 부분",
    "usage_patterns": "만족과 아쉬움이 갈린 상황",
    "method_notes": "이 리포트를 읽는 방법",
    "ask": "다들 좋다는데, 내 피부에도 맞을까?",
    "checklist": "구매 전 이 3가지만 체크",
    "fit": "이런 분께 잘 맞을 수 있어요",
    "consider": "이런 분은 한 번 더 확인하세요",
    # Legacy / internal → cardnews replacement.
    "핵심 강점": "리뷰에서 많이 좋다고 한 점",
    "모니터링 후보 신호": "그런데 의견이 갈린 부분",
    "주요 모니터링 후보": "그런데 의견이 갈린 부분",
    "관찰된 사용 패턴": "만족과 아쉬움이 갈린 상황",
    "유의 포인트": "구매 전 이 3가지만 체크",
    "잘 맞은 분들": "이런 분께 잘 맞을 수 있어요",
    "갈리는 의견": "그런데 의견이 갈린 부분",
    "반복되는 호평": "리뷰에서 많이 좋다고 한 점",
    "구매 전 점검": "구매 전 이 3가지만 체크",
}


# ---------------------------------------------------------------------------
# Signal / chip wording — split per surface
# ---------------------------------------------------------------------------

# Tokens that BOTH surfaces must avoid in their human-readable bodies.
# Run-003 QA pass-4 expanded the list with seller-side leakage —
# `Data Coverage`, `Reliability`, `confidence` etc. read like internal
# diagnostics dashboard headers in a B2B Korean report.
#
# Scope reminder: this scan applies to slide bodies / titles and the
# PDF report body (sections 1-6). The Appendix legitimately carries
# some diagnostic terms (Run ID labels etc.) and is exempt; callers
# should slice the rendered text to the pre-Appendix portion before
# scanning.
FORBIDDEN_INTERNAL_TERMS: tuple[str, ...] = (
    # Original Run-003 set
    "관찰 신호",
    "주요 신호",
    "우선 검토",
    "부정 신호",
    "긍정 신호",
    "모니터링 후보",
    "모니터링 후보 신호",
    "모니터링 가치",
    "신뢰도 낮음",
    "신뢰도 높음",
    "신뢰도 보통",
    "안정성 높음",
    "안정성 보통",
    "안정성 낮음",
    "관측된 반복 신호",
    # Pass-4 expansion — analyst-tool jargon that leaks into seller
    # surfaces.
    "코퍼스 정보가 전달되지 않아",
    "코퍼스",
    "Data Coverage",
    "Reliability",
    "evidence reliability",
    "collection completeness",
    # Particle fallbacks — the renderers must use grammar-correct
    # 과/와 / 은/는 / 을/를 directly. Literal "와(과)" / "은(는)" / "을(를)"
    # reads as machine-generated.
    "와(과)",
    "은(는)",
    "을(를)",
)


PDF_SIGNAL_LABEL_KO: dict[str, str] = {
    # Polarity verdicts — PDF prefers analytical noun forms.
    "negative_strong": "아쉬움 의견",
    "negative_weak": "아쉬움 의견",
    "negative": "아쉬움 의견",
    "positive": "만족 의견",
    "mixed": "의견 갈림",
    # Aggregate / headline phrases — PDF replacement.
    "부정 신호": "아쉬움 의견",
    "긍정 신호": "만족 의견",
    "관찰 신호": "확인 포인트",
    "주요 신호": "주요 확인 포인트",
    "우선 검토": "우선 확인 포인트",
    "모니터링 후보": "확인 포인트",
    "모니터링 후보 신호": "주요 확인 포인트",
    # Confidence — PDF wants the four-axis breakdown wording.
    "신뢰도 높음": "표본 충분",
    "신뢰도 보통": "표본 보통",
    "신뢰도 낮음": "참고 수준",
    "안정성 높음": "반복 확인",
    "안정성 보통": "반복 확인",
    "안정성 낮음": "반복 확인 제한적",
}


CARDNEWS_SIGNAL_LABEL_KO: dict[str, str] = {
    # Polarity verdicts — cardnews uses warmer, more buyer-empathetic
    # phrasing for headlines.
    "negative_strong": "아쉬운 점",
    "negative_weak": "아쉬운 점",
    "negative": "아쉬운 점",
    "positive": "좋았던 점",
    "mixed": "의견이 갈린 부분",
    # Aggregate / headline phrases — cardnews replacement.
    "부정 신호": "아쉬운 점",
    "긍정 신호": "좋았던 점",
    "관찰 신호": "확인할 포인트",
    "주요 신호": "확인할 포인트",
    "우선 검토": "꼭 확인할 포인트",
    "모니터링 후보": "확인할 포인트",
    "모니터링 후보 신호": "확인할 포인트",
    # Confidence — cardnews wants single-line empathetic.
    "신뢰도 높음": "리뷰가 충분히 쌓였어요",
    "신뢰도 보통": "참고 수준이에요",
    "신뢰도 낮음": "참고 수준이에요",
    "안정성 높음": "여러 리뷰에서 반복돼요",
    "안정성 보통": "여러 리뷰에서 비슷한 결",
    "안정성 낮음": "표본이 적어요",
}


# Backwards-compatible aliases — older call sites import these names
# without the surface argument. They default to the PDF surface so
# behavior matches the prior single-surface contract.
SECTION_HEADERS_KO: dict[str, str] = dict(PDF_SECTION_HEADERS_KO)
SIGNAL_LABEL_KO: dict[str, str] = dict(PDF_SIGNAL_LABEL_KO)


def _section_table(surface: Surface) -> dict[str, str]:
    if surface == "cardnews":
        return CARDNEWS_SECTION_HEADERS_KO
    return PDF_SECTION_HEADERS_KO


def _signal_table(surface: Surface) -> dict[str, str]:
    if surface == "cardnews":
        return CARDNEWS_SIGNAL_LABEL_KO
    return PDF_SIGNAL_LABEL_KO


def label_for_section_header(
    internal_title: str, *, surface: Surface = DEFAULT_SURFACE,
) -> str:
    """Return the reader-friendly section title for `internal_title`,
    selected for the requested `surface`. Falls back to the input
    when no mapping exists."""
    table = _section_table(surface)
    return table.get(internal_title, internal_title)


def label_for_polarity(
    polarity: str | None, *, surface: Surface = DEFAULT_SURFACE,
) -> str:
    if not polarity:
        return ""
    table = _signal_table(surface)
    return table.get(polarity, polarity)


def replace_internal_terms(
    text: str, *, surface: Surface = DEFAULT_SURFACE,
) -> str:
    """Apply the SIGNAL_LABEL map as a longest-match-first string
    substitution over `text`, using the table appropriate for the
    requested `surface`. Used by PDF / cardnews builders to sanitise
    free-form sentences so internal verbiage never reaches a reader.
    """
    if not isinstance(text, str) or not text:
        return text
    table = _signal_table(surface)
    out = text
    for old in sorted(table.keys(), key=len, reverse=True):
        new = table[old]
        if old != new and old in out:
            out = out.replace(old, new)
    return out


# Math / symbol glyphs that should NEVER appear in a published business
# report. Some Korean fonts don't carry these glyphs; even when they
# do, their presence reads as "this report was machine-generated and
# not proof-read". Run-003 QA pass-3 lock.
FORBIDDEN_SYMBOLS: tuple[str, ...] = (
    "∫",  # ∫
    "∬",  # ∬
    "∭",  # ∭
    "∮",  # ∮
    "∯",  # ∯
    "∰",  # ∰
    "√",  # √
    "∑",  # ∑
    "∏",  # ∏
    "∂",  # ∂
    "∞",  # ∞
    "≈",  # ≈
    "≠",  # ≠
    "≤",  # ≤
    "≥",  # ≥
)

# Plain-Korean replacements for direction arrows. A → B reads fine on
# a slide but feels machine-y in an analyst report; the report wording
# uses "A에서 B로" / "A → B 전환" / etc.
_ARROW_REPLACEMENTS: tuple[tuple[str, str], ...] = (
    ("→", " 에서 "),
    ("⇒", " 에서 "),
    ("➜", " 에서 "),
)


def scan_forbidden_symbols(text: str) -> list[str]:
    """Return any FORBIDDEN_SYMBOLS that appear in `text`. PDF /
    cardnews builders run this against the rendered text before
    shipping. Empty list = clean."""
    if not isinstance(text, str) or not text:
        return []
    return [s for s in FORBIDDEN_SYMBOLS if s in text]


def scrub_for_report(text: str) -> str:
    """Sanitize a string for the seller business report.

    1. Strip every FORBIDDEN_SYMBOL — replaced with empty string. The
       upstream code is responsible for not relying on these glyphs;
       this is a defense-in-depth scrub at the rendering boundary.
    2. Replace ASCII / typographic arrows with Korean text equivalents.

    Idempotent. Returns `text` unchanged when no replacement applies.
    """
    if not isinstance(text, str) or not text:
        return text
    out = text
    for sym in FORBIDDEN_SYMBOLS:
        if sym in out:
            out = out.replace(sym, "")
    for src, dst in _ARROW_REPLACEMENTS:
        if src in out:
            out = out.replace(src, dst)
    return out


# Seller-friendly Korean replacement for analyst-tool tokens that
# slip through `replace_internal_terms`. Used by the cardnews /
# PDF caveat builders.
_SELLER_FRIENDLY_REPLACEMENTS: tuple[tuple[str, str], ...] = (
    ("아쉬움 신호 과소 관측", "아쉬움 의견이 실제보다 적게 반영"),
    ("부정 신호 과소 관측", "아쉬움 의견이 실제보다 적게 반영"),
    ("아쉬움 신호", "아쉬움 의견"),
    ("부정 신호", "아쉬움 의견"),
    ("긍정 신호", "만족 의견"),
    ("관찰 신호", "반복 의견"),
    ("주요 신호", "주요 의견"),
    ("우선 검토", "우선 확인"),
    ("관측된 반복 신호", "반복된 의견"),
    ("관측", "확인"),
    ("모니터링 후보 신호", "확인 필요 항목"),
    ("모니터링 후보", "확인 필요 항목"),
    ("모니터링 가치", "확인 필요 정도"),
    ("코퍼스", "리뷰 표본"),
    ("Data Coverage", "데이터 범위"),
    ("Reliability", "해석 시 유의점"),
    ("신뢰도 낮음", "참고 수준"),
    ("신뢰도 높음", "표본 충분"),
    ("신뢰도 보통", "표본 보통"),
    ("안정성 높음", "여러 리뷰에서 반복됨"),
    ("안정성 보통", "반복 확인"),
    ("안정성 낮음", "반복성 낮음"),
    # Run-003 QA pass-5: replace casual "불만" / "불만 후기" with the
    # softer "아쉬움 의견" the rest of the report uses. The literal
    # "불만" reads as too direct on a buyer-facing slide.
    ("불만 후기", "아쉬움 의견"),
    ("만족 / 불만", "만족 / 아쉬움"),
    ("만족/불만", "만족/아쉬움"),
)


def to_seller_friendly(text: str) -> str:
    """Strip every analyst-tool token from a free-form string and
    replace it with the seller-friendly equivalent. Longest-match-
    first ordering so multi-word tokens land before the single-word
    forms they contain.
    """
    if not isinstance(text, str) or not text:
        return text
    out = text
    # Apply longest replacements first.
    for src, dst in sorted(
        _SELLER_FRIENDLY_REPLACEMENTS, key=lambda p: -len(p[0]),
    ):
        if src in out:
            out = out.replace(src, dst)
    return out


def scan_forbidden_terms(text: str) -> list[str]:
    """Return the list of internal-only tokens still present in
    `text`. Helpers/tests use this as a single source of truth for
    the forbidden-token contract.

    Caller scope: pass slide bodies / report body text. Negative-list
    fields like `tone.avoid` legitimately CONTAIN the forbidden tokens
    and must not be passed through this scan.
    """
    if not isinstance(text, str) or not text:
        return []
    return [t for t in FORBIDDEN_INTERNAL_TERMS if t in text]


__all__ = [
    "DEFAULT_SURFACE",
    "FORBIDDEN_INTERNAL_TERMS",
    "FORBIDDEN_SYMBOLS",
    "PDF_SECTION_HEADERS_KO",
    "PDF_SIGNAL_LABEL_KO",
    "CARDNEWS_SECTION_HEADERS_KO",
    "CARDNEWS_SIGNAL_LABEL_KO",
    "SECTION_HEADERS_KO",
    "SIGNAL_LABEL_KO",
    "label_for_polarity",
    "label_for_section_header",
    "replace_internal_terms",
    "scan_forbidden_symbols",
    "scan_forbidden_terms",
    "scrub_for_report",
    "to_seller_friendly",
]
