"""Phase 2E Stage 2 — full-seed polarity classification eval.

For each (review, attribute) pair in seed_v0.2.json:
  1. Fetch review text from voc_data.db
  2. Extract narrow clause around the seed's evidence_span anchor
  3. Run Stage 2 classifier (OpenAI gpt-4o-mini by default; --stub for offline)
  4. Compare predicted polarity / intensity to seed values

Outputs:
  - /tmp/phase2e_stage2_eval_results.json (per-record detail)
  - stdout summary (overall accuracy, per-attribute, confusion matrix)

Usage:
  PYTHONPATH=. python3 scripts/eval_phase2e_stage2.py            # real LLM
  PYTHONPATH=. python3 scripts/eval_phase2e_stage2.py --stub     # heuristic
  PYTHONPATH=. python3 scripts/eval_phase2e_stage2.py --limit 10 # quick smoke

NO DB writes. Reads seed and DB review text only.
"""
from __future__ import annotations
import argparse
import json
import sqlite3
import sys
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from src.voc.reporting.phase2e.stage2 import (  # noqa: E402
    OpenAIClassifier,
    StubClassifier,
    extract_clause,
    extract_narrow_clause,
)

SEED_PATH = REPO / "eval_data/phase2e/seed_v0.2.json"
DB_PATH = REPO / "voc_data.db"
OUT_PATH = Path("/tmp/phase2e_stage2_eval_results.json")
CACHE_PATH = "/tmp/phase2e_stage2_cache.json"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stub", action="store_true", help="use deterministic stub classifier (no API calls)")
    ap.add_argument("--limit", type=int, default=0, help="limit to first N records (smoke testing)")
    ap.add_argument("--model", default="gpt-4o-mini")
    args = ap.parse_args()

    seed = json.load(open(SEED_PATH))
    con = sqlite3.connect(DB_PATH)

    if args.stub:
        classifier = StubClassifier()
        model_id = "stub"
    else:
        classifier = OpenAIClassifier(model=args.model, cache_path=CACHE_PATH)
        model_id = args.model

    # Cache review text by review_id
    rid_to_text: dict[str, str] = {}

    records = seed["records"]
    if args.limit > 0:
        records = records[:args.limit]

    results = []
    for i, r in enumerate(records, 1):
        rid = r["review_id"]
        if rid not in rid_to_text:
            row = con.execute("SELECT text FROM phase1_reviews WHERE review_id=?", (rid,)).fetchone()
            rid_to_text[rid] = row[0] if row else ""
        text = rid_to_text[rid]
        attribute = r["attribute"]
        # Use the seed's evidence_span as the clause (already the precise
        # human-annotator window). For E2E (production) Stage 2 will use
        # Stage 1's matched_text snippet instead. Adding ±30 chars of context
        # for disambiguation when polarity hinges on adjacent words.
        evidence_span = (r.get("evidence_span") or "").lstrip("…").rstrip("…").strip()
        if evidence_span:
            # v0.3 (Option A): W1+W2 narrow extractor.
            #   W1: if evidence_span has an evaluative marker, use it directly
            #   W2: otherwise pick the shortest clause containing the span
            clause = extract_narrow_clause(text, evidence_span, max_chars=80)
        else:
            clause = text[:80]
        pred = classifier.classify(clause, attribute)

        result = {
            "calib_id": r.get("calib_id"),
            "sample_key": r.get("sample_key"),
            "review_id_short": rid[:12],
            "attribute": attribute,
            "human_polarity": r["polarity"],
            "human_intensity": r["intensity"],
            "human_evidence_span": r.get("evidence_span", ""),
            "clause": clause,
            "predicted_polarity": pred.polarity if pred else None,
            "predicted_intensity": pred.intensity if pred else None,
            "predicted_drop": pred.drop if pred else True,
            "predicted_confidence": pred.confidence if pred else "low",
            "predicted_evidence_span": pred.evidence_span if pred else "",
            "predicted_rationale": pred.rationale if pred else "",
            "polarity_match": pred is not None and not pred.drop and pred.polarity == r["polarity"],
            "intensity_match": pred is not None and not pred.drop and pred.intensity == r["intensity"],
        }
        results.append(result)
        if i % 20 == 0:
            print(f"  ... {i}/{len(records)} processed")
    con.close()

    # Aggregate
    n = len(results)
    n_polarity_match = sum(1 for r in results if r["polarity_match"])
    n_intensity_match = sum(1 for r in results if r["intensity_match"])
    n_drop = sum(1 for r in results if r["predicted_drop"])

    polarity_acc = n_polarity_match / n if n else 0.0
    intensity_acc = n_intensity_match / n if n else 0.0

    # Per-attribute accuracy
    per_attr_total = defaultdict(int)
    per_attr_match = defaultdict(int)
    for r in results:
        per_attr_total[r["attribute"]] += 1
        if r["polarity_match"]:
            per_attr_match[r["attribute"]] += 1

    # Confusion matrix (human polarity → predicted polarity)
    confusion = defaultdict(Counter)
    for r in results:
        h = r["human_polarity"]
        p = r["predicted_polarity"] if (r["predicted_polarity"] and not r["predicted_drop"]) else "DROP/None"
        confusion[h][p] += 1

    summary = {
        "model": model_id,
        "n_records": n,
        "polarity_accuracy": polarity_acc,
        "intensity_accuracy": intensity_acc,
        "n_drop": n_drop,
        "drop_rate": n_drop / n if n else 0.0,
        "per_attribute_accuracy": {
            a: {
                "match": per_attr_match[a],
                "total": per_attr_total[a],
                "accuracy": per_attr_match[a] / per_attr_total[a] if per_attr_total[a] else 0.0,
            }
            for a in sorted(per_attr_total)
        },
        "confusion_matrix": {h: dict(c) for h, c in confusion.items()},
        "results": results,
    }
    OUT_PATH.write_text(json.dumps(summary, ensure_ascii=False, indent=2))

    # Print summary
    print()
    print("=" * 70)
    print(f"Phase 2E Stage 2 — eval (model={model_id})")
    print("=" * 70)
    print(f"records evaluated: {n}")
    print(f"polarity accuracy: {polarity_acc:.2%} ({n_polarity_match}/{n})")
    print(f"intensity accuracy: {intensity_acc:.2%} ({n_intensity_match}/{n})")
    print(f"drop rate: {n_drop / n:.2%} ({n_drop}/{n})")
    print()
    print("Per-attribute polarity accuracy:")
    for a in sorted(per_attr_total):
        stats = summary["per_attribute_accuracy"][a]
        print(f"  {a:35s} {stats['match']:3d}/{stats['total']:3d} ({stats['accuracy']:.0%})")
    print()
    print("Confusion matrix (rows = human polarity, cols = predicted):")
    headers = sorted({p for c in confusion.values() for p in c.keys()})
    print(f"  {'human \\\\ pred':<20s}", *(f"{h:>16s}" for h in headers))
    for h in sorted(confusion):
        cells = [f"{confusion[h].get(p, 0):>16d}" for p in headers]
        print(f"  {h:<20s}", *cells)
    print()
    print(f"wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
