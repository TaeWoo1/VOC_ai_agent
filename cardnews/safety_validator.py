"""Cardnews safety validator — anti-clickbait + audit-leak guard.

Runs after `build_long_cardnews_layout(...)` produces a layout dict and
BEFORE any HTML render. The contract is fail-closed: any banned framing,
any review_id leaking into a public field, or a missing `language` slot
raises `CardnewsSafetyError` and aborts the render.

Why this is code, not documentation
-----------------------------------
The cardnews exists to reduce information asymmetry between brands and
buyers without ever sounding like exposé / brand-attack journalism.
That's a tone contract worth enforcing in code so it can't drift as
templates change or as future LLM-polish layers reword copy.

The two layered ban lists
-------------------------
- `BANNED_FRAMINGS_KO` — clickbait / brand-attack / consumer-as-ignorant
  phrases that a buyer-facing surface must never carry. Specified by the
  product owner; this list is authoritative for the consumer-facing
  cardnews. The seller-PDF ban list in `voc.content.validators` is a
  separate, narrower list scoped to operator surfaces and stays
  untouched.
- `_REVIEW_ID_LEAK_PATTERN` — auditing keeps `audit.evidence_review_id_truncated`
  in the layout JSON for traceability, but those IDs must never reach a
  rendered template. The validator checks every non-audit string for any
  12-hex-char substring that matches a known audit ID in the same layout.

Audit fields are explicitly excluded from public scanning by walking
the layout with `_strip_audit=True`.
"""
from __future__ import annotations

import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass


# ---------------------------------------------------------------------------
# Ban list — authoritative for consumer-facing cardnews
# ---------------------------------------------------------------------------
#
# Specified verbatim by the product owner. Substring match.
#
# Narrowing note (2026-05-01):
# The single Hangul `독` was originally on this list as an aggressive
# catch for `독한` / `독성`. It bit a legitimate LLM signature paragraph
# at the word `독특` (distinctive — exactly the natural vocabulary for a
# "이 제품만의 포인트" page). The signature page semantics make `독특`
# practically guaranteed to appear in good copy, so the single-char ban
# is too aggressive. Replaced with the specific hostile compounds
# (`독한`, `독성`, `독해`, `독함`).

BANNED_FRAMINGS_KO: tuple[str, ...] = (
    "브랜드가 숨긴",
    "당신이 모르는 진실",
    "광고에 속지 마세요",
    "진짜 실체",
    "충격적인 반전",
    "팩트 폭로",
    "소비자들은 속고 있다",
    "절대 사지 마세요",
    "최악",
    "독한",
    "독성",
    "독해",
    "독함",
    "부작용",
    "무조건",
    "인생템",
    "미쳤어요",
    # CTA-shape ban (v2.0): the framing "갈리는 제품 추천 받고 싶다면…"
    # asks the reader to solicit polarized-product recommendations,
    # which positions the carousel as a recommendation aggregator
    # rather than an analysis. The narrower substring catches the
    # solicitation framing without bothering observational mentions
    # of "호불호 갈리는 제품" elsewhere on the page.
    "갈리는 제품 추천",
)

# Extra clusters scanned only at the planner stage (the LLM has more
# room to drift than a static template). Layout-stage scanning sticks
# to BANNED_FRAMINGS_KO so audit-quote text containing legit medical
# vocabulary (e.g. "치료" in a verbatim review) doesn't trip on the
# narrower public-string walk.
PLANNER_MEDICAL_BANNED_KO: tuple[str, ...] = (
    "치료",
    "완치",
    "보장",
    "부작용 없음",
    "효능 보장",
    # Efficacy-maximizing patterns. Cosmetics review summaries
    # are observational — the buyer-facing surface should never imply
    # the product enhances, maximizes, or guarantees an effect.
    # `효능` is broad and may bite legitimate copy in adjacent
    # contexts (product info pages); on the consumer cardnews
    # surface that's the desired behavior — push the planner away
    # from efficacy framing entirely.
    "효과가 극대화",
    "효과를 극대화",
    "효과를 높",
    "효과가 확실",
    "효능",
)

PLANNER_ATTACK_BANNED_KO: tuple[str, ...] = (
    "사기",
    "거짓말",
    "기만",
    "조작된",
)

PLANNER_EXPOSE_BANNED_KO: tuple[str, ...] = (
    "숨긴",
    "속고",
    "폭로",
    "은폐",
)

# Layout slot names that are allowed to surface as rendered text. Anything
# under `audit.*` is held back. New page types should declare their
# user-visible string fields here; otherwise the safety walker will
# silently skip new fields and let leaks through.
PUBLIC_TEXT_FIELDS: frozenset[str] = frozenset({
    "title",
    "subtitle",
    "label_ko",
    "chip",
    "evidence_phrase_ko",
    "tip_ko",
    "disclosure",
    "verdict_ko",
    "name_ko",
    "category",
    "source_url",
    "headline",
    "body",
    "footer",
    "handle",
    "cta_text",
    # v1.1 long-layout additions:
    "label",
    "value",
    "note",
    "lead",
    "lead_line",
    "takeaway_ko",
    "secondary_note",
    "count",
    "rank",
    "number",
    "short_name",
    # v1.2 long-layout additions:
    "why_note",
    "who_note",
    # v2.0 long-layout additions:
    "corpus_footer",   # cover micro-text (분석 기준 absorbed)
    "closing_note",    # summary closing-note (judgment criterion)
    "sub",             # one_liner sub-line
    "tip",             # checkpoint slide tip (v2.0 single-message page)
    # v2.1 long-layout additions — spotlight pages:
    "what_reviewers_liked",  # positive_spotlight body
    "why_it_matters",        # positive_spotlight aside (also signature aside via 'note')
    "who_benefits",          # positive_spotlight aside (분-ending sentence)
    "split_signal",          # caution_spotlight metric line
    "likely_context",        # caution_spotlight aside
    "check_before_buy",      # caution_spotlight aside
    # v2.1.1 — one_liner roadmap mini-nav label (kept for backward compat
    # so a v2.1 layout still passes the validator; v2.2 layouts no longer
    # emit it).
    "roadmap_label",
    "signal_count",          # insight_spotlight metric line
    "interpretation",        # insight_spotlight body paragraph
    "who_should_check",      # insight_spotlight aside (also signature surface)
    # v2.2 — one_liner densification (replaces v2.1.1 roadmap mini-nav)
    "framing_note",          # one_liner: why-this-product-is-read-this-way
    # v2.2 — why_divides per-axis sub-line ("axis" + "why" pair)
    "axis",
    "why",
    # v2.3 (legacy) — cover hook-type classifier (kept for backward
    # compat with already-shipped layouts).
    "hook_type",
    # v2.4 — controlled-variety cover hook composition fields.
    # `hook_intent` and `product_angle` are Literal values; the
    # planner picks them from a closed enum, but they're treated as
    # public strings so the safety walker still scans them defensively.
    "hook_intent",
    "product_angle",
    # v2.3 — fit/consider item supporting line.
    "signal_hint",
    # v2.3 — summary one-liner conclusion (above the pre-purchase checks).
    "one_liner_conclusion",
    # v2.3 — sparse-page aux_block tile (title + body text).
    "text",
})

PUBLIC_LIST_FIELDS: frozenset[str] = frozenset({
    "bullets",
    "for_bullets",
    "not_for_bullets",
    "lines",
    "items",
    # v1.1 long-layout additions — string-list fields:
    "chip_strip",
    "supporting_lines",
    # v1.1 long-layout additions — dict-list fields (walker recurses
    # naturally; listing them here documents intent + lets future
    # string-only-item refactors stay safe):
    "mini_metrics",
    "mini_cards",
    "ranked_items",
    "comparison_items",
    "numbered_items",
    "fit_items",
    "consider_items",
    "actions",
    # v1.2 signature page:
    "aside_items",
    # v2.0 additions — string-list fields:
    "axes",        # why_divides axis lines
    "takeaways",   # summary takeaway sentences
    # v2.0 additions — dict-list fields (documentation):
    "slides",      # checkpoints (v2.0: 1..3 individual slide pages)
    # v2.1.1 — one_liner roadmap mini-nav (dict items: number, label).
    # Kept for backward compat; v2.2 layouts emit `metric_pills` instead.
    "roadmap_items",
    # v2.2 — one_liner numeric anchors (string list).
    "metric_pills",
    # v2.2 — why_divides paired axis + why-line (dict items).
    "axis_pairs",
    # v2.2 — cta supporting save/like/comment actions (string list).
    "support_actions",
})

# Allowed `language` values. New locales add here; the safety contract
# stays the same shape across languages (the ban list is per-language).
ALLOWED_LANGUAGES: frozenset[str] = frozenset({"ko"})

# A 12-hex-char review_id token (matches `oliveyoung_browser_api`'s 12-char
# truncation convention). We only flag a leak when the same token appears
# in `audit.evidence_review_id_truncated` AND in some public string.
_HEX12 = re.compile(r"\b[0-9a-f]{12}\b")


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SafetyViolation:
    rule: str
    location: str
    matched: str | None = None
    detail: str = ""

    def __str__(self) -> str:
        bits = [f"{self.rule} @ {self.location}"]
        if self.matched is not None:
            bits.append(f"matched={self.matched!r}")
        if self.detail:
            bits.append(self.detail)
        return " — ".join(bits)


class CardnewsSafetyError(ValueError):
    """Raised when the cardnews layout violates the consumer-safety
    contract. The renderer must NOT proceed when this fires.

    `violations` carries the full list so the operator can fix every
    issue in one pass instead of whack-a-mole."""

    def __init__(self, violations: tuple[SafetyViolation, ...]):
        self.violations = violations
        joined = "\n  - ".join(str(v) for v in violations)
        super().__init__(
            f"cardnews safety contract violated ({len(violations)} issue"
            f"{'s' if len(violations) != 1 else ''}):\n  - {joined}"
        )


# ---------------------------------------------------------------------------
# Walkers
# ---------------------------------------------------------------------------


def _walk_public_strings(node: object, path: str) -> Iterator[tuple[str, str]]:
    """Yield (path, string) for every user-visible string in the layout.
    Skips any subtree rooted at a key named `audit`."""
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "audit":
                continue
            child_path = f"{path}.{k}" if path else k
            if isinstance(v, str):
                if k in PUBLIC_TEXT_FIELDS:
                    yield child_path, v
                # Strings under unknown keys are intentionally NOT yielded.
                # That's the allowlist behavior — callers must declare
                # their public text fields.
            elif isinstance(v, list):
                if k in PUBLIC_LIST_FIELDS:
                    for i, item in enumerate(v):
                        if isinstance(item, str):
                            yield f"{child_path}[{i}]", item
                        else:
                            yield from _walk_public_strings(
                                item, f"{child_path}[{i}]"
                            )
                else:
                    for i, item in enumerate(v):
                        yield from _walk_public_strings(
                            item, f"{child_path}[{i}]"
                        )
            elif isinstance(v, dict):
                yield from _walk_public_strings(v, child_path)
    elif isinstance(node, list):
        for i, item in enumerate(node):
            yield from _walk_public_strings(item, f"{path}[{i}]")


def _collect_audit_review_ids(node: object) -> set[str]:
    """Pull every `audit.evidence_review_id_truncated` value from the
    layout. The render-leak check needs this set to know what tokens
    must not appear publicly."""
    out: set[str] = set()
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "audit" and isinstance(v, dict):
                rid = v.get("evidence_review_id_truncated")
                if isinstance(rid, str) and _HEX12.fullmatch(rid):
                    out.add(rid)
            else:
                out |= _collect_audit_review_ids(v)
    elif isinstance(node, list):
        for item in node:
            out |= _collect_audit_review_ids(item)
    return out


def _walk_languages(node: object, path: str) -> Iterator[tuple[str, object]]:
    """Yield (path, language_value) at the top-level layout and on every
    page object. Used to assert language presence + allowed value."""
    if isinstance(node, dict):
        if "pages" in node:
            yield path or "<root>", node.get("language")
        if node.get("type") and "type" in node:
            yield path or "<page>", node.get("language")
        for k, v in node.items():
            if k == "audit":
                continue
            child_path = f"{path}.{k}" if path else k
            if isinstance(v, (dict, list)):
                yield from _walk_languages(v, child_path)
    elif isinstance(node, list):
        for i, item in enumerate(node):
            yield from _walk_languages(item, f"{path}[{i}]")


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def validate_cardnews_safety(
    layout: dict,
    *,
    extra_banned: Iterable[str] | None = None,
) -> None:
    """Run the consumer-safety contract over a cardnews layout.

    Raises `CardnewsSafetyError` with the full violation list when any
    rule fires. Returns None on success.

    `extra_banned` lets callers extend the ban list at runtime (e.g. for
    a brand-specific tone profile). The base list is non-overridable —
    callers can add but never remove.
    """
    if not isinstance(layout, dict):
        raise CardnewsSafetyError(
            (SafetyViolation(
                rule="malformed",
                location="<root>",
                detail="layout must be a dict",
            ),)
        )

    violations: list[SafetyViolation] = []
    banned = tuple(BANNED_FRAMINGS_KO) + tuple(
        s for s in (extra_banned or ()) if isinstance(s, str) and s
    )

    # 1) Banned framings — every public string is scanned for every banned
    #    substring. Flag each independently so operators see the full
    #    diagnostic in one shot.
    for path, text in _walk_public_strings(layout, ""):
        if not text:
            continue
        for term in banned:
            if term in text:
                violations.append(SafetyViolation(
                    rule="banned_framing",
                    location=path,
                    matched=term,
                    detail="anti-clickbait / brand-attack tone — see "
                           "feedback_consumer_safety_contract memory",
                ))

    # 2) Audit-ID leak — the audit.evidence_review_id_truncated tokens may
    #    only appear inside `audit.*`. If the same 12-hex token surfaces
    #    publicly the privacy contract is broken.
    audit_ids = _collect_audit_review_ids(layout)
    if audit_ids:
        for path, text in _walk_public_strings(layout, ""):
            for rid in audit_ids:
                if rid in text:
                    violations.append(SafetyViolation(
                        rule="review_id_leak",
                        location=path,
                        matched=rid,
                        detail="review_id from audit.* leaked into a "
                               "public field — see feedback_evidence_audience_scope",
                    ))

    # 3) Language presence — top-level + every page node. Missing or
    #    out-of-allowlist values block.
    saw_root = False
    for path, lang in _walk_languages(layout, ""):
        if path == "<root>":
            saw_root = True
        if not isinstance(lang, str) or lang not in ALLOWED_LANGUAGES:
            violations.append(SafetyViolation(
                rule="language_invalid",
                location=f"{path}.language",
                matched=str(lang),
                detail=f"language must be one of {sorted(ALLOWED_LANGUAGES)}",
            ))
    if not saw_root:
        violations.append(SafetyViolation(
            rule="language_missing",
            location="<root>.language",
            detail="layout must carry a top-level `language` field",
        ))

    if violations:
        raise CardnewsSafetyError(tuple(violations))


# ---------------------------------------------------------------------------
# Planner-stage validator
# ---------------------------------------------------------------------------


def _walk_plan_strings(node: object, path: str) -> Iterator[tuple[str, str]]:
    """Walk every string in a content_plan dict.

    Unlike `_walk_public_strings` (which uses a field allowlist for the
    layout to keep audit fields out), the content_plan has NO audit
    fields by contract — every string in it is consumer-facing. So we
    walk every string indiscriminately.
    """
    if isinstance(node, dict):
        for k, v in node.items():
            child_path = f"{path}.{k}" if path else k
            if isinstance(v, str):
                yield child_path, v
            elif isinstance(v, (dict, list)):
                yield from _walk_plan_strings(v, child_path)
    elif isinstance(node, list):
        for i, item in enumerate(node):
            if isinstance(item, str):
                yield f"{path}[{i}]", item
            elif isinstance(item, (dict, list)):
                yield from _walk_plan_strings(item, f"{path}[{i}]")


def validate_content_plan_safety(
    plan: dict,
    *,
    extra_banned: Iterable[str] | None = None,
) -> None:
    """Run the consumer-safety contract over a content_plan dict.

    This runs BEFORE layout build — catching banned framings at the
    source means the layout never gets a chance to embed them, and the
    operator sees a clean diagnostic from the planner output rather
    than a cryptic render-time abort.

    Catches:
      * `BANNED_FRAMINGS_KO` (clickbait / brand-attack / consumer-as-
        ignorant — same list the layout enforces)
      * `PLANNER_MEDICAL_BANNED_KO` (cosmetics shouldn't make medical
        promises)
      * `PLANNER_ATTACK_BANNED_KO` (brand-attack / accusation cluster)
      * `PLANNER_EXPOSE_BANNED_KO` (exposé / 폭로 framing cluster)

    Raises `CardnewsSafetyError` on any violation.
    """
    if not isinstance(plan, dict):
        raise CardnewsSafetyError(
            (SafetyViolation(
                rule="malformed",
                location="<root>",
                detail="content_plan must be a dict",
            ),)
        )

    violations: list[SafetyViolation] = []
    base_banned = (
        tuple(BANNED_FRAMINGS_KO)
        + tuple(PLANNER_MEDICAL_BANNED_KO)
        + tuple(PLANNER_ATTACK_BANNED_KO)
        + tuple(PLANNER_EXPOSE_BANNED_KO)
    )
    banned = base_banned + tuple(
        s for s in (extra_banned or ()) if isinstance(s, str) and s
    )

    rule_for: dict[str, str] = {}
    for term in BANNED_FRAMINGS_KO:
        rule_for[term] = "banned_framing"
    for term in PLANNER_MEDICAL_BANNED_KO:
        rule_for[term] = "medical_claim"
    for term in PLANNER_ATTACK_BANNED_KO:
        rule_for[term] = "brand_attack"
    for term in PLANNER_EXPOSE_BANNED_KO:
        rule_for[term] = "expose_framing"

    for path, text in _walk_plan_strings(plan, ""):
        if not text:
            continue
        for term in banned:
            if term in text:
                violations.append(SafetyViolation(
                    rule=rule_for.get(term, "banned_framing"),
                    location=path,
                    matched=term,
                    detail="content_plan must not carry this framing — "
                           "see ko_cardnews_content_plan.md banned list",
                ))

    # Language presence check — content_plan carries `language` at top
    # level only (no nested page-level language fields). Single check.
    lang = plan.get("language")
    if not isinstance(lang, str) or lang not in ALLOWED_LANGUAGES:
        violations.append(SafetyViolation(
            rule="language_invalid",
            location="<root>.language",
            matched=str(lang),
            detail=f"language must be one of {sorted(ALLOWED_LANGUAGES)}",
        ))

    if violations:
        raise CardnewsSafetyError(tuple(violations))
