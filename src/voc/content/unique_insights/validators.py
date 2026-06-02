"""Validator for `unique_product_insights.json`.

Phase E1+E2 ships the validator without the LLM call. The Phase E3
extractor will run this against its output before disk write; the
runner (Phase E5) will run it again post-disk-load.

Hard rules enforced (each → blocking flag on violation)
-------------------------------------------------------
- `schema_version` is `"1.0"`.
- `insights[]` length ≤ `MAX_INSIGHTS`.
- Every insight's `insight_id` matches `^ins_\\d{3}$` and is unique.
- `type` ∈ INSIGHT_TYPES.
- `title_ko` ≤ 30, `explanation_ko` ≤ 200,
  `what_makes_it_unique_ko` ≤ 200 (all NFC-normalized).
- `evidence_review_ids[]`: 2..5 distinct values; every cited id
  resolves in `bounded_review_excerpts`.
- `evidence_quotes_ko[]`: same length as `evidence_review_ids[]`;
  each quote is a literal substring of
  `bounded_review_excerpts[evidence_review_ids[i]]` after NFC.
- `confidence` ∈ CONFIDENCE_LEVELS; relevance fields ∈ RELEVANCE_LEVELS.
- `category_baseline.source` ∈ BASELINE_SOURCES.
- When `category_baseline.source == "uncertain"`,
  `category_baseline.is_hypothesis` MUST be true.
- Ban-list scans (medical / directive / superlative / causal /
  anti-clickbait) on every LLM-authored field. **Not** on
  `evidence_quotes_ko[]` — those are verbatim review excerpts and
  reviewers may use any wording; the substring check guarantees
  authenticity, not safety.
- `content_angle_score` ∈ [0, 1].
- `risk_flags[]` items ∈ KNOWN_RISK_FLAGS (advisory only —
  unknown flags get an advisory but are not blocking).
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from src.voc.content.insight_brief import ANTI_CLICKBAIT_KO
from src.voc.content.unique_insights.schema import (
    BASELINE_SOURCES,
    CONFIDENCE_LEVELS,
    INSIGHT_TYPES,
    KNOWN_RISK_FLAGS,
    MAX_EVIDENCE_REVIEW_IDS,
    MAX_EXPLANATION_CHARS_KO,
    MAX_INSIGHTS,
    MAX_SOURCE_CANDIDATE_IDS,
    MAX_TITLE_CHARS_KO,
    MAX_WHAT_MAKES_UNIQUE_CHARS_KO,
    MIN_EVIDENCE_REVIEW_IDS,
    MIN_SOURCE_CANDIDATE_IDS,
    RELEVANCE_LEVELS,
    UNIQUE_INSIGHTS_SCHEMA_VERSION,
    CandidatePool,
)
from src.voc.content.validators import (
    BAN_LIST_CAUSAL_KO,
    BAN_LIST_DIRECTIVE_KO,
    BAN_LIST_MEDICAL_KO,
    BAN_LIST_SUPERLATIVE_KO,
    ValidationFlag,
)


_INSIGHT_ID_RE = re.compile(r"^ins_\d{3}$")


@dataclass(frozen=True)
class InsightValidationResult:
    """Same shape as `CardnewsValidationResult` / `BriefValidationResult`
    so callers can treat the three uniformly. Type-distinct keeps
    test assertions clear."""
    ok: bool
    flags: tuple[ValidationFlag, ...]

    @property
    def blocking(self) -> tuple[ValidationFlag, ...]:
        return tuple(f for f in self.flags if f.severity == "blocking")

    @property
    def advisory(self) -> tuple[ValidationFlag, ...]:
        return tuple(f for f in self.flags if f.severity == "advisory")

    def summary(self) -> str:
        if self.ok:
            return f"ok ({len(self.advisory)} advisory)"
        return (
            f"failed ({len(self.blocking)} blocking, "
            f"{len(self.advisory)} advisory)"
        )


# ---------------------------------------------------------------------------
# Ban-list groups
# ---------------------------------------------------------------------------
#
# Same semantics as Phase B/C: substring scan after NFC. We deliberately
# do NOT scan `evidence_quotes_ko[]` because those are verbatim review
# excerpts and may legitimately contain banned tokens (e.g. a reviewer
# wrote "최고에요"). The substring authenticity check is the safety
# anchor on quotes; the ban lists protect LLM-authored fields.

_BAN_LIST_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("ban_list_medical", BAN_LIST_MEDICAL_KO),
    ("ban_list_directive", BAN_LIST_DIRECTIVE_KO),
    ("ban_list_superlative", BAN_LIST_SUPERLATIVE_KO),
    ("ban_list_causal", BAN_LIST_CAUSAL_KO),
    ("anti_clickbait", ANTI_CLICKBAIT_KO),
)

_BAN_LIST_DETAIL: dict[str, str] = {
    "ban_list_medical": "medical claim language",
    "ban_list_directive": "directive / imperative wording",
    "ban_list_superlative": "superlative claim without comparative basis",
    "ban_list_causal": "causal product-defect attribution",
    "anti_clickbait": "sensational / clickbait framing",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _nfc(s: str | None) -> str:
    return unicodedata.normalize("NFC", s) if s else ""


def _kchars(s: str | None) -> int:
    return 0 if not s else len(_nfc(s))


def _scan_ban_groups(text: str, location: str) -> list[ValidationFlag]:
    """Run every ban list against `text`. Each match yields one
    blocking ValidationFlag."""
    flags: list[ValidationFlag] = []
    if not text:
        return flags
    n = _nfc(text)
    for rule, terms in _BAN_LIST_GROUPS:
        for term in terms:
            if term in n:
                flags.append(ValidationFlag(
                    rule=rule,
                    severity="blocking",
                    location=location,
                    matched=term,
                    detail=_BAN_LIST_DETAIL[rule],
                ))
    return flags


def _is_substring_nfc(needle: str | None, haystack: str | None) -> bool:
    """NFC-normalized substring check."""
    if not needle or not haystack:
        return False
    return _nfc(needle) in _nfc(haystack)


# ---------------------------------------------------------------------------
# Public validator
# ---------------------------------------------------------------------------


def _candidate_id_set_from_pool(pool: CandidatePool) -> set[str]:
    """Union of candidate_ids across every bucket. Used by the
    `source_candidate_id_in_pool` rule."""
    out: set[str] = set()
    for bucket in (
        pool.high_frequency_strengths,
        pool.concentrated_complaints,
        pool.cross_attribute_tradeoffs,
        pool.polarity_outliers,
        pool.usage_context_signals,
    ):
        for e in bucket:
            if e.candidate_id:
                out.add(e.candidate_id)
    return out


def _candidate_id_set_from_doc(insights_doc: dict) -> set[str]:
    """Same union, but from the on-disk doc shape (when no
    CandidatePool object is available)."""
    cp = insights_doc.get("candidate_pool") or {}
    out: set[str] = set()
    for bucket_name in (
        "high_frequency_strengths", "concentrated_complaints",
        "cross_attribute_tradeoffs", "polarity_outliers",
        "usage_context_signals",
    ):
        for e in (cp.get(bucket_name) or []):
            if isinstance(e, dict):
                cid = e.get("candidate_id")
                if isinstance(cid, str) and cid:
                    out.add(cid)
    return out


def validate_unique_insights(
    insights_doc: dict,
    *,
    bounded_review_excerpts: dict[str, str] | None = None,
    candidate_pool: CandidatePool | None = None,
) -> InsightValidationResult:
    """Validate a `unique_product_insights.json`-shaped dict.

    `bounded_review_excerpts` is the authoritative review-text
    lookup the LLM was given. When omitted, the validator looks
    inside `insights_doc["candidate_pool"]["bounded_review_excerpts"]`
    (the on-disk source of truth).

    `candidate_pool` is the in-memory pool the extractor used. When
    omitted, the validator derives the candidate-id set from the
    on-disk doc's `candidate_pool` block. The
    `source_candidate_id_in_pool` rule rejects any insight that
    cites an id not present in this set.
    """
    flags: list[ValidationFlag] = []

    if not isinstance(insights_doc, dict):
        return InsightValidationResult(
            ok=False,
            flags=(ValidationFlag(
                rule="malformed",
                severity="blocking",
                location="insights_doc",
                detail="insights_doc must be a dict",
            ),),
        )

    # ---- Schema version -------------------------------------------------
    sv = insights_doc.get("schema_version")
    if sv != UNIQUE_INSIGHTS_SCHEMA_VERSION:
        flags.append(ValidationFlag(
            rule="schema_version",
            severity="blocking",
            location="schema_version",
            matched=str(sv),
            detail=f"expected {UNIQUE_INSIGHTS_SCHEMA_VERSION!r}",
        ))

    # ---- Resolve bounded_review_excerpts --------------------------------
    if bounded_review_excerpts is None:
        cp = insights_doc.get("candidate_pool") or {}
        raw = cp.get("bounded_review_excerpts")
        if isinstance(raw, dict):
            bounded_review_excerpts = {
                k: v for k, v in raw.items()
                if isinstance(k, str) and isinstance(v, str)
            }
        else:
            bounded_review_excerpts = {}

    # ---- Resolve candidate_id set ---------------------------------------
    if candidate_pool is not None:
        candidate_id_set = _candidate_id_set_from_pool(candidate_pool)
    else:
        candidate_id_set = _candidate_id_set_from_doc(insights_doc)

    # ---- insights array shape -------------------------------------------
    insights = insights_doc.get("insights")
    if not isinstance(insights, list):
        flags.append(ValidationFlag(
            rule="insights_present",
            severity="blocking",
            location="insights",
            detail="insights must be a list (may be empty)",
        ))
        # Without a list we cannot do per-insight validation.
        return InsightValidationResult(
            ok=False, flags=tuple(flags),
        )

    if len(insights) > MAX_INSIGHTS:
        flags.append(ValidationFlag(
            rule="insights_count",
            severity="blocking",
            location="insights",
            matched=str(len(insights)),
            detail=f"insights must have ≤ {MAX_INSIGHTS} entries",
        ))

    # ---- Per-insight validation -----------------------------------------
    seen_ids: set[str] = set()
    for i, insight in enumerate(insights):
        loc = f"insights[{i}]"
        if not isinstance(insight, dict):
            flags.append(ValidationFlag(
                rule="malformed_insight",
                severity="blocking",
                location=loc,
                detail="insight must be a dict",
            ))
            continue

        flags.extend(_validate_one_insight(
            insight, loc, seen_ids, bounded_review_excerpts,
            candidate_id_set,
        ))

    blocking = any(f.severity == "blocking" for f in flags)
    return InsightValidationResult(
        ok=not blocking,
        flags=tuple(flags),
    )


def _validate_one_insight(
    insight: dict,
    loc: str,
    seen_ids: set[str],
    bounded: dict[str, str],
    candidate_id_set: set[str],
) -> list[ValidationFlag]:
    flags: list[ValidationFlag] = []

    # insight_id
    iid = insight.get("insight_id")
    if not isinstance(iid, str) or not _INSIGHT_ID_RE.match(iid):
        flags.append(ValidationFlag(
            rule="insight_id_format",
            severity="blocking",
            location=f"{loc}.insight_id",
            matched=str(iid),
            detail="insight_id must match ^ins_[0-9]{3}$",
        ))
    elif iid in seen_ids:
        flags.append(ValidationFlag(
            rule="insight_id_unique",
            severity="blocking",
            location=f"{loc}.insight_id",
            matched=iid,
            detail="insight_id must be unique within insights[]",
        ))
    else:
        seen_ids.add(iid)

    # type
    t = insight.get("type")
    if t not in INSIGHT_TYPES:
        flags.append(ValidationFlag(
            rule="insight_type_enum",
            severity="blocking",
            location=f"{loc}.type",
            matched=str(t),
            detail=f"type must be one of {INSIGHT_TYPES}",
        ))

    # title / explanation / what_makes_it_unique
    flags.extend(_validate_text_field(
        insight.get("title_ko"),
        location=f"{loc}.title_ko",
        max_chars=MAX_TITLE_CHARS_KO,
        rule_present="title_ko_present",
        rule_length="title_ko_length",
    ))
    flags.extend(_validate_text_field(
        insight.get("explanation_ko"),
        location=f"{loc}.explanation_ko",
        max_chars=MAX_EXPLANATION_CHARS_KO,
        rule_present="explanation_ko_present",
        rule_length="explanation_ko_length",
    ))
    flags.extend(_validate_text_field(
        insight.get("what_makes_it_unique_ko"),
        location=f"{loc}.what_makes_it_unique_ko",
        max_chars=MAX_WHAT_MAKES_UNIQUE_CHARS_KO,
        rule_present="what_makes_it_unique_ko_present",
        rule_length="what_makes_it_unique_ko_length",
    ))

    # category_baseline (object)
    cb = insight.get("category_baseline")
    if not isinstance(cb, dict):
        flags.append(ValidationFlag(
            rule="category_baseline_present",
            severity="blocking",
            location=f"{loc}.category_baseline",
            detail="category_baseline must be a dict",
        ))
    else:
        cb_source = cb.get("source")
        if cb_source not in BASELINE_SOURCES:
            flags.append(ValidationFlag(
                rule="category_baseline_source",
                severity="blocking",
                location=f"{loc}.category_baseline.source",
                matched=str(cb_source),
                detail=f"source must be one of {BASELINE_SOURCES}",
            ))
        is_hypothesis = cb.get("is_hypothesis")
        if not isinstance(is_hypothesis, bool):
            flags.append(ValidationFlag(
                rule="category_baseline_is_hypothesis_type",
                severity="blocking",
                location=f"{loc}.category_baseline.is_hypothesis",
                matched=str(is_hypothesis),
                detail="is_hypothesis must be a bool",
            ))
        elif cb_source == "uncertain" and is_hypothesis is not True:
            flags.append(ValidationFlag(
                rule="baseline_uncertain_marks_hypothesis",
                severity="blocking",
                location=f"{loc}.category_baseline.is_hypothesis",
                detail=(
                    "when category_baseline.source == 'uncertain', "
                    "is_hypothesis MUST be true"
                ),
            ))
        cb_ko = cb.get("ko")
        if not isinstance(cb_ko, str):
            flags.append(ValidationFlag(
                rule="category_baseline_ko_present",
                severity="blocking",
                location=f"{loc}.category_baseline.ko",
                detail="category_baseline.ko must be a string",
            ))
        else:
            flags.extend(_scan_ban_groups(cb_ko, f"{loc}.category_baseline.ko"))

    # evidence_review_ids
    rids = insight.get("evidence_review_ids")
    if not isinstance(rids, list):
        flags.append(ValidationFlag(
            rule="evidence_review_ids_present",
            severity="blocking",
            location=f"{loc}.evidence_review_ids",
            detail="evidence_review_ids must be a list",
        ))
        rids = []
    else:
        non_str = [r for r in rids if not isinstance(r, str)]
        if non_str:
            flags.append(ValidationFlag(
                rule="evidence_review_ids_type",
                severity="blocking",
                location=f"{loc}.evidence_review_ids",
                matched=str(non_str)[:80],
                detail="every evidence_review_id must be a string",
            ))
        distinct = list(dict.fromkeys(r for r in rids if isinstance(r, str)))
        if len(distinct) < MIN_EVIDENCE_REVIEW_IDS:
            flags.append(ValidationFlag(
                rule="evidence_review_ids_min",
                severity="blocking",
                location=f"{loc}.evidence_review_ids",
                matched=str(len(distinct)),
                detail=(
                    f"need ≥ {MIN_EVIDENCE_REVIEW_IDS} distinct review_ids; "
                    f"got {len(distinct)}"
                ),
            ))
        if len(rids) > MAX_EVIDENCE_REVIEW_IDS:
            flags.append(ValidationFlag(
                rule="evidence_review_ids_max",
                severity="blocking",
                location=f"{loc}.evidence_review_ids",
                matched=str(len(rids)),
                detail=(
                    f"too many evidence_review_ids; max {MAX_EVIDENCE_REVIEW_IDS}"
                ),
            ))
        if len(distinct) != len([r for r in rids if isinstance(r, str)]):
            flags.append(ValidationFlag(
                rule="evidence_review_ids_unique",
                severity="blocking",
                location=f"{loc}.evidence_review_ids",
                detail="evidence_review_ids must be distinct",
            ))
        for j, r in enumerate(rids):
            if isinstance(r, str) and r not in bounded:
                flags.append(ValidationFlag(
                    rule="evidence_review_id_in_pool",
                    severity="blocking",
                    location=f"{loc}.evidence_review_ids[{j}]",
                    matched=r,
                    detail=(
                        "review_id not in candidate_pool.bounded_review_excerpts"
                    ),
                ))

    # evidence_quotes_ko + substring check
    quotes = insight.get("evidence_quotes_ko")
    if not isinstance(quotes, list):
        flags.append(ValidationFlag(
            rule="evidence_quotes_ko_present",
            severity="blocking",
            location=f"{loc}.evidence_quotes_ko",
            detail="evidence_quotes_ko must be a list",
        ))
        quotes = []
    else:
        if isinstance(rids, list) and len(quotes) != len(rids):
            flags.append(ValidationFlag(
                rule="evidence_quotes_count_match",
                severity="blocking",
                location=f"{loc}.evidence_quotes_ko",
                matched=f"quotes={len(quotes)} ids={len(rids)}",
                detail=(
                    "evidence_quotes_ko must be the same length as "
                    "evidence_review_ids"
                ),
            ))
        for j, q in enumerate(quotes):
            if not isinstance(q, str) or not q.strip():
                flags.append(ValidationFlag(
                    rule="evidence_quote_present",
                    severity="blocking",
                    location=f"{loc}.evidence_quotes_ko[{j}]",
                    detail="evidence_quote must be a non-empty string",
                ))
                continue
            # Substring check against bounded_review_excerpts at the
            # parallel review_id index. If the index is out of range
            # (count_match flagged elsewhere), we still try to pair as
            # best we can.
            paired_rid = (
                rids[j] if isinstance(rids, list) and j < len(rids) and isinstance(rids[j], str)
                else None
            )
            haystack = bounded.get(paired_rid) if paired_rid else None
            if haystack is None:
                # The review_id itself is invalid; don't double-flag —
                # `evidence_review_id_in_pool` already fired above.
                continue
            if not _is_substring_nfc(q, haystack):
                flags.append(ValidationFlag(
                    rule="evidence_quote_substring",
                    severity="blocking",
                    location=f"{loc}.evidence_quotes_ko[{j}]",
                    matched=q[:60],
                    detail=(
                        "evidence_quote is not a literal substring of "
                        "the cited review's bounded excerpt (NFC-normalized)"
                    ),
                ))

    # source_candidate_ids — every insight must cite ≥1 candidate_pool
    # entry it derived from. Validator rejects ids not present in
    # the pool's id set so the LLM cannot invent unanchored signals.
    sc = insight.get("source_candidate_ids")
    if not isinstance(sc, list):
        flags.append(ValidationFlag(
            rule="source_candidate_ids_present",
            severity="blocking",
            location=f"{loc}.source_candidate_ids",
            detail="source_candidate_ids must be a list",
        ))
        sc = []
    else:
        non_str_sc = [s for s in sc if not isinstance(s, str)]
        if non_str_sc:
            flags.append(ValidationFlag(
                rule="source_candidate_id_type",
                severity="blocking",
                location=f"{loc}.source_candidate_ids",
                matched=str(non_str_sc)[:80],
                detail="every source_candidate_id must be a string",
            ))
        distinct_sc = list(dict.fromkeys(s for s in sc if isinstance(s, str)))
        if len(distinct_sc) < MIN_SOURCE_CANDIDATE_IDS:
            flags.append(ValidationFlag(
                rule="source_candidate_ids_min",
                severity="blocking",
                location=f"{loc}.source_candidate_ids",
                matched=str(len(distinct_sc)),
                detail=(
                    f"need ≥ {MIN_SOURCE_CANDIDATE_IDS} distinct "
                    f"source_candidate_ids; got {len(distinct_sc)}"
                ),
            ))
        if len(sc) > MAX_SOURCE_CANDIDATE_IDS:
            flags.append(ValidationFlag(
                rule="source_candidate_ids_max",
                severity="blocking",
                location=f"{loc}.source_candidate_ids",
                matched=str(len(sc)),
                detail=(
                    f"too many source_candidate_ids; max "
                    f"{MAX_SOURCE_CANDIDATE_IDS}"
                ),
            ))
        if len(distinct_sc) != len([s for s in sc if isinstance(s, str)]):
            flags.append(ValidationFlag(
                rule="source_candidate_ids_unique",
                severity="blocking",
                location=f"{loc}.source_candidate_ids",
                detail="source_candidate_ids must be distinct",
            ))
        for j, cid in enumerate(sc):
            if isinstance(cid, str) and cid not in candidate_id_set:
                flags.append(ValidationFlag(
                    rule="source_candidate_id_in_pool",
                    severity="blocking",
                    location=f"{loc}.source_candidate_ids[{j}]",
                    matched=cid,
                    detail=(
                        "candidate_id not present in candidate_pool "
                        "(LLM cannot invent unanchored signals)"
                    ),
                ))

    # confidence
    conf = insight.get("confidence")
    if conf not in CONFIDENCE_LEVELS:
        flags.append(ValidationFlag(
            rule="confidence_enum",
            severity="blocking",
            location=f"{loc}.confidence",
            matched=str(conf),
            detail=f"confidence must be one of {CONFIDENCE_LEVELS}",
        ))

    # content_angle_score
    cas = insight.get("content_angle_score")
    if not isinstance(cas, (int, float)) or not (0.0 <= float(cas) <= 1.0):
        flags.append(ValidationFlag(
            rule="content_angle_score_range",
            severity="blocking",
            location=f"{loc}.content_angle_score",
            matched=str(cas),
            detail="content_angle_score must be a number in [0, 1]",
        ))

    # relevance enums
    for fld, rule in (
        ("seller_report_relevance", "seller_report_relevance_enum"),
        ("buyer_content_relevance", "buyer_content_relevance_enum"),
    ):
        v = insight.get(fld)
        if v not in RELEVANCE_LEVELS:
            flags.append(ValidationFlag(
                rule=rule,
                severity="blocking",
                location=f"{loc}.{fld}",
                matched=str(v),
                detail=f"{fld} must be one of {RELEVANCE_LEVELS}",
            ))

    # risk_flags (advisory if unknown values appear)
    rfs = insight.get("risk_flags")
    if rfs is None or not isinstance(rfs, list):
        flags.append(ValidationFlag(
            rule="risk_flags_present",
            severity="blocking",
            location=f"{loc}.risk_flags",
            detail="risk_flags must be a list (may be empty)",
        ))
    else:
        for j, rf in enumerate(rfs):
            if not isinstance(rf, str):
                flags.append(ValidationFlag(
                    rule="risk_flag_type",
                    severity="blocking",
                    location=f"{loc}.risk_flags[{j}]",
                    matched=str(rf),
                    detail="risk_flag must be a string",
                ))
                continue
            if rf not in KNOWN_RISK_FLAGS:
                flags.append(ValidationFlag(
                    rule="risk_flag_unknown",
                    severity="advisory",
                    location=f"{loc}.risk_flags[{j}]",
                    matched=rf,
                    detail=(
                        f"unknown risk_flag {rf!r}; known set is "
                        f"{KNOWN_RISK_FLAGS}"
                    ),
                ))

    return flags


def _validate_text_field(
    value: object,
    *,
    location: str,
    max_chars: int,
    rule_present: str,
    rule_length: str,
) -> list[ValidationFlag]:
    flags: list[ValidationFlag] = []
    if not isinstance(value, str) or not value.strip():
        flags.append(ValidationFlag(
            rule=rule_present,
            severity="blocking",
            location=location,
            detail=f"{location} must be a non-empty string",
        ))
        return flags
    n = _kchars(value)
    if n > max_chars:
        flags.append(ValidationFlag(
            rule=rule_length,
            severity="blocking",
            location=location,
            matched=value[:60],
            detail=f"len={n} > {max_chars}",
        ))
    flags.extend(_scan_ban_groups(value, location))
    return flags
