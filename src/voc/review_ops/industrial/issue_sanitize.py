"""Deterministic risky-wording sanitizer for repeated-issue text.

The repeated-issue discovery engine occasionally emits operator-facing wording
that overstates what review evidence can support (directive/causal phrasing such
as ``원인 분석 및 개선 방안``) or implies automation we do not perform
(``자동 처리`` / ``즉시 반영``). This module rewrites those phrases to hedged,
operator-safe equivalents using a fixed, ordered replacement table — no LLM, no
network, fully deterministic.

It is a pure leaf module: stdlib only. It is intentionally NOT wired into the
app or Notion export in this slice; callers (the cache serializer in S1b and the
discovery path in S1d) consume :func:`sanitize_issue_fields`.

Design contract:
- Longest-match-first: compound phrases are rewritten as a whole before their
  shorter constituents (``원인 분석 및 개선 방안`` never decomposes into
  ``원인 분석`` + ``개선 방안``).
- Idempotent: no rewrite output contains a banned phrase, so a second pass is a
  no-op.
- Non-mutating: :func:`sanitize_issue_fields` returns a new dict and never edits
  the caller's object.
"""

from __future__ import annotations

import re

# Raw banned tokens. Presence of any of these in displayed/cached issue text is
# a contract violation; `has_banned_wording` is the predicate used by tests and
# (later) as a fallback trigger in S1d.
BANNED_PHRASES: tuple[str, ...] = (
    "원인 분석",
    "개선 방안",
    "개선해야",
    "반드시",
    "매출 영향",
    "자동 처리",
    "즉시 반영",
)

# Ordered (longest-match-first) rewrite table. Order is load-bearing: full
# action phrases come first (so "개선 방안을 마련하세요" reads naturally rather
# than leaving a dangling "보완 방향 ...을 마련하세요"), then the compound noun
# phrase, then its constituents. An empty replacement removes the phrase;
# whitespace is normalized afterwards.
PHRASE_REWRITES: tuple[tuple[str, str], ...] = (
    ("필요시 개선 방안을 마련하세요", "필요하면 보완 여부를 검토하세요"),
    ("필요하면 개선 방안을 마련하세요", "필요하면 보완 여부를 검토하세요"),
    ("원인 분석 및 개선 방안", "확인 및 보완 방향 검토"),
    ("개선 방안을 마련하세요", "보완 여부를 검토하세요"),
    ("원인 분석", "발생 여부 확인"),
    ("개선 방안", "보완 방향"),
    ("개선해야", "보완을 검토"),
    ("자동 처리", "수동 확인"),
    ("즉시 반영", "반영 검토"),
    ("매출 영향", "재구매·신뢰 영향 가능성"),
    ("반드시", ""),
)

# Cleanup pass applied AFTER the main rewrites (longest-first). When the compound
# rewrite ("확인 및 보완 방향 검토") is followed by a particle + verb it leaves an
# awkward "검토을 …" / "검토이 …"; these collapse it back to natural Korean. The
# final generic rules fix any remaining wrong particle — 검토 ends in a vowel, so
# it takes 를 (object) and 가 (subject), never 을 / 이 — for arbitrary trailers.
_CLEANUP_REWRITES: tuple[tuple[str, str], ...] = (
    ("보완 방향 검토을 마련하세요", "보완 여부를 검토하세요"),
    ("보완 방향 검토을 검토하세요", "보완 방향을 검토하세요"),
    ("검토을", "검토를"),
    ("검토이", "검토가"),
)

# Issue dict keys whose text is operator-facing and therefore sanitized. All
# other keys (evidence_review_ids, severity, review_count, tag_label, ...) are
# left exactly as received.
_SANITIZED_FIELDS: tuple[str, ...] = (
    "issue_title",
    "summary",
    "recommended_action",
)

_MULTISPACE_RE = re.compile(r" {2,}")


def sanitize_issue_text(text: str) -> str:
    """Rewrite risky phrasing to hedged, natural operator-safe Korean.

    Applies :data:`PHRASE_REWRITES` (longest-match-first), then
    :data:`_CLEANUP_REWRITES` to smooth particle artifacts, then collapses any
    double spacing introduced by removals and strips the result. Idempotent and
    deterministic. Non-string input is returned unchanged.
    """
    if not isinstance(text, str):
        return text
    out = text
    for phrase, replacement in PHRASE_REWRITES:
        out = out.replace(phrase, replacement)
    for phrase, replacement in _CLEANUP_REWRITES:
        out = out.replace(phrase, replacement)
    # Removals (e.g. 반드시 → "") can leave doubled or edge whitespace.
    out = _MULTISPACE_RE.sub(" ", out).strip()
    return out


def has_banned_wording(text: str) -> bool:
    """Return True if any raw banned phrase is present in ``text``."""
    if not isinstance(text, str):
        return False
    return any(phrase in text for phrase in BANNED_PHRASES)


def sanitize_issue_fields(issue: dict) -> dict:
    """Return a copy of ``issue`` with operator-facing text sanitized.

    Only :data:`_SANITIZED_FIELDS` (``issue_title`` / ``summary`` /
    ``recommended_action``) are rewritten; every other key is preserved
    unchanged. The input dict is never mutated.
    """
    out = dict(issue)
    for field in _SANITIZED_FIELDS:
        value = out.get(field)
        if isinstance(value, str):
            out[field] = sanitize_issue_text(value)
    return out
