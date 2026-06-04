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

# Ordered (longest-match-first) rewrite table. Order is load-bearing: the
# compound phrase MUST precede its constituents so that
# "원인 분석 및 개선 방안" is rewritten as a unit. An empty replacement removes
# the phrase; surrounding whitespace is normalized afterwards.
PHRASE_REWRITES: tuple[tuple[str, str], ...] = (
    ("원인 분석 및 개선 방안", "확인 및 보완 방향 검토"),
    ("매출 영향", "재구매·신뢰 영향 가능성"),
    ("원인 분석", "원인 가설 검토"),
    ("개선 방안", "보완 방향 검토"),
    ("개선해야", "보완을 검토"),
    ("자동 처리", "수동 확인"),
    ("즉시 반영", "반영 검토"),
    ("반드시", ""),
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
    """Rewrite risky phrasing to hedged operator-safe wording.

    Applies :data:`PHRASE_REWRITES` in order (longest-match-first), then
    collapses any double spacing introduced by removals and strips the result.
    Idempotent and deterministic. Non-string input is returned unchanged.
    """
    if not isinstance(text, str):
        return text
    out = text
    for phrase, replacement in PHRASE_REWRITES:
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
