"""Post-Stage-2 polarity reliability guardrail.

Stage 2 of the Phase 2E pipeline assigns polarity (`positive`,
`negative_weak`, `negative_strong`, `mixed`) to attribute-tagged
review spans via an LLM. Empirically (see run-010 audit) some
clearly positive spans land with `negative_weak`. Surfacing those
in seller-facing risk sections destroys analytical reliability.

This module is a **post-Stage-2 advisory layer**. It does NOT
edit the Stage 2 prompt, the aggregator, or any canonical schema
field. It computes a verdict per quote — *suspect* or *clean* —
and returns reasons. The adapter then uses the verdict to:

  - exclude suspect quotes from polarity-specific surfaces
    (e.g. a "negative_weak" flagged-positive should not appear in
    `monitoring_candidates.top_negative_quotes`),
  - keep the raw record for audit (sidecar + per-attribute
    `polarity_suspect=True` flag in the report's `top_quotes`).

Hard rules
----------
- Never auto-flip a polarity. Suggested polarity is advisory only.
- Pure: no I/O, no DB, no LLM, no global state.
- Conservative on ambiguous text — when in doubt, NOT suspect.
  Better to surface a marginal complaint than silently kill it.
- Negation- and concession-aware on Korean cues (e.g. "안 좋",
  "~지 않", "~는데", "~지만") so a clean negative isn't
  mis-flagged as a positive carrying suspicion.

Design contract
---------------
- Input: text + claimed polarity. Cue lists are private to this
  module (lexicon-shaped, not in `data/phase1_lexicons/`, so
  Phase 1 baseline is unaffected).
- Output: `PolarityCheck` dataclass. Adapter reads `is_suspect`
  and `reasons`. Other fields are diagnostic only.

Korean lexicon notes
--------------------
- Strong-positive cues are decisive sentiment markers — `만족`,
  `좋네요`, `좋아요`, `좋습니다`, `좋더라`, `깨끗`, `깔끔`, `진정되`,
  `쫀쫀`, `대만족`. Single words inside negation are still
  positive *content* (e.g., "만족스러" appearing inside "만족스럽지
  않" — handled by the negation walker).
- Strong-negative cues — `아쉬`, `별로`, `불만`, `짜증`, `후회`,
  `비추`, `마음에 안`, `안 좋`, `안좋`, `자극적이`, `따가운`, `안 닫`.
  Some morphemes are deliberately omitted (`마르`, `말라` —
  ambiguous in skincare context: pad drying = bad, skin not
  drying = good).
- Concession structures (`-지만`, `-는데`, `-인데`) typically
  flip the polarity of the preceding clause. We do NOT use
  these to flip Stage 2's call; instead we treat them as a
  *reason to be conservative*.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable


# -----------------------------------------------------------------------------
# Lexicon — Korean cues
# -----------------------------------------------------------------------------

# Strong, decisive positive cues. Membership = "this morpheme
# appearing in the clause is hard to interpret as a complaint."
KO_POSITIVE_CUES: tuple[str, ...] = (
    "만족",          # 만족해요/만족스러/만족합니다/대만족
    "대만족",
    "강추",
    "재구매",
    "추천",
    "좋아요",
    "좋네요",
    "좋습니다",
    "좋더라",
    "좋았어요",
    "좋았습니다",
    "괜찮아요",
    "괜찮네요",
    "마음에 들",     # 마음에 들어요 / 들었어요 / 들더라
    "마음에들",
    "깨끗",
    "깔끔",
    "쫀쫀",
    "촉촉하",
    "촉촉해",
    "부드러",        # 부드러워요/부드러웠어요/부드럽고
    "진정되",        # 진정되는/진정됐어요
    "탄탄해진",
    "탄력",
    "잘 떼져",
    "잘떼져",
    "잘 발려",
    "잘발려",
    "밀착도 잘",
    "밀착도잘",
    "흡수가 잘",
    "흡수가잘",
    "오래가",        # 오래가요/오래가더라 — 지속력 강점
    "오래 가",
    "유지가 잘",
    "편해요",
    "편하게",
    "가성비",        # 가성비 좋다 / 가성비 뛰어나
    "대용량",
)

# Strong, decisive negative cues.
KO_NEGATIVE_CUES: tuple[str, ...] = (
    "아쉽",          # 아쉽다/아쉬워/아쉬운
    "아쉬워",
    "아쉬운",
    "아쉬웠",        # 아쉬웠음/아쉬웠어요 — past form
    "별로",
    "별로였",        # 별로였다
    "별로라",
    "불만",
    "짜증",
    "후회",
    "비추",
    "안 좋",
    "안좋",
    "안 닫",
    "안닫",
    "안 닫혀",
    "안닫혀",
    "안 맞",
    "잘 안",         # 잘 안 닫혀 / 잘 안 발려
    "자극적이",
    "따가",
    "쓰라",
    "트러블",
    "트러블이",
    "건조해",
    "당겨",
    "안 들어",       # 안 들어가요 (도구 사용성)
    "안들어",
    "비싸",
    "너무 비싸",
    "돈 아까",
    "돈아까",
    "효과 모르",
    "효과는 모르",
    "마음에 안",
    "맘에 안",
    "생각보다 별로",
    "부족",          # 보습 부족 / 양 부족
    "모자라",        # 모자라요 / 모자라는
)

# Concession / mitigation markers. When present, we treat the
# clause polarity as harder to call (= more conservative on
# `is_suspect` flagging). Not a source of suspicion by itself.
KO_CONCESSION_MARKERS: tuple[str, ...] = (
    "지만",          # ~지만
    "는데",          # ~는데 (but not interrogative -는데?)
    "인데",          # ~인데
    "이긴",          # ~이긴 한데
    "긴 한데",
    "긴한데",
    "기는 한데",
    "기는하지만",
)

# Negation walker — when one of these appears within a 6-char
# window AFTER a positive cue, treat the cue as negated (so a
# negation around "만족" no longer counts as positive evidence).
KO_POST_NEGATIONS: tuple[str, ...] = (
    "지 않",         # ~지 않다/지 않아
    "지않",
    "지는 않",       # ~지는 않다 (mild denial: "촉촉하지는 않다")
    "지는않",
    "지가 않",
    "지가않",
    "안 됩",
    "안됩",
    "안 돼",
    "안돼",
    "못 했",
    "못했",
    "없어",
    "없네",
    "없습니다",
    "없었",
    "고 해야하나",   # "촉촉하다고 해야하나" — hedged self-correction
    "고 해야 하나",
    "라고 해야하나",
    "라고 해야 하나",
    "다고 해야하나",
    "다고 해야 하나",
)

# Pre-position diminishers — when one of these appears IMMEDIATELY
# before (within ~5 chars) a positive cue, the cue is dampened.
# Example: "덜 촉촉" → 촉촉 is hedged, not a positive sentiment.
# These are conceptually the mirror of KO_POST_NEGATIONS but apply
# to the LEFT of the cue. They convert a positive cue into a
# `negated_positive` (which leans negative for guardrail purposes).
KO_PRE_DIMINISHERS: tuple[str, ...] = (
    "덜 ",           # 덜 촉촉 / 덜 발려
    "덜",
    "별로 ",         # 별로 좋지 않
    "별로",
    "기대보다 ",     # 기대보다 촉촉
    "기대보다",
    "생각보다 ",     # 생각보다 촉촉
    "생각보다",
    "부족",          # 부족하게 촉촉 / 보습 부족
    "조금 ",         # 조금 촉촉 (when paired with 아쉬 / 모자라)
    "조금",
    "약간 ",
    "약간",
    "그닥 ",         # 그닥 좋지 않
    "그닥",
    "그저 그래",
    "그저그래",
)

# Sentence-level hedge markers. When ONE of these appears in the
# text, it indicates the speaker is using a positive concept word
# under explicit self-correction. Restricted to UNAMBIGUOUS self-
# corrections so it doesn't false-fire on normal mixed reviews
# ("좋아요 근데 ... 아쉬워요" — the 아쉬 there is a separate clause,
# not a hedge of the 좋 cue). Negative cues like 아쉬* are detected
# separately via KO_NEGATIVE_CUES and don't belong here.
KO_HEDGE_PATTERNS: tuple[str, ...] = (
    "라고 해야하나",
    "라고 해야 하나",
    "다고 해야하나",
    "다고 해야 하나",
    "지는 않",        # "촉촉하지는 않다" — direct denial of the cue
    "지는않",
)


# -----------------------------------------------------------------------------
# Result dataclass
# -----------------------------------------------------------------------------


@dataclass(frozen=True)
class PolarityCheck:
    """Verdict for one (text, claimed_polarity) pair.

    `is_suspect=True` means: the claimed polarity contradicts
    decisive cues in the text. The adapter should treat this
    quote as polarity-unsafe in the claimed direction (drop from
    that side's surface; keep raw for audit).

    `suggested_polarity` is the polarity that would be consistent
    with the cues found, if any. Advisory only — never used to
    silently rewrite Stage 2's call.

    `confidence` is a coarse flag: `high` when one side has at
    least one decisive cue and the other has none; `medium` when
    both sides have cues (text genuinely mixed); `low` when no
    decisive cues fired at all (we cannot judge).
    """
    is_suspect: bool
    claimed_polarity: str
    suggested_polarity: str | None
    confidence: str  # "high" | "medium" | "low"
    reasons: tuple[str, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict:
        return {
            "is_suspect": self.is_suspect,
            "claimed_polarity": self.claimed_polarity,
            "suggested_polarity": self.suggested_polarity,
            "confidence": self.confidence,
            "reasons": list(self.reasons),
        }


# -----------------------------------------------------------------------------
# Cue detection
# -----------------------------------------------------------------------------


def _find_cue_hits(text: str, cues: Iterable[str]) -> list[tuple[str, int]]:
    """Return (cue, start_index) tuples for each occurrence."""
    hits: list[tuple[str, int]] = []
    for cue in cues:
        start = 0
        while True:
            idx = text.find(cue, start)
            if idx < 0:
                break
            hits.append((cue, idx))
            start = idx + 1
    return hits


def _is_negated_after(text: str, hit_end: int, window: int = 8) -> bool:
    """Check whether a post-negation marker appears within `window`
    characters after the cue's end position. Window widened from 6
    to 8 so multi-char hedges like "고 해야하나" / "지는 않" land in
    range when the positive cue is short (e.g., "촉촉하" + "다고 해야
    하나 그건 좀 아쉬웠음")."""
    tail = text[hit_end:hit_end + window]
    return any(neg in tail for neg in KO_POST_NEGATIONS)


# "생각보다" / "기대보다" are ambiguous degree-comparators: the
# polarity depends on what follows. "생각보다 만족스러웠어요" is
# positive ("better than expected"); "생각보다 덜 촉촉했어요" is
# negative ("less moist than expected"). The strict pre-diminisher
# check would flatten both into 'negated_positive', which the
# run-003 audit caught as a false-positive on the first form.
_AMBIGUOUS_DIMINISHER_STEMS: frozenset[str] = frozenset({
    "생각보다", "기대보다",
})

# Tokens that — when present in the same span as a positive cue —
# justify treating an ambiguous degree-comparator as a real
# diminisher. Anything in this list flips "생각보다 X" / "기대보다 X"
# into a negated-positive cue.
_NEGATIVE_CO_CUE_TOKENS: tuple[str, ...] = (
    "덜",
    "별로",
    "부족",
    "아쉽",
    "아쉬워",
    "아쉬운",
    "아쉬웠",
    "안 ",
    "안좋",
    "기대 이하",
    "기대 이하인",
    "모자라",
    "후회",
)


def _has_negative_co_cue(text: str) -> bool:
    return any(t in text for t in _NEGATIVE_CO_CUE_TOKENS)


def _is_diminished_before(text: str, hit_start: int, window: int = 5) -> bool:
    """Check whether a pre-position diminisher (덜 / 별로 / 기대보다 /
    생각보다 / 부족) appears immediately before the cue. The diminisher
    must end at or close to the cue's start so we don't false-flag a
    sentence-distance "별로" that modifies a different clause.

    Run-003 QA pass-5 fix: "생각보다" / "기대보다" are degree-
    comparators whose direction depends on the rest of the text. They
    only count as diminishers when a negative co-cue (덜 / 별로 /
    부족 / 아쉬* / 안 / ...) is present in the same text.
    """
    head = text[max(0, hit_start - window):hit_start]
    if not head:
        return False
    for dim in KO_PRE_DIMINISHERS:
        if not head.endswith(dim):
            continue
        # Ambiguous comparators only count when accompanied by a real
        # negative co-cue. Otherwise the speaker is comparing favourably
        # against an expectation (positive lean).
        stripped = dim.strip()
        if stripped in _AMBIGUOUS_DIMINISHER_STEMS:
            if not _has_negative_co_cue(text):
                continue
        return True
    return False


def _has_hedge_pattern(text: str) -> bool:
    """True when the text contains a sentence-level hedge that
    indicates positive cues are being qualified or self-corrected
    (e.g. "...라고 해야하나 그건 좀 아쉬웠음"). Used as a soft
    signal: pushes positive cue resolution toward `negated_positive`
    when paired with a negative-leaning concession.
    """
    return any(p in text for p in KO_HEDGE_PATTERNS)


def _has_concession(text: str) -> bool:
    return any(marker in text for marker in KO_CONCESSION_MARKERS)


def _classify_polarity(claimed: str) -> str:
    """Coerce claimed polarity to one of {positive, negative, mixed}
    families. Stage 2 uses negative_weak / negative_strong; we
    collapse them for guardrail purposes."""
    p = (claimed or "").lower().strip()
    if p in ("positive", "pos", "긍정"):
        return "positive"
    if p in ("negative_weak", "negative_strong", "negative", "neg", "부정"):
        return "negative"
    if p in ("mixed", "혼합"):
        return "mixed"
    return "unknown"


# -----------------------------------------------------------------------------
# Public API
# -----------------------------------------------------------------------------


def check_polarity(text: str, claimed_polarity: str) -> PolarityCheck:
    """Classify (text, claimed_polarity) as suspect or clean.

    Conservative semantics:
      - `negative` claimed + at least one effective positive cue + zero
        effective negative cues → suspect (suggest positive).
      - `positive` claimed + at least one effective negative cue + zero
        effective positive cues → suspect (suggest negative).
      - Both sides have cues → not suspect, confidence=medium
        (text is genuinely mixed; respect Stage 2).
      - No decisive cues → not suspect, confidence=low (cannot
        judge — defer to Stage 2).
      - Concession structure present → confidence dropped one
        level; never raises is_suspect on its own.

    "Effective" cue = cue hit that is NOT followed by a post-
    negation marker within a 6-char window. So "만족스럽지 않"
    counts as a NEGATIVE cue path (positive cue cancelled by
    negation).
    """
    if not isinstance(text, str) or not text.strip():
        return PolarityCheck(
            is_suspect=False,
            claimed_polarity=claimed_polarity or "",
            suggested_polarity=None,
            confidence="low",
            reasons=("empty_text",),
        )

    family = _classify_polarity(claimed_polarity)

    pos_hits = _find_cue_hits(text, KO_POSITIVE_CUES)
    neg_hits = _find_cue_hits(text, KO_NEGATIVE_CUES)

    # Apply negation walker to positive cues — a negated positive
    # cue is effectively a negative-leaning context. We move it
    # into a derived "negated_positive" bucket rather than the
    # active negative bucket (cues are still asymmetric — the
    # speaker chose a positive word inside a denial; that's a
    # negative claim about a positive concept, not a fresh
    # negative sentiment).
    #
    # Three orthogonal cancellation paths:
    #   1. POST-negation: cue end + 8 chars contains "지 않" / "지는
    #      않" / "고 해야하나" etc. ("촉촉하다고 해야하나").
    #   2. PRE-diminisher: cue start preceded within 5 chars by
    #      "덜" / "별로" / "기대보다" / "생각보다" / "부족" etc.
    #      ("덜 촉촉").
    #   3. SENTENCE-level hedge: text contains an aggregate hedge
    #      pattern like "...라고 해야하나" or "아쉬웠" together with
    #      a positive cue → soft cancellation.
    effective_pos: list[tuple[str, int]] = []
    negated_positives: list[tuple[str, int]] = []
    text_has_hedge = _has_hedge_pattern(text)
    for cue, idx in pos_hits:
        post_negated = _is_negated_after(text, idx + len(cue))
        pre_diminished = _is_diminished_before(text, idx)
        if post_negated or pre_diminished:
            negated_positives.append((cue, idx))
            continue
        # Sentence-level hedge: only cancels positive cue when there's
        # also an explicit negative tone marker nearby (별로/아쉬/...).
        # This is the conservative path — without a negative tone,
        # hedges alone don't override Stage 2.
        if text_has_hedge:
            negated_positives.append((cue, idx))
            continue
        effective_pos.append((cue, idx))

    pos_count = len(effective_pos)
    neg_count = len(neg_hits)
    has_negated_pos = len(negated_positives) > 0
    concession = _has_concession(text)

    reasons: list[str] = []
    if effective_pos:
        reasons.append(f"pos_cues={[c for c, _ in effective_pos][:5]}")
    if neg_hits:
        reasons.append(f"neg_cues={[c for c, _ in neg_hits][:5]}")
    if negated_positives:
        reasons.append(
            f"negated_pos_cues={[c for c, _ in negated_positives][:5]}"
        )
    if concession:
        reasons.append("concession_marker")

    # No cues at all — defer to Stage 2.
    if pos_count == 0 and neg_count == 0 and not has_negated_pos:
        return PolarityCheck(
            is_suspect=False,
            claimed_polarity=claimed_polarity or "",
            suggested_polarity=None,
            confidence="low",
            reasons=tuple(reasons) or ("no_decisive_cues",),
        )

    # Both sides have cues — text is genuinely mixed; respect
    # Stage 2 (concession lowers confidence).
    if pos_count > 0 and neg_count > 0:
        confidence = "medium" if not concession else "low"
        return PolarityCheck(
            is_suspect=False,
            claimed_polarity=claimed_polarity or "",
            suggested_polarity=None,
            confidence=confidence,
            reasons=tuple(reasons + ["mixed_cues"]),
        )

    # Negated positive only (no other cues) — leans negative.
    # Stage 2 calling this `negative_*` is consistent.
    if pos_count == 0 and neg_count == 0 and has_negated_pos:
        if family == "positive":
            return PolarityCheck(
                is_suspect=True,
                claimed_polarity=claimed_polarity or "",
                suggested_polarity="negative_weak",
                confidence="medium",
                reasons=tuple(reasons + ["negated_positive_in_positive_claim"]),
            )
        return PolarityCheck(
            is_suspect=False,
            claimed_polarity=claimed_polarity or "",
            suggested_polarity=None,
            confidence="medium",
            reasons=tuple(reasons + ["negated_positive_consistent_with_neg"]),
        )

    # Only positive cues. negation/concession-aware confidence.
    if pos_count > 0 and neg_count == 0:
        if family == "negative":
            confidence = "high" if not concession else "medium"
            return PolarityCheck(
                is_suspect=True,
                claimed_polarity=claimed_polarity or "",
                suggested_polarity="positive",
                confidence=confidence,
                reasons=tuple(reasons + ["positive_cues_in_negative_claim"]),
            )
        return PolarityCheck(
            is_suspect=False,
            claimed_polarity=claimed_polarity or "",
            suggested_polarity=None,
            confidence="high",
            reasons=tuple(reasons + ["positive_cues_consistent_with_pos"]),
        )

    # Only negative cues.
    if neg_count > 0 and pos_count == 0:
        if family == "positive":
            confidence = "high" if not concession else "medium"
            return PolarityCheck(
                is_suspect=True,
                claimed_polarity=claimed_polarity or "",
                suggested_polarity="negative_weak",
                confidence=confidence,
                reasons=tuple(reasons + ["negative_cues_in_positive_claim"]),
            )
        return PolarityCheck(
            is_suspect=False,
            claimed_polarity=claimed_polarity or "",
            suggested_polarity=None,
            confidence="high",
            reasons=tuple(reasons + ["negative_cues_consistent_with_neg"]),
        )

    # Defensive default — should not reach.
    return PolarityCheck(
        is_suspect=False,
        claimed_polarity=claimed_polarity or "",
        suggested_polarity=None,
        confidence="low",
        reasons=tuple(reasons + ["defensive_default"]),
    )


# -----------------------------------------------------------------------------
# Audit aggregator
# -----------------------------------------------------------------------------


@dataclass
class PolarityAuditEntry:
    attribute_key: str
    review_id: str | None
    text: str
    claimed_polarity: str
    suggested_polarity: str | None
    confidence: str
    reasons: tuple[str, ...]


def build_audit_record(
    quotes_by_attribute: dict[str, list[dict]],
) -> dict:
    """Aggregate polarity verdicts across all attribute quotes.

    Input shape: `{attribute_key: [{text, polarity, review_id, …}]}`.
    Output: a JSON-serializable summary suitable for sidecar:

        {
          "summary": {"<attr>": {"n_total": …, "n_suspect": …}},
          "samples": [<at most 30 PolarityAuditEntry dicts>],
          "n_total_quotes": …,
          "n_total_suspect": …,
        }
    """
    summary: dict[str, dict] = {}
    samples: list[PolarityAuditEntry] = []
    n_total = 0
    n_total_suspect = 0

    for attr_key, quotes in (quotes_by_attribute or {}).items():
        if not isinstance(quotes, list):
            continue
        n_attr = 0
        n_attr_suspect = 0
        for q in quotes:
            if not isinstance(q, dict):
                continue
            text = q.get("text") or q.get("evidence_span") or ""
            claimed = q.get("polarity") or ""
            check = check_polarity(text, claimed)
            n_attr += 1
            n_total += 1
            if check.is_suspect:
                n_attr_suspect += 1
                n_total_suspect += 1
                if len(samples) < 30:
                    samples.append(
                        PolarityAuditEntry(
                            attribute_key=attr_key,
                            review_id=q.get("review_id"),
                            text=text[:200],
                            claimed_polarity=claimed,
                            suggested_polarity=check.suggested_polarity,
                            confidence=check.confidence,
                            reasons=check.reasons,
                        )
                    )
        summary[attr_key] = {
            "n_total": n_attr,
            "n_suspect": n_attr_suspect,
            "suspect_share": (
                round(n_attr_suspect / n_attr, 4) if n_attr else 0.0
            ),
        }

    return {
        "n_total_quotes": n_total,
        "n_total_suspect": n_total_suspect,
        "n_total_suspect_share": (
            round(n_total_suspect / n_total, 4) if n_total else 0.0
        ),
        "by_attribute": summary,
        "samples": [
            {
                "attribute_key": e.attribute_key,
                "review_id": e.review_id,
                "text": e.text,
                "claimed_polarity": e.claimed_polarity,
                "suggested_polarity": e.suggested_polarity,
                "confidence": e.confidence,
                "reasons": list(e.reasons),
            }
            for e in samples
        ],
    }


__all__ = [
    "PolarityCheck",
    "check_polarity",
    "build_audit_record",
    "KO_POSITIVE_CUES",
    "KO_NEGATIVE_CUES",
    "KO_CONCESSION_MARKERS",
]
