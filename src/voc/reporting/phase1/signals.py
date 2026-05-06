"""Rule-based signal layer for the Phase 1 mini-report.

Given a batch of review rows plus a curated lexicon, emit a ``SignalsBundle``
suitable for placing under ``Phase1Report.signals``. No LLM, no embeddings.
The detection is deterministic and reproducible from a frozen fixture.

Three mechanisms, all lightweight:
  1. Lexicon matching — substring-literal patterns, versioned as JSON under
     ``data/phase1_lexicons/`` so curators can tune without code changes.
  2. Gap rules — hardcoded cross-field checks that surface operational
     inconsistencies. PR5B ships ONE rule: ``api_repurchase_vs_text_mention``.
  3. Frequency discovery — intentionally NOT here. It lives outside the
     pipeline as a separate curation script so the main report stays stable.

Determinism guarantees:
  - A review matching multiple patterns within the SAME lexicon entry counts
    as 1 evidence (dedup within entry).
  - ``sample_review_ids`` is the first ≤3 ids, sorted ascending.
  - Entries below their ``min_doc_freq`` are dropped from output entirely
    (not returned with evidence_count=0).
  - Output list order mirrors the lexicon JSON entry order so operators can
    predict where a signal will appear in the report.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

from pydantic import BaseModel, Field

from src.voc.reporting.phase1.schema import (
    SignalCandidate,
    SignalCategory,
    SignalsBundle,
)

Row = dict[str, Any]

# Bundled default lexicons. Callers can override via ``load_lexicons(...)``.
_DEFAULT_POSITIVE = Path("data/phase1_lexicons/positive.json")
_DEFAULT_CAUTIONARY = Path("data/phase1_lexicons/cautionary.json")

# The gap rules below watch for these phrasings. Kept in code (not in the
# lexicon files) because a rule is the operator-facing interpretation of a
# match, not the matching itself — swapping patterns is a code review, not
# a curator task.
_REPURCHASE_TEXT_PATTERNS: tuple[str, ...] = (
    "재구매", "계속 사", "3개째", "또 사", "쟁이",
)

# Negation filter — optional, signal-scoped.
#
# Some patterns are intrinsically positive keywords (e.g., "촉촉" for
# moist_finish, "발림성" for good_applicability, "재구매" for the OY
# repurchase-gap rule). Substring matching alone can't distinguish
#   [fires correctly]  "촉촉하고 발색도 이뻐요"
# from
#   [should suppress]  "촉촉한 것도 아니고 그냥 무난"
#   [should suppress]  "재구매는 안 할 것 같은데"
# because all four contain the target keyword.
#
# Rule: for signals in `_NEGATION_FILTERED_SIGNALS`, a pattern match is
# suppressed when any Korean negation particle appears within a small
# window around the match position. Conservative by design — catches the
# clearest cases (안 / 않 / 못 / 없 / 아니 / 모르), misses colloquial
# negations ("영…", "개별로", "~만 왔어요") that would need context-aware
# disambiguation.
#
# Opt-in only: `no_base_crumbling` patterns (e.g., "베이스 까짐없", "안
# 까지") are themselves negation constructs; filtering them would gut the
# signal. Not included.
_NEGATION_FILTERED_SIGNALS: frozenset[str] = frozenset({
    "moist_finish",
    "good_applicability",
    "persistence_reservation",
    # NOTE: api_repurchase_vs_text_mention is handled separately in
    # _detect_gaps since it's not a lexicon entry.
})

_NEGATION_PARTICLES: tuple[str, ...] = (
    "안 ",   # trailing space avoids matching "안녕", "안썼" etc.
    "않",    # "않고", "지 않"
    "못 ",   # "못 써요"
    "아니",  # "것도 아니고"
    "모르",  # "모르겠음", "모르겠네요"
    # "없" removed: in cosmetics-review Korean it frequently appears in
    # POSITIVE compound expressions ("까짐없고", "자극 없어요", "뜸 없음")
    # where it negates a negative to yield a positive claim. Keeping it in
    # the particle list false-suppresses legitimate positive-signal fires
    # on reviews that combine a positive-by-negation phrase with a
    # positive keyword (e.g., "베이스까짐없고 촉촉하고"). The observed FP
    # cases from the validation audit (docs/performance_validation_v1.md)
    # all relied on other particles (아니 / 모르 / 안).
)
# Windows are asymmetric by design. Korean negation of a keyword most
# often appears AFTER the keyword as a sentence-mid or sentence-final
# particle ("촉촉한 것도 아니고", "재구매는 안 할", "발림성이 영 별로").
# Pre-window is deliberately tight (~1 word) to catch the narrow "안
# 촉촉" case without bleeding across clauses — a larger pre-window picks
# up the negation from an earlier clause when the same keyword appears
# again later in a positive framing ("촉촉한 것도 아니지만 실은 촉촉하고").
_NEGATION_PRE_WINDOW = 3    # chars before pattern start — 1 particle
_NEGATION_POST_WINDOW = 20  # chars after pattern end


def _is_negated_at(text: str, pos: int, pattern_len: int) -> bool:
    """True iff any negation particle appears within the pre/post window
    around the pattern-match position."""
    before = text[max(0, pos - _NEGATION_PRE_WINDOW):pos]
    after = text[pos + pattern_len:pos + pattern_len + _NEGATION_POST_WINDOW]
    window = before + after
    return any(particle in window for particle in _NEGATION_PARTICLES)


def _pattern_present_unnegated(
    text: str, pattern: str, apply_filter: bool,
) -> bool:
    """Core pattern-match predicate. When ``apply_filter`` is False
    (default for most signals), behaves as ``pattern in text`` and returns
    on first hit. When True, iterates all occurrences and returns True
    only if at least one is outside a negation window — i.e., a single
    non-negated mention of the keyword suffices to fire the signal.
    """
    if not pattern or pattern not in text:
        return False
    if not apply_filter:
        return True
    idx = 0
    plen = len(pattern)
    while True:
        pos = text.find(pattern, idx)
        if pos < 0:
            return False
        if not _is_negated_at(text, pos, plen):
            return True
        idx = pos + 1

# Coupang-scoped authenticity concern. Unlike most signals (min_doc_freq=2
# to avoid single-anecdote noise), this rule fires at ANY occurrence because
# third-party seller counterfeit risk is a critical operational class — one
# credible report already warrants operator attention, and suppressing it
# behind a ≥2-row threshold would silently hide the highest-severity signal
# this pipeline can surface.
_AUTHENTICITY_TEXT_PATTERNS: tuple[str, ...] = (
    "가품", "짝퉁", "짭퉁", "정품이 아닌", "정품 아닌", "색도 다르",
)

# Channel-agnostic skin-irritation safety signal. Same threshold=1 rationale
# as authenticity: safety class, one credible complaint warrants operator
# review. Patterns are mostly conjunctive (가렵+따갑) rather than
# single-word, because every single-word irritation vocabulary (가렵, 따갑,
# 알러지, 두드러기, 발진, 피부 트러블, 자극적이, 피부 자극, 피부가 붉어) appears
# more often in 5★ NEGATION constructs ("자극 없어요", "알러지 반응 없음",
# "피부 트러블 없어요") than in genuine complaints on the current corpus. A
# reviewer conjoining itching AND stinging is a reliable irritation signal.
#
# Exception (v1.12): "피부가 올라" is a specific-phrase irritation marker
# ("breakouts / skin flares up after use") that polarity-tested cleanly
# on the 1224-row corpus (1 × ≤3★ hit, 0 × ≥4★ FPs). "피부톤이 올라" is a
# distinct positive phrase; substring match of "피부가 올라" requires the
# 가 particle and does not collide with it. See docs/phase2_coverage_audit.md
# §F event #23.
_SKIN_IRRITATION_TEXT_PATTERNS: tuple[str, ...] = (
    # Korean `가렵다` is a ㅂ-irregular — declarative form "가렵-" and
    # conjugated form "가려-" both need coverage in conjunctive patterns.
    "가렵고 따갑", "따갑고 가렵", "따갑고 가려", "이상하게 가렵",
    # Non-conjunctive specific-phrase exception:
    "피부가 올라",
)


# ---------------------------------------------------------------------------
# Lexicon types and loading
# ---------------------------------------------------------------------------


class LexiconEntry(BaseModel):
    id: str
    display_label: str
    patterns: list[str]
    min_doc_freq: int = 2
    # Base+extensions scoping. Default ["*"] = universal (matches all rows
    # regardless of product category). An explicit list like ["blush"] or
    # ["blush", "eyeshadow"] scopes the entry to those categories only.
    # Rows whose product has no known category never match a non-universal
    # entry — strict semantics, safer for cross-category contamination.
    # See docs/csv_upload.md / later category-probe notes for curation
    # guidelines.
    categories: list[str] = Field(default_factory=lambda: ["*"])


class LexiconFile(BaseModel):
    version: str
    entries: list[LexiconEntry]


class Lexicons(BaseModel):
    """Curated lexicons for a signal-detection pass.

    ``version`` is a composite of the two files' versions so provenance can
    reference a single string.
    """

    version: str
    positive: list[LexiconEntry] = Field(default_factory=list)
    cautionary: list[LexiconEntry] = Field(default_factory=list)


def load_lexicons(
    positive_path: Path | str | None = None,
    cautionary_path: Path | str | None = None,
) -> Lexicons:
    """Load lexicon files from disk. Absent files are treated as empty."""
    pos = _load_file(Path(positive_path) if positive_path else _DEFAULT_POSITIVE)
    cau = _load_file(Path(cautionary_path) if cautionary_path else _DEFAULT_CAUTIONARY)
    return Lexicons(
        version=f"positive={pos.version};cautionary={cau.version}",
        positive=pos.entries,
        cautionary=cau.entries,
    )


def _load_file(path: Path) -> LexiconFile:
    if not path.is_file():
        return LexiconFile(version="0.0", entries=[])
    return LexiconFile.model_validate_json(path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------


def detect_signals(
    rows: Iterable[Row],
    lexicons: Lexicons,
    *,
    product_categories: dict[str, str] | None = None,
) -> SignalsBundle:
    bundle, _ = detect_signals_with_membership(
        rows, lexicons, product_categories=product_categories,
    )
    return bundle


def detect_signals_with_membership(
    rows: Iterable[Row],
    lexicons: Lexicons,
    *,
    product_categories: dict[str, str] | None = None,
) -> tuple[SignalsBundle, dict[str, set[str]]]:
    """Same detection as ``detect_signals`` but also returns the full
    ``{signal_name: {review_id, ...}}`` membership map — not capped at the
    3-id ``sample_review_ids`` limit.

    Used by the signal-quality eval (``src/voc/reporting/phase1/eval.py``)
    where precision/recall math needs every hit, not just samples. The
    ``SignalsBundle`` output is identical to what ``detect_signals`` returns,
    so callers can use either function interchangeably when membership is
    not needed.

    ``product_categories`` is an optional ``{product_external_id: category}``
    map. When omitted (default None), category scoping is disabled — every
    lexicon entry is matched against every row regardless of its
    ``categories`` field. This preserves current behavior for any caller
    that doesn't know about categories. When provided, an entry with
    non-universal ``categories`` only matches rows whose product falls in
    that scope (strict; see ``_row_in_entry_scope``).
    """
    rows = list(rows)
    total = len(rows)

    pos_cands, pos_mem = _match_entries(
        rows, lexicons.positive, "positive", total,
        product_categories=product_categories,
    )
    cau_cands, cau_mem = _match_entries(
        rows, lexicons.cautionary, "cautionary", total,
        product_categories=product_categories,
    )
    gap_cands, gap_mem = _detect_gaps(rows, total)

    bundle = SignalsBundle(
        positive=pos_cands, cautionary=cau_cands, gaps=gap_cands,
    )
    membership: dict[str, set[str]] = {}
    membership.update(pos_mem)
    membership.update(cau_mem)
    membership.update(gap_mem)
    return bundle, membership


def _row_in_entry_scope(
    row: Row,
    entry: LexiconEntry,
    product_categories: dict[str, str] | None,
) -> bool:
    """Apply base+extensions scoping. Returns True when the row should be
    considered for this entry.

    Semantics:
      - ``product_categories is None`` (no scoping info at all): permissive —
        match any row against any entry. Preserves behavior for callers that
        don't use categories.
      - Entry has ``"*"`` in ``categories``: universal — match any row.
      - Entry is scoped (e.g. ``["blush"]``) AND scoping is active:
        strict — the row's product must be in ``product_categories`` AND its
        mapped category must be in the entry's ``categories`` list.
    """
    if "*" in entry.categories:
        return True
    if product_categories is None:
        return True
    pid = row.get("product_external_id")
    if pid is None:
        return False
    row_cat = product_categories.get(str(pid))
    if row_cat is None:
        return False
    return row_cat in entry.categories


def _match_entries(
    rows: list[Row],
    entries: list[LexiconEntry],
    category: SignalCategory,
    total: int,
    *,
    product_categories: dict[str, str] | None = None,
) -> tuple[list[SignalCandidate], dict[str, set[str]]]:
    """Returns (emitted_candidates, {signal_name: full hit-id set}).

    Base+extensions grouping: multiple entries MAY share the same ``id``
    (typically a base universal entry + one or more category-scoped
    extension entries). All entries with the same id contribute hits to a
    single ``SignalCandidate``; hit_ids are deduped across entries via the
    ``_make_candidate`` helper. ``display_label`` and ``min_doc_freq`` are
    taken from the first-seen entry for that id (curator discipline keeps
    these consistent across entries; a divergence isn't validated).

    Membership is only recorded for signals that passed the ``min_doc_freq``
    threshold and were actually emitted. A sub-threshold match contributes
    nothing to either the bundle or the membership dict.

    Ordering: candidates are emitted in first-seen-id order, matching the
    lexicon file's entry order so operators can predict where a signal
    appears in the report.
    """
    # Group entries by signal_id, preserving first-seen order.
    by_id: dict[str, dict] = {}
    order: list[str] = []
    for entry in entries:
        sig_id = entry.id
        if sig_id not in by_id:
            by_id[sig_id] = {
                "display_label": entry.display_label,
                "min_doc_freq": entry.min_doc_freq,
                "hit_ids": [],
            }
            order.append(sig_id)
        bucket = by_id[sig_id]
        negation_filter = sig_id in _NEGATION_FILTERED_SIGNALS
        for r in rows:
            if not _row_in_entry_scope(r, entry, product_categories):
                continue
            text = r.get("text") or ""
            if any(
                _pattern_present_unnegated(text, p, negation_filter)
                for p in entry.patterns
            ):
                rid = r.get("review_id")
                if rid:
                    bucket["hit_ids"].append(str(rid))

    out: list[SignalCandidate] = []
    membership: dict[str, set[str]] = {}
    for sig_id in order:
        bucket = by_id[sig_id]
        unique_ids = set(bucket["hit_ids"])
        if len(unique_ids) < bucket["min_doc_freq"]:
            continue
        out.append(_make_candidate(
            name=sig_id,
            display_label=bucket["display_label"],
            category=category,
            hit_ids=bucket["hit_ids"],  # _make_candidate dedups + sorts
            total=total,
        ))
        membership[sig_id] = unique_ids
    return out, membership


def _detect_gaps(
    rows: list[Row], total: int,
) -> tuple[list[SignalCandidate], dict[str, set[str]]]:
    """Operational gap rules. Each is channel-scoped or channel-agnostic,
    hardcoded (not curator-owned), and returns at most one ``SignalCandidate``.

    Today we ship:

    1. ``api_repurchase_vs_text_mention`` (OliveYoung-only, threshold 2) —
       rows whose ``oy_is_repurchase`` flag is False but whose text mentions
       repurchase. Signals data-capture / UX disagreement.

    2. ``coupang_authenticity_concern`` (Coupang-only, threshold 1) — rows
       whose text mentions counterfeit / not-genuine phrasings. Threshold 1
       because third-party seller authenticity risk is a high-severity
       operational signal class; one credible mention warrants surfacing.

    3. ``skin_irritation_concern`` (channel-agnostic, threshold 1) — rows
       whose text describes allergic / irritation reactions using
       conjunctive patterns (가렵+따갑). Threshold 1 because skin safety is
       a high-severity class; patterns are conjunctive to avoid firing on
       negation-heavy positive reviews ("자극 없어요", "알러지 반응 없음").
    """
    out: list[SignalCandidate] = []
    membership: dict[str, set[str]] = {}

    # 1) OY repurchase flag vs text. Negation filter applied because
    # repurchase keywords can appear inside explicit non-repurchase
    # statements ("재구매는 안 할 것 같은데") which are the opposite of
    # the signal's intent.
    hit_ids: list[str] = []
    for r in rows:
        if r.get("source_channel") != "oliveyoung":
            continue
        flag = ((r.get("raw_metadata") or {}).get("oy_is_repurchase"))
        if flag is not False:
            continue
        text = r.get("text") or ""
        if any(
            _pattern_present_unnegated(text, p, apply_filter=True)
            for p in _REPURCHASE_TEXT_PATTERNS
        ):
            rid = r.get("review_id")
            if rid:
                hit_ids.append(str(rid))
    if len(hit_ids) >= 2:
        out.append(_make_candidate(
            name="api_repurchase_vs_text_mention",
            display_label="재구매 API 플래그와 본문 신호 불일치",
            category="gap",
            hit_ids=hit_ids,
            total=total,
        ))
        membership["api_repurchase_vs_text_mention"] = set(hit_ids)

    # 2) Coupang authenticity concern
    hit_ids = []
    for r in rows:
        if r.get("source_channel") != "coupang":
            continue
        text = r.get("text") or ""
        if any(p in text for p in _AUTHENTICITY_TEXT_PATTERNS):
            rid = r.get("review_id")
            if rid:
                hit_ids.append(str(rid))
    if len(hit_ids) >= 1:
        out.append(_make_candidate(
            name="coupang_authenticity_concern",
            display_label="정품·가품 의심 언급 (고위험 운영 신호)",
            category="gap",
            hit_ids=hit_ids,
            total=total,
        ))
        membership["coupang_authenticity_concern"] = set(hit_ids)

    # 3) Channel-agnostic skin-irritation safety concern
    hit_ids = []
    for r in rows:
        text = r.get("text") or ""
        if any(p in text for p in _SKIN_IRRITATION_TEXT_PATTERNS):
            rid = r.get("review_id")
            if rid:
                hit_ids.append(str(rid))
    if len(hit_ids) >= 1:
        out.append(_make_candidate(
            name="skin_irritation_concern",
            display_label="피부 자극·알러지 우려 (고위험 안전 신호)",
            category="gap",
            hit_ids=hit_ids,
            total=total,
        ))
        membership["skin_irritation_concern"] = set(hit_ids)

    return out, membership


def _make_candidate(
    *,
    name: str,
    display_label: str,
    category: SignalCategory,
    hit_ids: list[str],
    total: int,
) -> SignalCandidate:
    uniq = sorted(set(hit_ids))
    return SignalCandidate(
        name=name,
        display_label=display_label,
        category=category,
        evidence_count=len(uniq),
        coverage_ratio=round(len(uniq) / total, 4) if total else 0.0,
        sample_review_ids=uniq[:3],
    )


# ---------------------------------------------------------------------------
# JSON convenience (not used by detect_signals itself; helpful for CLI)
# ---------------------------------------------------------------------------


def dump_lexicon_json(entries: list[LexiconEntry]) -> str:
    """Round-trip helper for curator tooling."""
    return json.dumps(
        [e.model_dump() for e in entries],
        ensure_ascii=False,
        indent=2,
    )
