"""Stratified sample of unlabeled rows from the matched-pair corpus.

Produces ``data/performance_validation_sample_v1.json``, a deterministic
rating-stratified sample of reviews that have NOT been labeled in
``eval_data/phase1/phase1_signals_golden.json``. Used for the
Step-1 performance-validation audit described in docs/performance_validation_v1.md.

Scope: matched pair only (디어달리아 A000000238828 + Coupang 7156638510).
Stratification: 10 rows each from {1-2★, 3★, 4★, 5★}. The 4-stratum design
avoids over-weighting the 5★ bulk (which dominates the corpus) while
ensuring the tails are exercised.

Underscore prefix = diagnostic/one-off, not part of the production pipeline.
"""

from __future__ import annotations
import json
import random
import sqlite3
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = REPO_ROOT / "voc_data.db"
GOLDEN_PATH = REPO_ROOT / "eval_data" / "phase1" / "phase1_signals_golden.json"
OUT_PATH = REPO_ROOT / "data" / "performance_validation_sample_v1.json"

MATCHED_PAIR_PRODUCT_IDS = ("A000000238828", "7156638510")
SAMPLE_PER_STRATUM = 10
SEED = 42

# Rating stratum predicates. Stratified on the integer rating bucket so a
# 5★ value of 5.0 and an integer 5 both land in the top stratum.
STRATA = [
    ("1-2★", lambda r: 1 <= r <= 2),
    ("3★",   lambda r: r == 3),
    ("4★",   lambda r: r == 4),
    ("5★",   lambda r: r == 5),
]


def load_golden_review_ids() -> set[str]:
    if not GOLDEN_PATH.is_file():
        return set()
    data = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    labels = data.get("labels") or {}
    return {str(k) for k in labels.keys()}


def fetch_candidate_rows() -> list[dict]:
    with sqlite3.connect(str(DB_PATH)) as conn:
        placeholders = ",".join("?" * len(MATCHED_PAIR_PRODUCT_IDS))
        cur = conn.execute(
            f"SELECT review_id, rating_raw, text, source_channel, product_external_id "
            f"FROM phase1_reviews "
            f"WHERE is_duplicate=0 AND product_external_id IN ({placeholders})",
            MATCHED_PAIR_PRODUCT_IDS,
        )
        return [
            {
                "review_id": rid,
                "rating_raw": rating,
                "text": text,
                "source_channel": channel,
                "product_external_id": product_id,
            }
            for rid, rating, text, channel, product_id in cur.fetchall()
            if rating is not None and text
        ]


def main() -> None:
    golden_ids = load_golden_review_ids()
    all_rows = fetch_candidate_rows()
    unlabeled = [r for r in all_rows if r["review_id"] not in golden_ids]

    rng = random.Random(SEED)
    sampled: list[dict] = []
    for name, pred in STRATA:
        stratum_rows = [r for r in unlabeled if pred(int(r["rating_raw"]))]
        if not stratum_rows:
            print(f"[warn] stratum {name} empty; skipping")
            continue
        picked = rng.sample(stratum_rows, min(SAMPLE_PER_STRATUM, len(stratum_rows)))
        for row in picked:
            sampled.append({
                "stratum": name,
                "review_id": row["review_id"],
                "rating": int(row["rating_raw"]),
                "channel": row["source_channel"],
                "product_external_id": row["product_external_id"],
                "text": row["text"],
            })

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps({
            "version": "v1",
            "generated_by": "scripts/_sample_unlabeled_rows.py",
            "seed": SEED,
            "matched_pair_product_ids": list(MATCHED_PAIR_PRODUCT_IDS),
            "excluded_golden_label_count": len(golden_ids),
            "candidate_unlabeled_total": len(unlabeled),
            "sample_per_stratum": SAMPLE_PER_STRATUM,
            "rows": sampled,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps({
        "sample_file": str(OUT_PATH),
        "total_sampled": len(sampled),
        "per_stratum": {name: sum(1 for r in sampled if r["stratum"] == name)
                         for name, _ in STRATA},
        "candidate_unlabeled_total": len(unlabeled),
        "excluded_golden_label_count": len(golden_ids),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
