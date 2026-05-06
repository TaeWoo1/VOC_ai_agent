"""Adapter: Phase 2E `ProductReportData` → v3.0 `analysis_report.json`.

The seller-side Phase 2E pipeline aggregates reviews into a
`ProductReportData` dataclass and feeds that directly to PDF
rendering. The content engine (Phase A–D) consumes the v3.0
`analysis_report.json` schema instead. This adapter is the bridge.

Mapping summary
---------------
- `corpus`                ← derived from `data.n_reviews`; corpus
                            confidence rubric is size-based.
- `attributes[]`          ← one per `attribute_summaries` entry;
                            `label_ko` is the Korean part of
                            `ATTRIBUTE_LABELS_KO` with the English
                            gloss stripped (the brief and cardnews
                            already strip parens, but emitting the
                            short label here keeps every downstream
                            surface aligned).
- `strengths[]`           ← attributes where `n_positive > n_negative`
                            and `n_positive ≥ 5`, sorted DESC.
- `monitoring_candidates[]` ← attributes where `n_negative ≥ 5`,
                            sorted DESC.
- `tradeoffs[]`           ← top entries from `data.tradeoff_pairs`.
- `usage_patterns[]`      ← cross-attribute contradictions
                            synthesized from per-attribute
                            polarity counts (≥5 on each side).
- `quick_decision`        ← verdict + `who_for_ko` / `who_not_for_ko`
                            derived from top strengths + monitoring.
- `buyer_segments[]`      ← **empty**. Phase 2E lacks native segment
                            detection; the adapter does not invent
                            data. The cardnews `slide_fit` builder
                            falls back to `quick_decision.who_for_ko`
                            (or `brief.best_for`) when this is empty.
- `theme_contrasts[]`     ← empty (Phase 2E doesn't compute these).
- `trend`                 ← null (no snapshot comparison wired in).
- `methodology_notes`     ← locked default.

Hard rules
----------
- No analysis logic changes. The adapter is read-only over PRD.
- No DB writes, no network, no LLM.
- Output passes the JSON schema at
  `src/voc/content/schemas/analysis_report.schema.json`.
- The brief generator + cardnews generator must build successfully
  from the adapter's output for at least the bullet-floor on slides
  1, 2, 3, 5, 6, 7. Slide 4 (fit) requires a separate cardnews
  fallback (Phase D2 small patch).
"""
from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from typing import Any, Iterable

# ProductReportData lives under the protected reporting/phase2e/ tree.
# We import it READ-ONLY for type hints and field access. No protected
# field is mutated here.
from src.voc.reporting.phase2e.report import (
    ATTRIBUTE_LABELS_KO,
    AttributeSummary,
    ProductReportData,
)
from src.voc.content.editorial_rules import (
    build_contrast_verdict as _scamper_contrast_verdict,
    build_hesitation_lines as _scamper_hesitation_lines,
    display_label_for as _scamper_display_label,
    interview_hook_for as _scamper_interview_hook_for,
    select_best_quote as _scamper_select_best_quote,
)
# P0 reliability layer — added 2026-05-01. Both modules are pure
# (no I/O, no LLM, no DB) and live under reporting/phase2e/ so
# they're co-located with the data they guard.
from src.voc.reporting.phase2e.polarity_guardrail import (
    check_polarity as _check_polarity,
    build_audit_record as _build_polarity_audit,
)
from src.voc.reporting.phase2e.quote_display import (
    normalize_for_display as _quote_display_text,
    synthesize_phrase_display as _quote_paraphrase,
    synthesize_quote_summary_for_report as _quote_pdf_summary,
)
# Defensive normalization for raw breadcrumb strings that some
# legacy callers still pass in. Detection / scrape paths already
# normalize at capture time; this is the editorial guarantee.
from src.voc.connectors.oliveyoung_browser_api import (
    parse_breadcrumb_text as _parse_breadcrumb_text,
)


ANALYSIS_REPORT_SCHEMA_VERSION = "3.0"

# Minimum counts (mirrored from cardnews/brief). Restated rather
# than imported to keep the adapter independent of phase D layout.
STRENGTH_MIN_POSITIVE: int = 5
MONITORING_MIN_NEGATIVE: int = 5
CONTRADICTION_MIN_PER_SIDE: int = 5

# Per-attribute quote caps. The Phase 2E aggregator (`aggregate_product`)
# stores up to 5 positive + 5 negative `sample_evidences_*` per
# attribute. We surface up to MAX_QUOTES_PER_SIDE on each polarity
# side so the candidate pool's `bounded_review_excerpts` is densely
# populated for downstream substring anchoring.
MAX_QUOTES_PER_SIDE: int = 5
MAX_QUOTES_MONITORING: int = 5

# Bound a single quote's text. Reviewers occasionally write very
# long single-sentence reviews; truncate excerpts to keep
# `bounded_review_excerpts` cumulative size under the LLM's prompt
# budget. Truncation is at the right boundary (most-recent text
# loses) — operators using these excerpts for audit can re-fetch
# the source review by `review_id`.
MAX_QUOTE_CHARS: int = 200

# Corpus confidence rubric (size-based). Mirrors Phase 2E's
# snapshot rubric in spirit — large corpora get `high`, small
# corpora `low`.
_CORPUS_CONFIDENCE_HIGH_MIN: int = 1000
_CORPUS_CONFIDENCE_MEDIUM_MIN: int = 300

# Default methodology disclosure used when callers don't override.
# Operator-facing language; matches the seller PDF's interpretation
# note. Carefully avoids tokens on the medical ban list (효능 / 효과)
# while still satisfying the cardnews `disclosure_keyword_preservation`
# rule (must contain one of `리뷰` / `정리` / `효능 보장하지 않`).
_DEFAULT_DISCLOSURE_KO = (
    "공개 리뷰 데이터를 정리한 정보이며, "
    "제품 성능을 보장하지 않고 결함을 단정하지 않습니다."
)

# Strategy-aware disclosure for the merged-multi-sort corpus.
# Makes the bias profile explicit: this corpus is what a consumer can
# *observe* by switching sort tabs, NOT a random sample of all reviews.
# Designed for issue / strength discovery, not distribution estimation.
# Note on banned tokens: avoid `절대` (substring of `절대값`) and
# `해야 합니다` / `해야 함` — both trip the cardnews directive ban
# list. Use `수치 추정` and passive `…용도로 설계되었습니다` instead.
_OBSERVABLE_MULTI_SORT_DISCLOSURE_KO = (
    "여러 정렬(최신순·평점순·도움순 등)을 통해 소비자가 실제로 접하는 "
    "리뷰들을 정리한 자료입니다. 무작위 표본이 아니므로 평점·감성 분포의 "
    "수치 추정에는 적합하지 않으며, 반복적으로 등장하는 강점·단점·"
    "트레이드오프를 식별하는 용도로 설계되었습니다."
)

# Default sample caveat.
_DEFAULT_SAMPLE_CAVEATS_KO: tuple[str, ...] = (
    "리뷰 표본은 자발적 작성자에 편향될 수 있습니다.",
)

# Strategy-specific caveats: surfaced in addition to the default
# voluntary-author bias note.
_OBSERVABLE_MULTI_SORT_SAMPLE_CAVEATS_KO: tuple[str, ...] = (
    "여러 정렬축(최신순·평점 낮은순·평점 높은순·유용한 순·도움순)에서 "
    "수집한 리뷰를 review_id 기준으로 합집합 후 중복 제거한 자료입니다.",
    "정렬축마다 상위 노출 리뷰가 다르기 때문에 평점·감성 분포의 수치 "
    "추정에는 부적합하며, 반복 관찰되는 신호 발견 용도로 해석합니다.",
)

# Locked tradeoff key parser — mirrors `phase2e.usage_patterns`
# format `attr_a:polarity_a -> attr_b:polarity_b`.
_TRADEOFF_KEY_RE = re.compile(
    r"^([a-z_]+):[a-z_]+\s*->\s*([a-z_]+):[a-z_]+$"
)


# Tradeoff pair-key parser. Same regex shape as the candidate-pool
# builder so an attribute that appears on either side of an arrow
# (e.g. "pigmentation:positive -> dryness_skin_texture:negative") is
# correctly suppressed when its key is in `suppress_attributes`.
_TRADEOFF_PAIR_KEY_RE = re.compile(
    r"^([a-z_]+):[a-z_]+\s*->\s*([a-z_]+):[a-z_]+$"
)


def _pair_touches_suppressed(
    pair_key: str, suppressed: frozenset[str] | set[str],
) -> bool:
    """True when either side of a tradeoff pair_key references a
    suppressed attribute. Malformed keys are conservatively kept
    (returned False) — defensive default since the seller PDF
    already rejects them downstream."""
    if not suppressed:
        return False
    m = _TRADEOFF_PAIR_KEY_RE.match(pair_key)
    if not m:
        return False
    return m.group(1) in suppressed or m.group(2) in suppressed


def _short_label_ko(
    attribute_key: str,
    *,
    profile_id: str | None = None,
) -> str:
    """Map an attribute key to its short Korean label, stripping the
    English gloss in parentheses. Falls back to the key itself when
    the attribute is unknown.

    `profile_id` consults `editorial_rules.LABEL_OVERRIDES_BY_PROFILE`
    first — for `skincare_pad`, makeup-leaning labels like
    "베이스 상호작용" are replaced with skincare-coded equivalents
    ("패드 밀착력"). The canonical attribute key is NEVER renamed."""
    full = ATTRIBUTE_LABELS_KO.get(attribute_key, attribute_key)
    short = full.split("(")[0].strip()
    return _scamper_display_label(
        attribute_key, profile_id=profile_id, fallback=short,
    )


# ---------------------------------------------------------------------------
# Attribute-fit guardrail (report-layer only).
#
# Stage 1 detects which attributes a sentence mentions; Stage 2 judges
# the polarity of each (attribute, span) pair. Both are protected per
# CLAUDE.md §6, so this layer cannot relabel the underlying attribute.
#
# But the seller PDF surfaces a representative quote per attribute.
# When the detector grouped a quote under attribute X, but the visible
# text reads as if the user is talking about something else (amount /
# price / efficacy), the quote contaminates the representative card.
#
# Rule shape: per-attribute, list off-topic CUES (lexical signals that
# strongly indicate a different attribute is the topic). When all cues
# are off-topic and the on-topic terms are absent, emit an
# `attribute_fit_warning` flag. The flag does NOT alter the underlying
# evidence — adapters that surface "representative" quotes (strengths,
# monitoring_candidates) should prefer non-flagged quotes when
# available.
#
# Conservative on purpose. False negatives are fine; false positives
# (suppressing on-topic evidence) are the failure mode we guard against.
# ---------------------------------------------------------------------------

# Regex flag string per attribute. The first entry of each tuple is
# the off-topic CUE pattern (the quote really talks about something
# else), the second is the ON-topic ANCHOR pattern that, when
# present, defuses the warning. The cue→anchor pairing prevents the
# rule from suppressing legit mentions like "건조해서 양이 부족"
# (genuine dryness complaint with an amount aside).
_ATTRIBUTE_FIT_RULES: dict[str, list[tuple[str, str | None, str]]] = {
    # 건조감/당김 — quotes about pore efficacy, amount, or price are
    # off-topic. Anchor terms: 건조|촉촉|수분|당김.
    "dryness_skin_texture": [
        ("모공", r"건조|촉촉|수분|당김|수분감|보습", "off_topic_pore_efficacy"),
        (r"양이\s*(거의\s*)?없|양이\s*적|용량이\s*적",
         r"건조|촉촉|수분|당김|수분감|보습",
         "off_topic_amount"),
        (r"가격|비싸|가성비",
         r"건조|촉촉|수분|당김|수분감|보습",
         "off_topic_price"),
        (r"효과(는)?\s*(못|없|모르)",
         r"건조|촉촉|수분|당김|수분감|보습",
         "off_topic_efficacy_doubt"),
    ],
}


def _attribute_fit_warning(attribute_key: str, text: str) -> str | None:
    """Return a string warning code when the quote text reads as
    off-topic for `attribute_key`, else None.

    Conservative: each rule needs (a) an off-topic cue match AND
    (b) the on-topic anchor missing. When the anchor is also present,
    we trust Stage 1's grouping. Pattern matching is case-insensitive
    on the source text — the spans are already NFC-normalized upstream.
    """
    if not text or not attribute_key:
        return None
    rules = _ATTRIBUTE_FIT_RULES.get(attribute_key)
    if not rules:
        return None
    for cue_pattern, anchor_pattern, code in rules:
        if not re.search(cue_pattern, text):
            continue
        if anchor_pattern and re.search(anchor_pattern, text):
            continue
        return code
    return None


def _resolve_corpus_confidence(n_reviews: int) -> str:
    """Size-based corpus confidence. Same rubric flows into
    signal_stability — Phase 2E doesn't differentiate sampling
    method here."""
    if n_reviews >= _CORPUS_CONFIDENCE_HIGH_MIN:
        return "high"
    if n_reviews >= _CORPUS_CONFIDENCE_MEDIUM_MIN:
        return "medium"
    return "low"


def _evidence_score(summary: AttributeSummary) -> float:
    """Decorative evidence score. Brief and cardnews don't strictly
    consume it, but the schema lists it. Use a log-scaled count
    so big-attribute / small-attribute differences are legible."""
    total = (summary.n_positive or 0) + (summary.n_negative or 0)
    if total <= 0:
        return 0.0
    return round(math.log1p(total), 4)


def _polarity_share(summary: AttributeSummary) -> dict:
    """Per-attribute polarity share. Adds to roughly 1 when there
    are records; emits 0/0/0 when empty."""
    pos = summary.n_positive or 0
    neg = summary.n_negative or 0
    mix = summary.n_mixed or 0
    total = pos + neg + mix
    if total <= 0:
        return {"positive": 0.0, "negative": 0.0, "mixed": 0.0}
    return {
        "positive": round(pos / total, 4),
        "negative": round(neg / total, 4),
        "mixed": round(mix / total, 4),
    }


def _quote_from_evidence(
    ev: dict | None,
    *,
    attribute_key: str | None = None,
    profile_id: str | None = None,
) -> dict | None:
    """Convert a Phase 2E sample-evidence dict to a v3.0 quote dict.

    Field-name resolution order for the verbatim text:
      1. `evidence_span` — the canonical Phase 2E aggregator field
         (set in `aggregate_product` from `Stage 2 record.evidence_span`).
      2. `text`          — what the v3.0 schema calls it; accepted
         for forward-compat and test fixtures that already use
         schema-shaped dicts.
      3. `evidence_text` — legacy field name; tolerated.

    The text is NFC-stripped and capped at `MAX_QUOTE_CHARS` so a
    single very long review doesn't blow the bounded-excerpt
    budget downstream.

    Output keys:
      - `text`         : raw verbatim span (preserves
                         `EvidenceUnit.text == parent.text[start:end]`).
      - `display_text` : human-readable copy (sentence-snapped,
                         length-capped). PDF/cardnews surfaces
                         prefer this; audit tooling reads `text`.
      - `polarity_suspect` : True when the post-Stage-2 guardrail
                         judges the (text, polarity) pair as a
                         reliability risk. Advisory; never auto-flips.
      - `polarity_check`   : guardrail diagnostic dict (reasons +
                         suggested polarity).

    `review_id`, `char_start`, `char_end`, `polarity`, `rating`
    pass through when present.
    """
    if not isinstance(ev, dict):
        return None
    text = (
        ev.get("evidence_span")
        or ev.get("text")
        or ev.get("evidence_text")
        or ""
    ).strip()
    if not text:
        return None
    if len(text) > MAX_QUOTE_CHARS:
        text = text[:MAX_QUOTE_CHARS].rstrip()
    out: dict = {"text": text}
    for k_in, k_out in (
        ("review_id", "review_id"),
        ("char_start", "char_start"),
        ("char_end", "char_end"),
        ("polarity", "polarity"),
        ("rating", "rating"),
    ):
        if (v := ev.get(k_in)) is not None:
            out[k_out] = v

    # P0 reliability — display_text + polarity guardrail. Both are
    # additive: never mutate `text` or `polarity`; raw span invariant
    # is preserved for audit.
    #
    # display_text resolution:
    #   1. Run the cleaning pipeline (`normalize_for_display`).
    #   2. If the cleaned span is fragmented / colloquial / cut-off,
    #      synthesize a "...라는 의견" / "...만족 의견" wrap so the
    #      seller PDF and cardnews don't surface dangling stems.
    #   3. Otherwise the cleaned span IS the display_text.
    # The synthesizer takes the polarity hint so the suffix matches
    # Stage 2's verdict ("만족 의견" vs "아쉬움 의견").
    claimed = ev.get("polarity") or out.get("polarity") or ""
    out["display_text"] = _quote_paraphrase(text, polarity=claimed)
    # PDF-only summary: avoids the "...아쉬움 의견" / "...만족 의견"
    # duplication that reads as awkward in a business report. Cardnews
    # surfaces continue to use `display_text` (warmer, buyer-friendly).
    raw_summary = _quote_pdf_summary(text, polarity=claimed)
    # Pass-17: every analysis_report.json `display_quote_summary` is
    # passed through the shared normalizer so degraded values
    # (truncated / dangling / generic) never reach disk. The
    # downstream consumer (PDF appendix, cardnews, inspector) can
    # trust this field without a fallback chain. The raw `text`
    # field is preserved verbatim for audit.
    from src.voc.content.quote_summary_normalizer import (
        normalize_display_quote_summary,
    )
    out["display_quote_summary"] = normalize_display_quote_summary(
        raw_summary,
        attribute_key=attribute_key or "",
        polarity=claimed,
        profile_id=profile_id,
    )
    if claimed:
        check = _check_polarity(text, claimed)
        if check.is_suspect:
            out["polarity_suspect"] = True
            out["polarity_check"] = check.to_dict()
    # Report-layer attribute-fit warning. Advisory; the underlying
    # Stage 1 grouping is unchanged. Representative-quote selectors
    # (strengths, monitoring_candidates) prefer unflagged quotes so
    # poor matches don't surface in PDF / cardnews even though the
    # raw span stays in `attributes[].top_quotes` for audit.
    if attribute_key:
        warning = _attribute_fit_warning(attribute_key, text)
        if warning:
            out["attribute_fit_warning"] = warning
    return out


def _attributes_block(
    summaries: dict[str, AttributeSummary],
    *,
    profile_id: str | None = None,
) -> list[dict]:
    out: list[dict] = []
    # Sort by attribute key for deterministic output.
    for key in sorted(summaries.keys()):
        s = summaries[key]
        if not s.attribute and not key:
            continue
        attr_key = s.attribute or key
        block: dict = {
            "key": attr_key,
            "label_ko": _short_label_ko(attr_key, profile_id=profile_id),
            "n_positive": int(s.n_positive or 0),
            "n_negative": int(s.n_negative or 0),
            "n_mixed": int(s.n_mixed or 0),
            "evidence_score": _evidence_score(s),
            "polarity_share": _polarity_share(s),
            "tier": None,
        }
        quotes: list[dict] = []
        for ev in (s.sample_evidences_pos or [])[:MAX_QUOTES_PER_SIDE]:
            # Pass-17: forward profile_id so the
            # display_quote_summary normalizer can apply the
            # profile-specific fallback for degraded summaries.
            q = _quote_from_evidence(
                ev, attribute_key=attr_key, profile_id=profile_id,
            )
            if q:
                # Polarity is now finalized BEFORE the summary write —
                # but `_quote_from_evidence` runs the normalizer using
                # the polarity it saw inside the evidence dict. When
                # we override here, re-run the normalizer so the final
                # summary respects the surface polarity.
                final_polarity = q.get("polarity") or "positive"
                if final_polarity != q.get("polarity"):
                    q["polarity"] = final_polarity
                quotes.append(q)
        for ev in (s.sample_evidences_neg or [])[:MAX_QUOTES_PER_SIDE]:
            q = _quote_from_evidence(
                ev, attribute_key=attr_key, profile_id=profile_id,
            )
            if q:
                final_polarity = q.get("polarity") or "negative_strong"
                # Pass-17: when the surface polarity is overridden
                # (e.g., evidence had no polarity but the bucket is
                # negative), re-run the normalizer so the surface
                # summary matches the surface polarity instead of the
                # default positive form.
                if final_polarity != (q.get("polarity") or ""):
                    from src.voc.content.quote_summary_normalizer import (
                        normalize_display_quote_summary,
                    )
                    q["polarity"] = final_polarity
                    q["display_quote_summary"] = normalize_display_quote_summary(
                        q.get("display_quote_summary"),
                        attribute_key=attr_key,
                        polarity=final_polarity,
                        profile_id=profile_id,
                    )
                quotes.append(q)
        if quotes:
            block["top_quotes"] = quotes
        out.append(block)
    return out


def _strengths_block(
    summaries: dict[str, AttributeSummary],
    *,
    profile_id: str | None = None,
) -> list[dict]:
    candidates: list[tuple[str, AttributeSummary]] = []
    for key, s in summaries.items():
        n_pos = int(s.n_positive or 0)
        n_neg = int(s.n_negative or 0)
        if n_pos > n_neg and n_pos >= STRENGTH_MIN_POSITIVE:
            candidates.append((s.attribute or key, s))
    candidates.sort(key=lambda kv: -(kv[1].n_positive or 0))

    out: list[dict] = []
    for attr_key, s in candidates:
        entry: dict = {
            "attribute_key": attr_key,
            "supporting_count": int(s.n_positive or 0),
            "theme_keywords_ko": [],
        }
        # SCAMPER C: pick the most decision-useful quote rather than
        # blindly choosing index 0. Generic phrases ("너무 만족해요")
        # are penalized; profile-specific nouns ("대용량", "패드",
        # "집게") are bonused.
        # P0 reliability: skip candidates flagged as polarity_suspect
        # in the *positive* direction (e.g., a quote labeled positive
        # but containing strong negative cues should not be surfaced
        # as a strength's representative quote).
        if s.sample_evidences_pos:
            pool = list(s.sample_evidences_pos)
            while pool:
                best = _scamper_select_best_quote(
                    pool, profile_id=profile_id,
                )
                if best is None:
                    break
                q = _quote_from_evidence(
                    best, attribute_key=attr_key, profile_id=profile_id,
                )
                if q is None:
                    pool.remove(best)
                    continue
                if q.get("polarity_suspect"):
                    pool.remove(best)
                    continue
                # Report-layer attribute-fit guardrail. Skip a quote
                # whose visible text reads off-topic for this
                # attribute so the strengths card doesn't anchor on
                # a misclassified evidence excerpt.
                if q.get("attribute_fit_warning"):
                    pool.remove(best)
                    continue
                entry["representative_quote"] = q
                break
        out.append(entry)
    return out


def _monitoring_block(
    summaries: dict[str, AttributeSummary],
    *,
    profile_id: str | None = None,
) -> list[dict]:
    candidates: list[tuple[str, AttributeSummary]] = []
    for key, s in summaries.items():
        n_neg = int(s.n_negative or 0)
        if n_neg >= MONITORING_MIN_NEGATIVE:
            candidates.append((s.attribute or key, s))
    candidates.sort(key=lambda kv: -(kv[1].n_negative or 0))

    out: list[dict] = []
    for attr_key, s in candidates:
        entry: dict = {
            "attribute_key": attr_key,
            "concern_label_ko": _short_label_ko(attr_key, profile_id=profile_id),
            "n_negative": int(s.n_negative or 0),
        }
        # SCAMPER P (PUT TO ANOTHER USE): repeated frictions become
        # seller-facing interview hooks. None for attributes without
        # a curated template — caller falls back to concern_label_ko.
        hook = _scamper_interview_hook_for(attr_key)
        if hook:
            entry["interview_hook_ko"] = hook
        # SCAMPER C: same quote-quality scoring on the negative side.
        # Sort the (capped) sample-evidence list by score so the most
        # informative complaints surface first.
        raw_neg = list((s.sample_evidences_neg or []))
        if raw_neg:
            from src.voc.content.editorial_rules import (
                score_quote_quality as _scq,
            )
            raw_neg.sort(
                key=lambda ev: -_scq(ev, profile_id=profile_id),
            )
        # P0 reliability: drop quotes the polarity guardrail flags
        # as suspect when they sit on the *negative* side. A
        # negative_weak quote whose text is "촉촉하고 만족해요" must
        # never appear in monitoring_candidates — it's the central
        # failure mode this layer guards against.
        quotes: list[dict] = []
        skipped_suspect = 0
        skipped_fit = 0
        for ev in raw_neg:
            if len(quotes) >= MAX_QUOTES_MONITORING:
                break
            q = _quote_from_evidence(
                ev, attribute_key=attr_key, profile_id=profile_id,
            )
            if q is None:
                continue
            if q.get("polarity_suspect"):
                skipped_suspect += 1
                continue
            # Report-layer attribute-fit guardrail. Off-topic quotes
            # (e.g. dryness card showing a "양이 부족" complaint) are
            # excluded from the representative surface but remain in
            # `attributes[].top_quotes` for audit.
            if q.get("attribute_fit_warning"):
                skipped_fit += 1
                continue
            # Force the negative polarity surface AND re-normalize
            # the summary so it matches.
            final_polarity = q.get("polarity") or "negative_strong"
            if final_polarity != q.get("polarity"):
                from src.voc.content.quote_summary_normalizer import (
                    normalize_display_quote_summary,
                )
                q["polarity"] = final_polarity
                q["display_quote_summary"] = normalize_display_quote_summary(
                    q.get("display_quote_summary"),
                    attribute_key=attr_key, polarity=final_polarity,
                    profile_id=profile_id,
                )
            quotes.append(q)
        if quotes:
            entry["top_negative_quotes"] = quotes
        if skipped_suspect:
            entry["polarity_suspect_skipped"] = skipped_suspect
        if skipped_fit:
            entry["attribute_fit_skipped"] = skipped_fit
        out.append(entry)
    return out


def _tradeoffs_block(tradeoff_pairs: Iterable) -> list[dict]:
    """`tradeoff_pairs` is `Counter[str, int]`; format keys are
    `attr_a:pol -> attr_b:pol`."""
    out: list[dict] = []
    # Counter.most_common when available, else iterate items
    items = (
        tradeoff_pairs.most_common()  # type: ignore[attr-defined]
        if hasattr(tradeoff_pairs, "most_common")
        else sorted(((k, v) for k, v in (tradeoff_pairs or {}).items()),
                    key=lambda kv: -kv[1])
    )
    for pair_key, count in items:
        if not pair_key or not isinstance(pair_key, str):
            continue
        out.append({"pair": pair_key, "count": int(count)})
    return out


def _usage_patterns_block(
    summaries: dict[str, AttributeSummary],
    *,
    profile_id: str | None = None,
) -> list[dict]:
    """Synthesize decision-useful usage patterns from per-attribute
    polarity counts.

    Replaces the previous single-template "관련 호평이 보이지만 같은
    항목에 불만 후기도 N건" surface. A business-grade narrative
    requires (a) variation across entries and (b) a *what to validate*
    cue per entry. Each pattern carries:

      - `kind`               — one of {contradiction, dominant_strength,
                                dominant_friction}
      - `sentence_ko`        — primary one-line narrative
      - `business_question_ko` — what the seller should validate /
                                investigate next (interview / detail
                                page / spec)
      - `evidence_count`     — total quotes contributing
      - `n_positive`, `n_negative`

    The variation is index-modulated so consecutive entries don't
    repeat phrasing. This is a presentation layer choice; the
    underlying counts remain the source of truth.
    """
    # Templates are ordered so the first attribute uses the leading
    # phrasing, the second uses an alternate, etc. All retain the
    # explicit count contract for the editorial validator's
    # evidence-pair check. `{topic}` resolves to the appropriate
    # 은/는 topic particle by the last syllable's batchim.
    contradiction_templates: tuple[str, ...] = (
        "<b>{label}</b>{topic} 만족 후기 {pos}건이 누적되는 강점이지만, "
        "같은 축에 다른 결 의견 {neg}건이 함께 보입니다.",
        "<b>{label}</b>{topic} {pos}건의 호평이 쌓인 동시에 {neg}건의 "
        "주의 의견이 사용 시나리오 차이를 시사합니다.",
        "<b>{label}</b> 항목은 {pos}건이 만족, {neg}건이 불만으로 "
        "사용자별 체감이 갈리는 구간입니다.",
    )
    contradiction_questions: tuple[str, ...] = (
        "사용 시나리오(피부 타입·계절·병용 단계)별로 만족 / 불만이 "
        "갈리는지 인터뷰에서 짚어볼 후보입니다.",
        "상세 페이지에서 적정 사용 조건을 명시할 후보 항목입니다.",
        "리뷰 텍스트를 재분석해 만족 / 불만 사용자 군의 공통 조건을 "
        "찾아볼 후보입니다.",
    )

    out: list[dict] = []
    for key in sorted(summaries.keys()):
        s = summaries[key]
        n_pos = int(s.n_positive or 0)
        n_neg = int(s.n_negative or 0)
        if n_pos >= CONTRADICTION_MIN_PER_SIDE and n_neg >= CONTRADICTION_MIN_PER_SIDE:
            label = _short_label_ko(s.attribute or key, profile_id=profile_id)
            # Topic particle picker by batchim of last Hangul syllable.
            topic = "는"
            if label:
                last = label.strip()[-1]
                code = ord(last)
                if 0xAC00 <= code <= 0xD7A3:
                    topic = "는" if (code - 0xAC00) % 28 == 0 else "은"
            idx = len(out)
            tpl = contradiction_templates[idx % len(contradiction_templates)]
            qtpl = contradiction_questions[idx % len(contradiction_questions)]
            out.append({
                "kind": "contradiction",
                "sentence_ko": tpl.format(
                    label=label, pos=n_pos, neg=n_neg, topic=topic,
                ),
                "business_question_ko": qtpl,
                "evidence_count": n_pos + n_neg,
                "n_positive": n_pos,
                "n_negative": n_neg,
                "attribute_key": s.attribute or key,
            })
    out.sort(key=lambda p: -(p["evidence_count"]))
    return out


def _quick_decision_block(
    summaries: dict[str, AttributeSummary],
    confidence: str,
    *,
    selected_profile_id: str | None = None,
) -> dict:
    """Verdict + `who_for_ko` / `who_not_for_ko` derivation.

    `who_for_ko` lists 1–3 evidence-led audience descriptions
    based on top strengths. `who_not_for_ko` lists 1–2 caution
    descriptions based on top monitoring concerns. These feed
    Phase D's `best_for` / `not_for` slide-6 directly.

    Confidence maps the corpus rubric (high/medium/low) onto
    the brief rubric (strong/moderate/weak).
    """
    confidence_to_brief = {"high": "strong", "medium": "moderate", "low": "weak"}
    cl = confidence_to_brief.get(confidence, "weak")

    strengths = sorted(
        [(k, s) for k, s in summaries.items() if (s.n_positive or 0) > (s.n_negative or 0)
         and (s.n_positive or 0) >= STRENGTH_MIN_POSITIVE],
        key=lambda kv: -(kv[1].n_positive or 0),
    )
    monitoring = sorted(
        [(k, s) for k, s in summaries.items() if (s.n_negative or 0) >= MONITORING_MIN_NEGATIVE],
        key=lambda kv: -(kv[1].n_negative or 0),
    )

    # ---- SCAMPER editorial layer ----
    # MODIFY: contrast verdict ("X 만족 후기 N건이 보이지만, Y 불만 후기도
    # M건 함께 누적됩니다.") replaces the generic "관련 호평이 반복적으로
    # 관찰됩니다" template.
    # REVERSE: hesitation lines surface monitoring concerns as primary
    # buyer value, not buried under strengths.
    # ELIMINATE: evidence-paired who_for templates carry counts so the
    # downstream editorial validator's evidence-pair check passes.
    strength_inputs = [
        {
            "attribute_key": s.attribute or k,
            "label_ko": _short_label_ko(
                s.attribute or k, profile_id=selected_profile_id,
            ),
            "supporting_count": int(s.n_positive or 0),
        }
        for k, s in strengths[:3]
    ]
    monitoring_inputs = [
        {
            "attribute_key": s.attribute or k,
            "concern_label_ko": _short_label_ko(
                s.attribute or k, profile_id=selected_profile_id,
            ),
            "n_negative": int(s.n_negative or 0),
        }
        for k, s in monitoring[:3]
    ]
    verdict = _scamper_contrast_verdict(
        strengths=strength_inputs, monitoring=monitoring_inputs,
    )

    # Decision-useful audience descriptions. Replaces the previous
    # "X 만족 후기 N건이 누적되는 사용자" tautology — that phrasing
    # answered "who likes it?" with "people who like it." Business
    # readers need a description of the *type of buyer* who'd be
    # well-served. We rotate through 3 phrasings indexed by position
    # so consecutive lines don't repeat.
    who_for_templates: tuple[str, ...] = (
        "{label} 강점({n}건)이 매력적인 사용자",
        "{label}{obj} 우선 가치로 두는 사용자 (만족 {n}건)",
        "{label} 중심으로 제품을 고르는 사용자 (관련 호평 {n}건)",
    )
    who_for: list[str] = []
    for i, entry in enumerate(strength_inputs):
        tpl = who_for_templates[i % len(who_for_templates)]
        label = entry["label_ko"]
        # Korean object-particle picker (을/를) by batchim of last
        # Hangul syllable. Falls back to 를 for non-Hangul tails.
        obj = "를"
        if label:
            last = label.strip()[-1]
            code = ord(last)
            if 0xAC00 <= code <= 0xD7A3:
                obj = "를" if (code - 0xAC00) % 28 == 0 else "을"
        who_for.append(
            tpl.format(
                label=label,
                n=entry["supporting_count"],
                obj=obj,
            )
        )

    # who_not_for is the REVERSE surface — derived from hesitation
    # lines which already carry counts so the validator passes.
    who_not_for = _scamper_hesitation_lines(
        monitoring_inputs, profile_id=selected_profile_id, limit=2,
    )

    watch_outs = [entry["concern_label_ko"] for entry in monitoring_inputs[:3]]

    return {
        "verdict_ko": verdict,
        "who_for_ko": who_for,
        "who_not_for_ko": who_not_for,
        "watch_outs_ko": watch_outs,
        "confidence_level": cl,
    }


def _methodology_block(sampling_strategy: str = "latest_only") -> dict:
    """Strategy-aware methodology surface.

    `observable_multi_sort_corpus` gets an explicit disclosure that
    names the bias profile so downstream content surfaces (brief,
    cardnews, seller PDF) inherit honest framing instead of
    inheriting the silent default. Other strategies fall through to
    the legacy disclaimer.
    """
    if sampling_strategy == "observable_multi_sort_corpus":
        return {
            "disclosure_ko": _OBSERVABLE_MULTI_SORT_DISCLOSURE_KO,
            "sample_caveats_ko": [
                *_DEFAULT_SAMPLE_CAVEATS_KO,
                *_OBSERVABLE_MULTI_SORT_SAMPLE_CAVEATS_KO,
            ],
            "sampling_strategy": sampling_strategy,
        }
    return {
        "disclosure_ko": _DEFAULT_DISCLOSURE_KO,
        "sample_caveats_ko": list(_DEFAULT_SAMPLE_CAVEATS_KO),
        "sampling_strategy": sampling_strategy,
    }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


def productreportdata_to_analysis_report(
    data: ProductReportData,
    *,
    source_url: str | None = None,
    primary_sort: str = "DATETIME_DESC",
    sampling_strategy: str = "latest_only",
    corpus_type: str = "observed_scrape",
    observation_window: dict | None = None,
    product_slug: str | None = None,
    product_category: str | None = None,
    suppress_attributes: Iterable[str] | None = None,
    selected_profile_id: str | None = None,
    sorts_attempted: list[str] | None = None,
    sorts_succeeded: list[str] | None = None,
    sorts_failed: list[str] | None = None,
    partial_success: bool | None = None,
) -> dict:
    """Build a v3.0 `analysis_report.json` dict from a Phase 2E
    `ProductReportData`.

    Pure: no DB, no LLM, no I/O. The caller writes the dict to
    disk after validation.

    `product_slug` is taken verbatim when supplied (CLI override
    path). When omitted, the caller is expected to derive a slug
    via `src.voc.content.paths.slugify` from the product name and
    URL — the adapter doesn't import the path layer to keep its
    surface tiny.

    `suppress_attributes` is the closed set of canonical attribute
    keys to drop from every output surface (attributes,
    strengths, monitoring_candidates, tradeoffs, usage_patterns,
    quick_decision derivations). Stage 1 detection itself is NOT
    altered — suppression is a presentation-layer filter so the
    seller-facing analysis_report.json doesn't list e.g.
    `pigmentation` for a toner pad. Pass an empty iterable or None
    to disable. The matching `selected_profile_id` (if any) is
    surfaced into `analysis_report.product` for audit.
    """
    summaries = data.attribute_summaries or {}
    suppress: frozenset[str] = (
        frozenset(s for s in suppress_attributes if isinstance(s, str) and s)
        if suppress_attributes else frozenset()
    )
    if suppress:
        summaries = {
            k: v for k, v in summaries.items()
            if (v.attribute or k) not in suppress
        }
    raw_tradeoffs = getattr(data, "tradeoff_pairs", None) or {}
    if suppress:
        if hasattr(raw_tradeoffs, "items"):
            tradeoffs_filtered: dict = {
                k: v for k, v in raw_tradeoffs.items()
                if not _pair_touches_suppressed(k, suppress)
            }
        else:
            tradeoffs_filtered = {}
    else:
        tradeoffs_filtered = raw_tradeoffs

    n_reviews = int(getattr(data, "n_reviews", 0) or 0)
    confidence = _resolve_corpus_confidence(n_reviews)

    # Observation window: schema accepts null start/end. The seller
    # pipeline does not currently track per-product windows.
    window = observation_window or {"start": None, "end": None}

    # SCAMPER A — defensive category normalization. Even when the
    # caller already cleaned the breadcrumb, a legacy/raw string
    # like "마스크팩\n패드\n패드" reaching this layer would land
    # verbatim in product.category. Normalize once here so the
    # editorial guarantee holds regardless of upstream caller.
    cleaned_category: str | None = None
    if isinstance(product_category, str) and product_category.strip():
        nodes = _parse_breadcrumb_text(product_category)
        if nodes:
            # Caller's intent (leaf vs full path) is preserved by the
            # input shape: a single token in → leaf; a separator-
            # joined string in → full path stays full path.
            if "\n" in product_category or len(nodes) > 1 and any(
                sep in product_category for sep in (">", "/", "|", "›", "»", "→")
            ):
                cleaned_category = " > ".join(nodes)
            else:
                cleaned_category = nodes[-1]
    raw_product_name = getattr(data, "product_name", None)
    # Pass-15: split the OliveYoung-style merch headline
    # ("[1위 패드] 메디힐 더마 패드 200매 대용량 기획 세트 7종 골라담기")
    # into report-friendly parts. Audit `text` is preserved as
    # raw_product_name; `name_ko` keeps the legacy contract (whatever
    # the upstream caller wrote) so existing consumers don't break.
    from src.voc.content.product_name_normalizer import (
        normalize_product_name,
    )
    name_parts = normalize_product_name(raw_product_name)
    # Pass-18 — product image fields. `image_url` is the original URL
    # captured at scrape time (or None when the connector didn't capture
    # one). `image_local_path` is the on-disk path under the run's
    # `assets/` dir, populated either at collection time or by the
    # backfill CLI (`scripts/backfill_product_image.py`). `image_source`
    # records which channel produced the image (oliveyoung | coupang |
    # manual | None) so downstream tools can surface attribution.
    #
    # The cardnews skill consumes `image_local_path` first; the URL is
    # only used as a fall-through if the local file is missing. This
    # keeps the renderer offline at render time — no live HTTP fetches
    # against external CDNs while the carousel is being built.
    product_block: dict = {
        "slug": product_slug,
        "name_ko": raw_product_name,  # legacy field: raw audit text
        "name_en": None,
        "category": cleaned_category,
        "source_url": source_url,
        "image_url": getattr(data, "product_image_url", None),
        "image_local_path": getattr(data, "product_image_local_path", None),
        "image_source": getattr(data, "product_image_source", None),
        # Pass-15 four-part shape — every consumer that wants the
        # report-friendly headline reads `display_product_name` /
        # `report_title`; `raw_product_name` is the audit invariant.
        "raw_product_name": name_parts["raw_product_name"],
        "display_product_name": name_parts["display_product_name"],
        "offer_context": name_parts["offer_context"],
        "promo_context": name_parts["promo_context"],
        "report_title": name_parts["report_title"],
    }
    if selected_profile_id:
        product_block["selected_profile_id"] = selected_profile_id
    if suppress:
        product_block["suppressed_attributes"] = sorted(suppress)

    attributes_block = _attributes_block(
        summaries, profile_id=selected_profile_id,
    )

    # P0 reliability — polarity audit aggregator. Reads every quote
    # surfaced in the attributes block (which includes the polarity
    # field) and computes per-attribute suspect counts. The sidecar
    # is JSON-serializable and small enough to ride in the same
    # analysis_report.json file. Tooling can lift it out later.
    quotes_by_attribute: dict[str, list[dict]] = {}
    for attr_block in attributes_block:
        key = attr_block.get("key")
        quotes = attr_block.get("top_quotes") or []
        if key and quotes:
            quotes_by_attribute[key] = quotes
    polarity_audit = _build_polarity_audit(quotes_by_attribute)

    # Four-axis confidence/coverage breakdown. Run-003 surfaced the
    # failure mode where a single `confidence_level=high` field hid an
    # under-observed negative-signal pool (RATING_ASC failed but
    # n=2115 was large). The four axes split the verdicts so each
    # surface can show the right caveat — see confidence_axes.py.
    from src.voc.content.confidence_axes import compute_confidence_axes
    confidence_axes = compute_confidence_axes(
        n_reviews=n_reviews,
        polarity_audit=polarity_audit,
        sorts_attempted=sorts_attempted,
        sorts_succeeded=sorts_succeeded,
        sorts_failed=sorts_failed,
        partial_success=partial_success,
    )

    report = {
        "schema_version": ANALYSIS_REPORT_SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "product": product_block,
        "corpus": {
            "n_reviews_total": n_reviews,
            "n_reviews_analyzed": n_reviews,
            "primary_sort": primary_sort,
            "sampling_strategy": sampling_strategy,
            "corpus_type": corpus_type,
            "confidence_level": confidence,
            "signal_stability": confidence,
            "observation_window": window,
            # Additive: legacy `confidence_level` kept for back-compat;
            # `confidence_axes` is the new operator-facing surface.
            "confidence_axes": confidence_axes,
        },
        "attributes": attributes_block,
        "strengths": _strengths_block(
            summaries, profile_id=selected_profile_id,
        ),
        "monitoring_candidates": _monitoring_block(
            summaries, profile_id=selected_profile_id,
        ),
        "tradeoffs": _tradeoffs_block(tradeoffs_filtered),
        "usage_patterns": _usage_patterns_block(
            summaries, profile_id=selected_profile_id,
        ),
        "buyer_segments": [],   # Phase 2E lacks native segment detection
        "quick_decision": _quick_decision_block(
            summaries, confidence, selected_profile_id=selected_profile_id,
        ),
        "theme_contrasts": [],   # Phase 2E does not compute these
        "trend": None,
        "methodology_notes": _methodology_block(sampling_strategy),
        "polarity_audit": polarity_audit,
    }
    return report
