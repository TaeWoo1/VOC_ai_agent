"""Phase 2E end-to-end pipeline eval.

Pipeline: Stage 1 → Stage 2 → Stage 3 aggregation, run on every review in
seed_v0.2.json. Compares against human seed records at both record-level
and review-level (mixed_review_flag, tradeoff_pair).

This is the FIRST eval where Stage 1's `matched_text` (not the seed's
`evidence_span`) drives the Stage 2 clause window. Honest E2E condition.

Outputs:
  - /tmp/phase2e_e2e_eval_results.json
  - stdout summary

Usage:
  PYTHONPATH=. python3 scripts/eval_phase2e_e2e.py            # real LLM
  PYTHONPATH=. python3 scripts/eval_phase2e_e2e.py --stub     # heuristic
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

from src.voc.reporting.phase2e.stage1 import extract as stage1_extract  # noqa: E402
from src.voc.reporting.phase2e.stage2 import (  # noqa: E402
    OpenAIClassifier,
    StubClassifier,
    extract_narrow_clause,
)
from src.voc.reporting.phase2e.aggregate import aggregate  # noqa: E402

SEED_PATH = REPO / "eval_data/phase2e/seed_v0.2.json"
DB_PATH = REPO / "voc_data.db"
OUT_PATH = Path("/tmp/phase2e_e2e_eval_results.json")
CACHE_PATH = "/tmp/phase2e_e2e_cache.json"


def sample_id(r: dict) -> str:
    return r.get("sample_key") or r.get("calib_id") or r["review_id"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stub", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
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

    # Group seed records per sample (review_id-level aggregation of human truth)
    seed_by_sample: dict[str, dict] = {}
    for r in seed["records"]:
        sid = sample_id(r)
        if sid not in seed_by_sample:
            seed_by_sample[sid] = {
                "sample_id": sid,
                "review_id": r["review_id"],
                "product_id": r["product_id"],
                "product_name": r["product_name"],
                "human_records": [],
                "human_attrs": set(),
                "human_polarities_by_attr": {},
                "mixed_review_flag": r["mixed_review_flag"],
                "tradeoff_pair": r.get("tradeoff_pair"),
            }
        seed_by_sample[sid]["human_records"].append({
            "attribute": r["attribute"],
            "polarity": r["polarity"],
            "intensity": r["intensity"],
            "evidence_span": r.get("evidence_span", ""),
            "delivery_condition_flag": r.get("delivery_condition_flag", False),
        })
        seed_by_sample[sid]["human_attrs"].add(r["attribute"])
        seed_by_sample[sid]["human_polarities_by_attr"].setdefault(r["attribute"], []).append(r["polarity"])

    samples = list(seed_by_sample.values())
    if args.limit > 0:
        samples = samples[:args.limit]

    review_results = []
    record_results: list[dict] = []
    for i, s in enumerate(samples, 1):
        rid = s["review_id"]
        text_row = con.execute("SELECT text FROM phase1_reviews WHERE review_id=?", (rid,)).fetchone()
        text = text_row[0] if text_row else ""

        # Stage 1
        candidates = stage1_extract(rid, text)

        # Stage 2: classify each candidate (clause from extract_narrow_clause)
        polarity_records = []
        per_record_detail = []
        for cand in candidates:
            clause = extract_narrow_clause(text, cand.matched_text, max_chars=80)
            rec = classifier.classify(clause, cand.attribute)
            per_record_detail.append({
                "attribute": cand.attribute,
                "stage1_matched_text": cand.matched_text,
                "clause": clause,
                "stage2_polarity": rec.polarity if rec else None,
                "stage2_intensity": rec.intensity if rec else None,
                "stage2_drop": rec.drop if rec else True,
                "stage2_confidence": rec.confidence if rec else None,
            })
            if rec and not rec.drop:
                polarity_records.append(rec)

        # Stage 3: aggregate
        agg = aggregate(rid, polarity_records, review_text=text)

        # Build per-record eval comparing against seed
        for det in per_record_detail:
            attr = det["attribute"]
            human_polarities = s["human_polarities_by_attr"].get(attr)
            if human_polarities:
                # Pick first human polarity for that attr (most samples have 1 record per attr)
                human_pol = human_polarities[0]
                pred_pol = det["stage2_polarity"]
                pred_drop = det["stage2_drop"]
                polarity_match = (pred_pol == human_pol and not pred_drop)
            else:
                # Pipeline detected an attribute the human didn't annotate
                # → false positive on attribute (already filtered by drop=true ideally)
                human_pol = None
                pred_pol = det["stage2_polarity"]
                pred_drop = det["stage2_drop"]
                polarity_match = pred_drop  # if dropped, no mismatch
            record_results.append({
                "sample_id": s["sample_id"],
                "attribute": attr,
                "human_polarity": human_pol,
                "predicted_polarity": pred_pol,
                "predicted_drop": pred_drop,
                "polarity_match": polarity_match,
                "human_present": human_pol is not None,
            })

        # Review-level eval: mixed_review_flag, tradeoff_pair, attribute coverage
        detected_attrs = sorted({r.attribute for r in agg.records})
        human_attrs = sorted(s["human_attrs"])
        coverage_intersect = sorted(set(detected_attrs) & set(human_attrs))
        attr_recall = len(coverage_intersect) / len(human_attrs) if human_attrs else 0.0
        attr_precision = len(coverage_intersect) / len(detected_attrs) if detected_attrs else 0.0

        # Mixed flag accuracy
        mixed_flag_match = (agg.mixed_review_flag == s["mixed_review_flag"])

        # Tradeoff_pair: loose-match (both attributes overlap with seed pair attributes)
        seed_tp = s["tradeoff_pair"] or ""
        pred_tp = agg.tradeoff_pair or ""
        tp_match_strict = (pred_tp == seed_tp)
        tp_loose_match = False
        if pred_tp and seed_tp:
            import re
            seed_attrs_in_pair = set(re.findall(r"([a-z_]+):", seed_tp))
            pred_attrs_in_pair = set(re.findall(r"([a-z_]+):", pred_tp))
            tp_loose_match = bool(seed_attrs_in_pair & pred_attrs_in_pair)
        # If both seed and pipeline have NO tradeoff_pair, that's a match
        if not pred_tp and not seed_tp:
            tp_loose_match = True
            tp_match_strict = True

        # Insight-level: do they agree on overall sentiment direction?
        seed_has_neg = any(p in ("negative_weak", "negative_strong", "mixed") for p in
                            [hr["polarity"] for hr in s["human_records"]])
        pipeline_has_neg = any(r.polarity in ("negative_weak", "negative_strong", "mixed") for r in agg.records)
        insight_neg_match = (seed_has_neg == pipeline_has_neg)

        review_results.append({
            "sample_id": s["sample_id"],
            "product_name": s["product_name"],
            "n_human_attrs": len(human_attrs),
            "n_detected_attrs": len(detected_attrs),
            "human_attrs": human_attrs,
            "detected_attrs": detected_attrs,
            "missed_attrs": sorted(set(human_attrs) - set(detected_attrs)),
            "false_pos_attrs": sorted(set(detected_attrs) - set(human_attrs)),
            "attr_recall": attr_recall,
            "attr_precision": attr_precision,
            "human_mixed_flag": s["mixed_review_flag"],
            "pred_mixed_flag": agg.mixed_review_flag,
            "mixed_flag_match": mixed_flag_match,
            "human_tradeoff_pair": seed_tp or None,
            "pred_tradeoff_pair": pred_tp or None,
            "tradeoff_pair_strict_match": tp_match_strict,
            "tradeoff_pair_loose_match": tp_loose_match,
            "insight_negative_direction_match": insight_neg_match,
            "per_record_detail": per_record_detail,
        })

        if i % 10 == 0:
            print(f"  ... {i}/{len(samples)} processed")

    con.close()

    # Aggregate metrics
    n_samples = len(review_results)
    mixed_flag_acc = sum(1 for r in review_results if r["mixed_flag_match"]) / n_samples
    tp_strict_acc = sum(1 for r in review_results if r["tradeoff_pair_strict_match"]) / n_samples
    tp_loose_acc = sum(1 for r in review_results if r["tradeoff_pair_loose_match"]) / n_samples
    insight_neg_acc = sum(1 for r in review_results if r["insight_negative_direction_match"]) / n_samples
    avg_attr_recall = sum(r["attr_recall"] for r in review_results) / n_samples
    avg_attr_precision = sum(r["attr_precision"] for r in review_results) / n_samples

    # Record-level
    n_record_with_human = sum(1 for r in record_results if r["human_present"])
    n_record_pol_match = sum(1 for r in record_results if r["human_present"] and r["polarity_match"])
    record_pol_acc = n_record_pol_match / n_record_with_human if n_record_with_human else 0.0

    # Mixed-flag confusion
    mixed_confusion = Counter()
    for r in review_results:
        mixed_confusion[(r["human_mixed_flag"], r["pred_mixed_flag"])] += 1

    summary = {
        "model": model_id,
        "n_samples": n_samples,
        "n_record_with_human": n_record_with_human,
        "n_record_pol_match": n_record_pol_match,
        "record_polarity_accuracy": record_pol_acc,
        "review_level": {
            "mixed_flag_accuracy": mixed_flag_acc,
            "tradeoff_pair_strict_accuracy": tp_strict_acc,
            "tradeoff_pair_loose_accuracy": tp_loose_acc,
            "insight_negative_direction_accuracy": insight_neg_acc,
            "avg_attribute_recall": avg_attr_recall,
            "avg_attribute_precision": avg_attr_precision,
        },
        "mixed_flag_confusion": {f"human={k[0]},pred={k[1]}": v for k, v in mixed_confusion.items()},
        "review_results": review_results,
        "record_results": record_results,
    }
    OUT_PATH.write_text(json.dumps(summary, ensure_ascii=False, indent=2))

    # Print summary
    print()
    print("=" * 70)
    print(f"Phase 2E E2E eval (model={model_id})")
    print("=" * 70)
    print(f"samples: {n_samples}")
    print(f"record-level polarity accuracy (where pipeline detected human attribute): "
          f"{record_pol_acc:.2%} ({n_record_pol_match}/{n_record_with_human})")
    print()
    print("Review-level metrics:")
    print(f"  mixed_review_flag accuracy:          {mixed_flag_acc:.2%}")
    print(f"  tradeoff_pair strict accuracy:       {tp_strict_acc:.2%}")
    print(f"  tradeoff_pair loose accuracy:        {tp_loose_acc:.2%}  (any attr overlap)")
    print(f"  insight (negative direction) acc:    {insight_neg_acc:.2%}")
    print(f"  avg attribute recall (per sample):   {avg_attr_recall:.2%}")
    print(f"  avg attribute precision (per sample): {avg_attr_precision:.2%}")
    print()
    print("Mixed-flag confusion:")
    for k, v in sorted(mixed_confusion.items(), key=lambda x: (str(x[0][0]), str(x[0][1]))):
        print(f"  human={str(k[0]):<5s} pred={str(k[1]):<5s}: {v}")
    print()
    print(f"wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
