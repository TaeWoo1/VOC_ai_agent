"""Signal-quality evaluation for the Phase 1 pipeline.

Pure scoring function — no I/O. Given:

  * a membership map from ``detect_signals_with_membership``
  * a golden-label JSON (``eval_data/phase1/phase1_signals_golden.json``)
  * a signal-map JSON (``eval_data/phase1/phase1_signal_map.json``)

compute per-signal precision / recall and a separate coverage-gap tally.
See ``eval_data/phase1/README.md`` for the curator-facing framing.

Key semantics (locked):

* **Coverage gaps are SEPARATE from TP/FP/FN math.** A labeled review whose
  only tags map to empty signal-map entries contributes ZERO to any
  signal's precision/recall. It shows up only in ``coverage_gaps``. This
  prevents conflating "pipeline has no rule for tag X" with "pipeline
  failed to catch what it should have."

* **Universe for FP counting is the full set of reviews the pipeline ran on
  (``all_review_ids``), not just labeled ones.** Absence from the golden
  file explicitly means "no cautionary concern expected" per README. So a
  signal firing on an unlabeled review counts as FP.

* **Positive signals are out of scope.** Only signal names that appear as
  a value in ``tag_to_expected_signals`` are scored. Positive-lexicon
  firings (``moist_finish`` etc.) are ignored.

* **Draft and reviewed labels are treated identically by default.**
  Callers can pass ``include_statuses`` to filter.
"""

from __future__ import annotations

from typing import Iterable, Literal

from pydantic import BaseModel, Field


LabelStatus = Literal["draft", "reviewed", "dismissed"]


class SignalScore(BaseModel):
    signal_name: str
    n_expected: int     # labeled reviews whose tags map to this signal
    n_fired: int        # reviews in scored universe the pipeline fired this signal on
    tp: int
    fp: int
    fn: int
    precision: float | None = None  # None when n_fired == 0
    recall: float | None = None     # None when n_expected == 0


class CoverageGap(BaseModel):
    tag: str
    n_reviews: int
    example_review_ids: list[str] = Field(default_factory=list)  # up to 5, sorted


class EvalSummary(BaseModel):
    labeled_reviews_total: int
    labeled_reviews_included: int     # after status filter
    reviews_in_universe: int          # pipeline input size
    scored_signals: int               # distinct mapped signals present
    mapped_tags_used: int             # distinct tags with non-empty mapping used by any label
    coverage_gap_tags_used: int       # distinct tags with empty mapping used by any label


class EvalResult(BaseModel):
    per_signal: dict[str, SignalScore]
    coverage_gaps: list[CoverageGap]  # sorted: n_reviews desc, tag asc
    summary: EvalSummary
    golden_version: str
    signal_map_version: str
    included_statuses: list[str]


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


def score(
    *,
    membership: dict[str, set[str]],
    all_review_ids: Iterable[str],
    golden: dict,
    signal_map: dict,
    include_statuses: list[LabelStatus] | None = None,
) -> EvalResult:
    """Score the pipeline's current detections against the golden labels.

    ``membership`` — full ``{signal_name: {review_ids}}`` from
    ``detect_signals_with_membership``. Not the capped 3-id sample list.

    ``all_review_ids`` — every review the pipeline ran on. Needed so FP
    counting can see signals fired on unlabeled reviews.

    ``include_statuses`` — statuses to include. ``None`` means all non-
    dismissed statuses (``["draft", "reviewed"]``). Pass ``["reviewed"]``
    to score only reviewed entries.
    """
    if include_statuses is None:
        include_statuses = ["draft", "reviewed"]
    include_set = set(include_statuses)

    universe: set[str] = set(all_review_ids)
    labels: dict = golden.get("labels", {})
    tag_to_signals: dict[str, list[str]] = signal_map.get(
        "tag_to_expected_signals", {}
    )

    # 1) Filter labels by status. Every included label must also be in the
    #    pipeline universe — reviews in the golden file that the pipeline
    #    never saw would produce unscoreable labels.
    included_label_ids: set[str] = set()
    skipped_not_in_universe: set[str] = set()
    for rid, entry in labels.items():
        status = entry.get("status", "draft")
        if status not in include_set:
            continue
        if rid not in universe:
            skipped_not_in_universe.add(rid)
            continue
        included_label_ids.add(rid)

    # 2) Per labeled review, resolve expected signals via tag → signals map.
    #    Tags with empty mappings contribute to coverage_gaps ONLY.
    expected_by_signal: dict[str, set[str]] = {}
    coverage_gap_hits: dict[str, list[str]] = {}
    mapped_tags_used: set[str] = set()
    for rid in included_label_ids:
        entry = labels[rid]
        for tag in entry.get("concerns", []):
            mapped = tag_to_signals.get(tag)
            if mapped is None:
                # Tag isn't declared at all — treat like a coverage gap so
                # the operator sees "this labeled concept has no home."
                coverage_gap_hits.setdefault(tag, []).append(rid)
                continue
            if len(mapped) == 0:
                coverage_gap_hits.setdefault(tag, []).append(rid)
                mapped_tags_used  # no-op, kept for readability parity
                continue
            mapped_tags_used.add(tag)
            for sig in mapped:
                expected_by_signal.setdefault(sig, set()).add(rid)

    # 3) Signals in scope for scoring = signals that appear anywhere in the
    #    signal_map values. This deliberately excludes positives that never
    #    get mapped (moist_finish etc. don't appear in signal_map).
    in_scope_signals: set[str] = set()
    for mapped in tag_to_signals.values():
        in_scope_signals.update(mapped)
    # Also include any signal that fired AND is in the mapping value universe
    # — handled by the union above since `in_scope_signals` covers all values.

    # 4) Compute per-signal TP/FP/FN.
    per_signal: dict[str, SignalScore] = {}
    for sig in sorted(in_scope_signals):
        expected = expected_by_signal.get(sig, set())
        fired_full = membership.get(sig, set()) & universe
        tp = len(expected & fired_full)
        fp = len(fired_full - expected)
        fn = len(expected - fired_full)
        precision = tp / (tp + fp) if (tp + fp) > 0 else None
        recall = tp / (tp + fn) if (tp + fn) > 0 else None
        per_signal[sig] = SignalScore(
            signal_name=sig,
            n_expected=len(expected),
            n_fired=len(fired_full),
            tp=tp, fp=fp, fn=fn,
            precision=round(precision, 4) if precision is not None else None,
            recall=round(recall, 4) if recall is not None else None,
        )

    # 5) Coverage gaps list, sorted by frequency.
    gaps: list[CoverageGap] = [
        CoverageGap(
            tag=tag,
            n_reviews=len(rids),
            example_review_ids=sorted(rids)[:5],
        )
        for tag, rids in coverage_gap_hits.items()
    ]
    gaps.sort(key=lambda g: (-g.n_reviews, g.tag))

    # 6) Summary.
    summary = EvalSummary(
        labeled_reviews_total=len(labels),
        labeled_reviews_included=len(included_label_ids),
        reviews_in_universe=len(universe),
        scored_signals=len(per_signal),
        mapped_tags_used=len(mapped_tags_used),
        coverage_gap_tags_used=len(coverage_gap_hits),
    )

    return EvalResult(
        per_signal=per_signal,
        coverage_gaps=gaps,
        summary=summary,
        golden_version=str(golden.get("version", "unknown")),
        signal_map_version=str(signal_map.get("version", "unknown")),
        included_statuses=list(include_statuses),
    )


# ---------------------------------------------------------------------------
# Rendering — thin markdown formatter for CLI convenience
# ---------------------------------------------------------------------------


def render_markdown(result: EvalResult) -> str:
    """Operator-readable markdown output for the scoring CLI."""
    lines: list[str] = []
    s = result.summary
    lines.append("# Phase 1 signal-quality eval")
    lines.append("")
    lines.append(
        f"golden={result.golden_version} · signal_map={result.signal_map_version} "
        f"· statuses={','.join(result.included_statuses)}"
    )
    lines.append(
        f"labeled: {s.labeled_reviews_included}/{s.labeled_reviews_total} "
        f"· universe: {s.reviews_in_universe} "
        f"· scored signals: {s.scored_signals} "
        f"· mapped tags used: {s.mapped_tags_used} "
        f"· coverage-gap tags used: {s.coverage_gap_tags_used}"
    )
    lines.append("")

    # Per-signal table
    lines.append("## Per-signal scores")
    lines.append("")
    lines.append("| signal | n_exp | n_fired | TP | FP | FN | precision | recall |")
    lines.append("|---|---:|---:|---:|---:|---:|---:|---:|")
    for sig_name, sc in sorted(result.per_signal.items()):
        p = f"{sc.precision:.2f}" if sc.precision is not None else "—"
        r = f"{sc.recall:.2f}" if sc.recall is not None else "—"
        lines.append(
            f"| `{sc.signal_name}` | {sc.n_expected} | {sc.n_fired} "
            f"| {sc.tp} | {sc.fp} | {sc.fn} | {p} | {r} |"
        )
    lines.append("")

    # Coverage gaps
    lines.append("## Coverage gaps (labeled concerns with no pipeline signal)")
    lines.append("")
    if not result.coverage_gaps:
        lines.append("_(none)_")
    else:
        lines.append("| tag | n reviews | example review_ids |")
        lines.append("|---|---:|---|")
        for g in result.coverage_gaps:
            ex = ", ".join(f"`{r[:10]}`" for r in g.example_review_ids)
            lines.append(f"| `{g.tag}` | {g.n_reviews} | {ex} |")
    lines.append("")
    return "\n".join(lines) + "\n"
