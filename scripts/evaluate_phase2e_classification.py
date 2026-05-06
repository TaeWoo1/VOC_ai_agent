#!/usr/bin/env python3
"""Seed evaluator for Phase 2E polarity classification.

Reads a hand-labeled JSONL seed (default
`eval_data/phase2e/polarity_eval.jsonl`) and produces:

  - polarity accuracy (coarse: positive / negative / mixed / neutral)
  - per-class precision / recall / F1
  - confusion matrix (fine-grained: positive / negative_weak /
    negative_strong / mixed / neutral)
  - error counts by attribute
  - seller-surface-risk count: errors that would surface incorrectly
    in the seller PDF if uncaught (e.g. a positive_as_negative
    landing in monitoring_candidates.top_negative_quotes)
  - guardrail catch rate: among polarity errors, the fraction that
    `polarity_guardrail.check_polarity` would already flag as suspect

The runner is **read-only over the dataset**. It does not call the
Stage 2 LLM by default; the rationale is that the dataset already
records `current_polarity` per span, which is what Stage 2 produced.
A `--run-stage2` flag is available for the future-API-on path but
not exercised here.

This is a **seed eval**, not a production benchmark. Outputs say so
in their headers. Treat metrics as direction-of-error indicators.

Usage
-----

    PYTHONPATH=. python3 scripts/evaluate_phase2e_classification.py
    PYTHONPATH=. python3 scripts/evaluate_phase2e_classification.py \\
        --dataset eval_data/phase2e/polarity_eval.jsonl \\
        --out-dir outputs/eval

Outputs land at
`outputs/eval/phase2e_classification_eval_<UTC-timestamp>.json` and
the matching `.md`. Prior reports are not deleted — operators
compare across runs.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

# Guardrail import — co-located with the data it guards. Pure module.
from src.voc.reporting.phase2e.polarity_guardrail import (  # noqa: E402
    check_polarity,
)
# Stage 2 imports for replay mode. These are pure constants + the
# classifier protocol; the actual `OpenAIClassifier` is constructed
# lazily in `main()` so unit tests don't pull the openai SDK.
from src.voc.reporting.phase2e.stage2 import (  # noqa: E402
    ALLOWED_PROMPT_VERSIONS,
    DEFAULT_PROMPT_VERSION,
    PROMPT_VERSION_V2_SKINCARE,
    PolarityClassifier,
    PolarityRecord,
)


# ---------------------------------------------------------------------------
# Schema constants — single source of truth for the JSONL contract.
# ---------------------------------------------------------------------------


REQUIRED_FIELDS: frozenset[str] = frozenset({
    "id", "source_run_id", "goodsNo", "product_name",
    "review_id", "attribute", "text", "current_polarity",
    "gold_polarity", "error_type", "confidence", "note",
})

POLARITY_VALUES: frozenset[str] = frozenset({
    "positive", "negative_weak", "negative_strong", "mixed", "neutral",
})

ERROR_TYPE_VALUES: frozenset[str] = frozenset({
    "positive_as_negative",
    "negative_as_positive",
    "mixed_should_be_mixed",
    "neutral_or_context_missing",
    "attribute_mismatch",
    "span_boundary_bad",
    "acceptable_current_label",
})

CONFIDENCE_VALUES: frozenset[str] = frozenset({"high", "medium", "low"})

# Coarse polarity buckets used for headline accuracy + per-class P/R/F1.
# Stage 2's neg_weak/neg_strong distinction is preserved in the
# fine-grained confusion matrix but folded for headline numbers.
COARSE_BUCKETS: tuple[str, ...] = ("positive", "negative", "mixed", "neutral")
FINE_BUCKETS: tuple[str, ...] = (
    "positive", "negative_weak", "negative_strong", "mixed", "neutral",
)


def _coarse(polarity: str) -> str:
    """Map fine-grained polarity to a coarse 4-bucket family."""
    if polarity in ("negative_weak", "negative_strong"):
        return "negative"
    if polarity in COARSE_BUCKETS:
        return polarity
    # Defensive — unexpected values fall to 'neutral' so the metrics
    # don't crash; schema validation already errored on these.
    return "neutral"


# ---------------------------------------------------------------------------
# Schema validation
# ---------------------------------------------------------------------------


class DatasetValidationError(ValueError):
    """Raised when a JSONL row violates the schema. Tests assert on
    the message prefix; do not change without updating tests."""


def validate_dataset(rows: list[dict]) -> None:
    """Raise on the first row that violates the schema. Empty datasets
    are not valid (the eval has nothing to measure)."""
    if not rows:
        raise DatasetValidationError("dataset is empty")
    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            raise DatasetValidationError(
                f"row {i}: not a JSON object"
            )
        missing = REQUIRED_FIELDS - set(row.keys())
        if missing:
            raise DatasetValidationError(
                f"row {i} (id={row.get('id')!r}): missing fields {sorted(missing)}"
            )
        for k in ("current_polarity", "gold_polarity"):
            if row[k] not in POLARITY_VALUES:
                raise DatasetValidationError(
                    f"row {i} (id={row.get('id')!r}): {k}={row[k]!r} not in "
                    f"{sorted(POLARITY_VALUES)}"
                )
        if row["error_type"] not in ERROR_TYPE_VALUES:
            raise DatasetValidationError(
                f"row {i} (id={row.get('id')!r}): error_type={row['error_type']!r} "
                f"not in {sorted(ERROR_TYPE_VALUES)}"
            )
        if row["confidence"] not in CONFIDENCE_VALUES:
            raise DatasetValidationError(
                f"row {i} (id={row.get('id')!r}): confidence={row['confidence']!r} "
                f"not in {sorted(CONFIDENCE_VALUES)}"
            )


def load_dataset(path: Path) -> list[dict]:
    """Read JSONL, parse each line, validate. Empty / comment lines
    are tolerated; malformed JSON raises immediately."""
    rows: list[dict] = []
    with path.open(encoding="utf-8") as f:
        for ln_no, line in enumerate(f, start=1):
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            try:
                rows.append(json.loads(stripped))
            except json.JSONDecodeError as e:
                raise DatasetValidationError(
                    f"line {ln_no}: invalid JSON ({e})"
                ) from e
    validate_dataset(rows)
    return rows


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------


def compute_per_class_metrics(
    pairs: list[tuple[str, str]],
    labels: Iterable[str] = COARSE_BUCKETS,
) -> dict:
    """Return per-class precision/recall/F1/support given (gold, pred)
    coarse-bucket pairs. Each metric is a float in [0, 1]."""
    out: dict[str, dict[str, float | int]] = {}
    for cls in labels:
        tp = sum(1 for g, p in pairs if g == cls and p == cls)
        fp = sum(1 for g, p in pairs if g != cls and p == cls)
        fn = sum(1 for g, p in pairs if g == cls and p != cls)
        support = sum(1 for g, _ in pairs if g == cls)
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = (
            2 * precision * recall / (precision + recall)
            if (precision + recall) else 0.0
        )
        out[cls] = {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "support": support,
            "tp": tp,
            "fp": fp,
            "fn": fn,
        }
    return out


def compute_confusion_matrix(
    pairs: list[tuple[str, str]],
    labels: Iterable[str] = FINE_BUCKETS,
) -> dict:
    """Confusion matrix as a nested dict keyed `[gold][pred] = count`.
    Both axes carry every bucket so missing rows/cols still appear
    as zeros — easier to read in Markdown."""
    labels = list(labels)
    matrix: dict[str, dict[str, int]] = {
        g: {p: 0 for p in labels} for g in labels
    }
    for g, p in pairs:
        if g in matrix and p in matrix[g]:
            matrix[g][p] += 1
    return matrix


def compute_seller_surface_risk(rows: list[dict]) -> dict:
    """Count errors that would surface incorrectly in seller PDF.

    The dangerous classes:
      - `positive_as_negative` — quote labeled negative would land in
        `monitoring_candidates.top_negative_quotes` even though the
        text is actually praise. Overstates frictions in the seller
        report.
      - `negative_as_positive` — quote labeled positive would land in
        a strength's representative_quote even though the text is
        actually a complaint. Overstates strengths.
      - `attribute_mismatch` — quote attached to wrong attribute, will
        surface under that attribute's section regardless of polarity.
      - `span_boundary_bad` — polarity may be correct but the raw
        span ends mid-word and looks unprofessional in print.

    `mixed_should_be_mixed` is excluded — Stage 2 produced *one* side
    of a mixed span, which is wrong but not strictly a surface-risk
    failure (the seller report can still cite it as a representative
    of that one side).
    """
    risk_codes = (
        "positive_as_negative",
        "negative_as_positive",
        "attribute_mismatch",
        "span_boundary_bad",
    )
    by_code = Counter(
        r["error_type"] for r in rows
        if r["error_type"] in risk_codes
    )
    return {
        "total_at_risk": int(sum(by_code.values())),
        "by_error_type": {k: int(v) for k, v in by_code.items()},
    }


def compute_guardrail_catch_rate(rows: list[dict]) -> dict:
    """Among polarity-flip errors (positive_as_negative /
    negative_as_positive), how many would the existing post-Stage-2
    guardrail flag as suspect?

    The guardrail's contract is: never auto-flip; mark the row
    suspect when decisive cues contradict the claim. This metric is
    a direct measure of how much of the eval's known-error surface
    the guardrail already covers.
    """
    eligible = [
        r for r in rows
        if r["error_type"] in ("positive_as_negative", "negative_as_positive")
    ]
    if not eligible:
        return {
            "n_polarity_errors": 0,
            "n_caught": 0,
            "n_missed": 0,
            "catch_rate": None,
            "missed_samples": [],
            "caught_samples": [],
        }
    caught: list[dict] = []
    missed: list[dict] = []
    for r in eligible:
        check = check_polarity(r["text"], r["current_polarity"])
        sample = {
            "id": r["id"],
            "review_id": r["review_id"],
            "attribute": r["attribute"],
            "current_polarity": r["current_polarity"],
            "gold_polarity": r["gold_polarity"],
            "text_excerpt": r["text"][:120] + (
                "…" if len(r["text"]) > 120 else ""
            ),
        }
        if check.is_suspect:
            sample["guardrail_suggested"] = check.suggested_polarity
            sample["guardrail_confidence"] = check.confidence
            caught.append(sample)
        else:
            sample["guardrail_reasons"] = list(check.reasons)
            missed.append(sample)
    return {
        "n_polarity_errors": len(eligible),
        "n_caught": len(caught),
        "n_missed": len(missed),
        "catch_rate": round(len(caught) / len(eligible), 4),
        "missed_samples": missed,
        "caught_samples": caught[:5],  # first 5 for the report
    }


def compute_errors_by_attribute(rows: list[dict]) -> dict:
    """Count errors per attribute, broken down by error_type."""
    by_attr: dict[str, dict[str, int]] = defaultdict(
        lambda: defaultdict(int),
    )
    totals_by_attr: dict[str, int] = Counter()
    for r in rows:
        attr = r["attribute"]
        totals_by_attr[attr] += 1
        if r["error_type"] != "acceptable_current_label":
            by_attr[attr][r["error_type"]] += 1
    out: dict[str, dict] = {}
    for attr, counts in by_attr.items():
        total = totals_by_attr[attr]
        n_errors = sum(counts.values())
        out[attr] = {
            "n_total_in_eval": total,
            "n_errors": n_errors,
            "error_rate": (
                round(n_errors / total, 4) if total else 0.0
            ),
            "by_error_type": {k: int(v) for k, v in counts.items()},
        }
    return out


# ---------------------------------------------------------------------------
# Top-level evaluator
# ---------------------------------------------------------------------------


def evaluate(rows: list[dict]) -> dict:
    """Build the full metrics dict from a validated row list."""
    n_total = len(rows)

    # For accuracy / per-class metrics, exclude rows where the
    # polarity comparison is moot:
    #   - attribute_mismatch (the polarity may be correct, just
    #     attached to the wrong attribute)
    #   - span_boundary_bad (polarity may be correct; span is the
    #     issue)
    # These rows are still counted in seller_surface_risk because
    # they would still surface incorrectly.
    polarity_eligible = [
        r for r in rows
        if r["error_type"] not in ("attribute_mismatch", "span_boundary_bad")
    ]
    n_excluded = n_total - len(polarity_eligible)

    coarse_pairs: list[tuple[str, str]] = [
        (_coarse(r["gold_polarity"]), _coarse(r["current_polarity"]))
        for r in polarity_eligible
    ]
    fine_pairs: list[tuple[str, str]] = [
        (r["gold_polarity"], r["current_polarity"])
        for r in polarity_eligible
    ]

    n_correct_coarse = sum(1 for g, p in coarse_pairs if g == p)
    n_correct_fine = sum(1 for g, p in fine_pairs if g == p)

    return {
        "n_total": n_total,
        "n_excluded_from_polarity_metrics": n_excluded,
        "n_evaluated": len(polarity_eligible),
        "accuracy_coarse": (
            round(n_correct_coarse / len(coarse_pairs), 4)
            if coarse_pairs else None
        ),
        "accuracy_fine": (
            round(n_correct_fine / len(fine_pairs), 4)
            if fine_pairs else None
        ),
        "per_class_coarse": compute_per_class_metrics(coarse_pairs),
        "confusion_matrix_fine": compute_confusion_matrix(fine_pairs),
        "errors_by_attribute": compute_errors_by_attribute(rows),
        "seller_surface_risk": compute_seller_surface_risk(rows),
        "guardrail_catch_rate": compute_guardrail_catch_rate(rows),
        "error_type_distribution": dict(Counter(r["error_type"] for r in rows)),
    }


# ---------------------------------------------------------------------------
# Markdown rendering
# ---------------------------------------------------------------------------


def _render_per_class_table(per_class: dict) -> str:
    out = ["| class | precision | recall | F1 | support |",
           "|---|---:|---:|---:|---:|"]
    for cls, m in per_class.items():
        out.append(
            f"| `{cls}` | {m['precision']:.3f} | {m['recall']:.3f} | "
            f"{m['f1']:.3f} | {m['support']} |"
        )
    return "\n".join(out)


def _render_confusion_matrix(cm: dict, labels: list[str]) -> str:
    header = "| gold \\ pred | " + " | ".join(f"`{p}`" for p in labels) + " |"
    sep = "|---|" + "---:|" * len(labels)
    rows = [header, sep]
    for g in labels:
        cells = [f"**`{g}`**"] + [str(cm[g][p]) for p in labels]
        rows.append("| " + " | ".join(cells) + " |")
    return "\n".join(rows)


def _render_attribute_errors(errors_by_attr: dict) -> str:
    if not errors_by_attr:
        return "_No attribute-level errors._\n"
    out = ["| attribute | total | errors | error_rate | top error_type |",
           "|---|---:|---:|---:|---|"]
    for attr, info in sorted(
        errors_by_attr.items(),
        key=lambda kv: -kv[1]["error_rate"],
    ):
        top_type = (
            max(info["by_error_type"].items(), key=lambda kv: kv[1])[0]
            if info["by_error_type"] else "-"
        )
        out.append(
            f"| `{attr}` | {info['n_total_in_eval']} | "
            f"{info['n_errors']} | {info['error_rate']:.2%} | "
            f"`{top_type}` |"
        )
    return "\n".join(out)


def render_markdown(
    metrics: dict,
    *,
    dataset_path: Path,
    ran_at_utc: str,
) -> str:
    coarse_acc = metrics["accuracy_coarse"]
    fine_acc = metrics["accuracy_fine"]
    risk = metrics["seller_surface_risk"]
    catch = metrics["guardrail_catch_rate"]
    n_total = metrics["n_total"]
    n_eval = metrics["n_evaluated"]

    sections: list[str] = []
    sections.append(
        "# Phase 2E classification — seed eval"
    )
    sections.append("")
    sections.append(
        f"> ⚠ **Seed eval, NOT a production benchmark.** "
        f"Single product, single labeler, {n_total} rows. "
        f"Treat metrics as direction-of-error indicators, not as an "
        f"SLA. See `eval_data/phase2e/README.md` for limitations."
    )
    sections.append("")
    sections.append(
        f"- **Generated:** `{ran_at_utc}`\n"
        f"- **Dataset:** `{dataset_path}` ({n_total} rows)\n"
        f"- **Polarity-eligible rows:** {n_eval} "
        f"(excluded {metrics['n_excluded_from_polarity_metrics']} "
        f"`attribute_mismatch` / `span_boundary_bad`)"
    )
    sections.append("")

    sections.append("## Headline accuracy")
    sections.append("")
    sections.append(
        f"- **Coarse (positive / negative / mixed / neutral):** "
        f"{coarse_acc:.3f}" if coarse_acc is not None
        else "- Coarse: n/a"
    )
    sections.append(
        f"- **Fine (5-bucket — neg_weak / neg_strong split):** "
        f"{fine_acc:.3f}" if fine_acc is not None
        else "- Fine: n/a"
    )
    sections.append("")

    sections.append("## Per-class precision / recall / F1 (coarse)")
    sections.append("")
    sections.append(_render_per_class_table(metrics["per_class_coarse"]))
    sections.append("")

    sections.append("## Confusion matrix (fine)")
    sections.append("")
    sections.append(
        _render_confusion_matrix(
            metrics["confusion_matrix_fine"], list(FINE_BUCKETS),
        )
    )
    sections.append("")
    sections.append(
        "_Read: a cell at row=`positive`, col=`negative_weak` is "
        "the count of spans whose gold is `positive` but Stage 2 "
        "returned `negative_weak` — i.e. positive_as_negative._"
    )
    sections.append("")

    sections.append("## Errors by attribute")
    sections.append("")
    sections.append(_render_attribute_errors(metrics["errors_by_attribute"]))
    sections.append("")

    sections.append("## Seller-surface risk")
    sections.append("")
    sections.append(
        f"- **Total spans at risk of incorrect surfacing:** "
        f"{risk['total_at_risk']}\n"
        f"- By error_type:"
    )
    for code, n in sorted(
        risk["by_error_type"].items(), key=lambda kv: -kv[1],
    ):
        sections.append(f"  - `{code}`: {n}")
    sections.append("")
    sections.append(
        "_'At risk' = polarity-flip / attribute-mismatch / span-"
        "boundary errors that would surface incorrectly in seller "
        "PDF if uncaught by post-Stage-2 layers (the polarity "
        "guardrail catches a subset; see below)._"
    )
    sections.append("")

    sections.append("## Guardrail catch rate")
    sections.append("")
    if catch.get("catch_rate") is None:
        sections.append("_No polarity-flip errors in the dataset._")
    else:
        sections.append(
            f"- **n polarity errors:** {catch['n_polarity_errors']}\n"
            f"- **caught by guardrail:** {catch['n_caught']}\n"
            f"- **missed:** {catch['n_missed']}\n"
            f"- **catch rate:** {catch['catch_rate']:.2%}"
        )
        if catch.get("missed_samples"):
            sections.append("")
            sections.append("**Missed samples (guardrail did NOT flag):**")
            sections.append("")
            for s in catch["missed_samples"][:8]:
                sections.append(
                    f"- `{s['id']}` (`{s['attribute']}`, claimed=`"
                    f"{s['current_polarity']}` → gold=`{s['gold_polarity']}`)"
                )
                sections.append(f"    > {s['text_excerpt']}")
                if s.get("guardrail_reasons"):
                    sections.append(
                        f"    _guardrail reasons: "
                        f"{s['guardrail_reasons'][:3]}_"
                    )
        if catch.get("caught_samples"):
            sections.append("")
            sections.append("**Caught samples (first 5):**")
            sections.append("")
            for s in catch["caught_samples"]:
                sections.append(
                    f"- `{s['id']}` — guardrail suggested `"
                    f"{s.get('guardrail_suggested')}` "
                    f"(confidence={s.get('guardrail_confidence')})"
                )
    sections.append("")

    sections.append("## Error-type distribution")
    sections.append("")
    sections.append("| error_type | count |")
    sections.append("|---|---:|")
    for code, n in sorted(
        metrics["error_type_distribution"].items(),
        key=lambda kv: -kv[1],
    ):
        sections.append(f"| `{code}` | {n} |")
    sections.append("")

    sections.append("## Recommendations (interpretive — not actions)")
    sections.append("")
    bullets: list[str] = []
    if (catch.get("catch_rate") or 0) < 0.5 and catch.get("n_polarity_errors", 0) > 0:
        bullets.append(
            "Guardrail catch rate is below 50% on this seed. The "
            "guardrail covers only decisive-cue cases; ambiguous or "
            "fragmented spans pass through. Stage 2 prompt + "
            "verifier work (see "
            "`docs/phase2e_stage2_improvement_plan.md`) is the next "
            "lever."
        )
    if risk["total_at_risk"] >= n_total * 0.2:
        bullets.append(
            f"Seller-surface risk count ({risk['total_at_risk']}) is "
            f">=20% of the dataset. Until Stage 2 improves, the "
            f"adapter's `polarity_suspect` filter is doing real work — "
            f"do not relax it."
        )
    if any(
        info["error_rate"] >= 0.5
        for info in metrics["errors_by_attribute"].values()
    ):
        worst = max(
            metrics["errors_by_attribute"].items(),
            key=lambda kv: kv[1]["error_rate"],
        )
        bullets.append(
            f"Attribute-level error rate is highest on `{worst[0]}` "
            f"({worst[1]['error_rate']:.0%}). When prioritizing prompt "
            f"work, consider this attribute first."
        )
    if not bullets:
        bullets.append(
            "No single corrective action stands out from this seed. "
            "Expanding the dataset (target 80–150 rows across multiple "
            "products) is the highest-leverage next step."
        )
    for b in bullets:
        sections.append(f"- {b}")
    sections.append("")

    sections.append("---")
    sections.append("")
    sections.append(
        "_Generated by `scripts/evaluate_phase2e_classification.py`. "
        "JSON sibling alongside this file carries the full structured "
        "metrics for diff/CI consumption._"
    )

    return "\n".join(sections) + "\n"


# ---------------------------------------------------------------------------
# Replay — re-classify the dataset's text with a Stage 2 classifier
# and compute a baseline-vs-replay side-by-side comparison.
# ---------------------------------------------------------------------------


def _row_with_replay(row: dict, rec: PolarityRecord | None) -> dict:
    """Return a copy of `row` with replay fields added.

    `replay_polarity` is the classifier's call (or `"neutral"` when
    the classifier returned None / drop=true). `replay_changed /
    improved / regressed` are derived booleans for downstream
    aggregation.
    """
    if rec is None:
        replay_polarity = "neutral"
        replay_drop = True
        replay_rationale = "(classifier returned None)"
    else:
        replay_polarity = rec.polarity
        replay_drop = bool(rec.drop)
        replay_rationale = rec.rationale or ""

    gold_coarse = _coarse(row["gold_polarity"])
    cur_coarse = _coarse(row["current_polarity"])
    rep_coarse = _coarse(replay_polarity)
    cur_correct = (cur_coarse == gold_coarse)
    rep_correct = (rep_coarse == gold_coarse)
    return {
        **row,
        "replay_polarity": replay_polarity,
        "replay_drop": replay_drop,
        "replay_rationale": replay_rationale,
        "replay_changed": (cur_coarse != rep_coarse),
        "replay_improved": (not cur_correct) and rep_correct,
        "replay_regressed": cur_correct and (not rep_correct),
    }


def run_replay(
    rows: list[dict],
    classifier: PolarityClassifier,
    *,
    progress: bool = False,
) -> list[dict]:
    """Classify every row's text with `classifier`. Returns a new
    list with replay fields populated. Rows are not mutated.

    Pure orchestration over the classifier; no I/O.
    """
    enriched: list[dict] = []
    for i, row in enumerate(rows):
        if progress:
            print(
                f"  [replay {i + 1:>3}/{len(rows)}] {row['id']} "
                f"({row['attribute']})",
                flush=True,
            )
        try:
            rec = classifier.classify(row["text"], row["attribute"])
        except Exception as e:
            # Classifier fault: record as None so eligible rows still
            # contribute to baseline metrics.
            rec = None
            row = {**row, "replay_error": f"{type(e).__name__}: {e}"}
        enriched.append(_row_with_replay(row, rec))
    return enriched


def compute_side_by_side(enriched: list[dict]) -> dict:
    """Aggregate per-row replay outcomes into headline counts +
    sample lists for the Markdown report."""
    n_total = len(enriched)
    n_changed = sum(1 for r in enriched if r["replay_changed"])
    n_improved = sum(1 for r in enriched if r["replay_improved"])
    n_regressed = sum(1 for r in enriched if r["replay_regressed"])
    n_unchanged = n_total - n_changed
    samples_improved = [
        {
            "id": r["id"],
            "attribute": r["attribute"],
            "from": r["current_polarity"],
            "to": r["replay_polarity"],
            "gold": r["gold_polarity"],
            "text_excerpt": r["text"][:120] + (
                "…" if len(r["text"]) > 120 else ""
            ),
            "replay_rationale": r.get("replay_rationale", "")[:160],
        }
        for r in enriched if r["replay_improved"]
    ]
    samples_regressed = [
        {
            "id": r["id"],
            "attribute": r["attribute"],
            "from": r["current_polarity"],
            "to": r["replay_polarity"],
            "gold": r["gold_polarity"],
            "text_excerpt": r["text"][:120] + (
                "…" if len(r["text"]) > 120 else ""
            ),
            "replay_rationale": r.get("replay_rationale", "")[:160],
        }
        for r in enriched if r["replay_regressed"]
    ]
    return {
        "n_total": n_total,
        "n_changed": n_changed,
        "n_unchanged": n_unchanged,
        "n_improved": n_improved,
        "n_regressed": n_regressed,
        "net_delta": n_improved - n_regressed,
        "samples_improved": samples_improved,
        "samples_regressed": samples_regressed,
    }


def _derive_error_type(current_polarity: str, gold_polarity: str) -> str:
    """Derive an error_type-compatible label from a (current, gold)
    polarity pair. Used during replay so seller-surface-risk and
    error-by-attribute aggregates reflect the REPLAY's behavior,
    not the dataset's static annotation.

    Mirrors the seed dataset's labeling discipline:
      - exact match → acceptable_current_label
      - gold positive, current negative_* → positive_as_negative
      - gold negative_*, current positive → negative_as_positive
      - gold mixed, current single side → mixed_should_be_mixed
      - gold neutral, current any sentiment → neutral_or_context_missing
      - any other coarse mismatch → falls back to neutral_or_context_missing
    """
    if current_polarity == gold_polarity:
        return "acceptable_current_label"
    cur_c = _coarse(current_polarity)
    gold_c = _coarse(gold_polarity)
    if cur_c == gold_c:
        # Same coarse family (e.g. negative_weak vs negative_strong)
        # is not a surface-risk error.
        return "acceptable_current_label"
    if gold_c == "positive" and cur_c == "negative":
        return "positive_as_negative"
    if gold_c == "negative" and cur_c == "positive":
        return "negative_as_positive"
    if gold_c == "mixed" and cur_c in ("positive", "negative"):
        return "mixed_should_be_mixed"
    if gold_c == "neutral":
        return "neutral_or_context_missing"
    return "neutral_or_context_missing"


def evaluate_replay(enriched: list[dict]) -> dict:
    """Compute the same metric pack as `evaluate()`, but on the
    replay polarity values. Reuses `evaluate()` by swapping
    `current_polarity` → `replay_polarity` AND deriving a fresh
    `error_type` from the replay-vs-gold pair.

    Without the error_type re-derivation, `seller_surface_risk`
    would echo the dataset's static annotation (i.e. the v1 baseline
    error pattern) regardless of what the replay actually produced.
    """
    swapped = [
        {
            **r,
            "current_polarity": r["replay_polarity"],
            "error_type": _derive_error_type(
                r["replay_polarity"], r["gold_polarity"],
            ),
        }
        for r in enriched
    ]
    return evaluate(swapped)


def render_replay_markdown(
    *,
    baseline_metrics: dict,
    replay_metrics: dict,
    side_by_side: dict,
    dataset_path: Path,
    ran_at_utc: str,
    model: str,
    prompt_version: str,
    n_replayed: int,
) -> str:
    """Markdown report for replay mode — adds a side-by-side block
    on top of the standard report sections."""
    sections: list[str] = []
    sections.append("# Phase 2E classification — replay eval")
    sections.append("")
    sections.append(
        f"> ⚠ **Seed eval, NOT a production benchmark.** Direction-"
        f"of-error indicators only."
    )
    sections.append("")
    sections.append(
        f"- **Generated:** `{ran_at_utc}`\n"
        f"- **Dataset:** `{dataset_path}`\n"
        f"- **Replayed rows:** {n_replayed}\n"
        f"- **Model:** `{model}`\n"
        f"- **Prompt version:** `{prompt_version}`"
    )
    sections.append("")

    # ---- Side-by-side ----
    sections.append("## Baseline vs replay (headline)")
    sections.append("")
    sections.append("| metric | baseline | replay | delta |")
    sections.append("|---|---:|---:|---:|")
    for label, k in (
        ("coarse accuracy", "accuracy_coarse"),
        ("fine accuracy", "accuracy_fine"),
    ):
        b = baseline_metrics.get(k)
        r = replay_metrics.get(k)
        if b is None or r is None:
            continue
        delta = r - b
        delta_s = f"{delta:+.4f}"
        sections.append(
            f"| {label} | {b:.4f} | {r:.4f} | {delta_s} |"
        )
    risk_b = baseline_metrics["seller_surface_risk"]["total_at_risk"]
    risk_r = replay_metrics["seller_surface_risk"]["total_at_risk"]
    sections.append(
        f"| seller-surface risk count | {risk_b} | {risk_r} | "
        f"{risk_r - risk_b:+d} |"
    )
    catch_b = baseline_metrics["guardrail_catch_rate"].get("catch_rate")
    catch_r = replay_metrics["guardrail_catch_rate"].get("catch_rate")
    if catch_b is not None and catch_r is not None:
        sections.append(
            f"| guardrail catch rate | {catch_b:.4f} | {catch_r:.4f} | "
            f"{catch_r - catch_b:+.4f} |"
        )
    sections.append("")
    sections.append(
        "_Lower seller-surface risk is better. Higher catch rate "
        "is better only when polarity errors still exist; if "
        "replay drives errors to zero, catch rate naturally drops._"
    )
    sections.append("")

    # ---- Per-class deltas ----
    sections.append("## Per-class precision / recall / F1 — coarse")
    sections.append("")
    sections.append(
        "| class | P (base) | P (rep) | R (base) | R (rep) | "
        "F1 (base) | F1 (rep) | support |"
    )
    sections.append(
        "|---|---:|---:|---:|---:|---:|---:|---:|"
    )
    for cls in COARSE_BUCKETS:
        b = baseline_metrics["per_class_coarse"].get(cls, {})
        r = replay_metrics["per_class_coarse"].get(cls, {})
        sections.append(
            f"| `{cls}` | "
            f"{b.get('precision', 0):.3f} | {r.get('precision', 0):.3f} | "
            f"{b.get('recall', 0):.3f} | {r.get('recall', 0):.3f} | "
            f"{b.get('f1', 0):.3f} | {r.get('f1', 0):.3f} | "
            f"{b.get('support', 0)} |"
        )
    sections.append("")

    # ---- Row-level outcomes ----
    sections.append("## Row-level outcomes")
    sections.append("")
    sxs = side_by_side
    sections.append(
        f"- **Total replayed:** {sxs['n_total']}\n"
        f"- **Changed (current ≠ replay, coarse):** {sxs['n_changed']}\n"
        f"- **Unchanged:** {sxs['n_unchanged']}\n"
        f"- **Improved (replay matches gold; current didn't):** {sxs['n_improved']}\n"
        f"- **Regressed (current matched gold; replay doesn't):** {sxs['n_regressed']}\n"
        f"- **Net delta (improved − regressed):** "
        f"{sxs['net_delta']:+d}"
    )
    sections.append("")

    if sxs["samples_improved"]:
        sections.append("**Improved samples (first 10):**")
        sections.append("")
        for s in sxs["samples_improved"][:10]:
            sections.append(
                f"- `{s['id']}` (`{s['attribute']}`) — "
                f"`{s['from']}` → `{s['to']}` (gold=`{s['gold']}`)"
            )
            sections.append(f"    > {s['text_excerpt']}")
            if s.get("replay_rationale"):
                sections.append(f"    _replay rationale: {s['replay_rationale']}_")
        sections.append("")

    if sxs["samples_regressed"]:
        sections.append("**Regressed samples (all):**")
        sections.append("")
        for s in sxs["samples_regressed"]:
            sections.append(
                f"- `{s['id']}` (`{s['attribute']}`) — "
                f"`{s['from']}` → `{s['to']}` (gold=`{s['gold']}`)"
            )
            sections.append(f"    > {s['text_excerpt']}")
            if s.get("replay_rationale"):
                sections.append(f"    _replay rationale: {s['replay_rationale']}_")
        sections.append("")

    # ---- Replay confusion matrix ----
    sections.append("## Replay confusion matrix (fine)")
    sections.append("")
    sections.append(
        "_Read: row=gold, column=replay's prediction._"
    )
    sections.append("")
    cm = replay_metrics["confusion_matrix_fine"]
    header = "| gold \\ rep | " + " | ".join(
        f"`{p}`" for p in FINE_BUCKETS
    ) + " |"
    sep = "|---|" + "---:|" * len(FINE_BUCKETS)
    sections.append(header)
    sections.append(sep)
    for g in FINE_BUCKETS:
        cells = [f"**`{g}`**"] + [str(cm[g][p]) for p in FINE_BUCKETS]
        sections.append("| " + " | ".join(cells) + " |")
    sections.append("")

    sections.append("---")
    sections.append("")
    sections.append(
        "_Generated by `scripts/evaluate_phase2e_classification.py "
        "--replay-stage2`. Sibling JSON carries the full structured "
        "metrics including per-row replay outcomes._"
    )
    return "\n".join(sections) + "\n"


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="evaluate_phase2e_classification",
        description=__doc__.split("\n\n")[0],
    )
    p.add_argument(
        "--dataset", type=Path,
        default=REPO / "eval_data" / "phase2e" / "polarity_eval.jsonl",
        help="Path to the JSONL seed dataset.",
    )
    p.add_argument(
        "--out-dir", type=Path,
        default=REPO / "outputs" / "eval",
        help="Where the JSON + Markdown reports land. Created if missing.",
    )
    p.add_argument(
        "--run-stage2", action="store_true",
        help=(
            "Reserved. When set, re-classify every text with the live "
            "Stage 2 LLM and overwrite `current_polarity` before "
            "scoring. Not implemented in this seed runner — current "
            "behavior evaluates the dataset's recorded labels."
        ),
    )
    p.add_argument(
        "--replay-stage2", action="store_true",
        help=(
            "Re-classify every text with the live Stage 2 classifier "
            "(OpenAI by default) and produce a baseline-vs-replay "
            "side-by-side report. Requires OPENAI_API_KEY in env or "
            ".env. Without the key the script exits non-zero and "
            "prints the manual command."
        ),
    )
    p.add_argument(
        "--model", default="gpt-4o-mini",
        help="Model name for replay (default: gpt-4o-mini).",
    )
    p.add_argument(
        "--prompt-version", default=PROMPT_VERSION_V2_SKINCARE,
        choices=list(ALLOWED_PROMPT_VERSIONS),
        help=(
            "Stage 2 prompt variant to use during replay. Default is "
            "the v2 skincare-sentiment prompt; pass "
            "`v1_makeup_focused` to replay the baseline."
        ),
    )
    p.add_argument(
        "--limit", type=int, default=None,
        help=(
            "Replay only the first N rows. Useful for cheap smoke "
            "tests. Default: all rows."
        ),
    )
    p.add_argument(
        "--out-prefix", default=None,
        help=(
            "Override the output filename prefix. Default: "
            "`phase2e_classification_eval` for baseline mode, "
            "`phase2e_classification_replay` for replay mode."
        ),
    )
    p.add_argument(
        "--cache-path",
        default="/tmp/phase2e_replay_cache.json",
        help=(
            "Where the replay classifier caches API responses. "
            "Default: /tmp/phase2e_replay_cache.json. "
            "Cache key includes prompt_version so v1/v2 caches "
            "never collide."
        ),
    )
    p.add_argument(
        "--show-progress", action="store_true",
        help="Print per-row progress during replay.",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    if not args.dataset.is_file():
        print(f"✗ dataset not found: {args.dataset}", file=sys.stderr)
        return 2

    if args.run_stage2:
        print(
            "⚠ --run-stage2 is reserved and not implemented in the "
            "seed runner. Evaluating recorded labels.",
            file=sys.stderr,
        )

    try:
        rows = load_dataset(args.dataset)
    except DatasetValidationError as e:
        print(f"✗ dataset schema error: {e}", file=sys.stderr)
        return 3

    if args.replay_stage2:
        return _run_replay_mode(args, rows)

    return _run_baseline_mode(args, rows)


def _run_baseline_mode(args, rows: list[dict]) -> int:
    metrics = evaluate(rows)
    ran_at_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    ts_slug = ran_at_utc.replace(":", "").replace("-", "")
    args.out_dir.mkdir(parents=True, exist_ok=True)
    prefix = args.out_prefix or "phase2e_classification_eval"
    json_path = args.out_dir / f"{prefix}_{ts_slug}.json"
    md_path = args.out_dir / f"{prefix}_{ts_slug}.md"

    json_payload = {
        "schema_version": "1.0",
        "kind": "phase2e_seed_classification_eval",
        "ran_at_utc": ran_at_utc,
        "dataset_path": str(args.dataset.resolve()),
        "metrics": metrics,
    }
    json_path.write_text(
        json.dumps(json_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    md_path.write_text(
        render_markdown(metrics, dataset_path=args.dataset, ran_at_utc=ran_at_utc),
        encoding="utf-8",
    )

    print(f"✓ seed eval complete")
    print(f"  json: {json_path}")
    print(f"  md  : {md_path}")
    print()
    print(f"  rows           : {metrics['n_total']}")
    print(f"  evaluated      : {metrics['n_evaluated']}")
    if metrics["accuracy_coarse"] is not None:
        print(
            f"  coarse acc     : {metrics['accuracy_coarse']:.3f}"
        )
    if metrics["accuracy_fine"] is not None:
        print(
            f"  fine acc       : {metrics['accuracy_fine']:.3f}"
        )
    print(
        f"  surface risk   : {metrics['seller_surface_risk']['total_at_risk']}"
    )
    catch = metrics["guardrail_catch_rate"]
    if catch.get("catch_rate") is not None:
        print(
            f"  guardrail catch: "
            f"{catch['n_caught']}/{catch['n_polarity_errors']} "
            f"({catch['catch_rate']:.0%})"
        )
    return 0


def _run_replay_mode(args, rows: list[dict]) -> int:
    """Replay every dataset row through the Stage 2 classifier and
    write the side-by-side baseline-vs-replay report. Without an
    API key, exits non-zero and prints the manual command."""
    # Lazy import — keeps unit tests free of openai SDK dependency.
    try:
        from src.voc.reporting.phase2e.stage2 import OpenAIClassifier
    except ImportError as e:
        print(f"✗ cannot import OpenAIClassifier: {e}", file=sys.stderr)
        return 5
    try:
        classifier = OpenAIClassifier(
            model=args.model,
            cache_path=str(args.cache_path),
            prompt_version=args.prompt_version,
        )
    except RuntimeError as e:
        # Almost always: OPENAI_API_KEY not set, or openai SDK not
        # installed. Print the exact manual command for the operator.
        print(f"✗ replay cannot start: {e}", file=sys.stderr)
        print(file=sys.stderr)
        print(
            "  Set OPENAI_API_KEY in env or .env and re-run:",
            file=sys.stderr,
        )
        print(file=sys.stderr)
        print(
            f"    PYTHONPATH=. python3 scripts/evaluate_phase2e_classification.py \\",
            file=sys.stderr,
        )
        print(
            f"        --replay-stage2 \\",
            file=sys.stderr,
        )
        print(
            f"        --dataset {args.dataset} \\",
            file=sys.stderr,
        )
        print(
            f"        --model {args.model} \\",
            file=sys.stderr,
        )
        print(
            f"        --prompt-version {args.prompt_version}",
            file=sys.stderr,
        )
        return 6

    if args.limit is not None:
        rows = rows[:max(0, int(args.limit))]

    print(
        f"▶ replay: {len(rows)} rows, model={args.model}, "
        f"prompt={args.prompt_version}",
    )
    enriched = run_replay(rows, classifier, progress=args.show_progress)
    baseline_metrics = evaluate(rows)
    replay_metrics = evaluate_replay(enriched)
    side_by_side = compute_side_by_side(enriched)

    ran_at_utc = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    ts_slug = ran_at_utc.replace(":", "").replace("-", "")
    args.out_dir.mkdir(parents=True, exist_ok=True)
    prefix = args.out_prefix or "phase2e_classification_replay"
    json_path = args.out_dir / f"{prefix}_{ts_slug}.json"
    md_path = args.out_dir / f"{prefix}_{ts_slug}.md"

    json_payload = {
        "schema_version": "1.0",
        "kind": "phase2e_seed_classification_replay",
        "ran_at_utc": ran_at_utc,
        "dataset_path": str(args.dataset.resolve()),
        "model": args.model,
        "prompt_version": args.prompt_version,
        "n_replayed": len(enriched),
        "baseline_metrics": baseline_metrics,
        "replay_metrics": replay_metrics,
        "side_by_side": side_by_side,
        "rows": enriched,
    }
    json_path.write_text(
        json.dumps(json_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    md_path.write_text(
        render_replay_markdown(
            baseline_metrics=baseline_metrics,
            replay_metrics=replay_metrics,
            side_by_side=side_by_side,
            dataset_path=args.dataset,
            ran_at_utc=ran_at_utc,
            model=args.model,
            prompt_version=args.prompt_version,
            n_replayed=len(enriched),
        ),
        encoding="utf-8",
    )

    print(f"✓ replay eval complete")
    print(f"  json: {json_path}")
    print(f"  md  : {md_path}")
    print()
    print(
        f"  baseline coarse acc : {baseline_metrics['accuracy_coarse']:.3f}"
    )
    print(
        f"  replay   coarse acc : {replay_metrics['accuracy_coarse']:.3f}"
        f"  ({replay_metrics['accuracy_coarse'] - baseline_metrics['accuracy_coarse']:+.3f})"
    )
    print(
        f"  baseline surface risk : {baseline_metrics['seller_surface_risk']['total_at_risk']}"
    )
    print(
        f"  replay   surface risk : {replay_metrics['seller_surface_risk']['total_at_risk']}"
        f"  ({replay_metrics['seller_surface_risk']['total_at_risk'] - baseline_metrics['seller_surface_risk']['total_at_risk']:+d})"
    )
    print(
        f"  improved              : {side_by_side['n_improved']}"
    )
    print(
        f"  regressed             : {side_by_side['n_regressed']}"
    )
    print(
        f"  net delta             : {side_by_side['net_delta']:+d}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
