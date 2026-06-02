"""Phase 2E Stage 1 — calibration recall eval (read-only).

Runs the new attribute candidate extractor against the 8-sample calibration
seed and measures attribute-mention recall + precision.

Usage:

    PYTHONPATH=. python3 scripts/eval_phase2e_stage1.py

Outputs:
  - /tmp/phase2e_stage1_eval_results.json (per-sample detail)
  - stdout summary

NO DB writes. NO lexicon edits. NO production integration.
"""
from __future__ import annotations
import json
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

from src.voc.reporting.phase2e.stage1 import extract  # noqa: E402

SEED_PATH = REPO / "eval_data/phase2e/seed_v0.2_calibration.json"
DB_PATH = REPO / "voc_data.db"
OUT_PATH = Path("/tmp/phase2e_stage1_eval_results.json")


def main() -> None:
    seed = json.load(open(SEED_PATH))
    con = sqlite3.connect(DB_PATH)

    # Group seed records by calib_id, collect human attribute set per sample
    by_calib: dict[str, dict] = {}
    for r in seed["records"]:
        cid = r["calib_id"]
        if cid not in by_calib:
            by_calib[cid] = {
                "calib_id": cid,
                "review_id": r["review_id"],
                "product_id": r["product_id"],
                "product_name": r["product_name"],
                "human_attributes": set(),
                "human_records_by_attr": defaultdict(list),
            }
        by_calib[cid]["human_attributes"].add(r["attribute"])
        by_calib[cid]["human_records_by_attr"][r["attribute"]].append({
            "polarity": r["polarity"],
            "evidence_span": r.get("evidence_span", ""),
        })

    results = []
    total_human_pairs = 0
    total_detected_pairs = 0
    total_intersection = 0

    for cid, sample in by_calib.items():
        rid = sample["review_id"]
        row = con.execute(
            "SELECT text FROM phase1_reviews WHERE review_id=?", (rid,)
        ).fetchone()
        text = row[0] if row else ""

        candidates = extract(rid, text)
        detected_attrs = sorted({c.attribute for c in candidates})
        human_attrs = sorted(sample["human_attributes"])

        intersection = sorted(set(detected_attrs) & set(human_attrs))
        missed = sorted(set(human_attrs) - set(detected_attrs))
        false_pos = sorted(set(detected_attrs) - set(human_attrs))

        sample_recall = len(intersection) / len(human_attrs) if human_attrs else 0
        sample_precision = (
            len(intersection) / len(detected_attrs) if detected_attrs else 0
        )

        total_human_pairs += len(human_attrs)
        total_detected_pairs += len(detected_attrs)
        total_intersection += len(intersection)

        results.append({
            "calib_id": cid,
            "product_name": sample["product_name"],
            "review_id_short": rid[:12],
            "n_human_attrs": len(human_attrs),
            "n_detected_attrs": len(detected_attrs),
            "human_attrs": human_attrs,
            "detected_attrs": detected_attrs,
            "intersection": intersection,
            "missed": missed,
            "false_positives": false_pos,
            "sample_recall": sample_recall,
            "sample_precision": sample_precision,
            "candidates": [
                {"attribute": c.attribute, "matched_text": c.matched_text}
                for c in candidates
            ],
        })

    con.close()

    # Aggregate
    agg_recall = total_intersection / total_human_pairs if total_human_pairs else 0
    agg_precision = (
        total_intersection / total_detected_pairs if total_detected_pairs else 0
    )

    # Per-attribute recall (across all calibration samples)
    attr_total: dict[str, int] = defaultdict(int)
    attr_captured: dict[str, int] = defaultdict(int)
    for r in results:
        for a in r["human_attrs"]:
            attr_total[a] += 1
            if a in r["detected_attrs"]:
                attr_captured[a] += 1

    summary = {
        "n_samples": len(results),
        "total_human_attribute_pairs": total_human_pairs,
        "total_detected_attribute_pairs": total_detected_pairs,
        "total_intersection": total_intersection,
        "aggregate_recall": agg_recall,
        "aggregate_precision": agg_precision,
        "target_recall": 0.85,
        "passes_target": agg_recall >= 0.85,
        "per_attribute_recall": {
            a: {
                "captured": attr_captured[a],
                "total": attr_total[a],
                "recall": attr_captured[a] / attr_total[a] if attr_total[a] else 0,
            }
            for a in sorted(attr_total)
        },
        "results": results,
    }

    OUT_PATH.write_text(json.dumps(summary, ensure_ascii=False, indent=2))

    # Print readable summary
    print("Phase 2E Stage 1 — Calibration recall eval")
    print("=" * 70)
    print(f"samples: {summary['n_samples']}")
    print(f"human attribute pairs: {total_human_pairs}")
    print(f"detected attribute pairs: {total_detected_pairs}")
    print(f"intersection: {total_intersection}")
    print()
    print(f"aggregate recall:    {agg_recall:.2%}")
    print(f"aggregate precision: {agg_precision:.2%}")
    print(
        f"target recall ≥ 85%: {'PASS' if summary['passes_target'] else 'FAIL'}"
    )
    print()
    print("Per-attribute recall:")
    for a, d in summary["per_attribute_recall"].items():
        print(f"  {a:35s} {d['captured']:2d}/{d['total']:2d}  ({d['recall']:.0%})")
    print()
    print("Per-sample detail:")
    for r in results:
        print(
            f"  {r['calib_id']}  "
            f"recall={r['sample_recall']:.0%}  precision={r['sample_precision']:.0%}  "
            f"missed={r['missed']}  false_pos={r['false_positives']}"
        )

    print(f"\nwrote {OUT_PATH}")


if __name__ == "__main__":
    main()
